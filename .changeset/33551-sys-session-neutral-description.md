---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the Sessions page subtitle no longer says "active" on the revoked view

Clause-②: no
Metadata-protocol: none

`sys_session`'s object description was "Active user sessions", and the console draws an object's description as the subtitle of every list view, so Setup → Sessions → Revoked (the audit view of ended sessions) was titled as active sessions. The description is now the neutral "User sessions", in the source and in all eleven locale bundles. No key, field, view or action changes; the toolbar's "Sign out other devices" action is unchanged and still shows on every session view.
