---
'@objectstack/plugin-security': minor
'@objectstack/spec': minor
---

fix(security): **BREAKING** — `sys_position` retires the `permissions` column (ADR-0049 enforce-or-remove, #9885)

Maintainer ruling 2026-08-20: **REMOVE**. The column — a "JSON-serialized array
of permission strings" textarea — was declared on the platform position table
while **no producer ever wrote it and no runtime path ever read it**. The
object-scoped census (every `sys_position`-naming file, with same-object
positive controls resolving `active` / `delegatable` / `is_default` / `name`
to real readers) measured it at zero on both sides: the builtin and declared
position bootstrappers set `label` / `description` / `managed_by` / `active` /
`is_default` only, and position→grant resolution consults
`sys_position_permission_set` rows plus the position `name` — never this
column. Its only reference was the `clone_position` action copying it between
rows (a copy of a value nothing writes), removed in the same stroke. objectui
was searched under the same discipline: no console surface names the column.
A free-text grant catalogue on a security object that no runtime enforces
tells an author — human or AI — that direct position-level permission strings
are a platform capability; they are not. This is an **accept-set narrowing**:
the platform stops declaring, projecting and accepting the column.

Migration (FROM → TO):

| Wrote | Write instead |
|---|---|
| `permissions` on a `sys_position` seed row or data-door write | Delete the key. Capability reaches a position **only** through permission-set bindings (`sys_position_permission_set` rows, created in Setup or by an app's kernel:ready binder); prose that was documenting intent belongs in `description`. |

One-line fix: delete `permissions` from any authored `sys_position` row.

<!-- adr-0087: registered position-permissions-column-retired -->

Enforcement after the removal is loud, not silent: the engine's schema
preflight refuses an undeclared field with `400 INVALID_FIELD` before the
driver or any hook runs, and `PositionSchema`'s strict parse now rejects a
declared-position `permissions` key with guidance naming the binding table.
Physical columns on already-deployed databases are untouched (ADR-0045 schema
sync is additive). If position-level direct grants ever become a real need,
the column is re-declared **with a runtime reader in the same PR** —
declare-and-enforce or don't declare.
