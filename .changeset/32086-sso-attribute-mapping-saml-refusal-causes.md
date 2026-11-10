---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth, platform-objects): an SSO provider maps who a sign-in resolves to (SAML email, first, last and display name; OIDC email and name), and a refused SAML response names its cause

Clause-②: yes (widening)
Metadata-protocol: none

**Attribute mapping.** `@better-auth/sso` reads a SAML user's email from the `email` attribute (else the NameID) and the name from `givenName` + `surname`, else `displayName`, else the NameID. Okta sends the full name as `name` and Entra ID sends claim URIs, so their users were named after their NameID, and nothing in the platform could map other attribute names.

- **Register SAML Provider** takes four new optional fields, `mapEmail`, `mapFirstName`, `mapLastName` and `mapName`, stored as the provider's `mapping.email` / `firstName` / `lastName` / `name` beside the groups attribute. Blank leaves the default. The help text names the Okta and Entra ID attribute names.
- **Show Attribute Mapping** and **Edit Attribute Mapping** on `sys_sso_provider` show and change the mapping of an existing provider, SAML or OIDC, through two new platform-admin bridges, `POST /api/v1/auth/admin/sso/get-attribute-mapping` and `POST /api/v1/auth/admin/sso/set-attribute-mapping` (route ledger rows, `server-only`, `requires: 'sso'`). A member left untouched keeps its value, a cleared one goes back to the default, and the groups claim and every other member of the stored mapping are kept. An OIDC provider maps `email` and `name` only; `firstName` / `lastName` on one answer `400 INVALID_REQUEST`. An unknown provider is `404 RESOURCE_NOT_FOUND`. The answer carries the provider id, its protocol and the four members, nothing else of the stored configuration. The edit is not offered to an AI caller: the email member decides which account a sign-in links to.
- The labels are translated in all ten locales.

**SAML refusal causes.** The vendor answers every samlify rejection with `error=saml_error&error_description=Invalid SAML response`. After it refuses, the posted response is now read once more against the provider's configured signing certificates and IdP entity id, in samlify's order, and `error_description` names the first of four causes that applies: `saml_idp_status_not_success`, `saml_response_unsigned`, `saml_signing_certificate_mismatch` (the IdP certificate rotation case) or `saml_issuer_mismatch`. One `warn` line carries the provider id, `protocol: 'saml'` and the cause. `error=saml_error` is unchanged, any other refusal keeps `Invalid SAML response`, and nothing about the accept decision changes. No cryptography runs; neither the redirect nor the line carries assertion content, and the answer is the same for every account. `fast-xml-parser` (the parser the vendor already uses) becomes a direct dependency of plugin-auth.

Documented in `content/docs/permissions/sso.mdx` ("Map the user's email and name", "Why a SAML sign-in was refused").
