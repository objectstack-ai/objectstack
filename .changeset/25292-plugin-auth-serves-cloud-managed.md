---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): `GET /api/v1/auth/config` serves `features.cloudManaged`

Clause-②: yes (widening)
Metadata-protocol: none

The public auth config's `features` gains `cloudManaged`, a boolean read from `isCloudManaged()` in `@objectstack/core` (true when the process runs with `OS_CLOUD_MANAGED=1`). It is `false` on every other deployment. The console reads it to hide the doors that add people by hand (invite, create user, set password) in a cloud-managed environment, whose people arrive from the organisation's identity provider.

What to do: nothing. The payload only gains a key.
