---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): the runtime `object_extension` publish door judges a computed field an extension adds by the build's field-formula pass, against the extended object as served

Clause-②: no (narrowing) — the `object_extension` publish door (Studio's add-field on a `.custom` pair, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) now refuses an extension whose computed field carries an `expression` `os build` refuses. No exported type or signature changes. Measured first-party: 0 extension entries with a computed field (`examples/app-showcase` one entry, three plain fields; `packages/plugins/plugin-auth` one, a `secret` field; HotCRM none), so nothing first-party is newly refused.
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-data` teaches `defineObjectExtension({ extend, fields })` and the computed-field rules without saying the runtime door is exempt; the door now gives the verdict the build already gives.

<!-- adr-0087: registered object-extension-door-computed-field-expression-judged -->

**BREAKING** accept-set narrowing of the runtime `object_extension` publish door (`validateStackExpressions` joins its `runtimeTypes`).

`os build` and `os validate` judge each field an `objectExtensions` entry adds with the field-formula pass, but the publish door that writes an extension at runtime ran only the vocabulary freeze, so a computed field the build refuses published with a 200 and then read null, or failed, on every row.

- On an `object_extension` write the expression rule runs exactly one pass: the extension walk over each field the written entry adds, against the door's live objects with the entry folded in (the build's own fold), located where the build locates it: `object 'crm_account' · objectExtensions[0] · field 'score__c' expression`. A refusal is the gate's `422 INVALID_METADATA` with issue rule `expression-invalid`; a stored field that reads another record, the clock or the acting user is an advisory (`stored-expression-cross-record-input`, `stored-expression-volatile-input`), never a refusal.
- An extension of an object the door does not carry is judged on what does not depend on that object's fields (grammar, registered functions, bare and unbound references).
- Unchanged: the object save door, `os build`, `os validate`, a draft save (never gated), and a stored row, which is judged only when it is published again.

Migration: before publishing an extension again, fix each refused `expression` the way you would on a declared field of the same object: read `record.FIELD` for a field the object serves, call only registered functions, and make a stored field that reads another record, the clock or the acting user a `formula` field.
