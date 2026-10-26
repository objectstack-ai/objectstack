---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/lint': minor
'@objectstack/plugin-hono-server': minor
---

feat(spec,security): a field permission entry can carry a row condition (`when`) on its edit vote

Clause-②: yes (widening)
Metadata-protocol: added
Ruling-ref: 6408558941

- **Before.** A `fields["<object>.<field>"]` entry voted `readable` / `editable` on every row of the object. A lock that should apply on some rows only (the amount of an approved opportunity, say) had no spelling: a validation rule or a hook carried it, outside the permission model and outside `os explain`.
- **Now.** `FieldPermissionSchema.when` is an optional row condition, authored in the same canonical CEL as `rowLevelSecurity[].using` (`status == 'approved'`, `owner_id == current_user.id`, …). An entry with a `when` votes as declared on the rows the condition names and is **absent** on the others, as if the set had not declared the field; an entry without one votes on every row, as before. The vote reaches the **edit** bit only — reads are row-blind — so `readable: false` beside a `when` is refused at parse, and the message says why. `condition`, `where` and `filter` are refused with a pointer to `when`.
- **Judged on the row the write changes.** The write gate (the engine middleware's field-level step and `canWriteObject`) judges the **stored** row before an update, read as the caller reads it, and each **incoming** row of an insert — in process, by `RLSCompiler.compileRowPredicate` (the compile, `current_user` context, field guard and comparand faces an RLS `check` clause takes) and the write gate's own stored-form judge. Never a query rewrite. A row that cannot be judged — a predicate update, a stored row the caller cannot read, a condition that does not resolve for the request — applies the entry as its **lock** (no edit grant), and a WARN line says why.
- **Row-blind readers apply the lock.** `/auth/me/permissions` (`buildEffectiveFieldPermissions`, new in `@objectstack/core`, the one vote `PermissionEvaluator.getFieldPermissions` takes per object), the writable-field projections, the query guard and the result masker hold no row, so a conditioned entry is reported as its lock: no client is told of an edit the gate refuses. `os explain`'s `fls` layer names each row-conditioned entry as such — judged per row by the write gate, applied as the lock elsewhere.
- **Validated like an RLS predicate.** `@objectstack/lint`'s `validateRlsPredicateEnforceability` walks `permissions[].fields[].when` by the passes `using` / `check` take, against the key's object: `rls-predicate-unenforceable`, `-unparseable`, `-over-budget`, `-unknown-field`, `-unknown-user-variable`, with the cost named (the entry cannot be judged and is applied as its lock on every row).
- **Unchanged.** Field grants union without deny: a matched conditioned lock is out-voted by a sibling's unconditioned `editable: true` exactly as before, and only declaring entries vote. The `/auth/me/permissions` `fields` merge keeps its most-permissive rule. Recorded under ADR-0066 ⑧ (note of 2026-10-26).
