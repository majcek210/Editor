package io.github.majcek210.hackatimeeditor.wakacli

import java.io.File
import java.io.InputStream
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Result of one wakatime-cli process. exitCode is null when it did not finish. */
data class RunResult(
    val command: List<String>,
    val exitCode: Int?,
    val stdout: String,
    val stderr: String,
    val durationMs: Long,
    val error: String? = null,
)

/**
 * Runs the bundled wakatime-cli once. Callers must run this off the main
 * thread. The process gets a minimal environment: HOME is the app files dir
 * (so ~/.wakatime holds the CLI's own offline queue and internal state) and
 * SSL_CERT_FILE points at the bundled Mozilla CA file.
 */
class CliRunner(
    private val binary: File,
    private val home: File,
    private val config: File,
    private val caFile: File,
    private val tmpDir: File,
    private val timeoutMs: Long = 10_000,
) {
    fun command(args: List<String>): List<String> =
        listOf(binary.absolutePath, "--config", config.absolutePath, "--log-to-stdout") + args

    fun run(args: List<String>): RunResult {
        val cmd = command(args)
        val started = System.nanoTime()
        fun elapsed() = (System.nanoTime() - started) / 1_000_000
        File(home, ".wakatime").mkdirs()
        tmpDir.mkdirs()
        val pb = ProcessBuilder(cmd).directory(home)
        val env = pb.environment()
        env.clear()
        env["HOME"] = home.absolutePath
        env["SSL_CERT_FILE"] = caFile.absolutePath
        env["TMPDIR"] = tmpDir.absolutePath
        env["PATH"] = "/system/bin:/system/xbin:/usr/bin:/bin"
        val process = try {
            pb.start()
        } catch (e: Exception) {
            return RunResult(cmd, null, "", "", elapsed(), "failed to start: ${e.message}")
        }
        val out = StringBuilder()
        val err = StringBuilder()
        val tOut = thread(name = "wakacli-stdout") { drain(process.inputStream, out) }
        val tErr = thread(name = "wakacli-stderr") { drain(process.errorStream, err) }
        val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            process.waitFor(2, TimeUnit.SECONDS)
        }
        tOut.join(2000)
        tErr.join(2000)
        return RunResult(
            cmd,
            if (finished) process.exitValue() else null,
            out.toString(),
            err.toString(),
            elapsed(),
            if (finished) null else "timed out after ${timeoutMs / 1000} s; process killed",
        )
    }

    private fun drain(input: InputStream, into: StringBuilder) {
        val buf = ByteArray(8192)
        val bytes = java.io.ByteArrayOutputStream()
        try {
            input.use {
                while (true) {
                    val n = it.read(buf)
                    if (n < 0) break
                    if (bytes.size() < MAX_OUTPUT) bytes.write(buf, 0, minOf(n, MAX_OUTPUT - bytes.size()))
                }
            }
        } catch (_: Exception) {
        }
        synchronized(into) { into.append(bytes.toString(Charsets.UTF_8.name())) }
    }

    companion object {
        const val MAX_OUTPUT = 64 * 1024
    }
}
