---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a person-to-permission-set assignment refuses an agent ceiling set at every write door

Clause-②: no (narrowing) — a non-system insert or update of `sys_user_permission_set` that would store an assignment naming one of the three MCP agent ceiling sets (`mcp_agent_data_read`, `mcp_agent_data_write`, `mcp_agent_restricted`) is refused with `400 VALIDATION_FAILED` (`invalid_value` at `permission_set`), for every caller, a platform administrator included; nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and nothing an author writes changes: a runtime write of an assignment row naming an agent ceiling set is refused, and a stored one is left for an administrator to remove -->

**BREAKING** for a deployment whose administrators assign an MCP agent ceiling set to users through the permission-set assignment table.

- **The rule (ADR-0090 D10).** The agent ceiling sets are an AI agent's own grants. The door that admits an agent connected over MCP derives its ceiling from the scopes its user consented to and puts it on the agent's request; no assignment row is read for it. A `sys_user_permission_set` row is a person's grant, so it never names one. Every door that writes the table refuses such a row: the data API's create and update, `createMany`, `updateMany`, the per-object and cross-object batch, and both import doors (the row fails with `code: 'invalid_value'` at `permission_set`). An update that keeps an assignment naming one in force (a new holder, a validity window, an echo of the set) is refused too.
- **Unchanged.** Every other permission set stays assignable, and removing an assignment stays open. A system write (seed replay, the platform's own grant writers) is not judged. An agent connected over MCP holds its ceiling exactly as before. An organization administrator is still refused the same sets on the organization boundary first (`403 PERMISSION_DENIED`).
- **Who moves, and the fix.** An assignment stored before this release that names an agent ceiling set is left as it is, and can no longer be edited: delete it (`DELETE /api/v1/data/sys_user_permission_set/ID`), or rename it to a permission set meant for people. List them with `GET /api/v1/data/sys_user_permission_set?permission_set=mcp_agent_data_read` and the same query for the other two names.
