---
'@objectstack/runtime': patch
---

fix(runtime): MCP `run_action` answers a declared action with no handler as `POST /api/v1/actions` does, `404 RESOURCE_NOT_FOUND`

Clause-②: no
Metadata-protocol: none

A declared `script` action with no handler bound anywhere (for example, an install-local package whose handlers never bound) got two different answers. `POST /api/v1/actions/:object/:action` answers it from its routing-miss branch: `404`, `RESOURCE_NOT_FOUND`, `Action 'X' on object 'Y' not found`. MCP `run_action` answered `400 VALIDATION_ERROR`, `No handler registered for action 'X' on 'Y'`, which told the agent its input was bad.

The MCP bridge threw that miss as an uncoded error. It now throws the routing miss as `/actions` answers it, with the same sentence, `404` and `RESOURCE_NOT_FOUND`, so `run_action` gives the same answer. The `action_invocation` row MCP writes for the miss moves the same way: it recorded `500` / `INTERNAL_ERROR`, and now records `404` / `RESOURCE_NOT_FOUND`, as the REST row does. A declared action with a handler, and a handler's own coded refusal, answer as before. No REST answer changes.
