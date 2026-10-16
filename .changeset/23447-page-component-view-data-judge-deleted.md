---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

feat(spec)!: `checkPageComponentViewData` is deleted; a page component's `data` prop naming the retired view-level `api` source is refused by the component-props rule alone, at the CLI doors and the metadata save door (#23447)

**BREAKING** — `checkPageComponentViewData` is no longer exported from `@objectstack/spec/ui`, and `PageSchema` no longer carries it. Since the component-props rule (`validateComponentProps`, `@objectstack/lint`) runs on a `page` write at the metadata save door, it and the page-parse check judged the same binding at the same door: one operation with two implementations. The governed side stays. The props rule parses the component's `properties` against the type's `ComponentPropsMap` row, and that row's `data` is `ViewDataSchema`, so it raises the retirement's own prescription on the same four types (`object-grid`, `object-map`, `object-gantt`, `object-tree`), at the same positions: regions, `page:tabs` items, nested containers and slots.

Clause-②: yes (narrowing)

What narrows: the published export leaves `@objectstack/spec/ui`. What `PageSchema` accepts widens by this one shape, a component `data` naming the retired provider, which the props rule then refuses at every door that runs it.

## FROM → TO

| you wrote | write instead |
| --- | --- |
| `import { checkPageComponentViewData } from '@objectstack/spec/ui'`, and `.superRefine(checkPageComponentViewData)` on a mirror built from `PageSchema.shape` | nothing on the mirror: a page component's `properties` is judged by `validateComponentProps` from `@objectstack/lint` (or `runAuthoringRules`), against the stack that carries the page |
| a page component's `properties.data` with `provider: 'api'` | unchanged from the step-18 retirement: `provider: 'object'` with `object`, or `provider: 'value'` with `items`; an endpoint read moves onto the component's `dataSource: { provider: 'api', read: { url: '/api/...' } }` |

**The one-line fix:** drop the import and the re-attachment; run the props rule where you need the verdict.

**Which doors refuse the binding now, measured:**

| door | before | after |
| --- | --- | --- |
| `definePage()`, `defineStack({ pages })`, `PageSchema.safeParse` | refused, `custom` at `…properties.data.provider` | accepted (these doors run no lint rule) |
| `os validate`, `os build` | refused inside `defineStack` | refused by the props rule: `component-props-invalid` at `pages[0].regions[0].components[0].properties.data.provider`, with the prescription |
| metadata save door (`PUT /api/v1/meta/page/:name`, the Studio, MCP) | `422 INVALID_METADATA`, spec-parse issue `custom` | `422 INVALID_METADATA`, rule `component-props-invalid` at the same component, with the prescription; nothing stored |
| boot (`loadMetaFromDb`) | `invalid: 1`, registered under `[metadata_spec_invalid]` | `invalid: 0`, registered, no warning |
| read (`getMetaItem`) | served, `_diagnostics.valid: false` with the refusal | served as stored, `_diagnostics.valid: true` |

**A page already stored with such a component** still loads and is served as stored, and no longer carries a read diagnostic for the binding; its next save is refused with 422 by the props rule. `os migrate meta --stored` still lists it under the step-18 entry `view-data-api-provider-retired`, and that entry's fate text now says so. The `@objectstack/lint` change is text only: the props rule's header named the runtime publish door as a door it does not run on.

<!-- adr-0087: not-required (already-registered view-data-api-provider-retired) the retirement this check enforced is that step-18 entry; this change deletes the second implementation of its page-component half, and the entry's acceptance criteria now name the component-props gate at the CLI doors and the save door as the one judge -->
