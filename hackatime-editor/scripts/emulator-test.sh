#!/usr/bin/env bash
# Runs on an Android emulator in CI. Installs the APK, then runs the bundled
# wakatime-cli from the app's own uid and nativeLibraryDir (the same way the
# app does) against the real Hackatime API with a syntactically valid but
# unknown API key. Reaching the server and getting "invalid api key" (exit
# 104) proves that exec, DNS and TLS all work on Android. A DNS failure shows
# up as exit 102 with "lookup ... on [::1]:53".
#
# Usage: emulator-test.sh <apk> [<pure-go x86_64 binary for comparison>]
set -uo pipefail
APK="$1"
NOCGO="${2:-}"
PKG=io.github.majcek210.hackatimeeditor
FAKE_KEY=00000000-0000-4000-8000-000000000000
REPORT="${REPORT:-emulator-report.md}"
: > "$REPORT"
say() { echo "$*" | tee -a "$REPORT"; }

adb wait-for-device
adb shell getprop ro.build.version.release | xargs -I{} echo "Android {}" | tee -a "$REPORT"
adb shell getprop ro.product.cpu.abi | xargs -I{} echo "ABI {}" | tee -a "$REPORT"
adb install -r -g "$APK" || exit 1
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 10   # plugin load() copies the CA bundle into the files dir

APKDIR=$(adb shell pm path "$PKG" | head -1 | sed 's/^package://; s#/base.apk##' | tr -d '\r')
ABI=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')
case "$ABI" in arm64-v8a) LIBARCH=arm64 ;; armeabi-v7a) LIBARCH=arm ;; *) LIBARCH="$ABI" ;; esac
CLI="$APKDIR/lib/$LIBARCH/libwakatime.so"
FILES=/data/user/0/$PKG/files
say "nativeLibraryDir binary: $CLI"
adb shell ls -l "$CLI" | tee -a "$REPORT"

runas() { adb shell "run-as $PKG sh -c '$1'"; }
# Config with a valid-looking but unknown key, written through stdin.
runas "mkdir -p $FILES/.wakatime $FILES/emu && echo hello > $FILES/emu/test.txt"
printf '[settings]\napi_url = https://hackatime.hackclub.com/api/hackatime/v1\napi_key = %s\nheartbeat_rate_limit_seconds = 0\ntimeout = 8\n' "$FAKE_KEY" \
  | adb shell "run-as $PKG sh -c 'cat > $FILES/emu/test.cfg'"

say ""
say "## --version"
say '```'
runas "$CLI --version" 2>&1 | tee -a "$REPORT"
say '```'

heartbeat() { # label env-prefix
  say ""
  say "## $1"
  say '```'
  # The install path contains "==", which env would read as a variable, so run it as ./libwakatime.so.
  OUT=$(runas "rm -f $FILES/.wakatime/wakatime-internal.cfg; cd $(dirname "$CLI") && env -i HOME=$FILES $2 ./libwakatime.so --config $FILES/emu/test.cfg --entity $FILES/emu/test.txt --plugin hackatime-editor/0.1.0 --write --sync-ai-disabled --log-to-stdout; echo EXIT=\$?" 2>&1)
  echo "$OUT" | sed "s/$FAKE_KEY/<redacted>/g" | tee -a "$REPORT"
  say '```'
}
heartbeat "cgo build, SSL_CERT_FILE = bundled Mozilla CA" "SSL_CERT_FILE=$FILES/wakatime/cacert.pem"
CGO_RESULT="$OUT"
heartbeat "cgo build, system CA store only" ""

STATUS=0
if echo "$CGO_RESULT" | grep -q 'EXIT=104'; then
  say ""; say "RESULT: reached Hackatime and got 'invalid api key' (exit 104). exec, DNS and TLS work."
elif echo "$CGO_RESULT" | grep -q 'EXIT=0'; then
  say ""; say "RESULT: exit 0 (heartbeat accepted or queued)."
else
  say ""; say "RESULT: unexpected result for the bundled CLI."; STATUS=1
fi

if [ -n "$NOCGO" ] && [ -f "$NOCGO" ]; then
  adb push "$NOCGO" /data/local/tmp/wakatime-nocgo >/dev/null
  adb shell chmod 755 /data/local/tmp/wakatime-nocgo
  adb shell "mkdir -p /data/local/tmp/h/.wakatime && printf '[settings]\napi_url = https://hackatime.hackclub.com/api/hackatime/v1\napi_key = $FAKE_KEY\ntimeout = 8\n' > /data/local/tmp/h/t.cfg && echo hi > /data/local/tmp/h/t.txt"
  say ""
  say "## comparison: pure Go build (CGO_ENABLED=0), run from /data/local/tmp as shell user"
  say '```'
  adb shell "cd /data/local/tmp/h && env -i HOME=/data/local/tmp/h /data/local/tmp/wakatime-nocgo --config t.cfg --entity /data/local/tmp/h/t.txt --plugin hackatime-editor/0.1.0 --sync-ai-disabled --log-to-stdout; echo EXIT=\$?" 2>&1 | sed "s/$FAKE_KEY/<redacted>/g" | tee -a "$REPORT"
  say '```'
fi
if [ -n "${TEST_APK:-}" ] && [ -f "$TEST_APK" ]; then
  say ""
  say "## JGit on device (clone https://github.com/octocat/Hello-World.git, stage, commit)"
  say '```'
  adb install -r "$TEST_APK" >/dev/null
  INST=$(adb shell am instrument -w "$PKG.test/androidx.test.runner.AndroidJUnitRunner" 2>&1)
  echo "$INST" | tail -15 | tee -a "$REPORT"
  say '```'
  echo "$INST" | grep -q "^OK (" || STATUS=1
fi
exit $STATUS
