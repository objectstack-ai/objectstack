#!/usr/bin/env node
/**
 * ADR-0076 D7 trigger metric (#2462): cross-package commit ratio of the
 * ObjectQL engine core (`engine.ts` / `registry.ts`).
 *
 * The engine repo-split (D7) is trigger-gated: it may only happen once the
 * share of engine-core commits that ALSO touch files outside
 * `packages/objectql/` falls to a low, stable level (it was ~88% when the
 * ADR was written — i.e. the engine still co-evolves with the rest of the
 * monorepo and is NOT separable). This script computes that ratio from git
 * history so CI can track it over time.
 *
 * Run:  node scripts/check-engine-split-ratio.mjs [--days N] [--threshold PCT]
 *       node scripts/check-engine-split-ratio.mjs --self-test
 *
 *   --days N         Look-back window in days (default 90).
 *   --threshold PCT  Optional gate: exit 1 if the ratio is ABOVE the given
 *                    percentage. By default the script is REPORT-ONLY (always
 *                    exits 0) — the split threshold is an open question
 *                    (ADR-0076 OQ#5) and is set deliberately, not by default.
 *   --cwd PATH       Measure another checkout (the self-test's fixtures).
 *
 * Exit codes:
 *   0  the ratio was computed over the whole window, and is printed with the
 *      horizon it was computed against.
 *   1  --threshold was given and the ratio is above it.
 *   2  CANNOT COMPUTE — bad arguments, or this checkout cannot see the whole
 *      window. Never confusable with 1: "the engine is not separable" and "I
 *      could not measure" are different facts.
 *
 * Output: a human-readable summary on stdout; when $GITHUB_STEP_SUMMARY is
 * set, a markdown section is appended for the Actions run summary.
 *
 * ## Why a horizon guard, and why it refuses instead of warning (#9902)
 *
 * `git log --since=<N days ago>` in a shallow clone answers from whatever part
 * of the window happens to be present, **exits 0, and prints no warning** — the
 * graft boundary is invisible to it. The scheduled run is safe
 * (`engine-split-metric.yml` checks out with `fetch-depth: 0`); a seat running
 * this locally is not, and agent containers clone shallow.
 *
 * Measured in one such container on 2026-08-21 (graft floor 2026-06-02, window
 * `--days 90` reaching back to 2026-05-23):
 *
 *   | reading                                   | engine-core commits in the window |
 *   |-------------------------------------------|-----------------------------------|
 *   | this script, before this guard             | **265** — exit 0, no warning      |
 *   | truth (GitHub commit list for the window)  | 282                               |
 *
 * Seventeen commits short, and worse than short: the one commit the truncated
 * scan *did* return from below the floor was the graft boundary itself, which
 * carries the whole tree and therefore "touches" both engine-core files and
 * everything outside `packages/objectql/`. A truncated window does not merely
 * lose data points, it fabricates one — and it lands in the cross-package
 * numerator, pushing the ratio the wrong way.
 *
 * The shape is REFUSAL rather than a warning because of what consumes the
 * number: this is an ADR trigger metric, read to decide whether a repo split
 * may proceed. A ratio printed beside a caveat is still a ratio, and it gets
 * quoted without the caveat; a refusal cannot be quoted at all. The predicate
 * is `historyHorizon()` in `scripts/pm/git-history.mjs`, deliberately shared
 * rather than re-implemented — it is not `--is-shallow-repository` (which
 * would refuse windows a shallow clone answers exactly) but "does the floor
 * predate the window", and the deepen command it prints is computed so it can
 * only ADD history.
 *
 * Zero third-party dependencies.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { historyHorizon } from './pm/git-history.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENGINE_CORE = ['packages/objectql/src/engine.ts', 'packages/objectql/src/registry.ts'];
const ENGINE_PACKAGE_PREFIX = 'packages/objectql/';

const EXIT_OK = 0;
const EXIT_ABOVE_THRESHOLD = 1;
const EXIT_CANNOT_COMPUTE = 2;

function arg(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}

/**
 * The horizon line that travels beside the number. Pure, so --self-test pins
 * the words: a metric pasted into an ADR discussion without its horizon is a
 * number nobody can re-derive.
 */
export function renderHorizon(horizon) {
  if (!horizon.shallow) return `  history horizon:      complete clone; ref tip ${horizon.tip}`;
  // `(predates the window)` is a CLAIM, so it is spelled only when it holds.
  // Measured while ablating the refusal above: with the guard removed this line
  // still printed "predates the window" beside a floor that sat inside it —
  // an annotation written on the assumption that it was reached only after a
  // pass becomes a false statement the moment anything reaches it otherwise.
  const placed = horizon.covered ? ' (predates the window)' : ' — INSIDE the window, this metric is not measurable here';
  return `  history horizon:      shallow clone, oldest visible commit ${horizon.floor}${placed}; ref tip ${horizon.tip}`;
}

/** The refusal, as words. Pure, so --self-test pins that it names both facts. */
export function renderRefusal({ horizon, days, sinceIso }) {
  return (
    `⛔  cannot compute the ADR-0076 D7 trigger metric — ${horizon.reason}.\n` +
    `    window: last ${days} days (since ${sinceIso.slice(0, 10)})   ref tip: ${horizon.tip}\n` +
    `    A ratio derived here would be real, plausible and WRONG: the missing commits are\n` +
    `    invisible to \`git log\`, which reports no error, and the graft boundary commit that\n` +
    `    IS visible carries the whole tree — so it counts as an engine-core commit AND as a\n` +
    `    cross-package one. Refusing rather than printing a caveat: an ADR trigger metric gets\n` +
    `    quoted without its caveats (#9902).\n` +
    `    Remedy: ${horizon.remedy}`
  );
}

function main(argv) {
  const days = Number(arg(argv, 'days', '90'));
  const thresholdRaw = arg(argv, 'threshold', '');
  const threshold = thresholdRaw === '' ? null : Number(thresholdRaw);
  const repoRoot = resolve(arg(argv, 'cwd', resolve(__dirname, '..')));

  if (!Number.isFinite(days) || days <= 0) {
    console.error(`Invalid --days value: ${arg(argv, 'days', '90')}`);
    return EXIT_CANNOT_COMPUTE;
  }
  if (thresholdRaw !== '' && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)) {
    console.error(`Invalid --threshold value: ${thresholdRaw} (expected 0-100)`);
    return EXIT_CANNOT_COMPUTE;
  }

  const git = (...args) =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  // ── the horizon comes FIRST: nothing below may run on a window this
  //    checkout cannot see all of.
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  const horizon = historyHorizon({ cwd: repoRoot, ref: 'HEAD', sinceMs });
  if (!horizon.covered) {
    console.error(renderRefusal({ horizon, days, sinceIso }));
    return EXIT_CANNOT_COMPUTE;
  }

  // Commits in the window that touched the engine core.
  const shas = git('log', `--since=${sinceIso}`, '--format=%H', '--', ...ENGINE_CORE)
    .split('\n')
    .filter(Boolean);

  let crossPackage = 0;
  for (const sha of shas) {
    const files = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
    if (files.some((f) => !f.startsWith(ENGINE_PACKAGE_PREFIX))) crossPackage += 1;
  }

  const total = shas.length;
  const ratio = total === 0 ? 0 : (crossPackage / total) * 100;
  const ratioStr = ratio.toFixed(1);

  const lines = [
    `ADR-0076 D7 trigger metric — engine cross-package commit ratio`,
    `  window:               last ${days} days`,
    `  engine-core commits:  ${total}  (${ENGINE_CORE.join(', ')})`,
    `  also cross-package:   ${crossPackage}`,
    `  ratio:                ${total === 0 ? 'n/a (no engine-core commits in window)' : `${ratioStr}%`}`,
    renderHorizon(horizon),
    ``,
    `Reference: ~88% at ADR time (2026-06) — the engine repo-split (D7) stays`,
    `deferred until this ratio is low and stable (threshold TBD, ADR-0076 OQ#5).`,
  ];
  console.log(lines.join('\n'));

  // Zero is a broken scan far more often than a quiet engine (#4690). The
  // window is provably whole by now, so say so out loud rather than letting a
  // blank denominator read as a healthy 0.0%.
  if (total === 0) {
    console.error(
      `\n⚠️  ZERO engine-core commits in a ${days}-day window. The window is provably whole ` +
        `(${renderHorizon(horizon).trim()}), so this is either a genuinely dormant engine or a\n` +
        `    path that has moved — check ${ENGINE_CORE.join(' / ')} still exist before reading 0 as healthy.`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `### ADR-0076 D7 trigger metric — engine cross-package commit ratio`,
      ``,
      `| Window | Engine-core commits | Cross-package | Ratio |`,
      `|---|---|---|---|`,
      `| last ${days} days | ${total} | ${crossPackage} | ${total === 0 ? 'n/a' : `${ratioStr}%`} |`,
      ``,
      `${renderHorizon(horizon).trim()}`,
      ``,
      `Reference: ~88% at ADR time. D7 (engine repo-split) stays deferred until this is low and stable (OQ#5).`,
      ``,
    ].join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  if (threshold !== null && total > 0 && ratio > threshold) {
    console.error(`\nRatio ${ratioStr}% exceeds the configured threshold of ${threshold}% — engine is not separable.`);
    return EXIT_ABOVE_THRESHOLD;
  }
  return EXIT_OK;
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  let failures = 0;
  const t = (name, ok, detail = '') => {
    if (ok) { console.log(`  ✓ ${name}`); return; }
    failures += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  };
  const day = 24 * 60 * 60 * 1000;

  // ── pure rendering ────────────────────────────────────────────────────────
  t('a complete clone reports its horizon as complete, with the tip',
    renderHorizon({ shallow: false, tip: '2026-08-21' }).includes('complete clone')
    && renderHorizon({ shallow: false, tip: '2026-08-21' }).includes('2026-08-21'));
  t('an ALLOWED shallow answer still prints its floor — the number travels with its horizon',
    renderHorizon({ shallow: true, covered: true, floor: '2026-06-02', tip: '2026-08-21' }).includes('2026-06-02'));
  t('and the horizon line never CLAIMS the floor predates the window unless it does',
    !renderHorizon({ shallow: true, covered: false, floor: '2026-06-02', tip: '2026-08-21' }).includes('predates')
    && /INSIDE the window/.test(renderHorizon({ shallow: true, covered: false, floor: '2026-06-02', tip: '2026-08-21' })),
    renderHorizon({ shallow: true, covered: false, floor: '2026-06-02', tip: '2026-08-21' }));
  const refusal = renderRefusal({
    horizon: { reason: 'floor sits INSIDE the window', tip: '2026-08-21', remedy: 'git -C /x fetch --unshallow origin' },
    days: 90,
    sinceIso: '2026-05-23T00:00:00.000Z',
  });
  t('the refusal names the reason, the window and a runnable remedy',
    /INSIDE the window/.test(refusal) && /last 90 days/.test(refusal) && /fetch --unshallow/.test(refusal), refusal);
  t('and it prints no percentage at all — a refusal must not be quotable as a ratio',
    !/%/.test(refusal), refusal);

  // ── real repos: the defect, then both legs of the guard ───────────────────
  const root = mkdtempSync(join(tmpdir(), 'engine-split-selftest-'));
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const self = fileURLToPath(import.meta.url);
  // spawnSync, not execFileSync: this script writes to stderr on SUCCESS too
  // (the zero-scan warning), and execFileSync surfaces stderr only when it
  // throws -- a self-test that reads stderr only on failure is half blind.
  const runAllowFail = (args, cwd) => {
    const r = spawnSync(process.execPath, [self, ...args, '--cwd', cwd], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), code: r.status };
  };

  try {
    const up = join(root, 'up');
    mkdirSync(join(up, 'packages/objectql/src'), { recursive: true });
    mkdirSync(join(up, 'packages/core/src'), { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], up);
    g(['config', 'user.email', 'selftest@objectstack.ai'], up);
    g(['config', 'user.name', 'selftest'], up);
    // 40 commits, one per day, each touching engine.ts; the even ones also
    // touch another package, so the true ratio over any window is 50%.
    const start = Date.parse('2026-06-01T12:00:00Z');
    for (let i = 0; i < 40; i += 1) {
      const d = new Date(start + i * day).toISOString();
      writeFileSync(join(up, 'packages/objectql/src/engine.ts'), `// engine ${i}\n`);
      if (i % 2 === 0) writeFileSync(join(up, 'packages/core/src/index.ts'), `// core ${i}\n`);
      g(['add', '-A'], up);
      execFileSync('git', ['commit', '--quiet', '-m', `c${i}`], {
        cwd: up,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d },
      });
    }
    // `--days` is relative to now, so re-date the whole fixture to end today.
    const daysSinceFixture = Math.ceil((Date.now() - (start + 39 * day)) / day);

    const full = join(root, 'full');
    g(['clone', '--quiet', `file://${up}`, full], root);
    const shallow = join(root, 'shallow');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, shallow], root);

    const wide = String(daysSinceFixture + 45);   // reaches below the depth-5 floor
    const narrow = String(daysSinceFixture + 2);  // sits entirely above it

    // BASELINE: the defect itself, with raw git, in the shallow fixture.
    const rawWide = g(['log', `--since=${wide} days ago`, '--format=%H', '--',
      'packages/objectql/src/engine.ts'], shallow).split('\n').filter(Boolean).length;
    const rawFull = g(['log', `--since=${wide} days ago`, '--format=%H', '--',
      'packages/objectql/src/engine.ts'], full).split('\n').filter(Boolean).length;
    t('BASELINE — raw git answers the same window with a smaller number and no warning '
      + '(this is the defect, reproduced)', rawWide < rawFull && rawWide === 5 && rawFull === 40,
      `shallow ${rawWide} vs full ${rawFull}`);

    const okFull = runAllowFail(['--days', wide], full);
    t('a complete clone computes the metric, exit 0', okFull.code === 0, JSON.stringify(okFull).slice(0, 400));
    t('and the ratio is the fixture\'s real 50.0% over all 40 commits',
      /engine-core commits:  40/.test(okFull.stdout) && /ratio: *50\.0%/.test(okFull.stdout), okFull.stdout);
    t('and it states the horizon it was computed against',
      /history horizon: *complete clone/.test(okFull.stdout), okFull.stdout);

    const refused = runAllowFail(['--days', wide], shallow);
    t('the same question in the shallow clone REFUSES instead of answering', refused.code === EXIT_CANNOT_COMPUTE,
      `exit ${refused.code}: ${refused.stdout}${refused.stderr}`);
    t('and stdout carries no ratio at all, so nothing can be quoted from it',
      !/%/.test(refused.stdout) && refused.stdout.trim() === '', JSON.stringify(refused.stdout));
    t('and the refusal names the floor and a deepen command',
      /oldest visible commit on 'HEAD' is 2026-07-06/.test(refused.stderr)
      && /fetch --shallow-since=/.test(refused.stderr), refused.stderr);
    t('and the refusal exit code is NOT the threshold code — "cannot measure" never reads as '
      + '"the engine is not separable"', refused.code !== EXIT_ABOVE_THRESHOLD);

    const okNarrow = runAllowFail(['--days', narrow], shallow);
    t('a STILL-shallow clone whose floor predates the window is answered, not refused '
      + '(a bare is-shallow guard would refuse a provably correct answer)',
      okNarrow.code === 0 && /ratio: *\d/.test(okNarrow.stdout), `exit ${okNarrow.code}: ${okNarrow.stdout}${okNarrow.stderr}`);
    t('and that answer still carries the floor beside it',
      /shallow clone, oldest visible commit 2026-07-06/.test(okNarrow.stdout), okNarrow.stdout);
    t('the fixture is still shallow after that answer — the predicate is the floor, not the flag',
      g(['rev-parse', '--is-shallow-repository'], shallow).trim() === 'true');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(failures === 0
    ? `\ncheck-engine-split-ratio --self-test: all cases passed.`
    : `\ncheck-engine-split-ratio --self-test: ${failures} FAILED.`);
  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : main(process.argv.slice(2)));
