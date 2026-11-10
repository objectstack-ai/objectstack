---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): a same-origin read of the control plane's default install namespace

Clause-②: yes (widening)
Metadata-protocol: none

`GET /api/v1/cloud-connection/install-namespace?package_id=PACKAGE_ID` answers the namespace the control plane would give an unmanaged copy of a package in this environment, so the Console's hosted install dialog can show it as an editable default and send it back as `target_namespace` on `POST /api/v1/cloud-connection/install`. A tenant console could not read it before: the control plane's route is cross-origin, and the console does not know its own environment id.

- **Gate.** The same as `POST /install`: the environment is resolved from the request host (or the single-environment configuration), the caller needs a signed-in session of it (`401 UNAUTHENTICATED` otherwise), and a session the authentication policy holds is refused `403` with the gate's own code. The control plane is asked nothing before these pass.
- **Closed query set.** `package_id` only. Any other parameter (including the `packageId` spelling and an `environment_id` the caller names) is refused `400 VALIDATION_ERROR`, and so is `package_id` supplied twice. A missing or blank `package_id` is `400 INVALID_REQUEST`.
- **Answer.** The control plane's status and body are relayed unchanged. A runtime not connected to a cloud account answers `503 CLOUD_UNCONFIGURED`, and an unreachable control plane answers `502 EXTERNAL_SERVICE_ERROR`, so the dialog reads "no default" and leaves the field empty. The route never answers a namespace it made up.
