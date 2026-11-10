---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(auth)!: edit an SSO provider in place, see what deleting one removes, and keep one provider per email domain

Clause-②: yes (narrowing) — registering an SSO provider, or editing a provider's domain, onto a domain entry another provider already serves is refused, where it was accepted before; and deleting a provider is refused when the number of users it unlinks cannot be read. The edit actions and their door, the delete preview and the counts on a successful delete widen.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. The refusals are new answers of the auth routes to a request; no stored provider, mapping or grant row is rewritten by the upgrade, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on SSO provider registration, provider domain edits and provider delete (`@objectstack/plugin-auth`).

After the upgrade, `POST /api/v1/auth/sso/register`, the `register_sso_provider` / `register_saml_provider` actions behind `/api/v1/auth/admin/sso/register` and `/register-saml`, and a `domain` edit on `POST /api/v1/auth/sso/update-provider` are refused `409 RESOURCE_CONFLICT` with `field: 'domain'` when one of the domains named is an exact entry of another provider's domain list. Before, the second provider was saved, but sign-in routes an address to the first provider that serves it, so the second was never reached by address. Providers already stored are not touched or re-checked; only a new claim of an entry is refused. A provider for a subdomain beside one for its parent (`eng.acme.com` beside `acme.com`) is still accepted. To serve a second IdP, register it for its own domain or subdomain, or delete the provider that holds the domain first. `POST /api/v1/auth/sso/delete-provider` is refused `503` when the count of users it would unlink cannot be read, and nothing is deleted; retry once the data store answers.

- **Edit instead of delete and re-register.** Two new SSO Providers actions, "Edit SAML Settings" (IdP entity ID, SSO URL, signing certificate, with an option to keep trusting the current certificate while the IdP switches over) and "Edit OIDC Settings" (client ID, client secret, scopes), post to a new platform-admin `POST /api/v1/auth/admin/sso/update-provider`. It writes through `@better-auth/sso`'s own `/sso/update-provider` with only the fields you changed; a blank field keeps what is stored, and the client secret is never shown back. A certificate or client secret changes while users are linked; the entity ID, SSO URL and client ID identify the IdP account each user signs in with, so they change only while no user is linked (`409`, with that reason).
- **Delete names its consequences.** "Delete SSO Provider" now shows, before you confirm, how many users the delete unlinks, how many of them have no password or other sign-in method and lose access, and the group mappings and grants removed with it (read from a new platform-admin `GET /api/v1/auth/admin/sso/delete-impact?providerId=`). The delete itself answers the same counts. After a delete, the provider's IdP group mappings and the permission-set grants its sign-ins projected are removed; a grant made by hand or by SCIM is never touched.
- **One email domain, one provider.** Registering a provider (either door), or editing a provider's domain, onto a domain another provider already serves is refused `409 RESOURCE_CONFLICT` with `field: 'domain'`, naming the provider that serves it to a platform administrator. A provider for a subdomain beside one for its parent is still accepted.
