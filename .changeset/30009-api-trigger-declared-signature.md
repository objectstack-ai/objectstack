---
'@objectstack/trigger-api': patch
'@objectstack/lint': patch
'@objectstack/skills': patch
---

feat(trigger-api): an `api` hook verifies the vendor signature its start node declares (`config.signature`)

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/trigger-api`.** `start()` reads the hook's one verifier with `apiTriggerVerifierOf(binding.config)` (`@objectstack/spec/automation`). A start node that declares its sender's scheme (`config.signature`: DocuSign Connect's base64 `X-DocuSign-Signature-1`, a Stripe-style `t=…,v1=…`, a GitHub-style `sha256=`) now admits a correctly signed post that was answered `401` before. That scheme REPLACES the `x-objectstack-signature` check for its hook: the declared header is read on both faces of the door (the self-hosted mount and `handleInboundHook`) with `Headers.get`, so a repeated field is its one joined value; the HMAC-SHA256 is computed under the key `config.secretRef` names (read at every post through the engine's reader, `503` while it has no value), over the raw body or `<t>.<raw body>`; each digest is decoded strictly to 32 bytes and compared with `timingSafeEqual`, any one of several `v1` elements matching (a key roll); and a timestamped scheme is held to `HTTP_SIGNATURE_TOLERANCE_SECONDS` from `@objectstack/core`. A body-only scheme has no replay window, as the contract states. A valid `x-objectstack-signature` admits nothing on such a hook, and a post without the declared header is refused. A declaration the spec answers `unusable` arms a hook that refuses every post before any secret is read and never falls back to `x-objectstack-signature`; a declared scheme bound without the engine's `config.secretRef` reader is refused at `start()`. Every failure is the same `401 INVALID_SIGNATURE` with its own cause in the server log (`declared-header-absent`, `declared-header-malformed`, `declared-prefix-missing`, `declared-no-digest`, `declared-mismatch`, `declared-outside-window`, `declared-unusable`), never the key, the header value or the body. A hook that declares no scheme is verified exactly as before.
- **`@objectstack/lint`.** `validateFlowApiTriggerSecret` grades an `api` hook by that same reader: a usable declaration is ready on its `config.secretRef` alone, and an unusable one is the new error `flow-api-trigger-signature-unusable` (with its `os explain` entry), located at the key the spec refuses. It fires only on a declaration the flow parse already refuses, so no stack that passed before is refused now.
- **`@objectstack/skills`.** The automation and api skills teach `config.signature` where they said a vendor-signed callback cannot be admitted.
