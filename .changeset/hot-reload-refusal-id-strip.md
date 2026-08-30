---
"@objectstack/core": patch
---

`HotReloadManager`'s refusal messages — the plugin-registration doors for retired `stateStrategy` values and removed config keys, and the `startWatching()` removal notice — no longer cite internal tracker ids. The prescriptions keep their customer-resolvable anchors (ADR-0049 enforce-or-remove, the `@objectstack/spec` / `@objectstack/core` versions, and the `scheduleReload` migration call); the `#NNNN` tokens, which resolve to nothing for the host author reading the refusal, are gone.
