package io.github.majcek210.hackatimeeditor.wakacli

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class WakaCliTest {
    private val key = "12345678-1234-4123-8123-123456789abc"
    private val plugin = "hackatime-editor/0.1.0"
    private val good = listOf(
        "--entity", "/data/p/a.kt", "--entity-type", "file", "--plugin", plugin,
        "--category", "coding", "--write", "--project", "p", "--language", "Kotlin",
        "--lineno", "3", "--cursorpos", "1", "--lines-in-file", "9", "--sync-ai-disabled",
    )

    @Test fun acceptsHeartbeatArgs() {
        ArgPolicy.validate(good, plugin)
    }

    @Test fun rejectsDangerousFlags() {
        for (bad in listOf("--key", "--api-url", "--config", "--proxy", "--no-ssl-verify", "--config-write", "--extra-heartbeats", "--hostname")) {
            assertThrows(ArgPolicy.Rejected::class.java) { ArgPolicy.validate(good + listOf(bad, "x"), plugin) }
        }
        assertThrows(ArgPolicy.Rejected::class.java) { ArgPolicy.validate(good + "--key=$key", plugin) }
    }

    @Test fun rejectsOtherPluginNames() {
        val args = good.toMutableList().also { it[it.indexOf(plugin)] = "vscode/1.90.0" }
        assertThrows(ArgPolicy.Rejected::class.java) { ArgPolicy.validate(args, plugin) }
    }

    @Test fun rejectsRelativeEntityAndMissingEntity() {
        assertThrows(ArgPolicy.Rejected::class.java) { ArgPolicy.validate(listOf("--entity", "a.kt", "--plugin", plugin), plugin) }
        assertThrows(ArgPolicy.Rejected::class.java) { ArgPolicy.validate(listOf("--plugin", plugin), plugin) }
    }

    @Test fun redactsKeyEverywhere() {
        val args = Redactor.args(listOf("cli", "--key", key, "--x=$key", "--key=$key"), listOf(key))
        assertEquals(listOf("cli", "--key", Redactor.REDACTED, "--x=${Redactor.REDACTED}", "--key=${Redactor.REDACTED}"), args)
        val b64 = java.util.Base64.getEncoder().encodeToString(key.toByteArray())
        val text = Redactor.text("api_key = $key Authorization: Basic $b64 WAKA_$key", listOf(key))
        assertFalse(text.contains(key))
        assertFalse(text.contains(b64))
    }

    @Test fun writesConfigWithRequiredSettings() {
        val dir = Files.createTempDirectory("cfg").toFile()
        val f = File(dir, "c.cfg")
        WakaConfig.write(f, key)
        val ini = WakaConfig.readIni(f)
        assertEquals("https://hackatime.hackclub.com/api/hackatime/v1", ini["settings.api_url"])
        assertEquals(key, ini["settings.api_key"])
        assertEquals("30", ini["settings.heartbeat_rate_limit_seconds"])
        assertThrows(IllegalArgumentException::class.java) { WakaConfig.write(f, "not-a-key") }
    }

    @Test fun runnerUsesConfigFlagAndMinimalEnv() {
        val dir = Files.createTempDirectory("run").toFile()
        val script = File(dir, "fake-cli.sh")
        script.writeText("#!/bin/sh\necho \"args=\$*\"\necho \"home=\$HOME ca=\$SSL_CERT_FILE user=\$USER\" >&2\nexit 102\n")
        script.setExecutable(true)
        val r = CliRunner(script, dir, File(dir, "c.cfg"), File(dir, "ca.pem"), File(dir, "tmp")).run(listOf("--entity", "/x"))
        assertEquals(102, r.exitCode)
        assertTrue(r.stdout.contains("--config ${File(dir, "c.cfg").absolutePath} --log-to-stdout --entity /x"))
        assertTrue(r.stderr.contains("home=${dir.absolutePath} ca=${File(dir, "ca.pem").absolutePath} user=\n"))
        assertTrue(File(dir, ".wakatime").isDirectory)
    }

    @Test fun runnerKillsOnTimeout() {
        val dir = Files.createTempDirectory("slow").toFile()
        val script = File(dir, "slow.sh")
        script.writeText("#!/bin/sh\nsleep 30\n")
        script.setExecutable(true)
        val r = CliRunner(script, dir, File(dir, "c"), File(dir, "ca"), File(dir, "t"), timeoutMs = 500).run(emptyList())
        assertNull(r.exitCode)
        assertTrue(r.error!!.contains("timed out"))
        assertTrue(r.durationMs < 5000)
    }

    @Test fun logIsRedactedAndNewestFirst() {
        val dir = Files.createTempDirectory("log").toFile()
        val log = InvocationLog(File(dir, "l.jsonl"))
        log.append("edit", RunResult(listOf("cli", "--entity", "/a"), 0, "ok $key", "", 5), listOf(key))
        log.append("save", RunResult(listOf("cli", "--key", key), 102, "", "err", 7), listOf(key))
        val entries = log.read(10)
        assertEquals("save", entries[0].getString("reason"))
        assertEquals(2L, entries[0].getLong("id"))
        assertFalse(File(dir, "l.jsonl").readText().contains(key))
    }
}
