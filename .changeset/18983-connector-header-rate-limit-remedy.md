---
'@objectstack/spec': patch
---

docs(spec): the connector header no longer teaches `retryConfig` as the remedy for a rate-limited upstream (#18983)

`packages/spec/src/integration/connector.zod.ts` ships inside this package —
`files[]` carries `src/**/*.zod.ts`, and the file is present in the published
tarball — so its header TSDoc is text consumers read, and the generated
reference page is rendered from it. That header ended its "no outbound rate
limiting" paragraph with "what L3 does declare for a rate-limited upstream is
`retryConfig` — whose `retryableStatusCodes` default `[408, 429, 500, 502, 503,
504]` includes `429` — and `health.circuitBreaker`", which reads as a remedy.

It is not one. `packages/spec/liveness/connector.json` records all eight
`retryConfig` sub-keys and every `health.circuitBreaker` sub-key as `dead`
(verifiedAt 2026-09-17), and outside `packages/spec` nothing reads either: no
retry loop consumes the strategy, the backoff, the jitter or that status-code
list, so the `429` in it never causes a retry, and no breaker ever opens. An
author who followed that sentence wrote configuration that parses, stores, and
is then silently ignored.

The sentence now carries the wording PR #18979 landed for the same claim in
`packages/spec/docs/SYNC_ARCHITECTURE.md`: both keys are **declared but
currently unimplemented**, with a pointer to the liveness ledger, and they are
explicitly neither retired — both are still declared and still parse, so an
author writing them sees no error — nor left to the host, since
`ConnectorProviderContext` carries exactly `name`, `label`, `description`,
`icon`, `type`, `providerConfig`, `auth` and `loadPackageFile`, and a provider
factory is therefore never handed either key.

**Prose only — zero behaviour change.** No schema, declaration, default or
accept set moves, and the keys' fate stays ADR-0049's to rule on rather than
being prejudged here. The generated reference page
`content/docs/references/integration/connector.mdx` follows from `gen:docs`; it
is not published by any package in this workspace.
