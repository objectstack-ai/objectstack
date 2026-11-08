---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an unmanaged grant refused after the control plane granted it writes the environment's `package_unmanaged_import` failure row

Clause-②: no
Metadata-protocol: none

cloud#3624 ruling A has both sides audit an unmanaged install. Before this, the environment wrote its `package_unmanaged_import` row only when the copy's import ran. A grant refused before the import left the control plane's grant row with no environment outcome. That covers the install-local door's install capability (403), the manifest fetch, the walled catalog and the protocol handshake, and the cloud-connection door's own two refusals.

- **The install-local door's refusals of a grant.** The cloud-connection door now hands the in-process door the grant beside the request: `install(request, { grant })`, with the package, version, environment and installer. When the door answers a grant with a refusal that its unmanaged copy did not already audit, it hands the `audit` slot one `package_unmanaged_import` event. The event has `outcome: 'failure'` and the answer's code and HTTP status. A throw is audited with the status it resolves to, then rethrown. The import's own success and failure events are unchanged and are never written twice.
- **The cloud-connection door's own refusals.** A grant it cannot read (502) and an environment without the install-local door (503) each hand the environment's `audit` slot the same failure event. The multi-tenant slot is the environment kernel's; the single-environment slot is the host's.
- **What is not audited.** A plain `POST /api/v1/marketplace/install-local` call, which no grant started, writes no row for a refusal. Nor do a control-plane refusal, a managed install, and the cloud-connection door's checks before the control plane is called. No grant exists for any of them.
- The events go through the `audit` slot, never as a hand-built row. An audit slot that throws changes no answer, and the failure is logged at `error`. The row's metadata keys are the ones #30964 shipped. The refusal row names the granted marketplace package id, and carries `environment_id`, because the grant names its environment.
