# Hackatime Editor

A code editor for Android with a VS Code-like interface. It records coding
time to [Hackatime](https://hackatime.hackclub.com) (Hack Club's
WakaTime-compatible tracker) using the official, bundled
[wakatime-cli](https://github.com/wakatime/wakatime-cli), and nothing else.

- Vite + TypeScript + CodeMirror 6, wrapped with Capacitor 8 for Android.
- A small Kotlin Capacitor plugin runs the bundled CLI.
- Capacitor Filesystem for files, Capacitor Preferences for settings.

Not affiliated with Hack Club or WakaTime.

## Install the APK

Download `hackatime-editor-debug-apk` from the latest successful run of the
**hackatime-editor** workflow (repository Actions tab), unzip it and open
`hackatime-editor-0.1.0-debug.apk` on your phone. Allow "install unknown apps"
for your browser or file manager when Android asks. It is a debug build signed
with the CI's debug key.

## Get your API key

1. Sign in at https://hackatime.hackclub.com.
2. Open https://hackatime.hackclub.com/my/wakatime_setup (it redirects to
   `/setup`). Your API key is the UUID in the shown config
   (`api_key = xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx`).
3. In the app: Settings (gear), paste the key, tap **Save key**. The app then
   runs **Test tracking**, which sends one heartbeat through the CLI and shows
   the result. Tracking turns on only if that run exits 0.

## Verify time on the dashboard

1. Open a project folder in the app, open a file and type for a minute, then save.
2. Open the Tracking Log (activity bar or command palette). Each run shows the
   arguments, exit code, stdout and stderr. Exit 0 means the CLI accepted the
   heartbeat (sent, or held in its offline queue for up to 30 s).
3. On https://hackatime.hackclub.com the time shows up under the project name
   and the editor `hackatime-editor`. The "Test tracking" heartbeat is recorded
   under the project `hackatime-editor-test`.

## How tracking works

This section is the full description of what the app sends and when. The code
is small enough to check against it: `src/core/tracker/` (TypeScript) and
`android/app/src/main/java/io/github/majcek210/hackatimeeditor/wakacli/` (Kotlin).

**Only wakatime-cli talks to Hackatime.**
- The app contains no HTTP client for Hackatime, no fallback sender and no
  heartbeat queue of its own. The web layer's Content Security Policy is
  `connect-src 'self'`, so the WebView cannot make network requests to other
  hosts at all.
- The Kotlin plugin (`WakaCliPlugin.kt`) starts the bundled binary
  `libwakatime.so` (wakatime-cli v2.28.0, built from the pinned commit by
  `scripts/build-cli.sh`) and returns its exit code, stdout and stderr.
- If the binary is missing or not executable, there is no API key, the
  "Test tracking" run has not passed, or any run fails, tracking is off and
  the status bar says `Hackatime: tracking off (<reason>)`. A failure is never
  retried by the app. To turn tracking on again, run Test tracking in Settings.

**When a heartbeat is sent.** Only on real user activity:
- opening a file the user tapped (explorer, quick open, search result),
- typing or other edits made by the user (CodeMirror user events),
- saving (with `--write`).

Rules, enforced in `src/core/tracker/throttle.ts` and covered by
`tests/throttle.test.ts` and `tests/tracker.test.ts`:
- At most one heartbeat per 30 seconds per file for opens and edits.
- Every save sends one heartbeat with `--write`.
- Nothing while the app is in the background (Capacitor pause/resume and
  `visibilitychange`; the Kotlin plugin also refuses while paused).
- Nothing when there has been no touch, key or text input for 2 minutes.
- No timers, no periodic or background pings. Restoring tabs at startup does
  not send anything.
- At most one CLI process at a time; an edit heartbeat that arrives while one
  is running is dropped, not queued.

**The CLI's own behaviour is used as is.** Rate limiting
(`heartbeat_rate_limit_seconds = 30`, global across files), the offline queue
(`~/.wakatime/offline_heartbeats.bdb` under the app's files dir) and backoff
after failures are all wakatime-cli features. The app adds no queue or retry.

**What the CLI is given.**
- Arguments (built in `src/core/tracker/cliArgs.ts`):
  `--entity <absolute path> --entity-type file --plugin hackatime-editor/<version> --category coding [--write] [--project <folder>] [--language <name>] [--lineno N] [--cursorpos N] [--lines-in-file N] --sync-ai-disabled`.
- The Kotlin plugin checks these against an allow-list (`ArgPolicy.kt`) and
  rejects anything else, including `--key`, `--api-url`, `--proxy`,
  `--no-ssl-verify` and a `--plugin` value other than
  `hackatime-editor/<installed version>`. It then adds
  `--config <files>/wakatime/hackatime-editor.cfg --log-to-stdout`.
- The config file holds `api_url = https://hackatime.hackclub.com/api/hackatime/v1`,
  `api_key`, `heartbeat_rate_limit_seconds = 30` and `timeout = 8`. It is in
  the app's private storage. The key is never passed on the command line.
- Environment: only `HOME` (app files dir), `SSL_CERT_FILE` (bundled Mozilla
  CA bundle), `TMPDIR` and `PATH`.
- The process runs on a background thread with a 10 second timeout; it never
  blocks the UI.

**Honest identification.** The User-Agent sent by the CLI ends with
`hackatime-editor/<version>`; the app does not claim to be another editor.

**Tracking Log.** Every CLI run is appended by the Kotlin plugin to
`files/wakatime/invocations.jsonl`: timestamp, reason (open, edit, save,
test), the full argument list with the API key redacted, exit code, stdout,
stderr and duration. The API key (and its base64 form) is removed before the
entry is written. The app can only read this log; there is no function to edit
or clear it. The newest 1000 entries are kept.

**Exit codes** (from wakatime-cli `pkg/exitcode`): 0 success, 102 API or
network error (heartbeat kept in the CLI's offline queue), 104 invalid API
key, 112 CLI backing off after an earlier failure.

Research behind each of these choices, with file and line references, is in
[NOTES.md](NOTES.md).

## Features

- Activity bar (Explorer, Search, Tracking Log, Settings), collapsible
  sidebar, tabs with unsaved dot and close button, status bar with
  Hackatime status, Ln/Col, indentation, encoding and language.
- Sidebar is a slide-over drawer at phone width and persistent on tablets
  and in landscape.
- Command palette (title bar button or Ctrl+Shift+P): Open File, Save,
  Save All, Close Tab, Go to Line, Change Language Mode, Toggle Sidebar,
  Open Settings, Show Tracking Log, and more.
- Quick open with fuzzy file name matching (Ctrl+P), project-wide search
  with case, whole word and regex toggles (Ctrl+Shift+F).
- Find and replace in the file with regex and case toggles (Ctrl+F).
- CodeMirror 6 editor with Dark+ colors, bracket pair colorization, indent
  guides, soft wrap, multiple cursors (Ctrl+D, Alt+drag), line numbers,
  undo/redo, auto-indent, bracket matching and syntax highlighting for
  JavaScript, TypeScript, JSX/TSX, Python, Lua, HTML, CSS, JSON, Markdown,
  C, C++, Rust, Go, Java and Kotlin.
- Keyboard toolbar above the on-screen keyboard: Tab, brackets, quotes,
  arrows, Undo, Redo, Save.
- Project folders in app storage (`Android/data/<app>/files/projects`) or in
  `Documents/projects`; file tree with create, rename and delete; unsaved
  changes prompts. The open folder and tabs are remembered.
- A small internal plugin interface (`src/core/plugins.ts`, example in
  `src/plugins/wordCount.ts`). No VS Code extension support, debugger or
  terminal. The tracker is a core module, not a plugin.

## Build it yourself

Requirements: Node 22, JDK 21, Go 1.21+ (the CLI's pinned toolchain, Go
1.27.3, is downloaded automatically), Android SDK with platform 36, and the
Android NDK (r26 or newer).

```sh
cd hackatime-editor
npm ci
npm test                     # Vitest
ANDROID_NDK_HOME=/path/to/ndk scripts/build-cli.sh
npm run build
npx cap sync android
cd android && ./gradlew testDebugUnitTest assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

`scripts/build-cli.sh`:
- clones wakatime-cli at tag `v2.28.0` and checks it resolves to commit
  `37ab01e6d80dbe9a05f0ee3cd90012e988090c7a`,
- runs `go mod verify` against `go.sum`,
- builds `GOOS=android` with cgo and the NDK clang (API 24) for arm64-v8a,
  armeabi-v7a and x86_64, with `-trimpath` and a fixed build date,
- writes `jniLibs/<abi>/libwakatime.so` and `assets/wakatime-cli-build.json`
  (with SHA-256 of each binary),
- downloads certifi 2026.10.23, checks its SHA-256 and extracts the Mozilla
  CA bundle to `assets/cacert.pem`.

Without the NDK it stops and says what to install. `ALLOW_NO_CGO=1` builds a
pure Go arm64 binary instead, but that binary cannot resolve DNS on Android
(see NOTES.md, section 6), so tracking would fail with a visible error.

`scripts/substitute-sdk.sh` exists only for machines that cannot reach
`dl.google.com`; it is not used by CI and does not help with Google's Maven
repository, which the Android build also needs.

### CI

`.github/workflows/hackatime-editor.yml` (repository root):
1. **build**: Vitest, web build, CLI build with the runner's NDK, Kotlin unit
   tests, debug APK, uploaded as the `hackatime-editor-debug-apk` artifact.
2. **emulator-test**: installs the APK on an API 34 x86_64 emulator and runs
   the bundled CLI from the app's uid and nativeLibraryDir against the real
   Hackatime API with an unknown key (`scripts/emulator-test.sh`). Exit 104
   ("invalid api key") proves that exec, DNS and TLS work. It also runs a
   pure Go build for comparison. The report is in the job summary.

## Tests

- `npm test`: throttling (one heartbeat per 30 s per file, write on save,
  nothing while idle or backgrounded, no timers), CLI argument construction,
  API key redaction, tracker on/off rules, fuzzy matching.
- `./gradlew testDebugUnitTest`: Kotlin allow-list, redaction, config file,
  process runner (environment, timeout kill) and the invocation log.

## License

MIT for this project. wakatime-cli is BSD 3-Clause, Codicons are CC BY 4.0,
CodeMirror is MIT, the CA bundle is MPL 2.0.
