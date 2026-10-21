#!/usr/bin/env bash
# npm run app:install — builds md-light, adds the Quick Look preview, installs
# it to /Applications and registers it with macOS.
set -euo pipefail
cd "$(dirname "$0")/.."

npx tauri build --bundles app
APP="src-tauri/target/release/bundle/macos/md-light.app"

if ! bash quicklook/build.sh "$APP"; then
  echo "⚠ The Quick Look preview could not be built (are the Xcode command line tools installed? xcode-select --install)."
  echo "  md-light itself is installed anyway."
fi

echo "▸ Installing to /Applications"
pkill -x md-light 2>/dev/null || true
rm -rf /Applications/md-light.app
cp -R "$APP" /Applications/

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREGISTER" -f /Applications/md-light.app >/dev/null 2>&1 || true
if [ -d /Applications/md-light.app/Contents/PlugIns/MDLightQuickLook.appex ]; then
  pluginkit -a /Applications/md-light.app/Contents/PlugIns/MDLightQuickLook.appex 2>/dev/null || true
  pluginkit -e use -i dev.mdlight.app.quicklook 2>/dev/null || true
  qlmanage -r >/dev/null 2>&1 || true
  qlmanage -r cache >/dev/null 2>&1 || true
fi

open /Applications/md-light.app
echo "✓ md-light is installed. Press space on a .md file in Finder for the preview."
