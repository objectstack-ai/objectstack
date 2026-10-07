---
"@objectstack/runtime": patch
---

The runtime dispatcher's `GET /meta/datasource/:name/published` serves a code-defined datasource's code definition while a stored row under its name still exists

Clause-②: no

- This is the dispatcher twin of the `@objectstack/rest` published door, and it now answers the same way. For a datasource name the host registers from code (one an installed package declares in `*.datasource.ts`, or the host's `default`), the door serves the layered read's `effective` layer, which is the code definition, instead of the leftover stored row. It asks the protocol's `declinesStoredRow` in place of `isShippedFlowName`. A shipped flow name is answered as before.
- Unchanged: a runtime datasource's stored row, and every stored row of every other type, is served as before. So is every row when the protocol does not provide `declinesStoredRow`.
