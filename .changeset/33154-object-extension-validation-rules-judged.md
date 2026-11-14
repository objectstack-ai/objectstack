---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): `os build` and the runtime `object_extension` publish door judge each validation rule an object extension adds by the object's own rule pass, against the extended object as served

Clause-②: no (narrowing) — `os build`, `os validate` and the `object_extension` publish door (Studio, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) now refuse an extension whose validation rule carries a `condition` or `when` the same rule on the object itself is refused for. No exported type or signature changes. Measured first-party: 0 extension entries carry a validation rule (`examples/app-showcase` one entry, three plain fields; `packages/plugins/plugin-auth` one, a `secret` field; HotCRM none), so nothing first-party is newly refused.
Metadata-protocol: narrowed
Skills-docs: none owed — this PR edits `content/docs/deployment/validating-metadata.mdx` (the object extension door paragraph names the rule pass); `skills/objectstack-data` teaches validation rules on the object and `defineObjectExtension({ extend, fields })` without saying an extension's rules are exempt, so the build and the door now give the verdict the object's own rules already get.

<!-- adr-0087: registered object-extension-validation-rule-expression-judged -->

**BREAKING** accept-set narrowing of `os build`, `os validate` and the runtime `object_extension` publish door.

**Before:** the registry merges an extension's `validations` onto its target object by name, so every save of the target runs them, but the expression rule judged only the rules an object declares. A rule an extension added with a misspelt field (`record.nmae`), an unregistered function (`sqrt(…)`) or an unguarded nullable operand was accepted by the build and published with a 200, and failed only when an end user saved a record.

**Now:** each rule an `objectExtensions` entry adds is judged by the object's own rule pass (its `condition` and `when`, every nested `then` / `otherwise` branch, the `parent` root verdict and the null-guard gate), with the same rule id `expression-invalid`, against the extended object as served (its own fields and every field an extension adds). A finding is located at the entry: `object 'crm_account' · objectExtensions[0] · validation 'no_blocked__c'`, key path `objectExtensions[0].validations[0].condition`. At the door the refusal is `422 INVALID_METADATA`, the door still runs one pass (the extension walk), and a republish is judged without the package's own stored extension, which the write replaces.

**Unchanged:** the object save door, an object's own rules, a draft save (never gated), a stored row (judged only when it is published again), and the regex and JSON-schema checks of a `format` / `json_schema` rule, which still judge an object's own rules only.

**Fix:** before building or publishing again, repair each refused rule the way you would on a rule declared on the same object: read `record.FIELD` for a field the object serves, call only registered functions, guard a nullable operand with `!= null`, and read through a reference only in the shape a declared rule may.
