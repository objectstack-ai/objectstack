---
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': patch
---

fix(plugin-auth)!: `POST /api/v1/auth/sys-oauth-application/register` refuses an application type the OAuth provider does not judge with `400 INVALID_REQUEST`, where it registered it as a `web` client

Clause-②: no (narrowing) — the register door accepted any `type` value and registered every one other than `web` / `native` as a `web` client with a secret; it now refuses each of those values with 400, so it accepts exactly `web`, `native` and no type.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer one runtime REST door gives a caller whose request body names an application type the OAuth provider has no counterpart for; the remedy is a different value in that request, never a rewrite of a package source or a stored row. The Console form that posts to this door already offers only Web and Native, and `sys_oauth_application` rows are not touched. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a REST door's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

The OAuth provider (`@better-auth/oauth-provider`) judges two application types, `web` and `native`, and this door forwards the type the Setup → OAuth Applications form chose as the provider's `application_type`. Any other value has no provider counterpart. The door used to register such a request as a confidential `web` client, with a client secret and the web redirect-URI rule, which is a different kind of client from the one the request asked for. It now refuses the request instead.

- **FROM:** a request whose `type` is present and is neither `web` nor `native` (`user-agent-based`, `public`, any other string including the empty string, or a value that is not a string) answered `200` and stored a `web` client, or answered the web rule's `400 OAUTH_REGISTER_FAILED` for a loopback redirect URI, and the server logged one warning naming the value.
- **TO:** the same request answers `400` with `error.code: 'INVALID_REQUEST'`. The message names the value (its first 64 characters) and the two accepted types, and says to choose `native` for an `http://localhost`, `http://127.0.0.1` or `http://[::1]` redirect URI. The provider is not called, nothing is stored, and no warning is logged: the refusal replaces that warning.
- **Unchanged:** `web` and `native` are forwarded as the provider's `application_type`, and the provider's own redirect-URI rule decides. A request with no `type`, or with `type: null`, registers a `web` client, the provider's default. The other refusals keep their codes and statuses. Clients already registered are not touched.
- **`@objectstack/platform-objects`:** only the code comment on the `create_oauth_application` action changes, to state this refusal; it ships in the package's JavaScript. The form already offers only Web and Native.
- **The fix for an integrator:** send `type: 'web'` for a client whose redirect URIs are https on a host that is not a loopback address, or `type: 'native'` for a client that also redirects to `http://localhost`, `http://127.0.0.1` or `http://[::1]`. Omitting `type` registers `web`.
