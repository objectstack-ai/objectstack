---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): Setup's Register SAML Provider registers a complete form; it answered 400 for every one

Clause-②: no — a form the bridge always refused registers; nothing a caller sends today is refused
Metadata-protocol: none

- **Before.** `POST /api/v1/auth/admin/sso/register-saml` (Setup → SSO Providers → Register SAML Provider) answered `400 SAML_REGISTER_FAILED` "[body.samlConfig.idpMetadata] idpMetadata.entityID is required when IdP metadata XML is not provided" for every complete form. The bridge sent `samlConfig` with no IdP descriptor, which `@better-auth/sso` requires when no IdP metadata XML is given, so no SAML provider could be registered from Setup.
- **Now.** The bridge sends `samlConfig.idpMetadata.entityID` from the form's IdP Entity ID field (`issuer`), and a complete form registers the provider (one `sys_sso_provider` row) and answers the SP ACS and metadata URLs as before. The form's fields, the required set and the refusal of an incomplete form (`400 INVALID_REQUEST` naming the missing field) are unchanged. The IdP SSO URL and signing certificate stay where they were (`samlConfig.entryPoint`, `samlConfig.cert`).
