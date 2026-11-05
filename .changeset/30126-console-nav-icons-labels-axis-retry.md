---
'@object-ui/layout': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-charts': patch
'@object-ui/console': patch
---

fix(console): a nav entry with no icon draws its object's icon, record field labels read in one style, a count chart fits a small count, and a page whose entry failed to load retries (#30126)

Clause-②: yes (widening)
Metadata-protocol: none

- **Navigation icons.** An app navigation entry of type `object` that names no `icon` now draws the icon its object declares, in the sidebar and in the `nav:menu` page block. Before, every such row drew the same generic page icon, so an app whose navigation names no icons showed one icon down the whole sidebar. The icon is read by object name from the metadata the console already holds, so no request is added and the navigation is not written to. An authored `icon` wins, and an object with no icon, a dashboard, page or report entry, and a host with no resolver keep the generic icon. `@object-ui/layout` exports `resolveNavItemIcon`, the types `NavIconTarget` and `NavTargetIconResolver`, and an optional `resolveTargetIcon` prop on `NavigationRenderer`, alongside the existing `resolveTargetLabel`.
- **Record field labels.** A record page's section field labels no longer carry an uppercase transform. Only Latin text took it, so in a zh console an untranslated label (`REPAIR COST`) read in capitals beside a translated one (`负责人`). Section labels now render as authored, in the style of the highlights strip above them.
- **Small count charts.** A count axis whose largest value is a small whole number (1 to 3) now tops out at that number, so a chart of one record draws its bar to the top of the axis instead of a quarter of the way up a 0–4 axis. An axis with an authored `min`, `max` or `stepSize`, fractional values, or a count of 4 or more draws as before.
- **Boot retry.** When the page's entry script fails to load before anything mounts (the server went away between serving the page and serving its entry, as during an `os dev` restart), the page now reloads itself, backing off from 1 second and doubling, at most five times per tab. Before, the loading splash stayed forever. The count is cleared on the first mount, and where `sessionStorage` cannot be read nothing retries.
