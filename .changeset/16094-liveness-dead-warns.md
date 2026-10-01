---
'@objectstack/lint': minor
---

Authoring a key whose liveness-ledger verdict is `dead` now draws a `liveness-dead-property` warning, and a `live-elsewhere` key a `liveness-live-elsewhere-property` warning, with no per-row `authorWarn` opt-in: the verdict itself is the warning. Before this, both rule ids were exported and never produced, because no shipped `dead` or `live-elsewhere` row opted in.

Clause-②: no

**Which keys warn.** A ledger row warns when its status is `dead`, `live-elsewhere` or `experimental`, or when it sets `authorWarn: true` (still the only way a `planned` row warns). Among authorable keys in the metadata types the rule walks, four are `dead` today: a view container's own `name` and `label` (the `defineView` container, not `list.label`), and a permission set's `rowLevelSecurity[].label` and `rowLevelSecurity[].description`. No walk visits `manifest`, `connectors` or realtime subscriptions, so their rows still warn nobody. That includes `manifest.runtime`, the one `live-elsewhere` row.

**The hint.** A row that warns only because of its `dead` or `live-elsewhere` verdict shows its `authorHint`, else the verdict's default hint: "Remove it — it is declared in the spec but not consumed at runtime." for `dead`. It never shows the ledger's internal `note`. Rows that opt in with `authorWarn`, and `experimental` rows, show exactly the hint they showed before.

**Retired keys.** A `retiredKey` tombstone keeps its `dead` row. Every command that parses (`os validate`, `os build`, the runtime publish gate) still refuses the key first, so it gets no second report. `os lint` does not parse: a config it accepts without `defineStack` that carries a retired key now gets a `liveness-dead-property` warning where it got nothing.

**What changes for a project.** Nothing is refused, and nothing changes without `--strict`. `os lint --strict` and `os validate --strict` now exit 1 instead of 0 on a stack that was otherwise warning-clean and authors a view container `label` or `name`, or a row-level-security policy `label` or `description`. A view container that carries its own `name` and `label` beside its `object` binding is one such shape: it draws two warnings per container, and under `--strict` that flips the exit. Across this repository's example apps, only `app-showcase` gains warnings: two, on one permission set's policy `label` and `description`, and no example's exit code changes. To clear the warning, delete the key: nothing reads it.
