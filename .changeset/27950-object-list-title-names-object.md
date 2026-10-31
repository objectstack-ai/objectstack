---
'@object-ui/app-shell': patch
---

feat(app-shell): an object list's title names the object ahead of the view switcher

Clause-②: no
Metadata-protocol: none

The Console list title has been the view switcher, 「VIEW ▾ · COUNT」, and the app bar draws no object crumb, so with the sidebar collapsed to its rail or the list opened from a link nothing on the page said which object it listed. The title now reads 「OBJECT / VIEW ▾ · COUNT」: the object's plural label, in the reader's language, comes first and links to the object's default list (`/apps/APP/OBJECT`, which opens the reader's pinned view or the declared default).

- A view with no `label` is already called by the plural, so its title reads the plural alone.
- Where the row is short, the object's label never shrinks; the view's label truncates first.
- On a phone the app bar's view switcher reads 「OBJECT / VIEW」, so the view's label is the part cut at the end.
- The app bar is unchanged: it still draws no crumb on an object's list, view or record route. The record page's own header is unchanged.
