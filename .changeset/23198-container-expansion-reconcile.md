---
"@objectstack/metadata-protocol": patch
---

Republishing a view container without one of its views now stops serving that view, without a restart

Clause-②: no

- A view container (a `defineView` document, such as a package's `showcase_task` views) expands to one view per entry, registered in the process registry under `<object>.<viewKey>`. A publish of the container registered the views it expanded to and removed none it no longer expanded to. So after `POST /api/v1/meta/view/NAME/publish` of a container whose `listViews` lost an entry, `GET /api/v1/meta/view`, `GET /api/v1/meta/view?object=OBJECT` and the by-name read of that view kept serving it until the process restarted.
- Every write that changes a view container's stored row now leaves the registry holding the views that row expands to: a publish, a save that publishes, a rollback, a revert, a replica's convergence, a reset and a delete. So does the list read's and the boot's hydration of a stored row. The write answers after this, so a read that follows it serves the published set.
- A view the container no longer expands to is healed the way a reset heals it: where a package ships a view of that name, the package's view is served again, and a name nothing else serves is removed. As for a reset, a name whose MetadataService read fails stays registered until a restart.
- When one container name has two stored rows (one bound to no package, one bound to a package), each row is compared with what that row registered before. A republish of one row removes only the views that row dropped, and the list read leaves both rows' views registered however often it runs. A view both rows expand to, which one row drops, is served from the other row's stored row and registered again by the next list read. A reset or delete of the name heals every row's views, as before.
- Unchanged: an organization-scoped write touches no registry entry, a baseline is re-registered on a control-plane kernel only, and a view name another package ships is never registered or healed for the container. Every other type registers and resets as before.
- No public export, signature, schema or accept-set change. In the built entry declarations, `ObjectStackProtocolImplementation` gains one untyped `private` member name and loses two `private static` ones.
