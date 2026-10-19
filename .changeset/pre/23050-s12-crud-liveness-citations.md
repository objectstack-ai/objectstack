---
'@objectstack/spec': patch
---

The liveness ledger's CRUD rows cite the code that reads their keys where it now lives

Clause-②: no (only the rows' evidence paths move and every status stays `live`: `CrudEndpointsConfigSchema` accepts `operations.*` and `dataPrefix` exactly as before, and no state count moves)

- `liveness/crud_endpoints.json`: the five `operations.*` rows and the `dataPrefix` row cited `packages/rest/src/rest-server.ts#registerCrudEndpoints` for the code that gates and prefixes the CRUD mounts. `@objectstack/rest` moved that registrar's body to `packages/rest/src/crud-routes.ts` with no behaviour change, so those six path references follow it.
- The quoted code, the producers, the verdicts and the notes are unchanged.
