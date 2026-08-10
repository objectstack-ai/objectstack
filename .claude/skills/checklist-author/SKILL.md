---
name: checklist-author
description: >
  Re-audit the platform test checklist (docs/qa/platform-checklist/) for coverage
  gaps and author the missing items — the five-angle capability sweep. Use whenever
  the maintainer says "跑一轮 coverage sweep", "run a coverage sweep", "排查测试清单
  遗漏", "审计测试覆盖", or asks whether some platform surface "有测试吗" and the
  answer needs verifying rather than recalling. Also the right tool after a large
  platform surface lands or before a major release. NOT a customer-published skill —
  this is internal agent tooling (lives in .claude/, never in the published
  `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery — every SKILL.md outside `skills/` must carry this marker
  # (template-consistency.test.ts enforces it).
  internal: true
---

# Checklist author — the coverage sweep that keeps the checklist honest

The canonical method lives in **`docs/qa/platform-checklist/SWEEP.md`** — read it
first and follow it; this skill is the trigger and the orchestration contract, not a
second copy of the procedure.

## What you are producing

A delta on `docs/qa/platform-checklist/`: new/extended items in `areas/*.json`, a
reconciled `coverage.json`, defects/docs-drift appended to `FOLLOW-UPS.md` — all
validating green under `node scripts/check-platform-checklist.mjs`, landed on a task
branch per AGENTS.md (worktree-first, PD#11).

## Orchestration contract

1. **Worktree first** (PD#11): `git worktree add ../objectstack-<task> -b <branch> main`.
   All edits there. Read the checklist's current state before dispatching anything.
2. **Five READ-ONLY gap hunters in parallel** — one per SWEEP.md angle (console UI /
   spec enums / routes & runtime / built-in apps / docs claims). Each gets: the current
   item-id list, the already-known waivers and blocked items (don't re-report), and the
   output contract `surface | evidence path | coverage verdict | proposed id | sketch |
   fixture?`. Hunters write NO files.
3. **Dedupe into a scratch register** (delete it before landing). Cross-angle
   duplicates are high-priority signal, not noise.
4. **Per-area writer agents** — one agent per `areas/*.json` file so writers never
   collide; nobody but the orchestrator touches `coverage.json` or `scripts/`.
   Every item follows README.md's deep-test contract; missing fixtures become
   `blocked`/`knownGaps`, never faked coverage. Writers ground every endpoint, enum,
   and error code in source before asserting — treat this skill's own briefs as
   hypotheses, source as truth.
5. **Reconcile centrally**: un-waive any kind a hunter proved has a stock fixture
   (four of six waivers were stale in the 2026-08 sweep — re-audit every waiver every
   time), map new items in `coverage.json`, pin `enumSource` on any new variants
   matrix (see README "Variants stay fresh automatically").
6. **Validate + land**: validator green, then commit on the task branch. Product
   defects and docs-drift go to `FOLLOW-UPS.md`; security-sensitive findings are
   NEVER filed publicly without the maintainer's decision.

## Scale guidance

A full sweep is ~5 hunter + ~8 writer agents. For a scoped question ("X 有测试吗?"),
run ONE hunter on the relevant angle, verify against the checklist, and author only
what's missing — same contract, smaller fleet.
