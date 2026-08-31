---
"@objectstack/objectql": minor
---

fix(objectql): cut the tenant-audit control's scope by the OBJECT's tenancy, not the caller's `isSystem` flag (#13491)

Maintainer ruling, 2026-08-31 (联案 #13491 + #13497, verbatim「同意」). The batch #9
ruling — "`isSystem` writes are out of this control's scope" — was narrowed by its
own look-back clause, which #13497's measurement fired:

- **`isSystem` x a tenant-scoped object = IN scope.** A system write that lands an
  org-less row on a tenant-scoped object is the defect class the control exists
  for. It has occurred five times (#12745, #12928, #10673, #8617, cloud#1239 — one
  a credentials table) and every instance was found by a person reading call
  sites, never by the control.
- **`isSystem` x a genuinely global object = OUT of scope.** #8672's reasoning
  ("an org-less row is defensible for `sys_permission_set`") now inherits **per
  object**; the wholesale `sys_` / `cloud_` / `ai_` namespace exemption is
  withdrawn.

Two gates narrow by that one classification:

1. `resolveSystemInsertOrganization`'s blanket
   `isPlatformNamespaceObject(object)` short-circuit, so an admitted platform
   object reaches #8844's existing derive/refuse machinery (multi-organization
   refusal branch included);
2. the engine's `bypassTenantAudit` `isSystem` mute, which used to silence EVERY
   elevated write — the #13178 census measured 135 of 175 write call sites (77%)
   silenced at it, the control's largest gate sitting ahead of the condition the
   control is about.

**Why a hand-adjudicated ledger and not a schema read.** `applySystemFields`
provisions the `organization_id` COLUMN unconditionally — its existence was
deliberately decoupled from whether tenancy is on. Measured by AST census of every
`ObjectSchema.create` in `packages/`: of 84 platform-namespace objects, 59 carry a
tenant column, `sys_permission_set` among them. A schema read therefore replaces a
wholesale exemption with a wholesale inclusion. The ruling's source is "有列**且有
写手填**", and the writer half is a fact about the code, established once by
inventory (`packages/objectql/src/tenancy/platform-object-tenancy.ts`).

**Direction is one-way.** What this adds is refusals and warnings only; no write's
target or payload changes. An object the inventory could not adjudicate is
`unclassified`, which keeps today's behaviour exactly and goes back to the
maintainer on a list — so the blast radius equals the seven admitted objects
(`sys_file`, `sys_upload_session`, `sys_approval_request`, `sys_approval_action`,
`sys_approval_approver`, `sys_automation_run`, `sys_notification_delivery`), each
admitted on a citable writer fact.
