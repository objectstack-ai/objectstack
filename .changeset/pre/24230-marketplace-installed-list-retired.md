---
'@objectstack/spec': minor
---

feat(spec)!: `marketplace:installed-list` is retired — refused by name at the schema door; the separate Installed Apps view it drew was retired, and Setup → Packages filtered to Source = marketplace replaces it (#24230, ADR-0049)

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-marketplace-installed-list-retired -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings (the `user:profile`, `element:filter`, `element:form`, `ai:chat_window` and `record:json` retirements shipped the same way).

`marketplace:installed-list` was the plugin console widget that drew the separate Installed Apps view. It was published in 17.3.0 with an empty `ComponentPropsMap` row and was never a `PageComponentType` member: it reached the page schema through the type union's open string arm. The separate view was then retired, because Setup → Packages carries the same packages and their actions behind a Source = marketplace filter. The widget's one page, `marketplace_installed`, had already left `@objectstack/cloud-connection`, whose "Installed Apps" navigation entry opens the filtered Packages view instead, and the console deleted the widget's one renderer. After that, an authored node validated clean and then drew "Unknown component type" in front of a user. A declared element nothing draws is a capability claim nothing keeps, so it is retired under ADR-0049 enforce-or-remove and refused by name, the `ai:chat_window` way.

**What is refused:** an authored `marketplace:installed-list` component node, at `PageComponentSchema.type`. That covers `definePage()`, `PageSchema`, and every door that parses pages: `os validate`, `os build`, `os lint` and the metadata save door. The issue is located at the node's own path, with `code: 'custom'` and `params.retiredComponentType`, and its message is the retirement prescription. `ComponentPropsMap['marketplace:installed-list']` stays as a row, because for a type outside the enum the row is the only thing that keeps the name known to the component-props gate, `check-yaml-examples` and the type vocabulary. The row now refuses every props bag, `{}` included, with the same prescription. One prescription string, `RETIRED_PAGE_COMPONENT_TYPES` in `@objectstack/spec/ui`, answers at every door. The authoring rule `component-type-unknown` reports the node by name, and the typo suggester no longer offers it.

**What else moves:** its print classification row (`PRINT_REFUSED_PAGE_COMPONENT_TYPES`) leaves with it, because a retired type is refused at the parse before any print rule reads it. The D3 entry `ui-cloud-connection-widgets-unknown-keys-refused`, which closed this type's props bag to `{}` in the same major, now speaks for `cloud-connection:panel` alone, so the upgrade guide no longer tells an upgrader to keep a node that is refused. No export is removed: the row was built by the `emptyProps` factory, which exports no def, so no JSON Schema leaves the published set.

**What stays accepted:** every other `ComponentPropsMap` row, byte-identically, including the sibling console widgets `cloud-connection:panel` and `mcp:connect-agent`. The open string arm also stays open: custom and plugin-registered types keep parsing, the `marketplace:` namespace included. The only string refused is the retired name itself.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a `{ type: 'marketplace:installed-list' }` component node in a page region, slot or container | nothing: delete the node. The Installed Apps list is Setup → Packages filtered to Source = marketplace |
| a page whose only job was to show that list | a navigation item `{ type: 'component', componentRef: 'developer:packages', params: { source: 'marketplace' } }`, which is what `@objectstack/cloud-connection`'s own "Installed Apps" entry does |

The one-line fix: delete the `marketplace:installed-list` component node, and link to the filtered Packages view if users need to reach it. No ADR-0087 conversion is registered, because the only edit is deleting an authored page node, and a mechanical conversion does not delete page nodes: which region closes up is a layout decision. The D3 entry `ui-marketplace-installed-list-retired` carries that delegation, so `os migrate meta --from 17` lists it as a manual change for every stack that still names the type.

## Who is affected, measured

- **objectstack** at `cbfa5e4335`: zero authored `marketplace:installed-list` nodes in shipped metadata. `@objectstack/cloud-connection` serves no page for it, and its pin test asserts that. The other hits were the spec's own row, print row and docblocks, its tests, two lint pins, one synthetic test fixture in `packages/cli` (now a live block) and the release-owned changelogs. A tree-scoped absence pin now holds that zero.
- **objectui** at the console pin `.objectui-sha` `5e15928b46`: the type is registered by string only, with no typed read of `ComponentPropsMap['marketplace:installed-list']`. The row's key is kept, so the console build at the pin is unaffected. objectui `main` has deleted the renderer.
- **Deployed metadata** was not measured.

The retirement kit:

- the retired-type map entry and the print classification row removed (`packages/spec/src/ui/page.zod.ts`), the row turned into a whole-bag refusal (`packages/spec/src/ui/component.zod.ts`), and the vocabulary docblock updated (`component-type-vocabulary.ts`)
- the D3 semantic entry `ui-marketplace-installed-list-retired` and its step-18 rationale fragment; the D3 entries `ui-cloud-connection-widgets-unknown-keys-refused` (narrowed to `cloud-connection:panel`) and `ui-mcp-connect-agent-unknown-keys-refused` (one clause) amended
- pin tests: `component-marketplace-installed-list-retirement.test.ts` pins `code`, `path`, `params` and the first sentence at each door (the map, the row with empty and keyed bags, `PageComponentSchema`, `PageSchema` at the element path), the absence from the enum and the print rows, the D3 registration and the narrowed sibling entry, with `cloud-connection:panel` as the live control, plus a tree-scoped absence walk; `component-type-vocabulary.test.ts` pins the type known only through its row, out of the typo candidates, and `marketplace:` still unreserved; the lint accept pins in `validate-component-types.test.ts` and `validate-component-props.test.ts` are flipped into refusal pins
- generated docs follow the schema: the reference page for `ui/page`, `spec-changes.json` and the upgrade guide
