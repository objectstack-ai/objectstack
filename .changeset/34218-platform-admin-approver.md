---
'@objectstack/spec': minor
'@objectstack/plugin-approvals': minor
'@objectstack/lint': minor
---

feat(approvals): a `platform_admin` approver type routes a step to the platform administrators, from the deployment's own packaged flows only

Clause-②: yes (widening)
Metadata-protocol: added

The widening: `ApproverType` accepts a new member, `platform_admin`, which takes no `value`. Nothing accepted before is refused. The narrowing that comes with it applies only to the new member: it is refused outside the running body of a `source: 'code'` package's flow.

`{ type: 'platform_admin' }` on an approval node addresses the deployment's platform administrators: the people `hasPlatformAdminStanding` answers yes for, which covers a holder of the cross-tenant `admin_full_access` grant and a verified account whose email `OS_PLATFORM_OWNER_EMAIL` declares.

- The step opens on ONE address slot, `platform_admin:*`, that names no person. Nobody is enumerated, nobody is notified, and the slot grants no record read. `onEmptyApprovers` does not treat the slate as empty.
- At the inbox and at every decision, the server asks whether the caller has platform-administrator standing at that moment, from the stored rows and never from the session's posture. A caller who has it decides as an ordinary approver, and the decision records the person (`actor_id`) and the slot (`acted_as`). A revoked administrator cannot decide, also on a request opened before the revocation. An organization administrator takes no slot. The #3424 tenant-admin override is withheld from a request whose slate holds `platform_admin:*`, including a mixed slate: an override decides the whole request, so the guard covers the whole request. Its ordinary approvers still decide as usual. The platform-admin override is unchanged.
- The new member is accepted only in the running body of a flow shipped by a package the deployment registers in code (registry `source: 'code'`, or a residual owner a code door recorded). Anywhere else the node refuses to open, fails closed and writes nothing: a flow authored in the environment, an environment override of a packaged flow, and a marketplace or authored package's flow. The runtime save door refuses an active flow naming it with `approval-approver-platform-admin-authored`. `os lint` knows the type and refuses nothing, because it cannot know which door will register a package. No designer offers the type.

Nothing to migrate.
