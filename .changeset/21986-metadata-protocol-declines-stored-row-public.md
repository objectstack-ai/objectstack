---
"@objectstack/metadata-protocol": minor
---

`ObjectStackProtocolImplementation.declinesStoredRow(type, name)` is now public, so a door that serves a stored row out of the layered read can ask the same decision the reads make

Clause-②: yes (widening)

- The method answers `true` for exactly the names whose stored `sys_metadata` row the active reads (`getMetaItem`, the list, and the `effective` layer of `getMetaItemLayered`) do not adopt: a flow name a managed package ships (the answer `isShippedFlowName` gives), and a datasource name the host registers from code (one an installed package declares in `*.datasource.ts`, or the host's `default`). Every other type and name answers `false`.
- The `GET /meta/:type/:name/published` doors in `@objectstack/rest` and `@objectstack/runtime` now ask this method in place of `isShippedFlowName`. A door asks it, and does not restate either half or the host's code-datasource set.
- `isShippedFlowName` stays public and unchanged.
- The only change to the public surface is this one added method. No signature, schema or accept set changes, and no behaviour of this package changes.
