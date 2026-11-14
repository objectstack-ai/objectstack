---
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

fix(runtime,cli): `GET /api/v1/ready` reports whether the boot seed has landed, and `os serve` prints the seed result its banner promised

Clause-②: no
Metadata-protocol: none

The inline boot seed can still be writing after the kernel runs: past its budget (`OS_INLINE_SEED_BUDGET_MS`, default 8 s) it continues in the background, and a seed that waits for demo accounts or seed files starts after `kernel:ready`. `/health` and `/ready` answered ready the whole time, and the settle was announced only on the `os serve` IPC channel (`objectstack:seed-settled`), so a script, e2e suite or health check in another process could not tell when the seed rows were there.

- **`/ready`.** When the app declares seed data, the 200 body now carries `seed`: `"pending"` while any source is still writing, then `"settled"`, or `"failed"` when a source dropped a record, dropped a reference from a written row, or installed no rows (the same verdict the IPC message calls `ok: false`). A multi-tenant or `skipSeedData` boot runs no inline seed and reads `"settled"`. The status code is unchanged, so a replica stays in rotation while it seeds. An app with no seed data gets exactly the body it got before. To wait for the seed from another process, poll `/api/v1/ready` until `seed` is not `"pending"`.
- **`os serve` / `os dev`.** When the ready banner printed `⚠ Seeds:   pending` and "its result prints after this banner", the result now prints, once, when the seed settles: `Seeds:   settled — crm 162 rows`. Before, a clean seed printed nothing, because the seeder's completion lines are logged at `info`, below the default level. A seed that settled before the banner is reported in the banner as before, and nothing more prints.
