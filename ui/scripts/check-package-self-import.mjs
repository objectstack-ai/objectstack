#!/usr/bin/env node
/**
 * No package may name ITSELF in a module specifier inside its own `src/`.
 *
 * Run:  node scripts/check-package-self-import.mjs   (also `pnpm check:self-import`)
 * Exit: 0 = no package imports itself by name, 1 = at least one does, or an
 *       exemption below has gone stale
 *
 * ## The failure this closes (objectui#4801, first paid by PR #4789)
 *
 * PR #4789's first CI run had exactly one red check, `Type Check`:
 *
 *     cascadeOptionWidgetTypes.reexport.test.tsx(30,82):
 *       error TS2307: Cannot find module '@object-ui/fields'
 *
 * The file sits in `packages/fields/src/` and imported `@object-ui/fields` —
 * its OWN package name. That resolves, legally, through the package's own
 * `exports` map, which points at `./dist/index.d.ts`. And `turbo.json` gives
 * `type-check` `dependsOn: ["^build"]` — the DEPENDENCIES' builds, never the
 * package's own. So on a cold CI cache the declarations the specifier resolves
 * to have not been produced yet, and the file that reads as ordinary fails to
 * compile.
 *
 * ## Why a human process cannot catch it, which is why it is a gate
 *
 * Every local workflow builds before it type-checks, and
 * `pnpm --filter '<pkg>^...' build` builds the dependency closure — which, for
 * any package that is also somebody else's dependency, leaves a `dist/` behind.
 * The self-import then resolves against a stale artifact and the tree is green
 * on every machine that has ever run a build. The failure is visible ONLY on a
 * cold cache, i.e. only in CI, and it costs a full CI round plus a rework round
 * every time. Reproduced deliberately for objectui#4801: in a fresh worktree
 * with only the dependencies built (`packages/fields/dist` confirmed absent),
 * the self-import spelling exits 2 with the message above verbatim and the
 * relative spelling exits 0.
 *
 * ## Why the relative spelling is not a downgrade
 *
 * A package's own name and a relative path into its own `src/` are the SAME
 * module here, on both surfaces that read it: the repo-root `vitest.config.mts`
 * aliases each `@object-ui` package name to that package's own `src` directory,
 * and every consumer inside the package compiles from source. (A glob spelling
 * that pairing would close this block comment early — the trap
 * `tsconfig.scripts.json` documents, hit once while writing this file.)
 * Nothing about an assertion's meaning changes;
 * what changes is that the specifier stops depending on an artifact whose
 * existence nothing ordered. It is also strictly more honest — a file inside
 * the package is not a consumer of the package, and spelling it as one hides
 * that it is reading its own source either way.
 *
 * ## AST, not a regex, and the specimens that decide it
 *
 * The scan reuses `scripts/check-phantom-dependencies.mjs`'s TypeScript-backed
 * `moduleSpecifiers()` rather than growing a second parser, for two reasons
 * that are measurable in this repository right now:
 *
 *   - A package name inside a STRING LITERAL is not a module edge, and this
 *     repo has several. `packages/i18n/src/__tests__/perm-home-namespace-3546.test.ts`
 *     carries `"import { useObjectTranslation } from '@object-ui/i18n'"` as
 *     fixture TEXT; `packages/layout/src/__tests__/side-effects-manifest.test.ts`
 *     assigns `'@object-ui/layout'` to a const it writes into a temp entry file
 *     to bundle. A regex matching `from '<name>'` flags the first; both are
 *     correct code. An AST walk sees neither, because neither is an import.
 *   - The five forms that make a module edge — `import`, `export … from`,
 *     `import x = require()`, `import('…')` (value and type position) and
 *     `require()` — are all read. A gate seeing only `import` is satisfied by
 *     rewriting the import as a `require`, and the self-import would resolve to
 *     `dist` exactly as before.
 *
 * Sharing the parser also means the two gates cannot disagree about what a
 * module edge IS, which is the sort of drift that makes one of two gates quietly
 * stop covering a form.
 *
 * ## Scope, stated so it is not mistaken for more
 *
 *   - `src/**` of every workspace package under `packages/`, `apps/` and
 *     `examples/`. The roots come from the sibling gate's `PACKAGE_ROOTS` so the
 *     two cannot disagree about where packages live; `examples/` is added HERE
 *     because the property is about `type-check` racing a build, not about
 *     publication — three example packages carry both a `type-check` script and
 *     a `src/`, so the same race reaches them. The sibling gate excludes them
 *     because its question ("is this declared for a consumer") only applies to
 *     what is published, which is a different question.
 *   - Membership is NOT filtered by the changeset release group, for the same
 *     reason: an unpublished package still type-checks, and still has no
 *     dependency edge on its own build.
 *   - Files outside `src/` — `vite.config.ts`, a package's own `scripts/`,
 *     `apps/console/plugin.ts` — are not read. Those run through a bundler or a
 *     different program, where the package name may be exactly the right
 *     specifier.
 *   - WHERE a self-import resolves is not re-derived per package. It resolves
 *     to `dist` through `exports` unless some tsconfig `paths` entry redirects
 *     it, and a gate that accepted "there is a paths entry today" would be
 *     accepting the workaround as the fix — `packages/components/tsconfig.test.json`
 *     carried exactly such an entry until objectui#4801 removed it with the
 *     import it existed for.
 *
 * ## The exemption shape
 *
 * `SELF_IMPORT_EXEMPTIONS` is keyed by repo-relative file path and names the
 * specifiers that file may keep, with the reason. It exists for the one form
 * objectui#4801 named as legitimate: a file that reads the PUBLISHED artifact on
 * purpose (a packaging pin — "what a consumer resolves"), where the package name
 * is the point rather than an accident. It is EMPTY today, which is a
 * measurement and not an aspiration: all five self-references the phantom-deps
 * report counted were triaged for objectui#4801 and none was of that form.
 *
 * An exemption is re-derived on every run, the way `HOST_PROVIDED` and
 * `BUNDLED_APPLICATIONS` are in the sibling gate: an entry whose file no longer
 * holds that self-import, or that carries no written reason, is reported as
 * `stale-exemption` and fails the gate. An exemption is worth exactly what its
 * evidence is worth, and one that outlives its site silently widens the hole.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PACKAGE_ROOTS,
  isBuiltin,
  listSourceFiles,
  moduleSpecifiers,
  packageNameOf,
} from './check-phantom-dependencies.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * Where a workspace package can live.
 *
 * `PACKAGE_ROOTS` is imported rather than copied so the two gates cannot drift
 * apart on it; `examples` is appended here because this gate's question reaches
 * packages the sibling's does not (see the scope note in the header).
 */
export const SCAN_ROOTS = [...PACKAGE_ROOTS, 'examples'];

/**
 * @typedef {object} SelfImportExemption
 * @property {string[]} specifiers the self-referential specifiers this file may keep
 * @property {string} reason why the package NAME is the right specifier here
 */

/**
 * Files allowed to name their own package, with the evidence for each.
 *
 * Empty by measurement — see the header. The shape is kept live (and pinned by
 * `scripts/__tests__/check-package-self-import.test.ts`) because the legitimate
 * form exists: a test that deliberately pins what a CONSUMER resolves has to
 * spell the package name, and it must be possible to say so out loud rather than
 * by deleting the gate.
 *
 * @type {Record<string, SelfImportExemption>}
 */
export const SELF_IMPORT_EXEMPTIONS = {};

// ── the workspace ────────────────────────────────────────────────────────────

/**
 * Every workspace package that has a `src/` directory.
 *
 * Throws on an empty result: a walk that found no packages would pass every
 * assertion below while looking at nothing, which is the failure a gate must
 * never report as a pass.
 *
 * @param {string} root
 * @returns {{ name: string, dir: string, srcDir: string, manifest: any }[]}
 */
export function discoverPackages(root) {
  const packages = [];
  for (const scanRoot of SCAN_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(root, scanRoot), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = `${scanRoot}/${entry.name}`;
      const manifestPath = join(root, dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        throw new Error(`cannot read ${dir}/package.json: ${error.message}`);
      }
      if (!manifest.name) continue;
      const srcDir = join(root, dir, 'src');
      if (!existsSync(srcDir)) continue;
      packages.push({ name: manifest.name, dir, srcDir, manifest });
    }
  }
  if (packages.length === 0) {
    throw new Error(
      `no workspace package with a src/ directory was found under ${SCAN_ROOTS.join(', ')} in ${root} — ` +
        'the walk is broken, and an empty scan would pass while checking nothing',
    );
  }
  return packages;
}

// ── the judgement ────────────────────────────────────────────────────────────

/**
 * One package's self-imports, WITHOUT judging them.
 *
 * `sites` lists EVERY self-import found, carrying the full detail a finding
 * needs. Nothing here consults the exemption table, and that is the point: the
 * parse is what costs, and it does not depend on which entries are exempt. See
 * `scanRepository` for why the split exists (objectui#5402).
 *
 * @param {{ name: string, dir: string, srcDir: string, manifest: any }} pkg
 * @param {{ root: string }} options
 * @returns {{ sites: any[], counters: Record<string, number> }}
 */
export function auditPackage(pkg, { root } = {}) {
  const sites = [];
  const counters = {
    files: 0,
    specifiers: 0,
    relative: 0,
    alias: 0,
    builtin: 0,
    external: 0,
    selfImport: 0,
  };

  for (const file of listSourceFiles(pkg.srcDir)) {
    counters.files += 1;
    const relPath = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    if (!/\b(?:import|export|require)\b/.test(text)) continue;

    for (const use of moduleSpecifiers(text, file)) {
      counters.specifiers += 1;

      if (use.specifier.startsWith('.') || use.specifier.startsWith('/')) {
        counters.relative += 1;
        continue;
      }
      // Asked before the package-name grammar, for the reason the sibling gate
      // states: `node:fs` is not a legal package name, so a grammar-first
      // reading files every `node:`-prefixed import as a path alias.
      if (isBuiltin(use.specifier)) {
        counters.builtin += 1;
        continue;
      }

      const name = packageNameOf(use.specifier);
      if (name === null) {
        // Not a package by npm's grammar — a tsconfig path alias (`@/ui/x`).
        counters.alias += 1;
        continue;
      }
      if (name !== pkg.name) {
        counters.external += 1;
        continue;
      }

      counters.selfImport += 1;
      sites.push({
        reason: 'package-self-import',
        pkg: pkg.name,
        file: relPath,
        line: use.line,
        column: use.column,
        kind: use.kind,
        typeOnly: use.typeOnly,
        specifier: use.specifier,
      });
    }
  }

  return { sites, counters };
}

/**
 * Exemptions that no longer describe the repository.
 *
 * Three ways an entry goes stale, all of them silent widenings if unreported:
 * the file stopped self-importing (or stopped existing), the specific specifier
 * changed, or the entry never carried a reason — an exemption nobody can review
 * is one nobody can revoke.
 *
 * @param {Record<string, SelfImportExemption>} exemptions
 * @param {{ file: string, specifier: string }[]} sites every self-import actually present
 * @returns {any[]}
 */
export function auditExemptions(exemptions, sites) {
  const present = new Map();
  for (const site of sites) {
    if (!present.has(site.file)) present.set(site.file, new Set());
    present.get(site.file).add(site.specifier);
  }

  const findings = [];
  for (const [file, entry] of Object.entries(exemptions)) {
    if (typeof entry?.reason !== 'string' || entry.reason.trim() === '') {
      findings.push({ reason: 'stale-exemption', file, detail: 'carries no written reason, so it cannot be reviewed' });
    }
    const specifiers = entry?.specifiers ?? [];
    if (specifiers.length === 0) {
      findings.push({ reason: 'stale-exemption', file, detail: 'names no specifier, so it exempts nothing' });
      continue;
    }
    const found = present.get(file);
    for (const specifier of specifiers) {
      if (found?.has(specifier)) continue;
      findings.push({
        reason: 'stale-exemption',
        file,
        specifier,
        detail: found
          ? `no longer imports '${specifier}' (it imports ${[...found].map((s) => `'${s}'`).join(', ')})`
          : 'holds no self-import at all any more, or is no longer a scanned source file',
      });
    }
  }
  return findings;
}

/**
 * Every self-import in a repository, WITHOUT judging any of them.
 *
 * This is the expensive half and the whole reason the API is split in two: it
 * full-parses every source file of every workspace package with TypeScript
 * (~3,100 files / ~30 MB in this repository today), and NONE of that work
 * depends on the exemption table. Judging is a filter over the result and costs
 * microseconds.
 *
 * ## Why the split exists (objectui#5402)
 *
 * `scripts/__tests__/check-package-self-import.test.ts` asserts two different
 * things about this repository — that it is green under the repository's own
 * exemption table, and that it is green under NO exemptions at all. Before the
 * split those were two calls to `analyze(repoRoot)`, i.e. the same 30 MB parse
 * performed twice, and the second one sat inside a 15-second `it()`.
 *
 * That is affordable uninstrumented and not affordable under coverage. V8's
 * precise coverage (`Profiler.startPreciseCoverage({ callCount, detailed })`,
 * which `@vitest/coverage-v8` arms in the worker BEFORE test modules and their
 * dependencies are compiled) emits block counters at compile time and is
 * isolate-wide — `coverage.exclude` filters the REPORT, never the
 * instrumentation, so `node_modules/typescript` is instrumented too. Measured
 * on this repository: the identical parse takes 4.1-4.9 s uninstrumented and
 * 32-35 s when coverage was armed first — a 7x constant factor landing squarely
 * on the parser. Two scans, one of them inside a bounded window, is what made
 * `ci.yml`'s `Test (coverage)` job fail 100% of the time for four days.
 *
 * So: scan once, judge as often as you like.
 *
 * Deliberately NOT memoised. A cache keyed by root would return stale verdicts
 * for a tree that changed under it, and the callers that need one scan can hold
 * one scan.
 *
 * @param {string} root
 * @returns {{ packages: any[], sites: any[], counters: Record<string, number> }}
 */
export function scanRepository(root) {
  const packages = discoverPackages(root);
  const counters = {
    packages: packages.length,
    files: 0,
    specifiers: 0,
    relative: 0,
    alias: 0,
    builtin: 0,
    external: 0,
    selfImport: 0,
  };

  const sites = [];
  for (const pkg of packages) {
    const result = auditPackage(pkg, { root });
    sites.push(...result.sites);
    for (const key of Object.keys(result.counters)) counters[key] += result.counters[key];
  }

  return { packages, sites, counters };
}

/**
 * The verdict a given exemption table reaches about an already-completed scan.
 *
 * Pure: it reads `scan` and never re-reads the repository, never mutates what it
 * was handed. Everything expensive already happened in `scanRepository`.
 *
 * @param {{ packages: any[], sites: any[], counters: Record<string, number> }} scan
 * @param {Record<string, SelfImportExemption>} [exemptions]
 * @returns {{ findings: any[], counters: Record<string, number>, packages: any[] }}
 */
export function judgeScan(scan, exemptions = SELF_IMPORT_EXEMPTIONS) {
  const findings = [];
  let exempted = 0;
  for (const site of scan.sites) {
    if (exemptions[site.file]?.specifiers?.includes(site.specifier)) {
      exempted += 1;
      continue;
    }
    findings.push({ ...site });
  }
  findings.push(...auditExemptions(exemptions, scan.sites));

  return { findings, counters: { ...scan.counters, exempted }, packages: scan.packages };
}

/**
 * The whole judgement for one repository root: scan, then judge.
 *
 * `exemptions` is injectable because the default table describes THIS
 * repository: a test about the mechanism supplies its own rather than editing
 * the repository's.
 *
 * Every call re-scans. A caller that judges the SAME root under more than one
 * exemption table should call `scanRepository` once and `judgeScan` per table
 * instead — see the note on `scanRepository`.
 *
 * @param {string} root
 * @param {{ exemptions?: Record<string, SelfImportExemption> }} [options]
 * @returns {{ findings: any[], counters: Record<string, number>, packages: any[] }}
 */
export function analyze(root, { exemptions = SELF_IMPORT_EXEMPTIONS } = {}) {
  return judgeScan(scanRepository(root), exemptions);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HINTS = {
  'package-self-import':
    'A file inside a package named the package ITSELF. That specifier resolves through the ' +
    "package's own `exports` map to `dist/`, and `type-check` has no dependency edge on this " +
    "package's own build (turbo's `type-check` dependsOn `^build` — the DEPENDENCIES' builds), so " +
    'on a cold CI cache the artifact does not exist yet and the file fails with TS2307. It passes ' +
    'locally only because a previous build left `dist/` behind. Import the module by a RELATIVE ' +
    'path: inside the package it is the same module (the repo-root vitest config aliases the ' +
    'package name to `src/` too), so nothing about the code changes except that it stops depending ' +
    'on an artifact nothing ordered. See objectui#4801 and PR #4789.',
  'stale-exemption':
    'An entry in SELF_IMPORT_EXEMPTIONS (scripts/check-package-self-import.mjs) no longer matches ' +
    'the repository. Re-confirm the property, update the entry, or delete it — an exemption whose ' +
    'site has gone silently widens the hole for the next file that lands there.',
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
        '    Reported as a failure rather than a pass: this gate decides whether a package names ' +
        'itself,\n    so losing an input means it cannot decide, and a green verdict would have ' +
        'looked at nothing.',
    );
    process.exit(1);
  }

  const { findings, counters } = result;

  // A refactor that quietly empties the walk would satisfy every assertion above
  // while checking nothing — the same size assertion the sibling gates open with.
  if (counters.packages < 30 || counters.specifiers < 5000) {
    console.error(
      `The scan collapsed: ${counters.packages} package(s) and ${counters.specifiers} module ` +
        'specifier(s). Expected dozens of packages and thousands of specifiers — the package walk or ' +
        'the parser is broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `Scanned ${counters.packages} workspace package(s), ${counters.files} source file(s), ` +
      `${counters.specifiers} module specifier(s): ${counters.external} import(s) of another package, ` +
      `${counters.relative} relative, ${counters.alias} path alias, ${counters.builtin} node builtin, ` +
      `${counters.selfImport} self-import (${counters.exempted} exempted).`,
  );

  if (findings.length === 0) {
    console.log('✅  No package names itself inside its own src/.');
    process.exit(0);
  }

  console.error(`\n❌  ${findings.length} self-import problem(s):\n`);
  for (const finding of findings) {
    if (finding.reason === 'stale-exemption') {
      console.error(`      ${finding.file}  [stale-exemption]  ${finding.detail}`);
      continue;
    }
    const extra = [finding.kind !== 'import' ? finding.kind : null, finding.typeOnly ? 'type-only' : null]
      .filter(Boolean)
      .join(', ');
    console.error(
      `      ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ` +
        `${finding.pkg} imports itself as '${finding.specifier}'${extra ? ` (${extra})` : ''}`,
    );
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((finding) => finding.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nA package self-import is green on every machine that has ever run a build and red on a cold ' +
      'CI cache\nonly — which is why this is a gate and not a review note. See the header of ' +
      'scripts/check-package-self-import.mjs (objectui#4801).',
  );
  process.exit(1);
}
