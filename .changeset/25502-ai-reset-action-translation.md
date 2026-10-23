---
'@objectstack/service-settings': patch
---

fix: Setup → AI's "Reset to environment defaults" button is now translated in zh-CN, ja-JP and es-ES

Clause-②: no
Metadata-protocol: none

The `ai` settings manifest declares an `action_button` with id `reset`, but no locale bundle carried `settings.ai.actions.reset.label`, so the button rendered in English beside its translated siblings. The bundles now carry it (en, zh-CN, ja-JP, es-ES).

The settings translation coverage test now reads every manifest's `action_button` labels: each shipped non-English locale must carry `settings.<namespace>.actions.<id>.label` for every action button, and no bundle may carry action copy for a button no manifest declares.
