---
'@objectstack/core': minor
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
'@objectstack/runtime': patch
---

feat(security): the guest's grants channel — an anonymous request at a guest-entry door holds the sets bound to the `guest` anchor, in the one organization the deployment resolves for it (ADR-0138 E1, D3/D4)

ADR-0087 disposition: none. No authorable key, accept set or stored shape moves: no spec schema, metadata type, stored row or published response field is added, removed, renamed or re-shaped. A declared binding that was not enforced becomes enforced (ADR-0090 D9, as ADR-0138 D3 amends it).

**The bindings that start granting.** On the reference apps, none: `app-showcase`, `app-crm`, `app-multi-package` and `app-todo` declare no definition of the `guest` anchor that names a set. `app-showcase` ships `showcase_guest_portal` as a capability an administrator may bind and binds it to no anchor (its `client_portal_user` position is an ordinary position), and `app-crm`'s `guest_portal` is the public form doors' set, which keeps its own posture. No reference app declares a permission set named `guest`, so no grant stops either. A set starts granting only where a deployment holds an environment definition of the `guest` position that names it.

What changes:

- **`@objectstack/core`** — the anonymous branch of `resolveAuthzContext` resolves the guest's grants on a face that takes the explicit guest entry (the new `guestEntry` input). It reads the sets the `guest` position's definition names, through the same position-bound read every position uses, and the activation ledger as for any held set. It resolves them only in the organization the guest entry's organization step derives (`resolveGuestOrganization`), which asks ADR-0131 D9's predicate and no second spelling of it. With nothing bound, the guest holds no set and no read is issued. The predicate itself, `resolveSystemWriteOrganization`, moves to `@objectstack/core` so both of its askers share it. New exports: `resolveGuestOrganization`, `resolveSystemWriteOrganization` (with `SystemWriteOrganizationDecision` and `SystemWriteRefusalReason`), and `GuestOrganizationUnresolvedError` with `isGuestOrganizationUnresolvedError` and its constants.
- **`@objectstack/objectql`** — `resolveSystemWriteOrganization` and its two types are re-exported from `@objectstack/core` as the same bindings. Nothing a caller imports changes.
- **`@objectstack/plugin-security`** — the set resolution treats the guest's sets as any requested set, and no longer folds the guest's position into the request. A permission set that merely shares the anchor's name no longer reaches an anonymous caller, and the baseline and `everyone` never did. At the CRUD gate, a guest that reaches a data operation acting in no organization, on a deployment where the organization step refuses, is refused before the operation runs.
- **`@objectstack/plugin-sharing`** — the read filter answers deny-all for the guest on every object that record sharing scopes, before the sharing-model branch: the guest reaches rows only through share links, never through the object's sharing model (ADR-0138 D3 item 6, as the maintainer's ruling C amends it). `externalSharingModel` is still not read for any caller. Share links are redeemed at their own door and are unchanged.
- **`@objectstack/runtime`** — the runtime face, which serves the guest, asks for the guest's grants.

What an anonymous caller sees at an `authRequired: false` endpoint of `type: 'object_operation'`:

- **One organization, a set bound to `guest`:** the operation runs as the guest, under that set, in that organization. A read the set grants is admitted and returns no row, whatever the object's sharing model (`private`, `public_read`, `public_read_write` or `controlled_by_parent`): the guest reaches a record only through a share link. A create the set grants lands in that organization with no owner.
- **Nothing bound:** `403 PERMISSION_DENIED`, as before.
- **A walled deployment, several organizations, or none:** `501 NOT_IMPLEMENTED`, naming the missing site binding (ADR-0138 D5), where it used to be `403 PERMISSION_DENIED` with nothing granted. Nothing that was served stops being served. The operator's log names the reason once.

Unchanged: share links, which still serve an anonymous caller the one record they name, with `publicSharing.eligibility` checked at the mint and at every redemption; the public form doors, which keep their own posture and organization; the flow door, which runs under the flow's own declared posture; every surface that answers an anonymous request `401`; and every signed-in caller.

Level: `minor` for `@objectstack/core`, because new exported symbols widen its published index; `patch` for the other four, whose exports do not move.
