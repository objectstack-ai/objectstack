---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
'@object-ui/auth': patch
---

feat(auth): `directSignIn.afterSignOut` lets an explicit sign-out return through the identity provider's sign-in page

Clause-②: yes (widening)
Metadata-protocol: none

A deployment with direct sign-in on can now choose where an explicit sign-out returns once the identity provider has ended its own session. The default keeps today's behaviour, so nothing changes until a deployment sets the new value.

- The auth plugin's `directSignIn` option takes `afterSignOut: 'hold' | 'identity-provider'`, and the environment variable `OS_AUTH_DIRECT_SIGN_IN_AFTER_SIGN_OUT` wins over it, like the other direct sign-in settings. `hold` is the default. Any other value refuses to boot, naming the variable and both values.
- `GET /api/v1/auth/config` serves `features.afterSignOut` while the direct sign-in setting is on, on the same terms as `features.localSignIn`, and leaves it out otherwise. `AuthFeaturesConfigSchema` in `@objectstack/spec` gains the optional `afterSignOut` enum, and `PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS` gains `'afterSignOut'`.
- `hold`: the Console's sign-out sends the sign-in page as the provider's return address, and the page holds with a button to sign in again, as before.
- `identity-provider`: while `features.directSignIn` reads `true`, the Console's sign-out sends `{basePath}/sign-in/direct` instead, so after the provider's logout the browser goes through the direct sign-in door to the provider's own sign-in page. The door starts a fresh sign-in without the browser's cookies, and the provider has just ended its session, so it asks for credentials; it does not loop. Register the door's absolute address as a post-logout redirect URI at the provider.
- `@object-ui/auth`: `AuthPublicConfig.features` gains the optional `afterSignOut`. When the tab holds no auth config at sign-out, the client reads it once (3 seconds at most) and keeps the sign-in page if it cannot.
- Module exports on the `@objectstack/plugin-auth` entry: the type `DirectSignInAfterSignOut`. In `direct-sign-in.ts` (not on the package entry): `DIRECT_SIGN_IN_AFTER_SIGN_OUT`, and `DIRECT_SIGN_IN_ENV.afterSignOut`.
