#!/usr/bin/env bash
# Pre-release dependency audit: fails the build on any high/critical
# vulnerability in npm dependencies (devDependencies only — see
# package.json, this project has zero runtime dependencies by design).
#
# GHSA-mh99-v99m-4gvg (brace-expansion DoS) is allowlisted below: it's only
# reachable through electron-builder's transitive tree via glob@7/rimraf@2,
# both abandoned majors that will never adopt the patched brace-expansion@5
# (a breaking rewrite — confirmed locally that forcing it via `overrides`
# makes minimatch/glob throw, since 5.x drops the old callable-function
# export). electron-builder is dev-only tooling that never runs against
# untrusted input, so the DoS has no real trigger path here. Remove this
# allowlist entry once electron-builder ships a dependency tree without it.
#
# GHSA-ch52-4w7c-c8xp (http-cache-semantics max-stale leaks entries of a
# *shared* cache) has no patched release (<= 4.2.0 is the latest). It sits
# under got -> @electron/get, the build-time downloader of the Electron binary:
# a single-user, short-lived process with no shared cache and no runtime
# exposure (the shipped app has no npm dependencies). Remove this entry once a
# fixed http-cache-semantics is published.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ALLOWLISTED_ADVISORIES="GHSA-mh99-v99m-4gvg GHSA-ch52-4w7c-c8xp"

report="$(npm audit --audit-level=high --json || true)"

other_high_count=$(node -e "
  const report = JSON.parse(process.argv[1])
  const allowlisted = process.argv[2].split(' ')
  let count = 0
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    if (vuln.severity !== 'high' && vuln.severity !== 'critical') continue
    const advisoryIds = (vuln.via ?? [])
      .filter((entry) => typeof entry === 'object')
      .map((entry) => entry.url?.split('/').pop())
    if (advisoryIds.every((id) => allowlisted.includes(id))) continue
    count += 1
  }
  console.log(count)
" "$report" "$ALLOWLISTED_ADVISORIES")

if [ "$other_high_count" -gt 0 ]; then
  echo "$report" | node -e "
    let input = ''
    process.stdin.on('data', (chunk) => { input += chunk })
    process.stdin.on('end', () => {
      const report = JSON.parse(input)
      console.log(report.metadata?.vulnerabilities ?? report)
    })
  "
  echo "npm audit found high/critical vulnerabilities beyond the allowlisted: $ALLOWLISTED_ADVISORIES" >&2
  exit 1
fi

echo "npm audit: only allowlisted advisories ($ALLOWLISTED_ADVISORIES) present, no other high/critical vulnerabilities."
