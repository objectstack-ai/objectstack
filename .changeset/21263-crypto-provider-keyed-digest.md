---
'@objectstack/spec': minor
'@objectstack/service-settings': minor
---

feat(spec): `ICryptoProvider` gains a required `keyedDigest(plain): Promise<string>` member, and `LocalCryptoProvider` implements it (#21263)

Clause-②: yes

**BREAKING** for `ICryptoProvider` implementers: the new member is required, so a
provider that does not declare it stops compiling (`TS2420` on a class, `TS2741`
on an object literal), and the compiler names the missing member. Code that only
calls a provider is unaffected.

`keyedDigest` is a digest of `plain` under the provider's server-held key, for a
value that is handed to a caller but must not let that caller check a guess about
the input offline. The contract requires three things of every implementation:

- **Keyed.** The output cannot be computed without the provider's key. A provider
  that holds no key material rejects; it never returns an unkeyed value.
- **Stable per key.** Under one key, equal input gives equal output in every
  process and on every node that holds the key. Replacing the key changes every
  output.
- **Not a substitute for `digest`.** `digest` keeps its contract and the stability
  the audit trail relies on.

The output is `hmac-sha256:` followed by the 64 lowercase hex characters of an
HMAC-SHA-256: 76 characters from `[0-9a-z:-]`, which travel unchanged in an HTTP
header, a query string and JSON, and never collide with the `sha256:` spelling of
an unkeyed content hash.

`LocalCryptoProvider` computes it from the 32-byte data key it already resolves
(`OS_SECRET_KEY`, `OS_DEV_CRYPTO_KEY`, the persisted key file, or the ephemeral
test-mode key), through a MAC key derived from that data key, so the AES-GCM key
is never used as a MAC key. There is no new secret or environment variable to
configure. An instance constructed with an explicit key that is not 32 bytes holds
no usable key material, and its `keyedDigest` rejects with
`KeyedDigestKeyUnavailableError`.

<!-- adr-0087: not-required (no-migration-prescription) `ICryptoProvider` is a TypeScript contract with no metadata surface: no Zod schema, no authorable key, no export renamed or removed and no stored row changes shape, so `objectstack migrate meta` has nothing to rewrite. The affected party is a provider implementer, and the compiler names the missing member at their declaration. -->
