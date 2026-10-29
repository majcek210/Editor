package io.github.majcek210.hackatimeeditor.git

import org.eclipse.jgit.api.CreateBranchCommand
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.api.ListBranchCommand
import org.eclipse.jgit.api.MergeResult
import org.eclipse.jgit.api.errors.GitAPIException
import org.eclipse.jgit.lib.BranchTrackingStatus
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.lib.PersonIdent
import org.eclipse.jgit.lib.Repository
import org.eclipse.jgit.lib.StoredConfig
import org.eclipse.jgit.storage.file.FileBasedConfig
import org.eclipse.jgit.storage.file.FileRepositoryBuilder
import org.eclipse.jgit.transport.CredentialItem
import org.eclipse.jgit.transport.CredentialsProvider
import org.eclipse.jgit.transport.RefSpec
import org.eclipse.jgit.transport.URIish
import org.eclipse.jgit.util.FS
import org.eclipse.jgit.util.SystemReader
import java.io.File

/** Credentials for one HTTPS host. The token is only offered to that host. */
data class GitCredentials(val host: String, val username: String, val token: String)

data class Identity(val name: String, val email: String)

data class FileChange(val path: String, val kind: String)

data class RepoStatus(
    val branch: String?,
    val detached: Boolean,
    val upstream: String?,
    val ahead: Int,
    val behind: Int,
    val staged: List<FileChange>,
    val unstaged: List<FileChange>,
    val conflicts: List<String>,
)

data class CommitInfo(val id: String, val message: String, val author: String, val time: Long)

class GitError(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Plain JVM wrapper around JGit. No Android dependencies so it can be unit
 * tested on the JVM. All paths are absolute working tree paths.
 */
class GitService(private val home: File) {
    init {
        isolateFromSystem(home)
    }

    // ------------------------------------------------------------ repo info

    fun isRepo(dir: File): Boolean = File(dir, ".git").exists()

    fun init(dir: File, initialBranch: String = "main") {
        dir.mkdirs()
        wrap("init") { Git.init().setDirectory(dir).setInitialBranch(initialBranch).call().close() }
    }

    fun clone(url: String, dir: File, creds: GitCredentials?, branch: String? = null) {
        requireHttps(url)
        if (dir.exists() && (dir.list()?.isNotEmpty() == true)) throw GitError("Folder ${dir.name} already exists and is not empty")
        wrap("clone") {
            val cmd = Git.cloneRepository().setURI(url).setDirectory(dir)
                .setCredentialsProvider(provider(creds, url))
            if (!branch.isNullOrBlank()) cmd.setBranch(branch)
            cmd.call().use { git ->
                // An empty remote has no HEAD to follow; JGit then defaults to
                // "master". Use "main" like GitHub does.
                val repo = git.repository
                if (repo.resolve(Constants.HEAD) == null && branch.isNullOrBlank()) {
                    repo.updateRef(Constants.HEAD).link(Constants.R_HEADS + "main")
                }
            }
        }
    }

    fun status(dir: File): RepoStatus = open(dir) { git ->
        val repo = git.repository
        val s = wrap("status") { git.status().call() }
        val staged = ArrayList<FileChange>()
        val unstaged = ArrayList<FileChange>()
        s.added.forEach { staged.add(FileChange(it, "added")) }
        s.changed.forEach { staged.add(FileChange(it, "modified")) }
        s.removed.forEach { staged.add(FileChange(it, "deleted")) }
        s.modified.forEach { unstaged.add(FileChange(it, "modified")) }
        s.missing.forEach { unstaged.add(FileChange(it, "deleted")) }
        s.untracked.forEach { unstaged.add(FileChange(it, "untracked")) }
        val branch = repo.branch
        val full = repo.fullBranch
        val detached = full == null || !full.startsWith(Constants.R_HEADS)
        val tracking = if (!detached && branch != null) BranchTrackingStatus.of(repo, branch) else null
        RepoStatus(
            branch = if (detached) branch?.take(7) else branch,
            detached = detached,
            upstream = tracking?.remoteTrackingBranch?.removePrefix(Constants.R_REMOTES),
            ahead = tracking?.aheadCount ?: 0,
            behind = tracking?.behindCount ?: 0,
            staged = staged.sortedBy { it.path },
            unstaged = unstaged.sortedBy { it.path },
            conflicts = s.conflicting.sorted(),
        )
    }

    // ------------------------------------------------------------- staging

    fun stage(dir: File, paths: List<String>) = open(dir) { git ->
        wrap("stage") {
            val add = git.add()
            val rm = git.rm().setCached(true)
            var anyAdd = false
            var anyRm = false
            for (p in paths) {
                checkPath(p)
                if (File(dir, p).exists()) { add.addFilepattern(p); anyAdd = true } else { rm.addFilepattern(p); anyRm = true }
            }
            if (anyAdd) add.call()
            if (anyRm) rm.call()
        }
    }

    fun stageAll(dir: File) = open(dir) { git ->
        wrap("stage all") {
            git.add().addFilepattern(".").call()
            git.add().addFilepattern(".").setUpdate(true).call()
        }
    }

    fun unstage(dir: File, paths: List<String>) = open(dir) { git ->
        wrap("unstage") {
            val reset = git.reset()
            paths.forEach { checkPath(it); reset.addPath(it) }
            reset.call()
        }
    }

    /** Throws away working tree changes for these paths. Untracked files are deleted. */
    fun discard(dir: File, paths: List<String>) = open(dir) { git ->
        wrap("discard") {
            val status = git.status().call()
            val untracked = paths.filter { it in status.untracked }
            val tracked = paths - untracked.toSet()
            untracked.forEach { checkPath(it); File(dir, it).delete() }
            if (tracked.isNotEmpty()) {
                val co = git.checkout()
                tracked.forEach { checkPath(it); co.addPath(it) }
                co.call()
            }
        }
    }

    // ------------------------------------------------------------- commits

    fun commit(dir: File, message: String, who: Identity): String = open(dir) { git ->
        if (message.isBlank()) throw GitError("Commit message is empty")
        if (who.name.isBlank() || who.email.isBlank()) throw GitError("Set your Git name and email in Settings first")
        val person = PersonIdent(who.name, who.email)
        wrap("commit") {
            val s = git.status().call()
            if (s.added.isEmpty() && s.changed.isEmpty() && s.removed.isEmpty()) throw GitError("Nothing staged to commit")
            git.commit().setMessage(message).setAuthor(person).setCommitter(person).call().name
        }
    }

    fun log(dir: File, max: Int): List<CommitInfo> = open(dir) { git ->
        try {
            git.log().setMaxCount(max).call().map {
                CommitInfo(it.name, it.fullMessage.trim(), it.authorIdent.name, it.commitTime.toLong() * 1000)
            }
        } catch (_: Exception) {
            emptyList() // no commits yet
        }
    }

    // ------------------------------------------------------------- branches

    fun branches(dir: File): Pair<List<String>, List<String>> = open(dir) { git ->
        val local = wrap("branches") { git.branchList().call() }.map { Repository.shortenRefName(it.name) }
        val remote = wrap("branches") { git.branchList().setListMode(ListBranchCommand.ListMode.REMOTE).call() }
            .map { it.name.removePrefix(Constants.R_REMOTES) }
            .filter { !it.endsWith("/HEAD") }
        local.sorted() to remote.sorted()
    }

    /** Checks out a local branch, or creates a tracking branch for "origin/x". */
    fun checkout(dir: File, name: String, create: Boolean) = open(dir) { git ->
        wrap("checkout") {
            val repo = git.repository
            when {
                create -> git.checkout().setCreateBranch(true).setName(name).call()
                repo.findRef(Constants.R_HEADS + name) != null -> git.checkout().setName(name).call()
                repo.findRef(Constants.R_REMOTES + name) != null -> {
                    val local = name.substringAfter('/')
                    git.checkout().setCreateBranch(true).setName(local).setStartPoint(name)
                        .setUpstreamMode(CreateBranchCommand.SetupUpstreamMode.TRACK).call()
                }
                else -> throw GitError("No branch named $name")
            }
        }
    }

    // ------------------------------------------------------------- remotes

    fun remoteUrl(dir: File): String? = open(dir) { it.repository.config.getString("remote", "origin", "url") }

    fun setRemote(dir: File, url: String) = open(dir) { git ->
        requireHttps(url)
        val cfg: StoredConfig = git.repository.config
        cfg.setString("remote", "origin", "url", url)
        cfg.setString("remote", "origin", "fetch", "+refs/heads/*:refs/remotes/origin/*")
        cfg.save()
    }

    fun fetch(dir: File, creds: GitCredentials?) = open(dir) { git ->
        val url = remoteUrl(dir) ?: throw GitError("No remote named origin")
        wrap("fetch") { git.fetch().setRemote("origin").setCredentialsProvider(provider(creds, url)).call() }
    }

    /** Fetch then merge the upstream branch. Returns a short description. */
    fun pull(dir: File, creds: GitCredentials?): String = open(dir) { git ->
        val url = remoteUrl(dir) ?: throw GitError("No remote named origin")
        val r = wrap("pull") {
            git.pull().setRemote("origin").setCredentialsProvider(provider(creds, url)).call()
        }
        val merge = r.mergeResult
        when {
            !r.isSuccessful && merge?.mergeStatus == MergeResult.MergeStatus.CONFLICTING ->
                "Merge conflicts in: ${merge.conflicts?.keys?.joinToString(", ")}. Fix them, stage and commit."
            !r.isSuccessful -> throw GitError("Pull failed: ${merge?.mergeStatus ?: r.rebaseResult?.status ?: "unknown"}")
            merge == null -> "Up to date"
            else -> when (merge.mergeStatus) {
                MergeResult.MergeStatus.ALREADY_UP_TO_DATE -> "Already up to date"
                MergeResult.MergeStatus.FAST_FORWARD -> "Fast-forwarded"
                else -> "Merged (${merge.mergeStatus})"
            }
        }
    }

    /** Pushes the current branch to origin and sets it as upstream. */
    fun push(dir: File, creds: GitCredentials?): String = open(dir) { git ->
        val repo = git.repository
        val url = remoteUrl(dir) ?: throw GitError("No remote named origin. Add one first.")
        val branch = repo.branch ?: throw GitError("No branch checked out")
        if (repo.fullBranch?.startsWith(Constants.R_HEADS) != true) throw GitError("HEAD is detached; check out a branch to push")
        val results = wrap("push") {
            git.push().setRemote("origin")
                .setRefSpecs(RefSpec("refs/heads/$branch:refs/heads/$branch"))
                .setCredentialsProvider(provider(creds, url)).call()
        }
        val problems = results.flatMap { it.remoteUpdates }
            .filter { it.status.name !in setOf("OK", "UP_TO_DATE") }
            .map { "${it.remoteName}: ${it.status}${it.message?.let { m -> " ($m)" } ?: ""}" }
        if (problems.isNotEmpty()) {
            throw GitError("Push rejected: ${problems.joinToString("; ")}. Pull first if the remote has new commits.")
        }
        val cfg = repo.config
        if (cfg.getString("branch", branch, "remote") == null) {
            cfg.setString("branch", branch, "remote", "origin")
            cfg.setString("branch", branch, "merge", "refs/heads/$branch")
            cfg.save()
        }
        "Pushed $branch to origin"
    }

    /** Writes user.name and user.email to the app's own user gitconfig (used for merge commits). */
    fun setIdentity(who: Identity) {
        val cfg = SystemReader.getInstance().openUserConfig(null, FS.DETECTED)
        cfg.load()
        cfg.setString("user", null, "name", who.name)
        cfg.setString("user", null, "email", who.email)
        cfg.save()
    }

    // ------------------------------------------------------------- helpers

    private fun <T> open(dir: File, block: (Git) -> T): T {
        val repo = try {
            FileRepositoryBuilder().setWorkTree(dir).setGitDir(File(dir, ".git")).setMustExist(true).build()
        } catch (e: Exception) {
            throw GitError("${dir.name} is not a Git repository")
        }
        return Git(repo).use(block)
    }

    private fun <T> wrap(op: String, block: () -> T): T = try {
        block()
    } catch (e: GitError) {
        throw e
    } catch (e: GitAPIException) {
        throw GitError("$op failed: ${rootMessage(e)}", e)
    } catch (e: Exception) {
        throw GitError("$op failed: ${rootMessage(e)}", e)
    }

    private fun rootMessage(e: Throwable): String {
        var t: Throwable = e
        val parts = LinkedHashSet<String>()
        while (true) {
            t.message?.let { parts.add(it) }
            t = t.cause ?: break
        }
        return parts.joinToString(": ").ifBlank { e.javaClass.simpleName }
    }

    private fun checkPath(p: String) {
        if (p.startsWith("/") || p.split('/').any { it == ".." } || p.startsWith(".git/") || p == ".git") {
            throw GitError("Invalid path: $p")
        }
    }

    companion object {
        fun requireHttps(url: String) {
            val uri = try { URIish(url) } catch (e: Exception) { throw GitError("Not a valid Git URL: $url") }
            if (uri.scheme != "https" && uri.scheme != "file") throw GitError("Only https:// remotes are supported")
            if (!uri.user.isNullOrEmpty() || !uri.pass.isNullOrEmpty()) {
                throw GitError("Do not put credentials in the URL; set a token in Settings instead")
            }
        }

        /** Offers the token only to the host it was saved for. */
        fun provider(creds: GitCredentials?, url: String): CredentialsProvider? {
            if (creds == null) return null
            return object : CredentialsProvider() {
                override fun isInteractive() = false
                override fun supports(vararg items: CredentialItem) =
                    items.all { it is CredentialItem.Username || it is CredentialItem.Password }

                override fun get(uri: URIish, vararg items: CredentialItem): Boolean {
                    if (uri.scheme != "https" || !uri.host.equals(creds.host, ignoreCase = true)) return false
                    for (item in items) when (item) {
                        is CredentialItem.Username -> item.value = creds.username
                        is CredentialItem.Password -> item.value = creds.token.toCharArray()
                        else -> return false
                    }
                    return true
                }
            }.takeIf { (try { URIish(url).host } catch (_: Exception) { null }).equals(creds.host, ignoreCase = true) }
        }

        @Volatile private var isolated = false

        /**
         * JGit would otherwise read /etc/gitconfig (and try to run a "git"
         * binary to find it) and ~/.gitconfig. On Android neither exists, so
         * use empty system config and a user config inside the app dir.
         */
        @Synchronized
        fun isolateFromSystem(home: File) {
            if (isolated) return
            val parent = SystemReader.getInstance()
            SystemReader.setInstance(object : SystemReader() {
                override fun getHostname(): String = parent.hostname
                override fun getenv(variable: String): String? =
                    if (variable == "GIT_CONFIG_NOSYSTEM") "1" else parent.getenv(variable)
                override fun getProperty(key: String): String? = parent.getProperty(key)
                override fun getCurrentTime(): Long = parent.currentTime
                override fun getTimezone(time: Long): Int = parent.getTimezone(time)

                override fun openSystemConfig(parent: org.eclipse.jgit.lib.Config?, fs: FS): FileBasedConfig =
                    object : FileBasedConfig(parent, File(home, "git/system.gitconfig"), fs) {
                        override fun load() {}
                        override fun isOutdated() = false
                    }

                override fun openUserConfig(parent: org.eclipse.jgit.lib.Config?, fs: FS): FileBasedConfig =
                    FileBasedConfig(parent, File(home, "git/user.gitconfig"), fs)

                override fun openJGitConfig(parent: org.eclipse.jgit.lib.Config?, fs: FS): FileBasedConfig =
                    FileBasedConfig(parent, File(home, "git/jgit.config"), fs)
            })
            File(home, "git").mkdirs()
            FS.DETECTED.setUserHome(home)
            isolated = true
        }
    }
}
