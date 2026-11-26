---
'@object-ui/app-shell': patch
---

fix(app-shell): the metadata form's field picker reads an object's fields with the stored sign-in token, so a session held by its token alone can pick fields

Clause-②: no
Metadata-protocol: none

The `field-selector` picker in the metadata forms read an object's field catalog with the session cookie only, so a session held by its sign-in (bearer) token alone was refused and the picker showed a load failure. It now sends the stored token as well, as the other same-server console requests do. The session cookie is still sent, a cookie session behaves exactly as before, and a refused request now reaches the console's session-ended check.
