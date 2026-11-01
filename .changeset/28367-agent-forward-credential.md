---
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/plugin-auth': patch
---

feat(runtime, rest, plugin-auth): an AI agent connected over OAuth can run `api` actions that forward to identity routes and other same-origin routes, as the agent

Clause-②: yes (widening, at the two named cells only)
Metadata-protocol: none

An `api` action runs by forwarding a request to its `target` inside the server. Until now an agent connected over OAuth was refused by name before that forward unless the target was the MCP endpoint, because its access token is honoured there alone. So the identity actions ADR-0011 exposes to agents (update my profile, the confirmed admin actions) never ran for one.

Now, per ADR-0090 D10 rule 5, the forward carries a credential the server mints for that one forward instead of the agent's token. It is bound to the forward's method and route and to the action run, spent by its first use, revoked when the target answers, and redeemable only inside the server's own in-process call. At the target it resolves to the same agent: its scope ceiling, the user it acts for and its client. At the identity routes, the auth library is shown the delegating user for that one request only; no session is created, and the user's own permissions there still decide. Writes the agent makes are recorded with both the agent and its user.

What changes, at exactly two cells of the forward table:

- an agent at an identity route: refused by name before, now forwarded as the agent;
- an agent at any other same-origin route: refused by name before, now forwarded as the agent when the connection holds `actions:execute` and `data:write`.

What does not change:

- An API key is still refused by name at an identity route.
- A state-changing request to the metadata endpoint is never forwarded for an agent; it is refused `403` by name.
- An agent without `data:write` is refused `403` by name, and `list_actions` marks those actions the same way.
- Nothing the target mints, such as a rotated session token or cookie, comes back to an agent.
- An OAuth access token presented directly to the data API or to an identity route is still refused.
