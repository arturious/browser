#!/bin/bash
set -e
cd "$(dirname "$0")"

export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
swift build

APP_NAME="Browser.app"
BUILD_DIR=".build/arm64-apple-macosx/debug"
APP_DIR=".build/${APP_NAME}"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp "$BUILD_DIR/browser" "$APP_DIR/Contents/MacOS/browser"
cp "Sources/browser/Info.plist" "$APP_DIR/Contents/Info.plist"

echo "Built $APP_DIR"
