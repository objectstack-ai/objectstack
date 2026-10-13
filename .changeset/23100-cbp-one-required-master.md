---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/plugin-security": minor
---

feat(spec)!: a `controlled_by_parent` object derives its master from exactly one required `master_detail` — the parse refuses anything else, and the runtime's two fallback tiers retire (#23100)

Clause-②: no (narrowing)

ADR-0055 §1 says a `controlled_by_parent` object "must declare exactly one required `master_detail` field … Validation error otherwise (fail closed)". Until now neither the parse nor the runtime kept it. `ObjectSchema` accepted such an object with no master at all. The security runtime derived a master through a three-tier fallback the record never stated: a required `master_detail`, then any `master_detail`, then a required `lookup`, taking the first match by field order within a tier. The maintainer ruling (letter B) enforces the record, under ADR-0049 (enforce-or-remove).

**BREAKING — what moves for consumers.**

- **`@objectstack/spec`.** `ObjectSchema` (raw `.parse()` / `.safeParse()`, `ObjectSchema.create()`, `defineStack`, `os validate` and the metadata save door) refuses an object declaring `sharingModel: 'controlled_by_parent'` unless exactly one of its fields is a `master_detail` declared `required: true`. With none, the issue sits at `sharingModel` and names each field that relied on a retired tier. With two or more, it sits at `fields` and names them. A plain object literal is judged like a raw parse: an omitted `required` on its `master_detail` is refused, while `ObjectSchema.create()` keeps forcing an omitted `required` to `true`. The step-18 semantic migration entry `cbp-master-relation-tiers-retired` carries the prescription for `os migrate meta`.
- **`@objectstack/plugin-security`.** The relation resolver derives a master from that one field and nothing else. An object that declares a non-required `master_detail` only, a required `lookup` only, or two required `master_detail` fields resolves no master. Every read of it is denied, and every write and insert is refused with `422 INVALID_METADATA`. The plugin reports such an object once per object (`[security/controlled-by-parent] … resolves no master relation`), naming the shape it relied on. The `422` message now says "not exactly one required master_detail field".
- **`@objectstack/lint`.** `security-controlled-by-parent-no-relation` now refuses the non-required `master_detail` and required `lookup` shapes as well. `security-controlled-by-parent-ambiguous-relation` reports two or more required `master_detail` fields as "no master is derived", since the runtime no longer picks one by field order. Two required `lookup` fields are now a no-relation object, not a tie. `security-master-detail-ungranted` no longer treats a lookup-bound `controlled_by_parent` object as a detail.

**FROM → TO — HotCRM's three objects.** These are the only producers measured on the retired third tier: the read-only HotCRM clone at `0f84c9c`, 8 `controlled_by_parent` objects, 5 of them already on one required `master_detail`. HotCRM's pinned engine is unaffected until it bumps past the release that carries this change.

| object | FROM | TO |
|---|---|---|
| `crm_campaign_member` | `crm_campaign: Field.lookup('crm_campaign', { required: true })` | `crm_campaign: Field.masterDetail('crm_campaign', { required: true, deleteBehavior: 'restrict' })` |
| `crm_event_attendee` | `crm_event: Field.lookup('crm_event', { required: true })` | `crm_event: Field.masterDetail('crm_event', { required: true, deleteBehavior: 'restrict' })` |
| `crm_article_feedback` | `crm_knowledge_article: Field.lookup('crm_knowledge_article', { required: true, deleteBehavior: 'cascade' })` | `crm_knowledge_article: Field.masterDetail('crm_knowledge_article', { required: true, deleteBehavior: 'cascade' })` |

`deleteBehavior: 'restrict'` keeps what the two lookups do today: a campaign or an event with members or attendees cannot be deleted. Without it a `master_detail` cascades, and a detail's rows are deleted with their master. An object whose rows must outlive their parent is not a detail. It leaves `controlled_by_parent` for `private`, `public_read` or `public_read_write`.

**Remedy, in one line.** On every object with `sharingModel: 'controlled_by_parent'`, declare exactly one `master_detail` field with `required: true`, pointing at the master. Every other parent is a `lookup`.

**Unchanged.**

- An object with one required `master_detail` resolves and derives exactly as before, chain walk included. So does a required `master_detail` beside other `lookup` fields, or beside a `master_detail` that is not required. Every in-tree `controlled_by_parent` object is in that set: `examples/app-crm` (1), `examples/app-showcase` (2), the CLI's eval corpus (4) and the dogfood fixtures.
- Stored metadata is not rewritten. A stored row in a retired shape still registers, under its `[metadata_spec_invalid]` diagnostic, and is denied until it is corrected and saved. No conversion is offered: turning a `lookup` into a `master_detail` changes what deleting the master does to every row, and leaving `controlled_by_parent` is the author's decision.
- No export, signature or error code is added or removed.

<!-- adr-0087: registered cbp-master-relation-tiers-retired -->
