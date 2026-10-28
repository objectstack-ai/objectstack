---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): the install-local answer lists the connector credentials the installed package names, and which are not set yet

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/marketplace/install-local` answers with `credentialRefs` when the package's connectors name any `auth.credentialRef`. Each entry has the reference, the instances naming it, its `status` from the automation service's credential listing (`set` / `missing` / `rejected`, or `unknown` when that listing cannot be read) and its `source`, never a value. When any of them is not set, a `credentialNote` names them and says how to set them. An unset reference never refuses the install: the instance naming it installs degraded and materializes once the credential is set (#27237). The answer's keys are unchanged for a package whose connectors name no credential.
