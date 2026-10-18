---
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

fix(runtime,cli): `os start` and `os dev` refuse a SQLite database whose directory cannot be made, at once, instead of hanging

Clause-②: no

**What was wrong.** The standalone host (`createStandaloneStack`, which `os start`, `os dev`'s standalone boot and every embedder run) prepared the directory of a file-backed SQLite database with Node's recursive `mkdirSync`. Node's recursive mkdir never returns when a level answers `ENOENT` although its parent exists: for `OS_DATABASE_URL=file:/proc/os-x/ctl.db` it looped `mkdir("/proc/os-x")` and `mkdir("/proc")` without end, holding the event loop. `os start` printed `→ Starting server...` and hung with no timeout and no message. The `sqlite-wasm` arm (`wasm-sqlite://…`, or `OS_DATABASE_DRIVER=sqlite-wasm`) did the same. `os dev` hung the same way in its own process when its default database lived under a state directory that cannot be made (for example `OS_HOME=/proc/os-x`).

**What an operator sees now.** The boot exits non-zero within its normal start-up time, naming the database file, the directory and the operating system's error:

```text
✗ [StandaloneStack] SQLite database file '/proc/os-x/ctl.db' cannot be created: its directory '/proc/os-x' could not be made: ENOENT: no such file or directory, mkdir '/proc/os-x'
```

`os dev` with an unusable state directory prints `✗ The default database '…/data/objectstack.db' cannot be created: its directory '…/data' could not be made: …`, followed by the remedy: point `OS_HOME` at a directory that can be created, or choose the database with `--database`.

Nothing else changes. A creatable path is still made, every missing level of it. The read-only boot (`os migrate plan` over an absent database file) still creates no directory. The refusal names the path, never the database URL.
