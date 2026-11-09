---
'@objectstack/cloud-connection': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

An in-environment marketplace install can name the package version to install. `POST /api/v1/cloud-connection/install` now accepts `version` and forwards it to the control plane's install action, which installs that version or refuses it as it does today. Leaving `version` out still installs the latest version, and the request sent to the control plane is unchanged.

A `version` that is not a SemVer 2.0.0 string (for example `latest`, `1.2` or `^1.2.3`) is refused with `400 INVALID_REQUEST` before anything is sent.
