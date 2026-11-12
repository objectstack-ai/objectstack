---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): SCIM adopts an account that SSO just-in-time provisioning already created, under three conditions and never on an email match alone; the SCIM 409 no longer names the vendor

Clause-②: no
Metadata-protocol: none

"Turn on SSO first, add SCIM later" is the usual rollout. A person who signed in
through the organization's SSO provider before SCIM was turned on had an account
the directory could not reach: Entra ID and Okta look the user up (nothing: the
account is not a SCIM resource yet), then create it, and the create answered
`409` because the email was taken. The identity provider marked the user failed,
so its later deactivation never reached that account.

`POST /api/v1/auth/scim/v2/Users` now LINKS the existing account to the
connection, and answers `201` with a new SCIM resource the directory then
manages (lookups find it, a deactivation bans the account), when every part of
this holds:

1. the account reads `sys_user.source = 'idp_provisioned'` and holds no local
   password;
2. no SCIM directory already holds it (no `sys_scim_subject` row) — an account
   one directory provisioned, or deleted, is never adopted by a second;
3. one of its `sys_account` rows names a `sys_sso_provider` of the organization
   that owns the SCIM credential the request authenticated with
   (`sys_scim_connection_credential.organization_id`; both unset counts as the
   same environment-wide organization, one unset does not);
4. that provider's `domain_verified` is true (ADR-0135 D6 domain verification,
   opt-in through `OS_SSO_DOMAIN_VERIFICATION`), and the account's email domain
   is exactly one of the provider's domains.

Anything else answers `409` as before. Adoption therefore needs SSO domain
verification turned on and the domain verified; without it nothing changes.

The SCIM conflict text the vendor worded in its own name now reads in the
platform's words: "An account with this email already exists" (was "A Better
Auth User already uses this email"), and "account" for "Better Auth User" in the
three other `409` details. The status and `scimType` are unchanged.
