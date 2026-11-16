---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth)!: a SCIM directory sets, changes and clears a user's manager through the Enterprise User `manager` attribute

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is the answer a SCIM user write gets when the manager it names would be refused by the admin endpoint. There is nothing for `objectstack migrate meta` to rewrite; the identity provider's manager mapping is corrected in the directory. -->

**BREAKING** for a SCIM identity provider that sends a manager the admin endpoint would refuse. A SCIM create, replace or patch that names the Enterprise User `manager` attribute, for an active user the directory holds, whose manager resolves to a User the same connection provisioned, and where that link would make the user their own manager, close a cycle, run past the 20-link depth cap, or cross an organization boundary, used to answer `201` / `200` and leave `manager_id` untouched. It now answers SCIM `400` with `scimType: invalidValue` and the admin endpoint's reason, and nothing of the request is written. Those four are the only requests served before and refused now. Remedy: correct the manager in the directory.

**The gap.** `POST /api/v1/auth/admin/set-user-manager` refuses a person a SCIM directory holds and says to change the manager in the directory, but nothing carried the directory's answer to `sys_user.manager_id`: `@better-auth/scim` stored and echoed `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager` and wrote nothing of it onto the user. So a SCIM-held user's manager could not change from either side, and approvals routed to the manager could not follow a reorganisation.

**The rule.** A SCIM user write that names the attribute now projects `manager.value` onto `sys_user.manager_id`, inside the SCIM transaction. `manager.value` is the manager's SCIM resource `id` (RFC 7643 §4.3), looked up among the Users the same connection provisioned; a `$ref` alone is read by its final `/Users/{id}` segment. The link goes through the admin endpoint's own refusals, above.

- **Silence is not a clear.** A create or PATCH that does not name the attribute leaves `manager_id` as it is. An explicit PATCH `remove`, or a replace without the attribute, clears it.
- **One owner per identity.** The projection writes only on an identity whose manager the directory owns, which is exactly the set the admin endpoint refuses (one shared predicate). On any other identity, for example one holding a local password, the admin endpoint owns the column and the projection writes nothing.
- **A reference that names no User is served.** An unknown id, an `externalId` or email, another connection's id, or a `$ref` with no readable `/Users/{id}` segment does not fail the write: the user is saved, `manager_id` stays as it was, and the event is recorded with one operator warning and one `scim_manager_unresolved` audit row (when `@objectstack/plugin-audit` is installed), both once per connection per window, carrying the count held back. The row names the connection, the user and the reference, cut to 256 characters, and nothing else from the request; a request that is refused writes none.
- **An unchanged manager is not judged again**, so a write is never refused over a chain other links have since reshaped, and a report whose manager was deleted keeps working.

**Where it does not project, and why.**

- Outside an authenticated SCIM request: the vendor also runs this step while it decommissions a connection or replays a provisioning domain. Neither is a write the directory made, and a decommission must never be refused over an org-chart reference.
- When the user's profile source belongs to another connection: that connection authors the user's name and email, so its manager is the one that counts, not this request's.
- For an inactive user: a deprovision is never refused over the org chart. A manager named while the user is inactive is not applied on re-activation alone; it lands on the next replace, or on a patch that changes it. (`@better-auth/scim` calls the host only when a PATCH changes what it stores, so a patch that re-sends the same value, or removes an attribute the directory never sent, writes nothing; a replace always reaches the projection.)

The `idp_provisioned` stamp (ADR-0135 D4) is unchanged.
