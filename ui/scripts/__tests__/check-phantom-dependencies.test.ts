import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  ALL_FIELDS,
  RUNTIME_FIELDS,
  TOOLING_FILE,
  analyze,
  auditExemptions,
  auditPackage,
  discoverPackages,
  isBuiltin,
  moduleSpecifiers,
  packageNameOf,
  readReleaseGroup,
} from '../check-phantom-dependencies.mjs';

/**
 * objectui#4394 — a bare specifier resolving from a package directory says
 * nothing about whether that package DECLARES it.
 *
 * The root `package.json` carries `devDependencies.react`, so a
 * `node_modules/react` symlink exists at the workspace root and Node's — and
 * TypeScript's — upward walk reaches it from any package directory. A
 * dependency-direction check performed by resolution therefore returns the wrong
 * answer, confidently, and the disagreement is silent all the way to a
 * consumer's install.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The parser sees every form that makes a module edge.** A gate reading
 *     only `import` is satisfied by rewriting the import as `require`, and the
 *     lazy `import()` is exactly where a plugin's undeclared dependency hides.
 *  2. **Node builtins are recognised BEFORE the package-name grammar.** This is
 *     a regression pin, not a hypothetical: `node:fs` is not a legal package
 *     name, so a grammar-first reading filed all 127 `node:`-prefixed imports as
 *     path aliases and graded none of them. Nothing in the verdict moved — only
 *     a counter did — which is why it is pinned by counter here.
 *  3. **The verdicts**, over throwaway package trees rather than this
 *     repository, so they stay decidable when the workspace moves.
 *  4. **The exemptions are re-derived, never trusted.** An exemption is worth
 *     what its evidence is worth; one whose evidence has gone covers a package
 *     that may now be shipping undeclared imports.
 *  5. **The scope cannot collapse quietly.** An empty release group would make
 *     every assertion vacuous, so it throws.
 *  6. **This repository is green, and the one defect the gate found is fixed.**
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-phantom-dependencies.mjs';

interface Finding {
  reason: string;
  pkg?: string;
  name?: string;
  specifier?: string;
  file?: string;
  line?: number;
  typeOnly?: boolean;
  kind?: string;
  detail?: string;
  missing?: string[];
}

// ── fixture package trees ────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

interface PackageSpec {
  /** `packages/<dir>` unless given. */
  dir?: string;
  manifest: Record<string, unknown>;
  /** `src`-relative path -> file body. */
  files: Record<string, string>;
}

/**
 * A throwaway workspace shaped like this one: a `fixed` release group, a root
 * manifest with `devDependencies`, and packages under `packages/`.
 *
 * Named `@fixture/*` deliberately — if the gate ever stopped reading
 * `.changeset/config.json` and fell back to an `@object-ui/*` surface, every
 * verdict below would flip, which is the drift these trees exist to catch.
 */
function fixtureRepo(
  label: string,
  packages: PackageSpec[],
  { rootDevDependencies = {} as Record<string, string>, released = null as string[] | null } = {},
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `phantom-deps-${label}-`));
  fixtures.push(root);

  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };

  const names = released ?? packages.map((p) => p.manifest.name as string);
  write('.changeset/config.json', JSON.stringify({ fixed: [names], ignore: [] }, null, 2));
  write('package.json', JSON.stringify({ name: '@fixture/root', devDependencies: rootDevDependencies }, null, 2));

  for (const spec of packages) {
    const dir = spec.dir ?? `packages/${(spec.manifest.name as string).split('/').pop()}`;
    write(`${dir}/package.json`, JSON.stringify(spec.manifest, null, 2));
    for (const [rel, body] of Object.entries(spec.files)) write(`${dir}/src/${rel}`, body);
  }
  return root;
}

/**
 * `reason :: package :: dependency` for every finding, sorted — the readable
 * verdict.
 *
 * `bundled: {}` because the real exemption table describes THIS repository:
 * against a throwaway tree its one entry is legitimately stale, and every
 * verdict below would carry that noise. The exemption block further down passes
 * its own table, and the real one is checked against the real repository.
 */
const verdict = (root: string): string[] =>
  (analyze(root, { bundled: {} }).findings as Finding[])
    .map((f) => `${f.reason} :: ${f.pkg ?? f.name} :: ${f.name}`)
    .sort();

/** The counters, which is where the builtin/alias regression shows up. */
const counters = (root: string): Record<string, number> => analyze(root, { bundled: {} }).counters;

// ── 1. the parser ────────────────────────────────────────────────────────────

describe('every form that makes a module edge is read', () => {
  it('reads static, re-export, type-only, dynamic, require and import-equals forms', () => {
    const found = moduleSpecifiers(
      `import a from 'alpha';
import type { B } from 'beta';
export { c } from 'gamma';
export type { D } from 'delta';
import epsilon = require('epsilon');
const z = require('zeta');
const lazy = () => import('eta');
type T = import('theta').Thing;
import './local';
`,
      'probe.ts',
    );
    expect(found.map((f: { specifier: string }) => f.specifier)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      // Source order, not a form ranking: `require('zeta')` sits above the
      // lazy `import('eta')` in the fixture, and the walk reports what it meets.
      'zeta',
      'eta',
      'theta',
      './local',
    ]);
  });

  it('flags exactly the type-only forms as type-only', () => {
    const found = moduleSpecifiers(
      `import type { B } from 'beta';
import { value } from 'beta';
export type { D } from 'delta';
type T = import('theta').Thing;
`,
      'probe.ts',
    );
    // Both directions on one fixture, because a parser that lost the flag would
    // pass either half alone: `beta` appears twice, once type-only and once not,
    // so "everything is type-only" and "nothing is" are both red here.
    expect(
      found.map((f: { specifier: string; kind: string; typeOnly: boolean }) => `${f.specifier}/${f.kind}:${f.typeOnly}`),
    ).toEqual([
      'beta/import:true',
      'beta/import:false',
      'delta/export:true',
      'theta/import()-type:true',
    ]);
  });

  it('reports the line a specifier is on, because a finding has to be findable', () => {
    const found = moduleSpecifiers("\n\nimport x from 'alpha';\n", 'probe.ts');
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
  });
});

describe('setParentNodes is OFF, because nothing here reads a parent (objectui#5410)', () => {
  it('the parser call spells it out as a deliberate `false`, not a bare positional', () => {
    // Regression pin on the source text itself. A silent flip back to `true`
    // would cost every one of this file's callers a full linking pass over the
    // parsed tree for a pointer nothing here follows, and would do it invisibly
    // — the CLI's output does not change either way (see the next test).
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toMatch(
      /ts\.createSourceFile\(\s*fileName,\s*text,\s*ts\.ScriptTarget\.Latest,\s*\/\*\s*setParentNodes\s*\*\/\s*false,\s*ts\.ScriptKind\.TSX\s*\)/,
    );
  });

  it('a tree parsed with setParentNodes: false has no `.parent`, and getStart(source) still works', () => {
    // Demonstrates the mechanism the comment in the gate claims, rather than
    // trusting the claim: with parent nodes off, `.parent` is genuinely absent
    // on every node this walk visits, and `getStart(source)` — called with the
    // source file passed EXPLICITLY, as moduleSpecifiers() does — still resolves
    // a position without needing to climb to `.parent` to find it.
    const source = ts.createSourceFile('probe.ts', "import a from 'alpha';\n", ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    let importNode: ts.Node | undefined;
    ts.forEachChild(source, (node) => {
      if (ts.isImportDeclaration(node)) importNode = node;
    });
    expect(importNode).toBeDefined();
    expect((importNode as ts.Node & { parent?: ts.Node }).parent).toBeUndefined();
    expect(() => importNode!.getStart(source)).not.toThrow();
  });

  it('moduleSpecifiers() output is unaffected — pinned against the true/false parity measured for objectui#5410', () => {
    // Not a re-measurement of the ~3,300-file repository corpus (that lives in
    // the PR that closed objectui#5410, run once as a manual check, not as a
    // per-commit test); this is the same claim on a fixture small enough to
    // pin: every form moduleSpecifiers() recognizes, parsed both ways, must
    // produce byte-identical findings.
    const src = `import a from 'alpha';
import type { B } from 'beta';
export { c } from 'gamma';
export type { D } from 'delta';
import epsilon = require('epsilon');
const z = require('zeta');
const lazy = () => import('eta');
type T = import('theta').Thing;
import './local';
`;
    const withParents = moduleSpecifiers(src, 'probe.ts');

    // The reference computed independently, with the flag pinned to `true`
    // rather than imported from the gate, so this test cannot pass merely
    // because both sides read the same (possibly-regressed) constant.
    function moduleSpecifiersWithParents(text: string, fileName: string) {
      const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: { specifier: string; kind: string; typeOnly: boolean; line: number; column: number }[] = [];
      const push = (node: ts.Node, specifier: string, kind: string, typeOnly: boolean) => {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({ specifier, kind, typeOnly, line: line + 1, column: character + 1 });
      };
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          push(node, node.moduleSpecifier.text, 'import', Boolean(node.importClause?.isTypeOnly));
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          push(node, node.moduleSpecifier.text, 'export', Boolean(node.isTypeOnly));
        } else if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          ts.isStringLiteral(node.moduleReference.expression)
        ) {
          push(node, node.moduleReference.expression.text, 'import=', false);
        } else if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument) &&
          ts.isStringLiteral(node.argument.literal)
        ) {
          push(node, node.argument.literal.text, 'import()-type', true);
        } else if (ts.isCallExpression(node)) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) push(node, argument.text, 'dynamic import()', false);
            else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
              push(node, argument.text, 'require()', false);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return found;
    }

    expect(withParents).toEqual(moduleSpecifiersWithParents(src, 'probe.ts'));
  });
});

// ── 2. package names, aliases and builtins ───────────────────────────────────

describe('a specifier is resolved to the PACKAGE it belongs to', () => {
  it('strips subpaths and keeps scopes whole', () => {
    expect(packageNameOf('react')).toBe('react');
    expect(packageNameOf('react-dom/client')).toBe('react-dom');
    expect(packageNameOf('@object-ui/core')).toBe('@object-ui/core');
    expect(packageNameOf('@object-ui/core/registry')).toBe('@object-ui/core');
    expect(packageNameOf('@testing-library/jest-dom/vitest')).toBe('@testing-library/jest-dom');
  });

  it('rejects a tsconfig path alias by GRAMMAR, not by a list of aliases', () => {
    // npm has no empty scope, so `@/x` cannot name a package. Every package here
    // maps `@/*` to `src/*`, and the day one is written it must not be graded as
    // a missing dependency called `@`.
    expect(packageNameOf('@/ui/button')).toBeNull();
    expect(packageNameOf('@')).toBeNull();
    expect(packageNameOf('./relative')).toBeNull();
    expect(packageNameOf('../up')).toBeNull();
    expect(packageNameOf('/absolute')).toBeNull();
    expect(packageNameOf('')).toBeNull();
  });

  it('knows the node builtins in both spellings', () => {
    expect(isBuiltin('node:fs')).toBe(true);
    expect(isBuiltin('fs')).toBe(true);
    expect(isBuiltin('node:fs/promises')).toBe(true);
    expect(isBuiltin('child_process')).toBe(true);
    expect(isBuiltin('react')).toBe(false);
    expect(isBuiltin('@object-ui/core')).toBe(false);
  });
});

describe('builtins are recognised BEFORE the package-name grammar (regression)', () => {
  /**
   * `node:fs` fails `packageNameOf` — npm names may not contain `:` — so a gate
   * that asked the grammar first filed every `node:`-prefixed import as a path
   * alias and graded none of them. The verdict did not move when this was live;
   * only the counters did, which is exactly why the counter is the assertion.
   */
  const tree = (): string =>
    fixtureRepo('builtin-order', [
      {
        manifest: { name: '@fixture/tool', version: '1.0.0', devDependencies: { '@types/node': '^26.0.0' } },
        files: { 'index.ts': "import { readFileSync } from 'node:fs';\nimport { join } from 'path';\nexport { readFileSync, join };\n" },
      },
    ]);

  it('counts both spellings as builtins and neither as a path alias', () => {
    const c = counters(tree());
    expect(c.builtin).toBe(2);
    expect(c.alias).toBe(0);
  });

  it('a package with no @types/node is told so, for the `node:` form too', () => {
    const root = fixtureRepo('builtin-untyped', [
      {
        manifest: { name: '@fixture/untyped', version: '1.0.0' },
        files: { 'index.ts': "import { readFileSync } from 'node:fs';\nexport { readFileSync };\n" },
      },
    ]);
    expect(verdict(root)).toEqual(['builtin-without-types :: @fixture/untyped :: node:fs']);
  });

  it('a tooling file may lean on the ROOT declaring @types/node; a runtime file may not', () => {
    const files = {
      'index.ts': "import { readFileSync } from 'node:fs';\nexport { readFileSync };\n",
      '__tests__/a.test.ts': "import { readFileSync } from 'node:fs';\nexport { readFileSync };\n",
    };
    const withRoot = fixtureRepo(
      'builtin-root',
      [{ manifest: { name: '@fixture/untyped', version: '1.0.0' }, files }],
      { rootDevDependencies: { '@types/node': '^26.0.0' } },
    );
    // Only the runtime file is reported — the tooling one is covered by the root.
    expect(verdict(withRoot)).toEqual(['builtin-without-types :: @fixture/untyped :: node:fs']);
  });
});

// ── 3. the verdicts ──────────────────────────────────────────────────────────

describe('a runtime file must name its imports in a field a consumer installs', () => {
  const runtimeFile = "import { Link } from 'react-router-dom';\nexport { Link };\n";

  it('RED when the package declares it nowhere — the objectui#4394 shape', () => {
    const root = fixtureRepo('undeclared', [
      { manifest: { name: '@fixture/plugin', version: '1.0.0' }, files: { 'index.ts': runtimeFile } },
    ]);
    expect(verdict(root)).toEqual(['undeclared-runtime :: @fixture/plugin :: react-router-dom']);
  });

  it('RED when the ROOT declares it and the package does not — that is the whole trap', () => {
    // The root's devDependencies are on the resolution path from every package
    // directory and on no consumer's. If this ever went green the gate would be
    // measuring resolution again, which is the thing it exists to stop.
    const root = fixtureRepo(
      'root-hoisted',
      [{ manifest: { name: '@fixture/plugin', version: '1.0.0' }, files: { 'index.ts': runtimeFile } }],
      { rootDevDependencies: { 'react-router-dom': '^7.0.0' } },
    );
    expect(verdict(root)).toEqual(['undeclared-runtime :: @fixture/plugin :: react-router-dom']);
  });

  it('RED, with its own reason, when it is declared only in devDependencies', () => {
    // Distinguished from "declared nowhere" on purpose: the fix is a move, not
    // an addition, and a message that said "add it" would be wrong here.
    const root = fixtureRepo('dev-only', [
      {
        manifest: { name: '@fixture/plugin', version: '1.0.0', devDependencies: { 'react-router-dom': '^7.0.0' } },
        files: { 'index.ts': runtimeFile },
      },
    ]);
    expect(verdict(root)).toEqual(['dev-only-runtime :: @fixture/plugin :: react-router-dom']);
  });

  it.each(RUNTIME_FIELDS)('GREEN when declared in %s', (field) => {
    const root = fixtureRepo(`green-${field}`, [
      {
        manifest: { name: '@fixture/plugin', version: '1.0.0', [field]: { 'react-router-dom': '^7.0.0' } },
        files: { 'index.ts': runtimeFile },
      },
    ]);
    expect(verdict(root)).toEqual([]);
  });

  it('judges a subpath import by its PACKAGE, not by the whole specifier', () => {
    const root = fixtureRepo('subpath', [
      {
        manifest: { name: '@fixture/plugin', version: '1.0.0', dependencies: { 'react-dom': '^19.0.0' } },
        files: { 'index.ts': "import { createRoot } from 'react-dom/client';\nexport { createRoot };\n" },
      },
    ]);
    expect(verdict(root)).toEqual([]);
  });
});

describe('type-only imports are STRICT, and that grading is deliberate', () => {
  it('RED for `import type` from an undeclared package', () => {
    // The emitted `.d.ts` keeps the reference, so a consumer type-checking
    // against this package needs the types installed — and the import is one
    // edit away from becoming a value import with nothing reporting the
    // promotion. A carve-out here is the tolerant-consumer shape AGENTS.md #0.1
    // rejects on principle.
    const root = fixtureRepo('type-only', [
      {
        manifest: { name: '@fixture/plugin', version: '1.0.0' },
        files: { 'index.ts': "import type { ReactNode } from 'react';\nexport type Node = ReactNode;\n" },
      },
    ]);
    const findings = analyze(root, { bundled: {} }).findings as Finding[];
    expect(findings.map((f) => `${f.reason} :: ${f.name}`)).toEqual(['undeclared-runtime :: react']);
    expect(findings[0].typeOnly, 'the finding must say it was type-only, so the reader can judge it').toBe(true);
  });
});

describe('a tooling file is judged against the package OR the workspace root', () => {
  const toolingFiles = {
    '__tests__/a.test.ts': "import { describe } from 'vitest';\nexport { describe };\n",
    'b.test.ts': "import { render } from '@testing-library/react';\nexport { render };\n",
    '__benchmarks__/c.bench.ts': "import { bench } from 'vitest';\nexport { bench };\n",
  };

  it('GREEN when the root declares the shared toolchain, and the lean is COUNTED', () => {
    // The concession is real, so its size is printed on every run rather than
    // absorbed: 1872 imports lean on it in this repository today.
    const root = fixtureRepo(
      'tooling-root',
      [{ manifest: { name: '@fixture/plugin', version: '1.0.0' }, files: toolingFiles }],
      { rootDevDependencies: { vitest: '^4.0.0', '@testing-library/react': '^16.0.0' } },
    );
    expect(verdict(root)).toEqual([]);
    expect(counters(root).toolingViaRoot).toBe(3);
  });

  it('RED when NOTHING declares it — not the package, not the root', () => {
    const root = fixtureRepo('tooling-orphan', [
      { manifest: { name: '@fixture/plugin', version: '1.0.0' }, files: toolingFiles },
    ]);
    expect(verdict(root)).toEqual([
      'undeclared-tooling :: @fixture/plugin :: @testing-library/react',
      'undeclared-tooling :: @fixture/plugin :: vitest',
      'undeclared-tooling :: @fixture/plugin :: vitest',
    ]);
  });

  it("the package's own devDependencies answer it too, with no lean on the root", () => {
    const root = fixtureRepo('tooling-own', [
      {
        manifest: {
          name: '@fixture/plugin',
          version: '1.0.0',
          devDependencies: { vitest: '^4.0.0', '@testing-library/react': '^16.0.0' },
        },
        files: toolingFiles,
      },
    ]);
    expect(verdict(root)).toEqual([]);
    expect(counters(root).toolingViaRoot).toBe(0);
  });

  it('classifies the tooling shapes this repository actually uses', () => {
    for (const file of [
      'packages/x/src/__tests__/a.test.ts',
      'packages/x/src/__mocks__/server.ts',
      'packages/x/src/__benchmarks__/x.bench.ts',
      'packages/x/src/a.test.tsx',
      'packages/x/src/a.spec.ts',
      'packages/x/src/a.bench.ts',
      'packages/x/src/a.stories.tsx',
    ]) {
      expect(TOOLING_FILE.test(file), `${file} must be graded as tooling`).toBe(true);
    }
    for (const file of [
      'packages/x/src/index.ts',
      'packages/x/src/renderers/Link.tsx',
      // The near-misses. A directory merely CALLED `test` is not the convention
      // here, and a file whose name contains "test" is not a test file.
      'packages/x/src/testing/harness.ts',
      'packages/x/src/latest.ts',
    ]) {
      expect(TOOLING_FILE.test(file), `${file} must be graded as runtime`).toBe(false);
    }
  });
});

describe('the gradings that are not about dependency fields at all', () => {
  it('a self-reference is fine when the package declares `exports`, and reported when it does not', () => {
    const files = { 'index.ts': "import { x } from '@fixture/self';\nexport { x };\n" };
    const withExports = fixtureRepo('self-ok', [
      { manifest: { name: '@fixture/self', version: '1.0.0', exports: { '.': './dist/index.js' } }, files },
    ]);
    expect(verdict(withExports)).toEqual([]);
    expect(counters(withExports).selfReference).toBe(1);

    const withoutExports = fixtureRepo('self-broken', [
      { manifest: { name: '@fixture/self', version: '1.0.0' }, files },
    ]);
    expect(verdict(withoutExports)).toEqual(['self-reference-without-exports :: @fixture/self :: @fixture/self']);
  });

  it('a host-provided module needs its evidence, and says which half is missing', () => {
    const files = { 'index.ts': "import * as vscode from 'vscode';\nexport { vscode };\n" };
    const proven = fixtureRepo('host-ok', [
      {
        manifest: {
          name: '@fixture/ext',
          version: '1.0.0',
          engines: { vscode: '^1.85.0' },
          devDependencies: { '@types/vscode': '^1.125.0' },
        },
        files,
      },
    ]);
    expect(verdict(proven)).toEqual([]);

    const unproven = fixtureRepo('host-unproven', [
      { manifest: { name: '@fixture/ext', version: '1.0.0' }, files },
    ]);
    const findings = analyze(unproven, { bundled: {} }).findings as Finding[];
    expect(findings.map((f) => f.reason)).toEqual(['host-module-unproven']);
    expect(findings[0].missing).toEqual(['`@types/vscode` in a dependency field', '`engines.vscode`']);
  });
});

describe('scope: only the release group, only `src/`', () => {
  it('does not read a package outside the `fixed` group', () => {
    const root = fixtureRepo(
      'out-of-group',
      [
        { manifest: { name: '@fixture/kept', version: '1.0.0' }, files: { 'index.ts': "export const a = 1;\n" } },
        { manifest: { name: '@fixture/loose', version: '1.0.0' }, files: { 'index.ts': "import 'ghost';\n" } },
      ],
      { released: ['@fixture/kept'] },
    );
    expect(verdict(root)).toEqual([]);
    expect(discoverPackages(root).map((p: { name: string }) => p.name)).toEqual(['@fixture/kept']);
  });

  it('does not read files outside `src/`', () => {
    const root = fixtureRepo('outside-src', [
      { manifest: { name: '@fixture/kept', version: '1.0.0' }, files: { 'index.ts': "export const a = 1;\n" } },
    ]);
    fs.writeFileSync(path.join(root, 'packages/kept/vite.config.ts'), "import 'ghost';\n");
    expect(verdict(root)).toEqual([]);
  });
});

// ── 4. exemptions are re-derived, never trusted ──────────────────────────────

describe('an exemption is worth exactly what its evidence is worth', () => {
  const bundled = {
    '@fixture/app': {
      config: 'packages/app/vite.config.ts',
      reason: 'fixture',
      verify(root: string, pkg: { manifest: { scripts?: Record<string, string> } }): string[] {
        const problems: string[] = [];
        if (!/\bvite build\b/.test(pkg.manifest.scripts?.build ?? '')) problems.push('build script no longer runs vite build');
        const config = fs.readFileSync(path.join(root, 'packages/app/vite.config.ts'), 'utf8');
        if (/^\s*external\s*:/m.test(config)) problems.push('rollupOptions.external is back');
        return problems;
      },
    },
  };

  function appRepo(label: string, { build = 'vite build', external = false } = {}): string {
    const root = fixtureRepo(label, [
      {
        dir: 'packages/app',
        manifest: {
          name: '@fixture/app',
          version: '1.0.0',
          scripts: { build },
          devDependencies: { 'react-router-dom': '^7.0.0' },
        },
        files: { 'index.ts': "import { Link } from 'react-router-dom';\nexport { Link };\n" },
      },
    ]);
    fs.writeFileSync(
      path.join(root, 'packages/app/vite.config.ts'),
      external ? 'export default { build: { rollupOptions: {\n  external: [/x/],\n} } };\n' : 'export default { build: {} };\n',
    );
    return root;
  }

  it('a bundled application may answer a runtime import from devDependencies', () => {
    const root = appRepo('bundled-ok');
    const pkg = discoverPackages(root)[0];
    expect(auditExemptions(root, [pkg], bundled)).toEqual([]);
    expect(auditPackage(pkg, { root, bundled }).findings).toEqual([]);
  });

  it('and stops being able to the moment its imports go external again', () => {
    const root = appRepo('bundled-external', { external: true });
    const pkg = discoverPackages(root)[0];
    const stale = auditExemptions(root, [pkg], bundled) as Finding[];
    expect(stale.map((f) => f.reason)).toEqual(['stale-exemption']);
    expect(stale[0].detail).toContain('external');
  });

  it('or the moment the build stops being a bundler build', () => {
    const root = appRepo('bundled-tsc', { build: 'tsc' });
    const pkg = discoverPackages(root)[0];
    expect((auditExemptions(root, [pkg], bundled) as Finding[]).map((f) => f.reason)).toEqual(['stale-exemption']);
  });

  it('or the moment the package it names is gone', () => {
    const root = appRepo('bundled-gone');
    expect((auditExemptions(root, [], bundled) as Finding[]).map((f) => f.detail?.slice(0, 30))).toEqual([
      'is listed in BUNDLED_APPLICATI',
    ]);
  });

  it('this repository’s real exemptions all still hold', () => {
    expect(auditExemptions(repoRoot, discoverPackages(repoRoot))).toEqual([]);
  });
});

// ── 5. the scope cannot collapse quietly ─────────────────────────────────────

describe('a scope that collapsed must fail, never pass vacuously', () => {
  it('an empty `fixed` group throws instead of scanning nothing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-deps-empty-'));
    fixtures.push(root);
    fs.mkdirSync(path.join(root, '.changeset'), { recursive: true });
    fs.writeFileSync(path.join(root, '.changeset/config.json'), JSON.stringify({ fixed: [], ignore: [] }));
    expect(() => readReleaseGroup(root)).toThrow(/empty `fixed` group/);
  });

  it('an unreadable release config throws', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-deps-noconfig-'));
    fixtures.push(root);
    expect(() => readReleaseGroup(root)).toThrow(/cannot read \.changeset\/config\.json/);
  });

  it('the CLI refuses to report on an implausibly small scan', () => {
    // The size assertion in the CLI is what stops a refactor from emptying the
    // walk and printing a green verdict over nothing.
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toMatch(/The scan collapsed/);
    expect(gate).toMatch(/counters\.packages < 30 \|\| counters\.specifiers < 5000/);
  });
});

// ── 6. this repository ───────────────────────────────────────────────────────

describe('objectui itself', () => {
  const result = analyze(repoRoot);

  it('scans a real surface (a guard that found nothing would pass everything)', () => {
    expect(result.counters.packages).toBeGreaterThan(30);
    expect(result.counters.runtimeChecked).toBeGreaterThan(2000);
    expect(result.counters.toolingChecked).toBeGreaterThan(2000);
    expect(discoverPackages(repoRoot).map((p: { name: string }) => p.name)).toContain('@object-ui/console');
  });

  it('has no phantom dependency', () => {
    expect(
      (result.findings as Finding[]).map((f) => `${f.file ?? f.name}: ${f.reason} ${f.name}`),
      'run `pnpm check:phantom-deps` — its output says which field the declaration belongs in',
    ).toEqual([]);
  });

  it('pins the defect this gate found: plugin-detail declares the router it imports', () => {
    // The general assertion above would catch a regression here too; this one is
    // named so a revert points straight at the issue that explains why. The
    // range is the one its three siblings use — `app-shell`, `layout` and
    // `plugin-designer` — rather than a fourth spelling of the same claim
    // (the objectui#3741 lesson about hand-authored peer ranges).
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/plugin-detail/package.json'), 'utf8'),
    ) as Record<string, Record<string, string>>;
    expect(manifest.peerDependencies['react-router-dom']).toBe('^6.0.0 || ^7.0.0');
    for (const sibling of ['app-shell', 'layout', 'plugin-designer']) {
      const other = JSON.parse(
        fs.readFileSync(path.join(repoRoot, `packages/${sibling}/package.json`), 'utf8'),
      ) as Record<string, Record<string, string>>;
      expect(other.peerDependencies['react-router-dom'], `${sibling} is the norm this copies`).toBe('^6.0.0 || ^7.0.0');
    }
  });

  it('still imports it, so the declaration is not left describing nothing', () => {
    // The inverse pin. A declaration whose imports have gone is dead weight in
    // every consumer's install, and this gate does not check that direction.
    for (const file of [
      'packages/plugin-detail/src/renderers/record-reference-rail.tsx',
    ]) {
      expect(fs.readFileSync(path.join(repoRoot, file), 'utf8')).toContain("from 'react-router-dom'");
    }
  });

  it('the tooling lean on the root is visible, not absorbed', () => {
    // The root allowance is the gate's one concession, so its size is a number
    // this repository states rather than a silence. If it ever reached zero the
    // allowance would be dead code and should go.
    expect(result.counters.toolingViaRoot).toBeGreaterThan(1000);
  });
});

// ── the wiring ───────────────────────────────────────────────────────────────

describe('the gate is wired where the sibling gates are', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

  it('package.json exposes it as a named script', () => {
    expect(pkg.scripts['check:phantom-deps']).toBe('node scripts/check-phantom-dependencies.mjs');
  });

  it('ci.yml runs it after the install it needs (it imports typescript)', () => {
    const install = ci.indexOf('pnpm install --frozen-lockfile');
    const step = ci.indexOf('run: pnpm check:phantom-deps');
    expect(step, 'ci.yml does not run `pnpm check:phantom-deps`').toBeGreaterThan(-1);
    expect(step, 'the check runs before dependencies are installed').toBeGreaterThan(install);
  });

  it('runs in the `type-check` job, where the other parse-based gates run', () => {
    const jobs = ci.slice(ci.search(/^jobs:[ \t]*$/m));
    const typeCheck = jobs.slice(jobs.search(/^ {2}type-check:[ \t]*$/m));
    const nextJob = typeCheck.slice(1).search(/^ {2}\S/m);
    const block = nextJob === -1 ? typeCheck : typeCheck.slice(0, nextJob + 1);
    expect(block).toContain('run: pnpm check:phantom-deps');
  });

  it('the released packages it scans are the ones changesets versions', () => {
    // Read from the same file, so the two gates cannot disagree about what
    // "published" means — the reason `check-changeset-presence.mjs` derives its
    // surface rather than listing it.
    const released = readReleaseGroup(repoRoot) as Set<string>;
    for (const name of discoverPackages(repoRoot) as { name: string }[]) {
      expect(released.has(name.name), `${name.name} is scanned but is not in the fixed group`).toBe(true);
    }
    expect(ALL_FIELDS).toContain('devDependencies');
    expect(RUNTIME_FIELDS).not.toContain('devDependencies');
  });
});
