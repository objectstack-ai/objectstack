---
'@objectstack/spec': minor
---

feat(spec)!: `record:json` is retired — refused by name at the schema door; the approval request page's raw JSON panel it was declared for was dropped (#24162, ADR-0049)

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-record-json-retired -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings (the `user:profile`, `element:filter`, `element:form` and `ai:chat_window` retirements shipped the same way).

`record:json` was added to `PageComponentType` in `18.0.0-next.3`, with a strict `ComponentPropsMap` row, `RecordJsonProps` (`field`, `label`, `requiredPermissions`). It was declared spec first for one face: the approval request page's raw JSON panel. The maintainer then dropped that panel — the person deciding an approval has no business need to read the request as JSON — so no renderer was built and no page placed the type: zero consumers in objectstack and objectui, and its one planned producer was closed unmerged. A declared element that nothing draws is a capability claim nothing keeps, so it is retired under ADR-0049 enforce-or-remove, refused by name, the `ai:chat_window` way. The `18.0.0-next.3` entry below records what that prerelease shipped; this entry is its retirement.

**What is refused:** an authored `record:json` component node, at `PageComponentSchema.type`. That covers `definePage()`, `PageSchema`, and every door that parses pages: `os validate`, `os build`, `os lint` and the metadata save door. The issue is located at the node's own path, with `code: 'custom'` and `params.retiredComponentType`, and its message is the retirement prescription. `PageComponentType`'s own error map refuses the name with the same text when the enum is parsed alone. `ComponentPropsMap['record:json']` stays as a row, so every reader that dispatches on it keeps recognising the name: the component-props gate, `check-yaml-examples` and the type vocabulary's known set. The row now refuses every props bag, `{}` included, with the same prescription. One prescription string, `RETIRED_PAGE_COMPONENT_TYPES` in `@objectstack/spec/ui`, answers at all three doors. The authoring rule `component-type-unknown` reports the node by name, and stops suggesting `record:json` for a misspelling in the `record:` namespace.

**What is removed from the exports:** `RecordJsonProps` (`@objectstack/spec/ui`), the props schema the element no longer has. Its JSON Schema (`ui/RecordJsonProps`) is no longer published. Its print classification row (`PRINT_REFUSED_PAGE_COMPONENT_TYPES`) leaves with it: a retired type is refused at the parse before any print rule reads it.

**What stays accepted:** every other member of `PageComponentType` and `ComponentPropsMap`, byte-identically, including the four record blocks' own `requiredPermissions` gate, which `record:json` never changed. The open string arm also stays open: custom and plugin-registered types keep parsing. The only string refused is the retired name itself.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a `{ type: 'record:json' }` component node in a page region, slot or container | nothing: delete the node. No replacement panel exists, by ruling |
| `properties: { field, label, requiredPermissions }` on that node | nothing: none of them was ever read |

The one-line fix: delete the `record:json` component node. No ADR-0087 conversion is registered, because the only edit is deleting an authored page node, and a mechanical conversion does not delete page nodes: which region closes up is a layout decision. The D3 entry `ui-record-json-retired` carries that delegation, so `os migrate meta --from 17` lists it as a manual change for every stack that still names the type.

## Who is affected, measured

- **objectstack** at `eda6f14b7b`: zero authored `record:json` nodes in `examples/**`, `packages/apps/**`, `apps/**`, `skills/**` and `content/docs/**` code samples. The only hits were the spec's own type list, row and print row, its tests, the lint accept pin and the generated reference docs. A tree-scoped absence pin now holds that zero.
- **objectui** `main`: zero hits (the card's census); the `.objectui-sha` pin is not moved.
- **Deployed metadata** was not measured; the type was published in one prerelease only.

The retirement kit:

- the retired-type map entry and the enum value removed (`packages/spec/src/ui/page.zod.ts`), its print classification row removed, and the row turned into a whole-bag refusal, with `RecordJsonProps` removed (`packages/spec/src/ui/component.zod.ts`)
- the D3 semantic entry `ui-record-json-retired`, its step-18 rationale fragment, and the `RETIRED_DEFS_BY_MAJOR` entry `ui/RecordJsonProps`
- pin tests: `component-record-json-retirement.test.ts` pins `code`, `path`, `params` and the first sentence at each door (the map, the row with empty and populated bags, `PageComponentSchema`, `PageSchema` at the element path, the enum error map), with `record:approvals` as the live control, plus a tree-scoped absence walk; `component-type-vocabulary.test.ts` pins the type known, out of the typo candidates, and `record:` still reserved; the lint accept pin `validate-record-json-23745.test.ts` is flipped into a refusal pin at both lint rules and the shared pipeline
- generated baselines and docs follow the schema: `api-surface/`, `export-origins/`, `declaration-map/`, `authorable-surface/`, `json-schema.manifest/`, the strictness-ledger counts, `spec-changes.json`, the upgrade guide and the reference docs
