package io.github.majcek210.hackatimeeditor.wakacli

import java.io.File

/**
 * The wakatime config file passed with --config, and readers for the CLI's
 * own internal state file (~/.wakatime/wakatime-internal.cfg).
 * Format: INI, [settings] section (wakatime-cli pkg/ini, pkg/params).
 */
object WakaConfig {
    const val API_URL = "https://hackatime.hackclub.com/api/hackatime/v1"
    const val RATE_LIMIT_SECONDS = 30
    /** CLI request timeout; below the plugin's 10 s process timeout. */
    const val CLI_TIMEOUT_SECONDS = 8

    // Same pattern wakatime-cli validates against (pkg/params/params.go apiKeyRegex).
    private val KEY_RE = Regex("^(waka_)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$")

    fun isValidKey(key: String) = KEY_RE.matches(key)

    fun render(apiKey: String): String = buildString {
        append("[settings]\n")
        append("api_url = ").append(API_URL).append('\n')
        append("api_key = ").append(apiKey).append('\n')
        append("heartbeat_rate_limit_seconds = ").append(RATE_LIMIT_SECONDS).append('\n')
        append("timeout = ").append(CLI_TIMEOUT_SECONDS).append('\n')
    }

    fun write(file: File, apiKey: String) {
        require(isValidKey(apiKey)) { "That does not look like a Hackatime API key (expected a UUID)." }
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(render(apiKey))
        tmp.setReadable(false, false); tmp.setReadable(true, true)
        tmp.setWritable(false, false); tmp.setWritable(true, true)
        if (!tmp.renameTo(file)) {
            file.writeText(render(apiKey))
            tmp.delete()
        }
    }

    fun readKey(file: File): String? = readIni(file)["settings.api_key"]?.takeIf { it.isNotBlank() }

    /** Minimal INI reader: returns "section.key" to value. */
    fun readIni(file: File): Map<String, String> {
        if (!file.isFile) return emptyMap()
        val out = HashMap<String, String>()
        var section = ""
        file.forEachLine { raw ->
            val line = raw.trim()
            when {
                line.isEmpty() || line.startsWith("#") || line.startsWith(";") -> {}
                line.startsWith("[") && line.endsWith("]") -> section = line.substring(1, line.length - 1).trim()
                '=' in line -> {
                    val k = line.substringBefore('=').trim()
                    val v = line.substringAfter('=').trim()
                    out["$section.$k"] = v
                }
            }
        }
        return out
    }
}
