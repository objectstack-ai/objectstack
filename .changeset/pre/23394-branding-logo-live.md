---
'@objectstack/spec': patch
---

fix(spec): the liveness ledger reads `app.branding.logo` as `live`, citing the console's `AppMark` reader (#23394)

Clause-②: no

**What was wrong.** The liveness ledger shipped with `@objectstack/spec` graded `app.branding.logo` `planned`, with a note saying no mounted component rendered it. The console now does: objectui's `AppMark` draws `branding.logo` as the app's square icon on the top-bar app pill, on each App Switcher row and in the phone drawer header.

**What changes.**

- `liveness/app.json`: `branding.logo` reads `live`, citing `AppMark` and the two shell components that mount it at the `.objectui-sha` pin. The designer pages that write the key stay cited as its `producer`. The `branding` container's note says the same.
- `liveness/state-counts/app.md` is regenerated: `app` moves from `live 50 · planned 1` to `live 51 · planned 0`.

Unchanged: what `AppSchema` accepts and refuses (an app-level `logo` is still refused, and the refusal still points at `branding`), and every other ledger row.
