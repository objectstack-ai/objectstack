# Runner protocol — executing the checklist accurately

How an AI agent runs [the platform checklist](./README.md) so that its verdicts can be
trusted. Every rule here was paid for: the #3358 sweeps produced three showcase-defect
discoveries, two real regressions — and also one self-inflicted false alarm and several
"ticked on a label" temptations. The protocol turns those lessons into mechanics.

Prerequisite reading: the **dogfood-verification** skill
(`.claude/skills/dogfood-verification/SKILL.md`) — environment isolation (§0), the
build/runtime model incl. the vendored-console staleness trap (§2), and the
anti-false-positive rule (§3). This file assumes it and adds the checklist-specific
contract.

## Verdicts

Per **clause** (each acceptance entry gets exactly one):

| verdict | meaning |
|---|---|
| `pass` | oracle consulted, expectation held, evidence captured |
| `fail` | oracle consulted, expectation violated, evidence captured, issue filed |
| `blocked` | could not consult the oracle — carries `{by: fixture\|environment\|dependency\|product-bug, ref}` |
| `skipped` | deliberately not attempted this run (out of scope) |

Per **item**, derived — never hand-assigned:

- `pass` — every clause passed;
- `partial` — some passed, none failed (the "proved half, left it unticked" state from
  #3358, now first-class instead of a prose apology);
- `fail` — any clause failed;
- `blocked` / `not-run` — nothing consulted.

**No verdict without evidence.** A clause with no captured artifact is `not-run`, not
`pass`. Evidence means: the API/network trace, the screenshot, the log excerpt, or the
test-run output the clause's `evidence` field names.

## The accuracy rules

1. **Oracle hierarchy** — server truth (`api`, `network`, `build`, `test`) outranks
   `screenshot`, which outranks `dom`. A `dom` oracle may only be consulted **after** a
   screenshot (or equivalent) confirms the surface rendered — post-navigation DOM dumps
   return transitional emptiness and are the #1 source of fake "P0: feature missing"
   findings (dogfood skill §3).
2. **`fail` is expensive, on purpose.** Before recording one:
   - reproduce it **twice**, on fresh loads;
   - run the *automation self-check*: could your own driving have caused this?
     Coordinate-based clicks, React controlled-input fills, and shared browser tabs
     have each produced convincing fake bugs (#3358 had to retract a "dead approve
     button" that was a coordinate-click artifact — a ref-targeted click worked);
   - check the `traps` field and rule each listed trap out;
   - for console UI failures, confirm against current objectui source or a fresh build
     — the vendored `/_console` bundle may be stale (skill §2);
   - then capture the **reproduction rule** — ordered steps / API calls (method · path ·
     body) / the ref-targeted selector path + expected-vs-actual — into the run's result
     issue, which is labeled `bug`. A `fail` with no reproduction rule in its issue is not
     a completed verdict. (The screenshot that convinced you is a live judgment aid, not
     report content — describe what it showed in one line; never attach it.)
3. **Classify blockers honestly.** Missing seed/persona/fixture → `blocked(fixture)`,
   and *record the gap on the item* (`fixtures.knownGaps` or `blocked`) so the next
   sweep doesn't rediscover it. A defect in the fixture itself (seed silently failing,
   as in #3408/#3415) is a **`fail` against the seed**, not a block — "nothing reports
   this" was the actual bug.
4. **Both sides of every gate.** For any permission/visibility/feature gate, verify
   presence for the entitled persona AND absence (or server-side rejection) for the
   unentitled one. UI absence alone is a client courtesy; the server is the authority
   (ADR-0057 D10) — where feasible, prove denial with a direct forged request.
5. **Severe findings are hypotheses.** "The whole surface is unreachable" gets
   disproven-or-confirmed via screenshot + the server's own metadata before it is
   written down (the golden rule of the dogfood skill).
6. **Don't re-prove what automation pins.** If `automated.ref` is set, run that test
   and cite its output as the evidence; drive the browser only for what the pin doesn't
   cover. The reverse also holds: when a sweep hand-proves something repeatedly,
   propose promoting it to a permanent test and set `automated` in a revision.
7. **Verify pass for high-stakes claims.** For P0 `fail`s and any finding that would
   ship or block a release: a second, independent agent re-derives the verdict from the
   captured evidence alone (not from the first agent's narrative) before it is acted
   on. Disagreement → re-run the item.

### Trap vocabulary (`traps` field)

| trap | what it fakes | counter |
|---|---|---|
| `hydration-race` | empty nav/list right after navigation | screenshot first; settle; then read DOM |
| `stale-console-bundle` | UI bug already fixed upstream in objectui | check against objectui HMR console / fresh build (skill §2) |
| `stale-dist` | src edits with no runtime effect | rebuild package + restart before judging |
| `automation-input` | dead buttons / empty submits caused by the driver | ref-targeted clicks; native setter + input/change events |
| `shared-browser-tab` | drifting origin, foreign drafts | pin absolute origin; own port/DB (skill §0) |
| `seed-data-thin` | features with nothing to show; silent seed rejections | check row counts vs built artifact; read boot log |
| `single-datapoint` | charts "render" but prove little | prefer multi-bucket fixtures; note weakness in evidence |
| `dispatcher-vs-hono-route` | route exists in unit tests, 404s on the real server | oracle = live server trace, never simulated dispatch |
| `wrong-panel` | feature looks missing on a sibling surface | item's `steps` name the exact surface; check it |
| `wrong-persona` | admin privileges mask a guard | run guard checks as the non-privileged persona |

## Run records — the GitHub issue is the report

Every completed run — **pass or fail alike** — files **one GitHub issue** as its durable
record, labeled `qa-run` (plus `bug` when any clause failed). **Nothing lands in the
repo** — not the JSON, not screenshots; `runs/` is git-ignored except its README.

**The issue is text only.** Screenshots and DOM dumps are oracles you consult *live* to
reach a verdict — never report artifacts. What the report carries for a defect is the
**reproduction rule**: ordered steps / API calls (method · path · body) / the
ref-targeted selector path + expected-vs-actual from the oracle, enough to re-hit it on a
fresh boot with no picture. A clause whose oracle was a screenshot is recorded as a
one-line text description of what it showed, not a link.

The in-environment JSON scratch (RUNNER shape, never committed):

```jsonc
{
  "run": "2026-08-07-v17-release-sweep",
  "date": "2026-08-07",
  "scope": "since:v17 + P0",            // the filter that selected items
  "app": "showcase",
  "env": {
    "framework": "<commit sha>",
    "objectuiPin": "<.objectui-sha>",   // stale-bundle honesty: record what the console was
    "port": 3456, "db": "file:/tmp/<run>/data.db"
  },
  "runner": "<agent/session identifier>",
  "results": [
    {
      "id": "approvals.per-group-signoff",
      "revision": 1,                     // ← the revision this verdict is valid for
      "verdict": "pass",
      "clauses": [
        { "clause": 0, "verdict": "pass", "evidence": "…text: what the oracle returned — no image links…" }
      ],
      "issues": [],                      // filed failures / fixture gaps
      "notes": "…"
    }
  ]
}
```

The issue body is: env fingerprint · scope (selector + per-item `revision`) · the
per-clause verdict table (text oracle evidence) · a reproduction rule per `fail` ·
derived item verdicts + fixture gaps. The durable, version-controlled truth is still the
checklist under `areas/`; a run is a dated assertion about one build, and it lives in its
issue, not the tree.
