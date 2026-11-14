---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): an `access_denied` sign-in return says the account has no access to this environment, with switch account and back to console

Clause-②: yes (widening) — the `@object-ui/i18n` locale packs gain four keys under `auth.login.errors` (`ssoAccessDenied`, `ssoSwitchAccount`, `ssoBackToConsole`, `ssoSwitchAccountHint`) in all eleven shipped locales; no key is renamed or removed.
Metadata-protocol: none

When the control plane's identity provider refuses an account that is not a member of the environment's organization, it sends the browser back to the environment with `error=access_denied`, and the callback lands it on the Console sign-in page. That page had no sentence for the code and said the sign-in link had expired. It now says the account you signed in with does not have access to this environment, the same refusal the provider's own page states. On an environment the control plane runs (`features.cloudManaged` with the runtime config's `cloudUrl`), it also offers that page's two actions: **Switch account**, which opens the provider's end-session door (`/api/v1/auth/oauth2/end-session` on the control plane) in a new tab so the refused account is signed out there, and **Back to console**, the control plane's console. Elsewhere it shows the sentence alone, since the code may come from a provider the page cannot address. The technical code and description stay behind the details toggle, and every other refusal code keeps its sentence.
