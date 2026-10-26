---
'@objectstack/rest': patch
---

perf(rest): `GET /meta/app` judges its navigation on the protocol's execution face, so it no longer schema-parses every object on each read

Clause-②: yes (widening): the exported `RestProtocol` type gains one optional member, `getMetaItemsForExecution?`. Measured on the built `dist/index.d.ts` at `cb0a2fcf` (before) and at this head (after): the export list is unchanged (67 names), and outside doc comments the one changed line is that member. Every other member signature is byte-identical. The member is optional, so nothing a protocol must provide changes.

Metadata-protocol: none

- **What.** The nav-servability gate (#24031) reads each object's `enable` to prune the nav entries whose object refuses `list`. It read them through the served `getMetaItems`, which stamps `_diagnostics` on every object, so every `/meta/app` read ran a full schema parse of every object definition. `RestServer.metaListSource` now asks `getMetaItemsForExecution` for `object` when the protocol has it (the same list, without the serving decorations) and `getMetaItems` otherwise. The batch route's exposure gate and the by-name gate's list fallback read the same source. The `book` and `doc` lists stay on the served face.
- **Measured** on the showcase app (108 objects, local, main-thread CPU per request): `GET /meta/app` 73.25 ms → 16.75 ms.
- **Unchanged.** Every `/meta` answer: the same nav prune, and `GET /meta/object` still serves `_diagnostics` on every object.
