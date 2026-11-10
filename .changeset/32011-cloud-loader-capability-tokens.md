---
'@objectstack/spec': minor
---

feat(spec): `requires` accepts `audit-compliance` and `access-policy-console`, two capabilities cloud's runtime loader resolves, beside `governance`

Clause-②: yes (widening: two new accepted `requires` tokens)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-platform/SKILL.md (its Enterprise / cloud bullet names `ai-seat` and `governance` as the cloud-resolved tokens and now omits these two); no `content/docs/**` sentence lists the cloud-loader tokens

- **`PLATFORM_CAPABILITY_TOKENS`** gains `audit-compliance` and `access-policy-console` in the enterprise / cloud-runtime group, so `defineStack({ requires: ['audit-compliance'] })` and `requires: ['access-policy-console']` are accepted at authoring time. Near misses such as `audit_compliance` or `access-policy` are still refused as unknown capabilities (`STACK_CAPABILITY_UNKNOWN`).
- **`PLATFORM_CAPABILITY_PROVIDERS`** gains a row for each in `governance`'s shape: `package: null`, `edition: 'cloud'`, with the notes `cloud audit-compliance tier` and `cloud access-policy console`. This repository installs nothing for either token, so, exactly as for `ai-seat` and `governance`, the `os build` / `os validate` preflight classifies both as unavailable under the open edition and fails with "provided only by a cloud runtime", while `objectstack serve` mounts nothing for them and stays quiet. A stack that declares one is meant for a cloud runtime whose loader provides it.

Nothing that parsed before parses differently.
