#!/usr/bin/env bash
# Pre-release dependency audit: fails the build on any high/critical
# vulnerability in npm dependencies (devDependencies only — see
# package.json, this project has zero runtime dependencies by design).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm audit --audit-level=high
