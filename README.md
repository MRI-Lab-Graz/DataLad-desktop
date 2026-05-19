# DataLad Desktop

DataLad Desktop is a researcher-first desktop app built from GitHub Desktop, adding a small set of DataLad-aware project actions while preserving the familiar project, commit, history, and branch workflow people already understand.

## Product scope (MVP)

The first version keeps the GitHub Desktop shell and exposes only five DataLad actions:

- Clone/Install
- Get
- Save
- Update
- Push

Git-only projects should continue to behave like normal GitHub Desktop projects.

## Platform target

DataLad Desktop must be cross-platform for MVP, with special focus on Windows because the main user base is expected to run on Windows systems.

Platform guidance:

- Windows is the primary day-to-day user platform and should be treated as first-class in UX and validation.
- macOS support remains required for cross-platform parity.
- Cross-platform behavior should stay consistent across project detection, diagnostics, and DataLad actions.

## Repository setup notes

This repository now includes an initial implementation scaffold for the MVP DataLad adapter boundary, strict command schemas, onboarding diagnostics formatting, and tests for classification edge cases.

- Roadmap: `docs/roadmap.md`
- Researcher workflow and UX rules: `docs/product/researcher-workflow.md`
- DataLad adapter contract: `docs/architecture/datalad-adapter.md`
- DataLad adapter interface schemas: `docs/architecture/datalad-adapter-interface.md`
- Adapter scaffold source: `src/datalad/adapter.js`
- Adapter tests: `test/adapter.test.js`

## Fork origin and upstream sync

This project is intended to be seeded from GitHub Desktop and maintained with an explicit upstream sync strategy.

- Upstream source repository: _TBD (GitHub Desktop)_
- Upstream starting commit/tag: _TBD_
- Upstream sync strategy: _TBD (document before implementation starts)_

## Local validation

Run baseline tests:

```bash
npm test
```

## GUI harness testing

Install dependencies and start the desktop harness:

```bash
npm install
npm start
```

The window includes:

- Environment diagnostics (with UI-ready recovery report)
- Project classification (Git / Dataset / Superdataset)
- Curated DataLad actions (Clone/Install, Get, Save, Update, Push)
- Adapter interface contract snapshot
