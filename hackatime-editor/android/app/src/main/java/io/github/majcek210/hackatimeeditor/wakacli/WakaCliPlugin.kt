package io.github.majcek210.hackatimeeditor.wakacli

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
 * Runs the bundled, official wakatime-cli. This is the only code in the app
 * that causes network traffic to Hackatime, and it does so only by starting
 * the CLI process. There is no HTTP client, no retry and no queue here: the
 * CLI's own rate limiting and offline queue are used as they are.
 */
@CapacitorPlugin(name = "WakaCli")
class WakaCliPlugin : Plugin() {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "wakacli") }

    @Volatile
    private var foreground = true

    private lateinit var home: File
    private lateinit var dir: File
    private lateinit var configFile: File
    private lateinit var caFile: File
    private lateinit var testEntity: File
    private lateinit var log: InvocationLog
    private lateinit var binary: File
    private var buildInfo: JSONObject? = null
    private var abiName: String? = null

    override fun load() {
        val ctx = context
        home = ctx.filesDir
        dir = File(home, "wakatime").apply { mkdirs() }
        configFile = File(dir, "hackatime-editor.cfg")
        caFile = File(dir, "cacert.pem")
        log = InvocationLog(File(dir, "invocations.jsonl"))
        testEntity = File(home, "tracking-test/hackatime-editor-test.txt")
        binary = File(ctx.applicationInfo.nativeLibraryDir, "libwakatime.so")
        abiName = abiFromLibDir(ctx.applicationInfo.nativeLibraryDir)
        File(home, ".wakatime").mkdirs()
        // Copy the bundled Mozilla CA bundle out of the APK so the CLI can read it.
        try {
            ctx.assets.open("cacert.pem").use { input ->
                val bytes = input.readBytes()
                if (!caFile.isFile || !caFile.readBytes().contentEquals(bytes)) caFile.writeBytes(bytes)
            }
        } catch (_: Exception) {
        }
        buildInfo = try {
            JSONObject(ctx.assets.open("wakatime-cli-build.json").bufferedReader().use { it.readText() })
        } catch (_: Exception) {
            null
        }
    }

    override fun handleOnPause() {
        foreground = false
    }

    override fun handleOnResume() {
        foreground = true
    }

    override fun handleOnDestroy() {
        executor.shutdown()
    }

    private fun appVersion(): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0.0.0"

    private fun pluginString() = "hackatime-editor/${appVersion()}"

    private fun unavailableReason(): String? = when {
        !binary.isFile -> "libwakatime.so is not in ${binary.parent} (this APK was built without the CLI for ${abiName ?: "this ABI"})"
        !binary.canExecute() -> "libwakatime.so is not executable; native library extraction may be disabled"
        !caFile.isFile -> "CA bundle could not be copied to ${caFile.path}"
        else -> null
    }

    @PluginMethod
    fun getInfo(call: PluginCall) {
        val reason = unavailableReason()
        val abiInfo = abiName?.let { buildInfo?.optJSONObject("abis")?.optJSONObject(it) }
        val ret = JSObject()
            .put("available", reason == null)
            .put("binaryPath", binary.absolutePath)
            .put("appVersion", appVersion())
            .put("hasApiKey", WakaConfig.readKey(configFile) != null)
            .put("apiUrl", WakaConfig.API_URL)
            .put("testEntity", testEntity.absolutePath)
        if (reason != null) ret.put("reason", reason)
        abiName?.let { ret.put("abi", it) }
        buildInfo?.optString("version")?.let { ret.put("cliVersion", it) }
        abiInfo?.let { ret.put("cgo", it.optInt("cgo", 0) == 1) }
        call.resolve(ret)
    }

    @PluginMethod
    fun setApiKey(call: PluginCall) {
        val key = call.getString("apiKey")?.trim().orEmpty()
        executor.execute {
            try {
                WakaConfig.write(configFile, key)
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "could not write config")
            }
        }
    }

    @PluginMethod
    fun clearApiKey(call: PluginCall) {
        executor.execute {
            configFile.delete()
            call.resolve()
        }
    }

    @PluginMethod
    fun heartbeat(call: PluginCall) {
        val reason = call.getString("reason") ?: "unknown"
        val args = try {
            call.getArray("args")?.toList<String>() ?: emptyList()
        } catch (e: Exception) {
            call.reject("args must be an array of strings")
            return
        }
        // Defense in depth: the web layer already refuses while backgrounded.
        if (!foreground) {
            call.reject("refused: app is in the background")
            return
        }
        try {
            ArgPolicy.validate(args, pluginString())
        } catch (e: ArgPolicy.Rejected) {
            call.reject("refused: ${e.message}")
            return
        }
        unavailableReason()?.let {
            call.reject("wakatime-cli not available: $it")
            return
        }
        val apiKey = WakaConfig.readKey(configFile)
        if (apiKey == null) {
            call.reject("no API key set")
            return
        }
        if (reason == "test") prepareTestEntity()
        executor.execute {
            val runner = CliRunner(binary, home, configFile, caFile, File(context.cacheDir, "wakatime-tmp"))
            val result = runner.run(args)
            val entry = log.append(reason, result, listOf(apiKey))
            call.resolve(JSObject.fromJSONObject(entry))
        }
    }

    @PluginMethod
    fun getLog(call: PluginCall) {
        val limit = call.getInt("limit") ?: 200
        executor.execute {
            val arr = JSArray()
            for (e in log.read(limit.coerceIn(1, InvocationLog.MAX_ENTRIES))) arr.put(e)
            call.resolve(JSObject().put("entries", arr))
        }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ini = WakaConfig.readIni(File(home, ".wakatime/wakatime-internal.cfg"))
        val ret = JSObject()
        ini["internal.heartbeats_last_sent_at"]?.let { ret.put("lastSentAt", it) }
        ini["internal.backoff_at"]?.takeIf { it.isNotBlank() }?.let { ret.put("backoffAt", it) }
        ini["internal.backoff_retries"]?.toIntOrNull()?.let { ret.put("backoffRetries", it) }
        call.resolve(ret)
    }

    private fun prepareTestEntity() {
        testEntity.parentFile?.mkdirs()
        if (!testEntity.isFile) {
            testEntity.writeText("This file exists so \"Test tracking\" can send one heartbeat through wakatime-cli.\n")
        }
    }

    private fun abiFromLibDir(path: String): String? = when (File(path).name) {
        "arm64" -> "arm64-v8a"
        "arm" -> "armeabi-v7a"
        "x86_64" -> "x86_64"
        "x86" -> "x86"
        else -> null
    }
}
