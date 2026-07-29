---
"@objectstack/console": minor
---

Console (objectui) backfill for `2cb8d78e24ad...c6cfdf1288b6` — the one refresh in
the v17 window that landed with no changeset.

`scripts/bump-objectui.sh` emits a `@objectstack/console` changeset on every bump
precisely so a SHA move leaves a trace (see `docs/releases-maintenance.md`). One
bump in this window did not, so 25 commits — including two breaking ones — were
absent from the release history and from the curated v17 page. This entry records
them after the fact; it declares no new SHA move (`.objectui-sha` already points
past this range at `4a4829d0ef39`).

Frontend changes in this range:

- feat(react)!: trim dead device/preference delegates from useClientNotifications (objectstack#3612 companion) (#2862)
- feat(types)!: drop the ObjectStack/ObjectOS/ObjectQL/ObjectUI Capabilities re-exports (#2860)
- feat: gate detail/form edit & delete on the server's effective operation set (framework#3546) (#2832)
- feat(app-shell): approver values become record lookups (framework#3508) (#2834)
- feat(console): group tenancy posture affordances — org switcher as write context + org attribution (ADR-0105 Phase 1) (#2858)
- feat(console): i18n the system-settings hub (objectui#2851 P2) (#2859)
- fix(dashboard,charts): resolve `{current_user_id}` in widget filters (framework#3574) (#2857)
- fix(grid): validate email format in the import preview (objectstack#3566) (#2840)
- fix(fields): consistent image-field rendering + click-to-zoom (#2836) (#2837)
- fix(app-shell): stop the flow-node repeater from committing during render (#2838) (#2839)

Plus 15 dependency bumps, three of them major for the Console's own build:
`maplibre-gl` 5→6, `chalk` 5→6, `jsdom` 29→30 (dev).

objectui range: `2cb8d78e24ad...c6cfdf1288b6`
