# Platform test checklist — standing ledger

A durable, machine-readable checklist of platform capabilities that an **AI agent
executes** against a running app (browser + API + CLI + build gates). It replaces the
one-off shapes release verification used before — a hand-written table per release
([docs/plans/release-15.1-test-plan.md](../../plans/release-15.1-test-plan.md)) and a
checkbox issue per release (#3358) — with one ledger that **accumulates across
releases**, supports append/change without losing history, and pins every tick to an
acceptance oracle and captured evidence.

Validated by `pnpm check:platform-checklist` (`scripts/check-platform-checklist.mjs`) —
a zero-dependency structural + coverage check. **By maintainer decision it runs on a
periodic MANUAL cadence, not in CI**: run it before a release, after a large platform
surface lands, or alongside a `checklist-author` / `checklist-test`. It is a QA ledger, not
a per-PR code gate, so an unrelated PR is never blocked by checklist drift. Execution
protocol for agents: [RUNNER.md](./RUNNER.md). Run records: [runs/](./runs/README.md).

**Two internal skills drive this ledger** (`.claude/skills/`, never published):
`checklist-author` **authors** items (find gaps → write them, per
[SWEEP.md](./SWEEP.md)); `checklist-test` **executes** them (pick items by selector →
drive them → emit a run record, per [RUNNER.md](./RUNNER.md)). The runner resolves what
to test with `scripts/checklist-select.mjs <selector>` — an item id, an `area:`, a
`capability:`, a `priority:`, a `since:vN` release, or a **`file:<path>`** that maps a
framework source file to the items whose `source` cites it ("test whatever covers this
file").

## Layout

```
docs/qa/platform-checklist/
  README.md        ← this file: what an item is, how to append / change / retire
  RUNNER.md        ← how an AI runs the checklist accurately (verdicts, oracles, evidence)
  areas/*.json     ← the ledger, sharded by feature area (append here)
  coverage.json    ← capability-coverage ratchet: every governed metadata kind → items or waiver
  runs/            ← run-record FORMAT contract only; results are git-ignored, never committed
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
    "knownGaps": ["…"],                  // rediscovered every sweep
    "provisioning": {                    // OPT INTO an area-level recipe (next section) instead of
      "use": "qa-scratch-authz",         // copying its call sequence into this item
      "why": "which clauses it unblocks, and what they would score without it"
    }
  },
  "steps": ["…"],                        // how to exercise it
  "acceptance": [                        // ★ the acceptance criteria — one clause per assertable fact
    { "clause": "what must hold",
      "oracle": "api",                   // api | network | screenshot | dom | log | test | build
      "verify": "how to consult the oracle, concretely",
      "evidence": "what artifact the run must capture" }
  ],
  "negative": ["…"],                     // the other side of every gate (deny/absence cases)
  "variants": ["…"],                     // enumerable-surface matrix (field types, chart types, flow
                                         // nodes, operators…) — derived from the spec's own Zod enums,
                                         // source cited; one clause requires per-variant verification
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

### Area-level `fixtures` — one named provisioning recipe, many items

When several items in an area need the *same* environment that stock seeds do not
provide, the recipe is written **once at the area level** and items **reference** it. Two
halves, both required — a recipe nobody references is dead text, and a reference to a
recipe that isn't there is a dangling pointer. The worked instance is `qa-scratch-authz`
in [`areas/attachments-storage.json`](./areas/attachments-storage.json) (#7716/#7670);
copy its shape rather than inventing a second one.

**Half 1 — the recipe**, a keyed block beside the area's `area`/`title`/`items` keys:

```jsonc
"fixtures": {                            // AREA level — a sibling of "items", not inside one
  "$comment": "…",                       // what this block is, and the replay rule for runners
  "qa-scratch-authz": {                  // the recipe KEY — what items name in `provisioning.use`
    "title": "Scratch authz parents (qa_vault / qa_shared / qa_nofiles) + two member personas",
    "why": "what is missing from stock seeds, and which clauses block(fixture) without it",
    "provenance": "run #7635 (framework 92f26f75) → #7670",   // where the recipe was proven
    "app": "showcase",
    "requires": ["capabilities/sessions the recipe itself needs before step 1"],
    "sequence": [                        // the calls, in order — replayable literally
      { "step": 1,
        "call": "POST /api/v1/packages",
        "body": { "…": "…" },            // optional; omit for a non-body step
        "expect": "what a correct response looks like — and the re-run/409 caveat",
        "source": "framework file:line that grounds the call and its shape" }
    ],
    "teardown": "the one call (or the cheaper discard-the-DB path) that undoes it",
    "knownGaps": ["where the recipe is known to be sharp — e.g. an SDK helper that drops ?package="]
  }
}
```

**Half 2 — the reference**, on each item that needs it:

```jsonc
"fixtures": {
  "app": "showcase",
  "requires": ["…"],                     // item-specific needs stay here
  "provisioning": {
    "use": "qa-scratch-authz",           // must match a key in the AREA's fixtures block
    "why": "which of THIS item's clauses the recipe unblocks, and what they'd score without it"
  },
  "knownGaps": ["CLOSED by the qa-scratch-authz recipe (#7670): … ; fall back to <pin> only if …"]
}
```

Why this shape:

- **Recipes are runtime-provisioned.** No repo file is touched and nothing is seeded, so
  the only cleanup is the `teardown` line. That is what makes a recipe safe to replay on
  a live boot — and why `requires` must name the capability the recipe itself needs
  (e.g. a session holding `manage_metadata`) rather than assuming a bare admin session.
- **Every call cites framework source at `file:line`.** Replay them literally; if one
  4xxs, re-read the citation before assuming the recipe rotted.
- **`why` is the debt marker.** A recipe exists because stock fixtures cannot demonstrate
  something — the same discipline as a coverage waiver. Landing the fixture in the
  showcase seeds proper retires the recipe; until then `why` says what is missing and
  which clauses would go `blocked(fixture)` without it.
- **Opting in does not delete the item's `knownGaps`** — it rewrites them as
  *CLOSED-by-recipe*, naming any pinned fallback and asking the run to record **which**
  of the two its verdict rests on. Deleting the gap loses the reason the recipe exists.

The validator does **not** yet resolve `provisioning.use` against the area's `fixtures`
keys — that was deliberately deferred (option C on #7716's open question, tracked at
#7720), to be revisited if the recipe shape spreads to more areas. Until then a typo'd
`use` is caught by review, not by `check:platform-checklist`: copy the key, don't retype it.

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

## Capability coverage — every capability the platform has gets tested

`coverage.json` makes "凡是有的能力, 都要测试" mechanical instead of aspirational. The
universe of capabilities is **derived, not hand-kept**: every metadata kind with a
`packages/spec/liveness/<kind>.json` ledger (the ADR-0049 governed set) must be mapped
to at least one checklist item, or waived with a written reason. The validator
(`pnpm check:platform-checklist`, run on the manual cadence below — **not** wired into
CI) reports both directions — an unmapped kind is flagged (the platform grew a
capability the checklist doesn't test), and a mapped kind whose liveness ledger
disappeared is flagged too (the entry outlived the capability). This is the
`examples/app-showcase/src/coverage.ts` demonstrated-or-waived ratchet, applied to
testing instead of demonstration.

Enumerable surfaces *inside* a capability (49 field types, 20 chart types, flow node
types, query operators, decision actions, …) are covered by `variants` matrices on the
items themselves, each derived from the spec's own Zod enums with the source cited.

**Variants stay fresh automatically.** A matrix item may pin the spec enum it was
authored against with an `enumSource` field:

```jsonc
"enumSource": {
  "file": "packages/spec/src/data/field.zod.ts",  // repo-root-relative spec source
  "export": "FieldType",                           // the exported z.enum(...) const
  "expect": 49                                     // member count the variants match
}
```

The validator extracts the enum's *current* member count from that source (comment-
stripped, deduped) and fails when it no longer equals `expect`. So when the platform
grows a 50th field type or a 21st chart type, the next `check:platform-checklist` run
goes red with a precise instruction: revise the variants matrix, bump the item revision,
set `expect` to the new count. This closes the gap the coverage ratchet alone left — the
kind-level ratchet catches a *new metadata kind*, `enumSource` catches a *new value in
an existing kind's enum* — so "spec grew a variant" is caught by the manual check
instead of drifting silently (the showcase `coverage.test.ts` only catches it
indirectly). Items currently pinned: field types, chart types, action locations, webhook
triggers, flow node types. Pin more as matrices are added.

A waiver is a debt marker, not an exemption: it names what fixture or surface is
missing, so paying it down is a matter of adding the fixture and flipping the entry to
`items`.

### Variants freshness — spec enum drift is caught on the item itself

Matrix items may pin the spec enum their `variants` were authored against:

```jsonc
"enumSource": { "file": "packages/spec/src/data/field.zod.ts", "export": "FieldType", "expect": 49 }
```

The validator extracts the enum's CURRENT member count from the spec source at check
time (comment-stripped, deduped) and fails with `VARIANTS STALE` when it no longer
equals `expect` — so the next `check:platform-checklist` run after a 50th field type
lands flags the matrix as stale (revise it, or consciously bump `expect` with a
revision). This closes the loop the kind-level ratchet leaves open: new *kinds* are
caught by the liveness-derived universe, new *members of an existing kind* by these pins.
Enums declared inline (anonymous `z.enum` inside an object literal) cannot be pinned by
export name — those matrices still rely on the showcase `coverage.test.ts`
demonstrability gate.

### Operating cadence — when to run this (it is NOT in CI)

By maintainer decision `check:platform-checklist` is **not** wired into per-PR CI: the
checklist is a QA ledger, not a code gate, so an unrelated PR is never blocked by
checklist drift. It runs on a **manual / periodic cadence** instead. Run
`pnpm check:platform-checklist` (zero-dependency, ~1s, no tokens):

- **before a release** — part of the release sweep below;
- **after a large platform surface lands** — a new metadata kind, a new enum, a new area;
- **whenever you touch the checklist** — the structural + coverage check catches a
  dangling id or a forgotten `revision` bump in your own edit;
- **alongside a `checklist-author`** (find gaps) **or `checklist-test`** (execute items).

The trade-off of staying out of CI: a new capability kind or enum value that lands on
`main` between runs is caught at the **next** manual run, not the moment it merged. The
ratchets still detect it — they just aren't a blocking gate. If drift-catching latency
ever matters more than PR independence, re-adding the one-line CI step
(`run: pnpm check:platform-checklist`) restores the automatic posture.

### How the checklist keeps itself current

1. **New capability kind** → a `packages/spec/liveness/<kind>.json` ledger appears →
   the coverage ratchet flags it the next time `check:platform-checklist` runs.
2. **New member of an enumerable surface** → the `enumSource` pin flags the matrix as
   stale the next time the check runs (for pinned enums).
3. **New feature inside an existing kind** → process: the feature PR lands a `since:
   v<current>` item (same discipline as changesets); the release sweep filter catches
   stragglers.
4. **Periodic re-sweep** → [SWEEP.md](./SWEEP.md) is a runbook any AI session can
   execute on request ("run a coverage sweep") — five independent gap-hunt angles,
   dedupe, author, validate. The 2026-08 sweep it encodes found 3 stale waivers and
   ~55 missing items; re-running it is how drift that slips past 1–3 gets caught.

## How a release sweep works

A release no longer gets a hand-written checklist. The sweep for `vN` is a **filter
over this ledger**: `since == vN` (the new capabilities) ∪ all `P0` (the standing
smoke) ∪ any item whose `source` cites a PR in the release. The tracking issue for the
sweep links here and hosts discussion; results stay OUT of the repo — every run files
one `qa-run` GitHub issue as its record (text only: the verdict table + a reproduction
rule per failure — RUNNER.md rule 2's authentication/authorization carve-out excepted,
and it binds the extracted card too — never screenshots; `runs/` is git-ignored), and a
run that finds a real regression extracts it into its own standalone card at close-out
(RUNNER.md, extraction obligation — the run issue itself stays `qa-run`-only, excluded
from triage). Item text, fixtures learned, and new traps discovered flow **back into the
ledger** as revisions — that is the accumulation the one-off checklists never had.

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
