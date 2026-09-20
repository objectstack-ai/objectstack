---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

chore(spec)!: the metadata migration chain is supported from protocol 16 — `MIGRATION_SUPPORT_FLOOR` 10 → 16, and `step11`–`step16` retire with it (#19056)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authorable surface moves: no spec key, export or config field is removed or renamed, so there is no source rewrite for a D2 conversion or a D3 semantic entry to carry, and nothing for `os migrate meta` to rewrite. What narrows is the accepted `fromMajor` ARGUMENT RANGE of `applyMetaMigrations`, which the ledger has no vocabulary for - a conversion rewrites metadata, and this metadata is untouched. The one instruction a stopped consumer needs - reach protocol 16 by another path, then re-run - is carried by the `MigrationFloorError` message itself. -->

**BREAKING** for a consumer still authored against protocol **10, 11, 12, 13, 14
or 15**. Landing in the launch window as `minor` under the lockstep convention.

Maintainer ruling, 2026-09-18, verbatim and untranslated:

> 升级只需要支持从 16.0版本开始。

「16.0」reads as protocol major 16 — the same unit as the constant
(`PROTOCOL_VERSION` is `17.0.0`, so the package version `17.x` and the protocol
major are not the same number). That reading was put back to the maintainer and
was not contradicted.

## What changes for you

`MIGRATION_SUPPORT_FLOOR` — a published export of `@objectstack/spec` — moves
from `10` to `16`. Two consequences, both at the boundary:

| you call | before | after |
| --- | --- | --- |
| `applyMetaMigrations(stack, N)` for N ∈ 10..15 | replays the chain from N | throws `MigrationFloorError` |
| `os migrate meta --from N` for N ∈ 10..15 | migrates | refuses, naming the floor |
| `applyMetaMigrations(stack, N)` for N ≥ 16 | unchanged | unchanged |
| `MIGRATION_SUPPORT_FLOOR` as a TS literal type | `10` | `16` |

The fix, and the only one there is: **reach protocol 16 by another path first,
then re-run.** The refusal says so itself — `Cannot migrate from protocol N: the
chain's support floor is 16 (ADR-0087 D3). Upgrade to protocol 16 by another
path first, then re-run.` A stack already at 16 or above is unaffected, and the
16 → 17 and 17 → 18 hops are untouched.

If you pin `MIGRATION_SUPPORT_FLOOR`'s literal type (`const f: 10 = …`), that
annotation stops compiling. The value was always a release-policy knob, so read
the constant rather than restating it.

## What this is NOT

It is **not** a slimming change, and the measurement is the reason to say so.
Counted on `src/migrations/registry.ts` at `e6a03e649` (17,718 lines):

| block | lines | share |
| --- | ---: | ---: |
| `step11`–`step16` — what leaves | 328 | 1.9% |
| `step17` | 4,699 | 26.5% |
| `step18` | 7,565 | 42.7% |
| the registration map + the two retirement tables | 5,077 | 28.7% |
| file header | 49 | 0.3% |

Everything but the first row stays. What the raise buys is a **narrower support
promise**: six permanently-replayable chains no longer have to be maintained,
and the CI replay shrinks to the range the project actually promises — 10 of the
97 conversion fixtures leave the chain-replay gate, because the chain no longer
reaches the major that graduated them.

## What was deliberately NOT removed

`RETIRED_KEYS_BY_MAJOR` and `RETIRED_DEFS_BY_MAJOR` live in the same file and
are keyed by protocol major, which makes them look like chain state. They are
not, and both are kept whole:

- the chain never reads either table (`chain.ts` imports the steps and the floor
  and nothing else);
- their one non-test reader, `packages/spec/scripts/build-schemas.ts`
  (`check:authorable-surface`), folds every major into one set and never
  mentions `MIGRATION_SUPPORT_FLOOR`.

So a row below the floor is still the live proof that its retirement was
declared. Measured by ablation: a row planted under major **11** — a major whose
step this change deletes — was still read and judged, reported as *"(registered
at major 11)"*. Both facts are pinned in
`src/migrations/retired-tables-not-floor-scoped.test.ts` so the next floor move
reads them first. Dropping such a row errors nowhere at the moment it is
dropped; the declared retirement simply stops being declared.

The D2 conversion registry is untouched for the same reason: every rehydration
seam replays the **full** conversion chain over stored `sys_metadata` rows,
retired entries included, so the protocol-11/13/14/15 conversions keep
converting rows at rest long after the source-side chain stops reaching them.

## `@objectstack/cli`

`os migrate meta --help` advertised `--from 10`, `--from 10 --step`,
`--from 11 --to 12` and `--from 10 --out …`. Every one of those refuses after
this change. The examples are now derived from `MIGRATION_SUPPORT_FLOOR`, so the
next floor move cannot leave them advertising commands that throw.
