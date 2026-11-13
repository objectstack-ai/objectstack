---
'@objectstack/lint': minor
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
---

fix(lint): the runtime `object_extension` publish door judges a computed field an extension adds by the build's field-formula pass, against the extended object as served

Clause-②: no (narrowing) — the `object_extension` publish door (Studio's add-field on a `.custom` pair, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) now refuses an extension whose computed field carries an `expression` `os build` refuses. No exported type or signature changes. Measured first-party: 0 extension entries with a computed field (`examples/app-showcase` one entry, three plain fields; `packages/plugins/plugin-auth` one, a `secret` field; HotCRM none), so nothing first-party is newly refused.
Metadata-protocol: narrowed
Skills-docs: none owed — this PR edits `content/docs/deployment/validating-metadata.mdx` (the CEL row's runtime column gains `ᵒˣ`, and the object extension door paragraph names the formula pass); `skills/objectstack-data` teaches `defineObjectExtension({ extend, fields })` and the computed-field rules without saying the runtime door is exempt, so the door now gives the verdict the build already gives.

<!-- adr-0087: registered object-extension-door-computed-field-expression-judged -->

**BREAKING** accept-set narrowing of the runtime `object_extension` publish door (`validateStackExpressions` joins its `runtimeTypes`).

`os build` and `os validate` judge each field an `objectExtensions` entry adds with the field-formula pass, but the publish door that writes an extension at runtime ran only the vocabulary freeze, so a computed field the build refuses published with a 200 and then read null, or failed, on every row.

- On an `object_extension` write the expression rule runs exactly one pass: the extension walk over each field the written entry adds, against the door's live objects with the entry folded in (the build's own fold), located as the build locates it for a package with one extension entry: `object 'crm_account' · objectExtensions[0] · field 'score__c' expression` (the door judges the written entry alone, so its index is always `[0]`; a build of a package with several entries names the entry's own index). A refusal is the gate's `422 INVALID_METADATA` with issue rule `expression-invalid`; a stored field that reads another record, the clock or the acting user is an advisory (`stored-expression-cross-record-input`, `stored-expression-volatile-input`), never a refusal.
- A republish is judged against the target without the package's own stored extension, which the write replaces, as the build sees the package's one entry: dropping a field the extension's own formula still reads is refused, and a formula over a lookup the same write re-targets is judged over the new target.
- An extension of an object the door does not carry is judged on what does not depend on that object's fields (grammar, registered functions, bare and unbound references).
- A package-wide draft publish (`publishPackageDrafts`) whose drafts depend on a sibling extension draft is refused, because that batch's pending set carries no extension drafts (#33152); publishing the extension first through the per-item door works.
- Unchanged: the object save door, `os build`, `os validate`, a draft save (never gated), and a stored row, which is judged only when it is published again.

Migration: before publishing an extension again, fix each refused `expression` the way you would on a declared field of the same object: read `record.FIELD` for a field the object serves, call only registered functions, and make a stored field that reads another record, the clock or the acting user a `formula` field.
