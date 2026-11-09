---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): Connect an Agent lists the AI assistants you authorized and your API keys

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`**: under the setup steps on Connect an Agent (which sits in Account's AI Assistant group), a "What can act as you" card lists the assistants the signed-in person authorized on the OAuth consent page, read from `oauth.authorizedClients.list()`: the client's name (its client id beside a fallback when it declares none), each granted scope in the consent page's own words, when it was authorized, when it was last used (the server records the hour, so it reads "in the hour from …") or that no use is recorded, and the organization only when it is not the active one. Assistant rows carry no Revoke yet; the card says so. Below them, the person's own API keys (`sys_api_key` rows filtered to the signed-in user, so a platform administrator sees their own keys here too): name, prefix, created, last used or never used, and the revoked or expired state. An active key's Revoke asks first, naming the key, then writes `revoked: true`, which ends the key's access at once; the list re-reads in place, and a key minted on the same page appears without a reload.
- **`@object-ui/i18n`**: the new `connectAgent.access.*` strings in all eleven packs. Scope wording reuses the existing `oauth.consent.scope.*` keys.
