---
'@objectstack/metadata-protocol': minor
---

feat(metadata-protocol)!: the save door refuses a tenant's copy of a packaged validation rule that changes the rule's condition, type or any other key the package owns (#28448)

Clause-②: no (narrowing) — an `object` publish that carries a same-named copy of a validation rule a code layer ships (the packaged owner's or an extension's), and changes anything but the copy's `message` and `active`, is now refused with `422 INVALID_METADATA`. The same publish was stored before, and the fold ran the package's rule instead of the copy's.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row needs rewriting: a copy stored before this change keeps loading, reported once at load, and the package's rule runs for it, as the registry fold already did. Only a new write of such a copy is refused, and its refusal carries the prescription. -->

**BREAKING** for a tenant save that changes a packaged validation rule (ADR-0029 D9.2a, 2026-10-30 note; ruling of record 6524229156, letter C′, and ruling of record 6545641964, letter B, which puts this refusal at the save door).

- **Before.** The registry fold ran the package's rule with the tenant copy's `message` and `active`, and said once at load (`validation_rule_copy_changed`) that the copy's condition does not run. The save that stored the copy answered success, so the admin who changed the condition was never told.
- **Now.** The runtime authoring gate asks the registry's own predicate, `SchemaRegistry.tenantRuleCopyRefusal`, the one the load report reads. A publish of a copy that changes a package-owned key is refused with one issue, rule `validation-rule-copy-changed`, located at the copy's first changed key (for example `validations[1].condition`), with the prescription: "To change the condition, add a rule under a new name, or change it in the package." Nothing is written.
- **Still saved.** A copy that changes only `message` (a reword) or `active` (`active: false` switches the rule off). A rule under a new name, which stays additive. A draft save, which no gate rule refuses; publishing it is judged.
- **Who sees it.** An admin who edits a packaged or extension rule's condition or type in Studio, or an author doing the same through the metadata API of a runtime: the save now answers with the refusal instead of storing a copy that never runs. To keep a different condition, add it as a rule under a new name.
