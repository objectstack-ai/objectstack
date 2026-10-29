---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an @mention by email matches the user whatever the address's casing

Clause-②: no
Metadata-protocol: none

A comment that @-mentioned a colleague by email in a different case than the stored address (`Carol@Example.com` for `carol@example.com`) was accepted, but the mention resolved no user and the colleague was never notified; the server logged `mention notification withheld` with reason `unknown_email`. The mention lookup now normalises the address the way identity and sign-in do (trim, then lowercase, through the shared `normalizePlatformAdminEmail`), so it names the same user sign-in would. Who may be notified is unchanged: the record and comment read checks still decide.
