---
'@objectstack/spec': minor
---

feat(spec)!: an object extension's `fieldPatches` is keyed by the field map's own key grammar, so a key no field name can be is refused where it is written

`ObjectExtensionSchema.fieldPatches` (ADR-0146 D10) was keyed by any string. A field patch addresses one of the extended object's own fields by name, and every field name is lowercase snake_case, so a key such as `Industry` or `Annual Revenue` could never match a field. It still parsed, and was refused only downstream, where the target judge reaches.

Clause-②: no (narrowing) — `ObjectExtensionSchema` refuses a `fieldPatches` key outside the snake_case grammar of an object's `fields` keys, which it accepted. Nothing is widened, and no public export is added.

Metadata-protocol: narrowed (an object extension may no longer key a field patch by anything but a field name)

Skills-docs: updated here — `content/docs/data-modeling/object-extensions.mdx` ("A patch must name something real") gains the key grammar. `skills/objectstack-data/SKILL.md` keys its `fieldPatches` example by `industry`, so every taught line stays true and no skill line changes.

<!-- adr-0087: registered object-extension-field-patch-key-grammar-refused -->

**BREAKING** accept-set narrowing on `ObjectExtensionSchema` (`@objectstack/spec`), at every door that parses an object extension: `defineObjectExtension`, `defineStack({ objectExtensions })`, `os validate`, the marketplace install and the `/api/v1/meta` `object_extension` save door.

- **Before.** `fieldPatches: { Industry: { label: 'Sector' } }` parsed in `defineStack`, was stored by the save door and booted: the registry fold named the patch once in the log and applied nothing, and `os validate` refused it only when the target object was in the same stack.
- **Now.** One `invalid_key` issue at `fieldPatches.Industry`, naming the grammar and an example. The key schema is the one `ObjectSchema.fields` reads, hoisted to one constant, so the two cannot drift.
- **Unchanged.** A snake_case key parses as before, and a `__c` key is still refused by the `__c` rule with its own prescription.
- **Who sees it.** No extension in this repository's examples, skills, docs or templates writes such a key. A stored `object_extension` row that carries one no longer parses, so the sync names the row (`INVALID_METADATA`) and registers none of it, its `fields` included; its next save is refused until the key is renamed. `os migrate meta --stored` does not list such a row beforehand: the stored pass has no stack collection for an `object_extension` row and hands it back untouched, so check each stored extension's `fieldPatches` keys against the grammar before upgrading.

**FROM → TO.** `fieldPatches: { Industry: { label: 'Sector' } }` → `fieldPatches: { industry: { label: 'Sector' } }`: key each patch by the name of the field the extended object declares (the key of its `fields` entry), never by its label. The upgrade guide entry is `object-extension-field-patch-key-grammar-refused`.
