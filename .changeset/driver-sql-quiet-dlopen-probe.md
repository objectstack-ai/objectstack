---
"@objectstack/driver-sql": patch
---

Log a concise one-liner instead of the full `ERR_DLOPEN_FAILED` stack trace when native `better-sqlite3` cannot load (an ABI / `NODE_MODULE_VERSION` mismatch after a Node upgrade, or the native addon was never built). The native → wasm SQLite step-down is unchanged — this only stops a handled, non-fatal fallback from reading like a fatal crash in the dev console, and points at `pnpm rebuild better-sqlite3` for native speed. Any other `PRAGMA` failure keeps its full warning.
