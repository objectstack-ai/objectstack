---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): `RuntimeConfigPlugin` serves a declared `cloudHomeUrl`

Clause-②: yes (widening)
Metadata-protocol: none

`RuntimeConfigPluginConfig` takes a new optional `cloudHomeUrl`: the absolute URL of the control plane's console home page. When a host declares it, `GET /api/v1/runtime/config` serves it verbatim as a top-level `cloudHomeUrl`, beside `cloudUrl` and `upgradeUrl`. It follows the `upgradeUrl` contract:

- Host option only. There is no env var: the distribution whose control plane serves the page fills it.
- Absent by default. An unset, empty or whitespace-only value serves no key at all, never `""` or a guessed default.
- Absolute or refused. A relative path or a non-`http(s)` scheme is not served, and the mount log names the option and the refused value.

Nothing changes for a host that does not declare it.
