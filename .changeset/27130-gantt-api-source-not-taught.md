---
'@object-ui/plugin-gantt': patch
---

docs(plugin-gantt): the `object-gantt` registration no longer teaches the retired view-level `api` source

Clause-②: no
Metadata-protocol: none

- **Before.** The `data` input said `{ provider: 'api', read }` "reads through that request", and the `filter` input listed "an `api` request" among the record sources the gantt reads. The spec refuses that provider by name and the gantt has no reader for it: a gantt carrying it requests neither URL.
- **Now.** `data` names the two providers the gantt reads, `{ provider: 'value', items }` and `{ provider: 'object', object }`, and says that rows a server computes reach the gantt as an object whose plugin driver computes them, never as a request URL in the view. `filter` names the object and inline rows.
- **Unchanged.** Text only: no input, schema, renderer behaviour or export moves. The page element's `dataSource: { provider: 'api', read, path? }` binding is a different door and is untouched.
