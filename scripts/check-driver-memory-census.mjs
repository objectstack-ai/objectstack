#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-driver-memory-census -- every DECLARATION of `@objectstack/driver-memory`
// in this repo must be disposed of in writing, and the ruled test consumers must
// still carry the ruling that keeps them (#6664, from #5704 / #5499).
//
//   node scripts/check-driver-memory-census.mjs
//   node scripts/check-driver-memory-census.mjs --list       # print the whole census
//   node scripts/check-driver-memory-census.mjs --self-test  # verify the checker itself
//
// ## The failure mode this exists for
//
// #5499 froze INVESTMENT in `@objectstack/driver-memory`; #5704 migrated the
// project's test backends to sqlite `:memory:` and ruled (Q2 = B, maintainer
// 2026-08-06) that ONE test file keeps the driver on purpose, as the schemaless
// arm of a cross-family divergence pin. Nothing gates that programme. Its
// enforcement was a PROSE CENSUS: a sentence in the ruled file saying it was the
// only permanent test consumer in the repository, backed by #5704/#5784 renaming
// every look-alike local stub to `makeStubDriver` so that grepping for the driver
// would land on real consumers only.
//
// A grep is a fine handle. A sentence describing what the grep should find is
// not: it is a hand-maintained count with no second party, and it expired
// silently the first time the hand-edit step was skipped. #6468 (PR #6553) added
// `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`,
// which imports the driver for a reason that reads exactly as permanent as the
// ruled file's -- after #5704's survey, with no ruling block, and named nowhere
// in the census it invalidated. Two concrete ways that misleads, both recorded
// on #6664: an agent verifying "the retirement is complete" reads "only here" and
// deletes the OTHER file's schemaless arm; or takes the second file as implicitly
// covered and stops looking, so a THIRD arrival is never disposed of either.
//
// So the census stops being prose and becomes this ledger + this gate. The gate
// polices the RETIREMENT PROGRAMME's bookkeeping; it is not investment in the
// driver, which stays frozen under #5499.
//
// ## What counts as a DECLARATION
//
// Two axes, both named by the maintainer's ruling on #6664:
//
//   TS bindings      a module-binding position naming the package in a tracked
//                    `*.ts` / `*.tsx` / `*.mts` / `*.cts` file: `import ... from`,
//                    `export ... from`, `await import()`, `import()` in type
//                    position, `require()`, and `vi.mock()` / `jest.mock()`.
//   Manifests        a `dependencies` / `devDependencies` / `peerDependencies` /
//                    `optionalDependencies` entry in a tracked `package.json`.
//
// `vi.mock` is ledgered even though it REPLACES the module rather than consuming
// it. Two reasons, and neither is tidiness: a scanner that silently skipped some
// positions would carry an unstated exclusion (the thing this gate replaces was
// exactly an unstated claim), and `vi.mock('X', async (importOriginal) => ...)`
// does reach the real module, so "a mock never consumes it" is not true in
// general. Ledgering them costs five lines and makes the census output the
// complete answer to "who names this package", which is the handle #6664 says
// was missing.
//
// ## Why AST, not a regex over the specifier
//
// The distinction the census has always drawn is DECLARATIONS vs MENTIONS: the
// ruled file's own comment block names the package five times, `.changeset/**`
// names it in dozens of published notes, and `packages/runtime/tsup.config.ts`
// carries it as a bare string in a bundler externals array. None of those binds
// the module. A textual grep cannot separate them, so it either drowns the
// signal or needs an exclusion list nobody can audit. Object structure decides
// this, so the checker reads structure -- and prints the string literals that
// NAME the package but sit outside a binding position under `--list` as context,
// never as findings. (A literal that merely CONTAINS the name inside a longer
// sentence -- `'... @objectstack/driver-memory not installed'` in plugin-dev's
// warning -- is prose in a string, and is not read at all.)
//
// ## Invariants
//
//   DISCOVERED  the scan found at least one binding. Zero is not a clean repo,
//               it is a broken scan: every other invariant iterates this set, so
//               a discovery that quietly stopped matching would print OK while
//               reading nothing (the #4868 family).
//   LEDGERED    every discovered binding and manifest declaration has a ledger
//               entry, and the entry's `kind` / `field` matches what was found.
//               An unledgered arrival is the #6664 defect itself.
//   LIVE        every ledger entry still resolves to something the scan found.
//               A migrated consumer must lose its entry in the same PR, or the
//               ledger becomes the next stale census.
//   RULED       every `ruledConsumers` entry is a static `import` whose file
//               still contains each of its `rulingMarkers`. The ruling block IS
//               the disposition record; deleting it while the entry stays would
//               leave the driver in a file nothing explains.
//   CENSUS      every ruled file states the ruled COUNT verbatim, in the marker
//               this gate derives from the ledger (see `censusMarker` below).
//               This is the one invariant aimed straight at #6664: the census
//               sentence and the ruled set can no longer drift apart, because
//               changing the set makes both files' sentences fail until they are
//               rewritten.
//
// ## What it deliberately does NOT do
//
// It does not judge whether a declaration SHOULD exist. "Is this consumer
// legitimate?" is a maintainer ruling (#5704 Q2, #6664 A) and this gate is the
// bookkeeping under it, not a second opinion on it. It forbids exactly one
// thing: a declaration nobody has written a disposition for. There is also no
// `--fix` / `--update` flag, for the reason `engine-double-contract.baseline.json`
// states for itself -- a generator would let a new arrival be admitted by
// "just run the update command", which is precisely how a ledger stops meaning
// anything.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = join(ROOT, 'scripts', 'driver-memory-census.ledger.json');

/** The package the retirement programme is about. */
const SPECIFIER = '@objectstack/driver-memory';

/** Manifest fields that DECLARE a dependency (a `name` field does not). */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Binding kinds a ledger entry may claim. `string-literal` is context, never gated. */
const BINDING_KINDS = ['import', 'export-from', 'dynamic-import', 'import-type', 'require', 'mock'];

/**
 * The disposition vocabulary. Closed on purpose: a free-text axis would let the
 * next arrival be waved through with a word nobody has to defend.
 */
const AXES = {
  'ruled-permanent':
    'a test consumer a maintainer ruled stays (the #5704 Q2=B family) — its arm is structural, not a migration leftover',
  'product-consumer':
    'shipped code that resolves the driver at run time. #5704 carved these out of the migration surface by name: they belong to the package-retirement decision (#5499), not to the test-backend programme',
  'published-example':
    'an example whose SUBJECT is the driver — demonstrating a shipped package is not a test consumer of it',
  'mock-replacement':
    'a `vi.mock` factory that REPLACES the module; the real driver is never loaded here',
  'ruled-consequence':
    'a manifest declaration that exists because of a ruling above — it goes when the last consumer it serves goes, not before',
};

// ── The census marker ───────────────────────────────────────────────────────
//
// Derived from the ledger rather than written down twice, so the sentence in the
// ruled files cannot outlive the set it describes. The whole of #6664 is that
// this number was hand-maintained and expired without anyone noticing.
const censusMarker = (n) => `#6664 census: ${n} ruled consumer${n === 1 ? '' : 's'}`;

// ── File discovery ──────────────────────────────────────────────────────────

const TS_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.turbo', 'coverage', '.next']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TS_EXT.test(e.name) || e.name === 'package.json') out.push(relative(ROOT, p));
  }
  return out;
}

/**
 * Tracked files, per the ruling's wording ("tracked `*.ts` plus `package.json`").
 * git is authoritative because it excludes build output and local scratch without
 * an ignore list of our own; the walk is a fallback for a checkout that is not a
 * git repository (a published tarball, an unpacked source archive) so the gate
 * degrades to "scans more" rather than to "scans nothing".
 */
function candidateFiles() {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', 'package.json', '*/package.json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    files = walk(ROOT);
  }
  return files.map((f) => f.split(sep).join('/')).sort();
}

// ── Scanning ────────────────────────────────────────────────────────────────

const namesPackage = (text) => text === SPECIFIER || text.startsWith(`${SPECIFIER}/`);

const MOCK_METHODS = new Set(['mock', 'doMock', 'unmock', 'doUnmock']);

/** `vi.mock(...)` / `jest.mock(...)` — the module-graph interception forms. */
function isMockCall(call) {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ts.isIdentifier(callee.name) || !MOCK_METHODS.has(callee.name.text)) return false;
  return ts.isIdentifier(callee.expression) && (callee.expression.text === 'vi' || callee.expression.text === 'jest');
}

/**
 * Classify one string literal that names the package by the position it sits in.
 * Everything that is not a module-binding position comes back `string-literal`:
 * a bundler externals array, a log message, a doc string. Those are MENTIONS,
 * which the census has never counted (see the header).
 */
function classify(node) {
  const parent = node.parent;
  if (!parent) return 'string-literal';
  if (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) return 'import';
  if (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) return 'export-from';
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic-import';
    if (ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return 'require';
    if (isMockCall(parent)) return 'mock';
    return 'string-literal';
  }
  // `import('@objectstack/driver-memory').InMemoryDriver` in a TYPE position:
  // StringLiteral -> LiteralTypeNode -> ImportTypeNode.
  if (ts.isLiteralTypeNode(parent) && parent.parent && ts.isImportTypeNode(parent.parent)) return 'import-type';
  return 'string-literal';
}

/** Every occurrence of the specifier in one source text, classified. */
export function scanSource(fileName, text) {
  const sf = parseSourceFile(fileName, text);
  const found = [];
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && namesPackage(node.text)) {
      found.push({
        kind: classify(node),
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        specifier: node.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Every dependency-field declaration of the specifier in one manifest object. */
export function scanManifest(json) {
  const out = [];
  for (const field of DEP_FIELDS) {
    const block = json?.[field];
    if (block && typeof block === 'object' && Object.hasOwn(block, SPECIFIER)) {
      out.push({ field, range: String(block[SPECIFIER]) });
    }
  }
  return out;
}

function scanRepo(files = candidateFiles(), read = (f) => readFileSync(join(ROOT, f), 'utf8')) {
  const bindings = [];
  const mentions = [];
  const manifests = [];

  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    if (!text.includes(SPECIFIER)) continue;

    if (file === 'package.json' || file.endsWith('/package.json')) {
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      for (const d of scanManifest(json)) manifests.push({ file, ...d });
      continue;
    }
    if (!TS_EXT.test(file)) continue;

    for (const hit of scanSource(file, text)) {
      (hit.kind === 'string-literal' ? mentions : bindings).push({ file, ...hit });
    }
  }
  return { bindings, mentions, manifests };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

function loadLedger(path = LEDGER_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Ledger shape errors are their own class: a malformed ledger gates nothing. */
function validateLedgerShape(ledger, problems) {
  const ruled = ledger.ruledConsumers ?? [];
  const other = ledger.otherDeclarations ?? [];
  const manifests = ledger.manifests ?? [];

  if (!Array.isArray(ruled) || !Array.isArray(other) || !Array.isArray(manifests)) {
    problems.push('LEDGER: `ruledConsumers`, `otherDeclarations` and `manifests` must all be arrays.');
    return { ruled: [], other: [], manifests: [] };
  }
  for (const e of ruled) {
    if (e.axis !== 'ruled-permanent') {
      problems.push(`LEDGER: ruledConsumers entry ${e.file} must carry axis 'ruled-permanent' (found '${e.axis}').`);
    }
    if (e.kind !== 'import') {
      problems.push(
        `LEDGER: ruledConsumers entry ${e.file} claims kind '${e.kind}'. A ruled consumer is a static import — `
          + 'a dynamically or conditionally bound one is a product consumer, which is a different axis.',
      );
    }
    if (!Array.isArray(e.rulingMarkers) || e.rulingMarkers.length === 0) {
      problems.push(`LEDGER: ruledConsumers entry ${e.file} must name at least one rulingMarker (the issue that ruled it).`);
    }
  }
  for (const e of [...ruled, ...other]) {
    if (!BINDING_KINDS.includes(e.kind)) {
      problems.push(`LEDGER: ${e.file} claims kind '${e.kind}', which is not one of: ${BINDING_KINDS.join(', ')}.`);
    }
  }
  for (const e of [...ruled, ...other, ...manifests]) {
    if (!Object.hasOwn(AXES, e.axis)) {
      problems.push(`LEDGER: ${e.file} claims axis '${e.axis}', which is not one of: ${Object.keys(AXES).join(', ')}.`);
    }
    if (typeof e.why !== 'string' || e.why.trim().length < 20) {
      problems.push(
        `LEDGER: ${e.file} has no usable \`why\`. An entry that records only a name is a disposition the next `
          + 'reader has to re-derive — which is the state #6664 was filed about.',
      );
    }
  }
  for (const e of manifests) {
    if (!DEP_FIELDS.includes(e.field)) {
      problems.push(`LEDGER: manifest entry ${e.file} claims field '${e.field}', which is not a dependency field.`);
    }
  }
  return { ruled, other, manifests };
}

export function reconcile(scan, ledger, read = (f) => readFileSync(join(ROOT, f), 'utf8')) {
  const problems = [];
  const { ruled, other, manifests: ledgerManifests } = validateLedgerShape(ledger, problems);
  const ledgerBindings = [...ruled, ...other];

  // DISCOVERED
  if (scan.bindings.length === 0) {
    problems.push(
      `DISCOVERED: the scan found no module binding of ${SPECIFIER} anywhere. That is not a retired driver, `
        + 'it is a broken scan — every check below iterates this set, so it would pass vacuously and this '
        + 'script would report OK while reading nothing. Fix the discovery before trusting a green run. '
        + '(If the driver really has been retired repo-wide, delete this gate and its ledger in the same PR.)',
    );
  }

  // LEDGERED — bindings
  const ledgerKey = (e) => `${e.file} ${e.kind}`;
  const ledgered = new Map(ledgerBindings.map((e) => [ledgerKey(e), e]));
  const seen = new Set();
  for (const b of scan.bindings) {
    const key = ledgerKey(b);
    seen.add(key);
    if (ledgered.has(key)) continue;
    const sameFile = ledgerBindings.filter((e) => e.file === b.file);
    problems.push(
      `LEDGERED: ${b.file}:${b.line} binds ${b.specifier} (${b.kind}) and the ledger does not cover it.`
        + (sameFile.length
          ? ` The ledger has this file as '${sameFile.map((e) => e.kind).join("', '")}' — a second binding kind is a `
            + 'separate disposition, not an extension of the first.'
          : '')
        + ' A new arrival is not a bookkeeping chore: it is the #6664 defect itself. Do NOT add an entry to make '
        + 'this green if the answer is "this should have been migrated" — take the disposition through the '
        + 'process #5704 / #6664 record (rule it, migrate it, or file it), then write down what was decided.'
        // The REASON for that refusal, in the text the author actually reads (#8576).
        // Mirrors this file's own header verbatim rather than restating it: one rule in
        // two voices becomes two rules by the next reading.
        + ' "Is this consumer legitimate?" is a maintainer ruling (#5704 Q2, #6664 A) and this gate is the '
        + 'bookkeeping under it, not a second opinion on it.',
    );
  }
  // LIVE — bindings
  for (const e of ledgerBindings) {
    if (seen.has(ledgerKey(e))) continue;
    const stillThere = scan.bindings.some((b) => b.file === e.file);
    problems.push(
      `LIVE: the ledger records ${e.file} as '${e.kind}', which the scan no longer finds.`
        + (stillThere
          ? ` The file still binds the package by another means (${scan.bindings.filter((b) => b.file === e.file).map((b) => b.kind).join(', ')}) — update the entry's kind.`
          : ' If it was migrated, delete the entry in the same PR: a ledger nobody prunes becomes the next stale census.'),
    );
  }

  // LEDGERED / LIVE — manifests
  const mKey = (e) => `${e.file} ${e.field}`;
  const ledgeredM = new Set(ledgerManifests.map(mKey));
  const seenM = new Set();
  for (const d of scan.manifests) {
    seenM.add(mKey(d));
    if (ledgeredM.has(mKey(d))) continue;
    problems.push(
      `LEDGERED: ${d.file} declares ${SPECIFIER} in ${d.field} (${d.range}) and the ledger does not cover it. `
        + 'A manifest declaration outlives the consumer that justified it — that is exactly how a frozen package '
        + 'stays installed everywhere after the last real use is gone (#5499). Record which consumer it serves.',
    );
  }
  for (const e of ledgerManifests) {
    if (seenM.has(mKey(e))) continue;
    problems.push(
      `LIVE: the ledger records ${e.file} declaring ${SPECIFIER} in ${e.field}, which the manifest no longer does. `
        + 'Delete the entry in the same PR.',
    );
  }

  // RULED + CENSUS
  const marker = censusMarker(ruled.length);
  for (const e of ruled) {
    let text;
    try {
      text = read(e.file);
    } catch {
      problems.push(`RULED: ${e.file} is ledgered as a ruled consumer but cannot be read.`);
      continue;
    }
    for (const m of e.rulingMarkers ?? []) {
      if (text.includes(m)) continue;
      problems.push(
        `RULED: ${e.file} no longer mentions ${m}. The ruling block IS this consumer's disposition record — `
          + 'without it the next reader finds a frozen driver in a test file and nothing saying why it is there, '
          + 'which is the state that produced #6664. Restore the block, or take the removal through a ruling.',
      );
    }
    if (!text.includes(marker)) {
      problems.push(
        `CENSUS: ${e.file} does not state the census verbatim. Every ruled file must carry the exact string `
          + `"${marker}" so the ruled SET and the sentences describing it cannot drift apart. This is the #6664 `
          + 'defect mechanised: the old census was prose with no second party, and it expired silently the first '
          + 'time the hand-edit step was skipped. Changing the ruled set means rewriting both sentences.',
      );
    }
  }

  return problems;
}

// ── Reporting ───────────────────────────────────────────────────────────────

function report({ list = false } = {}) {
  const scan = scanRepo();
  const ledger = loadLedger();
  const problems = reconcile(scan, ledger);
  const ruled = ledger.ruledConsumers ?? [];

  console.log(
    `\n${SPECIFIER} census: ${scan.bindings.length} module binding(s) in `
      + `${new Set(scan.bindings.map((b) => b.file)).size} file(s), ${scan.manifests.length} manifest `
      + `declaration(s) — ${ruled.length} ruled test consumer(s) (${censusMarker(ruled.length)}).\n`,
  );

  if (list) {
    const axisOf = new Map(
      [...(ledger.ruledConsumers ?? []), ...(ledger.otherDeclarations ?? [])].map((e) => [`${e.file} ${e.kind}`, e.axis]),
    );
    for (const b of scan.bindings) {
      console.log(`  ${b.kind.padEnd(15)} ${b.file}:${b.line}  [${axisOf.get(`${b.file} ${b.kind}`) ?? 'UNLEDGERED'}]`);
    }
    console.log('');
    for (const d of scan.manifests) {
      const e = (ledger.manifests ?? []).find((x) => x.file === d.file && x.field === d.field);
      console.log(`  ${d.field.padEnd(15)} ${d.file}  ${d.range}  [${e?.axis ?? 'UNLEDGERED'}]`);
    }
    console.log(
      `\n  non-binding string occurrences (MENTIONS — never gated, see the header): ${scan.mentions.length}`,
    );
    for (const m of scan.mentions) console.log(`    ${m.file}:${m.line}`);
    console.log('');
  }

  if (problems.length) {
    for (const p of problems) console.error(`  x ${p}`);
    console.error(
      `\nThe disposition process, in one line: #5499 froze investment in this driver, #5704 migrated the test `
        + `backends and ruled which consumer stays, #6664 ruled the second one and replaced the prose census with `
        + `this ledger. Rule it, migrate it, or file it — then write it down here.\n`,
    );
    console.error(`check-driver-memory-census: ${problems.length} problem(s).\n`);
    process.exit(1);
  }

  for (const e of ruled) console.log(`  ruled    ${e.file}  (${e.ruling})`);
  console.log(
    `\ncheck-driver-memory-census: OK — every declaration is ledgered, every ledger entry is live, and every `
      + `ruled file states "${censusMarker(ruled.length)}". Nothing here invests in the driver (#5499 freeze).\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard (#4118). This drives the scanner and
// the reconciler at both sides of every decision they make, so a refactor that
// neuters either fails HERE rather than turning every future PR green.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };
  const kinds = (src) => scanSource('a.ts', src).map((h) => h.kind);

  // ── Binding positions, one per form.
  expect('static import is a binding',
    kinds(`import { InMemoryDriver } from '${SPECIFIER}';`).join() === 'import');
  expect('export-from is a binding',
    kinds(`export { InMemoryDriver } from '${SPECIFIER}';`).join() === 'export-from');
  expect('dynamic import is a binding',
    kinds(`const m = await import('${SPECIFIER}');`).join() === 'dynamic-import');
  expect('require is a binding',
    kinds(`const m = require('${SPECIFIER}');`).join() === 'require');
  expect('vi.mock is a binding',
    kinds(`vi.mock('${SPECIFIER}', () => ({}));`).join() === 'mock');
  expect('jest.mock is a binding',
    kinds(`jest.mock('${SPECIFIER}');`).join() === 'mock');
  expect('import() in type position is a binding',
    kinds(`type D = import('${SPECIFIER}').InMemoryDriver;`).join() === 'import-type');
  expect('a subpath import is a binding',
    kinds(`import x from '${SPECIFIER}/adapters';`).join() === 'import');

  // ── MENTIONS: the distinction the whole census rests on. Each of these really
  //    occurs in the tree today (tsup externals, comment prose, log strings).
  expect('a bundler externals array entry is a mention, not a binding',
    kinds(`export default { external: ['${SPECIFIER}'] };`).join() === 'string-literal');
  expect('a bare constant holding the name is a mention, not a binding',
    kinds(`const PKG = '${SPECIFIER}';`).join() === 'string-literal');
  expect('a log line that merely CONTAINS the name is not a string occurrence at all',
    kinds(`logger.warn('  x ${SPECIFIER} not installed — skipping driver');`).length === 0);
  expect('a comment is not seen at all', kinds(`// uses ${SPECIFIER} on purpose\nexport const x = 1;`).length === 0);
  expect('another package is not seen at all',
    kinds(`import { SqlDriver } from '@objectstack/driver-sql';`).length === 0);
  expect('a longer package name sharing the prefix is not seen',
    kinds(`import x from '@objectstack/driver-memory-extra';`).length === 0);

  // ── Two bindings in one file are reported separately (dev-plugin.ts really
  //    carries a dynamic import next to prose; a file could carry two forms).
  const two = kinds(`vi.mock('${SPECIFIER}', () => ({}));\nconst m = await import('${SPECIFIER}');`);
  expect('sibling bindings in one file are judged independently', two.join() === 'mock,dynamic-import');

  // ── Manifest scanning: dependency fields yes, `name` no.
  expect('dependencies is a declaration',
    scanManifest({ dependencies: { [SPECIFIER]: 'workspace:*' } }).map((d) => d.field).join() === 'dependencies');
  expect('devDependencies is a declaration',
    scanManifest({ devDependencies: { [SPECIFIER]: 'workspace:*' } }).map((d) => d.field).join() === 'devDependencies');
  expect('optionalDependencies is a declaration',
    scanManifest({ optionalDependencies: { [SPECIFIER]: 'workspace:*' } }).length === 1);
  expect('the package own `name` is not a declaration', scanManifest({ name: SPECIFIER }).length === 0);
  expect('a manifest naming another package declares nothing',
    scanManifest({ dependencies: { '@objectstack/driver-sql': 'workspace:*' } }).length === 0);

  // ── Reconciliation, driven on synthetic scans so a real violation never
  //    surfaces as a self-test failure (the least legible message available).
  const ruledFile = 'p/ruled.test.ts';
  const okLedger = () => ({
    ruledConsumers: [{
      file: ruledFile, kind: 'import', axis: 'ruled-permanent', ruling: '#5704 Q2=B',
      rulingMarkers: ['#5704'],
      why: 'the schemaless arm of a divergence pin — structural, not a migration leftover',
    }],
    otherDeclarations: [],
    manifests: [],
  });
  const okScan = () => ({ bindings: [{ file: ruledFile, kind: 'import', line: 1, specifier: SPECIFIER }], mentions: [], manifests: [] });
  const textOk = () => `#5704 ${censusMarker(1)}`;
  const readFrom = (map) => (f) => {
    if (!Object.hasOwn(map, f)) throw new Error(`no such file ${f}`);
    return map[f];
  };

  expect('a fully reconciled census is green',
    reconcile(okScan(), okLedger(), readFrom({ [ruledFile]: textOk() })).length === 0);

  // The #6664 defect: a second consumer arrives unledgered.
  const arrival = okScan();
  arrival.bindings.push({ file: 'p/new.test.ts', kind: 'import', line: 2, specifier: SPECIFIER });
  let ps = reconcile(arrival, okLedger(), readFrom({ [ruledFile]: textOk(), 'p/new.test.ts': '' }));
  expect('an unledgered arrival is a finding', ps.some((p) => p.startsWith('LEDGERED:') && p.includes('p/new.test.ts')));
  // #8576. The refusal above turns the bookkeeping remedy down; this pins that it
  // also says WHOSE call the disposition is, in the text the author reads.
  // Asserted on the planted arrival — the string only ever prints on failure.
  expect('the LEDGERED refusal states whose call the disposition is, not just that it is refused',
    ps.some((p) => p.startsWith('LEDGERED:') && p.includes('is a maintainer ruling')));

  // The mirror: a ledger entry whose consumer was migrated away.
  ps = reconcile({ bindings: [], mentions: [], manifests: [] }, okLedger(), readFrom({ [ruledFile]: textOk() }));
  expect('an empty scan trips DISCOVERED', ps.some((p) => p.startsWith('DISCOVERED:')));
  expect('a stale ledger entry trips LIVE', ps.some((p) => p.startsWith('LIVE:')));

  // A kind change is a different disposition, not a rename.
  const rekinded = { bindings: [{ file: ruledFile, kind: 'dynamic-import', line: 1, specifier: SPECIFIER }], mentions: [], manifests: [] };
  ps = reconcile(rekinded, okLedger(), readFrom({ [ruledFile]: textOk() }));
  expect('a changed binding kind is reported both ways',
    ps.some((p) => p.startsWith('LEDGERED:')) && ps.some((p) => p.startsWith('LIVE:')));

  // RULED: the ruling block cannot be deleted while the entry stays.
  ps = reconcile(okScan(), okLedger(), readFrom({ [ruledFile]: censusMarker(1) }));
  expect('a deleted ruling marker is a finding', ps.some((p) => p.startsWith('RULED:') && p.includes('#5704')));

  // CENSUS: the sentence and the set cannot drift — the whole point of #6664.
  ps = reconcile(okScan(), okLedger(), readFrom({ [ruledFile]: '#5704 only permanent test consumer in the repository' }));
  expect('a census sentence that does not state the count is a finding', ps.some((p) => p.startsWith('CENSUS:')));

  const twoRuled = okLedger();
  twoRuled.ruledConsumers.push({
    file: 'p/second.test.ts', kind: 'import', axis: 'ruled-permanent', ruling: '#6664',
    rulingMarkers: ['#5704'], why: 'the engine-fallback arm of a convergence pin — structural, no SQL equivalent',
  });
  const twoScan = okScan();
  twoScan.bindings.push({ file: 'p/second.test.ts', kind: 'import', line: 1, specifier: SPECIFIER });
  ps = reconcile(twoScan, twoRuled, readFrom({ [ruledFile]: textOk(), 'p/second.test.ts': `#5704 ${censusMarker(2)}` }));
  expect('growing the ruled set invalidates the OLD count in every file that still states it',
    ps.length === 1 && ps[0].startsWith('CENSUS:') && ps[0].includes(ruledFile));

  // Manifest axis, both directions.
  const mScan = okScan();
  mScan.manifests.push({ file: 'p/package.json', field: 'dependencies', range: 'workspace:*' });
  ps = reconcile(mScan, okLedger(), readFrom({ [ruledFile]: textOk() }));
  expect('an unledgered manifest declaration is a finding',
    ps.some((p) => p.startsWith('LEDGERED:') && p.includes('package.json')));

  const mLedger = okLedger();
  mLedger.manifests.push({ file: 'p/package.json', field: 'devDependencies', axis: 'product-consumer', why: 'the host installs it for the dynamic import in the factory' });
  ps = reconcile(mScan, mLedger, readFrom({ [ruledFile]: textOk() }));
  expect('a manifest declared in the wrong FIELD is reported both ways',
    ps.some((p) => p.startsWith('LEDGERED:')) && ps.some((p) => p.startsWith('LIVE:')));

  // Ledger shape: the vocabulary is closed and `why` must say something.
  const badAxis = okLedger();
  badAxis.otherDeclarations.push({ file: 'p/x.ts', kind: 'import', axis: 'because-i-said-so', why: 'a sufficiently long explanation' });
  expect('an unknown axis is refused',
    reconcile(okScan(), badAxis, readFrom({ [ruledFile]: textOk() })).some((p) => p.includes("axis 'because-i-said-so'")));

  const emptyWhy = okLedger();
  emptyWhy.otherDeclarations.push({ file: 'p/x.ts', kind: 'import', axis: 'product-consumer', why: 'legacy' });
  expect('an entry with no usable `why` is refused',
    reconcile(okScan(), emptyWhy, readFrom({ [ruledFile]: textOk() })).some((p) => p.includes('no usable')));

  const ruledByMock = okLedger();
  ruledByMock.ruledConsumers[0].kind = 'mock';
  expect('a ruled consumer must be a static import',
    reconcile(okScan(), ruledByMock, readFrom({ [ruledFile]: textOk() })).some((p) => p.includes('A ruled consumer is a static import')));

  // ── Wiring: discovery must reach the real tree and find the ruled files. NOT
  //    asserted here: that the tree is clean — that is the gated run's job.
  if (existsSync(LEDGER_PATH)) {
    const realScan = scanRepo();
    const realLedger = loadLedger();
    expect('discovery finds bindings in the real tree', realScan.bindings.length > 0);
    expect('discovery finds manifest declarations in the real tree', realScan.manifests.length > 0);
    for (const e of realLedger.ruledConsumers ?? []) {
      expect(`discovery reaches the ruled consumer ${e.file}`,
        realScan.bindings.some((b) => b.file === e.file && b.kind === e.kind));
    }
    expect('the ledger rules exactly the consumers #5704/#6664 named',
      (realLedger.ruledConsumers ?? []).length === 2);
  }

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-driver-memory-census --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: classifies every module-binding form (import / export-from / dynamic import / import-type / '
      + 'require / vi.mock) as a DECLARATION and every other string occurrence as a MENTION (a bundler externals '
      + 'entry, a log line, a comment), reads dependency fields but not a manifest\'s own `name`, reports an '
      + 'unledgered arrival AND a stale ledger entry AND a changed binding kind, refuses an unknown axis or an '
      + 'empty `why`, fails when a ruling marker is deleted, fails when a ruled file stops stating the census '
      + 'count, shows that growing the ruled set invalidates every sentence still carrying the old count, and '
      + 'proves discovery reaches both ruled consumers in the real tree.',
  );
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else report({ list: argv.includes('--list') });
