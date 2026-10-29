package io.github.majcek210.hackatimeeditor.wakacli

import java.util.Base64

/** Removes the API key from anything written to the Tracking Log. */
object Redactor {
    const val REDACTED = "<redacted>"
    private val KEY_RE = Regex("(?i)(waka_)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
    private val FLAG_RE = Regex("(--key[= ])\\S+")
    private val CFG_RE = Regex("(api_key\\s*=\\s*)\\S+")
    private val BASIC_RE = Regex("(Basic\\s+)[A-Za-z0-9+/=]{8,}")

    fun text(input: String, secrets: List<String> = emptyList()): String {
        var out = input
        for (s in secrets) {
            if (s.isEmpty()) continue
            out = out.replace(s, REDACTED)
            out = out.replace(Base64.getEncoder().encodeToString(s.toByteArray()), REDACTED)
        }
        out = FLAG_RE.replace(out) { it.groupValues[1] + REDACTED }
        out = CFG_RE.replace(out) { it.groupValues[1] + REDACTED }
        out = BASIC_RE.replace(out) { it.groupValues[1] + REDACTED }
        return KEY_RE.replace(out, REDACTED)
    }

    fun args(args: List<String>, secrets: List<String> = emptyList()): List<String> {
        val out = ArrayList<String>(args.size)
        var i = 0
        while (i < args.size) {
            val a = args[i]
            when {
                a == "--key" -> {
                    out.add(a)
                    if (i + 1 < args.size) { out.add(REDACTED); i++ }
                }
                a.startsWith("--key=") -> out.add("--key=$REDACTED")
                else -> out.add(text(a, secrets))
            }
            i++
        }
        return out
    }
}
