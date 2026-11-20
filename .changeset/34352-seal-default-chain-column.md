---
'@objectstack/spec': minor
---

feat(spec)!: a sealed object that names no `lifecycle.seal.chainField` is refused at parse when its default chain column `tenant_id` cannot chain its rows

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. A lifecycle.seal that names no chainField was already chained by tenant_id; the parse now holds that default to the rules a named chainField already met. No conversion can repair a refused declaration without choosing for the author which column holds each row's organization (declare tenant_id, or name chainField), so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing, shipped as `minor`. A `lifecycle.seal` that names no `chainField` chains each row by the default column `tenant_id` (ADR-0154 D10, note on `chainField`). That default was never judged at authoring: an object without a usable `tenant_id` parsed, and at run time the sealer reported it at `error` and sealed none of its rows. The default is now judged by the same rules as a named `chainField`, and the object is refused with one located issue at `lifecycle.seal` when `tenant_id`:

- is not a field of the object. The platform injects `organization_id`, never `tenant_id`, so it must be declared;
- has a value that is not one text on every store (a number, boolean, date, datetime, JSON-shaped or multi-value column);
- is listed in `lifecycle.seal.valueFields`.

The refusal fires wherever `ObjectSchema` parses: `os validate`, `os build` and the metadata save door. A definition that reaches the registry without the parse, including a stored `sys_metadata` row loaded at boot, still registers, and the sealer still reports it at `error` as before.

- FROM: `{ name: 'ai_audit_log', fields: { id, created_at, payload }, lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'] } } }` parsed, and its rows were not sealed.
- TO: the same object is refused at `lifecycle.seal`: "`lifecycle.seal` names no `chainField`, so the sealer chains each row by the default chain column `tenant_id`, which is not a field of this object."

Not moved: an object that declares a text or lookup `tenant_id`, and an object whose `chainField` names a column it has, parse as before.

The fix: declare a text or lookup `tenant_id` field that holds each row's organization id, or name the chain column, such as the injected tenant column: `seal: { valueFields: ['payload'], chainField: 'organization_id' }`.
