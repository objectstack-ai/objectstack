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
 * with its ESLint job red for 19 minutes, because the job carrying 25 `check:*`
 * gates was not in the required set at all. Four more merges repeated it that
 * night (#6067/#6096/#6051/#6103) before the settings were fixed on
 * 2026-08-07.
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
 *      `paths-ignore:`. A path-filtered trigger produces NO check run on a PR
 *      that misses the glob — not a skip, an absence — which is permanent
 *      pending (the audit's `Spec property liveness` exclusion).
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
 */
export const REQUIRED_CONTEXTS = [
  {
    workflow: 'lint.yml',
    job: 'lint',
    context: 'ESLint',
    authorized: '#5617 maintainer ruling 2026-08-07 — applied to the settings the same day',
    carries: 'the whole check:* gate family (25 steps) — the job whose red did not block #5584',
  },
  {
    workflow: 'lint.yml',
    job: 'typecheck',
    context: 'TypeScript Type Check',
    authorized: '#5617 maintainer ruling 2026-08-07 — applied to the settings the same day',
    carries: 'the type-check + generated-artifact gate family (33 steps)',
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
  {
    workflow: 'adr-merge-approval.yml',
    job: 'adr-merge-approval',
    context: 'ADR maintainer approval',
    authorized: '#7022 maintainer settings action, confirmed to the devx PM seat 2026-08-10 ~02:3xZ (screenshot of the `main` ruleset)',
    carries: 'the #6741 ruling that only the maintainer own-account approval may land a docs/adr/** merge (#6942/#6962 landed unapproved while this context sat outside the required set)',
  },
];

/** Repository root, resolved from this file rather than from the cwd. */
function scriptRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

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

/** The pin. */
async function main() {
  const { problems, pinned } = await scanWorkflows(scriptRepoRoot());
  if (problems.length > 0) {
    console.error(`✗ check-required-contexts — ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error(
      `\n  This gate pins the job NAMES that branch protection references. It cannot read the required set itself\n` +
        `  (Settings → Rulesets is maintainer-only; the API answers 403 to every agent seat), so a legitimate rename\n` +
        `  is a two-step act: the maintainer updates the required set, then this registry follows.\n`,
    );
    process.exit(1);
  }
  const files = new Set(REQUIRED_CONTEXTS.map((entry) => entry.workflow)).size;
  console.log(`✓ check-required-contexts: ${pinned.length} required context name(s) pinned across ${files} workflow(s).`);
  for (const line of pinned) console.log(`    ${line}`);
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
    'adr-merge-approval.yml': readFileSync(join(root, '.github', 'workflows', 'adr-merge-approval.yml'), 'utf8'),
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
  const renamedEslint = fixture('rename ESLint', 'lint.yml', (s) => s.replace('    name: ESLint\n', '    name: ESLint (fast)\n'));
  assert(
    renamedEslint.problems.some((p) => p.includes("job 'lint'") && p.includes('"ESLint (fast)"') && p.includes("'ESLint'") && p.includes('The name IS the contract')),
    "renaming lint.yml's ESLint job ⇒ red, naming the job, the new name and the required context",
  );
  assert(renamedEslint.problems.length === 1, `renaming ESLint produces exactly the one finding — got ${JSON.stringify(renamedEslint.problems)}`);

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

  // The #7022 addition: a third workflow file, registered for the first time.
  // Same reverse-verification shape as the ESLint/Build Core renames above —
  // a pin that has never been exercised for its own entry is exactly the
  // "registered but nothing checks it" gap this script exists to close.
  const renamedAdrApproval = fixture('rename ADR maintainer approval', 'adr-merge-approval.yml', (s) =>
    s.replace('    name: ADR maintainer approval\n', '    name: ADR Merge Approval\n'),
  );
  assert(
    renamedAdrApproval.problems.some(
      (p) => p.includes("job 'adr-merge-approval'") && p.includes('"ADR Merge Approval"') && p.includes("'ADR maintainer approval'"),
    ),
    'renaming adr-merge-approval.yml\'s job ⇒ red, naming the job, the new name and the required context (#7022)',
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
    noQueue.problems.some((p) => p.includes('merge_group') && p.includes('ESLint') && p.includes('TypeScript Type Check')),
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
      'wiring: lint.yml\'s ESLint job must run `pnpm check:required-contexts` — an unwired pin verifies nothing (#4690)',
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
    // renaming the ESLint job turns this gate red under the NEW name, while the
    // old required context stops reporting — the PR is blocked from both sides.
    assert(
      REQUIRED_CONTEXTS.some((entry) => entry.workflow === 'lint.yml' && entry.job === 'lint'),
      'wiring: the job this gate runs in is itself registered, so a rename of it cannot be the one rename nothing notices',
    );
  }

  if (failures.length > 0) {
    console.error(`✗ check-required-contexts --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-required-contexts --self-test: ${checked} assertions ` +
      `(rename ablations across both workflows + matrix/continue-on-error/trigger shapes + the shard-name collision + the #4690 pins).`,
  );
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  await main();
}
