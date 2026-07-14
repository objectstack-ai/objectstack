---
"@objectstack/console": minor
---

chore(console): refresh vendored `@object-ui/console` SPA to objectui@95835581

Bumps the pinned `.objectui-sha` from `2f3ab55a` to `95835581` (11 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

Notable upstream changes pulled in:

- feat(console-ai): ChatDock — right-docked AI rail, now DEFAULT ON with the flag as a kill-switch (ADR-0057 P3 go-live), FAB launcher, `/ai` maximized dock + Studio right-dock reflow, bind-on-create conversations
- feat(plugin-gantt): #2460 interactive batches — row single-click locate / double-click detail, day-snap drag, layout with tray + filters, mobile QR code, lock hints
- feat(plugin-gantt): summaryExtent 'self' + tooltip fallback formatting when no schema
- fix(plugin-gantt): delete-dialog i18n, dependency candidate search box, exclude group/locked from summary
- fix(auth): login silent-failure UX — SSO pending states, redirect-URL contract, OAuth callback error banner
