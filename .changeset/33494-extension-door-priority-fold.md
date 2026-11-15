---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

fix(lint, metadata-protocol): the `object_extension` publish door folds the written entry among the other packages' extensions of its target by priority, so it judges the field definition `os build` judges

Clause-②: no (narrowing) — at the runtime `object_extension` publish door (Studio, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) the expression rule now reads each field of the target as `os build` serves it when another package's published extension adds the same field: one write it accepted is now refused (a higher-priority package's definition of a field the written entry also adds closes a formula cycle through another field of the entry), and two it refused now publish (the written entry ties with another package on that field, or another package outranks it there). `os build` is unchanged. The new gate input (`storedObjectExtensions` on `runRuntimeAuthoringRules` and `evaluateRuntimeAuthoringGate`, the `StoredObjectExtension` type from `@objectstack/lint/runtime`) is optional. Measured first-party exposure: no two first-party packages extend the same object (`examples/app-showcase` one entry on `showcase_account`, `packages/plugins/plugin-auth` one on `sys_sso_provider`, HotCRM `origin/main` 2492ac6 one module, o2c, extending `crm_contract` and `crm_account`), so no first-party write changes verdict.
Metadata-protocol: narrowed
Skills-docs: none owed — this PR edits `content/docs/deployment/validating-metadata.mdx` (the object extension paragraph states the door's fold); the skills teach `defineObjectExtension({ extend, fields, priority })` and formula fields, and say nothing of how the door read a field two packages add.

<!-- adr-0087: not-required (already-registered object-extension-formula-cycle-refused) the unreleased entry this PR updates states the door's fold and covers each changed shape -->

**BREAKING** accept-set change of the runtime `object_extension` publish door (narrowing in one shape, widening in two).

**Before:** the door's target carried every other package's extension field as a plain field with no package and no priority, and the gate folded the written entry over it, so the door judged the written entry's own definition of every field it adds. A self-reading formula the written entry adds under a field another package adds at the same priority, or at a higher one, was refused although `os build` accepts it; and a higher-priority package's formula closing a cycle through another field of the written entry was not seen, although `os build` refuses it.

**Now:** the host states the target's other packages' published extensions (each with its package, priority and fields; a disabled package's left out), and the gate folds the written entry among them by priority through the build's own fold (`objectsAsServed`). The door judges the definition `os build` judges: the written entry's where its priority decides the field, another package's where that one outranks it, and none where two packages add it at the priority that decides it. This corrects the `@objectstack/lint` 33153 note's **Now** clause "(at the door, a name the target already serves included: the written definition is the one served)" and its **Unchanged** sentence "The publish door judges the written entry's own definition of every field it adds, whatever priority another package's extension adds the same field at, so it can refuse a tie, or an entry another package outranks, that `os build` lets through": the written definition is the one judged where the written entry's priority decides the field, and the door no longer refuses a tie or an outranked entry that `os build` accepts. Where that note says "at the same priority", read "at the priority that decides it".

**Unchanged:** `os build`, `os validate` and `os lint`; a write the door judges with no other package extending the same field; a host that states no extensions (the written entry is folded over the target as served); a draft save (never gated).

**Fix:** a write refused for the new shape: break the cycle, so the formula the entry adds does not read a field that another package's higher-priority formula computes from it, or rename the entry's field so it is not outranked.
