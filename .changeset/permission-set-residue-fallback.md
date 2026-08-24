---
'@objectstack/plugin-security': patch
---

An organization-less `sys_permission_set` row grants again — #11121 revoked standing access silently

#11121 made the request-time permission-set loader tenant-scoped so two
organizations holding a row for the same name stop answering each other's
requests. It shipped the second half as a COMMENT — "an organization-less
leftover only where it does not [have its own]" — and the code read `.own`
alone, which by `resolveOwnOrganizationRow`'s own documented contract is never
a residue once an organization is supplied.

That helper is written for SEEDERS, where refusing to read a residue as
"already seeded" is the entire point. Enforcement wants the opposite reading: an
organization-less row is still a row the principal was granted, and dropping it
revokes standing access with no signal at the moment of loss — the failure this
catalog's own header, and `resolve-authz-context`'s `sys_position` read, both
name as the thing not to do.

The asymmetry was observable on a single row: its `system_permissions` and
`tab_permissions` kept applying, because that read is unscoped and by id, while
its `object_permissions` and `admin_scope` stopped. One row, two enforcement
planes, opposite verdicts. Every walled deployment carrying pre-#11121 rows —
or any row authored without a tenant, which includes admin-UI-authored sets —
lost those grants on upgrade, reported only as a boot WARN about "leftovers"
that states the catalog is complete.

Found by cloud's `apps/ee-group-showcase` dogfood suites, which had been failing
four ADR-0111 / ADR-0105 assertions on cloud main while turbo replayed them from
cache.

Preference order is unchanged, so the cross-tenant bleed #11121 closed stays
closed: this organization's own row still WINS wherever it exists, and a
leftover is consulted only in its absence. #11121's suite covers seeding and the
`sys_position` sweep; the three cases added here cover the loader path it did
not — residue resolves, own beats residue, and the single-posture carve-out is
untouched. Reverting the one-line fix reddens exactly the first of them.
