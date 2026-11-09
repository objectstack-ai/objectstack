---
'@objectstack/plugin-audit': patch
'@objectstack/plugin-auth': patch
---

feat(plugin-audit): an API key or OAuth access token admitting a request leaves a `credential_use` row in `sys_audit_log`, once per credential per use window

Clause-②: yes (widening)
Metadata-protocol: none

Credential use left no ledger row naming the credential: the only trace was the credential's own last-use stamp. An audit export or SIEM stream had nothing to read for "which key or token acted as whom, and when".

- **`sys_audit_log.action` gains `credential_use`** (`@objectstack/plugin-audit`). One row per credential per use window, written when the credential's own throttled use stamp lands: `sys_api_key.last_used_at` (the shared key-admission seam, at most once per key per hour, so every door that admits a key counts: REST, the runtime dispatcher and its `/mcp` face, the stdio MCP transport, the storage doors) and `sys_oauth_consent.last_used_at` (an OAuth access token's use on the `/mcp` door, at most once per consent per clock hour). No new timer: a second use inside the window writes no row.
- **The row** names the credential's owner (`user_id`, `actor`), the credential row (`object_name` / `record_id`), the organization it is bound to (`tenant_id`, or none), and in `metadata` the `credential_kind` (`api_key` / `oauth_access_token`), the `credential_id`, the window start (`used_at`) and, for a token, the `client_id`. It never carries a key, a token, a key hash or a key prefix.
- **A `skip_consent` OAuth client** (`@objectstack/plugin-auth`) has no consent row to stamp. Its use is handed to the new `audit` slot member `recordCredentialUse` from the same stamp point and under the same throttle (at most once per client, user and organization per clock hour in each process); the row names the client's `sys_oauth_application` row.
- **Not yet on the row:** the source address and the user agent (`ip_address` / `user_agent` are null). Neither stamp point holds them; they follow in a separate change.

Nothing about which credentials are admitted changes. To read the rows: filter `sys_audit_log` on `action = 'credential_use'`.
