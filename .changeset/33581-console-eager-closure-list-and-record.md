---
'@object-ui/console': patch
---

perf(console): the first load no longer downloads the object list, the record view and the list view package

Clause-②: no
Metadata-protocol: none

Every Console route, a dashboard included, used to download the object list (the default list and a saved list view), the record view its drawer draws, and `@object-ui/plugin-list` (the list view and the gallery) before the app asked for any data. The object list now loads like the other route pages, its download starting as soon as the route is known; the record view loads the first time a record opens in the drawer; and the `list-view`, `view:list` and `object-gallery` registrations are lazy stubs that load the package the first time a schema names one of them. The Console's eager closure (`dist/eager-closure.json`) goes from 2,165,721 to 2,060,434 bytes gzipped (−105,287). What each route draws is unchanged; a record opened in the drawer shows the detail skeleton while its code arrives.
