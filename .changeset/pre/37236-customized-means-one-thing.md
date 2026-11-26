---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): "customized" means one thing everywhere; Setup → Packages names an app's arrangements apart

Clause-②: no
Metadata-protocol: none

In Setup → Packages, an installed app's "Customizations in this environment" line now counts as customized only the items this environment changed or added on the app (overrides and extensions), the same number the All metadata header shows and the same rule its lists' 「customized」 filter uses. Tab, field-group and action-layout arrangements are not counted as customizations any more: they are named on their own in the same line, and only when there are any — for example "3 customized, 2 rearranged, 1 switched off" (「已定制 3 项，调整排列 2 处，已停用 1 项」).

An app whose only change is an arrangement now reads "0 customized, 2 rearranged, 0 switched off" instead of "2 customized", and still lists both arrangements under the section's 「布局」 tab. The All metadata header and the 「customized」 filter are unchanged.
