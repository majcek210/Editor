package io.github.majcek210.hackatimeeditor.git

import android.os.Environment
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Git for project folders, using JGit. Separate from time tracking: nothing
 * here sends heartbeats, and the tracker does not see Git operations.
 *
 * The access token is stored in the app's private files dir, is never returned
 * to the web layer, and is only offered to the host it was saved for.
 */
@CapacitorPlugin(name = "Git")
class GitPlugin : Plugin() {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "git") }
    private lateinit var git: GitService
    private lateinit var credFile: File

    override fun load() {
        git = GitService(context.filesDir)
        credFile = File(context.filesDir, "git/credentials.json")
    }

    override fun handleOnDestroy() {
        executor.shutdown()
    }

    // ------------------------------------------------------------ settings

    private data class Settings(val name: String, val email: String, val username: String, val host: String, val token: String)

    private fun readSettings(): Settings {
        val j = try { JSONObject(credFile.readText()) } catch (_: Exception) { JSONObject() }
        return Settings(
            j.optString("name"), j.optString("email"), j.optString("username"),
            j.optString("host", "github.com").ifBlank { "github.com" }, j.optString("token"),
        )
    }

    private fun writeSettings(s: Settings) {
        credFile.parentFile?.mkdirs()
        val tmp = File(credFile.parentFile, "credentials.json.tmp")
        tmp.writeText(JSONObject().put("name", s.name).put("email", s.email).put("username", s.username).put("host", s.host).put("token", s.token).toString())
        tmp.setReadable(false, false); tmp.setReadable(true, true)
        tmp.renameTo(credFile)
    }

    private fun creds(): GitCredentials? {
        val s = readSettings()
        return if (s.token.isBlank()) null else GitCredentials(s.host, s.username.ifBlank { "git" }, s.token)
    }

    private fun identity(): Identity = readSettings().let { Identity(it.name, it.email) }

    @PluginMethod
    fun getConfig(call: PluginCall) {
        val s = readSettings()
        call.resolve(JSObject().put("name", s.name).put("email", s.email).put("username", s.username).put("host", s.host).put("hasToken", s.token.isNotBlank()))
    }

    @PluginMethod
    fun setConfig(call: PluginCall) {
        val cur = readSettings()
        val host = (call.getString("host") ?: cur.host).trim().lowercase().ifBlank { "github.com" }
        if (!Regex("^[a-z0-9.-]+(:[0-9]+)?$").matches(host)) return call.reject("Invalid host")
        // token: absent keeps the saved one, "" removes it.
        val token = if (call.data.has("token")) call.getString("token")?.trim().orEmpty() else cur.token
        val s = Settings(
            (call.getString("name") ?: cur.name).trim(),
            (call.getString("email") ?: cur.email).trim(),
            (call.getString("username") ?: cur.username).trim(),
            host, token,
        )
        run(call) {
            writeSettings(s)
            if (s.name.isNotBlank() && s.email.isNotBlank()) git.setIdentity(Identity(s.name, s.email))
            JSObject()
        }
    }

    // ------------------------------------------------------------ git ops

    @PluginMethod fun isRepo(call: PluginCall) = withDir(call) { JSObject().put("repo", git.isRepo(it)) }

    @PluginMethod fun init(call: PluginCall) = withDir(call) { git.init(it); JSObject() }

    @PluginMethod
    fun clone(call: PluginCall) = withDir(call) { dir ->
        val url = call.getString("url")?.trim().orEmpty()
        git.clone(url, dir, creds(), call.getString("branch"))
        JSObject()
    }

    @PluginMethod
    fun status(call: PluginCall) = withDir(call) { dir ->
        if (!git.isRepo(dir)) return@withDir JSObject().put("repo", false)
        val s = git.status(dir)
        fun list(l: List<FileChange>) = JSArray().apply { l.forEach { put(JSObject().put("path", it.path).put("kind", it.kind)) } }
        JSObject()
            .put("repo", true)
            .put("branch", s.branch)
            .put("detached", s.detached)
            .put("upstream", s.upstream)
            .put("ahead", s.ahead)
            .put("behind", s.behind)
            .put("staged", list(s.staged))
            .put("unstaged", list(s.unstaged))
            .put("conflicts", JSArray(s.conflicts))
            .put("remote", git.remoteUrl(dir))
    }

    @PluginMethod fun stage(call: PluginCall) = withDir(call) { git.stage(it, paths(call)); JSObject() }
    @PluginMethod fun stageAll(call: PluginCall) = withDir(call) { git.stageAll(it); JSObject() }
    @PluginMethod fun unstage(call: PluginCall) = withDir(call) { git.unstage(it, paths(call)); JSObject() }
    @PluginMethod fun discard(call: PluginCall) = withDir(call) { git.discard(it, paths(call)); JSObject() }

    @PluginMethod
    fun commit(call: PluginCall) = withDir(call) { dir ->
        JSObject().put("id", git.commit(dir, call.getString("message").orEmpty(), identity()))
    }

    @PluginMethod fun push(call: PluginCall) = withDir(call) { JSObject().put("message", git.push(it, creds())) }
    @PluginMethod fun pull(call: PluginCall) = withDir(call) { JSObject().put("message", git.pull(it, creds())) }
    @PluginMethod fun fetch(call: PluginCall) = withDir(call) { git.fetch(it, creds()); JSObject() }

    @PluginMethod
    fun branches(call: PluginCall) = withDir(call) { dir ->
        val (local, remote) = git.branches(dir)
        JSObject().put("local", JSArray(local)).put("remote", JSArray(remote))
    }

    @PluginMethod
    fun checkout(call: PluginCall) = withDir(call) { dir ->
        git.checkout(dir, call.getString("name").orEmpty(), call.getBoolean("create", false) == true)
        JSObject()
    }

    @PluginMethod
    fun setRemote(call: PluginCall) = withDir(call) { git.setRemote(it, call.getString("url")?.trim().orEmpty()); JSObject() }

    @PluginMethod
    fun log(call: PluginCall) = withDir(call) { dir ->
        val arr = JSArray()
        git.log(dir, (call.getInt("max") ?: 50).coerceIn(1, 500)).forEach {
            arr.put(JSObject().put("id", it.id).put("message", it.message).put("author", it.author).put("time", it.time))
        }
        JSObject().put("commits", arr)
    }

    // ------------------------------------------------------------ helpers

    private fun paths(call: PluginCall): List<String> = call.getArray("paths")?.toList<String>() ?: emptyList()

    /** Project folders must be inside the app's external files dir or Documents. */
    private fun allowedDir(path: String?): File {
        if (path.isNullOrBlank() || !path.startsWith("/")) throw GitError("A project folder is required")
        val dir = File(path).canonicalFile
        val roots = listOfNotNull(
            context.getExternalFilesDir(null),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
        ).map { it.canonicalFile }
        if (roots.none { dir.path == it.path || dir.path.startsWith(it.path + "/") }) {
            throw GitError("Git is only available for project folders")
        }
        return dir
    }

    private fun withDir(call: PluginCall, block: (File) -> JSObject) {
        val dir = try { allowedDir(call.getString("dir")) } catch (e: GitError) { return call.reject(e.message) }
        run(call) { block(dir) }
    }

    private fun run(call: PluginCall, block: () -> JSObject) {
        executor.execute {
            try {
                call.resolve(block())
            } catch (e: Exception) {
                call.reject(redact(e.message ?: e.javaClass.simpleName))
            }
        }
    }

    private fun redact(msg: String): String {
        val token = readSettings().token
        return if (token.isBlank()) msg else msg.replace(token, "<redacted>")
    }
}
