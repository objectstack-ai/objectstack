---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@objectstack/rest': minor
---

feat(plugin-security,rest,spec)!: the permission-set "Discard Overlay" action, its REST route and its contract member are retired; no door creates the overlay it discarded, and a database holding one is refused at cold boot (ADR-0131 cutover, ADR-0048)

Clause-②: no (narrowing)

<!-- adr-0087: registered security-permission-set-overlay-discard-retired -->

**BREAKING** — a narrowing of the public surface: one HTTP route, one Setup action and one optional contract member are removed. Shipped as `minor` under the launch-window convention for breaking changes.

The action deleted the environment-wide `sys_metadata` row that shadowed a package-declared permission set, then re-projected the set's `sys_permission_set` row. Neither half has anything left to do:

- No door creates such an overlay. The metadata door refuses a save over a packaged permission set on every topology, whatever `OS_METADATA_WRITABLE` says. The data door refuses an edit of one (clone it instead). The data API cannot write `sys_metadata`. A package that declares a name the environment holds is refused at install.
- An overlay stored before those refusals makes the cold boot refuse the deployment with `422 NAMESPACE_CONFLICT`, so a server that could answer the route never holds one.
- The authorization resolver reads the security catalog, not `sys_permission_set` rows, so the re-projected row granted nothing.

### What was removed

| removed | what to use instead |
| --- | --- |
| `POST /api/v1/security/permission-sets/:id/discard-overlay` | `os migrate security-catalog-overlays` with the flags and environment the deployment boots with lists every overlay row with no server running; `--apply` deletes them (a history tombstone per row). |
| the **Discard Overlay** action on `sys_permission_set` in Setup | the same offline step. To keep a customization of a packaged set, clone it under a new name (the **Clone** action) and assign the clone. |
| `ISecurityService.discardPermissionSetOverlay` and `PermissionSetOverlayDiscardResult` (`@objectstack/spec/contracts`) | nothing: delete the call and the import. `tsc` names each one. |
| `discardPermissionSetOverlay`, `PermissionSetNotFoundError`, `PermissionSetOverlayStateError` and the `PermissionSetOverlayDiscardDeps` / `PermissionSetOverlayDiscardResult` types (`@objectstack/plugin-security`) | nothing: delete the import. |

**The one-line fix:** stop calling the route or the member, and clear any overlay offline with `os migrate security-catalog-overlays --apply` before the first boot on this release.

`ERROR_CODE_LEDGER['@objectstack/plugin-security']` no longer lists `INVALID_STATE` or `NOT_FOUND`: the removed action was their only producer in this package. Both codes stay registered under `@objectstack/rest`, and the union of codes is unchanged.

The permission-set drift diagnostic no longer names the action in its `overlay_shadow` detail, and the boot reading of shadowed packaged sets names the offline step instead.
