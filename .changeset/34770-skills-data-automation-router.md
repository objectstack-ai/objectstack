---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data and objectstack-automation entry files become routers

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/SKILL.md` goes from 26.6 KB to 9.0 KB and `skills/objectstack-automation/SKILL.md` from 28.2 KB to 9.0 KB. Each now holds three things: four first checks (the installed `@objectstack/spec` version, what the project already has, the type's contract, `os validate`), the traps that parse and then fail at run time, and a table that says which file to open for what you are writing. No rule's teaching changes. Text moved, and this entry says where it went. The two skills together did not grow.

**objectstack-data.** The entry keeps `Conditional Field Rules`, `Object Definition`, `Field Type Selection`, `Relationship Patterns`, `Validation Patterns` and `Access depth` under their headings, each cut to the rules that fail silently. What left:

- The object key table, the `enable` table, `Search Fields (searchableFields)` and `Object Extension Model` are in `references/examples-objects.md` (`#object-keys`, `#search-fields-searchablefields`, `#object-extension-model`).
- `Schema evolution on an existing database` is `rules/field-types.md#changing-a-field-that-has-data`. The detail of choosing a type (a box that must be checked, the seeded-row default, why a person stays optional) is `rules/field-types.md#choosing-a-type`.
- The `Conditional Field Rules` example and its bullets, and what a bare field ref does at run time, are `rules/validation.md#conditional-field-rules`.
- `Ownership queues` and the mechanics of `readScope` / `writeScope` are in `rules/security.md`.
- A handler named apart from the record owner is `rules/relationships.md#record-owner-and-other-people-on-a-record`.
- Anchors that no longer exist in `SKILL.md`: `#skill-boundaries`, `#quick-reference--detailed-rules`, `#object-capabilities-enable`, `#search-fields-searchablefields`, `#schema-evolution-on-an-existing-database`, `#common-patterns`, `#naming-rules-summary`, `#index-patterns`, `#object-extension-model`, `#security--access-control`, `#ownership-queues--park-a-record-for-a-team-to-claim`, `#verify-your-work`, `#references`. `#conditional-field-rules`, `#object-definition`, `#field-type-selection`, `#relationship-patterns` and `#validation-patterns` still do.

**objectstack-automation.** The entry keeps `Data Operations`, `External Integration`, `notify`, `Failure routing & runAs`, `Filter operands (config.filter)`, `Valid-but-silently-wrong (passes build, fails at runtime)` and `Integrations are declared, not coded` under their headings, each cut to the rules that fail silently, plus one paragraph on declaring a trigger on the start node. What left:

- `references/examples-flows.md` now also holds `Flow Types`, packaged flows (`.custom` overrides, `defaultActive`), the control-flow node table, the detail of the `http`, `connector_action` and `screen` nodes, `Flow Variables`, `Triggers` (the `requires` tokens, the trigger types) and `Assignment rules`. For `notify`, failure routing and `runAs`, filter operands and value slots, a section titled "the rest" holds what the entry's section no longer says.
- `references/integration-recipes.md` now also holds `Inbound webhook (api) triggers` and the list of cases that are platform code.
- Anchors that no longer exist in `SKILL.md`: `#when-to-use-this-skill`, `#flows--visual-logic-orchestration` (now `#flows`), `#flow-types`, `#control-flow`, `#human-decision`, `#flow-variables`, `#assignment-rules--route-a-new-record-to-a-queue-or-a-person`, `#triggers--event-driven-automation` and its four subsections, `#verify-your-work`, `#references`.

**Not carried over, because the contract or a check already says it.** From objectstack-data: the `label`, `datasource`, `displayNameField`, `trackHistory`, `searchable`, `apiEnabled`, `files` and `clone` rows (their defaults are in `data/object.zod.ts`, which the entry's third check points at), the `titleFormat` row (a save and `os validate` refuse the key by name), the four-row `sharingModel` table (the four values are one bullet of `Object Definition`), and the sections that only listed the other files (`Skill Boundaries`, the rules list, `Naming Rules Summary`, `Index Patterns`).

**One correction.** The multi-value lookup note in objectstack-data showed a `{record.tags.0}` token "in flow values". A flow value slot refuses that token, as objectstack-automation teaches. The note, now in `rules/relationships.md`, shows the CEL spelling `record.tags[0]`.
