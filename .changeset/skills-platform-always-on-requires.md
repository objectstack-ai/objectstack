---
'@objectstack/skills': patch
---

docs(skills): the platform skill's `requires:` table marks the always-on tokens

Clause-②: no
Metadata-protocol: none

`objectstack-platform`'s `### requires:` no longer calls every listed service opt-in. The table marks each token of `PLATFORM_ALWAYS_ON_CAPABILITIES` (`queue`, `job`, `cache`, `settings`, `email`, `storage`, `sms`, `sharing`, `messaging`, `analytics`, `package-registry`) with °, and the lead says every boot mounts them, listed or not, while `--preset minimal` drops exactly those. The `auth` → `email` rule now says it holds under `--preset minimal` too, and the `triggers` + `job` pairing is scoped to `--preset minimal`. The skill's eval for silent scheduled flows and notifications no longer expects `job` and `messaging` in `requires:`, and a new eval case asks whether an always-on service must be listed. The platform behaviour already shipped; this release only teaches it.
