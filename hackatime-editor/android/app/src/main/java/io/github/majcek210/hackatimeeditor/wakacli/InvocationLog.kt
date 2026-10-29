package io.github.majcek210.hackatimeeditor.wakacli

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Append-only JSON-lines log of every wakatime-cli invocation. Only the native
 * plugin writes it, and entries are redacted before they are written. The web
 * layer can read it but there is no method to edit or clear it. To bound disk
 * use, only the newest [MAX_ENTRIES] entries are kept.
 */
class InvocationLog(private val file: File) {
    private val lock = Any()
    private var nextId: Long = -1

    fun append(reason: String, result: RunResult, secrets: List<String>): JSONObject {
        synchronized(lock) {
            if (nextId < 0) nextId = (readAll().lastOrNull()?.optLong("id", 0) ?: 0) + 1
            val entry = JSONObject()
                .put("id", nextId++)
                .put("timestamp", Instant.now().toString())
                .put("reason", reason)
                .put("args", JSONArray(Redactor.args(result.command, secrets)))
                .put("exitCode", result.exitCode ?: JSONObject.NULL)
                .put("stdout", Redactor.text(result.stdout, secrets))
                .put("stderr", Redactor.text(result.stderr, secrets))
                .put("durationMs", result.durationMs)
            result.error?.let { entry.put("error", Redactor.text(it, secrets)) }
            file.parentFile?.mkdirs()
            file.appendText(entry.toString() + "\n")
            trim()
            return entry
        }
    }

    /** Newest first. */
    fun read(limit: Int): List<JSONObject> = synchronized(lock) { readAll().asReversed().take(limit) }

    private fun readAll(): List<JSONObject> {
        if (!file.isFile) return emptyList()
        return file.readLines().mapNotNull { line ->
            try { JSONObject(line) } catch (_: Exception) { null }
        }
    }

    private fun trim() {
        val lines = file.readLines()
        if (lines.size <= MAX_ENTRIES + 100) return
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(lines.takeLast(MAX_ENTRIES).joinToString("\n", postfix = "\n"))
        tmp.renameTo(file)
    }

    companion object {
        const val MAX_ENTRIES = 1000
    }
}
