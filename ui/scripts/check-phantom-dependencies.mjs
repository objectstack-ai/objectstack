#!/usr/bin/env node
/**
 * Every bare specifier a released package imports must be DECLARED by that
 * package — not merely resolvable from it.
 *
 * Run:  node scripts/check-phantom-dependencies.mjs   (also `pnpm check:phantom-deps`)
 * Exit: 0 = every in-scope import is declared, 1 = at least one is a phantom
 *
 * ## The gap this closes (objectui#4394)
 *
 * `@object-ui/core` is React-free by construction and by declaration: no `.tsx`
 * file, no `from 'react'`, no `react` in its `dependencies`, and an empty
 * `peerDependencies`. AGENTS.md section 3 pins it in words too — "No UI-lib deps.
 * Logic only." And yet:
 *
 *     $ node -e "console.log(require.resolve('react', { paths: ['packages/core/src'] }))"
 *     …/node_modules/.pnpm/react@19.2.8/node_modules/react/index.js
 *
 * The cause is benign and permanent: the ROOT `package.json` carries
 * `devDependencies.react` (the DOM vitest projects need it), so a
 * `node_modules/react` symlink exists at the workspace root, and Node's — and
 * TypeScript's — upward directory walk reaches it from ANY package directory.
 * pnpm's isolated `node_modules` prevents phantom dependencies BETWEEN workspace
 * packages; it does not defend a package against the root's own dev
 * dependencies.
 *
 * So a dependency-direction check performed BY RESOLUTION returns the wrong
 * answer, and returns it confidently. objectui#4394 recorded the trap after
 * objectui#4389's brief asked its implementer to "measure the actual import
 * graph", where the resolution probe is the obvious way to do that. A `react`
 * import added to `packages/core` would typecheck, build and pass every local
 * suite, then break the published `@object-ui/core` for the first consumer who
 * does not already have React installed — discovered at install time, by
 * somebody else.
 *
 * The authoritative question is not "does it resolve here" but "does the package
 * that PUBLISHES this file declare it". That is what this gate asks, and it is a
 * question root hoisting cannot answer for anyone.
 *
 * ## What the first full run found
 *
 * Not zero. `packages/plugin-detail/src/renderers/PermissionFacetLink.tsx` and
 * `record-reference-rail.tsx` import `react-router-dom`, which
 * `@object-ui/plugin-detail` declares in no field at all — while its three
 * siblings that use the same hooks (`app-shell`, `layout`, `plugin-designer`)
 * all declare it as a peer of `^6.0.0 || ^7.0.0`. That is not a latent risk in
 * that package: its `vite.config.ts` externalises every bare specifier
 * (`external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)`), so the
 * published `dist/index.js` carries a bare `react-router-dom` import that the
 * package's manifest never mentions. The declaration was added in the same pull
 * request as this gate, which is why the gate lands ENFORCING with no baseline
 * ledger: the surface it had to clear was two distinct (package, specifier)
 * pairs across seven call sites, and one of them was a real defect.
 *
 * ## Two tiers, because two different things ship
 *
 * A phantom dependency hurts when it reaches a CONSUMER. Which files can do that
 * is not uniform, so the rule is not either:
 *
 *   - RUNTIME files — everything under `src/` that is not test tooling. These
 *     compile or bundle into the published artifact, and (for the library
 *     packages, whose rollup config externalises every bare specifier) their
 *     imports stay bare in `dist`. Judged against the package's own
 *     `dependencies` / `peerDependencies` / `optionalDependencies`. A
 *     `devDependencies` entry is NOT an answer here: it is not installed for a
 *     consumer, which is the whole failure.
 *   - TOOLING files — `__tests__/`, `__mocks__/`, `__benchmarks__/`, and
 *     `*.test.*` / `*.spec.*` / `*.bench.*` / `*.stories.*`. No consumer ever
 *     RESOLVES one: they are not entry points and nothing in a published
 *     artifact imports them. Judged against the package's own four dependency
 *     fields OR the WORKSPACE ROOT's `devDependencies`.
 *
 *     "Not resolved" is the load-bearing claim, and it is deliberately weaker
 *     than "not present in the tarball" — which would be false. objectui#4006
 *     measured 73 `*.test.d.ts` files landing in the published `dist/` of
 *     `@object-ui/fields` and `@object-ui/plugin-editor`, and three packages
 *     (`fields`, `types`, `data-objectstack`) listed `src` in `files`, so their
 *     tarballs carried the test SOURCES too. None of the three do anymore.
 *     objectui#4847 dropped `src` from `data-objectstack`'s `files` (43 source
 *     files, 38 of them tests, left that tarball); objectui#4856 dropped it
 *     from `fields`' (173 source files, 97 of them tests) after a clean rebuild
 *     measured zero `.map` files and zero `sourceMappingURL` comments in its
 *     `vite-plugin-dts` output, so nothing in its `dist` referred back to `src`
 *     at all. `types` was the holdout: it builds with a bare `tsc`, and until
 *     objectui#4851 its `tsconfig.json` set `declarationMap: true` with no
 *     `inlineSources`, so its shipped `dist/*.d.ts.map` named `../src/*.ts`
 *     with no embedded content — dropping `src` from `files` while that was
 *     still true would have left published maps pointing at files the tarball
 *     no longer carried. objectui#4851 closed the gap at the source instead of
 *     leaving the exception standing: `declarationMap` is now `false`, a clean
 *     rebuild confirmed zero `.map` files, zero `sourceMappingURL` comments,
 *     and zero `../src` references in `dist`, and only then did `src` come out
 *     of `files`. Go-to-source for `@object-ui/types` consumers now resolves
 *     to the `.d.ts`, not the original `.ts` — a deliberate, near-zero-pull
 *     trade for a pure-types package whose declarations are near-isomorphic to
 *     their source, made explicitly rather than left as a silent regression.
 *     Stated here rather than glossed, because "the build excludes tests" is
 *     the plausible-sounding version of this paragraph and it is not what the
 *     repository measures.
 *
 * The root allowance is a decision, not an oversight, and it is worth stating
 * why it is honest rather than convenient. This repository installs its test
 * toolchain once, at the root: measured over `main`, 1873 tooling imports in
 * released packages resolve to something the package itself does not declare,
 * and 74 of the 76 distinct (package, specifier) pairs are exactly four names —
 * `vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
 * `@testing-library/user-event`. Demanding thirty packages re-declare those
 * would be a large mechanical churn that protects no consumer, because none of
 * those files is published. What the allowance still catches is the real thing:
 * a tooling import of a package declared NOWHERE — not by the package, not by
 * the root — which is a module nothing in this repository installs on purpose.
 * The count of imports that lean on the allowance is printed on every run, so
 * the size of the concession stays visible rather than being absorbed.
 *
 * What this tier split deliberately does NOT do is police LAYERING. "May
 * `@object-ui/core` import React at all" is a different property with a
 * different home (AGENTS.md section 3, and objectui#4389); a core test file that
 * imported React would satisfy this gate and still be wrong. This gate answers
 * one question — is what you import declared where a consumer can see it — and
 * answering a second one badly is worse than not answering it.
 *
 * ## The explicit gradings
 *
 * Each of these is a judgement the gate had to make. They are written down
 * rather than buried, because a silent grading is indistinguishable from a bug:
 *
 *   - **Type-only imports are STRICT.** `import type { X } from 'pkg'` is judged
 *     exactly like a value import. Three reasons, in order of weight. The
 *     declaration coupling is real and it survives erasure: the emitted `.d.ts`
 *     keeps the reference, so a consumer type-checking against this package
 *     needs `pkg`'s types installed, and an undeclared one leaves them with
 *     `TS2307` in a file they did not write. It is also one edit from becoming a
 *     value import, and nothing would report the promotion. And a carve-out here
 *     is the tolerant-consumer shape AGENTS.md #0.1 rejects on principle. The
 *     measurement says this costs nothing today: of the seven runtime-file
 *     violations on `main`, zero were type-only, so strictness is free at the
 *     moment it lands — which is exactly when to choose it.
 *   - **Node builtins need `@types/node`.** `node:fs` and bare `fs` are provided
 *     by the runtime, never installed, so "declared" cannot mean a dependency
 *     entry; what a package CAN declare is that it targets Node at all.
 *     `@types/node` in any of its dependency fields is that declaration —
 *     including `devDependencies`, and that is correct rather than lax: a types
 *     package is never a runtime import, so `dependencies` would be the wrong
 *     field for it. Measured on `main`: every builtin import in a package that
 *     does not declare `@types/node` is in a tooling file (33 pairs, all of
 *     them), and every runtime builtin import — `@object-ui/cli`'s `fs`, `path`,
 *     `url`, `child_process` — is in a package that declares it. So this lands
 *     enforcing at zero cost too.
 *   - **Host-provided modules are declared in `HOST_PROVIDED`,** with the
 *     evidence each one requires. `vscode` is the specimen: it is injected by
 *     the extension host, is not on npm as a runtime package, and declaring it
 *     as a dependency would be the mistake. `packages/vscode-extension` earns
 *     the exemption by declaring `@types/vscode` AND `engines.vscode` — checked
 *     on every run, so the exemption cannot outlive its evidence.
 *   - **A self-reference is allowed when the package declares `exports`.** Node
 *     resolves a package's own name through its own `exports` map, so
 *     `@object-ui/core` importing `@object-ui/core` is legal and installs
 *     nothing. Without `exports` it does not resolve, and that is reported.
 *   - **`@/…` is not a package.** npm's grammar has no empty scope, so a
 *     specifier whose first segment cannot be a package name is a tsconfig path
 *     alias (every package here maps `@/*` to `src/*`). Skipped by GRAMMAR, not
 *     by a name list.
 *
 * ## The one exemption with a manifest, and why it is verified
 *
 * `@object-ui/console` imports ~325 modules across its `src/` that it declares
 * only in `devDependencies`, and that is right: it is an APPLICATION. Its build
 * is a Vite app build with no `build.lib` and no `rollupOptions.external`, so
 * every one of those imports is INLINED into `dist/`, and the published package
 * is that bundle plus a `plugin.js` wrapper. Nothing a consumer installs
 * resolves them. `BUNDLED_APPLICATIONS` records that, and re-derives the two
 * properties it rests on every run — the build script still runs `vite build`,
 * and the config still declares neither of the two keys that would make the
 * imports external again. The day either changes, the exemption fails loudly
 * instead of quietly covering a package that has started shipping bare imports.
 *
 * ## Scope, stated so it is not mistaken for more
 *
 *   - `src/**` of the packages in the `fixed` group of `.changeset/config.json`,
 *     read from that file for the same reason `check-changeset-presence.mjs`
 *     reads it: the release configuration is where "published" is actually
 *     defined, and a hand-written glob would have missed `apps/console` exactly
 *     as it did there.
 *   - Files OUTSIDE `src/` are not read — a package's `vite.config.ts`,
 *     `scripts/`, or a published sidecar such as `apps/console/plugin.ts`. Those
 *     resolve at build time or against a different manifest; widening to them
 *     means grading build tooling by the same rule as shipped code, which is a
 *     different gate.
 *   - The REVERSE direction — a declared dependency nothing imports — is not
 *     checked. It is a real question (dead weight in every consumer's install)
 *     and a different one; a package may legitimately declare something it uses
 *     from a non-`src` path.
 *   - Tooling material that reaches the TARBALL is objectui#4006's, not this
 *     gate's: see the tier note above for the measurement and for why "nothing
 *     resolves it" is the claim that keeps the tooling tier sound.
 */

import ts from 'typescript';
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Workspace directories that hold one package per subdirectory. */
export const PACKAGE_ROOTS = ['packages', 'apps'];

/**
 * The fields a CONSUMER's install honours. `devDependencies` is deliberately
 * absent: it is the field that is not installed for them, which is the entire
 * failure this gate is about.
 */
export const RUNTIME_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/** Every field a package can declare a dependency in. */
export const ALL_FIELDS = [...RUNTIME_FIELDS, 'devDependencies'];

/** Directories that hold no published source. */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo']);

/** Source extensions worth parsing. */
export const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * Files that exist to test or measure the package rather than to ship in it.
 *
 * Judged by name, which is the convention every sibling gate in this repository
 * uses and the one the packages' own tsconfigs encode. The stronger-looking
 * alternative — "does the build tsconfig program read this file" — is the WRONG
 * question here and was measured before being rejected: six released packages'
 * build programs read all of their test files, and none of those six emits them,
 * because the `tsc` steps inherit `noEmit: true` from the root config and the
 * artifact comes from the bundler's entry graph. A file being type-checked is
 * not a file being published.
 */
export const TOOLING_FILE =
  /(^|\/)(__tests__|__mocks__|__benchmarks__)\/|\.(test|spec|bench|stories)\.[cm]?[jt]sx?$/;

/**
 * Modules an execution host injects, which therefore must NOT be declared as
 * dependencies — plus the evidence a package has to show to import one.
 *
 * `requires` names the manifest facts, re-checked on every run so an entry
 * cannot outlive the package's claim to it.
 */
export const HOST_PROVIDED = {
  vscode: {
    types: '@types/vscode',
    engine: 'vscode',
    reason:
      'the VS Code extension host injects `vscode` at activation; it is not a runtime npm ' +
      'package and declaring it as a dependency would make an uninstallable package',
  },
};

/**
 * @typedef {object} BundledApplication
 * @property {string} config repo-relative path to the build config the claim rests on
 * @property {string} reason why `devDependencies` is the right field for this package
 * @property {(root: string, pkg: any) => string[]} verify problems found re-deriving the claim; empty means it holds
 */

/**
 * Packages whose published artifact INLINES its imports, so `devDependencies` is
 * the correct field for them.
 *
 * `verify` re-derives the claim from the repository on every run: an entry is
 * worth exactly as much as the properties underneath it, and a stale one would
 * cover a package that had started shipping bare imports.
 *
 * @type {Record<string, BundledApplication>}
 */
export const BUNDLED_APPLICATIONS = {
  '@object-ui/console': {
    config: 'apps/console/vite.config.ts',
    reason:
      'an application build: `vite build` with no `build.lib` and no `rollupOptions.external`, ' +
      'so every import is inlined into the `dist/` bundle the package publishes',
    verify(root, pkg) {
      const problems = [];
      if (!/\bvite build\b/.test(pkg.manifest.scripts?.build ?? '')) {
        problems.push(
          `its build script is now \`${pkg.manifest.scripts?.build ?? '(none)'}\`, which does not run \`vite build\``,
        );
      }
      const configPath = resolve(root, this.config);
      let config;
      try {
        config = readFileSync(configPath, 'utf8');
      } catch {
        problems.push(`${this.config} cannot be read, so the exemption cannot be verified`);
        return problems;
      }
      // Either key turns an app build back into a library build, whose bare
      // imports survive into `dist` and must be declared again.
      if (/^\s*lib\s*:/m.test(config)) problems.push(`${this.config} now declares \`build.lib\`, i.e. a LIBRARY build`);
      if (/^\s*external\s*:/m.test(config)) {
        problems.push(`${this.config} now declares \`rollupOptions.external\`, so some imports stay bare in dist`);
      }
      return problems;
    },
  },
};

const BUILTINS = new Set(builtinModules);

/** Whether a specifier names a module the Node runtime provides. */
export const isBuiltin = (specifier) =>
  specifier.startsWith('node:') || BUILTINS.has(specifier) || BUILTINS.has(specifier.split('/')[0]);

/**
 * npm's package-name grammar for the first segment of a specifier.
 *
 * This is what tells a package apart from a tsconfig path alias without a list
 * of aliases to maintain: `@/ui/button` has an EMPTY scope, which npm does not
 * allow, so it cannot be a package and must be an alias. `./x`, `../x` and `/x`
 * are relative or absolute paths and never reach this.
 */
const PACKAGE_SPECIFIER = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/|$)/;

/**
 * The PACKAGE a specifier belongs to: `@scope/pkg/sub` -> `@scope/pkg`,
 * `pkg/sub` -> `pkg`. Returns `null` for anything that is not a package
 * specifier at all.
 */
export function packageNameOf(specifier) {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (!PACKAGE_SPECIFIER.test(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0];
}

// ── source walk ──────────────────────────────────────────────────────────────

/** Every source file under `dir`, as absolute paths. */
export function listSourceFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, found);
    else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

/**
 * Every module specifier a file names, with the form it names it in.
 *
 * All five forms that produce a module edge are read, because a gate that saw
 * only `import` would be satisfied by rewriting the import as a `require` — and
 * the lazy `import()` is the one an agent reaches for when a heavy widget must
 * not be in the entry chunk, which is exactly where a plugin's undeclared
 * dependency would hide.
 *
 * @returns {{ specifier: string, kind: string, typeOnly: boolean, line: number, column: number }[]}
 */
export function moduleSpecifiers(text, fileName = 'file.tsx') {
  // setParentNodes is false BY DESIGN, not by oversight: this walk only ever
  // descends (`ts.forEachChild`, never `.parent`), and the one position lookup
  // below calls `node.getStart(source)` with the source file passed EXPLICITLY —
  // exactly the form that skips TypeScript's own `.parent`-walking fallback
  // (`getTokenPosOfNode`'s `sourceFile ?? getSourceFileOfNode(node)`). `source`
  // is local to this function and never escapes to a caller who might walk
  // upward, so no consumer of `moduleSpecifiers()` can read a parent either.
  // Setting the flag costs TypeScript a full second linking pass over the
  // parsed tree for a pointer this parser never follows — confirmed unused by
  // running both settings over every file in this repository and diffing the
  // JSON output byte-for-byte (objectui#5410).
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TSX);
  const found = [];
  const push = (node, specifier, kind, typeOnly) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({ specifier, kind, typeOnly, line: line + 1, column: character + 1 });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
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

// ── the workspace ────────────────────────────────────────────────────────────

/**
 * The names changesets versions as one family — this repository's definition of
 * "published".
 *
 * Read from `.changeset/config.json` rather than listed, for the reason
 * `check-changeset-presence.mjs` gives at length: a hand-written surface reads
 * as exhaustive and is not, and the package it misses first is `@object-ui/console`,
 * which lives under `apps/` instead of `packages/`. An empty group THROWS — a
 * gate whose scope collapsed to nothing passes everything.
 */
export function readReleaseGroup(root) {
  const configPath = join(root, '.changeset/config.json');
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read .changeset/config.json: ${error.message}`);
  }
  const released = new Set((config.fixed ?? []).flat());
  if (released.size === 0) {
    throw new Error(
      '.changeset/config.json declares an empty `fixed` group, so this gate would scan nothing ' +
        'and pass everything. That is a configuration error, not an empty scope.',
    );
  }
  return released;
}

/**
 * Every workspace package in the release group that has a `src/` directory.
 *
 * @returns {{ name: string, dir: string, srcDir: string, manifest: object }[]}
 */
export function discoverPackages(root, released = readReleaseGroup(root)) {
  const packages = [];
  for (const parent of PACKAGE_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(root, parent));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const dir = `${parent}/${entry}`;
      const manifestPath = join(root, dir, 'package.json');
      try {
        if (!statSync(manifestPath).isFile()) continue;
      } catch {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!manifest.name || !released.has(manifest.name)) continue;
      const srcDir = join(root, dir, 'src');
      if (!existsSync(srcDir)) continue;
      packages.push({ name: manifest.name, dir, srcDir, manifest });
    }
  }
  return packages;
}

/** The set of names a manifest declares across `fields`. */
export const declaredIn = (manifest, fields) =>
  new Set(fields.flatMap((field) => Object.keys(manifest[field] ?? {})));

// ── the judgement ────────────────────────────────────────────────────────────

/**
 * One package's findings.
 *
 * `rootDevDependencies` is the workspace root's declaration set — the tooling
 * tier's allowance, passed in rather than read here so a test can vary it.
 *
 * @param {{ name: string, dir: string, srcDir: string, manifest: any }} pkg
 * @param {{ root: string, rootDevDependencies?: Set<string>, bundled?: Record<string, BundledApplication> }} options
 * @returns {{ findings: any[], counters: Record<string, number> }}
 */
export function auditPackage(pkg, { root, rootDevDependencies = new Set(), bundled = BUNDLED_APPLICATIONS } = {}) {
  const findings = [];
  const counters = {
    files: 0,
    specifiers: 0,
    relative: 0,
    alias: 0,
    builtin: 0,
    selfReference: 0,
    runtimeChecked: 0,
    toolingChecked: 0,
    toolingViaRoot: 0,
  };

  const runtimeDeclared = declaredIn(pkg.manifest, RUNTIME_FIELDS);
  const allDeclared = declaredIn(pkg.manifest, ALL_FIELDS);
  // A bundled application inlines its imports, so its runtime files are judged
  // against every field it declares rather than only the installed ones.
  const isBundled = Object.hasOwn(bundled, pkg.name);
  const runtimeAllowed = isBundled ? allDeclared : runtimeDeclared;

  for (const file of listSourceFiles(pkg.srcDir)) {
    counters.files += 1;
    const relPath = relative(root, file).split('\\').join('/');
    const tooling = TOOLING_FILE.test(relPath);
    const text = readFileSync(file, 'utf8');
    if (!/\b(?:import|export|require)\b/.test(text)) continue;

    for (const use of moduleSpecifiers(text, file)) {
      counters.specifiers += 1;
      const at = { file: relPath, line: use.line, column: use.column, kind: use.kind, typeOnly: use.typeOnly };

      if (use.specifier.startsWith('.') || use.specifier.startsWith('/')) {
        counters.relative += 1;
        continue;
      }

      // Asked BEFORE the package-name grammar below, and the order is
      // load-bearing: `node:fs` is not a legal package name (npm allows no `:`),
      // so a grammar-first reading files all 127 `node:`-prefixed imports as
      // path aliases and grades none of them. That was live for one run of this
      // gate, and it is invisible in the verdict — only the counters moved.
      if (isBuiltin(use.specifier)) {
        counters.builtin += 1;
        const types = allDeclared.has('@types/node') || (tooling && rootDevDependencies.has('@types/node'));
        if (!types) {
          findings.push({ reason: 'builtin-without-types', ...at, specifier: use.specifier, name: use.specifier });
        }
        continue;
      }

      const name = packageNameOf(use.specifier);
      if (name === null) {
        // Not a package by npm's grammar — a tsconfig path alias (`@/ui/x`).
        counters.alias += 1;
        continue;
      }

      // A package's own name resolves through its own `exports` map and installs
      // nothing; without `exports` it does not resolve at all.
      if (name === pkg.name) {
        counters.selfReference += 1;
        if (!pkg.manifest.exports) {
          findings.push({ reason: 'self-reference-without-exports', ...at, specifier: use.specifier, name });
        }
        continue;
      }

      if (Object.hasOwn(HOST_PROVIDED, name)) {
        const spec = HOST_PROVIDED[name];
        const missing = [
          !allDeclared.has(spec.types) && `\`${spec.types}\` in a dependency field`,
          !pkg.manifest.engines?.[spec.engine] && `\`engines.${spec.engine}\``,
        ].filter(Boolean);
        if (missing.length > 0) {
          findings.push({ reason: 'host-module-unproven', ...at, specifier: use.specifier, name, missing });
        }
        continue;
      }

      if (tooling) {
        counters.toolingChecked += 1;
        if (allDeclared.has(name)) continue;
        if (rootDevDependencies.has(name)) {
          counters.toolingViaRoot += 1;
          continue;
        }
        findings.push({ reason: 'undeclared-tooling', ...at, specifier: use.specifier, name });
        continue;
      }

      counters.runtimeChecked += 1;
      if (runtimeAllowed.has(name)) continue;
      findings.push({
        reason: allDeclared.has(name) ? 'dev-only-runtime' : 'undeclared-runtime',
        ...at,
        specifier: use.specifier,
        name,
      });
    }
  }

  return { findings, counters };
}

/**
 * Every exemption table entry re-derived against the repository.
 *
 * An exemption is worth what its evidence is worth, so an entry naming a package
 * that is gone, or resting on a property that has changed, fails the build
 * exactly like a phantom import would.
 *
 * @param {string} root
 * @param {{ name: string, manifest: any }[]} packages
 * @param {Record<string, BundledApplication>} [bundled]
 * @returns {any[]}
 */
export function auditExemptions(root, packages, bundled = BUNDLED_APPLICATIONS) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const findings = [];
  for (const [name, entry] of Object.entries(bundled)) {
    const pkg = byName.get(name);
    if (!pkg) {
      findings.push({
        reason: 'stale-exemption',
        name,
        detail: 'is listed in BUNDLED_APPLICATIONS but is not a released workspace package with a src/ directory any more',
      });
      continue;
    }
    for (const problem of entry.verify(root, pkg)) {
      findings.push({ reason: 'stale-exemption', name, detail: problem });
    }
  }
  return findings;
}

/**
 * The whole judgement for one repository root.
 *
 * `bundled` is injectable because the default table describes THIS repository:
 * run against a throwaway tree it would report its own entry as stale, which is
 * correct there and noise everywhere else. A test that is not about the
 * exemptions passes `{}`.
 *
 * @param {string} root
 * @param {{ bundled?: Record<string, BundledApplication> }} [options]
 * @returns {{ findings: any[], counters: Record<string, number>, packages: any[] }}
 */
export function analyze(root, { bundled = BUNDLED_APPLICATIONS } = {}) {
  const packages = discoverPackages(root);
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const rootDevDependencies = new Set(Object.keys(rootManifest.devDependencies ?? {}));

  const findings = [...auditExemptions(root, packages, bundled)];
  const counters = {
    packages: packages.length,
    files: 0,
    specifiers: 0,
    relative: 0,
    alias: 0,
    builtin: 0,
    selfReference: 0,
    runtimeChecked: 0,
    toolingChecked: 0,
    toolingViaRoot: 0,
  };

  for (const pkg of packages) {
    const result = auditPackage(pkg, { root, rootDevDependencies, bundled });
    findings.push(...result.findings.map((finding) => ({ pkg: pkg.name, ...finding })));
    for (const key of Object.keys(result.counters)) counters[key] += result.counters[key];
  }

  return { findings, counters, packages };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HINTS = {
  'undeclared-runtime':
    'This file ships. Declare the package in this package.json — `dependencies` for something it ' +
    'owns, `peerDependencies` for something the host application supplies (the shape the React and ' +
    'react-router-dom edges already use here). It resolving today proves nothing: the workspace ' +
    "root's devDependencies are on the resolution path from every package directory, and they are " +
    'not on a consumer\'s (objectui#4394).',
  'dev-only-runtime':
    'Declared, but only in `devDependencies` — which a consumer\'s install does not fetch. Move it ' +
    'to `dependencies` (or `peerDependencies`), keeping the devDependencies entry if the local ' +
    'build wants a concrete version alongside a wide peer range.',
  'undeclared-tooling':
    'A test/benchmark import of a package that neither this package nor the workspace root ' +
    'declares, so nothing in this repository installs it on purpose and it is here by accident of ' +
    'hoisting. Add it to this package\'s `devDependencies`, or to the root\'s if it is shared ' +
    'toolchain.',
  'builtin-without-types':
    'A Node builtin in a package that declares no `@types/node`, so nothing records that this ' +
    'package targets Node at all. Add `@types/node` to its `devDependencies` — or use the ' +
    'TypeScript host (`ts.sys`) instead, which is why several packages here have no such import.',
  'host-module-unproven':
    'A module the execution host injects. It must NOT become a dependency, so the package earns ' +
    'the import by declaring the evidence instead — see HOST_PROVIDED in ' +
    'scripts/check-phantom-dependencies.mjs.',
  'self-reference-without-exports':
    'A package importing its own name resolves through its own `exports` map. This package ' +
    'declares no `exports`, so the specifier resolves to nothing once installed. Import the ' +
    'module by a relative path, or add the `exports` field.',
  'stale-exemption':
    'An exemption in scripts/check-phantom-dependencies.mjs no longer matches the repository. ' +
    'Re-confirm the property, update the entry, or delete it — an exemption whose evidence has ' +
    'gone covers a package that may now be shipping undeclared imports.',
};

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  let result;
  try {
    result = analyze(root);
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate decides whether an import is ' +
        'declared,\n    so losing an input means it cannot decide, and a green verdict would have ' +
        'looked at nothing.',
    );
    process.exit(1);
  }

  const { findings, counters } = result;

  // A refactor that quietly empties the scan would satisfy every assertion above
  // while checking nothing — the same reason `check-i18n-call-site-keys.mjs`
  // opens with a size assertion.
  if (counters.packages < 30 || counters.specifiers < 5000) {
    console.error(
      `The scan collapsed: ${counters.packages} released package(s) and ${counters.specifiers} module ` +
        'specifier(s). Expected dozens of packages and thousands of specifiers — the release group, the ' +
        'package walk or the parser is broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `Scanned ${counters.packages} released package(s), ${counters.files} source file(s), ` +
      `${counters.specifiers} module specifier(s): ${counters.runtimeChecked} runtime-file and ` +
      `${counters.toolingChecked} tooling-file package import(s) checked, ` +
      `${counters.relative} relative, ${counters.alias} path alias, ${counters.builtin} node builtin, ` +
      `${counters.selfReference} self-reference. ` +
      `${counters.toolingViaRoot} tooling import(s) are declared only by the workspace root.`,
  );

  if (findings.length === 0) {
    console.log('✅  Every in-scope import is declared by the package that publishes it.');
    process.exit(0);
  }

  const distinct = new Set(findings.map((finding) => `${finding.pkg ?? ''}::${finding.name}`));
  console.error(
    `\n❌  ${findings.length} import(s) are not declared where a consumer would find them ` +
      `(${distinct.size} distinct package/dependency pair(s)):\n`,
  );
  for (const finding of findings) {
    if (finding.reason === 'stale-exemption') {
      console.error(`      ${finding.name}  [stale-exemption]  ${finding.detail}`);
      continue;
    }
    const extra = [
      finding.kind !== 'import' ? finding.kind : null,
      finding.typeOnly ? 'type-only' : null,
      finding.missing ? `missing ${finding.missing.join(' and ')}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.error(
      `      ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ` +
        `${finding.pkg} imports '${finding.specifier}' -> ${finding.name}${extra ? ` (${extra})` : ''}`,
    );
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((finding) => finding.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nA specifier RESOLVING from a package directory does not mean the package declares it: the ' +
      'workspace\nroot\'s devDependencies sit on the resolution path from everywhere, and on no ' +
      "consumer's.\nSee the header of scripts/check-phantom-dependencies.mjs (objectui#4394).",
  );
  process.exit(1);
}
