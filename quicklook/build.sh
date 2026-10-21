#!/usr/bin/env bash
# Builds the Quick Look extension (space-bar preview of .md files) and embeds it
# into an md-light.app:   quicklook/build.sh path/to/md-light.app
# Needs macOS with the Xcode command line tools (swiftc, codesign).
set -euo pipefail

APP="${1:?usage: quicklook/build.sh path/to/md-light.app}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
APPEX="$APP/Contents/PlugIns/MDLightQuickLook.appex"
VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
ARCH="$(uname -m)"

echo "▸ Quick Look: rendering script and styles"
(cd "$ROOT" && npx vite build --config quicklook/vite.config.ts --logLevel warn)
node "$HERE/build-assets.mjs" "$HERE/build/resources" >/dev/null

echo "▸ Quick Look: compiling extension ($ARCH)"
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"
xcrun swiftc -O -swift-version 5 -parse-as-library -application-extension \
  -module-name MDLightQuickLook \
  -target "$ARCH-apple-macos12.0" \
  -framework Quartz -framework JavaScriptCore -framework UniformTypeIdentifiers \
  -Xlinker -e -Xlinker _NSExtensionMain \
  "$HERE/PreviewProvider.swift" -o "$APPEX/Contents/MacOS/MDLightQuickLook"
sed "s/__VERSION__/$VERSION/g" "$HERE/Info.plist" > "$APPEX/Contents/Info.plist"
cp "$HERE/build/resources/render.js" "$HERE/build/resources/preview.css" "$APPEX/Contents/Resources/"

echo "▸ Quick Look: signing"
# Ad-hoc signatures are enough to run on this Mac. The extension is signed
# first (with its sandbox entitlements), then the app around it.
codesign --force --sign - --entitlements "$HERE/entitlements.plist" "$APPEX"
codesign --force --sign - "$APP"
echo "✓ Quick Look extension embedded in $APP"
