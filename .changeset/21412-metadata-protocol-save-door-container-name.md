---
'@objectstack/metadata-protocol': minor
---

The runtime save door refuses a view container whose own `name` disagrees with the name it is saved under

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at one door over an existing key: `ViewSchema.name` is not removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. Which of the two names a divergent container meant (the body's, or the one it was saved under) is authoring intent no conversion entry can decide. New saves are refused with the remedy; a row stored before this change keeps its bytes. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered); and the change narrows what a runtime write door accepts, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing at the runtime save door, shipped as `minor` under the repo's launch-window convention for breaking changes, the grade the ObjectQL boot loop's refusal of the same divergence shipped with.

**What was accepted before.** `saveMetaItem`, which `PUT /api/v1/meta/view/:name` and the dispatcher's metadata save both call, accepted an aggregated view container (`list` / `form` / `listViews` / `formViews`) whose body carried a `name` different from the name it was saved under. It stored the row under the save name and registered the container under the body's `name`, so one document answered under two names. The source registrars (the ObjectQL boot loop and the artifact/HMR loader) and `os validate` already refused a container whose `name` disagrees with the key they file it under.

**What is refused now.** That body, with `VALIDATION_ERROR` / 400, before anything is stored or registered, through the same judge the source registrars call (`@objectstack/metadata/view-container-name`). The key judged here is the save name: a container saved under a name other than the object it binds to still saves, and so does the body the door stores for it when it is read and sent back.

**The fix.** Drop the body's `name` (the door stamps the save name), or set it to the name the container is saved under.

A standalone view record (`viewKind`) and every other metadata type are judged too, by the same release's every-type refusal at the save, restore and publish doors (its own entry).
