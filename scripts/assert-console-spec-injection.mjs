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
// ## Probe derivation lives in ./console-spec-probes.mjs
//
// Not here, because objectstack#9667 added a SECOND consumer: this script can
// only run where BOTH specs exist, which is inside a build. On a console-dist
// cache HIT there is no objectui build tree and therefore no vendored spec, so
// nothing could re-ask the question about the restored artifact. Two scripts,
// one derivation — see that module's header.
//
// ## This script also writes the provenance stamp
//
// On success it records the probes it chose into `<dist>/.objectstack-injection.json`,
// so `pnpm check:console-injection` can replay them against a restored dist that
// this script can no longer be run against. Written LAST, only once every
// assertion below is green — unlike the `.objectui-sha` stamp, which
// build-console.sh writes before its canary assert (the asymmetry ci.yml's
// split restore/save comment calls out).
//
// Usage:
//   node scripts/assert-console-spec-injection.mjs \
//     --injected <framework packages/spec> \
//     --vendored <objectui build tree node_modules/@objectstack/spec> \
//     --assets   <built console dist/assets>
//
// Exit: 0 = injection proven (or no skew to prove) · 1 = injection failed
//       2 = inconclusive / cannot run

import path from 'node:path';

import {
  ProbeError,
  describeCandidates,
  pickProbe,
  readBundle,
  readSpecBlob,
  writeStamp,
} from './console-spec-probes.mjs';

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

const args = parseArgs(process.argv);

const assetsDir = path.resolve(args.assets);
// The dist root is the assets dir's parent: build-console.sh passes
// `<dist>/assets`, so this is where the .objectui-sha stamp already lives.
const distDir = path.dirname(assetsDir);

let bundle;
let injectedBlob;
let vendoredBlob;
try {
  bundle = readBundle(assetsDir);
  injectedBlob = readSpecBlob(path.resolve(args.injected), 'injected');
  vendoredBlob = readSpecBlob(path.resolve(args.vendored), 'vendored');
} catch (error) {
  if (!(error instanceof ProbeError)) throw error;
  fail(error.message);
}

const freshWitness = pickProbe(describeCandidates(injectedBlob), vendoredBlob);
const staleDetector = pickProbe(describeCandidates(vendoredBlob), injectedBlob);

/** Record what this build proved, for check:console-injection to replay. */
function stamp(skew) {
  try {
    writeStamp(distDir, [
      {
        name: '@objectstack/spec',
        injectedFrom: path.resolve(args.injected),
        skew,
        freshWitness,
        staleDetector,
      },
    ]);
  } catch (error) {
    // A dist we cannot stamp is still a dist this script just proved good.
    // Failing here would turn a green build red over provenance bookkeeping;
    // check:console-injection reports the missing stamp on its own terms.
    console.warn(`⚠ could not write the injection stamp: ${error.message}`);
  }
}

if (!freshWitness && !staleDetector) {
  console.log('✓ Injected and vendored @objectstack/spec declare the same descriptions');
  console.log('  — no observable skew, so nothing for this check to assert.');
  stamp(false);
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
stamp(true);
process.exit(0);
