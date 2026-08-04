---
"@objectstack/spec": minor
"@objectstack/metadata": minor
---

fix(metadata,spec): the endpoint publish gates now guard the metadata write path too (#5189, #5040 E7b)

#5111 (E7) hung the five per-endpoint `apis:` gates on
`ObjectStackDefinitionSchema`, which every path that parses a **stack** runs
through — `defineStack`, `os validate`, the lint scorer, artifact ingest,
`EnvironmentArtifactSchema.metadata`. #5189 proved a stored `api` item need
never have been part of a stack: `MetadataManager.publishPackage`, a direct
`metadata.register()` and a Studio metadata write each mint one item at a time
and saw no gate at all.

Three of the five gates degrade safely when bypassed — the executor answers a
structured 501 naming the item, and a path outside the `apps/<namespace>/`
carve-out simply matches nothing. **ADR-0121 D6 has no runtime counterpart**:
the runtime honours `authRequired: false` faithfully and `deriveBucketConfig`
returns `null` for a budget whose `enabled` is not `true`, so the bypass minted
an anonymous, zero-quota execution entry point — the exact shape D6 exists to
forbid.

Two doors now, both running the SAME gate function rather than a second copy of
the criteria:

- **Publish** — `MetadataManager.publishPackage` runs
  `validateApiEndpointDeclarations` over the package's `api` items and fails
  the publish, naming each endpoint and the key to fix, on the same
  `validationErrors` surface it already uses. This pass is **not** governed by
  `options.validate`: an opt-out on a security gate is the bypass this fixed.
- **Load** — the endpoint matcher's index build re-applies the *identity-free*
  subset (supported subset, mapping, policy/D6) to every stored item. A
  declaration that never passed publish is EXCLUDED from the index and named at
  `error` level, so a bypassed endpoint answers 404 with a loud log instead of
  answering anonymously and unmetered. The namespace and uniqueness gates are
  deliberately not applied there — both need a stack identity a stored row does
  not carry.

**New in `@objectstack/spec/api`** (the module was package-internal in #5111,
whose only consumer was one file away):
`validateApiEndpointDeclarations`, `identityFreeEndpointGateFailure`,
`EndpointGateIssue`, `EndpointGateIdentity`.

**New option — `publishPackage(id, { namespace })`.** `MetadataManager` indexes
items by `packageId` and carries no manifest, so it cannot prove a namespace on
its own and will **not** infer one from the items it is judging (an
author-supplied value would make the ADR-0121 D1/D2 carve-out gate vacuous).
Callers that hold the package manifest pass its explicit `manifest.namespace`;
without it the namespace gate fails and the package's `api` items do not
publish — which is the rule, not a limitation: a publish that cannot prove a
namespace must not mint a URL under one. Packages that declare no `api` items
are untouched.
