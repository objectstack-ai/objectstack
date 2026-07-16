# @objectstack/downstream-contract

A **frozen, representative third-party consumer** of `@objectstack/spec`, used as a
backward-compatibility gate.

## Why this exists

Every other consumer the framework tests — the example apps, `@objectstack/dogfood` —
lives in this monorepo and **co-evolves with the spec in the same commit**. When a spec
change would break them, the same PR just fixes them. So they can never catch a change
that breaks a *real* third party (e.g. [hotcrm](https://github.com/objectstack-ai/hotcrm))
that is pinned to a **published** release and authors metadata independently.

This package closes that gap. It is authored exactly the way an external project does —
importing from the package entry points, mixing the builder (`ObjectSchema.create`),
the `defineX` factories, and **bare metadata literals** (the pattern third parties on
older releases used, see #2035) — and then validates that metadata against the spec.

## The contract (read before editing)

These fixtures are **frozen**. The gate is:

> A spec change that requires editing the fixtures to stay green is, by definition, a
> **breaking change** for third parties.

So if a change here turns red:

- **Do not** edit the fixtures to make it pass. That hides the very break this package
  exists to surface.
- Treat it as a deliberate decision: either revert/adjust the spec change to stay
  backward compatible, or — if the break is intended — bump `@objectstack/spec` to a new
  **major** and document the migration, *then* update the fixtures in the same PR.

## What it checks

- `pnpm --filter @objectstack/downstream-contract typecheck` — the fixtures are typed
  with real spec types (`ActionInput`, `ReportInput`, `PageInput`, …). A removed or
  narrowed export fails here (the #2023 class of break).
- `pnpm --filter @objectstack/downstream-contract test` — runs each bare-literal fixture
  through its schema's `.parse()` and assembles everything via `defineStack` (schema +
  cross-reference validation — the heart of `objectstack validate`).

For the live counterpart, the release pipeline can additionally run hotcrm's own
`validate && typecheck && build` against the unreleased spec; this package is the fast,
deterministic, in-CI floor.
