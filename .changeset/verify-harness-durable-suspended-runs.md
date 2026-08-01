---
"@objectstack/verify": minor
---

fix(verify): stop the harness pinning `suspendedRunStore: 'memory'` (#4470)

`bootStack` hardcoded `suspendedRunStore: 'memory'` when it registered
`@objectstack/service-automation`. That made the DB-backed suspended-run store
**structurally unreachable** from every dogfood/e2e fixture — not under-tested,
untestable. The coverage map had a clean seam nothing crossed:

- unit tests covered ENGINE-side persistence (`suspended-run-store.test.ts`
  drives suspend → restart → resume against a fake table);
- e2e covered the BUSINESS chain (approvals), but single-process and wholly in
  memory;
- the ASSEMBLY between them — is `sys_automation_run` registered, is its table
  created, is the store actually attached to the engine — was covered by
  neither.

#4420 grew in precisely that seam: the store hung off a table that was never
created, every write failed into a `warn` nobody read, the pause reported
success, and the run died at the next restart. #4460 added assembly unit tests;
this makes the e2e half possible.

The harness now boots the plugin's own `'auto'` default — the same wiring
`objectstack dev` / `serve` get — so fixtures exercise the real assembly. Two
new knobs:

- `automation` accepts `{ suspendedRunStore: 'auto' | 'memory' }` as well as
  `true`, so a fixture that wants the old in-memory behaviour asks for it
  explicitly rather than getting it by default.
- `databaseFile` backs the in-process SQLite database with a file instead of
  `:memory:`, so state can outlive a kernel.

Answering the question the issue raised — was `'memory'` pinned for speed or
because persistence could not run there? **Speed/simplicity.** The durable path
works in this harness: the accompanying dogfood proof boots with it, and the
whole existing dogfood suite passes on it unchanged (38 files, 239 tests). Note
`databaseFile` does not yet deliver a true cold boot: a second `bootStack` over
the same file reads a database whose tables exist but whose rows are gone —
ordinary records do not survive it either, so it is a harness/driver persistence
gap rather than anything to do with suspended runs, and it is filed as #4518.
