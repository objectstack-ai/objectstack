import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLING_FILE } from '../check-phantom-dependencies.mjs';
import {
  BUILD_OUTPUT_DIRS,
  BUILD_RECORD,
  MIN_PACKAGES,
  PUBLISHED_TOOLING_FILE,
  analyze,
  auditPackedFiles,
  buildWorkspace,
  discoverPublishedPackages,
  isToolingArtifact,
  outputDirOf,
  packedFiles,
  toolingConventionFrom,
} from '../check-published-dist-tooling.mjs';
import { jobBlock, rootCi, rootWorkflow, rootWorkflowFiles, uiRun, withoutComments } from './helpers/root-ci';
import { rootManifest, workspaceRoot } from '../workspace-root.mjs';

/**
 * objectui#4846 — no published package's build output may carry tooling material.
 *
 * The property has been broken three times and caught by a human every time
 * (#4006: 73 `*.test.d.ts` in two `dist/`; #4836: 9 more across four packages,
 * one of them an emitted module importing `vitest`). In the defective state
 * every gate in this repository exited 0, so what this file mostly pins is the
 * ways the NEW gate could join them in being green about nothing:
 *
 *  1. **The criterion is derived from the sibling gate, not retyped.** The
 *     tooling convention lives in `TOOLING_FILE`; a hand-copied second spelling
 *     would drift, and the drift is invisible (both gates stay green, one stops
 *     covering a directory).
 *  2. **The artifact regex is a strict SUPERSET of the source one, on purpose.**
 *     `TOOLING_FILE` ends `\.[cm]?[jt]sx?$` and therefore does NOT match
 *     `foo.test.d.ts` — which is exactly what #4006 found in the tarballs. A
 *     gate reusing the source regex verbatim would have been blind to the
 *     original defect.
 *  3. **The vacuous verdict is RED.** "No artifacts, therefore clean" is the one
 *     answer this gate must never give, and it is pinned by feeding `analyze()`
 *     an empty file list for every package and requiring a finding per package.
 *  4. **A build that fails is a failure, not a skip.**
 *  5. **`private` packages are out of scope, `apps/` packages are in it.**
 *  6. **The scan cannot collapse quietly**, and this repository is above the
 *     floor.
 *  7. **The gate is wired into the publish path**, which is where the ruling put
 *     it (comment 5307574139), and into a nightly workflow — and NOT into a
 *     per-PR job.
 *  8. **A build record is refused even though it has no tooling SOURCE.**
 *     objectui#7003 measured the blind spot: every criterion above traces an
 *     artifact back to a source the convention names, and a `*.tsbuildinfo` is
 *     a compiler by-product with no such source, so `PUBLISHED_TOOLING_FILE`
 *     matches nothing about it. `BUILD_RECORD` is the second, artifact-only
 *     term; the cases below read it from the gate rather than retyping the
 *     suffix, so the two cannot disagree about what a build record IS.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-published-dist-tooling.mjs';

interface Finding {
  reason: string;
  pkg?: string;
  dir?: string;
  file?: string;
  detail?: string;
}

// ── fixture package trees ────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway workspace with a `.changeset/config.json` and some manifests. */
function makeWorkspace(manifests: Record<string, Record<string, unknown>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'published-dist-gate-'));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, '.changeset'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeset/config.json'),
    JSON.stringify({ fixed: [Object.values(manifests).map((m) => m.name)] }),
  );
  for (const [dir, manifest] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

const pkg = (name: string, dir = `packages/${name.split('/').pop()}`) => ({ name, dir, manifest: { name } });

// ── 1. the convention is derived, never retyped ──────────────────────────────

describe('the tooling convention is read out of the sibling gate', () => {
  it('derives both alternations from the live TOOLING_FILE', () => {
    const convention = toolingConventionFrom(TOOLING_FILE.source);
    expect(convention.directories.split('|')).toEqual(['__tests__', '__mocks__', '__benchmarks__']);
    expect(convention.stems.split('|')).toEqual(['test', 'spec', 'bench', 'stories']);
  });

  it('throws by name when TOOLING_FILE is restructured beyond recognition', () => {
    // The failure mode a hand-copied constant does NOT have: if the sibling
    // gate's regex changes shape, this gate stops rather than quietly matching
    // a stale convention.
    expect(() => toolingConventionFrom('^nothing-like-it$')).toThrow(/cannot read the tooling convention/);
    expect(() => toolingConventionFrom('^nothing-like-it$')).toThrow(/check-phantom-dependencies\.mjs/);
  });

  it('covers every directory the sibling gate calls tooling', () => {
    for (const directory of toolingConventionFrom(TOOLING_FILE.source).directories.split('|')) {
      expect(isToolingArtifact(`dist/${directory}/x.d.ts`)).toBe(true);
      expect(isToolingArtifact(`dist/nested/deep/${directory}/x.js`)).toBe(true);
    }
  });
});

// ── 2. the artifact regex is a deliberate superset of the source one ─────────

describe('the artifact criterion vs. the source criterion', () => {
  it('agrees with TOOLING_FILE on source-shaped names', () => {
    for (const name of [
      'src/__tests__/a.ts',
      'src/__mocks__/plugin-form.ts',
      'src/__benchmarks__/core.bench.ts',
      'src/a.test.tsx',
      'src/a.spec.js',
      'src/Button.stories.tsx',
    ]) {
      expect(TOOLING_FILE.test(name), name).toBe(true);
      expect(isToolingArtifact(name), name).toBe(true);
    }
    for (const name of ['src/index.ts', 'src/specimen.ts', 'src/validateSpec.ts', 'dist/stories/Button.js']) {
      expect(TOOLING_FILE.test(name), name).toBe(false);
      expect(isToolingArtifact(name), name).toBe(false);
    }
  });

  it('catches the EMITTED counterparts TOOLING_FILE cannot see — objectui#4006 in one line', () => {
    // 73 files of exactly the FIRST shape below shipped in `@object-ui/fields`
    // and `@object-ui/plugin-editor`. A gate that reused `TOOLING_FILE` verbatim
    // on tarball paths would have graded every one of them as clean, because its
    // tail is `\.[cm]?[jt]sx?$`: a declaration (`.d.ts`) and a source map
    // (`.js.map`) do not end that way, and an emit produces mostly those.
    for (const emitted of [
      'dist/a.test.d.ts',
      'dist/a.test.d.ts.map',
      'dist/a.test.js.map',
      'dist/core.bench.d.mts',
      'dist/Button.stories.d.ts',
    ]) {
      expect(TOOLING_FILE.test(emitted), `${emitted} via TOOLING_FILE`).toBe(false);
      expect(isToolingArtifact(emitted), `${emitted} via PUBLISHED_TOOLING_FILE`).toBe(true);
    }
    // The emitted JS itself is the half both criteria already agree on — named
    // here so the superset claim above is not mistaken for "the source regex
    // sees nothing in a dist".
    for (const emitted of ['dist/a.test.js', 'dist/a.spec.mjs', 'dist/core.bench.cjs']) {
      expect(TOOLING_FILE.test(emitted), `${emitted} via TOOLING_FILE`).toBe(true);
      expect(isToolingArtifact(emitted), `${emitted} via PUBLISHED_TOOLING_FILE`).toBe(true);
    }
  });

  it('anchors the stem marker to the last path segment', () => {
    expect(PUBLISHED_TOOLING_FILE.test('dist/a.test.d/index.js')).toBe(false);
    expect(isToolingArtifact('dist/renderers/index.js')).toBe(false);
  });
});

// ── 2b. build records, which have no tooling source at all ───────────────────

describe('build records — objectui#7003', () => {
  /** Spellings `tsc` writes, built from the gate's own output-directory list. */
  const records = BUILD_OUTPUT_DIRS.flatMap((dir) => [
    `${dir}/tsconfig.tsbuildinfo`,
    `${dir}/tsconfig.build.tsbuildinfo`,
    `${dir}/.tsbuildinfo`,
    `${dir}/nested/deep/tsconfig.tsbuildinfo`,
  ]);

  it('is exactly the blind spot the card measured: invisible to the derived convention', () => {
    // The whole finding of objectui#7003 in one assertion. `PUBLISHED_TOOLING_FILE`
    // matches a tooling MARKER — a directory name or a stem — because every
    // artifact it grades was emitted from a file somebody wrote. A build record
    // was written by the compiler about the build, so it carries no marker, and
    // the gate built for tooling material in published output saw nothing.
    for (const record of records) {
      expect(PUBLISHED_TOOLING_FILE.test(record), `${record} via PUBLISHED_TOOLING_FILE`).toBe(false);
      expect(TOOLING_FILE.test(record), `${record} via TOOLING_FILE`).toBe(false);
      expect(isToolingArtifact(record), `${record} via isToolingArtifact`).toBe(true);
    }
  });

  it('reads the pattern off the gate instead of retyping the suffix', () => {
    // The derived-never-retyped property, applied to the new term: the predicate
    // is the union of the two exported patterns and nothing else, so a third
    // spelling cannot appear in the gate without appearing here.
    for (const path of [
      ...records,
      'tsconfig.tsbuildinfo',
      'dist/index.js',
      'dist/a.test.d.ts',
      'src/a.test.ts',
      'dist/__tests__/a.d.ts',
    ]) {
      expect(isToolingArtifact(path), path).toBe(PUBLISHED_TOOLING_FILE.test(path) || BUILD_RECORD.test(path));
    }
  });

  it('does not fire on names that merely contain the word', () => {
    for (const clean of [
      'dist/index.js',
      'dist/tsbuildinfo.js',
      'dist/tsconfig.tsbuildinfo.js',
      'dist/a.tsbuildinfo/index.js', // a DIRECTORY so named — anchored to the last segment
    ]) {
      expect(isToolingArtifact(clean), clean).toBe(false);
    }
  });
});

// ── 3. the verdicts, including the vacuous one ───────────────────────────────

describe('outputDirOf', () => {
  it('names the build output directory an entry belongs to', () => {
    expect(outputDirOf('dist/index.js')).toBe('dist');
    expect(outputDirOf('src/index.ts')).toBe(null);
    expect(outputDirOf('README.md')).toBe(null);
    for (const dir of BUILD_OUTPUT_DIRS) expect(outputDirOf(`${dir}/x.js`)).toBe(dir);
  });
});

describe('auditPackedFiles', () => {
  it('passes a tarball whose build output is clean', () => {
    const { findings, counters } = auditPackedFiles(pkg('@object-ui/core'), [
      'README.md',
      'dist/index.js',
      'dist/index.d.ts',
    ]);
    expect(findings).toEqual([]);
    expect(counters.output).toBe(2);
  });

  it('names the package AND the file for tooling material in build output', () => {
    const { findings } = auditPackedFiles(pkg('@object-ui/core'), [
      'dist/index.js',
      'dist/__benchmarks__/core.bench.js',
      'dist/__benchmarks__/core.bench.d.ts',
    ]);
    expect(findings.map((f: Finding) => f.reason)).toEqual([
      'tooling-in-published-output',
      'tooling-in-published-output',
    ]);
    expect(findings.map((f: Finding) => f.file)).toEqual([
      'dist/__benchmarks__/core.bench.js',
      'dist/__benchmarks__/core.bench.d.ts',
    ]);
    expect(findings[0].pkg).toBe('@object-ui/core');
    expect(findings[0].dir).toBe('packages/core');
  });

  it('names a build record inside the build output — objectui#7003', () => {
    const { findings, counters } = auditPackedFiles(pkg('@object-ui/core'), [
      'dist/index.js',
      'dist/tsconfig.tsbuildinfo',
      'dist/chunks/tsconfig.build.tsbuildinfo',
    ]);
    expect(findings.map((f: Finding) => f.reason)).toEqual([
      'tooling-in-published-output',
      'tooling-in-published-output',
    ]);
    expect(findings.map((f: Finding) => f.file)).toEqual([
      'dist/tsconfig.tsbuildinfo',
      'dist/chunks/tsconfig.build.tsbuildinfo',
    ]);
    expect(findings[0].pkg).toBe('@object-ui/core');
    expect(findings[0].dir).toBe('packages/core');
    expect(counters.tooling).toBe(2);
  });

  it('leaves the record at its REAL location alone — the package root', () => {
    // Where every one of this repository's 30 composite packages writes its
    // record today, and the state option B would change. It is not in any
    // package's `files` list, so it does not reach a tarball at all — but this
    // function must not flag it even when handed one, or the gate would red a
    // tree that ships nothing wrong.
    const { findings, counters } = auditPackedFiles(pkg('@object-ui/core'), [
      'tsconfig.tsbuildinfo',
      'dist/index.js',
      'dist/index.d.ts',
    ]);
    expect(findings).toEqual([]);
    expect(counters.tooling).toBe(0);
  });

  it('reports a tarball with NO build output instead of passing it — the vacuous verdict', () => {
    // The whole reason this gate is not "check dist/ if it exists": with no
    // per-PR full-repo build, `dist/` is usually absent, and a gate that skips
    // then is green because it looked at nothing.
    const { findings } = auditPackedFiles(pkg('@object-ui/plugin-designer'), ['README.md', 'package.json']);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('no-build-output');
    expect(findings[0].pkg).toBe('@object-ui/plugin-designer');
    expect(findings[0].detail).toMatch(/inspected nothing for it/);
  });

  it('an entirely empty tarball is also a finding, not a pass', () => {
    const { findings } = auditPackedFiles(pkg('@object-ui/layout'), []);
    expect(findings.map((f: Finding) => f.reason)).toEqual(['no-build-output']);
  });

  it('counts src-tier tooling without failing on it', () => {
    // Some released packages also list `src` in `files`, so their tarballs
    // carry test sources. That is objectui#4851 and a different card — and not
    // a uniform one, since `@object-ui/types`' entry is load-bearing for its
    // published `.d.ts.map`. This gate makes the concession VISIBLE rather than
    // enforcing it here or hiding it.
    const { findings, counters } = auditPackedFiles(pkg('@object-ui/types'), [
      'dist/index.d.ts',
      'src/index.ts',
      'src/__tests__/a.test.ts',
      'src/b.test.ts',
    ]);
    expect(findings).toEqual([]);
    expect(counters.srcTierTooling).toBe(2);
    expect(counters.tooling).toBe(0);
  });
});

describe('analyze', () => {
  const packages = [pkg('@object-ui/core'), pkg('@object-ui/layout'), pkg('@object-ui/console', 'apps/console')];

  it('is RED when nothing was built — the state a vacuous gate would call green', () => {
    const result = analyze('/nowhere', { packages, pack: () => [] });
    expect(result.findings).toHaveLength(packages.length);
    expect(new Set(result.findings.map((f: Finding) => f.reason))).toEqual(new Set(['no-build-output']));
  });

  it('is green when every tarball carries clean build output', () => {
    const result = analyze('/nowhere', { packages, pack: () => ['dist/index.js', 'dist/index.d.ts'] });
    expect(result.findings).toEqual([]);
    expect(result.counters.output).toBe(6);
  });

  it('collects the src-tier packages by name', () => {
    const result = analyze('/nowhere', {
      packages,
      pack: (_root: string, p: { name: string }) =>
        p.name === '@object-ui/core' ? ['dist/index.js', 'src/a.test.ts'] : ['dist/index.js'],
    });
    expect(result.findings).toEqual([]);
    expect(result.srcTierPackages).toEqual(['@object-ui/core']);
  });
});

// ── 4. a build that fails is a failure ───────────────────────────────────────

describe('buildWorkspace', () => {
  /** A scratch workspace root whose manifest declares the given scripts. */
  const workspaceWith = (scripts: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'published-dist-build-'));
    fixtures.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-root', scripts }));
    return root;
  };

  it("runs the workspace root's `build` script, from the workspace root, and reports how long it took", () => {
    // objectstack#26860: the gate used to run `turbo run build` from `ui/`,
    // 128 tasks including the docs app, which is not the build that publishes.
    const root = workspaceWith({ build: 'turbo run build' });
    const calls: unknown[][] = [];
    const seconds = buildWorkspace(root, {
      exec: (...args: unknown[]) => {
        calls.push(args);
      },
    });
    expect(typeof seconds).toBe('number');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('pnpm');
    expect(calls[0][1]).toEqual(['build']);
    expect((calls[0][2] as { cwd: string }).cwd).toBe(root);
  });

  it('forwards --concurrency and --force when asked', () => {
    const calls: unknown[][] = [];
    buildWorkspace(workspaceWith({ build: 'turbo run build' }), {
      concurrency: 2,
      force: true,
      exec: (...args: unknown[]) => {
        calls.push(args);
      },
    });
    expect(calls[0][1]).toEqual(['build', '--concurrency=2', '--force']);
  });

  it('refuses, naming the manifest, when the workspace root declares no `build` script', () => {
    // The defect objectstack#26860 was filed from: `check:node-esm-load` ran a
    // `build` script `ui/package.json` does not have, and pnpm's exit 254 was
    // the whole diagnosis.
    const root = workspaceWith({ test: 'vitest' });
    const exec = () => {
      throw new Error('must not run');
    };
    expect(() => buildWorkspace(root, { exec })).toThrow(/declares no `build` script/);
    expect(() => buildWorkspace(root, { exec })).toThrow(new RegExp(`${root}/package\\.json`));
  });

  it('throws — never returns — when the build fails', () => {
    expect(() =>
      buildWorkspace(workspaceWith({ build: 'turbo run build' }), {
        exec: () => {
          throw new Error('turbo exited 1');
        },
      }),
    ).toThrow(/nothing trustworthy to inspect/);
  });

  it("is the release's build: the workspace root's `build` script, which `pnpm run release` opens with", () => {
    // What the publish path runs before `scripts/release-publish.sh` reads the
    // artifacts with `--no-build`. If the release ever builds something else,
    // this gate's build mode no longer reads what publishes, and this goes red.
    // `repoRoot` in this file is the objectui root, `ui/` under the monorepo.
    const workspace = workspaceRoot(repoRoot);
    const scripts = rootManifest(repoRoot).scripts as Record<string, string>;
    expect(scripts.build).toEqual(expect.any(String));
    expect(scripts.release.startsWith('pnpm run build && ')).toBe(true);
    expect(withoutComments(jobBlock(rootWorkflow('release.yml'), 'publish'))).toContain('run: pnpm run build\n');
    expect(scripts.build).toBe(
      JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).scripts.build,
    );
  });
});

// ── 5. scope: private out, apps/ in ──────────────────────────────────────────

describe('discoverPublishedPackages', () => {
  it('drops packages npm never receives, and keeps the ones under apps/', () => {
    const root = makeWorkspace({
      'packages/core': { name: '@object-ui/core' },
      'packages/vscode-extension': { name: 'object-ui', private: true },
      'apps/console': { name: '@object-ui/console' },
    });
    expect(discoverPublishedPackages(root).map((p: { name: string }) => p.name)).toEqual([
      '@object-ui/core',
      '@object-ui/console',
    ]);
  });

  it('drops packages the release group does not name', () => {
    const root = makeWorkspace({ 'packages/core': { name: '@object-ui/core' } });
    fs.mkdirSync(path.join(root, 'packages/test-support'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages/test-support/package.json'),
      JSON.stringify({ name: '@object-ui/test-support' }),
    );
    expect(discoverPublishedPackages(root).map((p: { name: string }) => p.name)).toEqual(['@object-ui/core']);
  });

  it('excludes THIS repository’s private fixed-group member by name', () => {
    // `packages/vscode-extension` is named `object-ui`, is in the fixed group
    // (changesets versions it) and is `private`. Reading the fixed group alone
    // would put an unpublishable package in scope.
    const names = discoverPublishedPackages(repoRoot).map((p: { name: string }) => p.name);
    expect(names).not.toContain('object-ui');
    expect(names).toContain('@object-ui/console');
    expect(names).toContain('@object-ui/plugin-designer');
  });
});

// ── 6. the scan cannot collapse quietly ──────────────────────────────────────

describe('scope size', () => {
  it('this repository publishes more packages than the floor', () => {
    expect(discoverPublishedPackages(repoRoot).length).toBeGreaterThanOrEqual(MIN_PACKAGES);
  });

  it('the gate refuses a release group it cannot read', () => {
    const root = makeWorkspace({});
    fs.writeFileSync(path.join(root, '.changeset/config.json'), JSON.stringify({ fixed: [] }));
    expect(() => discoverPublishedPackages(root)).toThrow(/empty `fixed` group/);
  });

  it('a pack result with no file list is an error, not an empty list', () => {
    expect(() => packedFiles('/repo', pkg('@object-ui/core'), () => JSON.stringify([{}]))).toThrow(
      /reported no file list/,
    );
    expect(() => packedFiles('/repo', pkg('@object-ui/core'), () => 'not json')).toThrow(/unparseable output/);
  });
});

// ── 7. the wiring the ruling asked for, and the one it forbade ───────────────

describe('wiring', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  it('is runnable as a named script', () => {
    expect(manifest.scripts['check:published-dist']).toBe(`node ${GATE}`);
  });

  it('runs on the publish path, before anything is published', () => {
    // The ruling (objectui#4846 comment 5307574139) put the gate where the harm
    // materialises. The release publishes through the workspace root's
    // `release` script (release.yml's publish step runs `pnpm run release`),
    // whose last command is `scripts/release-publish.sh`; that script runs the
    // gate with `--no-build` and refuses to go on when it is red, before
    // `changeset publish` packs a single tarball. So a red gate stops the
    // publish itself rather than reporting after the fact. Comment lines are
    // dropped first: the script's header names `changeset publish` in prose.
    // `repoRoot` in this file is the objectui root, `ui/` under the monorepo.
    const workspace = workspaceRoot(repoRoot);
    const scripts = rootManifest(repoRoot).scripts as Record<string, string>;
    expect(scripts.release.endsWith(' && bash scripts/release-publish.sh')).toBe(true);
    const publish = withoutComments(fs.readFileSync(path.join(workspace, 'scripts/release-publish.sh'), 'utf8'));
    const gate = `node ${path.relative(workspace, path.join(repoRoot, GATE))} --no-build`;
    expect(publish).toMatch(new RegExp(`^if ! ${gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; then$`, 'm'));
    const publishAt = publish.search(/^changeset publish\b/m);
    expect(publishAt).toBeGreaterThan(-1);
    expect(publish.indexOf(gate)).toBeLessThan(publishAt);
  });

  // The full-battery half (objectstack#26717). objectui scheduled the scan
  // nightly in `published-dist-gate.yml` (roster row 23 of objectstack#25697);
  // under the monorepo it runs in root `ci.yml`'s `ui-published-artifacts` job,
  // which a pull request and a queue entry skip, over the release's own build.
  const FULL_BATTERY_JOB = 'ui-published-artifacts';
  const PER_PR_EVENTS = ['pull_request', 'merge_group'];

  /** A job's own `if:` line, at the job's indent; '' when it has none. */
  const jobIf = (block: string) => block.match(/^ {4}if: (.*)$/m)?.[1] ?? '';
  const deniesPerPrEvents = (condition: string) =>
    PER_PR_EVENTS.every((event) => condition.includes(`github.event_name != '${event}'`));

  it("runs in ci.yml's full battery, after the release's build, with --no-build", () => {
    const block = withoutComments(jobBlock(rootCi(), FULL_BATTERY_JOB));
    expect(block).toContain(`run: ${uiRun('check:published-dist')} --no-build`);
    expect(block.indexOf('run: pnpm build\n')).toBeGreaterThan(-1);
    expect(block.indexOf('run: pnpm build\n')).toBeLessThan(block.indexOf(uiRun('check:published-dist')));
    expect(deniesPerPrEvents(jobIf(block)), jobIf(block)).toBe(true);
  });

  it('is NOT run by any per-PR or queue job — the ruling forbade a per-PR full-repo build', () => {
    // Asked of the root `.github/workflows/`, the only workflows GitHub runs
    // under the monorepo (objectstack#25712); `ui/.github/` runs nowhere. A
    // workflow that subscribes a per-PR event may carry the scan only in a job
    // whose own `if:` denies both of them: the ruling is about the build a
    // pull request pays for, and such a job costs it nothing.
    const perPr = rootWorkflowFiles().filter((file) =>
      new RegExp(`^on:[\\s\\S]*?\\b(${PER_PR_EVENTS.join('|')}):`, 'm').test(rootWorkflow(file)),
    );
    expect(perPr.length).toBeGreaterThan(0); // the scan itself must not be empty
    let carriers = 0;
    for (const file of perPr) {
      const text = rootWorkflow(file);
      const jobsAt = text.search(/^jobs:[ \t]*$/m);
      expect(jobsAt, file).toBeGreaterThan(-1);
      const keys = [...text.slice(jobsAt).matchAll(/^ {2}([a-z0-9][a-z0-9_-]*):[ \t]*$/gm)].map((m) => m[1]);
      expect(keys.length, file).toBeGreaterThan(0);
      for (const key of keys) {
        const block = withoutComments(jobBlock(text, key));
        if (!block.includes(GATE) && !block.includes('check:published-dist')) continue;
        carriers += 1;
        expect(deniesPerPrEvents(jobIf(block)), `${file} job ${key}: if: ${jobIf(block)}`).toBe(true);
      }
    }
    // The carrier the case above pins is seen here too, so this loop cannot
    // pass by reading no job at all.
    expect(carriers).toBeGreaterThan(0);
  });
});
