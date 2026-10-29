# Research notes

Everything below was read from source, not guessed. Sources:

- wakatime-cli, tag `v2.28.0`, commit `37ab01e6d80dbe9a05f0ee3cd90012e988090c7a`
  (github.com/wakatime/wakatime-cli). Paths below are relative to that tree.
- Hackatime, commit `2e0ccdd9117b337e6618db365b191543dd9fe5e0` (2026-10-28)
  (github.com/hackclub/hackatime).
- Go standard library, `go1.24.7` source in `/usr/local/go/src` (the same code
  is in go1.27.3, which wakatime-cli's `go.mod` requires).

## 1. CLI flags used for a single heartbeat

All defined in `cmd/root.go` (`setFlags`):

| Flag | Line | How this app uses it |
|---|---|---|
| `--entity` | 103 | Absolute path of the file. Always set. |
| `--entity-type` | 108 | Always `file` (the default, set explicitly). |
| `--plugin` | 223 | `hackatime-editor/<versionName>`. Enforced again in Kotlin. |
| `--write` | 309 | Only on save. |
| `--project` | 225 | Name of the open project folder. |
| `--language` | 180 | Language mode of the tab (overrides detection). |
| `--category` | 72 | Always `coding` (the CLI default). |
| `--lineno`, `--cursorpos`, `--lines-in-file` | 181, 99, 184 | Cursor line, column and line count. |
| `--sync-ai-disabled` | 265 | Set. By default the CLI parses AI tool transcripts on every heartbeat (help text at 260-265); this editor has nothing to report there. |
| `--config` | 82 | Set by the Kotlin plugin to the app's own config file. |
| `--log-to-stdout` | 196 | Set by the Kotlin plugin so errors show up in the Tracking Log. |
| `--key` | 179 | Not used. The key is in the config file instead, so it never appears in the process list or in argv. |
| `--api-url` | 61 | Not used as a flag. `api_url` is in the config file (`pkg/params/params.go:465` reads `api-url`, `apiurl`, `api_url`, `settings.api_url` in that order). |
| `--disable-offline` | 100 | Not used. Offline queue stays on (CLI default). |
| `--sync-offline-activity` | 276 | Not used. Default syncs queued heartbeats after a successful send. |
| `--offline-count` | 286 | Not used by the app. Useful for debugging. |
| `--heartbeat-rate-limit-seconds` | 135 | Not used as a flag; set in the config file. |
| `--timeout` | 288 | Not used as a flag; `timeout = 8` in the config file. Default is 120 s (`pkg/api/api.go:22`). |
| `--ssl-certs-file` | 245 | Not used. See section 5. |
| `--proxy` | 233 | Not used, and rejected by the Kotlin allow-list. |

The Kotlin plugin only accepts the flags in the first block of this table
(`ArgPolicy.kt`).

## 2. Config file format

INI, read through viper (`pkg/ini/ini.go`). Keys live in `[settings]`:

```ini
[settings]
api_url = https://hackatime.hackclub.com/api/hackatime/v1
api_key = <uuid>
heartbeat_rate_limit_seconds = 30
timeout = 8
```

- `api_key` must match `^(waka_)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`
  (`pkg/params/params.go:47`, checked at 564-571). The app validates the same
  pattern before writing the file.
- `heartbeat_rate_limit_seconds`: `pkg/params/params.go:157-160` (flag first,
  then config), applied in `LoadOfflineParams` at 932-990.
- `timeout`: `pkg/params/params.go:337-341`.
- The CLI keeps its own state in a second file, `~/.wakatime/wakatime-internal.cfg`
  (`pkg/ini/ini.go:33`, `InternalFilePath` at 281): `heartbeats_last_sent_at`,
  `backoff_at`, `backoff_retries`. The app reads it (never writes it) to show
  when the CLI last synced.
- Home is `WAKATIME_HOME` or the user's home dir (`pkg/ini/ini.go:300-315`);
  the folder is `.wakatime` (line 29). The app sets `HOME` to its files dir.

## 3. Authentication against Hackatime

- The CLI sends `Authorization: Basic base64(api_key)` with no user part:
  `pkg/api/heartbeat.go:280` builds `BasicAuth{Secret: apiKey}`, and
  `pkg/api/auth.go:27-30` encodes just the secret.
- Heartbeats go to `<api_url>/users/current/heartbeats.bulk`
  (`pkg/api/heartbeat.go:44`), as a JSON array.
- Hackatime routes: `config/routes.rb:347-356`, namespace `api/hackatime/v1`:
  `post "/users/:id/heartbeats"` (line 353). The `.bulk` suffix arrives as
  `params["format"] == "bulk"` (`app/controllers/api/hackatime/v1/hackatime_controller.rb:59-67`).
- Hackatime accepts bearer, basic and `?api_key=` (`hackatime_controller.rb:244-250`).
  For basic it does `Base64.strict_decode64(token)` and looks the whole result
  up as the key (`app/controllers/concerns/user_api_authentication.rb:31-33`),
  which matches what the CLI sends.
- A 401 makes the CLI exit with 104 (`pkg/api/heartbeat.go:104`,
  `pkg/exitcode/exitcode.go:13`).

Verified locally: a linux/amd64 build of the same commit, pointed at a local
TLS server, sent `POST /api/hackatime/v1/users/current/heartbeats.bulk` with
`Authorization: Basic MTIz...` (base64 of the key) and
`User-Agent: wakatime/<ver> (<os>) go1.27.3 hackatime-editor/0.1.0`.

## 4. User-Agent and plugin string

`pkg/heartbeat/heartbeat.go:276-310`: `wakatime/%s (%s-%s-%s) %s %s`, the last
field being the `--plugin` value. Hackatime stores `request.user_agent` per
heartbeat (`app/services/heartbeat_ingest.rb:106`) and derives the editor from
the product chain after the platform
(`app/services/wakatime_user_agent_parser.rb:86-98`, `extract_editor` at 309).
Plugin is `hackatime-editor/<version>`, so the editor is reported as this app.
I traced the parser by reading it; I did not run it.

## 5. Rate limiting, offline queue, backoff

- Rate limit (`pkg/ratelimit/ratelimit.go:21-35`, used at
  `cmd/heartbeat/heartbeat.go:277-288`): if less than
  `heartbeat_rate_limit_seconds` passed since `heartbeats_last_sent_at`, the
  heartbeat goes to the offline queue and the CLI exits 0 without a request.
  This is global, not per file. Default is 120 s (`pkg/offline/offline.go:38`);
  we set 30.
- Offline queue: bolt DB `~/.wakatime/offline_heartbeats.bdb`
  (`pkg/offline/offline.go:28`). Failed sends are queued; the queue is synced
  after the next successful send (up to `sync-offline-activity`, default 1000).
- Backoff (`pkg/backoff/backoff.go`): after a failure the CLI waits
  `15 * 2^retries` seconds (max 3600) before trying the network again, queues
  heartbeats meanwhile and exits 112 (`pkg/exitcode/exitcode.go:21`).
- The app adds no queue or retry on top. One CLI run per heartbeat, and a
  failure turns tracking off.

Observed with the local test: first call exits 0 and sends; a second call 2 s
later exits 0 with no request (rate limited, queued). With DNS broken the CLI
exited 102 and wrote `backoff_retries = 1`.

## 6. Android: exec, DNS and certificates

### exec

Apps cannot exec files from their writable data dir on Android 10+ (W^X for
`untrusted_app`). The binary ships as `jniLibs/<abi>/libwakatime.so`, with
`android:extractNativeLibs="true"` and `packaging.jniLibs.useLegacyPackaging = true`,
and runs from `ApplicationInfo.nativeLibraryDir`.

### DNS

- Go's pure resolver reads `/etc/resolv.conf`; when it is missing it falls back
  to `127.0.0.1:53` and `[::1]:53` (`net/dnsconfig.go:27`). Android has no
  `/etc/resolv.conf`, so a `CGO_ENABLED=0` binary cannot resolve names.
- On `GOOS=android`, Go prefers the cgo resolver (`net/conf.go:183-186`,
  "DNS requests don't work on Android, so prefer the cgo resolver"), which
  calls bionic `getaddrinfo` and therefore Android's own DNS (netd, private
  DNS, VPNs). That only exists when cgo is enabled, which needs the NDK.
- Upstream's own `build-android-arm64` target uses `CGO_ENABLED=0`
  (`Makefile:6` and `48-49`); only android/arm forces cgo (42-46).
- wakatime-cli's DNS fallback to a hard-coded IP only applies to
  `api.wakatime.com` (`pkg/api/api.go:70-73`), not to a custom `api_url`.

Reproduced locally: the pure Go build with `/etc/resolv.conf` hidden failed
with `lookup hackatime.hackclub.com on [::1]:53: dial udp [::1]:53` and exit 102.

**Decision:** build with `GOOS=android CGO_ENABLED=1` and the NDK clang for API
24 (`scripts/build-cli.sh`). The CI emulator job (`scripts/emulator-test.sh`)
runs the bundled binary from the app uid against the real API with an unknown
key; success is exit 104 (server reached, key rejected). It also runs a pure Go
build for comparison.

### Certificates

- `crypto/x509` on `GOOS=android` adds `/system/etc/security/cacerts` and the
  user CA folder to its search dirs (`crypto/x509/root_linux.go:25-31`), and
  honours `SSL_CERT_FILE` (`crypto/x509/root_unix.go:19`).
- wakatime-cli builds its pool from the system pool plus bundled Let's Encrypt
  roots (`pkg/api/transport.go:125-142`). `--ssl-certs-file` would replace the
  pool entirely (`pkg/api/option.go:184-194`), so it is not used.
- The app ships the Mozilla bundle (certifi 2026.10.23, sha256 pinned), copies
  it to `files/wakatime/cacert.pem` and sets `SSL_CERT_FILE`. That works for
  both `GOOS=android` and `GOOS=linux` builds.

## 7. Differences from the task's assumptions

- `https://hackatime.hackclub.com/my/wakatime_setup` now redirects to `/setup`
  (`config/routes.rb:235`). Both work.
- The CLI's rate limit is global across files, not per file. The app throttles
  per file (30 s) and the CLI then rate-limits globally (30 s, queued offline,
  exit 0). A save heartbeat can therefore sit in the CLI's offline queue for up
  to 30 s before it is sent with the next heartbeat.
- The CLI default rate limit is 120 s, not 30; we set 30 in the config.
- The CLI does not create `~/.wakatime/` itself in every path (a first run
  without it logged `failed creating file ... wakatime-internal.cfg`); the
  plugin creates it.
- The CLI parses AI tool transcripts by default (`cmd/root.go:260-265`); we
  pass `--sync-ai-disabled`.
- wakatime-cli `v2.28.0` needs Go 1.27.3 (`go.mod`); `GOTOOLCHAIN=auto` fetches it.
- Upstream's android/arm64 release build is pure Go, so it hits the DNS
  problem on stock Android. We build our own with cgo.
- `java.time` and `java.util.Base64` need API 26, so `minSdk` is 26 (Capacitor
  8 default is 24).

## 8. What could not be verified here

The development sandbox could not reach `dl.google.com` (Android SDK, NDK and
Google's Maven repository) or `hackatime.hackclub.com`. So:

- The APK is built by GitHub Actions, not locally.
- Android behaviour of the CLI is checked by the CI emulator job (x86_64,
  API 34), not on a physical arm64 phone.
- No real heartbeat with a real key was sent from this environment.
