#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectui-changeset-digest — build the `@objectstack/console` changeset body
// for an objectui pin bump FROM WHAT OBJECTUI DECLARED, not from commit titles.
//
//   node scripts/objectui-changeset-digest.mjs --from <sha> --to <sha> \
//        [--objectui-root <path>] [--framework-root <path>] \
//        [--out <file>] [--bump-override minor] [--max N] [--json]
//   node scripts/objectui-changeset-digest.mjs --self-test
//
// Prints the resolved bump level (`major` | `minor` | `patch`) on stdout; the
// human-readable accounting goes to stderr. With `--out` the full changeset
// file (frontmatter included) is written there, otherwise it goes to stdout
// after the bump line is emitted to stderr instead. Exit code 2 means "the
// range is not walkable in this checkout" — the caller degrades, loudly.
//
// WHY THIS EXISTS (#4731)
// -----------------------
// `bump-objectui.sh` used to GUESS which objectui commits belonged in the
// platform release record by matching conventional-commit types on the subject
// line — `grep -iE '^- (feat|fix)'`, then `head -40`, then `grep -ciE '^feat'`
// for the bump level. Every part of that guess was measured wrong on one real
// range (`7d9734d5e321..785b8a5d432c`, 53 non-merge commits):
//
//   * It dropped ALL 9 `refactor(...)` commits, 6 of them BREAKING (`!`) —
//     including `refactor(layout)!: delete PageNodeRenderer` and the burn-ledger
//     batches (objectui#3220 / #3224) — plus `chore(deps): lockstep the
//     @objectstack family onto 17.0.0-rc.1`. Breaking changes are the single
//     class that must never vanish from a release record, and the type filter
//     made them the only class structurally unable to appear.
//   * `head -40` truncated in silence. A truncated list and a complete list are
//     indistinguishable in the artifact — which is the exact silence this
//     changeset exists to prevent (#3340).
//   * It pulled IN commits that ship nothing: two `fix(ci)` commits
//     (objectui#3198 / #3186) matched the type filter while releasing no
//     package code at all.
//
// The question the script actually needs answered is "does this commit ship in
// the frontend release?" — and objectui already DECLARES the answer. Every
// releasing PR carries a `.changeset/*.md`; an empty frontmatter block is
// changesets' own spelling of "release-nothing". So we read the changesets
// added over the range: package names say whether it releases, and the declared
// level (major/minor/patch) IS the bump — nothing is inferred from a subject
// line any more. Declaration over inference, per AGENTS.md Prime Directive #12.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** Default cap on the rendered list. A cap that fires ANNOUNCES itself (#4731). */
export const DEFAULT_MAX_ENTRIES = 100;

const LEVEL_RANK = { patch: 1, minor: 2, major: 3 };

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Parse a changeset file: the frontmatter package→level map plus the first
 * paragraph of the summary.
 *
 * An EMPTY frontmatter block (`---\n---`) is changesets' own "release-nothing"
 * marker — the file exists so the repo's own gate is satisfied, but it releases
 * no package. That is precisely the signal the old type filter could not see.
 *
 * @param {string} text
 * @returns {{ packages: Record<string, string>, summary: string }}
 */
export function parseChangeset(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Record<string, string>} */
  const packages = {};
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    for (; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        i++;
        break;
      }
      const m = /^\s*["']?([^"':]+)["']?\s*:\s*([A-Za-z]+)\s*$/.exec(lines[i]);
      if (m && LEVEL_RANK[m[2].toLowerCase()]) packages[m[1].trim()] = m[2].toLowerCase();
    }
  }
  const body = [];
  while (i < lines.length && !lines[i].trim()) i++;
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) break;
    body.push(lines[i].trim());
  }
  return { packages, summary: body.join(' ').replace(/\s+/g, ' ').trim() };
}

/** Highest declared level in a package→level map, or null when release-nothing. */
export function highestLevel(packages) {
  let best = null;
  for (const level of Object.values(packages)) {
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

/** One-line entry text, truncated AUDIBLY (never silently) at `limit` chars. */
export function clampSummary(summary, limit = 180) {
  if (summary.length <= limit) return summary;
  return `${summary.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Collect the `.changeset/*.md` files ADDED over `from..to`, newest first.
 *
 * Walks the log rather than diffing the two endpoints: a changeset consumed by
 * a release INSIDE the range is gone at `to`, and an endpoint diff would drop
 * it — the released frontend change would vanish from the release record, the
 * very failure this whole mechanism exists to prevent.
 *
 * `commits` is every non-merge commit in the range (newest first) and
 * `commitsWithChangesetShas` the subset that added one, so a caller can NAME
 * the commits it is leaving out instead of only counting them (#4843).
 *
 * @returns {{ entries: Array<{ path: string, sha: string, subject: string }>, commits: Array<{ sha: string, subject: string }>, totalCommits: number, commitsWithChangeset: number, commitsWithChangesetShas: Set<string> }}
 */
export function collectAddedChangesets(objectuiRoot, from, to) {
  const commits = git(objectuiRoot, ['log', '--no-merges', '--format=%H%x09%s', `${from}..${to}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  const totalCommits = commits.length;

  const raw = git(objectuiRoot, [
    'log',
    '--no-merges',
    '--diff-filter=A',
    '--name-only',
    '--format=%x01%H%x02%s',
    `${from}..${to}`,
    '--',
    '.changeset/',
  ]);

  /** @type {Array<{ path: string, sha: string, subject: string }>} */
  const entries = [];
  const seen = new Set();
  const commitsWithChangeset = new Set();
  let sha = '';
  let subject = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('\u0001')) {
      const sep = line.indexOf('\u0002');
      sha = line.slice(1, sep);
      subject = line.slice(sep + 1);
      continue;
    }
    const path = line.trim();
    if (!path.startsWith('.changeset/') || !path.endsWith('.md')) continue;
    if (path.endsWith('/README.md')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    commitsWithChangeset.add(sha);
    entries.push({ path, sha, subject });
  }
  return {
    entries,
    commits,
    totalCommits,
    commitsWithChangeset: commitsWithChangeset.size,
    commitsWithChangesetShas: commitsWithChangeset,
  };
}

/** Read a changeset's content at `to`, falling back to the commit that added it. */
function readAt(objectuiRoot, to, sha, path) {
  try {
    return git(objectuiRoot, ['show', `${to}:${path}`]);
  } catch {
    return git(objectuiRoot, ['show', `${sha}:${path}`]);
  }
}

/**
 * Is the framework repo in changesets pre-release (RC) mode?
 *
 * Mirrors `scripts/check-changeset-no-major.mjs`: outside an RC window a
 * `major` on any package promotes the WHOLE lockstep group, and that gate
 * rejects it. objectui marks its breaking symbol renames `major` routinely, so
 * a mechanical `major` here would make every ordinary pin refresh red. Inside
 * pre-mode a `major` only ever yields `X.0.0-<tag>.N`, which is what an RC
 * window is for — so the level passes through untouched.
 */
export function inPreMode(frameworkRoot) {
  try {
    const pre = JSON.parse(readFileSync(join(frameworkRoot, '.changeset', 'pre.json'), 'utf8'));
    return pre?.mode === 'pre';
  } catch {
    return false;
  }
}

/**
 * THE criterion: which objectui changes over `from..to` actually ship in the
 * frontend release, as objectui DECLARED it — plus a full account of what is
 * being left out and why.
 *
 * This is the single shared implementation. `bump-objectui.sh` (via
 * `buildDigest` below, #4731) and `scripts/objectui-range.mjs` (#4843) both go
 * through it, so the platform release record and the release page's Console
 * section can never disagree about what "a releasing frontend change" means.
 * Two copies of this rule would drift, and the first thing they would drift on
 * is the class that already went missing once: breaking `refactor(...)!`.
 *
 * Nothing here reads a commit type. Grouping output BY type is presentation and
 * belongs to the caller; it must never become a filter again.
 *
 * @returns {{ releasing: Array<object>, releaseNothingEntries: Array<object>, noChangesetCommits: Array<object>, releaseNothing: number, noChangeset: number, changesetsAdded: number, totalCommits: number }}
 */
export function classifyRange({ objectuiRoot, from, to }) {
  const { entries, commits, totalCommits, commitsWithChangesetShas } = collectAddedChangesets(
    objectuiRoot,
    from,
    to,
  );

  const releasing = [];
  const releaseNothingEntries = [];
  for (const entry of entries) {
    const { packages, summary } = parseChangeset(readAt(objectuiRoot, to, entry.sha, entry.path));
    const level = highestLevel(packages);
    if (!level) {
      releaseNothingEntries.push({ ...entry, summary: summary || entry.subject });
      continue;
    }
    releasing.push({
      ...entry,
      level,
      packages: Object.keys(packages),
      summary: summary || entry.subject,
    });
  }

  // Breaking first, then by declared level, then in the log's own (newest-first)
  // order. The class the old filter could not represent at all now leads.
  const order = { major: 0, minor: 1, patch: 2 };
  releasing.sort((a, b) => order[a.level] - order[b.level]);

  const noChangesetCommits = commits.filter((c) => !commitsWithChangesetShas.has(c.sha));

  return {
    releasing,
    releaseNothingEntries,
    noChangesetCommits,
    releaseNothing: releaseNothingEntries.length,
    noChangeset: noChangesetCommits.length,
    changesetsAdded: entries.length,
    totalCommits,
  };
}

/**
 * Build the digest for a range.
 *
 * @returns {{ bump: string, declaredLevel: string|null, breaking: number, releasing: Array<object>, releaseNothing: number, noChangeset: number, totalCommits: number, downgradedMajor: boolean, body: string }}
 */
export function buildDigest({
  objectuiRoot,
  frameworkRoot = REPO_ROOT,
  from,
  to,
  max = DEFAULT_MAX_ENTRIES,
  bumpOverride = '',
}) {
  const { releasing, releaseNothing, noChangeset, changesetsAdded, totalCommits } = classifyRange({
    objectuiRoot,
    from,
    to,
  });

  const declaredLevel = releasing.length
    ? releasing.reduce(
        (best, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[best] ? r.level : best),
        'patch',
      )
    : null;
  const breaking = releasing.filter((r) => r.level === 'major').length;

  let bump = bumpOverride || declaredLevel || 'patch';
  let downgradedMajor = false;
  if (!bumpOverride && bump === 'major' && !inPreMode(frameworkRoot)) {
    bump = 'minor';
    downgradedMajor = true;
  }

  const shown = releasing.slice(0, Math.max(0, max));
  const hidden = releasing.length - shown.length;

  const lines = [];
  for (const r of shown) {
    lines.push(
      `- **${r.level}** — ${clampSummary(r.summary)} (objectui \`${r.sha.slice(0, 9)}\`)`,
    );
  }
  if (hidden > 0) {
    // A cap that fires SAYS SO, with the real count. Silent truncation and no
    // truncation are indistinguishable in the artifact (#4731).
    lines.push(
      `- …and ${hidden} more releasing changeset${hidden === 1 ? '' : 's'} in this range (list capped at ${max}; see the objectui range below).`,
    );
  }
  if (!lines.length) {
    lines.push(
      '- _No releasing changeset in this range — every objectui commit here declared release-nothing._',
    );
  }

  const omitted = [];
  if (releaseNothing > 0) {
    omitted.push(
      `${releaseNothing} release-nothing changeset${releaseNothing === 1 ? '' : 's'}`,
    );
  }
  if (noChangeset > 0) {
    omitted.push(`${noChangeset} commit${noChangeset === 1 ? '' : 's'} carrying no changeset`);
  }

  const accounting =
    `Derived from the changesets objectui declared over the range — ` +
    `${releasing.length} releasing of ${changesetsAdded} changeset${changesetsAdded === 1 ? '' : 's'} added ` +
    `across ${totalCommits} non-merge commit${totalCommits === 1 ? '' : 's'}` +
    (omitted.length ? `; omitted: ${omitted.join(', ')} (they ship no package code).` : '.');

  const notes = [];
  if (breaking > 0) {
    notes.push(
      `⚠️ ${breaking} of these declare a **major** (breaking) bump in objectui` +
        (downgradedMajor
          ? `; recorded here as \`minor\` because the launch-window convention ships breaking as minor ` +
            `(\`scripts/check-changeset-no-major.mjs\`) — the breaking entries are listed above, unabridged.`
          : '.'),
    );
  }

  const body = [accounting, '', ...lines, ...(notes.length ? ['', ...notes] : [])].join('\n');

  return {
    bump,
    declaredLevel,
    breaking,
    releasing,
    releaseNothing,
    noChangeset,
    totalCommits,
    downgradedMajor,
    body,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
  };

  if (has('-h') || has('--help')) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('//'))
        .map((l) => l.slice(3))
        .join('\n'),
    );
    return 0;
  }

  if (has('--self-test')) return selfTest();

  const objectuiRoot = val('--objectui-root', join(REPO_ROOT, '..', 'objectui'));
  const frameworkRoot = val('--framework-root', REPO_ROOT);
  const from = val('--from');
  const to = val('--to');
  const out = val('--out');
  const max = Number(val('--max', String(DEFAULT_MAX_ENTRIES)));
  const bumpOverride = val('--bump-override', '');

  if (!from || !to) {
    console.error('✗ objectui-changeset-digest: --from <sha> --to <sha> are required.');
    return 1;
  }
  if (!existsSync(join(objectuiRoot, '.git'))) {
    console.error(`✗ objectui-changeset-digest: no objectui checkout at ${objectuiRoot}`);
    return 2;
  }
  try {
    git(objectuiRoot, ['cat-file', '-e', `${from}^{commit}`]);
    git(objectuiRoot, ['cat-file', '-e', `${to}^{commit}`]);
  } catch {
    console.error(
      `✗ objectui-changeset-digest: cannot walk ${from.slice(0, 12)}..${to.slice(0, 12)} in ${objectuiRoot}`,
    );
    return 2;
  }

  const digest = buildDigest({ objectuiRoot, frameworkRoot, from, to, max, bumpOverride });

  if (has('--json')) {
    console.log(JSON.stringify(digest, null, 2));
    return 0;
  }

  const short = to.slice(0, 12);
  const rangeLabel = `${from.slice(0, 12)}...${to.slice(0, 12)}`;
  const file =
    `---\n"@objectstack/console": ${digest.bump}\n---\n\n` +
    `Console (objectui) refreshed to \`${short}\`. Frontend changes in this range:\n\n` +
    `${digest.body}\n\n` +
    `objectui range: \`${rangeLabel}\`\n`;

  console.error(
    `→ ${digest.releasing.length} releasing changeset(s), ${digest.breaking} breaking, ` +
      `${digest.releaseNothing} release-nothing, ${digest.noChangeset} commit(s) without a changeset` +
      (digest.downgradedMajor ? ' — declared major recorded as minor (launch window)' : ''),
  );

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, file);
    console.log(digest.bump);
  } else {
    console.log(file);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test (#4731) — the repo idiom for a `scripts/` gate: build throwaway git
// repos, run the real code over them, assert the artifact.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const check = (name, cond, detail = '') => {
    if (cond) {
      console.log(`  ✓ ${name}`);
    } else {
      failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const tmp = mkdtempSync(join(tmpdir(), 'objectui-digest-selftest-'));
  try {
    // --- a throwaway "objectui" whose commits mirror the #4731 range shapes ---
    const ui = join(tmp, 'objectui');
    mkdirSync(join(ui, '.changeset'), { recursive: true });
    const g = (...args) => git(ui, args);
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'selftest@objectstack.ai');
    g('config', 'user.name', 'self test');
    g('config', 'commit.gpgsign', 'false');

    const commit = (subject, files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(ui, path)), { recursive: true });
        writeFileSync(join(ui, path), content);
      }
      g('add', '-A');
      g('commit', '-q', '-m', subject);
      return g('rev-parse', 'HEAD').trim();
    };

    const base = commit('chore: base', { 'README.md': 'base\n' });

    commit('feat(grid): aggregate single-call mode for bulk actions', {
      '.changeset/bulk-action-aggregate.md':
        '---\n"@object-ui/plugin-grid": minor\n---\n\nGrid bulk actions gain an aggregate single-call mode.\n',
      'src/grid.ts': 'a\n',
    });
    // The class the old `feat|fix` type filter could not represent AT ALL.
    const breakingSha = commit(
      'refactor(layout)!: delete PageNodeRenderer, the unregistered page-node renderer (#3225)',
      {
        '.changeset/remove-dead-layout-page-node-renderer.md':
          '---\n"@object-ui/layout": major\n---\n\nRemove `PageNodeRenderer`, the dead page-node renderer (objectui#3223).\n',
        'src/layout.ts': 'b\n',
      },
    );
    commit('chore(deps): lockstep the @objectstack family onto 17.0.0-rc.1 (#3189)', {
      '.changeset/objectstack-family-rc1-lockstep.md':
        '---\n"@object-ui/app-shell": minor\n"@object-ui/core": minor\n---\n\nBring the whole `@objectstack` family to `17.0.0-rc.1`.\n',
      'package.json': '{}\n',
    });
    // Matches `fix|feat` on the subject but declares release-nothing.
    commit('fix(ci): hand the cross-repo token to github-script (#3186)', {
      '.changeset/fix-cross-repo-closer-require.md':
        '---\n---\n\nfix(ci): hand the cross-repo token to github-script\n\nRelease-nothing: touches a workflow only.\n',
      '.github/workflows/x.yml': 'on: push\n',
    });
    // Matches the type filter and carries no changeset at all.
    commit('fix(ci): never render a budget FAIL for a run that measured nothing (#3198)', {
      '.github/workflows/y.yml': 'on: push\n',
    });
    const head = g('rev-parse', 'HEAD').trim();

    // --- a "framework" root without pre.json (launch window, no RC) ---
    const fwPlain = join(tmp, 'fw-plain');
    mkdirSync(join(fwPlain, '.changeset'), { recursive: true });
    // --- and one in RC pre-mode ---
    const fwPre = join(tmp, 'fw-pre');
    mkdirSync(join(fwPre, '.changeset'), { recursive: true });
    writeFileSync(join(fwPre, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}\n');

    const digest = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPre,
      from: base,
      to: head,
    });

    console.log('objectui-changeset-digest --self-test');
    check(
      'releasing list is derived from changesets, not commit types (3 of 4 added)',
      digest.releasing.length === 3,
      `got ${digest.releasing.length}`,
    );
    check(
      'a breaking `refactor(...)!` commit IS represented',
      digest.body.includes('PageNodeRenderer') && digest.body.includes(breakingSha.slice(0, 9)),
    );
    check(
      'a non-feat/fix `chore(deps)` commit that releases IS represented',
      digest.body.includes('Bring the whole'),
    );
    check(
      'a `fix(ci)` commit with an EMPTY frontmatter changeset is NOT represented',
      !digest.body.includes('cross-repo token'),
    );
    check(
      'a `fix(ci)` commit with no changeset at all is NOT represented',
      !digest.body.includes('budget FAIL'),
    );
    check('release-nothing changesets are counted, not dropped in silence', digest.releaseNothing === 1);
    check(
      'commits without a changeset are counted, not dropped in silence',
      digest.noChangeset === 1,
      `got ${digest.noChangeset}`,
    );
    check('the accounting states the omissions', digest.body.includes('omitted:'));
    check('the declared level drives the bump (major declared)', digest.declaredLevel === 'major');
    check('breaking count is surfaced in the body', digest.body.includes('⚠️ 1 of these declare'));
    check('in RC pre-mode a declared major stays major', digest.bump === 'major');

    const plain = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPlain,
      from: base,
      to: head,
    });
    check(
      'outside pre-mode a declared major records as minor — AUDIBLY',
      plain.bump === 'minor' && plain.downgradedMajor && plain.body.includes('launch-window'),
    );

    const overridden = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPre,
      from: base,
      to: head,
      bumpOverride: 'patch',
    });
    check('CONSOLE_BUMP still overrides the derived level', overridden.bump === 'patch');

    const capped = buildDigest({
      objectuiRoot: ui,
      frameworkRoot: fwPre,
      from: base,
      to: head,
      max: 1,
    });
    check(
      'a cap that fires ANNOUNCES itself with the real count',
      capped.body.includes('…and 2 more releasing changesets'),
      capped.body,
    );

    // --- end-to-end through the shell driver -------------------------------
    const fwRun = join(tmp, 'fw-run');
    mkdirSync(join(fwRun, 'scripts'), { recursive: true });
    mkdirSync(join(fwRun, '.changeset'), { recursive: true });
    writeFileSync(join(fwRun, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}\n');
    writeFileSync(join(fwRun, '.objectui-sha'), `${base}\n`);
    for (const f of ['bump-objectui.sh', 'objectui-changeset-digest.mjs']) {
      writeFileSync(join(fwRun, 'scripts', f), readFileSync(join(__dirname, f), 'utf8'));
    }
    execFileSync('bash', [join(fwRun, 'scripts', 'bump-objectui.sh'), '--no-commit', head], {
      encoding: 'utf8',
      env: { ...process.env, OBJECTUI_ROOT: ui },
    });
    const written = join(fwRun, '.changeset', `console-${head.slice(0, 12)}.md`);
    const body = existsSync(written) ? readFileSync(written, 'utf8') : '';
    check('bump-objectui.sh writes the digest-derived changeset', body.length > 0);
    check(
      'the emitted changeset declares the derived bump',
      body.startsWith('---\n"@objectstack/console": major\n---'),
      body.slice(0, 60),
    );
    check(
      'the emitted changeset carries the breaking entry and not the ci noise',
      body.includes('PageNodeRenderer') && !body.includes('cross-repo token'),
    );
    check('the pin file is updated', readFileSync(join(fwRun, '.objectui-sha'), 'utf8').trim() === head);

    // --- degraded range: the fallback must SAY it is degraded --------------
    const fwDegraded = join(tmp, 'fw-degraded');
    mkdirSync(join(fwDegraded, 'scripts'), { recursive: true });
    mkdirSync(join(fwDegraded, '.changeset'), { recursive: true });
    writeFileSync(join(fwDegraded, '.objectui-sha'), `${'0'.repeat(40)}\n`);
    for (const f of ['bump-objectui.sh', 'objectui-changeset-digest.mjs']) {
      writeFileSync(join(fwDegraded, 'scripts', f), readFileSync(join(__dirname, f), 'utf8'));
    }
    execFileSync('bash', [join(fwDegraded, 'scripts', 'bump-objectui.sh'), '--no-commit', head], {
      encoding: 'utf8',
      env: { ...process.env, OBJECTUI_ROOT: ui },
    });
    const degraded = readFileSync(
      join(fwDegraded, '.changeset', `console-${head.slice(0, 12)}.md`),
      'utf8',
    );
    check(
      'an unwalkable range degrades LOUDLY, not silently',
      degraded.includes('could not be walked') &&
        degraded.includes('**Degraded list**') &&
        degraded.includes('NOT a\ncomplete account'),
      degraded,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n⛔ objectui-changeset-digest --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log('✓ objectui-changeset-digest --self-test: all checks passed');
  return 0;
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
