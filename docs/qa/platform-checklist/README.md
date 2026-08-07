# Platform test checklist — standing ledger

A durable, machine-readable checklist of platform capabilities that an **AI agent
executes** against a running app (browser + API + CLI + build gates). It replaces the
one-off shapes release verification used before — a hand-written table per release
([docs/plans/release-15.1-test-plan.md](../../plans/release-15.1-test-plan.md)) and a
checkbox issue per release (#3358) — with one ledger that **accumulates across
releases**, supports append/change without losing history, and pins every tick to an
acceptance oracle and captured evidence.

Validated in CI: `pnpm check:platform-checklist`
(`scripts/check-platform-checklist.mjs`). Execution protocol for agents:
[RUNNER.md](./RUNNER.md). Run records: [runs/](./runs/README.md).

## Layout

```
docs/qa/platform-checklist/
  README.md        ← this file: what an item is, how to append / change / retire
  RUNNER.md        ← how an AI runs the checklist accurately (verdicts, oracles, evidence)
  areas/*.json     ← the ledger, sharded by feature area (append here)
  runs/            ← durable run records (one JSON per executed sweep)
```

Sharding by area keeps parallel edits conflict-free: two agents appending to different
areas never touch the same file, and slug ids (below) never collide the way
next-sequential numbers do.

## Item anatomy

```jsonc
{
  "id": "approvals.per-group-signoff",   // "<area>.<slug>" — immutable, globally unique, never reused
  "title": "Per-group sign-off (会签) needs one approval from EACH group",
  "since": "v16",                        // release that introduced the capability
  "status": "active",                    // active | draft | retired
  "revision": 1,                         // bumps on any semantic edit
  "priority": "P1",                      // P0 = release-gating smoke · P1 = core · P2 = extended
  "surface": "browser",                  // browser | api | cli | build | mixed  (the 15.1 plan's 🖥/🔌 lanes)
  "personas": ["…"],                     // who the runner signs in as
  "fixtures": {                          // what the environment must provide — the #1 cause of
    "app": "showcase",                   // blocked runs in #3358 was missing fixtures, so they are
    "requires": ["…"],                   // declared up front, and known gaps are recorded, not
    "knownGaps": ["…"]                   // rediscovered every sweep
  },
  "steps": ["…"],                        // how to exercise it
  "acceptance": [                        // ★ the acceptance criteria — one clause per assertable fact
    { "clause": "what must hold",
      "oracle": "api",                   // api | network | screenshot | dom | log | test | build
      "verify": "how to consult the oracle, concretely",
      "evidence": "what artifact the run must capture" }
  ],
  "negative": ["…"],                     // the other side of every gate (deny/absence cases)
  "traps": ["hydration-race"],           // known false-positive risks (vocabulary in RUNNER.md)
  "automated": { "kind": "e2e", "ref": "path/to/pinning.test.ts" },  // set when a permanent test pins it
  "blocked": { "by": "fixture", "ref": "#NNNN" },  // standing blocker, waive-with-a-reference
  "source": ["#3358 §1"],                // where the expectation comes from
  "history": [ { "revision": 1, "date": "…", "change": "…", "ref": "#PR" } ]
}
```

Design notes:

- **Acceptance is clause-grained**, because runs are clause-grained: the #3358 sweeps
  repeatedly proved half an item and honestly left the box unchecked ("upload guard —
  not ticking on the strength of a label"). Clause verdicts let a run record *which*
  half passed instead of collapsing to one checkbox.
- **Every clause names its oracle.** The oracle hierarchy and the anti-false-positive
  rules live in [RUNNER.md](./RUNNER.md); the validator only enforces that an oracle is
  declared — an oracle-free clause is an invitation to tick on vibes.
- **`automated` is the 🤖 lane** of the 15.1 plan: once a permanent test pins an item,
  runs may satisfy it by executing that test and citing its output as evidence, instead
  of re-driving the browser.

## Lifecycle — append, change, retire (never delete)

- **Append** — add an item to its area file (or add a new area file). Pick an
  `<area>.<slug>` id that will still make sense in two years; ids are immutable and
  never reused. New-capability items land with `since: v<current>` in the same PR as
  the capability, or from the release notes at release time.
- **Change** — edit the fields, bump `revision`, append a `history` entry saying what
  changed and why. The revision matters because run records pin the revision they ran
  against: a semantic edit silently re-validating old results is exactly what the
  validator's revision/history check exists to stop.
- **Retire** — set `status: "retired"` + `retiredReason` (and `supersededBy` when a
  successor exists). The row stays in the file; deleting rows destroys the history that
  makes old run records interpretable. Retire when the capability is removed
  (ADR-0049 enforce-or-remove) or the item is folded into a successor.
- **Blocked is not a lifecycle state** — it's a standing annotation (`blocked: {by,
  ref}`) meaning "not runnable on stock fixtures today, tracked at <ref>". The
  showcase-side fixture gaps #3358 uncovered (#3408, #3409, #3415) each cost a sweep to
  rediscover; recording the gap on the item is what stops that.

## How a release sweep works

A release no longer gets a hand-written checklist. The sweep for `vN` is a **filter
over this ledger**: `since == vN` (the new capabilities) ∪ all `P0` (the standing
smoke) ∪ any item whose `source` cites a PR in the release. The tracking issue for the
sweep links here and hosts discussion; results land as a run record under `runs/`
(plus findings filed as issues, one per failure). Item text, fixtures learned, and new
traps discovered flow **back into the ledger** as revisions — that is the accumulation
the one-off checklists never had.

## Relationship to what already exists

| System | Relationship |
|---|---|
| `.claude/skills/dogfood-verification` | **How** to boot/drive/verify without lying to yourself. RUNNER.md builds on it; the skill is not restated here. |
| `packages/verify` (`objectstack verify`) | Headless auto-derived proof engine (CRUD fidelity, RLS). Items delegate to it via `automated`/`oracle: "test"` rather than re-proving by hand. |
| `packages/qa/dogfood` golden tests | Permanent pins for historical regressions — the `automated.ref` target for API-lane items. |
| `examples/app-showcase/src/coverage.ts` | The ratchet that every spec variant is *demonstrable*. This ledger asserts the demonstrations *work when driven*. Fixture gaps found here should often be fixed there. |
| objectui `e2e/live/*` + ADR-0054 | The browser-lane automation and the UI-testability contract (stable locators, machine-readable async state) that makes browser oracles trustworthy. |
| `docs/plans/release-15.1-test-plan.md`, #3358 | The predecessors this generalizes. Their vocabulary (方式 lanes, 验证要点, 来源) maps to `surface`, `acceptance`, `source`. |

**Deliberately not reused:** `packages/spec/src/qa/testing.zod.ts`
(`TestScenarioSchema`). Its action vocabulary is headless-API-only
(`create_record`/`api_call`/…) and cannot express browser clauses, visual oracles,
fixtures, or evidence requirements — and it currently has no runtime consumer (a
declared-but-inert surface under ADR-0049/0078, `qa` has no liveness ledger entry).
Adopting it here would have silently changed its meaning; if it gains a real executor
some day, `oracle: "test"` items can point at scenarios expressed in it.
