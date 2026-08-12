---
---

test(qa): the `@objectstack/spec` backward-compatibility gate now reads spec source instead of `spec/dist` (#7991)

Release-nothing: adds `packages/qa/downstream-contract/vitest.config.ts` and a pin test,
and removes that package's entry from `KNOWN_UNALIASED_TEST_IMPORTS` in
`scripts/check-test-source-alias.mjs`. No package code changes.

`packages/qa/downstream-contract` is the frozen third-party consumer fixture — the
backward-compatibility gate for `@objectstack/spec`, whose README states that a failure
there means a spec change has narrowed something a published-spec consumer already
relies on. It shipped no `vitest.config.*`, so every `@objectstack/spec` import resolved
through `exports` to `packages/spec/dist`, a build artifact: the one suite built to
answer "is this spec change breaking?" was rendering a verdict about build state.

Measured on this package, direction predicted before running. With a required field
injected into `ConnectorSchema` in SOURCE only and no rebuild — a break the frozen
`DcConnector` fixture cannot parse:

Counts below are `test/contract.test.ts` — the 14 frozen-fixture cases — so that the
before and after columns describe the same 14 assertions. (The suite as a whole is 16
once the 2 new pin cases are counted, and is green: `Tests  16 passed (16)`.)

| tree | before this change (no alias) | after (aliased) |
|---|---|---|
| spec source == dist | 14 passed (14) | 14 passed (14) |
| required field injected into `ConnectorSchema` source, no rebuild | **14 passed (14)** | **1 failed \| 13 passed (14)**, naming `osProbeRequiredField` |

The two runs in the second row are the same checkout with the same stale `dist`; the only
difference is whether `vitest.config.ts` is present.

A green here is consumed as evidence of backward compatibility, and it was not evidence
of that. Turbo already orders `test` after `^build`, so `turbo run test` was never the
failing path; what breaks is every path turbo does not mediate (`pnpm test` inside the
package, `vitest run <file>`, an editor runner, a tree built at an older commit) — the
paths this gate is re-run on while someone is changing the spec.

Two cases in a new `test/source-resolution.pin.test.ts` keep the demonstration
executable rather than historical: one imports `@objectstack/spec/conversions`, a source
directory the `exports` map deliberately does not publish, so it resolves only through
the alias; the other pins `defineConnector` from the package root and from
`@objectstack/spec/integration` to one object, which is both the missing-alias guard and
the standing guard on a dual instance.

The alias uses the anchored regex / array form (the object form matches by prefix and
would resolve `@objectstack/spec/ui` to `spec/src/index.ts/ui`, ENOTDIR), with the
replacement spelled `path.join(<packages>, 'spec/src/$1/index.ts')` rather than as a
template literal — `check:test-source-alias` reads a replacement by its last string
literal and cannot see through the template form (#8020).

Adjacent exposure found while measuring and deliberately left for its own card: the
package's other half, `typecheck`, still resolves spec types through `dist/*.d.ts`, so a
narrowed export type reads green there the same way (#8021).
