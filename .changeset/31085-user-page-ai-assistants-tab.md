---
'@objectstack/platform-objects': patch
---

feat(platform-objects): Setup's user page gains an "AI Assistants" tab, for platform administrators

Clause-②: no
Metadata-protocol: none

- **`@objectstack/platform-objects`**: the `sys_user` record page (`sys_user_detail`) has a new "AI Assistants" tab, beside API Keys, labelled in en, zh-CN, ja-JP, es-ES and zh-Hant. Its body is the console widget `mcp:authorized-assistants`: the AI assistants (OAuth clients such as Claude Desktop) this person authorized, each with a confirm-first Revoke. An administrator can now see and end what acts as a person who cannot sign in to withdraw it themselves (a lost laptop, a departure). The tab is shown only to a platform administrator (`current_user.isPlatformAdmin == true` on the tab item): the widget's list and Revoke go through the platform-admin-gated `/api/v1/auth/admin/authorized-clients` doors, so any other viewer could only see a refusal. The server's gate is unchanged.
