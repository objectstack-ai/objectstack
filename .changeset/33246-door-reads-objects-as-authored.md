---
'@objectstack/lint': minor
---

fix(lint): the runtime publish door judges a record-triggered flow condition and a hook `condition` over a system column the platform injects (`created_at`, `updated_at`, `owner_id`, …) as `os build` does

Clause-②: yes (widening) — the flow and hook publish doors (Studio, `PUT /api/v1/meta/flow/NAME` and `/meta/hook/NAME`, the MCP and AI authoring doors) now accept a condition they refused and `os build` accepted: an ordering or arithmetic operator applied with no `!= null` guard to a column the platform injects and the object does not declare. Nothing that published before is refused; `os build`, `os validate`, `os lint` and the MCP `validate_expression` tool are unchanged. No exported type or signature changes.
Metadata-protocol: added
Skills-docs: none owed — no skill teaches that an injected column needs a null guard in a flow or hook condition, or that the door refuses one; the door now gives the verdict `os build` already gives, which is what `skills/objectstack-automation` and `skills/objectstack-data` describe.

**Before:** every runtime publish door hands the authoring rules the objects as the registry serves them, and a served object carries the columns the registry injects (`created_at`, `created_by`, `updated_at`, `updated_by`, `owner_id`, `owning_business_unit_id`, `organization_id`, …) as declared fields with `required: false` and no default. The null-guard gate read them as declared nullable fields, so the flow and hook publish doors refused `record.created_at > timestamp('2025-01-01T00:00:00Z')` or `record.updated_at > record.created_at` in a record-triggered flow's start condition, edge condition or `decision` branch, or in a hook `condition`, with `422 INVALID_METADATA` (`expression-invalid`), while `os build` and the MCP `validate_expression` tool accepted the same condition. Only the `object_extension` door read the objects without those columns.

**Now:** every runtime publish door reads the objects without the injected columns, through the write path's own strip (`stripInjectedSystemColumns` from `@objectstack/metadata-core`), as `os build` reads the objects as authored. An injected column is still a known field, and the null-guard gate does not judge it nullable, at the door or the build. A field the object declares nullable is judged as before: `record.amount > 0` with no guard is refused at both.

**Unchanged:** `os build`, `os validate`, `os lint`, the MCP `validate_expression` tool, every verdict on a field the object declares, and the advisory on an injected column with no storage behind it on an `external` object.
