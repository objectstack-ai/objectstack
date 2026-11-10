---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth): Microsoft Entra ID registers and signs in over OIDC: Graph trusted for its discovery only, groups from the verified ID token, and a named refusal for a user without a mailbox

Clause-②: yes (widening)
Metadata-protocol: none

**Registration.** Entra ID's discovery document names its `userinfo_endpoint` on `https://graph.microsoft.com`, so every Entra ID registration was refused `discovery_untrusted_origin` unless the operator widened `OS_TRUSTED_ORIGINS`, and with it the CSRF allow-list. A built-in table of companion origins (`login.microsoftonline.com` → `https://graph.microsoft.com`) now trusts Graph only while `/sso/register` validates the discovery document of a registration whose issuer is an `https://login.microsoftonline.com` URL. The CSRF allow-list does not change. A host named only by a discovery document is still never trusted: any other IdP whose discovery names a foreign host is refused as before, and the message now names the endpoint and the registration member that names it explicitly (`"userInfoEndpoint": "…"`). The Register SSO Provider bridge (`POST /api/v1/auth/admin/sso/register`) now takes `userInfoEndpoint` and `skipUserInfo`; the Setup form does not show them yet.

**Groups.** When the userinfo answer does not carry the provider's groups claim, the groups are read from the ID token the vendor already verified. Userinfo wins where both carry it. A groups overage (`_claim_names`) grants nothing from groups, makes no Graph call, and logs one `warn` per provider naming the fix (emit only the groups assigned to the application, or use Entra ID app roles).

**Users without a mailbox.** A provider can now read its claims from the verified ID token only: the new `skipUserInfo` option (column `skip_user_info` on `sys_sso_provider`, "Read Claims From the ID Token Only", off by default, set at registration or with Edit Sign-In Options). With it on and the email mapped to `preferred_username` or `upn`, an Entra ID user without a mailbox signs in. The stored userinfo endpoint is kept.

**Refusal wording.** A sign-in whose claims carry no email address was redirected with `error_description=missing_user_info`. It now reads `error_description=email_claim_missing` (`error=invalid_provider` is unchanged), and the `warn` line names the missing claim and the mapping key (`mapping.email`). A client that matched `missing_user_info` should match `email_claim_missing`, exported as `SSO_OIDC_EMAIL_CLAIM_MISSING`.
