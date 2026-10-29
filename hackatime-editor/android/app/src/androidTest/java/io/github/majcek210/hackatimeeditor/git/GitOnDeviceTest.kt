package io.github.majcek210.hackatimeeditor.git

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Runs JGit on the Android runtime: HTTPS clone of a public repo, then a local commit. */
@RunWith(AndroidJUnit4::class)
class GitOnDeviceTest {
    @Test
    fun cloneStageCommitOnDevice() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val root = File(ctx.getExternalFilesDir(null), "projects/ci-git-test").apply { deleteRecursively() }
        val git = GitService(ctx.filesDir)
        git.clone("https://github.com/octocat/Hello-World.git", root, null)
        assertTrue(File(root, "README").isFile)
        assertEquals("master", git.status(root).branch)

        File(root, "note.txt").writeText("from the emulator\n")
        git.stage(root, listOf("note.txt"))
        val id = git.commit(root, "test commit", Identity("CI", "ci@example.com"))
        assertEquals(40, id.length)
        val s = git.status(root)
        assertTrue(s.staged.isEmpty() && s.unstaged.isEmpty())
        assertEquals(1, s.ahead)
        root.deleteRecursively()
    }
}
