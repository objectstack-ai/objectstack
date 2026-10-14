---
"@objectstack/metadata-protocol": patch
---

Resetting a published overlay of a view container now stops serving the views it expanded to, without a restart

Clause-②: no

- A view container (a `defineView` document, such as a package's `showcase_task` views) expands to one view per entry, registered under `<object>.<viewKey>` (`showcase_task.default`, `showcase_task.in_progress`, …). A published overlay of the container registers its own expanded views under those names in the process registry.
- `DELETE /api/v1/meta/view/NAME` on such an overlay answered `reset: true`, but its registry heal restored only the container's own name. `GET /api/v1/meta/view` and `GET /api/v1/meta/view?object=OBJECT` kept listing the overlay's expanded views next to the packaged ones until the process restarted, and the end-user list kept rendering the overlay's columns and label. The by-name read of an expanded view served the overlay's copy too wherever no MetadataService answered first.
- The heal now also heals every view name the container registered when it was published, through the same steps as the container's own name. A packaged view of that name is served again, a view only the overlay added is removed, and a later publish of the container is served as before.
- Unchanged: an organization-scoped delete still touches no registry entry, re-registration still happens on a control-plane kernel only, and a view name another package ships, which the publish never registered, is never touched by the reset. Dashboards and every other type reset as before.
- No public export, signature, schema or accept-set change. The built entry declarations gain three `private static` member names on `ObjectStackProtocolImplementation`.
