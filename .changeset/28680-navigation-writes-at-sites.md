---
'@object-ui/app-shell': patch
---

perf(console): write app navigation where a page or dashboard is created or deleted, and stop reading the whole `/meta/page` and `/meta/dashboard` lists on every app page

Clause-②: no
Metadata-protocol: none

`NavigationSyncEffect` read both lists on every app page after the first paint, only to diff their name sets and add or remove navigation entries. The console's sites now write navigation themselves:

- **The metadata editor's Publish** adds a package-less page or dashboard to every writable app the first time it is published (the draft was its only layer). A later publish of the same item is an update and writes nothing.
- **The metadata editor's Delete** removes a package-less page or dashboard from every writable app when the delete leaves no baseline. A reset to a packaged baseline writes nothing.
- **Publish all** asks each package-less page or dashboard draft's layers before publishing it, and adds the ones it creates to navigation.

The diff's rules are kept: platform artifacts (a `sys_` name, or `_packageId` / `_provenance: 'package'`) never write navigation, write-protected apps are skipped, and nothing is written in draft preview. A create no longer adds a second entry to an app that already references the page or dashboard.

What no longer reaches navigation: a package-less page or dashboard created or deleted outside this tab (a server-side agent, another tab, a raw REST call). The diff noticed one only when it appeared in this tab's list mid-session; it now reaches navigation only through its own writer. Items from a package install or a CLI deploy carry `_packageId` and never reached navigation through the diff.

`NavigationSyncEffect` is removed. `@object-ui/app-shell` is private and nothing outside it imported the effect.
