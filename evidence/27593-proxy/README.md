# Proxy preview review evidence for objectstack#27593 (never merged)

Post-merge proxy preview review (proxy for epic:#26676#1, ruling 6520722066 on #26676) of PR #27893,
run on `main` at `18318361f74f8b1d1623f333efa9216bbd3a7170`, against the in-repo CRM example
(`examples/app-crm`, `objectstack dev --seed-admin --fresh`, console on its Vite dev server), in Chromium (Playwright).

The review was made by a context-free subagent whose only inputs were the card's Acceptance
(`acceptance.md`), the PR's "What to look at" list (`what-to-look-at.md`), the v4 design boards
(`git show a7825499aa:docs/design/record-page-v2-2026-10-27/v4/…`), and the console URL and sign-in.

- `shots/` — screenshots, named by point (`p1-` … `p5-`) and `board-*` for the boards.
- `readings/` — the measured boxes (`readings.json` is the summary plus all raw readings).
- `scripts/` — the Playwright scripts that produced them.
