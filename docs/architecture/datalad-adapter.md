# DataLad Adapter Contract

## Goal

Keep DataLad integration behind one boundary so shell/UI code remains close to upstream GitHub Desktop behavior and does not issue DataLad shell calls directly.

Detailed request/result schema and interface guarantees are documented in `docs/architecture/datalad-adapter-interface.md`.

## Responsibilities

The adapter is responsible for:

1. Environment checks
2. Project detection/classification
3. Curated command execution
4. Structured results
5. Progress reporting
6. User-friendly error mapping

## Supported project classifications

- Plain Git repository
- DataLad dataset
- DataLad superdataset

## Curated MVP commands

The adapter should expose only the MVP operations:

- Clone/Install
- Get
- Save
- Update
- Push

Commands such as `status`, `subdatasets`, and `siblings` can be used internally to power UI state, but should not expand the first-wave user-facing command catalog.

## Error and diagnostic expectations

Diagnostics should explicitly detect and report common environment issues:

- Python missing/incompatible
- DataLad missing/incompatible
- git-annex missing/incompatible
- unsupported system state

Errors surfaced to UI should be mapped into researcher language first, with technical detail only when needed for recovery.

## Integration rules

- Do not scatter DataLad shell calls through UI components.
- Keep branch workflows, history, and commit interactions aligned with standard GitHub Desktop behavior.
- Route normal commit action through DataLad-aware save path for DataLad-enabled projects.
