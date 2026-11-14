---
'@objectstack/lint': minor
---

fix(lint): the flow and hook publish doors accept an unguarded ordering or arithmetic operand over `created_at` / `updated_at`, the two system columns the platform stamps on every stored row, as `os build` does

Clause-②: yes (widening) — the flow and hook publish doors (Studio, `/api/v1/meta`, the MCP and AI authoring doors) now accept a condition they refused and `os build` accepted: `created_at` or `updated_at` (as the registry injects them, on an object whose storage the platform provisions) under an ordering or arithmetic operator with no `!= null` guard. Nothing that published before is refused, and no other verdict moves. `os build`, `os validate`, `os lint` and the MCP `validate_expression` tool are unchanged. No exported type or signature changes.
Metadata-protocol: added
Skills-docs: none owed — no skill teaches that `created_at` or `updated_at` needs a null guard in a flow or hook condition, or that the door refuses one; the door now gives the verdict `os build` already gives on those two columns.

**Before:** every runtime publish door hands the authoring rules the objects as the registry serves them, and a served object carries the columns the registry injects as declared fields with `required: false` and no default. The null-guard gate read every one of them as nullable, so the flow and hook publish doors refused `record.created_at > timestamp('2025-01-01T00:00:00Z')` or `record.updated_at > record.created_at` in a record-triggered flow's start condition, edge condition or `decision` branch, or in a hook `condition`, with `422 INVALID_METADATA` (`expression-invalid`), while `os build` and `validate_expression` accepted the same condition.

**Now:** at a runtime publish door the null-guard gate leaves out `created_at` and `updated_at` when they are the platform's own injected definitions on an object whose storage the platform provisions: the platform writes both on every stored row, so a read of either is never `null`. A `created_at` the author declares, and the one on an ADR-0015 `external` object, are judged as before.

**Unchanged:** the door keeps its type verdicts on every injected column (date arithmetic such as `record.created_at + 1 > 0` is still refused), and still judges `owner_id`, `created_by`, `updated_by`, `owning_business_unit_id` and `queue` nullable: a stored row can hold `null` in each. On those five the door and `os build` still differ (the build does not judge any injected column) until #33435 settles their verdict. The `object_extension` door, which reads the objects as authored, is unchanged.
