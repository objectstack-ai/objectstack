---
'@objectstack/service-automation': patch
---

fix(service-automation): a connector instance whose upstream no longer matches its pin is degraded in its own words

Clause-②: no
Metadata-protocol: none

A provider factory that throws `CONNECTOR_UPSTREAM_CHANGED` (the `mcp` provider does when an instance's `providerConfig.toolsSnapshot` does not match what the server serves) degrades the instance on the same 5 s → 5 min backoff as an unreachable upstream, but its log records now say what happened. The materializer's ERROR reads "… serves a tool definition that differs from its toolsSnapshot — instance registered degraded (no actions); re-checking with backoff, attempt N." instead of "upstream unavailable … retrying with backoff", and the engine's degrade WARN says the instance has no actions "until its upstream serves the definitions its pin names again" instead of "until its upstream is reachable". The instance's reason (`GET /api/v1/automation/connectors`, the `connector_action` refusal) is the factory's message, naming each changed tool, as before.
