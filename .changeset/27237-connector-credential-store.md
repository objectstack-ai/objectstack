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
- A credential the upstream refuses (HTTP 401 / 403) degrades the instance with the upstream's message, never the value. An `mcp` instance is refused when it connects; a `rest` or `openapi` instance on the first call that answers 401 / 403, which still returns its answer. A stored credential is marked `rejected`, and its instance is not retried until the credential is set again, the declaration changes, or the server restarts; the mark itself stays until the value is set again or an `mcp` handshake proves it. A call answered 2xx does not clear it, since the endpoint may not check the credential; it only stamps the last-verified time of a credential still `set`. A credential from an environment variable or the host's resolver is retried on the usual backoff instead, since it can change where the service cannot see it, and the listing reports it `rejected` until a provider proves it or the server restarts.
- Under the `group` and `isolated` tenancy postures the store is not read, and writes to it are refused with a 403 naming the posture.
- A value starting with `secret:` is refused with a 400: the data engine would store it as a handle to another stored secret. Writes run one at a time with their reconcile, so the instances end on the value the store ends on; a first write another replica makes at the same moment answers 409.
- The value never appears in a log record, the listing, `GET /connectors`, an error body or a read of the object. A provider message that echoes it carries `[credential withheld]` instead, and so does one that echoes it percent-encoded or base64-encoded, including the base64 `user:value` pair of a basic credential.

A deployment that relied on the boot failing for an unset reference now boots, with that instance degraded and named on `GET /api/v1/automation/connectors`.
