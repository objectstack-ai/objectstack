#!/usr/bin/env node
// Assert that OBJECTSTACK_SPEC_DIST actually landed in the built console bundle.
//
// ## Why this is not a frozen literal like the client's BUNDLE_CANARY
//
// build-console.sh asserts the injected *client* with a fixed string
// ('import/jobs'). That works because the question is static: "is the client in
// here new enough to have the import-job API?". The spec question is not static.
// What must be true is "the bundle carries the surface the framework declares
// NOW", and any literal frozen today is carried by the published spec too within
// one release — after which the canary passes forever while proving nothing. A
// self-staling assertion is the exact silent-pass failure objectstack#8134 exists
// to end, so it must not be the fix for it.
//
// So both probes are DERIVED, on every run, from the two specs actually on disk:
//
//   injected = this framework tree's packages/spec  (what must be bundled)
//   vendored = the @objectstack/spec objectui's own lockfile installed
//              (what gets bundled when the injection is missing or broken)
//
// ## The test is two-sided, because one side is not enough
//
// Measured while building this check: asserting only "a string unique to the
// injected spec appears in the bundle" PASSES even with no injection at all. The
// console bundle already contains a second, transitive copy of this tree's spec,
// dragged in by the injected @objectstack/client — it lands in a different chunk
// from the console's own `@objectstack/spec` imports. A one-sided probe reads
// that copy and reports success while the designer still runs on the published
// schemas. So:
//
//   FRESH WITNESS  — text only the injected spec has; must be PRESENT.
//   STALE DETECTOR — text only the vendored spec has; must be ABSENT.
//
// The stale detector is the one that actually catches this card's defect: it is
// positive evidence that the published spec is still in the bundle. The fresh
// witness alone cannot distinguish "injection worked" from "some other copy".
//
// ## Substring safety
//
// A probe is only usable if a literal search can tell the two specs apart, so
// each candidate is checked against the ENTIRE other spec's built output, not
// against a string set. Descriptions are routinely REWORDED by appending a
// clause, which makes the old text a prefix of the new one — three of the first
// candidates measured here were exactly that, and a set-difference check called
// them unique when a substring search would have matched both.
//
// ## When the two specs agree
//
// If neither side has text the other lacks, there is nothing to detect and the
// check reports "no skew" and exits 0. That is a real state — the build right
// after a spec publish — not a failure.
//
// Usage:
//   node scripts/assert-console-spec-injection.mjs \
//     --injected <framework packages/spec> \
//     --vendored <objectui build tree node_modules/@objectstack/spec> \
//     --assets   <built console dist/assets>
//
// Exit: 0 = injection proven (or no skew to prove) · 1 = injection failed
//       2 = inconclusive / cannot run

import fs from 'node:fs';
import path from 'node:path';

/** Export conditions a browser/ESM bundler picks, in preference order.
 *  `types` is deliberately absent — it sits first in each condition object and
 *  would resolve every subpath at a `.d.mts` file. */
const IMPORT_CONDITIONS = ['import', 'module', 'browser', 'default'];

function fail(message) {
  console.error(`✗ assert-console-spec-injection: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith('--')) fail(`unexpected argument \`${key}\``);
    if (argv[i + 1] === undefined) fail(`\`${key}\` has no value`);
    out[key.slice(2)] = argv[i + 1];
  }
  for (const required of ['injected', 'vendored', 'assets']) {
    if (!out[required]) fail(`--${required} is required`);
  }
  return out;
}

function pickImportTarget(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const hit = pickImportTarget(candidate);
      if (hit) return hit;
    }
    return null;
  }
  for (const condition of IMPORT_CONDITIONS) {
    if (!Object.hasOwn(value, condition)) continue;
    const hit = pickImportTarget(value[condition]);
    if (hit) return hit;
  }
  return null;
}

/** Every JS file a package's exports map resolves to, concatenated once. */
function readSpecBlob(packageDir, label) {
  const manifestPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifestPath)) fail(`${label} spec has no package.json at \`${manifestPath}\``);
  let exportsMap;
  try {
    exportsMap = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).exports;
  } catch (error) {
    fail(`${label} \`${manifestPath}\` is not readable JSON (${error.message})`);
  }
  if (!exportsMap || typeof exportsMap !== 'object') fail(`${label} spec declares no exports map`);

  const chunks = [];
  for (const value of Object.values(exportsMap)) {
    const target = pickImportTarget(value);
    if (!target || !/\.(js|mjs|cjs)$/.test(target)) continue;
    const absolute = path.resolve(packageDir, target);
    if (!fs.existsSync(absolute)) continue;
    chunks.push(fs.readFileSync(absolute, 'utf8'));
  }
  if (chunks.length === 0) fail(`${label} spec at \`${packageDir}\` has no built JavaScript to compare`);
  return chunks.join('\n');
}

/**
 * Candidate probe strings: Zod `.describe()` arguments.
 *
 * They are prose written by spec authors, which makes them stable across a
 * bundler (plain string literals, preserved by minification) and specific enough
 * that a match is not a coincidence — the property objectstack#8134's own
 * measurement relied on, and the reason a bare key name like `object` is
 * unusable here (`optionsFrom.object` false-positives).
 */
function describeCandidates(blob) {
  const found = new Set();
  const pattern = /\.describe\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
  for (const match of blob.matchAll(pattern)) {
    const text = match[2];
    // Long enough to be unique, short enough to survive intact, and free of
    // escapes and line breaks so a literal search means what it says.
    if (text.length < 32 || text.length > 160) continue;
    if (/[\\\r\n]/.test(text)) continue;
    found.add(text);
  }
  return [...found].sort();
}

/** First candidate present in `mine` and absent from `theirs`, as raw text. */
function pickProbe(candidates, theirs) {
  for (const candidate of candidates) {
    if (!theirs.includes(candidate)) return candidate;
  }
  return null;
}

const args = parseArgs(process.argv);

const assetsDir = path.resolve(args.assets);
if (!fs.existsSync(assetsDir)) fail(`assets dir \`${assetsDir}\` does not exist`);
const assetChunks = [];
for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
  if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
    assetChunks.push(fs.readFileSync(path.join(assetsDir, entry.name), 'utf8'));
  }
}
if (assetChunks.length === 0) fail(`no JavaScript assets under \`${assetsDir}\``);
const bundle = assetChunks.join('\n');

const injectedBlob = readSpecBlob(path.resolve(args.injected), 'injected');
const vendoredBlob = readSpecBlob(path.resolve(args.vendored), 'vendored');

const freshWitness = pickProbe(describeCandidates(injectedBlob), vendoredBlob);
const staleDetector = pickProbe(describeCandidates(vendoredBlob), injectedBlob);

if (!freshWitness && !staleDetector) {
  console.log('✓ Injected and vendored @objectstack/spec declare the same descriptions');
  console.log('  — no observable skew, so nothing for this check to assert.');
  process.exit(0);
}

const freshPresent = freshWitness ? bundle.includes(freshWitness) : null;
const stalePresent = staleDetector ? bundle.includes(staleDetector) : null;

// Neither probe anywhere in the bundle means the spec is not in this build at
// all — the check cannot speak to an injection it cannot see.
if (freshPresent !== true && stalePresent !== true) {
  console.error('✗ Neither spec appears in the built console — no @objectstack/spec');
  console.error('  content matched. The injection is UNVERIFIED by this check.');
  process.exit(2);
}

if (stalePresent === true) {
  console.error("✗ Built console still carries the PUBLISHED @objectstack/spec.");
  console.error('  The console resolved spec from objectui\'s lockfile, so any authorable');
  console.error('  key this framework declared after the last spec publish is unreachable');
  console.error('  in the Studio designer — the defect objectstack#8134 exists to end.');
  console.error('');
  console.error('  Text found in the bundle that ONLY the vendored spec has:');
  console.error(`    "${staleDetector}"`);
  if (freshPresent === true) {
    console.error('');
    console.error('  Note: text unique to this tree\'s spec is ALSO in the bundle —');
    console.error('  a second, transitive copy (via the injected @objectstack/client).');
    console.error('  That copy is not what the designer imports; both must not coexist.');
  }
  process.exit(1);
}

if (freshPresent !== true) {
  console.error('✗ The published spec is gone from the bundle, but nothing unique to');
  console.error("  this tree's spec was found either — the build is in an unexpected");
  console.error('  state and the injection is UNVERIFIED.');
  console.error(`    expected: "${freshWitness}"`);
  process.exit(2);
}

console.log("✓ Console bundle carries THIS tree's @objectstack/spec, and only it.");
console.log(`    present (injected only): "${freshWitness}"`);
if (staleDetector) console.log(`    absent  (vendored only): "${staleDetector}"`);
process.exit(0);
