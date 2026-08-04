---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): sign JWTs with an algorithm the host can actually use (#3585)

On any host whose WebCrypto lacks Ed25519 — StackBlitz/WebContainer is the
reported one — **every authenticated request 500'd as soon as the OIDC provider
was enabled**, which is the default whenever the MCP server is on. Sign-in
succeeded, then the first `/api/v1/auth/get-session` returned 500 with
`OperationError … cfrgGenerateKey`. An app that never asked for OIDC got an
unusable login, and the only escape was `OS_OIDC_PROVIDER_ENABLED=false`.

The cause was an inherited default: `plugin-auth` registered better-auth's `jwt`
plugin without `jwks.keyPairConfig`, so better-auth's **EdDSA / Ed25519** default
applied and jose asked WebCrypto for an algorithm the host does not have. It hit
ordinary cookie login rather than just OAuth clients because the plugin's `after`
hook signs a `set-auth-jwt` header for *every* session.

**Three changes, no configuration required:**

- **The signing algorithm is now chosen by capability, not by inheritance.** At
  instance build the plugin asks WebCrypto whether it can generate an Ed25519
  key pair — using the exact algorithm descriptor jose uses — and pins
  `keyPairConfig` to `EdDSA`/`Ed25519` when it can, or falls back to **ES256**
  when it cannot. Hosts with Ed25519 behave exactly as before.
- **Deployments that already minted an EdDSA key keep working.** Choosing ES256
  for *new* keys is not sufficient on its own: better-auth's `resolveSigningKey`
  falls back to *any* stored key when none matches the configured algorithm, so
  an existing EdDSA key in `sys_jwks` would still be selected and then fail in
  `importJWK`. On a host without Ed25519 the plugin now installs better-auth's
  `adapter.getJwks` keyring seam and hides keys this host cannot import, so a
  fresh ES256 key is minted and the deployment converges on a working state.
  Hidden rows are **never deleted** — move back to a host with Ed25519 and they
  are used again. Such a host also stops advertising those keys in
  `/api/v1/auth/jwks`, since it can neither sign nor verify with them.
- **A signing failure can no longer take down the session path.** If signing
  fails anyway (neither algorithm usable, an unwritable `sys_jwks`, or a rotated
  `OS_AUTH_SECRET` that cannot decrypt the stored key), `/get-session` now
  returns the session normally and simply omits the `set-auth-jwt` header,
  instead of 500ing. The failure is reported once with an error that names the
  algorithm, says what still works, and points at the opt-out — and is queryable
  via `getDegradedAuthFeatures()` under the new `jwtSigning` key.

No configuration changes and no migration. Deployments on hosts with Ed25519 are
unaffected: the keyring override is installed only where it is needed.
