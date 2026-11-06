---
'@objectstack/spec': patch
---

docs(spec): the app page `record` binding's describe and `PageRecordBindingSchema` TSDoc say what the console does

Clause-②: no
Metadata-protocol: none

The `record` key on `PageSchema` and the `PageRecordBindingSchema` TSDoc no longer say "Planned in the renderer". The console already reads the binding: once per page open, the first row under `sort`, under the caller's identity. Every component's `visibleWhen` sees that row as `record`, and a record block that binds its own row still provides that row to its own subtree. The text now names the three states a predicate sees: pending (the page body is not drawn), no row, or a read the server refuses as forbidden (403) (`record` is null), and any other failure (the page body is not drawn). A page drawn through `interfaceConfig.source` reads no binding. The old sentence that a missing row leaves `record` unbound and renders the component is gone, since the console binds `record` as null. The component `visibleWhen` describe and TSDoc no longer say a faulting predicate renders the component: the console withholds it, so a `data.*` read on an element no `api` data source binds, or `current_user.hasCapability(...)` on a host with no capability list, hides the component. No key, shape, default or export changes. The `props.record` liveness note drops its line that called this text stale, and the `record` row of the Pages guide (`content/docs/ui/pages.mdx`) now gives the same reading.
