---
'@objectstack/spec': patch
---

docs(spec): the app page `record` binding's describe and `PageRecordBindingSchema` TSDoc say what the console does

Clause-②: no
Metadata-protocol: none

The `record` key on `PageSchema` and the `PageRecordBindingSchema` TSDoc no longer say "Planned in the renderer". The console already reads the binding: once per page open, the first row under `sort`, under the caller's identity. Every component's `visibleWhen` sees that row as `record`, and a record block that binds its own row still provides that row to its own subtree. The text now names the three states a predicate sees: pending (the page body is not drawn), no row or a refused read (`record` is null), and any other failure (the page body is not drawn). The old sentence that a missing row leaves `record` unbound and renders the component is gone, since the console binds `record` as null. No key, shape, default or export changes. The `props.record` liveness note drops its line that called this text stale.
