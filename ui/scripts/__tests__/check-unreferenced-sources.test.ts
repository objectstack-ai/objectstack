import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  COVERED_PACKAGES,
  analyze,
  applyAliasRule,
  auditCoverage,
  classifyAliases,
  evaluatePath,
  readBuildConfig,
} from '../check-unreferenced-sources.mjs';

/**
 * objectui#7515 — a source file nothing reaches must not sit in a published
 * package forever.
 *
 * Before this gate, none of the 42 `scripts/check-*.mjs` files could see one.
 * `check-dist-completeness` asks whether `dist/` holds what `tsc` emits;
 * `check-readme-exports` compares documented exports against shipped ones;
 * `check-i18n-dead-keys` covers message keys. A `.tsx` that is in the tarball
 * while being reachable from nothing is outside all three, and both instances
 * found this week — objectui#7319 and objectui#7397 — were found by a human
 * reading unrelated code.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The alias leg, which is the whole difficulty.** `packages/components`
 *     reaches two live files only through `vite.config.ts` `resolve.alias`
 *     entries whose importer is a bundled dependency no source file names. A
 *     walk that skips that leg reports exactly those two as dead on its first
 *     run, and a gate that cries wolf on live files gets switched off rather
 *     than fixed. Pinned over throwaway trees AND on this repository.
 *  2. **A true orphan is still reported** — the other direction, so a gate that
 *     passes because its loop body never runs cannot look correct.
 *  3. **An alias replacement's ROLE is decided by the filesystem**, not by its
 *     spelling: a file is a graph ROOT, a directory is a RESOLUTION RULE.
 *  4. **An unreadable config is a FINDING, never a skip.** An alias this gate
 *     cannot evaluate is an alias whose target it would otherwise accuse of
 *     being dead, so the safe direction is to fail on the config.
 *  5. **`find` is read as a VALUE, not as source text.** The first run of this
 *     gate reported `packages/components`' own `@` alias as unmodelled, because
 *     `JSON.parse` cannot read a single-quoted TypeScript string.
 *  6. **The coverage table is re-derived, never trusted** — an entry whose
 *     package has moved leaves the gate checking nothing while reporting a pass.
 *  7. **The scope cannot collapse quietly.** No roots must be a finding, not a
 *     green run over an unwalkable package.
 *  8. **This repository is green, and objectui#7515's orphan stays gone.**
 *  9. **The gate is wired** where the sibling parse-based gates are.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-unreferenced-sources.mjs';

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway one-package repository.
 *
 * Named `@fixture/*` deliberately: an `@object-ui/*` assumption anywhere in the
 * walk would flip every verdict below without any of them saying so.
 */
function fixtureRepo(label: string, files: Record<string, string>, viteConfig: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `unreferenced-${label}-`));
  fixtures.push(root);
  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('package.json', JSON.stringify({ name: '@fixture/root' }, null, 2));
  write('packages/widget/package.json', JSON.stringify({ name: '@fixture/widget' }, null, 2));
  write('packages/widget/vite.config.ts', viteConfig);
  for (const [rel, body] of Object.entries(files)) write(`packages/widget/src/${rel}`, body);
  return root;
}

const COVER = { 'packages/widget': { buildConfig: 'vite.config.ts', notes: 'fixture' } };

/** `reason :: subject` for every finding, sorted — the readable verdict. */
const verdict = (root: string, covered = COVER): string[] =>
  analyze(root, covered)
    .findings.map((f) => `${f.reason} :: ${f.file ?? f.pkg}`)
    .sort();

/** A build config with an entry and whatever alias array the caller wants. */
const config = (aliases = ''): string => `
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: { alias: [${aliases}] },
  build: { lib: { entry: resolve(__dirname, 'src/index.ts') } },
});
`;

// ── 1. the alias leg ─────────────────────────────────────────────────────────

describe('a file reached only through a build-config alias is alive', () => {
  const SHIM_ALIAS =
    "{ find: /^use-sync-external-store\\/shim(\\.js)?$/, replacement: resolve(__dirname, 'src/lib/shim.ts') },";

  it('stays silent on the alias target — the false positive that would disable the gate', () => {
    const root = fixtureRepo(
      'alias-alive',
      {
        'index.ts': "export { button } from './ui/button';\n",
        'ui/button.ts': 'export const button = 1;\n',
        'lib/shim.ts': "export { useSyncExternalStore } from 'react';\n",
      },
      config(SHIM_ALIAS),
    );
    expect(verdict(root)).toEqual([]);
  });

  it('reports that same file the moment the alias is gone — so the silence is CAUSED by the alias', () => {
    const root = fixtureRepo(
      'alias-removed',
      {
        'index.ts': "export { button } from './ui/button';\n",
        'ui/button.ts': 'export const button = 1;\n',
        'lib/shim.ts': "export { useSyncExternalStore } from 'react';\n",
      },
      config(),
    );
    expect(verdict(root)).toEqual(['unreferenced-source :: packages/widget/src/lib/shim.ts']);
  });

  it('walks THROUGH an alias target, so what the alias target imports is alive too', () => {
    const root = fixtureRepo(
      'alias-transitive',
      {
        'index.ts': 'export const nothing = 1;\n',
        'lib/shim.ts': "export { helper } from './shim-helper';\n",
        'lib/shim-helper.ts': 'export const helper = 1;\n',
      },
      config(SHIM_ALIAS),
    );
    expect(verdict(root)).toEqual([]);
  });
});

// ── 2. a true orphan is still reported ───────────────────────────────────────

describe('a file nothing reaches is reported', () => {
  it('names the orphan and nothing else', () => {
    const root = fixtureRepo(
      'orphan',
      {
        'index.ts': "export { button } from './ui/button';\n",
        'ui/button.ts': 'export const button = 1;\n',
        'ui/orphan.ts': 'export const Orphan = 1;\n',
      },
      config(),
    );
    expect(verdict(root)).toEqual(['unreferenced-source :: packages/widget/src/ui/orphan.ts']);
  });

  it('a file reached only by a TEST is still unreachable from the entry, and says so', () => {
    const root = fixtureRepo(
      'test-only',
      {
        'index.ts': 'export const entry = 1;\n',
        'lib/helper.ts': 'export const helper = 1;\n',
        '__tests__/helper.test.ts': "import { helper } from '../lib/helper';\n",
      },
      config(),
    );
    const { findings } = analyze(root, COVER);
    expect(findings.map((f) => f.reason)).toEqual(['unreferenced-source']);
    expect(findings[0].testImporters).toEqual(['packages/widget/src/__tests__/helper.test.ts']);
  });
});

// ── 3. the role of an alias is decided by the filesystem ─────────────────────

describe('a file alias is a ROOT; a directory alias is a RESOLUTION RULE', () => {
  it('a directory alias resolves specifiers without making anything a root', () => {
    const root = fixtureRepo(
      'dir-alias',
      {
        'index.ts': "export { button } from '@/ui/button';\n",
        'ui/button.ts': 'export const button = 1;\n',
        'ui/orphan.ts': 'export const Orphan = 1;\n',
      },
      config("{ find: '@', replacement: resolve(__dirname, './src') },"),
    );
    // `@/ui/button` resolved (so button is alive), and the directory alias did
    // NOT bless the whole tree (so the orphan is still reported).
    expect(verdict(root)).toEqual(['unreferenced-source :: packages/widget/src/ui/orphan.ts']);
  });

  it('classifyAliases splits the two by asking the disk, not the spelling', () => {
    const root = fixtureRepo(
      'classify',
      { 'index.ts': 'export const entry = 1;\n', 'lib/shim.ts': 'export const shim = 1;\n' },
      config(),
    );
    const pkgDir = path.join(root, 'packages/widget');
    const srcDir = path.join(pkgDir, 'src');
    const { roots, rules, outside } = classifyAliases(
      [
        { find: { kind: 'string', value: '@', text: '@' }, replacement: srcDir },
        { find: { kind: 'string', value: '~shim', text: '~shim' }, replacement: path.join(srcDir, 'lib/shim.ts') },
        { find: { kind: 'string', value: '@other', text: '@other' }, replacement: path.join(root, 'packages/other/src') },
      ],
      srcDir,
    );
    expect(roots.map((r) => path.relative(srcDir, r.file))).toEqual([path.join('lib', 'shim.ts')]);
    expect(rules).toHaveLength(1);
    expect(outside).toHaveLength(1);
  });
});

// ── 4. an unreadable config is a finding, never a skip ───────────────────────

describe('what this gate cannot read, it refuses to guess about', () => {
  it('an alias replacement it cannot evaluate is a finding', () => {
    const root = fixtureRepo(
      'unevaluatable',
      { 'index.ts': 'export const entry = 1;\n' },
      config("{ find: '~x', replacement: someHelper(__dirname) },"),
    );
    expect(verdict(root)).toEqual(['unevaluatable-alias :: packages/widget']);
  });

  it('a missing entry is a finding, and every file does NOT become an orphan on top of it', () => {
    const root = fixtureRepo(
      'no-entry',
      { 'index.ts': 'export const entry = 1;\n', 'lib/helper.ts': 'export const helper = 1;\n' },
      `
import { defineConfig } from 'vite';
export default defineConfig({ resolve: { alias: [] } });
`,
    );
    // `no-roots` short-circuits: reporting both source files as unreferenced
    // would bury the real defect under noise it caused itself.
    expect(verdict(root)).toEqual(['no-entry :: packages/widget', 'no-roots :: packages/widget']);
  });

  it('evaluatePath understands resolve/join over __dirname and refuses anything else', () => {
    const source = `export default { a: resolve(__dirname, 'src/x.ts'), b: process.env.ENTRY };`;
    const parsed = ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const object = (parsed.statements[0] as ts.ExportAssignment).expression as ts.ObjectLiteralExpression;
    const [a, b] = object.properties as unknown as ts.PropertyAssignment[];
    expect(evaluatePath(a.initializer, '/pkg')).toBe(path.resolve('/pkg', 'src/x.ts'));
    expect(evaluatePath(b.initializer, '/pkg')).toBeNull();
  });
});

// ── 5. `find` is a value, not source text ────────────────────────────────────

describe("an alias `find` is read as a VALUE — the miss this gate's first run made", () => {
  it('reads a single-quoted TypeScript string, which JSON.parse cannot', () => {
    const root = fixtureRepo(
      'single-quoted',
      { 'index.ts': "export { x } from '@/lib/x';\n", 'lib/x.ts': 'export const x = 1;\n' },
      config("{ find: '@', replacement: resolve(__dirname, './src') },"),
    );
    const { aliases } = readBuildConfig(path.join(root, 'packages/widget'), 'vite.config.ts');
    expect(aliases[0].find).toEqual({ kind: 'string', value: '@', text: "'@'" });
    // and the rule it produces actually resolves the specifier
    expect(applyAliasRule(aliases[0], '@/lib/x')).toBe(path.join(root, 'packages/widget/src', '/lib/x'));
  });

  it('reads a regex literal as a pattern, matching only what the pattern matches', () => {
    const root = fixtureRepo(
      'regex-find',
      { 'index.ts': 'export const entry = 1;\n', 'lib/shim.ts': 'export const shim = 1;\n' },
      config("{ find: /^shim(\\.js)?$/, replacement: resolve(__dirname, 'src/lib/shim.ts') },"),
    );
    const { aliases } = readBuildConfig(path.join(root, 'packages/widget'), 'vite.config.ts');
    expect(aliases[0].find.kind).toBe('regex');
    expect(applyAliasRule(aliases[0], 'shim.js')).toBe(aliases[0].replacement);
    expect(applyAliasRule(aliases[0], 'shim/deep')).toBeNull();
  });
});

// ── 6/7. the coverage table, and the scope that must not collapse ────────────

describe('the coverage table is re-derived on every run', () => {
  it('a covered package that has moved is a finding, not a silent pass', () => {
    const root = fixtureRepo('stale', { 'index.ts': 'export const entry = 1;\n' }, config());
    expect(auditCoverage(root, { 'packages/gone': { buildConfig: 'vite.config.ts', notes: 'x' } })).toEqual([
      { reason: 'stale-coverage', pkg: 'packages/gone', detail: 'no src/ directory' },
    ]);
  });

  it('a coverage entry with no notes is an unreviewable claim and is rejected', () => {
    const root = fixtureRepo('no-notes', { 'index.ts': 'export const entry = 1;\n' }, config());
    const findings = auditCoverage(root, { 'packages/widget': { buildConfig: 'vite.config.ts', notes: '' } });
    expect(findings.map((f) => f.detail)).toContain('no notes — an unreviewable coverage claim');
  });

  it('the uncovered remainder is DERIVED from the workspace, not written down', () => {
    const root = fixtureRepo('remainder', { 'index.ts': 'export const entry = 1;\n' }, config());
    expect(analyze(root, {}).uncovered).toEqual(['packages/widget']);
    expect(analyze(root, COVER).uncovered).toEqual([]);
  });
});

// ── 8. this repository ───────────────────────────────────────────────────────

describe('this repository', () => {
  const result = analyze(repoRoot);

  it('is green — every shipped source file in every covered package is reachable', () => {
    expect(result.findings).toEqual([]);
  });

  it('covers packages/components, whose alias leg is the reason this gate exists', () => {
    expect(Object.keys(COVERED_PACKAGES)).toContain('packages/components');
    expect(COVERED_PACKAGES['packages/components'].notes).not.toBe('');
  });

  it('did not go green by walking nothing', () => {
    // The failure mode objectui#7070 names: a gate that passes because its loop
    // body never ran. Floors, not exact figures, so ordinary churn does not
    // rewrite this file.
    expect(result.counters.packages).toBeGreaterThanOrEqual(1);
    expect(result.counters.files).toBeGreaterThan(150);
    expect(result.counters.reached).toBe(result.counters.files);
    expect(result.counters.specifiers).toBeGreaterThan(500);
    expect(result.counters.entries).toBeGreaterThanOrEqual(1);
    expect(result.counters.aliasRoots).toBeGreaterThanOrEqual(1);
  });

  it('still reports the two use-sync-external-store shims as ALIVE', () => {
    // The two files the card named as the false positives any gate of this
    // class produces. Nothing imports either one; both are reached only through
    // vite.config.ts.
    const src = path.join(repoRoot, 'packages/components/src');
    for (const shim of ['lib/use-sync-external-store-shim.ts', 'lib/use-sync-external-store-with-selector-shim.ts']) {
      expect(fs.existsSync(path.join(src, shim)), `${shim} is gone — this pin no longer proves anything`).toBe(true);
    }
    expect(
      result.findings.filter((f) => f.file?.includes('use-sync-external-store')),
    ).toEqual([]);
  });

  it("objectui#7515's orphan stays deleted", () => {
    expect(fs.existsSync(path.join(repoRoot, 'packages/components/src/ui/toast.tsx'))).toBe(false);
    // It was never on the published surface: the barrel that carries `ui/*`
    // never named it. Re-derived rather than asserted, so a re-added export
    // fails here rather than in a consumer's bundle.
    const barrel = fs.readFileSync(path.join(repoRoot, 'packages/components/src/ui/index.ts'), 'utf8');
    expect(barrel).not.toContain("from './toast'");
    expect(barrel).toContain("from './sonner'"); // control: the live implementation IS carried
  });

  it('no longer declares the dependency that only the orphan imported', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/components/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@radix-ui/react-toast']).toBeUndefined();
    expect(manifest.dependencies['@radix-ui/react-dialog']).toBeDefined(); // control: live radix deps stay
  });
});

// ── 9. the wiring ────────────────────────────────────────────────────────────

describe('the gate is wired where the sibling gates are', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

  it('package.json exposes it as a named script', () => {
    expect(pkg.scripts['check:unreferenced-sources']).toBe(`node ${GATE}`);
  });

  it('ci.yml runs it after the install it needs (it parses with typescript)', () => {
    const install = ci.indexOf('pnpm install --frozen-lockfile');
    const step = ci.indexOf('run: pnpm check:unreferenced-sources');
    expect(step, 'ci.yml does not run `pnpm check:unreferenced-sources`').toBeGreaterThan(-1);
    expect(step, 'the check runs before dependencies are installed').toBeGreaterThan(install);
  });

  it('runs in the `type-check` job, where the other parse-based gates run', () => {
    const jobs = ci.slice(ci.search(/^jobs:[ \t]*$/m));
    const typeCheck = jobs.slice(jobs.search(/^ {2}type-check:[ \t]*$/m));
    const nextJob = typeCheck.slice(1).search(/^ {2}\S/m);
    const block = nextJob === -1 ? typeCheck : typeCheck.slice(0, nextJob + 1);
    expect(block).toContain('run: pnpm check:unreferenced-sources');
  });

  it("shares the sibling gate's parser rather than growing a second one", () => {
    // Two parsers disagreeing about what a module edge IS is how one of two
    // gates quietly stops covering a form.
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toContain("from './check-phantom-dependencies.mjs'");
    expect(gate).toContain('moduleSpecifiers');
  });
});
