---
'@objectstack/service-automation': patch
---

fix(service-automation): a degraded connector instance whose backoff retry meets a configuration fault stops retrying and reports the configuration reason

Clause-②: no
Metadata-protocol: none

A declarative connector instance whose upstream was unreachable at boot is degraded and retried on a backoff (#3017). When the upstream later answered and the provider refused the instance's configuration (for example an `mcp` or `openapi` `providerConfig.include` naming a tool or operation the upstream does not offer), the fault was logged and skipped, but the instance stayed in the retry set: `GET /api/v1/automation/connectors` kept the stale "could not reach" reason, and the timer reconnected against a fault no retry can clear.

ADR-0097 does not retry a configuration fault, and now that holds on this path too:

- The instance's `degradedReason` becomes the provider's configuration message, and the retry timer no longer schedules it. An unchanged metadata reload does not re-attempt it; an edit of its declaration, or a restart, does.
- When a previously-materialized connector is still serving (a changed entry whose new configuration was pending a retry), it keeps serving and the retry stops.
- A credential the upstream refuses on the retry keeps its hold path, and an upstream still unreachable on the retry keeps degrading and retrying, as before.
