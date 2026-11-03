---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

Clause-②: yes
Metadata-protocol: none

An app whose entries live only under `areas` now opens on its first entry there, and an app whose menu holds only links or actions now says it opens from its menu, instead of an empty page (#29771).

- The app root walks the top-level navigation, then each area's navigation in order. It opens the first object, page, dashboard, report or component entry the member is shown in any of them, and only then the first doc entry. A working entry in an area therefore outranks a doc in the top-level navigation.
- When every entry the member is shown is a `url` or `action` link, the root draws an empty state that says the app opens from its menu (`AppNoAccessEmptyState`, reason `menu-only`). It offers no Setup link: the member has access.
- `@object-ui/i18n` adds `empty.appOpensFromMenu` and `empty.appOpensFromMenuDescription` to all ten locale packs.
- The app designer's preview names the same landing as the console, areas included.
