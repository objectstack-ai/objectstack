---
'@objectstack/spec': minor
---

feat(spec): `PackageSchema.visibility` defaults to `org` (was `private`), the create-time default every publish path already produced

Clause-②: yes

`PackageSchema` (`@objectstack/spec/marketplace`) filled an omitted `visibility` with
`private`, but no path that creates a package ever reached that value: the cloud control
plane gives a new package `org` when the create request omits the key, and
`os package publish` used to send `org` itself. The declared default now matches what the
runtime does: `org`, which makes a package published from one environment installable in
the owner organization's other environments.

- **What changes:** `PackageSchema.parse(row)` on a row with no `visibility` now returns
  `visibility: 'org'`. A row that names `private`, `org` or `marketplace` is read exactly
  as before, and any other value is still refused.
- **What does not change:** the accepted values, and `CreatePackageRequestSchema.visibility`,
  which stays optional with no default. A create request that omits the key reaches the
  control plane without it, and the control plane's default applies.
- **If you relied on the old default:** pass `visibility: 'private'` explicitly.
