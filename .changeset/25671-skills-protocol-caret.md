---
'@objectstack/skills': patch
---

docs(skills): the objectstack-platform stack-config example declares `engines: { protocol: '^18' }`, the major the 18.x boot handshake accepts

Clause-②: no
Metadata-protocol: none

`objectstack-platform/SKILL.md` taught `engines: { protocol: '^17' }` in its `defineStack` manifest example while `PROTOCOL_VERSION` is `18.0.0`, so a config copied from the skill was refused at boot (`OS_PROTOCOL_INCOMPATIBLE`). The example, the eval that pins it (`evals/config-plugins-ops.json`, prompt and expected output together) and the `objectstack-upgrade` sentence describing what the scaffold writes now all say `'^18'`, matching `create-objectstack` and every example app. The `'^17'` → `--from 17` worked example in `objectstack-upgrade` is unchanged.
