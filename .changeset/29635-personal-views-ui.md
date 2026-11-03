---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): a list's view switcher lists the reader's own views (My views), and any reader can save the list on screen as one, rename it, delete it and pin it as their default

Clause-②: yes (widening)
Metadata-protocol: none

The Console list's view switcher reads the signed-in reader's own `sys_personal_view` rows for the object through the data API, filtered to their own rows, and lists them in a **My views** section beside the views the packages and the environment declare. **Save as my view**, at the end of the dropdown, is offered to any reader the server lets save one, not to administrators only: it saves the open view's body with the reader's filter, sort, grouping, column order, hidden columns and density laid over it, as a spec `ListView` bound to the object (the shape the view config panel saves), and opens it. Each of the reader's rows offers **Rename** (a data API update of its `label`) and **Delete**, which goes through the owner's own-row door `DELETE /api/v1/personal-views/:id`, never the data API's delete. The row's 📌 is the existing per-object pin, so a pinned personal view is the reader's default and the next open resolves it; a pinned or addressed view that has since been deleted falls back to the default view with no error. A reader whose read is refused (an external member, today) is offered neither the section nor the save. While the reader's views are read, the list waits only when the address or the pin names a view it does not hold yet; any other open paints at once.

The widening is three new `view.switcher` keys in every `@object-ui/i18n` locale pack (`myViews`, `saveAsMyView`, `myViewName`). The switcher's new optional props are module-internal: `@object-ui/app-shell`'s entry does not export the switcher.
