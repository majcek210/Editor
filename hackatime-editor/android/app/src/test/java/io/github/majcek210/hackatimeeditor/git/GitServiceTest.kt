package io.github.majcek210.hackatimeeditor.git

import org.eclipse.jgit.api.Git
import org.eclipse.jgit.transport.CredentialItem
import org.eclipse.jgit.transport.URIish
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class GitServiceTest {
    private val tmp: File = Files.createTempDirectory("gitsvc").toFile()
    private val git = GitService(File(tmp, "home"))
    private val me = Identity("Test User", "test@example.com")

    private fun bareRemote(): String {
        val bare = File(tmp, "remote.git")
        Git.init().setBare(true).setDirectory(bare).setInitialBranch("main").call().close()
        return bare.toURI().toString()
    }

    @Test fun cloneCommitPushPullRoundTrip() {
        val url = bareRemote()
        val a = File(tmp, "a")
        val b = File(tmp, "b")
        git.clone(url, a, null)
        assertTrue(git.isRepo(a))

        File(a, "hello.py").writeText("print('hi')\n")
        var s = git.status(a)
        assertEquals(listOf(FileChange("hello.py", "untracked")), s.unstaged)
        git.stage(a, listOf("hello.py"))
        s = git.status(a)
        assertEquals(listOf(FileChange("hello.py", "added")), s.staged)
        git.commit(a, "first", me)
        assertEquals("Pushed main to origin", git.push(a, null))
        assertEquals("origin/main", git.status(a).upstream)

        git.clone(url, b, null)
        assertEquals("print('hi')\n", File(b, "hello.py").readText())
        File(b, "hello.py").appendText("print('more')\n")
        git.stageAll(b)
        git.commit(b, "second", me)
        git.push(b, null)

        git.fetch(a, null)
        assertEquals(1, git.status(a).behind)
        assertEquals("Fast-forwarded", git.pull(a, null))
        assertTrue(File(a, "hello.py").readText().contains("more"))
        assertEquals(listOf("second", "first"), git.log(a, 10).map { it.message })
        assertEquals("Test User", git.log(a, 1)[0].author)
    }

    @Test fun stageUnstageDiscardAndDelete() {
        val dir = File(tmp, "r")
        git.init(dir)
        File(dir, "a.txt").writeText("one\n")
        git.stageAll(dir)
        git.commit(dir, "init", me)

        File(dir, "a.txt").writeText("changed\n")
        File(dir, "new.txt").writeText("new\n")
        git.stage(dir, listOf("a.txt"))
        assertEquals(listOf(FileChange("a.txt", "modified")), git.status(dir).staged)
        git.unstage(dir, listOf("a.txt"))
        assertTrue(git.status(dir).staged.isEmpty())
        git.discard(dir, listOf("a.txt", "new.txt"))
        assertEquals("one\n", File(dir, "a.txt").readText())
        assertFalse(File(dir, "new.txt").exists())

        File(dir, "a.txt").delete()
        git.stage(dir, listOf("a.txt"))
        assertEquals(listOf(FileChange("a.txt", "deleted")), git.status(dir).staged)
    }

    @Test fun branches() {
        val dir = File(tmp, "br")
        git.init(dir)
        File(dir, "x").writeText("x")
        git.stageAll(dir)
        git.commit(dir, "init", me)
        git.checkout(dir, "feature", create = true)
        assertEquals("feature", git.status(dir).branch)
        assertEquals(listOf("feature", "main"), git.branches(dir).first)
        git.checkout(dir, "main", create = false)
        assertEquals("main", git.status(dir).branch)
    }

    @Test fun refusesBadInput() {
        val dir = File(tmp, "bad")
        git.init(dir)
        assertThrows(GitError::class.java) { git.commit(dir, "msg", me) } // nothing staged
        assertThrows(GitError::class.java) { git.commit(dir, " ", me) }
        assertThrows(GitError::class.java) { git.commit(dir, "msg", Identity("", "")) }
        assertThrows(GitError::class.java) { git.stage(dir, listOf("../etc/passwd")) }
        assertThrows(GitError::class.java) { git.push(dir, null) } // no remote
        assertThrows(GitError::class.java) { GitService.requireHttps("http://example.com/r.git") }
        assertThrows(GitError::class.java) { GitService.requireHttps("https://user:tok@github.com/r.git") }
        GitService.requireHttps("https://github.com/o/r.git")
        assertThrows(GitError::class.java) { git.status(File(tmp, "nope")) }
    }

    @Test fun tokenOnlyGoesToItsHost() {
        val creds = GitCredentials("github.com", "me", "secret-token")
        assertNull(GitService.provider(creds, "https://gitlab.com/o/r.git"))
        val p = GitService.provider(creds, "https://github.com/o/r.git")
        assertNotNull(p)
        val user = CredentialItem.Username()
        val pass = CredentialItem.Password()
        assertTrue(p!!.get(URIish("https://github.com/o/r.git"), user, pass))
        assertEquals("secret-token", String(pass.value))
        assertFalse(p.get(URIish("https://evil.example/o/r.git"), CredentialItem.Username(), CredentialItem.Password()))
    }
}
