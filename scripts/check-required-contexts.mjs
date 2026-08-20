#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Required-context name pin (#6865) — the job `name:` literals that branch
 * protection references are CONTRACT, so the repo asserts them.
 *
 *   node scripts/check-required-contexts.mjs               # the pin (lint)
 *   node scripts/check-required-contexts.mjs --self-test   # verify the checker itself
 *   node scripts/check-required-contexts.mjs --verify-required-set
 *                                       # report-only live ruleset diff (#9642)
 *                                       # ⛔ NOT runnable from a dev seat — see
 *                                       #    "Where the live half can run" below
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
 *      it (#5617's audit named `Console Pin Freshness` as exactly this shape at
 *      the time of the audit; that workflow has since been deleted outright —
 *      see the ⛔ exclusion note below, which outlives it);
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
 * ## The required SET: readable, diffable, and deliberately not merge-blocking
 *
 * ⚠️ TWO DIFFERENT ENDPOINTS answer for "is this name actually required", and
 * confusing them is how this header carried a false premise for weeks (#9642).
 * Both are named here, with which one holds THIS repository's configuration, so
 * a reader who doubts this paragraph tests the right URL:
 *
 *   • the CLASSIC BRANCH-PROTECTION endpoint,
 *     GET /repos/objectstack-ai/objectstack/branches/main/protection,
 *     answers HTTP 403 `Resource not accessible by integration` to an ordinary
 *     agent seat. GitHub names its price in the response itself —
 *     `X-Accepted-GitHub-Permissions: administration=read` — and no Actions
 *     token can pay it either: `administration` is not among the 17 permissions
 *     a workflow may grant its GITHUB_TOKEN. It is ALSO not where this repo's
 *     configuration lives — `main` is governed by a repository RULESET, not by
 *     classic branch protection. Testing this URL and concluding "the required
 *     set is unreadable" is the exact error #9642 retired.
 *   • the RULESET endpoints, GET /repos/objectstack-ai/objectstack/rulesets and
 *     the same path plus /{id}, answer HTTP 200 to an ordinary agent seat.
 *     Their price is `X-Accepted-GitHub-Permissions: metadata=read` — the
 *     baseline every token carries, and not one of the 17 a workflow can toggle
 *     because it cannot be given up. The required SET is readable — by a token
 *     that reaches api.github.com at all, which a DEV SEAT does not (see
 *     "Where the live half can run" at `--verify-required-set` below; that is a
 *     transport fact about the container, not a permission this repo grants).
 *
 * Measured 2026-08-18 (#9642): one ruleset, `main`, id 12119582, enforcement
 * `active`, repository-sourced — `includes_parents=true` returns that one and
 * only that one, so no organization ruleset is being missed — carrying six
 * `required_status_checks` contexts and `strict_required_status_checks_policy:
 * false`.
 *
 * ⚠️ What is readable is the set as it is NOW, never how it got there. Both
 * history routes are shut to a seat, re-measured 2026-08-18 (#9533) with the
 * price GitHub names in each response:
 *
 *   GET .../rulesets/12119582/history        403  administration=write
 *   GET .../rulesets/rule-suites             403  administration=read
 *
 * So "when did this context leave the set" and "was it ever in it" are NOT
 * agent-answerable, and no amount of re-reading the live endpoint turns into
 * an answer. A row's provenance therefore has to be carried in writing, here,
 * by the PR that adds it — which is why `authorized` distinguishes a ruling
 * that APPROVED a context from an application that was ATTESTED APPLIED. That
 * distinction is not pedantry: #9533 turned on it (see the tombstone below).
 *
 * So the two lists are machine-comparable, and `--verify-required-set` below
 * compares them in BOTH directions. What that mode is NOT is a merge-blocking
 * gate, for a structural reason rather than a squeamish one: the settings half
 * of any required-set change is maintainer-only and lands AFTER the merge (the
 * #9325 two-step). A required check reddening on registry-vs-settings
 * disagreement would be red on precisely the PR carrying the repo half and
 * could not go green before merging — it would deadlock the sitting it claims
 * to protect. It is report-only, in `check-governed-merges.mjs`'s posture, and
 * the pin proper stays entirely network-free so the required `Lint & Repo
 * Gates` context can never redden on a GitHub blip (self-test: 'the pin stays
 * network-free').
 *
 * ⚠️ What has NOT changed: this registry is still the repo's DECLARATION of
 * what the settings are believed to reference, sourced from the maintainer
 * rulings on #5617. Adding a row here does not make a context required, and
 * only a maintainer can change the settings. What #9642 changed is that a
 * disagreement is now MEASURED instead of invisible — and the first run found
 * one: `Build Docs` and `Console Pin Gate` were registered here and were NOT
 * in the live required set. That first finding is closed (#9533, 2026-08-18
 * ruling — the two rows dropped; the tombstone below carries the provenance),
 * so the two lists agree in both directions today and the sweep prints its
 * ✅ line. The mechanism stays for the next disagreement; it reports and
 * decides nothing.
 *
 * ## Why `if:` is deliberately NOT asserted
 *
 * #6865's own body proposed asserting the enrolled jobs carry no `if:`. That is
 * right for lint.yml's two and WRONG for the four jobs the 2026-08-09 ruling
 * approved (approved — how much of that batch reached the settings is #9533's
 * finding below): `build-core`, `build-docs`, `console-pin` and
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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
 * (the audit's stated reason was "no `merge_group` trigger — required-izing it
 * deadlocks the queue, and that file's own comment invites it". ⚠️ Two things
 * happened to that reason and neither reopens the question: #6121 added the
 * trigger, which #6991 recorded as making the stated reason stale; then #10134
 * DELETED the workflow, the script and the `package.json` entry outright, so no
 * check-run of this name reports at all — the 2026-08-20 ruling is that which
 * objectui revision we pin is a decision taken in an objectstack issue, never
 * derived from objectui `main`, so there is no currency question for a gate to
 * ask. This entry STAYS for a reason the deletion CREATES: it is now the only
 * thing standing between a future author and rebuilding a same-named gate and
 * enrolling it here), `Spec property liveness` (PR-side `paths:`,
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
 * ⛔ TOMBSTONE — `Build Docs` (ci.yml:build-docs) and `Console Pin Gate`
 * (ci.yml:console-pin), dropped 2026-08-18 by the #9533 ruling. Recorded at
 * length because the shape here is NOT the one the ruling's wording assumed,
 * and a future reader who re-derives it from git will otherwise reach the
 * same wrong conclusion twice:
 *
 *   • What the rows claimed. Both carried `authorized: '#5617 closing ruling
 *     2026-08-09, second batch'` — and that ruling reads «Second batch
 *     approved: Build Core, Build Docs, Console Pin Gate, Temporal Conformance
 *     (live PG + MySQL) join the required set … The maintainer applies this in
 *     Settings alongside confirming item 2.» An APPROVAL, in the future tense,
 *     of a Settings action. Contrast the two 2026-08-07 rows, whose
 *     `authorized` says "applied to the settings the same day": those attest
 *     an accomplished state. Nothing anywhere ever attested this batch applied.
 *   • What the settings actually took. The one contemporaneous transcription
 *     of the ruleset — the maintainer's 2026-08-10 screenshot, quoted on
 *     #7022 — lists `ADR maintainer approval` "alongside TypeScript Type
 *     Check / ESLint / Test Core / Dogfood Regression Gate / Build Core".
 *     Of the four-name batch, only `Build Core` is there. `Temporal
 *     Conformance` arrived later; these two never appear in any reading.
 *   • So this is most likely a HALF-APPLIED approval, not a removal — the
 *     #6865 two-step's other failure mode, and one no one could see while the
 *     required set was believed unreadable. It cannot be proven: ruleset
 *     history is 403 to a seat (see the header). Stated as the likelihood it
 *     is, because the ruling's own veto clause ("if the removal was in fact
 *     accidental, restore the contexts in Settings instead") is aimed at a
 *     removal, and the maintainer re-reading this should know the choice on
 *     the table is really "apply the standing 2026-08-09 approval, or let it
 *     lapse". The ruling let it lapse; that is what these rows record.
 *
 * ⛔ And why this tombstone is PROSE and not a RETIRED_CONTEXT_NAMES row,
 * against the #9523 precedent the ruling cited. That ledger bans a name from
 * the instruction surfaces because the name is DEAD — no check-run reports it
 * any more. Neither of these names is dead: both jobs still exist, still carry
 * these `name:` literals, and still publish these check-runs on every PR that
 * trips their filter. They lost REQUIRED status, which is a different fact.
 * Ledgering them anyway was measured before it was rejected (2026-08-18):
 * `docs/releases-maintenance.md` names `Console Pin Gate` in correct, current
 * prose describing what still checks the pin, so
 * the row reds the scan there and prints the diagnostic "a seat following this
 * text looks for a check-run that no longer reports" — false, about prose that
 * is right. Budgeting around it would only arm the trap for the next author
 * who legitimately names the live job.
 *
 * ⚠️ The cost of the drop, stated rather than discovered later: these two
 * `name:` literals are now pinned by NOTHING, while prose elsewhere still refers
 * to the jobs by name — `docs/releases-maintenance.md`,
 * `packages/console/README.md` and lint.yml's cross-reference among them. This
 * list read FIVE until #10134 deleted `scripts/check-objectui-pin-fresh.mjs` and
 * `.github/workflows/objectui-pin-freshness.yml`, both of which named
 * `Console Pin Gate` only to tell it apart from `Console Pin Freshness`; the
 * recorded debt shrank by two and did not close. ⚠️ It was never asserted by
 * anything either way, so read it as examples and never as a census — the same
 * trap the `carries` note below is about. Renaming either job no longer detaches a
 * required gate — that is the whole point — but it does silently falsify that
 * prose. Filed as its own card rather than solved here, since a pin for
 * "contract job names that are not required contexts" is a new mechanism and
 * this card is ledger hygiene. Filed as #9793.
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
    authorized:
      '#5617 closing ruling 2026-08-09, second batch — "the highest-value addition"; ' +
      'the only member of that batch the 2026-08-10 ruleset screenshot (#7022) shows applied, and live in the 2026-08-18 read',
    carries: 'the only compile-regression gate in the repo',
  },
  {
    workflow: 'ci.yml',
    job: 'temporal-conformance',
    context: 'Temporal Conformance (live PG + MySQL)',
    authorized:
      '#5617 closing ruling 2026-08-09, second batch; absent from the 2026-08-10 screenshot and present in the ' +
      '2026-08-18 read, so it was applied somewhere between the two — no attestation names the day',
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
 *     FRESH); at or below = green with a notice. A ban would be wrong while
 *     the fix PRs are in flight — a fix may legitimately keep the dead name
 *     as a historical mention ("改名前的 PR 仍列旧名"), and history is
 *     legitimate prose everywhere. Budgets only ever ratchet down, by hand,
 *     notice-driven; a row whose budgets have been trimmed away is a standing
 *     ban on writing that dead name fresh anywhere in the scan set. The
 *     `ESLint` row reached that state on 2026-08-18: its checklist fix was
 *     expected to keep one historical mention and dropped the name outright,
 *     the trim notice fired, and the budget was deleted — measured, not
 *     assumed, which is the whole point of the notice being notice-driven.
 *   - `renameInFlight: true` lets the OLD literal satisfy a `mustName`
 *     requirement while the instruction fixes are in flight. Once every
 *     required-set surface names the new literal itself, a notice asks for
 *     the flip to false. Flipping early is safe by construction: the flip PR
 *     goes red while any surface still leans on the grace, so it cannot merge
 *     before the fixes do — it self-orders, it never races. (The pin runs in
 *     the `Lint & Repo Gates` job with no `if:`, asserted in the wiring block
 *     below, so "red" there means the required context is red — that is what
 *     makes the self-ordering hold rather than merely being claimed.)
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
    // naming every blocking context. States the required set ⇒ mustName.
    // Widened to all six by the #9677 ruling (2026-08-18): the sentence had
    // named two and called the other four advisory-and-rides-through, which
    // is the misclassification that puts a PR into the queue to be ejected.
    // The full set is pinned here so the corrected sentence cannot rot back
    // — a rename in ANY of the six now reddens this gate instead.
    file: 'AGENTS.md',
    mustName: [
      'Lint & Repo Gates',
      'TypeScript Type Check',
      'Test Core',
      'Dogfood Regression Gate',
      'Build Core',
      'Temporal Conformance (live PG + MySQL)',
    ],
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
 * The repo-ROOT surface above, declared for `scripts/pm/dispatch-gates.mjs`
 * (#9979, applying #9964's pattern).
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and "looks like a path" there means "carries a separator". Four
 * of the five surfaces have one; `AGENTS.md` does not, because a repo-root FILE
 * has no separator to be found by — so an AGENTS.md card derived this gate not
 * at all, while that surface is the one carrying `mustName` for all six
 * required contexts (widened 2→6 by the #9677 ruling). Editing the merge-queue
 * paragraph there is precisely how this gate goes red, and it was reachable
 * only by judgment.
 *
 * `<file>/**` is the form that reaches a root file: the extractor accepts it,
 * and `collapseHint` reduces it back to that one path and to nothing else.
 *
 * ⚠️ Provenance, NOT a lookup key. `scanInstructionSurfaces` opens every
 * surface `file`; the glob spelling appearing there would send this gate
 * reading a path that does not exist — and a surface it cannot read is a hard
 * failure here by design (#4690). The self-test pins both halves.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**'];

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
    // NO budgets: the rename is complete on every surface. The checklist's
    // gate-clearance line was the one budgeted site (1 occurrence, in flight
    // as its own PR when this row was written) and its fix was expected to
    // keep that mention as deliberate history; it dropped the name entirely
    // instead, the trim notice fired, and the budget was deleted on
    // 2026-08-18. This row is therefore now a standing ban: writing `ESLint`
    // fresh into ANY scanned surface is red. A future deliberate historical
    // mention is still legitimate prose — it just has to re-record a budget
    // here, in the same PR, saying why.
    // The grace is closed for the same reason: every required-set surface
    // names 'Lint & Repo Gates' itself, so the retired literal no longer
    // satisfies mustName (self-test: "the shipped ledger's grace is closed").
    renameInFlight: false,
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

// ── The live required SET (#9642) ───────────────────────────────────────────

/**
 * `--verify-required-set` — the half this file spent weeks calling unreadable.
 *
 *   node scripts/check-required-contexts.mjs --verify-required-set
 *   node scripts/check-required-contexts.mjs --verify-required-set --json
 *
 * ## Why this is report-only and NOT wired into the required gate
 *
 * The settings half of any required-set change is MAINTAINER-ONLY and lands
 * AFTER the merge — the #9325 rename two-step: merge the rename, then swap the
 * Settings entry. A required check that reddened on registry-vs-settings
 * disagreement would therefore be red on precisely the PR carrying the repo
 * half, and could not go green before merging: it would deadlock the sitting it
 * claims to protect, the same way required-izing a context with no `merge_group`
 * trigger — the `Console Pin Freshness` shape — deadlocks the queue. Report-only
 * is not timidity here, it is the only shape
 * that does not self-block.
 *
 * The posture is `check-governed-merges.mjs`'s, verbatim in behaviour: a
 * completed sweep exits 0 whether it found 0 or 40 disagreements, and a
 * non-zero exit classifies the ENVIRONMENT, not the tree. Unreachable prints
 * NOT VERIFIED and exits 2; it is never a pass (#4690).
 *
 * ## Where the live half can run — NOT from a dev seat (#9678)
 *
 * ⛔ A `NOT VERIFIED` here on an agent session container is the ENVIRONMENT,
 * never the tree and never this registry. Do not chase it, do not "fix" it, and
 * do not conclude from it that the ruleset is unreadable — that inference, from
 * a different cause, is exactly what #9642 had to retire. Re-measured
 * 2026-08-19 from a dev seat, both documented spellings:
 *
 *   node scripts/check-required-contexts.mjs --verify-required-set
 *       -> NOT VERIFIED — GET /repos/objectstack-ai/objectstack answered 401
 *   NODE_OPTIONS=--use-env-proxy node ... --verify-required-set
 *       -> NOT VERIFIED — GET /repos/objectstack-ai/objectstack answered 403
 *
 * The 401 is the #7412 proxy trap (Node's global fetch does not read
 * HTTPS_PROXY on its own), and `renderRequiredSetUnverified` says so. The 403
 * is the finding: with the documented remedy applied, the seat's own egress
 * policy refuses api.github.com. The proxy hint correctly goes SILENT once the
 * flag is set, so what a dev actually sees is a bare 403 with no explanation of
 * its seat class — hence this paragraph. Two seat classes, both dead ends;
 * there is no third spelling that works from here.
 *
 * The standing caller is therefore `.github/workflows/required-set-patrol.yml`
 * (#9678), where a runner reaches the API directly with the workflow's own
 * GITHUB_TOKEN — no proxy env and no `--use-env-proxy` needed. It is scheduled,
 * report-only and ⛔ never a required context; the "live mode stays OFF the
 * required path" block in `--self-test` pins that from this side.
 *
 * ## Both directions are reported, because they are different defects
 *
 *   A. a REGISTRY ROW whose context is absent from the live required set — the
 *      gate family that row names is ADVISORY right now, with no signal
 *      anywhere. #5617 verbatim: PR #5584 merged with its gate-carrying job red
 *      for 19 minutes because that job was not in the required set at all.
 *   B. a LIVE required context with no registry row — a required context whose
 *      job `name:` literal nothing in this repo pins. Renaming that job detaches
 *      its gate silently, which is the whole defect this file exists for; the
 *      remedy is a registry row, not a settings change.
 *
 * Neither is judged here. A is the maintainer's to resolve (drop the row, or
 * restore the context); B is a dev's (add the row with its authorizing ruling).
 *
 * ## Enforcement and target are read, not assumed
 *
 * A ruleset in `evaluate` (dry-run) or `disabled` enforcement blocks nothing,
 * and a ruleset whose `conditions.ref_name` does not cover the default branch
 * is about some other ref. Counting either as "required" would manufacture the
 * exact false green this file was written to prevent, so their contexts are
 * collected separately and reported as a SHADOW set.
 */

/** Does a ruleset's ref condition cover `defaultBranch`? */
export function rulesetCoversDefaultBranch(ruleset, defaultBranch) {
  const cond = ruleset?.conditions?.ref_name;
  if (!cond) return false;
  const spellings = [`refs/heads/${defaultBranch}`, '~DEFAULT_BRANCH', '~ALL'];
  const exclude = Array.isArray(cond.exclude) ? cond.exclude : [];
  if (exclude.some((p) => spellings.includes(p))) return false;
  const include = Array.isArray(cond.include) ? cond.include : [];
  return include.some((p) => spellings.includes(p));
}

/**
 * The live-vs-registry verdict. Pure, so the self-test asserts on it offline —
 * the predicates cannot rot unrun the way an uninvoked self-test does (#4690).
 *
 * `rulesets` is a list of FULL ruleset objects (the `/rulesets/{id}` shape,
 * with `rules[]`), not the listing shape.
 */
export function judgeRequiredSet({ registry, rulesets, defaultBranch = 'main' }) {
  const enforcing = [];
  const shadowed = [];
  for (const ruleset of rulesets ?? []) {
    if (ruleset?.target !== 'branch') continue;
    if (!rulesetCoversDefaultBranch(ruleset, defaultBranch)) continue;
    (ruleset.enforcement === 'active' ? enforcing : shadowed).push(ruleset);
  }

  let strict = null;
  const collect = (list, into, readStrict) => {
    for (const ruleset of list) {
      for (const rule of ruleset.rules ?? []) {
        if (rule?.type !== 'required_status_checks') continue;
        const parameters = rule.parameters ?? {};
        if (readStrict && typeof parameters.strict_required_status_checks_policy === 'boolean') {
          strict = parameters.strict_required_status_checks_policy;
        }
        for (const check of parameters.required_status_checks ?? []) {
          const context = typeof check === 'string' ? check : check?.context;
          if (typeof context !== 'string' || context === '') continue;
          if (!into.has(context)) into.set(context, []);
          into.get(context).push(`${ruleset.name ?? ruleset.id} (${ruleset.enforcement})`);
        }
      }
    }
  };
  const live = new Map();
  const shadow = new Map();
  collect(enforcing, live, true);
  collect(shadowed, shadow, false);

  const registered = new Set(registry.map((entry) => entry.context));
  return {
    defaultBranch,
    rulesetsRead: (rulesets ?? []).length,
    enforcing: enforcing.map((r) => ({ id: r.id, name: r.name, source: r.source ?? null, sourceType: r.source_type ?? null })),
    shadowed: shadowed.map((r) => ({ id: r.id, name: r.name, enforcement: r.enforcement })),
    live: [...live.keys()],
    shadow: [...shadow.keys()],
    strict,
    // Direction A — declared here, not required there.
    advisory: registry.filter((entry) => !live.has(entry.context)),
    // Direction B — required there, pinned by nothing here.
    unpinned: [...live.keys()].filter((context) => !registered.has(context)).map((context) => ({ context, from: live.get(context) })),
    noEnforcingRuleset: enforcing.length === 0,
    noRequiredChecksRule: enforcing.length > 0 && live.size === 0,
  };
}

/** The whole report as text — pure, so the self-test asserts on the words. */
export function renderRequiredSetReport(verdict) {
  const lines = [
    `required-set sweep: ${verdict.live.length} live required context(s) on ${verdict.defaultBranch}, ` +
      `${verdict.advisory.length} registered-but-not-required, ${verdict.unpinned.length} required-but-unpinned.`,
    `  read ${verdict.rulesetsRead} ruleset(s); ${verdict.enforcing.length} active and covering the default branch` +
      (verdict.strict === null ? '' : `; strict_required_status_checks_policy: ${verdict.strict}`),
    `  Report-only by design (#9642): the settings half of any change is maintainer-only and lands AFTER the merge,`,
    `  so a merge-blocking version of this diff would be red on the very PR that carries the repo half.`,
  ];
  for (const ruleset of verdict.enforcing) {
    lines.push(`    • ruleset ${ruleset.name} (id ${ruleset.id}, ${ruleset.sourceType ?? 'unknown'}-sourced${ruleset.source ? ` — ${ruleset.source}` : ''})`);
  }
  for (const ruleset of verdict.shadowed) {
    lines.push(`    ⚠️  ruleset ${ruleset.name} (id ${ruleset.id}) is enforcement=${ruleset.enforcement} — it blocks NOTHING; its contexts are SHADOW, not required.`);
  }
  for (const context of verdict.live) lines.push(`    required: ${context}`);
  for (const context of verdict.shadow) lines.push(`    shadow (not enforced): ${context}`);

  if (verdict.noEnforcingRuleset) {
    lines.push(
      '',
      `  ⛔ NO active ruleset covers ${verdict.defaultBranch}. Every gate in the registry is advisory and the merge`,
      '     queue enforces nothing. This is a reading, not an environment failure — the API answered.',
    );
  } else if (verdict.noRequiredChecksRule) {
    lines.push('', `  ⛔ the active ruleset(s) carry NO required_status_checks rule — every registered gate is advisory.`);
  }

  if (verdict.advisory.length > 0) {
    lines.push(
      '',
      `  ⛔ direction A — registered here, NOT in the live required set (${verdict.advisory.length}). Each of these gate`,
      '     families is ADVISORY today, with no signal anywhere. That is #5617 verbatim: PR #5584 merged with its',
      '     gate-carrying job red for 19 minutes because that job was not in the required set at all.',
    );
    for (const entry of verdict.advisory) {
      lines.push(`       • ${entry.context} — ${entry.workflow} job '${entry.job}' — carries ${entry.carries}`);
      lines.push(`           authorized: ${entry.authorized}`);
    }
    lines.push(
      '     Resolving this is a MAINTAINER decision (drop the row, or restore the context in Settings → Rulesets);',
      '     this script decides nothing. File a card and follow the #6865 two-step; #9533 is the worked precedent',
      '     (it dropped a pair, and its tombstone in REQUIRED_CONTEXTS records what a row does and does not attest).',
    );
  }

  if (verdict.unpinned.length > 0) {
    lines.push(
      '',
      `  ⛔ direction B — required in the live set, pinned by NO registry row (${verdict.unpinned.length}). Renaming the job`,
      '     that publishes one of these detaches its gate silently — the defect this whole file exists for. The remedy',
      '     is a REQUIRED_CONTEXTS row naming the workflow, job id and authorizing ruling; no settings change.',
    );
    for (const entry of verdict.unpinned) lines.push(`       • ${entry.context} — from ${entry.from.join(', ')}`);
  }

  if (verdict.advisory.length === 0 && verdict.unpinned.length === 0 && !verdict.noEnforcingRuleset && !verdict.noRequiredChecksRule) {
    lines.push('', `  ${REQUIRED_SET_CLEAN_MARK}  the live required set and this registry agree in both directions.`);
  }
  return lines.join('\n');
}

/**
 * What an unreachable read prints. Never the word "verified" — #4690.
 *
 * The proxy hint is not politeness. In an agent container every GitHub call is
 * routed through the session proxy, and Node's global fetch does NOT read
 * HTTPS_PROXY on its own (Node 22): the read then answers HTTP 401 and a reader
 * who stops there concludes "the ruleset is unreadable from this seat" — which
 * is the EXACT false premise #9642 retired, re-derived from a different cause.
 * Measured on the day this landed: unset, 401; with the flag, 200 and a full
 * reading. `check-governed-merges.mjs` reaches the API the same way and shares
 * the trap.
 */
export function renderRequiredSetUnverified(reason, env = process.env) {
  const proxied = Boolean(env.HTTPS_PROXY || env.https_proxy) && !/--use-env-proxy/.test(env.NODE_OPTIONS ?? '');
  return (
    `required-set sweep: NOT VERIFIED — ${reason}\n` +
    '  The live required set could not be read, so nothing is asserted about it in either direction.\n' +
    '  NOT VERIFIED is not a pass and not a failure of the tree (#4690); exit 2 classifies the ENVIRONMENT.\n' +
    '  The read needs only `metadata=read` (GitHub answers that in X-Accepted-GitHub-Permissions), so the usual\n' +
    '  cause is a missing GITHUB_TOKEN / GH_TOKEN rather than a permission this repo would have to grant.' +
    (proxied
      ? '\n  ⚠️  HTTPS_PROXY is set and NODE_OPTIONS does not carry --use-env-proxy: Node fetch is bypassing the\n' +
        '      session proxy, which answers 401 here. Re-run as NODE_OPTIONS=--use-env-proxy before concluding\n' +
        '      anything about readability — that inference is how #9642 happened.'
      : '')
  );
}

/** Sweep complete (0 or N disagreements). */
export const EXIT_SWEPT = 0;
/** Could not read the live set — classifies the environment, never the tree. */
export const EXIT_ENVIRONMENT = 2;

/**
 * The standing caller for the live mode (#9678) — scheduled, report-only, and
 * ⛔ never a required context. Named here rather than only in a comment so the
 * self-test can assert the caller EXISTS and that nothing else runs the flag.
 * Repo-root-relative to `.github/workflows/`.
 */
export const PATROL_WORKFLOW = 'required-set-patrol.yml';

/**
 * The clean mark a COMPLETED sweep renders when the two lists agree in both
 * directions, and the exact character the patrol keys its drift annotation on.
 * One constant rather than two copies: the workflow reads this out of the
 * rendered report, so a silent divergence between "what the report prints" and
 * "what the caller looks for" would turn every drift finding into a green tick.
 * Every non-agreeing reading withholds it, so the patrol annotates on ABSENCE —
 * which fails toward a false alarm, never a false all-clear.
 */
export const REQUIRED_SET_CLEAN_MARK = '✅';

function requiredSetApiContext(env) {
  return {
    apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    repo: env.GITHUB_REPOSITORY ?? 'objectstack-ai/objectstack',
    token: env.GITHUB_TOKEN || env.GH_TOKEN || null,
  };
}

async function fetchGithubJson(url, token) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error?.message ?? error}`);
  }
  if (!res.ok) throw new Error(`GET ${url} answered HTTP ${res.status}`);
  return res.json();
}

/**
 * Read every ruleset that applies to this repository, INCLUDING organization
 * rulesets inherited from above (`includes_parents`) — an org ruleset missed is
 * a required context missed, which would understate the live set and turn
 * direction B silently green.
 *
 * The listing shape carries no `rules[]`, so each entry is fetched by id. A
 * failure on any of them is an ENVIRONMENT failure, never a partial reading:
 * "some of the rulesets" cannot answer "is this context required".
 */
export async function fetchLiveRulesets({ apiUrl, repo, token }) {
  const listing = await fetchGithubJson(`${apiUrl}/repos/${repo}/rulesets?includes_parents=true&per_page=100`, token);
  if (!Array.isArray(listing)) throw new Error(`GET ${apiUrl}/repos/${repo}/rulesets did not answer a list`);
  const full = [];
  for (const entry of listing) {
    const orgSourced = entry?.source_type === 'Organization' && typeof entry.source === 'string';
    const url = orgSourced
      ? `${apiUrl}/orgs/${entry.source}/rulesets/${entry.id}`
      : `${apiUrl}/repos/${repo}/rulesets/${entry.id}`;
    full.push(await fetchGithubJson(url, token));
  }
  return full;
}

/** `--verify-required-set`. Returns the exit code; never throws past here. */
async function verifyRequiredSet(argv = process.argv.slice(2), env = process.env) {
  const ctx = requiredSetApiContext(env);
  if (!ctx.token) {
    console.error(renderRequiredSetUnverified('no GITHUB_TOKEN / GH_TOKEN in the environment'));
    return EXIT_ENVIRONMENT;
  }
  let rulesets;
  let defaultBranch = 'main';
  try {
    const repo = await fetchGithubJson(`${ctx.apiUrl}/repos/${ctx.repo}`, ctx.token);
    if (typeof repo?.default_branch === 'string' && repo.default_branch !== '') defaultBranch = repo.default_branch;
    rulesets = await fetchLiveRulesets(ctx);
  } catch (error) {
    console.error(renderRequiredSetUnverified(error.message));
    return EXIT_ENVIRONMENT;
  }
  const verdict = judgeRequiredSet({ registry: REQUIRED_CONTEXTS, rulesets, defaultBranch });
  if (argv.includes('--json')) console.log(JSON.stringify(verdict, null, 2));
  else console.log(renderRequiredSetReport(verdict));
  return EXIT_SWEPT;
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
      `\n  This gate pins the job NAMES that branch protection references. It does not itself read the required SET —\n` +
        `  that read is \`node scripts/check-required-contexts.mjs --verify-required-set\`, report-only and off the\n` +
        `  required path on purpose (#9642: the settings half of a rename is maintainer-only and lands AFTER the merge,\n` +
        `  so a blocking version would be red on the very PR carrying the repo half). The ruleset IS readable from an\n` +
        `  ordinary seat — /repos/OWNER/REPO/rulesets answers 200; it is the CLASSIC /branches/main/protection endpoint\n` +
        `  that answers 403, and this repo does not use classic branch protection. A legitimate rename is still a\n` +
        `  two-step act: the maintainer updates the required set, then this registry follows — and the instruction\n` +
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
  // Re-pointed from `console-pin` to `temporal-conformance` when #9533 dropped
  // the console-pin row: a fixture must mutate a job the registry still
  // REGISTERS, or it asserts nothing while reading exactly as before.
  const droppedJob = fixture('drop the temporal-conformance job', 'ci.yml', (s) =>
    s.replace('\n  temporal-conformance:\n', '\n  temporal-conformance-disabled:\n'),
  );
  assert(
    droppedJob.problems.some((p) => p.includes("job 'temporal-conformance' no longer exists") && p.includes('Temporal Conformance (live PG + MySQL)')),
    'a required context whose job id is gone ⇒ red',
  );

  // ── (4) growing a matrix on a registered job ──────────────────────────────
  // Re-pointed from `build-docs` for the same reason as (2) above.
  const matrixed = fixture('matrix on build-core', 'ci.yml', (s) =>
    s.replace('  build-core:\n    name: Build Core\n', '  build-core:\n    name: Build Core\n    strategy:\n      matrix:\n        shard: [1, 2]\n'),
  );
  assert(
    matrixed.problems.some((p) => p.includes("job 'build-core'") && p.includes('strategy.matrix')),
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
  // ci.yml's sharded `test` job is named `Test Core (${{ matrix.shard }}/6)`
  // and its aggregate gate is named `Test Core`. Dropping the suffix makes two
  // jobs publish one context, and the surviving conclusion is whichever
  // finished last — a shard could satisfy the aggregate's required gate.
  const collided = fixture('collide the shard name with the gate name', 'ci.yml', (s) =>
    s.replace('name: Test Core (${{ matrix.shard }}/6)', 'name: Test Core'),
  );
  assert(
    collided.problems.some((p) => p.includes("job 'test'") && p.includes("published by ci.yml:test-gate")),
    'an unregistered job wearing a registered context name ⇒ red',
  );
  // The suffixed spelling is NOT a collision — the guard must not read a
  // prefix as a clash, or ci.yml is red on main today.
  assert(
    baseline.problems.length === 0 && sources['ci.yml'].includes('name: Test Core (${{ matrix.shard }}/6)'),
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
  // budget and the replacement. Additive on purpose: no anchor into a region
  // an in-flight PR edits. The `ESLint` row's budgets have been trimmed away,
  // so the checklist tolerates ZERO occurrences and one appended mention is
  // already the red — the standing-ban state, asserted rather than described.
  const freshChecklistText = surfaceSources[CHECKLIST_SURFACE] + '\n- 入队前亲核 ESLint job 是否已绿。\n';
  const freshStale = judgeSurfaces({ files: surfaceMap({ [CHECKLIST_SURFACE]: freshChecklistText }) });
  assert(
    freshStale.problems.some(
      (p) =>
        p.includes(CHECKLIST_SURFACE) &&
        p.includes("retired required context 'ESLint'") &&
        p.includes('budgeted: 0') &&
        p.includes("'Lint & Repo Gates'"),
    ),
    'a retired name written fresh into a trimmed row\'s surface ⇒ red, naming the file, the budget and the replacement',
  );
  // …and that red is the TRIM's doing, not something the scan would say
  // anyway: the identical text under a row that still budgets 1 for this file
  // is green. Without this ablation the assertion above keeps passing on the
  // day someone restores the budget, and the standing ban would be untested.
  const budgetRestored = judgeSurfaces({
    retired: RETIRED_CONTEXT_NAMES.map((row) =>
      row.name === 'ESLint' ? { ...row, staleSites: { [CHECKLIST_SURFACE]: 1 } } : row,
    ),
    files: surfaceMap({ [CHECKLIST_SURFACE]: freshChecklistText }),
  });
  assert(
    budgetRestored.problems.length === 0,
    `restoring a budget of 1 makes the same single mention green — the red above is the trimmed budget, nothing else — got ${JSON.stringify(budgetRestored.problems)}`,
  );
  const staleInAgents = judgeSurfaces({
    files: surfaceMap({ 'AGENTS.md': surfaceSources['AGENTS.md'] + '\nConfirm the ESLint job is green before arming.\n' }),
  });
  assert(
    staleInAgents.problems.some((p) => p.includes('AGENTS.md') && p.includes("'ESLint'") && p.includes('budgeted: 0')),
    'a retired name in a zero-budget surface ⇒ red (budgets tolerate only the sites recorded at rename time)',
  );

  // The SHIPPED state of the #9325 rename, both halves of the housekeeping
  // the notices drove (#9505). The grace is closed: a checklist that reverts
  // to naming only the retired literal no longer satisfies mustName. Pinning
  // this against the REAL ledger is the point — the synthetic pair further
  // down proves the mechanism, this proves the mechanism is switched on in
  // the row that ships.
  const revertedText = '- 入队前亲核 ESLint 与 TypeScript Type Check 两个 job 的 `conclusion` 已为 `success`。\n';
  const graceClosed = judgeSurfaces({ files: surfaceMap({ [CHECKLIST_SURFACE]: revertedText }) });
  assert(
    graceClosed.problems.some(
      (p) => p.includes(CHECKLIST_SURFACE) && p.includes("'Lint & Repo Gates'") && p.includes('no longer names'),
    ),
    "the shipped ledger's grace is closed: a surface naming only 'ESLint' is red on the required literal (#9505)",
  );
  // Single-variable ablation of exactly that flip: re-open the grace on the
  // real row and change NOTHING else (the budget stays trimmed, so the
  // budget half still reds) — the NAMING red disappears. So the red above is
  // renameInFlight: false, not the trim and not the file's other content.
  const graceReopened = judgeSurfaces({
    retired: RETIRED_CONTEXT_NAMES.map((row) => (row.name === 'ESLint' ? { ...row, renameInFlight: true } : row)),
    files: surfaceMap({ [CHECKLIST_SURFACE]: revertedText }),
  });
  assert(
    !graceReopened.problems.some((p) => p.includes("'Lint & Repo Gates'") && p.includes('no longer names')),
    'flipping ONLY renameInFlight back to true clears the naming red — the red above is the flip, isolated',
  );

  // The two notices that drove this housekeeping must go SILENT once it is
  // done: a completion notice that keeps firing after the work is finished
  // trains the seat reading it to ignore the next one. Read from the real
  // ledger against the real surfaces — the same pair the pin prints.
  const shipped = judgeSurfaces();
  assert(
    !shipped.notices.some((n) => n.includes("'ESLint'") || n.includes('renameInFlight to false')),
    'after the flip and the trim, the ESLint row is silent — neither the trim notice nor the flip notice fires (#9505)',
  );
  // The notice LOGIC outlives this rename, so it keeps its coverage through a
  // synthetic in-flight row: the real ledger no longer has one, and an
  // untested notice is the next rename's silent no-op.
  const inFlightAgain = judgeSurfaces({
    retired: [{ name: 'ESLint', replacedBy: 'Lint & Repo Gates', renameInFlight: true, staleSites: { [CHECKLIST_SURFACE]: 1 } }],
  });
  assert(
    inFlightAgain.notices.some((n) => n.includes('renameInFlight to false')),
    'the flip-completion notice still fires for an in-flight row whose surfaces have all moved to the current literal',
  );
  assert(
    inFlightAgain.notices.some((n) => n.includes("'ESLint'") && n.includes('trimmed')),
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

  // ── the dispatch-gates declaration (#9979) ───────────────────────────────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or missing entry runs perfectly green here and
  // shows up only as a dev dispatched on an AGENTS.md card with this gate
  // absent from the brief — on the surface that carries `mustName` for all six
  // required contexts.
  assert(
    INSTRUCTION_SURFACES.map((s) => s.file)
      .filter((f) => !f.includes('/'))
      .every((f) => ROOT_FILE_WATCH_HINTS.includes(`${f}/**`)),
    'every separator-less instruction surface declares a root-file watch hint (#9979)',
  );
  assert(
    ROOT_FILE_WATCH_HINTS.every((h) => INSTRUCTION_SURFACES.some((s) => s.file === h.replace(/\/\*+$/, ''))),
    'and the declaration names no file this gate does not scan (#9979)',
  );
  assert(ROOT_FILE_WATCH_HINTS.join(',') === 'AGENTS.md/**', 'AGENTS.md is the root surface it declares (#9979)');
  // Provenance, never a lookup key: `scanInstructionSurfaces` opens every
  // surface `file`, so the glob form appearing there would read a missing file
  // — a hard failure here by design.
  assert(
    !INSTRUCTION_SURFACES.some((s) => ROOT_FILE_WATCH_HINTS.includes(s.file)),
    'the declared form is NOT an INSTRUCTION_SURFACES file (#9979)',
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
  // ── the live required SET (#9642): offline predicates + the measured read ──
  //
  // The live diff is report-only and deliberately never runs in CI (the
  // header's deadlock argument), so without this block its predicates would rot
  // unrun — #4690 with a network call attached. Everything below is offline:
  // synthetic rulesets for each direction, plus one frozen copy of the real
  // 2026-08-18 reading so the shape this code parses is the shape GitHub sends.
  const RULESET_SNAPSHOT = {
    id: 12119582,
    name: 'main',
    target: 'branch',
    source_type: 'Repository',
    source: 'objectstack-ai/objectstack',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'merge_queue', parameters: { merge_method: 'SQUASH', grouping_strategy: 'ALLGREEN', max_entries_to_build: 5 } },
      { type: 'pull_request', parameters: { required_approving_review_count: 0, require_code_owner_review: false } },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [
            { context: 'TypeScript Type Check', integration_id: 15368 },
            { context: 'Test Core', integration_id: 15368 },
            { context: 'Dogfood Regression Gate', integration_id: 15368 },
            { context: 'Build Core', integration_id: 15368 },
            { context: 'Temporal Conformance (live PG + MySQL)', integration_id: 15368 },
            { context: 'Lint & Repo Gates', integration_id: 15368 },
          ],
        },
      },
    ],
  };
  const judgeLive = (rulesets, registry = REQUIRED_CONTEXTS) => judgeRequiredSet({ registry, rulesets, defaultBranch: 'main' });

  {
    const snapshot = judgeLive([RULESET_SNAPSHOT]);
    assert(snapshot.live.length === 6, `the 2026-08-18 reading carries six required contexts — got ${snapshot.live.length}`);
    assert(snapshot.strict === false, 'strict_required_status_checks_policy is read, not assumed');
    assert(snapshot.enforcing.length === 1 && !snapshot.noEnforcingRuleset, 'one active ruleset covers the default branch');
    assert(snapshot.unpinned.length === 0, `every context in the 2026-08-18 reading has a registry row — got ${JSON.stringify(snapshot.unpinned)}`);
    // Direction A against the checked-in registry. It was LIVE when this was
    // written (`Build Docs` / `Console Pin Gate`, #9533) and is EMPTY since
    // that card dropped the two rows — which is exactly why the assertion is
    // written on the SHAPE (the difference is reported, and reported as
    // advisory) and not on the membership: hardcoding the pair would have
    // reddened this self-test on the very PR that resolved it. It survived
    // that resolution unchanged; leave it derived.
    const liveSet = new Set(snapshot.live);
    assert(
      snapshot.advisory.length === REQUIRED_CONTEXTS.filter((e) => !liveSet.has(e.context)).length &&
        snapshot.advisory.every((e) => !liveSet.has(e.context)),
      'direction A reports exactly the registry rows the live set does not carry',
    );
  }

  // Direction A on a synthetic pair — the row is reported, and the report says
  // ADVISORY and names #5617 rather than describing a mismatch neutrally.
  {
    const registry = [
      { workflow: 'lint.yml', job: 'lint', context: 'Kept Gate', authorized: 'fixture', carries: 'the fixture family' },
      { workflow: 'ci.yml', job: 'dropped', context: 'Dropped Gate', authorized: 'fixture', carries: 'the dropped family' },
    ];
    const verdict = judgeRequiredSet({
      registry,
      rulesets: [{ ...RULESET_SNAPSHOT, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Kept Gate' }] } }] }],
      defaultBranch: 'main',
    });
    assert(verdict.advisory.length === 1 && verdict.advisory[0].context === 'Dropped Gate', 'direction A: a registry row absent from the live set is reported');
    assert(verdict.unpinned.length === 0, 'direction A fixture reports nothing in direction B');
    const text = renderRequiredSetReport(verdict);
    assert(/ADVISORY today/.test(text) && /#5617/.test(text), 'direction A names the consequence (advisory, no signal) and #5617');
    assert(/#9533/.test(text) && /MAINTAINER decision/.test(text), 'direction A routes the remedy to the maintainer, deciding nothing itself');
  }

  // Direction B: required there, pinned by nothing here. Different remedy —
  // a registry row, not a settings change — so the report must say so.
  {
    const registry = [{ workflow: 'lint.yml', job: 'lint', context: 'Kept Gate', authorized: 'fixture', carries: 'the fixture family' }];
    const verdict = judgeRequiredSet({
      registry,
      rulesets: [
        { ...RULESET_SNAPSHOT, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Kept Gate' }, { context: 'Unpinned Gate' }] } }] },
      ],
      defaultBranch: 'main',
    });
    assert(verdict.unpinned.length === 1 && verdict.unpinned[0].context === 'Unpinned Gate', 'direction B: a live context with no registry row is reported');
    assert(verdict.advisory.length === 0, 'direction B fixture reports nothing in direction A');
    assert(/REQUIRED_CONTEXTS row/.test(renderRequiredSetReport(verdict)), 'direction B prescribes the registry row, not a settings change');
  }

  // enforcement=evaluate is a DRY RUN: it blocks nothing. Counting its contexts
  // as required would manufacture the false green this file exists to prevent —
  // so they land in the shadow set AND direction A fires for the same row.
  {
    const registry = [{ workflow: 'lint.yml', job: 'lint', context: 'Kept Gate', authorized: 'fixture', carries: 'the fixture family' }];
    const evaluating = {
      ...RULESET_SNAPSHOT,
      enforcement: 'evaluate',
      rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Kept Gate' }] } }],
    };
    const verdict = judgeRequiredSet({ registry, rulesets: [evaluating], defaultBranch: 'main' });
    assert(verdict.live.length === 0 && verdict.shadow.includes('Kept Gate'), 'an evaluate-mode ruleset contributes SHADOW contexts, never required ones');
    assert(verdict.advisory.length === 1, 'a context that is only shadow-required still reports as advisory');
    assert(/blocks NOTHING/.test(renderRequiredSetReport(verdict)), 'the report says out loud that a dry-run ruleset blocks nothing');
  }

  // A ruleset about some OTHER ref is not about the default branch.
  {
    const elsewhere = { ...RULESET_SNAPSHOT, conditions: { ref_name: { include: ['refs/heads/release/*'], exclude: [] } } };
    const verdict = judgeLive([elsewhere]);
    assert(verdict.live.length === 0 && verdict.noEnforcingRuleset, 'a ruleset scoped to another ref is not read as the default branch required set');
    assert(rulesetCoversDefaultBranch({ conditions: { ref_name: { include: ['~ALL'] } } }, 'main'), '~ALL covers the default branch');
    assert(rulesetCoversDefaultBranch({ conditions: { ref_name: { include: ['refs/heads/main'] } } }, 'main'), 'an explicit refs/heads spelling covers it');
    assert(
      !rulesetCoversDefaultBranch({ conditions: { ref_name: { include: ['~ALL'], exclude: ['~DEFAULT_BRANCH'] } } }, 'main'),
      'an explicit exclusion of the default branch wins over ~ALL',
    );
  }

  // Zero active rulesets is a READING, not an environment failure — the API
  // answered. It is also the loudest possible finding, so it must not render
  // as the clean case.
  {
    const verdict = judgeLive([]);
    const text = renderRequiredSetReport(verdict);
    assert(verdict.noEnforcingRuleset && /NO active ruleset/.test(text), 'no active ruleset covering the default branch is reported loudly');
    assert(!/✅/.test(text), 'the unprotected reading never renders as the clean case');
  }

  // The clean case, and the NOT-VERIFIED case that must never read as clean.
  {
    const registry = [{ workflow: 'lint.yml', job: 'lint', context: 'Kept Gate', authorized: 'fixture', carries: 'the fixture family' }];
    const clean = judgeRequiredSet({
      registry,
      rulesets: [{ ...RULESET_SNAPSHOT, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Kept Gate' }] } }] }],
      defaultBranch: 'main',
    });
    assert(/✅/.test(renderRequiredSetReport(clean)), 'agreement in both directions renders as the clean case');
    const unverified = renderRequiredSetUnverified('GET …/rulesets answered HTTP 502', {});
    assert(/NOT VERIFIED/.test(unverified) && !/✅/.test(unverified), 'an unreachable read prints NOT VERIFIED and never the clean mark (#4690)');
    assert(/HTTP 502/.test(unverified), 'the reason the read failed is printed, not swallowed');
    assert(!/--use-env-proxy/.test(unverified), 'the proxy hint stays silent when no proxy is configured');
    assert(
      /--use-env-proxy/.test(renderRequiredSetUnverified('HTTP 401', { HTTPS_PROXY: 'http://127.0.0.1:1' })),
      'a proxied environment without the flag is told so — concluding "unreadable" from that 401 is how #9642 happened',
    );
    assert(
      !/--use-env-proxy/.test(renderRequiredSetUnverified('HTTP 401', { HTTPS_PROXY: 'http://127.0.0.1:1', NODE_OPTIONS: '--use-env-proxy' })),
      'the hint stops once the flag is actually set',
    );
    assert(EXIT_SWEPT === 0 && EXIT_ENVIRONMENT === 2, 'a completed sweep exits 0; a non-zero exit classifies the ENVIRONMENT (check-governed-merges posture)');
  }

  // ── the live mode stays OFF the required path ────────────────────────────
  //
  // This is the assertion that keeps #9642's whole trade honest. The moment
  // `--verify-required-set` is wired into a step of a job that publishes a
  // required context, this gate can redden on a GitHub blip — and, worse, it
  // reddens on the very PR that carries the repo half of a rename, deadlocking
  // the two-step. Wiring it is a maintainer decision, and it goes red HERE
  // first rather than silently in the queue.
  {
    const uncommentedYaml = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const [file, text] of Object.entries(sources)) {
      assert(
        !/--verify-required-set/.test(uncommentedYaml(text)),
        `wiring: ${file} must not RUN the live required-set read — report-only, off the required path (#9642)`,
      );
    }
    const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert(
      !Object.values(pkgJson.scripts ?? {}).some((s) => typeof s === 'string' && s.includes('--verify-required-set')),
      'wiring: no package script runs the live read — a `check:*` script is how a thing reaches the required job (#9642)',
    );

    // ── …and the standing caller it DOES have (#9678) ─────────────────────
    //
    // The two assertions above are absences, and an absence cannot tell "kept
    // deliberately off the required path" apart from "wired nowhere at all" —
    // which is what this mode actually was for its whole first life: a sweep
    // whose only scheduled caller was its own offline self-test. So the caller
    // is pinned as a PRESENCE too, in the same block, and the whole
    // .github/workflows tree is swept rather than the two files `sources`
    // carries: a second caller appearing in some third workflow is exactly the
    // thing the absences above are guarding against, and they cannot see it.
    const workflowDir = join(root, '.github', 'workflows');
    const callers = readdirSync(workflowDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .filter((f) => /--verify-required-set/.test(uncommentedYaml(readFileSync(join(workflowDir, f), 'utf8'))));
    assert(
      callers.join(',') === PATROL_WORKFLOW,
      `wiring: exactly one workflow runs the live read and it is ${PATROL_WORKFLOW} — found [${callers.join(', ')}] (#9678)`,
    );

    // Read defensively and turn "missing" into a NAMED assertion rather than an
    // uncaught ENOENT. Measured under reverse verification: deleting the patrol
    // made this block throw mid-self-test, so the `callers` failure above was
    // recorded and never printed and every later assertion never ran — a stack
    // trace where the gate's own authored verdict belongs (#4690's family). The
    // downstream cases each carry `patrolPresent` for the same reason: on an
    // absent file `!/merge_group/` is vacuously true, which is a false green
    // about a workflow that does not exist.
    const patrolPath = join(workflowDir, PATROL_WORKFLOW);
    const patrolPresent = existsSync(patrolPath);
    assert(patrolPresent, `wiring: the standing caller .github/workflows/${PATROL_WORKFLOW} is missing — the live mode is wired nowhere again (#9678)`);
    const patrolYaml = patrolPresent ? uncommentedYaml(readFileSync(patrolPath, 'utf8')) : '';
    // The mechanical proxy for "never required". Assertion 6 of this pin is
    // that every required context's workflow carries `merge_group:` — without
    // one, the queue build never produces the context and the whole queue
    // stalls waiting for it. A patrol that declares no merge_group trigger
    // therefore CANNOT be validly required-ized, and required-izing it anyway
    // wedges the queue rather than deadlocking a rename two-step quietly.
    assert(
      patrolPresent && !/^\s{0,4}merge_group\s*:/m.test(patrolYaml),
      `wiring: ${PATROL_WORKFLOW} must declare no merge_group trigger — a workflow without one deadlocks the queue if it is ever required-ized (#9678)`,
    );
    assert(
      !REQUIRED_CONTEXTS.some((entry) => entry.workflow === PATROL_WORKFLOW),
      `wiring: no REQUIRED_CONTEXTS row may name ${PATROL_WORKFLOW} — the patrol is report-only by construction (#9678)`,
    );
    // The patrol reads its drift signal out of the CLEAN MARK this file
    // renders, so the coupling is pinned from the side that owns the string.
    // The rendering itself is pinned in both directions above ('agreement in
    // both directions renders as the clean case' / 'the unprotected reading
    // never renders as the clean case'); this asserts the caller still reads
    // the same character. A rendering change costs the patrol a FALSE ALARM,
    // never a false all-clear — it annotates on the mark's ABSENCE.
    assert(
      patrolPresent && patrolYaml.includes(REQUIRED_SET_CLEAN_MARK),
      `wiring: ${PATROL_WORKFLOW} must key its drift annotation on the clean mark ${REQUIRED_SET_CLEAN_MARK} this file renders (#9678)`,
    );
  }

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
    // The pin runs in a job that publishes a REQUIRED context. A network call
    // reached from here would make that context able to redden on a GitHub
    // outage, for reasons unrelated to any diff — and would re-create the
    // two-step deadlock the live mode is report-only to avoid (#9642).
    assert(
      !/\bfetch\(|verifyRequiredSet\(|fetchLiveRulesets\(/.test(mainBody),
      'wiring: the pin (main) stays network-free — the live required-set read is report-only and off the required path (#9642)',
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
      `the \`carries\` step-count ban + the instruction-surface stale-name scan (#9491) + ` +
      `the live required-set diff and its off-the-required-path wiring (#9642) + the #4690 pins).`,
  );
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (process.argv.includes('--verify-required-set')) {
  // Report-only, off the required path (#9642). Exit 0 = swept (0 or N
  // disagreements); exit 2 = the live set could not be read (ENVIRONMENT).
  process.exitCode = await verifyRequiredSet();
} else {
  await main();
}
