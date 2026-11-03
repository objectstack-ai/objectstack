---
'@objectstack/spec': minor
---

feat(spec)!: an object extension's `fields` is keyed by the field map's own key grammar, so a field no object could declare is refused where it is written

`ObjectExtensionSchema.fields` was keyed by any string. The fields an extension adds are merged into the target object's field map, and every key of that map is lowercase snake_case: `ObjectSchema.fields` refuses any other. So an extension could add a field under a key (`Region Code`, `region-code`) that the target's own declaration could never hold.

Clause-②: no (narrowing) — `ObjectExtensionSchema` refuses a `fields` key outside the snake_case grammar of an object's `fields` keys, which it accepted. Nothing is widened, and no public export is added.

Metadata-protocol: narrowed (an object extension may no longer add a field under anything but a snake_case field name)

Skills-docs: updated here — `content/docs/data-modeling/object-extensions.mdx` ("Naming the fields you add") gains the key grammar. `skills/objectstack-data/SKILL.md` and its evals teach extension fields only as `region__c`, so every taught line stays true and no skill line changes.

<!-- adr-0087: registered object-extension-field-key-grammar-refused -->

**BREAKING** accept-set narrowing on `ObjectExtensionSchema` (`@objectstack/spec`), at every door that parses an object extension: `defineObjectExtension`, `defineStack({ objectExtensions })`, `os validate`, the marketplace install and the `/api/v1/meta` `object_extension` save door.

- **Before.** `fields: { 'Region Code': { type: 'text', label: 'Region' } }` parsed in `defineStack`, whether or not the target was in the same stack, and `os validate` raised nothing on it. In a `.custom` package, `fields: { 'Region Code__c': … }` was saved and published by the `object_extension` doors, served on every object read, re-registered at boot, and stored values in a column of that name.
- **Now.** One `invalid_key` issue at `fields.Region Code`, naming the grammar and an example. The key schema is the one `ObjectSchema.fields` and `fieldPatches` read, one constant, so the three cannot drift.
- **Unchanged.** A snake_case key parses as before, `__c` included (`region_code__c`); where the `__c` suffix is required or refused is still judged by the doors' `__c` rule.
- **Who sees it.** No extension in this repository's examples, skills, docs or templates writes such a key. A stored `object_extension` row that carries one no longer parses, so the sync that registers stored extensions counts it as an error and registers none of it, its `fieldPatches` included, and its next save is refused (422 `INVALID_METADATA`) until the field is renamed. `os migrate meta --stored` lists such a row beforehand, one TODO for each refused key at `fields.KEY`, and leaves it as stored for its owner to rename.

**FROM → TO.** `fields: { 'Region Code': { type: 'text', label: 'Region Code' } }` → `fields: { region_code: { type: 'text', label: 'Region Code' } }` (`region_code__c` in a customization package): key each added field by a lowercase snake_case name, and keep the display text in its `label`. Renaming a field that already stores values also means renaming every view, formula and caller that reads it. The upgrade guide entry is `object-extension-field-key-grammar-refused`.
