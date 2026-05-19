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

## Repository setup notes

This repository currently tracks planning and architecture for the MVP scope.

- Roadmap: `docs/roadmap.md`
- Researcher workflow and UX rules: `docs/product/researcher-workflow.md`
- DataLad adapter contract: `docs/architecture/datalad-adapter.md`

## Fork origin and upstream sync

This project is intended to be seeded from GitHub Desktop and maintained with an explicit upstream sync strategy.

- Upstream source repository: _TBD (GitHub Desktop)_
- Upstream starting commit/tag: _TBD_
- Upstream sync strategy: _TBD (document before implementation starts)_

## Local validation

No build/test tooling is configured in this repository yet.
