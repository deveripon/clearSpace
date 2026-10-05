#!/bin/bash
# Builds Clearspace and installs it into /Applications.
# Run once:  bash install.sh      (run again any time to update)
set -euo pipefail
cd "$(dirname "$0")"

step() { printf "\n\033[1;36m==>\033[0m %s\n" "$1"; }

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (or: brew install node), then run this again."
  exit 1
fi

ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"

step "Downloading build tools (one time, removed again at the end)"
npm install --no-audit --no-fund --loglevel=error

step "Building Clearspace.app for $ARCH"
npx electron-builder --mac --dir "--$ARCH" >/dev/null
APP="$(ls -d dist/mac*/Clearspace.app | head -1)"
[ -d "$APP" ] || { echo "Build failed: Clearspace.app not found in dist/"; exit 1; }

step "Signing it for this Mac"
codesign --force --deep --sign - "$APP"

step "Installing to /Applications"
osascript -e 'quit app "Clearspace"' >/dev/null 2>&1 || true
sleep 1
rm -rf "/Applications/Clearspace.app"
ditto "$APP" "/Applications/Clearspace.app"
xattr -cr "/Applications/Clearspace.app" 2>/dev/null || true

step "Removing build files"
rm -rf node_modules dist

step "Done. Opening Clearspace"
open "/Applications/Clearspace.app"
