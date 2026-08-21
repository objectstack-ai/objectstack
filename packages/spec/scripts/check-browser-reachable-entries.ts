#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Mechanize the schema-free-export principle (#10199).
 *
 *   pnpm --filter @objectstack/spec check:browser-reachable-entries   # self-test + audit
 *   tsx scripts/check-browser-reachable-entries.ts --self-test        # fixture check only
 *
 * ## The principle, and why prose was not enough
 *
 * The 2026-08-20 maintainer ruling on #10096 minted a standing principle for
 * this package's export design (recorded verbatim, untranslated):
 *
 *   > 浏览器可达的 spec 导出面必须 schema-free。
 *
 * — an export surface browser/client consumers reach carries vocabulary (maps,
 * folds, enums, pure predicates) without linking the zod schema/validation
 * machinery. #10096's landing wrote it into `README.md` and `src/index.ts` and
 * shipped the reference pattern (`@objectstack/spec/meta-spelling`); the ruling
 * named mechanizing it a welcome follow-up, which is this file.
 *
 * The failure shape it guards is measured, not theoretical: ONE string fold
 * reached through `/shared` cost +246.9 KB minified / +69.7 KB gzipped (#10096),
 * and one pure predicate reached through `/security` cost +261.5 KB minified
 * (#10031). Both were invisible to every gate this repo had — objectui#5324
 * records that the consumer's OWN bundle-budget check reported PASS on the PR
 * that added the bytes. A budget check cannot see this: the bytes arrive inside
 * a dependency the consumer already imports, so the budget moves by a delta
 * nobody attributes. What is decidable is the module graph, and that is what
 * this reads.
 *
 * ## What it judges, and what it deliberately does not
 *
 * `browser-reachable-entries.json` is the contract half. Only the entries in its
 * `browserReachable` map are judged; everything else is UNJUDGED, so this gate is
 * additive and shrink-only and raises no weakening question. What it will not
 * let you do is leave an entry unclassified: every subpath in the `exports` map
 * must appear in exactly one of the ledger's three sections, in both directions
 * — the `check:generated` reconciliation pattern, for the same reason (a surface
 * nobody classified silently drops out of coverage).
 *
 * For a judged entry, two assertions:
 *
 *   1. **no zod anywhere in its built module graph** — `zod` or `zod/*`, reached
 *      directly or through any relative hop;
 *   2. **every bare external it links is declared** in that entry's `externals`
 *      list. `./meta-spelling` declares `[]`, i.e. a closed graph. This is the
 *      half that survives indirection: a wrapper package that re-exports zod
 *      would satisfy (1) — the bundle names the wrapper, not zod — and it cannot
 *      satisfy (2) without someone adding a line to the ledger and explaining it.
 *
 * ## Instrument: a static scan of the BUILT bundle, not an esbuild probe
 *
 * #10199 offered two instruments and asked for the cheaper one unless it proved
 * spoofable. It is the cheaper one, with the spoof paths closed rather than
 * assumed away. Measured on this tree, each closure named with what it answers:
 *
 *   - **"it scans the wrong file."** The file to scan is resolved THROUGH the
 *     `exports` map (`import`.default and `require`.default), not by the
 *     `dist/<entry>/index.mjs` convention. Repointing a subpath at a
 *     schema-bearing bundle moves what this reads, exactly as it moves what a
 *     consumer loads.
 *   - **"it only reads one file."** Today every entry is self-contained
 *     (`splitting: false`, and the scan finds zero relative specifiers across all
 *     34 bundles), so a one-file check would pass today and go quietly blind the
 *     day `splitting` is turned on and zod arrives through a shared chunk. So the
 *     walk is TRANSITIVE over relative hops, and a relative specifier that does
 *     not resolve is a hard error — an incomplete walk reporting "no zod" is the
 *     false green this gate exists to prevent. The self-test drives that walk
 *     over a synthetic chunk chain, because this tree cannot exercise it.
 *   - **"it reads prose."** The bundles carry documentation strings, and one of
 *     them really does contain the text `from '@objectstack/spec/ui'` inside a
 *     `reason:` string in `dist/index.mjs` — a naive grep reports it as an
 *     import. Specifiers are therefore accepted only where the statement keyword
 *     sits in CODE, decided by `scripts/js-comment-mask.mjs`, this tree's one
 *     answer to "comment, literal, or code".
 *   - **"zod stops being an external and gets inlined."** This is the one spoof a
 *     specifier scan genuinely cannot see, and it is why the gate carries a
 *     CALIBRATION assertion instead of a fragile inlined-runtime regex: across
 *     all scanned entries the scan must find at least one real zod link. Today it
 *     finds 15. If a bundler change inlines zod, or esbuild's emitted import
 *     shape moves out from under the scanner, that count goes to zero and the
 *     gate REFUSES — loudly, naming the instrument — instead of reporting every
 *     entry clean. A zod-version-specific content marker would have to be
 *     rewritten on every zod major; this cannot rot, because it is calibrated
 *     against whatever the tree actually builds.
 *
 * The esbuild probe (instrument 2) buys one thing over this: it measures the
 * exports map's resolution rather than the build layout. Resolving through the
 * exports map buys the same thing for no dependency and no bundle step, so it is
 * not adopted. If a future entry ever ships as something a static scan cannot
 * follow — a wildcard subpath, a conditional export tree — that is the point to
 * revisit it, and the reconciliation above is what will force the conversation.
 *
 * ## It reads BUILT output, so an unbuilt tree is NOT MEASURED
 *
 * Never "not applicable": a missing `dist` would make "found no zod link" and
 * "read no bundle" the same green, and a stale one would answer about a build
 * that predates the import under test (#4690's class). Both are refusals, via
 * `lib/dist-freshness.ts` — on the BUNDLE axis, not the `.d.ts` axis its sibling
 * uses; that file's docblock has the measurement for why the two differ.
 *
 * Exit: 0 = every declared entry is schema-free and the ledger reconciles;
 *       1 = a violation, an unclassified entry, an unbuilt/stale tree, or an
 *           instrument that can no longer detect zod.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanSource } from '../../../scripts/js-comment-mask.mjs';
import { inspectBundleFreshness } from './lib/dist-freshness';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = join(PKG_DIR, 'browser-reachable-entries.json');
const RERUN = 'pnpm --filter @objectstack/spec check:browser-reachable-entries';
const SELF_TEST = process.argv.includes('--self-test');

/** A specifier naming zod itself, or any of its subpaths. */
function isZodSpecifier(spec: string): boolean {
  return spec === 'zod' || spec.startsWith('zod/');
}

function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../');
}

// ---------------------------------------------------------------------------
// The scanner: which module specifiers does this bundle actually link?
// ---------------------------------------------------------------------------

/**
 * The three statement keywords a module specifier can sit behind, in output
 * esbuild emits: `from` (static import and re-export), `import` (bare
 * side-effect import, and the dynamic call form) and `require` (the CJS
 * bundle). Published here rather than left inside the matcher because a source
 * scan only ever sees the spellings it knows, and an unrecognised one produces
 * no finding — silently. The calibration assertion is the other half of that
 * bargain: if this list ever stops matching what the bundler emits, the zod
 * count falls to zero and the run refuses.
 */
const SPECIFIER_KEYWORDS = new Set(['from', 'import', 'require']);

/**
 * Read backwards from a string literal's opening quote and decide whether this
 * literal is a MODULE SPECIFIER or just a string.
 *
 * Walked character by character rather than matched with a regex over a fixed
 * window, because the two mistakes a window makes are both real here:
 * `Array.from('abc')` and `Buffer.from('...')` put the keyword `from`
 * immediately before a string literal, and only the preceding `.` tells them
 * apart from a re-export; and a window that happens to start exactly at the
 * keyword lets a `^` anchor stand in for the boundary check.
 *
 * Comment characters are treated as whitespace — `import /* c *\/ 'x'` is a
 * legal spelling — using the same flags that decided the literal was a literal.
 */
function specifierKeywordBefore(
  source: string,
  comment: Uint8Array,
  quoteIndex: number,
): string | null {
  let i = quoteIndex - 1;
  const skipBlanks = (): void => {
    while (i >= 0 && (comment[i] === 1 || /\s/.test(source[i]!))) i--;
  };

  skipBlanks();
  // The call forms — `require(`, `import(` — carry an open paren; `from` never does.
  if (i >= 0 && source[i] === '(') {
    i--;
    skipBlanks();
  }

  let end = i;
  while (i >= 0 && /[\w$]/.test(source[i]!)) i--;
  const word = source.slice(i + 1, end + 1);
  if (!SPECIFIER_KEYWORDS.has(word)) return null;

  // A member access is never a module specifier: `Array.from('abc')` is not an
  // import, and neither is `mod.require('x')`.
  if (i >= 0 && source[i] === '.') return null;

  return word;
}

export interface Specifier {
  spec: string;
  keyword: string;
}

/**
 * Every module specifier this bundle links, in file order.
 *
 * Exported so the self-test drives the real scanner over fixture sources rather
 * than over this tree, which would only prove what today's build happens to
 * contain (#4690: a scan whose green result is "nothing found" has to prove it
 * can still find something).
 */
export function specifiersOf(source: string): Specifier[] {
  const { comment, literal } = scanSource(source);
  const found: Specifier[] = [];
  let i = 0;

  while (i < source.length) {
    if (literal[i] !== 1 || comment[i] === 1) {
      i++;
      continue;
    }
    const start = i;
    while (i < source.length && literal[i] === 1 && comment[i] !== 1) i++;

    // The delimiters are CODE either side of a literal's content, so `start - 1`
    // is the opening quote whenever this run really is a string.
    const quoteIndex = start - 1;
    if (quoteIndex < 0) continue;
    const quote = source[quoteIndex];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;

    const keyword = specifierKeywordBefore(source, comment, quoteIndex);
    if (keyword) found.push({ spec: source.slice(start, i), keyword });
  }

  return found;
}

// ---------------------------------------------------------------------------
// The walk: one entry's whole built module graph
// ---------------------------------------------------------------------------

export interface BundleGraph {
  /** Every file visited, repo-relative, in visit order. */
  files: string[];
  /** Bare specifier → the files that link it. */
  externals: Map<string, string[]>;
  /** Relative specifiers that did not resolve — always an error, never a skip. */
  unresolved: { from: string; spec: string }[];
}

/**
 * Follow a relative specifier the way a runtime would, over what a bundler
 * actually emits.
 *
 * esbuild writes explicit extensions, so the bare join is the case that fires
 * today; the extension and directory-index fallbacks exist so that a future
 * output shape degrades into a RESOLVED hop rather than into an `unresolved`
 * error nobody expected. A specifier that matches none of them is reported, not
 * dropped.
 */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = join(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    join(base, 'index.mjs'),
    join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // A directory matched `existsSync`; keep looking at the index forms.
      }
    }
  }
  return null;
}

/**
 * Walk one built entry file and everything it reaches through relative hops.
 *
 * Bare specifiers are recorded as external links and NOT followed: this gate
 * judges what the published bundle links, and following a bare specifier would
 * mean walking `node_modules`, which is a different (and much larger) question
 * than the one #10199 asks. The `externals` allowlist is how indirection through
 * a bare specifier is kept honest instead.
 */
export function walkBundle(root: string, entryFile: string): BundleGraph {
  const graph: BundleGraph = { files: [], externals: new Map(), unresolved: [] };
  const seen = new Set<string>();
  const queue = [entryFile];

  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(root, file);
    graph.files.push(rel);

    const source = readFileSync(file, 'utf8');
    for (const { spec } of specifiersOf(source)) {
      if (isRelative(spec)) {
        const target = resolveRelative(file, spec);
        if (target) queue.push(target);
        else graph.unresolved.push({ from: rel, spec });
        continue;
      }
      const linkers = graph.externals.get(spec) ?? [];
      linkers.push(rel);
      graph.externals.set(spec, linkers);
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

interface Ledger {
  browserReachable: Record<string, { why: string; externals: string[] }>;
  unjudged: string[];
  notAModule: string[];
}

type ExportsMap = Record<string, unknown>;

/**
 * The files a consumer really loads for one subpath: the `import` condition's
 * default and the `require` condition's default.
 *
 * Both are scanned. They are separate bundles built by separate tsup passes, and
 * a promise that holds for the ESM half while the CJS half links zod is not a
 * promise — a bundler picking the `require` condition is the ordinary case for
 * a consumer on an older toolchain.
 */
function targetsOf(entry: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    for (const key of ['import', 'require']) {
      const branch = record[key];
      if (!branch || typeof branch !== 'object') continue;
      const target = (branch as Record<string, unknown>).default;
      if (typeof target === 'string') out.push(target);
    }
  };
  visit(entry);
  return out;
}

function reconcile(exportsMap: ExportsMap, ledger: Ledger, problems: string[]): void {
  const declared = new Map<string, string>();
  const claim = (subpath: string, section: string): void => {
    const already = declared.get(subpath);
    if (already) {
      problems.push(
        `'${subpath}' is classified twice — in '${already}' and in '${section}'. ` +
          `Every subpath belongs to exactly one section.`,
      );
      return;
    }
    declared.set(subpath, section);
  };

  for (const subpath of Object.keys(ledger.browserReachable)) claim(subpath, 'browserReachable');
  for (const subpath of ledger.unjudged) claim(subpath, 'unjudged');
  for (const subpath of ledger.notAModule) claim(subpath, 'notAModule');

  for (const subpath of Object.keys(exportsMap)) {
    if (declared.has(subpath)) continue;
    problems.push(
      `'${subpath}' is in package.json's exports map but is classified in NO section of\n` +
        `      browser-reachable-entries.json. Decide what it is:\n` +
        `        • browserReachable — a browser/client consumer reaches it, so it must link no zod;\n` +
        `        • unjudged        — a server/build-time surface this gate asserts nothing about;\n` +
        `        • notAModule      — it resolves to something other than a JS module.\n` +
        `      An unclassified entry is how a surface silently drops out of coverage.`,
    );
  }

  for (const [subpath, section] of declared) {
    if (subpath in exportsMap) continue;
    problems.push(
      `'${subpath}' is listed in browser-reachable-entries.json ('${section}') but is NOT in\n` +
        `      package.json's exports map. Delete the stale line — a ledger row for an entry\n` +
        `      nobody publishes reads as coverage that does not exist.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function audit(): never {
  const freshness = inspectBundleFreshness(PKG_DIR, 'check', RERUN);
  if (!freshness.fresh) {
    console.error(`❌  check:browser-reachable-entries — NOT MEASURED.${freshness.message}`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
    exports?: ExportsMap;
  };
  const exportsMap = pkg.exports ?? {};
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger;

  const problems: string[] = [];
  reconcile(exportsMap, ledger, problems);

  // Every JS entry is scanned, judged or not: the unjudged ones are what
  // calibrates the instrument (see the header). Scanning them costs ~0.4s.
  const notAModule = new Set(ledger.notAModule);
  let zodLinksFound = 0;
  let bundlesScanned = 0;
  const judged = ledger.browserReachable;

  for (const subpath of Object.keys(exportsMap)) {
    if (notAModule.has(subpath)) continue;
    const contract = judged[subpath];

    for (const target of targetsOf(exportsMap[subpath])) {
      const file = join(PKG_DIR, target);
      if (!existsSync(file)) {
        problems.push(
          `'${subpath}' resolves to ${target}, which does not exist. The exports map points at a\n` +
            `      file this build did not emit.`,
        );
        continue;
      }

      const graph = walkBundle(PKG_DIR, file);
      bundlesScanned++;

      for (const { from, spec } of graph.unresolved) {
        problems.push(
          `'${subpath}': ${from} links '${spec}', which resolves to no file on disk. The walk of\n` +
            `      this entry's module graph is INCOMPLETE, so no verdict about it can be trusted.`,
        );
      }

      const zodLinkers = [...graph.externals.entries()].filter(([spec]) => isZodSpecifier(spec));
      zodLinksFound += zodLinkers.length;
      if (!contract) continue;

      for (const [spec, linkers] of zodLinkers) {
        problems.push(
          `'${subpath}' is DECLARED browser-reachable but its built graph links '${spec}'\n` +
            `      (via ${linkers.join(', ')}).\n` +
            `      浏览器可达的 spec 导出面必须 schema-free (ruling 2026-08-20 on #10096): move the\n` +
            `      vocabulary this entry needs into a schema-free module — deriving it at BUILD time\n` +
            `      if its source is the zod graph, as gen:meta-url-spelling does — or withdraw the\n` +
            `      browser-reachable declaration. Do NOT satisfy this by re-exporting from a wrapper.`,
        );
      }

      const allowed = new Set(contract.externals);
      for (const [spec, linkers] of graph.externals) {
        if (isZodSpecifier(spec) || allowed.has(spec)) continue;
        problems.push(
          `'${subpath}' is DECLARED browser-reachable and links the undeclared external '${spec}'\n` +
            `      (via ${linkers.join(', ')}).\n` +
            `      This gate follows relative hops but does not walk node_modules, so an external is\n` +
            `      exactly where a zod link can hide behind one level of indirection. Add '${spec}' to\n` +
            `      this entry's "externals" in browser-reachable-entries.json — with the reason it is\n` +
            `      schema-free — or drop the dependency.`,
        );
      }
    }
  }

  // The calibration. A specifier scan cannot see a zod that got INLINED into the
  // bundles, nor an emitted import shape it no longer recognises; in both cases
  // it reports every entry clean. It cannot report that silently: zero zod links
  // across the whole surface means the instrument, not the surface, changed.
  if (bundlesScanned > 0 && zodLinksFound === 0) {
    console.error(
      `\n❌  check:browser-reachable-entries — INSTRUMENT NOT CALIBRATED.\n\n` +
        `   Scanned ${bundlesScanned} built bundle(s) and found ZERO zod links anywhere — including in\n` +
        `   the schema-bearing entries that certainly do link it. So this run cannot tell "no entry\n` +
        `   links zod" apart from "this scan can no longer see a zod link", and the green it would\n` +
        `   otherwise print would be worth nothing.\n\n` +
        `   The two causes, both real:\n` +
        `     • zod is no longer an external — a bundler change inlined it, so no specifier names it.\n` +
        `       This gate's scan must then learn to detect the inlined runtime.\n` +
        `     • the emitted import shape moved out from under the scanner (see SPECIFIER_KEYWORDS).\n`,
    );
    process.exit(1);
  }

  if (problems.length) {
    console.error(
      `\n❌  check:browser-reachable-entries — ${problems.length} problem(s):\n`,
    );
    for (const problem of problems) console.error(`   ✗ ${problem}\n`);
    console.error(
      `   The principle and the reference pattern: packages/spec/README.md ("Export surfaces"),\n` +
        `   src/index.ts's module doc, and src/meta-spelling/index.ts.\n`,
    );
    process.exit(1);
  }

  const declaredCount = Object.keys(judged).length;
  console.log(
    `✅  check:browser-reachable-entries — ${declaredCount} declared browser-reachable ` +
      `entr${declaredCount === 1 ? 'y links' : 'ies link'} no zod; ` +
      `${bundlesScanned} bundle(s) scanned, ${zodLinksFound} zod link(s) seen elsewhere ` +
      `(instrument calibrated); exports map fully classified.`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Self-test — the shapes, not the corpus
// ---------------------------------------------------------------------------

/**
 * A green run over today's build proves only what today's build contains, and
 * two of the things this gate must do cannot be exercised by it at all: the tree
 * has ZERO relative hops between bundles (every entry is self-contained), so the
 * transitive walk — the part that keeps the gate honest the day `splitting` is
 * turned on — would ship never having run. These fixtures are the contract.
 */
function selfTest(): never {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  };

  // ── The scanner: it must FIND real specifiers … ──────────────────────────
  const real = [
    `import { z } from 'zod';`,
    `export { a } from "./chunk-A.mjs";`,
    `import './side-effect.mjs';`,
    `var zod = require('zod');`,
    `const mod = await import('zod/v4');`,
  ].join('\n');
  const realSpecs = specifiersOf(real).map((s) => s.spec);
  check(
    'finds static import, re-export, bare import, require and dynamic import',
    JSON.stringify(realSpecs) ===
      JSON.stringify(['zod', './chunk-A.mjs', './side-effect.mjs', 'zod', 'zod/v4']),
    JSON.stringify(realSpecs),
  );

  // ── … and it must NOT fabricate them out of prose or lookalikes ──────────
  // The first case is REAL text from dist/index.mjs: a documentation string that
  // contains a complete import statement. A naive grep reports it as a link.
  const ghost = [
    `const doc = { reason: "pins the shape against \\\`import type { X } from '@objectstack/spec/ui'\\\` as intentional" };`,
    `// import { z } from 'zod';`,
    `/* import { z } from 'zod'; */`,
    `const chars = Array.from('abcdef');`,
    `const buf = Buffer.from('AAAA');`,
    `const cfg = { from: 'zod' };`,
  ].join('\n');
  const ghostSpecs = specifiersOf(ghost).map((s) => s.spec);
  check(
    'reports nothing for prose, commented-out imports, Array.from/Buffer.from and a `from:` key',
    ghostSpecs.length === 0,
    JSON.stringify(ghostSpecs),
  );

  // ── The walk: transitive over relative hops, both verdicts ───────────────
  const tmp = mkdtempSync(join(tmpdir(), 'os-browser-reachable-'));
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(join(dist, 'clean'), { recursive: true });
    mkdirSync(join(dist, 'dirty'), { recursive: true });

    // Clean entry → chunk → chunk, no zod anywhere.
    writeFileSync(join(dist, 'clean', 'index.mjs'), `export { a } from '../chunk-clean.mjs';\n`);
    writeFileSync(join(dist, 'chunk-clean.mjs'), `export { a } from './chunk-leaf.mjs';\n`);
    writeFileSync(join(dist, 'chunk-leaf.mjs'), `export const a = 1;\n`);

    const clean = walkBundle(tmp, join(dist, 'clean', 'index.mjs'));
    check(
      'walks a relative chunk chain to its leaf',
      clean.files.length === 3 && clean.externals.size === 0 && clean.unresolved.length === 0,
      `files=${clean.files.length} externals=${clean.externals.size}`,
    );

    // Dirty entry: zod is TWO relative hops away — invisible to a one-file scan.
    writeFileSync(join(dist, 'dirty', 'index.mjs'), `export { b } from '../chunk-dirty.mjs';\n`);
    writeFileSync(join(dist, 'chunk-dirty.mjs'), `export { b } from './chunk-zod.mjs';\n`);
    writeFileSync(join(dist, 'chunk-zod.mjs'), `import { z } from 'zod';\nexport const b = z;\n`);

    const dirty = walkBundle(tmp, join(dist, 'dirty', 'index.mjs'));
    check(
      'finds a zod link reached through two relative hops',
      [...dirty.externals.keys()].some(isZodSpecifier),
      JSON.stringify([...dirty.externals.keys()]),
    );
    check(
      'a one-file scan would have MISSED it (this is why the walk is transitive)',
      specifiersOf(readFileSync(join(dist, 'dirty', 'index.mjs'), 'utf8')).every(
        (s) => !isZodSpecifier(s.spec),
      ),
    );

    // An unresolvable relative hop is an ERROR, never a silent skip.
    writeFileSync(join(dist, 'clean', 'broken.mjs'), `export { c } from './gone.mjs';\n`);
    const broken = walkBundle(tmp, join(dist, 'clean', 'broken.mjs'));
    check(
      'reports an unresolvable relative hop instead of walking past it',
      broken.unresolved.length === 1 && broken.unresolved[0]!.spec === './gone.mjs',
      JSON.stringify(broken.unresolved),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── The refusal: an unbuilt or stale tree is NOT MEASURED ────────────────
  // Driven here rather than against this workspace, because the only way to
  // observe the refusal on the real tree is to break the real tree. Both
  // verdicts are pinned: a guard only ever seen green cannot be told apart from
  // one that matches nothing.
  const fresh = mkdtempSync(join(tmpdir(), 'os-browser-reachable-fresh-'));
  try {
    mkdirSync(join(fresh, 'src'), { recursive: true });
    writeFileSync(join(fresh, 'src', 'a.ts'), 'export const a = 1;\n');

    const missing = inspectBundleFreshness(fresh, 'check', RERUN);
    check(
      'refuses an UNBUILT package rather than reporting it clean',
      !missing.fresh && missing.state === 'missing',
      JSON.stringify(missing),
    );

    // A bundle older than the source it claims to describe.
    mkdirSync(join(fresh, 'dist'), { recursive: true });
    writeFileSync(join(fresh, 'dist', 'index.mjs'), 'export const a = 1;\n');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(fresh, 'dist', 'index.mjs'), past, past);

    const stale = inspectBundleFreshness(fresh, 'check', RERUN);
    check(
      'refuses a STALE build rather than answering about it',
      !stale.fresh && stale.state === 'stale',
      JSON.stringify(stale),
    );

    // …and passes once the bundle is the newer of the two.
    const now = new Date();
    utimesSync(join(fresh, 'dist', 'index.mjs'), now, now);
    check('accepts a build newer than its sources', inspectBundleFreshness(fresh, 'check', RERUN).fresh);

    // The bundler config is an input too: editing it without rebuilding must
    // read as stale, because it decides the entries and the externals.
    const later = new Date(Date.now() + 60_000);
    writeFileSync(join(fresh, 'tsup.config.ts'), 'export default {};\n');
    utimesSync(join(fresh, 'tsup.config.ts'), later, later);
    check(
      'an edited-but-unbuilt tsup.config.ts reads as stale',
      !inspectBundleFreshness(fresh, 'check', RERUN).fresh,
    );
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }

  // ── The reconciliation: both directions ──────────────────────────────────
  const emptyLedger = (): Ledger => ({ browserReachable: {}, unjudged: [], notAModule: [] });

  let problems: string[] = [];
  reconcile({ '.': {}, './new': {} }, { ...emptyLedger(), unjudged: ['.'] }, problems);
  check(
    'fails an exports-map entry that no section classifies',
    problems.length === 1 && problems[0]!.includes(`'./new'`),
    JSON.stringify(problems),
  );

  problems = [];
  reconcile({ '.': {} }, { ...emptyLedger(), unjudged: ['.', './gone'] }, problems);
  check(
    'fails a ledger row for a subpath the exports map no longer publishes',
    problems.length === 1 && problems[0]!.includes(`'./gone'`),
    JSON.stringify(problems),
  );

  problems = [];
  reconcile(
    { '.': {} },
    { browserReachable: { '.': { why: 'x', externals: [] } }, unjudged: ['.'], notAModule: [] },
    problems,
  );
  check(
    'fails a subpath classified in two sections at once',
    problems.length === 1 && problems[0]!.includes('classified twice'),
    JSON.stringify(problems),
  );

  problems = [];
  reconcile({ '.': {}, './x.json': {} }, { ...emptyLedger(), unjudged: ['.'], notAModule: ['./x.json'] }, problems);
  check('accepts a fully classified exports map', problems.length === 0, JSON.stringify(problems));

  // ── Target resolution reads BOTH conditions ──────────────────────────────
  const targets = targetsOf({
    import: { types: './dist/x/index.d.mts', default: './dist/x/index.mjs' },
    require: { types: './dist/x/index.d.ts', default: './dist/x/index.js' },
  });
  check(
    'scans the import AND require halves of one subpath',
    JSON.stringify(targets) === JSON.stringify(['./dist/x/index.mjs', './dist/x/index.js']),
    JSON.stringify(targets),
  );

  if (failures.length) {
    console.error(`\n✗ self-test: ${failures.length} case(s) failed.`);
    process.exit(1);
  }
  console.log('✅  self-test: scanner, transitive walk and ledger reconciliation all behave.');
  process.exit(0);
}

if (SELF_TEST) selfTest();
audit();
