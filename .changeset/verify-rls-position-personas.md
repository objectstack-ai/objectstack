---
"@objectstack/verify": minor
"@objectstack/cli": minor
---

feat(verify): `--rls` runs one probe persona per DECLARED POSITION, so app-authored narrowing is exercised (#7978)

`objectstack verify --rls` proves one invariant — **you cannot mutate what you
cannot see** (#1994). Since #7685 its probe persona authors its own capability
(object read+edit, owner-scoped `select` only), which makes the *platform's*
by-id write gate reachable. That persona holds **no positions** by construction,
and a policy carrying `positions: [...]` is never applicable to a caller who does
not hold one — so an app's own position-gated narrowing was never exercised, only
the platform gate underneath it. That is exactly the authoring shape the real
#7665 defect wore: an ordinary `contributor` against
`positions: ['contributor']` rules.

## What changed

- **One persona per position the app DECLARES.** The set is derived from
  `config.positions` (`declaredPositionNames`), never a list kept in the
  verifier — a position added to an app is covered without touching this
  package. Each persona holds that position and nothing else, so its whole
  capability is what the app itself binds to it (`provisionRlsPositionPersona`
  writes one `sys_user_position` row; the built-in `everyone` / `guest` anchors
  are excluded, since no app declares them).
- **Probe targets are established once and shared** by every persona, so a
  position costs 4 HTTP calls per object rather than re-deriving and re-creating
  a record per persona. Each persona mutates with a **distinct short marker**, so
  "did the row change" stays attributable — and short, because a probe field's
  `maxLength` would truncate a long marker into a false negative.
- **Coverage is reported per position, never rolled into one number.**
  `RlsReport` gains `positionRuns[]` (one summary per position), `totals` (every
  persona's verdicts summed; the unit is one *object × persona* probe) and
  `positionCoverage` (`declared` vs `ran`, plus `notRun` for a declared position
  whose persona could not be provisioned, and a `note` when the app declares no
  positions at all — "nothing to run" must not read like "nothing to find").
  `summary` / `results` / `unproven` still describe the base persona exactly as
  before.
- **`verify` counts a position persona's holes.** The exit contract reads
  `totals.holes`, and an unprovisionable declared position is a hard failure for
  the same reason a degraded base persona is: the run covered less than its
  numbers read.

## Measured, before → after

| | showcase | crm |
|:--|:--|:--|
| before | 23 probes: 20 proven (20 consistent, **0 holes**), 3 unproven (0 probe-blocked, 3 skipped) — exit 0 | 6 probes: 6 proven, 0 holes, 0 unproven — exit 0 |
| after | 230 probes (base + 9 positions): 35 proven (33 consistent, **2 HOLES**), 195 unproven (54 member-visible, 111 probe-blocked, 30 skipped) — exit 1 | 24 probes (base + 3 positions): 6 proven, 0 holes, 18 unproven (18 probe-blocked) — exit 0 |

Cost: showcase 22s → 50s, crm 10s → 12s (`dogfood-verify` budget is 20 min).

**The two showcase holes are real and are NOT fixed here** — filed as #8059. A
`contributor` reads `GET 404` on a `showcase_invoice` and still PATCHes it by id;
the app's check-only `update` policy suppresses #7665's write-scope derivation,
and the post-image `check` that should have caught it is dropped for
position-scoped callers. Tuning the probe to keep the run green is the one thing
this verifier must never do, so `verify --rls` on the showcase now exits 1 until
#8059 lands.

The new personas are falsifiable, not decorative: ablating the #7665 write-scope
derivation flips the `contributor` persona's `showcase_task` from
`rls-consistent` to `rls-hole` (and the base persona's 16, unchanged from #7685's
measurement).

## No behaviour change outside the verifier

Tooling only: no runtime, spec or enforcement path is touched. `runRlsProofs`'
existing call shape still works, and consumers that only read the report gain
fields rather than losing any.
