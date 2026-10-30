---
'@object-ui/plugin-dashboard': patch
'@object-ui/i18n': patch
---

fix(plugin-dashboard): a viewer whose every dashboard tile is refused sees one no-access panel, not an empty canvas

Clause-②: no
Metadata-protocol: none

A tile whose data the viewer may not read is left out of the dashboard outside design mode. When every tile was left out, the viewer saw the dashboard's header over an empty canvas, with no message. `DashboardRenderer` now draws one no-access panel in the canvas in that case (lock icon, "You don’t have access", "You don’t have permission to view the data behind this dashboard."), the same face the console shows for a dashboard the viewer may not open. The header, its description and the refresh control stay as they are.

- A partial refusal is unchanged: the refused tiles leave, the rest reflow, no message.
- In design mode every tile stays and draws its own no-access state; no panel.
- A failure that is not a read refusal keeps every tile and its error; no panel.
- A dashboard with no widgets draws no panel.
- `@object-ui/i18n` adds `dashboard.allWidgetsForbiddenMessage` in all ten locales.
