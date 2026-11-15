---
'@object-ui/console': patch
---

perf(console): the first load no longer downloads the Setup pages, the package form and the view config panel

Clause-②: no
Metadata-protocol: none

Every Console route, a dashboard included, used to download the Packages page with its package form dialog, the permission-set editor, the Setup pages for packaged actions, connector credentials, connector connections, position holders, permission-set assignment and the recycle bin, and the list view's config panel with the Studio form widgets it draws, before the app asked for any data. These now load the first time they are drawn: a Setup page when its entry is opened, the view config panel as a list mounts. The Console's eager closure (`dist/eager-closure.json`) goes from 2,293,387 to 2,163,688 bytes gzipped (−129,699), measured on two builds of the same tree. What each route draws is unchanged; a Setup page shows a one-line loading notice while its code arrives.
