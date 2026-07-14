---
"@objectstack/driver-sqlite-wasm": patch
---

Harden the wasm SQLite driver (the dev fallback used when native `better-sqlite3` has an ABI mismatch) against three failure modes that spammed `pnpm dev`:

- **Atomic flushes.** The database was persisted with a plain `writeFile` that truncates-then-streams in place, so a process killed mid-write (a dev-server restart, Ctrl-C, or crash — likely under `on-write`, where every dispatcher tick flushes) left a torn file that sql.js rejected on the next boot with `database disk image is malformed`. Flushes now write to a sibling temp file, `fsync`, and atomically `rename()` over the target, so a reader always sees a complete image.
- **Corruption self-heal.** When an on-disk image is already corrupt, the driver now detects it at open (via `PRAGMA quick_check`), quarantines the bad file to `<db>.corrupt-<timestamp>`, and boots on a fresh database — instead of failing every query forever with no path to recovery.
- **`undefined` bindings.** A raw `undefined` binding made sql.js `throw` a plain string (`Wrong API use : tried to bind a value of an unknown type (undefined).`), which aborted the write and logged as a garbled char-indexed object. `undefined` is now coerced to SQL `NULL`, matching the driver's `useNullAsDefault` semantics and the native better-sqlite3 path.
