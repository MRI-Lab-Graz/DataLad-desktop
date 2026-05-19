# DataLad Adapter Interface (MVP)

This document defines the stable boundary between UI/shell code and DataLad integration logic.

## Version

- Interface version: `0.2.0`
- Source of truth: `src/datalad/schema.js`

## Goals

- Keep one command boundary for all DataLad operations.
- Ensure requests/results are validated before they reach UI code.
- Keep command vocabulary limited to curated MVP actions.

## Command names

- `cloneInstall`
- `get`
- `save`
- `update`
- `push`

No additional command names are allowed for MVP.

## Request schemas

### cloneInstall

- Required: `source`, `targetPath`
- Optional: none

### get

- Required: `projectPath`
- Optional: `paths` (array)

### save

- Required: `projectPath`, `message`
- Optional: `paths` (array)

### update

- Required: `projectPath`
- Optional: none

### push

- Required: `projectPath`
- Optional: none

## Result schema

All command calls return:

- `ok` (boolean)
- `commandName`
- `command`
- `args`
- `exitCode`
- `stdout`
- `stderr`
- `failed`
- `userError` (present when `ok` is false)

The runner result shape is validated before returning to callers.

## Project classification contract

`detectProject(projectPath)` returns one of:

- `git`
- `dataset`
- `superdataset`

Detection strategy order:

1. Confirm Git worktree.
2. Probe DataLad dataset state using `datalad status`.
3. If probe is inconclusive, fall back to `.datalad/config` metadata.
4. Probe subdatasets using `datalad subdatasets`.
5. If subdataset probe is inconclusive, fall back to `.gitmodules` metadata.

## Onboarding diagnostics contract

`checkEnvironment()` includes a UI-ready `report` with:

- `severity`
- `headline`
- `summary`
- `checks[]` including status/version/details per tool
- `recoverySteps[]` with actionable setup steps

This output is intended for onboarding screens and inline setup-recovery UX.