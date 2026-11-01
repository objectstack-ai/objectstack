---
"@objectstack/cloud-connection": patch
---

Clause-②: no
Metadata-protocol: none

fix(cloud-connection): every member of an installed bundle is recorded as installed

`POST /api/v1/marketplace/install-local` (and `os package install`) now registers every member of a `packages[]`
bundle as `source: 'marketplace'`, at the install and at every restart's rehydrate, whatever the member's entry
states. The `manifest` service stamps an entry's own `source` over the door's, so a member whose entry said `'code'`
was recorded as the host's own code, and readers of a package's origin treated it so — the connector materializer
let its package-relative file refs read the host's directory. The precedence itself is unchanged for the boot, where
a merged artifact's entries keep stating their own origin.
