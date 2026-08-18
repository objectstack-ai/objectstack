#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Required-context name pin (#6865) — the job `name:` literals that branch
 * protection references are CONTRACT, so the repo asserts them.
 *
 *   node scripts/check-required-contexts.mjs               # the pin (lint)
 *   node scripts/check-required-contexts.mjs --self-test   # verify the checker itself
 *
 * ## The defect
 *
 * A GitHub required status check is matched BY THE CHECK-RUN NAME, and a job's
 * check-run name is its `name:` value. Nothing in a workflow file says "this
 * string is load-bearing". So renaming a job is a one-line edit with a silent,
 * repo-wide consequence: the old name never reports again, and the required
 * context sits permanently pending (equivalent to red — it wedges the PR and
 * the merge queue), or, if the stale context is then quietly removed from the
 * settings to unwedge things, every gate that job carries degrades to advisory
 * with no signal anywhere. The second shape is #5617 verbatim: PR #5584 merged
 * with its ESLint job red for 19 minutes, because the job carrying the whole
 * `check:*` gate family was not in the required set at all. Four more merges
 * repeated it that night (#6067/#6096/#6051/#6103) before the settings were
 * fixed on 2026-08-07.
 *
 * ci.yml already writes this contract down in prose — at least eight places,
 * e.g. "the NAME is the required check, so renaming it would silently drop the
 * gate wherever branch protection lists it" — and `check-shard-attestation.mjs`
 * asserts that the two aggregate gate JOB IDS (`test-gate`, `dogfood-gate`)
 * still exist and still count attestations. Neither of those asserts a `name:`
 * LITERAL, and lint.yml had no note and no assertion at all. This script is the
 * missing half: the literals, in one registry, machine-checked.
 *
 * ## What this pin asserts (all of it repo-side, all of it checkable here)
 *
 * For every entry in REQUIRED_CONTEXTS:
 *
 *   1. the workflow file exists and parses;
 *   2. the job id still exists in it;
 *   3. its `name:` is EXACTLY the registered literal — the pin proper;
 *   4. the job declares no `strategy.matrix`. A matrix job's check-run name is
 *      the name with the matrix values appended (`Test Core (1/3)`), so a bare
 *      registered name would never report. Worse, per #5617's audit a SKIPPED
 *      matrix job publishes the name UNEXPANDED, so the two spellings are not
 *      even stable across runs;
 *   5. the job sets no truthy `continue-on-error`. Such a job cannot conclude
 *      `failure`, so it would publish a green required context over a failure —
 *      an advisory gate wearing a required gate's name;
 *   6. its workflow carries a `merge_group:` trigger. Without it the queue
 *      build never produces the context and the whole queue stalls waiting for
 *      it (#5617's audit lists `Console Pin Freshness` as exactly this shape:
 *      a file whose own comment invites required-ization it cannot survive);
 *   7. its workflow's `pull_request:` trigger exists and carries no `paths:` /
 *      `paths-ignore:`, and, if it names `types:` at all, that list is a
 *      superset of GitHub's default `[opened, synchronize, reopened]`. A
 *      path-filtered trigger produces NO check run on a PR that misses the
 *      glob, and naming `types:` REPLACES (never extends) the default set,
 *      so dropping one of the three from a hand-written list produces NO
 *      check run on that activity — neither is a skip, both are an absence,
 *      which is permanent pending (the audit's `Spec property liveness`
 *      exclusion for the `paths:` half; #8304 for the `types:` half — no
 *      enrolled workflow names `types:` today, and this guard is what makes
 *      growing such a list safe).
 *
 * Plus two whole-registry properties:
 *
 *   8. no two entries register the same context name;
 *   9. no UNREGISTERED job in a scanned workflow carries a registered name.
 *      Two jobs with one name publish one context whose conclusion is whichever
 *      finished last, so an unrelated job could satisfy a required gate. This
 *      is live ammunition here rather than a hypothetical: ci.yml's sharded
 *      `test` job is named `Test Core (${{ matrix.shard }}/3)` and its gate is
 *      named `Test Core`; deleting the suffix collides them.
 *
 * ## What this pin does NOT assert, stated so nobody inherits false closure
 *
 * It CANNOT verify that any of these names is actually in `main`'s required set
 * or in the merge queue's check set. That configuration lives in repository
 * Settings → Rulesets, and no agent seat can read it: `GET
 * /repos/objectstack-ai/objectstack/branches/main/protection` answers HTTP 403
 * `GitHub access is not enabled for this session` (measured, #6865). Writing a
 * gate that claimed to check the required SET would be a gate that cannot read
 * the thing it names — the #4690 phantom-check shape.
 *
 * So the registry is the repo's declaration of what the settings are believed
 * to reference, sourced from the maintainer rulings on #5617, and the pin
 * enforces the half that lives in this repo: THESE NAMES DO NOT MOVE. If the
 * settings and this registry disagree, only a maintainer can see it and only a
 * maintainer can fix it — which is why every entry carries the ruling that
 * authorized it, so the two lists can be reconciled by hand in one reading.
 *
 * ## Why `if:` is deliberately NOT asserted
 *
 * #6865's own body proposed asserting the enrolled jobs carry no `if:`. That is
 * right for lint.yml's two and WRONG for four of the six the maintainer added
 * on 2026-08-09: `build-core`, `build-docs`, `console-pin` and
 * `temporal-conformance` each carry `if: ${{ !cancelled() && needs.filter…}}`
 * BY DESIGN — THE FILTER CONTRACT (#4928). A job-level `if:` that skips still
 * publishes a check run (conclusion `skipped`, which branch protection counts
 * as passing); it is the workflow-level `paths:` filter that publishes nothing,
 * which is why assertion 7 above judges the trigger and not the job. Asserting
 * "no `if:`" uniformly would have made this gate red on `main` the day it
 * landed, against four jobs that are correct.
 *
 * The two aggregate gates are a further special case — they need `if: always()`
 * for a reason of their own (#3622: a gate that skips because a dependency
 * failed publishes no context) — and `check-shard-attestation.mjs` already owns
 * and asserts that. Re-litigating per-job `if:` shape here would duplicate that
 * judgement in a second place with a different rationale, which is the one
 * outcome #6865's dispatch explicitly warned against.
 *
 * ## The instruction-surface scan (#9491)
 *
 * Since #9491 this file also guards the INSTRUCTION FILES that state the
 * required set as operative prose. The design — its split-PR sequencing
 * constraint, the occurrence-budget grace, and its measured recognition
 * limits — is documented at INSTRUCTION_SURFACES / RETIRED_CONTEXT_NAMES
 * below, with the decision in judgeInstructionSurfaces.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The branch-protection-required check contexts, as this repository declares
 * them. Each entry is `<workflow file>` + `<job id>` → the exact check-run name.
 *
 * `authorized` names the ruling that put the context in the required set, so a
 * maintainer visiting Settings can reconcile the two lists without archaeology.
 * Adding a row here does NOT make a context required — only the settings do.
 * Removing one from the settings without removing the row leaves a pin that is
 * merely inert, never wrong: the assertion "this job still has this name" holds
 * either way.
 *
 * ⛔ Names the #5617 audit ruled must STAY OUT of the required set, recorded so
 * a later reader does not enroll them here by symmetry: `Console Pin Freshness`
 * (no `merge_group` trigger — required-izing it deadlocks the queue, and that
 * file's own comment invites it), `Spec property liveness` (PR-side `paths:`,
 * so PRs touching no spec/docs sit pending forever), `Validate Package
 * Dependencies` (both faults), `Check PR Size` / `Auto Label` / `Check
 * Changeset` (the `labeled` event republishes the same context as `skipped`,
 * washing it green), the un-named `filter` job (its context name is the bare
 * job id), and every matrix shard name. Assertions 4, 6 and 7 below are exactly
 * the machine-readable form of the first three exclusions, so enrolling one of
 * them by mistake fails here instead of in the merge queue.
 *
 * ⛔ And one name REMOVED rather than excluded, recorded so nobody re-enrolls
 * it from git archaeology: `ADR maintainer approval` (adr-merge-approval.yml)
 * was registered here on a 2026-08-10 screenshot of the ruleset, but the
 * maintainer's own reading of the required set on 2026-08-18 listed exactly
 * the entries above and not it — the screenshot had gone stale, and a PR
 * carrying that check at `failure` merged through the queue the same day,
 * confirming it empirically. The 2026-08-18 ruling then retired the check
 * entirely (human merge IS the review record for governed surfaces; the
 * post-merge audit is scripts/pm/check-governed-merges.mjs). This removal is
 * the registry-follows half of the header's two-step; the Settings half is
 * the maintainer attestation above.
 *
 * ⛔ `carries` names the gate FAMILY and never a step count — assertion 10
 * enforces that, because prose here reads as measurement while being asserted
 * by nothing. Both counts this registry used to carry were wrong on the day
 * they were WRITTEN, not merely outgrown: at the authoring commit (d3e53f2d8,
 * 2026-08-09) the ESLint entry said "(25 steps)" against a job running 35
 * `pnpm check:*` steps, and the typecheck entry said "(33 steps)" against 10
 * (43 by the loosest caliber that counts its `--filter` spellings, 29 by
 * non-setup steps — no caliber yields 33, so what was even measured is no
 * longer recoverable). 25 was roughly the ESLint count at the #5617 INCIDENT
 * (24 on 2026-08-06), i.e. a historical figure that had drifted into a
 * present-tense field. Then it rotted at about three steps a day: 24 → 54
 * between 2026-08-06 and 2026-08-16, gaining two more while #9103 — the card
 * reporting the staleness — sat open, every gate green throughout. The count
 * is a property of the workflow, so the workflow is where it is read from: the
 * job's own step list, one grep away and never stale (#9103).
 */
export const REQUIRED_CONTEXTS = [
  {
    workflow: 'lint.yml',
    job: 'lint',
    // Renamed from 'ESLint' under the #9325 ruling: the old name described one
    // of the job's steps and mis-routed the diagnosis of every other gate it
    // carries. The rename lands in two halves that CANNOT be atomic — this
    // registry + the workflow `name:` here, and the required-context entry in
    // repository Settings → Rulesets — so it is done in one maintainer-present
    // sitting: merge, then swap the Settings entry immediately. Either half
    // alone is an outage (permanently-pending, or advisory-with-no-signal =
    // #5617). If you are reading this while a required context named 'ESLint'
    // is still live in Settings, that swap has not happened yet.
    context: 'Lint & Repo Gates',
    authorized:
      '#5617 maintainer ruling 2026-08-07 (enrolment, applied to the settings the same day); ' +
      'renamed from `ESLint` by the #9325 maintainer ruling 2026-08-17, swapped in the settings in the same sitting as the merge',
    carries: 'the whole check:* gate family — the job whose red did not block #5584',
  },
  {
    workflow: 'lint.yml',
    job: 'typecheck',
    context: 'TypeScript Type Check',
    authorized: '#5617 maintainer ruling 2026-08-07 — applied to the settings the same day',
    carries: 'the type-check + generated-artifact gate family',
  },
  {
    workflow: 'ci.yml',
    job: 'test-gate',
    context: 'Test Core',
    authorized: '#5617 closing ruling 2026-08-09, confirmation item 2 (the bare aggregate name)',
    carries: 'the sharded Test Core matrix, counted via check:shard-attestation (#6082/#3622)',
  },
  {
    workflow: 'ci.yml',
    job: 'dogfood-gate',
    context: 'Dogfood Regression Gate',
    authorized: '#5617 closing ruling 2026-08-09, confirmation item 2 (the bare aggregate name)',
    carries: 'the sharded dogfood matrix + dogfood-verify, counted via check:shard-attestation',
  },
  {
    workflow: 'ci.yml',
    job: 'build-core',
    context: 'Build Core',
    authorized: '#5617 closing ruling 2026-08-09, second batch — "the highest-value addition"',
    carries: 'the only compile-regression gate in the repo',
  },
  {
    workflow: 'ci.yml',
    job: 'build-docs',
    context: 'Build Docs',
    authorized: '#5617 closing ruling 2026-08-09, second batch',
    carries: 'the docs-site build',
  },
  {
    workflow: 'ci.yml',
    job: 'console-pin',
    context: 'Console Pin Gate',
    authorized: '#5617 closing ruling 2026-08-09, second batch',
    carries: 'the pinned-console build reconciliation',
  },
  {
    workflow: 'ci.yml',
    job: 'temporal-conformance',
    context: 'Temporal Conformance (live PG + MySQL)',
    authorized: '#5617 closing ruling 2026-08-09, second batch',
    carries: 'the live-server datetime conformance axis (#3912/#3942)',
  },
];

/**
 * ── Instruction surfaces (#9491) ─────────────────────────────────────────────
 *
 * The same context literals are OPERATIVE PROSE outside the workflows: the
 * instruction files that tell a review seat which check-runs to confirm before
 * flipping a PR ready / arming auto-merge / enqueuing it. #9325's rename moved
 * lint.yml and this registry in one PR (the pin above forces that), while
 * AGENTS.md was carried along BY HAND and the pm-dispatch review checklist was
 * caught by a dev seat READING it — no gate read the name at all (#9491's
 * measurement: replacing it with `Nonexistent Job Name` turned nothing red
 * across the file's whole derived gate union). A seat that looks for a
 * check-run by a stale name and finds nothing either stalls or arms on an
 * unverified gate family.
 *
 * ## The sequencing constraint this design is built around
 *
 * A rename CANNOT land atomically across all its surfaces: the Settings entry
 * is maintainer-only, and the instruction files are split across seat tiers
 * (`.claude/skills/pm-dispatch/**` is a maintainer-merge surface a dev seat
 * may not edit — the reason the checklist half of #9325 was its own card). So
 * between the rename PR and the instruction-fix PR(s), `main` legitimately
 * holds stale names, and a gate that reds on them blocks the very sitting it
 * protects. Not hypothetical: this scan landed WHILE the repo sat in that
 * window — registry renamed, `review-checklist.md` still naming `ESLint`, the
 * fix PR open. Hence:
 *
 *   - RETIRED_CONTEXT_NAMES is a permanent, append-only rename ledger. The
 *     rename PR MUST add a row: without one, the scan below is red on every
 *     occurrence of the newly-old literal, and that red lands on the rename
 *     PR itself — where the registry edit is already in hand — so the ledger
 *     cannot be forgotten (self-test: 'the ledger cannot be forgotten').
 *   - `staleSites` is a per-file OCCURRENCE BUDGET, not a ban: the occurrence
 *     counts at rename time. Above budget = red (the dead name written
 *     FRESH); at or below = green with a notice. A ban would be wrong even
 *     for the fix PRs — the checklist's own fix keeps one `ESLint` as a
 *     deliberate historical mention ("改名前的 PR 仍列旧名"), and history is
 *     legitimate prose everywhere. Budgets only ever ratchet down, by hand,
 *     notice-driven; a row whose budgets have been trimmed away is a standing
 *     ban on writing that dead name fresh anywhere in the scan set.
 *   - `renameInFlight: true` lets the OLD literal satisfy a `mustName`
 *     requirement while the instruction fixes are in flight. Once every
 *     required-set surface names the new literal itself, a notice asks for
 *     the flip to false. Flipping early is safe by construction: the flip PR
 *     goes red while any surface still leans on the grace, so it cannot merge
 *     before the fixes do — it self-orders, it never races.
 *
 * ## What this scan can and cannot recognise, measured before it was built
 *
 * Recognition is LEXICON-ONLY: current names (the registry) + former names
 * (this ledger). Recognising an ARBITRARY check-run-shaped literal in
 * bilingual prose — the stronger reading of #9491's direction 2 — needs
 * markers in the instruction files, which are exactly the files split across
 * seat tiers; every marker-free heuristic tried fires on ordinary English.
 * The `mustName` guard closes most of that gap from the other side: a surface
 * that states the required set must contain each required literal (current,
 * or ledgered-former while in flight), so replacing a name with garbage or
 * deleting the sentence is red even though the garbage itself is never
 * recognised. RESIDUALS, recorded rather than implied covered: paraphrase
 * drift (naming a context loosely, e.g. "Lint & Type Check" in
 * docs/launch-readiness.md) is invisible to both halves; and after a
 * SHORTENING rename (new name a substring of the old), an old-literal mention
 * satisfies the new name's `mustName` by substring — the budget half still
 * tracks the old name, so staleness stays bounded.
 *
 * ## The scan set, derived 2026-08-18, not assumed
 *
 * Every `*.md` under AGENTS.md, CLAUDE.md, `.claude/` and `docs/` naming any
 * registered context, case-sensitive, with a positive control run on the zero
 * hits. Excluded deliberately: `docs/adr/**` and package CHANGELOGs
 * (point-in-time records — a rename must NOT retro-edit them, so scanning
 * them would demand exactly that), and this script + `.github/workflows/**`
 * (the ledger and the pinned half themselves — old names live here as
 * history by design).
 */
export const INSTRUCTION_SURFACES = [
  {
    // The merge-queue rule ("the queue enforces only the required set"),
    // naming both blocking contexts. States the required set ⇒ mustName.
    file: 'AGENTS.md',
    mustName: ['Lint & Repo Gates', 'TypeScript Type Check'],
  },
  {
    // The review seat's gate-clearance step: confirm both jobs' `conclusion`
    // before flipping ready / arming / enqueuing. States the required set.
    file: '.claude/skills/pm-dispatch/references/review-checklist.md',
    mustName: ['Lint & Repo Gates', 'TypeScript Type Check'],
  },
  {
    // Names the typecheck context as the job two generated-artifact gates run
    // in — operative, but does not state the required set ⇒ scan-only.
    file: '.claude/skills/spec-property-retirement/SKILL.md',
    mustName: [],
  },
  // Release/maintenance checklists that name individual contexts ⇒ scan-only.
  { file: 'docs/launch-readiness.md', mustName: [] },
  { file: 'docs/releases-maintenance.md', mustName: [] },
];

/**
 * Former required-context names — permanent history, append-only. A row is
 * added BY the rename PR (the scan is red on the old literal until it is) and
 * never deleted: once its budgets are trimmed away, the row is a standing ban
 * on writing the dead name fresh anywhere in the scan set.
 */
export const RETIRED_CONTEXT_NAMES = [
  {
    name: 'ESLint',
    replacedBy: 'Lint & Repo Gates',
    authorized: '#9325 maintainer ruling 2026-08-17; workflow + registry half landed via #9421 on 2026-08-18',
    // The checklist's gate-clearance line: stale when this ledger row was
    // written (the fix was in flight as its own PR), and that fix keeps one
    // deliberate historical `ESLint` mention on the same line — the budget is
    // 1 across both states on purpose.
    staleSites: { '.claude/skills/pm-dispatch/references/review-checklist.md': 1 },
    // While true, the old literal still satisfies mustName — the split-PR
    // window. Flip to false once every required-set surface names
    // 'Lint & Repo Gates' itself; the completion notice below says when.
    renameInFlight: true,
  },
  {
    // Not a rename — the CHECK itself retired (2026-08-18 ruling: a human
    // merge IS the review record for a governed surface; detection moved to
    // the post-merge audit, scripts/pm/check-governed-merges.mjs — the
    // registry's removal note above carries the two-step provenance). No
    // budgets: no instruction surface named it when this row was written, so
    // the row is purely the standing ban on writing the dead name fresh.
    name: 'ADR maintainer approval',
    replacedBy: null,
    authorized:
      'maintainer ruling 2026-08-18 (「同意。」 on the retirement package); registry row removed in the same PR, ' +
      'Settings half attested by the maintainer the same day',
  },
];

/** Repository root, resolved from this file rather than from the cwd. */
function scriptRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * GitHub's default `pull_request:` activity types. Naming any `types:` at
 * all REPLACES this set rather than extending it, so a workflow that names
 * `types:` must restate every one of these (or more) or it silently stops
 * publishing a check run for the dropped activity — the same permanent-
 * pending wedge assertion 7's `paths:` guard exists to catch, through a
 * different key on the same trigger (#8304).
 */
const DEFAULT_PULL_REQUEST_TYPES = ['opened', 'synchronize', 'reopened'];

/**
 * A workflow's trigger block.
 *
 * Read under both spellings on purpose. `on` is a YAML 1.1 boolean and a YAML
 * 1.2 string, so the SAME document yields the key `'on'` under one schema and
 * `true` under the other. That is a property of the parser, not of the
 * document — GitHub's format has exactly one spelling — so accepting both is
 * reading one contract, not tolerating two. Neither present is a problem, never
 * a pass (#4690).
 */
function triggersOf(doc) {
  if (!doc || typeof doc !== 'object') return undefined;
  const block = doc.on ?? doc[true];
  return block && typeof block === 'object' ? block : undefined;
}

/**
 * Judge a registry against already-parsed workflows.
 *
 * Pure: every input is an argument, so `--self-test` exercises the real
 * decision instead of a parallel imitation of it.
 *
 * @param {{
 *   registry: ReadonlyArray< { workflow: string, job: string, context: string } >,
 *   workflows: Map< string, { doc?: unknown, error?: string } >,
 * }} input
 * @returns {{ problems: string[], pinned: string[] }}
 */
export function judge({ registry, workflows }) {
  const problems = [];
  const pinned = [];

  // A pin over an empty registry verifies nothing while printing a tick —
  // the phantom check this whole family is written against (#4690).
  if (!Array.isArray(registry) || registry.length === 0) {
    return { problems: ['the required-context registry is empty — nothing was pinned (see #4690).'], pinned: [] };
  }

  // (8) One context name, one entry. Two rows for one name means the registry
  // itself has lost track of which job owns the contract.
  const byContext = new Map();
  for (const entry of registry) {
    const seen = byContext.get(entry.context);
    if (seen) {
      problems.push(
        `the registry lists the context '${entry.context}' twice (${seen.workflow}:${seen.job} and ${entry.workflow}:${entry.job}) — ` +
          `one required context is published by exactly one job.`,
      );
    } else {
      byContext.set(entry.context, entry);
    }
  }

  // (10) `carries` describes the gate family; it may not embed a step count.
  // A number in this field reads as a measurement of what the required context
  // covers — the thing a reader consults to decide whether some gate is
  // protected — while being asserted by nothing, so it rots green. Measured:
  // both counts the registry once carried were already wrong at their authoring
  // commit, and the ESLint job went 24 → 54 `check:*` steps in the ten days to
  // 2026-08-16 with no gate anywhere noticing (#9103). Re-stamping the number
  // would only reschedule that; the workflow's step list is the count.
  for (const entry of registry) {
    const counted = typeof entry.carries === 'string' ? entry.carries.match(/\b\d+\s+steps?\b/i) : null;
    if (counted) {
      problems.push(
        `the registry's \`carries\` for '${entry.context}' embeds a step count (${JSON.stringify(counted[0])}). ` +
          `That number is asserted by nothing and rots silently as the gate family grows — both counts this registry used to ` +
          `carry were wrong on the day they were written, and the ESLint job's went 24 → 54 in ten days with every gate green ` +
          `(#9103). Name the gate FAMILY here and let the '${entry.job}' job's step list in .github/workflows/${entry.workflow} ` +
          `be the count.`,
      );
    }
  }

  // Workflow-level prerequisites are per FILE, so compute them once and report
  // them once — an entry-by-entry report would print the same trigger fault
  // four times and bury the job-level findings under it.
  const files = [...new Set(registry.map((entry) => entry.workflow))];
  const usable = new Set();
  for (const file of files) {
    const read = workflows.get(file);
    if (!read) {
      problems.push(`.github/workflows/${file} was never read — a scan that reads nothing cannot report a pass (#4690).`);
      continue;
    }
    if (read.error) {
      problems.push(`.github/workflows/${file} could not be read as YAML: ${read.error}`);
      continue;
    }
    const doc = read.doc;
    if (!doc || typeof doc !== 'object' || !doc.jobs || typeof doc.jobs !== 'object') {
      problems.push(`.github/workflows/${file} has no jobs: map — nothing in it was verified (#4690).`);
      continue;
    }
    usable.add(file);

    const triggers = triggersOf(doc);
    if (!triggers) {
      problems.push(`.github/workflows/${file} has no readable \`on:\` block, so its required contexts' triggers cannot be verified (#4690).`);
      continue;
    }
    // (6) merge_group. `merge_group:` with no body parses to null, which is
    // present — so test for the KEY, never for a truthy value.
    if (!Object.prototype.hasOwnProperty.call(triggers, 'merge_group')) {
      problems.push(
        `.github/workflows/${file} carries no \`merge_group:\` trigger, but publishes required context(s) ` +
          `${registry.filter((e) => e.workflow === file).map((e) => `'${e.context}'`).join(', ')}. ` +
          `A queue build would wait forever on a context that never reports (#5617 audit; the \`Console Pin Freshness\` shape).`,
      );
    }
    // (7) an unfiltered pull_request trigger.
    if (!Object.prototype.hasOwnProperty.call(triggers, 'pull_request')) {
      problems.push(
        `.github/workflows/${file} carries no \`pull_request:\` trigger, so its required context(s) never report on a PR at all (#5617 audit).`,
      );
    } else {
      const pr = triggers.pull_request;
      for (const key of ['paths', 'paths-ignore']) {
        if (pr && typeof pr === 'object' && Object.prototype.hasOwnProperty.call(pr, key)) {
          problems.push(
            `.github/workflows/${file}'s \`pull_request:\` trigger carries \`${key}:\`. A path-filtered trigger publishes NO check run ` +
              `on a PR that misses the glob — not a skip, an absence — so every required context in this file sits permanently pending ` +
              `on those PRs (#5617 audit; the \`Spec property liveness\` shape).`,
          );
        }
      }
      // (7b) a `types:` list that drops one of GitHub's defaults. Naming any
      // `types:` REPLACES the default `[opened, synchronize, reopened]`
      // rather than adding to it, so a hand-restated list that misses one is
      // the identical permanent-pending wedge as a `paths:` filter, through a
      // different key on the same trigger (#8304).
      if (pr && typeof pr === 'object' && Object.prototype.hasOwnProperty.call(pr, 'types')) {
        const types = Array.isArray(pr.types) ? pr.types : [];
        const missing = DEFAULT_PULL_REQUEST_TYPES.filter((t) => !types.includes(t));
        if (missing.length > 0) {
          problems.push(
            `.github/workflows/${file}'s \`pull_request:\` trigger names \`types:\` but omits GitHub's default activity type(s) ` +
              `${missing.map((t) => `'${t}'`).join(', ')}. Naming any \`types:\` REPLACES that default set instead of extending it, so a PR reaching ` +
              `that activity produces NO check run — not a skip, an absence — and every required context in this file sits permanently pending ` +
              `on those PRs (#8304; the \`types:\` counterpart to assertion 7's \`paths:\` guard above).`,
          );
        }
      }
    }
  }

  for (const entry of registry) {
    if (!usable.has(entry.workflow)) continue; // already reported at file level
    const jobs = workflows.get(entry.workflow).doc.jobs;
    const job = jobs[entry.job];

    // (2) the job id still exists.
    if (!job || typeof job !== 'object') {
      problems.push(
        `${entry.workflow}: job '${entry.job}' no longer exists, so the branch-protection-required context '${entry.context}' ` +
          `can never report again — the PR and the merge queue wedge on a check that will not arrive (#6865/#5617).`,
      );
      continue;
    }

    // (3) THE PIN.
    const name = job.name;
    if (name !== entry.context) {
      problems.push(
        `${entry.workflow}: job '${entry.job}' is named ${JSON.stringify(name ?? null)}, but branch protection requires the context ` +
          `'${entry.context}'. The name IS the contract: GitHub matches a required check by its check-run name, so this rename ` +
          `silently detaches the gate. Rename it back, or have a maintainer update the required set FIRST and this registry with it (#6865).`,
      );
    }

    // (4) no matrix.
    if (job.strategy && typeof job.strategy === 'object' && job.strategy.matrix !== undefined) {
      problems.push(
        `${entry.workflow}: job '${entry.job}' publishes required context '${entry.context}' but declares a strategy.matrix. ` +
          `A matrix job's check-run name has the matrix values appended, so the bare name never reports — and a SKIPPED matrix job ` +
          `publishes the name unexpanded, so it is not even one stable string (#5617 audit).`,
      );
    }

    // (5) no continue-on-error.
    const coe = job['continue-on-error'];
    if (coe !== undefined && coe !== false) {
      problems.push(
        `${entry.workflow}: job '${entry.job}' publishes required context '${entry.context}' with continue-on-error: ${JSON.stringify(coe)}. ` +
          `Such a job cannot conclude \`failure\`, so it would publish a green required context over a failing run — an advisory gate ` +
          `wearing a required gate's name.`,
      );
    }

    pinned.push(`${entry.workflow}:${entry.job} → '${entry.context}'`);
  }

  // (9) no unregistered job may shadow a registered name.
  const owner = new Map(registry.map((entry) => [`${entry.workflow}:${entry.job}`, entry.context]));
  for (const file of usable) {
    for (const [id, job] of Object.entries(workflows.get(file).doc.jobs)) {
      const name = job && typeof job === 'object' ? job.name : undefined;
      if (typeof name !== 'string') continue;
      if (owner.get(`${file}:${id}`) === name) continue; // this job IS the registered owner
      const claimed = byContext.get(name);
      if (!claimed) continue;
      problems.push(
        `${file}: job '${id}' is named '${name}', which is the required context published by ${claimed.workflow}:${claimed.job}. ` +
          `Two jobs with one name publish ONE context whose conclusion is whichever finished last, so an unrelated job could satisfy ` +
          `the required gate (#5617 audit, "同名 context 以最后一次结论为准").`,
      );
    }
  }

  return { problems, pinned };
}

/**
 * Read the workflows a registry names and judge them.
 *
 * @param {string} root repository root (or a fixture root in --self-test)
 * @param {ReadonlyArray<{ workflow: string, job: string, context: string }>} registry
 */
export async function scanWorkflows(root, registry = REQUIRED_CONTEXTS) {
  const { parse } = await import('yaml');
  const workflows = new Map();
  for (const file of new Set(registry.map((entry) => entry.workflow))) {
    const path = join(root, '.github', 'workflows', file);
    if (!existsSync(path)) {
      workflows.set(file, { error: 'the file does not exist' });
      continue;
    }
    try {
      workflows.set(file, { doc: parse(readFileSync(path, 'utf8')) });
    } catch (error) {
      workflows.set(file, { error: error.message });
    }
  }
  return judge({ registry, workflows });
}

/**
 * Exact, case-sensitive occurrence count. The names are identifiers, not
 * words: case is what separates the retired context 'ESLint' from prose about
 * the eslint tool, and the derivation sweep measured zero incidental
 * collisions in the scan set under exact matching.
 */
function countOccurrences(text, literal) {
  return text.split(literal).length - 1;
}

/**
 * Judge the instruction surfaces against already-read file text.
 *
 * Pure, like `judge` above: every input is an argument, so `--self-test`
 * exercises the real decision instead of a parallel imitation of it.
 *
 * @param {{
 *   registry: ReadonlyArray< { workflow: string, job: string, context: string } >,
 *   surfaces: ReadonlyArray< { file: string, mustName: ReadonlyArray<string> } >,
 *   retired: ReadonlyArray< { name: string, replacedBy: string | null, staleSites?: Record<string, number>, renameInFlight?: boolean } >,
 *   files: Map< string, { text?: string, error?: string } >,
 * }} input
 * @returns {{ problems: string[], notices: string[] }}
 */
export function judgeInstructionSurfaces({ registry, surfaces, retired, files }) {
  const problems = [];
  const notices = [];

  if (!Array.isArray(registry) || registry.length === 0) {
    return { problems: ['the required-context registry is empty — nothing was pinned (see #4690).'], notices: [] };
  }
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    return { problems: ['the instruction-surface scan set is empty — the #9491 scan verified nothing while printing a tick (#4690).'], notices: [] };
  }
  const retiredList = Array.isArray(retired) ? retired : [];
  const currentNames = new Set(registry.map((entry) => entry.context));

  // ── registry-level hygiene: a malformed ledger or scan set tolerates or ──
  // ── bans the wrong thing silently, so each shape is its own named red. ──
  const surfaceFiles = new Set();
  for (const surface of surfaces) {
    if (surfaceFiles.has(surface.file)) {
      problems.push(`the instruction-surface scan set lists '${surface.file}' twice.`);
    }
    surfaceFiles.add(surface.file);
    for (const context of surface.mustName ?? []) {
      if (!currentNames.has(context)) {
        problems.push(
          `'${surface.file}' is required to name '${context}', which is not a registered required context — if the context was ` +
            `renamed, update this mustName to the new literal in the same PR as the registry (and ledger the old name in ` +
            `RETIRED_CONTEXT_NAMES); if it left the required set, drop it from mustName.`,
        );
      }
    }
  }
  const seenRetired = new Set();
  for (const row of retiredList) {
    if (seenRetired.has(row.name)) {
      problems.push(`RETIRED_CONTEXT_NAMES lists '${row.name}' twice.`);
    }
    seenRetired.add(row.name);
    if (currentNames.has(row.name)) {
      problems.push(
        `RETIRED_CONTEXT_NAMES lists '${row.name}', which is still a REGISTERED context — a name cannot be both current and retired.`,
      );
    } else {
      for (const context of currentNames) {
        if (context.includes(row.name)) {
          problems.push(
            `retired name '${row.name}' is a substring of the registered context '${context}', so every occurrence of the current ` +
              `name would count as the retired one — this scan cannot tell them apart; resolve the collision before ledgering.`,
          );
        }
      }
    }
    if (row.replacedBy != null && !currentNames.has(row.replacedBy)) {
      problems.push(
        `retired name '${row.name}' says it was replaced by '${row.replacedBy}', which is not a registered context — on a ` +
          `chained rename, re-point replacedBy at the CURRENT name in the same PR as the registry.`,
      );
    }
    for (const [site, budget] of Object.entries(row.staleSites ?? {})) {
      if (!surfaceFiles.has(site)) {
        problems.push(
          `retired name '${row.name}' budgets occurrences in '${site}', which is not in the instruction-surface scan set — ` +
            `a budget nothing reads tolerates nothing; fix the path or add the surface to INSTRUCTION_SURFACES.`,
        );
      }
      if (!Number.isInteger(budget) || budget < 1) {
        problems.push(
          `retired name '${row.name}' budgets ${JSON.stringify(budget)} occurrence(s) in '${site}' — a budget is a positive ` +
            `integer; for zero, drop the key entirely.`,
        );
      }
    }
  }

  // ── per surface: the stale-name budgets, then the naming requirement. ──
  for (const surface of surfaces) {
    const read = files instanceof Map ? files.get(surface.file) : undefined;
    if (!read) {
      problems.push(`${surface.file} was never read — a scan that reads nothing cannot report a pass (#4690).`);
      continue;
    }
    if (read.error !== undefined) {
      problems.push(`${surface.file} could not be read: ${read.error}`);
      continue;
    }
    const text = read.text ?? '';

    for (const row of retiredList) {
      const count = countOccurrences(text, row.name);
      const budget = row.staleSites?.[surface.file] ?? 0;
      const replacement = row.replacedBy != null ? `'${row.replacedBy}'` : 'nothing — it left the required set';
      if (count > budget) {
        problems.push(
          `${surface.file} names the retired required context '${row.name}' ${count}× (budgeted: ${budget}). That name was replaced by ` +
            `${replacement}; a seat following this text looks for a check-run that no longer reports, and reads the absence as ` +
            `anything but a rename — it stalls, or arms on an unverified gate family (#9491). Replace the stale name, or — for a ` +
            `deliberate historical mention — raise this file's budget in RETIRED_CONTEXT_NAMES in the same PR, saying why.`,
        );
      } else if (count > 0) {
        notices.push(
          `${surface.file} names retired context '${row.name}' ${count}× within its budget of ${budget} (in-flight rename or historical mention).`,
        );
      } else if (budget > 0) {
        notices.push(
          `${surface.file} no longer names retired context '${row.name}' — its budget of ${budget} in RETIRED_CONTEXT_NAMES can be trimmed.`,
        );
      }
    }

    for (const context of surface.mustName ?? []) {
      if (!currentNames.has(context)) continue; // already a hygiene problem above
      const present = text.includes(context);
      const viaFormer = retiredList.some(
        (row) => row.replacedBy === context && row.renameInFlight === true && countOccurrences(text, row.name) > 0,
      );
      if (!present && !viaFormer) {
        problems.push(
          `${surface.file} no longer names the required context '${context}'. This file states the required set, and the literal IS ` +
            `the contract — a required check is matched by check-run name, so an instruction that stops naming it cannot be followed ` +
            `(#9491). Name it verbatim; if the context was renamed, ledger the old name in RETIRED_CONTEXT_NAMES (renameInFlight: ` +
            `true) in the rename PR; if this file legitimately stopped stating the required set, update INSTRUCTION_SURFACES in the ` +
            `same PR.`,
        );
      }
    }
  }

  // ── the renameInFlight completion notice: when no required-set surface ──
  // ── leans on the grace any more, ask for the flip — the flip PR then ──
  // ── verifies itself (it is red if flipped while any surface still leans). ──
  for (const row of retiredList) {
    if (row.renameInFlight !== true || row.replacedBy == null) continue;
    const relying = surfaces.filter((surface) => (surface.mustName ?? []).includes(row.replacedBy));
    if (relying.length === 0) continue;
    const allCurrent = relying.every((surface) => {
      const read = files instanceof Map ? files.get(surface.file) : undefined;
      return read !== undefined && read.error === undefined && (read.text ?? '').includes(row.replacedBy);
    });
    if (allCurrent) {
      notices.push(
        `every required-set surface now names '${row.replacedBy}' itself — flip '${row.name}'.renameInFlight to false in ` +
          `RETIRED_CONTEXT_NAMES, so the retired name stops satisfying the naming requirement (safe: while any surface still ` +
          `leans on the grace, that flip is red and cannot merge).`,
      );
    }
  }

  return { problems, notices };
}

/**
 * Read the instruction surfaces a scan set names and judge them.
 *
 * @param {string} root repository root (or a fixture root in --self-test)
 */
export async function scanInstructionSurfaces(
  root,
  surfaces = INSTRUCTION_SURFACES,
  retired = RETIRED_CONTEXT_NAMES,
  registry = REQUIRED_CONTEXTS,
) {
  const files = new Map();
  for (const surface of surfaces) {
    const path = join(root, surface.file);
    if (!existsSync(path)) {
      files.set(surface.file, { error: 'the file does not exist' });
      continue;
    }
    try {
      files.set(surface.file, { text: readFileSync(path, 'utf8') });
    } catch (error) {
      files.set(surface.file, { error: error.message });
    }
  }
  return judgeInstructionSurfaces({ registry, surfaces, retired, files });
}

/** The pin. */
async function main() {
  const root = scriptRepoRoot();
  const workflowVerdict = await scanWorkflows(root);
  const surfaceVerdict = await scanInstructionSurfaces(root);
  const problems = [...workflowVerdict.problems, ...surfaceVerdict.problems];
  if (problems.length > 0) {
    console.error(`✗ check-required-contexts — ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  • ${problem}`);
    for (const notice of surfaceVerdict.notices) console.error(`  ℹ ${notice}`);
    console.error(
      `\n  This gate pins the job NAMES that branch protection references. It cannot read the required set itself\n` +
        `  (Settings → Rulesets is maintainer-only; the API answers 403 to every agent seat), so a legitimate rename\n` +
        `  is a two-step act: the maintainer updates the required set, then this registry follows — and the instruction\n` +
        `  files that STATE the set follow in their own PRs, bridged by the RETIRED_CONTEXT_NAMES ledger (#9491).\n`,
    );
    process.exit(1);
  }
  const files = new Set(REQUIRED_CONTEXTS.map((entry) => entry.workflow)).size;
  console.log(
    `✓ check-required-contexts: ${workflowVerdict.pinned.length} required context name(s) pinned across ${files} workflow(s); ` +
      `${INSTRUCTION_SURFACES.length} instruction surface(s) scanned against ${RETIRED_CONTEXT_NAMES.length} retired name(s) (#9491).`,
  );
  for (const line of workflowVerdict.pinned) console.log(`    ${line}`);
  for (const notice of surfaceVerdict.notices) console.log(`  ℹ ${notice}`);
}

// ── Self-test ───────────────────────────────────────────────────────────────

async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, description) => {
    checked += 1;
    if (!condition) failures.push(description);
  };

  const root = scriptRepoRoot();
  const { parse } = await import('yaml');
  const sources = {
    'lint.yml': readFileSync(join(root, '.github', 'workflows', 'lint.yml'), 'utf8'),
    'ci.yml': readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'),
  };

  /** Judge the real workflows with one file's text replaced by `source`. */
  const withSource = (file, source) =>
    judge({
      registry: REQUIRED_CONTEXTS,
      workflows: new Map(Object.entries({ ...sources, [file]: source }).map(([f, text]) => [f, { doc: parse(text) }])),
    });

  /**
   * A mutated workflow, with the mutation itself asserted.
   *
   * Every anchor is a literal lifted out of a real workflow, so any of them can
   * go stale under an unrelated edit. `String.replace` that matches nothing
   * returns its input unchanged — which would leave the assertion below judging
   * the PRISTINE workflow and passing for the wrong reason, permanently and
   * silently. So a no-op mutation is a named failure of its own.
   */
  const fixture = (label, file, mutate) => {
    const source = mutate(sources[file]);
    assert(source !== sources[file], `fixture '${label}': its ${file} anchor no longer matches — the assertion below would judge the pristine workflow`);
    return withSource(file, source);
  };

  // ── the checked-in state is green ─────────────────────────────────────────
  const baseline = await scanWorkflows(root);
  assert(baseline.problems.length === 0, `the checked-in workflows pass the pin — got ${JSON.stringify(baseline.problems)}`);
  assert(baseline.pinned.length === REQUIRED_CONTEXTS.length, `every registered context is reached and pinned (${baseline.pinned.length}/${REQUIRED_CONTEXTS.length})`);

  // ── (3) THE PIN: reverse verification, one per workflow file ──────────────
  // Predicted direction: RED, naming the job, the new name and the required
  // context. A rename is the whole defect #6865 is about, so a green here would
  // mean the gate is decorative.
  // The anchor is the CURRENT name of the gate-family job (renamed away from
  // `ESLint` by #9325); the mutation restores the OLD spelling on purpose, so
  // this fixture doubles as the regression test for that rename: reverting
  // lint.yml alone, without this registry, is exactly the half-landed state
  // the #9325 sequencing exists to prevent, and it must be red.
  const renamedGateJob = fixture('rename the gate-family job back to ESLint', 'lint.yml', (s) =>
    s.replace('    name: Lint & Repo Gates\n', '    name: ESLint\n'),
  );
  assert(
    renamedGateJob.problems.some(
      (p) => p.includes("job 'lint'") && p.includes('"ESLint"') && p.includes("'Lint & Repo Gates'") && p.includes('The name IS the contract'),
    ),
    "renaming lint.yml's gate-family job ⇒ red, naming the job, the new name and the required context",
  );
  assert(renamedGateJob.problems.length === 1, `renaming the gate-family job produces exactly the one finding — got ${JSON.stringify(renamedGateJob.problems)}`);

  // The second-batch half: a name the maintainer approved on 2026-08-09, which
  // had no assertion of any kind before this script.
  const renamedBuildCore = fixture('rename Build Core', 'ci.yml', (s) => s.replace('    name: Build Core\n', '    name: Build (core)\n'));
  assert(
    renamedBuildCore.problems.some((p) => p.includes("job 'build-core'") && p.includes("'Build Core'")),
    'renaming ci.yml\'s Build Core job ⇒ red (the newly-approved batch is covered too)',
  );
  const renamedTemporal = fixture('rename Temporal Conformance', 'ci.yml', (s) =>
    s.replace('    name: Temporal Conformance (live PG + MySQL)\n', '    name: Temporal Conformance\n'),
  );
  assert(
    renamedTemporal.problems.some((p) => p.includes("job 'temporal-conformance'") && p.includes('Temporal Conformance (live PG + MySQL)')),
    'dropping the "(live PG + MySQL)" suffix ⇒ red — the parenthetical is part of the contract, not decoration',
  );

  // ── (2) the job disappearing entirely ─────────────────────────────────────
  const droppedJob = fixture('drop the console-pin job', 'ci.yml', (s) => s.replace('\n  console-pin:\n', '\n  console-pin-disabled:\n'));
  assert(
    droppedJob.problems.some((p) => p.includes("job 'console-pin' no longer exists") && p.includes('Console Pin Gate')),
    'a required context whose job id is gone ⇒ red',
  );

  // ── (4) growing a matrix on a registered job ──────────────────────────────
  const matrixed = fixture('matrix on build-docs', 'ci.yml', (s) =>
    s.replace('  build-docs:\n    name: Build Docs\n', '  build-docs:\n    name: Build Docs\n    strategy:\n      matrix:\n        shard: [1, 2]\n'),
  );
  assert(
    matrixed.problems.some((p) => p.includes("job 'build-docs'") && p.includes('strategy.matrix')),
    'a matrix on a required-context job ⇒ red (its bare name would never report)',
  );

  // ── (5) continue-on-error ────────────────────────────────────────────────
  const soft = fixture('continue-on-error on typecheck', 'lint.yml', (s) =>
    s.replace('  typecheck:\n    name: TypeScript Type Check\n', '  typecheck:\n    name: TypeScript Type Check\n    continue-on-error: true\n'),
  );
  assert(
    soft.problems.some((p) => p.includes("job 'typecheck'") && p.includes('continue-on-error')),
    'continue-on-error on a required-context job ⇒ red (it could never conclude failure)',
  );
  // The explicit-false spelling is the same as absent and must stay green.
  const softFalse = fixture('continue-on-error: false is not a fault', 'lint.yml', (s) =>
    s.replace('  typecheck:\n    name: TypeScript Type Check\n', '  typecheck:\n    name: TypeScript Type Check\n    continue-on-error: false\n'),
  );
  assert(softFalse.problems.length === 0, `continue-on-error: false ⇒ green — got ${JSON.stringify(softFalse.problems)}`);

  // ── (6) the merge_group trigger ──────────────────────────────────────────
  const noQueue = fixture('drop merge_group from lint.yml', 'lint.yml', (s) => s.replace('\n  merge_group:\n', '\n'));
  assert(
    noQueue.problems.some((p) => p.includes('merge_group') && p.includes('Lint & Repo Gates') && p.includes('TypeScript Type Check')),
    'a required-context workflow without merge_group ⇒ red, naming every context it would strand',
  );
  assert(
    noQueue.problems.filter((p) => p.includes('merge_group')).length === 1,
    'the trigger fault is reported ONCE per file, not once per enrolled context',
  );

  // ── (7) a path-filtered pull_request trigger ─────────────────────────────
  const pathFiltered = fixture('paths: on ci.yml', 'ci.yml', (s) =>
    s.replace('  pull_request:\n    branches:\n      - main\n', "  pull_request:\n    branches:\n      - main\n    paths:\n      - 'packages/**'\n"),
  );
  assert(
    pathFiltered.problems.some((p) => p.includes('`paths:`') && p.includes('permanently pending')),
    'a paths-filtered pull_request trigger ⇒ red (it publishes no check run at all, which is not a skip)',
  );
  const noPr = fixture('drop pull_request from ci.yml', 'ci.yml', (s) => s.replace('  pull_request:\n    branches:\n      - main\n', ''));
  assert(noPr.problems.some((p) => p.includes('no `pull_request:` trigger')), 'a required-context workflow with no pull_request trigger ⇒ red');

  // ── (7b) a `types:` list that drops a GitHub default ──────────────────────
  // No enrolled workflow names `types:` today (the one that hand-restated the
  // defaults retired with its check), so the guard is exercised by GROWING a
  // list onto ci.yml's plain trigger — which is exactly the future edit this
  // guard exists to catch: naming any `types:` REPLACES GitHub's default
  // `[opened, synchronize, reopened]`, so a hand-written list that misses one
  // is the same permanent-pending wedge as a `paths:` filter (#8304). The
  // no-`types:`-at-all ⇒ green half is the checked-in baseline itself,
  // asserted green at the top of this self-test.
  const droppedReopened = fixture('grow a types: list that omits reopened onto ci.yml', 'ci.yml', (s) =>
    s.replace('  pull_request:\n    branches:\n      - main\n', '  pull_request:\n    types: [opened, synchronize]\n    branches:\n      - main\n'),
  );
  assert(
    droppedReopened.problems.some((p) => p.includes('ci.yml') && p.includes("omits GitHub's default activity type(s) 'reopened'")),
    "a hand-restated types: list missing 'reopened' ⇒ red, naming the dropped default (#8304)",
  );
  const droppedTwo = fixture('grow a types: list that omits opened and synchronize onto ci.yml', 'ci.yml', (s) =>
    s.replace('  pull_request:\n    branches:\n      - main\n', '  pull_request:\n    types: [reopened]\n    branches:\n      - main\n'),
  );
  assert(
    droppedTwo.problems.some((p) => p.includes("'opened', 'synchronize'")),
    'dropping two defaults at once ⇒ red naming both, in default order',
  );
  const supersetTypes = fixture('grow a strict-superset types: list onto ci.yml', 'ci.yml', (s) =>
    s.replace('  pull_request:\n    branches:\n      - main\n', '  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n    branches:\n      - main\n'),
  );
  assert(
    supersetTypes.problems.length === 0,
    `a types: list that is a strict superset of the three defaults ⇒ green (got ${JSON.stringify(supersetTypes.problems)})`,
  );

  // ── (9) the shadowing collision, on the live specimen ────────────────────
  // ci.yml's sharded `test` job is named `Test Core (${{ matrix.shard }}/3)`
  // and its aggregate gate is named `Test Core`. Dropping the suffix makes two
  // jobs publish one context, and the surviving conclusion is whichever
  // finished last — a shard could satisfy the aggregate's required gate.
  const collided = fixture('collide the shard name with the gate name', 'ci.yml', (s) =>
    s.replace('name: Test Core (${{ matrix.shard }}/3)', 'name: Test Core'),
  );
  assert(
    collided.problems.some((p) => p.includes("job 'test'") && p.includes("published by ci.yml:test-gate")),
    'an unregistered job wearing a registered context name ⇒ red',
  );
  // The suffixed spelling is NOT a collision — the guard must not read a
  // prefix as a clash, or ci.yml is red on main today.
  assert(
    baseline.problems.length === 0 && sources['ci.yml'].includes('name: Test Core (${{ matrix.shard }}/3)'),
    'the real suffixed shard name coexists with the bare gate name (assertion 9 compares whole names, not prefixes)',
  );

  // ── (8) a registry that lists one context twice ──────────────────────────
  const doubled = judge({
    registry: [...REQUIRED_CONTEXTS, { workflow: 'ci.yml', job: 'build-docs', context: 'Build Core' }],
    workflows: new Map(Object.entries(sources).map(([f, text]) => [f, { doc: parse(text) }])),
  });
  assert(doubled.problems.some((p) => p.includes('twice')), 'a context registered against two jobs ⇒ red');

  // ── (10) a `carries` string that embeds a step count ─────────────────────
  // The rot mode #9103 recorded, now with an assertion on it. Both spellings
  // the registry actually used are exercised, since the parenthesised form is
  // the one a future author is most likely to reintroduce.
  const workflowsFor = () => new Map(Object.entries(sources).map(([f, text]) => [f, { doc: parse(text) }]));
  for (const spelling of ['the whole check:* gate family (25 steps)', 'the type-check family, 33 steps']) {
    const stale = judge({
      registry: [{ ...REQUIRED_CONTEXTS[0], carries: spelling }, ...REQUIRED_CONTEXTS.slice(1)],
      workflows: workflowsFor(),
    });
    assert(
      stale.problems.some((p) => p.includes('embeds a step count')),
      `a \`carries\` string carrying a step count ⇒ red (${JSON.stringify(spelling)})`,
    );
  }
  // The live registry must satisfy it — the half that would have been green for
  // ten days while the real count doubled.
  assert(
    REQUIRED_CONTEXTS.every((entry) => !/\b\d+\s+steps?\b/i.test(entry.carries ?? '')),
    'no entry in the real registry embeds a step count',
  );

  // ── missing input is a failure, never a pass (#4690) ─────────────────────
  assert(judge({ registry: [], workflows: new Map() }).problems.length === 1, 'an empty registry ⇒ red, never a silent tick');
  assert(
    judge({ registry: REQUIRED_CONTEXTS, workflows: new Map() }).problems.some((p) => p.includes('was never read')),
    'a workflow that was never read ⇒ red',
  );
  // These three generic-scanner assertions deliberately use a fixed two-file
  // registry rather than the real REQUIRED_CONTEXTS: they exercise
  // scanWorkflows' file-level handling (missing / no-jobs / unparseable), not
  // any particular entry, so pinning them to two arbitrary files keeps them
  // stable as the registry grows (#7022 learned this the hard way — the first
  // draft used REQUIRED_CONTEXTS directly and broke the moment a third
  // workflow file was registered, for a reason unrelated to what it tests).
  const twoFileRegistry = [
    { workflow: 'lint.yml', job: 'placeholder', context: 'Placeholder Lint' },
    { workflow: 'ci.yml', job: 'placeholder', context: 'Placeholder CI' },
  ];
  assert(
    judge({ registry: twoFileRegistry, workflows: new Map([['lint.yml', { error: 'boom' }], ['ci.yml', { error: 'boom' }]]) }).problems.every((p) => p.includes('boom')),
    'an unparseable workflow ⇒ red',
  );
  const empty = mkdtempSync(join(tmpdir(), 'required-contexts-'));
  try {
    assert((await scanWorkflows(empty, twoFileRegistry)).problems.some((p) => p.includes('does not exist')), 'a missing workflow file ⇒ red, never a pass');
    mkdirSync(join(empty, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(empty, '.github', 'workflows', 'lint.yml'), 'name: Lint\non: push\n');
    writeFileSync(join(empty, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push\n');
    assert((await scanWorkflows(empty, twoFileRegistry)).problems.every((p) => p.includes('no jobs')), 'a workflow with no jobs: map ⇒ red');
    writeFileSync(join(empty, '.github', 'workflows', 'lint.yml'), 'jobs: [oops\n  - :\n');
    assert((await scanWorkflows(empty, twoFileRegistry)).problems.some((p) => p.includes('could not be read as YAML')), 'an unparseable workflow ⇒ red');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  // ── the `on:` key under both YAML schemas ────────────────────────────────
  // Same document, two parser verdicts. Reading only one spelling would make
  // every trigger assertion vacuous the day the parser's schema changes — and
  // vacuous means GREEN, which is the direction that never gets noticed.
  const triggerDoc = { push: {}, pull_request: {}, merge_group: null };
  assert(triggersOf({ on: triggerDoc }) === triggerDoc, "the YAML 1.2 spelling (string key 'on') is read");
  assert(triggersOf({ [true]: triggerDoc }) === triggerDoc, 'the YAML 1.1 spelling (boolean key true) is read');
  assert(triggersOf({}) === undefined && triggersOf(null) === undefined, 'no trigger block at all is undefined, not a crash');

  // ── instruction surfaces (#9491): the stale-name scan ─────────────────────
  //
  // Fixtures here are deliberately either ADDITIVE (text appended; no anchor
  // into a region an in-flight PR edits) or fully SYNTHETIC (file text
  // supplied inline). The checklist half of the #9325 rename was an OPEN PR
  // when this scan landed; a fixture anchored into the line it rewrites would
  // have let THIS self-test eject that PR from the merge queue — the exact
  // block-the-sitting failure the budget design exists to avoid.
  const CHECKLIST_SURFACE = '.claude/skills/pm-dispatch/references/review-checklist.md';
  const surfaceSources = Object.fromEntries(
    INSTRUCTION_SURFACES.map((s) => [s.file, readFileSync(join(root, s.file), 'utf8')]),
  );
  const surfaceMap = (overrides = {}) =>
    new Map(Object.entries({ ...surfaceSources, ...overrides }).map(([f, text]) => [f, { text }]));
  const judgeSurfaces = (input = {}) =>
    judgeInstructionSurfaces({
      registry: REQUIRED_CONTEXTS,
      surfaces: INSTRUCTION_SURFACES,
      retired: RETIRED_CONTEXT_NAMES,
      files: surfaceMap(),
      ...input,
    });

  // Today's tree passes — INCLUDING while `main` sits in a rename's split-PR
  // window, which it did on the day this landed (registry renamed, the
  // checklist still naming `ESLint`, the fix PR open). Red-at-rest here blocks
  // every PR in the repo, so this asserts the reader and the budgets together.
  const surfaceBaseline = await scanInstructionSurfaces(root);
  assert(
    surfaceBaseline.problems.length === 0,
    `the checked-in instruction surfaces pass the scan — got ${JSON.stringify(surfaceBaseline.problems)}`,
  );

  // A retired name written FRESH (beyond budget) ⇒ red, naming the file, the
  // budget and the replacement. Additive on purpose: the budgeted file holds
  // 1 occurrence before its fix PR and 1 after (the fix keeps a historical
  // mention), and two appended mentions exceed the budget from either base.
  const freshStale = judgeSurfaces({
    files: surfaceMap({
      [CHECKLIST_SURFACE]: surfaceSources[CHECKLIST_SURFACE] + '\n- 入队前亲核 ESLint job;确认 ESLint 已绿。\n',
    }),
  });
  assert(
    freshStale.problems.some(
      (p) =>
        p.includes(CHECKLIST_SURFACE) &&
        p.includes("retired required context 'ESLint'") &&
        p.includes('budgeted: 1') &&
        p.includes("'Lint & Repo Gates'"),
    ),
    'a retired name written beyond its budget ⇒ red, naming the file, the budget and the replacement',
  );
  const staleInAgents = judgeSurfaces({
    files: surfaceMap({ 'AGENTS.md': surfaceSources['AGENTS.md'] + '\nConfirm the ESLint job is green before arming.\n' }),
  });
  assert(
    staleInAgents.problems.some((p) => p.includes('AGENTS.md') && p.includes("'ESLint'") && p.includes('budgeted: 0')),
    'a retired name in a zero-budget surface ⇒ red (budgets tolerate only the sites recorded at rename time)',
  );

  // The post-fix state, synthesised from the fix PR's own line shape: current
  // names present, ONE historical `ESLint` mention within budget ⇒ green —
  // the fix itself must not be blocked by this scan — and the completion
  // notice asks for the renameInFlight flip.
  const postFix = judgeSurfaces({
    files: surfaceMap({
      [CHECKLIST_SURFACE]:
        '- 入队前亲核 Lint & Repo Gates 与 TypeScript Type Check 两个 job 的 `conclusion` 已为 `success`(必需检查认 check-run 名,改名前的 PR 仍列旧名 `ESLint`)。\n',
    }),
  });
  assert(
    postFix.problems.length === 0,
    `the post-rename checklist (current names + one budgeted historical mention) ⇒ green — got ${JSON.stringify(postFix.problems)}`,
  );
  assert(
    postFix.notices.some((n) => n.includes('renameInFlight to false')),
    'once every required-set surface names the current literal itself, the flip-to-false notice fires',
  );

  // A rewording that keeps the current literals and drops the historical
  // mention ⇒ green, with the trim notice (budgets only ever ratchet down).
  const reworded = judgeSurfaces({
    files: surfaceMap({ [CHECKLIST_SURFACE]: '- 翻 ready 前确认 Lint & Repo Gates 与 TypeScript Type Check 均已 success。\n' }),
  });
  assert(
    reworded.problems.length === 0,
    `a rewording that keeps the current literals ⇒ green — got ${JSON.stringify(reworded.problems)}`,
  );
  assert(
    reworded.notices.some((n) => n.includes("'ESLint'") && n.includes('trimmed')),
    'a budget larger than the surviving occurrence count ⇒ the trim notice',
  );

  // The anti-vacuous guard, with its own ablation. A checklist that stops
  // naming any context is red ONLY because mustName exists: nothing stale is
  // present, so the retired-name half sees nothing — confirmed by ablating
  // the guard and watching the same text pass. The failure mode is real, and
  // the guard is the thing catching it, not a side effect.
  const vacuousText = '- 翻 ready 前确认全部必需检查已绿。\n';
  const vacuous = judgeSurfaces({ files: surfaceMap({ [CHECKLIST_SURFACE]: vacuousText }) });
  assert(
    vacuous.problems.filter((p) => p.includes(CHECKLIST_SURFACE) && p.includes('no longer names')).length === 2 &&
      vacuous.problems.some((p) => p.includes("'Lint & Repo Gates'")) &&
      vacuous.problems.some((p) => p.includes("'TypeScript Type Check'")),
    'an instruction file that stops naming the required set ⇒ red once per required context it dropped',
  );
  const vacuousNoGuard = judgeSurfaces({
    surfaces: INSTRUCTION_SURFACES.map((s) => (s.file === CHECKLIST_SURFACE ? { ...s, mustName: [] } : s)),
    files: surfaceMap({ [CHECKLIST_SURFACE]: vacuousText }),
  });
  assert(
    vacuousNoGuard.problems.length === 0,
    'ablating mustName ⇒ the vacuous file passes by saying nothing — the guard is load-bearing',
  );

  // The #9491 measurement, now with a red: a name that has never existed
  // replaces the real one. The garbage literal itself is NOT recognised —
  // recognition is lexicon-only — but the file no longer contains
  // 'Lint & Repo Gates' under any ledgered spelling, so mustName reds: the
  // presence guard catching what the recogniser cannot see.
  const garbage = judgeSurfaces({
    files: surfaceMap({ [CHECKLIST_SURFACE]: '- 入队前亲核 Nonexistent Job Name 与 TypeScript Type Check 两个 job。\n' }),
  });
  assert(
    garbage.problems.some((p) => p.includes(CHECKLIST_SURFACE) && p.includes("'Lint & Repo Gates'") && p.includes('no longer names')),
    "replacing a required context with 'Nonexistent Job Name' ⇒ red (the #9491 measurement, closed)",
  );

  // The split-PR window, self-contained: a surface naming ONLY the old name
  // satisfies mustName through the in-flight grace; the SAME state with the
  // grace flipped off is red — so a premature flip PR blocks itself and can
  // never race the instruction fixes.
  const windowRetired = (inFlight) => [
    { name: 'ESLint', replacedBy: 'Lint & Repo Gates', renameInFlight: inFlight, staleSites: { [CHECKLIST_SURFACE]: 1 } },
  ];
  const windowText = '- 入队前亲核 ESLint 与 TypeScript Type Check 两个 job 的 `conclusion`。\n';
  const windowOpen = judgeSurfaces({ retired: windowRetired(true), files: surfaceMap({ [CHECKLIST_SURFACE]: windowText }) });
  assert(
    windowOpen.problems.length === 0,
    `the intermediate state (old name only, budgeted, in flight) ⇒ green — got ${JSON.stringify(windowOpen.problems)}`,
  );
  const windowClosed = judgeSurfaces({ retired: windowRetired(false), files: surfaceMap({ [CHECKLIST_SURFACE]: windowText }) });
  assert(
    windowClosed.problems.some((p) => p.includes(CHECKLIST_SURFACE) && p.includes("'Lint & Repo Gates'")),
    'flipping renameInFlight to false while a surface still leans on the old name ⇒ red (the flip self-orders)',
  );

  // A FUTURE rename, end to end: retire 'TypeScript Type Check' for a new
  // name. WITH a ledger row (budgets = the real occurrence counts, computed
  // live so unrelated edits cannot stale this fixture) the atomic in-repo
  // half is green; WITHOUT it, the same registry rename is red on every
  // surface still naming the old literal AND on the naming guard — the red
  // that forces the rename PR to write the ledger.
  const renamedRegistry = REQUIRED_CONTEXTS.map((e) => (e.job === 'typecheck' ? { ...e, context: 'Static Types Gate' } : e));
  const renamedSurfaces = INSTRUCTION_SURFACES.map((s) => ({
    ...s,
    mustName: s.mustName.map((c) => (c === 'TypeScript Type Check' ? 'Static Types Gate' : c)),
  }));
  const typecheckCounts = Object.fromEntries(
    INSTRUCTION_SURFACES.map((s) => [s.file, countOccurrences(surfaceSources[s.file], 'TypeScript Type Check')]).filter(
      ([, n]) => n > 0,
    ),
  );
  assert(
    Object.keys(typecheckCounts).length >= 2,
    'the rename-protocol fixture is not vacuous: at least two surfaces name the old literal today',
  );
  const renameLedgered = judgeSurfaces({
    registry: renamedRegistry,
    surfaces: renamedSurfaces,
    retired: [
      ...RETIRED_CONTEXT_NAMES,
      { name: 'TypeScript Type Check', replacedBy: 'Static Types Gate', renameInFlight: true, staleSites: typecheckCounts },
    ],
  });
  assert(
    renameLedgered.problems.length === 0,
    `a registry rename WITH its ledger row (budgets = today's counts) ⇒ green, so the rename PR can land — got ${JSON.stringify(renameLedgered.problems)}`,
  );
  // Without a ledger row the old literal leaves the LEXICON with the registry
  // — nothing counts it — so the catch is the naming guard: the required-set
  // surfaces no longer name the new literal by any recognised spelling, and
  // the red's remedy says to write the ledger. It cannot be forgotten.
  const renameUnledgered = judgeSurfaces({ registry: renamedRegistry, surfaces: renamedSurfaces });
  assert(
    renameUnledgered.problems.some(
      (p) => p.includes("'Static Types Gate'") && p.includes('no longer names') && p.includes('RETIRED_CONTEXT_NAMES'),
    ),
    'the same rename WITHOUT a ledger row ⇒ red on the naming guard, remedy naming the ledger',
  );
  // A ledger row that under-enumerates its sites: every un-budgeted surface
  // still naming the old literal is red with its real count — the gate tells
  // the rename PR exactly which budgets to record.
  const { 'AGENTS.md': droppedBudget, ...partialCounts } = typecheckCounts;
  assert(droppedBudget > 0, 'the under-budget fixture is not vacuous: AGENTS.md names the old literal today');
  const renameUnderBudgeted = judgeSurfaces({
    registry: renamedRegistry,
    surfaces: renamedSurfaces,
    retired: [
      ...RETIRED_CONTEXT_NAMES,
      { name: 'TypeScript Type Check', replacedBy: 'Static Types Gate', renameInFlight: true, staleSites: partialCounts },
    ],
  });
  assert(
    renameUnderBudgeted.problems.some(
      (p) => p.includes('AGENTS.md') && p.includes("'TypeScript Type Check'") && p.includes('budgeted: 0'),
    ),
    'a ledger row that under-enumerates its stale sites ⇒ red naming the site and its real count',
  );

  // Ledger and scan-set hygiene: each malformed shape is its own named red —
  // a budget nothing reads, or a name the counter cannot tell apart from a
  // current one, tolerates or bans the wrong thing silently.
  const hygiene = (input) => judgeSurfaces(input).problems;
  assert(
    hygiene({ surfaces: [{ file: 'AGENTS.md', mustName: ['No Such Context'] }] }).some(
      (p) => p.includes("'No Such Context'") && p.includes('not a registered required context'),
    ),
    'mustName naming an unregistered context ⇒ red',
  );
  assert(
    hygiene({ retired: [{ name: 'Test Core', replacedBy: null, staleSites: {} }] }).some((p) =>
      p.includes('both current and retired'),
    ),
    'a retired name that is still registered ⇒ red',
  );
  assert(
    hygiene({ retired: [{ name: 'Build', replacedBy: null, staleSites: {} }] }).some((p) =>
      p.includes('substring of the registered context'),
    ),
    'a retired name that is a substring of a current one ⇒ red (its count would swallow the current name)',
  );
  assert(
    hygiene({ retired: [{ name: 'Old Gate', replacedBy: 'No Such Context', staleSites: {} }] }).some(
      (p) => p.includes('replaced by') && p.includes('No Such Context'),
    ),
    'replacedBy pointing at an unregistered context ⇒ red (a chained rename must re-point at the current name)',
  );
  assert(
    hygiene({ retired: [{ name: 'Old Gate', replacedBy: null, staleSites: { 'no/such/file.md': 1 } }] }).some(
      (p) => p.includes('no/such/file.md') && p.includes('not in the instruction-surface scan set'),
    ),
    'a budget keyed by a file outside the scan set ⇒ red (it would tolerate nothing)',
  );
  assert(
    hygiene({ retired: [{ name: 'Old Gate', replacedBy: null, staleSites: { 'AGENTS.md': 0 } }] }).some((p) =>
      p.includes('positive'),
    ),
    'a zero budget ⇒ red (drop the key instead)',
  );
  assert(
    hygiene({
      retired: [
        { name: 'Old Gate', replacedBy: null, staleSites: {} },
        { name: 'Old Gate', replacedBy: null, staleSites: {} },
      ],
    }).some((p) => p.includes("'Old Gate'") && p.includes('twice')),
    'a ledger row listed twice ⇒ red',
  );
  assert(
    hygiene({ surfaces: [...INSTRUCTION_SURFACES, INSTRUCTION_SURFACES[0]] }).some((p) => p.includes('twice')),
    'a surface listed twice ⇒ red',
  );
  assert(
    judgeSurfaces({ surfaces: [] }).problems.some((p) => p.includes('scan set is empty')),
    'an empty scan set ⇒ red, never a silent tick (#4690)',
  );
  assert(
    judgeSurfaces({ files: new Map() }).problems.filter((p) => p.includes('was never read')).length ===
      INSTRUCTION_SURFACES.length,
    'an instruction surface that was never read ⇒ red, once per surface (#4690)',
  );
  const emptySurfaceRoot = mkdtempSync(join(tmpdir(), 'instruction-surfaces-'));
  try {
    const missing = await scanInstructionSurfaces(emptySurfaceRoot);
    assert(
      missing.problems.filter((p) => p.includes('could not be read') && p.includes('does not exist')).length ===
        INSTRUCTION_SURFACES.length,
      'a scan root with no instruction files ⇒ red per surface, never a pass',
    );
  } finally {
    rmSync(emptySurfaceRoot, { recursive: true, force: true });
  }

  // ── the wiring: this gate must actually run on every PR ──────────────────
  //
  // Same shape, and the same honesty, as check-empty-changeset's consumer block
  // (#6509): assertions are only as real as the step that runs them, and a gate
  // nobody invokes is #4690's phantom check with extra ceremony. So the wiring
  // is read, not assumed.
  //
  // RESIDUAL, recorded rather than implied: this assertion is run BY the step it
  // pins, so a PR that deletes both the step and this script is not caught here
  // — nothing afterwards remembers either existed. That is a deletion plainly
  // visible in a `.github/**` diff rather than a silent no-op, and closing it
  // entirely would need a gate outside this file asserting this file's wiring,
  // which is a coupling with its own cost.
  {
    const uncommented = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const lintJobStart = sources['lint.yml'].indexOf('\n  lint:');
    const lintJobEnd = sources['lint.yml'].indexOf('\n  typecheck:');
    const lintJob = uncommented(lintJobStart === -1 ? '' : sources['lint.yml'].slice(lintJobStart, lintJobEnd === -1 ? undefined : lintJobEnd));
    assert(
      /run: pnpm check:required-contexts\b/.test(lintJob),
      'wiring: lint.yml\'s `lint` job (the "Lint & Repo Gates" context) must run `pnpm check:required-contexts` — an unwired pin verifies nothing (#4690)',
    );
    const step = lintJob.split(/\n(?=      - name: )/).find((s) => /run: pnpm check:required-contexts\b/.test(s)) ?? '';
    assert(
      !/^\s*if:/m.test(step),
      'wiring: the required-context pin step must carry NO `if:` — whatever a condition reads is a way for a PR to arrange that this pin does not run on it',
    );
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const wiring = pkg.scripts?.['check:required-contexts'] ?? '';
    assert(/check-required-contexts\.mjs --self-test/.test(wiring), 'wiring: `check:required-contexts` must run this file\'s --self-test first');
    assert(/check-required-contexts\.mjs(?! --self-test)/.test(wiring), 'wiring: `check:required-contexts` must also run the real pin, not only the self-test');
    // The pin lives in a job it also pins. That is deliberate and worth stating:
    // renaming the gate-family job turns this gate red under the NEW name, while
    // the old required context stops reporting — the PR is blocked from both
    // sides. That is also why the #9325 rename could not be self-serve: the
    // repo-side half is checkable here, the Settings half is not reachable at all.
    assert(
      REQUIRED_CONTEXTS.some((entry) => entry.workflow === 'lint.yml' && entry.job === 'lint'),
      'wiring: the job this gate runs in is itself registered, so a rename of it cannot be the one rename nothing notices',
    );
    // The instruction-surface scan must be wired into the PIN, not only into
    // this self-test — a scan only the self-test exercises is #4690's phantom
    // check with extra ceremony. Read from this file's own source, same
    // honesty as the package.json/lint.yml wiring reads above.
    const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const mainBody = ownSource.slice(ownSource.indexOf('async function main()'), ownSource.indexOf('// ── Self-test'));
    assert(
      /scanInstructionSurfaces\(root\)/.test(mainBody),
      'wiring: the pin (main) runs the instruction-surface scan, not only the self-test (#4690/#9491)',
    );
    assert(
      /surfaceVerdict\.problems/.test(mainBody),
      "wiring: the pin merges the surface scan's problems into its exit verdict (#9491)",
    );
  }

  if (failures.length > 0) {
    console.error(`✗ check-required-contexts --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-required-contexts --self-test: ${checked} assertions ` +
      `(rename ablations across both workflows + matrix/continue-on-error/trigger shapes + the shard-name collision + ` +
      `the \`carries\` step-count ban + the instruction-surface stale-name scan (#9491) + the #4690 pins).`,
  );
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  await main();
}
