---
'@objectstack/platform-objects': patch
---

Clause-②: no (copy only: no accept set or public surface moves; owes the seat's review of record at `TIER_DEFAULT` before the queue)

fix(platform-objects): SSO provider, OAuth application and Connect-an-Agent copy says "this system"

- **What changed.** Inside the running system, user-facing copy names the system the user is in as "this system". The `sys_sso_provider` object description ("External SSO identity providers (OIDC / SAML) this system federates login to"), the `clientId` help text of its Register SSO Provider action ("OAuth client ID issued by the IdP for this system."), and the OAuth applications grid's empty state ("Register an application to let its clients sign users in with this system.") now say so. The `en` copy of the Connect-an-Agent page subtitle follows the page's new text.
- **Translations.** The zh-CN, ja-JP and es-ES values of the same strings are re-translated, and the recorded source hash of the Connect-an-Agent subtitle moves to the new English text in all three, so those locales keep serving their translation rather than falling back to English.
- **Unchanged.** Every object, field, action and page name, and all behaviour.
