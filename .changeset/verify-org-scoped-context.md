---
"@objectstack/verify": minor
---

feat(verify): `bootStack({ orgContext: true })` — a harness admin whose execution context carries an organization (#7762)

`bootStack` could not mint an admin whose resolved execution context carried an
`organizationId`. Every `organization_id`-filtered read in the platform was
therefore structurally **untestable at the HTTP layer** in the open core: the
filter never engaged, so a fixture asserting on the difference between a
filtered and an unfiltered read saw no difference and passed for the wrong
reason.

That is not theoretical. #7676 — package-seeded (`organization_id = null`)
sharing rules invisible to an org-scoped admin — escaped **both** suites that
should have caught it and needed a manual QA run to find. The HTTP-layer
regression test written for its fix measured green against the *unfixed* code
and was correctly deleted rather than shipped as phantom coverage. Two earlier
defects of the same class (`sys_business_unit` approver expansion,
`sys_metadata` pending-draft listing) were found the same way.

`orgContext: true` flips `AuthPlugin`'s ADR-0081 D1 default-organization
bootstrap back on — the same one `objectstack dev` / `serve` give a real
single-tenant deployment. The admin is bound to a real `sys_organization` as
owner, their session carries `activeOrganizationId`, and org-scoped reads
resolve it off the execution context. The boot **asserts** the bind and refuses
to return a stack without it, because a best-effort bootstrap that quietly
no-ops is the vacuum this option exists to close.

⛔ **It performs no tenant isolation.** It stamps the caller's organization; it
stands up no organization wall. With no `org-scoping` service present,
`SecurityPlugin` strips the wildcard `organization_id` RLS policies, so a
fixture asserting "tenant B cannot read tenant A's rows" and booting this way
would assert nothing and pass. Cross-tenant isolation still has exactly one
honest proof: `multiTenant: true` with the real `@objectstack/organizations`.

The tenancy **posture** is untouched, and that is a property of the seam rather
than of this implementation: `TenancyService.probeIsolation` is
`() => !!ctx.getService('org-scoping')`, so the effective posture derives from
service registration alone and reads nothing about what any context carries.
The posture and the `degraded` flag are pinned identical with the flag off vs
on.

`orgContext` does **not** compose with either spelling of `multiTenant` and the
boot refuses the combination rather than booting something weaker than it
reads: under `multiTenant: true` the enterprise package already owns the org
bootstrap, and under `multiTenant: 'posture-only'` the open bootstrap
deliberately abstains (walled posture), which would leave the admin org-less
inside a fixture that reads as org-bound.

Default boots are unchanged — the option is opt-in and the existing dogfood
suite is unaffected.
