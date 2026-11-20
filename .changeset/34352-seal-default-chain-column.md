---
'@objectstack/spec': minor
---

feat(spec)!: a sealed object that names no `lifecycle.seal.chainField` is refused at parse when its default chain column `tenant_id` cannot chain its rows

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered seal-default-chain-column-refused -->

**BREAKING** accept-set narrowing, shipped as `minor`. A `lifecycle.seal` that names no `chainField` chains each row by the default column `tenant_id` (ADR-0154 D10, note on `chainField`). That default was never judged at authoring. It is now judged by the same rules as a named `chainField`, and the object is refused with one located issue at `lifecycle.seal` in three cases. What run time did with each before:

- (a) `tenant_id` is not a field of the object. The platform injects `organization_id`, never `tenant_id`, so it must be declared. Before: the object parsed, and the sealer reported it at `error` and sealed none of its rows.
- (b) `tenant_id` has a value that is not one text on every store (a number, boolean, date, datetime, JSON-shaped or multi-value column). Before: the object parsed, and the sealer sealed its rows into the deployment chain with no report.
- (c) `tenant_id` is listed in `lifecycle.seal.valueFields`. Before: the object parsed and was sealed per organization, with the committed column's value carried in clear as the chain in every checkpoint.

The judgement reads the object's own declared fields plus the columns the platform injects. A `tenant_id` that reaches the object only through an `objectExtensions` entry does not count: such an object is refused at parse, although the sealer, which reads the folded field map, would have sealed it. Declare the column on the object itself.

The refusal fires wherever `ObjectSchema` parses: `ObjectSchema.create()` and `defineStack()` (strict by default) throw when a code-authored stack's config module is evaluated, and `os validate`, `os build` and the metadata save door refuse it. A definition that reaches the registry without the parse, including a stored `sys_metadata` row loaded at boot, still registers, and the sealer still treats it as before.

- FROM: `{ name: 'ai_audit_log', fields: { id, created_at, payload }, lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'] } } }` parsed, and its rows were not sealed.
- TO: the same object is refused at `lifecycle.seal`: "`lifecycle.seal` names no `chainField`, so the sealer chains each row by the default chain column `tenant_id`, which is not a field of this object."

Not moved: an object that declares a text or lookup `tenant_id`, and an object whose `chainField` names a column it has, parse as before.

The fix: declare a text or lookup `tenant_id` field that holds each row's organization id, or name the chain column, such as the injected tenant column: `seal: { valueFields: ['payload'], chainField: 'organization_id' }`. On a case (b) or (c) object that already has checkpoints, the fix changes the chain column or its value, so the next pass re-seals the last sealed window and `os audit verify` reports it `listed_twice`.
