---
'@objectstack/lint': minor
---

fix(lint): the flow and hook publish doors accept an unguarded ordering comparison over `created_at` / `updated_at`, the two system columns the platform stamps on every stored row, as `os build` does

Clause-②: yes (widening) — the flow and hook publish doors (Studio, `/api/v1/meta`, the MCP and AI authoring doors) now accept a condition they refused and `os build` accepted: `created_at` or `updated_at` (as the registry injects them, on an object whose storage the platform provisions) read off the current row (bare in a flow, or `record.`) as an operand of `<`, `<=`, `>` or `>=` with no `!= null` guard, in a record-triggered flow or in a hook whose every event is `afterInsert`, `beforeUpdate`, `afterUpdate`, `beforeDelete` or `afterDelete`. Nothing that published before is refused, and no other verdict moves: arithmetic over either column, a `previous.` read, a `beforeInsert` or read-event hook, and the other six injected columns keep their verdicts. `os build`, `os validate`, `os lint` and the MCP `validate_expression` tool are unchanged. No exported type or signature changes.
Metadata-protocol: added
Skills-docs: none owed — no skill teaches that `created_at` or `updated_at` needs a null guard in a flow or hook condition, or that the door refuses one; the door now gives the verdict `os build` already gives on those two columns under an ordering comparison.

**Before:** every runtime publish door hands the authoring rules the objects as the registry serves them, and a served object carries the columns the registry injects as declared fields with `required: false` and no default. The null-guard gate read every one of them as nullable, so the flow and hook publish doors refused `record.created_at > timestamp('2025-01-01T00:00:00Z')` or `record.updated_at > record.created_at` in a record-triggered flow's start condition, edge condition or `decision` branch, or in a hook `condition`, with `422 INVALID_METADATA` (`expression-invalid`), while `os build` and `validate_expression` accepted the same condition.

**Now:** at a runtime publish door the null-guard gate does not report `created_at` or `updated_at` when the column is the platform's own injected definition on an object whose storage the platform provisions, the operand is the current row's column (a record-triggered flow's bare trigger-record name, or `record.created_at` / `record.updated_at`), and the operator is an ordering comparison (`<`, `<=`, `>`, `>=`). The warrant is the stamp: the platform writes both columns on every stored row in its own `beforeInsert` hook (`sys_stamp_audit_insert`, priority 10), so a read of the current row after it is never `null`. A record-triggered flow reads the stored row after it; so does a hook on `afterInsert`, `beforeUpdate`, `afterUpdate`, `beforeDelete` or `afterDelete`. A hook keeps every verdict unless each of its `events` is one of those five.

**Unchanged:**

- A `previous.created_at` / `previous.updated_at` read is judged as before: an insert binds `previous` itself to `null`, so `record.updated_at > previous.updated_at` in an `afterInsert` hook or a create-leg flow is refused, and the message names the full guard (`previous != null && previous.updated_at != null`).
- A hook whose `events` include `beforeInsert` (it can run before the stamp, at any `priority`) or a read event (`beforeFind`, `afterFind`: no record) is judged as before.
- Arithmetic over either column is refused at every door, as before: `record.created_at + 1 > 0` and `record.updated_at - record.created_at > duration('1h')` at a hook, at an action, and in a flow's `record.` spelling (where the null-guard is the door's refusal), and the bare `created_at + 1 > 0` in a flow (where the type verdict is).
- A `created_at` the author declares, and the one on an ADR-0015 `external` object, are judged as before.
- The door still judges six injected columns nullable: `owner_id`, `created_by`, `updated_by`, `owning_business_unit_id` and `queue`, which a stored row can hold `null` in, and `organization_id`, which org scoping stamps on insert.
- On those six, and on a `beforeInsert` or read-event hook's ordering over `created_at` / `updated_at`, the door and `os build` still differ (the build judges no injected column) until #33435 settles their verdict.
- The `object_extension` door, which reads the objects as authored, is unchanged.
