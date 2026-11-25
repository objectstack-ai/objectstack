---
'@objectstack/skills': patch
---

docs(skills): the objectstack-platform stack-config example declares `engines: { protocol: '^19' }`, the major the 19.x boot handshake accepts

Clause-②: no
Metadata-protocol: none

`PROTOCOL_VERSION` moves to `19.0.0`, and a 19 runtime refuses a manifest that declares `'^18'` at boot (`OS_PROTOCOL_INCOMPATIBLE`). The `objectstack-platform` `defineStack` example, the eval that pins it (`evals/config-plugins-ops.json`, prompt and expected output together) and the `objectstack-upgrade` sentence that says what every scaffold and example writes now say `'^19'`. The upgrade skill's worked examples (`'^17'` → `--from 17`, the `--to 18` acceptance replay of the last ported hop) are unchanged: no conversion is registered at step 19, so the chain an author replays still ends at 18.
