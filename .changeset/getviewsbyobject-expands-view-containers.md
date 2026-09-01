---
"@objectstack/metadata": patch
---

fix(metadata): `getViewsByObject()` expands aggregated view containers instead of answering empty (#13913)

`MetadataManager.getViewsByObject()` reads `this.list('view')` — the manager's
own registry + loader store, which is a completely different store from the
`sys_metadata` rows the REST route (`GET /meta/view?object=`) reads through
`getMetaItems`. #13407 taught that route to expand a runtime-authored aggregated
`defineView` container inline; this exit never called it and had no equivalent
step, so a container the REST route now serves still answered **empty** here —
for every internal/SDK caller that uses this entry point rather than the route.

Getting the container into the store was never enough on its own: the filter
also requires `viewKind`, and a container has none. Relaxing that requirement
would answer with the container itself as a view — the behaviour #7163 ruled
wrong — so the repair adds the container's **expansion**, whose items each carry
the `viewKind` + `object` pair this filter has always tested. The filter is
untouched; it reads the top-level `object` exactly as `ViewSchema.object`
declares.

The expansion is registry-free and per-read, mirroring #13407's choice at the
other exit and for the same reason: the registry is process-wide, so a read must
not graft rows into it. Already-present names win, so a container whose expanded
ViewItems were registered by a source registrar (the ObjectQL boot loop, the
artifact/HMR loader) still answers with those registered, fully-enriched items
and gains nothing new.

The object-derivation chain (`object` → `list.data.object` → `form.data.object`
→ the row's own `name`) now has one spelling for this package, in the new
`view-container-expansion.ts`, rather than a third private copy to fall behind.
