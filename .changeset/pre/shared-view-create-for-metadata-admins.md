---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

A shared list view is offered only to an administrator who may write one, and it is shared at once. Add view offers Shared only to an administrator whose session holds `manage_metadata`, the capability the shared view's write door asks; an organization administrator without it is no longer offered a Shared choice the server answers `403`. A view created Shared is saved and published in one act, so everyone sees it on their next read instead of waiting behind a draft; a refused save publishes nothing. A reader who opens a view the server says no longer exists is told so once, and the list shows its default view. Two new `@object-ui/i18n` keys under `view.switcher` carry the notices in every locale.
