---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(auth): edit an SSO provider in place, see what deleting one removes, and keep one provider per email domain

Clause-②: yes
Metadata-protocol: none

- **Edit instead of delete and re-register.** Two new SSO Providers actions, "Edit SAML Settings" (IdP entity ID, SSO URL, signing certificate, with an option to keep trusting the current certificate while the IdP switches over) and "Edit OIDC Settings" (client ID, client secret, scopes), post to a new platform-admin `POST /api/v1/auth/admin/sso/update-provider`. It writes through `@better-auth/sso`'s own `/sso/update-provider` with only the fields you changed; a blank field keeps what is stored, and the client secret is never shown back. A certificate or client secret changes while users are linked; the entity ID, SSO URL and client ID identify the IdP account each user signs in with, so they change only while no user is linked (`409`, with that reason).
- **Delete names its consequences.** "Delete SSO Provider" now shows, before you confirm, how many users the delete unlinks, how many of them have no password or other sign-in method and lose access, and the group mappings and grants removed with it (read from a new platform-admin `GET /api/v1/auth/admin/sso/delete-impact?providerId=`). The delete itself answers the same counts. After a delete, the provider's IdP group mappings and the permission-set grants its sign-ins projected are removed; a grant made by hand or by SCIM is never touched.
- **One email domain, one provider.** Registering a provider (either door), or editing a provider's domain, onto a domain another provider already serves is refused `409 RESOURCE_CONFLICT` with `field: 'domain'`, naming the provider that serves it to a platform administrator. A provider for a subdomain beside one for its parent is still accepted.
