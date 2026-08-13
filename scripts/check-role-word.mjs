#!/usr/bin/env node
// check-role-word — ADR-0090 D3 vocabulary ratchet for hand-written docs.
//
// D3 makes "role" a reserved-forbidden word (capability = permission_set,
// distribution = position, hierarchy = business_unit). The publish-time lint
// (`security-role-word`, packages/lint) enforces this for AUTHORED METADATA;
// nothing enforced it for the repo's own documentation — which is how the
// pre-D3 copy in book.zod.ts ("role-gated") and content/docs survived the
// P1 rename wave (#2697 was identifier-driven).
//
// This is a RATCHET, not a ban-with-exceptions: existing occurrences are
// frozen in scripts/role-word-baseline.json (many are legitimate — the
// better-auth boundary, ARIA `role=` in samples, educational "formerly
// roles" mentions — and untangling them file-by-file is incremental work).
// The check fails when:
//   • a file NOT in the baseline contains the word, or
//   • a baselined file's count INCREASES, or
//   • a baselined file's count DECREASED / file vanished (improvement!) —
//     run with --update to ratchet the baseline down and commit it.
//
//   node scripts/check-role-word.mjs [--update]
//   node scripts/check-role-word.mjs --self-test   # verify the checker's own rules
//
// `--update` expands the baseline, which is the shrink-only direction of this
// ratchet — the NEW-use message marks that path `⛔ MAINTAINER-ONLY` per the
// #8435 convention, and the self-test holds the marker in place.
//
// Scope: content/docs (hand-written; references/ is generated from spec and
// excluded — the spec source is the fix site there) and skills/. File and
// directory NAMES count too (they become URLs).
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['content/docs', 'skills'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
const EXTENSIONS = new Set(['.mdx', '.md']);
const BASELINE_PATH = 'scripts/role-word-baseline.json';
const WORD = /\brole(?:s)?\b/gi;

const update = process.argv.includes('--update');

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if ([...EXTENSIONS].some((x) => e.endsWith(x))) out.push(p);
  }
}

function countMatches(text) {
  const m = text.match(WORD);
  return m ? m.length : 0;
}

// ── The ratchet-remedy authority convention (#8435) ──────────────────────────
//
// This gate's second remedy is `--update`, which expands the baseline. That is
// a shrink-only ratchet, so taking that path WEAKENS the gate — and the message
// used to offer it in the same breath as the real fix, with nothing saying whose
// path it is. The convention landed for check-engine-double-contract.mjs and
// check-type-check-coverage.mjs; the twin blocks there are the reference.
//
// The marker here has to label the ACT, not the file. `--update` does not append
// a line: it rewrites the entire baseline from the current tree (see the
// `update` branch below), so an author reaching for it to admit one new
// occurrence also re-baselines every other file in the same stroke.
//
// ⛔ This STRENGTHENS ratchet governance and weakens nothing. No threshold
// moves, no baseline entry is added, and the verdicts this gate reaches are
// byte-for-byte the ones it reached before — only the diagnostic text changes.

/** Kept identical to the other gates' token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * How this gate OFFERS the privileged path, as a detector rather than a string
 * compare, so the self-test can prove it still reaches its subject: a reworded
 * offer that stopped matching would make the convention check pass vacuously on
 * every message.
 *
 * Deliberately keyed on the baseline-EXPANDING phrasing ("add it to <path>") and
 * not on `--update` alone. The two ratchet-DOWN messages below also name
 * `--update`, and ratcheting down is squarely the author's job — a detector that
 * caught those would force the maintainer-only marker onto a message where it is
 * actively wrong.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
  `add it to\\s+${BASELINE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * The convention: a message that hands the author the baseline-expanding path
 * must say in the same breath that the path is not theirs. A message offering no
 * such path is unaffected — this is an authority label, not a vocabulary ban.
 *
 * @param {string} message
 * @returns {boolean}
 */
function ratchetRemedyCarriesAuthority(message) {
  if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
  return message.includes(RATCHET_AUTHORITY_MARKER);
}

/**
 * The NEW-use verdict's text, named and pure so the self-test can assert on the
 * exact string the author reads. A message built inline is a message no
 * assertion can reach.
 *
 * @param {string} file
 * @param {number} count
 * @returns {string}
 */
function newUseMessage(file, count) {
  return (
    `${file}: NEW use of the reserved word "role" (${count} occurrence(s)). `
    + 'ADR-0090 D3: use permission_set / position / business_unit. That is the fix, and the '
    + `only one of the two you can take on your own. ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal `
    + 'option: for a genuine boundary (better-auth, ARIA, quoted history), add it to '
    + `${BASELINE_PATH} by running \`node scripts/check-role-word.mjs --update\`. The gated thing `
    + 'is that ACT, not the file — `--update` rewrites the whole baseline from the current tree, '
    + 'so it admits your occurrence and re-baselines every other file in one stroke. The baseline '
    + 'is shrink-only, so this weakens a ratchet and needs a maintainer to agree the boundary is '
    + 'genuine first — do not take this path to get CI green.'
  );
}

function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // ── The ratchet-remedy authority convention (#8435) ────────────────────────
  //
  // Four assertions, deliberately non-overlapping, so each way this can rot is
  // caught by exactly one NAMED failure: (1) the detector still reaches its
  // subject, (2) the real message carries the marker, (3) an unmarked offer is
  // REJECTED, (4) the detector does NOT reach the ratchet-DOWN messages. (3) is
  // what makes (2) worth having — a predicate that approved everything would
  // keep (2) green with the convention gone. (4) is this gate's own hazard:
  // both directions of its ratchet are spelled `--update`, and marking the
  // improvement path maintainer-only would teach the opposite of the rule.
  const real = newUseMessage('content/docs/example.mdx', 2);
  expect('#8435 — the ratchet-offer DETECTOR still matches the NEW-use message (else the check '
    + 'below is vacuous)',
    RATCHET_EXPANSION_OFFER.test(real));
  expect(`#8435 — the NEW-use message marks the baseline path ${RATCHET_AUTHORITY_MARKER} (the `
    + 'baseline is shrink-only, so running --update is a maintainer action, not the author\'s '
    + 'second option)',
    ratchetRemedyCarriesAuthority(real));

  // (3)'s fixture is SYNTHETIC rather than the real message with the marker
  // stripped: derived, it also fires on a rewording and misdescribes the cause.
  const unmarkedOffer = `example.mdx: NEW use. add it to ${BASELINE_PATH} with --update.`;
  expect('#8435 — the synthetic unmarked-offer fixture is still recognised as an offer',
    RATCHET_EXPANSION_OFFER.test(unmarkedOffer));
  expect('#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves the '
    + 'predicate discriminates rather than approving everything)',
    !ratchetRemedyCarriesAuthority(unmarkedOffer));

  const ratchetDown = `content/docs/example.mdx: role-word count improved 4 → 2 — ratchet DOWN: `
    + 'run `node scripts/check-role-word.mjs --update` and commit the baseline.';
  expect('#8435 — the detector does NOT match the ratchet-DOWN message, which also names --update '
    + '(marking the improvement path maintainer-only would teach the opposite of the rule)',
    !RATCHET_EXPANSION_OFFER.test(ratchetDown) && ratchetRemedyCarriesAuthority(ratchetDown));

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-role-word --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: the NEW-use remedy marks baseline expansion as maintainer-only, the predicate '
    + 'rejects an unmarked offer, and the ratchet-DOWN remedy stays the author\'s own.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

const files = [];
for (const root of ROOTS) if (existsSync(root)) walk(root, files);

const current = {};
for (const f of files.sort()) {
  const rel = relative('.', f).replace(/\\/g, '/');
  // File/dir names are URLs — a `role-*` slug is UI copy (counts once).
  const nameHits = countMatches(rel);
  const bodyHits = countMatches(readFileSync(f, 'utf8'));
  const total = nameHits + bodyHits;
  if (total > 0) current[rel] = total;
}

if (update) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`role-word baseline updated: ${Object.keys(current).length} file(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {};

const errors = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(newUseMessage(file, count));
  } else if (count > allowed) {
    errors.push(`${file}: role-word count grew ${allowed} → ${count}. New occurrences are banned (ADR-0090 D3).`);
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  const now = current[file];
  if (now === undefined) {
    errors.push(`${file}: baselined file is clean/gone (was ${allowed}) — ratchet DOWN: run \`node scripts/check-role-word.mjs --update\` and commit the baseline.`);
  } else if (now < allowed) {
    errors.push(`${file}: role-word count improved ${allowed} → ${now} — ratchet DOWN: run \`node scripts/check-role-word.mjs --update\` and commit the baseline.`);
  }
}

if (errors.length) {
  console.error(`check-role-word: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}
console.log(`check-role-word: OK (${Object.keys(current).length} baselined file(s), no new occurrences).`);
