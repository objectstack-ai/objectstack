---
'@objectstack/spec': minor
'@objectstack/service-settings': minor
'@objectstack/objectql': patch
'@objectstack/service-datasource': patch
---

feat(spec): `CryptoContext` gains a required `scope` discriminant, and `LocalCryptoProvider` binds it into a delimiter-safe, versioned AAD (ADR-0128 D1–D3, #21326 stage 1)

Clause-②: yes

**BREAKING** for `ICryptoProvider` implementers and for every direct caller of
`encrypt`, `decrypt` or `rotateKey`: `CryptoContext.scope` is required, so a
context literal without it stops compiling (`TS2741`), and the compiler names the
missing member. `LocalCryptoProvider` also refuses such a context at runtime with
`CryptoContextScopeError`, for a caller the compiler never saw. Code that only
injects a provider is unaffected.

`scope` is a member of the new closed set `CRYPTO_CONTEXT_SCOPES` (type
`CryptoContextScope`), one member per producer of `CryptoContext`:
`settings` (`SettingsService`), `object_secret_field` (the ObjectQL engine's
secret-field path) and `datasource_credential` (the datasource secret binder).
Each producer in this release passes its own member on every call. A new producer
adds its own member; it never borrows an existing one.

What the contract now requires of every provider that binds AAD:

- **Producer-discriminated (D1).** The AAD binds `(scope, namespace, key)`, so a
  ciphertext sealed by one producer does not authenticate under another
  producer's context, whatever the two `(namespace, key)` pairs are.
- **Delimiter-safe (D2).** Distinct triples produce distinct AAD bytes. An
  unescaped join is not permitted.
- **Versioned.** A ciphertext records which AAD derivation sealed it, and is
  opened only with that derivation. An unknown derivation fails closed. No second
  derivation or scope is ever tried after a failure (D3).

`LocalCryptoProvider` seals every new value under derivation version 2: a lead
byte that never occurs in UTF-8, a versioned label, then the scope, namespace and
key, each prefixed with its 4-byte length. The ciphertext carries a `v2:` marker.
A ciphertext with no marker is version 1, the bare base64 every earlier release
sealed, and it still opens with the older `(namespace, key)` binding. Existing
secrets therefore keep working with no action, and carry the older binding until
they are re-wrapped. Re-wrapping existing ciphertext at rest is stage 2 of
#21326. `rotateKey` already re-seals a version-1 handle under version 2. Any other
marker is refused with `UnknownCiphertextVersionError`.

Operational note: a secret set or rotated by this release carries the `v2:`
marker, and an earlier release cannot open it. A rollback past this release needs
those values to be set again.

`@objectstack/objectql` and `@objectstack/service-datasource` pass their own
scope on every seal and open. Their public surface is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) `CryptoContext` and `ICryptoProvider` are TypeScript contracts with no metadata surface: no Zod schema, no authorable key, no export renamed or removed, and no stored row changes shape (`sys_secret.ciphertext` is provider-defined, and every existing ciphertext still opens), so `objectstack migrate meta` has nothing to rewrite. The affected party is a provider implementer or a direct caller, and the compiler names the missing member at their call site. -->
