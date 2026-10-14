---
'@objectstack/spec': minor
---

feat(spec)!: the page parse refuses a page component's `data` prop that names the retired view-level `api` data source, so the Studio, REST and MCP save door refuses it as `os validate` does (#23357)

**BREAKING** — a page whose `object-grid`, `object-map`, `object-gantt` or `object-tree` component carries `properties.data` with `provider: 'api'` is now refused by `PageSchema`, at the component's `properties.data.provider`, with the retirement's own prescription. Those four components take a view data source (`ViewDataSchema`) as `data`, so the step-18 retirement of the view-level `api` source reached them through the same schema; but the page parse leaves a component's `properties` an open record, and the component-props gate that refused the binding runs at the CLI doors only. A page saved through the Studio, REST or MCP therefore kept the binding, with its request headers, and the console kept sending it.

Clause-②: no (narrowing)

The judge is the retirement's own: `ViewDataSchema` parses the component's `data`, and the prescription it raises is raised by the page parse unchanged (one text for a view and a page; the page's issue `code` is `custom`, as every object-level check on `PageSchema` raises). It reaches every component under `regions` and `slots`, at any depth, a component nested in a `page:tabs` item or a container included. It judges nothing else in the bag: another `data` provider, a component whose `data` is a row array (`object-kanban`, `object-calendar`, `object-timeline`), a custom or registered type with no props row, and a component's own `dataSource` binding are untouched. `checkPageComponentViewData` is exported from `@objectstack/spec/ui`, like the four other `PageSchema` checks, so a mirror built from `PageSchema.shape` can re-attach it.

## FROM → TO

| you wrote (accepted by the page parse until this change) | write instead |
| --- | --- |
| `properties.data` with `provider: 'api'` (and its `read` / `write` request blocks) on an `object-grid`, `object-map`, `object-gantt` or `object-tree` page component | `properties.data` with `provider: 'object'` and `object: '<object_name>'`, or `provider: 'value'` with `items: [...]`; an endpoint the page must read is a page component's `dataSource: { provider: 'api', read: { url: '/api/...' }, path? }`, same-origin and with no credential key |
| `read.headers: { Authorization: '...' }` inside that binding | nothing: a credential never lives in metadata, and the console reads an element binding with its own signed-in fetch |

**The one-line fix:** bind each such component to its object or to static rows, and move any endpoint read onto a page component's `dataSource`.

**What an author who still writes it sees.** `definePage()`, `defineStack({ pages })`, `os validate` and `PUT /api/v1/meta/page/:name` refuse the page at `regions[i].components[j].properties.data.provider` (or the nested or slot position) with the prescription. At the save door that is `422 INVALID_METADATA`, nothing persisted.

**A page already stored with such a component.** `os migrate meta --stored` lists it by page and component (the step-18 entry `view-data-api-provider-retired`), and nothing rewrites it: deleting `data` would make the component query its object instead. Left as stored, the page still loads and is served, registered under `[metadata_spec_invalid]` with the refusal in the `_diagnostics` of every read, and its next save is refused with 422. The console stops sending the request when its own reader of the retired arm is deleted (objectstack-ai/objectui#12325); until then a stored page keeps sending it.

<!-- adr-0087: not-required (already-registered view-data-api-provider-retired) the step-18 entry already names the data prop of these four page components in its scope; this change makes the page parse refuse what that entry retired, and its acceptance criteria now name the page parse beside the component-props gate -->
