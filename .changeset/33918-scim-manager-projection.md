---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a SCIM directory sets, changes and clears a user's manager through the Enterprise User `manager` attribute

Clause-②: yes (widening). A SCIM request whose `manager` is ignored today starts writing `manager_id`. A manager value naming no known user is answered as a SCIM error. The dev measures this again before the PR, including whether any request served today becomes refused.
Metadata-protocol: none

`POST /api/v1/auth/admin/set-user-manager` refuses a person a SCIM directory holds and says to change the manager in the directory, but nothing carried the directory's answer to `sys_user.manager_id`: `@better-auth/scim` stored and echoed `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager` and wrote nothing of it onto the user. So a SCIM-held user's manager could not change from either side, and approvals routed to the manager could not follow a reorganisation.

A SCIM create, replace or patch now projects `manager.value` onto `sys_user.manager_id`, inside the SCIM transaction. `manager.value` is the manager's SCIM resource `id` (RFC 7643 §4.3), looked up among the Users the same connection provisioned; a `$ref` alone is read by its final `/Users/{id}` segment. The link goes through the admin endpoint's own refusals: self-assignment, a cycle, the 20-link depth cap and a manager provably outside the user's organizations. A reference that names no User the connection provisioned is refused too. Each refusal is a SCIM `400` with `scimType: invalidValue`, and nothing of the request is written. Removing the attribute (a PATCH `remove`, or a replace without it) clears `manager_id`.

The projection follows the user's profile source (the one whose name and email the user carries), runs only on an active user, and judges a manager only when it changes, so a deprovision or an unrelated update is never refused over the org chart.

Requests accepted before and refused now: a create, replace or patch whose `manager.value` is not the SCIM id of a User this connection provisioned (an `externalId`, an email, a value from another connection, or a manager not provisioned yet), and one whose manager would be the user themself, close a cycle, pass the depth cap or cross an organization. They used to answer `201`/`200` and leave `manager_id` untouched.

The `idp_provisioned` stamp (ADR-0135 D4) is unchanged.
