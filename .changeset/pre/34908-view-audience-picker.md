---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): 「Who sees this view」 — pick a shared view's or a dashboard's audience from the known capabilities, and see which positions will see it

Clause-②: no
Metadata-protocol: none

The audience gate is the existing, server-enforced `requiredPermissions` (all of the capabilities listed are required). The console now sets it from a closed list and shows who it reaches; no key, value or gate changes, and nothing is granted from the view (granting stays in Setup).

- **`@object-ui/app-shell`.** The view switcher's in-place create card offers 「Who sees this view」 for a shared view: the capabilities the environment knows (declared, or granted by a permission set), each with the permission sets granting it, and a read-only preview of the positions whose permission sets grant every capability picked. The preview reads each position's sets from the server (`GET /meta/position?include=grants`, the sets the resolver grants its holders), never from a position's raw definition; a list served without them leaves the positions unknown. While a gate is picked, the card says it applies to its creator too. It starts from the open view's gate, which a new shared view used to inherit silently, and the pick replaces it; an empty pick writes no gate. A failed catalog read offers nothing to type. The shared hint no longer says every shared view is seen by everyone who can see the list. In Studio, the view panel's and the dashboard settings' audience row is the new `ref-multi:capability` picker: a closed list (no typed-name box when the catalog is unread, empty or failed), each option with its granting sets, and the same preview under it. The picker reads the catalog once its row is on screen, so an editor whose audience section stays closed sends no request.
- **`@objectstack/spec`.** The view and dashboard forms' `requiredPermissions` rows declare `widget: 'ref-multi:capability'` (the list is closed: a host with no catalog offers nothing to add). The view hint's last sentence now says only what holds on every carrier: the person setting the gate no longer sees the view in the list either.
- **`@objectstack/platform-objects`.** The `metadataForms` bundles carry the narrowed view hint (zh-CN, ja-JP and es-ES translated; the other locales the English source).
- **`@object-ui/i18n`.** The create card's new strings and the corrected shared hint, in all eleven console locales.

Nothing to migrate.
