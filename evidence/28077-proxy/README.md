# Proxy preview review evidence for objectstack#28077, #28078, #28079 (never merged)

Proxy preview review (proxy for epic:#26676#1, ruling 6520722066 on #26676) of PR #28141 at head `b832e42c`,
against the in-repo CRM example (`examples/app-crm`, `objectstack dev --seed-admin --fresh`, console on its Vite dev server),
in Chromium (Playwright), Contacts.

Made by a context-free review subagent whose only inputs were the three cards' Acceptance and the live console.

- `shots/` — screenshots, named by card.
- `readings/` — raw per-scenario readings (`c28077.out`: per-frame sidebar widths from the first frame; `c28078.out`: state before/after one Esc; `c28079.out`: state through resize, keep-open and reload).
- `scripts/` — the Playwright scripts that produced them.

Verdict: PASS on every Acceptance checkbox of the three cards.
