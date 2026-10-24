import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import {
  CENSUS_FLOORS,
  GIT_IGNORED_CONTROL,
  PROBE_BASENAME,
  SOURCE_EXTENSIONS,
  UNREACHED_GROUPS,
  VACUOUS_GROUPS,
  analyze,
  censusCollapse,
  extensionProbeCollapse,
  extensionReach,
  gitIgnoreCollapse,
  gitIgnoreReading,
  isGitWorkTree,
  ruleCountFor,
  walkedFiles,
} from '../check-lint-rule-coverage.mjs';

/**
 * objectui#7908 -- `eslint.config.js` resolves ZERO rules for every
 * `.js`/`.mjs`/`.cjs` file, so a third of what `lint:root` walks is linted
 * vacuously while every exit code downstream reads it as clean.
 *
 * The gate under test reports rule RESOLUTION, not merely whether ESLint ran.
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The walk is the same walk.** `walkedFiles` enumerates via
 *     `ESLint#isPathIgnored`; a real `ESLint#lintFiles` over the same fixture
 *     must produce the same set. Without this leg the gate could be measuring a
 *     population ESLint never touches, and every other assertion here would
 *     still pass.
 *  2. **Zero rules is a reading, not a broken call.** Every fixture that
 *     reports a zero also reports a control file in the same run that resolves
 *     a non-zero count, the same shape the card's own measurement used.
 *  3. **All three reds, each through the real mechanism.** Unledgered vacuity,
 *     an over-broad row, and a stale row -- driven by editing the fixture's
 *     ESLint config or its tree, never by hand-constructing the gate's own
 *     internal state.
 *  4. **A green is never "the walk found nothing."** The fixture greens assert
 *     their own counters, and the repository run asserts the census floors.
 *  5. **This repository is green today**, with every ledger row still live.
 *  7. **objectui#8337 -- the second predicate.** A source file ESLint does not
 *     walk AT ALL is a different defect from a walked file with no rules, and
 *     predicate 1 cannot see it by construction. The unreachable EXTENSION set
 *     is derived from the live config rather than listed, so a predicate that
 *     knew only about `.mts` would fail these cases.
 *  8. **The discrimination is per file, not per ignore.** A `.mts` inside an
 *     ignored directory, and one excluded by a name pattern, are both excluded
 *     for reasons that are not this gate's business; the substitution test
 *     separates them from the extension gap.
 *  9. **Predicate 2 cannot pass vacuously even once it is fixed.** Its control
 *     is on the probe -- both answers in the same run -- so an empty population
 *     stays a reading rather than becoming a blind spot.
 * 10. **objectui#8369 -- the census is over the tree GIT tracks.** A build
 *     output on disk is not a file anybody wrote, so the walk drops what git
 *     ignores. The load-bearing pin is the card's own control turned into a
 *     fixture: the same tree analysed with and without a generated file gives
 *     the IDENTICAL verdict and the identical census. The three git semantics
 *     it rests on are pinned separately, each against a real `git` process --
 *     an untracked-and-unignored file is still reported (which is why this is
 *     not `git ls-files`), a TRACKED file stays counted even when a rule names
 *     it, and outside a work tree the filter reports itself unavailable rather
 *     than filtering silently.
 *  6. **The gate is wired** in `package.json`, and its only enforcement path is
 *     the `this repository is green` case above, running inside `pnpm test`.
 *     The absence of a `ci.yml` step is asserted rather than assumed, so the
 *     header's claim about it stays checkable.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway repository: a flat ESLint config plus a file tree. Written to
 * disk rather than modelled, because "which files does ESLint walk" is half of
 * what can go wrong and no model of that answers it.
 */
function tree(label: string, files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `lint-rule-coverage-${label}-`)));
  fixtures.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/** A config whose only rule-bearing block is scoped to `.ts` -- the shape of the defect. */
const TS_ONLY_CONFIG = [
  "export default [",
  "  { ignores: ['**/generated/**'] },",
  "  { files: ['**/*.ts'], rules: { 'no-debugger': 'error', 'no-empty': 'error' } },",
  "];",
  "",
].join('\n');

const FILES = {
  'src/covered.ts': 'export const a = 1;\n',
  'tools/vacuous.mjs': 'export const b = 2;\n',
};

/** Predicate 1's ledger for {@link FILES}, so a predicate-2 fixture reds for one reason only. */
const LEDGER = [
  { glob: 'tools/**/*.mjs', reason: 'fixture', card: 'objectui#7908' },
  { glob: 'eslint.config.js', reason: 'the fixture config', card: 'objectui#7908' },
];

describe('the walk is the walk ESLint actually performs', () => {
  it('enumerates exactly what ESLint#lintFiles reaches', async () => {
    const root = tree('walk', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      'generated/ignored.ts': 'export const c = 3;\n',
      'notes.md': '# not a linted file\n',
      'data.json': '{}\n',
    });

    const eslint = new ESLint({ cwd: root });
    const mine = await walkedFiles(root, eslint);
    const theirs = (await eslint.lintFiles(['.']))
      .map((r) => path.relative(root, r.filePath).split(path.sep).join('/'))
      .sort();

    expect(mine).toEqual(theirs);
    // ...and the answer is not trivially "everything" or "nothing".
    expect(mine).toContain('src/covered.ts');
    expect(mine).toContain('tools/vacuous.mjs');
    expect(mine).not.toContain('generated/ignored.ts');
    expect(mine).not.toContain('notes.md');
  });

  it('prunes a directory by asking the live config, not by a copied list', async () => {
    const root = tree('prune', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      'generated/deep/also-ignored.ts': 'export const d = 4;\n',
    });
    const eslint = new ESLint({ cwd: root });

    // The probe is a file that does not exist; the answer comes from the
    // config's own `ignores`, which is what keeps this from drifting.
    expect(await eslint.isPathIgnored(path.join(root, 'generated', PROBE_BASENAME))).toBe(true);
    expect(await eslint.isPathIgnored(path.join(root, 'tools', PROBE_BASENAME))).toBe(false);
    expect(await walkedFiles(root, eslint)).not.toContain('generated/deep/also-ignored.ts');
  });
});

describe('zero rules is a reading, not a broken call', () => {
  it('reports a zero and a non-zero control in the same run', async () => {
    const root = tree('reading', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES });
    const eslint = new ESLint({ cwd: root });

    expect(await ruleCountFor(eslint, path.join(root, 'tools/vacuous.mjs'))).toBe(0);
    expect(await ruleCountFor(eslint, path.join(root, 'src/covered.ts'))).toBe(2);
  });

  it('separates "walked with no rules" from "not walked at all"', async () => {
    const root = tree('shapes', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES, 'notes.md': '# x\n' });
    const eslint = new ESLint({ cwd: root });

    // The distinction the gate turns on: `undefined` means ESLint never looks
    // at the file, an object with no `rules` means it looks and has nothing to
    // say. Both would read as "0 rules" to a caller that only counted keys.
    expect(await eslint.calculateConfigForFile(path.join(root, 'notes.md'))).toBeUndefined();
    const vacuous = await eslint.calculateConfigForFile(path.join(root, 'tools/vacuous.mjs'));
    expect(vacuous).toBeDefined();
    expect(vacuous.rules).toBeUndefined();
  });
});

describe('narrowing a glob removes files from the WALK, it does not make them vacuous', () => {
  it('is the measured asymmetry between the default-lint set and `.ts`', async () => {
    // `.js`/`.cjs`/`.mjs` are linted by default; `.ts` is walked only because
    // some config object's `files` names it. So the two fail in opposite
    // directions, and a gate built on the wrong one would measure nothing.
    const root = tree('narrowed', {
      'eslint.config.js': TS_ONLY_CONFIG.replace("files: ['**/*.ts']", "files: ['**/*.tsx']"),
      ...FILES,
    });
    const eslint = new ESLint({ cwd: root });

    expect(await eslint.isPathIgnored(path.join(root, 'src/covered.ts'))).toBe(true);
    expect(await eslint.calculateConfigForFile(path.join(root, 'src/covered.ts'))).toBeUndefined();

    const result = await analyze({ root, groups: [{ glob: '**/*.mjs', reason: 'fixture', card: 'objectui#7908' }, { glob: 'eslint.config.js', reason: 'the fixture config', card: 'objectui#7908' }] });
    expect(result.walked).not.toContain('src/covered.ts');
    expect(result.vacuous).not.toContain('src/covered.ts');
  });

  it('reds when a files: entry ENTERS the walk carrying no rules', async () => {
    // The real-world way this defect is added to a config, and the fourth
    // ablation leg on this gate's own PR.
    const root = tree('widened-walk', {
      'eslint.config.js': TS_ONLY_CONFIG.replace('export default [', "export default [\n  { files: ['**/*.mts'] },"),
      ...FILES,
      'build.mts': 'export const f = 6;\n',
    });
    const result = await analyze({
      root,
      groups: [
        { glob: 'tools/**/*.mjs', reason: 'fixture', card: 'objectui#7908' },
        { glob: 'eslint.config.js', reason: 'the fixture config', card: 'objectui#7908' },
      ],
    });

    const unledgered = result.findings.filter((f) => f.kind === 'unledgered');
    expect(unledgered).toHaveLength(1);
    expect(unledgered[0].files).toEqual(['build.mts']);
  });
});

describe('the ledger, and the three directions it goes red', () => {
  // Two rows, and the second one is not decoration: a flat config is itself a
  // `.js` file that ESLint walks and resolves no rules for, so the fixture
  // reproduces the repository's own shape -- and it is why the real ledger
  // COUNTS `eslint.config.js` instead of exempting it. A gate that special-cased
  // its own config would be green here for the wrong reason.
  const groups = [
    { glob: 'tools/**/*.mjs', reason: 'fixture', card: 'objectui#7908' },
    { glob: 'eslint.config.js', reason: 'the fixture config, counted like the real one', card: 'objectui#7908' },
  ];

  it('is GREEN when every vacuous file is declared, with counters that are not zero', async () => {
    const root = tree('green', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES });
    // Predicate 2 has its own ledger and its own fixtures below; an empty one
    // keeps this case a statement about vacuity alone.
    const result = await analyze({ root, groups, unreachedGroups: [] });

    expect(result.findings).toEqual([]);
    expect(result.vacuous).toEqual(['eslint.config.js', 'tools/vacuous.mjs']);
    expect(result.ruleBearing).toEqual(['src/covered.ts']);
    expect(result.rows[0].vacuousMatches).toEqual(['tools/vacuous.mjs']);
    expect(result.rows[1].vacuousMatches).toEqual(['eslint.config.js']);
  });

  it('reds on a NEW zero-rule file outside every row, and names it', async () => {
    const root = tree('unledgered', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      'elsewhere/new-tool.mjs': 'export const e = 5;\n',
    });
    const result = await analyze({ root, groups });

    const unledgered = result.findings.filter((f) => f.kind === 'unledgered');
    expect(unledgered).toHaveLength(1);
    expect(unledgered[0].files).toEqual(['elsewhere/new-tool.mjs']);
    // The declared file is NOT reported -- the row still does its job.
    expect(unledgered[0].files).not.toContain('tools/vacuous.mjs');
  });

  it('reds on a row that also claims files which now resolve rules', async () => {
    const root = tree('overbroad', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES });
    const result = await analyze({
      root,
      groups: [{ glob: '**/*.{ts,mjs}', reason: 'too wide', card: 'objectui#7908' }, groups[1]],
    });

    const overBroad = result.findings.filter((f) => f.kind === 'over-broad');
    expect(overBroad).toHaveLength(1);
    expect(overBroad[0].files).toEqual(['src/covered.ts']);
  });

  it('reds as STALE when the config grows to cover a declared row', async () => {
    // The row is honest on the tree above. Here the config's rule-bearing block
    // widens to `.mjs`, so the vacuity the row declares is GONE -- driven
    // through ESLint rather than by editing the row.
    const root = tree('stale-covered', {
      'eslint.config.js': TS_ONLY_CONFIG.replace("files: ['**/*.ts']", "files: ['**/*.{ts,mjs}']"),
      ...FILES,
    });
    const result = await analyze({ root, groups, unreachedGroups: [] });

    // Only the config file is left unjudged; the row that declared `tools/`
    // now over-claims a covered file AND declares nothing, which is both reds.
    expect(result.vacuous).toEqual(['eslint.config.js']);
    expect(result.findings.map((f) => f.kind).sort()).toEqual(['over-broad', 'stale']);
  });

  it('reds as STALE when a row matches no walked file at all', async () => {
    const root = tree('stale-gone', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES });
    const result = await analyze({
      root,
      groups: [...groups, { glob: 'deleted/**/*.mjs', reason: 'gone', card: 'objectui#7908' }],
    });

    const stale = result.findings.filter((f) => f.kind === 'stale');
    expect(stale).toHaveLength(1);
    expect(stale[0].glob).toBe('deleted/**/*.mjs');
  });
});


describe('objectui#8337 -- the source files ESLint does not walk at all', () => {
  // The predicate-2 ledger every fixture below judges against, and the shape
  // the real one has: an exact path, never a population glob.
  const unreachedGroups = [
    { glob: 'src/tool.mts', reason: 'the fixture config never names .mts', card: 'objectui#8337' },
  ];

  it('derives the unreachable extension set from the config, and it is not just `.mts`', async () => {
    const root = tree('reach', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES });
    const reach = await extensionReach(new ESLint({ cwd: root }), root);

    // `.js`/`.cjs`/`.mjs` are ESLint's default set; `.ts` is reachable only
    // because the config names it. Everything else falls through BOTH.
    expect(reach.reachable).toEqual(['js', 'cjs', 'mjs', 'ts']);
    expect(reach.unreachable).toEqual(['jsx', 'cts', 'mts', 'tsx']);
    // A predicate that knew only about `.mts` would report one of these four.
    expect(reach.unreachable.length).toBeGreaterThan(1);
  });

  it('follows the config rather than a list -- widening it moves an extension out of the set', async () => {
    const root = tree('reach-widened', {
      'eslint.config.js': TS_ONLY_CONFIG.replace("files: ['**/*.ts']", "files: ['**/*.{ts,mts}']"),
      ...FILES,
    });
    const reach = await extensionReach(new ESLint({ cwd: root }), root);

    expect(reach.reachable).toContain('mts');
    expect(reach.unreachable).not.toContain('mts');
    // `.cts` did not move: the config named one extension, not a family.
    expect(reach.unreachable).toContain('cts');
  });

  it('reds on an unwalked source file, and the same tree greens once a row declares it', async () => {
    const files = { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES, 'src/tool.mts': 'export const t = 7;\n' };
    const root = tree('unreached', files);

    const bare = await analyze({ root, groups: LEDGER, unreachedGroups: [] });
    const red = bare.findings.filter((f) => f.kind === 'unreached-unledgered');
    expect(red).toHaveLength(1);
    expect(red[0].files).toEqual(['src/tool.mts']);
    // It is NOT the other predicate's class: ESLint never opened it, so it is
    // in neither `walked` nor `vacuous`.
    expect(bare.walked).not.toContain('src/tool.mts');
    expect(bare.vacuous).not.toContain('src/tool.mts');
    expect(bare.unwalkedSource).toContain('src/tool.mts');

    const declared = await analyze({ root, groups: LEDGER, unreachedGroups });
    expect(declared.findings).toEqual([]);
    expect(declared.unreachedRows[0].unreachedMatches).toEqual(['src/tool.mts']);
  });

  it('does not claim a file excluded by its LOCATION or by a NAME pattern', async () => {
    // Two legitimate exclusions that are none of this gate's business, and the
    // extension gap sitting between them in the same tree.
    const root = tree('not-extension', {
      'eslint.config.js': TS_ONLY_CONFIG.replace(
        "{ ignores: ['**/generated/**'] },",
        "{ ignores: ['**/generated/**', '**/*.gen.*'] },",
      ),
      ...FILES,
      'generated/build.mts': 'export const g = 8;\n',
      'src/schema.gen.mts': 'export const h = 9;\n',
      'src/tool.mts': 'export const t = 7;\n',
    });
    const result = await analyze({ root, groups: LEDGER, unreachedGroups: [] });

    const red = result.findings.filter((f) => f.kind === 'unreached-unledgered');
    expect(red).toHaveLength(1);
    // Only the one whose path WOULD be walked under a reachable extension.
    expect(red[0].files).toEqual(['src/tool.mts']);
  });

  it('reds as OVER-BROAD when a row also claims a file ESLint walks', async () => {
    const root = tree('unreached-overbroad', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      'src/tool.mts': 'export const t = 7;\n',
    });
    const result = await analyze({
      root,
      groups: LEDGER,
      unreachedGroups: [{ glob: 'src/*', reason: 'claims the covered .ts too', card: 'objectui#8337' }],
    });

    const overBroad = result.findings.filter((f) => f.kind === 'unreached-over-broad');
    expect(overBroad).toHaveLength(1);
    expect(overBroad[0].files).toEqual(['src/covered.ts']);
  });

  it('reds as STALE when the config grows to reach the declared extension', async () => {
    // The remedy direction, driven through ESLint rather than by editing the
    // row: reach `.mts` and the waiver has nothing left to waive.
    const root = tree('unreached-stale', {
      'eslint.config.js': TS_ONLY_CONFIG.replace("files: ['**/*.ts']", "files: ['**/*.{ts,mts}']"),
      ...FILES,
      'src/tool.mts': 'export const t = 7;\n',
    });
    const result = await analyze({ root, groups: LEDGER, unreachedGroups });

    expect(result.unreached).toEqual([]);
    expect(result.findings.filter((f) => f.kind === 'unreached-stale')).toHaveLength(1);
  });

  it('cannot report a clean sheet on a broken probe -- the control is on the instrument', async () => {
    // An empty population is what FIXING this looks like, so the control has to
    // survive the fix: it asks the probe to answer both ways in one run.
    expect(extensionProbeCollapse({ reachable: [], controlUnreachable: true })).toMatch(/probe collapsed/);
    expect(extensionProbeCollapse({ reachable: ['ts'], controlUnreachable: false })).toMatch(/probe collapsed/);
    expect(extensionProbeCollapse({ reachable: ['ts'], controlUnreachable: true })).toBeNull();
  });
});

describe('the census cannot pass by collapsing', () => {
  it('rejects a walk that reached nothing', () => {
    expect(censusCollapse({ walked: [], ruleBearing: [], vacuous: [] })).toMatch(/census collapsed/);
  });

  it('rejects a walk that reached files but resolved rules for none of them', () => {
    const walked = Array.from({ length: CENSUS_FLOORS.walked + 1 }, (_, i) => `f${i}.mjs`);
    expect(censusCollapse({ walked, ruleBearing: [], vacuous: walked })).toMatch(/census collapsed/);
  });
});

/**
 * A fixture tree that IS a git repository. Nothing is committed: `git
 * check-ignore` reads the ignore files and the index, and neither needs a
 * commit -- which also keeps these fixtures free of any identity config.
 */
function gitTree(label: string, files: Record<string, string>, forceAdd: string[] = []): string {
  const root = tree(label, files);
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  if (forceAdd.length) execFileSync('git', ['add', '-f', ...forceAdd], { cwd: root, stdio: 'ignore' });
  return root;
}

describe('objectui#8369 -- the census is over the tree git tracks, not the files on disk', () => {
  it('gives the identical verdict and census whether or not the tree has been built', async () => {
    // The card's own control, as a fixture: `built.js` is a generated file --
    // named in `.gitignore`, absent from any commit -- and before this fix its
    // mere presence turned the gate red with `unledgered: built.js`.
    const root = gitTree('git-artifact', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      '.gitignore': 'built.js\n',
    });

    const unbuilt = await analyze({ root, groups: LEDGER, unreachedGroups: [] });
    fs.writeFileSync(path.join(root, 'built.js'), 'export const built = 1;\n');
    const built = await analyze({ root, groups: LEDGER, unreachedGroups: [] });

    expect(unbuilt.findings).toEqual([]);
    expect(built.findings).toEqual([]);
    expect(built.walked).toEqual(unbuilt.walked);
    expect(built.vacuous).toEqual(unbuilt.vacuous);
    expect(built.ruleBearing).toEqual(unbuilt.ruleBearing);
    // The one number that DOES move, and it is reported rather than silent.
    expect(unbuilt.git.excluded).toEqual([]);
    expect(built.git.excluded).toEqual(['built.js']);
    // ...and the census is not trivially empty on either side.
    expect(built.walked).toContain('src/covered.ts');
    expect(built.vacuous).toContain('tools/vacuous.mjs');
  });

  it('still reports a source file git does NOT ignore, before anybody stages it', async () => {
    // Why this is a git-IGNORE filter and not `git ls-files`: enumerating
    // tracked files would make the verdict depend on whether the developer had
    // run `git add`, which is the same defect wearing a different hat.
    const root = gitTree('git-untracked', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      '.gitignore': 'built.js\n',
      'elsewhere/new-tool.mjs': 'export const e = 5;\n',
    });
    const result = await analyze({ root, groups: LEDGER, unreachedGroups: [] });

    const unledgered = result.findings.filter((f) => f.kind === 'unledgered');
    expect(unledgered).toHaveLength(1);
    expect(unledgered[0].files).toEqual(['elsewhere/new-tool.mjs']);
    expect(result.git.excluded).toEqual([]);
  });

  it('keeps a TRACKED file in the census even when an ignore rule names it', async () => {
    // Measured semantics of `git check-ignore`, pinned because the whole filter
    // rests on them: it consults the index, so a tracked path is never called
    // ignored. A file in the repository stays judged whatever `.gitignore` says.
    const root = gitTree(
      'git-tracked',
      { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES, '.gitignore': 'tools/vacuous.mjs\n' },
      ['tools/vacuous.mjs'],
    );
    const result = await analyze({ root, groups: LEDGER, unreachedGroups: [] });

    expect(result.walked).toContain('tools/vacuous.mjs');
    expect(result.vacuous).toContain('tools/vacuous.mjs');
    expect(result.git.excluded).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it('narrows the ESLint#lintFiles equivalence by exactly the ignored paths', async () => {
    // The header's "272 files, 272 matches, zero difference" claim now holds
    // only up to this filter, so the difference is pinned rather than the
    // equality -- one file, and it is the generated one.
    const root = gitTree('git-walk-equiv', {
      'eslint.config.js': TS_ONLY_CONFIG,
      ...FILES,
      '.gitignore': 'built.js\n',
      'built.js': 'export const built = 1;\n',
    });
    const eslint = new ESLint({ cwd: root });

    const mine = await walkedFiles(root, eslint);
    const theirs = (await eslint.lintFiles(['.']))
      .map((r) => path.relative(root, r.filePath).split(path.sep).join('/'))
      .sort();

    expect(theirs).toContain('built.js');
    expect(mine).not.toContain('built.js');
    expect(theirs.filter((f) => f !== 'built.js')).toEqual(mine);
  });

  it('reports itself unavailable outside a git work tree rather than filtering silently', async () => {
    const root = tree('no-git', { 'eslint.config.js': TS_ONLY_CONFIG, ...FILES });
    expect(isGitWorkTree(root)).toBe(false);

    const result = await analyze({ root, groups: LEDGER, unreachedGroups: [] });
    expect(result.git.available).toBe(false);
    expect(result.git.excluded).toEqual([]);
    // Nothing is dropped, and the entry point refuses that state for THIS
    // repository -- an unavailable filter is the broken state, not a lenient one.
    expect(result.findings).toEqual([]);
    expect(gitIgnoreCollapse(result.git)).toMatch(/not a git work tree/);
  });

  it('takes both halves of its control from a real git process, in one run', () => {
    // The control lives on the INSTRUMENT: an empty ignored set is what an
    // unbuilt tree legitimately looks like, so "git answered nothing" and "git
    // did not answer" have to be told apart by something other than the set.
    const noNodeModulesRule = gitTree('git-control-half', { '.gitignore': 'built.js\n' });
    const half = gitIgnoreReading(noNodeModulesRule, []);
    expect(half.available).toBe(true);
    expect(half.controlVisible).toBe(true);
    // This fixture ignores nothing under node_modules, so the positive half is
    // genuinely absent -- and the collapse message says which half.
    expect(half.controlIgnored).toBe(false);
    expect(gitIgnoreCollapse(half)).toMatch(new RegExp(GIT_IGNORED_CONTROL.replace(/[/.]/g, '\\$&')));

    const both = gitTree('git-control-both', { '.gitignore': 'node_modules\nbuilt.js\n' });
    const reading = gitIgnoreReading(both, ['built.js', 'src/covered.ts']);
    expect(reading.controlIgnored).toBe(true);
    expect(reading.controlVisible).toBe(true);
    expect(gitIgnoreCollapse(reading)).toBeNull();
    // ...and the reading itself discriminates, on paths that need not exist.
    expect(reading.ignored.has('built.js')).toBe(true);
    expect(reading.ignored.has('src/covered.ts')).toBe(false);
  });

  it('names both directions of a collapsed filter', () => {
    expect(gitIgnoreCollapse({ available: false, controlIgnored: false, controlVisible: false })).toMatch(
      /not a git work tree/,
    );
    expect(gitIgnoreCollapse({ available: true, controlIgnored: false, controlVisible: true })).toMatch(
      /cannot\s+say "yes"/,
    );
    expect(gitIgnoreCollapse({ available: true, controlIgnored: true, controlVisible: false })).toMatch(
      /cannot\s+say "no"/,
    );
    expect(gitIgnoreCollapse({ available: true, controlIgnored: true, controlVisible: true })).toBeNull();
  });
});

describe('this repository', () => {
  it('is green, with every ledger row still live and the census standing', async () => {
    const result = await analyze({ root: repoRoot });

    expect(censusCollapse(result)).toBeNull();
    expect(result.findings).toEqual([]);
    // The gate's whole point: this number is NOT zero today, and a green here
    // means it is declared, not absent.
    expect(result.vacuous.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.vacuousMatches.length, `ledger row '${row.glob}' declares nothing any more`).toBeGreaterThan(0);
      expect(row.ruleBearingMatches, `ledger row '${row.glob}' over-claims`).toEqual([]);
    }
    // Predicate 2, same two properties. Its population is two files today --
    // the vitest config objectui#8337 was filed about, and the declaration twin
    // `scripts/ui-root.d.mts` that package tests (compiled with `allowJs: false`)
    // need to import `scripts/ui-root.mjs` typed (objectstack#25685, objectui#13472)
    // -- and a green here means both are DECLARED rather than invisible.
    expect(extensionProbeCollapse(result.reach)).toBeNull();
    expect(result.unreached).toEqual(['scripts/ui-root.d.mts', 'vitest.config.mts']);
    // objectui#8369: this run is only a reading of the tree git tracks if the
    // filter was there and could answer both ways.
    expect(result.git.available).toBe(true);
    expect(gitIgnoreCollapse(result.git)).toBeNull();
    for (const row of result.unreachedRows) {
      expect(row.unreachedMatches.length, `unreached row '${row.glob}' declares nothing any more`).toBeGreaterThan(0);
      expect(row.walkedMatches, `unreached row '${row.glob}' over-claims`).toEqual([]);
    }
  }, 60_000);

  it('still has the defect the card measured -- the JS family resolves zero rules', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    // Two zeros and a control, in one run. The control is what makes the zeros
    // a reading; without it a broken invocation looks identical.
    expect(await ruleCountFor(eslint, path.join(repoRoot, 'eslint.config.js'))).toBe(0);
    expect(await ruleCountFor(eslint, path.join(repoRoot, 'scripts/check-lint-coverage.mjs'))).toBe(0);
    expect(await ruleCountFor(eslint, path.join(repoRoot, 'playwright.config.ts'))).toBeGreaterThan(100);
  }, 30_000);

  it('still has objectui#8337 -- three controls, three DISTINCT states, one run', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const mts = path.join(repoRoot, 'vitest.config.mts');

    // NOT WALKED. `undefined` is not "zero rules"; it is ESLint declining to
    // look, and collapsing the two would delete the finding.
    expect(await eslint.isPathIgnored(mts)).toBe(true);
    expect(await eslint.calculateConfigForFile(mts)).toBeUndefined();
    // Walked and ruled.
    expect(await ruleCountFor(eslint, path.join(repoRoot, 'playwright.config.ts'))).toBeGreaterThan(100);
    // Walked, zero rules -- predicate 1's class, which is a DIFFERENT state.
    expect(await eslint.calculateConfigForFile(path.join(repoRoot, 'scripts/github-slug.mjs'))).toBeDefined();
    expect(await ruleCountFor(eslint, path.join(repoRoot, 'scripts/github-slug.mjs'))).toBe(0);
  }, 30_000);

  it('has an unreachable extension set that is derived, and a probe that discriminates', async () => {
    const reach = await extensionReach(new ESLint({ cwd: repoRoot }), repoRoot);

    expect(extensionProbeCollapse(reach)).toBeNull();
    // Measured on 868e825012: the rule-bearing globs are TS-and-TSX and the
    // default set is the JS family, so three extensions fall through both --
    // `.jsx` among them, which neither the card nor its triage names.
    expect(reach.unreachable).toEqual(['jsx', 'cts', 'mts']);
    expect(reach.reachable).toEqual(['js', 'cjs', 'mjs', 'ts', 'tsx']);
    // Every candidate got an answer: the probe partitions the set, it does not
    // quietly drop an extension it could not decide.
    expect([...reach.reachable, ...reach.unreachable].sort()).toEqual([...SOURCE_EXTENSIONS].sort());
  }, 30_000);

  it('declares a reason and an owning card on every ledger row', () => {
    expect(VACUOUS_GROUPS.length).toBeGreaterThan(0);
    for (const row of VACUOUS_GROUPS) {
      expect(row.glob, 'a row must be a glob').toBeTruthy();
      expect(row.reason.length, `row '${row.glob}' needs a reason, not a bare glob`).toBeGreaterThan(40);
      expect(row.card, `row '${row.glob}' must name the card that owns it`).toMatch(/objectui#\d+/);
    }
    // Rows are globs on purpose -- a per-path ledger of this population would be
    // over a hundred rows that nobody would ever shrink.
    expect(VACUOUS_GROUPS.length).toBeLessThan(20);
  });

  it("declares predicate 2's rows as exact PATHS, not populations", () => {
    expect(UNREACHED_GROUPS.length).toBeGreaterThan(0);
    for (const row of UNREACHED_GROUPS) {
      expect(row.reason.length, `row '${row.glob}' needs a reason, not a bare path`).toBeGreaterThan(40);
      expect(row.card, `row '${row.glob}' must name the card that owns it`).toMatch(/objectui#\d+/);
      // The asymmetry with VACUOUS_GROUPS, pinned because it is deliberate: a
      // `**/*.mts` row would waive the next `.mts` file, which is the only
      // thing this predicate exists to catch.
      expect(row.glob, `row '${row.glob}' must not be a population glob`).not.toMatch(/[*?[\]{]/);
    }
  });

  it('never judges apps/console/plugin.js, built or not (objectui#8369)', async () => {
    const result = await analyze({ root: repoRoot });
    // The reading is about PATHS, so it holds whether or not this checkout has
    // been built -- and its control is a real source file in the same package,
    // asked in the same run.
    const reading = gitIgnoreReading(repoRoot, ['apps/console/plugin.js', 'apps/console/src/main.tsx']);
    expect(reading.ignored.has('apps/console/plugin.js')).toBe(true);
    expect(reading.ignored.has('apps/console/src/main.tsx')).toBe(false);

    expect(result.walked).not.toContain('apps/console/plugin.js');
    expect(result.walked).toContain('apps/console/src/main.tsx');
  }, 60_000);

  it('is wired in package.json, and deliberately not in a workflow yet', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:lint-rule-coverage']).toBe('node scripts/check-lint-rule-coverage.mjs');

    // The inverse pin. The gate's header states that nothing in
    // `.github/workflows/**` runs this command and that the test above is what
    // enforces it -- the same position objectui#8301 left `check:unused-deps`
    // in when it was closed `not planned`. If someone adds the step, this line
    // is what fails, and it points at the header paragraph that has to be
    // rewritten. A missing assertion would have left the claim uncheckable.
    const workflows = fs
      .readdirSync(path.join(repoRoot, '.github/workflows'))
      .map((f) => fs.readFileSync(path.join(repoRoot, '.github/workflows', f), 'utf8'))
      .join('\n');
    expect(workflows).not.toContain('check:lint-rule-coverage');
  });
});
