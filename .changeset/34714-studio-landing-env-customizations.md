---
'@object-ui/i18n': patch
---

feat(console): the Studio landing lists every change this environment made to its installed apps in one panel

Clause-②: yes (widening)
Metadata-protocol: none

The Studio landing gains a **Customizations in this environment** panel under the installed apps, so "what did we change here" no longer means opening each app.

- One row per change, read from each installed app's customization read (`GET /api/v1/packages/:id/customizations`, the read its card already makes): items the app's customization package overrides read **Changed**, fields, validation rules and indexes it adds read **Added**, the app's items switched off in this environment read **Switched off**. What other packages contribute is not this environment's change and makes no row.
- Each row names the item (its label where the app's list gives one, else its name), its kind and its app, and opens it in Studio.
- Tabs narrow the list (All, New fields, Forms and views, Flows, Switched off), a search narrows it by text, and the rows can be grouped by app. The first six rows show; the rest are behind "Show all".
- The panel's total equals the cards' "customized" plus "switched off": one read per app now serves both the card and the panel.
- With no change anywhere the panel is one line. An app whose read fails (a 403 included) is named as unreadable, never counted as 0.

New keys under `engine.studio.landing.envCustomizations.*` in the studio namespace (en, zh). No server change.
