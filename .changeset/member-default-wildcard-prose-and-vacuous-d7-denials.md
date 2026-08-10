---
'@objectstack/platform-objects': patch
---

**`member_default`'s removed wildcard was still named as live fact, and two D7 dogfood denials had gone vacuous (#6964).**

#5491 (PR #6684) removed `member_default`'s plain `'*'` object grant and ADR-0095
D1 retired its wildcard `tenant_isolation` RLS policy. Six live sites outside the
two surfaces PR #6958 already fixed still asserted one of those two facts as
current, and — the reason this is not only prose — two dogfood tests rested their
whole evidential claim on the first one.

**Prose (`platform-objects`, `qa/dogfood`, published docs).** The
`requiredPermissions` gates on `sys_scim_provider` and `sys_sso_provider`
justified themselves by an exposure that no longer exists, which invites the next
reader to conclude the gates are redundant. They are not: `requiredPermissions`
is a capability AND-gate evaluated *before* the CRUD grant, so it denies
regardless of how permissive any grant is — including one an app-declared profile
or a customer-authored set names. `sys_sso_provider`'s `tenancy.enabled:false`
and `rls-multitenant`'s investigation narrative are re-premised on the ADR-0095
D1 Layer 0 tenant wall, which is what actually decides them now. And
`content/docs/permissions/index.mdx` stated the retired wildcard
`tenant_isolation` policy as shipped behaviour, contradicting
`releases/implementation-status.mdx` in the same repo; the doc now matches the
status page.

**The defect.** `showcase-default-profile` and `showcase-d7-default-profile`
proved ADR-0056 D7 with `expect(status).not.toBe(200)` on an app object,
justified by "`member_default` has a wildcard grant → would be 200". With the
wildcard gone that baseline grants nothing on app objects, so the denial became
the trivially expected outcome and the assertion passed *because nothing is
produced* — it could no longer tell "the declared default is in force" from "no
default is in force at all", which is the one thing those files exist to tell.
Measured on a live showcase boot, one fresh sign-up per wiring: under the
built-in baseline `showcase_private_note` and `showcase_contact` are **403**,
exactly as under the declared default.

Both denial cases are replaced wholesale rather than re-worded, with an object
only the built-in baseline grants (`sys_user_preference`): 200 if and only if
`member_default` governs. The same run settles the risk that would have killed
that idea — a named `fallbackPermissionSet` **replaces** `member_default` rather
than merging additively on top of it. Reverse-verified: stripping the declared-
default wiring turns the new case red (200) and the positive case red (403),
while the deleted cases stay green — the vacuity, demonstrated directly.

No runtime behaviour changes.
