---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): `os build` and the runtime `object_extension` publish door refuse a formula an object extension adds that reads its own value, itself or through another formula, as they refuse one the object declares

Clause-②: no (narrowing) — `os build`, `os validate`, `os lint` and the `object_extension` publish door (Studio, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) now refuse one shape an extension could carry before: a `formula` field an extension adds that sits on a cycle of formulas (itself, two added formulas reading each other, or a cycle closing through a formula the target declares). No exported type or signature changes. Measured first-party: 0 `objectExtensions` entries add a `formula` field (`examples/app-showcase` one entry, a `select`, a `url` and a `number` field; `packages/plugins/plugin-auth` one, a `secret` field; HotCRM none), so nothing first-party is newly refused.
Metadata-protocol: narrowed
Skills-docs: none owed — this PR edits `content/docs/deployment/validating-metadata.mdx` (the object extension paragraph names the cycle check); `skills/objectstack-formula` and `skills/objectstack-data` teach formula fields and `defineObjectExtension({ extend, fields })` without saying an extension is exempt from the cycle check, so the build and the door now give the verdict the object's own formulas already get.

<!-- adr-0087: registered object-extension-formula-cycle-refused -->

**BREAKING** accept-set narrowing of `os build`, `os validate`, `os lint` and the runtime `object_extension` publish door.

**Before:** the formula-cycle check ran on the object walk and named the object's declared formulas only. A formula an extension adds that reads itself (`a__c = record.a__c`), or two that read each other, was accepted at the build and the door; the engine never evaluated them, and they read null on every row.

**Now:** the cycle is found on the target as served (its declared fields with every kept extension's fields folded in), and each member an extension adds is refused with the object's own verdict and sentence (at the door, a name the target already serves included: the written definition is the one served) (`expression-invalid`), located at the entry: `object 'TARGET' · objectExtensions[0] · field 'FIELD' expression` (`packages[j].manifest.` prefixed in a built artifact). It runs at the `object_extension` door (`422 INVALID_METADATA`) as in `os build`.

**Unchanged:** a cycle among the object's own formulas, at the same location; a member the target declares on a cycle an extension closes keeps its location at the object, named once; a draft save (never gated); a stored row (judged only when it is published again). At the extension door a cycle among the target's own formulas, or a sibling package's, is not charged to the extension write, and a formula that only reads a cycle is not refused. In `os build` on an object the stack declares, a field two packages' extensions add at the same priority is not judged, since which definition the registry serves is registration order, so a cycle through it is not found there; on an object the stack does not declare, the later entry's definition is judged. The publish door judges the written entry's own definition of every field it adds, whatever priority another package's extension adds the same field at, so it can refuse a tie, or an entry another package outranks, that `os build` lets through.

**Fix:** before building or publishing again, break the cycle: have one formula on it read stored fields, or formulas that do not read it back.
