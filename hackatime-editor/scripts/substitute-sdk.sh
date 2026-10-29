#!/usr/bin/env bash
# ONLY for build machines that cannot reach dl.google.com (where the official
# Android SDK is hosted). It assembles a minimal SDK directory from artifacts
# on Maven Central:
#   platforms/android-36/android.jar  <- org.robolectric:android-all (API 36,
#                                        full framework classes + resources.arsc)
#   build-tools/35.0.0                <- placeholder entries only; AGP 8.13
#                                        runs aapt2 from Google Maven and d8,
#                                        zipflinger and apksig in-process.
# Normal builds (and CI) should use the official SDK instead.
#
# Usage: scripts/substitute-sdk.sh <output-dir>
set -euo pipefail
OUT="${1:?usage: substitute-sdk.sh <output-dir>}"
API=36
ALL_VER="16-robolectric-13921718"
ALL_SHA256="8b74a0a137330658d2f33f0dc715d42734f74ba8b2d7014fc2e95aa40d3f682d"
BT=35.0.0
URL="https://repo1.maven.org/maven2/org/robolectric/android-all/$ALL_VER/android-all-$ALL_VER.jar"

mkdir -p "$OUT/platforms/android-$API" "$OUT/build-tools/$BT/lib" "$OUT/licenses" "$OUT/platform-tools"
P="$OUT/platforms/android-$API"
if [ ! -f "$P/android.jar" ]; then
  JAR="${ANDROID_ALL_JAR:-}"
  if [ -z "$JAR" ]; then JAR="$OUT/android-all.jar"; curl -sSfL -o "$JAR" "$URL"; fi
  echo "$ALL_SHA256  $JAR" | sha256sum -c -
  cp "$JAR" "$P/android.jar"
fi

# java.base classes for AGP's JDK image transform (Java 9+ source levels).
if [ ! -f "$P/core-for-system-modules.jar" ]; then
  T="$(mktemp -d)"
  ( cd "$T" && unzip -q "$P/android.jar" 'java/*' 'javax/*' 'sun/*' 'jdk/*' 'libcore/*' 'dalvik/*' 'org/apache/harmony/*' 2>/dev/null || true
    zip -q -r "$P/core-for-system-modules.jar" . )
  rm -rf "$T"
fi
: > "$P/framework.aidl"
cat > "$P/source.properties" <<PROP
Pkg.Desc=Android SDK Platform $API (substitute)
Pkg.Revision=1
AndroidVersion.ApiLevel=$API
Layoutlib.Api=15
Layoutlib.Revision=1
Platform.MinToolsRev=22
PROP
printf 'ro.build.version.sdk=%s\nro.build.version.release=16\nro.build.version.codename=REL\n' "$API" > "$P/build.prop"
cat > "$P/package.xml" <<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:ns5="http://schemas.android.com/repository/android/generic/02" xmlns:ns6="http://schemas.android.com/sdk/android/repo/repository2/03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<localPackage path="platforms;android-$API" obsolete="false">
<type-details xsi:type="ns6:platformDetailsType"><api-level>$API</api-level><codename></codename><base-extension>true</base-extension><layoutlib api="15"/></type-details>
<revision><major>1</major></revision><display-name>Android SDK Platform $API (substitute)</display-name>
</localPackage></ns2:repository>
XML

B="$OUT/build-tools/$BT"
for f in aapt aapt2 aidl dexdump split-select zipalign apksigner d8 lld llvm-rs-cc bcc_compat; do
  [ -e "$B/$f" ] || { printf '#!/bin/sh\necho "substitute build-tools: %s is not available" >&2\nexit 1\n' "$f" > "$B/$f"; chmod +x "$B/$f"; }
done
mkdir -p "$B/renderscript/include" "$B/renderscript/clang-include" "$B/renderscript/lib"
for j in d8.jar apksigner.jar core-lambda-stubs.jar; do [ -e "$B/lib/$j" ] || (cd "$B/lib" && echo x > x && zip -q "$j" x && rm x); done
cp -f "$B/lib/core-lambda-stubs.jar" "$B/core-lambda-stubs.jar"
cat > "$B/source.properties" <<PROP
Pkg.Desc=Android SDK Build-Tools $BT (substitute)
Pkg.Revision=$BT
PROP
cat > "$B/package.xml" <<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<localPackage path="build-tools;$BT" obsolete="false"><type-details xsi:type="ns2:genericDetailsType"/>
<revision><major>35</major><minor>0</minor><micro>0</micro></revision><display-name>Android SDK Build-Tools $BT (substitute)</display-name>
</localPackage></ns2:repository>
XML
echo "substitute SDK ready at $OUT"
