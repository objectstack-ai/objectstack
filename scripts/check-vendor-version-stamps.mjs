#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-vendor-version-stamps — hold every version stamp about a PINNED VENDOR
// to a shape that does not rot when the pin moves (#13940).
//
//   node scripts/check-vendor-version-stamps.mjs                # the gate
//   node scripts/check-vendor-version-stamps.mjs --list         # every stamp it can see
//   node scripts/check-vendor-version-stamps.mjs --census       # the drift census
//   node scripts/check-vendor-version-stamps.mjs --window-sweep # window sensitivity
//   node scripts/check-vendor-version-stamps.mjs --attribution-sweep  # attribution mechanisms
//   node scripts/check-vendor-version-stamps.mjs --json
//   node scripts/check-vendor-version-stamps.mjs --self-test    # verify the checker
//
// ## The class, measured four times
//
// #10073 (29 stamps naming `1.7.0-rc.2` / `1.6.20` after the `^1.7.1` bump),
// #10188 (three more, outside that card's two-string scope), #11362 (two more,
// in platform-objects rather than plugin-auth) and #13940 (95, after the 1.7.2
// move) are one defect recurring. Each was closed by a hand sweep; each time the
// next card found more. The population went 29 -> 95, so the sweep is not
// converging on a remainder — it is trailing a PRODUCER.
//
// ## What the producer actually is
//
// Not "stamps name an old version". A stamp naming an old version can be
// perfectly true:
//
//     // [#11374] Bound from better-auth 1.7.1's own MySQL schema: ...
//
// That sentence is a fact about the release 1.7.1. It was true when written, it
// is true now, and it will still be true after 1.9.0 ships. Nothing rots.
//
// The producer is the OTHER shape — a sentence that fuses a permanent fact with
// a LIVE READING of a value that moves:
//
//     // still true of the installed stable `@better-auth/scim@1.7.1`
//
// "the installed" is a present-tense claim about this tree. The moment the pin
// moves it is not stale, it is FALSE: 1.7.1 is not installed. That is the class,
// and it is why a hand sweep keeps being the remedy — every bump falsifies every
// live-reading stamp at once, and nothing but a person reading them can tell.
//
// This is the same defect PR #13962 repaired one level up, in a docblock that
// froze a reading of `cases.length`: the fix there was to stop freezing a live
// value, not to write today's value in. Same remedy here.
//
// ## ⛔ Why this gate does NOT hold stamps equal to the pin
//
// The obvious mechanism — "every stamp must name the resolved pin" — was
// designed, measured against this repo's real corpus, and REJECTED. It
// manufactures false attestations, which are strictly worse than stale ones:
//
//   - A stamp is an ATTESTATION: it claims a behaviour was MEASURED against a
//     named version. Editing the version without redoing the measurement
//     produces a claim nobody ever made. A stale stamp tells the truth about
//     when it was checked; a restamped-but-unmeasured one lies about it.
//   - Measured 2026-08-31, over the code roots and `content/docs`: of 250 stamp
//     sites this gate sees, 138 name a version other than the resolved one. 51
//     carry an anchor outright; the rest are bare facts about a named release
//     — `[#11374] Bound from better-auth 1.7.1's own MySQL schema`, true when
//     written, true now, true after 1.9.0. Forcing them to the pin would
//     fabricate that many measurements. (Those figures are a dated reading, not
//     a live one: run `--census` for today's.)
//   - Some sites are not attestations at all. It is SELF-TEST FIXTURE DATA
//     inside `check-prerelease-pin-watch.mjs` — a synthetic npm registry payload
//     whose `1.7.1` is an arbitrary input proving the watcher notices a stable
//     release. A pin-equality sweep would corrupt a gate's own test input.
//
// So the rule is about PHRASING, not about version equality:
//
//   RED    a LIVE-READING stamp (it says "installed", "resolves to", "still
//          true", "today") that names a version which is not the resolved one,
//          and carries no date anchor scoping that present tense.
//   RED    an UNANCHORED MEASUREMENT — "measured on 1.7.1", "verified against
//          1.7.1" — resting a standing claim on a reading taken against a
//          version that no longer installs, without saying when it was taken.
//          The prose root is what made this shape visible: a docs page reads
//          "better-auth declares `addMember` as a server-only API … — measured
//          on 1.7.1", and the claim in front of the evidence is present tense
//          and unqualified, so the page reads as current.
//   GREEN  an ANCHORED stamp — one carrying a measurement date or an issue
//          reference — naming ANY version. Permanently true, never swept again.
//          One anchor answers both red shapes, which is why the remedy is the
//          same sentence either way.
//
// ## ⛔ Why the prose root is not just another entry in ROOTS
//
// `content/docs` was added by #13981, and adding it was measured to be the
// smaller half of that work. The detector could SEE the docs population before
// the root existed — 15 sites over 405 files — and still could not JUDGE the
// one site that mattered, because the package name sat ~90 characters back
// across a wrapped prose line, past the character window attribution used.
// Wiring the root without repairing attribution would have produced the
// appearance of coverage over the substance of none. See the attribution
// section below for what replaced the window, and why widening it was rejected
// with numbers rather than with an argument.
//
// The consequence is the point: once a stamp is anchored it is green at every
// future bump. The population that must be touched per bump falls from "every
// stamp naming the old version" (unbounded, growing 29 -> 95) to "stamps written
// as live readings" — which this gate holds at zero from the day it lands.
//
// The version-vs-pin comparison is still MEASURED and still REPORTED (`--census`,
// and a summary line on every run), because a bump author should be able to see
// the surface they are bumping under. It is deliberately ADVISORY: a failing
// drift check has exactly one remedy an author can apply in a hurry, and that
// remedy is the false attestation above.
//
// ## Why co-occurrence in a WINDOW, and not an adjacency regex
//
// #10188 recorded the shape that is not enough, verbatim: "a `better-auth@`-only
// comment-vs-pin gate would still miss stamps written as prose". Measured on
// this corpus, the specifier spelling is the MINORITY. Real stamps include
// `better-auth 1.7.1`, `` `better-auth@1.7.1` ``, `@better-auth/sso 1.7.1`,
// `better-auth (1.7.1)`, and — the ones no adjacency regex reaches at all —
// `stable 1.7.1 still peers @better-auth/utils 0.4.2` and `installed 1.7.1
// (measured 2026-08-19, #8224)`, where the version and the package name are
// separated by a clause or a line break.
//
// So a site is a version token with a watched family name WITHIN A WINDOW, the
// design `check-corpus-claim-drift.mjs` proved on the teaching corpus.
//
// The width is swept rather than guessed, and the sweep says something different
// from what was expected. The SITE count has no plateau at all — it climbs
// monotonically (199 at width 1, 250 at 4, 349 at 20 on today's corpus), because
// a wider window always drags more version tokens near some family mention. A
// plateau there was never going to exist, and a width picked by looking for one
// would have been picked on a fiction.
//
// The number that decides anything is the FAILING set, and it is flat: 0 at
// every width from 1 to 20 (re-measured 2026-08-31, with the prose root in and
// the corpus repaired). The verdict is window-INSENSITIVE on this corpus,
// because a live-reading claim and the version it names are the same clause —
// they are never four lines apart. So the width is a cheap knob, not a
// calibration, and `--window-sweep` prints both columns so the next author can
// see which is which rather than re-deriving it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── Configuration ───────────────────────────────────────────────────────────

/**
 * The vendor families whose version stamps this gate holds.
 *
 * A family is listed here when the repo makes MEASURED claims about it in prose
 * — that is what makes a stamp an attestation rather than a dependency range.
 * `packages` is every member the repo actually stamps; better-auth moves as ONE
 * line by `pnpm-workspace.yaml`'s standing rule, so a member missing from this
 * list is a member whose stamps go unread.
 */
export const WATCHED_FAMILIES = [
  {
    id: 'better-auth',
    packages: [
      'better-auth',
      '@better-auth/core',
      '@better-auth/sso',
      '@better-auth/scim',
      '@better-auth/oauth-provider',
      '@better-auth/drizzle-adapter',
      '@better-auth/kysely-adapter',
      '@better-auth/memory-adapter',
      '@better-auth/mongo-adapter',
      '@better-auth/prisma-adapter',
      '@better-auth/telemetry',
    ],
    // The member whose resolved version the family's stamps are read against.
    pinnedBy: 'better-auth',
  },
];

const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.mjs', '.js', '.tsx']);
const PROSE_EXTENSIONS = new Set(['.mdx', '.md']);

/**
 * Where this gate reads — and, for the prose root, what it deliberately does not.
 *
 * The code roots came first because the class was found in code. They are not
 * where it does the most damage: a stale stamp in a docblock misleads the next
 * maintainer, while a stale stamp in `content/docs` is a CUSTOMER-FACING
 * attestation. That is why the prose root is here.
 *
 * ⛔ `content/docs/releases` is excluded BY CONSTRUCTION, not by oversight.
 * Release pages are written centrally at release time and are never edited by a
 * code PR — CLAUDE.md states that as a standing rule — so a red there names no
 * author who may act on it: the gate would be demanding an edit the repo
 * forbids. Measured 2026-08-31, the exclusion drops 14 of the 15 docs sites,
 * every historical one among them. That is the intended shape, and the single
 * site it leaves is the one this root exists to judge.
 */
export const ROOTS = [
  { path: 'packages', extensions: CODE_EXTENSIONS },
  { path: 'scripts', extensions: CODE_EXTENSIONS },
  { path: 'apps', extensions: CODE_EXTENSIONS },
  { path: 'examples', extensions: CODE_EXTENSIONS },
  { path: 'content/docs', extensions: PROSE_EXTENSIONS, exclude: ['content/docs/releases'] },
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.objectstack']);

/**
 * Window, in lines, within which a family name and a version token count as one
 * stamp site. 4 matches `check-corpus-claim-drift.mjs`, and `--window-sweep`
 * reports today's sensitivity: widths 1..4 are stable on this corpus and the
 * count only creeps once the window starts reaching unrelated sentences.
 */
export const WINDOW = 4;

/**
 * Present-tense claims about THIS TREE. These are the half that rots: each
 * asserts something about the version installed right now, so it is false — not
 * merely stale — the moment the pin moves past the version it names.
 */
export const LIVE_READING_MARKERS = [
  'installed',
  'resolves to',
  'resolves today',
  'still true',
  'still peers',
  'is on',
  'currently',
  'today',
  'as it stands',
];

/**
 * Phrasings that SCOPE a present-tense word to the past, so the sentence carries
 * no claim about this tree any more.
 *
 * Having a vocabulary is the point. The cheapest honest repair for a rotting
 * stamp is almost never re-running the measurement — it is saying WHEN the
 * reading was taken. "the installed better-auth 1.7.1" rots at the next bump;
 * "the then-installed better-auth 1.7.1" is true for good, and neither sentence
 * claims anything the other does not about the behaviour itself.
 */
export const HISTORICAL_SCOPE_MARKERS = [
  'then-installed',
  'then installed',
  'at the time',
  'was installed',
  'was the installed',
  'not re-measured',
  'no longer the installed',
  'as of',
  'historical',
];

/**
 * Verbs that make the version behind them the PROVENANCE OF A READING.
 *
 * This is the second rotting shape, and the docs population is what made it
 * visible. A live-reading marker asserts something about this tree in the
 * present tense ("the installed 1.7.1"). A measurement verb asserts something
 * weaker and just as perishable: that a standing claim rests on a reading taken
 * against the version named. `content/docs/permissions/authentication.mdx`
 * reads "better-auth declares `addMember` as a server-only API … — measured on
 * 1.7.1" — a customer-facing attestation whose evidence was taken on a version
 * that no longer installs, with nothing saying when. The claim in front of it
 * is present tense and unqualified, so the page reads as current.
 *
 * ⭐ Contrast, from the SAME file, and the reason this rule is positional
 * rather than a sentence-wide substring: ":1217" says "the stable `1.7.0` /
 * `1.7.1` releases renamed it back to `accountId`". That names versions as the
 * SUBJECT of a permanently true statement. It carries no measurement verb, it
 * rots never, and a gate that reported it would be inviting an author to turn a
 * true sentence into a false one.
 *
 * ⛔ The verb must GOVERN the version token, which is why this is checked over
 * the characters immediately in front of the number rather than over the whole
 * sentence. Measured: `packages/cli/src/commands/init.ts` writes "Measured on
 * the configuration the range *does* govern (…), 1.7.1 behaves identically on
 * better-sqlite3 13.0.3" — the verb is real, and what it measures is a
 * CONFIGURATION, not the version. A sentence-wide substring test reds that line;
 * a positional one leaves it alone, correctly.
 */
export const MEASUREMENT_MARKERS = [
  'measured on',
  'measured against',
  'measured with',
  'verified on',
  'verified against',
  'tested on',
  'tested against',
  'checked on',
  'checked against',
  'confirmed on',
  'confirmed against',
  'observed on',
  'benchmarked on',
];

/**
 * How many characters of flattened text may separate a measurement verb from
 * the version it governs. Wide enough for a determiner, an adjective and a
 * wrapped comment line ("measured on the\n * installed 1.7.1"); far too narrow
 * to reach across the clause in the `init.ts` counter-example above.
 */
export const MEASUREMENT_LEAD = 48;

/** Words that carry no meaning between a measurement verb and the number. */
const MEASUREMENT_FILLER = /^(?:the|a|an|our|its|their|this|that|these|those|vendor|vendor's|vendors|installed|stable|current|currently|resolved|pinned|shipped|released|latest|same|exact|then|version|release|v|on|against|both|only)$/i;

/**
 * The measurement verb governing the version at `pos`, or null.
 *
 * @param {string} text
 * @param {number} pos flat offset of the version token
 * @returns {string|null}
 */
export function measurementLead(text, pos) {
  const lead = text.slice(Math.max(0, pos - MEASUREMENT_LEAD), pos);
  const low = lead.toLowerCase();
  for (const marker of MEASUREMENT_MARKERS) {
    const at = low.lastIndexOf(marker);
    if (at === -1) continue;
    // Only filler may stand between the verb and the number. A package name
    // counts as filler ("measured against @better-auth/sso 1.7.1"); it is
    // recognised by its shape, so an ordinary noun cannot pass as one.
    const words = lead.slice(at + marker.length).replace(/[`'"()\[\],:;*_–—]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.every((w) => MEASUREMENT_FILLER.test(w) || /[-/@]/.test(w))) return marker;
  }
  return null;
}

/**
 * What makes a stamp historical, and therefore permanent. A measurement date or
 * an issue reference says WHEN the reading was taken, which is exactly the
 * coordinate a frozen version number is missing — and it is the anchor BOTH red
 * shapes are missing, so it is the one repair that answers both.
 */
export const ANCHOR_PATTERN = /\b20\d\d-\d\d-\d\d\b|#\d{3,6}\b/;

/**
 * The declaration that a version here is SYNTHETIC INPUT, not an attestation.
 *
 * Gate self-tests build fake registry payloads and fake prose to drive their own
 * assertions; those numbers are arbitrary test data, and holding them to the
 * resolved pin would corrupt another gate's fixture. #13940 measured one such
 * site inside `check-prerelease-pin-watch.mjs` — its `1.7.1` proves the watcher
 * notices a stable release and means nothing about this tree.
 *
 * It is an INLINE declaration rather than a central exemption list on purpose: a
 * central list rots away from the thing it describes, while this sits on the
 * line it excuses and says why in the same breath.
 */
export const FIXTURE_MARKER = 'vendor-stamp:fixture';

/** The verdicts that FAIL the gate. Everything else is reported, not enforced. */
export const FAILING_VERDICTS = new Set(['live-stale', 'unanchored-measurement']);

const SEMVER = /(?<prefix>[\^~>=<]\s*)?\b(?<ver>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g;

/**
 * ── Attribution: binding a version to the package it is ABOUT ──────────────
 *
 * Everything downstream is a consequence of this step. An unattributed site is
 * counted and never judged, so a stamp the gate cannot attribute is a stamp the
 * gate cannot hold — it appears in the census and is silently exempt from the
 * rule.
 *
 * The first mechanism was a character window: a name claims the first unclaimed
 * version within `CLAIM_GAP` characters. It approximates "the same sentence"
 * with a byte count, and the approximation has a measured hole. In
 * `content/docs/permissions/authentication.mdx`, "better-auth declares
 * `addMember` as a server-only API with no HTTP path of its own — measured on
 * 1.7.1" puts about 90 characters of prose between the name and the version:
 * one sentence, two tokens, no attribution. The same hole hides live-reading
 * stamps in code — `organization-add-member.ts` writes "better-auth declares
 * `addMember` WITHOUT an HTTP path — measured on the installed 1.7.1" across a
 * wrapped comment line, ~73 characters, and went unjudged for the same reason.
 *
 * ⛔ WIDENING THE WINDOW IS NOT THE REPAIR. Swept over the 5,593-file code
 * corpus on 2026-08-31, raising the gap from 60 to 120 attributed 23 further
 * sites — and among those 23, `better-call@1.3.7`, `@better-auth/utils@0.4.2`,
 * `minimatch 10.2.3` and an internal `'0.0.0-polyfill'` sentinel were each
 * bound to a watched family member that none of them is about. A wider window
 * does not see further, it sees more indiscriminately, because the mechanism
 * models only ONE claimant and every version in reach is fair game.
 *
 * So attribution is two rules, and neither of them is a width:
 *
 *   1. SENTENCE SCOPE. A name reaches to the end of its sentence and no
 *      further — a blank line, a bullet, a heading, a JSX tag, a `.` or a `;`
 *      ends the reach whether it falls at character 20 or character 200. In
 *      code that is the statement terminator, so an attribution cannot leap
 *      from one statement into the next; in prose it is the unit a reader
 *      already parses as one claim.
 *   2. NEAREST CLAIMANT WINS. Every package in this tree may claim, not only
 *      the watched ones. `better-call@1.3.7` and `minimatch 10.2.3` bind their
 *      own versions, so a watched name standing further back never reaches
 *      them, at any width. The vocabulary is read from `pnpm-lock.yaml` — the
 *      same measured ground truth the resolved pin comes from, never a hand
 *      list that can rot away from the tree.
 *
 * The two failure directions are deliberately asymmetric. A foreign claimant
 * this misses costs an attribution that would have been judged; a foreign
 * claimant it invents costs a site its verdict — and an unjudged site is this
 * gate's own documented safe state ("counted as a site and reported, never
 * judged"). Where the rules are uncertain they therefore fail toward silence,
 * never toward a false red. `--attribution-sweep` prints both mechanisms side
 * by side, with a CONTESTED column counting attributions that bind a version
 * some other package owns, so the next author can re-derive this rather than
 * trust it.
 */

/**
 * The legacy character window. No longer the mechanism; still the yardstick
 * `--attribution-sweep` measures the current one against.
 */
export const CLAIM_GAP = 60;

/**
 * A hard cap on sentence scope, in characters of flattened text.
 *
 * A sentence terminator can be missing — a table row, a minified line, a
 * comment block written without punctuation — and an unbounded reach would let
 * one such line attribute every version in it.
 *
 * This is a guard rail, not a calibration, and `--attribution-sweep` is where
 * that is checked rather than asserted: it runs the sentence mechanism at
 * several caps and prints what each one attributes and fails. Measured
 * 2026-08-31, attribution saturates at 141 sites by 240 and does not move at
 * 400 or 800, and the failing column is identical at every cap — so the number
 * below decides nothing today. It exists so that a pathological line cannot
 * make it decide everything tomorrow.
 */
export const ATTRIBUTION_REACH = 240;

/**
 * The longest `(…)` that still reads as an aside inside one sentence. Beyond
 * this a round bracket is structure — a call, a test body — not punctuation.
 */
export const PARENTHETICAL_SPAN = 200;

/**
 * Strip the decoration a comment or a doc block puts at the start of a line, so
 * the structural test below sees the sentence rather than the comment syntax.
 *
 * A JSDoc continuation (` * installed 1.7.1`) must NOT read as a new paragraph
 * — the stamps this gate exists to catch wrap across exactly those lines. The
 * price is that a Markdown bullet written `* item` loses its marker and does not
 * end a scope; `- item`, the spelling this repo's prose uses, still does.
 */
export function stripDecoration(line) {
  return line.replace(/^[ \t]*(?:\/\/+|\/\*+|\*+\/|\*)?[ \t]*/, '');
}

/** Line starts that begin a new claim regardless of punctuation. */
const STRUCTURAL_START = /^(?:#{1,6}\s|[-+]\s|\d+[.)]\s|\|\s?|<\/?[A-Za-z!]|```|:::|>\s?)/;

/**
 * Words whose trailing `.` is not a sentence end. Without these, "e.g. 1.7.1"
 * would put a boundary between a name and the version it introduces.
 */
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'eg', 'ie', 'etc', 'vs', 'cf', 'approx', 'no', 'fig', 'al', 'resp', 'ca']);

/**
 * Every position at which an attribution scope ENDS.
 *
 * @param {string} text
 * @returns {number[]} sorted flat offsets; a claim may not cross one
 */
export function attributionBoundaries(text) {
  const bounds = new Set();
  const lines = text.split('\n');
  let at = 0;
  for (const line of lines) {
    const body = stripDecoration(line).trim();
    // A blank (or decoration-only) line ends a paragraph; a structural line
    // start begins a new one.
    if (body === '' || STRUCTURAL_START.test(body)) bounds.add(at);
    at += line.length + 1;
  }

  // A terminator inside a PARENTHETICAL does not end the sentence. Measured:
  // `(server-only \`auth.api.addMember\`; measured on the installed 1.7.1)`
  // reads as one claim, and cutting it at the `;` left a live-reading stamp
  // unattributed — the very shape this gate exists to hold.
  //
  // ⛔ A running bracket DEPTH cannot express this, and the first draft of this
  // function proved it: `it('…', () => {` leaves a round bracket open for the
  // length of a test, so every terminator in the body was suppressed and one
  // comment ran on for 170 characters as a single claim. What counts is a
  // parenthetical that CLOSES — an aside inside one sentence — so only spans
  // that open and close within `PARENTHETICAL_SPAN` are honoured, and an
  // unclosed or runaway bracket is ignored entirely.
  const inAside = new Uint8Array(text.length);
  const open = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') open.push(i);
    else if (ch === ')' && open.length > 0) {
      const from = open.pop();
      if (i - from <= PARENTHETICAL_SPAN) inAside.fill(1, from, i);
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== ';') continue;
    if (inAside[i]) continue;
    // A terminator only ends a sentence when nothing but closing punctuation
    // stands between it and whitespace. `foo.bar` and `1.7.1` are untouched.
    const rest = text.slice(i + 1, i + 8);
    const tail = rest.match(/^[)\]}"'`*_,]*/)[0];
    const next = rest[tail.length];
    if (next !== undefined && next !== '' && !/\s/.test(next)) continue;
    if (ch === '.') {
      const word = text.slice(Math.max(0, i - 12), i).match(/[A-Za-z.]+$/);
      if (word && (ABBREVIATIONS.has(word[0].toLowerCase()) || word[0].length === 1)) continue;
    }
    bounds.add(i + 1);
  }
  return [...bounds].sort((a, b) => a - b);
}

/**
 * Read every package name the tree actually contains, from the lockfile.
 *
 * This is the vocabulary rule 2 needs. It is MEASURED rather than listed for
 * the same reason the resolved pin is: a hand list of "other packages that
 * appear near our stamps" would rot the moment a dependency changed, and its
 * rot would be invisible — a missing name silently restores the false
 * attribution it existed to prevent.
 *
 * @param {string} lockText contents of pnpm-lock.yaml
 * @returns {Set<string>} lowercased package names
 */
export function collectPackageNames(lockText) {
  const names = new Set();
  for (const m of lockText.matchAll(/^\s+'?((?:@[^/'\s@]+\/)?[^@'\s:]+)@\d+\.\d+\.\d+[^:']*'?:/gm)) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * The package that owns a version token by standing right in front of it.
 *
 * Two spellings, and only two. `name@1.2.3` binds whatever it names, vocabulary
 * or not — the `@` IS the binding. A bare `name 1.2.3` binds only if the tree
 * really contains a package by that name, because prose is full of words that
 * sit in front of numbers ("installed 1.7.1", "on 1.7.1", "the four resolve
 * 0.5.0") and reading those as owners would silence real stamps.
 *
 * "Immediately" allows a few characters of punctuation, because the spelling
 * that needed it is a pnpm override key: `'@better-auth/core>@better-auth/utils':
 * '0.5.0'` puts four characters between the owner and its version, and reading
 * that version as `@better-auth/core`'s — which the character window did — gets
 * the wrong side of the `>` every time.
 *
 * ⛔ Reaching FURTHER than that was tried and measured, and the trade is
 * backwards: matching any package-shaped name anywhere between the watched name
 * and the number removed five misattributions that were all already
 * `historical` — harmless — and cost one genuine `live-stale` catch, where
 * "the better-call one went with the rc pin (stable 1.7.1 …)" mentions another
 * package in passing without owning anything. The failing set is what this gate
 * decides; silence bought with a real red is not a saving.
 *
 * @returns {string|null} the owning package name, or null if nothing owns it
 */
export function nearestClaimant(flat, pos, vocabulary, familyNames) {
  const before = flat.slice(Math.max(0, pos - 80), pos);
  const m = before.match(/([@A-Za-z0-9][@A-Za-z0-9._/-]*?)(@|[\s`'"([:,=]{1,4})$/);
  if (!m) return null;
  const name = m[1];
  const lower = name.toLowerCase();
  // The family's own name is not a foreign claimant — it is THE claimant, and
  // the watched-token path is what binds it.
  if (familyNames.has(lower)) return null;
  if (m[2] === '@') return name;
  return vocabulary.has(lower) ? name : null;
}



// ── Pure analysis ───────────────────────────────────────────────────────────

/**
 * Read the resolved version of each watched family from `pnpm-lock.yaml`.
 *
 * Deliberately STATIC. Reading `node_modules` would make the gate depend on an
 * install, and a gate that cannot run without one is a gate that gets skipped;
 * the lockfile carries the same resolution and is checked in.
 *
 * @param {string} lockText contents of pnpm-lock.yaml
 * @param {string[]} packages package names to resolve
 * @returns {Map<string, string>} package name -> resolved version
 */
export function resolveInstalledVersions(lockText, packages) {
  const found = new Map();
  for (const pkg of packages) {
    // Snapshot keys look like `  better-auth@1.7.2:` / `  '@better-auth/core@1.7.2':`
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s+'?${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)'?:`, 'gm');
    const versions = new Set();
    for (const m of lockText.matchAll(re)) versions.add(m[1]);
    // EXACTLY ONE resolution, or none. A package present at two versions has no
    // single "installed version" for a stamp to be held against, and picking the
    // highest would invent one — `@better-auth/utils` really is in this tree at
    // both 0.4.2 and 0.5.0, so a stamp saying 0.4.2 is correct about one copy.
    // Ambiguity makes the stamp unjudgeable, which is a true answer; guessing
    // makes it a false red.
    if (versions.size === 1) found.set(pkg, [...versions][0]);
  }
  return found;
}

/**
 * Find every version-stamp site in one file.
 *
 * A site is a SEMVER token that has a watched family name within `window` lines.
 * Anchoring on the version rather than the package name is deliberate: the
 * version is the token that rots, and the stamps this class is about routinely
 * put the two on different lines.
 *
 * @param {string} text file contents
 * @param {{id: string, packages: string[]}} family
 * @param {{window?: number, vocabulary?: Set<string>, reach?: number, attribution?: 'sentence'|{gap: number}}} [opts]
 *   `attribution` selects the mechanism: sentence scope with foreign claimants
 *   (the default), or `{gap}` for the legacy character window, which exists so
 *   `--attribution-sweep` can measure one against the other.
 * @returns {Array<{line: number, pos: number, version: string, pkg: string|null, text: string}>}
 */
export function findStampSites(text, family, opts = {}) {
  const window = opts.window ?? WINDOW;
  const attribution = opts.attribution ?? 'sentence';
  const reach = opts.reach ?? ATTRIBUTION_REACH;
  const vocabulary = opts.vocabulary ?? new Set();
  const lines = text.split('\n');

  // Offsets so a token's flat position maps back to a line number.
  const lineStart = [];
  let acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  const lineOf = (pos) => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };

  const flat = text;
  const low = flat.toLowerCase();

  // Package-name occurrences. Longest names first so `@better-auth/core` is not
  // shadowed by the `better-auth` substring inside it.
  const names = [...family.packages].sort((a, b) => b.length - a.length);
  const pkgTokens = [];
  const taken = new Array(flat.length).fill(false);
  for (const name of names) {
    const needle = name.toLowerCase();
    let from = 0;
    for (;;) {
      const at = low.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      if (taken[at]) continue;
      // The name must stand alone. Without this, the `better-auth` substring
      // inside `@better-auth/utils` claims that OTHER package's version — which
      // read `@better-auth/utils@0.4.2` as a better-auth stamp and reported it
      // drifted from 1.7.2. A stamp about a package the gate does not resolve
      // must stay unattributed, never get re-pointed at a sibling.
      const before = at > 0 ? flat[at - 1] : '';
      const after = flat[at + needle.length] ?? '';
      if (/[A-Za-z0-9@/-]/.test(before)) continue;
      if (/[A-Za-z0-9/-]/.test(after)) continue;
      for (let k = at; k < at + needle.length; k++) taken[k] = true;
      pkgTokens.push({ kind: 'pkg', pos: at, value: name });
    }
  }

  const verTokens = [];
  for (const m of flat.matchAll(SEMVER)) {
    // A RANGE (`^1.7.2`, `>=12.0.0`) is a dependency bound, not an attestation
    // that something was measured. Judging one against a resolved version is a
    // category error — `better-auth 1.7.1 peers ^12.0.0` stamps 1.7.1 only.
    if (m.groups.prefix) continue;
    verTokens.push({ kind: 'ver', pos: m.index + (m[0].length - m.groups.ver.length), value: m.groups.ver });
  }

  const stream = [...pkgTokens, ...verTokens].sort((a, b) => a.pos - b.pos);

  const mentionsFamily = lines.map((l) => {
    const ll = l.toLowerCase();
    return names.some((n) => ll.includes(n.toLowerCase()));
  });

  const familyNames = new Set(names.map((n) => n.toLowerCase()));
  const bounds = attribution === 'sentence' ? attributionBoundaries(flat) : [];
  /** Does a scope boundary fall in `(from, to]`? */
  const crossesBoundary = (from, to) => {
    let lo = 0, hi = bounds.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bounds[mid] <= from) lo = mid + 1; else hi = mid; }
    return lo < bounds.length && bounds[lo] <= to;
  };

  const sites = [];
  let armed = null; // the most recent package name that has not yet claimed a version
  for (const tok of stream) {
    if (tok.kind === 'pkg') { armed = tok; continue; }
    let pkg = null;
    if (attribution === 'sentence') {
      const owner = nearestClaimant(flat, tok.pos, vocabulary, familyNames);
      if (owner) {
        // Another package owns this version. The armed name stops reaching:
        // a sentence that has begun naming other packages' versions is no
        // longer one claim, and reaching PAST an owned version is exactly how
        // a wider window bound `better-call@1.3.7`'s neighbour `1.4.0` to
        // `@better-auth/scim`. Silence is the safe direction here.
        armed = null;
      } else if (armed) {
        const from = armed.pos + armed.value.length;
        if (tok.pos - from <= reach && !crossesBoundary(from, tok.pos)) {
          pkg = armed.value;
          armed = null; // a name claims ONE version, then stops claiming
        }
      }
    } else if (armed && tok.pos - (armed.pos + armed.value.length) <= attribution.gap) {
      pkg = armed.value;
      armed = null;
    }
    const i = lineOf(tok.pos);
    const lo = Math.max(0, i - window);
    const hi = Math.min(lines.length - 1, i + window);
    let near = false;
    for (let j = lo; j <= hi; j++) if (mentionsFamily[j]) { near = true; break; }
    if (!near) continue;
    sites.push({
      line: i + 1,
      pos: tok.pos,
      version: tok.value,
      pkg,
      text: lines[i].trim(),
    });
  }
  return sites;
}

/**
 * Classify one site.
 *
 * `sentence` is the site's own line plus one on either side — tight on purpose.
 * A date three lines away does not scope a present-tense clause; a date in the
 * same wrapped sentence does, which is why `Measured 2026-08-20 against the
 * installed better-auth 1.7.1` is honest and permanent while `still true of the
 * installed stable @better-auth/scim@1.7.1` is not.
 *
 * @param {{line: number, version: string, window: string}} site
 * @param {string} text the whole file
 * @param {string|undefined} resolved the version installed today
 * @returns {{verdict: 'current'|'anchored'|'live-stale', live: boolean, anchored: boolean, drifted: boolean}}
 */
export function classifySite(site, text, resolvedFor) {
  const lines = text.split('\n');
  const i = site.line - 1;
  const sentence = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join(' ');
  const low = sentence.toLowerCase();
  // Scoping beats liveness: "the then-installed 1.7.1" contains the word
  // "installed" and yet claims nothing about this tree, so the scope check runs
  // first and disarms the live marker rather than fighting it.
  const scoped = HISTORICAL_SCOPE_MARKERS.some((m) => low.includes(m));
  const live = !scoped && LIVE_READING_MARKERS.some((m) => low.includes(m));
  const anchored = ANCHOR_PATTERN.test(sentence);

  // Synthetic test input, declared as such on the line it sits on.
  if (sentence.includes(FIXTURE_MARKER)) {
    return { verdict: 'fixture', live, anchored, drifted: false, resolved: undefined };
  }

  // No attributable package, or a package this gate does not resolve, means the
  // gate cannot say whether the number drifted. It is counted as a site and
  // reported, never judged — a gate that guessed here would red on
  // `better-auth 1.7.1 behaves identically on 13.0.3 and on 12.11.1`.
  const resolved = site.pkg ? resolvedFor(site.pkg) : undefined;
  if (!resolved) return { verdict: 'unattributed', live, anchored, drifted: false, resolved: undefined };

  const drifted = site.version !== resolved;
  if (!drifted) return { verdict: 'current', live, anchored, drifted, resolved, measured: null };
  if (live && !anchored) return { verdict: 'live-stale', live, anchored, drifted, resolved, measured: null };
  // The measurement rule is POSITIONAL, so it needs the token's offset. Sites
  // built by `findStampSites` always carry one; a hand-built site without one is
  // judged by the sentence-level rules alone rather than by a guessed position.
  const measured = scoped || site.pos === undefined ? null : measurementLead(text, site.pos);
  if (measured && !anchored) {
    return { verdict: 'unanchored-measurement', live, anchored, drifted, resolved, measured };
  }
  return { verdict: 'historical', live, anchored, drifted, resolved, measured };
}

/** The author-facing remedy. Three honest options; restamping is never alone. */
export function liveStaleMessage(file, site, resolved) {
  return (
    `${file}:${site.line}: LIVE-READING stamp names ${site.version}, but the resolved version is ${resolved}.\n` +
    `    ${site.text}\n` +
    `    This sentence claims something about the version installed RIGHT NOW, so it is\n` +
    `    false — not merely stale — now that the pin has moved past ${site.version}.\n` +
    `    ⛔ Do NOT just rewrite ${site.version} to ${resolved}. A stamp attests that a behaviour was\n` +
    `    MEASURED against the version it names; changing the number without redoing the\n` +
    `    measurement manufactures a claim nobody made, which is worse than a stale one.\n` +
    `    Three honest fixes:\n` +
    `      (a) re-verify the behaviour against ${resolved}, then restamp AND date it;\n` +
    `      (b) keep ${site.version} and SCOPE the sentence to when it was true — the\n` +
    `          cheapest honest repair, and it re-measures nothing. Add the measurement\n` +
    `          date or the issue reference, or write "the then-installed ${site.version}"\n` +
    `          where it now says "the installed ${site.version}" (the shape PR #13962 landed\n` +
    `          for a frozen reading of a live value). Recognised scoping words:\n` +
    `          ${HISTORICAL_SCOPE_MARKERS.slice(0, 5).join(", ")};\n` +
    `      (c) drop the version from the live clause and point at the resolved pin instead.`
  );
}

/** The author-facing remedy for an unanchored measurement. */
export function unanchoredMeasurementMessage(file, site, resolved, marker) {
  return (
    `${file}:${site.line}: MEASUREMENT stamp — "${marker} ${site.version}" — but the resolved version is ${resolved}.\n` +
    `    ${site.text}\n` +
    `    This sentence rests a standing claim on a reading taken against ${site.version}, and never\n` +
    `    says WHEN. ${site.version} is not what installs any more, so a reader cannot tell whether the\n` +
    `    claim was re-checked since or simply left behind — and on a customer-facing page that\n` +
    `    reads as a current attestation.\n` +
    `    ⛔ Do NOT just rewrite ${site.version} to ${resolved}. A stamp attests that a behaviour was\n` +
    `    MEASURED against the version it names; changing the number without redoing the\n` +
    `    measurement manufactures a claim nobody made, which is worse than a stale one.\n` +
    `    Three honest fixes:\n` +
    `      (a) re-measure against ${resolved}, then restamp AND date it;\n` +
    `      (b) ANCHOR the reading you already took — add the measurement date or the issue\n` +
    `          reference to this sentence ("${marker} ${site.version} (2026-08-31)", "(#1234)").\n` +
    `          It re-measures nothing, changes no claim, and is permanent;\n` +
    `      (c) drop the version from the claim and describe the behaviour without it.`
  );
}

export function censusLine(total, drifted, resolved, familyId) {
  return (
    `  ${familyId}: ${total} version stamp(s); resolved ${resolved}; ` +
    `${drifted} name(s) a different version, reported and not enforced.`
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────

const rel = (p) => relative(REPO_ROOT, p).split(sep).join('/');

function walk(dir, extensions, exclude, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (exclude.has(rel(p))) continue;
      walk(p, extensions, exclude, out);
    } else if (extensions.has(p.slice(p.lastIndexOf('.')))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Every file the gate reads, per root.
 *
 * ⛔ A configured exclusion that no longer names a real directory is a HARD
 * ERROR, not a no-op. `content/docs/releases` is excluded because a red there
 * names no author allowed to fix it; if that directory is renamed, a silently
 * dead exclusion would start scanning it again and demand edits CLAUDE.md
 * forbids — the failure this gate would least be able to explain.
 */
function collectFiles() {
  const files = [];
  for (const root of ROOTS) {
    const abs = join(REPO_ROOT, root.path);
    for (const ex of root.exclude ?? []) {
      if (!existsSync(join(REPO_ROOT, ex))) {
        console.error(
          `check:vendor-version-stamps: root "${root.path}" excludes "${ex}", which does not exist.\n` +
          `    An exclusion that matches nothing is not a no-op here: it means the directory moved\n` +
          `    and this gate has silently started scanning it. Point the exclusion at the new path,\n` +
          `    or drop it if the reason for it is gone.`,
        );
        process.exit(1);
      }
    }
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      walk(abs, root.extensions, new Set(root.exclude ?? []), files);
    }
  }
  files.sort();
  return files;
}

function selfTest() {
  const failures = [];
  let ran = 0;
  const check = (name, ok, detail = '') => {
    ran++;
    if (!ok) failures.push(`${name}${detail ? `\n    ${detail}` : ''}`);
  };

  const family = { id: 'better-auth', packages: ['better-auth', '@better-auth/sso'] };

  // resolveInstalledVersions
  const lock = [
    'snapshots:',
    "  '@better-auth/core@1.7.2':",
    '  better-auth@1.7.2:',

    '  unrelated@3.0.0:',
  ].join('\n');
  const resolved = resolveInstalledVersions(lock, ['better-auth', '@better-auth/core', 'nope']);
  check('resolves a bare package name', resolved.get('better-auth') === '1.7.2', String(resolved.get('better-auth')));
  check('resolves a quoted scoped name', resolved.get('@better-auth/core') === '1.7.2', String(resolved.get('@better-auth/core')));
  check('an absent package resolves to nothing', !resolved.has('nope'));
  const ambiguous = resolveInstalledVersions(
    ["  '@better-auth/utils@0.4.2':", "  '@better-auth/utils@0.5.0':"].join('\n'),
    ['@better-auth/utils'],
  );
  check('a package present at TWO versions resolves to nothing, not to a guess',
    !ambiguous.has('@better-auth/utils'), JSON.stringify([...ambiguous]));

  // findStampSites — the prose spellings an adjacency regex loses
  const prose = '// better-auth 1.7.1 reads TEST directly\n';
  check('prose spelling is a site', findStampSites(prose, family).length === 1);

  const specifier = '// `@better-auth/sso@1.7.1` accepts a schema option\n';
  check('specifier spelling is a site', findStampSites(specifier, family).length === 1);

  const split = ['// stable 1.7.1 still peers', '// @better-auth/sso at 0.4.2'].join('\n');
  const splitSites = findStampSites(split, family);
  check('a version on a DIFFERENT line from the package name is a site', splitSites.length === 2, JSON.stringify(splitSites.map((s) => s.version)));

  const paren = '// vendor: better-auth (1.7.1) — byte-identical\n';
  check('parenthesised spelling is a site', findStampSites(paren, family).length === 1);

  const unrelated = '// lodash 4.17.21 is unrelated\n';
  check('a version with no family name nearby is NOT a site', findStampSites(unrelated, family).length === 0);

  const farAway = ['// better-auth notes', '', '', '', '', '// bumped semver 9.9.9'].join('\n');
  check('a version beyond the window is NOT a site', findStampSites(farAway, family, { window: 2 }).length === 0);
  check('...and IS one when the window reaches it', findStampSites(farAway, family, { window: 5 }).length === 1);

  // classifySite — the three verdicts
  const liveStale = '// still true of the installed stable `@better-auth/scim@1.7.1`';
  const R = (v) => () => v;
  let verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, liveStale, R('1.7.2'));
  check('an unanchored live reading naming a stale version is live-stale', verdict.verdict === 'live-stale', JSON.stringify(verdict));

  const datedLive = '// Measured 2026-08-20 against the installed better-auth 1.7.1, whose handler';
  verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, datedLive, R('1.7.2'));
  check('a DATE scopes the present tense — dated live reading is anchored', verdict.verdict === 'historical', JSON.stringify(verdict));

  const issueAnchored = "// [#11374] Bound from better-auth 1.7.1's own MySQL schema";
  verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, issueAnchored, R('1.7.2'));
  check('an issue reference anchors a stamp', verdict.verdict === 'historical', JSON.stringify(verdict));

  const historicalFact = "// better-auth 1.7.1's handler skips the delete";
  verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, historicalFact, R('1.7.2'));
  check('a bare fact about a named release is NOT live-stale', verdict.verdict === 'historical', JSON.stringify(verdict));

  const current = '// the installed better-auth 1.7.2 reads TEST directly';
  verdict = classifySite({ line: 1, version: '1.7.2', pkg: 'better-auth' }, current, R('1.7.2'));
  check('a stamp naming the resolved version is current', verdict.verdict === 'current', JSON.stringify(verdict));

  // The anchor must be in the SENTENCE, not merely in the file.
  const distantAnchor = ['// #11374 something else entirely', '//', '//', '//', '// the installed better-auth 1.7.1 does X'].join('\n');
  verdict = classifySite({ line: 5, version: '1.7.1', pkg: 'better-auth' }, distantAnchor, R('1.7.2'));
  check('an anchor four lines away does NOT scope a present-tense clause', verdict.verdict === 'live-stale', JSON.stringify(verdict));

  // ── Attribution: the half a naive gate gets wrong ────────────────────────
  const multi = '// better-auth 1.7.1 behaves identically on 13.0.3 and on 12.11.1.';
  const multiSites = findStampSites(multi, family);
  check('the package name claims the FIRST version only',
    multiSites.filter((x) => x.pkg === 'better-auth').map((x) => x.version).join(',') === '1.7.1',
    JSON.stringify(multiSites));
  check('later versions on the line are unattributed, not family stamps',
    multiSites.filter((x) => x.pkg === null).map((x) => x.version).join(',') === '13.0.3,12.11.1',
    JSON.stringify(multiSites));
  check('an unattributed version is never judged',
    classifySite({ line: 1, version: '13.0.3', pkg: null }, multi, R('1.7.2')).verdict === 'unattributed');

  const ranged = '// better-auth 1.7.1 peers `^12.0.0` while the tree resolves 13.x';
  check('a caret RANGE is not a stamp',
    findStampSites(ranged, family).every((x) => x.version !== '12.0.0'),
    JSON.stringify(findStampSites(ranged, family)));

  const scoped = '// `@better-auth/sso@1.7.1` and better-auth 1.7.2 differ';
  const scopedSites = findStampSites(scoped, family);
  check('the longest package name wins over its own substring',
    scopedSites.find((x) => x.version === '1.7.1')?.pkg === '@better-auth/sso',
    JSON.stringify(scopedSites));
  check('a second name claims its own version',
    scopedSites.find((x) => x.version === '1.7.2')?.pkg === 'better-auth',
    JSON.stringify(scopedSites));

  const sibling = '// `@better-auth/utils@0.4.2`, so this skew outlives that pin';
  check('a sibling package name is NOT claimed by the `better-auth` substring in it',
    findStampSites(sibling, family).every((x) => x.pkg === null),
    JSON.stringify(findStampSites(sibling, family)));

  const scopedLive = '// Measured on the then-installed better-auth 1.7.1, whose handler';
  check('"then-installed" scopes the present tense without needing a date',
    classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, scopedLive, R('1.7.2')).verdict === 'historical');
  check('...and the remedy teaches that vocabulary',
    liveStaleMessage('a.ts', { line: 1, version: '1.7.1', text: 'x' }, '1.7.2').includes('then-installed'));

  const fixture = `// ${FIXTURE_MARKER} — synthetic registry payload\n// the installed better-auth 1.7.1 does X`;
  check('a declared fixture is not judged',
    classifySite({ line: 2, version: '1.7.1', pkg: 'better-auth' }, fixture, R('1.7.2')).verdict === 'fixture');

  // The remedy must never present restamping as the lone fix.
  const msg = liveStaleMessage('a.ts', { line: 3, version: '1.7.1', text: 'x' }, '1.7.2');
  check('remedy refuses a blind restamp', msg.includes('⛔ Do NOT just rewrite'), msg);
  check('remedy offers re-verification', /re-verify the behaviour/.test(msg));
  check('remedy offers the historical shape', /SCOPE the sentence to when it was true/.test(msg));
  check('remedy offers the live-pointer shape', /point at the resolved pin/.test(msg));
  check('remedy names why restamping is worse', /manufactures a claim nobody made/.test(msg));

  // ── Prose distance: the docs population's two buckets ───────────────────
  //
  // ⭐ These two sentences sit in ONE file, `content/docs/permissions/
  // authentication.mdx`, and they are the acceptance test for this root. One
  // must be caught and the other must be left alone; a detector that reports
  // the second is worse than no detector, because "fixing" it turns a true
  // sentence into a false one.
  const vocab = new Set(['minimatch', 'better-call', '@better-auth/utils']);
  const sitesOf = (text, opts = {}) => findStampSites(text, family, { vocabulary: vocab, ...opts });

  // BUCKET 1 — a customer-facing attestation naming a version that is no
  // longer installed. The package name is ~90 characters back, across a
  // wrapped prose line: past CLAIM_GAP, inside the sentence.
  const attestation = [
    'better-auth declares `addMember` as a **server-only** API with no HTTP path of',
    'its own — measured on 1.7.1, where `addMember` builds its endpoint with no path',
    'argument while every sibling in the same module (`/organization/remove-member`,',
  ].join('\n');
  const attestationSites = sitesOf(attestation);
  check('a prose sentence attributes across a wrapped line',
    attestationSites.length === 1 && attestationSites[0].pkg === 'better-auth',
    JSON.stringify(attestationSites));
  check('...and the distance it crossed is beyond the legacy character window',
    attestationSites[0].pos - attestation.indexOf('better-auth') - 'better-auth'.length > CLAIM_GAP,
    String(attestationSites[0].pos - 'better-auth'.length));
  check('an unanchored measurement naming a stale version is CAUGHT',
    classifySite(attestationSites[0], attestation, R('1.7.2')).verdict === 'unanchored-measurement',
    JSON.stringify(classifySite(attestationSites[0], attestation, R('1.7.2'))));

  // BUCKET 2 — correctly frozen history, in the same file. The versions are
  // the SUBJECT of a permanently true statement, not the provenance of a
  // reading, and the nearest family mention is seven lines away.
  const frozenHistory = [
    'better-auth 1.7 identifies an account by `(issuer, accountId)`. `issuer` names',
    'the authority that vouched for the row.',
    '',
    '<Callout type="warn">',
    'The account id field\'s NAME changed twice inside the 1.7 line, so read it off',
    'the version you run rather than off an older note. The `1.7.0-rc.2` pre-release',
    'renamed `accountId` → `providerAccountId`; the stable `1.7.0` / `1.7.1` releases',
    'renamed it **back to `accountId`**, keeping the new `issuer`.',
    '</Callout>',
  ].join('\n');
  const frozenSites = sitesOf(frozenHistory);
  check('frozen history far from any family mention is not even a site',
    frozenSites.every((s) => !['1.7.0', '1.7.1'].includes(s.version)),
    JSON.stringify(frozenSites.map((s) => `${s.line}:${s.version}`)));
  // ⭐ And it must survive someone widening the window later: even ATTRIBUTED,
  // the sentence carries no live reading and no measurement verb, so it can
  // never be reported.
  const frozenNear = [
    'better-auth 1.7 identifies an account by `(issuer, accountId)`.',
    'The `1.7.0-rc.2` pre-release renamed `accountId` → `providerAccountId`; the',
    'stable `1.7.0` / `1.7.1` releases renamed it **back to `accountId`**.',
  ].join('\n');
  //
  // ⛔ Each site is judged with the attribution FORCED on. Left to itself this
  // sentence is unattributed, and an unattributed site is never reported for a
  // reason that has nothing to do with its phrasing — so the pin would pass
  // even if the classifier had been taught to red it. Forcing `pkg` is what
  // makes this a test of the RULE rather than of the attribution.
  const frozenSites2 = sitesOf(frozenNear, { window: 20 });
  check('the frozen sentence really does contain version tokens to judge',
    frozenSites2.length >= 3, JSON.stringify(frozenSites2.map((s) => s.version)));
  for (const s of frozenSites2) {
    const forced = classifySite({ ...s, pkg: 'better-auth' }, frozenNear, R('1.7.2'));
    check(`frozen history is never reported, even attributed (${s.version})`,
      !FAILING_VERDICTS.has(forced.verdict), JSON.stringify(forced));
  }

  // Two names near one version: the LAST name before it claims it.
  const twoNames = [
    'The SDK ships as better-auth and the SSO surface as `@better-auth/sso` —',
    'measured on 1.7.1, whose endpoint list is unchanged.',
  ].join('\n');
  check('the nearest preceding family name wins, not the first in the sentence',
    sitesOf(twoNames).find((s) => s.version === '1.7.1')?.pkg === '@better-auth/sso',
    JSON.stringify(sitesOf(twoNames)));

  // ── Sentence scope ───────────────────────────────────────────────────────
  const stopped = 'better-auth mounts the route itself. Node 20.11.0 is the floor.';
  check('a full stop ends the reach, however close the number is',
    sitesOf(stopped).every((s) => s.pkg === null), JSON.stringify(sitesOf(stopped)));

  const blankLine = ['better-auth mounts the route itself', '', 'The floor is 20.11.0'].join('\n');
  check('a blank line ends the reach', sitesOf(blankLine).every((s) => s.pkg === null),
    JSON.stringify(sitesOf(blankLine)));

  const bullet = ['better-auth notes:', '- the floor is 20.11.0'].join('\n');
  check('a bullet starts a new claim', sitesOf(bullet).every((s) => s.pkg === null),
    JSON.stringify(sitesOf(bullet)));

  // ⛔ A terminator inside a parenthetical does NOT end the sentence — the
  // shape that hid a live-reading stamp until this was fixed.
  const aside = [
    '// better-auth declares `addMember`',
    '// WITHOUT an HTTP path (server-only `auth.api.addMember`; measured on the',
    '// installed 1.7.1), so the catch-all never mounts it.',
  ].join('\n');
  const asideSite = sitesOf(aside).find((s) => s.version === '1.7.1');
  check('a `;` inside a parenthetical does not end the sentence',
    asideSite?.pkg === 'better-auth', JSON.stringify(sitesOf(aside)));
  check('...and the live reading it hid is now caught',
    classifySite(asideSite, aside, R('1.7.2')).verdict === 'live-stale');

  const runaway = ['it(\'a test\', () => {', '  // better-auth notes; the floor is 20.11.0 here'].join('\n');
  check('an UNCLOSED bracket is structure, not a parenthetical, so terminators still end sentences',
    attributionBoundaries(runaway).some((b) => b > runaway.indexOf('notes;') && b <= runaway.indexOf('20.11.0')),
    JSON.stringify(attributionBoundaries(runaway)));

  // ── Nearest claimant wins ────────────────────────────────────────────────
  const otherSpecifier = '// better-auth 1.7.2 peers an exact `better-call@1.3.7` in the rc line';
  check('a `name@version` specifier binds its own version, not a watched name\'s',
    sitesOf(otherSpecifier).find((s) => s.version === '1.3.7')?.pkg === null,
    JSON.stringify(sitesOf(otherSpecifier)));

  const otherProse = "// better-auth notes that an exact STABLE pin is not watched (minimatch 10.2.3)";
  check('a package name from the tree claims the number in front of it',
    sitesOf(otherProse).find((s) => s.version === '10.2.3')?.pkg === null,
    JSON.stringify(sitesOf(otherProse)));

  const overrideKey = "  '@better-auth/sso>@better-auth/utils': '0.5.0',";
  check('an override key binds the version to the RIGHT side of the `>`',
    sitesOf(overrideKey).every((s) => s.pkg === null), JSON.stringify(sitesOf(overrideKey)));

  const notAPackage = '// better-auth: the installed 1.7.1 reads TEST directly';
  check('an ordinary word in front of a number is NOT a claimant',
    sitesOf(notAPackage).find((s) => s.version === '1.7.1')?.pkg === 'better-auth',
    JSON.stringify(sitesOf(notAPackage)));

  check('the lockfile vocabulary is read from its snapshot keys',
    (() => {
      const v = collectPackageNames(["  better-call@1.4.0:", "  '@better-auth/utils@0.5.0':"].join('\n'));
      return v.has('better-call') && v.has('@better-auth/utils');
    })());

  // ── The measurement rule is POSITIONAL ───────────────────────────────────
  const measuredSomethingElse = [
    '// Measured on the configuration the range *does* govern (better-auth\'s own',
    '// Kysely dialect: migrations, sign-up, sign-in, adapter find/update/delete),',
    '// 1.7.1 behaves identically on 13.0.3 and on 12.11.1.',
  ].join('\n');
  for (const s of sitesOf(measuredSomethingElse)) {
    check(`a measurement verb that governs something else is not a stamp claim (${s.version})`,
      classifySite(s, measuredSomethingElse, R('1.7.2')).verdict !== 'unanchored-measurement',
      JSON.stringify(classifySite(s, measuredSomethingElse, R('1.7.2'))));
  }

  const measuredDated = '// better-auth: measured on 1.7.1 (2026-08-19), the handler skips the delete';
  check('a dated measurement is anchored, so permanent',
    classifySite(sitesOf(measuredDated)[0], measuredDated, R('1.7.2')).verdict === 'historical');

  const measuredScoped = '// better-auth: measured on the then-installed 1.7.1, the handler skips it';
  check('a scoped measurement claims nothing about this tree',
    classifySite(sitesOf(measuredScoped)[0], measuredScoped, R('1.7.2')).verdict === 'historical');

  const measuredCurrent = '// better-auth: measured on 1.7.2, the handler skips the delete';
  check('a measurement naming the resolved version is current',
    classifySite(sitesOf(measuredCurrent)[0], measuredCurrent, R('1.7.2')).verdict === 'current');

  check('the remedy for an unanchored measurement never presents restamping alone',
    (() => {
      const m = unanchoredMeasurementMessage('a.mdx', { line: 1, version: '1.7.1', text: 'x' }, '1.7.2', 'measured on');
      return m.includes('⛔ Do NOT just rewrite') && /ANCHOR the reading you already took/.test(m);
    })());

  // ── Structure ────────────────────────────────────────────────────────────
  check('every site carries the offset the positional rules need',
    sitesOf(attestation).every((s) => typeof s.pos === 'number'));

  const proseRoot = ROOTS.find((r) => r.path === 'content/docs');
  check('the prose root is wired', Boolean(proseRoot), JSON.stringify(ROOTS.map((r) => r.path)));
  check('⛔ content/docs/releases is excluded BY CONSTRUCTION',
    proseRoot?.exclude?.includes('content/docs/releases'), JSON.stringify(proseRoot?.exclude));
  check('...and the excluded directory still exists, so the exclusion is not silently dead',
    existsSync(join(REPO_ROOT, 'content/docs/releases')));

  // The gate offers no ratchet, ledger or baseline — nothing to weaken.
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  check(
    'this gate offers no baseline/ledger expansion remedy',
    !/add (?:it|the file|this) to\s+\S*(?:baseline|ledger)/i.test(src),
  );

  if (failures.length > 0) {
    console.error(`\ncheck-vendor-version-stamps --self-test: ${failures.length} failure(s).\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  // A COUNT, read from the run — never a literal. Freezing a reading of a live
  // value is the exact defect this gate exists to stop, and a self-test summary
  // that carries one would be the gate committing it in its own voice.
  console.log(`check-vendor-version-stamps --self-test: ${ran} checks pass.`);
  process.exit(0);
}

// ── Entry point ─────────────────────────────────────────────────────────────
//
// ONE guard around the WHOLE chain, per the #4690 convention. This file exports
// its analysis functions so other tools and its own self-test can drive them,
// and a scripts/** module that exports bindings can be imported FOR those
// exports — at which point an unguarded top level runs inside the importer and
// can end it mid-import, with exit 0. `isEntrypoint` is the shared answer to
// "was I run, or imported?"; a hand-typed argv comparison gets it wrong through
// a symlink, silently.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();

  // ── Main ────────────────────────────────────────────────────────────────────

  const listMode = process.argv.includes('--list');
  const censusMode = process.argv.includes('--census');
  const jsonMode = process.argv.includes('--json');
  const sweepMode = process.argv.includes('--window-sweep');
  const attributionSweepMode = process.argv.includes('--attribution-sweep');

  const lockPath = join(REPO_ROOT, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    console.error('check:vendor-version-stamps: pnpm-lock.yaml not found — cannot resolve any pin.');
    process.exit(1);
  }
  const lockText = readFileSync(lockPath, 'utf8');

  const files = collectFiles();
  // The vocabulary rule 2 of the attribution model needs: every package name the
  // tree actually contains, so a version another package owns is never claimed
  // by a watched name standing further back.
  const vocabulary = collectPackageNames(lockText);

  const SELF = join(REPO_ROOT, 'scripts', 'check-vendor-version-stamps.mjs');

  const errors = [];
  const report = [];
  let scanned = 0;

  for (const family of WATCHED_FAMILIES) {
    const resolvedMap = resolveInstalledVersions(lockText, family.packages);
    const resolved = resolvedMap.get(family.pinnedBy);
    if (!resolved) {
      console.error(
        `check:vendor-version-stamps: family "${family.id}" resolves to nothing in pnpm-lock.yaml.\n` +
        `    Its pinnedBy member is "${family.pinnedBy}". Either the family left the tree — in which\n` +
        `    case remove it from WATCHED_FAMILIES — or the member was renamed.`,
      );
      process.exit(1);
    }

    const sites = [];
    for (const file of files) {
      if (file === SELF) continue;
      const text = readFileSync(file, 'utf8');
      scanned++;
      for (const site of findStampSites(text, family, { window: WINDOW, vocabulary })) {
        const verdict = classifySite(site, text, (pkg) => resolvedMap.get(pkg));
        sites.push({ file: rel(file), ...site, ...verdict, window: undefined });
      }
    }

    if (sweepMode) {
      console.log(`\nwindow sweep — ${family.id}`);
      for (const w of [1, 2, 3, 4, 6, 8, 12, 20]) {
        let n = 0;
        let failing = 0;
        for (const file of files) {
          if (file === SELF) continue;
          const text = readFileSync(file, 'utf8');
          for (const site of findStampSites(text, family, { window: w, vocabulary })) {
            n++;
            if (FAILING_VERDICTS.has(classifySite(site, text, (pkg) => resolvedMap.get(pkg)).verdict)) failing++;
          }
        }
        // Both numbers, because only the second one is a DECISION. The site count
        // climbs with any window — more tokens fall near a family mention — so a
        // plateau in it was never going to exist. What the width has to leave
        // alone is the FAILING set, and that is what this column reports.
        console.log(`  window ${String(w).padStart(2)}: ${String(n).padStart(4)} site(s), ${failing} failing`);
      }
      continue;
    }

    if (attributionSweepMode) {
      // Both mechanisms, one table. CONTESTED counts attributions binding a
      // version some OTHER package in this tree owns — the false-attribution
      // column, measured rather than argued.
      console.log(`\nattribution sweep — ${family.id}`);
      const familyNames = new Set(family.packages.map((p) => p.toLowerCase()));
      const measure = (label, attribution, reach) => {
        let total = 0, attributed = 0, contested = 0, failing = 0;
        for (const file of files) {
          if (file === SELF) continue;
          const text = readFileSync(file, 'utf8');
          for (const site of findStampSites(text, family, { window: WINDOW, vocabulary, attribution, reach })) {
            total++;
            if (site.pkg) {
              attributed++;
              if (nearestClaimant(text, site.pos, vocabulary, familyNames)) contested++;
            }
            if (FAILING_VERDICTS.has(classifySite(site, text, (pkg) => resolvedMap.get(pkg)).verdict)) failing++;
          }
        }
        console.log(
          `  ${label.padEnd(22)}: ${String(total).padStart(4)} site(s), ${String(attributed).padStart(4)} attributed, ` +
          `${String(contested).padStart(3)} contested, ${failing} failing`,
        );
      };
      for (const gap of [60, 75, 90, 120, 200, 400]) measure(`legacy char-gap ${gap}`, { gap });
      // The sentence mechanism at several caps. The cap is a guard rail against
      // a line with no punctuation, so what it must NOT do is decide anything:
      // read the failing column across these rows, not the site count.
      for (const reach of [120, 240, 400, 800]) measure(`sentence, reach ${reach}`, 'sentence', reach);
      continue;
    }

    const drifted = sites.filter((s) => s.drifted);
    const liveStale = sites.filter((s) => s.verdict === 'live-stale');
    const unanchoredMeasurements = sites.filter((s) => s.verdict === 'unanchored-measurement');
    report.push({
      family: family.id,
      resolved,
      total: sites.length,
      drifted: drifted.length,
      liveStale: liveStale.length,
      unanchoredMeasurements: unanchoredMeasurements.length,
      sites,
    });

    for (const s of liveStale) errors.push(liveStaleMessage(s.file, s, s.resolved));
    for (const s of unanchoredMeasurements) errors.push(unanchoredMeasurementMessage(s.file, s, s.resolved, s.measured));

    if (listMode || censusMode) {
      console.log(`\n${family.id} — resolved ${resolved}`);
      const shown = censusMode ? drifted : sites;
      for (const s of shown) {
        console.log(`  [${s.verdict.padEnd(12)}] ${s.file}:${s.line}  ${s.pkg ?? '(unattributed)'}@${s.version}  ${s.text.slice(0, 88)}`);
      }
    }
  }

  if (sweepMode || attributionSweepMode) process.exit(0);

  if (jsonMode) {
    // `process.exitCode`, never `process.exit()`. stdout to a PIPE is async, so
    // exiting immediately after a large write truncates it — measured here: the
    // JSON came back cut mid-string at ~65KB through a pipe while the identical
    // run redirected to a file was complete. A gate whose machine-readable output
    // is silently short under exactly the usage that consumes it is worse than one
    // with no JSON mode at all.
    console.log(JSON.stringify({ scanned, report }, null, 2));
    process.exitCode = errors.length > 0 ? 1 : 0;
  }

  if (jsonMode) {
    // nothing further to print; the JSON above is the whole report
  } else if (errors.length > 0) {
    console.error(`\ncheck:vendor-version-stamps: ${errors.length} stamp(s) name a version that is not installed, in a sentence that does not survive the pin having moved.\n`);
    for (const e of errors) console.error(`  ✗ ${e}\n`);
    process.exitCode = 1;
  } else {
    console.log(`check:vendor-version-stamps: OK — ${scanned} file(s) scanned.`);
    for (const r of report) console.log(censusLine(r.total, r.drifted, r.resolved, r.family));
    console.log(
    '  A drifted stamp is REPORTED, never enforced. Every one that reaches this line is a fact\n' +
    '  about a named release, or carries a measurement date or issue reference — the shapes that\n' +
    '  rot were already failures above. Restamping the rest without re-measuring would manufacture\n' +
      '  attestations. Re-verify one and you may restamp it; otherwise it stays a historical fact.',
    );
  }
}
