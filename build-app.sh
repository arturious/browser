#!/bin/bash
# Builds dist/Browser-<version>-arm64.dmg (and dist/mac-arm64/Browser.app).
set -e
cd "$(dirname "$0")"
npm run dist
