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
// frozen in scripts/role-word-baseline.json, and not all of them are bugs.
// The legitimate KINDS — vocabulary owned upstream (better-auth's
// `sys_member.role`), ARIA's `role=` attribute, quoted pre-rename history —
// are named as KINDS and not as an inventory of the ledger: which of them it
// actually holds changes with every `--update`, so the same list read as a
// census goes wrong silently. Untangling the rest file-by-file is
// incremental work.
//
// The check fails when:
//   • a file NOT in the baseline contains the word, or
//   • a baselined file's count INCREASES, or
//   • a baselined file's count DECREASED / file vanished (improvement!) —
//     run with --update to ratchet the baseline down and commit it.
//
//   node scripts/check-role-word.mjs [--update]
//   node scripts/check-role-word.mjs --self-test   # verify the checker's own rules
//
// `--update` rewrites the baseline from the current tree — it never reads the
// old ledger (see the `update` branch at the bottom) — so it moves whichever
// way the tree moved: shrinking where the word is gone, EXPANDING where it is
// new. Only policy tells those apart. The baseline is shrink-only, so
// ratcheting down is the author's own remedy, while expanding WEAKENS the gate
// and is a maintainer's call: the NEW-use message marks that path
// `⛔ MAINTAINER-ONLY` per the #8435 convention, and the self-test holds the
// marker in place. Both pin the WORDING, not the act — the flag takes either
// direction from whoever runs it.
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

// ── What a PASSING run tells the reader (#9910) ────────────────────────
//
// The green line used to be, in full:
//
//   check-role-word: OK (N baselined file(s), no new occurrences).
//
// N is written generically because this line no longer exists in the program.
// It can never print again, at any size, so no literal here would be checkable
// against anything the gate does — and the next `--update` could only make one
// wrong, never right again. The quote is carried for its SHAPE.
//
// Every number in it came from the LEDGER. `current` holds only the files that
// still carry the word, and a green run is precisely the run where its key set
// equals the baseline's — so the population actually READ (`files`, walked over
// ROOTS) never reached the output at all.
//
// That was safe only while the ledger was non-empty, and safe by ACCIDENT: a
// scan that reads nothing drops every baselined file out of `current`, and the
// ratchet-DOWN branch below then reports one "clean/gone" problem per baselined
// file. Measured on this tree — ROOTS pointed at two non-existent directories,
// ledger untouched — exit 1, raising exactly one problem per baselined file.
// The magnitude is deliberately not written down, and no bound stands in its
// place: the ratchet-DOWN loop below walks `Object.entries(baseline)` and
// raises one error for every entry missing from `current`, so a dead scan
// raises as many problems as the ledger holds — an identity that survives
// every `--update`, at any ledger size, including the empty one. A SHRINK-only
// ledger admits no durable bound to state instead: a floor rots on the first
// sanctioned ratchet-down (the very remedy this gate tells authors to run),
// and a ceiling rots too, because the same `--update` is also the
// baseline-EXPANDING path the #8435 marker above gates.
//
// That protection is a side effect of still owing debt, and it evaporates at
// the exact moment this ratchet succeeds at its purpose: with the ledger
// empty, `current = {}` and `baseline = {}` raise nothing in either direction,
// and the same ablation printed
//
//   check-role-word: OK (0 baselined file(s), no new occurrences).   EXIT=0
//
// — a gate that read zero files, over an empty ledger, reporting success. So
// the green body states the INPUT VOLUME, which no clean tree can make vacuous:
// a zero in `0 .md/.mdx file(s) read` is an alarm a reader can act on, whereas
// a zero in `0 baselined file(s)` says nothing at all.
//
// PER ROOT, not just a total. `walk()` runs behind `existsSync(root)`, so a
// root that is renamed or moved away is skipped in SILENCE, and a bare total
// hides that behind whatever the other root still contributes. Every configured
// root is therefore named on every green run — including one that contributed
// nothing, because a root omitted from the line is the same silence in a new
// place.
//
// Verdicts, populations and exit codes are untouched. This is the success text
// and nothing else: the gate refuses exactly what it refused before.

/**
 * The input volume, as one clause, shared by BOTH success paths so they cannot
 * drift apart. Derived from EXTENSIONS rather than spelling the suffixes again,
 * so widening the scan cannot leave the sentence describing the old one.
 *
 * @param {{root: string, files: number}[]} scanned per-ROOT counts, in ROOTS order
 * @returns {string}
 */
function scanClause(scanned) {
  const total = scanned.reduce((n, r) => n + r.files, 0);
  const kinds = [...EXTENSIONS].sort().join('/');
  const perRoot = scanned.map((r) => `${r.root} ${r.files}`).join(', ');
  return `${total} ${kinds} file(s) read across ${scanned.length} root(s) — ${perRoot}`;
}

/**
 * The GREEN body, named and pure so the self-test can assert on the sentence an
 * author actually reads — the counts are interpolated, so reading this file's
 * SOURCE is not evidence about the rendered text.
 *
 * @param {{root: string, files: number}[]} scanned per-ROOT counts, in ROOTS order
 * @param {Record<string, number>} ledger files still carrying the word (== the
 *   baseline on any run that reaches this line)
 * @returns {string}
 */
function successSummary(scanned, ledger) {
  const fileCount = Object.keys(ledger).length;
  const occurrences = Object.values(ledger).reduce((n, c) => n + c, 0);
  return (
    'check-role-word: OK, no new occurrences of the reserved word.\n'
    + `  Scanned: ${scanClause(scanned)}.\n`
    + `  Ledger: ${fileCount} baselined file(s) still carrying it `
    + `(${occurrences} occurrence(s)) in ${BASELINE_PATH}.`
  );
}

/**
 * The `--update` confirmation. It carries the scan clause for the same reason,
 * and with more at stake: `--update` REWRITES the baseline from the current
 * tree, so running it over a dead scan does not merely print a misleading
 * number — it writes `{}` over the ledger, and its old line (`role-word
 * baseline updated: 0 file(s).`) read exactly like a debt fully paid.
 *
 * @param {{root: string, files: number}[]} scanned per-ROOT counts, in ROOTS order
 * @param {Record<string, number>} ledger the freshly written baseline
 * @returns {string}
 */
function updateSummary(scanned, ledger) {
  return (
    `role-word baseline updated: ${Object.keys(ledger).length} file(s) baselined `
    + `from ${scanClause(scanned)}.`
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
  // if/else, not two flat asserts: a fixture that stopped being an offer would
  // ALSO fail the discrimination check, and the second failure would misdescribe
  // the cause ("the predicate is not discriminating" when the fixture is what
  // broke). Exactly one of these two can fire.
  const unmarkedOffer = `example.mdx: NEW use. add it to ${BASELINE_PATH} with --update.`;
  if (!RATCHET_EXPANSION_OFFER.test(unmarkedOffer)) {
    expect('#8435 — the synthetic unmarked-offer fixture is no longer recognised as an offer, so '
      + 'it cannot test discrimination at all. Re-spell it to match RATCHET_EXPANSION_OFFER', false);
  } else {
    expect('#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves '
      + 'the predicate discriminates rather than approving everything)',
      !ratchetRemedyCarriesAuthority(unmarkedOffer));
  }

  const ratchetDown = `content/docs/example.mdx: role-word count improved 4 → 2 — ratchet DOWN: `
    + 'run `node scripts/check-role-word.mjs --update` and commit the baseline.';
  expect('#8435 — the detector does NOT match the ratchet-DOWN message, which also names --update '
    + '(marking the improvement path maintainer-only would teach the opposite of the rule)',
    !RATCHET_EXPANSION_OFFER.test(ratchetDown) && ratchetRemedyCarriesAuthority(ratchetDown));

  // ── The green body reports what was READ (#9910) ──────────────────────
  //
  // Interpolated counts again, so the source proves nothing about the rendered
  // sentence — driven here instead, in the states that used to be identical.
  //
  // These counts are SYNTHETIC fixtures, not a reading of the tree: every
  // assertion below closes over them, so they stay correct however the real
  // corpus moves. ⛔ Do not "refresh" them to match a live scan — that would
  // turn a closed fixture into a figure the tree can falsify, which is the
  // very defect the comment sites above were cleaned of.
  const SCANNED = [{ root: 'content/docs', files: 179 }, { root: 'skills', files: 36 }];
  const DEAD_SCAN = [{ root: 'content/docs', files: 0 }, { root: 'skills', files: 0 }];
  const PAID_OFF = {};

  const greenPaid = successSummary(SCANNED, PAID_OFF);
  const greenDead = successSummary(DEAD_SCAN, PAID_OFF);

  // (1) THE property this card exists for, pinned as a property and not as
  // text: once the debt is paid — the state this ratchet is BUILT to reach — a
  // tree that was read and one that was not must not render the same success.
  // A pin on the new sentence's wording would rot at the first rephrasing, and
  // worse, a rephrasing that went back to printing only ledger numbers would
  // keep such a pin green.
  expect('#9910 — the GREEN body renders DIFFERENTLY for a scanned tree and an unscanned one '
    + 'with the ledger EMPTY (the state in which every ledger-derived number is 0 either way)',
    greenPaid !== greenDead);

  // (2) The alarm has to be legible, not merely different: (1) alone passes on
  // any two strings that differ at all.
  expect('#9910 — an unscanned tree prints a ZERO input volume a reader can act on',
    /\b0 [^\n]*file\(s\) read\b/.test(greenDead));
  expect('#9910 — a scanned tree prints its real input volume, not a ledger-derived count',
    /\b215 [^\n]*file\(s\) read\b/.test(greenPaid));

  // (3) `walk()` sits behind `existsSync(root)`, so a root that moved away is
  // skipped in silence. A line that named only the roots which contributed
  // would put that silence straight back, one root at a time.
  const oneRootGone = successSummary(
    [{ root: 'content/docs', files: 179 }, { root: 'skills', files: 0 }], PAID_OFF);
  expect('#9910 — a root that contributed NOTHING is still named, with its zero (existsSync '
    + 'skips a missing root silently, so dropping it from the line hides the same failure)',
    /\bskills 0\b/.test(oneRootGone) && oneRootGone !== greenPaid);

  // (4) The same ambiguity on the privileged path, where it is destructive
  // rather than merely misleading: `--update` rewrites the baseline from the
  // tree it just read.
  expect('#9910 — the --update confirmation states its input volume too, so re-baselining '
    + 'over a dead scan cannot read like a debt fully paid',
    updateSummary(DEAD_SCAN, PAID_OFF) !== updateSummary(SCANNED, PAID_OFF));

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-role-word --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: the NEW-use remedy marks baseline expansion as maintainer-only, the predicate '
    + 'rejects an unmarked offer, the ratchet-DOWN remedy stays the author\'s own, and both '
    + 'success texts report what was READ \u2014 so a scanned tree and an unscanned one cannot print '
    + 'the same result once the ledger is empty.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

const files = [];
/* The input volume, per root, recorded as the scan runs — the same pass, not a
 * second one. `files` is built exactly as before; only the tally is new. */
const scanned = [];
for (const root of ROOTS) {
  const before = files.length;
  if (existsSync(root)) walk(root, files);
  scanned.push({ root, files: files.length - before });
}

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
  console.log(updateSummary(scanned, current));
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
console.log(successSummary(scanned, current));
