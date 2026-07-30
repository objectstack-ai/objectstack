---
"@objectstack/service-datasource": patch
---

fix(datasource): a `memory` datasource is ephemeral again, and each pool gets its own store (#4083)

The shared driver factory built `new InMemoryDriver()` for `driver: 'memory'` with
no config, so the pool inherited that driver's own `persistence: 'auto'` default —
in Node, a file adapter at the **relative, process-global** path
`.objectstack/data/memory-driver.json`. Two consequences, neither intended:

- **It was not ephemeral.** The pool flushed its whole store into the server's
  working directory (on an unref'd 2s autosave timer, and again at teardown) and
  reloaded it on the next boot. That is the opposite of what the driver id
  promises the operator who asks for it — `OS_DATABASE_DRIVER=memory` is
  documented as *ephemeral, not real SQL* — and it means a "throwaway" datasource
  left state in the deploy directory.
- **Every memory pool in a process shared one destination.** The default path
  carries no per-datasource component, so two `driver: 'memory'` datasources
  loaded and saved the same file: each saw the other's tables, and the last
  teardown to flush clobbered the other's rows.

Both were visible as an intermittent test failure. The ADR-0062 D1 federated-read
acceptance seeds 2 rows into an auto-connected external memory datasource and
reads them back; it returned 2 rows on a clean checkout and 2×N on the Nth run in
the same tree — passing in CI (always run #1, always a fresh checkout) and
failing locally for anyone who ran it twice. Whether a given run leaked depended
on the autosave timer, which is what made it look flaky rather than wrong.

- The factory now builds the memory pool with **`persistence: false` by default**.
- It also **honors the datasource's own `config`**, which was previously dropped
  entirely: `initialData` and `strictMode` never reached the driver.
- When an author *does* opt into persistence (`config.persistence`), the default
  destination is **scoped to the datasource** —
  `.objectstack/data/memory-<name>.json` / `objectstack:memory-db:<name>` — so
  pools stay independent. An explicit `path`/`key`, or a custom `adapter`, is
  left exactly as written.
- The dev-only sqlite step-down's last-resort in-memory driver
  (`resolveSqliteDriver`, #2229) is built the same way, making its own
  "not persistent" contract true.

`InMemoryDriver`'s documented defaults are unchanged — constructing one directly
still auto-detects persistence. Only the datasource-scoped pools this factory
builds changed.

**Migration.** A deployment relying on `driver: 'memory'` state surviving a
restart was relying on a bug, and should declare it: set
`config: { persistence: 'file' }` on the datasource (now written to a
per-datasource file), or use a real driver — `sqlite`/`sqlite-wasm` give durable
storage with real SQL. Existing `.objectstack/data/memory-driver.json` files are
no longer read; delete them.
