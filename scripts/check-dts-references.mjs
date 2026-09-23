#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-dts-references -- run as a build step, immediately AFTER
// `check-dts-emitted.mjs`: every declaration file this build emitted must be
// able to REACH every declaration file it refers to.
//
//   node ../../scripts/check-dts-references.mjs     # from the package directory
//   node scripts/check-dts-references.mjs --self-test
//
// ---------------------------------------------------------------------------
// THE SEAM IT EXISTS TO CLOSE (#19402)
//
// Two guards stand on either side of this question and each is correct on its
// own terms, which is why neither answers it:
//
//   `check-dts-emitted.mjs` asks: are the declaration paths the MANIFEST
//   promises a consumer on disk? Its docblock declares that scope deliberately
//   -- "a file the manifest never names is not this guard's business" -- and its
//   output is scoped to match ("34/34 declared declaration file(s) present").
//
//   `distIsStale()` (scripts/check-regen-pending.mjs) asks: are the build
//   INPUTS newer than the dist? It says so, and answers only that.
//
// Nothing asked: DID THIS BUILD EMIT EVERYTHING IT WAS SUPPOSED TO EMIT?
//
// A declaration pass emits one file per ENTRY plus a set of shared CHUNKS, and
// the entries import the chunks. A pass that emits every entry and only some
// chunks satisfies both guards above and is broken. Measured on `origin/main`
// (2026-09-20T16:23Z, recorded on #19402) with 2 of the emitted chunk
// declarations moved aside:
//
//   node scripts/check-dts-emitted.mjs   exit 0, "34/34 declared ... present"
//   distIsStale()                        false    declarationStamp()  match
//   pnpm --filter @objectstack/spec check:api-surface
//                                        exit 1, "70 breaking (removed/narrowed)"
//   => `check:generated --fix` on that tree would delete 64 live exports from
//      the committed baseline under one `✓ gen:api-surface`.
//
// The producers are ordinary, not contrived: an interrupted or killed DTS pass
// (the pass runs separately from the JS pass, and the build stamp is written by
// the build script's LAST step, so an interruption leaves fresh dist mtimes and
// the PREVIOUS build's stamp), a partially emitted chunk set, a hand-edit or a
// partial restore of `dist`.
//
// ## Why the answer is read off the EMISSION and not off a count
//
// "There should be 46 chunks" is a constant that is wrong on the next release,
// and a constant nobody can re-derive is the next card rather than a fix. The
// emitted declarations already carry the answer: rollup-dts writes each chunk
// reference into the file that needs it, as an ordinary relative module
// specifier (`import { X } from './view.zod-CIU5lVgU.js'`). So the set of files
// this build was supposed to emit is the TRANSITIVE CLOSURE of the relative
// references reachable from the manifest-declared declarations -- derived from
// the run, on every run, with no number to maintain.
//
// Measured on packages/spec at `a0e62e69` (2026-09-20T19:09Z): 34 declared
// roots reach a closure of 124 declaration files, and `dist/**` holds exactly
// 124 -- 0 emitted declarations outside the closure. So on this package the
// closure is not a sample of the emission, it IS the emission.
//
// ## Why not tsup's own emission record
//
// Because there is not one. Measured on the installed tsup 8.5.1: `metafile`
// occurs 0 times in `dist/rollup.js`, the DTS worker (lit control on the same
// grep over the same file: 16 `rollup`, 45 `dts`); it is an esbuild-only option
// written from `result.metafile` on the JS side. And a record the DTS pass
// wrote would be evidence from the pass whose message-less death (#11907) is
// the failure being guarded -- a run that stops mid-emission does not write its
// own closing record either.
//
// ## Why not the build's last step (`check-dev-prereqs.mjs --stamp`)
//
// Measured on this tree: 68 package build scripts run `check-dts-emitted.mjs`;
// exactly 4 of them are freshness AMPLIFIERS, the only packages where `--stamp`
// runs at all, and 12 of the 68 declare more than one entry point (the
// chunk-capable set). So the stamp's population is the wrong one by measurement
// and not by taste. It is also the wrong SUBJECT: `--stamp` records which
// INPUTS a dist was built from, and answering an emission question with an
// input digest is #7122's rejected direction one artifact over.
//
// ## Why a build STEP and not the post-build sweep next door
//
// `check-dts-closure.mjs` sweeps the built workspace after the closure build
// and shares `check-dts-emitted.mjs`'s manifest criterion, so it is blind to
// chunks in the same way and at a later instant. Later is too late for the
// reason #11907 recorded: turbo caches only SUCCESSFUL tasks, so a build that
// exits non-zero never becomes a cache entry, while a build that exits 0 over a
// partial emission is cached under the ordinary hash and replayed by every
// later run in that worktree. The verdict has to land inside the build.
//
// ## What this guard does NOT claim
//
// ⛔ It does not re-run TypeScript's module resolution and does not assert that
// `tsc` would pick the file found here -- that is `tsc`'s job and the built
// surface already has readers (`typecheck`, `check:api-surface`). The claim is
// exactly: every relative reference an emitted declaration writes resolves to a
// non-empty declaration file on disk.
// ⛔ It says nothing about freshness, about the JS bundles, or about
// declarations the manifest never names (0 of those on packages/spec today, and
// the count is printed every run rather than assumed).
// ⛔ It is not a second opinion on the manifest surface: a missing DECLARED
// root is `check-dts-emitted.mjs`'s verdict, which runs before this in the same
// `&&` chain.
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

import { declaredDeclarationPaths, missingDeclarations } from './check-dts-emitted.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const SELF = 'scripts/check-dts-references.mjs';

/** Every declaration extension a reference can land on. */
const DECLARATION_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts'];

/**
 * The declaration file(s) a relative module specifier can name.
 *
 * This is TypeScript's own output-to-declaration mapping and nothing wider:
 * `./x.js` -> `./x.d.ts`, `./x.mjs` -> `./x.d.mts`, `./x.cjs` -> `./x.d.cts`,
 * a declaration spelled outright names itself. Only an EXTENSIONLESS specifier
 * gets a list, because there is no twin to derive from it.
 *
 * ⛔ The cross-extension fallback is deliberately absent, and it is the one
 * mistake worth naming here: a build emits `x.d.ts` and `x.d.mts` from one
 * chunk, so a rule that let `./x.js` settle for `x.d.mts` would be satisfied by
 * a tree that lost every `.d.ts` chunk and kept every `.d.mts` one -- which is
 * the shape #19402 actually measured (2 chunk declarations moved aside, both
 * guards green). Generosity there reads as tolerance and is blindness.
 *
 * When nothing matches, the report prints every path tried, so a spelling this
 * file has not met is diagnosable rather than mysterious.
 */
export function referenceCandidates(fromRel, specifier) {
  const dir = path.posix.dirname(fromRel);
  const join = (s) => path.posix.normalize(path.posix.join(dir, s));

  if (/\.d\.[cm]?ts$/.test(specifier)) return [join(specifier)];
  if (specifier.endsWith('.mjs')) return [join(`${specifier.slice(0, -4)}.d.mts`)];
  if (specifier.endsWith('.cjs')) return [join(`${specifier.slice(0, -4)}.d.cts`)];
  if (/\.[jt]sx?$/.test(specifier)) return [join(specifier.replace(/\.[jt]sx?$/, '.d.ts'))];

  return [
    ...DECLARATION_EXTENSIONS.map((ext) => join(`${specifier}${ext}`)),
    ...DECLARATION_EXTENSIONS.map((ext) => join(`${specifier}/index${ext}`)),
  ];
}

/**
 * Every relative module specifier an emitted declaration writes.
 *
 * Parsed through `scripts/ts-parse.mjs`, the one sanctioned parse entry point
 * under `scripts/**`, for a reason this guard depends on: `ts.createSourceFile`
 * never throws, so a TRUNCATED declaration -- the other shape a half-finished
 * emission leaves -- would hand back a tree missing the references in the part
 * that never arrived, and this guard would score it clean. `parseSourceFile`
 * refuses instead, and the refusal names the file.
 *
 * ⛔ Reading the text with a regex is the shape that cannot be right here:
 * measured on packages/spec's own dist, TSDoc prose carries 4 relative
 * specifiers (`{@link import('../contracts/data-driver').DriverQuery}` and a
 * fenced `import { Task } from '../objects/task.object';`) that name files no
 * build was ever supposed to emit. A scan that reads comments reports those as
 * a partial emission on a perfectly healthy build.
 *
 * All six specifier-bearing positions are collected, not only the two this tree
 * currently emits (measured on packages/spec: 318 ImportDeclaration, 164
 * ExportDeclaration, 0 of the rest) -- the per-kind tally is printed on every
 * run, so "we only ever see two kinds" stays a reading rather than a belief.
 */
export function declarationReferences(fileName, text) {
  const sourceFile = parseSourceFile(fileName, text);
  const found = [];
  const kinds = new Map();
  const record = (kind, node) => {
    if (!node || !ts.isStringLiteral(node)) return;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    found.push({ kind, specifier: node.text });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) record('import', node.moduleSpecifier);
    else if (ts.isExportDeclaration(node)) record('export', node.moduleSpecifier);
    else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (arg && ts.isLiteralTypeNode(arg)) record('import-type', arg.literal);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record('import-equals', node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      record('dynamic-import', node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  for (const ref of sourceFile.referencedFiles ?? []) {
    kinds.set('triple-slash-path', (kinds.get('triple-slash-path') ?? 0) + 1);
    found.push({ kind: 'triple-slash-path', specifier: ref.fileName });
  }

  return { references: found, kinds };
}

/**
 * Walk the declaration graph from `roots` and report what it cannot reach.
 *
 * IO arrives as two functions so the self-test drives the real traversal, and
 * so this function has no opinion about where a package lives.
 *
 * @param {object} io
 * @param {string[]} io.roots package-relative declaration paths to seed from
 * @param {(rel: string) => (number|null)} io.sizeOf bytes, or null when absent
 * @param {(rel: string) => string} io.readText file contents
 */
export function walkDeclarationGraph({ roots, sizeOf, readText }) {
  const reached = [];
  const seen = new Set();
  const queue = [...roots];
  const findings = [];
  const kinds = new Map();
  let relative = 0;
  let bare = 0;

  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);

    const size = sizeOf(rel);
    if (size === null || size === 0) {
      // A seeded ROOT that is absent belongs to `check-dts-emitted.mjs`; it is
      // still reported here rather than skipped, because a guard run on its own
      // that stayed quiet about a missing root would be reporting a closure it
      // never walked.
      findings.push({ from: '(package.json)', specifier: rel, why: size === null ? 'missing' : 'empty', tried: [rel] });
      continue;
    }
    reached.push(rel);

    const { references, kinds: fileKinds } = declarationReferences(rel, readText(rel));
    for (const [k, n] of fileKinds) kinds.set(k, (kinds.get(k) ?? 0) + n);

    for (const { specifier } of references) {
      if (!specifier.startsWith('.')) {
        bare += 1;
        continue;
      }
      relative += 1;
      const tried = referenceCandidates(rel, specifier);
      const hit = tried.find((c) => (sizeOf(c) ?? 0) > 0);
      if (hit === undefined) {
        const present = tried.find((c) => sizeOf(c) === 0);
        findings.push({ from: rel, specifier, why: present === undefined ? 'missing' : 'empty', tried });
        continue;
      }
      if (!seen.has(hit)) queue.push(hit);
    }
  }

  reached.sort();
  findings.sort((a, b) => `${a.from}|${a.specifier}`.localeCompare(`${b.from}|${b.specifier}`));
  return { reached, findings, kinds, references: { relative, bare } };
}

/** Bytes on disk for a package-relative path; `null` for anything not a file. */
export function sizeOnDisk(packageDir) {
  return (rel) => {
    try {
      const s = statSync(path.resolve(packageDir, rel));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  };
}

/** The finding report, returned as a value so the self-test can read it. */
export function findingsText(name, result) {
  const lines = [
    `\nx ${name}: the declaration pass finished but did NOT emit everything it emitted references TO.\n`,
  ];
  for (const f of result.findings) {
    lines.push(`    ${f.why.padEnd(7)} ${f.specifier}`);
    lines.push(`            referenced by  ${f.from}`);
    lines.push(`            looked for     ${f.tried.join('  ')}`);
  }
  lines.push(
    '',
    '  Declarations are emitted one file per ENTRY plus shared CHUNKS, and the entries',
    '  import the chunks. Every path above is one this build WROTE INTO A FILE IT EMITTED',
    '  and then did not put on disk, so the emission is partial.',
    '',
    '  Why the guards either side of this one are quiet about it, and are right to be:',
    '    · scripts/check-dts-emitted.mjs asks only about the paths package.json promises a',
    '      consumer, and those can all be present while the chunks under them are not;',
    '    · distIsStale() asks whether the build INPUTS are newer than the dist, and after a',
    '      partial pass they are not.',
    '  Neither is broken. This is the reading between them.',
    '',
    '  What it costs to ignore: the entry declarations are the file `check:api-surface` and',
    '  every consumer read, and with a chunk missing they resolve to a fraction of the',
    '  package. On the measurement this guard was written for (#19402), 2 missing chunk',
    '  declarations turned into 70 breaking removals — and a `check:generated --fix` on that',
    '  tree would have deleted 64 live exports from the committed baseline.',
    '',
    '  Most likely cause: a declaration pass that did not finish. It is separate from the JS',
    '  pass, so an interrupted or killed build leaves the JS outputs, some declarations, and',
    '  a dist whose mtimes all look fresh. Rebuild it, from a clean dist:',
    '',
    `      pnpm --filter ${name} build`,
    '',
    '  If a full rebuild reproduces this, the pass is emitting a reference it never resolves',
    '  — read what the DTS pass printed, and ⛔ do not "fix" it by deleting the reference or',
    '  by narrowing package.json: both move the breakage to the consumer and hide it here.',
    '',
  );
  return lines.join('\n');
}

export function run(dir) {
  // `OS_SKIP_DTS` set means the declarations are absent ON PURPOSE, and that
  // run hashes differently in turbo, so its artifact cannot be served to a run
  // that wants declarations. Same stand-down as the guard before it.
  if (process.env.OS_SKIP_DTS) {
    console.log('check-dts-references: OS_SKIP_DTS is set - declarations skipped by request, not checked.');
    return 0;
  }

  let manifest;
  const manifestPath = path.resolve(dir, 'package.json');
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`\nx check-dts-references: cannot read ${manifestPath}: ${err.message}`);
    console.error("  This runs from the package directory, as a step of that package's build.\n");
    return 1;
  }

  const name = typeof manifest.name === 'string' ? manifest.name : path.basename(dir);
  const roots = declaredDeclarationPaths(manifest);
  if (roots.length === 0) {
    console.log(`check-dts-references: ${name} declares no declaration entry points - nothing to walk.`);
    return 0;
  }

  const sizeOf = sizeOnDisk(dir);
  const result = walkDeclarationGraph({
    roots,
    sizeOf,
    readText: (rel) => readFileSync(path.resolve(dir, rel), 'utf8'),
  });

  if (result.findings.length > 0) {
    console.error(findingsText(name, result));
    return 1;
  }

  const kinds = [...result.kinds].sort().map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
  console.log(
    `check-dts-references: ${name} - ${result.reached.length} declaration file(s) reachable from ` +
      `${roots.length} declared entry point(s); ${result.references.relative}/${result.references.relative} ` +
      `relative reference(s) resolved (${result.references.bare} bare specifier(s) are not this guard's ` +
      `business). Positions read: ${kinds}.`,
  );
  return 0;
}

// --- self-test ------------------------------------------------------------
// The two directions this guard can be wrong in are both silent: over-matching
// reds every healthy build, under-matching waves the partial emission through
// -- the exact artifact #19402 measured. Both get asserted, against real files
// in a temp directory rather than an injected filesystem, because the traversal
// and the parse are the parts that can be wrong.

const SELF_TEST_BATTERIES = Object.freeze({
  'candidate derivation': 7,
  'the walk, over real declaration files': 11,
  'prose is not a reference': 2,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 3;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 -- a self-test that never finished, reported as one that
// passed (#13798).
let selfTestReachedVerdict = false;

function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const failures = [];
  const eq = (label, actual, expected) => {
    registerCase();
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
  };
  const ok = (label, condition) => eq(label, condition === true, true);

  battery('candidate derivation');
  eq(
    'a `.js` specifier looks for the `.d.ts` twin FIRST',
    referenceCandidates('dist/index.d.ts', './view.zod-CIU5lVgU.js')[0],
    'dist/view.zod-CIU5lVgU.d.ts',
  );
  eq(
    'a `.mjs` specifier looks for the `.d.mts` twin FIRST',
    referenceCandidates('dist/index.d.mts', './view.zod-CIU5lVgU.mjs')[0],
    'dist/view.zod-CIU5lVgU.d.mts',
  );
  eq('a `.cjs` specifier looks for the `.d.cts` twin FIRST', referenceCandidates('dist/index.d.cts', './x.cjs')[0], 'dist/x.d.cts');
  eq(
    'a `.js` specifier does NOT settle for the `.d.mts` sibling — that is the #19402 shape',
    referenceCandidates('dist/index.d.ts', './chunk-AAA.js'),
    ['dist/chunk-AAA.d.ts'],
  );
  eq('a parent-relative specifier resolves against the referrer, not the package root',
    referenceCandidates('dist/data/index.d.ts', '../data-engine.zod-QSPoVoMp.js')[0], 'dist/data-engine.zod-QSPoVoMp.d.ts');
  eq('a declaration specifier names itself', referenceCandidates('dist/index.d.ts', './chunk.d.ts')[0], 'dist/chunk.d.ts');
  ok(
    'an extensionless specifier still offers the directory-index forms',
    referenceCandidates('dist/index.d.ts', './sub').includes('dist/sub/index.d.ts'),
  );

  battery('the walk, over real declaration files');
  const scratch = mkdtempSync(path.join(tmpdir(), 'dts-references-'));
  try {
    /** Build a fixture package dist: `{ '<rel>': '<contents>' }`. */
    const fixture = (name, files) => {
      const dir = path.join(scratch, name);
      for (const [rel, contents] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, contents);
      }
      return dir;
    };
    const walk = (dir, roots) =>
      walkDeclarationGraph({
        roots,
        sizeOf: sizeOnDisk(dir),
        readText: (rel) => readFileSync(path.join(dir, rel), 'utf8'),
      });

    // The healthy shape, in the spelling rollup-dts really emits: two entries
    // over one shared chunk, in both module formats.
    const healthy = {
      'dist/index.d.ts': "import { A } from './chunk-AAA.js';\nexport { A };\nexport * from './chunk-BBB.js';\n",
      'dist/index.d.mts': "import { A } from './chunk-AAA.mjs';\nexport { A };\nexport * from './chunk-BBB.mjs';\n",
      'dist/data/index.d.ts': "export { A } from '../chunk-AAA.js';\n",
      'dist/chunk-AAA.d.ts': 'export declare const A: number;\n',
      'dist/chunk-AAA.d.mts': 'export declare const A: number;\n',
      'dist/chunk-BBB.d.ts': 'export declare const B: number;\n',
      'dist/chunk-BBB.d.mts': 'export declare const B: number;\n',
    };
    const ROOTS = ['dist/index.d.ts', 'dist/index.d.mts', 'dist/data/index.d.ts'];

    const green = walk(fixture('healthy', healthy), ROOTS);
    eq('a complete emission produces NO findings', green.findings, []);
    eq('and the closure is the whole emission, reported as what it reached', green.reached.length, 7);
    eq('every relative reference is counted and resolved', [green.references.relative, green.references.bare], [5, 0]);

    // THE LOAD-BEARING DIRECTION: the #19402 artifact. Every DECLARED entry is
    // present -- `check-dts-emitted.mjs` is satisfied -- and a chunk is gone.
    const partial = { ...healthy };
    delete partial['dist/chunk-AAA.d.ts'];
    const red = walk(fixture('partial', partial), ROOTS);
    eq(
      'REJECTS the #19402 artifact: every declared entry present, a chunk missing',
      red.findings.map((f) => `${f.why}:${f.specifier}<-${f.from}`),
      ['missing:../chunk-AAA.js<-dist/data/index.d.ts', 'missing:./chunk-AAA.js<-dist/index.d.ts'],
    );
    ok('the report NAMES the referrer', findingsText('@fixture/spec', red).includes('dist/data/index.d.ts'));
    ok('the report NAMES every path it looked for', findingsText('@fixture/spec', red).includes('dist/chunk-AAA.d.ts'));
    // The sibling guard's own criterion is untouched by that tree: this is the
    // gap, stated as an assertion rather than as prose.
    eq(
      'the manifest-declared criterion is SATISFIED by the same tree -- that is the gap',
      missingDeclarations(ROOTS, sizeOnDisk(fixture('partial-2', partial))),
      [],
    );

    // A zero-byte chunk is present and useless -- the same verdict the sibling
    // guard gives a zero-byte declared file.
    const emptied = { ...healthy, 'dist/chunk-BBB.d.ts': '' };
    eq(
      'a zero-byte chunk reds as `empty`, not as present',
      walk(fixture('emptied', emptied), ROOTS).findings.map((f) => `${f.why}:${f.specifier}`),
      ['empty:./chunk-BBB.js'],
    );

    // A missing ROOT is reported too: a run that stayed quiet about it would be
    // claiming a closure it never walked.
    const noRoot = { ...healthy };
    delete noRoot['dist/data/index.d.ts'];
    eq(
      'a missing declared root is named, attributed to the manifest',
      walk(fixture('no-root', noRoot), ROOTS).findings.map((f) => `${f.why}:${f.specifier}<-${f.from}`),
      ['missing:dist/data/index.d.ts<-(package.json)'],
    );

    // Bare specifiers are somebody else's business and must not be chased.
    const withBare = { ...healthy, 'dist/chunk-BBB.d.ts': "import { z } from 'zod';\nexport declare const B: z.ZodString;\n" };
    const bare = walk(fixture('bare', withBare), ROOTS);
    eq('a bare specifier is counted, never resolved', [bare.findings.length, bare.references.bare], [0, 1]);

    // The cycle rollup-dts really produces (two chunks importing each other)
    // must terminate rather than re-queue forever.
    const cyclic = {
      'dist/index.d.ts': "export * from './a.js';\n",
      'dist/a.d.ts': "import { B } from './b.js';\nexport declare const A: typeof B;\n",
      'dist/b.d.ts': "import { A } from './a.js';\nexport declare const B: typeof A;\n",
    };
    eq('a reference cycle terminates and reaches both chunks', walk(fixture('cyclic', cyclic), ['dist/index.d.ts']).reached, [
      'dist/a.d.ts',
      'dist/b.d.ts',
      'dist/index.d.ts',
    ]);

    battery('prose is not a reference');
    // Measured on packages/spec's own dist: TSDoc carries relative specifiers
    // naming files no build ever emits. A text scan reports a healthy build as
    // a partial emission; the parse is what makes the difference.
    const prose = {
      'dist/index.d.ts':
        "/**\n * See {@link import('../contracts/data-driver').DriverQuery}.\n *\n * @example\n * import { Task } from '../objects/task.object';\n */\nexport declare const A: number;\n",
    };
    const prosed = walk(fixture('prose', prose), ['dist/index.d.ts']);
    eq('a specifier that appears only in a comment is NOT a reference', prosed.findings, []);
    eq('and it is not counted as one either', prosed.references.relative, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    failures.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  if (failures.length > 0) {
    console.error(`\nx check-dts-references self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    return 1;
  }
  console.log('check-dts-references self-test: all assertions passed.');
  selfTestReachedVerdict = true;
  return 0;
}

// Behind the entrypoint guard, for the reason the sibling guards state: an
// unguarded `process.exit` here would end any importer mid-import -- with
// status 0 on the healthy path, so the importer would read it as success.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-dts-references self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(run(process.cwd()));
}
