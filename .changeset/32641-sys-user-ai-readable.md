---
'@objectstack/platform-objects': patch
'@objectstack/mcp': patch
'@object-ui/console': patch
---

feat(platform-objects,mcp): a member's agent finds a colleague by name or email over MCP, to fill a person field

Clause-②: yes (widening) — the MCP read tools (`list_objects`, `describe_object`, `query_records`, `get_record`, `aggregate_records`) now admit one more system object, `sys_user`, which they refused before with `Object "sys_user" is a system object and is not exposed via MCP`. No write tool opens it.
Metadata-protocol: none

- **`sys_user` declares `enable.aiReadable: true`.** An agent reads users with the existing record tools, under every gate a console read runs, and is served exactly what the caller's console person picker is served: their own row and the members of their active organization (the `sys_user_self` and `sys_user_org_members` row scopes of `member_default`), never another organization's users; and every field except the `Admin` group (sign-in trail, lockout, ban reason and expiry, sign-in phone, legacy role, AI seat), which the non-admin permission sets withhold on results and refuse on filters. For a plain member that is: `id`, `name`, `email`, `email_verified`, `two_factor_enabled`, `banned`, `image`, `locale`, `manager_id`, `primary_business_unit_id`, `principal_kind`, `accountable_user_id`, `source`, `created_at`, `updated_at`. An administrator's agent reads what the administrator reads.
- **Read only.** `create_record`, `update_record`, `delete_record` and `delete_records` keep refusing every `sys_*` object, so the self-service profile edit stays a console and data-API affordance; account changes an agent may make go through actions that declare their own `ai.exposed`.
- **What an agent is told.** `query_records`' description and the served `SKILL.md` (and its Console "Download skill" copy) say how to find a colleague's id for a person field: `where: { "email": "..." }` for exactly one person, or `{ "name": { "$contains": "..." } }`; names repeat, so people who share a name are told apart by email. The `list_objects` line no longer says every system object is hidden.
