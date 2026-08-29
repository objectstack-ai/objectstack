---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

Author-time rejection for unknown `PageComponentSchema.type` strings inside the spec's own namespaces — the type-vocabulary half of the "Component Placeholder" gap.

`PageComponentSchema.type` is `z.union([PageComponentType, z.string()])`, and the open string arm is deliberate: custom and registered components (`object-grid`, `mcp:connect-agent`, `custom.widget`, kebab SDUI blocks) keep parsing exactly as before — nothing about the parse changed. What is new is that the spec now answers for its own namespaces (`page:` `record:` `nav:` `global:` `user:` `ai:` `app:` `element:`, derived from the enum): a type inside them that the vocabulary does not declare is refused at author time by the new gating rule `component-type-unknown` (`os validate` / `os build` / `os lint`), with the closest declared spellings suggested. Previously `global:serch` validated clean and the published page drew a literal "Component Placeholder" scaffold in front of the end user.

- `@objectstack/spec` exports the vocabulary claim from `@objectstack/spec/ui`: `RESERVED_COMPONENT_TYPE_NAMESPACES` (derived), `KNOWN_COMPONENT_TYPES` / `KNOWN_COMPONENT_TYPE_CANDIDATES`, `STRING_ARM_REGISTERED_TYPES` (the evidenced ledger of registered-but-row-less types, currently `record:line_items`), and the `hasReservedComponentNamespace` / `isKnownComponentType` predicates.
- `@objectstack/lint` ships `validateComponentTypes` (rule id `component-type-unknown`, severity `error`) on all three CLI commands; the runtime publish door is deliberately deferred pending a measured false-refusal budget over stored tenant page rows.

If a page authored a type in a reserved namespace that nothing declares, the fix is the rule's own hint: rename to the suggested declared type, or move a genuinely custom component to its own namespace (e.g. `my-plugin:widget`) so it cannot be mistaken for platform vocabulary.
