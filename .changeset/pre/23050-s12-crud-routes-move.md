---
'@objectstack/rest': patch
---

The CRUD doors' registrar body lives in its own module, with no route, handler or answer changed

Clause-②: no (a move: the six CRUD routes, their order, every handler and every response are unchanged, and the published declarations are byte-identical)

- `RestServer#registerCrudEndpoints` keeps its name, docblock and place. The body that registers `GET`, `POST` and `POST …/query` on `{basePath}{crud.dataPrefix}/:object`, and `GET`, `PATCH` and `DELETE` on `…/:object/:id`, moved unedited to `packages/rest/src/crud-routes.ts`. The five `crud.operations` switches and `crud.dataPrefix` gate and shape the same mounts.
- Nothing to do for a consumer: no export of the package entry, no route, no configuration key and no response moved.
