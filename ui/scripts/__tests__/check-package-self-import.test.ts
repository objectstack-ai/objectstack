import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCAN_ROOTS,
  SELF_IMPORT_EXEMPTIONS,
  analyze,
  auditExemptions,
  discoverPackages,
  judgeScan,
  scanRepository,
} from '../check-package-self-import.mjs';

/**
 * objectui#4801 — a file inside a package must not name its OWN package.
 *
 * The specifier is legal and it resolves: through the package's own `exports`
 * map, to `dist/`. What does not exist is an ORDERING — turbo gives `type-check`
 * `dependsOn: ["^build"]`, the DEPENDENCIES' builds, never the package's own —
 * so on a cold cache the declarations the specifier points at have not been
 * produced yet and the file fails with TS2307. PR #4789's first CI run was red
 * on exactly one line of exactly this shape in `packages/fields/src`.
 *
 * The reason it needs a gate rather than a review note is that no local workflow
 * can see it: every one of them builds before it type-checks, and
 * `pnpm --filter '<pkg>^...' build` leaves a `dist/` behind for any package that
 * is also someone else's dependency. Green everywhere, red in CI, once per
 * occurrence, at a cost of a full CI round plus a rework round.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **A package name inside a STRING LITERAL is not a module edge.** This is
 *     the reason the gate parses instead of grepping, and the counter-examples
 *     are live in this repository — `packages/i18n/src/__tests__` carries an
 *     import statement as fixture TEXT, `packages/layout/src/__tests__` assigns
 *     its own package name to a const it writes into a temp entry file.
 *  2. **The verdicts**, over throwaway package trees rather than this
 *     repository, so they stay decidable when the workspace moves.
 *  3. **The exemption table is re-derived, never trusted.** An entry whose site
 *     has gone silently widens the hole for the next file that lands there.
 *  4. **The scope cannot collapse quietly.** An empty walk would make every
 *     assertion vacuous, so it throws.
 *  5. **This repository is green, and the sites objectui#4801 converted stay
 *     converted** — including the `tsconfig.test.json` workaround that existed
 *     only to make one of them compile.
 *  6. **The gate is wired** where the sibling parse-based gates are.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-package-self-import.mjs';

/**
 * THE repository scan — computed exactly once, here, and judged many times below.
 *
 * Two assertions in this file are about this repository under DIFFERENT exemption
 * tables (the repository's own, and none at all), and one of them used to call
 * `analyze(repoRoot)` from inside an `it()`. That is a full TypeScript parse of
 * every source file of every workspace package — ~3,100 files, ~30 MB, ~15,500
 * module specifiers — and doing it twice is exactly the same work twice, because
 * the parse does not depend on the exemption table at all.
 *
 * It fits in the 15-second `testTimeout` uninstrumented (measured 8.8 s) and does
 * NOT fit under coverage (measured 41.3 s), which is why `ci.yml`'s
 * `Test (coverage)` job failed 100% of the time for four days — 50 of 51 completed
 * jobs, all on this file, all `Test timed out in 15000ms`. `@vitest/coverage-v8`
 * arms V8 precise coverage in the worker BEFORE test modules and their
 * dependencies compile; V8 emits those block counters at compile time and does so
 * isolate-wide, so `node_modules/typescript` is instrumented too (`coverage.exclude`
 * filters the report, never the instrumentation). Measured on this repository, the
 * identical parse costs 4.1-4.9 s uninstrumented and 32-35 s when coverage was
 * armed first: a 7x constant factor landing squarely on the parser.
 *
 * So the rule for anything added to this file: **judge `repoScan`, never rescan.**
 * `judgeScan()` is pure and costs microseconds; `analyze(repoRoot)` and
 * `scanRepository(repoRoot)` cost a full parse and must not appear inside an
 * `it()`. Module scope is deliberate — collection is not bounded by
 * `testTimeout`, and this scan is the file's one unavoidable cost.
 *
 * (objectui#5402. `analyze()` over a throwaway FIXTURE tree stays fine and is used
 * throughout — those trees hold a handful of tiny files.)
 */
const repoScan = scanRepository(repoRoot);

interface Finding {
  reason: string;
  pkg?: string;
  file?: string;
  specifier?: string;
  line?: number;
  column?: number;
  kind?: string;
  typeOnly?: boolean;
  detail?: string;
}

/** The exemption table's shape, as the gate documents it. */
type Exemptions = Record<string, { specifiers: string[]; reason: string }>;

// ── fixture package trees ────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

interface PackageSpec {
  /** `packages/<last segment of the name>` unless given. */
  dir?: string;
  manifest: Record<string, unknown>;
  /** `src`-relative path -> file body. */
  files: Record<string, string>;
}

/**
 * A throwaway workspace shaped like this one.
 *
 * Named `@fixture/*` deliberately: if the walk ever grew an `@object-ui/*`
 * assumption, every verdict below would flip.
 */
function fixtureRepo(label: string, packages: PackageSpec[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `self-import-${label}-`));
  fixtures.push(root);

  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('package.json', JSON.stringify({ name: '@fixture/root' }, null, 2));

  for (const spec of packages) {
    const dir = spec.dir ?? `packages/${(spec.manifest.name as string).split('/').pop()}`;
    write(`${dir}/package.json`, JSON.stringify(spec.manifest, null, 2));
    for (const [rel, body] of Object.entries(spec.files)) write(`${dir}/src/${rel}`, body);
  }
  return root;
}

/** `reason :: file :: specifier` for every finding, sorted — the readable verdict. */
const verdict = (root: string, exemptions: Exemptions = {}): string[] =>
  (analyze(root, { exemptions }).findings as Finding[])
    .map((f) => `${f.reason} :: ${f.file} :: ${f.specifier ?? ''}`)
    .sort();

// ── 1. a string is not an import ─────────────────────────────────────────────

describe('a package name that is not a module edge is not a finding', () => {
  it('ignores the name in a string constant, a fixture literal, a comment and JSDoc', () => {
    const root = fixtureRepo('literals', [
      {
        manifest: { name: '@fixture/talker' },
        files: {
          // Every shape this repository actually carries, in one file.
          'index.ts': [
            "// Consumers write `import { x } from '@fixture/talker';`.",
            '/**',
            " * @example import { x } from '@fixture/talker';",
            ' */',
            "const SPECIFIER = '@fixture/talker';",
            "const SNIPPET = \"import { x } from '@fixture/talker'\";",
            "export { SPECIFIER, SNIPPET };",
            "export const load = (): string => SPECIFIER;",
          ].join('\n'),
        },
      },
    ]);
    expect(verdict(root)).toEqual([]);
    // …and the file was really read, so "no findings" is a judgement rather than
    // a walk that skipped it.
    expect(analyze(root, { exemptions: {} }).counters.files).toBe(1);
  });

  it('the two live specimens in this repository stay unflagged', () => {
    // Named rather than left to the repo-wide green assertion, because these are
    // the files a regex-based rewrite of this gate would break first, and the
    // breakage would read as a real finding.
    // The layout specimen used to be `side-effects-manifest.test.ts`, whose
    // `SPECIFIER` constant held `'@object-ui/layout'`. objectui#3943 converged
    // that package-scoped pin into the repo-level
    // `side-effects-declaration-consistency.test.ts`, and with it gone NO file
    // under `packages/layout/src` carries the literal any more — so re-pointing
    // this entry at the new file would be wrong twice over: it lives outside
    // any package, and a file outside a package cannot import itself.
    //
    // Replaced rather than dropped, and with a JSDoc specimen from production
    // source rather than another test, which is the stronger case: a regex
    // rewrite of this gate breaks on a documented import example that quotes
    // its own package name exactly as it would on a test constant.
    //
    // (Spelled as bare package names rather than whole import phrases. That was
    // once required — `scripts-type-check.test.ts` matched the import shape in
    // the file's TEXT — and it is not any more: objectui#4902 moved that gate to
    // an AST walk, `workspaceImportSpecifiers()`, whose docstring is the
    // authoritative account. The spelling is kept because the map wants
    // specifiers, not import statements.)
    const specimens: Record<string, string> = {
      'packages/i18n/src/__tests__/perm-home-namespace-3546.test.tsx': '@object-ui/i18n',
      'packages/core/src/utils/freeze-schema.ts': '@object-ui/core',
    };
    for (const [file, owner] of Object.entries(specimens)) {
      const body = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(body, `${file} no longer carries the literal this pin is about`).toContain(`'${owner}'`);
    }
    expect((judgeScan(repoScan, {}).findings as Finding[]).map((f) => f.file)).toEqual([]);
  });
});

// ── 2. the verdicts ──────────────────────────────────────────────────────────

describe('a package naming itself is a finding, in every form', () => {
  it('flags import, re-export, require, dynamic import and type-position import', () => {
    const root = fixtureRepo('forms', [
      {
        manifest: { name: '@fixture/self' },
        files: {
          'a.ts': "import { a } from '@fixture/self';\nexport { a };\n",
          'b.ts': "export { b } from '@fixture/self';\n",
          'c.ts': "const c = require('@fixture/self');\nexport { c };\n",
          'd.ts': "export const d = () => import('@fixture/self');\n",
          'e.ts': "export type E = import('@fixture/self').Thing;\n",
          'f.ts': "import type { F } from '@fixture/self';\nexport type { F };\n",
        },
      },
    ]);
    expect(verdict(root)).toEqual([
      'package-self-import :: packages/self/src/a.ts :: @fixture/self',
      'package-self-import :: packages/self/src/b.ts :: @fixture/self',
      'package-self-import :: packages/self/src/c.ts :: @fixture/self',
      'package-self-import :: packages/self/src/d.ts :: @fixture/self',
      'package-self-import :: packages/self/src/e.ts :: @fixture/self',
      'package-self-import :: packages/self/src/f.ts :: @fixture/self',
    ]);
  });

  it('flags a SUBPATH of the package as well as its bare name', () => {
    // `@scope/pkg/sub` resolves through the same `exports` map to the same
    // unbuilt `dist`, so exempting subpaths would leave the failure intact under
    // a different spelling.
    const root = fixtureRepo('subpath', [
      {
        manifest: { name: '@fixture/self' },
        files: { 'a.ts': "import { a } from '@fixture/self/deep/thing';\nexport { a };\n" },
      },
    ]);
    expect(verdict(root)).toEqual(['package-self-import :: packages/self/src/a.ts :: @fixture/self/deep/thing']);
  });

  it('leaves relative paths, path aliases, builtins and OTHER packages alone', () => {
    const root = fixtureRepo('innocent', [
      {
        manifest: { name: '@fixture/self' },
        files: {
          'a.ts': [
            "import { x } from './local';",
            "import { y } from '../index';",
            "import { z } from '@/ui/button';",
            "import { readFileSync } from 'node:fs';",
            "import { j } from 'fs';",
            "import { s } from '@fixture/sibling';",
            "import React from 'react';",
            'export { x, y, z, readFileSync, j, s, React };',
          ].join('\n'),
        },
      },
      { manifest: { name: '@fixture/sibling' }, files: { 'index.ts': 'export const s = 1;\n' } },
    ]);
    expect(verdict(root)).toEqual([]);
    const c = analyze(root, { exemptions: {} }).counters;
    // Counted, not merely unflagged: a walk that stopped reading the file would
    // also produce zero findings.
    expect({ relative: c.relative, alias: c.alias, builtin: c.builtin, external: c.external }).toEqual({
      relative: 2,
      alias: 1,
      builtin: 2,
      external: 2,
    });
  });

  it('does not confuse a package whose name is a PREFIX of another', () => {
    // `@object-ui/plugin-form` vs `@object-ui/plugin-form-builder` is the live
    // shape; a `startsWith` comparison would flag the first importing the second.
    const root = fixtureRepo('prefix', [
      {
        manifest: { name: '@fixture/plug' },
        files: { 'a.ts': "import { a } from '@fixture/plug-extra';\nexport { a };\n" },
      },
      { manifest: { name: '@fixture/plug-extra' }, files: { 'index.ts': 'export const a = 1;\n' } },
    ]);
    expect(verdict(root)).toEqual([]);
  });

  it('scans apps/ and examples/, not only packages/', () => {
    // The failure is `type-check` racing a build, which has nothing to do with
    // whether a package is published — three example packages carry both a
    // `type-check` script and a `src/`.
    const root = fixtureRepo('roots', [
      { dir: 'apps/thing', manifest: { name: '@fixture/app' }, files: { 'a.ts': "import '@fixture/app';\n" } },
      { dir: 'examples/demo', manifest: { name: '@fixture/demo' }, files: { 'a.ts': "import '@fixture/demo';\n" } },
    ]);
    expect(verdict(root)).toEqual([
      'package-self-import :: apps/thing/src/a.ts :: @fixture/app',
      'package-self-import :: examples/demo/src/a.ts :: @fixture/demo',
    ]);
    expect(SCAN_ROOTS).toEqual(['packages', 'apps', 'examples']);
  });

  it('reports the line and column, because a finding has to be findable', () => {
    const root = fixtureRepo('position', [
      {
        manifest: { name: '@fixture/self' },
        files: { 'a.ts': "export const k = 1;\n\nimport '@fixture/self';\n" },
      },
    ]);
    const [finding] = analyze(root, { exemptions: {} }).findings as Finding[];
    expect({ file: finding.file, line: finding.line, column: finding.column ?? 1 }).toEqual({
      file: 'packages/self/src/a.ts',
      line: 3,
      column: 1,
    });
  });
});

// ── 3. the exemptions ────────────────────────────────────────────────────────

describe('an exemption is re-derived, never trusted', () => {
  const tree = (): string =>
    fixtureRepo('exempt', [
      {
        manifest: { name: '@fixture/self' },
        files: {
          'pinned.ts': "import { a } from '@fixture/self';\nexport { a };\n",
          'ordinary.ts': "import { b } from '@fixture/self';\nexport { b };\n",
        },
      },
    ]);

  it('suppresses exactly the file and specifier it names', () => {
    const root = tree();
    expect(
      verdict(root, {
        'packages/self/src/pinned.ts': {
          specifiers: ['@fixture/self'],
          reason: 'pins what a consumer resolves, so the package NAME is the subject',
        },
      }),
    ).toEqual(['package-self-import :: packages/self/src/ordinary.ts :: @fixture/self']);
  });

  it('reports an entry whose file no longer self-imports', () => {
    const root = tree();
    expect(
      verdict(root, {
        'packages/self/src/gone.ts': { specifiers: ['@fixture/self'], reason: 'a site that has since been fixed' },
      }),
    ).toEqual([
      'package-self-import :: packages/self/src/ordinary.ts :: @fixture/self',
      'package-self-import :: packages/self/src/pinned.ts :: @fixture/self',
      'stale-exemption :: packages/self/src/gone.ts :: @fixture/self',
    ]);
  });

  it('reports an entry whose SPECIFIER changed, even though the file still self-imports', () => {
    const root = tree();
    const findings = analyze(root, {
      exemptions: {
        'packages/self/src/pinned.ts': {
          specifiers: ['@fixture/self/subpath'],
          reason: 'the exempted spelling moved to a subpath',
        },
      },
    }).findings as Finding[];
    const stale = findings.find((f) => f.reason === 'stale-exemption');
    expect(stale?.detail).toContain("no longer imports '@fixture/self/subpath'");
    // The bare-name import in that same file is now judged again, which is the
    // point: a narrowed exemption must not keep covering what it no longer names.
    expect(findings.filter((f) => f.reason === 'package-self-import').map((f) => f.file).sort()).toEqual([
      'packages/self/src/ordinary.ts',
      'packages/self/src/pinned.ts',
    ]);
  });

  it('reports an entry with no written reason, and one that names no specifier', () => {
    expect(
      (
        auditExemptions(
          {
            'a.ts': { specifiers: ['@fixture/self'], reason: '   ' },
            'b.ts': { specifiers: [], reason: 'why' },
          } satisfies Exemptions,
          [{ file: 'a.ts', specifier: '@fixture/self' }],
        ) as Finding[]
      ).map((f) => `${f.file} :: ${f.detail}`),
    ).toEqual([
      'a.ts :: carries no written reason, so it cannot be reviewed',
      'b.ts :: names no specifier, so it exempts nothing',
    ]);
  });

  it('every entry in the repository table carries specifiers and a reason', () => {
    // Structural, not a count: the table is empty today by measurement (all five
    // self-references the phantom-deps report counted were triaged for
    // objectui#4801 and none was a deliberate packaging pin), and this stays
    // meaningful the day a real one is added.
    for (const [file, entry] of Object.entries(SELF_IMPORT_EXEMPTIONS as Record<string, unknown>)) {
      const value = entry as { specifiers?: string[]; reason?: string };
      expect(value.specifiers?.length, `${file} exempts nothing`).toBeGreaterThan(0);
      expect(value.reason?.trim().length, `${file} has no written reason`).toBeGreaterThan(0);
    }
  });
});

// ── 4. the scope cannot collapse ─────────────────────────────────────────────

describe('an empty scan is a failure, not a pass', () => {
  it('a workspace with no package throws', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'self-import-empty-'));
    fixtures.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@fixture/root"}');
    expect(() => discoverPackages(root)).toThrow(/no workspace package with a src\/ directory/);
  });

  it('the CLI refuses to report on an implausibly small scan', () => {
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toMatch(/The scan collapsed/);
    expect(gate).toMatch(/counters\.packages < 30 \|\| counters\.specifiers < 5000/);
  });
});

// ── 5. this repository ───────────────────────────────────────────────────────

describe('objectui itself', () => {
  // The repository's OWN exemption table, over the same single scan the
  // no-exemptions assertion above judges.
  const result = judgeScan(repoScan, SELF_IMPORT_EXEMPTIONS);

  it('scans a real surface (a guard that found nothing would pass everything)', () => {
    expect(result.counters.packages).toBeGreaterThan(30);
    expect(result.counters.specifiers).toBeGreaterThan(5000);
    expect((discoverPackages(repoRoot) as { name: string }[]).map((p) => p.name)).toContain('@object-ui/console');
  });

  it('no package imports itself', () => {
    expect(
      (result.findings as Finding[]).map((f) => `${f.file}: ${f.reason} ${f.specifier ?? ''}`),
      'run `pnpm check:self-import` — its output says which file names its own package',
    ).toEqual([]);
    expect(result.counters.selfImport).toBe(0);
  });

  it('pins the site PR #4789 paid for: the fields re-export test imports its own entry relatively', () => {
    // The general assertion above would catch a regression here too; this one is
    // named so a revert points straight at the evidence.
    const body = fs.readFileSync(
      path.join(repoRoot, 'packages/fields/src/cascadeOptionWidgetTypes.reexport.test.tsx'),
      'utf8',
    );
    expect(body).toContain("from './index'");
    // The quoted SPECIFIER alone, without the import keyword in front of it: a
    // quoted package name is a module edge in any of the five forms, and that
    // is the reason this assertion is spelled the way it is: it is the stronger
    // one. It once had a second reason — spelling the whole import phrase here
    // would trip `scripts-type-check.test.ts` — and that one expired when
    // objectui#4902 moved the sibling gate to the AST walk
    // `workspaceImportSpecifiers()`, which does not read assertion strings as
    // imports. The gate under test parses rather than greps for the same
    // reason, and that half still stands.
    expect(body).not.toContain("'@object-ui/fields'");
  });

  it('pins the two sites objectui#4801 converted', () => {
    const bench = fs.readFileSync(path.join(repoRoot, 'packages/core/src/__benchmarks__/core.bench.ts'), 'utf8');
    expect(bench).toContain("from '../index.js'");
    expect(bench).not.toContain("'@object-ui/core'");

    const snapshot = fs.readFileSync(
      path.join(repoRoot, 'packages/components/src/__tests__/snapshot-critical.test.tsx'),
      'utf8',
    );
    expect(snapshot).toContain("} from '../index';");
    expect(snapshot).not.toContain("'@object-ui/components'");
  });

  it('the tsconfig workaround the self-import needed is gone with it', () => {
    // `packages/components/tsconfig.test.json` mapped the package's own name back
    // to `src/index.ts` so the self-import would not reach `dist`. Leaving it
    // would have kept the workaround standing in for the fix — and would keep the
    // NEXT self-import in this package silently compiling.
    const config = fs.readFileSync(path.join(repoRoot, 'packages/components/tsconfig.test.json'), 'utf8');
    expect(config).toContain('"paths": {}');
    expect(config).not.toContain('"@object-ui/components": ["src/index.ts"]');
  });
});

// ── 5b. scan once, judge many ────────────────────────────────────────────────

describe('the judgement is separate from the scan, and pure', () => {
  // This is the property that lets the whole file share ONE `repoScan`. If
  // judging ever re-read the repository or consumed the scan, sharing it would
  // be wrong and the cost this file was cut down from would come straight back
  // (objectui#5402 — see the note on `repoScan`).

  it('judges the same scan under two tables without re-reading anything', () => {
    // A scan whose site names a file that does not exist: a judgement that went
    // back to the filesystem could not produce this finding.
    const scan = {
      packages: [{ name: '@fixture/self' }],
      sites: [
        {
          reason: 'package-self-import',
          pkg: '@fixture/self',
          file: 'packages/self/src/vanished.ts',
          line: 1,
          column: 1,
          kind: 'import',
          typeOnly: false,
          specifier: '@fixture/self',
        },
      ],
      counters: { packages: 1, files: 1, specifiers: 1, relative: 0, alias: 0, builtin: 0, external: 0, selfImport: 1 },
    };
    const frozen = structuredClone(scan);

    const strict = judgeScan(scan, {});
    expect((strict.findings as Finding[]).map((f) => `${f.file} :: ${f.specifier}`)).toEqual([
      'packages/self/src/vanished.ts :: @fixture/self',
    ]);
    expect(strict.counters.exempted).toBe(0);

    const lenient = judgeScan(scan, {
      'packages/self/src/vanished.ts': { specifiers: ['@fixture/self'], reason: 'pins what a consumer resolves' },
    });
    expect(lenient.findings).toEqual([]);
    expect(lenient.counters.exempted).toBe(1);

    // …and neither call consumed or edited the scan it was handed, so the next
    // judgement sees the same input.
    expect(scan).toEqual(frozen);
    expect((judgeScan(scan, {}).findings as Finding[]).map((f) => f.file)).toEqual([
      'packages/self/src/vanished.ts',
    ]);
  });

  it('hands out findings the caller cannot use to corrupt the scan', () => {
    const scan = scanRepository(
      fixtureRepo('purity', [
        {
          manifest: { name: '@fixture/self' },
          files: { 'a.ts': "import { a } from '@fixture/self';\nexport { a };\n" },
        },
      ]),
    );
    const [finding] = judgeScan(scan, {}).findings as Finding[];
    finding.file = 'rewritten-by-the-caller.ts';
    expect((judgeScan(scan, {}).findings as Finding[]).map((f) => f.file)).toEqual(['packages/self/src/a.ts']);
  });

  it('analyze() is exactly scanRepository() followed by judgeScan()', () => {
    const root = fixtureRepo('composition', [
      {
        manifest: { name: '@fixture/self' },
        files: {
          'a.ts': "import { a } from '@fixture/self';\nexport { a };\n",
          'b.ts': "export { b } from '@fixture/self/deep';\n",
        },
      },
    ]);
    const exemptions: Exemptions = {
      'packages/self/src/a.ts': { specifiers: ['@fixture/self'], reason: 'pins what a consumer resolves' },
    };
    expect(analyze(root, { exemptions })).toEqual(judgeScan(scanRepository(root), exemptions));
  });

  it('the scan carries no verdict of its own — counters.exempted belongs to the judgement', () => {
    // A scan that already knew what was exempt would be a scan tied to one
    // table, which is the thing this split exists to undo.
    expect(Object.keys(repoScan.counters as Record<string, number>)).not.toContain('exempted');
    expect(judgeScan(repoScan, {}).counters.exempted).toBe(0);
  });
});

// ── 6. the wiring ────────────────────────────────────────────────────────────

describe('the gate is wired where the sibling gates are', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

  it('package.json exposes it as a named script', () => {
    expect(pkg.scripts['check:self-import']).toBe(`node ${GATE}`);
  });

  it('ci.yml runs it after the install it needs (it parses with typescript)', () => {
    const install = ci.indexOf('pnpm install --frozen-lockfile');
    const step = ci.indexOf('run: pnpm check:self-import');
    expect(step, 'ci.yml does not run `pnpm check:self-import`').toBeGreaterThan(-1);
    expect(step, 'the check runs before dependencies are installed').toBeGreaterThan(install);
  });

  it('runs in the `type-check` job, where the other parse-based gates run', () => {
    const jobs = ci.slice(ci.search(/^jobs:[ \t]*$/m));
    const typeCheck = jobs.slice(jobs.search(/^ {2}type-check:[ \t]*$/m));
    const nextJob = typeCheck.slice(1).search(/^ {2}\S/m);
    const block = nextJob === -1 ? typeCheck : typeCheck.slice(0, nextJob + 1);
    expect(block).toContain('run: pnpm check:self-import');
  });

  it('shares the sibling gate\'s parser rather than growing a second one', () => {
    // Two parsers disagreeing about what a module edge IS is how one of two
    // gates quietly stops covering a form.
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toContain("from './check-phantom-dependencies.mjs'");
    expect(gate).toContain('moduleSpecifiers');
  });
});
