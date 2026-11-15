---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: `os build` refuses a flow or hook condition that orders or does arithmetic on an injected column a stored row can hold null in, as the publish gate already does

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no skill under `skills/**` teaches a condition over an injected column or the null guard on one; `content/docs/automation/flows.mdx` and `content/docs/automation/hooks.mdx` gain the rule in this change.

<!-- adr-0087: registered flow-hook-condition-injected-column-null-guard-at-build -->

**BREAKING** for a stack whose record-triggered flow (start `condition`, edge `condition`, `decision` branch `expression`) or hook `condition` applies `<`, `<=`, `>`, `>=` or `+ - * / %` to an injected system column the object does not declare itself, with no `!= null` guard in the same branch. `os build` judged the null guard over the declared fields only and accepted these; the runtime publish gate, which reads the object as served with those columns declared, refused them. A stored row holds `null` there: a system-context insert stores `null` in `owner_id`, `created_by` and `updated_by`, a seeded row keeps `created_by` and `updated_by` `null`, nothing stamps `owning_business_unit_id` yet, `queue` is `null` until a queue write names one, and a `beforeInsert` hook reads `organization_id`, `created_at` and `updated_at` before they are stamped. On such a row the flow run fails at the condition while the write that fired it lands, and a hook condition fails the write.

What moves (each line FROM → TO):

- `record.owner_id > 'a'` (or `created_by`, `updated_by`, `owning_business_unit_id`, `queue`, `organization_id`; bare in a flow too) at a record-triggered flow's start, edge or branch, or at a hook's `condition`: FROM accepted by `os build` and `os validate` TO refused with the publish gate's `expression-invalid` null-guard finding.
- `record.created_at > timestamp('2025-01-01T00:00:00Z')` (or `updated_at`) at a hook whose `events` include `beforeInsert`: FROM accepted by `os build` TO refused, as the publish gate refuses it.

The fix: guard the column in the same branch, `record.owner_id != null && record.owner_id > 'a'`. A flow's start-condition guard holds at every edge and branch; `has()` is no guard.

Unchanged: the publish gate's verdicts; a column the object declares itself, which keeps the verdict its own keys give; `created_at` / `updated_at` at every other hook event and flow slot; equality (`==`, `!=`) on any column; and validation rules and `requiredWhen`, which both doors judge over the declared fields only.
