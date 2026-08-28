---
"@objectstack/plugin-security": patch
---

fix(security): a refused RBAC catalog write is now boot-visible instead of reporting a seed of zero (#12923)

The five RBAC catalog seeders answered a refused write with `null`/`false`,
which is byte-for-byte the answer for "nothing to do": the `seeded` counter
never incremented and the pass returned normally. On a deployment still
enforcing a **platform-wide** unique index on the name column — the shape that
predates per-organization materialization — every per-organization INSERT is
refused that way, so the boot log read as a successful seed of zero rows.
Measured on a deployed plane, undetected for weeks: an empty Setup (no
positions, no permission sets, no capabilities) under a clean log.

The outer handler was not missing, it was **disarmed**. `security-plugin.ts`
already wrapped the organization-creation seed in a `try`/`catch` that warns,
and it was unreachable for this failure class: the refusal was converted to
`null` three call layers below, so the `await` resolved normally and the hook
logged "RBAC catalog seeded" at `info` over a seed of nothing. Another outer
`try`/`catch` would fix nothing — the signal has to survive the inner helper,
which is where the change is.

Each seeder now accumulates the writes the database refused and reports them
**once per object per class per pass**, beside its counts:

- a **unique violation** is named as a deployment-schema defect, with the
  migrate remedy (`os migrate plan` → `os migrate apply`, where the legacy
  index surfaces as a `replace_unique_index` operation) and a pointer to the
  query engine's own redacted `Insert operation failed` entries, which keep the
  colliding index identifier;
- anything **else** gets its own line and is never relabelled as the above,
  because no migration repairs it.

Classification uses the shipped cross-dialect predicates in
`@objectstack/types` (`isUniqueViolationError` / `uniqueViolationColumn`), not
a local `23505` / `ER_DUP_ENTRY` regex. The warning prints only the value-free
`code`/`errno` channel — never the driver's message, which a SQL driver
prefixes with the fully bound statement.

Diagnosis only: the seeders still **warn and continue**, never throw. A rethrow
would turn a silent degradation into a boot failure on every deployment
carrying the legacy index. Counts, accept/reject behaviour and the healthy-path
logs are unchanged, and a pass that refuses nothing stays silent.
