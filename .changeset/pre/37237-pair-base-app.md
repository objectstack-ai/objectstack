---
'@object-ui/app-shell': patch
---

fix(studio): a customization package's dashboard or report opens in its base app's edit state

Clause-②: no
Metadata-protocol: none

A dashboard or a report opened from a Studio list already opens in its app's edit state: the dashboard in edit mode, the report in its builder. A customization package (`<base>.custom`, where an installed app's customizations are saved) ships no app of its own, so its dashboards and reports stayed on Studio's generic item page. They now open in the base package's app, picked the same way as for any package: the app you came from when it is one of the base's, otherwise the base's first app. The app page's × goes back to the Studio list you left.

A customization package whose base has no published app keeps the generic item page. A customization package that does publish an app of its own opens there, as before. Every other package is unchanged. No props, exports or routes change.
