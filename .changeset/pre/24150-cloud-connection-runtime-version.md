---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): with `OS_RUNTIME_VERSION` unset, the server reports to the cloud the release `GET /api/v1/discovery` reports, not the Cloud Connection plugin's own `0.3.0`

Clause-②: no

`CloudConnectionPlugin` sends the server's version to the cloud in two places: as `runtime_version` on the approval links `POST /api/v1/cloud-connection/bind/start` returns, which the cloud's approval page shows next to the server's name, and as `runtime_version` in the registration request `POST /api/v1/cloud-connection/bind/poll` sends to the cloud's `/bind`. With `OS_RUNTIME_VERSION` unset, both carried the plugin's own `version` field, `0.3.0`. That string names the plugin, not the release the server runs, so an approver was shown `0.3.0` while discovery on the same server reported `18.0.0-next.*`.

- **Unset now:** both places carry the `version` the server's discovery document reports. The plugin reads it from the discovery document itself, through the `protocol` service, each time it builds the approval links or the registration request, so the two answers cannot drift.
- **Set:** a set `OS_RUNTIME_VERSION` is sent verbatim, as before.
- **No discovery document:** on a server with no `protocol` service, or when reading it fails, neither place carries a version. The approval links have no `runtime_version` parameter and the registration request has no `runtime_version` key. Before, both carried `0.3.0`.

What changes for you: nothing to rewrite. `OS_RUNTIME_VERSION` is now only needed to report a version other than the release, such as an image tag or a commit.
