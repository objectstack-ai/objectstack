---
"@objectstack/spec": patch
---

`sys_package_version` is now registered in `CLOUD_PROVIDED_OBJECT_NAMES`
(`@objectstack/spec/system`), so `isPlatformProvidedObjectName('sys_package_version')`
returns `true` and a reference to it resolves instead of being flagged as a
platform-prefixed name nothing registers (#16745).

The list already carried `sys_package` and `sys_package_installation` — the head
and tail of the three-table package family that `cloud/package.zod.ts` declares —
but not the release-snapshot table between them, whose row schema this repository
ships as `cloud/package-version.zod.ts`. Platform metadata that ships with the
product references the name: `sys_metadata.package_version_id` in
`@objectstack/metadata-core` is a `Field.lookup('sys_package_version', …)`. Against
the list's own stated purpose ("Listed here so a cloud-targeted stack is not told
its references are fictional") that shipped lookup target was being judged
fictional, and the same misclassification reached any dataset `object`, action
parameter `reference`, dashboard `optionsFrom.object` or navigation
`requiresObject` naming it.

One entry is added; no other member moves. The cloud-side half of the contract —
that `@objectstack/service-tenant` registers the table — is owned by the cloud
repository per the list's header and is not asserted from here.
