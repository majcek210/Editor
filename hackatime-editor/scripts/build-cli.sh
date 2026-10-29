#!/usr/bin/env bash
# Builds the official wakatime-cli from pinned source for Android and places
# it in the APK as a native library (jniLibs/<abi>/libwakatime.so).
# Also fetches a pinned Mozilla CA bundle into the app assets.
#
# Usage:
#   ANDROID_NDK_HOME=/path/to/ndk scripts/build-cli.sh      (preferred, cgo resolver)
#   ALLOW_NO_CGO=1 scripts/build-cli.sh                     (no NDK, pure Go resolver)
#
# See NOTES.md for why each choice was made.
set -euo pipefail

# ---- pins ------------------------------------------------------------------
WAKATIME_CLI_VERSION="v2.28.0"
WAKATIME_CLI_COMMIT="37ab01e6d80dbe9a05f0ee3cd90012e988090c7a"
WAKATIME_CLI_REPO="https://github.com/wakatime/wakatime-cli"
# Mozilla CA bundle, as packaged by certifi (pinned wheel + sha256 from PyPI).
CERTIFI_VERSION="2026.10.23"
CERTIFI_URL="https://files.pythonhosted.org/packages/32/d1/a3652fe2c19134d0d15922177821d863cbd7e842d53a21bbe7e8e3a1b5ac/certifi-2026.10.23-py3-none-any.whl"
CERTIFI_SHA256="e9b54de76e530bb6cf0ccd036787103acb58fd42ba930ea8bf948ddbaa2f61d1"
ANDROID_API="24"
# ---------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/cli"
SRC="$WORK/wakatime-cli"
JNI="$ROOT/android/app/src/main/jniLibs"
ASSETS="$ROOT/android/app/src/main/assets"
mkdir -p "$WORK" "$JNI" "$ASSETS"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required. $2" >&2; exit 1; }; }
need git "Install git."
need go "Install Go 1.21 or newer (the toolchain pinned in wakatime-cli's go.mod is fetched automatically via GOTOOLCHAIN=auto)."
need unzip "Install unzip."
need sha256sum "Install coreutils."
need curl "Install curl."

# ---- 1. source at the pinned commit ----------------------------------------
if [ ! -d "$SRC/.git" ]; then
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$WAKATIME_CLI_VERSION" "$WAKATIME_CLI_REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet --depth 1 origin "refs/tags/$WAKATIME_CLI_VERSION:refs/tags/$WAKATIME_CLI_VERSION" || true
git -C "$SRC" checkout --quiet --force "$WAKATIME_CLI_VERSION"
ACTUAL_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$WAKATIME_CLI_COMMIT" ]; then
  echo "error: tag $WAKATIME_CLI_VERSION resolves to $ACTUAL_COMMIT, expected $WAKATIME_CLI_COMMIT" >&2
  exit 1
fi
echo "wakatime-cli $WAKATIME_CLI_VERSION at $ACTUAL_COMMIT (verified)"

# ---- 2. verify module checksums against go.sum ------------------------------
export GOTOOLCHAIN=auto GOFLAGS=-mod=readonly
( cd "$SRC" && go mod download && go mod verify )

# ---- 3. build ----------------------------------------------------------------
COMMIT_DATE="$(git -C "$SRC" log -1 --format=%cd --date=format:'%Y-%m-%dT%H:%M:%S UTC')"
REPO_PATH="github.com/wakatime/wakatime-cli"
LDFLAGS="-s -w -buildid= -X '$REPO_PATH/pkg/version.BuildDate=$COMMIT_DATE' -X $REPO_PATH/pkg/version.Commit=${WAKATIME_CLI_COMMIT:0:7} -X $REPO_PATH/pkg/version.Version=$WAKATIME_CLI_VERSION -X $REPO_PATH/pkg/version.OS=android"

NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${ANDROID_NDK_LATEST_HOME:-}}}"
TOOLCHAIN=""
if [ -n "$NDK" ]; then
  TOOLCHAIN="$(echo "$NDK"/toolchains/llvm/prebuilt/*/bin)"
  [ -x "$TOOLCHAIN/aarch64-linux-android${ANDROID_API}-clang" ] || { echo "error: no NDK clang under $TOOLCHAIN" >&2; exit 1; }
elif [ "${ALLOW_NO_CGO:-0}" != "1" ]; then
  cat >&2 <<MSG
error: Android NDK not found.
The preferred build uses GOOS=android with cgo so DNS goes through Android's
resolver (bionic getaddrinfo). Install the NDK (r26 or newer, e.g.
'sdkmanager "ndk;27.2.12479018"') and set ANDROID_NDK_HOME, or re-run with
ALLOW_NO_CGO=1 to build a pure Go binary (the app then relays DNS through a
loopback CONNECT proxy; see NOTES.md).
MSG
  exit 1
fi

MANIFEST_ENTRIES=""
build_abi() { # abi goarch cc-prefix
  local abi="$1" goarch="$2" ccprefix="$3" cgo out
  out="$JNI/$abi/libwakatime.so"
  mkdir -p "$JNI/$abi"
  if [ -n "$TOOLCHAIN" ]; then
    cgo=1
    ( cd "$SRC" && CGO_ENABLED=1 GOOS=android GOARCH="$goarch" ${GOARM:+GOARM=$GOARM} \
        CC="$TOOLCHAIN/${ccprefix}${ANDROID_API}-clang" \
        go build -trimpath -buildvcs=false -ldflags "$LDFLAGS -X $REPO_PATH/pkg/version.Arch=$goarch" -o "$out" . )
  else
    cgo=0
    ( cd "$SRC" && CGO_ENABLED=0 GOOS=android GOARCH="$goarch" \
        go build -trimpath -buildvcs=false -ldflags "$LDFLAGS -X $REPO_PATH/pkg/version.Arch=$goarch" -o "$out" . )
  fi
  local sum; sum="$(sha256sum "$out" | cut -d' ' -f1)"
  echo "built $out (cgo=$cgo) sha256=$sum"
  MANIFEST_ENTRIES="$MANIFEST_ENTRIES${MANIFEST_ENTRIES:+,}
    \"$abi\": {\"goos\": \"android\", \"goarch\": \"$goarch\", \"cgo\": $cgo, \"sha256\": \"$sum\"}"
}

build_abi arm64-v8a arm64 aarch64-linux-android
if [ -n "$TOOLCHAIN" ]; then
  GOARM=7 build_abi armeabi-v7a arm armv7a-linux-androideabi
  # x86_64 is for emulators and Chromebooks (and the CI emulator test).
  build_abi x86_64 amd64 x86_64-linux-android
else
  # Go's android/arm port requires cgo, so armeabi-v7a is skipped without the NDK.
  rm -rf "$JNI/armeabi-v7a" "$JNI/x86_64"
  echo "skipping armeabi-v7a and x86_64 (need the NDK)"
fi

cat > "$ASSETS/wakatime-cli-build.json" <<JSON
{
  "version": "$WAKATIME_CLI_VERSION",
  "commit": "$WAKATIME_CLI_COMMIT",
  "abis": {$MANIFEST_ENTRIES
  }
}
JSON

# ---- 4. CA bundle -------------------------------------------------------------
WHL="$WORK/certifi-$CERTIFI_VERSION.whl"
[ -f "$WHL" ] || curl -sSfL -o "$WHL" "$CERTIFI_URL"
echo "$CERTIFI_SHA256  $WHL" | sha256sum -c -
unzip -p "$WHL" certifi/cacert.pem > "$ASSETS/cacert.pem"
echo "CA bundle: $(grep -c 'BEGIN CERTIFICATE' "$ASSETS/cacert.pem") certificates (certifi $CERTIFI_VERSION)"
echo "done"
