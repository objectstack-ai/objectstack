---
"@objectstack/spec": minor
---

`CLOUD_PROVIDED_OBJECT_NAMES` (`@objectstack/spec/system`) gains a member:
`sys_environment_credential`. `isPlatformProvidedObjectName('sys_environment_credential')`
now returns `true`, so a reference to that name resolves instead of being
diagnosed as a platform-prefixed name nothing registers (#18309).

This widens an accept set. The list is a closed set and the name was not in it,
so the object-reference ladder now accepts a value it used to warn on, and the
widening reaches every surface that consults the predicate: a dataset `object`,
an action parameter `reference`, a field `reference`, a dashboard
`optionsFrom.object`, a navigation `requiresObject` and a translation
`objects.<name>` subtree naming `sys_environment_credential` all stop being
diagnosed.

Why this name: `@objectstack/service-tenant` registers it in the cloud
repository on exactly the path the list's existing `sys_package`,
`sys_package_version` and `sys_package_installation` members take —
`objects/sys-environment-credential.object.ts` exported through
`objects/index.ts`, listed in `tenantObjects`, spread into
`manifestService.register({ objects })` by `tenant-plugin.ts`.

Unlike the earlier additions, this one fixes no diagnostic that fires today: no
`*.object.ts` in this repository references the name, so nothing shipped was
being mis-diagnosed. What was wrong is the registry's own claim about the name.
This repository's governed records already treat the object as real — ADR-0007's
inventory table lists it as existing, and ADR-0131 cites a measured cross-tenant
read of its rows — while the list that decides whether a reference resolves said
no package registers it. The first author to write the reference would have been
told it looked like a typo.

One entry is added; no other member moves and nothing is removed or narrowed.
The cloud-side half of the contract — that `@objectstack/service-tenant`
registers the table — is owned by the cloud repository per the list's header and
is not asserted from here.
