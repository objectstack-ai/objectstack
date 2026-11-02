---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol)!: an `object_extension` item's refusals fit the item door, and an extension names its target by the key the object is registered under (#28834)

Clause-②: no (narrowing) — the save, publish and restore doors refuse an `object_extension` whose `extend` is a short name the registry folds to a different, legacy `<ns>__<name>` key, which they admitted before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. One spelling of an existing key's value is refused at the item doors, with a sentence naming the key the object is registered under; a manifest's objectExtensions and stored rows at rest are untouched, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the `object_extension` item doors (`@objectstack/metadata-protocol`).

- **Before.** `getObject` resolves a short name to a legacy `<ns>__<name>` key (a key `computeFQN` no longer produces, so only an object whose name carries `__` has one). The gate checked that the target resolved, and the registry then filed the extension under the short name it was written with: a second, phantom object beside the real one.
- **Now.** The gate refuses that write with `VALIDATION_ERROR` / 400 on `extend`, and the sentence names both spellings. Save the extension under the key the object is registered as, with `extend` set to it.
- **Who sees it.** No one measured: no manifest or object in this repository or in `hotcrm` has a `__` key, the item door itself landed one change earlier (#28574), and the boot hydration does not run this gate, so a stored row of that spelling is not refused at rest.

Two refusal sentences change wording. Their rule, code and status stay (`NOT_OVERRIDABLE` / 403):

- An `object_extension` carrying `overrides` is told an extension takes no override and is stored under the name of the object it extends, so the fix is to edit the extension itself. It is no longer told to create one "under a new name".
- An `object` carrying `overrides` is told both places an extension is written: an `object_extension` item saved through `/api/v1/meta/object_extension`, or an `objectExtensions` entry of the pair's manifest.

Every other type's override sentence is unchanged.
