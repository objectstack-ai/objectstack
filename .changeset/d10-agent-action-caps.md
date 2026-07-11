---
'@objectstack/runtime': minor
---

ADR-0090 D10 (follow-up) — an MCP agent may now invoke the business **actions** its delegating user can run, gated by the `actions:execute` scope. Previously an agent principal carried no system capabilities, so any capability-gated action (`requiredPermissions`) was denied even when the user was entitled to it.

`resolve-execution-context` now keeps the delegating user's `systemPermissions` on the agent context **only when the token carries `actions:execute`** (otherwise none — and the MCP tool surface already hides the action tools). The `actions:execute` scope is the user's explicit consent to let the agent act on their behalf, so the capability gate (`actionPermissionError`) is delegated accordingly.

This never widens the agent's **data** reach: what an action reads or writes still flows through the object CRUD/FLS/RLS ceiling ∩ user intersection. A `data:read` agent that invokes a writing action is still blocked at the write; even a `data:write` agent cannot touch better-auth-managed tables; and capability-gated **object** access stays denied to the agent (that gate is driven by the resolved ceiling sets, which carry no capabilities). The residual is a capability-gated action whose effect is purely external (email, webhook) — exactly what `actions:execute` consents to. Tighter per-action agent scoping is the per-client-grants follow-up.
