#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-comment-mask-adoption -- nobody writes a NEW private comment-stripper.
 *
 *   node scripts/check-comment-mask-adoption.mjs              # scan the tree
 *   node scripts/check-comment-mask-adoption.mjs --list       # the ledger, tiered
 *   node scripts/check-comment-mask-adoption.mjs --self-test  # verify the checker
 *
 * ## What this gate is for
 *
 * `scripts/js-comment-mask.mjs` exists because two private `stripComments`
 * families drifted apart in two different directions -- one regex-based, blind
 * to string literals, opening PHANTOM comments that delete real code; one
 * string-aware but regex-blind, opening phantom STRINGS that hide real
 * comments. Both are silent, and one of them reports success. That module's
 * header carries the measurement.
 *
 * What the tree did NOT have is anything watching who adopted it.
 * `check-comment-mask-corpus.mjs` verifies the shared mask AGAINST A REAL
 * PARSER, which is a statement about the module and says nothing about its
 * callers. So the shared module was landed, some callers were converted by
 * hand, and the population that never moved was found again by hand -- three
 * separate cards for one conversion. This file is the part that stops a fourth:
 * a NEW private stripper reds here, on the PR that writes it.
 *
 * That is the `check-entry-guard.mjs` idiom, applied to a different question.
 * The argument for a SPELLING gate is the same one that file and
 * `check-parse-guard.mjs` make: the behaviour is pinned once, at the module, by
 * `js-comment-mask.mjs --self-test` and by the parser-differential corpus
 * sweep; enforcing that everyone routes through it is the half that keeps
 * covering the caller nobody has written yet.
 *
 * ## Why a NEW gate rather than widening `check:parse-guard`
 *
 * That widening was proposed and is refused here on the merits, not on
 * territory. `check-parse-guard` governs the three TypeScript PARSER ENTRY
 * POINTS (`ts.createSourceFile`, `ts.createProgram`, `ts.transpileModule`) and
 * bans them outside `scripts/ts-parse.mjs`. Comment-stripping is a different
 * subject: widening that gate's POPULATION past `scripts/**` would extend a ban
 * on raw parser entry points into package sources and would still not catch a
 * single private stripper. Its own header refuses the broader root twice --
 * parses outside `scripts/**` are deliberately not banned, and declaring a
 * repo-wide root would name that gate for every card in the tree. The
 * `stripComments` sentence in its header is a cited PRECEDENT for why one-time
 * sweeps do not hold, not a description of its own scope.
 *
 * ## What it reads, and why the mask is load-bearing HERE too
 *
 * Comments are masked (`maskComments`) before the scan -- this gate dogfoods
 * the module it protects. That is not ceremony. Measured on `1f6b8bb193`, the
 * naive-block-regex probe matches 17 files raw and 14 masked: the three
 * `canonical-expression-envelopes.test.ts` files were CONVERTED onto the shared
 * mask and now mention the old regex only in the prose explaining why they
 * moved. An unmasked gate would red on exactly the three files that did the
 * right thing, and would keep doing so forever. 3 of 17 is an 18% fabrication
 * rate, and every one of those is a file whose author already complied.
 *
 * Strings, templates and regex literals are deliberately NOT masked: a private
 * stripper IS a regex literal, so masking literals would blind the gate to its
 * whole subject.
 *
 * ## The ledger is shrink-only, and a STALE row is RED
 *
 * The rows below are the population measured at seed time. They are not
 * approvals -- most are `unconverted`, meaning "a live private stripper that
 * predates this gate". Converting them is per-row, is a MEASUREMENT rather than
 * a sweep, and is deliberately not this gate's call: a row whose verdict
 * changes under the shared mask is a finding to read.
 *
 * FIRST SHRINK (#12398): the three route-ledger conformance guards
 * (`metadata`, `cloud-connection`, `trigger-api`) were converted and their rows
 * deleted here in the same PR, which is the half this gate's `stale` branch
 * exists to demand. Their conversion was a measurement and it found something:
 * on two of the three, the private scanner was reading the `//` inside a REGEX
 * LITERAL as a line-comment opener and deleting real code to end of line --
 * `/^https?:\/\//i` in `packages/metadata/src/plugin.ts` (40 bytes) and
 * `/\/packages\/[^/]+\/versions\//` in
 * `packages/cloud-connection/src/marketplace-proxy-plugin.ts` (38 bytes, inside
 * a declared MOUNT SOURCE). That is the naive-`//` family this gate exists for,
 * found live rather than argued from the shape. `packages/cli/src/utils/
 * console-route-ledger.conformance.test.ts` is the fourth guard in that family
 * and stays recorded: its population limb already stripped, so it was out of
 * that card's scope and nobody has re-read its scanner.
 *
 * A recorded row that the scan no longer finds FAILS as stale. That is the
 * property `check-self-test-wired.mjs` names as the difference between a rule
 * with a witness and a rule without one: it converts "no findings" into "the
 * recorded set is EXACTLY reached", and an equality cannot be satisfied by
 * weakening the measured side. Without it, breaking the detector would leave
 * this gate green forever, which is the failure direction the whole family
 * exists to distrust.
 *
 * ## The seed is DERIVED, and the count it corrects
 *
 * The card that filed this class counted 21 files. Re-running the census with
 * the mask above counts 25 on that card's own commit (`0acadda3dd`) and 23 on
 * `1f6b8bb193` -- the two `canonical-expression-envelopes.test.ts` conversions
 * account for the difference between those two numbers, and the other four are
 * rows the card's hand-written probe never saw: two because a `scripts/`
 * exclusion applied as a SUBSTRING also removed `packages/lint/scripts/` and
 * `packages/spec/scripts/`, two because its line-strip probe did not cover the
 * `^\s*\/\/.*$` spelling. A gate seeded by transcribing that probe would
 * inherit the same 16% blind spot and report green over the very shape it
 * exists to catch. So the shapes below are derived from the measurement, and
 * every one of them is pinned in `--self-test`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

/**
 * The SCAN SURFACE, written in the syntax `scripts/pm/dispatch-gates.mjs` can
 * read -- and written as SUBTREE GLOBS on purpose.
 *
 * `hintCovers` refuses a separator-less literal as too generic, so declaring
 * the bare words `packages` and `examples` would build no hint at all and this
 * gate would be named by no dispatch brief -- the invisible-population species
 * `scripts/pm/bare-root-worklist.mjs` exists to count. The glob form collapses
 * back to exactly these two roots, which makes this gate REACHABLE by
 * construction and leaves that tool's `TRIAGE` map and `check:pm-dispatch-gates`'
 * `escapable-literal` species both unreachable from here.
 *
 * Provenance, never a lookup key: `SCAN_ROOTS` below does the walking. The
 * literal has to be written out -- assembling it at runtime would put it out of
 * reach of the extractor it exists for.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**', 'examples/**'];

/** The roots actually walked, derived from the declaration above. */
const SCAN_ROOTS = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.next', 'build', '.turbo', 'coverage', '.git']);

/** The module every one of these should be routing through. */
const CANONICAL = 'scripts/js-comment-mask.mjs';

/**
 * The stripper SHAPES, derived from the census rather than guessed.
 *
 * Each is a pattern over MASKED source. `regex-block` and `regex-line` are the
 * two halves of the naive two-regex family; `scanner-decl` is a hand-rolled
 * character scanner, recognised by the NAME IT BINDS rather than by its body,
 * because a scanner's body is a hundred lines of ordinary string handling with
 * no distinguishing token in it.
 *
 * `scanner-decl` matches a DECLARATION only, never an import. That distinction
 * is the whole difference between a private copy and an adopter, and it is
 * pinned in both directions in `--self-test`.
 */
export const SHAPES = [
  {
    id: 'regex-block',
    // A regex body that swallows everything up to the first `*/`: the naive
    // block-comment strip, which has no idea what a string literal is.
    re: /\[(?:\\s\\S|\^)\]\*\?\\\*\\\//,
    what: 'a naive block-comment strip regex',
  },
  {
    id: 'regex-line',
    // `\/\/` followed by a to-end-of-line wildcard run: the naive line-comment
    // strip, which cannot tell a comment from the `//` in a URL.
    re: /\\\/\\\/(?:\[\^\\n\]|\.)\*/,
    what: 'a naive line-comment strip regex',
  },
  {
    id: 'scanner-decl',
    // A local binding named for the job this repo already has one module for.
    // The name must bind a FUNCTION, not just be a name. Measured cost of
    // dropping that clause: `const withoutComments = { context: ... }` in
    // packages/runtime/src/discovery-schema-conformance.test.ts is a fixture
    // for the `comments` CAPABILITY -- this tree has a comments feature, so
    // the vocabulary collides -- and a name-only rule reports it as a private
    // stripper. Pinned as a negative in --self-test.
    re: /(?:function\s+(?:strip|mask|remove|without)Comments?\s*\(|(?:const|let|var)\s+(?:strip|mask|remove|without)Comments?\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>))/i,
    what: 'a privately declared comment stripper',
  },
];

/** The verdicts a ledger row may record. */
const VERDICTS = new Set(['unconverted', 'specimen']);

/**
 * The population measured at seed time, on `1f6b8bb193`.
 *
 * SHRINK-ONLY. A row the scan no longer finds fails as stale -- delete it in
 * the same PR that converts the file. A row whose SHAPES change fails too: the
 * recorded verdict describes a specific implementation, and a file that swapped
 * one private stripper for another has not been re-read by anyone.
 */
const LEDGER = new Map([
  ['examples/app-showcase/test/inert-wirings.test.ts',
    { shapes: ['regex-block'], verdict: 'unconverted', why: 'predates this gate; strips block comments before an inert-wiring scan that reports no offset' }],
  ['packages/cli/src/commands/artifact-child-env.pin.test.ts',
    { shapes: ['regex-block'], verdict: 'unconverted', why: 'predates this gate; block-comment strip ahead of a pinned-shape scan' }],
  ['packages/cli/src/commands/migrate/multi-value-columns.no-auto-run.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/cli/src/commands/serve-cluster-host-resolution.test.ts',
    { shapes: ['scanner-decl'], verdict: 'unconverted', why: 'predates this gate; hand-rolled scanner, blanks block comments to spaces and drops strings' }],
  ['packages/cli/src/commands/serve-multi-node-cap-advisory.pin.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; imports maskComments elsewhere but interfaceFields() still strips TSDoc with the private pair' }],
  ['packages/cli/src/commands/serve-verify-security-parity.contract.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'specimen', why: 'the private two-regex strip this file carried until its conversion, kept as a NEGATIVE CONTROL that the shared mask beats it; converting it would delete the evidence' }],
  ['packages/cli/src/utils/console-route-ledger.conformance.test.ts',
    { shapes: ['scanner-decl'], verdict: 'unconverted', why: 'predates this gate; hand-rolled scanner, preserves block-comment newlines' }],
  ['packages/create-objectstack/src/template-registry.test.ts',
    { shapes: ['regex-line'], verdict: 'unconverted', why: 'predates this gate; line-comment strip over a template manifest, the spelling the filing card missed' }],
  ['packages/drivers/driver-sql/src/live-dialect-matrix.isolation.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/lint/scripts/check-doc-formula-expressions.mjs',
    { shapes: ['regex-block'], verdict: 'unconverted', why: 'predates this gate; docblock extractor, and package-local tooling that CAN import the shared module today' }],
  ['packages/lint/src/validate-expressions.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/lint/src/validate-org-axis-red-lines.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/lint/src/validate-rule-compilability.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/lint/src/validate-security-posture.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/metadata-protocol/src/migrations/live-mysql-database.isolation.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/plugins/plugin-approvals/src/admin-exemption-retired.test.ts',
    { shapes: ['scanner-decl'], verdict: 'unconverted', why: 'predates this gate; hand-rolled scanner that DROPS block-comment newlines while its gate reports a line number' }],
  ['packages/plugins/plugin-auth/src/rate-limit-storage-isolation.test.ts',
    { shapes: ['scanner-decl'], verdict: 'unconverted', why: 'predates this gate; hand-rolled scanner that DROPS block-comment newlines while its gate reports a line number' }],
  ['packages/qa/downstream-contract/test/source-resolution.pin.test.ts',
    { shapes: ['regex-line'], verdict: 'unconverted', why: 'predates this gate; strips JSONC comments from a tsconfig, the spelling the filing card missed' }],
  ['packages/runtime/src/error-envelope.conformance.test.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; the full naive two-regex pair' }],
  ['packages/spec/scripts/lazify-schemas.ts',
    { shapes: ['regex-block', 'regex-line'], verdict: 'unconverted', why: 'predates this gate; import-block matcher consuming leading comments, and package-local tooling the card excluded by substring' }],
]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') { if (SKIP_DIR.has(e.name)) continue; }
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(p, out);
    } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * The shapes `source` carries, as shape ids.
 *
 * Raw source is tested FIRST as a prefilter. That is sound rather than a
 * shortcut: masking only ever replaces characters with spaces, so a masked hit
 * implies a raw hit, and a raw miss is a masked miss. It is also most of the
 * runtime -- the mask is a full character scan and the overwhelming majority of
 * files carry no stripper at all.
 */
export function shapesIn(source) {
  const rawHits = SHAPES.filter((s) => s.re.test(source));
  if (rawHits.length === 0) return [];
  const masked = maskComments(source);
  return rawHits.filter((s) => s.re.test(masked)).map((s) => s.id);
}

function scan() {
  const found = new Map();
  for (const root of SCAN_ROOTS) {
    for (const abs of walk(join(REPO_ROOT, root))) {
      let src;
      try { src = readFileSync(abs, 'utf8'); } catch { continue; }
      const shapes = shapesIn(src);
      if (shapes.length) found.set(relative(REPO_ROOT, abs).split(sep).join('/'), shapes);
    }
  }
  return found;
}

function main() {
  const found = scan();
  const fresh = [...found.keys()].filter((f) => !LEDGER.has(f)).sort();
  const stale = [...LEDGER.keys()].filter((f) => !found.has(f)).sort();
  const drifted = [...found.entries()]
    .filter(([f, shapes]) => LEDGER.has(f)
      && LEDGER.get(f).shapes.slice().sort().join(',') !== shapes.slice().sort().join(','))
    .map(([f, shapes]) => `${f}\n      recorded ${LEDGER.get(f).shapes.join(',')} — scan finds ${shapes.join(',')}`)
    .sort();

  let failed = false;

  if (fresh.length) {
    failed = true;
    console.error(`\n⛔ ${fresh.length} NEW private comment-stripper(s) — route through ${CANONICAL}:\n`);
    for (const f of fresh) console.error(`   ${f}  [${found.get(f).join(',')}]`);
    console.error(`
   That module answers this question once, and its header carries the two
   measured failure families a private copy joins. Import what you need:

     import { maskComments, stripComments } from '<rel>/${CANONICAL}';

     maskComments(src)   comments blanked, OFFSETS and line numbers both survive
     stripComments(src)  comments removed, LINE NUMBERS survive, offsets do not

   Pick by what your finding reports. If your case genuinely cannot route
   through it, say why in review and add a ledger row here -- but a row is a
   measurement someone has to be able to re-read, not a way past the gate.`);
  }

  if (stale.length) {
    failed = true;
    console.error(`\n⛔ ${stale.length} recorded row(s) the scan no longer finds — converted? delete the row:\n`);
    for (const f of stale) console.error(`   ${f}  [recorded ${LEDGER.get(f).shapes.join(',')}]`);
    console.error(`
   This ledger is SHRINK-ONLY and an unreached row is a failure by design: it
   is what makes "no findings" mean "the recorded set is exactly reached"
   rather than "the detector stopped matching". Deleting the row is the other
   half of the conversion and lands in the same PR.`);
  }

  if (drifted.length) {
    failed = true;
    console.error(`\n⛔ ${drifted.length} recorded row(s) whose stripper CHANGED shape:\n`);
    for (const d of drifted) console.error(`   ${d}`);
    console.error(`
   The recorded verdict describes a specific implementation. A file that
   swapped one private stripper for another has not been re-read by anyone, so
   update the row's shapes and its 'why' together -- or convert it.`);
  }

  if (failed) return 1;

  const byVerdict = (v) => [...LEDGER.values()].filter((r) => r.verdict === v).length;
  console.log(
    `OK  check:comment-mask-adoption — ${found.size} private comment-stripper(s) under `
    + `${ROOT_DIR_WATCH_HINTS.join(' + ')}, all ${LEDGER.size} recorded and every recorded row `
    + `still reached (${byVerdict('unconverted')} unconverted, ${byVerdict('specimen')} specimen). `
    + `A new one reds here.`,
  );
  return 0;
}

function list() {
  console.log(`# ${LEDGER.size} recorded private comment-strippers (shrink-only)\n`);
  for (const v of VERDICTS) {
    const rows = [...LEDGER.entries()].filter(([, r]) => r.verdict === v);
    console.log(`## ${v} (${rows.length})`);
    for (const [f, r] of rows) console.log(`  ${f}\n      [${r.shapes.join(',')}] ${r.why}`);
    console.log('');
  }
  return 0;
}

export function selfTest() {
  let failures = 0;
  const t = (name, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failures++;
  };
  const ids = (src) => shapesIn(src).join(',');

  // ── Each SHAPE fires on the spelling measured in the tree ────────────────
  t('the naive block-comment regex is caught',
    ids(String.raw`const b = src.replace(/\/\*[\s\S]*?\*\//g, '');`) === 'regex-block');
  t('...including the [^] spelling of the same body',
    ids(String.raw`const b = src.replace(/\/\*[^]*?\*\//g, '');`) === 'regex-block');
  t('the naive line-comment regex is caught ([^\\n]* form)',
    ids(String.raw`const b = src.replace(/\/\/[^\n]*/g, '');`) === 'regex-line');
  t('...and the .* form the filing card missed',
    ids(String.raw`const b = raw.replace(/^\s*\/\/.*$/gm, '');`) === 'regex-line');
  t('the two-regex pair reports BOTH halves',
    ids(String.raw`src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');`)
      === 'regex-block,regex-line');
  t('a hand-rolled scanner is caught by the name it binds',
    ids('function stripComments(source) { return source; }') === 'scanner-decl');
  t('...as a const arrow too',
    ids('const stripComments = (s) => s;') === 'scanner-decl');
  t('...and under the mask spelling',
    ids('function maskComments(source) { return source; }') === 'scanner-decl');

  // ── The ADOPTER must stay silent: this is the whole point ────────────────
  t('an IMPORT of the shared stripper is NOT a finding',
    ids("import { stripComments } from '../../scripts/js-comment-mask.mjs';") === '');
  t('...and neither is CALLING it',
    ids("const code = stripComments(readFileSync(f, 'utf8'));") === '');
  t('...nor importing the mask projection',
    ids("import { maskComments } from '../../../scripts/js-comment-mask.mjs';\nconst m = maskComments(src);") === '');

  // ── Prose must stay silent: the 18% fabrication this gate would otherwise
  //    aim at exactly the files that already complied ────────────────────────
  t('the same regex QUOTED IN PROSE is not a finding',
    ids(String.raw`/* We used to write src.replace(/\/\*[\s\S]*?\*\//g, '') here. */
const m = maskComments(src);`) === '');
  t('...and a line comment naming the scanner is not a finding',
    ids('// a private stripComments() used to live here\nconst m = maskComments(src);') === '');
  t('a regex literal is NOT masked away (the gate must still see its subject)',
    ids(String.raw`const RE = /\/\*[\s\S]*?\*\//g;`) === 'regex-block');

  // ── Negatives that must not fabricate ────────────────────────────────────
  t('an ordinary URL is not a stripper', ids("const u = 'https://example.com/a';") === '');
  // Measured false positive from the first run of this gate, kept as a pin:
  // the name alone is not the finding, the FUNCTION it binds is.
  t('a fixture OBJECT named for the comments capability is not a stripper',
    ids('const withoutComments = {\n  context: { getService: (n) => null },\n} as any;') === '');
  t('...while a FUNCTION by that same name still is',
    ids('const withoutComments = (s) => s.replace(x, y);') === 'scanner-decl');
  t('an unrelated regex is not a stripper', ids(String.raw`const re = /[\s\S]*?;/g;`) === '');
  t('an empty source finds nothing', ids('') === '');

  // ── Ledger invariants ────────────────────────────────────────────────────
  t('every recorded row carries a known verdict and a real reason',
    [...LEDGER.values()].every((r) => VERDICTS.has(r.verdict)
      && Array.isArray(r.shapes) && r.shapes.length > 0
      && r.shapes.every((s) => SHAPES.some((sh) => sh.id === s))
      && typeof r.why === 'string' && r.why.length > 20));
  t('the declared scan surface collapses to the roots actually walked',
    SCAN_ROOTS.join(',') === 'packages,examples');
  t('the declared surface is spelled with a separator (bare-root species unreachable)',
    ROOT_DIR_WATCH_HINTS.every((h) => h.includes('/')));

  // ── The instrument itself: the known-good probe MUST be recognised ───────
  // A zero from this detector is only a reading if the detector can be seen
  // firing on a stripper nobody disputes. `js-comment-mask.mjs` is that probe:
  // it is the tree's one sanctioned comment stripper, and it exports the very
  // name this gate recognises.
  t('POSITIVE CONTROL — the shared module itself reads as a stripper',
    shapesIn(readFileSync(join(REPO_ROOT, CANONICAL), 'utf8')).includes('scanner-decl'));

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  check-comment-mask-adoption --self-test (${failures} failure(s))`);
  return failures === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
