---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): say where the audit system tables were provisioned, and stop skipping provisioning silently (#4887)

`AuditPlugin.provisionSystemTables()` created `sys_audit_log` / `sys_activity` /
`sys_comment` at `kernel:ready` and then said **nothing** — not on success, and
not when it skipped the work entirely (`typeof engine.syncObjectSchema !==
'function'` returned silently). `syncObjectSchema()` itself returns `void` and
has three silent exits of its own — the object is not in the registry, no driver
resolves for it, or the resolved driver has no `syncSchema` — none of which
throw. So "provisioned three tables" and "provisioned nothing at all" produced
byte-identical logs, and the only way to tell them apart was to go looking in a
database.

#4887 is what that costs. `sys_audit_log` and `sys_activity` were reported as
never provisioned because they were absent from the primary SQLite file, with
the silent `typeof` bail named as the likely cause. Neither was true:
`sys_audit_log` (`lifecycle.class: 'audit'`) and `sys_activity`
(`lifecycle.class: 'telemetry'`) are routed by **ADR-0057 §3.6** to the
dedicated `telemetry` datasource whenever one is registered, and `os dev`
registers one by default as a *sibling file* (`dev.db` → `dev.telemetry.db`).
Both tables had been created — in the other store. `sys_comment` carries no
lifecycle class, stays on the primary, and was the one that "existed". Nothing
in the log connected those three facts.

Provisioning now reports itself:

- **Wholesale skip is a `warn`, naming the consequence** — the tables stay
  lazy-created on first WRITE, so an env that READS one first (the home page
  activity feed queries `sys_activity` before any mutation) logs "no such
  table" until something writes.
- **One `info` line per boot listing where each table landed** —
  `sys_audit_log→telemetry, sys_activity→telemetry, sys_comment→sqlite`,
  resolved through the engine's own `getDriverForObject`, so the log states the
  routing rather than leaving it to be inferred.
- **A second `info` line when the ADR-0057 split is in effect**, saying
  explicitly that those tables live in a different store — on SQLite, a
  different *file* — and that anything reading them without naming the object
  (raw SQL against the default datasource) will report "no such table" even
  though provisioning succeeded.
- **An object that resolves to no driver is a `warn`** — `syncObjectSchema()`
  returns without issuing any DDL in that case and throws nothing, so the
  per-object `catch` never fires; from outside the engine this is the only place
  it can be observed.

Behaviour is otherwise unchanged: the same three objects are synced, per-object
failures stay isolated, and an engine without on-demand DDL still degrades
instead of failing `start()`.
