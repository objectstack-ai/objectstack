---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the Register SSO Provider form can name the userinfo endpoint, read claims from the ID token only, and suggests the Microsoft Entra ID email claim

Clause-②: yes (widening)
Metadata-protocol: none

Setup → SSO Providers → **Register SSO Provider** (`sys_sso_provider.register_sso_provider`) now collects the two fields the register bridge (`POST /api/v1/auth/admin/sso/register`) has accepted since the server half of #32147:

- **Userinfo URL** (`userInfoEndpoint`, optional): kept instead of the userinfo endpoint the discovery document names. An endpoint the registration names is trusted for that registration, so this is the field the refusal of an untrusted discovery endpoint tells the admin to fill.
- **Read Claims From the ID Token Only** (`skipUserInfo`, optional, off unless ticked): stored as the provider's `skip_user_info`, labelled as that column is.

**Discovery URL** (`discoveryEndpoint`) and **Userinfo URL** are `url` inputs, and both help texts say an endpoint named there is trusted for the provider. The **Map: Email claim** help text names the Entra ID mapping: for an issuer on `login.microsoftonline.com`, users without a mailbox carry no `email` claim, so map `preferred_username` (or `upn`) and turn on the ID-token option. The hint is static text. An action param's help text and visibility cannot read the dialog's own values, so the form cannot key a hint on the issuer the admin types. The claim is never set for the admin: left blank, it still maps `email`.

The new labels and help texts are translated in every locale bundle.
