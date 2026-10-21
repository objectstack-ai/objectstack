---
'@objectstack/objectql': minor
'@objectstack/plugin-security': patch
---

fix(objectql,plugin-security): an insert's explicit `organization_id` that the Layer 0 wall judges is stored as sent, not replaced by the active organization

Clause-②: yes (widening) — `PostHookWriteImageCheck` gains the optional published member `judgesOrganization`, and an in-process `strictReadonlyWrites: true` insert naming an organization the wall admits is now stored instead of refused `ERR_READONLY_FIELD_REJECTED`.

**What was wrong.** Under the `group` posture, a member whose active organization is A can name C, another organization it belongs to, in an insert's `organization_id`. The Layer 0 write wall admitted C. Then the engine's static-`readonly` strip took it, because the platform's injected tenant column is `readonly: true`, and the driver stamped A. The insert answered 2xx with the row in A, single and array alike. The only signals were a `droppedFields` entry and a WARN. Under `isolated`, a caller that named its own active organization saw the same strip and report, for a value that ended up stored anyway.

**What changed.**

- **`@objectstack/objectql`.**
  - `PostHookWriteImageCheck` (reached as `OperationContext.postHookWriteImageCheck`) gains an optional member, `judgesOrganization?: boolean`. An enforcement layer sets it when the seam's `evaluate` holds every inserted row's `organization_id` to the tenant wall.
  - `ObjectQL.insert` reads that member, and nothing else. When it is set, a non-system caller's explicit `organization_id` stays out of the pre-hook withhold and out of the static-`readonly` strip. The value is then stored as sent where the wall admits it, and refused by the wall where it does not.
  - When the member is absent or `false`, both passes run exactly as before. That covers a seam that carries only a business `check`, a stack without an enforcement layer, and `validate()`, which runs no middleware.
- **`@objectstack/plugin-security`.**
  - Step 3.7 sets the member only where it composes the wall's own parts into an insert's stored-image seam.
  - It does not set the member on a business-`check`-only seam, on a crossing platform operator's seam, or on any update.
  - The wall's admit/refuse set is unchanged: an organization outside the caller's scope is still refused `403 PERMISSION_DENIED`.

**What a caller sees.** Every change below is a widening. None of them admits a `(caller, organization)` pair the wall does not already admit, and nothing accepted before is refused now.

- **The optional member.** `PostHookWriteImageCheck.judgesOrganization` (`OperationContext.postHookWriteImageCheck`) is new published surface on `@objectstack/objectql`.
- **The value is stored as sent.**
  - Under `group`, an insert naming an organization of the caller's membership set is stored there.
  - Under `isolated`, an insert naming the active organization is stored as before.
- **No longer reported.** Such an organization is no longer reported as dropped: not in `droppedFields`, not through the `onFieldsDropped` listener, and not by the read-only WARN.
- **`strictReadonlyWrites` stores it.** An in-process `engine.insert(..., { strictReadonlyWrites: true })` naming such an organization is now stored, where it used to be refused `ERR_READONLY_FIELD_REJECTED`: strict refuses exactly what the strip takes. No REST door can set that flag.
- **`beforeInsert` hooks see it.** On a walled insert, `beforeInsert` hooks now see the caller's `organization_id`, because the value will be stored. Before, it was withheld from them.
- **A member with no active organization.** Under `group`, such a member with a non-empty membership set can now insert a row naming one of those organizations: it is stored there. It used to be refused `403 PERMISSION_DENIED` under ADR-0123 D2, because the value was taken and the row then named no organization. A row naming none is still refused under D2, and one naming an organization outside the set is still refused by the wall.
- **An on-behalf-of insert (ADR-0090 D10).** Take a platform operator who crosses the wall and acts for a walled delegator. The named organization is held to the delegator's wall: stored as sent where that wall admits it, refused `403` where it does not. Before, an admitted value was taken and the active organization stored.
- **An explicit empty value in an array insert.** A row naming `organization_id: null` or `''` is no longer taken, reported, or refused under strict. It is still stored as the active organization, because the driver's stamp fills an empty value.
- **Where no wall judges the column, nothing changes.** The value is still taken and reported, and strict still refuses it. That includes `single`, a composition without the security plugin, a tenancy-disabled object, and a platform operator crossing the wall on its own behalf.
