---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

Clause-②: no

Four more live structured keys are authorable in the metadata forms: `activityMilestones`, `publicSharing` and `userActions` on the object form, and `inlineColumns` on the field form. Each was **declared** by its schema, graded `live` by the liveness ledger, and offered by **no** form in `METADATA_FORM_REGISTRY`, so an author's only door was the Source tab. Each is now a row whose sub-rows are declared by hand rather than derived from the schema:

- `activityMilestones` (object form, Advanced, beside `validations`) — a `type: 'repeater'` over the milestone's four keys: `field` (`widget: 'text'`, required), `value` and `summary` (text, required) and `type` (text). `field` pins its widget because the console turns a string sub-row named `field` into a field picker whose catalogue an object draft never fills.
- `publicSharing` (object form, Advanced, after `requiredPermissions`) — a `type: 'composite'` over all six keys of the share-link policy: `enabled` (switch), `allowedAudiences` and `allowedPermissions` (`widget: 'multiselect'` over their enum members), `maxExpiryDays` (number, at least 1), `redactFields` (`widget: 'string-tags'`) and `eligibility` (`type: 'code'`, `language: 'expression'`).
- `userActions` (object form, Advanced, under `managedBy`) — a `type: 'composite'` over the five affordance keys. `create`, `import`, `edit` and `delete` are each a boolean **or** a `{ enabled, visibleWhen, disabledWhen }` object, so they take `widget: 'json'`: the console renders a switch for a new entry or a stored boolean, and the object's own keys for a stored object, and never writes one arm over the other. `exportCsv` is a switch.
- `inlineColumns` (field form, Configuration, beside `inlineTitle`, shown on `master_detail` fields) — a `type: 'repeater'` over a **curated subset** of the twenty keys an inline grid column accepts: `name` (required), `label`, `width` and `defaultHidden`. The metadata-form reconciliation ledger records the nested `subset` row and names what is left to source and why: `type` opts a column out of hydration from the child field, the type-specific keys cannot be gated on a type the column takes from the child field at render, and the rules are copies of the child field's own.

The help text states what the runtime does with each value, read from its consumer, and claims a refusal only where one exists. A misspelt `publicSharing.redactFields` entry is refused at publish and by `os validate`. `activityMilestones[].field`, a `{token}` in its `summary`, and `inlineColumns[].name` are judged by no authoring door, and their help texts say so and name what happens instead: the milestone never fires, the token renders empty, the column renders as plain text.

The two new repeaters' row schemas also carry a JSON Schema `title` on every property, as every repeater row schema must: the four keys of an `activityMilestones` entry, and all twenty keys of `InlineGridColumnSchema`. Each title is a `.meta({ title })` call and nothing more.

⛔ **No schema accept set moves and no export changes.** `METADATA_FORM_REGISTRY` is declared as an opaque `Readonly<Record<string, FormView>>`, so row contents were never part of the declared surface. What changes is the **form payload** `getMetaTypes()` serves (its rows, and the titles above in its JSON Schema) and the translation keys `os i18n extract` walks, hence the regenerated `platform-objects` metadata-form bundles. Their 46 new leaves are authored in `zh-CN`, `ja-JP` and `es-ES` rather than left as extractor fills.

⛔ **The gate that would notice a missing row is NOT landed here.** The reconciliation gate's top-level `zodOnly` direction stays unwired; this change lands offers and one nested ledger row only.
