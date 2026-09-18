---
"@objectstack/spec": patch
---

`$orderby` is declared twice — `ODataQuerySchema.$orderby` and `QueryTransportParamsSchema.$orderby` now cross-reference each other, and a pin holds the two accept sets apart (#18977).

Clause-②: no. No accept set moves and no export is added, removed or renamed: the change is two docblocks in published source (`src/api/odata.zod.ts`, `src/data/data-engine.zod.ts`) plus a new pin test. Measured — `check:generated` reports all 16 generated artifacts up to date, `check:api-surface` and `check:authorable-surface` included.

The two declarations are **complementary refusals**: each accepts exactly what the other rejects, and neither pointed at the other, so reading one of them carefully and completely still produced the wrong answer about the other.

| `$orderby` value | `ODataQuerySchema` | `QueryTransportParamsSchema` (`DataEngineSortSchema`) |
|:---|:---|:---|
| `'name desc'` / `'-created_at'` | accepted | REFUSED |
| `['name desc', 'email asc']` | accepted | REFUSED |
| `[{field, order}]` | REFUSED | accepted |
| `{name: 'asc'}` / `{name: 1}` | REFUSED | accepted |

- **Which one grades a query bag**: `QueryTransportParamsSchema`, reached from `FindDataRequestSchema.query` through `QueryWithTransportSchema` — the schema `POST /data/:object/query` parses its body against. `ODataQuerySchema` grades no runtime door: measured on this tree, its only consumers are the `OData.buildUrl` helper in its own file and its own unit test.
- **The refusal on the transport side is deliberate and stays** — `#18704` settled it: lowering an OData sort *expression* means PARSING, and a second parser beside the door's is how one rule gets two implementations that disagree. Widening either side to close the gap is a decision, not a tidy-up, so this change closes the **reader's** half only.
- **The string forms are not unserved.** `normalizeSortNodes` (`@objectstack/metadata-protocol`) reads `'name desc'`, `'-created_at'` and the `string[]` form at the shared ingress behind `GET /data/:object`, the export route and in-process `findData`. A querystring spelled the OData way works; the same bag sent as a `POST /data/:object/query` body answers `400 VALIDATION_FAILED`. The difference is the door, and neither door is `ODataQuerySchema`.
- **The cost this repairs was already paid.** objectui#9554 was filed, triaged, graded and dispatched against a shipped `object-grid` producer that had been sending the canonical shape all along, because the filing seat read the OData declaration and quoted it correctly.

`src/api/odata-orderby-dual-declaration.test.ts` is the mechanical half: 25 cases pinning each side's accept set, their disjointness (with the lit control that neither set is empty), and which of the two `FindDataRequestSchema.query` is graded by. Widening or narrowing either declaration turns it red and lands the author on the cross-reference.
