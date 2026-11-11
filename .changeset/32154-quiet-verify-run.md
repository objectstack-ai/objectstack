---
'@objectstack/verify': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/metadata': patch
'create-objectstack': patch
---

fix(verify): a passing `os verify` run and a passing starter `pnpm test` no longer print stack traces, a `DATABASE_ERROR` or warnings about the harness's own secret

Clause-②: no
Metadata-protocol: none

On the blank starter a passing `os verify` printed 626 lines (346 INFO records, 263 `[Registry] …` lines, a `DATABASE_ERROR … no such table: _objectstack_sequences` and four better-auth warnings that the secret was short and low-entropy) before its verdict, and a passing `pnpm test` printed a WARN with a full stack trace for the refusal its own test asserts. It now prints the verdict and two console lines. A failing run still prints its failure: a failing test prints vitest's diff, and a boot that fails prints the ERROR record with the plugin, the message and the stack, then `os verify`'s refusal.

- **`@objectstack/verify`**: `bootStack` boots at `warn` unless `OS_LOG_LEVEL` (or the legacy `LOG_LEVEL`) names another level, the default `objectstack serve` already uses. The ObjectQL registry's `[Registry] …` lines follow the same level unless `OS_REGISTRY_LOG` is set. To see the whole boot log, run with `OS_LOG_LEVEL=info` or `OS_LOG_LEVEL=debug`. The auth signing secret, when `authSecret` is not passed, is 32 random bytes held in the process's memory for its lifetime, instead of a fixed 25-character string.
- **`@objectstack/metadata-protocol`**: the boot-time table-presence probe recognises a driver configured with a knex Client class, by the dialect that class declares. `@objectstack/driver-sqlite-wasm` is one, and on it the probe used to fall back to a statement that fails when the table is absent, so the driver logged `DATABASE_ERROR` on every boot of a project that had never numbered a record. A driver configured by name answers as before.
- **`@objectstack/objectql`**: when the engine itself refuses a caller's input on insert or update (a `VALIDATION_FAILED` raised before any statement runs, such as a missing required field), the `Insert operation failed` / `Update operation failed` line is logged at `debug` instead of `warn`. The caller still receives the refusal. Every other failure, including the database's own NOT NULL refusal, is still logged at `warn`.
- **`@objectstack/metadata`**: `Registered metadata loader: …` is logged at `debug`.
- **`create-objectstack`**: the starter's `vitest.config.ts` no longer sets `OS_REGISTRY_LOG`, because the booted stack is quiet by default; its comment names `OS_LOG_LEVEL=info pnpm test` for the whole boot log.
