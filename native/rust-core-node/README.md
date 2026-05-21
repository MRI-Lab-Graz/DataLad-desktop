# Rust Node Addon Bridge

This package exposes the Rust adapter core to Node.js/Electron via N-API.

## Location

- Rust logic crate: `../../rust-core`
- N-API bridge crate and Node package: `.`

## Build

```bash
npm install
npm run build
```

Debug build:

```bash
npm run build:debug
```

## Test

```bash
npm run test:rust
```

## Runtime integration

The Electron bridge in `src/datalad/rust-bridge.js` can load this package when:

1. `DATALAD_DESKTOP_USE_RUST_ADAPTER=1` is set.
2. Native addon build output exists in this directory.

If loading fails, the app falls back to the JavaScript adapter.
