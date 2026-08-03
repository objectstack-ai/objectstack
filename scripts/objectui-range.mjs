#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectui-range — summarize the frontend (objectui) delta bundled between two
// framework revisions, ready to paste into a release page's Console section.
//
// The platform is one version-locked train and the Console UI is frozen into
// @objectstack/console at the objectui commit pinned in .objectui-sha. To learn
// "what did the frontend change between platform version A and B", you diff the
// pinned SHA at two framework revisions and read what objectui DECLARED over
// that range. This script does exactly that — the aggregation layer described in
// docs/releases-maintenance.md.
//
// Usage:
//   node scripts/objectui-range.mjs <old-rev> [new-rev]
//       old-rev / new-rev are FRAMEWORK git refs (tags, branches, SHAs).
//       new-rev defaults to the working-tree .objectui-sha (the current pin).
//   node scripts/objectui-range.mjs --from <objectui-sha> --to <objectui-sha>
//       skip the framework lookup; use explicit objectui SHAs.
//   … --json     emit structured JSON instead of markdown
//   … --all      also itemize what ships nothing (release-nothing changesets and
//                commits carrying no changeset), not just count them
//   … --self-test  run the built-in assertions over throwaway git repos
//
// Env:
//   OBJECTUI_ROOT=/path/to/objectui   (default: ../objectui, like bump-objectui.sh)
//
// WHAT COUNTS AS A FRONTEND CHANGE HERE (#4843)
// ---------------------------------------------
// The releasing entries come from `classifyRange()` in
// scripts/objectui-changeset-digest.mjs — the SAME function `bump-objectui.sh`
// uses to write the pin changeset (#4731). One criterion, two consumers: the
// platform release record and this release-page section can no longer disagree
// about which frontend changes shipped.
//
// This script used to guess instead, keeping only `feat` + `fix` subject lines
// unless you passed `--all`. Measured on the real range
// `7d9734d5e321..785b8a5d432c` (53 non-merge commits, objectui), that guess:
//
//   * DROPPED 13 commits that actually released, 6 of them BREAKING (`!`):
//     `refactor(layout)!: delete PageNodeRenderer` and burn-ledger batches
//     2/4/5/6/7 — plus `chore(deps): lockstep the @objectstack family onto
//     17.0.0-rc.1`. Breaking changes were the single class structurally unable
//     to appear, in the artifact that leads with breaking changes.
//   * PULLED IN 5 commits that release nothing in objectui, two of them
//     `fix(ci)` (one with no changeset at all, one whose changeset has an empty
//     frontmatter — changesets' own spelling of "release-nothing").
//
// The output is a release page's body, so a reader cannot tell a filtered list
// from a complete one. Hence: the accounting footer is UNCONDITIONAL — every
// excluded item is counted out loud in the artifact itself, and `--all` names
// them. Headings group by the level objectui declared; grouping is presentation
// and must never become a filter again. Declaration over inference, per
// AGENTS.md Prime Directive #12.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { classifyRange, clampSummary } from './objectui-changeset-digest.mjs';

const FRAMEWORK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter(
  (a, i) => !a.startsWith('--') && argv[i - 1] !== '--from' && argv[i - 1] !== '--to',
);

const JSON_OUT = has('--json');
const SHOW_EXCLUDED = has('--all');

if (has('-h') || has('--help')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('//'))
      .map((l) => l.slice(3))
      .join('\n'),
  );
  process.exit(0);
}

function die(msg) {
  console.error(`✗ objectui-range: ${msg}`);
  process.exit(1);
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

// Resolve the objectui SHA pinned at a given framework rev (or the working tree).
function pinAt(root, rev) {
  if (rev === undefined) {
    const p = join(root, '.objectui-sha');
    if (!existsSync(p)) die('.objectui-sha not found in the working tree');
    return readFileSync(p, 'utf8').trim();
  }
  try {
    return git(root, ['show', `${rev}:.objectui-sha`]).trim();
  } catch {
    return die(`cannot read .objectui-sha at framework rev '${rev}'`);
  }
}

const CC = /^(feat|fix|refactor|perf|docs|test|chore|build|ci|style|revert)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/** Conventional-commit scope, when the subject has one. PRESENTATION ONLY. */
function scopeOf(subject) {
  const m = subject.match(CC);
  return m ? m[2] || '' : '';
}

/** Declared level → the release-page heading it belongs under. */
const SECTIONS = [
  ['major', 'Breaking changes'],
  ['minor', 'Features'],
  ['patch', 'Fixes'],
];

/**
 * Render the Console section for a classified range.
 *
 * Every count that could hide something is in the returned markdown, always —
 * including the zeros. A footer that only appears when something was dropped
 * still leaves the reader unable to tell "nothing dropped" from "footer not
 * implemented".
 */
export function renderRange({ fromSha, toSha, classified, showExcluded = false }) {
  const { releasing, releaseNothingEntries, noChangesetCommits, changesetsAdded, totalCommits } =
    classified;

  const areaCounts = {};
  for (const r of releasing) {
    const scope = scopeOf(r.subject);
    if (scope) areaCounts[scope] = (areaCounts[scope] || 0) + 1;
  }
  const topAreas = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const line = (r) => {
    const scope = scopeOf(r.subject) || r.packages[0] || '';
    return `- ${scope ? `**${scope}** — ` : ''}${clampSummary(r.summary)} (objectui \`${r.sha.slice(0, 9)}\`)`;
  };

  const out = [];
  out.push(
    `<!-- objectui ${fromSha.slice(0, 12)}..${toSha.slice(0, 12)} — ` +
      `${releasing.length} releasing changeset(s) of ${changesetsAdded} added ` +
      `across ${totalCommits} non-merge commit(s) -->`,
  );
  if (topAreas.length) {
    out.push('', `_Largest areas: ${topAreas.map(([a, n]) => `${a} (${n})`).join(', ')}_`);
  }

  for (const [level, heading] of SECTIONS) {
    const group = releasing.filter((r) => r.level === level);
    if (group.length) out.push('', `### ${heading}`, ...group.map(line));
  }

  if (!releasing.length) {
    out.push(
      '',
      '_No releasing changeset in this range — every objectui commit here ships nothing._',
    );
  }

  // --- the accounting. UNCONDITIONAL: a release page reader cannot otherwise
  // tell a filtered list from a complete one (#4843 / #3340). ---
  const excluded = [
    `${releaseNothingEntries.length} release-nothing changeset${releaseNothingEntries.length === 1 ? '' : 's'}`,
    `${noChangesetCommits.length} commit${noChangesetCommits.length === 1 ? '' : 's'} carrying no changeset`,
  ];
  out.push(
    '',
    `_Derived from the changesets objectui declared over this range — ` +
      `${releasing.length} releasing of ${changesetsAdded} added across ${totalCommits} non-merge commit(s). ` +
      `Excluded as shipping no package code: ${excluded.join(', ')}` +
      `${showExcluded ? '' : ' (run with `--all` to list them)'}._`,
  );

  if (showExcluded) {
    const rows = [
      ...releaseNothingEntries.map(
        (e) => `- _(release-nothing)_ ${e.subject} (objectui \`${e.sha.slice(0, 9)}\`)`,
      ),
      ...noChangesetCommits.map(
        (c) => `- _(no changeset)_ ${c.subject} (objectui \`${c.sha.slice(0, 9)}\`)`,
      ),
    ];
    out.push('', '### Excluded — ships no package code');
    out.push(...(rows.length ? rows : ['- _(nothing excluded in this range)_']));
  }

  return { markdown: out.join('\n'), topAreas };
}

function main() {
  let fromSha = val('--from');
  let toSha = val('--to');
  if (!fromSha || !toSha) {
    if (positional.length < 1) {
      die('need <old-rev> [new-rev], or --from <sha> --to <sha>. See --help/header.');
    }
    fromSha = pinAt(FRAMEWORK_ROOT, positional[0]);
    toSha = pinAt(FRAMEWORK_ROOT, positional[1]); // undefined → working-tree pin
  }

  const objectuiRoot = process.env.OBJECTUI_ROOT || join(FRAMEWORK_ROOT, '..', 'objectui');

  if (!existsSync(join(objectuiRoot, '.git'))) {
    die(
      `no objectui checkout at ${objectuiRoot}.\n` +
        `  Clone it as a sibling, or set OBJECTUI_ROOT=/path/to/objectui.\n` +
        `  Range to inspect once available: ${fromSha.slice(0, 12)}..${toSha.slice(0, 12)}`,
    );
  }

  if (fromSha === toSha) {
    console.log(
      `objectui unchanged (${fromSha.slice(0, 12)}) — no frontend delta in this range.`,
    );
    return 0;
  }

  let classified;
  try {
    classified = classifyRange({ objectuiRoot, from: fromSha, to: toSha });
  } catch {
    die(
      `cannot walk ${fromSha.slice(0, 12)}..${toSha.slice(0, 12)} in ${objectuiRoot}.\n` +
        `  Fetch it: git -C ${objectuiRoot} fetch --all`,
    );
  }

  const { markdown, topAreas } = renderRange({
    fromSha,
    toSha,
    classified,
    showExcluded: SHOW_EXCLUDED,
  });

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          from: fromSha,
          to: toSha,
          criterion: 'declared-changeset',
          count: classified.releasing.length,
          totalCommits: classified.totalCommits,
          changesetsAdded: classified.changesetsAdded,
          releaseNothing: classified.releaseNothing,
          noChangeset: classified.noChangeset,
          topAreas,
          releasing: classified.releasing,
          releaseNothingEntries: classified.releaseNothingEntries,
          noChangesetCommits: classified.noChangesetCommits,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(markdown);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test (#4843) — the repo idiom for a `scripts/` gate: build a throwaway
// git repo carrying the exact shapes measured on the real range, run the real
// code over it, assert the ARTIFACT (the markdown a maintainer pastes).
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

  const tmp = mkdtempSync(join(tmpdir(), 'objectui-range-selftest-'));
  try {
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

    // The five shapes measured on 7d9734d5e321..785b8a5d432c.
    // 1. an ordinary releasing `feat` — the only shape the old filter got right
    commit('feat(grid): aggregate single-call mode for bulk actions (#3201)', {
      '.changeset/bulk-action-aggregate.md':
        '---\n"@object-ui/plugin-grid": minor\n---\n\nGrid bulk actions gain an aggregate single-call mode.\n',
      'src/grid.ts': 'a\n',
    });
    // 2. a BREAKING `refactor(...)!` — structurally invisible to a feat|fix filter
    const breakingSha = commit(
      'refactor(layout)!: delete PageNodeRenderer, the unregistered page-node renderer (#3225)',
      {
        '.changeset/remove-dead-layout-page-node-renderer.md':
          '---\n"@object-ui/layout": major\n---\n\nRemove `PageNodeRenderer`, the dead page-node renderer (objectui#3223).\n',
        'src/layout.ts': 'b\n',
      },
    );
    // 3. a releasing `chore(deps)` — also invisible to a feat|fix filter
    commit('chore(deps): lockstep the @objectstack family onto 17.0.0-rc.1 (#3189)', {
      '.changeset/objectstack-family-rc1-lockstep.md':
        '---\n"@object-ui/app-shell": minor\n"@object-ui/core": minor\n---\n\nBring the whole `@objectstack` family to `17.0.0-rc.1`.\n',
      'package.json': '{}\n',
    });
    // 4. matches `fix` on the subject, declares release-nothing (empty frontmatter)
    commit('fix(ci): hand the cross-repo token to github-script (#3186)', {
      '.changeset/fix-cross-repo-closer-require.md':
        '---\n---\n\nfix(ci): hand the cross-repo token to github-script\n\nRelease-nothing: touches a workflow only.\n',
      '.github/workflows/x.yml': 'on: push\n',
    });
    // 5. matches `fix` on the subject, carries no changeset at all
    commit('fix(ci): never render a budget FAIL for a run that measured nothing (#3198)', {
      '.github/workflows/y.yml': 'on: push\n',
    });
    const head = g('rev-parse', 'HEAD').trim();

    console.log('objectui-range --self-test');

    const classified = classifyRange({ objectuiRoot: ui, from: base, to: head });
    const { markdown } = renderRange({ fromSha: base, toSha: head, classified });

    // --- the class that went missing: it must be IN the artifact, and lead ---
    check(
      'a BREAKING `refactor(...)!` commit IS in the pasteable list',
      markdown.includes('PageNodeRenderer') && markdown.includes(breakingSha.slice(0, 9)),
      markdown,
    );
    check(
      'breaking changes get their own leading section (declared major)',
      markdown.indexOf('### Breaking changes') > -1 &&
        markdown.indexOf('### Breaking changes') < markdown.indexOf('### Features'),
      markdown,
    );
    check(
      'a releasing non-feat/fix `chore(deps)` commit IS in the list',
      markdown.includes('Bring the whole'),
      markdown,
    );
    check(
      'commit type never filters: all 3 releasing changesets are listed',
      classified.releasing.length === 3,
      `got ${classified.releasing.length}`,
    );

    // --- what ships nothing is excluded, and SAYS SO in the artifact ---
    check(
      'a `fix(ci)` with an EMPTY frontmatter changeset is NOT listed',
      !markdown.includes('cross-repo token'),
      markdown,
    );
    check(
      'a `fix(ci)` with no changeset at all is NOT listed',
      !markdown.includes('budget FAIL'),
      markdown,
    );
    check(
      'the release-nothing count is spoken IN THE MARKDOWN, not just in JSON',
      classified.releaseNothing === 1 && markdown.includes('1 release-nothing changeset'),
      markdown,
    );
    check(
      'the no-changeset commit count is spoken IN THE MARKDOWN',
      classified.noChangeset === 1 && markdown.includes('1 commit carrying no changeset'),
      markdown,
    );
    check(
      'the accounting footer is unconditional and states the totals',
      markdown.includes('3 releasing of 4 added across 5 non-merge commit(s)'),
      markdown,
    );

    // --- a range that excludes NOTHING still says so (zeros are load-bearing) ---
    const clean = renderRange({
      fromSha: base,
      toSha: head,
      classified: {
        ...classified,
        releaseNothingEntries: [],
        noChangesetCommits: [],
        releaseNothing: 0,
        noChangeset: 0,
      },
    });
    check(
      'a range excluding nothing STILL prints the accounting (0, not silence)',
      clean.markdown.includes('0 release-nothing changesets') &&
        clean.markdown.includes('0 commits carrying no changeset'),
      clean.markdown,
    );

    // --- `--all` names the excluded entries instead of only counting them ---
    const all = renderRange({ fromSha: base, toSha: head, classified, showExcluded: true });
    check(
      '`--all` itemizes the excluded commits by subject',
      all.markdown.includes('### Excluded — ships no package code') &&
        all.markdown.includes('cross-repo token') &&
        all.markdown.includes('budget FAIL'),
      all.markdown,
    );

    // --- end-to-end through the real CLI ------------------------------------
    const cli = fileURLToPath(import.meta.url);
    const run = (args) =>
      execFileSync('node', [cli, ...args], {
        encoding: 'utf8',
        env: { ...process.env, OBJECTUI_ROOT: ui },
      });
    const cliMd = run(['--from', base, '--to', head]);
    check(
      'the CLI markdown carries the breaking entry and not the ci noise',
      cliMd.includes('PageNodeRenderer') && !cliMd.includes('cross-repo token'),
      cliMd,
    );
    const cliJson = JSON.parse(run(['--from', base, '--to', head, '--json']));
    check(
      'the CLI JSON reports the declared criterion and the excluded counts',
      cliJson.criterion === 'declared-changeset' &&
        cliJson.count === 3 &&
        cliJson.releaseNothing === 1 &&
        cliJson.noChangeset === 1,
      JSON.stringify(cliJson).slice(0, 200),
    );
    check(
      'every listed entry carries the level objectui declared',
      cliJson.releasing.every((r) => ['major', 'minor', 'patch'].includes(r.level)) &&
        cliJson.releasing.filter((r) => r.level === 'major').length === 1,
      JSON.stringify(cliJson.releasing.map((r) => r.level)),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n⛔ objectui-range --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log('✓ objectui-range --self-test: all checks passed');
  return 0;
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(has('--self-test') ? selfTest() : main());
}
