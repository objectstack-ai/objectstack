import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
//
// A NAMESPACE import, not named ones, and on purpose: the repository-state test
// below has to stay runnable against an older copy of the gate that lacks some
// of these exports (that is how its ablation leg is read — restore the old
// gate, watch the repository-state assertion go red). A named import of a
// missing export fails the whole file at link time instead, before any
// assertion runs, which would make that red say nothing.
import * as gate from '../check-changeset-no-major.mjs';
import { PACKAGE_ROOTS, RUNTIME_FIELDS } from '../check-phantom-dependencies.mjs';
import { maskComments } from '../js-comment-mask.mjs';

const mask: (source: string) => string = maskComments;

/**
 * objectui's major is not a count of its own breaking changes — it is pinned to
 * the `@objectstack` major so that "same major ⇒ compatible" holds across the
 * two repos (AGENTS.md §版本号策略). Since every publishable package sits in one
 * `fixed` group, ONE `major` in ONE changeset publishes all 39 of them as the
 * next major and breaks that pin.
 *
 * Four pending changesets had scored `major` (17 package entries) during the
 * 17.x line, which would have shipped 39 packages as 18.0.0 against an
 * `@objectstack` still on 17. The rule was written down and nothing ran it:
 * back then `ci.yml` and `lint.yml` both carried `paths-ignore` on their
 * `pull_request` trigger with `.changeset/**` in it, so a changeset-only PR
 * started no workflow at all.
 *
 * That last sentence is history. objectui#3523 step 2 deleted `paths-ignore`
 * from those `pull_request` triggers — it survives only on `push` — so such a
 * PR does start both workflows and does produce their contexts today. What it
 * still does not do is run anything expensive in them: the `Decide whether this
 * change needs a full run` step excludes markdown and `.changeset/**` and skips
 * every step below itself. Either way no gate inside those workflows reads the
 * changeset, which is why the locks below still stand (objectui#3857).
 *
 * The one `major` the rule admits — the synchronized bump that follows
 * `@objectstack` across its own major — is computed by the gate from the
 * group's own manifests (objectui#12334, under the maintainer's ruling on
 * objectui#12030). The fixtures below pin both directions of that computation.
 *
 * These tests are the second lock. `.github/workflows/changeset-guard.yml`
 * catches it on the PR that adds the changeset; the repo-state test below
 * catches it in `pnpm test` even if that workflow is ever removed or its
 * trigger stops matching.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const changesetDir = path.join(repoRoot, '.changeset');
const workflowDir = path.join(repoRoot, '.github/workflows');
const GATE = path.join(repoRoot, 'scripts/check-changeset-no-major.mjs');

interface Entry {
  file: string;
  pkg: string;
  line: number;
  reason?: string;
  from?: number;
  to?: number;
}
interface Verdict {
  offenders: Entry[];
  admitted: Entry[];
  refused: Entry[];
}

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

interface FixtureMember {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * A throwaway checkout: a `.changeset/` with `config.json` (one `fixed` group)
 * and the given changesets, plus one `packages/NAME/package.json` per member.
 * A changeset key containing `/` is written to that relative path, so
 * `pre/x.md` lands in `.changeset/pre/`.
 */
function checkout({
  members,
  outside = [],
  changesets,
  config = true,
}: {
  members: FixtureMember[];
  outside?: FixtureMember[];
  changesets: Record<string, string>;
  config?: boolean;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeset-no-major-'));
  fixtures.push(dir);
  fs.mkdirSync(path.join(dir, '.changeset'), { recursive: true });
  if (config) {
    fs.writeFileSync(
      path.join(dir, '.changeset/config.json'),
      JSON.stringify({ fixed: [members.map((m) => m.name)], ignore: outside.map((m) => m.name) })
    );
  }
  for (const member of [...members, ...outside]) {
    const pkgDir = path.join(dir, 'packages', member.name.split('/').pop()!);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(member));
  }
  for (const [name, source] of Object.entries(changesets)) {
    const file = path.join(dir, '.changeset', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}

const changeset = (entries: Record<string, string>) =>
  ['---', ...Object.entries(entries).map(([pkg, bump]) => `"${pkg}": ${bump}`), '---', '', 'Body.'].join('\n');

const SPEC = '@objectstack/spec';
const member = (name: string, version: string, spec?: string, field = 'dependencies'): FixtureMember => ({
  name,
  version,
  ...(spec ? { [field]: { [SPEC]: spec } } : {}),
});

/** The repository's shape on the day of the synchronized major: group on 17, spec on 18. */
const syncGroup = () => [
  member('@object-ui/core', '17.7.0', '^18.0.0-next.1'),
  member('@object-ui/react', '17.7.0', '^18.0.0-next.1', 'peerDependencies'),
  member('@object-ui/i18n', '17.7.0'),
];

const verdictOf = (dir: string) => gate.analyze(dir) as Verdict;

describe('parseFrontmatterBumps', () => {
  it('reads the package/bump pairs out of the frontmatter block', () => {
    const source = [
      '---',
      '"@object-ui/layout": minor',
      "'@object-ui/fields': patch",
      '@object-ui/core: minor',
      '---',
      '',
      'Body text.',
    ].join('\n');

    expect(gate.parseFrontmatterBumps(source)).toEqual([
      { pkg: '@object-ui/layout', bump: 'minor', line: 2 },
      { pkg: '@object-ui/fields', bump: 'patch', line: 3 },
      { pkg: '@object-ui/core', bump: 'minor', line: 4 },
    ]);
  });

  it('stops at the closing `---`, so prose about a bump is not a bump', () => {
    // Changeset bodies in this repo discuss the major/minor call explicitly —
    // and a body may hold a fenced YAML example. Neither may register as a
    // declaration, or the guard would fail on a changeset that is obeying it.
    const source = [
      '---',
      '"@object-ui/layout": minor',
      '---',
      '',
      'Scored `minor`, not `major`, per the fixed-group rule.',
      '',
      '```yaml',
      '"@object-ui/layout": major',
      '```',
    ].join('\n');

    expect(gate.parseFrontmatterBumps(source)).toEqual([
      { pkg: '@object-ui/layout', bump: 'minor', line: 2 },
    ]);
    expect(gate.findMajorBumps([{ file: 'x.md', source }])).toEqual([]);
  });

  it('returns nothing for a file with no frontmatter', () => {
    expect(gate.parseFrontmatterBumps('# Just a readme\n')).toEqual([]);
  });
});

describe('findMajorBumps', () => {
  it('reports every major entry with a file:line to jump to', () => {
    const source = ['---', '"@object-ui/auth": major', '"@object-ui/react": minor', '---'].join(
      '\n'
    );

    expect(gate.findMajorBumps([{ file: '.changeset/a.md', source }])).toEqual([
      { file: '.changeset/a.md', pkg: '@object-ui/auth', line: 2 },
    ]);
  });
});

describe('reading a major', () => {
  it('reads the major of a release or a prerelease version', () => {
    expect(gate.majorOfVersion('17.7.0')).toBe(17);
    expect(gate.majorOfVersion('18.0.0-next.0')).toBe(18);
    for (const version of ['', '18', '18.0', 'v18.0.0', '18.0.0+build.1', undefined]) {
      expect(() => gate.majorOfVersion(version), String(version)).toThrow();
    }
  });

  it('reads the ONE major a narrow range names, prerelease included', () => {
    expect(gate.majorOfRange('^18.0.0-next.1')).toBe(18);
    expect(gate.majorOfRange('^17.0.0')).toBe(17);
    expect(gate.majorOfRange('~18.1.0')).toBe(18);
    expect(gate.majorOfRange('=18.0.0')).toBe(18);
    expect(gate.majorOfRange('18.0.0-next.1')).toBe(18);
  });

  it('THROWS on a range that names no single major, rather than guessing one', () => {
    // A guess is what would admit a `major`; a throw refuses it.
    for (const range of ['>=18.0.0', '^17.0.0 || ^18.0.0', '18.x', '*', 'latest', 'workspace:*', '', '>=17.1.0 <18.0.0']) {
      expect(() => gate.majorOfRange(range), range).toThrow(/names no single major/);
    }
  });
});

describe('the synchronized major (the ruling on objectui#12030)', () => {
  it('ADMITS a major that carries the group exactly onto the spec major it declares', () => {
    const dir = checkout({
      members: syncGroup(),
      changesets: { 'sync.md': changeset({ '@object-ui/core': 'major', '@object-ui/i18n': 'major' }) },
    });
    const verdict = verdictOf(dir);
    expect(verdict.refused).toEqual([]);
    expect(verdict.admitted.map(({ pkg, from, to }) => `${pkg} ${from}->${to}`)).toEqual([
      '@object-ui/core 17->18',
      '@object-ui/i18n 17->18',
    ]);
  });

  it('REFUSES a major when the group is already on the spec major', () => {
    const dir = checkout({
      members: [member('@object-ui/core', '18.0.0', '^18.0.0'), member('@object-ui/react', '18.0.0', '^18.0.0')],
      changesets: { 'again.md': changeset({ '@object-ui/react': 'major' }) },
    });
    const verdict = verdictOf(dir);
    expect(verdict.admitted).toEqual([]);
    expect(verdict.refused).toHaveLength(1);
    expect(verdict.refused[0].reason).toContain('from 18 to 19');
    expect(verdict.refused[0].reason).toContain('names 18');
  });

  it('REFUSES a major two below the spec major — one major cannot land on it', () => {
    const dir = checkout({
      members: [member('@object-ui/core', '16.3.0', '^18.0.0-next.1')],
      changesets: { 'skip.md': changeset({ '@object-ui/core': 'major' }) },
    });
    const verdict = verdictOf(dir);
    expect(verdict.admitted).toEqual([]);
    expect(verdict.refused[0].reason).toContain('from 16 to 17');
  });

  it('REFUSES a major on a package outside the fixed group', () => {
    const dir = checkout({
      members: syncGroup(),
      outside: [member('@object-ui/site', '17.7.0', '^18.0.0-next.1')],
      changesets: { 'site.md': changeset({ '@object-ui/site': 'major' }) },
    });
    const verdict = verdictOf(dir);
    expect(verdict.admitted).toEqual([]);
    expect(verdict.refused[0].reason).toMatch(/not in a `fixed` group/);
  });

  it('REFUSES when a member declares a range that names no single major', () => {
    const dir = checkout({
      members: [...syncGroup(), member('@object-ui/fields', '17.7.0', '>=18.0.0-next.1')],
      changesets: { 'sync.md': changeset({ '@object-ui/core': 'major' }) },
    });
    const verdict = verdictOf(dir);
    expect(verdict.admitted).toEqual([]);
    expect(verdict.refused[0].reason).toContain('>=18.0.0-next.1');
  });

  it('REFUSES when members declare the spec on different majors', () => {
    const dir = checkout({
      members: [...syncGroup(), member('@object-ui/fields', '17.7.0', '^17.6.0')],
      changesets: { 'sync.md': changeset({ '@object-ui/core': 'major' }) },
    });
    expect(verdictOf(dir).refused[0].reason).toMatch(/different majors/);
  });

  it('REFUSES when members are on different version majors', () => {
    const dir = checkout({
      members: [...syncGroup(), member('@object-ui/fields', '16.9.0', '^18.0.0-next.1')],
      changesets: { 'sync.md': changeset({ '@object-ui/core': 'major' }) },
    });
    expect(verdictOf(dir).refused[0].reason).toMatch(/members are on different majors/);
  });

  it('reads consumer-facing fields only: a devDependencies range names nothing', () => {
    const dir = checkout({
      members: [member('@object-ui/core', '17.7.0', '^18.0.0-next.1', 'devDependencies')],
      changesets: { 'sync.md': changeset({ '@object-ui/core': 'major' }) },
    });
    const verdict = verdictOf(dir);
    expect(verdict.admitted).toEqual([]);
    expect(verdict.refused[0].reason).toMatch(/no member of the group declares/);
  });

  it('REFUSES every major when the release group cannot be read', () => {
    const dir = checkout({
      members: syncGroup(),
      config: false,
      changesets: { 'sync.md': changeset({ '@object-ui/core': 'major' }) },
    });
    expect(verdictOf(dir).refused[0].reason).toMatch(/release group could not be read/);
  });

  it('reads nothing beyond `.changeset/*.md` when no major is pending', () => {
    // No config, no manifests: the common case must not depend on them.
    const dir = checkout({ members: [], config: false, changesets: { 'fix.md': changeset({ '@object-ui/core': 'patch' }) } });
    expect(verdictOf(dir)).toEqual({ offenders: [], admitted: [], refused: [] });
  });

  it('restates the sibling gate\'s package roots and consumer fields exactly', () => {
    // Restated because that module imports `typescript` and this gate runs in a
    // bare checkout; pinned here so the two copies cannot drift apart.
    expect(gate.GROUP_ROOTS).toEqual(PACKAGE_ROOTS);
    expect(gate.CONSUMER_FIELDS).toEqual(RUNTIME_FIELDS);
  });

  it('reads no environment: the admission is computed, never switched on', () => {
    // The retired `OBJECTUI_ALLOW_MAJOR` switch admitted EVERY `major` for as
    // long as it was set. Comments are masked first: the header names it.
    const code = mask(fs.readFileSync(GATE, 'utf8'));
    expect(code).not.toContain('process.env');
  });
});

describe('Changesets pre mode: `.changeset/pre/` holds consumed changesets', () => {
  // Measured against the installed `@changesets/cli` 3: in pre mode,
  // `changeset version` MOVES each consumed changeset to `.changeset/pre/` and
  // bumps the group to `X.0.0-TAG.N`. These two cases are the tree it leaves.
  const prereleased = () => [
    member('@object-ui/core', '18.0.0-next.0', '^18.0.0-next.1'),
    member('@object-ui/react', '18.0.0-next.0', '^18.0.0-next.1', 'peerDependencies'),
  ];

  it('does not trip on the consumed synchronized major', () => {
    const dir = checkout({
      members: prereleased(),
      changesets: {
        'pre.json': JSON.stringify({ mode: 'pre', tag: 'next' }),
        'pre/sync.md': changeset({ '@object-ui/core': 'major', '@object-ui/react': 'major' }),
        'fix.md': changeset({ '@object-ui/react': 'patch' }),
      },
    });
    expect(verdictOf(dir)).toEqual({ offenders: [], admitted: [], refused: [] });
  });

  it('still refuses a NEW major pending beside it', () => {
    const dir = checkout({
      members: prereleased(),
      changesets: {
        'pre.json': JSON.stringify({ mode: 'pre', tag: 'next' }),
        'pre/sync.md': changeset({ '@object-ui/core': 'major' }),
        'another.md': changeset({ '@object-ui/react': 'major' }),
      },
    });
    const verdict = verdictOf(dir);
    expect(verdict.offenders.map((o) => o.file)).toEqual([path.join('.changeset', 'another.md')]);
    expect(verdict.refused[0].reason).toContain('from 18 to 19');
  });
});

describe('the repository itself', () => {
  it('declares no pending `major` the gate refuses — run as CI runs it', () => {
    // The script itself, in a child process, exactly as `changeset-guard.yml`
    // runs it. A `major` publishes all 39 fixed-group packages as the next
    // major; the only one admitted is the synchronized bump onto the
    // @objectstack/spec major the group declares — see AGENTS.md §版本号策略.
    const env = { ...process.env };
    delete env.OBJECTUI_ALLOW_MAJOR; // a retired switch must not decide this
    const run = spawnSync(process.execPath, [GATE], { cwd: repoRoot, env, encoding: 'utf8' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it('reads exactly the pending set: every top-level `.changeset/*.md` but the README, never `pre/`', () => {
    // Enumerated here independently of the gate's reader, from the live tree.
    // In pre mode `.changeset/pre/` holds consumed changesets; a reader that
    // walked into it would refuse the consumed synchronized major.
    const listed = fs
      .readdirSync(changesetDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
      .map((entry) => path.join('.changeset', entry.name))
      .sort();
    const read = (gate.readPendingChangesets(changesetDir) as { file: string }[]).map(({ file }) => file);
    expect(read).toEqual(listed);
    expect(read.some((file) => file.includes(`${path.sep}pre${path.sep}`))).toBe(false);
  });

  it('agrees in-process: nothing pending is refused', () => {
    const { refused } = gate.analyze(repoRoot) as Verdict;
    expect(
      refused.map(({ file, pkg, line, reason }) => `${pkg} at ${file}:${line}: ${reason}`),
      'Score it `minor` and describe the break in the body — see AGENTS.md §版本号策略.'
    ).toEqual([]);
  });
});

describe('changeset-guard.yml', () => {
  const guard = fs.readFileSync(path.join(workflowDir, 'changeset-guard.yml'), 'utf8');

  it('runs the guard script', () => {
    expect(guard).toContain('node scripts/check-changeset-no-major.mjs');
  });

  it('triggers on `.changeset/**` — the paths every other workflow ignores', () => {
    // The inverse pin, and the reason `ci.yml` still cannot host this check: on
    // a changeset-only PR its `Decide whether this change needs a full run` step
    // finds nothing outside its exclusion list (markdown and `.changeset/**`
    // among it) and skips every step below itself, so no gate in that workflow
    // ever reads the changeset. This one has to run outside that decision.
    //
    // Not the reason this comment used to give — "a changeset-only PR matches
    // its `paths-ignore` twice over, so no job in it would ever run". Since
    // objectui#3523 step 2, `paths-ignore` is gone from the `pull_request`
    // trigger and survives only on `push`: such a PR does start `ci.yml` and
    // does produce its contexts (measured — PR #3856, one markdown file, 16
    // checks; PR #4339, one line added to AGENTS.md, 17). The conclusion
    // outlived the premise; objectui#3857 pinned the correction.
    //
    // That surviving `push` copy is what the two assertions below read, and it
    // is why they stay green — `ci.yml` genuinely still declares `paths-ignore`
    // with markdown in it, on `push`. The in-job exclusion list is held
    // identical to that filter by `scripts/__tests__/merge-queue-reporting.test.ts`,
    // so the pair cannot drift apart silently.
    expect(guard).toMatch(/paths:\s*\n\s*- '\.changeset\/\*\*'/);

    const ci = fs.readFileSync(path.join(workflowDir, 'ci.yml'), 'utf8');
    expect(ci).toContain("paths-ignore:");
    expect(ci).toContain("- '**/*.md'");
  });
});
