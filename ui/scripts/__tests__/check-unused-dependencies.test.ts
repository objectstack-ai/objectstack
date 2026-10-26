import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DECLARED_WITHOUT_IMPORT,
  GATED_FIELDS,
  GLOBAL_TYPES_PACKAGES,
  MEASURED_FIELDS,
  analyze,
  auditAllowances,
  auditPackage,
  consumedNames,
  listPackageFiles,
  typedPackageOf,
} from '../check-unused-dependencies.mjs';
import { moduleSpecifiers, packageNameOf } from '../check-phantom-dependencies.mjs';

/**
 * objectui#8198 — a declaration nothing consumes is dead weight in every
 * consumer's install, and until this gate nothing in CI could see it.
 *
 * `check:phantom-deps` judges the OTHER direction (an import nothing declares)
 * and says so in its own scope note. The live instance that produced this card:
 * objectui#7397 deleted `packages/components/src/ui/chart.tsx`, the only
 * importer of `recharts` in `@object-ui/components`; the declaration stayed
 * until a human removed it by hand on objectui#7625.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The scan reaches OUTSIDE `src/`.** This is the one property that makes
 *     this a second gate rather than a flag on the first: a dependency consumed
 *     only by `vite.config.ts` is consumed, and a `src/`-only scan — which is
 *     what phantom-deps must use — would call it dead. Pinned as a verdict, not
 *     as a counter, because a regression here manufactures false positives that
 *     read exactly like real findings.
 *  2. **A stylesheet at-rule is a consumer.** `@plugin 'tailwindcss-animate'`
 *     is the ONLY consumer that package has in this repository. No import
 *     scanner can see it, so losing this rule would red two packages over a
 *     correct declaration.
 *  3. **`@types/X` follows X**, including npm's `@types/scope__name` mangling
 *     and the builtin case (`@types/node`).
 *  4. **Only the gated fields are gated.** `peerDependencies` and
 *     `devDependencies` are measured and reported, never failed — a decision
 *     stated in the script header. If that ever silently flips, 21 packages red
 *     over a `react-dom` peer convention.
 *  5. **Allowances delete themselves.** All four conditions, because the third
 *     one — the row still applies but is no longer NEEDED — is what separates a
 *     self-deleting allowance from a permanent allowlist.
 *  6. **The scope cannot collapse quietly.** An empty release group throws
 *     rather than passing everything.
 *  7. **This repository is green**, and its allowance table is exactly the four
 *     rows the pull request that landed the gate justified.
 *  8. **Both gates share one parser**, so the two directions cannot come to
 *     disagree about what an import is.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface Finding {
  reason: string;
  pkg: string;
  key: string;
  field?: string;
  dir?: string;
  detail?: string;
}

// ── fixture trees ────────────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

interface PackageSpec {
  dir?: string;
  manifest: Record<string, unknown>;
  /** PACKAGE-relative path -> body. `src/` is not implied: reaching outside it is the point. */
  files: Record<string, string>;
}

/**
 * A throwaway workspace shaped like this one.
 *
 * Named `@fixture/*` deliberately: if the gate ever stopped reading
 * `.changeset/config.json` and fell back to an `@object-ui/*` surface, every
 * verdict below would flip.
 */
function fixtureRepo(label: string, packages: PackageSpec[], released: string[] | null = null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `unused-deps-${label}-`));
  fixtures.push(root);
  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  const names = released ?? packages.map((p) => p.manifest.name as string);
  write('.changeset/config.json', JSON.stringify({ fixed: [names], ignore: [] }, null, 2));
  write('package.json', JSON.stringify({ name: '@fixture/root' }, null, 2));
  for (const spec of packages) {
    const dir = spec.dir ?? `packages/${(spec.manifest.name as string).split('/').pop()}`;
    write(`${dir}/package.json`, JSON.stringify(spec.manifest, null, 2));
    // `discoverPackages` only sees a package that HAS a src/ directory.
    fs.mkdirSync(path.join(root, dir, 'src'), { recursive: true });
    for (const [rel, body] of Object.entries(spec.files)) write(`${dir}/${rel}`, body);
  }
  return root;
}

const verdict = (root: string, allowances = {}): Finding[] =>
  analyze(root, { allowances }).findings as Finding[];

// ── 1. the scan reaches outside src/ ─────────────────────────────────────────

describe('the consumer scan covers the whole package, not just src/', () => {
  it('counts a specifier imported only by a build config', () => {
    const root = fixtureRepo('config-import', [
      {
        manifest: { name: '@fixture/app', dependencies: { 'vite-plugin-thing': '^1.0.0' } },
        files: {
          'vite.config.ts': "import thing from 'vite-plugin-thing';\nexport default { plugins: [thing()] };\n",
          'src/index.ts': 'export const x = 1;\n',
        },
      },
    ]);
    expect(verdict(root)).toEqual([]);
  });

  it('counts a specifier imported only by a sibling directory outside src/', () => {
    const root = fixtureRepo('bin-import', [
      {
        manifest: { name: '@fixture/tool', dependencies: { commander: '^12.0.0' } },
        files: { 'bin/cli.mjs': "import 'commander';\n", 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root)).toEqual([]);
  });

  it('still reports a dependency no file in the package names at all', () => {
    const root = fixtureRepo('dead', [
      {
        manifest: { name: '@fixture/dead', dependencies: { ghost: '^1.0.0' } },
        files: { 'vite.config.ts': "import 'something-else';\n", 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root)).toEqual([
      { reason: 'declared-without-consumer', pkg: '@fixture/dead', dir: 'packages/dead', field: 'dependencies', key: 'ghost' },
    ]);
  });

  it('reads every specifier form, because a `require` is a consumer too', () => {
    const root = fixtureRepo('forms', [
      {
        manifest: {
          name: '@fixture/forms',
          dependencies: { a: '1', b: '1', c: '1', d: '1' },
        },
        files: {
          'src/index.ts':
            "import 'a';\nexport * from 'b';\nconst c = require('c');\nconst d = () => import('d');\nexport { c, d };\n",
        },
      },
    ]);
    expect(verdict(root)).toEqual([]);
  });

  it('does not walk into node_modules or dist, which would make every declaration look consumed', () => {
    const root = fixtureRepo('skipdirs', [
      {
        manifest: { name: '@fixture/skip', dependencies: { ghost: '^1.0.0' } },
        files: {
          'node_modules/ghost/index.js': "import 'ghost';\n",
          'dist/index.js': "import 'ghost';\n",
          'src/index.ts': 'export const x = 1;\n',
        },
      },
    ]);
    expect(verdict(root).map((f) => f.key)).toEqual(['ghost']);
  });
});

// ── 2. stylesheets ───────────────────────────────────────────────────────────

describe('a stylesheet at-rule is a consumer', () => {
  it.each([
    ["@plugin 'tailwindcss-animate';", 'tailwindcss-animate'],
    ["@import 'tailwindcss';", 'tailwindcss'],
    ['@config "some-preset/tailwind.config.js";', 'some-preset'],
    ["@source 'scanned-pkg/dist';", 'scanned-pkg'],
  ])('%s consumes %s', (rule, name) => {
    const root = fixtureRepo(`css-${name}`, [
      {
        manifest: { name: '@fixture/styled', dependencies: { [name]: '^1.0.0' } },
        files: { 'src/index.css': `${rule}\n`, 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root)).toEqual([]);
  });

  it('is the only thing keeping tailwindcss-animate green in this repository', () => {
    // A regression here is silent in the fixtures above and loud only on the
    // real tree, so it is asserted on the real tree.
    const { consumed } = consumedNames(repoRoot, 'packages/components');
    expect(consumed.get('tailwindcss-animate')).toEqual({
      file: 'packages/components/src/index.css',
      how: 'css at-rule',
    });
  });
});

// ── 3. @types/X follows X ────────────────────────────────────────────────────

describe('typedPackageOf', () => {
  it.each([
    ['@types/node', 'node'],
    ['@types/glob', 'glob'],
    ['@types/babel__core', '@babel/core'],
    ['@types/react-syntax-highlighter', 'react-syntax-highlighter'],
    ['react', null],
    ['@object-ui/core', null],
  ])('%s -> %s', (name, expected) => {
    expect(typedPackageOf(name)).toBe(expected);
  });

  it('carves out @types/node unconditionally — its consumer is a global scope, not a module edge', () => {
    // Deliberately NO builtin import: the declaration this package makes is
    // "I target Node", and `process.env` / `Buffer` reach the global scope
    // without ever naming a module. A scan that demanded a builtin import here
    // would red a package for reading an environment variable.
    const root = fixtureRepo('types-node', [
      {
        manifest: { name: '@fixture/node-ish', dependencies: { '@types/node': '^22.0.0' } },
        files: { 'src/index.ts': 'export const home = process.env.HOME;\n' },
      },
    ]);
    expect(verdict(root)).toEqual([]);
    expect(GLOBAL_TYPES_PACKAGES).toEqual(new Set(['@types/node']));
  });

  it('does not extend that carve-out to any other @types package', () => {
    const root = fixtureRepo('types-not-node', [
      {
        manifest: { name: '@fixture/not-node', dependencies: { '@types/express': '^5.0.0' } },
        files: { 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root).map((f) => f.key)).toEqual(['@types/express']);
  });

  it('reports @types/X when X itself has no consumer either', () => {
    const root = fixtureRepo('types-orphan', [
      {
        manifest: { name: '@fixture/orphan', dependencies: { '@types/ghost': '^1.0.0' } },
        files: { 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root).map((f) => f.key)).toEqual(['@types/ghost']);
  });
});

// ── 4. only the gated fields are gated ───────────────────────────────────────

describe('field scope', () => {
  it('gates dependencies and optionalDependencies, and nothing else', () => {
    expect(GATED_FIELDS).toEqual(['dependencies', 'optionalDependencies']);
    expect(MEASURED_FIELDS).toEqual(['peerDependencies', 'devDependencies']);
  });

  it('does not fail an unconsumed peer or dev declaration — it counts it', () => {
    const root = fixtureRepo('measured-only', [
      {
        manifest: {
          name: '@fixture/measured',
          peerDependencies: { 'react-dom': '^19.0.0' },
          devDependencies: { vitest: '^4.0.0' },
        },
        files: { 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    const result = analyze(root, { allowances: {} });
    expect(result.findings).toEqual([]);
    expect(result.measured).toEqual({ peerDependencies: 1, devDependencies: 1 });
  });

  it('gates optionalDependencies, which a consumer still fetches', () => {
    const root = fixtureRepo('optional', [
      {
        manifest: { name: '@fixture/optional', optionalDependencies: { ghost: '^1.0.0' } },
        files: { 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root).map((f) => [f.field, f.key])).toEqual([['optionalDependencies', 'ghost']]);
  });
});

// ── 5. allowances delete themselves ──────────────────────────────────────────

describe('DECLARED_WITHOUT_IMPORT rows carry evidence and delete themselves', () => {
  const holds = { reason: 'evidence that holds', verify: () => [] };

  it('suppresses the finding while it applies', () => {
    const root = fixtureRepo('allow-live', [
      {
        manifest: { name: '@fixture/allowed', dependencies: { ghost: '^1.0.0' } },
        files: { 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    expect(verdict(root, { '@fixture/allowed': { ghost: holds } })).toEqual([]);
  });

  it('(1) reds when the package left the released population', () => {
    const root = fixtureRepo('allow-gone', [
      { manifest: { name: '@fixture/present' }, files: { 'src/index.ts': 'export const x = 1;\n' } },
    ]);
    const findings = verdict(root, { '@fixture/vanished': { ghost: holds } });
    expect(findings.map((f) => f.reason)).toEqual(['stale-allowance']);
    expect(findings[0].detail).toContain('not a released workspace package');
  });

  it('(2) reds when the declaration it excused is gone', () => {
    const root = fixtureRepo('allow-undeclared', [
      { manifest: { name: '@fixture/allowed' }, files: { 'src/index.ts': 'export const x = 1;\n' } },
    ]);
    const findings = verdict(root, { '@fixture/allowed': { ghost: holds } });
    expect(findings.map((f) => f.reason)).toEqual(['stale-allowance']);
    expect(findings[0].detail).toContain('outlived the declaration');
  });

  it('(3) reds when the dependency now HAS a visible consumer — the row is no longer needed', () => {
    const root = fixtureRepo('allow-unneeded', [
      {
        manifest: { name: '@fixture/allowed', dependencies: { ghost: '^1.0.0' } },
        files: { 'src/index.ts': "import 'ghost';\n" },
      },
    ]);
    const findings = verdict(root, { '@fixture/allowed': { ghost: holds } });
    expect(findings.map((f) => f.reason)).toEqual(['stale-allowance']);
    expect(findings[0].detail).toContain('now HAS a consumer');
  });

  it('(4) reds when verify finds the evidence gone', () => {
    const root = fixtureRepo('allow-unverified', [
      {
        manifest: { name: '@fixture/allowed', dependencies: { ghost: '^1.0.0' } },
        files: { 'src/index.ts': 'export const x = 1;\n' },
      },
    ]);
    const findings = verdict(root, {
      '@fixture/allowed': { ghost: { reason: 'gone', verify: () => ['the config no longer names it'] } },
    });
    expect(findings.map((f) => f.reason)).toEqual(['stale-allowance']);
    expect(findings[0].detail).toBe('the config no longer names it');
  });
});

// ── 6. the scope cannot collapse quietly ─────────────────────────────────────

describe('scope', () => {
  it('throws on an empty release group rather than passing everything', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-deps-empty-'));
    fixtures.push(root);
    fs.mkdirSync(path.join(root, '.changeset'), { recursive: true });
    fs.writeFileSync(path.join(root, '.changeset/config.json'), JSON.stringify({ fixed: [], ignore: [] }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@fixture/root' }));
    expect(() => analyze(root, { allowances: {} })).toThrow(/empty `fixed` group/);
  });

  it('listPackageFiles returns nothing for a directory that is not there', () => {
    expect(listPackageFiles(path.join(repoRoot, 'packages/does-not-exist'))).toEqual([]);
  });
});

// ── 7. this repository ───────────────────────────────────────────────────────

/**
 * One whole-repository scan, shared by the three tests below.
 *
 * `analyze(repoRoot)` walks every package in the release group — 47 manifests
 * and >1000 files — and the three assertions read three different fields of the
 * SAME verdict, so a call per test paid for the identical walk three times, each
 * time inside a bounded assertion window. On the push lane, where the suite runs
 * under v8 coverage instrumentation, a single pass crosses vitest's 15 s
 * `testTimeout`: all three tests then fail with `Test timed out in 15000ms`
 * while the gate itself is green, and because the coverage thresholds live only
 * on the report merged from every coverage shard, one red shard means the
 * coverage gate does not run at all (objectui#8479).
 *
 * Module scope, not `beforeAll`: the import phase is governed by no timeout,
 * whereas a hook would trade the 15 s `testTimeout` for the narrower 10 s
 * `hookTimeout`. Same reasoning, same file family as `check-doc-links.test.ts`'s
 * `ANCHOR_CORPUS` (objectui#8419). No timeout is raised and no assertion is
 * weakened — each test asserts exactly what it asserted before.
 */
const REPOSITORY_SCAN = analyze(repoRoot);

describe('this repository', () => {
  it('is green: every gated declaration has a consumer', () => {
    const { findings } = REPOSITORY_SCAN;
    expect(findings).toEqual([]);
  });

  it('allows exactly the four rows the gate landed with, each still verifying', () => {
    expect(
      Object.fromEntries(
        Object.entries(DECLARED_WITHOUT_IMPORT).map(([pkg, rows]) => [pkg, Object.keys(rows).sort()]),
      ),
    ).toEqual({
      '@object-ui/cli': ['@object-ui/components', '@object-ui/react'],
      'object-ui': ['@object-ui/core', '@object-ui/types'],
    });
  });

  it('scans a population big enough for the verdict to mean something', () => {
    const { counters } = REPOSITORY_SCAN;
    expect(counters.packages).toBeGreaterThanOrEqual(30);
    expect(counters.gatedDeclared).toBeGreaterThanOrEqual(200);
    expect(counters.files).toBeGreaterThanOrEqual(1000);
  });

  it('keeps the non-gated fields VISIBLE rather than absorbed', () => {
    const { measured } = REPOSITORY_SCAN;
    // Not an equality: these move with the tree. The pin is that the gate still
    // MEASURES them — a zero here would mean the reporting quietly stopped.
    expect(measured.peerDependencies).toBeGreaterThan(0);
    expect(measured.devDependencies).toBeGreaterThan(0);
  });
});

// ── 8. one parser, two directions ────────────────────────────────────────────

describe('the two directions share one parser', () => {
  it('uses phantom-deps` own specifier reader, so they cannot disagree about an import', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-unused-dependencies.mjs'), 'utf8');
    expect(source).toMatch(/from '\.\/check-phantom-dependencies\.mjs'/);
    for (const helper of ['moduleSpecifiers', 'packageNameOf', 'isBuiltin', 'discoverPackages', 'SKIP_DIRS']) {
      expect(source).toContain(helper);
    }
    // And the imported reader really is the one under test.
    expect(packageNameOf(moduleSpecifiers("import 'a/b/c';")[0].specifier)).toBe('a');
  });

  it('grades a package phantom-deps would pass, and vice versa — they answer different questions', () => {
    const root = fixtureRepo('orthogonal', [
      {
        manifest: { name: '@fixture/both', dependencies: { declared: '^1.0.0' } },
        files: { 'src/index.ts': "import 'undeclared';\n" },
      },
    ]);
    // This gate sees the unused declaration and says nothing about the phantom.
    expect(verdict(root).map((f) => f.key)).toEqual(['declared']);
  });
});

// ── auditPackage / auditAllowances, called directly ──────────────────────────

describe('the unit seams', () => {
  it('auditPackage reports per-package counters the CLI sums', () => {
    const root = fixtureRepo('counters', [
      {
        manifest: { name: '@fixture/counted', dependencies: { styled: '^1.0.0', '@types/glob': '^8.0.0', glob: '^10.0.0' } },
        files: { 'src/index.css': "@plugin 'styled';\n", 'src/index.ts': "import 'glob';\n" },
      },
    ]);
    const pkg = { name: '@fixture/counted', dir: 'packages/counted', manifest: JSON.parse(fs.readFileSync(path.join(root, 'packages/counted/package.json'), 'utf8')) };
    const { findings, counters } = auditPackage(pkg, { root, allowances: {} });
    expect(findings).toEqual([]);
    expect(counters.viaCss).toBe(1);
    expect(counters.viaTypes).toBe(1);
    expect(counters.gatedDeclared).toBe(3);
  });

  it('auditAllowances is callable on its own and needs the consumed map to answer rule 3', () => {
    const pkg = { name: '@fixture/x', dir: 'packages/x', manifest: { dependencies: { ghost: '1' } } };
    expect(auditAllowances('/nowhere', [pkg], new Map(), { '@fixture/x': { ghost: { reason: 'r', verify: () => [] } } })).toEqual([]);
  });
});
