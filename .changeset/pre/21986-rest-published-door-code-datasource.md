---
"@objectstack/rest": patch
---

`GET /api/v1/meta/datasource/:name/published` serves a code-defined datasource's code definition while a stored row under its name still exists

Clause-②: no

- For a datasource name the host registers from code (one an installed package declares in `*.datasource.ts`, or the host's `default`), the published door now serves the layered read's `effective` layer, which is the code definition. Before this change it served the leftover stored `sys_metadata` row, with that row's label, `origin` and connection settings, while `GET /api/v1/meta/datasource/:name`, the `/meta/datasource` list and `/layers` all served the code definition. The door now asks the protocol's `declinesStoredRow`, the one decision those reads make, in place of `isShippedFlowName`. A shipped flow name is answered as before.
- Unchanged: a runtime datasource's stored row is still what the door serves, and so is every stored row of every other type. A protocol that does not provide `declinesStoredRow` still gets the stored row. The row itself stays at rest, `/layers` still reports it in `overlay`, and `DELETE /api/v1/meta/datasource/:name` still removes it as the repair.
