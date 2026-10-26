---
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(plugin-list,plugin-grid): an empty list tells "no records you can see" and "nothing of yours yet" apart from "no records"

Clause-②: no
Metadata-protocol: none

An empty list chose its copy from the user's query and the view's filter alone. A member who may read none of an object's records and may not create one was told "Nothing here yet / Create your first record to get started." beside no Create button, and every "my …" view (`owner` equals the current user) told someone who owns nothing "No records match this view's filter."

- **No filter, no create grant.** When the permission answer has loaded and the caller does not hold the create grant (the `listNew` row of the affordance-to-grant map, the verdict the page's own New reads), the empty state reads "No records you can see" and asks the reader to contact an administrator. The add-record action is not drawn for that caller, even on a view that enables `addRecord`.
- **A filter naming the signed-in user.** When the view's declared filter compares a field to the caller's own id (or still carries the `{current_user_id}` placeholder), the empty state reads "Nothing of yours yet", with the add-record action only under the create grant.
- **Unchanged.** The first-run copy and action for a caller who may create, the user-query and view-filter copy, an authored `emptyState`, the 403 error panel, and every surface with no permission provider mounted.

`ListView` (grid and gallery), the standalone `ObjectGallery` and `ObjectGrid`'s default empty state decide the same way. `@object-ui/i18n` gains `list.ownedNoneTitle`, `list.ownedNoneMessage`, `list.noneVisibleTitle` and `list.noneVisibleMessage` in all ten locale packs.

What to do: nothing. A view that authors its own `emptyState` keeps it.
