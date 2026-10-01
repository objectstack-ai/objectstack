---
'@objectstack/lint': patch
---

Authoring a key whose liveness-ledger verdict is `dead` now draws a `liveness-dead-property` warning, and a `live-elsewhere` key a `liveness-live-elsewhere-property` warning, with no per-row `authorWarn` opt-in: the verdict itself is the warning (#16094). Before this, both rule ids were exported and never produced, because no shipped `dead` or `live-elsewhere` row opted in.

**Which keys warn.** A ledger row warns when its status is `dead`, `live-elsewhere` or `experimental`, or when it sets `authorWarn: true` (still the only way a `planned` row warns). The finding's hint is the row's `authorHint`, else its `note`. Among authorable keys (not `retiredKey` tombstones) in the metadata types the rule walks, four are `dead` today: a view container's own `name` and `label` (the `defineView` container, not `list.label`), and a permission set's `rowLevelSecurity[].label` and `rowLevelSecurity[].description`. No walk visits `manifest`, `connectors` or realtime subscriptions, so their rows still warn nobody. That includes `manifest.runtime`, the one `live-elsewhere` row.

**Retired keys.** A `retiredKey` tombstone keeps its `dead` row. Every command that parses (`os validate`, `os build`, the runtime publish gate) still refuses the key first, so it gets no second report. `os lint` does not parse: a config it accepts without `defineStack` that carries a retired key now gets a `liveness-dead-property` warning where it got nothing.

**What changes for a project.** Nothing is refused, and every command exits as before without `--strict`. Under `os lint --strict` and `os validate --strict` a new warning fails the run, as every warning does. Measured on a stack that was clean under both before this change: authoring a view container `label`, or a policy `label` plus `description`, takes both commands from exit 0 to exit 1. Across this repository's examples, `app-showcase` gains two warnings (the `showcase_contributor` permission set's policy `label` and `description`). `app-crm`, `app-todo` and `app-multi-package` gain none. No example's exit code changes. To clear the warning, delete the key: the ledger has measured that nothing reads it.
