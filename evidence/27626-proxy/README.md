# #27626 / PR #27907 — post-merge proxy preview review evidence (never merged)

Context-free preview review, the proxy for `epic:#26676#1` under the #26676 ruling B (comment 6520722066).

- Console: `main` at `18318361f74f8b1d1623f333efa9216bbd3a7170` (carries #27907 as `40be9b59`), `examples/app-crm`, `objectstack dev --seed-admin --fresh` plus the console's Vite dev server, signed in as the seeded admin, 1440×900, headless Chromium.
- `01`–`28`: the review subagent's screenshots and request logs (Playwright; the bell runs over raw CDP, because Playwright keeps every page `visible`).
- `29-bell-hidden-12min-tab.json`: the seat's follow-up run on the hidden-tab point. The page is hidden for 12.7 minutes as a background tab. `visibilityState` reads `hidden` for the whole run. The bell feeds poll every 60 s for the first 10 minutes of the hide, then stop. They read once at once when the page is shown again.
- `scripts/`: the scripts that produced the logs.
