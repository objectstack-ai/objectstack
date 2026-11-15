---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): `os build` and the runtime `object_extension` publish door judge the one-hop leaf through a lookup an object extension adds, and the regex and JSON-schema checks of each validation rule an extension adds, as they judge an object's own

Clause-②: no (narrowing) — `os build`, `os validate`, `os lint` and the `object_extension` publish door (Studio, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) now refuse two shapes an extension could carry before: a validation rule or formula reading `record.REF.LEAF` through a lookup an extension adds where the lookup's target serves no `LEAF`, and a `format` / `json_schema` validation rule an extension adds whose regex or schema does not compile or names an unregistered format. No exported type or signature changes. Measured first-party: 0 `objectExtensions` entries add a lookup or a validation rule (`examples/app-showcase` one entry, three plain fields; `packages/plugins/plugin-auth` one, a `secret` field; HotCRM none), so nothing first-party is newly refused.
Metadata-protocol: narrowed
Skills-docs: none owed — this PR edits `content/docs/deployment/validating-metadata.mdx` (the rule-table row now marks the extension door, and the object extension paragraph names both checks); `skills/objectstack-data` teaches one-hop reads, `format` / `json_schema` rules and `defineObjectExtension({ extend, fields })` without saying an extension is exempt from either check, so the build and the door now give the verdict the object's own declarations already get.

<!-- adr-0087: registered object-extension-added-lookup-hop-leaf-judged object-extension-validation-rule-artifacts-judged -->

**BREAKING** accept-set narrowing of `os build`, `os validate`, `os lint` and the runtime `object_extension` publish door.

**Before:** two checks the object's own declarations get skipped what an extension adds. The expression rule judged the leaf of a one-hop read (`record.REF.LEAF`) only when `REF` was declared on the object, so through a lookup an extension adds (`manager__c`) a misspelt leaf (`record.manager__c.daly_hours`) was accepted: a formula read null on every row, and a validation rule had no verdict and refused every save. And the regex and JSON-schema checks walked an object's own `validations` only, so an extension's `format` rule with a regex `new RegExp` throws on, or a `json_schema` rule whose schema ajv cannot compile or that names an unregistered format, was accepted and then skipped (or the format dropped) on every write: the rule protected nothing.

**Now:** the hop is judged on the object as served, a lookup an extension adds included, with the verdict a hop through a declared lookup gets (`expression-invalid`), located where the rule or formula is written (`object 'TARGET' · objectExtensions[0] · validation rule 'R' then → 'S'`, or `· field 'F' expression`); a hop through an added lookup into a stored-metadata-body table is refused as through a declared one. Each rule an extension adds, a nested `then` / `otherwise` branch included, gets the regex and JSON-schema checks with the same rule ids (`validation-rule-regex-uncompilable`, `validation-rule-json-schema-uncompilable`, `validation-rule-json-schema-unknown-format`), located at the entry: `object 'TARGET' · objectExtensions[0] · validation 'RULE'`, key path `objectExtensions[0].validations.RULE.regex` (or `.schema`). Both run at the `object_extension` door (`422 INVALID_METADATA`) as in `os build`.

**Unchanged:** the object save door and an object's own rules, formulas and hops, at the same locations; a draft save (never gated); a stored row (judged only when it is published again). A lookup two packages add at the same priority is not judged, since which definition the registry serves is registration order. At the extension door the target's own rules the door's live objects carry are judged in the gate's baseline too, so a broken rule of the target is not charged to the extension write.

**Fix:** before building or publishing again, read a field the lookup's target serves through the added lookup, and give each extension rule a regex that compiles (or a named `format`) and a schema ajv compiles, naming only registered formats, as you would on a rule declared on the same object.
