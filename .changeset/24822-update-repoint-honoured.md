---
'@objectstack/objectql': minor
'@objectstack/plugin-security': patch
---

fix(objectql,plugin-security): an update's re-point of `organization_id` that the Layer 0 wall admits is stored as sent, not silently dropped

Clause-②: yes (widening) — an update re-point of `organization_id` the Layer 0 wall admits is now stored instead of silently dropped, and an in-process `strictReadonlyWrites: true` update naming an organization the wall admits is now stored instead of refused `ERR_READONLY_FIELD_REJECTED`.

**What was wrong.** Under the `group` posture, a member whose active organization is A can name C, another organization it belongs to, in an update's `organization_id`. The Layer 0 write wall admitted C, on the payload and on the row about to be stored. Then the engine's static-`readonly` update strip took it, because the platform's injected tenant column is `readonly: true`, and the row stayed in A. The update answered 2xx, by id and by predicate alike, and the only signals were a `droppedFields` entry and a WARN. An object that declares its own writable `organization_id` stored the same re-point, so the app objects on the injected column were the inconsistent half. This is the update half of the insert fix shipped beside it.

**What changed.**

- **`@objectstack/objectql`.**
  - `ObjectQL.update` reads `PostHookWriteImageCheck.judgesOrganization` (reached as `OperationContext.postHookWriteImageCheck`) once per update, for a non-system caller, and hands that one value to every static-`readonly` pass: the pre-hook hide pass, the by-id strip, the predicate strip, and the stored view the `readonlyWhen` strips and the master-detail settlement read.
  - Where it is set, and the object's `organization_id` is the platform's injected column on an object the insert strip also judges, those passes leave the caller's re-point on the row. The wall then stores it as sent where it admits it and refuses it where it does not.
  - The decision is one helper, shared with `ObjectQL.insert`, so the two write verbs spare exactly the same objects.
  - The member's published doc now covers updates. No member is added.
- **`@objectstack/plugin-security`.**
  - Step 3.7 sets `judgesOrganization` on the stored-image seam it composes for a single-payload update, only where it composes the wall's own parts in, as it already did for an insert.
  - It does not set the member on a business-`check`-only seam, on a crossing platform operator's update (which gets no wall seam), or on an update whose payload is an array (step 3.7 composes no seam for one).
  - The wall's admit/refuse set is unchanged: a re-point outside the caller's scope is still refused `403 PERMISSION_DENIED`, and so is an emptied one (`null` or `''`).

**What a caller sees.** Every change below is a widening. None of them admits a `(caller, organization)` pair the wall does not already admit, and the engine's own gates (the wall, the strip and the strict flag) refuse nothing they accepted before.

- **The re-point is stored as sent.** Under `group`, an update naming another organization of the caller's membership set moves the row there, by id and by predicate. Under `isolated`, an update naming the active organization is stored as before.
- **No longer reported.** Such a re-point is no longer reported as dropped: not in `droppedFields`, not through the `onFieldsDropped` listener, and not by the read-only WARN.
- **`strictReadonlyWrites` stores it.** An in-process `engine.update(..., { strictReadonlyWrites: true })` naming such an organization is now stored, where it used to be refused `ERR_READONLY_FIELD_REJECTED`: strict refuses exactly what the strip takes. No REST door can set that flag.
- **`beforeUpdate` hooks see it.** On a walled update, `beforeUpdate` hooks now see the caller's `organization_id`, because the value will be stored. Before, it was withheld from them.
- **A member with no active organization.** Under `group`, such a member re-points within its membership set the same way, and outside it is refused.
- **An on-behalf-of update (ADR-0090 D10).** Take a platform operator who crosses the wall and acts for a walled delegator. The re-point is held to the delegator's wall: stored as sent where that wall admits it, refused `403` where it does not. Before, an admitted re-point was taken and the row kept its organization.
- **Outcomes that read the stored organization now follow the admitted value.** An organization-scoped unique key, a validation rule, a `readonlyWhen` / `requiredWhen` predicate, and a hook that reads `organization_id` now see the organization the row is moved to, not the one it used to keep. So a re-point that collides with an organization-scoped unique key in its new organization is refused there, as it already was on an object that declares its own `organization_id`; before, the re-point was dropped and the write reported success.
- **Only the platform's injected column on an app object is spared.** A `sys_` object, a platform-internal `managedBy` bucket (`engine-owned`, `append-only`, `better-auth`), and an object whose author declares its own `organization_id` with `readonly: true` keep the update strip: the value is still taken, reported, and refused under strict, exactly as before. The organization-scoped grant tables (`sys_user_position`, `sys_user_permission_set`) declare a writable `organization_id` the strip never took, so their re-points keep meeting their own guards exactly as before.
- **Where no wall judges the column, nothing changes.** The re-point is still taken and reported, and strict still refuses it. That includes `single`, a composition without the security plugin, a tenancy-disabled object, a platform operator crossing the wall on its own behalf, and `preserveAudit`, whose update-only exemption never reaches `organization_id`.
- **The `update`-mode `validate()` preview is unchanged.** It runs no middleware, so it holds no seam: it still reports an admitted re-point as dropped while the write stores it.
