---
'@objectstack/plugin-auth': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
'@object-ui/auth': patch
---

fix(plugin-auth): the auth settings save keeps a way to sign in under the local sign-in path off, and a client the IP allow-list refuses at the direct sign-in door lands on the sign-in page

Clause-②: yes (widening)
Metadata-protocol: none

Three fixes next to direct sign-in.

- **The auth settings save under `OS_AUTH_DIRECT_SIGN_IN_LOCAL_PATH=off`.** With the local sign-in path behind direct sign-in `off`, the sign-in page offers no email and password and no phone sign-in, but saving the auth settings still counted them as a way in. So with Google as the last provider, saving Google off (or clearing a client credential no environment variable backs) went through, and the page then showed "No sign-in method is available". The save now judges by what the page offers, as the provider delete and the boot report already do: that change is refused `400 SETTINGS_VALIDATION` with its own sentence in all eleven languages (keep Google, set up another sign-in method, or set the local sign-in path back to `hidden` with email and password on), and turning email and password on in the same save does not help. The `email_password_enabled` switch itself is never refused under `off`, because the page draws it neither way. Another identity provider, a social or OIDC provider with a client ID and secret, or a host sign-in handoff still counts. The `503` sentence for a provider delete whose provider list could not be read now says the sign-in page offers no email and password, which is true under both reasons the check runs.
- **A client the IP allow-list refuses at `GET /api/v1/auth/sign-in/direct`.** A blocked browser that navigated to the direct sign-in door got the raw `403 IP_NOT_ALLOWED` JSON. It now gets `302` to the Console's `/login?error=IP_NOT_ALLOWED`, with the page's `?redirect=` kept, and the page says the system does not allow sign-in from this network. The door is not exempt from the allow-list: nothing is started and no provider is read, every other auth request from that client is refused `403` as before, and the refusal is still audited and logged. The `@object-ui/i18n` locale packs gain one key, `auth.login.errors.networkNotAllowed`, in all eleven shipped locales; no key is renamed or removed.
- **The sign-out note after a provider logout.** The note a provider-logout sign-out leaves in the tab now records the sign-in page the provider returns to, and only a load of that page reads it. A provider that never sends the browser back no longer makes the next deep link opened in that tab drop its `?redirect=`.
