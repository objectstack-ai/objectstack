#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-undeclared-dep-imports (#10062) -- a package's NON-TEST `src/**` may
 * only import workspace packages that its own manifest DECLARES.
 *
 *   node scripts/check-undeclared-dep-imports.mjs              # judge the tree
 *   node scripts/check-undeclared-dep-imports.mjs --list       # the full sweep, per package
 *   node scripts/check-undeclared-dep-imports.mjs --self-test  # prove the battery can go red
 *
 * ## The class, and why "it is type-only" stopped covering it
 *
 * The measurement is the one the finding was filed with, unchanged: for every
 * workspace package, the `@objectstack/*` specifiers imported by its non-test
 * `src/**`, minus the packages its manifest declares. When that set is
 * non-empty, published source depends on something an installing consumer was
 * never told to install.
 *
 * The finding was filed with ONE member and a mitigation: the import was
 * type-only, so nothing reached the emitted JavaScript, and the shared
 * `tsup.config.ts` externalises `dependencies`/`peerDependencies` only -- a
 * devDependency is BUNDLED, which for `dts` means rollup-plugin-dts inlines the
 * declaration instead of leaving an unresolvable `import type` in the published
 * `.d.ts`. Both halves of that mitigation are now dead, and that is why this
 * gate exists rather than a convention:
 *
 *   * the class grew to three members with no signal, exactly as the filing
 *     predicted ("the next one arrives with no signal");
 *   * one member is a VALUE import --
 *     `service-automation/src/flow-precedence.ts` imports `isCodeArtifactBody`
 *     from `@objectstack/objectql` -- and the built
 *     `service-automation/dist/index.js` carries 9 occurrences of that function
 *     with no runtime import of objectql. objectql's implementation is INLINED
 *     into another package's bundle: a second copy of a workspace package's
 *     code, kept correct only by the bundler configuration continuing to bundle
 *     rather than externalise.
 *
 * Nothing in the tree asserted the invariant in either direction. There is no
 * `import/no-extraneous-dependencies` rule in `eslint.config.mjs`, and the two
 * gates that look adjacent answer a DIFFERENT question:
 * `check:type-source-resolution` and `check:test-source-alias` decide WHICH
 * copy of a dependency's types is resolved, never WHETHER the dependency is
 * declared.
 *
 * ## What counts as DECLARED
 *
 * `dependencies` + `peerDependencies` + `optionalDependencies`. A peer is a
 * declaration to the consumer -- `@objectstack/cli` declares
 * `@objectstack/driver-turso` as an optional peer precisely so an operator is
 * told about it -- so reading peers as undeclared would red on the packages
 * that did the right thing. `devDependencies` is deliberately NOT in the set:
 * it is the exact spelling this class is about, and a devDependency is absent
 * from a consumer's install tree by definition.
 *
 * ## Scope: non-test `src/**`, and what "non-test" is decided by
 *
 * Only `src/` is read -- a package's own tests, fixtures, scripts, benches and
 * config files are free to reach for a devDependency, which is what
 * devDependencies are for. Inside `src/`, a file is a test when its basename
 * carries `.test.` / `.spec.`, or when it sits under a `__tests__`, `test/`,
 * `tests/` or `__fixtures__` directory.
 *
 * A directory the package's OWN `tsconfig.json` excludes is not this package's
 * compiled source and is not read. That is not a courtesy: it is how
 * `packages/create-objectstack/src/templates/**` is judged. Those files are
 * PAYLOAD -- copied verbatim into a scaffolded user project by tsup's
 * `onSuccess`, never compiled here -- and their `@objectstack/*` imports
 * describe the generated project's manifest, not this one's. The evidence is
 * mechanical and lives in the tree (`"exclude": ["src/templates"]`), so it
 * cannot rot into a hardcoded skip list here. The honoured exclusions are
 * printed by `--list`.
 *
 * ## Comments are masked, and the mask is load-bearing
 *
 * Every scanned file goes through `scripts/js-comment-mask.mjs` -- `scanSource`
 * for the flags, `blank` for the projection, no private stripper here (see
 * `check:comment-mask-adoption`). Both flag arrays are load-bearing, and each
 * was measured fabricating members on `aef1b7e6`:
 *
 *   * COMMENT. `packages/rest/src/rest-server.ts` and
 *     `packages/cli/src/utils/storage-driver.ts` both carry comments that NAME
 *     the package they are explaining, and
 *     `packages/runtime/src/turso-driver-factory.ts` spends a docblock on why
 *     its specifier is written the way it is. A gate that reds on the authors
 *     who documented the situation is worse than no gate.
 *   * LITERAL. `packages/cli/src/commands/create.ts` builds a scaffolded
 *     README inside a template literal, and that README contains a fenced
 *     TypeScript block reading `import { … } from '@objectstack/plugin-${name}'`.
 *     The comment mask leaves it standing -- it is a string, not prose -- and
 *     an unguarded matcher reads it as an import of a package that does not
 *     exist. So a match counts only when its `import` / `from` / `require`
 *     KEYWORD sits at a byte the scanner flags as code.
 *
 * ## What a specifier is, and the one shape this gate cannot judge
 *
 * Static `import` / `export ... from`, bare side-effect `import '...'`, dynamic
 * `import('...')` and `require('...')`, with a STRING LITERAL specifier. A
 * dynamic import whose specifier is assembled -- `@objectstack/plugin-${name}`
 * in `packages/cli/src/commands/create.ts` -- names no package at scan time and
 * is not judged. Those are COUNTED and printed by `--list` rather than dropped,
 * so the population that cannot be decided stays visible instead of reading as
 * clean.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A sweep that finds nothing because it swept nothing reports exactly what a
 * clean tree reports. Every floor below is therefore a REFUSAL (exit 2), not a
 * pass, and each is set from a measured value with margin:
 *
 *   * fewer than MIN_PACKAGES workspace packages discovered -- the manifest
 *     globs stopped matching;
 *   * fewer than MIN_SCANNED_FILES non-test `src` files read -- the walk broke;
 *   * fewer than MIN_SPECIFIERS `@objectstack/*` specifiers extracted -- the
 *     MATCHER broke, which is the failure this gate cannot otherwise see: a
 *     dead regex produces an empty finding set, and the empty set is what
 *     success looks like.
 *
 * ## The provenance of a floor, and how to reproduce it
 *
 * `MEASURED` is a claim about ONE named commit -- `MEASURED.ref` -- and never
 * about `main`. It is the census the floors under it were derived from, not a
 * statement about the tree you are running on.
 *
 * ⭐ This gate is the sharp case of why that record has to be PRINTED. All three
 * floors are `>=`, and this record drifts UPWARD: measured 2026-08-29 the tree
 * read 2085 non-test src files and 1819 specifiers against a recorded 2057 and
 * 1805, so +28 and +14. ⛔ No floor can ever see an upward drift -- the number
 * moves further from the only thing looking at it, and the gate goes on
 * printing OK. The record was also a bare COMMENT until this repair, so nothing
 * in the language could hold it: no self-test could reference it, and no run
 * could show it to anybody.
 *
 * ⚠️ `MEASURED.ref` is this gate's PR BASE, and this gate DOES NOT EXIST in
 * that tree: the census was taken on the PR branch, and the base is the sha the
 * branch had to record. So the obvious recipe -- check the ref out and run the
 * gate there -- fails with `MODULE_NOT_FOUND` (measured 2026-08-29), and the
 * reader who tries it learns nothing about the record. Reproduce it by running
 * TODAY's instrument AGAINST that tree instead. `sweep` is exported and takes a
 * root for exactly this:
 *
 *   git worktree add --detach ../os-dep-provenance "$REF"    # $REF = MEASURED.ref
 *   node --input-type=module -e "import('./scripts/check-undeclared-dep-imports.mjs')
 *     .then((m) => { const r = m.sweep('../os-dep-provenance');
 *       console.log(r.packages.length, r.scannedFiles, r.specifiers); })"
 *
 * All three counts are source-only, so where the tree is available the
 * re-derivation is cheap: no install and no build. Re-derived at `MEASURED.ref`
 * on 2026-08-29: 78 / 2057 / 1805 -- exactly the record, which is the
 * measurement that rules out "the original count was written wrong".
 *
 * ⚠️ A SHALLOW clone cannot do this at all -- `MEASURED.ref` predates the
 * default checkout window, so the commit is simply absent. That is why the
 * reconciliation below is a PRINTED comparison and not a computed assertion:
 * the ref's tree is not reliably on disk. And note what a computed assertion
 * would be worth even where it works -- a commit's tree is IMMUTABLE, so
 * re-deriving the record at its ref can never go red. The only thing that moves
 * is today's tree, and comparing today's tree to the record is an equality.
 *
 * ## Why no equality against the tree, and why no band either
 *
 * An equality reds on every legitimate move, and this population moves on
 * almost every merge -- every new source file under a published `src` changes
 * it. A band around the record is the next thing to reach for, and it fails a
 * derivation rather than a taste test. Two reasons, either one sufficient:
 *
 *   1. The band already exists and is called the FLOOR. `MIN_SCANNED_FILES` IS
 *      `MEASURED.scannedFiles` minus the headroom this gate declared. A second,
 *      narrower band would be a second tolerance for one fact, and its width
 *      would be invented rather than measured.
 *   2. No width measures anything. Measured 2026-08-29, the three gates in
 *      `scripts/` carrying a record of this shape had drifted +28, -5 and -1
 *      from theirs, in both directions, within days of landing. A band narrow
 *      enough to notice a -1 next door reds on this file's +28; one wide enough
 *      to survive the +28 cannot see the -1.
 *
 * So the repair is not enforcement. What was missing is that a GREEN run never
 * showed the reader the two censuses side by side. `provenanceLine` prints both
 * on every pass: the drift is a fact in the log, not a discovery.
 *
 * ## The ledger is shrink-only, and a STALE row is RED
 *
 * A row is not an approval and not a waiver spelled once: it carries EVIDENCE
 * that must still be true, so it fails as soon as its subject moves.
 *
 * A row is admitted on ONE criterion, and it is not taste: the tree already
 * carries a decision that this package must NOT be declared here, together with
 * its reason. Everything else is remediated -- by declaring the dependency, by
 * declaring it as an OPTIONAL PEER where the source says it is an optional
 * install, or by routing the value through a package this one already declares.
 *
 * `optional-runtime-probe` -- declaring it would install it, and the import is
 * a guarded probe. The row demands the occurrence still be a DYNAMIC
 * `import()`: converting it to a static import makes the package a hard
 * requirement of module load, which is the very thing the row certifies it is
 * not, and reds here.
 *
 * `type-only` -- nothing reaches the emitted JavaScript, and the published
 * `.d.ts` inlines the declaration rather than naming the package. The row
 * demands every occurrence still be `import type` / `export type`. This is the
 * ORIGINAL mitigation of #10062, and the reason it is a row rather than a
 * convention: the mitigation was prose, `service-automation` turned its import
 * into a VALUE import, and nothing anywhere went red. Now that transition reds
 * here, on the PR that writes it.
 *
 * Both kinds also demand the package still be undeclared: once the manifest
 * declares it, the finding is gone and the row is stale, which is RED. The list
 * only ever shrinks.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// ---------------------------------------------------------------------------
/**
 * The subtrees this gate walks, declared so a dispatch brief can NAME it.
 *
 * The population is derived at runtime from `pnpm-workspace.yaml`, which is the
 * only honest source for "what is a workspace package". But a derived
 * population is invisible to `scripts/pm/dispatch-gates.mjs`, and `hintCovers`
 * refuses a separator-less literal as too generic -- so declaring the bare
 * words `packages`, `apps`, `examples` would build no hint at all and this gate
 * would be named by no brief: the invisible-population species
 * `scripts/pm/bare-root-worklist.mjs` exists to count. The glob form is
 * reachable by construction.
 *
 * These are a DECLARATION, never a lookup key -- the walk still comes from the
 * manifest. `--self-test` holds the two together: every `packages:` glob in
 * `pnpm-workspace.yaml` must sit under one of these hints, so a new workspace
 * root reds here instead of quietly leaving part of the tree unswept and this
 * gate unnameable.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**', 'apps/**', 'examples/**'];

// ---------------------------------------------------------------------------
// Refusal floors, and the provenance of the census they were derived from --
// the header is the authority on how to reproduce it and on why it is recorded
// rather than enforced. Raising the real number is normal; a run that drops
// BELOW one of these has stopped reading.
//
// ⚠️ This census used to be a bare COMMENT rather than a constant, and that is
// why it drifted +28/+14 unnoticed: nothing in the language held it, so no
// self-test could reference it and no run could print it. A record only prose
// carries is a record only prose can lose.

const MEASURED = Object.freeze({
  // The commit this census describes. ⚠️ It is this gate's PR BASE, not a tree
  // the gate ever ran in -- see the header for the recipe that actually
  // reproduces it. Immutable, so the record stays reproducible forever even as
  // `main` moves away from it. ⛔ Never repoint it without re-running all three
  // counts against the new ref.
  ref: 'aef1b7e6',
  packages: 78,
  scannedFiles: 2057,
  specifiers: 1805,
});
const MIN_PACKAGES = 60;
const MIN_SCANNED_FILES = 1500;
const MIN_SPECIFIERS = 1200;

// ---------------------------------------------------------------------------
// The ledger. Shrink-only; every row carries evidence re-checked on each run.

const LEDGER = [
  {
    pkg: '@objectstack/runtime',
    dep: '@objectstack/driver-turso',
    file: 'packages/runtime/src/turso-driver-factory.ts',
    kind: 'optional-runtime-probe',
    why:
      'The tree already carries the decision NOT to declare this, with its reason: #6268\'s header '
      + 'on that file states that `@objectstack/driver-turso` is an optional PEER of '
      + '`@objectstack/cli` and "is not declared by `@objectstack/runtime` at all", because a bare '
      + '`import()` resolves from the tree of the module that EVALUATES it — so the CLI passes its '
      + 'own thunk and this bare import is only the standalone stack\'s default. Absence raises '
      + 'MissingDriverPackageError carrying the install command as data.',
  },
  {
    pkg: '@objectstack/rest',
    dep: '@objectstack/objectql',
    file: 'packages/rest/src/rest-server.ts',
    kind: 'optional-runtime-probe',
    why:
      'The state-machine introspection door mirrors the dispatcher branch: the import is wrapped in '
      + 'try/catch and a deployment serving REST WITHOUT the data engine answers 501 '
      + 'NOT_IMPLEMENTED rather than failing to load. `@objectstack/rest` is deliberately not '
      + 'coupled to the engine — `query-multiplicity.ts` and the rest of `rest-server.ts` duck-type '
      + 'the same seam for exactly that reason — so declaring it would reverse a stance the tree '
      + 'states, not repair an omission.',
  },
  {
    pkg: '@objectstack/service-datasource',
    dep: '@objectstack/driver-turso',
    file: 'packages/services/service-datasource/src/default-datasource-driver-factory.ts',
    kind: 'optional-runtime-probe',
    why:
      'The tree carries this decision in an executable form. `default-datasource-driver-factory.'
      + 'test.ts` reaches the missing-package arm WITHOUT a stub — "deliberately not a dependency '
      + 'of this package, that is what optional means" — and it fails loudly with a notice naming '
      + 'the remedy if the package ever resolves from here. Declaring it (even as an optional peer) '
      + 'links it in the workspace and takes that assertion out; measured on this branch.',
  },
  {
    pkg: '@objectstack/service-datasource',
    dep: '@objectstack/driver-sqlite-wasm',
    file: 'packages/services/service-datasource/src/default-datasource-driver-factory.ts',
    kind: 'optional-runtime-probe',
    why:
      'Guarded arm: the load sits in try/catch and an absent package answers with '
      + 'missingSqliteWasmDriverMessage, naming the fault, the consequence and the install command '
      + '(#7385). The wasm driver rides as an optional install for published consumers, which the '
      + 'factory header states, so an unconditional dependency would install it for everyone.',
  },
  {
    pkg: '@objectstack/service-datasource',
    dep: '@objectstack/driver-sqlite-wasm',
    file: 'packages/services/service-datasource/src/sqlite-driver-fallback.ts',
    kind: 'optional-runtime-probe',
    why:
      'The same optional package on the fallback LADDER: rung 2 is entered inside try/catch and an '
      + 'absent package simply drops through to the next rung. The whole point of the ladder is that '
      + 'each rung may be unavailable, so a hard dependency would contradict the module.',
  },
  {
    pkg: '@objectstack/service-datasource',
    dep: '@objectstack/driver-mongodb',
    file: 'packages/services/service-datasource/src/default-datasource-driver-factory.ts',
    kind: 'optional-runtime-probe',
    why:
      'Guarded arm, same shape and same ruling as the sqlite-wasm arm beside it (#7385): try/catch, '
      + 'and an absent package answers with the fault, the consequence and the install command. '
      + '`@objectstack/runtime` declares this one in optionalDependencies for its own reasons; this '
      + 'package reaches it only through the guarded factory arm.',
  },
  {
    pkg: '@objectstack/rest',
    dep: '@objectstack/metadata-protocol',
    file: 'packages/rest/src/package-routes.ts',
    kind: 'type-only',
    why:
      '#9960 chose the PRODUCER\'s exported types over a local restatement for the '
      + '`protocol.deletePackage` seam, and refused a spec shape for it (zero external consumers). '
      + 'Nothing reaches the emitted JavaScript and rollup-plugin-dts inlines the two aliases, so an '
      + 'installing consumer is never told to install a package it does not receive. Measured on '
      + 'this branch: `packages/rest/dist/index.d.ts` and `index.d.cts` carry ZERO module '
      + 'references to `@objectstack/metadata-protocol` (its one textual occurrence is inside a '
      + 'TSDoc comment), and every `from` specifier in those published types names a package rest '
      + 'DECLARES — @objectstack/core, @objectstack/spec/* and zod. The row\'s mechanical evidence '
      + 'is the type-only form, checked every run; a value import ends it.',
  },
];

const LEDGER_KINDS = new Set(['optional-runtime-probe', 'type-only']);

// ---------------------------------------------------------------------------
// Workspace discovery

/**
 * The `packages:` globs from pnpm-workspace.yaml. Only the `<dir>/*` shape this
 * repo uses is understood; anything else REFUSES rather than being skipped, so
 * a new glob shape cannot silently shrink the population.
 */
export function workspaceGlobs(yamlText) {
  const lines = yamlText.split('\n');
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const m = /^\s+-\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line);
      if (m) { globs.push(m[1]); continue; }
      if (/^\S/.test(line)) inPackages = false;
    }
  }
  return globs;
}

function discoverPackages(root, globs) {
  const found = [];
  const bad = [];
  for (const glob of globs) {
    if (!glob.endsWith('/*') || glob.slice(0, -2).includes('*')) { bad.push(glob); continue; }
    const parent = join(root, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(parent, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
      catch { bad.push(`${relative(root, manifestPath)} (unparseable)`); continue; }
      if (typeof manifest.name !== 'string') { bad.push(`${relative(root, manifestPath)} (no name)`); continue; }
      found.push({ dir, rel: relative(root, dir).split('\\').join('/'), manifest });
    }
  }
  return { packages: found, bad };
}

// ---------------------------------------------------------------------------
// Source selection

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const TEST_BASENAME = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(?:^|\/)(?:__tests__|__fixtures__|tests?)\//;

/** Directory prefixes under the package root that the package's own tsconfig excludes. */
export function tsconfigExcludedDirs(pkgDir) {
  const out = [];
  const path = join(pkgDir, 'tsconfig.json');
  if (!existsSync(path)) return out;
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '')); }
  catch { return out; }
  for (const entry of cfg.exclude ?? []) {
    if (typeof entry !== 'string' || entry.includes('*')) continue;
    const normalised = entry.replace(/^\.\//, '').replace(/\/$/, '');
    // Only exclusions INSIDE `src/` are relevant — `dist` and `node_modules`
    // are never walked, and listing them would make `--list` unreadable.
    if (normalised !== 'src' && !normalised.startsWith('src/')) continue;
    out.push(normalised);
  }
  return out;
}

function walkSources(dir, base, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkSources(abs, base, out);
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

export function isTestPath(relPathFromPkg) {
  const base = relPathFromPkg.split('/').pop() ?? '';
  return TEST_BASENAME.test(base) || TEST_DIR.test(relPathFromPkg);
}

// ---------------------------------------------------------------------------
// Specifier extraction -- comments masked first, string literals only.

const LITERAL_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(@objectstack\/[^'"\n]+)\1/g;
const ASSEMBLED_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)`@objectstack\/[^`\n]*\$\{/g;
const DYNAMIC_HEAD = /(?:\bimport\s*\(\s*|\brequire\s*\(\s*)$/;
const TYPE_ONLY_HEAD = /^(?:import|export)\s+type\s/;

/**
 * `static-type` vs `static`, decided from the statement KEYWORD rather than
 * from the clause: `import type { X } from 'p'` erases whole, while
 * `import { type X, y } from 'p'` is a value import that also names a type. The
 * conservative reading is the stricter one, so only the `import type` /
 * `export type` head earns `static-type`.
 */
function staticForm(maskedText, matchIndex) {
  const from = Math.max(0, matchIndex - 4096);
  const window = maskedText.slice(from, matchIndex);
  const start = Math.max(window.lastIndexOf('import'), window.lastIndexOf('export'));
  if (start < 0) return 'static';
  return TYPE_ONLY_HEAD.test(window.slice(start)) ? 'static-type' : 'static';
}

/**
 * Occurrences of `@objectstack/*` specifiers in ONE already-masked source text.
 * Each carries `form` so a ledger row can demand a shape rather than a name.
 */
export function specifiersIn(source) {
  const { comment, literal } = scanSource(source);
  const maskedText = blank(source, comment);
  const occurrences = [];
  let assembled = 0;
  let m;
  LITERAL_SPEC.lastIndex = 0;
  while ((m = LITERAL_SPEC.exec(maskedText)) !== null) {
    if (literal[m.index]) continue;
    const head = maskedText.slice(Math.max(0, m.index), m.index + m[0].length - m[2].length - 2);
    const line = maskedText.slice(0, m.index).split('\n').length;
    occurrences.push({
      spec: m[2],
      pkg: m[2].split('/').slice(0, 2).join('/'),
      form: DYNAMIC_HEAD.test(head) ? 'dynamic' : staticForm(maskedText, m.index),
      line,
    });
  }
  ASSEMBLED_SPEC.lastIndex = 0;
  while ((m = ASSEMBLED_SPEC.exec(maskedText)) !== null) {
    if (literal[m.index]) continue;
    assembled += 1;
  }
  return { occurrences, assembled };
}


export function declaredDeps(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

// ---------------------------------------------------------------------------
// The sweep

export function sweep(root) {
  const workspacePath = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) {
    return { fatal: `pnpm-workspace.yaml not found under ${root}` };
  }
  const globs = workspaceGlobs(readFileSync(workspacePath, 'utf8'));
  if (globs.length === 0) return { fatal: `no \`packages:\` globs parsed out of ${workspacePath}` };
  const { packages, bad } = discoverPackages(root, globs);
  if (bad.length > 0) return { fatal: `unreadable workspace entries: ${bad.join(', ')}` };

  let scannedFiles = 0;
  let specifiers = 0;
  let assembled = 0;
  const findings = [];
  const exclusions = [];

  for (const pkg of packages) {
    const srcDir = join(pkg.dir, 'src');
    if (!existsSync(srcDir)) continue;
    const excluded = tsconfigExcludedDirs(pkg.dir);
    if (excluded.length > 0) exclusions.push({ pkg: pkg.manifest.name, excluded });
    const declared = declaredDeps(pkg.manifest);
    for (const abs of walkSources(srcDir, pkg.dir, [])) {
      const relFromPkg = relative(pkg.dir, abs).split('\\').join('/');
      if (excluded.some((e) => relFromPkg === e || relFromPkg.startsWith(`${e}/`))) continue;
      if (isTestPath(relFromPkg)) continue;
      scannedFiles += 1;
      const { occurrences, assembled: a } = specifiersIn(readFileSync(abs, 'utf8'));
      specifiers += occurrences.length;
      assembled += a;
      for (const occ of occurrences) {
        if (occ.pkg === pkg.manifest.name) continue;
        if (declared.has(occ.pkg)) continue;
        findings.push({
          pkg: pkg.manifest.name,
          dep: occ.pkg,
          spec: occ.spec,
          file: relative(root, abs).split('\\').join('/'),
          line: occ.line,
          form: occ.form,
          devDeclared: Boolean(pkg.manifest.devDependencies?.[occ.pkg]),
        });
      }
    }
  }

  return { packages, scannedFiles, specifiers, assembled, findings, exclusions };
}

// ---------------------------------------------------------------------------
// Ledger reconciliation

export function reconcile(findings, ledger) {
  const unledgered = [];
  const staleRows = [];
  const matched = new Set();

  for (const finding of findings) {
    const row = ledger.find((r) => r.pkg === finding.pkg && r.dep === finding.dep && r.file === finding.file);
    if (row === undefined) { unledgered.push(finding); continue; }
    matched.add(row);
    if (row.kind === 'optional-runtime-probe' && finding.form !== 'dynamic') {
      staleRows.push({
        row,
        why: `the occurrence at ${finding.file}:${finding.line} is a ${finding.form} import. `
          + 'An `optional-runtime-probe` row certifies the package is NOT required at module load; '
          + 'a static import makes it required. Declare the dependency or restore the dynamic import.',
      });
    }
    if (row.kind === 'type-only' && finding.form !== 'static-type') {
      staleRows.push({
        row,
        why: `the occurrence at ${finding.file}:${finding.line} is a ${finding.form} import. `
          + 'A `type-only` row certifies that NOTHING reaches the emitted JavaScript — that is the '
          + 'whole of its evidence, and a value import ends it. This is the exact transition that '
          + 'killed the mitigation for service-automation. Declare the dependency, or route the '
          + 'value through a package this one already declares.',
      });
    }
  }
  for (const row of ledger) {
    if (matched.has(row)) continue;
    staleRows.push({
      row,
      why: 'no finding matches this row any more. The import is gone or the dependency is now '
        + 'declared — either way the row is stale and must be deleted in the same PR.',
    });
  }
  return { unledgered, staleRows };
}

function ledgerShapeProblems(ledger) {
  const problems = [];
  for (const row of ledger) {
    const at = `${row.pkg} <- ${row.dep}`;
    if (!LEDGER_KINDS.has(row.kind)) problems.push(`${at}: unknown kind \`${row.kind}\``);
    if (typeof row.why !== 'string' || row.why.length < 40) problems.push(`${at}: \`why\` must state the reason`);
    if (typeof row.file !== 'string' || !row.file.includes('/')) problems.push(`${at}: \`file\` must be a repo-relative path`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Reporting

function refuse(message) {
  console.error(`check:undeclared-dep-imports: ${message}`);
  process.exit(2);
}

function floorProblems(result) {
  if (result.packages.length < MIN_PACKAGES) {
    return `discovered only ${result.packages.length} workspace package(s), below the floor of `
      + `${MIN_PACKAGES} (${MEASURED.packages} on ${MEASURED.ref}).\n`
      + 'The `packages:` globs stopped matching. A sweep over an empty population reports exactly\n'
      + 'what a clean tree reports, so this is a refusal rather than a pass.';
  }
  if (result.scannedFiles < MIN_SCANNED_FILES) {
    return `read only ${result.scannedFiles} non-test src file(s), below the floor of `
      + `${MIN_SCANNED_FILES} (${MEASURED.scannedFiles} on ${MEASURED.ref}).\n`
      + 'The walk or the test/exclusion filter broke. Refusing to report clean over files nobody read.';
  }
  if (result.specifiers < MIN_SPECIFIERS) {
    return `extracted only ${result.specifiers} \`@objectstack/*\` specifier(s), below the floor of `
      + `${MIN_SPECIFIERS} (${MEASURED.specifiers} on ${MEASURED.ref}).\n`
      + 'The MATCHER broke. A dead matcher produces an empty finding set, and the empty set is what\n'
      + 'success looks like — so this is the one floor this gate cannot do without.';
  }
  return null;
}

/**
 * The provenance footer for a PASSING run: the census this run read, the floors
 * it cleared, the census those floors were derived from, and the ref that
 * census belongs to -- side by side.
 *
 * This is the whole repair, and this gate needed it most: its three floors are
 * `>=`, and its record has drifted UPWARD (+28/+14 measured 2026-08-29). ⭐ No
 * floor can EVER see an upward drift -- the number moves away from the only
 * thing looking at it. Without this line the record could get arbitrarily far
 * from the tree and every green log would look identical either way. The delta
 * is reported as INFORMATION and never as a verdict: only the floors decide.
 *
 * Pure, so `--self-test` drives it with no tree.
 *
 * @param {{packages?: number, scannedFiles?: number, specifiers?: number}} counts
 * @returns {string}
 */
export function provenanceLine(counts) {
  const got = [counts?.packages ?? 0, counts?.scannedFiles ?? 0, counts?.specifiers ?? 0];
  const rec = [MEASURED.packages, MEASURED.scannedFiles, MEASURED.specifiers];
  const floors = [MIN_PACKAGES, MIN_SCANNED_FILES, MIN_SPECIFIERS];
  const delta = got.map((g, i) => (g === rec[i] ? '=' : `${g > rec[i] ? '+' : ''}${g - rec[i]}`));
  return `  provenance — packages/scannedFiles/specifiers: this run ${got.join('/')}`
    + ` · floors ${floors.join('/')} · derived from ${rec.join('/')} measured on ${MEASURED.ref}`
    + ` (${delta.join('/')} vs the record).\n`
    + '  ⚠ The delta is information, not a verdict — the floors are `>=` and cannot see an upward'
    + ' drift at all, which is why it is PRINTED. Reproduce the record: see this file\'s header.';
}

function main() {
  const shape = ledgerShapeProblems(LEDGER);
  if (shape.length > 0) refuse(`the ledger itself is malformed:\n  • ${shape.join('\n  • ')}`);

  const result = sweep(REPO_ROOT);
  if (result.fatal !== undefined) refuse(result.fatal);
  const floor = floorProblems(result);
  if (floor !== null) refuse(floor);

  const { unledgered, staleRows } = reconcile(result.findings, LEDGER);

  if (staleRows.length > 0) {
    console.error(`✗ check:undeclared-dep-imports: ${staleRows.length} stale ledger row(s)\n`);
    for (const s of staleRows) console.error(`  • ${s.row.pkg} <- ${s.row.dep} (${s.row.file})\n    ${s.why}`);
    console.error('');
  }

  if (unledgered.length > 0) {
    console.error(`✗ check:undeclared-dep-imports: ${unledgered.length} undeclared workspace import(s)\n`);
    for (const f of unledgered) {
      const where = f.devDeclared ? 'devDependencies only' : 'not declared at all';
      console.error(`  • ${f.pkg} <- ${f.dep} (${where})`);
      console.error(`      ${f.file}:${f.line}  [${f.form}]  '${f.spec}'`);
    }
    console.error(
      '\nA package\'s published `src/**` may only import what its manifest declares.\n'
      + 'Fix it one of three ways, and the choice is per member, not a policy:\n'
      + '  1. move the package into `dependencies` — the coupling is real, make it installable;\n'
      + '  2. route through a package already declared, or a local wrapper (PR #12296\'s route) —\n'
      + '     the coupling was avoidable, remove it;\n'
      + '  3. if the package is deliberately NOT installed (an optional runtime probe), add a\n'
      + '     ledger row in scripts/check-undeclared-dep-imports.mjs with its evidence.\n'
      + 'Declaring and wrapping are not equivalent: the first makes the coupling real and\n'
      + 'installable, the second removes it.',
    );
  }

  if (staleRows.length > 0 || unledgered.length > 0) return 1;

  console.log(
    `✓ check:undeclared-dep-imports: ${result.packages.length} workspace packages under `
    + `${ROOT_DIR_WATCH_HINTS.join(' + ')}, `
    + `${result.scannedFiles} non-test src files, ${result.specifiers} @objectstack/* specifiers `
    + `(${result.assembled} assembled, not judged); ${LEDGER.length} ledger row(s), all evidence intact.`,
  );
  console.log(provenanceLine({
    packages: result.packages.length,
    scannedFiles: result.scannedFiles,
    specifiers: result.specifiers,
  }));
  return 0;
}

function list() {
  const result = sweep(REPO_ROOT);
  if (result.fatal !== undefined) refuse(result.fatal);
  console.log(`packages: ${result.packages.length}  non-test src files: ${result.scannedFiles}  `
    + `@objectstack/* specifiers: ${result.specifiers}  assembled (not judged): ${result.assembled}\n`);
  console.log('tsconfig-excluded directories honoured:');
  for (const e of result.exclusions) console.log(`  ${e.pkg}: ${e.excluded.join(', ')}`);
  console.log('\nfindings (published src imports minus declared deps):');
  if (result.findings.length === 0) console.log('  (none)');
  for (const f of result.findings) {
    const ledgered = LEDGER.some((r) => r.pkg === f.pkg && r.dep === f.dep && r.file === f.file);
    console.log(`  ${f.pkg} <- ${f.dep}  [${f.form}]${ledgered ? '  (ledgered)' : ''}`);
    console.log(`      ${f.file}:${f.line}  '${f.spec}'  ${f.devDeclared ? 'devDependencies only' : 'undeclared'}`);
  }
  console.log(`\ntotal packages with findings: ${new Set(result.findings.map((f) => f.pkg)).size}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test
//
// The production run is green by construction on a fixed tree, so it cannot
// tell a working matcher from a dead one — every case below supplies the
// adversarial input a clean tree does not contain. Both directions are covered:
// the detector FIRING on each import form, and the detector STAYING SILENT on
// the four shapes that are legitimately not findings.

function fixture(root, rel, text) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function makeTree(root, { manifest, files, workspace }) {
  fixture(root, 'pnpm-workspace.yaml', workspace ?? 'packages:\n  - packages/*\n');
  fixture(root, 'packages/subject/package.json', JSON.stringify(manifest, null, 2));
  for (const [rel, text] of Object.entries(files)) fixture(root, `packages/subject/${rel}`, text);
}

function selfTest() {
  let failures = 0;
  const t = (name, ok) => { if (!ok) { failures += 1; console.error(`  FAIL  ${name}`); } else console.log(`  ok    ${name}`); };

  const tmp = mkdtempSync(join(tmpdir(), 'undeclared-dep-imports-'));
  const run = (spec) => {
    const root = mkdtempSync(join(tmp, 'case-'));
    makeTree(root, spec);
    return sweep(root);
  };
  const baseManifest = { name: '@objectstack/subject', dependencies: { '@objectstack/spec': 'workspace:*' } };

  try {
    // ── the detector FIRES, once per import form ────────────────────────────
    const staticImport = run({ manifest: baseManifest, files: { 'src/a.ts': "import { x } from '@objectstack/undeclared';\n" } });
    t('static value import of an undeclared package is a finding',
      staticImport.findings.length === 1 && staticImport.findings[0].dep === '@objectstack/undeclared'
      && staticImport.findings[0].form === 'static');

    const typeImport = run({ manifest: baseManifest, files: { 'src/a.ts': "import type { X } from '@objectstack/undeclared';\n" } });
    t('type-only import is a finding too (the "nothing lands in the JS" mitigation is not a pass)',
      typeImport.findings.length === 1 && typeImport.findings[0].form === 'static-type');

    const typeExport = run({ manifest: baseManifest, files: { 'src/a.ts': "export type { X } from '@objectstack/undeclared';\n" } });
    t('`export type ... from` is recorded as `static-type`',
      typeExport.findings.length === 1 && typeExport.findings[0].form === 'static-type');

    const inlineType = run({ manifest: baseManifest, files: { 'src/a.ts': "import { type X, y } from '@objectstack/undeclared';\n" } });
    t('an INLINE type clause beside a value binding is `static`, not `static-type` (the conservative read)',
      inlineType.findings.length === 1 && inlineType.findings[0].form === 'static');

    const bare = run({ manifest: baseManifest, files: { 'src/a.ts': "import '@objectstack/undeclared';\n" } });
    t('bare side-effect import is a finding', bare.findings.length === 1);

    const reExport = run({ manifest: baseManifest, files: { 'src/a.ts': "export { x } from '@objectstack/undeclared';\n" } });
    t('re-export is a finding', reExport.findings.length === 1);

    const dynamic = run({ manifest: baseManifest, files: { 'src/a.ts': "const m = await import('@objectstack/undeclared');\n" } });
    t('dynamic import is a finding, and is recorded as `dynamic`',
      dynamic.findings.length === 1 && dynamic.findings[0].form === 'dynamic');

    const required = run({ manifest: baseManifest, files: { 'src/a.ts': "const m = require('@objectstack/undeclared');\n" } });
    t('require() is a finding, and is recorded as `dynamic`',
      required.findings.length === 1 && required.findings[0].form === 'dynamic');

    const subpath = run({ manifest: baseManifest, files: { 'src/a.ts': "import { x } from '@objectstack/undeclared/kernel';\n" } });
    t('a subpath import is attributed to its PACKAGE',
      subpath.findings.length === 1 && subpath.findings[0].dep === '@objectstack/undeclared'
      && subpath.findings[0].spec === '@objectstack/undeclared/kernel');

    const devOnly = run({
      manifest: { ...baseManifest, devDependencies: { '@objectstack/undeclared': 'workspace:*' } },
      files: { 'src/a.ts': "import { x } from '@objectstack/undeclared';\n" },
    });
    t('a devDependency is NOT a declaration, and the report says so',
      devOnly.findings.length === 1 && devOnly.findings[0].devDeclared === true);

    // ── the detector STAYS SILENT where it must ─────────────────────────────
    const declared = run({
      manifest: { ...baseManifest, dependencies: { '@objectstack/dep': 'workspace:*' } },
      files: { 'src/a.ts': "import { x } from '@objectstack/dep';\n" },
    });
    t('a declared dependency is not a finding', declared.findings.length === 0);

    const peer = run({
      manifest: { ...baseManifest, peerDependencies: { '@objectstack/dep': 'workspace:^' } },
      files: { 'src/a.ts': "import { x } from '@objectstack/dep';\n" },
    });
    t('a peerDependency counts as declared', peer.findings.length === 0);

    const optional = run({
      manifest: { ...baseManifest, optionalDependencies: { '@objectstack/dep': 'workspace:*' } },
      files: { 'src/a.ts': "import { x } from '@objectstack/dep';\n" },
    });
    t('an optionalDependency counts as declared', optional.findings.length === 0);

    const selfRef = run({ manifest: baseManifest, files: { 'src/a.ts': "import { x } from '@objectstack/subject/other';\n" } });
    t('a package importing its own name is not a finding', selfRef.findings.length === 0);

    const tests = run({
      manifest: baseManifest,
      files: {
        'src/a.test.ts': "import { x } from '@objectstack/undeclared';\n",
        'src/b.spec.ts': "import { x } from '@objectstack/undeclared';\n",
        'src/__tests__/c.ts': "import { x } from '@objectstack/undeclared';\n",
        'src/tests/d.ts': "import { x } from '@objectstack/undeclared';\n",
        'src/__fixtures__/e.ts': "import { x } from '@objectstack/undeclared';\n",
      },
    });
    t('tests and fixtures are out of scope (that is what devDependencies are for)',
      tests.findings.length === 0 && tests.scannedFiles === 0);

    const outsideSrc = run({ manifest: baseManifest, files: { 'scripts/tool.ts': "import { x } from '@objectstack/undeclared';\n" } });
    t('only `src/**` is read', outsideSrc.findings.length === 0);

    // ── the comment mask, in both directions ───────────────────────────────
    const prose = run({
      manifest: baseManifest,
      files: {
        'src/a.ts': "// mirrors: `import { x } from '@objectstack/undeclared'` is a devDependency\n"
          + "/* import { y } from '@objectstack/undeclared'; */\nexport const ok = 1;\n",
      },
    });
    t('MASK — a comment naming an import is not a finding (the measured fabrication)',
      prose.findings.length === 0);

    const proseAndCode = run({
      manifest: baseManifest,
      files: { 'src/a.ts': "// explains '@objectstack/undeclared'\nimport { x } from '@objectstack/undeclared';\n" },
    });
    t('MASK — masking does not blind the gate to real code beside the prose',
      proseAndCode.findings.length === 1 && proseAndCode.findings[0].line === 2);

    const assembled = run({
      manifest: baseManifest,
      files: { 'src/a.ts': 'const m = await import(`@objectstack/plugin-${name}`);\n' },
    });
    t('an assembled specifier is COUNTED, not judged and not dropped',
      assembled.findings.length === 0 && assembled.assembled === 1);

    // ── tsconfig exclusions are honoured, and only where declared ──────────
    const payload = run({
      manifest: baseManifest,
      files: {
        'tsconfig.json': JSON.stringify({ include: ['src'], exclude: ['src/templates'] }),
        'src/templates/blank/app.ts': "import { x } from '@objectstack/undeclared';\n",
      },
    });
    t('a tsconfig-excluded directory is payload, not this package\'s source',
      payload.findings.length === 0 && payload.exclusions.length === 1);

    const noExclusion = run({
      manifest: baseManifest,
      files: {
        'tsconfig.json': JSON.stringify({ include: ['src'] }),
        'src/templates/blank/app.ts': "import { x } from '@objectstack/undeclared';\n",
      },
    });
    t('the SAME file is a finding when the tsconfig does not exclude it',
      noExclusion.findings.length === 1);

    // ── refusals ───────────────────────────────────────────────────────────
    const emptyRoot = mkdtempSync(join(tmp, 'empty-'));
    t('REFUSAL — a root with no pnpm-workspace.yaml is fatal, never clean',
      typeof sweep(emptyRoot).fatal === 'string');

    const noGlobs = mkdtempSync(join(tmp, 'noglobs-'));
    fixture(noGlobs, 'pnpm-workspace.yaml', 'onlyBuiltDependencies:\n  - esbuild\n');
    t('REFUSAL — a manifest with no `packages:` globs is fatal',
      typeof sweep(noGlobs).fatal === 'string');

    const badGlob = run({ manifest: baseManifest, files: { 'src/a.ts': 'export const ok = 1;\n' }, workspace: 'packages:\n  - "packages/**/*"\n' });
    t('REFUSAL — a glob shape this parser does not understand is fatal, not skipped',
      typeof badGlob.fatal === 'string');

    t('FLOOR — an empty population trips the package floor rather than passing',
      floorProblems({ packages: [], scannedFiles: 99999, specifiers: 99999 }) !== null);
    t('FLOOR — a broken walk trips the file floor',
      floorProblems({ packages: new Array(MIN_PACKAGES).fill(0), scannedFiles: 0, specifiers: 99999 }) !== null);
    t('FLOOR — a dead matcher trips the specifier floor (the one that cannot be seen otherwise)',
      floorProblems({ packages: new Array(MIN_PACKAGES).fill(0), scannedFiles: MIN_SCANNED_FILES, specifiers: 0 }) !== null);
    // ⚠️ This case used to pass the FLOOR values back in as the "measured"
    // ones, which made it `floors clear themselves` -- a tautology over two
    // copies of one constant. It now reads the record, so it also catches a
    // floor set ABOVE its own measurement.
    t('FLOOR — the values in the record clear every floor',
      floorProblems({
        packages: new Array(MEASURED.packages).fill(0),
        scannedFiles: MEASURED.scannedFiles,
        specifiers: MEASURED.specifiers,
      }) === null);
    t('FLOOR — every floor sits at or below the value it was measured from',
      MIN_PACKAGES <= MEASURED.packages && MIN_SCANNED_FILES <= MEASURED.scannedFiles
      && MIN_SPECIFIERS <= MEASURED.specifiers);

    // ── provenance: the record must stay reproducible, and visibly so ──────
    //
    // ⛔ None of these can red on a tree that legitimately moved -- that is the
    // point, and an equality here is the thing the header rules out. They red
    // when the RECORD stops being a self-contained, reproducible claim: a ref
    // that is not a ref, a quotation that restated the ref instead of reading
    // it, or a pass line that stopped showing the reader both censuses.
    t('PROVENANCE — the record carries the ref it was measured on, inside the frozen record',
      typeof MEASURED.ref === 'string' && /^[0-9a-f]{7,40}$/.test(MEASURED.ref) && Object.isFrozen(MEASURED),
      JSON.stringify(MEASURED.ref));
    t('PROVENANCE — the census is a CONSTANT, not a comment: every count is a number code can read',
      [MEASURED.packages, MEASURED.scannedFiles, MEASURED.specifiers].every(Number.isInteger));
    const floorRefusal = floorProblems({ packages: [], scannedFiles: 99999, specifiers: 99999 }) ?? '';
    t('PROVENANCE — the refusal names the ref AND the measurement',
      floorRefusal.includes(MEASURED.ref) && floorRefusal.includes(String(MEASURED.packages)), floorRefusal);
    // ⚠️ The case above is NOT sufficient, and an ablation proved it: replacing
    // `${MEASURED.ref}` in the refusal with the same sha typed out by hand
    // leaves the OUTPUT identical, so an assertion over the output stays green
    // while the ref and the count have become editable apart -- which is the
    // whole defect this file was repaired for. The only thing separating
    // "interpolated from the record" from "restated and currently agreeing" is
    // that the literal occurs exactly ONCE in the CODE: inside the record.
    //
    // Comments are masked first, with this tree's own masker, because PROSE
    // naming the ref is fine and sometimes necessary -- the header explains how
    // to reproduce the census, and a sibling docblock may date a different
    // claim to the same commit. What may never happen twice is a ref the
    // MACHINE reads, because that is the pair that can drift apart.
    const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const ownCode = blank(ownSource, scanSource(ownSource).comment);
    t('PROVENANCE — the ref literal appears exactly ONCE in the CODE: inside the record. '
      + 'Every other site interpolates it, so a count and its tree cannot be edited apart',
      ownCode.split(MEASURED.ref).length - 1 === 1,
      `${ownCode.split(MEASURED.ref).length - 1} code occurrence(s) of the ref literal`);
    const provDrifted = provenanceLine({ packages: 78, scannedFiles: 2085, specifiers: 1819 });
    t('PROVENANCE — a passing run shows the census it read AND the census the floors came from',
      provDrifted.includes('78/2085/1819')
      && provDrifted.includes(`${MEASURED.packages}/${MEASURED.scannedFiles}/${MEASURED.specifiers}`)
      && provDrifted.includes(`${MIN_PACKAGES}/${MIN_SCANNED_FILES}/${MIN_SPECIFIERS}`)
      && provDrifted.includes(MEASURED.ref), provDrifted);
    t('PROVENANCE — the UPWARD drift no floor can see is the one this line reports',
      provDrifted.includes('=/+28/+14')
      && provenanceLine(MEASURED).includes('=/=/=')
      && provenanceLine({ ...MEASURED, specifiers: MEASURED.specifiers - 5 }).includes('/-5'),
      provDrifted);
    t('PROVENANCE — the delta is marked as information, never as a verdict',
      /not a verdict/i.test(provDrifted) && !/✗|REFUS/.test(provDrifted), provDrifted);
    t('PROVENANCE — the PASS path actually prints it (a line nothing calls is the defect above)',
      readFileSync(fileURLToPath(import.meta.url), 'utf8').includes(`console.log(${'provenanceLine'}({`),
      'the pass path in main() no longer calls provenanceLine — the record would stop being reconciled in the log');

    // ── ledger reconciliation, in both directions ─────────────────────────
    const row = { pkg: '@objectstack/p', dep: '@objectstack/d', file: 'packages/p/src/a.ts', kind: 'optional-runtime-probe', why: 'x'.repeat(50) };
    const dyn = { pkg: '@objectstack/p', dep: '@objectstack/d', file: 'packages/p/src/a.ts', form: 'dynamic', line: 1, spec: '@objectstack/d', devDeclared: false };
    t('LEDGER — a matching dynamic finding is covered by its row',
      reconcile([dyn], [row]).unledgered.length === 0 && reconcile([dyn], [row]).staleRows.length === 0);
    t('LEDGER — the same finding turned STATIC reds the row (the evidence, not the name)',
      reconcile([{ ...dyn, form: 'static' }], [row]).staleRows.length === 1);
    t('LEDGER — a row whose finding is gone is STALE, not silently satisfied',
      reconcile([], [row]).staleRows.length === 1);
    t('LEDGER — an unrelated finding is not absorbed by the row',
      reconcile([{ ...dyn, dep: '@objectstack/other' }], [row]).unledgered.length === 1);
    t('LEDGER — a row in another FILE does not cover this one',
      reconcile([{ ...dyn, file: 'packages/p/src/b.ts' }], [row]).unledgered.length === 1
      && reconcile([{ ...dyn, file: 'packages/p/src/b.ts' }], [row]).staleRows.length === 1);
    const typeRow = { pkg: '@objectstack/p', dep: '@objectstack/d', file: 'packages/p/src/a.ts', kind: 'type-only', why: 'y'.repeat(50) };
    const typeFinding = { ...dyn, form: 'static-type' };
    t('LEDGER — a `type-only` row covers a static-type finding',
      reconcile([typeFinding], [typeRow]).staleRows.length === 0
      && reconcile([typeFinding], [typeRow]).unledgered.length === 0);
    t('LEDGER — the same import turned into a VALUE import reds the `type-only` row',
      reconcile([{ ...typeFinding, form: 'static' }], [typeRow]).staleRows.length === 1
      && reconcile([{ ...typeFinding, form: 'dynamic' }], [typeRow]).staleRows.length === 1);
    t('LEDGER — a `type-only` row does NOT satisfy a dynamic probe, and vice versa',
      reconcile([dyn], [typeRow]).staleRows.length === 1
      && reconcile([typeFinding], [row]).staleRows.length === 1);
    t('LEDGER — a malformed row is refused before any sweep runs',
      ledgerShapeProblems([{ ...row, kind: 'made-up' }]).length === 1
      && ledgerShapeProblems([{ ...row, why: 'short' }]).length === 1
      && ledgerShapeProblems([row]).length === 0);
    t('LEDGER — the shipped ledger is well formed', ledgerShapeProblems(LEDGER).length === 0);

    // ── the declared watch hints stay equal to the real population ────────
    const declaredGlobs = workspaceGlobs(readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8'));
    const hintRoots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
    t('WATCH HINTS — every `packages:` glob in pnpm-workspace.yaml sits under a declared hint',
      declaredGlobs.length > 0
      && declaredGlobs.every((g) => hintRoots.some((r) => g === r || g.startsWith(`${r}/`))));
    t('WATCH HINTS — every hint is a glob, never a bare top-level word (hintCovers refuses those)',
      ROOT_DIR_WATCH_HINTS.every((h) => h.includes('/')));

    // ── POSITIVE CONTROL on the real tree ─────────────────────────────────
    // A zero from this gate is only a reading if the instrument is seen working
    // on the tree it actually judges. The sweep must reach the real population
    // and must extract real specifiers; a matcher that has died reads as clean.
    const real = sweep(REPO_ROOT);
    t('POSITIVE CONTROL — the real sweep reaches its population and extracts specifiers',
      real.fatal === undefined && real.packages.length >= MIN_PACKAGES
      && real.scannedFiles >= MIN_SCANNED_FILES && real.specifiers >= MIN_SPECIFIERS);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  check-undeclared-dep-imports --self-test (${failures} failure(s))`);
  return failures === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
