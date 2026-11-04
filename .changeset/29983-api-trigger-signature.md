---
'@objectstack/spec': minor
---

feat(spec): an `api` flow's start node declares a third-party sender's signature scheme (`config.signature`), keyed by `config.secretRef` (#29983)

Clause-②: yes (widening)
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) A new optional key on an api start node's open config: nothing an author wrote before is refused, renamed or re-shaped, so there is nothing at rest for a migration to rewrite. -->

An inbound `api` hook admitted a post only by ObjectStack's own `x-objectstack-signature`, so a vendor that signs its callbacks its own way (DocuSign Connect, a Stripe-style `t=…,v1=…` header, a GitHub-style `sha256=` header) could not be admitted at all. The start node's `config` now carries `signature`, which declares how such a sender signs:

- `signs: 'body'`: the raw body alone, the whole header value (after an optional `prefix`) is the digest. DocuSign Connect: `{ signs: 'body', header: 'X-DocuSign-Signature-1', algorithm: 'hmac-sha256', encoding: 'base64' }`.
- `signs: 'timestamp.body'`: `T.RAW_BODY`, the header being `NAME=value` elements whose `timestampElement` carries `T` and whose `digestElement` carries the digest. Stripe-style: `{ signs: 'timestamp.body', header: 'Stripe-Signature', algorithm: 'hmac-sha256', encoding: 'hex', timestampElement: 't', digestElement: 'v1' }`.

The key is the start node's `config.secretRef`, as for an ObjectStack-signed hook. Declared, the scheme REPLACES the `x-objectstack-signature` check for that hook (one verifier per hook, never optional). The flow parse refuses a `signature` with no `secretRef`, one beside a literal `secret`, an algorithm other than `hmac-sha256`, an encoding other than `hex` or `base64`, a `timestamp.body` scheme with no `timestampElement` (or no `digestElement`, or the same name for both), a body-only scheme that names a timestamp element, and one on a flow that binds no `api` trigger.

New exports from `@objectstack/spec/automation`: `ApiTriggerSignatureSchema`, `ApiTriggerSignature`, `API_TRIGGER_SIGNATURE_KEY`, `apiTriggerVerifierOf` (the one reader of which verifier a hook has: `objectstack-signature`, `declared` or `unusable`), `ApiTriggerVerifier`, `apiTriggerSignatureRefusals` and `ApiTriggerSignatureRefusal`. The `ITriggerApiService.handleInboundHook` contract text states what the implementer owes: a constant-time compare of the decoded 32 bytes, the same 300-second window as `x-objectstack-signature` for a scheme that signs a timestamp, no replay window for a body-only scheme, and the one `401 INVALID_SIGNATURE` for every failure.

This release declares the key; the `api` trigger does not verify it yet. Until it does, a hook that declares `signature` is still verified by `x-objectstack-signature` alone, so every post its vendor sends is refused `401`, and none is admitted unverified.
