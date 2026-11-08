---
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': minor
---

feat(plugin-auth,platform-objects): per-provider SSO sign-in options for IdP-initiated sign-in and just-in-time accounts, and `invite_only` now refuses an SSO sign-in by someone who was not invited

Clause-②: yes (widening)
Metadata-protocol: none

**Behaviour change for existing deployments.** Under the `invite_only` audience posture, which is the default, an enterprise SSO sign-in (OIDC or SAML, through `@better-auth/sso`) by a person who has no account and no pending invitation is now refused. It redirects to the error page with `error=SELF_REGISTRATION_CLOSED`, and no user is created. Before, such a sign-in created the account. To keep the old behaviour for a provider, turn on its new `allowJit` option: **Setup → SSO Providers → Edit Sign-In Options**, or `POST /api/v1/auth/sso/update-provider` with `{ providerId, allowJit: true }`. Unchanged: a person who already has an account, a person with a pending invitation, the first human of an empty deployment, every sign-in under the `email_domain` or `open` posture, and the social and `oidcProviders` sign-ins.

- **Two options on each SSO provider, both off by default.** `sys_sso_provider` gains `allow_idp_initiated` and `allow_jit` (boolean, default false, history tracked). They are declared to `@better-auth/sso` as provider `additionalFields`, so its own `/sso/register` and `/sso/update-provider` accept them, a non-boolean is refused 400 `VALIDATION_ERROR`, and the people who can write a provider today are the only ones who can change them. Every change writes a `sys_audit_log` row and a field-level activity line with the old and the new value.
- **IdP-initiated sign-in (SAML and OIDC).** Off, a SAML Response with no `InResponseTo` is refused `error=unsolicited_response`, and an OIDC callback with a `code` and no `state` is refused `error=state_not_found`, as before. On, the vendor's own IdP-initiated handling runs for that provider only. For SAML, the vendor's plugin-wide `saml.allowIdpInitiated` now answers the provider's column for each ACS request. For OIDC, the column is carried into the configuration the vendor reads, and an `allowIdpInitiated` member stored in that configuration is ignored and removed on the next write.
- **Setup.** The SSO Providers list shows both options, and each row has an **Edit Sign-In Options** action.
