---
'@object-ui/app-shell': patch
---

fix(app-shell): the metadata form's field picker reads an object's fields from the object document the server serves

Clause-②: no
Metadata-protocol: none

The `field-selector` picker in the metadata forms asked for an object's fields at `/api/v1/objects/:name/fields`, a path no ObjectStack server mounts, so every load ended in the picker's failure state. It now reads the object document at `GET /api/v1/meta/object/:name` (draft-overlaid, as the other field pickers in the metadata forms read it) through the console's metadata client, which still sends the stored sign-in token. A name that matches no object now reads as "Object not found" rather than as a failed request. No server route is added and the widget's configuration (`dependsOn`, `reference`, `multiple`) is unchanged.
