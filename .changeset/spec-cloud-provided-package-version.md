---
"@objectstack/spec": minor
---

`CLOUD_PROVIDED_OBJECT_NAMES` (`@objectstack/spec/system`) gains a member:
`sys_package_version`. `isPlatformProvidedObjectName('sys_package_version')` now
returns `true`, so a reference to that name resolves instead of being flagged as
a platform-prefixed name nothing registers (#16745).

This widens an accept set. The name was previously refused, the list is a closed
set, and nothing in the published header enumerated this member — so the ladder
now accepts a value it used to warn on, and the widening reaches every surface
that consults the predicate: a dataset `object`, an action parameter
`reference`, a dashboard `optionsFrom.object` and a navigation `requiresObject`
naming `sys_package_version` all stop being diagnosed.

Why this name and not another: the list already carried `sys_package` and
`sys_package_installation` — the head and tail of the three-table package family
that `cloud/package.zod.ts` declares — but not the release-snapshot table
between them, whose row schema this repository ships as
`cloud/package-version.zod.ts`. Platform metadata that ships with the product
references it: `sys_metadata.package_version_id` in `@objectstack/metadata-core`
is a `Field.lookup('sys_package_version', …)`.

One entry is added; no other member moves and nothing is removed or narrowed.
The cloud-side half of the contract — that `@objectstack/service-tenant`
registers the table — is owned by the cloud repository per the list's header and
is not asserted from here.
