---
'@objectstack/plugin-auth': patch
---

fix(auth)!: under direct sign-in's local sign-in path `off`, the last identity provider is the last way in; the door's landings on the sign-in page keep its `?redirect=`

Clause-②: yes (narrowing) — narrowed: with direct sign-in on and its local sign-in path `off` (`directSignIn.localSignIn: 'off'`, or `OS_AUTH_DIRECT_SIGN_IN_LOCAL_PATH=off`), `POST /api/v1/auth/sso/delete-provider` on the last identity provider answers `409 DELETE_RESTRICTED` and deletes nothing while email and password is switched on, where it deleted the row; email and password, and phone sign-in, no longer count as a way in there, because the sign-in page does not offer them. Widened: two public functions, `pageOffersLocalSignIn` and `pageOffersEmailPassword`, an optional `localSignIn` on `SignInMethodConfigView.features`, and `carriedRedirect`.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches direct sign-in, the provider delete or the boot report; `content/docs/permissions/sso.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answer is a runtime refusal at one auth door under a deployment switch, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment running direct sign-in with the local sign-in path `off`: Setup's **Delete SSO Provider** on the last identity provider is refused `409 DELETE_RESTRICTED` (nothing deleted) unless another way in the sign-in page offers remains (another identity provider row, a social or OIDC provider with a client ID and secret, or a host sign-in handoff), even with email and password switched on. Before, the delete went through and the sign-in page then showed "No sign-in method is available". A boot in that state now reports at error under `no_sign_in_method_at_boot`.

Unchanged: the local sign-in path `hidden` (the default) and direct sign-in off, where email and password and phone sign-in count as before; the server's own password sign-in, which `off` never changed.

What to do: nothing, unless you delete the last identity provider under `off`. Register another identity provider first, or set `OS_AUTH_DIRECT_SIGN_IN_LOCAL_PATH=hidden` and restart.

Also fixed: the direct sign-in door hands the identity provider a sign-in page error address that keeps the page's `?redirect=`, and its own landing on the sign-in page (no provider to start, a refused or rate-limited start) keeps it too. A `?redirect=` that is not a same-origin path is dropped, by the return path's own rule.
