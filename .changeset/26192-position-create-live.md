---
'@object-ui/app-shell': patch
---

fix(app-shell): a position created from Setup → Positions → New is saved live and shows in the Positions list right after Save, as a permission set does

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`:** the `position` resource now registers `createLive: true`, the key the permission set already carries. Outside a package binding, "New" writes the position live (one PUT with no `mode` and no `package`, with the first-write pin `If-None-Match: *`), so it appears in the Positions list and its detail page reads it at once. Before, Setup carried no package, the create landed as a draft with no package, the list showed nothing and a read of the name answered not found until the admin published it by hand. Under a package binding (`?package=`) the create stays a package draft, as before.
- Later edits of an existing position in Setup still save as drafts, the generic editor's rule for every type; that is unchanged here.

What to do: nothing.
