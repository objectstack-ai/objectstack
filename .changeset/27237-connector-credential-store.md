---
'@objectstack/service-automation': patch
---

feat(service-automation): an administrator sets a declarative connector's credential in the environment's credential store, and a missing one degrades its instance instead of failing the boot

Clause-②: yes (widening)
Metadata-protocol: none

A provider-bound `connectors:` entry names its secret with `auth.credentialRef`. Before, the open tier resolved that name from the server's environment variables only, and a name with no value failed the boot. On a hosted environment, where the administrator who installs an app has no server environment, a connector-bearing app could never be credentialed.

The reference now resolves through three sources, in order: an environment variable of the same name (it always wins), then the new `sys_connector_credential` store, then the host's `credentialResolver` if one is injected. The store keeps one row per reference with its value in a `Field.secret` column: encrypted at rest by the host crypto provider and masked on every read. It is written through `setConnectorCredential` / `clearConnectorCredential` and listed by `listConnectorCredentialRefs` on the `automation` service, which the REST routes `GET`/`PUT`/`DELETE /api/v1/automation/connectors/credential-refs` serve.

- A reference no source answers for degrades the instance naming it, with a reason that names the reference and how to set it. Before, it failed the boot. A `credentialResolver` that throws is still fatal at boot.
- Setting or clearing a credential reconciles at once: every instance naming the reference re-materializes, or is torn down and degraded, with no restart.
- A credential the upstream refuses (HTTP 401 / 403) degrades the instance and marks a stored credential `rejected` with the upstream's message, never the value. An `mcp` instance is refused when it connects; a `rest` or `openapi` instance on the first call that answers 401 / 403, which still returns its answer. A refused instance is not retried on a timer until its credential or declaration changes.
- The value never appears in a log record, the listing, `GET /connectors`, an error body or a read of the object. A provider message that echoes it carries `[credential withheld]` instead.

A deployment that relied on the boot failing for an unset reference now boots, with that instance degraded and named on `GET /api/v1/automation/connectors`.
