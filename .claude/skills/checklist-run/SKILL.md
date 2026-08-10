---
name: checklist-run
description: >
  Execute the platform test checklist (docs/qa/platform-checklist/) against a real
  running app and produce a run record. Use whenever the maintainer says "测一下
  <功能>", "跑这个测试项", "run the checklist for <area/item>", "test this feature
  file", "验证 <功能点>", or points at a framework source file and asks whether it
  still works. Takes a SELECTOR (item id · area · capability kind · priority · a
  release · or a source-file path) and drives every matched item through its steps
  following RUNNER.md. The companion to `coverage-sweep` (which AUTHORS items); this
  one RUNS them. NOT a customer-published skill — internal agent tooling (lives in
  .claude/, never in the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery — every SKILL.md outside `skills/` must carry this marker
  # (template-consistency.test.ts enforces it).
  internal: true
---

# Checklist run — execute selected items against a live app

You resolve a **selector** to a set of checklist items, boot the app in isolation, drive
each item's steps in the browser / over the API, and emit a **run record**. The method
for judging each clause (verdicts, oracle hierarchy, evidence, the anti-false-positive
self-check) is **`docs/qa/platform-checklist/RUNNER.md`** — read it first and obey it;
this skill is the trigger, the selection contract, and the isolation/parallelism plan,
not a second copy of the runner protocol.

Environment know-how (boot, the dist build model, the vendored-console trap, browser
escape hatches) is the **`dogfood-verification`** skill — read it too. You are not
reinventing how to boot; you are executing a specific list against a boot.

## 0. Resolve the selector — deterministic, no guessing

Never eyeball which items to run. Ask the resolver:

```
node scripts/checklist-select.mjs <selector> --json
```

Selectors (one per run):

| selector | runs |
|---|---|
| `platform-core.console-login` (bare id) | that one item |
| `area:records-forms` (or bare `records-forms`) | every item in the area |
| `capability:hook` | items mapped to a metadata kind in `coverage.json` |
| `priority:P0` | the standing smoke |
| `surface:api` | every API-surface item (cheap — no browser build needed) |
| `since:v17` | everything introduced in a release (the release-sweep filter) |
| **`file:packages/plugins/plugin-approvals/src/approval-service.ts`** | **items whose `source[]` cites that file — "test whatever covers this file"** |
| `all` | the whole checklist |

`--json` gives the runnable list (id · priority · surface · revision). **Blocked items are
excluded by default** — they can't run on stock fixtures; pass `--include-blocked` only to
record them as `blocked` with their fixture reason. **Pin the `revision`** the resolver
reports into the run record: a verdict is only valid for the revision it ran against.

## 1. Plan the run by surface — build only what you need

Read the matched items' `surface`:

- **All `api` / `build` / `cli`** → no console build. Boot the framework (`objectstack dev`)
  and drive REST/CLI. Fast (~minutes).
- **Any `browser` / `mixed`** → you need the vendored console dist. It builds SEPARATELY
  from the showcase workspace closure (`pnpm objectui:build` from the pinned `.objectui-sha`);
  the first boot 404s `/_console/` until it exists (dogfood §2 — a real precondition, record
  it, don't fake a block). Budget the build (~10–30 min on a cold monorepo); it dominates
  wall time, the browser driving is minutes.

Build once, up front, for the whole run.

## 2. Isolate, then execute (per dogfood §0)

- Own free non-default port + own file DB **per concurrently-running item**
  (`--seed-admin -d file:/tmp/<run>/<item>.db`). Two runs sharing a port/DB/browser tab is
  the `shared-browser-tab` trap.
- **Parallelism:** fan API-surface items out in parallel (each its own port, cheap). Run
  browser items **few-at-a-time** (2–3), each its own port + browser context — a single
  machine's CPU and one shared display contend past that. When dispatching runner
  subagents, **they must be `opus`**, each given: the item JSON, RUNNER.md, the
  dogfood skill, its own port/DB, and the results-out-of-repo rule (§4).
- Execute each item's `steps` faithfully; judge each `acceptance` clause and each
  `negative` against its declared `oracle`, capturing the `evidence` the clause names.
  **Server truth outranks pixels; DOM only after a screenshot confirms render; a `fail`
  needs reproduction ×2 + the automation self-check + a reproduction rule in the run
  issue** (RUNNER §rules).

## 3. When the run teaches you something about the ITEM

A run that discovers the item's `steps` are wrong (a moved route, a renamed key, an
expiry path that needs localStorage cleared too) is the checklist working. That is a
checklist EDIT — do it in a **worktree** (PD#11): revise the item, bump `revision`, append
a `history` entry, keep `node scripts/check-platform-checklist.mjs` green, and land it on a
task branch. Product defects found while running go to `FOLLOW-UPS.md` (or a filed issue)
as expected-fail probes — never tick a clause green over a real defect.

## 4. The result issue — one GitHub issue per run, text only

Every completed run — **pass or fail alike** — files exactly one GitHub issue as its
durable record. Nothing about a run enters the repo tree: not the JSON, not screenshots.
The JSON run record (RUNNER.md shape) is scratch in the executing environment; `runs/`
stays git-ignored. The issue is the report.

**The issue is pure text — no images, ever.** Screenshots exist only to let you and your
subagents reach a verdict *live*; they are a judgment aid, discarded with the run
environment. The durable report needs the **reproduction rule, not the picture**.

File it with `issue_write` (github MCP):

- **Title** — `QA run · <selector> · <framework-sha[:8]> · <date>`
- **Labels** — `qa-run` always; add `bug` (and `regression` for a P0/P1) whenever any
  clause failed, so a real defect is triageable straight from the run issue without a
  second one.
- **Body**, in this order:
  - **Env fingerprint** — framework sha, `.objectui-sha`, port, db, seed, timestamp.
  - **Scope** — the selector + the `revision` each item ran against.
  - **Per-clause verdict table** — item · clause · verdict · one line of **text** oracle
    evidence (the API/network/build/test result — server truth, never a pixel).
  - **For every `fail`, a reproduction rule** — the exact ordered steps / the API calls
    (method · path · body) / the ref-targeted selector path to re-hit it on a fresh boot,
    plus expected-vs-actual from the oracle. Enough for a human or a fresh agent to
    reproduce it with no screenshot from you.
  - Derived item verdicts + any fixture-gap list.

Report the same per-clause table + the env-setup-vs-test time split back to the maintainer
in chat, and link the filed issue.

## Guardrails

- **Don't fake coverage.** Missing fixture → `blocked(fixture)` with the reason; unbuilt
  console → build it or record `blocked(environment)`; a half-proven item is `partial`,
  not `pass`. A blocked verdict WITH evidence is a successful run; a faked pass is not.
- **Don't run blocked items as if runnable** — the resolver hides them for this reason.
- **One selector, one run, one issue.** For a release sweep, run `since:vN` and
  `priority:P0` as separate runs → separate issues, rather than smearing them together.
