---
'@object-ui/auth': patch
---

fix(auth): sign-out follows the provider-logout redirect that better-auth answers, so signing out of a hosted environment also ends the cloud session

Clause-②: no
Metadata-protocol: none

On an environment signed in through an identity provider (ObjectOS Cloud, or any OIDC provider wired through `oidcProviders`), 退出登录 ended only the environment session. better-auth's `POST /sign-out` already answers `{ success: true, url, redirect: true }` for such a user, with `url` pointing at the provider's end-session endpoint, but the Console ignored it. The provider session survived, and 「使用 ObjectOS Cloud 继续」 signed the next person on a shared browser straight back in as the user who had just signed out, with no password.

- `createAuthClient().signOut()` now sends `callbackURL` = the SPA's own sign-in page (`<basename>/login`, so `/_console/login` on a hosted environment). better-auth passes it to the provider as `post_logout_redirect_uri`.
- When the answer carries `redirect: true` with an absolute `http:` or `https:` URL, the client clears the bearer token and then sends the window there with `window.location.assign`. Any other URL is ignored.
- `AuthProvider.signOut()` still resets its state and purges the tab's cached metadata before the page unloads. The header's 退出登录, the user menu and the remediation overlay's sign-out link all go through it.

What to do: nothing. A deployment without a provider gets `{ success: true }` from better-auth, and sign-out keeps its in-app route to the sign-in page. To end the provider session as well, register the environment's sign-in page (`<origin>/_console/login`) as a post-logout redirect URI with the provider.
