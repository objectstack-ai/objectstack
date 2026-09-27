---
"@objectstack/spec": patch
---

Liveness ledger: three rows that were graded `planned` are now `live`, because objectui reads them at the `.objectui-sha` pin this repo builds against. Ledger evidence only. ⛔ No schema, parse or accept-set change.

The ledgers ship inside this package (`files[]` includes `liveness`), and `@objectstack/lint` reads them. What changes is the row data an upgrading reader or tool consults. `@objectstack/lint` warns on a `planned` row only when the row sets `authorWarn`, and none of these three rows does, so its output does not change.

- **`action.onSuccess.navigate` and `action.onSuccess.openIn` are `live`.** The console's action runner performs the declared post-success hop after an `api` or `script` action succeeds. It interpolates `navigate` with the `${param.*}`, `${ctx.*}` and `${result.*}` scopes, refuses a URL that is neither http(s) nor relative, and opens a new tab only on `openIn: 'newTab'`, so the materialized `'self'` default has one source of truth. The action renderers and the declared-actions bar forward the block to the runner, and the console wires the runner's navigation to its router. Both rows had been `planned` since the contract landed spec-first ahead of this reader.
- **`translation.flows.screens` is `live`.** The console's screen-flow runner draws each screen's heading and each field's `label` / `placeholder` from `flows.<flow>.screens.<node_id>` in the active language, and falls back to the authored string key by key. The bundle reaches it through the translations route and the console's language loader.
- **`translation.flows.label` stays `planned`.** Nothing reads it yet. The `flows` group's `authorWarn` stays too, so `os lint` output is unchanged and the i18n coverage demand for `flows.*` stays held back.
- `state-counts.md` is regenerated: `action` has 46 live and 0 planned (was 44 and 2); `translation` has 23 live and 1 planned (was 22 and 2).
