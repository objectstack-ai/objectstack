#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package's declared `@objectstack/spec` FLOOR must carry every symbol that
 * package's own published artifact references.
 *
 * Run:  node scripts/check-spec-range-floors.mjs   (also `pnpm check:spec-floors`)
 * Exit: 0 = every consumer-facing floor admits only specs that carry the symbols,
 *       1 = at least one floor admits a spec that lacks one, OR the gate could
 *           not read an artifact, a published export surface, or a floor
 *
 * Since objectui#12958 the floors it judges at publish (and nightly) are computed
 * from `.objectstack-sha` by `scripts/objectstack-floor.mjs`, which runs first. It
 * stays: a release that contains the pin can still have removed a symbol the
 * artifact uses, and only this gate reads the floor release's exports.
 *
 * ## What a GREEN run does NOT judge: key REFUSAL (objectui#9036)
 *
 * This gate judges SYMBOL PRESENCE, and only that. A floor that admits a spec
 * which DECLARES the symbol but REFUSES the keys this repository's packages
 * write into it is GREEN either way: nothing here ever parses a payload against
 * the floor's own schema. So a green run of this gate is not evidence that the
 * floors are behaviourally sound, and must not be read as such.
 *
 * That boundary is deliberate and measured, not an oversight. objectui#9036
 * priced the behavioural leg end to end — the census of closed schemas, the
 * false-positive rate of the cheap criterion, the fixture cost of the expensive
 * one — and the measurement lives there. Per commandment #9 no figure from it is
 * copied into this header: a restated number is unfalsifiable from where it sits
 * and goes wrong the moment the tree moves, while a pointer stays true.
 *
 * The variance is live in this repository, not hypothetical: `GanttConfigSchema`
 * is CLOSED (unknown keys rejected) at the floor `@object-ui/types` declares and
 * OPEN at the floor `@object-ui/plugin-gantt` declares — one schema, two floors,
 * opposite answers. That was true when this was written; what re-derives it is
 * the two manifests' declared ranges read against the spec, never this sentence.
 *
 * One fact outlives that example, and anyone reading this section as a starting
 * point needs it before anything else: a key ABSENT from a schema does NOT imply
 * that the schema refuses it. Whether the schema is CLOSED decides that, and it
 * varies per schema AND per version. Deriving refusal from a key list is the
 * step that makes a naive version of this criterion confidently wrong.
 *
 * ## The defect class (objectui#5793)
 *
 * `@objectstack/spec@17.1.0` added exports that 17.0.0 does not have.
 * objectui#5494 then landed `packages/plugin-detail/src/renderers/
 * record-reference-rail.tsx`, whose published `dist/renderers/
 * record-reference-rail.d.ts` reads
 *
 *     import { ReferenceRailEntry } from '@objectstack/spec/ui';
 *     export type { ReferenceRailEntry } from '@objectstack/spec/ui';
 *
 * while `packages/plugin-detail/package.json` declared
 * `"@objectstack/spec": "^17.0.0"` — the same range every package in the
 * workspace declared, uniformly.
 *
 * A declared range is a PUBLIC CLAIM about what the package works against. Any
 * consumer resolution that lands 17.0.0 — a sibling pinning it exactly, an
 * `overrides` entry, an offline mirror a minor behind — satisfies `^17.0.0` and
 * gets a dangling type re-export. Normal installs resolve the newest 17.x and
 * never see it, which is precisely why nothing found this for a release and a
 * half: it is a floor-honesty defect, not a live breakage, and the lockfile
 * hides it from every green check in this repository.
 *
 * The direction was ruled on objectui#5793 (triage comment 5385335220): floors
 * track reality. "The uniform `^17.0.0` is deliberate" would be a maintainer
 * ruling and is NOT assumed here — the platform default is contract-tightening
 * over consumer tolerance.
 *
 * ## Two ways to build this gate that return a confident GREEN
 *
 * Both were live hazards on this card, and both are avoided by construction
 * rather than by care:
 *
 * 1. **Resolution answers the wrong question.** The ROOT `package.json`
 *    declares `@objectstack/spec`, so pnpm hoists it to the workspace root and
 *    Node's upward walk finds it from ANY package directory regardless of that
 *    package's own manifest. `require.resolve('@objectstack/spec/ui', { paths:
 *    [pkgDir] })` therefore succeeds everywhere, and a green `tsc` proves
 *    nothing whatsoever about a floor — it type-checks against the INSTALLED
 *    17.2.0, not against the declared minimum. This is the same trap
 *    `check-phantom-dependencies.mjs` records for `react`. So this gate
 *    resolves NOTHING through the installed tree: it fetches the declared
 *    minimum version from the registry and reads that tarball's own manifest.
 *
 * 2. **The dual-package halves are two different builds.** `@objectstack/spec`
 *    ships `require` → `dist/<entry>/index.js` and `import` →
 *    `dist/<entry>/index.mjs`, with separate type entries (`index.d.ts` /
 *    `index.d.mts`). Reaching the package through `createRequire` reads a build
 *    no bundler ever puts in an application. This gate walks the fetched
 *    manifest's own `exports` map under the **`import`** condition and prints
 *    the entry it landed on, so the artifact it judged is named in the log
 *    rather than assumed.
 *
 *    The two halves were measured on 17.0.0 `./ui` while this gate was written:
 *    `dist/ui/index.d.mts`, `dist/ui/index.d.ts` and the package's own published
 *    `api-surface/ui.json` each list 425 exported names with an empty symmetric
 *    difference. They agree today — which is a MEASUREMENT, not a licence to
 *    read whichever is convenient, because a divergence would be invisible to a
 *    gate that only ever read one. `--cross-check` re-runs that comparison over
 *    every entry the run consulted.
 *
 * ## Why the criterion is the ARTIFACT, not `src/`
 *
 * Reading `src/` is cheaper and needs no build, and it is wrong in the
 * direction that costs most here: a `import type` used only inside a function
 * body is ERASED and never reaches `dist/`, so a src-based gate would demand a
 * floor bump that nothing published justifies. The dispatch order for this card
 * is explicit that every range changed must be backed by a symbol the gate
 * names, and a gate that over-names symbols corrupts exactly that. `dist/` is
 * also the only thing that cannot be wrong about what a consumer installs —
 * the same argument `check-published-dist-tooling.mjs` makes at length.
 *
 * The cost of that choice is a build, so this gate is wired the way objectui's
 * other artifact-level gate is: the RELEASE path plus a nightly alarm, never a
 * per-PR job. The 2026-08-16 ruling on objectui#4846 rejected a per-PR
 * full-repo build, and nothing about this card reopens it. Its verdict logic is
 * exercised per-PR by `scripts/__tests__/check-spec-range-floors.test.ts`
 * against synthetic inputs.
 *
 * ## What is scanned, and the hole that exclusion could leave
 *
 * Symbol names are read out of the ESM artifacts — type declarations
 * (`.d.ts` / `.d.mts` / `.d.cts`) and ES modules — with TypeScript's parser.
 * The UMD/CJS bundle is NOT parsed for names: it reaches its externals as
 * minified property accesses on a factory parameter
 * (`e.ObjectUISpecData.FeedFilterMode`), so no symbol name survives in it.
 *
 * An exclusion is where a gate goes quietly blind, so it is guarded rather than
 * trusted: every spec SUBPATH mentioned anywhere in the artifact set — the UMD
 * bundle included, found by plain text scan — must also be covered by an
 * artifact the gate could name symbols in. A subpath that reaches consumers
 * only through a bundle this gate cannot read is a finding (`opaque-subpath`),
 * not a silent pass.
 *
 * ## Consumer-facing fields only
 *
 * `dependencies` / `peerDependencies` / `optionalDependencies` — the fields
 * `check-phantom-dependencies.mjs` calls RUNTIME_FIELDS, imported from there
 * rather than retyped. A `devDependencies` range is not installed for anybody
 * and floors nothing. A package whose artifact references spec while declaring
 * it ONLY as a dev dependency is a phantom dependency, which is that gate's
 * finding and deliberately not restated here.
 *
 * When more than one consumer-facing field declares the package, a consumer
 * install must satisfy all of them, so the effective floor is the HIGHEST of
 * their minimum versions.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

import { RUNTIME_FIELDS } from './check-phantom-dependencies.mjs';
import { discoverPublishedPackages } from './check-published-dist-tooling.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** The dependency whose floor this gate judges. */
export const SPEC_PACKAGE = '@objectstack/spec';

/**
 * Artifact files whose exported/imported symbol names TypeScript can read.
 * `.js` is included because every published package here is `"type": "module"`;
 * `artifactKindOf` checks that per package rather than assuming it.
 */
export const NAMEABLE_ARTIFACT = /\.(?:d\.[cm]ts|d\.ts|mjs|js|jsx|tsx?)$/;

/** Build output roots, matching `check-published-dist-tooling.mjs`. */
export const ARTIFACT_DIRS = ['dist', 'build'];

/**
 * A scan that collapses passes everything. This repository has 27 published
 * packages declaring the spec at the time of writing, 19 of them
 * consumer-facing. The number below is a COLLAPSE ALARM an order of magnitude
 * under that — deliberately not a census, which would need editing every time a
 * package gains or drops the edge (the drift argument `.github/workflows/
 * lint.yml` makes about hand-copied counts).
 */
export const MIN_FLOORED_PACKAGES = 8;

// ── range arithmetic, deliberately narrow ────────────────────────────────────

/**
 * The versions this gate can ORDER: `X.Y.Z`, no prerelease, no build metadata.
 * Prereleases are never ordered — not against each other, not against a
 * release — because semver's prerelease precedence is a question this gate has
 * never had to answer, and a wrong answer here would read as a verdict.
 */
export const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * The versions this gate can READ AS A FLOOR: a plain release, or a prerelease
 * of one (`18.0.0-next.1`), still with no build metadata (objectui#12334).
 *
 * A prerelease floor is judged exactly like a release floor: that exact version
 * is fetched from the registry and its own export surface is read. It became
 * necessary when the workspace moved onto `@objectstack/*` 18, which exists only
 * as prereleases on the `next` dist-tag (objectui#12030): every range read
 * `^18.0.0-next.N`, every one threw here, no package counted as floored, and
 * the run stopped at the collapse alarm — so `pnpm changeset:publish`, which
 * runs this gate first, could publish nothing.
 *
 * Reading one is not ordering one. Where a floor would have to be COMPARED —
 * two consumer-facing fields naming different floors, a `||` union, the search
 * for a replacement floor — a prerelease still throws or names nothing, as
 * before. Two fields naming the SAME floor need no comparison.
 */
const FLOOR_SPELLING = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
export const FLOOR_VERSION = new RegExp(`^${FLOOR_SPELLING}$`);

/** One lower-bound comparator: an optional operator, then a FLOOR_VERSION. */
const LOWER_BOUND = new RegExp(String.raw`^(\^|~|>=|=)?(${FLOOR_SPELLING})$`);

/**
 * pnpm's workspace protocol (objectstack ruling D1: inside the objectstack
 * monorepo objectui declares `@objectstack/spec` as `workspace:^`). The tail is
 * `*`, `^`, `~`, empty, or a range: the first four say "the workspace package
 * at whatever version it has", and publish as `^<that version>`, so their floor
 * IS the workspace package's own version; a range tail is read as that range.
 */
export const WORKSPACE_PROTOCOL = /^workspace:(.*)$/;
const WORKSPACE_OWN_VERSION = new Set(['', '*', '^', '~']);

/** `[major, minor, patch]`, or `null` when `version` is not a plain release. */
export function parseVersion(version) {
  const match = RELEASE_VERSION.exec(String(version).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** -1 / 0 / 1, ordering two plain releases. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`cannot order "${a}" against "${b}": both must be plain X.Y.Z releases`);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/** The major of a plain release. */
export function majorOf(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`"${version}" is not a plain X.Y.Z release`);
  return parsed[0];
}

/**
 * The lowest version a consumer install may land for `range`.
 *
 * A hand-written, deliberately narrow reader rather than the `semver` package,
 * which is not a dependency of this repository's root — adding one to answer a
 * question about four range spellings is the wrong trade, and a phantom import
 * of a hoisted transitive copy is what `check-phantom-dependencies.mjs` exists
 * to stop.
 *
 * The narrowness IS the safety property: anything this function does not
 * recognise THROWS, and the caller turns that into a red `unreadable-range`
 * finding. The failure direction that matters is a range silently read as
 * "floor 0.0.0" and therefore satisfied by everything — the vacuous green this
 * whole gate exists to prevent — so an unrecognised spelling must never fall
 * through to a pass.
 *
 * Supported: `X.Y.Z`, `=X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`, `>=X.Y.Z`, and a
 * space-separated comparator set carrying exactly one of those as its lower
 * bound (`>=17.1.0 <18.0.0`). Each lower bound may name a prerelease
 * (`^18.0.0-next.1`), which is then the floor itself: the lowest version such a
 * range admits is that exact prerelease (FLOOR_VERSION above). A `||` union
 * takes the LOWEST branch: a consumer may satisfy the range through any
 * alternative, so the lowest is what the range admits — and since finding the
 * lowest is an ordering, a union with a prerelease branch still throws.
 *
 * A `workspace:` range (WORKSPACE_PROTOCOL above) reads as the workspace
 * package's own version, which the caller passes as `workspaceVersion`; with
 * none passed it THROWS like any other unreadable spelling, so a tree where the
 * workspace package cannot be found never reads as "floor 0.0.0".
 *
 * @param {string} range
 * @param {{ workspaceVersion?: string | null }} [options]
 */
export function minVersionOf(range, { workspaceVersion = null } = {}) {
  const text = String(range).trim();
  if (text.length === 0) throw new Error('an empty range names no floor.');

  const workspace = WORKSPACE_PROTOCOL.exec(text);
  if (workspace) {
    const tail = workspace[1].trim();
    if (!WORKSPACE_OWN_VERSION.has(tail)) return minVersionOf(tail, { workspaceVersion });
    if (typeof workspaceVersion !== 'string' || !FLOOR_VERSION.test(workspaceVersion)) {
      throw new Error(
        `range "${text}" names the workspace package's own version as its floor, and this run was not told that ` +
          `version${workspaceVersion ? ` ("${workspaceVersion}" is not one)` : ''}. Reported as a failure rather than guessed: ` +
          'a workspace range read without its workspace is a range with no floor at all.',
      );
    }
    return workspaceVersion;
  }

  if (text.includes('||')) {
    const branches = text.split('||').map((branch) => minVersionOf(branch, { workspaceVersion }));
    return branches.reduce((lowest, candidate) => (compareVersions(candidate, lowest) < 0 ? candidate : lowest));
  }

  let floor = null;
  for (const comparator of text.split(/\s+/).filter(Boolean)) {
    const lower = LOWER_BOUND.exec(comparator);
    if (lower) {
      if (floor !== null) {
        throw new Error(`range "${text}" carries more than one lower bound; this gate reads exactly one.`);
      }
      floor = lower[2];
      continue;
    }
    // Upper bounds are irrelevant to a floor and are skipped on purpose.
    if (/^<=?\d+(\.\d+){0,2}$/.test(comparator)) continue;
    throw new Error(
      `range "${text}" contains "${comparator}", which this gate does not read. Reported as a failure ` +
        'rather than guessed: a range whose floor is guessed wrongly is approved wrongly.',
    );
  }
  if (floor === null) throw new Error(`range "${text}" names no lower bound.`);
  return floor;
}

// ── the declared floor ───────────────────────────────────────────────────────

/**
 * The lowest `@objectstack/spec` a consumer install of this package may land.
 *
 * @param {object} manifest
 * @param {readonly string[]} [fields]
 * @param {{ workspaceVersion?: string | null }} [options] the workspace spec's own version, for a `workspace:` range
 * @returns {{ version: string, ranges: {field: string, range: string}[] } | null}
 *   `null` when no consumer-facing field declares the spec at all.
 */
export function effectiveFloor(manifest, fields = RUNTIME_FIELDS, { workspaceVersion = null } = {}) {
  const ranges = [];
  for (const field of fields) {
    const range = manifest?.[field]?.[SPEC_PACKAGE];
    if (typeof range === 'string' && range.length > 0) ranges.push({ field, range });
  }
  if (ranges.length === 0) return null;

  let floor = null;
  for (const { field, range } of ranges) {
    let min;
    try {
      min = minVersionOf(range, { workspaceVersion });
    } catch (error) {
      throw new Error(
        `${field}["${SPEC_PACKAGE}"] = "${range}": ${error.message} A range whose floor cannot be named ` +
          'cannot be judged, and "unjudgeable, therefore fine" is the verdict this gate must never return.',
      );
    }
    // Highest minimum wins: a consumer must satisfy every declared field at once.
    // Two fields naming the SAME floor need no ordering, which is what lets a
    // prerelease floor declared twice through; two different prerelease floors
    // would need one, and stay unreadable (FLOOR_VERSION above).
    if (floor === null || min === floor) {
      floor = min;
      continue;
    }
    try {
      if (compareVersions(min, floor) > 0) floor = min;
    } catch (error) {
      throw new Error(
        `${ranges.map((r) => `${r.field}["${SPEC_PACKAGE}"] = "${r.range}"`).join(', ')}: ${error.message}. ` +
          'Two different floors have to be ordered to name the effective one, and this gate does not order prereleases.',
      );
    }
  }
  return { version: floor, ranges };
}

/**
 * The version of `@objectstack/spec` the workspace resolves, read from the
 * installed package's manifest -- the nearest `node_modules/@objectstack/spec`
 * walking up from `root`. Standalone that is the pinned build linked into
 * `node_modules`; inside the objectstack monorepo it is the workspace link to
 * `packages/spec`. `null` when nothing is installed, which a `workspace:` range
 * then turns into an unreadable-range finding rather than a floor.
 *
 * @param {string} root
 * @returns {string | null}
 */
export function workspaceSpecVersion(root) {
  let dir = root;
  for (;;) {
    const manifest = join(dir, 'node_modules', SPEC_PACKAGE, 'package.json');
    if (existsSync(manifest)) {
      try {
        const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
        return typeof version === 'string' ? version : null;
      } catch {
        return null;
      }
    }
    const parent = join(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── what the artifact references ─────────────────────────────────────────────

/**
 * The spec subpath a specifier names, or `null` when it is not the spec.
 *
 * `@objectstack/spec` → `.`, `@objectstack/spec/ui` → `./ui` — the spelling the
 * `exports` map uses, so no second normalisation is needed downstream.
 */
export function specSubpathOf(specifier) {
  if (specifier === SPEC_PACKAGE) return '.';
  if (!specifier.startsWith(`${SPEC_PACKAGE}/`)) return null;
  return `./${specifier.slice(SPEC_PACKAGE.length + 1)}`;
}

/**
 * Every spec symbol one artifact file references, by subpath.
 *
 * Deliberately a sibling of `check-phantom-dependencies.mjs`'s
 * `moduleSpecifiers()` rather than a caller of it: that function answers "which
 * PACKAGE does this file reach for", this one answers "which SYMBOLS does it
 * take from it". The imported name is what matters, never the local alias —
 * `import { A as B }` needs the spec to export `A`.
 *
 * A namespace import (`import * as spec`) or a bare side-effect import names no
 * symbol, so it is recorded as a subpath requirement only.
 *
 * @returns {{ named: Map<string, Set<string>>, subpaths: Set<string> }}
 */
export function specSymbols(text, fileName = 'file.d.ts') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TSX);
  const named = new Map();
  const subpaths = new Set();

  const note = (subpath, name) => {
    subpaths.add(subpath);
    if (!name) return;
    if (!named.has(subpath)) named.set(subpath, new Set());
    named.get(subpath).add(name);
  };

  const visit = (node) => {
    let specifier = null;
    let clause = null;

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text;
      clause = node.importClause?.namedBindings;
      // `import Default from '…'` — the spec publishes no default export, but
      // naming it is the caller's claim, so record it as one.
      if (node.importClause?.name) {
        const sub = specSubpathOf(specifier);
        if (sub) note(sub, 'default');
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text;
      clause = node.exportClause;
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      // `import('@objectstack/spec/ui').ReferenceRailEntry`
      const sub = specSubpathOf(node.argument.literal.text);
      if (sub) note(sub, node.qualifier && ts.isIdentifier(node.qualifier) ? node.qualifier.text : null);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const sub = specSubpathOf(node.moduleReference.expression.text);
      if (sub) note(sub, null);
    }

    if (specifier) {
      const sub = specSubpathOf(specifier);
      if (sub) {
        if (clause && (ts.isNamedImports(clause) || ts.isNamedExports(clause))) {
          for (const element of clause.elements) note(sub, (element.propertyName ?? element.name).text);
        } else {
          // namespace binding, or `export * from`, or a side-effect import
          note(sub, null);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return { named, subpaths };
}

/**
 * Every spec subpath one artifact reaches for as a STRING LITERAL.
 *
 * The guard on the UMD exclusion. A minified bundle still names its externals
 * in full — `require("@objectstack/spec/data")`, and again in the AMD
 * `define([...])` array — even though every member access on them has been
 * renamed to a single letter. So the subpath survives where the symbol does
 * not, and that is enough to tell "this gate did not need to read that file"
 * apart from "this gate could not".
 *
 * String literals rather than raw text, and this is not a refinement: the first
 * spelling of this guard scanned the file's TEXT and produced THIRTY findings
 * across fifteen packages on its first run, every one of them a `@objectstack/
 * spec` mention inside a DOC COMMENT (`@objectstack/spec/ui.` with the full
 * stop of the sentence attached, `@objectstack/spec/data/object.zod.ts` naming
 * a source file, `@objectstack/spec/view` naming an entry point that does not
 * exist). A guard that fires on prose is a guard that gets deleted, taking the
 * real coverage question with it. Comments are not literals, so parsing is what
 * makes the guard survivable.
 */
export function specSubpathsFromLiterals(text, fileName = 'bundle.js') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.JS);
  const found = new Set();
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) {
      const sub = specSubpathOf(node.text);
      if (sub) found.add(sub);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Files that can carry a module specifier at all. */
export const EXECUTABLE_ARTIFACT = /\.[cm]?jsx?$/;

/** Is this artifact one whose symbol names the parser can read? */
export function isNameableArtifact(file) {
  if (/\.umd\.[cm]?js$/.test(file)) return false;
  if (/\.map$/.test(file)) return false;
  return NAMEABLE_ARTIFACT.test(file);
}

/** Is this file part of a package's build output? */
export function isArtifactFile(file) {
  return ARTIFACT_DIRS.includes(file.split('/')[0]);
}

/**
 * Walk one package's build output.
 *
 * @returns {string[]} package-relative, `/`-separated paths
 */
export function listArtifactFiles(root, pkg) {
  const found = [];
  for (const dir of ARTIFACT_DIRS) {
    const base = join(root, pkg.dir, dir);
    if (!existsSync(base)) continue;
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) found.push(relative(join(root, pkg.dir), full).split('\\').join('/'));
      }
    };
    walk(base);
  }
  return found;
}

/**
 * What one package's artifact takes from the spec.
 *
 * @returns {{ named: Map<string, Map<string, string[]>>, covered: Set<string>, mentioned: Set<string>, scanned: number }}
 */
export function collectSpecUsage(files, readArtifact) {
  const named = new Map();
  const covered = new Set();
  const mentioned = new Set();
  let scanned = 0;

  for (const file of files) {
    if (!isArtifactFile(file)) continue;
    const text = readArtifact(file);
    if (text === null || text === undefined) continue;
    if (!text.includes(SPEC_PACKAGE)) continue;

    if (!isNameableArtifact(file)) {
      // Unreadable for symbol names — but its subpaths still have to be
      // accounted for, or the exclusion is where this gate goes blind.
      if (EXECUTABLE_ARTIFACT.test(file)) {
        for (const sub of specSubpathsFromLiterals(text, file)) mentioned.add(sub);
      }
      continue;
    }

    scanned += 1;
    const { named: fileNamed, subpaths } = specSymbols(text, file);
    for (const sub of subpaths) {
      covered.add(sub);
      mentioned.add(sub);
    }
    for (const [sub, names] of fileNamed) {
      if (!named.has(sub)) named.set(sub, new Map());
      const bucket = named.get(sub);
      for (const name of names) {
        if (!bucket.has(name)) bucket.set(name, []);
        bucket.get(name).push(file);
      }
    }
  }
  return { named, covered, mentioned, scanned };
}

// ── the published export surface of a given spec version ─────────────────────

/**
 * Resolve one subpath of a package's `exports` map under a condition list.
 *
 * A hand-rolled resolver rather than `import.meta.resolve` / `require.resolve`
 * ON PURPOSE: both of those answer from the INSTALLED tree, which is 17.2.0
 * here and hoisted to the workspace root — the exact hazard this gate exists to
 * step around. This walks the manifest that was FETCHED for the version under
 * judgement, and returns the conditions it took so the caller can print them.
 *
 * @returns {{ target: string, path: string[] } | null}
 */
export function resolveExportTarget(exportsField, subpath, conditions) {
  if (!exportsField || typeof exportsField !== 'object') return null;
  const entry = exportsField[subpath];
  if (entry === undefined) return null;

  const walk = (node, path) => {
    if (typeof node === 'string') return { target: node, path };
    if (node === null) return null;
    if (Array.isArray(node)) {
      for (const candidate of node) {
        const hit = walk(candidate, path);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    for (const condition of conditions) {
      if (!(condition in node)) continue;
      const hit = walk(node[condition], [...path, condition]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(entry, []);
}

/**
 * Every name a `.d.ts` / `.d.mts` entry exports.
 *
 * The spec's entries re-export from internal chunk files under `as` renames
 * (`export { A as ActionNavItem } from '../app.zod-CH7IEmsS.mjs'`), so the
 * EXPORTED name — never the local one — is what a consumer can import. No
 * `export *` appears in any 17.x entry (checked while writing this gate), so
 * following chunks is not needed; one that appeared later would be recorded as
 * `*` and reported rather than silently dropped.
 */
export function declaredExportNames(text, fileName = 'index.d.mts') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TS);
  const names = new Set();
  const starFrom = [];

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      } else if (!statement.exportClause && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        starFrom.push(statement.moduleSpecifier.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default');
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }
  return { names, starFrom };
}

const defaultFetch = (version, dir) =>
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      dir,
      `${SPEC_PACKAGE}@${version}`,
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
      '--omit=optional',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

/**
 * Fetch one published spec version and read its export surface.
 *
 * NOT resolved from `node_modules` — see hazard 1 in this file's header.
 *
 * @returns {{ version: string, dir: string, entryFor(subpath): {target, path, names, starFrom} | null }}
 */
export function loadPublishedSpec(version, cacheRoot, { fetch = defaultFetch, log = () => {} } = {}) {
  const dir = join(cacheRoot, version);
  const installed = join(dir, 'node_modules', SPEC_PACKAGE);
  if (!existsSync(join(installed, 'package.json'))) {
    mkdirSync(dir, { recursive: true });
    log(`Fetching ${SPEC_PACKAGE}@${version} from the registry (declared floor, not the installed tree)…`);
    try {
      fetch(version, dir);
    } catch (error) {
      throw new Error(
        `could not fetch ${SPEC_PACKAGE}@${version}: ${error.message}. Reported as a FAILURE rather ` +
          'than a skip — a floor this gate could not read is not a floor it may approve.',
      );
    }
  }
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  if (manifest.version !== version) {
    throw new Error(
      `asked the registry for ${SPEC_PACKAGE}@${version} and got ${manifest.version}. The export ` +
        'surface read would belong to the wrong version, which is the whole failure this gate is about.',
    );
  }

  const cache = new Map();
  return {
    version,
    dir: installed,
    manifest,
    /** The `import`-condition type entry for one subpath, parsed. */
    entryFor(subpath, conditions = ['import', 'types', 'default']) {
      const key = `${subpath}\u0000${conditions.join(',')}`;
      if (cache.has(key)) return cache.get(key);
      const resolved = resolveExportTarget(manifest.exports, subpath, conditions);
      if (!resolved) {
        cache.set(key, null);
        return null;
      }
      const file = join(installed, resolved.target);
      const text = readFileSync(file, 'utf8');
      const { names, starFrom } = declaredExportNames(text, resolved.target);
      const value = { ...resolved, file, names, starFrom };
      cache.set(key, value);
      return value;
    },
  };
}

// ── the judgement ────────────────────────────────────────────────────────────

/**
 * One package's verdict.
 *
 * Takes only `entryFor` off the loaded spec, never the whole handle: the
 * verdict must be drivable from a synthetic export set, or the unit tests can
 * exercise nothing without a registry.
 *
 * @param {{name: string, dir: string, manifest: object}} pkg
 * @param {{named: Map, covered: Set, mentioned: Set, scanned: number}} usage
 * @param {{ entryFor: (subpath: string) => ({ target: string, path: string[], names: Set<string>, starFrom: string[] } | null) }} spec
 *   the published export surface AT THIS PACKAGE'S FLOOR
 * @param {string} floor
 * @returns {{findings: object[], entries: {subpath: string, target: string, path: string[]}[]}}
 */
export function auditPackage(pkg, usage, spec, floor) {
  const findings = [];
  const entries = [];

  if (usage.mentioned.size === 0) {
    // Declares the spec and never reaches for it in the artifact. Over-declared
    // is a different card; a floor with nothing behind it cannot be too low.
    return { findings, entries };
  }

  const opaque = [...usage.mentioned].filter((sub) => !usage.covered.has(sub));
  for (const subpath of opaque.sort()) {
    findings.push({
      reason: 'opaque-subpath',
      pkg: pkg.name,
      subpath,
      detail:
        `reaches ${SPEC_PACKAGE}${subpath.slice(1)} only from artifacts this gate cannot read symbol ` +
        'names in (a minified UMD/CJS bundle), so its floor is unjudged rather than approved',
    });
  }

  for (const subpath of [...usage.named.keys()].sort()) {
    const entry = spec.entryFor(subpath);
    if (!entry) {
      findings.push({
        reason: 'unknown-subpath',
        pkg: pkg.name,
        subpath,
        floor,
        detail: `${SPEC_PACKAGE}@${floor} publishes no "${subpath}" export at all`,
      });
      continue;
    }
    entries.push({ subpath, target: entry.target, path: entry.path });
    if (entry.starFrom.length > 0) {
      findings.push({
        reason: 'unfollowable-star',
        pkg: pkg.name,
        subpath,
        floor,
        detail:
          `${SPEC_PACKAGE}@${floor}'s "${subpath}" entry re-exports \`*\` from ` +
          `${entry.starFrom.join(', ')}; its export set is not fully readable, so no symbol under it is approved`,
      });
      continue;
    }
    for (const [name, files] of [...usage.named.get(subpath)].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (entry.names.has(name)) continue;
      findings.push({
        reason: 'floor-too-low',
        pkg: pkg.name,
        subpath,
        symbol: name,
        floor,
        files: files.slice(0, 3),
        detail:
          `${pkg.dir}/${files[0]} references \`${name}\` from ${SPEC_PACKAGE}${subpath.slice(1)}, ` +
          `which ${SPEC_PACKAGE}@${floor} does not export`,
      });
    }
  }
  return { findings, entries };
}

/**
 * The lowest version within `range` that exports every symbol in `wanted`.
 *
 * Named so the gate can say what the floor should BE, not only that it is
 * wrong — the dispatch order for objectui#5793 requires every range changed to
 * be backed by a symbol the gate names, and a bump nobody can justify from the
 * output is the failure mode on the other side.
 */
export function lowestSatisfyingVersion(wanted, candidates, load) {
  for (const version of candidates) {
    const spec = load(version);
    let ok = true;
    for (const [subpath, names] of wanted) {
      const entry = spec.entryFor(subpath);
      if (!entry || entry.starFrom.length > 0) {
        ok = false;
        break;
      }
      for (const name of names instanceof Map ? names.keys() : names) {
        if (!entry.names.has(name)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return version;
  }
  return null;
}

/**
 * The remedy line printed under the `floor-too-low` findings for one package:
 * the lowest published release of the floor's major that exports every symbol
 * the package references, or the statement that none does.
 *
 * A PRERELEASE floor names no replacement. Finding one means ordering published
 * versions against the floor, and this gate does not order prereleases
 * (FLOOR_VERSION above) — so it says that, rather than offering a release it
 * reached by an ordering it does not define.
 */
export function replacementFloorLine(pkg, floor, wanted, versions, load) {
  if (parseVersion(floor) === null) {
    return (
      `      ${pkg}  →  its floor ${floor} is a prerelease, which this gate does not order, so it names no ` +
      `replacement: raise the range to a published ${SPEC_PACKAGE} that exports the symbols above.`
    );
  }
  const candidates = versions.filter((v) => compareVersions(v, floor) > 0 && majorOf(v) === majorOf(floor));
  const answer = lowestSatisfyingVersion(wanted, candidates, load);
  return answer
    ? `      ${pkg}  →  "${SPEC_PACKAGE}": "^${answer}"`
    : `      ${pkg}  →  no published ${majorOf(floor)}.x carries every symbol it references; the spec side is what is wrong.`;
}

/** Published versions of the spec, oldest first, prereleases dropped. */
export function publishedVersions(run = () => execFileSync('npm', ['view', SPEC_PACKAGE, 'versions', '--json'], { encoding: 'utf8' })) {
  const parsed = JSON.parse(run());
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter((v) => parseVersion(v) !== null).sort(compareVersions);
}

// ── the run ──────────────────────────────────────────────────────────────────

/**
 * The whole run, as data.
 *
 * @param {string} root
 * @param {{
 *   cacheRoot?: string,
 *   load?: (version: string) => { entryFor: (subpath: string) => any },
 *   log?: (line: string) => void,
 *   packages?: {name: string, dir: string, manifest: object}[],
 *   workspaceVersion?: string | null,
 * }} [options] `workspaceVersion` replaces the installed spec's version a `workspace:` range reads as its floor
 */
export function analyze(root, { cacheRoot, load, log = () => {}, packages, workspaceVersion } = {}) {
  const resolvedCache = cacheRoot ?? join(root, 'node_modules/.cache/spec-range-floors');
  const specVersion = workspaceVersion === undefined ? workspaceSpecVersion(root) : workspaceVersion;
  const loadSpec = load ?? ((version) => loadPublishedSpec(version, resolvedCache, { log }));

  const all = packages ?? discoverPublishedPackages(root);
  const findings = [];
  const counters = { published: all.length, floored: 0, artifacts: 0, scanned: 0, symbols: 0 };
  const consulted = [];

  for (const pkg of all) {
    let floor;
    try {
      floor = effectiveFloor(pkg.manifest, RUNTIME_FIELDS, { workspaceVersion: specVersion });
    } catch (error) {
      findings.push({ reason: 'unreadable-range', pkg: pkg.name, detail: error.message });
      continue;
    }
    if (floor === null) continue;
    counters.floored += 1;

    const files = listArtifactFiles(root, pkg);
    if (files.length === 0) {
      findings.push({
        reason: 'no-artifact',
        pkg: pkg.name,
        detail:
          `${pkg.dir} declares ${SPEC_PACKAGE} ${floor.ranges.map((r) => `${r.field}:${r.range}`).join(' ')} but ` +
          'produced no build output to judge. Reported as a FAILURE rather than a skip: "nothing to ' +
          'inspect, therefore clean" is the verdict this gate must never return.',
      });
      continue;
    }
    counters.artifacts += files.length;

    const usage = collectSpecUsage(files, (file) => {
      const full = join(root, pkg.dir, file);
      try {
        if (statSync(full).size > 32 * 1024 * 1024) return null;
        return readFileSync(full, 'utf8');
      } catch {
        return null;
      }
    });
    counters.scanned += usage.scanned;
    for (const names of usage.named.values()) counters.symbols += names.size;

    const spec = loadSpec(floor.version);
    const { findings: packageFindings, entries } = auditPackage(pkg, usage, spec, floor.version);
    for (const entry of entries) consulted.push({ version: floor.version, ...entry });
    for (const finding of packageFindings) findings.push({ ...finding, ranges: floor.ranges, usage: usage.named });
  }

  return { findings, counters, consulted };
}

const HINTS = {
  'floor-too-low':
    'Raise that package\'s `@objectstack/spec` range to the lowest version that exports the symbol — the ' +
    'line above names it. Do not add a tolerant re-declaration on this side: the range is the claim, and ' +
    'the claim is what is wrong (objectui#5793).',
  'unknown-subpath':
    'The declared floor publishes no such entry point. Either the range is far too low, or the import is a ' +
    'typo the installed 17.x happens to satisfy.',
  'opaque-subpath':
    'Every spec subpath a package ships must appear in an artifact whose symbol names are readable — a ' +
    'type declaration or an ES module. A subpath reaching consumers only through a minified bundle leaves ' +
    'the floor unjudged, and this gate reports that rather than passing it.',
  'no-artifact': 'Build the workspace before running this gate: `pnpm exec turbo run build --filter=!@object-ui/site`.',
  'unreadable-range': 'A `@objectstack/spec` range with no computable minimum cannot be judged.',
  'unfollowable-star': 'The spec entry re-exports `*`; teach this gate to follow chunk files before trusting it here.',
};

export async function main(argv = process.argv.slice(2)) {
  const root = process.cwd();
  const log = (line) => console.log(line);

  const result = analyze(root, { log });
  const { findings, counters, consulted } = result;

  if (counters.floored < MIN_FLOORED_PACKAGES) {
    console.error(
      `The scan collapsed: ${counters.floored} package(s) declare ${SPEC_PACKAGE} in a consumer-facing ` +
        `field, fewer than the ${MIN_FLOORED_PACKAGES} this repository has. The manifest walk, the release ` +
        'group or the field list is broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  // Name the artifact that was judged — hazard 2 in the header. The entry is
  // printed, not assumed, so a run that silently read the `require` half is
  // visible in its own log.
  const byEntry = new Map();
  for (const entry of consulted) byEntry.set(`${entry.version}${entry.subpath}`, entry);
  console.log(
    `Read the export surface of ${byEntry.size} ${SPEC_PACKAGE} entry point(s), each resolved through the ` +
      "FETCHED package's own `exports` map — never through the installed tree:",
  );
  for (const entry of [...byEntry.values()].sort((a, b) => `${a.version}${a.subpath}`.localeCompare(`${b.version}${b.subpath}`))) {
    console.log(`      ${SPEC_PACKAGE}@${entry.version} "${entry.subpath}"  [${entry.path.join(' > ')}]  ${entry.target}`);
  }
  console.log(
    `Inspected ${counters.floored} of ${counters.published} published package(s) — ${counters.artifacts} ` +
      `artifact file(s), ${counters.scanned} of them carrying a ${SPEC_PACKAGE} reference this gate could ` +
      `read symbol names in, ${counters.symbols} (subpath, symbol) pair(s) judged.`,
  );

  if (argv.includes('--cross-check')) crossCheck(root, consulted, log);

  if (findings.length === 0) {
    console.log(`✅  Every consumer-facing ${SPEC_PACKAGE} floor carries the symbols its package's artifact references.`);
    process.exit(0);
  }

  const tooLow = findings.filter((f) => f.reason === 'floor-too-low');
  const affected = new Set(findings.map((f) => f.pkg));
  console.error(`\n❌  ${findings.length} finding(s) across ${affected.size} published package(s):\n`);
  for (const finding of findings) {
    console.error(`      ${finding.pkg}  [${finding.reason}]  ${finding.detail}`);
  }

  if (tooLow.length > 0) {
    console.error('\nThe lowest published spec that carries every symbol each package references:');
    const versions = publishedVersions();
    const cacheRoot = join(root, 'node_modules/.cache/spec-range-floors');
    for (const pkg of [...new Set(tooLow.map((f) => f.pkg))].sort()) {
      const wanted = tooLow.find((f) => f.pkg === pkg).usage;
      const floor = tooLow.find((f) => f.pkg === pkg).floor;
      console.error(replacementFloorLine(pkg, floor, wanted, versions, (v) => loadPublishedSpec(v, cacheRoot, { log })));
    }
  }

  for (const reason of Object.keys(HINTS)) {
    if (findings.some((f) => f.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(`\nSee the header of scripts/check-spec-range-floors.mjs (objectui#5793).`);
  process.exit(1);
}

/**
 * The dual-package cross-check, on demand.
 *
 * Re-reads every entry the run consulted through the `require` condition and
 * compares export sets with the `import` half the verdict used. They agree on
 * 17.x today; a divergence would mean the verdict covers one half of a
 * dual-package build only, which is hazard 2 in this file's header cashed in.
 */
export function crossCheck(root, consulted, log = () => {}) {
  const cacheRoot = join(root, 'node_modules/.cache/spec-range-floors');
  const loaded = new Map();
  let compared = 0;
  const divergent = [];
  for (const { version, subpath } of consulted) {
    if (!loaded.has(version)) loaded.set(version, loadPublishedSpec(version, cacheRoot, { log }));
    const spec = loaded.get(version);
    const esm = spec.entryFor(subpath, ['import', 'types', 'default']);
    const cjs = spec.entryFor(subpath, ['require', 'types', 'default']);
    if (!esm || !cjs) continue;
    compared += 1;
    const only = (a, b) => [...a.names].filter((n) => !b.names.has(n));
    const left = only(esm, cjs);
    const right = only(cjs, esm);
    if (left.length || right.length) divergent.push({ version, subpath, esm: esm.target, cjs: cjs.target, left, right });
  }
  if (divergent.length === 0) {
    log(`Dual-package cross-check: ${compared} entry point(s) — the \`import\` and \`require\` halves export the same names.`);
    return true;
  }
  for (const d of divergent) {
    console.error(
      `      ${SPEC_PACKAGE}@${d.version} "${d.subpath}": ${d.esm} and ${d.cjs} disagree — ` +
        `${d.left.length} name(s) only in the import half, ${d.right.length} only in the require half.`,
    );
  }
  return false;
}

if (isEntrypoint(import.meta.url)) await main();
