---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the sidebar's object entry offers Object settings in place of Design, and dashboard and page entries no longer offer Design

Clause-②: no
Metadata-protocol: none

A sidebar entry's ⋯ menu used to offer Design for an object, a dashboard or a page entry, and only on an app whose package Studio lists as writable. An object entry, and an object favorite, now offer Object settings instead, which opens the object in Studio's Data surface, where its fields are. It is offered to a workspace admin who may author metadata on an app built here and on an installed app alike; an installed app's package opens in Studio's browse-only posture. A dashboard, page or report entry offers no Studio entry any more: each is edited on its own page. Object settings asks first when the page on screen holds unsaved edits, as Design did.

The list header's folded ⋯ menu, drawn when the header is too narrow for its actions, leads with the same Object settings entry under the same rule.

The `console.nav.design` translation key is replaced by `console.nav.objectSettings` in every locale pack.
