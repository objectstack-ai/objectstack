---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a view a stored view container expands answers by name what the object door lists, on every kernel and for every container scope

Clause-②: no

- **What changed.** `GET /api/v1/meta/view?object=…` lists the views a stored view container expands, and the by-name read now answers each of those names with the same item. Before, `getMetaItem` expanded no container: it answered such a name only on an unscoped kernel and only for an environment-wide container, where the registry held a hydrated copy. On an environment-scoped kernel, and for an organization-scoped container on any kernel, it answered nothing. Where the name is one a package also ships, such as `<object>.default` under a tenant's overlay of that package's container, it answered the packaged view while the list served the overlay's.
- **How.** The by-name read selects the stored containers in the caller's scope with the list read's own row selection, and expands them with the list read's own expansion. Nothing is persisted or registered, and a stored row of the name itself still answers first.
- **Layers, history and diff for such a name.** `getMetaItemLayered` reports the container's own stored row as `overlay`, with the scope it was read from as `overlayScope`, and the expanded view as `effective`. `historyMetaItem` and `diffMetaItem` answer exactly what they answer under the container's own name, and say so: every event's `ref.name` and the diff's `name` are the container's. No history is made up for a name that was never stored.
- **What does not change.** The container's own name still answers its stored row. The save door is unchanged, including a write by an expanded name. No response shape gains or loses a key.
