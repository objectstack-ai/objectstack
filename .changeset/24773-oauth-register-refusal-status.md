---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a refused OAuth application registration answers the status the refusal declared, not 500 (#24773)

Clause-②: no

`POST /api/v1/auth/sys-oauth-application/register` answered most refusals from better-auth as `500 OAUTH_REGISTER_FAILED`. better-auth raises each refusal as an `APIError` whose HTTP status is the number `statusCode` (`400`) and the name `status` (`'BAD_REQUEST'`). The route read only a numeric `status`, so a named refusal fell through to 500. Two examples are a redirect URI the provider refuses, such as `http://localhost:4001/callback` on a `web` client (`invalid_redirect_uri`), and a request with no session (`UNAUTHORIZED`).

- **Now.** The route answers the refusal's own status: `400` for the redirect-URI refusal and `401` for the missing session. The code stays `OAUTH_REGISTER_FAILED`, and `error.details.upstreamError` still carries the provider's discriminator (`invalid_redirect_uri`).
- **Unchanged.** A throw that declares no status, such as a storage fault while the client is persisted, still answers `500`. The body-schema refusal keeps answering `400`. Which redirect URIs a client may register is unchanged: a `web` client still needs an `https` URI on a non-loopback host.
