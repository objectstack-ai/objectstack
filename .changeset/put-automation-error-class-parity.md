---
'@objectstack/runtime': patch
---

`PUT /api/v1/automation/:name` answers 400 `VALIDATION_FAILED`, not 500, for a malformed flow definition — matching `POST /api/v1/automation` (#8123)

#8055 reclassified `POST /`'s `registerFlow` refusal from 500 `INTERNAL_ERROR` to 400 `VALIDATION_FAILED`. `PUT /:name` makes the identical `registerFlow` call in the same file and was left uncaught, so the two doors disagreed about the class of an identical refusal: publishing a flow through update got a different answer than publishing through create, for the same broken definition.

`PUT /:name` now routes its `registerFlow` call through the same `flowDefinitionRefusal` helper `POST /` uses, so both doors answer the same `code`, `status`, and `details.fields[]` shape for the same malformed body — including the #4277 self-correcting undeclared-config-key message, which survives verbatim.

**Which bodies are refused is unchanged** on both routes — a definition that registered before still registers, and every one that was refused is still refused, with the engine's own message intact.
