---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

Only an administrator shares a list view, and a shared view is shared at once. The view dropdown offers Shared in Add view, 「Make shared」 on the reader's own views and 「Unshare」 on a shared view saved in the app only to an administrator whose session holds `manage_metadata`, the capability the shared view's write door asks; an organization administrator without it is no longer offered a Shared choice the server answers `403`. A view created shared, or made shared, is saved and published in one act, so everyone sees it on their next read instead of waiting behind a draft. 「Make shared」 publishes the reader's view under a free key and removes it from My views; 「Unshare」 moves a shared view into the administrator's My views and deletes the shared one, and takes the copy back when the server keeps the view. A view the object authors, a read-only package ships or a package view's customization is never offered 「Unshare」. A reader who opens a view the server says no longer exists is told so once, and the list shows its default view. New `@object-ui/i18n` keys under `view.switcher` carry the new labels and notices in every locale.
