---
'@object-ui/app-shell': patch
'@object-ui/fields': patch
---

fix(console): starting an impersonation lands on home, and a person's permission-set picker no longer offers the MCP agent sets

Clause-②: no
Metadata-protocol: none

- **Impersonation landing.** An administrator who starts an impersonation from a Setup page used to stay on that page, which the impersonated user usually cannot open, so the console showed "You don't have access to this app". The impersonation banner now navigates to `/` the moment a session the console held as an ordinary one becomes impersonated, and the console resolves the landing for the user it now holds. A console that boots into an impersonated session (a reload, a new tab, a deep link) stays on the URL it was opened at, and ending an impersonation does not move the page. The navigation goes through the host navigate the console supplies, so a deployment's basename applies.
- **Agent sets in the person picker.** The `permission-ref` field (the permission set on a person's grant, `sys_user_permission_set.permission_set`) no longer offers the three MCP agent ceiling sets (`mcp_agent_data_read`, `mcp_agent_data_write`, `mcp_agent_restricted`, the spec's `MCP_AGENT_PERMISSION_SETS`). Those are an AI assistant's own grants, which the runtime puts on the agent principal directly. A grant that already names one still shows it as the row's value, by its label beside its name. `position-ref` is unchanged.
