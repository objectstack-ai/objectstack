# Evidence for objectstack#27593 (never merged)

Console sidebar fold, measured on the code of branch `claude/project-thread-oakpit` at `fdb717eabb`,
in Chromium (Playwright), against the in-repo CRM example (`examples/app-crm`, Contacts list),
backend `objectstack dev --seed-admin --fresh`, console served by its Vite dev server.

- `1280-rail.png` — 1280 px window: the sidebar mounts as the 48 px icon rail; content 1232 px wide.
- `1280-overlay.png` — after a click on the rail's background: the sidebar is 256 px over the page
  (z-index 40); the in-flow gap stays 48 px and the content stays 1232 px wide at x = 48.
- `1440-unchanged.png` — 1440 px window: expanded 256 px beside the content (1184 px), as before.
- `700-drawer.png` — 700 px window: the phone drawer after the trigger.
- `readings.json` — the measured boxes for each state (also after Esc, the app bar trigger, an outside press).
- `evidence.cjs` — the script that produced them.
