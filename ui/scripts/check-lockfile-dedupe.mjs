#!/usr/bin/env node
/**
 * Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
 *
 * The committed `pnpm-lock.yaml` must already be DEDUPED: running
 * `pnpm dedupe` on it may not collapse anything (objectui#8333).
 *
 *   Run:  node scripts/check-lockfile-dedupe.mjs             (`pnpm check:lockfile-dedupe`)
 *         node scripts/check-lockfile-dedupe.mjs --report-only  (what CI passes)
 *         node scripts/check-lockfile-dedupe.mjs --self-test
 *
 * ## `--report-only`: the gate REPORTS on pull requests (objectui#9562)
 *
 * objectui#9562 measured this gate returning four green and one red on a
 * byte-identical `pnpm-lock.yaml` inside ninety minutes, the red printing a
 * confident `VERDICT not deduped` that no lockfile edit and no registry publish
 * explained — and then instructing the reader to commit a dedupe the tree did
 * not need, to a lockfile every open pull request shares. The maintainer ruled
 * (2026-09-17, letter A) that a gate which is non-deterministic by construction
 * does not BLOCK:
 *
 *   - `--report-only` keeps every reading exactly as it is and changes only what
 *     the process does with it: annotations become `::warning::`, the same text
 *     is written to `$GITHUB_STEP_SUMMARY`, and the process exits 0. It is the
 *     flag `lockfile-dedupe.yml` passes.
 *   - The BARE script keeps its exit codes — 0 / 1 / 2 — for whoever runs it by
 *     hand. ⛔ That is deliberate and not an oversight to tidy away: the hard
 *     verdict is still how a human asks this question.
 *   - ⛔ Report-only may never flatten the three answers into two. `clean` and
 *     `cannot-run` both exit 0 under the flag, so the EXIT CODE no longer tells
 *     them apart — the annotation does, and `cannot-run` carries one precisely
 *     because of that. A report-only mode that cannot say "I could not look" is
 *     worse than the blocking gate it replaces.
 *   - The finding text, in BOTH modes, now says what the instrument is: re-run
 *     before acting, and dedupe only when the split reproduces. ⛔ The old
 *     unconditional "fix it HERE by running `pnpm dedupe` and committing the
 *     lockfile" is gone from both — it is the sentence objectui#9562 reported.
 *
 * ## What this is for, and why it is not objectui#8326's gate
 *
 * objectui#8326's `check-lockfile-integrity.mjs` reports a DELTA: it compares a
 * pull request's lockfile with its merge base and names anything that gained a
 * physical copy. It answers "did THIS change duplicate something?".
 *
 * This gate answers a different question, about one tree and no base: "is the
 * lockfile in a state where `pnpm dedupe` would still have work to do?" The two
 * are independent — a tree can be delta-clean and still carry years of
 * accumulated duplication, which is exactly the state `main` was in until
 * objectui#9215 collapsed 47 identities out of it.
 *
 * ## The defect this closes, in the order it happens
 *
 * 1. A dependency bump re-resolves part of the peer graph and forks a package
 *    that was single-copy. Measured on objectui#8333: bumping `better-auth`
 *    alone splits `zod` into a third physical copy and pulls `@objectstack/spec`
 *    and `ai` into a second peer context each. No declaration, range or override
 *    anywhere in the workspace changed — it is partial-re-resolution debt.
 * 2. `Bundle Analysis` then reads a bundle that grew, and the growth is
 *    attributed to the bump. It is not the bump: it is the fork.
 * 3. The remedy is `pnpm dedupe`. But `pnpm dedupe` is NOT SURGICAL — it
 *    collapses every collapsible duplicate in the tree, not just the one the
 *    bump created. Run inside a bump PR on a tree carrying old duplication, it
 *    drags all of that along, and the reviewer reads the combined delta as the
 *    bump's. That is the SAME misattribution, aimed at a different PR.
 *
 * ⇒ requiring the remedy is only honest once the tree is already deduped. That
 * is why objectui#8333's ruling was "B then A": pay the accumulated debt down in
 * its own dedicated pull request FIRST (objectui#9215, landed), and only then
 * require the remedy in bump PRs. This gate is the second half, and its whole
 * value depends on the first half staying true — which is precisely what it
 * enforces. Without it `main` drifts back to a duplicated tree and the next bump
 * PR's dedupe is expensive and unreadable again.
 *
 * ## Why the verdict is pnpm's exit code and not a parse of its output
 *
 * `pnpm dedupe --check` is pnpm's own contract: exit 0 when nothing would
 * change, non-zero when something would. This gate does not re-derive that. It
 * reads the exit code, and parses the output ONLY to NAME the packages in the
 * annotation. A parse that finds nothing still reds on a non-zero exit — the
 * names are a convenience and can never change the verdict, so a future change
 * to pnpm's report format degrades the message and not the judgement.
 *
 * The one thing the output IS load-bearing for is telling a FINDING apart from a
 * CRASH. Both exit non-zero, and "the registry was unreachable" is not a finding
 * about the diff. So a non-zero exit counts as a finding only when the output
 * carries pnpm's own remedy sentinel; otherwise this exits 2, "could not take a
 * reading", which is never a pass.
 *
 * ## It needs the pinned `@objectstack/*` build (objectui#12957)
 *
 * Every `@objectstack/*` package resolves to a `file:` directory of the build
 * `.objectstack-sha` pins (`scripts/objectstack-pin.mjs`), and `pnpm dedupe
 * --check` re-reads those directories. Without the build pnpm stops before it
 * judges anything (`ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`), so the checker asks
 * first and reports a reading it could not take, NAMING the cause rather than
 * leaving it to pnpm's message. `lockfile-dedupe.yml` restores the build before
 * this runs. Measured on objectui#12957 with the build in place: `VERDICT
 * deduped`, the lockfile's sha256 unchanged.
 *
 * ## ⚠️ This gate reads the REGISTRY, unlike its neighbour
 *
 * `check-lockfile-integrity.mjs` is one `node` call over two text files.
 * This one shells out to pnpm, which resolves against `registry.npmjs.org`, so
 * it costs a network round trip and can fail for reasons that are about the
 * world rather than the diff. That failure lands on exit 2 (see above) with a
 * message saying so, rather than being reported as a lockfile finding.
 *
 * ⚠️ Stated because it bounds what the green means: `pnpm dedupe` does NOT chase
 * the newest version admitted by a range — it only collapses copies that are
 * already in the tree. Measured on objectui#8333: `better-auth` is declared
 * `^1.7.2` and locked at `1.7.2` while the registry already serves `1.7.4`,
 * which that range admits, and this gate is green on that tree. So a publish to
 * the registry does not by itself turn this gate red, and it is not the
 * spontaneously-drifting check that a "resolve against the live registry" gate
 * sounds like. That is an argument from one measured instance plus pnpm's
 * documented behaviour, ⛔ not a proof over all future pnpm versions; the
 * instrument that re-derives it is this gate's own run history.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { CACHE_DIR, STAMP_FILE } from './objectstack-pin.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * pnpm's own remedy line, printed only when `--check` found something to
 * collapse. It is what separates a FINDING from a CRASH, both of which exit
 * non-zero. Captured verbatim from `pnpm@10.31.0`.
 */
export const DEDUPE_SENTINEL = 'Run pnpm dedupe to apply the changes above.';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
/** A reading that could not be taken is NOT a deduped lockfile. */
export const EXIT_CANNOT_RUN = 2;

/**
 * The one explicit flag objectui#9562's ruling grants, passed by
 * `lockfile-dedupe.yml`. ⛔ Not inferred from `process.env.CI` or from
 * `GITHUB_ACTIONS`: a mode that changes a verdict's consequences is a decision
 * the caller states, so that running the checker by hand cannot silently get a
 * different contract than the one being read here.
 */
export const REPORT_ONLY_FLAG = '--report-only';

/**
 * What this gate IS, said wherever it reports a finding — in both modes and on
 * both surfaces (log and step summary), from ONE copy so the two cannot drift.
 *
 * ⛔ This is not decoration. The defect objectui#9562 recorded is not that the
 * gate reds; it is that a confident red arrives with a remedy attached, and the
 * remedy writes to a file every open pull request shares.
 */
export const INSTRUMENT_CAVEAT = Object.freeze([
  '⚠️ WHAT THIS GATE IS: a LIVE registry reading, and it can disagree with itself. objectui#9562',
  'recorded four green and one red on a byte-identical `pnpm-lock.yaml` inside ninety minutes, the',
  'red naming a split that no lockfile edit and no registry publish explained.',
  '⇒ RE-RUN this check before acting on it, and run `pnpm dedupe` and commit the lockfile ONLY when',
  'the split reproduces. ⛔ One red is not by itself evidence that this tree needs a dedupe.',
]);

/**
 * The verdict, from pnpm's exit status plus the sentinel.
 *
 * `status === 0` with the sentinel present is contradictory — pnpm would be
 * saying both "nothing to do" and "run dedupe" — so it is reported as
 * `cannot-run` rather than being resolved in either direction.
 *
 * @param {{ status: number|null, output: string }} run
 * @returns {'clean'|'findings'|'cannot-run'}
 */
export function classify({ status, output = '' }) {
  const sentinel = output.includes(DEDUPE_SENTINEL);
  if (status === 0) return sentinel ? 'cannot-run' : 'clean';
  return sentinel ? 'findings' : 'cannot-run';
}

/**
 * Best-effort: the package NAMES whose copies `pnpm dedupe` would collapse.
 *
 * `--check` lists the snapshot keys it would remove as `- <identity>` lines,
 * where an identity is `name@version` optionally followed by a `(peer)` suffix.
 * Scoped names carry a leading `@`, so the version separator is the LAST `@`
 * before any peer suffix.
 *
 * ⛔ Never load-bearing: an empty result does not make a non-zero exit clean.
 *
 * @param {string} output
 * @returns {string[]} sorted, unique
 */
export function namesFromOutput(output = '') {
  const names = new Set();
  for (const line of output.split('\n')) {
    const match = /^-\s+(\S.*?)\s*$/.exec(line);
    if (!match) continue;
    const base = match[1].split('(')[0];
    const at = base.lastIndexOf('@');
    if (at <= 0) continue;
    names.add(base.slice(0, at));
  }
  return [...names].sort();
}

/**
 * The line that tells the reader this job will not fail, printed ONLY under the
 * flag. Without it a `::warning::` on a green check reads as an unexplained
 * near-miss.
 *
 * @param {boolean} reportOnly
 * @returns {string[]}
 */
function modeLine(reportOnly) {
  return reportOnly
    ? ['⚠️ REPORT ONLY — this job exits 0 and does not fail your pull request (objectui#9562).']
    : [];
}

/**
 * @param {{ outcome: 'clean'|'findings'|'cannot-run', names?: string[], output?: string, reportOnly?: boolean }} reading
 * @returns {string[]} lines to print
 */
export function renderVerdict({ outcome, names = [], output = '', reportOnly = false }) {
  if (outcome === 'clean') {
    return ['VERDICT deduped — `pnpm dedupe` would collapse nothing in this lockfile.'];
  }
  if (outcome === 'cannot-run') {
    return [
      'VERDICT could not take a reading — `pnpm dedupe --check` did not report a result.',
      'This is a fact about the run (registry, toolchain, or a changed pnpm report format),',
      'NOT a verdict on this change. Nothing here was judged.',
      ...modeLine(reportOnly),
      ...(output ? ['', '--- pnpm output ---', output.trimEnd()] : []),
    ];
  }
  const named = names.length ? names.join(', ') : '(pnpm named no removable identity — see its output above)';
  return [
    output.trimEnd(),
    '',
    `VERDICT not deduped — \`pnpm dedupe\` would still collapse duplicate copies: ${named}.`,
    ...modeLine(reportOnly),
    'Two physical copies of one package are two real paths in the bundle, and a downstream',
    '`Bundle Analysis` reading then measures resolution collateral left behind by an earlier',
    'change rather than measuring this one (objectui#8333).',
    '',
    ...INSTRUMENT_CAVEAT,
    '',
    '⛔ Do NOT satisfy this by pinning a version, adding a `pnpm.overrides` entry or widening a',
    'range: those spend a declaration to fix a resolution artefact, and objectui#8333 rejected',
    'both. `pnpm dedupe` changes no declaration at all.',
  ];
}

/**
 * The same reading, rendered for `$GITHUB_STEP_SUMMARY` instead of the log.
 *
 * Empty for a clean tree: a gate with nothing to report writes nothing, so the
 * presence of a block is itself the signal on the run summary page.
 *
 * @param {{ outcome: 'clean'|'findings'|'cannot-run', names?: string[], output?: string }} reading
 * @returns {string} markdown, or '' when there is nothing to say
 */
export function renderStepSummary({ outcome, names = [], output = '' }) {
  if (outcome === 'clean') return '';
  if (outcome === 'cannot-run') {
    return [
      '### ⚠️ Lockfile dedupe — could not take a reading',
      '',
      '`pnpm dedupe --check` did not report a result, so **nothing here was judged**. That is a fact',
      'about the run — registry, toolchain, or a changed pnpm report format — and not a verdict on',
      'this change. ⛔ It is NOT a deduped lockfile either.',
      '',
      ...INSTRUMENT_CAVEAT,
      '',
    ].join('\n');
  }
  const named = names.length
    ? names.map((name) => `- \`${name}\``)
    : ['- _(pnpm named no removable identity — see the job log)_'];
  return [
    '### ⚠️ Lockfile dedupe — not deduped',
    '',
    '`pnpm dedupe` would still collapse duplicate copies of:',
    '',
    ...named,
    '',
    ...INSTRUMENT_CAVEAT,
    '',
    '```text',
    output.trimEnd(),
    '```',
    '',
  ].join('\n');
}

/**
 * Append a step-summary block, when the runner gave us somewhere to put it.
 *
 * ⛔ Never throws and never changes a verdict: a summary that could not be
 * written is a worse report, not a different reading.
 *
 * @param {string} text
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether anything was written
 */
export function writeStepSummary(text, env = process.env) {
  const target = env.GITHUB_STEP_SUMMARY;
  if (!target || !text) return false;
  try {
    fs.appendFileSync(target, `${text}\n`);
    return true;
  } catch (error) {
    console.error(
      `::warning title=Lockfile dedupe::could not write the step summary: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Whether the pinned `@objectstack/*` build is absent, read off its stamp.
 *
 * @param {string} [root]
 * @returns {boolean}
 */
export function pinnedBuildMissing(root = REPO_ROOT) {
  return !fs.existsSync(path.join(root, CACHE_DIR, STAMP_FILE));
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
export function main(argv = process.argv.slice(2)) {
  const reportOnly = argv.includes(REPORT_ONLY_FLAG);
  /** The annotation LEVEL is the whole difference: same message, same surface. */
  const annotate = (message) =>
    console.error(`::${reportOnly ? 'warning' : 'error'} title=Lockfile dedupe::${message}`);

  if (pinnedBuildMissing()) {
    annotate(
      `could not take a reading — the pinned @objectstack/* build is not in ${CACHE_DIR}, so ` +
        '`pnpm dedupe --check` cannot resolve those packages (objectui#12957). Run `pnpm objectstack:build` ' +
        'first. ⛔ This is NOT a deduped verdict.',
    );
    for (const line of renderVerdict({ outcome: 'cannot-run', reportOnly })) console.error(line);
    writeStepSummary(renderStepSummary({ outcome: 'cannot-run' }));
    return reportOnly ? EXIT_CLEAN : EXIT_CANNOT_RUN;
  }

  const run = spawnSync('pnpm', ['dedupe', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (run.error) {
    annotate(`could not run \`pnpm dedupe --check\`: ${run.error.message}`);
    for (const line of renderVerdict({ outcome: 'cannot-run', reportOnly })) console.error(line);
    writeStepSummary(renderStepSummary({ outcome: 'cannot-run' }));
    return reportOnly ? EXIT_CLEAN : EXIT_CANNOT_RUN;
  }

  // pnpm writes its report across both streams; the verdict reads them together.
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const outcome = classify({ status: run.status, output });
  const names = outcome === 'findings' ? namesFromOutput(output) : [];

  const lines = renderVerdict({ outcome, names, output, reportOnly });
  const write = outcome === 'clean' ? console.log : console.error;
  for (const line of lines) write(line);

  if (outcome === 'clean') return EXIT_CLEAN;

  writeStepSummary(renderStepSummary({ outcome, names, output }));

  if (outcome === 'cannot-run') {
    // ⛔ Under the flag the exit code no longer separates "clean" from "could
    // not look" — both are 0 — so the ANNOTATION has to, and this is the only
    // place it can come from. Without it, report-only would answer a question
    // it never asked.
    if (!reportOnly) return EXIT_CANNOT_RUN;
    annotate(
      'could not take a reading — `pnpm dedupe --check` did not report a result, so nothing here ' +
        'was judged. ⛔ This is NOT a deduped verdict.',
    );
    return EXIT_CLEAN;
  }

  annotate(
    `${names.join(', ') || 'duplicate copies'} — a live registry reading says \`pnpm dedupe\` would collapse these. ` +
      'Re-run before acting; dedupe and commit the lockfile only if the split reproduces (objectui#8333, objectui#9562).',
  );
  return reportOnly ? EXIT_CLEAN : EXIT_FINDINGS;
}

/**
 * Cases built from REAL `pnpm@10.31.0` output captured on objectui#8333: the
 * green leg is today's `main`, the red leg is the same tree with `better-auth`
 * bumped, which forks `zod`.
 *
 * @returns {number}
 */
export function selfTest() {
  /** @type {{ name: string, ok: boolean }[]} */
  const cases = [];
  const t = (name, ok) => cases.push({ name, ok: Boolean(ok) });

  const RED = [
    '@objectstack/spec@17.4.0(ai@7.0.65(zod@4.6.4))',
    '└── zod 4.4.3 → 4.6.4',
    '',
    '+ zod-validation-error@4.0.2(zod@4.6.4)',
    '- @ai-sdk/gateway@4.0.52(zod@4.4.3)',
    '- @objectstack/spec@17.4.0(ai@7.0.65(zod@4.4.3))',
    '- ai@7.0.65(zod@4.4.3)',
    '- zod@4.4.3',
    '',
    DEDUPE_SENTINEL,
    '',
  ].join('\n');
  const GREEN = ' WARN  7 deprecated subdependencies found: glob@7.2.3\nProgress: resolved 1767, done\n';

  // ── the verdict comes from the exit code, disambiguated by the sentinel ────
  t('a zero exit with no sentinel is clean', classify({ status: 0, output: GREEN }) === 'clean');
  t('a non-zero exit carrying the sentinel is a finding', classify({ status: 1, output: RED }) === 'findings');
  t(
    'a non-zero exit WITHOUT the sentinel is could-not-run, not a finding',
    classify({ status: 1, output: 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/x' }) === 'cannot-run',
  );
  t(
    'a crash with no output at all is could-not-run, never clean',
    classify({ status: 137, output: '' }) === 'cannot-run',
  );
  t(
    'a contradictory zero-exit-with-sentinel is could-not-run, not silently clean',
    classify({ status: 0, output: RED }) === 'cannot-run',
  );
  t('a null status (killed by signal) is could-not-run', classify({ status: null, output: '' }) === 'cannot-run');

  // ── the names are a convenience; they never decide anything ───────────────
  const names = namesFromOutput(RED);
  t('names the unscoped package whose copy is removed', names.includes('zod'));
  t('names a SCOPED package without eating its leading @', names.includes('@objectstack/spec'));
  t('strips the peer suffix rather than reporting it as part of the name', names.includes('ai'));
  t('does not report the ADDED identity as removed', !names.includes('zod-validation-error'));
  t('reports each name once, sorted', JSON.stringify(names) === JSON.stringify([...new Set(names)].sort()));
  t('finds nothing in clean output', namesFromOutput(GREEN).length === 0);

  // ── the pinned @objectstack/* build is a precondition (objectui#12957) ─────
  t('a root without the pinned build is reported missing', pinnedBuildMissing(path.join(REPO_ROOT, 'no-such-root')) === true);
  t(
    'CONTROL — a red verdict still reds when the parse names nothing',
    renderVerdict({ outcome: 'findings', names: [], output: RED }).some((l) => l.startsWith('VERDICT not deduped')),
  );

  // ── the rendered verdicts say which of the three answers this was ─────────
  t('clean renders VERDICT deduped', renderVerdict({ outcome: 'clean' })[0].startsWith('VERDICT deduped'));
  t(
    'a finding names the packages and points at `pnpm dedupe`',
    renderVerdict({ outcome: 'findings', names, output: RED }).join('\n').includes('`pnpm dedupe`'),
  );
  t(
    'a finding forbids the rejected remedies by name',
    renderVerdict({ outcome: 'findings', names, output: RED }).join('\n').includes('pnpm.overrides'),
  );
  t(
    'could-not-run says it judged nothing',
    renderVerdict({ outcome: 'cannot-run' }).join('\n').includes('Nothing here was judged'),
  );

  // ── objectui#9562: the finding text names the INSTRUMENT, in both modes ───
  for (const reportOnly of [false, true]) {
    const label = reportOnly ? 'report-only' : 'blocking';
    const finding = renderVerdict({ outcome: 'findings', names, output: RED, reportOnly }).join('\n');
    t(`${label} mode: the finding says to re-run before acting`, finding.includes('RE-RUN this check'));
    t(
      `${label} mode: ⛔ the unconditional instruction to commit a dedupe is GONE`,
      !finding.includes('Fix it HERE'),
    );
    t(`${label} mode: the finding still names the packages`, finding.includes('zod'));
  }

  t(
    'only report-only mode says the job will not fail',
    renderVerdict({ outcome: 'findings', names, output: RED, reportOnly: true }).join('\n').includes('REPORT ONLY') &&
      !renderVerdict({ outcome: 'findings', names, output: RED }).join('\n').includes('REPORT ONLY'),
  );
  t(
    'report-only could-not-run says it will not fail, and still says it judged nothing',
    renderVerdict({ outcome: 'cannot-run', reportOnly: true }).join('\n').includes('REPORT ONLY') &&
      renderVerdict({ outcome: 'cannot-run', reportOnly: true }).join('\n').includes('Nothing here was judged'),
  );

  // ── the step summary: same reading, other surface ────────────────────────
  t('a clean tree writes NO step summary — the block itself is the signal', renderStepSummary({ outcome: 'clean' }) === '');
  const summary = renderStepSummary({ outcome: 'findings', names, output: RED });
  t('the step summary names the split', names.every((name) => summary.includes(name)));
  t('the step summary carries pnpm\'s own output', summary.includes(DEDUPE_SENTINEL));
  t('the step summary carries the instrument caveat, from the one copy', summary.includes(INSTRUMENT_CAVEAT[0]));
  const cannotSummary = renderStepSummary({ outcome: 'cannot-run' });
  t(
    'the could-not-run summary stays distinguishable from a deduped one',
    cannotSummary.includes('could not take a reading') && !cannotSummary.includes('not deduped'),
  );
  t(
    'CONTROL — a finding summary still renders when the parse names nothing',
    renderStepSummary({ outcome: 'findings', names: [], output: RED }).includes('not deduped'),
  );
  t(
    'the step summary is written only where the runner asked for one',
    writeStepSummary(summary, {}) === false && writeStepSummary('', { GITHUB_STEP_SUMMARY: '/dev/null' }) === false,
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}`);
  if (failed.length) {
    console.error(`✗ check-lockfile-dedupe self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-lockfile-dedupe self-test: ${cases.length} cases pass ` +
      '(the three verdicts, the crash-vs-finding split, the report-only rendering, and the controls ' +
      'a name-parser-driven gate would fail).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    process.exitCode = selfTest();
  } else {
    try {
      process.exitCode = main(argv);
    } catch (error) {
      // ⛔ The catch-all obeys the flag too. A mode that reports every measured
      // outcome and then reds on a crash of the reporter is still a gate that
      // fails a pull request for a reason that is not about it.
      const reportOnly = argv.includes(REPORT_ONLY_FLAG);
      console.error(
        `::${reportOnly ? 'warning' : 'error'}::check-lockfile-dedupe could not take a reading: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error('A reading that could not be taken is NOT a deduped lockfile.');
      process.exitCode = reportOnly ? EXIT_CLEAN : EXIT_CANNOT_RUN;
    }
  }
}
