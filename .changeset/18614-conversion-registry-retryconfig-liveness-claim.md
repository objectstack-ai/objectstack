---
"@objectstack/spec": patch
---

`src/conversions/registry.ts` — the `connector-rate-limit-config-removed` entry no longer asserts that `retryConfig` and the connector timeouts "are live" (#18614). The assertion was measured false; the ledger seeded by #18582 had already recorded the correction on the other side.

The comment conflated two different statements. That the rate-limit retirement left those keys *in place* is true and is kept — it is what the fixture's single notice demonstrates. That they are *live* was never measured by that entry and is false: the read-probe for `retryConfig`, `connectionTimeoutMs` and `requestTimeoutMs` finds no consumer anywhere outside `packages/spec` (the sibling key `providerConfig`, on the same schema, fires on the identical probe), no retry loop reads a strategy or a backoff, every timeout occurrence outside the spec is a write of the literal `30000` so a def satisfies the post-parse `Connector` type, and `ConnectorProviderContext` carries none of the three — so a provider factory cannot read them either. `liveness/connector.json` classifies all ten rows `dead` and is now cited as the authority.

Nothing is retired here and no schema moved: ADR-0049 owes these keys a decision, which the corrected comment states rather than pre-empts. The text ships — `tsup` preserves comments, so these bytes reach `dist/index.js`, `dist/index.mjs` and the `shared`/`browser` bundles inside the published tarball, which is why this is a `patch` and not `skip-changeset`.

Clause-②: no
