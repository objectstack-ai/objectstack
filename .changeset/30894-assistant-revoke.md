---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): revoke an authorized AI assistant from Connect an Agent, and an administrator widget for a person's assistants

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`**: each row in Connect an Agent's "Authorized AI assistants" list now has a Revoke. It asks first, naming the assistant, then withdraws the grant through `oauth.authorizedClients.withdraw(id)`: the assistant's token is refused on its next call and it has to be authorized again to reconnect. The list is read again after every withdraw, so a grant already withdrawn elsewhere leaves it too, and the refusal is named. The line saying withdrawing was not available yet is gone. New SDUI widget `mcp:authorized-assistants` for a `sys_user` record page: it reads the person from the bound record (no props), lists their authorized assistants through `oauth.authorizedClients.listForUser(userId)` with the same rows and confirm-first Revoke, which calls `withdrawForUser(userId, id)`. Those doors are for platform administrators; anyone else sees the server's refusal as a failed read. Off a `sys_user` record it renders nothing, and it is drawn only where a page names it.
- **`@object-ui/i18n`**: `connectAgent.access.withdrawTitle`, `withdrawBody`, `managedBody`, `managedEmpty` and `managedTruncated` added in all eleven packs; `connectAgent.access.withdrawLater` removed (net +4 keys per pack).
