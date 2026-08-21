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
//   • a configured ROOT does not exist — refused before anything is scanned,
//     because a verdict over the roots that DID resolve is a verdict about a
//     population nobody configured (#9932), or
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
// directory NAMES count too (they become URLs). Both roots must BE THERE — a
// configured root that does not resolve is a hard refusal, not a skip; see the
// #9932 block above `missingRoots()`.
import { spawnSync } from 'node:child_process';
import {
  readdirSync, readFileSync, writeFileSync, statSync, existsSync,
  mkdirSync, mkdtempSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['content/docs', 'skills'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
const EXTENSIONS = new Set(['.mdx', '.md']);
const BASELINE_PATH = 'scripts/role-word-baseline.json';
const WORD = /\brole(?:s)?\b/gi;

/**
 * The half of ROOTS that `scripts/pm/dispatch-gates.mjs` cannot see, written in
 * the subtree spelling that tool compares in. Provenance ONLY: nothing in this
 * gate reads this list, and the scan above behaves exactly as it did without it.
 *
 * ## The gap this closes (#9964's declaration pattern, one class over)
 *
 * That tool builds every dispatch's gate list by scanning each gate's own source
 * for the path literals it operates on, and "looks like a path" there means
 * "carries a separator". `content/docs` has one; `skills` does not, so no hint
 * was ever built for it — this gate's population reached the derivation as its
 * content half plus its baseline artifact, and a card touching only the skills
 * tree scored `silent`: not "irrelevant", but "its sources name paths, none of
 * which cover yours", which that tool's residue summary calls its weakest claim
 * and explicitly not a clearance.
 *
 * Not hypothetical. PR #10038 — a skills-only docs fix — derived a green local
 * union and met this gate as red CI (`role-word count grew 2 → 3`), costing one
 * repair round. CI enforces either way (lint.yml carries no path filter); what
 * was missing is discoverability, and this restores it.
 *
 * ## Why the subtree spelling, and not a wider extractor
 *
 * `hintCovers` refuses a bare single-segment literal (`skills`) as too generic
 * BY DESIGN, and that refusal is measured, not incidental: teaching the
 * extractor to accept bare top-level directory words was priced at +139084
 * fabricated (gate, file) pairs, because `packages`, `apps` and `examples` are
 * path COMPONENTS in dozens of gates that never read those roots. A declared
 * subtree is a different claim from a bare word — an author stating what the
 * gate reads, in the syntax the repo uses for that everywhere else — and the
 * glob collapse reduces this one back to this gate's second root and to nothing
 * else. `.claude/skills/...` is NOT under it, which is correct: ROOTS does not
 * reach there, so the tool must not name this gate for a card that edits it.
 *
 * ## Provenance, never a lookup key
 *
 * The glob form appearing in ROOTS would send the scan at a directory that does
 * not exist. That used to be a silent skip; since #9932 it is a hard refusal
 * (see the block above `missingRoots()`), so the mistake now fails the gate
 * outright instead of quietly shrinking its population — but the coupling is
 * still worth pinning, because a refusal names the wrong problem. The self-test
 * pins both halves: every separator-less ROOT is declared here, and nothing
 * declared here is itself a ROOTS entry.
 */
const ROOT_DIR_WATCH_HINTS = ['skills/**'];

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
// PER ROOT, not just a total. At the time this was written `walk()` ran behind
// `existsSync(root)`, so a root that was renamed or moved away was skipped in
// SILENCE, and a bare total hid that behind whatever the other root still
// contributed. Every configured root is therefore named on every green run —
// including one that contributed nothing, because a root omitted from the line
// is the same silence in a new place.
//
// #9932 later closed the missing-root half by refusing outright, so THAT state
// can no longer reach this line. The per-root breakdown is not thereby idle:
// its live subject is a root that EXISTS and contributed nothing — no matching
// files, or everything under SKIP_DIRS — which is still green, still invisible
// in a bare total, and the state the assertions below drive.
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
 * Since #9932 the dead scan caused by a MISSING root cannot get this far — the
 * refusal precedes the write, and the self-test pins that as byte-identity of
 * the ledger, not merely as an exit code. The residual case this clause still
 * speaks for is roots that exist and hold nothing.
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

// ── A configured ROOT that does not exist is a REFUSAL (#9932) ───────────────
//
// `walk()` used to run behind `existsSync(root)`. A root named in ROOTS but
// absent from the tree was skipped, and the gate went on to reach a verdict —
// including OK — over whatever the surviving roots contributed. #9910 made that
// condition LEGIBLE (every root is named in the Scanned line with its own
// count) and deliberately stopped there, because refusing is a verdict change
// and a verdict change is its own decision. This is that decision, taken.
//
// Measured on this file's parent commit, all three exit 0:
//
//   • No root exists — reachable with no source edit at all, by running the
//     gate from any directory that is not the repository root. It printed
//     `OK, no new occurrences` over a zero-file scan. Nothing contradicted the
//     green, because BASELINE_PATH is cwd-relative too: the ledger read as `{}`
//     and an empty ledger agrees with an empty scan.
//   • One root missing, ledger fully populated — a third ROOT pointed at a
//     directory that does not exist was named in the Scanned line with its zero
//     and the run still said OK. This is the card's headline case, and the
//     incidental protection people reach for (baselined files dropping out of
//     `current` and tripping the ratchet-DOWN branch below) never covered it: a
//     root whose ledger share is already zero takes nothing with it when it
//     goes, and every root added to ROOTS starts there by definition.
//   • `--update` with no root present — overwrote a populated ledger with `{}`
//     and exited 0. The destructive one: the confirmation line #9910 added
//     makes that readable, but readable is not refused.
//
// ## Why per-root, and not "refuse only when EVERY root is missing"
//
// The middle route was the suggested shape, and its entire justification is
// keeping the gate runnable in a PARTIAL CHECKOUT. No such caller exists. The
// gate has exactly two executing callers — the root `check:role-word` package
// script, and the `Lint & Repo Gates` step that runs it — and that job checks
// out with `actions/checkout` carrying no `sparse-checkout` filter. Nothing
// anywhere in this repo configures one. The `fetch-depth: 0` there and the
// `--depth` clones elsewhere truncate HISTORY, not the working tree, and both
// roots are TRACKED directories, so every checkout of every ref materialises
// both.
//
// So the middle route protects nobody and leaves green the one case the card
// says is not hypothetical in shape: one root gone while the others still
// report. The guard's own origin story is not the basis for this either way and
// could not be checked here if it were — `git log -S` in a depth-50 clone
// reaches only as far as the declaration commit, so "it was written for partial
// checkouts" stays an unverified reading, while the caller inventory is a fact
// about today.
//
// A root that EXISTS and contributes nothing is a DIFFERENT condition and stays
// green on purpose. That one is the zero-volume Scanned line's subject, and it
// is what the per-root #9910 assertions below now test — the missing-root state
// they were written against can no longer reach a success message at all.

/**
 * Which configured roots are absent, in ROOTS order.
 *
 * `exists` is injected so the self-test can drive every combination — all
 * present, all absent, and the PARTIAL tree that separates this shape from the
 * refuse-only-when-all-are-missing one — without building a filesystem for each.
 * The spawned legs there cover what a probe cannot: that the program consults
 * this at all.
 *
 * @param {string[]} roots
 * @param {(path: string) => boolean} [exists]
 * @returns {string[]}
 */
function missingRoots(roots, exists = existsSync) {
  return roots.filter((r) => !exists(r));
}

/**
 * The refusal's text, named and pure for the same reason as the messages above:
 * the roots are interpolated, so reading this file's SOURCE is not evidence
 * about the sentence an author actually reads.
 *
 * @param {string[]} missing
 * @returns {string}
 */
function missingRootsMessage(missing) {
  return (
    `check-role-word: configured root(s) not found — ${missing.join(', ')}. REFUSING to reach a `
    + 'verdict. A directory named in ROOTS is a declaration that it is in scope, so a scan that '
    + 'could not read it has not checked what this gate says it checks, and any verdict over the '
    + 'roots that did resolve — OK included — would be about a population nobody configured. '
    + 'Every ROOT resolves against the CURRENT WORKING DIRECTORY, so the usual cause is running '
    + 'this from somewhere other than the repository root: run `pnpm check:role-word` from there. '
    + 'If the directory moved for good, edit ROOTS in scripts/check-role-word.mjs so the gate '
    + 'declares what it actually reads. The same refusal covers `--update`, where the stake is '
    + 'higher: it rewrites the baseline from the tree it just read, so over a dead scan it would '
    + 'write an empty one and report it exactly like a debt fully paid.'
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

  // (3) A line that named only the roots which contributed would put the
  // silence straight back, one root at a time. Since #9932 a root that MOVED
  // AWAY is refused before this line renders, so what this fixture stands for
  // now is the residual case: a root that exists and contributed nothing.
  const oneRootGone = successSummary(
    [{ root: 'content/docs', files: 179 }, { root: 'skills', files: 0 }], PAID_OFF);
  expect('#9910 — a root that contributed NOTHING is still named, with its zero (a root can '
    + 'exist and read empty; dropping it from the line hides that behind the other root\'s total)',
    /\bskills 0\b/.test(oneRootGone) && oneRootGone !== greenPaid);

  // (4) The same ambiguity on the privileged path, where it is destructive
  // rather than merely misleading: `--update` rewrites the baseline from the
  // tree it just read.
  expect('#9910 — the --update confirmation states its input volume too, so re-baselining '
    + 'over a dead scan cannot read like a debt fully paid',
    updateSummary(DEAD_SCAN, PAID_OFF) !== updateSummary(SCANNED, PAID_OFF));

  // ── A missing ROOT is REFUSED, per root (#9932) ───────────────────────────
  //
  // Two layers, because either alone is vacuous in precisely the way this card
  // is about. The pure legs prove the PREDICATE discriminates; the spawned legs
  // prove the program CONSULTS it. A predicate nothing calls is the same
  // "declaration that silently self-cancels" shape the gate was carded for, and
  // it would pass every assertion an in-process fixture can make.
  //
  // Fixture roots, not real ones: these names appear nowhere else in this file,
  // so `includes()` below cannot pass on incidental prose.
  const PRESENT_ROOT = 'alpha/one';
  const ABSENT_ROOT = 'bravo-two';
  expect('#9932 — with NO root present, every one of them is reported (the total-scan case, '
    + 'measured green before this landed)',
    missingRoots([PRESENT_ROOT, ABSENT_ROOT], () => false).join(',')
      === `${PRESENT_ROOT},${ABSENT_ROOT}`);
  // THE assertion that separates this shape from "refuse only when EVERY root
  // is missing". Under that middle route, this is the line that goes red — so
  // it is also the line that records which shape was chosen and why.
  expect('#9932 — a PARTIALLY present tree is still refused, naming only the absent root '
    + '(per-root, NOT refuse-only-when-all-are-missing: no partial-checkout caller exists)',
    missingRoots([PRESENT_ROOT, ABSENT_ROOT], (r) => r === PRESENT_ROOT).join(',') === ABSENT_ROOT);
  // Discrimination. Without it, a probe that returned every root would keep both
  // assertions above green while refusing every healthy checkout in the world.
  expect('#9932 — a fully present tree is NOT refused (proves the probe discriminates rather '
    + 'than reporting everything)',
    missingRoots([PRESENT_ROOT, ABSENT_ROOT], () => true).length === 0);
  const refusal = missingRootsMessage([ABSENT_ROOT]);
  expect('#9932 — the refusal names the missing root and not the present one',
    refusal.includes(ABSENT_ROOT) && !refusal.includes(PRESENT_ROOT));

  // The spawned legs. Each builds a tree, runs THIS file inside it as a child
  // (no `--self-test`, so the child takes the normal path and terminates), and
  // reads the child's real exit status — never a pipe's.
  //
  // The trees are built FROM ROOTS rather than re-spelled, so adding or renaming
  // a root cannot leave these legs testing the population of an older file.
  const SELF = fileURLToPath(import.meta.url);
  const runIn = (cwd, args = []) => {
    const r = spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const REFUSAL_MARK = 'REFUSING to reach a verdict';
  const sandbox = mkdtempSync(join(tmpdir(), 'check-role-word-selftest-'));
  try {
    if (ROOTS.length < 2) {
      expect('#9932 — the partial-tree leg needs one root present and one absent; with fewer than '
        + 'two ROOTS it cannot test the chosen shape at all. Re-express it before shrinking ROOTS',
        false);
    } else {
      const [firstRoot, ...restRoots] = ROOTS;

      // (1) Nothing there at all — the total-scan case, measured exit 0 before.
      const noneDir = join(sandbox, 'none');
      mkdirSync(noneDir, { recursive: true });
      const none = runIn(noneDir);
      expect('#9932 — a tree where NO configured root exists is REFUSED (exit 1) and names them '
        + 'all, where it used to print OK over a zero-file scan',
        none.status === 1 && none.out.includes(REFUSAL_MARK)
          && ROOTS.every((r) => none.out.includes(r)));

      // (2) The partial tree at the PROGRAM level. This is the leg the middle
      // route fails, and the only leg that can see whether the main path
      // consults the probe at all.
      const partialDir = join(sandbox, 'partial');
      mkdirSync(join(partialDir, firstRoot), { recursive: true });
      const partial = runIn(partialDir);
      expect('#9932 — a tree missing ONE configured root is REFUSED (exit 1), names it, and does '
        + 'not name the root that resolved (the scan reached that one; it is not the problem)',
        partial.status === 1 && partial.out.includes(REFUSAL_MARK)
          && restRoots.every((r) => partial.out.includes(r))
          && !partial.out.includes(firstRoot));

      // (3) Discrimination at the program level: legs (1) and (2) would both
      // pass on a gate that refused unconditionally.
      //
      // The exit-0 half records what a root that EXISTS and holds nothing does
      // TODAY. That is the zero-volume Scanned line's subject, not this
      // refusal's, and a later card that wants to refuse that too changes this
      // line deliberately rather than discovering it went quietly green.
      const wholeDir = join(sandbox, 'whole');
      for (const r of ROOTS) mkdirSync(join(wholeDir, r), { recursive: true });
      const whole = runIn(wholeDir);
      expect('#9932 — a tree where every configured root EXISTS is not refused (a gate that '
        + 'refused unconditionally would satisfy both legs above and no healthy checkout)',
        whole.status === 0 && !whole.out.includes(REFUSAL_MARK));

      // (4) The destructive path. Pinned as "the file did not change", not
      // merely "exit 1": the claim is that the refusal happens BEFORE the write.
      const updateDir = join(sandbox, 'update');
      mkdirSync(join(updateDir, firstRoot), { recursive: true });
      mkdirSync(join(updateDir, dirname(BASELINE_PATH)), { recursive: true });
      const ledgerPath = join(updateDir, BASELINE_PATH);
      // Opaque contents on purpose. The child must refuse before it ever parses
      // this file, so byte-identity is the whole assertion — and a path-shaped
      // key here would feed the dispatch-gates hint extractor described at the
      // top of this file a literal that names no population this gate reads.
      const ledgerBefore = '{\n  "pinned": 7\n}\n';
      writeFileSync(ledgerPath, ledgerBefore);
      const updated = runIn(updateDir, ['--update']);
      expect('#9932 — `--update` over a tree with a missing root refuses BEFORE writing, leaving '
        + 'the baseline byte-identical (it used to overwrite a populated one with {} and exit 0)',
        updated.status === 1 && updated.out.includes(REFUSAL_MARK)
          && readFileSync(ledgerPath, 'utf8') === ledgerBefore);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  // ── The dispatch-gates declaration (#9964's pattern) ──────────────────────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or stale one runs green here forever and pays
  // itself out as a dev dispatched on a skills card with this gate missing from
  // the brief. The coupling is derived from ROOTS on both sides rather than
  // re-spelled, so widening or renaming a root cannot leave the declaration
  // describing the old population.
  const separatorless = ROOTS.filter((r) => !r.includes('/'));
  expect('the declaration exists for every ROOT the hint extractor cannot see (a root with no '
    + 'path separator is refused as too generic, so it needs the subtree spelling)',
    separatorless.every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
  expect('and it declares no root this gate does not walk (a declaration that can drift from the '
    + 'scan is worse than none — it replaces a silent gate with a lying one)',
    ROOT_DIR_WATCH_HINTS.every((h) => ROOTS.includes(h.replace(/\/\*+$/, ''))));
  expect('skills is the root it declares (the half PR #10038 met as red CI)',
    ROOT_DIR_WATCH_HINTS.includes('skills/**'));
  // Provenance, never a lookup key: the glob form appearing in ROOTS would send
  // the scan at a directory that does not exist. That used to be a silent skip;
  // since #9932 it is a refusal, which fails loudly but names the wrong problem.
  expect('the declared form is NOT a ROOTS entry',
    !ROOTS.some((r) => ROOT_DIR_WATCH_HINTS.includes(r)));

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-role-word --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: the NEW-use remedy marks baseline expansion as maintainer-only, the predicate '
    + 'rejects an unmarked offer, the ratchet-DOWN remedy stays the author\'s own, and both '
    + 'success texts report what was READ \u2014 so a scanned tree and an unscanned one cannot print '
    + 'the same result once the ledger is empty. Every separator-less ROOT also declares the '
    + 'subtree spelling dispatch-gates derives from, and declares nothing this gate does not '
    + 'walk. A configured ROOT that does not exist is REFUSED — per root, before the scan and '
    + 'before `--update` writes anything — proven by running this gate inside built trees, not '
    + 'by a predicate no caller has to reach.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

/* Probed for ALL roots first, so one message names every missing one rather
 * than the run dying at whichever comes first — and probed here, ahead of both
 * the scan and the `--update` write, because both are unsound over a population
 * the gate could not read. */
const absentRoots = missingRoots(ROOTS);
if (absentRoots.length) {
  console.error(missingRootsMessage(absentRoots));
  process.exit(1);
}

const files = [];
/* The input volume, per root, recorded as the scan runs — the same pass, not a
 * second one. `files` is built exactly as before; only the tally is new. */
const scanned = [];
for (const root of ROOTS) {
  const before = files.length;
  // No `existsSync` guard here any more: that skip WAS the defect, and a dead
  // guard left behind would quietly restore it the moment the refusal above is
  // moved or made conditional. A root that vanishes between the probe and this
  // line throws — loudly, which is the right direction, since the failure this
  // block exists to prevent is a silent PASS.
  walk(root, files);
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
