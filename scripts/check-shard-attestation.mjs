#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shard positive-attestation gate (#6082) — an aggregate gate COUNTS
 * credentials; it does not scan the aggregate reading for bad words.
 *
 *   node scripts/check-shard-attestation.mjs               # static drift guard (lint)
 *   node scripts/check-shard-attestation.mjs --self-test   # verify the checker itself
 *   node scripts/check-shard-attestation.mjs --emit  …     # a shard publishes its credential
 *   node scripts/check-shard-attestation.mjs --verify …    # a gate counts the credentials
 *
 * ## The defect this replaces
 *
 * `test-gate` / `dogfood-gate` in ci.yml used to decide from ONE datum: the
 * matrix job's aggregate `needs.<job>.result`, passed when it read
 * `success|skipped|cancelled` and failed on everything else. That is an
 * ABSENCE-OF-NEGATIVE test, and it has two measured defects (#6082):
 *
 *   1. `abandoned` — an undocumented runner value for "this job was discarded
 *      and never dispatched to a runner" (runner_id 0, `steps` absent, zero
 *      tests executed). It is not one of the four documented `needs.*.result`
 *      values, so it landed in the `*)` fallthrough. Run 31120902911 painted a
 *      false red on a run with zero test failures, and the queue evicted #6010
 *      31 seconds later. The tempting fix — whitelist `abandoned` — was
 *      REJECTED by the maintainer (2026-08-07), because the discarded job is
 *      NOT moot: the queue was still consuming that run's verdicts, so passing
 *      it would publish `Test Core: success` over zero test runs — precisely
 *      the shape #4928 exists to block.
 *
 *   2. The wider one, which is why counting had to replace whitelisting: the
 *      aggregate reading can SWALLOW A REAL FAILURE. Run 31114735713 has shard
 *      `Test Core (3/3)` at job-level `conclusion: failure`, while the very
 *      same run's aggregate gate read `abandoned`. One datum cannot carry three
 *      shards' verdicts, so any lifecycle value in it hides whatever the
 *      siblings actually concluded. Under whitelisting-by-word that hole is one
 *      word away from live ammunition; under counting it cannot exist, because
 *      a failed shard publishes no credential and the count comes up short.
 *
 * ## What replaces it: declared = enforced, counted positively
 *
 * Every real shard job ends with two steps that carry no `if:` — so they run
 * only when EVERY preceding step of that job succeeded, and nothing runs after
 * them that could later turn the job red without also invalidating them:
 *
 *   `--emit` writes `<job>-<shard>-of-<total>.json` ("I ran and I passed"),
 *   `actions/upload-artifact` publishes it as `shard-attest-<job>-<n>-of-<N>`.
 *
 * The gate downloads every matching artifact of ITS OWN RUN and requires the
 * attested set to equal the DECLARED roster. A shard that was never scheduled
 * publishes nothing, so it cannot be counted — which is exactly the property
 * asked for: no attestation, no pass.
 *
 * Artifacts, not job `outputs`, deliberately. GitHub documents matrix job
 * outputs as OVERWRITING each other (the map a consumer sees is the last leg to
 * finish), so `needs.<job>.outputs.*` structurally cannot carry three legs'
 * credentials — and building this gate on the undocumented "an empty value does
 * not clobber" merge behaviour would repeat the exact mistake #6082 is about:
 * resting a merge decision on an unspecified runner detail. Same-run artifact
 * download needs no permission beyond the job's existing `contents: read`
 * (`actions: read` is required only for cross-run/cross-repo downloads), so the
 * gates keep their permission block. `actions/cache` was the other per-leg
 * channel and is rejected on this repo's own grounds: the 10 GB pool is
 * carefully rationed (see "Restore Turbo cache" in ci.yml — PR-side saves
 * evicting main's turbo seeds is a measured incident).
 *
 * ## What is deliberately NOT changed
 *
 *   - `cancelled` still passes without counting (#3668). Cancellation is a
 *     run-lifecycle state: with cancel-in-progress on, every superseded push
 *     cancels the in-flight matrix, and #3668 measured (run 30271824408) that a
 *     real shard failure DOMINATES the aggregate over a cancelled sibling — it
 *     reads `failure`, never `cancelled`. So `cancelled` masks no regression,
 *     and demanding credentials there would paint the false red on the
 *     superseded SHA that #3668 removed.
 *   - `skipped` still passes ONLY when the `filter` job itself succeeded
 *     (#4928). `skipped` alone cannot separate "the path filter said no core
 *     paths changed" from "the path filter exploded and took every downstream
 *     job with it", and the second published a green Test Core over zero test
 *     runs. Expected-N is 0 in exactly that case — the roster adjusts, the
 *     guard does not move.
 *   - The gates keep `if: always()` and their `name:`. Both are contracts:
 *     branch protection requires the bare `Test Core` / `Dogfood Regression
 *     Gate` contexts, and a gate that skips publishes no context at all, which
 *     is the #3622 repo-wide merge deadlock.
 *
 * ## Why a declared negative is still a veto
 *
 * Counting is necessary but not sufficient. A leg can publish its credential
 * and only afterwards be marked `failure` by a post-step (a cache save's post
 * action, say). So a leg whose aggregate result is `failure` fails the gate
 * even with a full roster. Every OTHER value — `success`, `abandoned`, and
 * whatever the runner leaks next — is decided purely by the count, which is
 * what makes this robust to the next undocumented lifecycle value instead of
 * needing another word added to a list.
 *
 * ## How the static guard decides what a job IS (#6589)
 *
 * `scanWorkflow` has to tell an aggregate GATE (`… --verify …`) from an
 * attesting SHARD (`… --emit …`), and both answers are read out of the same
 * place: the jobs' `run:` text. That classification is by INVOCATION —
 * `invokesScript()` requires the flag to be an argument of a command that runs
 * this script — and never by two substrings co-occurring somewhere in a job.
 *
 * The co-occurrence spelling was live and measured wrong (#6589). Every
 * attesting shard job already contains the string `check-shard-attestation.mjs`
 * (its own `--emit` step at the bottom), so under `text.includes(BASENAME) &&
 * text.includes('--verify')` the sole discriminator was the bare flag substring
 * appearing ANYWHERE in ANY step of that job. Adding a `git rev-parse --verify`
 * to the shard's package-set step reclassified job `test` as a gate and the
 * guard failed with two complaints about properties of a gate that job is not
 * required to have — pointing the reader at #3622/#4928 contracts to break.
 * Whole `--verify`-shaped family: `git show-ref --verify`, `gpg --verify`, …
 *
 * The classifier therefore also drops shell comments, because DOCUMENTING this
 * trap inside a `run:` re-armed it — a comment is part of `run:` (the #4890
 * shape). Making that safe by construction is the point: the self-test's
 * `--verify`-in-a-comment fixture is the pin.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Artifact-name prefix shared by every shard credential. */
const ARTIFACT_PREFIX = 'shard-attest-';

/** The gate jobs that carry a branch-protection-required context. */
const REQUIRED_GATE_JOBS = ['test-gate', 'dogfood-gate'];

const SCRIPT_BASENAME = 'check-shard-attestation.mjs';

/** Repository root, resolved from this file rather than from the cwd. */
function scriptRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

// ── The credential ──────────────────────────────────────────────────────────

/** The attestation id (and file stem) for one leg of one job. */
export function attestationId(job, shard, total) {
  return `${job}-${shard}-of-${total}`;
}

/** The artifact name a shard publishes its credential under. */
export function artifactName(job, shard, total) {
  return `${ARTIFACT_PREFIX}${attestationId(job, shard, total)}`;
}

/** Every attestation id a leg is required to produce when it actually runs. */
function rosterFor(job, total) {
  return Array.from({ length: total }, (_, i) => attestationId(job, i + 1, total));
}

// ── The verdict, as a pure function ─────────────────────────────────────────

/**
 * Judge one gate from its legs' declared rosters and the credentials on disk.
 *
 * Pure: every input is an argument, so --self-test exercises the real decision
 * and not a parallel imitation of it.
 *
 * @param {{
 *   gate: string,
 *   legs: { job: string, total: number, result: string }[],
 *   filterResult: string,
 *   present: Map<string, Record<string, unknown>>,
 *   runId: string,
 *   downloadOutcome?: string,
 * }} input
 * @returns {{ ok: boolean, log: string[], errors: string[] }}
 */
export function judge({ gate, legs, filterResult, present, runId, downloadOutcome }) {
  const log = [];
  const errors = [];
  const allowed = new Set();
  let counted = 0;

  log.push(`${gate}: counting per-shard positive attestations (#6082), not absence of negatives.`);
  log.push(`  filter job result: ${filterResult || '(unreadable)'}`);
  if (downloadOutcome && downloadOutcome !== 'success') {
    log.push(`  NOTE: the attestation download step itself did not succeed (outcome: ${downloadOutcome}).`);
  }

  // A gate with no legs has verified nothing; reporting OK for it is #4690's
  // defect. Same for a leg whose result did not interpolate.
  if (legs.length === 0) {
    errors.push(`${gate}: no legs were declared — the gate cannot verify anything (see #4690).`);
  }

  for (const leg of legs) {
    const roster = rosterFor(leg.job, leg.total);
    const label = leg.total > 1 ? `${leg.job} (declared roster 1..${leg.total}/${leg.total})` : `${leg.job} (single leg)`;

    if (!leg.result) {
      errors.push(`${gate}: leg ${leg.job} has an empty aggregate result — refusing to guess (see #4690).`);
      for (const id of roster) allowed.add(id);
      continue;
    }

    log.push(`  leg ${label} — aggregate result: ${leg.result}`);

    if (leg.result === 'cancelled') {
      // #3668: a run-lifecycle state, not a shard verdict. Legs that finished
      // before the cancellation may legitimately have attested, so their
      // credentials are ALLOWED but none are REQUIRED.
      for (const id of roster) allowed.add(id);
      log.push(`    satisfied (cancelled — run-lifecycle state, #3668; expected attestations: 0)`);
      continue;
    }

    if (leg.result === 'skipped') {
      if (filterResult === 'cancelled') {
        for (const id of roster) allowed.add(id);
        log.push(`    satisfied (skipped while the run was cancelled — #3668; expected attestations: 0)`);
        continue;
      }
      if (filterResult !== 'success') {
        errors.push(
          `${gate}: leg ${leg.job} was skipped while the filter job did not succeed (filter result: ${filterResult}). ` +
            `Refusing to report a pass over zero runs — see #4928.`,
        );
        continue;
      }
      // Expected-N adjusts to 0: the filter legitimately said this family has
      // nothing to run. Nothing is allowed either — a credential here would
      // contradict the skip.
      log.push(`    satisfied (skipped by the filter — #4928; expected attestations: 0)`);
      continue;
    }

    for (const id of roster) allowed.add(id);
    const missing = roster.filter((id) => !present.has(id));
    for (const id of roster) {
      const record = present.get(id);
      log.push(record ? `    + ${id}  (run ${record.run_id}, attempt ${record.run_attempt})` : `    - ${id}  MISSING`);
    }
    log.push(`    attested ${roster.length - missing.length} / ${roster.length} declared shard(s)`);

    counted += roster.length;
    if (missing.length > 0) {
      errors.push(
        `${gate}: ${missing.length} of ${roster.length} declared shard(s) of ${leg.job} published no positive attestation ` +
          `(${missing.join(', ')}). A shard that never ran cannot be counted as passing — see #6082.`,
      );
    }
    if (leg.result === 'failure') {
      // Declared negative: a leg can attest and only then be failed by a post
      // step. Counting is necessary, not sufficient.
      errors.push(`${gate}: leg ${leg.job} reported result 'failure' — a declared negative is never overridden by a full roster.`);
    }
  }

  // Foreign or stale credentials: the run must not be judged on someone else's.
  for (const [id, record] of present) {
    if (!allowed.has(id)) {
      errors.push(`${gate}: unexpected attestation '${id}' that no declared leg accounts for.`);
      continue;
    }
    if (runId && record.run_id !== undefined && String(record.run_id) !== String(runId)) {
      errors.push(`${gate}: attestation '${id}' belongs to run ${record.run_id}, not this run (${runId}).`);
    }
    if (record.attestation !== attestationId(String(record.job), record.shard, record.total)) {
      errors.push(`${gate}: attestation '${id}' does not describe itself consistently (payload: ${JSON.stringify(record)}).`);
    }
  }

  if (errors.length === 0) {
    log.push(
      counted > 0
        ? `${gate}: satisfied — all ${counted} declared shard(s) published a positive attestation.`
        : `${gate}: satisfied — no shard was expected to run, and none claimed to.`,
    );
  }
  return { ok: errors.length === 0, log, errors };
}

// ── Reading the credentials off disk ────────────────────────────────────────

/**
 * Every attestation in `dir`, keyed by id. A missing directory is zero
 * attestations, not an error: the legitimate filter-skipped run downloads
 * nothing at all.
 *
 * @param {string} dir
 * @returns {{ present: Map<string, Record<string, unknown>>, problems: string[] }}
 */
export function readAttestations(dir) {
  const present = new Map();
  const problems = [];
  if (!existsSync(dir)) return { present, problems };
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -'.json'.length);
    try {
      const record = JSON.parse(readFileSync(join(dir, entry), 'utf8'));
      present.set(id, record);
    } catch (error) {
      problems.push(`attestation '${entry}' is not readable JSON: ${error.message}`);
    }
  }
  return { present, problems };
}

// ── The static drift guard: the gate's roster IS the declared matrix ────────

/** `--leg <job>/<total>:<result>` as the gate spells it. */
const LEG_TOKEN = /--leg\s+['"]?([A-Za-z0-9_-]+)\/(\d+):/g;

/**
 * One `run:` block, split into the individual commands a shell would execute.
 *
 * Three properties, each of which the classification below rests on:
 *
 *   - a backslash-newline continuation JOINS its lines into one command, so a
 *     flag written on a continuation line is still an argument of the command
 *     that started two lines up (which is how both invocations in ci.yml are
 *     actually spelled);
 *   - a `#` comment is DROPPED, so writing about this classifier inside a
 *     `run:` cannot re-trigger it (#6589's second-order trap);
 *   - quoting is honoured, so a `#` or a `|` inside an argument stays an
 *     argument rather than silently truncating the command — a false negative
 *     here would disable the gate quietly, which is the one outcome worse than
 *     the false positive #6589 is about.
 *
 * Deliberately a small lexer and not a shell: it recognises comments, quotes,
 * continuations and the separators `; & && | ||` plus newline. Anything more
 * exotic in a `run:` block (heredocs, process substitution) can only make a
 * command look like fewer commands, never like more, so it cannot manufacture
 * a classification.
 *
 * @param {unknown} runText a step's `run:` string
 * @returns {string[]} the commands, in order, comments and separators removed
 */
export function shellCommands(runText) {
  if (typeof runText !== 'string') return [];
  const commands = [];
  let current = '';
  let quote = '';
  let atWordStart = true;
  const flush = () => {
    const command = current.trim();
    if (command) commands.push(command);
    current = '';
    atWordStart = true;
  };
  for (let i = 0; i < runText.length; i += 1) {
    const ch = runText[i];
    if (quote) {
      // Inside single quotes a backslash is literal; inside double quotes it
      // escapes the next character. Either way the pair stays in the argument.
      if (ch === '\\' && quote === '"' && i + 1 < runText.length) {
        current += ch + runText[i + 1];
        i += 1;
        continue;
      }
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\\') {
      if (runText[i + 1] === '\n') {
        current += ' ';
        i += 1;
        atWordStart = true;
        continue;
      }
      if (i + 1 < runText.length) {
        current += ch + runText[i + 1];
        i += 1;
        atWordStart = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '#' && atWordStart) {
      while (i < runText.length && runText[i] !== '\n') i += 1;
      flush();
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|') {
      flush();
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      atWordStart = false;
      continue;
    }
    current += ch;
    atWordStart = ch === ' ' || ch === '\t';
  }
  flush();
  return commands;
}

/**
 * Does this `run:` text INVOKE this script with `flag`?
 *
 * Adjacency, not co-occurrence (#6589): the flag must be an argument of a
 * command that runs `SCRIPT_BASENAME`. The script named in one step and the
 * flag spelled in another — or in a comment, or as an argument of some other
 * program entirely — no longer add up to an invocation.
 *
 * @param {unknown} runText a step's `run:` string
 * @param {string} flag e.g. `--verify` or `--emit`
 */
export function invokesScript(runText, flag) {
  return shellCommands(runText).some((command) => {
    const tokens = command.split(/\s+/).map((token) => token.replace(/^['"]|['"]$/g, ''));
    const at = tokens.findIndex((token) => token === SCRIPT_BASENAME || token.endsWith(`/${SCRIPT_BASENAME}`));
    if (at === -1) return false;
    return tokens.slice(at + 1).some((token) => token === flag || token.startsWith(`${flag}=`));
  });
}

/**
 * Scan `.github/workflows/ci.yml` and hold the gates to their own declaration.
 *
 * The whole point of "declared = enforced" is that the roster the gate counts
 * against cannot drift from the matrix the shards actually run. GitHub gives no
 * way to share one literal between `strategy.matrix` and a downstream job's
 * step (the `env` context is not available in `strategy`), so the two literals
 * are reconciled HERE instead of being remembered.
 *
 * Missing input is a failure, never a pass (#4690): no workflow file, no gate,
 * an unparseable document — every one of them is a problem, because a scan that
 * reads nothing is indistinguishable from a scan that found nothing wrong.
 *
 * @param {string} root repository root (or a fixture root in --self-test)
 * @returns {Promise<{ problems: string[], gates: number, legs: number, attesters: number }>}
 */
export async function scanWorkflow(root) {
  const { parse } = await import('yaml');
  const problems = [];
  const file = join(root, '.github', 'workflows', 'ci.yml');
  if (!existsSync(file)) {
    return { problems: [`${file} does not exist — nothing was verified (see #4690).`], gates: 0, legs: 0, attesters: 0, gateIds: [], attesterIds: [] };
  }

  let doc;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { problems: [`${file} does not parse as YAML: ${error.message}`], gates: 0, legs: 0, attesters: 0, gateIds: [], attesterIds: [] };
  }
  const jobs = doc && typeof doc === 'object' ? doc.jobs : undefined;
  if (!jobs || typeof jobs !== 'object') {
    return { problems: [`${file} has no jobs: map — nothing was verified (see #4690).`], gates: 0, legs: 0, attesters: 0, gateIds: [], attesterIds: [] };
  }

  const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps : []);
  const runTextOf = (job) =>
    stepsOf(job)
      .map((step) => (typeof step?.run === 'string' ? step.run : ''))
      .join('\n');
  /**
   * Does any single step of this job invoke this script with `flag`?
   *
   * Per STEP, never over the job's joined text: two steps' texts concatenated
   * are not a command, and treating them as one is exactly #6589.
   */
  const jobInvokes = (job, flag) => stepsOf(job).some((step) => invokesScript(step?.run, flag));

  /** The shard count a job DECLARES: a matrix's length, or 1 for a single job. */
  const declaredTotal = (job) => {
    const shard = job?.strategy?.matrix?.shard;
    if (shard === undefined) return 1;
    return Array.isArray(shard) ? shard.length : NaN;
  };

  const gates = new Map();
  const claimed = new Map();
  for (const [id, job] of Object.entries(jobs)) {
    if (!jobInvokes(job, '--verify')) continue;
    const text = runTextOf(job);
    const legs = [...text.matchAll(LEG_TOKEN)].map((m) => ({ job: m[1], total: Number(m[2]) }));
    gates.set(id, legs);
    if (job.if !== 'always()') {
      problems.push(`job '${id}' is an aggregate gate but its job-level if: is ${JSON.stringify(job.if)}, not always() — a gate that skips publishes no required context (#3622).`);
    }
    const needs = Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
    if (!needs.includes('filter')) {
      problems.push(`gate '${id}' does not list 'filter' in needs:, so it cannot apply the #4928 skipped-only-when-filter-succeeded guard.`);
    }
    const patterns = stepsOf(job)
      .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/download-artifact@'))
      .map((step) => String(step?.with?.pattern ?? ''));
    if (patterns.length === 0) {
      problems.push(`gate '${id}' never downloads the shard attestations it claims to count.`);
    }

    for (const leg of legs) {
      const target = jobs[leg.job];
      if (!target) {
        problems.push(`gate '${id}' counts a leg '${leg.job}' that is not a job in this workflow.`);
        continue;
      }
      if (claimed.has(leg.job)) {
        problems.push(`job '${leg.job}' is counted by both '${claimed.get(leg.job)}' and '${id}' — one attesting job, one gate.`);
      }
      claimed.set(leg.job, id);
      if (!needs.includes(leg.job)) {
        problems.push(`gate '${id}' counts leg '${leg.job}' but does not list it in needs:, so it cannot read its result.`);
      }
      const total = declaredTotal(target);
      if (!Number.isInteger(total)) {
        problems.push(`job '${leg.job}' declares a strategy.matrix.shard that is not a list — the roster cannot be derived.`);
        continue;
      }
      if (total !== leg.total) {
        problems.push(
          `gate '${id}' expects ${leg.total} attestation(s) from '${leg.job}', which declares ${total} shard(s). ` +
            `Change the matrix and the gate's --leg together, or the gate counts against a roster that no longer exists (#6082).`,
        );
      }
      // The credential must mean "every step of this job passed": emit + upload
      // are the LAST two steps and neither may carry an `if:`.
      const steps = stepsOf(target);
      const [emit, upload] = steps.slice(-2);
      const emitsHere = invokesScript(emit?.run, '--emit');
      const uploadsHere = typeof upload?.uses === 'string' && upload.uses.startsWith('actions/upload-artifact@');
      if (!emitsHere || !uploadsHere) {
        problems.push(
          `job '${leg.job}' must END with the attestation pair (${SCRIPT_BASENAME} --emit, then actions/upload-artifact). ` +
            `Anything after them can fail the job while its credential already counts as a pass (#6082).`,
        );
        continue;
      }
      if (emit.if !== undefined || upload.if !== undefined) {
        problems.push(`job '${leg.job}' guards its attestation steps with an if: — the credential must mean "every earlier step succeeded", which only an unguarded step says (#6082).`);
      }
      const declaredName = String(upload?.with?.name ?? '');
      if (!declaredName.startsWith(`${ARTIFACT_PREFIX}${leg.job}-`) || !declaredName.endsWith(`-of-${leg.total}`)) {
        problems.push(
          `job '${leg.job}' uploads its attestation as '${declaredName}', which the gate cannot count — it must read ` +
            `'${ARTIFACT_PREFIX}${leg.job}-<shard>-of-${leg.total}'.`,
        );
      }
      if (!patterns.some((p) => p.endsWith('*') && declaredName.startsWith(p.slice(0, -1)))) {
        problems.push(`gate '${id}' downloads pattern(s) ${JSON.stringify(patterns)}, none of which matches '${declaredName}'.`);
      }
    }
  }

  for (const required of REQUIRED_GATE_JOBS) {
    if (!gates.has(required)) {
      problems.push(`job '${required}' carries a branch-protection-required context but no longer counts shard attestations (#6082/#3622).`);
    }
  }
  // Any job that publishes a credential must be counted by exactly one gate,
  // or the credential is decoration. Same invocation test as the gate side and
  // as `emitsHere` above (#6589): the question is "does this job publish a
  // credential the way the pair check requires", and a bare `--emit` substring
  // — `esbuild --emit`, a comment — does not answer it.
  for (const [id, job] of Object.entries(jobs)) {
    if (jobInvokes(job, '--emit') && !claimed.has(id)) {
      problems.push(`job '${id}' publishes an attestation that no gate counts — declared but not enforced.`);
    }
  }

  const legs = [...gates.values()].reduce((n, l) => n + l.length, 0);
  // `gateIds` / `attesterIds` are the CLASSIFICATION itself, reported so a test
  // can assert what a job was taken for instead of inferring it from the
  // absence of a problem — #6589's misclassification produced problems that
  // named neither the classifier nor the flag.
  return { problems, gates: gates.size, legs, attesters: claimed.size, gateIds: [...gates.keys()], attesterIds: [...claimed.keys()] };
}

// ── Modes ───────────────────────────────────────────────────────────────────

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function argValues(flag) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === flag && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  return out;
}

/** A shard publishes its credential. */
function emit() {
  const job = argValue('--job');
  const shard = Number(argValue('--shard'));
  const total = Number(argValue('--total'));
  const out = argValue('--out');
  if (!job || !Number.isInteger(shard) || !Number.isInteger(total) || !out) {
    console.error(`::error::${SCRIPT_BASENAME} --emit needs --job <id> --shard <n> --total <n> --out <dir>`);
    process.exit(1);
  }
  const id = attestationId(job, shard, total);
  const payload = {
    attestation: id,
    job,
    shard,
    total,
    run_id: process.env.GITHUB_RUN_ID ?? '',
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
    sha: process.env.GITHUB_SHA ?? '',
    workflow_job: process.env.GITHUB_JOB ?? '',
    attested_at: new Date().toISOString(),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Attested: ${id} ran to completion with every step green (run ${payload.run_id}, attempt ${payload.run_attempt}).`);
}

/** A gate counts the credentials. */
function verify() {
  const gate = argValue('--gate', 'gate');
  const dir = argValue('--dir');
  if (!dir) {
    console.error(`::error::${SCRIPT_BASENAME} --verify needs --dir <attestation dir>`);
    process.exit(1);
  }
  const legs = argValues('--leg').map((token) => {
    const at = token.indexOf(':');
    const [job, total] = (at === -1 ? token : token.slice(0, at)).split('/');
    return { job, total: Number(total), result: at === -1 ? '' : token.slice(at + 1).trim() };
  });
  const { present, problems } = readAttestations(dir);
  const verdict = judge({
    gate,
    legs,
    filterResult: argValue('--filter-result', ''),
    present,
    runId: process.env.GITHUB_RUN_ID ?? '',
    downloadOutcome: argValue('--download-outcome', ''),
  });
  for (const line of verdict.log) console.log(line);
  const errors = [...problems.map((p) => `${gate}: ${p}`), ...verdict.errors];
  if (errors.length > 0) {
    for (const error of errors) console.log(`::error::${error}`);
    process.exit(1);
  }
}

/** The static drift guard. */
async function main() {
  const { problems, gates, legs, attesters } = await scanWorkflow(scriptRepoRoot());
  if (problems.length > 0) {
    console.error(`✗ check-shard-attestation — ${problems.length} problem(s) in .github/workflows/ci.yml\n`);
    for (const problem of problems) console.error(`  • ${problem}`);
    process.exit(1);
  }
  console.log(`✓ check-shard-attestation: ${gates} aggregate gate(s) count ${legs} declared leg(s) across ${attesters} attesting job(s).`);
}

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * The dominance experiment, in the shape #3668 set for `cancelled` — run as
 * fixtures because a dev cannot fabricate a real runner-starved CI run.
 */
async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, description) => {
    checked += 1;
    if (!condition) failures.push(description);
  };

  const attest = (job, shard, total, runId = '99') =>
    [attestationId(job, shard, total), { attestation: attestationId(job, shard, total), job, shard, total, run_id: runId, run_attempt: '1' }];

  const testGate = (results, ids, filterResult = 'success') =>
    judge({
      gate: 'Test Core',
      legs: [{ job: 'test', total: 3, result: results }],
      filterResult,
      present: new Map(ids),
      runId: '99',
    });

  // ── (i) all N positives ⇒ green ───────────────────────────────────────────
  assert(testGate('success', [attest('test', 1, 3), attest('test', 2, 3), attest('test', 3, 3)]).ok, 'all 3 declared shards attested ⇒ green');

  // ── (ii) N-1 positives, one never scheduled ⇒ red ─────────────────────────
  // COUNTER-EXAMPLE PIN 1 — "abandoned is not moot" (#6082 comment 5208599210,
  // run 31120902911). A discarded shard has runner_id 0 and no `steps`: it
  // executed zero tests while the queue was still consuming this run's
  // verdicts. Whitelisting the word (option A) would have published `Test
  // Core: success` over that. Counting cannot: the credential is absent.
  const abandonedNotMoot = testGate('abandoned', [attest('test', 1, 3), attest('test', 2, 3)]);
  assert(!abandonedNotMoot.ok, 'abandoned-not-moot: 2 of 3 attested + aggregate `abandoned` ⇒ red');
  assert(
    abandonedNotMoot.errors.some((e) => e.includes('test-3-of-3') && e.includes('#6082')),
    'abandoned-not-moot: the error names the shard that published nothing',
  );
  // The same shape must stay red no matter what word the runner leaks, which is
  // the whole reason the verdict no longer consults a word list.
  for (const leaked of ['abandoned', 'success', 'neutral', 'stale', '']) {
    assert(!testGate(leaked, [attest('test', 1, 3), attest('test', 2, 3)]).ok, `a missing credential is red even when the aggregate reads '${leaked || '(empty)'}'`);
  }

  // ── (iii) N-1 positives + one explicit failure ⇒ red ──────────────────────
  assert(!testGate('failure', [attest('test', 1, 3), attest('test', 2, 3)]).ok, 'a genuinely failing shard ⇒ red');
  // COUNTER-EXAMPLE PIN 2 — "a real failure swallowed by a sibling's lifecycle
  // value" (#6082 comment 5208599210, run 31114735713: shard `Test Core (3/3)`
  // at job-level conclusion=failure while the aggregate gate read `abandoned`).
  // Under whitelisting-by-word, adding `abandoned` would have turned this run's
  // only required red green with a real failure in it. Here the failing shard
  // and the discarded shard are both simply absent from the count.
  const swallowedFailure = testGate('abandoned', [attest('test', 1, 3)]);
  assert(!swallowedFailure.ok, 'real-failure-swallowed: aggregate `abandoned` over a failed + a discarded shard ⇒ red');
  assert(
    swallowedFailure.errors.some((e) => e.includes('test-2-of-3') && e.includes('test-3-of-3')),
    'real-failure-swallowed: BOTH unattested shards are named, so the failure cannot hide behind the lifecycle value',
  );
  // A declared negative is a veto even on a full roster — a leg can attest and
  // then be failed by a post step.
  assert(!testGate('failure', [attest('test', 1, 3), attest('test', 2, 3), attest('test', 3, 3)]).ok, 'a full roster never overrides a declared `failure`');

  // ── (iv) filter-skipped family ⇒ green with expected-N adjusted to 0 ──────
  assert(testGate('skipped', []).ok, '#4928: skipped legs + filter success ⇒ green, expected-N adjusts to 0');
  // ── the #4928 guard itself must not regress ───────────────────────────────
  for (const bad of ['failure', 'skipped', '']) {
    const guarded = testGate('skipped', [], bad);
    assert(!guarded.ok, `#4928 guard: skipped legs while filter result is '${bad || '(empty)'}' ⇒ red`);
    assert(guarded.errors.some((e) => e.includes('#4928')), `#4928 guard names its issue for filter result '${bad || '(empty)'}'`);
  }
  assert(testGate('skipped', [], 'cancelled').ok, '#3668: a cancelled filter still lets a skipped leg pass');
  assert(!testGate('skipped', [attest('test', 1, 3)]).ok, 'a credential from a leg that was reported skipped is a contradiction ⇒ red');

  // ── #3668 lifecycle: cancelled passes without counting ────────────────────
  assert(testGate('cancelled', []).ok, '#3668: a cancelled matrix passes with zero credentials (superseded SHA)');
  assert(testGate('cancelled', [attest('test', 1, 3)]).ok, '#3668: a leg that attested before the cancellation is allowed, not required');

  // ── dogfood-gate: a matrix leg and a single leg under one context ─────────
  const dogfood = (dogfoodResult, verifyResult, ids) =>
    judge({
      gate: 'Dogfood Regression Gate',
      legs: [
        { job: 'dogfood', total: 3, result: dogfoodResult },
        { job: 'dogfood-verify', total: 1, result: verifyResult },
      ],
      filterResult: 'success',
      present: new Map(ids),
      runId: '99',
    });
  const fullDogfood = [attest('dogfood', 1, 3), attest('dogfood', 2, 3), attest('dogfood', 3, 3), attest('dogfood-verify', 1, 1)];
  assert(dogfood('success', 'success', fullDogfood).ok, 'dogfood: 3 shards + the CLI leg all attested ⇒ green');
  assert(!dogfood('success', 'abandoned', fullDogfood.slice(0, 3)).ok, 'dogfood: the single CLI leg is counted too — its absence is red');
  assert(dogfood('skipped', 'skipped', []).ok, 'dogfood: both legs skipped by the filter ⇒ green (#4928)');
  assert(dogfood('success', 'skipped', fullDogfood.slice(0, 3)).ok, 'dogfood: each leg is judged on its own roster — a full matrix + a filter-skipped CLI leg ⇒ green');
  assert(!dogfood('success', 'skipped', fullDogfood).ok, 'dogfood: a credential from the leg reported skipped contradicts the skip ⇒ red');

  // ── foreign / stale credentials ───────────────────────────────────────────
  assert(!testGate('success', [attest('test', 1, 3), attest('test', 2, 3), attest('test', 3, 3), attest('test', 4, 4)]).ok, 'a credential no declared leg accounts for ⇒ red');
  assert(
    !testGate('success', [attest('test', 1, 3), attest('test', 2, 3), attest('test', 3, 3, '1234')]).ok,
    'a credential from another run ⇒ red',
  );
  const forged = new Map([attest('test', 1, 3), attest('test', 2, 3), attest('test', 3, 3)]);
  forged.get('test-3-of-3').attestation = 'test-1-of-3';
  assert(!judge({ gate: 'Test Core', legs: [{ job: 'test', total: 3, result: 'success' }], filterResult: 'success', present: forged, runId: '99' }).ok, 'a credential that does not describe itself ⇒ red');

  // ── missing input is a failure, never a pass (#4690) ──────────────────────
  assert(!judge({ gate: 'Test Core', legs: [], filterResult: 'success', present: new Map(), runId: '99' }).ok, 'a gate with no legs verifies nothing ⇒ red');
  assert(!testGate('', []).ok, 'an aggregate result that did not interpolate ⇒ red');

  // ── the classifier: adjacency, not co-occurrence (#6589) ──────────────────
  // Every one of these strings is in the classifier's own input domain — that
  // is the point. The old test asked whether the basename and the flag both
  // occurred; these ask whether the flag is an ARGUMENT of a command that runs
  // the script.
  const REAL_GATE_COMMAND = "node scripts/check-shard-attestation.mjs --verify \\\n  --gate 'Test Core' \\\n  --dir \"$OS_ATTEST_DIR\"";
  assert(invokesScript('node scripts/check-shard-attestation.mjs --verify --gate x', '--verify'), 'the flag as an argument on the same line ⇒ an invocation');
  assert(invokesScript(REAL_GATE_COMMAND, '--verify'), "ci.yml's real gate command, continuations and all ⇒ an invocation");
  assert(
    invokesScript('node scripts/check-shard-attestation.mjs \\\n  --verify \\\n  --gate x', '--verify'),
    'the flag on a CONTINUATION line of the invocation ⇒ still the same command',
  );
  assert(!invokesScript('node scripts/check-shard-attestation.mjs --emit --job test\ngit rev-parse --verify HEAD', '--verify'), '#6589: the script in one command + the flag in another ⇒ NOT an invocation');
  assert(!invokesScript('git rev-parse --verify HEAD', '--verify'), '#6589: another program\'s identically-spelled flag ⇒ not an invocation');
  assert(!invokesScript('git show-ref \\\n  --verify refs/heads/main', '--verify'), '#6589: the flag on another program\'s continuation line ⇒ not an invocation');
  assert(
    !invokesScript('# node scripts/check-shard-attestation.mjs --verify would reclassify this job\necho documented', '--verify'),
    '#6589 second-order trap: DOCUMENTING the invocation in a comment is not making one (the #4890 shape)',
  );
  assert(!invokesScript('echo hi  # node scripts/check-shard-attestation.mjs --verify', '--verify'), '#6589: a trailing comment on a real command is still a comment');
  assert(!invokesScript('node scripts/check-shard-attestation.mjs --emit --job test && git rev-parse --verify HEAD', '--verify'), '#6589: `&&` starts a new command — the flag belongs to git, not to the script');
  assert(invokesScript('node scripts/check-shard-attestation.mjs --emit --job test && git rev-parse --verify HEAD', '--emit'), 'the same line still reads as an --emit invocation');
  assert(!invokesScript('node scripts/check-shard-attestation.mjs --verify-nothing', '--verify'), 'a longer flag that merely STARTS with the flag is a different flag');
  assert(invokesScript('node scripts/check-shard-attestation.mjs --gate "a # b" --verify', '--verify'), 'a quoted `#` is an argument, not a comment — the command must not be truncated');
  assert(invokesScript("node scripts/check-shard-attestation.mjs --gate 'a || b' --verify", '--verify'), 'a quoted separator is an argument, not a command boundary');
  assert(!invokesScript(undefined, '--verify') && !invokesScript(null, '--verify'), 'a step with no run: is not an invocation');
  assert(
    shellCommands('a \\\n  b\n# c\nd; e | f')
      .map((command) => command.split(/\s+/).join(' '))
      .join(' / ') === 'a b / d / e / f',
    'shellCommands: continuations join, comments drop, `;` and `|` split',
  );

  // ── readAttestations over a real directory ───────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'shard-attest-'));
  try {
    assert(readAttestations(join(dir, 'never-created')).present.size === 0, 'a missing download directory is zero credentials, not a crash');
    mkdirSync(join(dir, 'a'), { recursive: true });
    process.env.GITHUB_RUN_ID = '99';
    process.env.GITHUB_RUN_ATTEMPT = '1';
    const argv = process.argv;
    process.argv = ['node', SCRIPT_BASENAME, '--emit', '--job', 'test', '--shard', '2', '--total', '3', '--out', join(dir, 'a')];
    emit();
    process.argv = argv;
    const round = readAttestations(join(dir, 'a'));
    assert(round.present.has('test-2-of-3'), '--emit writes the id the gate looks for');
    assert(round.present.get('test-2-of-3').run_id === '99', '--emit stamps the run id the gate cross-checks');
    writeFileSync(join(dir, 'a', 'test-1-of-3.json'), 'not json');
    assert(readAttestations(join(dir, 'a')).problems.length === 1, 'an unreadable credential is a problem, not a silent skip');

    // ── the static drift guard, over fixture workflows ──────────────────────
    const good = readFileSync(join(scriptRepoRoot(), '.github', 'workflows', 'ci.yml'), 'utf8');
    const withWorkflow = async (source) => {
      const root = mkdtempSync(join(tmpdir(), 'shard-attest-wf-'));
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), source);
      try {
        return await scanWorkflow(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    /**
     * A mutated ci.yml, with the mutation itself asserted.
     *
     * Every anchor below is a literal lifted out of ci.yml, so any of them can
     * go stale under an unrelated edit. A `String.replace` that matches nothing
     * returns the input unchanged — which would leave each assertion below
     * judging the PRISTINE workflow. The green-expecting ones would then pass
     * for the wrong reason, permanently, and silently. So the no-op is a named
     * failure of its own, and the label says which anchor died.
     */
    const fixture = async (label, mutate) => {
      const source = mutate(good);
      assert(source !== good, `fixture '${label}': its ci.yml anchor no longer matches — the assertion below would judge the pristine workflow`);
      return withWorkflow(source);
    };
    const baseline = await withWorkflow(good);
    assert(baseline.problems.length === 0, 'the checked-in ci.yml passes the static drift guard');
    assert((await fixture('grow the matrix', (s) => s.replace('shard: [1, 2, 3]', 'shard: [1, 2, 3, 4]'))).problems.some((p) => p.includes('declares 4 shard')), 'growing the matrix without the gate ⇒ red');
    assert((await fixture('shrink the roster', (s) => s.replace('--leg "test/3', '--leg "test/2'))).problems.some((p) => p.includes('expects 2 attestation')), 'shrinking the gate roster without the matrix ⇒ red');
    assert((await fixture('uncounted intruder', (s) => s.replace(/^jobs:$/m, 'jobs:\n  intruder:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/check-shard-attestation.mjs --emit'))).problems.some((p) => p.includes('no gate counts')), 'an attestation no gate counts ⇒ red');
    assert((await fixture('rename test-gate', (s) => s.replace('  test-gate:', '  test-gate-renamed:'))).problems.some((p) => p.includes("'test-gate'")), 'losing a required-context gate ⇒ red');
    assert((await fixture('typo the artifact name', (s) => s.replace('name: shard-attest-test-', 'name: shard-attest-typo-'))).problems.some((p) => p.includes('cannot count')), 'an artifact name the gate cannot match ⇒ red');
    assert(
      (await fixture('step after the credential', (s) => s.replace('          overwrite: true\n\n  test-gate:', '          overwrite: true\n\n      - name: after the credential\n        run: echo late\n\n  test-gate:'))).problems.some((p) =>
        p.includes('must END with the attestation pair'),
      ),
      'a step appended after the credential ⇒ red',
    );
    assert(
      (await fixture('unmatchable download pattern', (s) => s.replace('          pattern: shard-attest-test-*', '          pattern: shard-attest-nothing-*'))).problems.some((p) => p.includes('none of which matches')),
      'a gate whose download pattern cannot match its legs ⇒ red',
    );
    assert(
      (await fixture('if: on the credential step', (s) => s.replace('      - name: Attest this shard ran and passed\n        run: |\n          node scripts/check-shard-attestation.mjs --emit \\\n            --job test', '      - name: Attest this shard ran and passed\n        if: always()\n        run: |\n          node scripts/check-shard-attestation.mjs --emit \\\n            --job test'))).problems.some((p) => p.includes('guards its attestation steps with an if:')),
      'an `if:` on the credential step ⇒ red (the credential would stop meaning "every earlier step passed")',
    );

    // ── #6589: a shard job is not a gate because a step says `--verify` ──────
    // The classification, asserted as a classification. The measured false red
    // reported neither the classifier nor the flag — it reported that job
    // `test` lacked two properties only an aggregate gate owes, and following
    // that reading means editing the shard job's `if:`, i.e. breaking #3622.
    assert(
      REQUIRED_GATE_JOBS.every((id) => baseline.gateIds.includes(id)) && baseline.gateIds.length === REQUIRED_GATE_JOBS.length,
      `the real gate invocations, and only those, are classified as gates (${REQUIRED_GATE_JOBS.join(', ')})`,
    );
    assert(baseline.attesterIds.includes('test'), 'the sharded test job is classified as an attester');
    const SHARD_STEP_ANCHOR = "      - name: Compute this shard's package set\n";
    const shardStepProbe = (body) => (s) => s.replace(SHARD_STEP_ANCHOR, `      - name: Probe step (#6589)\n${body}\n${SHARD_STEP_ANCHOR}`);
    const staysAnAttester = async (label, body) => {
      const result = await fixture(label, shardStepProbe(body));
      assert(!result.gateIds.includes('test'), `#6589 '${label}': job 'test' is NOT reclassified as an aggregate gate`);
      assert(result.attesterIds.includes('test'), `#6589 '${label}': job 'test' is still counted as an attester`);
      assert(result.problems.length === 0, `#6589 '${label}': the guard stays green — got ${JSON.stringify(result.problems)}`);
    };
    // The exact edit that was measured red on origin/main: the idiomatic strict
    // ref-existence check, in the step ci.yml routes around with `git cat-file
    // -e` to this day. Whole family: `git show-ref --verify`, `gpg --verify`.
    await staysAnAttester('git rev-parse --verify in a shard step', '        run: git rev-parse --verify "$GITHUB_SHA^{commit}"');
    await staysAnAttester('the flag on another program\'s continuation line', '        run: |\n          git show-ref \\\n            --verify refs/heads/main');
    // The second-order trap, in a fixture: writing DOWN the collision used to
    // re-arm it, because a comment is part of `run:` (#4890's shape). This one
    // spells the whole invocation and must still classify as a shard.
    await staysAnAttester(
      'a comment documenting the invocation',
      '        run: |\n          # node scripts/check-shard-attestation.mjs --verify would have\n          # reclassified this shard job as an aggregate gate (#6589).\n          echo documented',
    );
    // The twin, on the `--emit` side: "publishes an attestation that no gate
    // counts" asked the same co-occurrence question one flag over — a bare
    // `--emit` anywhere in an unclaimed job's `run:` text, script or no script.
    const unclaimedEmitFlag = await fixture('another program\'s --emit flag in an unclaimed job', (s) =>
      s.replace(/^jobs:$/m, 'jobs:\n  bystander:\n    runs-on: ubuntu-latest\n    steps:\n      - run: esbuild src/index.ts --emit\n      - run: echo "see check-shard-attestation.mjs for why this is not an attester"'),
    );
    assert(
      !unclaimedEmitFlag.problems.some((p) => p.includes("'bystander'")),
      '#6589 twin: another program\'s --emit flag is not an unenforced credential — the job is never named',
    );
    assert(unclaimedEmitFlag.problems.length === 0, `#6589 twin: the guard stays green — got ${JSON.stringify(unclaimedEmitFlag.problems)}`);

    // The other direction: a REAL gate invocation must still read as a gate, or
    // the fix has simply turned the guard off. `--verify-nothing` is not the
    // flag, so test-gate stops being one and the required-context check fires.
    const ablated = await fixture('ablate the gate invocation', (s) =>
      s.replace('check-shard-attestation.mjs --verify', 'check-shard-attestation.mjs --verify-nothing'),
    );
    assert(!ablated.gateIds.includes('test-gate'), '#6589 positive limb: a job that no longer INVOKES the script with the flag stops being a gate');
    assert(
      ablated.problems.some((p) => p.includes("job 'test-gate'") && p.includes('#3622')),
      '#6589 positive limb: losing the real gate invocation ⇒ red, naming the branch-protection contract',
    );

    const noFile = mkdtempSync(join(tmpdir(), 'shard-attest-empty-'));
    try {
      assert((await scanWorkflow(noFile)).problems.some((p) => p.includes('does not exist')), '#4690: a missing ci.yml is a failure, never a pass');
      mkdirSync(join(noFile, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(noFile, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push\n');
      assert((await scanWorkflow(noFile)).problems.some((p) => p.includes('no jobs')), '#4690: a workflow with no jobs is a failure, never a pass');
      writeFileSync(join(noFile, '.github', 'workflows', 'ci.yml'), 'jobs: [oops\n  - :\n');
      assert((await scanWorkflow(noFile)).problems.length > 0, '#4690: an unparseable workflow is a failure, never a pass');
    } finally {
      rmSync(noFile, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`✗ check-shard-attestation --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-shard-attestation --self-test: ${checked} assertions (dominance experiment + both #6082 counter-examples + the #4928 guard + the #6589 classifier pins).`,
  );
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (process.argv.includes('--emit')) {
  emit();
} else if (process.argv.includes('--verify')) {
  verify();
} else {
  await main();
}
