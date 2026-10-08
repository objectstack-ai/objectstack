# Studio task benchmark

One fixed task — **build a repair-ticket app with no code** — run against a fresh showcase boot,
timed, counting every red error, failed write, code-shaped entry and dead end the author meets.
Its numbers are the Studio UX baseline, re-measured every release.

| file | what it is |
|---|---|
| [SCENARIO.md](./SCENARIO.md) | the fixed script: environment, the eight steps, the server-side oracle for each |
| [SCORING.md](./SCORING.md) | what is counted, how each red error is classified, the headline row |
| [SCORESHEET.md](./SCORESHEET.md) | the blank sheet a run fills in |
| [USER-SESSIONS.md](./USER-SESSIONS.md) | the protocol for 3–5 think-aloud sessions with real low-code authors |
| [`baselines/`](./baselines/) | one filled sheet per release, named `YYYY-MM-DD-OBJECTSTACKSHA8-OBJECTUISHA8.md` |

## Current baseline

[`baselines/2026-10-08-8fc50b76-a58626c8.md`](./baselines/2026-10-08-8fc50b76-a58626c8.md):

```text
completed 8/8 · total 1511 s · 16 red errors · 13 failed writes · 10 code-shaped entries · 0 dead ends
```

(agent run — the time is agent time, not a human completion time; see SCORING.md.)

## Each release

1. Boot fresh, exactly as SCENARIO.md → *Environment* says, with the console built at the release's
   `.objectui-sha` pin.
2. Run the eight steps unchanged; fill a copy of SCORESHEET.md.
3. Commit it under `baselines/` with both SHAs in the name, and compare its headline and per-step
   rows with the previous file. A number moving the wrong way, or a step that stops completing, is a
   regression — report it per step.
4. Every red error, failed write, code-shaped entry and dead end carries a card reference. One with
   no card goes to the reviewing seat to file; the runner does not file cards from a benchmark run.

## Why the baseline is a committed file, not a `qa-run` issue

The next run has to **read** the previous one, field by field, to compare. A markdown file keyed to
both SHAs sits next to the script it scores, survives in history alongside script changes, and is
diffable. The platform checklist's `qa-run` issue contract belongs to checklist runs (its title
grammar is parsed by `scripts/qa/qa-rollup.mjs` and counts checklist verdicts), and its `runs/`
directory is git-ignored — neither fits a recurring comparison point.

## Running it as an agent

Follow `.claude/skills/dogfood-verification` and `docs/qa/platform-checklist/RUNNER.md` for the
boot, the oracle hierarchy and the trap vocabulary. What this benchmark adds:

- **Record everything as it happens.** Attach a listener to the browser (Playwright over CDP works)
  that logs every non-GET `/api` answer and every 4xx/5xx with its body, and polls the page for
  visible red elements (`role=alert`, error toasts, `destructive` / `red-` classes), logging each
  new text with a timestamp. Write a `MARK stepN-start` / `MARK stepN-end` line into the same log at
  each clock edge. The sheet is then filled from one timeline. Make the listener survive page
  dialogs (`beforeunload` on sign-out) — a crashed recorder silently stops counting.
- **Drive like an author.** Real clicks and keyboard input; never set a value through the DOM. Read
  each screen before acting — the benchmark is about what the console offers, not about a script
  that already knows the answer.
- **Verify each step server-side** with SCENARIO.md's oracle (the draft read is
  `GET /api/v1/meta/TYPE/NAME?state=draft&package=PACKAGE`), and prove step 4's rule after publish
  with a forged create that should be refused with the rule's own message.
- **Tear down** the server, the browser and the recorder by the PIDs you recorded.
