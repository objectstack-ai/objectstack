---
'@objectstack/spec': minor
---

feat(spec)!: a page component's `data` prop that names the retired view-level `api` data source is refused at the Studio, REST and MCP save door as `os validate` refuses it (#23357)

**BREAKING** — a page whose `object-grid`, `object-map`, `object-gantt` or `object-tree` component carries `properties.data` with `provider: 'api'` is refused at the component's `properties.data.provider`, with the retirement's own prescription, by the component-props gate (`validateComponentProps`, `@objectstack/lint`, rule `component-props-invalid`) at `os validate`, `os build`, `os lint` and the metadata save door. Those four components take a view data source (`ViewDataSchema`) as `data`, so the step-18 retirement of the view-level `api` source reached them through the same schema. The page parse leaves a component's `properties` an open record, and before 18 the component-props gate ran at the CLI doors only, so a page saved through the Studio, REST or MCP kept the binding, with its request headers, and the console kept sending it.

Clause-②: yes (narrowing)

The judge is the retirement's own: the component's `ComponentPropsMap` row parses its `data` with `ViewDataSchema`, and the finding carries that schema's prescription unchanged, one text for a view and a page. It reaches every component under `regions` and `slots`, at any depth, a component nested in a `page:tabs` item or a container included. Only those four types meet this prescription: a component whose `data` is a row array (`object-kanban`, `object-calendar`, `object-timeline`) is judged by its own row and refused for its shape, a custom or registered type with no props row is not judged, and a component's own `dataSource` binding is untouched.

## FROM → TO

| you wrote (saved by the Studio, REST and MCP door before 18) | write instead |
| --- | --- |
| `properties.data` with `provider: 'api'` (and its `read` / `write` request blocks) on an `object-grid`, `object-map`, `object-gantt` or `object-tree` page component | `properties.data` with `provider: 'object'` and `object: '<object_name>'`, or `provider: 'value'` with `items: [...]`; an endpoint the page must read is a page component's `dataSource: { provider: 'api', read: { url: '/api/...' }, path? }`, same-origin and with no credential key |
| `read.headers: { Authorization: '...' }` inside that binding | nothing: a credential never lives in metadata, and the console reads an element binding with its own signed-in fetch |

**The one-line fix:** bind each such component to its object or to static rows, and move any endpoint read onto a page component's `dataSource`.

**What an author who still writes it sees.** `os validate`, `os build`, `os lint` and `PUT /api/v1/meta/page/:name` refuse the page at `pages[i].regions[j].components[k].properties.data.provider` (or the nested or slot position), rule `component-props-invalid`, with the prescription. At the save door that is `422 INVALID_METADATA`, nothing persisted. `definePage()` and `defineStack({ pages })` run no authoring rule and accept the page.

**A page already stored with such a component.** `os migrate meta --stored` lists it by page and component (the step-18 entry `view-data-api-provider-retired`), and nothing rewrites it: deleting `data` would make the component query its object instead. Left as stored, the page still loads and is served as stored, with no read diagnostic for the binding, and its next save is refused with 422 by the component-props gate. The console no longer reads the retired arm (objectstack-ai/objectui#12325), so a stored page does not send the request.

<!-- adr-0087: not-required (already-registered view-data-api-provider-retired) the step-18 entry already names the data prop of these four page components in its scope; the component-props gate refuses what that entry retired at the CLI doors and the save door, and its acceptance criteria name that gate -->
