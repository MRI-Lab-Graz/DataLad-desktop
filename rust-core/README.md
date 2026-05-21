# Rust Core Bootstrap

This crate is the first step of porting DataLad Desktop backend logic from Node.js to Rust.

## Scope in this bootstrap

- Process runner abstraction (`process_runner.rs`)
- Environment diagnostics model (`diagnostics.rs`)
- Initial adapter core with `check_environment()` (`adapter.rs`)

The API mirrors the existing JavaScript adapter diagnostics contract to keep migration incremental.

## Next steps

1. Add command schema validation and curated command execution (`cloneInstall`, `get`, `save`, `update`, `push`).
2. Add project classification (`git`, `dataset`, `superdataset`) with fallback behavior.
3. Expose this crate to Electron through a Node bridge (recommended: `napi-rs`).
4. Switch JS adapter calls to Rust implementation behind a feature flag.

Status update:

- Curated command execution and project classification are now implemented in this crate.
- Electron has an opt-in bridge scaffold in [src/datalad/rust-bridge.js](../src/datalad/rust-bridge.js).
- A Node native addon package scaffold exists in [native/rust-core-node](../native/rust-core-node/).
- The app uses Rust only when `DATALAD_DESKTOP_USE_RUST_ADAPTER=1` and a native module is available.

## Local build

Install Rust toolchain first:

- https://rustup.rs/

Then run:

```bash
cargo test
```

## Electron bridge behavior

- Default behavior: JavaScript adapter is used.
- Opt-in behavior: set `DATALAD_DESKTOP_USE_RUST_ADAPTER=1` to attempt native Rust adapter loading.
- Package lookup target for native addon: `@datalad-desktop/rust-core`
