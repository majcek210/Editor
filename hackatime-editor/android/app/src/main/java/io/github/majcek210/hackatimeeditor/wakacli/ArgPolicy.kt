package io.github.majcek210.hackatimeeditor.wakacli

/**
 * Allow-list for the arguments the web layer may pass to wakatime-cli.
 * Only single-heartbeat flags are accepted. Everything that could change where
 * data goes or how it is authenticated (--key, --api-url, --config, --proxy,
 * --no-ssl-verify, --config-write, --extra-heartbeats, ...) is rejected; the
 * plugin sets --config itself.
 */
object ArgPolicy {
    private val VALUE_FLAGS = setOf(
        "--entity", "--entity-type", "--plugin", "--category", "--project",
        "--language", "--lineno", "--cursorpos", "--lines-in-file",
    )
    private val BOOL_FLAGS = setOf("--write", "--sync-ai-disabled")
    private val NUMERIC = setOf("--lineno", "--cursorpos", "--lines-in-file")
    private val CATEGORIES = setOf("coding")

    class Rejected(message: String) : IllegalArgumentException(message)

    /** Throws [Rejected] unless [args] is a valid single heartbeat for [expectedPlugin]. */
    fun validate(args: List<String>, expectedPlugin: String) {
        val seen = HashSet<String>()
        var i = 0
        while (i < args.size) {
            val flag = args[i]
            if (flag in BOOL_FLAGS) {
                if (!seen.add(flag)) throw Rejected("duplicate flag $flag")
                i++
                continue
            }
            if (flag !in VALUE_FLAGS) throw Rejected("flag not allowed: $flag")
            if (!seen.add(flag)) throw Rejected("duplicate flag $flag")
            if (i + 1 >= args.size) throw Rejected("missing value for $flag")
            val value = args[i + 1]
            if (value.isEmpty() || value.startsWith("--")) throw Rejected("bad value for $flag")
            when (flag) {
                "--entity" -> if (!value.startsWith("/") || value.contains('\u0000')) throw Rejected("entity must be an absolute path")
                "--entity-type" -> if (value != "file") throw Rejected("entity type must be file")
                "--plugin" -> if (value != expectedPlugin) throw Rejected("plugin must be $expectedPlugin")
                "--category" -> if (value !in CATEGORIES) throw Rejected("category not allowed: $value")
            }
            if (flag in NUMERIC && value.toIntOrNull()?.let { it > 0 } != true) throw Rejected("$flag must be a positive integer")
            i += 2
        }
        for (required in listOf("--entity", "--plugin")) {
            if (required !in seen) throw Rejected("missing $required")
        }
    }
}
