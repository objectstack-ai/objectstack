---
'@object-ui/app-shell': patch
---

fix(app-shell): a new report made from an app's reports list is saved in the app's package, as a new view is

Clause-②: no
Metadata-protocol: none

Studio redesign (epic #36890).

- **New report from an app's reports list** now saves the report where a new view made in that app is saved: in the app's package when it is writable, or, for an installed app, in its customization package, so Studio's report list for that package shows it. Before, a report made this way belonged to no package. Reports opened from Studio's report list were already saved this way.
- **Where the app's customization package cannot be used** (for example, the deployment does not let a tenant administrator create one), the report is saved outside any package, as before, and a notice says Studio's report list does not show it. A new view falls back the same way.
- **Existing reports are not moved.** Only reports created from now on are placed in the app's package.
