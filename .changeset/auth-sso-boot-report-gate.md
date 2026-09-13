---
'@objectstack/plugin-auth': patch
---

Gate the `no_sign_in_account_at_boot` boot report on whether the deployment has a delegated sign-in path.

The report fires on one store shape — human `sys_user` rows, zero `sys_account` rows — and calls it unrecoverable. On a deployment whose sign-in is delegated to an identity provider that shape is the healthy resting state: `ssoOnlyMode` states it in the auth config contract ("managed (IdP-provisioned) users simply hold no local credential") and names cloud-as-IdP. Such a kernel logged the report at `error` on every boot, including boots that had just served a successful SSO sign-in.

The report now also reads the runtime's sign-in wiring — SSO-only mode declared, a configured social/OIDC provider, or enterprise SSO with at least one registered `sys_sso_provider` — and stays silent at `error` when one of them holds, recording the shape at `debug` under the same grep token with the reason named.

Unchanged: `probeSignInAccountsPresence` keeps its existence-only predicate, and a deployment with no delegated sign-in path — including one that merely switched the SSO plugin on with no identity provider registered — still reports at `error`.
