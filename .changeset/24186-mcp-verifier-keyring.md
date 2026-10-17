---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the MCP access-token verifier follows the signing keyring instead of holding its own copy of the key set for five minutes

Clause-②: no

- **What changed.** `AuthManager.verifyMcpAccessToken` no longer keeps its own copy of the signing key set for five minutes. It reads the key set on every call through the same keyring reader the token signer and `/jwks` use, so the set it checks a signature against is held only under both halves of the cross-request caching rule: a `sys_jwks` write that passes this process's data engine retires it in the same operation, and a 30-second bound covers a write the process cannot see, such as one made on another node.
- **A token signed by a key the set does not carry gets one fresh read.** Before such a token is refused, the keyring is read once more from the table, and the token is checked again. That read is shared by every token that arrives while it is in flight, and a new one starts no sooner than 30 seconds after the previous one, so tokens that name keys which do not exist cost at most one keyring read per 30 seconds. A token whose key is still absent after that read is refused, as before.
- **Unchanged.** Issuer, audience, expiry, the `client_credentials` refusal and the `organization_id` claim are checked exactly as before. Only the public key set `/jwks` publishes is used for verification. No export, configuration key or environment variable is added.
