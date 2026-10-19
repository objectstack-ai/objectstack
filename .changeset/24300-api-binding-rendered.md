---
'@objectstack/spec': patch
---

A page element's `api` data source is described as rendered, and `visibleWhen` says where `data` is mounted

Clause-②: no (describe and TSDoc text only: `ElementApiDataSourceSchema` and `PageComponentSchema` accept exactly what they accepted before, and every refusal keeps its issue `code` and `path`)

- `ElementApiDataSourceSchema`'s describe dropped its `[PLANNED — not yet rendered]` marker. It now says what the console renders: the console reads the binding on every page element and binds the value `path` selects as `data`, on that element and on every element nested inside it. The element's `visibleWhen` is decided once the read answers. While the read is in flight, or when the binding is refused or the read fails, the element draws a loading or error panel instead.
- `PageComponentSchema.visibleWhen` (its describe and its TSDoc) no longer says that no renderer reads the binding. The renderer mounts no `data` root on an element that no `api` data source binds, where a `data.*` read still faults and the gate never gates. On an element that one binds, `data` is the bound value.
- The binding's refusal and unknown-key messages no longer name a page element. For example, "`read.url` of a page element's `api` data source must be …" now reads "`read.url` of an `api` data source must be …", and the unknown-key surface is "this `api` data source". The `object` guidance names the object binding only where the `dataSource` takes one. Each message keeps its issue `code` and `path`.
