---
'@object-ui/console': patch
---

fix(console): an internal form refuses a write the caller holds no grant for before it draws a field

Clause-②: no
Metadata-protocol: none

A member who may read an object but not create it could open a form link (`/forms/NAME` or `/apps/APP/forms/NAME`), type the whole record, and learn only on Submit that the server refuses it, losing the typing. The internal form page now asks the caller's grant as soon as the form has loaded: a create form the create grant, an edit form (`?recordId=`) the update grant, through the console's affordance map (`createFormFields`, `editFormFields`). Refused, the page draws the submit-time refusal's own localized sentence ("You don't have permission to save this record.") and no field. With the grant, the form is unchanged.

The app-less `/forms/NAME` route now sits under the same permissions layout as `/home` and `/apps/APP/*`, so both form URLs read the one `/auth/me/permissions` answer the console already holds, and a hop from Home or an app asks nothing again. The URL is unchanged. The anonymous `/f/SLUG` route is unchanged. No metadata key and no server change.
