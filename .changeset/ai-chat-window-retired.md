---
'@objectstack/spec': minor
---

feat(spec)!: `ai:chat_window` is retired — refused by name at the schema door, the floating chat overlay is the AI chat entry point (#21504, ADR-0049)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-ai-chat-window-retired -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings (the `user:profile`, `element:filter` and `element:form` retirements shipped the same way).

`ai:chat_window` was declared in `PageComponentType` and mapped to `AIChatWindowProps` (`mode`, `agentId`, `context`, `aria`) in `ComponentPropsMap`, and no renderer for it ever shipped — not in objectui, framework or cloud. The console leaves it unregistered on purpose: the floating chat overlay it mounts on every page is the supported AI chat entry point, and an inline page-level chat window is not part of the supported surface. So an authored `ai:chat_window` node validated clean and then drew "Unknown component type" in front of an end user, and none of its four props configured anything. The triage ruling retired it under ADR-0049 enforce-or-remove, refused by name, following the `user:profile` precedent.

**What is refused:** an authored `ai:chat_window` component node, at `PageComponentSchema.type`. That covers `definePage()`, `PageSchema`, and every door that parses pages: `os validate`, `os build`, `os lint` and the metadata save door. The issue is located at the node's own path, with `code: 'custom'` and `params.retiredComponentType`, and its message is the retirement prescription. `PageComponentType`'s own error map refuses the name with the same text when the enum is parsed alone. `ComponentPropsMap['ai:chat_window']` stays as a row, so every reader that dispatches on it keeps recognising the name: the component-props gate, `check-yaml-examples` and the type vocabulary's known set. The row now refuses every props bag, `{}` included, with the same prescription. One prescription string, `RETIRED_PAGE_COMPONENT_TYPES` in `@objectstack/spec/ui`, answers at all three doors.

**What is removed from the exports:** `AIChatWindowProps` (`@objectstack/spec/ui`), the props schema the element no longer has. Its JSON Schema (`ui/AIChatWindowProps`) is no longer published.

**What stays accepted:** every other member of `PageComponentType` and `ComponentPropsMap`, byte-identically. That includes `ai:suggestion`, which keeps its row and its place in the enum, so `ai:` stays a namespace the `component-type-unknown` authoring rule claims. The open string arm also stays open: custom and plugin-registered types keep parsing. The only string refused is the retired name itself.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a `{ type: 'ai:chat_window' }` component node in a page region, slot or container | nothing: delete the node. The floating chat overlay is on every page already |
| `properties: { agentId: '…' }` on that node | the app's `defaultAgent` (a platform agent: `ask`, the default, or `build` on an authoring surface) |
| `properties: { mode, context, aria }` on that node | nothing: none of them was ever read, and the overlay is not configured per page |

The one-line fix: delete the `ai:chat_window` component node. No ADR-0087 conversion is registered, because the only edit is deleting an authored page node, and a mechanical conversion does not delete page nodes: which region closes up is a layout decision. The D3 entry `ui-ai-chat-window-retired` carries that delegation, so `os migrate meta --from 17` lists it as a manual change for every stack that still names the type.

## Who is affected, measured

- **objectstack** at `529d9711fb`: zero authored `ai:chat_window` nodes in `examples/**`, `packages/apps/**`, `apps/**`, `skills/**` and `content/docs/**` code samples. The only hits were the spec's own type list, its row, its tests and the generated reference docs. The control in the same query shape: `element:divider` is authored in 3 example files and `record:details` in 12.
- **objectui** at the `.objectui-sha` pin `89cad75d55`: no renderer is registered. `components/src/renderers/placeholders.tsx` omits the type on purpose, and Studio's page palette excludes it. The remaining hits are tests asserting its absence, the palette exclusion, a parity-ledger entry and comments. No non-test source imports `AIChatWindowProps` or indexes the row.
- **cloud** and **hotcrm** (triage's census): zero producers. hotcrm names it once, in a comment, as dropped.
- **Deployed metadata** was not measured.

The retirement kit:

- the retired-type map entry, the enum value removed (`packages/spec/src/ui/page.zod.ts`), and the row turned into a whole-bag refusal, with `AIChatWindowProps` removed (`packages/spec/src/ui/component.zod.ts`)
- the D3 semantic entry `ui-ai-chat-window-retired`, its step-18 rationale fragment, and the `RETIRED_DEFS_BY_MAJOR` entry `ui/AIChatWindowProps`
- pin tests: in `component.test.ts`, `code`, `path`, `params` and the first sentence at each of the three doors, with `ai:suggestion` as the control and the open arm left open. In `component-type-vocabulary.test.ts`, the type stays known, leaves the typo candidates, and `ai:` stays reserved. The `ComponentPropsMap` `z.unknown()` enumeration loses its `ai:chat_window` `context` line with the row's keys.
- generated baselines and docs follow the schema: `api-surface/`, `export-origins/`, `declaration-map/`, `authorable-surface/`, `authorable-defaults/`, `json-schema.manifest/`, `spec-changes.json`, the upgrade guide and the reference docs. The hand-written `content/docs/ui/pages.mdx` component list now says the truth.
