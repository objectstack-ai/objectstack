---
'@object-ui/plugin-form': patch
---

fix(app-shell): a related list offers no + New when the create form would drop its link to the parent

Clause-②: no
Metadata-protocol: none

A record page's related list no longer offers + New for a child whose relationship field back to the parent is one the create form will not save (`readonly`, computed, server-owned, or closed to the caller on create). The record used to be created without the link, so it never appeared in the list it was created from. Creating the child from its own list is unchanged. `@object-ui/plugin-form` exports `createKeepsField`, the create form's own outbound filter asked about one field, which the related list reads.
