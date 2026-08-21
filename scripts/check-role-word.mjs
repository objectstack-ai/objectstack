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

// ── The vendor-wire fence exemption (#10533) ─────────────────────────────────
//
// Maintainer ruling, 2026-08-21 — 「其他接受」 — accepting option B: the ratchet
// gains a narrowly-scoped exemption for upstream-owned vocabulary appearing
// inside fenced code blocks marked as vendor wire payloads; prose remains fully
// ratcheted (ADR-0090 D3's actual target).
//
// This is NOT an amendment to D3. D3's own Word ban paragraph already carves the
// boundary out in its own words:
//
//   "Single documented exception: the better-auth boundary — `sys_member.role`
//    is third-party schema we do not own; it remains…"
//
// D3 reserves the word in "identifiers, UI copy, and documentation", and what it
// is aimed at is ObjectStack PROSE reaching for the word where `permission_set` /
// `position` / `business_unit` is meant. A JSON body quoting a third party's
// literal wire key is not that and never was — but a per-file EXACT ratchet has
// no way to say so. It can only say "frozen count", and because it is per-file
// and exact, NO file anywhere has spare budget: the corpus cannot gain a single
// new occurrence, in any file, by any author who is not the maintainer.
//
// Measured, not hypothetical. `POST /api/v1/auth/organization/add-member` reads
// `body.role` (`readRole()` in packages/plugins/plugin-auth/src/organization-add-member.ts)
// and — unlike `userId` / `organizationId` / `teamId` — carries no snake_case
// alias, so the wire name is that word and nothing else. #10050 had to document a
// REQUIRED parameter without naming it. Adding it to the `http` fence that page
// already has moved content/docs/permissions/authentication.mdx 4 → 5 and this
// gate refused: `role-word count grew 4 → 5`.
//
// ## What bounds the exemption is the MARKING, not the fence
//
// Keying on "is a fenced block" would exempt every code block in the corpus —
// materially broader than what was accepted, and it would take the ratchet's
// teeth out of every example in every page. A block is exempt only when it is
// CLAIMED, one block at a time, by a marker line written directly above it. So
// the exemption's entire surface is greppable (`git grep os:vendor-wire`), every
// use of it is a reviewable line in a diff rather than a property of a file's
// shape, and the count of blocks it covers is printed on every run (see
// `exemptClause`) instead of having to be rediscovered.
//
// The marker also names WHICH upstream it claims, and that vendor must be one
// this repo has actually decided about (VENDOR_BOUNDARIES). D3 documents exactly
// one, so a second boundary is a decision — taken by editing this file under
// review, never by an author typing a new word into a docs page. That is the
// difference between an exemption with a floor and an exemption that widens
// itself.
//
// ## Deliberately NOT extended to inline code spans
//
// A backticked word in a sentence is prose with backticks around it; inline code
// is everywhere, and exempting it would leave the ratchet with nothing. A prose
// mention still costs a baselined occurrence — including the route path
// `/organization/update-member-role` written into a sentence, which the card
// names as a second-order bite. The remedy there is the same one every author
// has: put the wire shape in a marked fence, where a URL belongs anyway.

/**
 * The claim token. Spelled ONCE — every matcher, message and self-test derives
 * from it, so renaming it cannot leave a diagnostic pointing at a marker that
 * nothing recognises any more.
 *
 * It deliberately contains no form of the reserved word. A marker that matched
 * WORD would contribute one occurrence per marked block and defeat itself, which
 * is why the `<!-- role-word: … -->` spelling floated on the card is not the one
 * used here: `\brole\b` matches inside `role-word` (the hyphen is a word
 * boundary), so every marker would have paid for itself.
 */
const VENDOR_WIRE_TOKEN = 'os:vendor-wire';

/**
 * The upstreams whose wire vocabulary this repo has decided to carry literally.
 * ADR-0090 D3 documents exactly one. Adding an entry is a deliberate, reviewable
 * edit to this gate — which is the point: it keeps the exemption's blast radius
 * in source, where review can see it, rather than in author discipline.
 */
const VENDOR_BOUNDARIES = new Set(['better-auth']);

// Comment syntax per EXTENSION, not per root. MDX has no HTML comments —
// fumadocs-mdx fails the build outright on `<!-- … -->` ("Unexpected character
// `!`… to create a comment in MDX, use `{/* text */}`") — while the MDX
// expression form in a plain `.md` file renders as literal text. The marker
// follows each format's own syntax, exactly as the `os:check` convention already
// does; the reference implementation is
// packages/spec/scripts/check-skill-examples.ts.
//
// Line comments, not a JSDoc block, on purpose: the MDX spelling ENDS in the
// two characters that close a block comment, so quoting it inside one truncates
// the comment mid-sentence and the file stops parsing. The reference above is
// written this way for the same reason.
//
// Keyed by extension rather than by root because EXTENSIONS admits both kinds
// under either ROOT: a `.md` file added under content/docs must take the `.md`
// spelling, and a root-keyed table would hand it the one that breaks.
const MARKER_SYNTAX = {
  '.md': { open: '<!--', close: '-->' },
  '.mdx': { open: '{/*', close: '*/}' },
};

/** `.mdx` or `.md`, for a path this gate walked (EXTENSIONS admits only those). */
function extensionOf(file) {
  return file.endsWith('.mdx') ? '.mdx' : '.md';
}

/** The marker an author writes, rendered for one extension. */
function markerFor(ext, vendor) {
  const s = MARKER_SYNTAX[ext];
  return `${s.open} ${VENDOR_WIRE_TOKEN} ${vendor} ${s.close}`;
}

/**
 * Does this line ATTEMPT the claim? Deliberately generous — any comment carrying
 * the token, in either format, naming any vendor word at all.
 *
 * Generosity is the fail-safe direction. A line this recognises but
 * `vendorWireClaim()` refuses becomes a LOUD orphan; a line neither recognises is
 * a marker that silently checks nothing while reading as intentional, which is
 * strictly the worse failure. `check-skill-examples.ts` reached the same split
 * for `os:check`, and for the same reason.
 */
function looksLikeVendorWireClaim(line) {
  const t = line.trim();
  if (!t.includes(VENDOR_WIRE_TOKEN)) return false;
  return (t.startsWith('<!--') && t.endsWith('-->'))
    || (t.startsWith('{/*') && t.endsWith('*/}'));
}

/**
 * The vendor this line claims, or null if it opts nothing in. All three
 * conditions are required, and each one is a way the exemption could otherwise
 * widen by accident: the exact comment syntax for THIS extension, exactly the
 * token plus exactly one vendor word, and that vendor declared in
 * VENDOR_BOUNDARIES.
 *
 * @param {string} line
 * @param {string} ext
 * @returns {string | null}
 */
function vendorWireClaim(line, ext) {
  const syntax = MARKER_SYNTAX[ext];
  if (!syntax) return null;
  const t = line.trim();
  if (!t.startsWith(syntax.open) || !t.endsWith(syntax.close)) return null;
  const inner = t.slice(syntax.open.length, t.length - syntax.close.length).trim();
  const parts = inner.split(/\s+/);
  if (parts.length !== 2 || parts[0] !== VENDOR_WIRE_TOKEN) return null;
  return VENDOR_BOUNDARIES.has(parts[1]) ? parts[1] : null;
}

/**
 * An opening code fence, CommonMark-shaped: up to three spaces of indent (58 of
 * them in today's corpus, inside list items), a run of three or more backticks,
 * and an info string that may not itself contain a backtick.
 */
const FENCE_OPEN = /^ {0,3}(`{3,})([^`]*)$/;

/**
 * Every vendor-wire exemption in one file, plus the two ways a marker can be
 * present and mean nothing.
 *
 * The backtick RUN LENGTH is tracked, not just "a fence": today's corpus holds
 * four ```` fences that wrap ``` examples, and a closer that ignored length
 * would end such a block on its own contents — scoping the exemption to a
 * fragment of what the author claimed, or past it.
 *
 * @param {string} text
 * @param {string} ext
 * @returns {{blocks: number, occurrences: number, orphans: number[], unterminated: number[]}}
 */
function analyzeVendorWire(text, ext) {
  const lines = text.split('\n');
  const inFence = new Array(lines.length).fill(false);
  const claimed = new Set();
  const orphans = [];
  const unterminated = [];
  let blocks = 0;
  let occurrences = 0;

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) continue;
    const run = open[1].length;
    const closeFence = new RegExp(`^ {0,3}\`{${run},}[ \\t]*$`);
    let end = i + 1;
    while (end < lines.length && !closeFence.test(lines[end])) end++;
    const vendor = i > 0 && !inFence[i - 1] ? vendorWireClaim(lines[i - 1], ext) : null;
    if (vendor) {
      if (end >= lines.length) {
        // An unclosed fence runs to the end of the document (CommonMark), so
        // honouring this marker would exempt the whole remainder of the file
        // from one line — the silent widening this whole design exists to
        // prevent. Refused instead, and named.
        unterminated.push(i + 1);
      } else {
        claimed.add(i - 1);
        blocks += 1;
        for (let b = i + 1; b < end; b++) occurrences += countMatches(lines[b]);
      }
    }
    for (let s = i; s < Math.min(end + 1, lines.length); s++) inFence[s] = true;
    i = end;
  }

  for (let i = 0; i < lines.length; i++) {
    // Top level only. A marker shown INSIDE a fence is example text, and this
    // gate's own convention has to be documentable — in these very roots —
    // without the documentation tripping it.
    if (inFence[i] || claimed.has(i)) continue;
    if (looksLikeVendorWireClaim(lines[i])) orphans.push(i + 1);
  }

  return { blocks, occurrences, orphans, unterminated };
}

/**
 * A marker that opts nothing in is an ERROR, not a no-op. It reads as
 * intentional — someone believed the block below it was covered — while the
 * block is still counted, so the author meets a "count grew" verdict that names
 * neither the marker nor the reason it did not take.
 *
 * @param {string} file
 * @param {number} line
 * @param {string} ext
 * @returns {string}
 */
function orphanMarkerMessage(file, line, ext) {
  return (
    `${file}:${line}: a ${VENDOR_WIRE_TOKEN} marker that opts NOTHING in. It must be the line `
    + 'IMMEDIATELY above an opening code fence (no blank line between), spelled for this file '
    + `type — ${markerFor(ext, '<vendor>')} — and name exactly one declared vendor boundary `
    + `(${[...VENDOR_BOUNDARIES].join(', ')}). A placed-but-inert marker is worse than no marker: `
    + 'it reads as intentional while the block it claims is still fully counted.'
  );
}

/**
 * @param {string} file
 * @param {number} line
 * @returns {string}
 */
function unterminatedFenceMessage(file, line) {
  return (
    `${file}:${line}: a ${VENDOR_WIRE_TOKEN} marker claims a code fence that is never closed. `
    + 'An unclosed fence runs to the end of the document, so honouring it would exempt the whole '
    + 'rest of the file from a single marker. Close the fence.'
  );
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
    + 'ADR-0090 D3: use permission_set / position / business_unit. That is the fix. '
    + `If instead this is a third party's literal WIRE key, put it in a fenced code block and `
    + `mark that block \`${markerFor(extensionOf(file), '<vendor>')}\` on the line directly above `
    + `the opening fence (declared boundaries: ${[...VENDOR_BOUNDARIES].join(', ')}); prose stays `
    + `ratcheted either way. Those two are the paths you can take on your own. `
    + `${RATCHET_AUTHORITY_MARKER}, NOT a co-equal third: for a genuine boundary that is NOT a `
    + 'fenced wire payload (ARIA, quoted history), add it to '
    + `${BASELINE_PATH} by running \`node scripts/check-role-word.mjs --update\`. The gated thing `
    + 'is that ACT, not the file — `--update` rewrites the whole baseline from the current tree, '
    + 'so it admits your occurrence and re-baselines every other file in one stroke. The baseline '
    + 'is shrink-only, so this weakens a ratchet and needs a maintainer to agree the boundary is '
    + 'genuine first — do not take this path to get CI green.'
  );
}

/**
 * The count-GREW verdict, named and pure for the same reason as the message
 * above — and newly so. It used to be built inline, which is exactly why the
 * defect this gate was carded for was invisible from here: the author of a
 * vendor wire payload met "New occurrences are banned" with no reachable remedy
 * named at all, and the only one that existed was the maintainer's.
 *
 * It deliberately does NOT offer the baseline path. `RATCHET_EXPANSION_OFFER`
 * keys on that offer, so a message that named it would need the authority
 * marker; the point of this one is that the author now HAS a path of their own.
 *
 * @param {string} file
 * @param {number} allowed
 * @param {number} count
 * @returns {string}
 */
function grewMessage(file, allowed, count) {
  return (
    `${file}: role-word count grew ${allowed} → ${count}. New occurrences are banned `
    + '(ADR-0090 D3): use permission_set / position / business_unit. If the new occurrence is a '
    + `third party's literal WIRE key, put it in a fenced code block and mark that block `
    + `\`${markerFor(extensionOf(file), '<vendor>')}\` on the line directly above the opening `
    + `fence (declared boundaries: ${[...VENDOR_BOUNDARIES].join(', ')}). Prose — including a `
    + 'route path written into a sentence — stays ratcheted; put the wire shape in the fence.'
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
 * What the scan did NOT count, as one clause, shared by both success paths for
 * the reason `scanClause` is (#10533).
 *
 * The #9910 principle this follows: a run reports what it READ, because a number
 * derived only from the ledger cannot tell a reader whether the population moved
 * underneath it. The vendor-wire exemption creates a second such blind spot — a
 * suppressed occurrence is invisible in every ledger number and in the file
 * count alike — so the volume is stated outright on every run. It is the answer
 * to "how far has this widened?", printed rather than rediscovered, and a zero
 * here is as informative as a large number: it says no block in the corpus
 * claims the boundary at all.
 *
 * @param {{blocks: number, occurrences: number}} exempt
 * @returns {string}
 */
function exemptClause(exempt) {
  return (
    `${exempt.blocks} ${VENDOR_WIRE_TOKEN} block(s) suppressed ${exempt.occurrences} `
    + 'occurrence(s)'
  );
}

/**
 * The GREEN body, named and pure so the self-test can assert on the sentence an
 * author actually reads — the counts are interpolated, so reading this file's
 * SOURCE is not evidence about the rendered text.
 *
 * @param {{root: string, files: number}[]} scanned per-ROOT counts, in ROOTS order
 * @param {Record<string, number>} ledger files still carrying the word (== the
 *   baseline on any run that reaches this line)
 * @param {{blocks: number, occurrences: number}} exempt vendor-wire suppressions
 * @returns {string}
 */
function successSummary(scanned, ledger, exempt) {
  const fileCount = Object.keys(ledger).length;
  const occurrences = Object.values(ledger).reduce((n, c) => n + c, 0);
  return (
    'check-role-word: OK, no new occurrences of the reserved word.\n'
    + `  Scanned: ${scanClause(scanned)}.\n`
    + `  Exempt: ${exemptClause(exempt)}.\n`
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
 * @param {{blocks: number, occurrences: number}} exempt vendor-wire suppressions
 * @returns {string}
 */
function updateSummary(scanned, ledger, exempt) {
  return (
    `role-word baseline updated: ${Object.keys(ledger).length} file(s) baselined `
    + `from ${scanClause(scanned)}, with ${exemptClause(exempt)}.`
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
  // Synthetic for the same reason the counts above are: closed fixtures, never a
  // reading of the tree. `NO_EXEMPT` is what today's corpus renders (no block
  // claims the boundary); `SOME_EXEMPT` is the state a future one reaches.
  const NO_EXEMPT = { blocks: 0, occurrences: 0 };
  const SOME_EXEMPT = { blocks: 2, occurrences: 3 };

  const greenPaid = successSummary(SCANNED, PAID_OFF, NO_EXEMPT);
  const greenDead = successSummary(DEAD_SCAN, PAID_OFF, NO_EXEMPT);

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
    [{ root: 'content/docs', files: 179 }, { root: 'skills', files: 0 }], PAID_OFF, NO_EXEMPT);
  expect('#9910 — a root that contributed NOTHING is still named, with its zero (a root can '
    + 'exist and read empty; dropping it from the line hides that behind the other root\'s total)',
    /\bskills 0\b/.test(oneRootGone) && oneRootGone !== greenPaid);

  // (4) The same ambiguity on the privileged path, where it is destructive
  // rather than merely misleading: `--update` rewrites the baseline from the
  // tree it just read.
  expect('#9910 — the --update confirmation states its input volume too, so re-baselining '
    + 'over a dead scan cannot read like a debt fully paid',
    updateSummary(DEAD_SCAN, PAID_OFF, NO_EXEMPT) !== updateSummary(SCANNED, PAID_OFF, NO_EXEMPT));

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

  // ── The vendor-wire fence exemption (#10533) ───────────────────────────────
  //
  // Maintainer ruling, 2026-08-21: 「其他接受」 — option B, with a self-test
  // covering the exemption in all three directions plus a positive control.
  // Those four are labelled (B1)…(B4) below and are the load-bearing set; the
  // legs after them each close one way the MARKING could stop bounding the
  // exemption, which is the only thing standing between "vendor wire payloads"
  // and "every fenced block in the corpus".
  //
  // Fixtures differ from each other in exactly ONE line wherever possible, so a
  // failure names the property and not the fixture.
  const VW_MDX = markerFor('.mdx', 'better-auth');
  const VW_MD = markerFor('.md', 'better-auth');
  /** Counted occurrences — what the ratchet actually compares against. */
  const vwCount = (text, ext) => countMatches(text) - analyzeVendorWire(text, ext).occurrences;

  const FENCED = [
    '# Attaching an existing user',
    '',
    VW_MDX,
    '```http',
    'POST /api/v1/auth/organization/add-member',
    '{ "userId": "usr_01HZX", "role": "member" }',
    '```',
    '',
  ].join('\n');
  const UNMARKED = FENCED.replace(`${VW_MDX}\n`, '');
  const PROSE = FENCED.replace(
    '# Attaching an existing user',
    '# Attaching an existing user\n\nEvery member carries a role, said the prose.',
  );

  // (B4) THE POSITIVE CONTROL, and it comes first because every leg below is
  // vacuous without it: the fixtures really do contain the reserved word. A
  // fixture that had lost it would make (B1) pass by saying nothing at all —
  // zero counted occurrences because there were none to count — and that is
  // precisely the shape of green this gate exists to refuse elsewhere.
  expect('#10533 (B4, positive control) — the fixtures CARRY the reserved word, so a zero from '
    + '(B1) is the exemption working and not an empty fixture',
    countMatches(FENCED) === 1 && countMatches(UNMARKED) === 1 && countMatches(PROSE) === 2);

  // (B1) The new behaviour.
  expect('#10533 (B1) — a fenced vendor-wire block PASSES: its occurrence is not counted',
    vwCount(FENCED, '.mdx') === 0);
  // (B2) D3's actual target, untouched.
  expect('#10533 (B2) — a PROSE occurrence still FAILS, in the very same file whose fenced block '
    + 'is exempt (the exemption suppresses a block, never a file)',
    vwCount(PROSE, '.mdx') === 1);
  // (B3) The leg that carries the design. Without it the exemption keys on "is a
  // fence" and silently widens to every code block in the corpus — materially
  // broader than what was accepted. The ruling says "marked as vendor wire
  // payloads"; the marking is what bounds it.
  expect('#10533 (B3) — an UNMARKED fence still FAILS (the exemption keys on the MARKING, never '
    + 'on being a code block)',
    vwCount(UNMARKED, '.mdx') === 1);

  // The tally the green line publishes has to be real, or the "how far has this
  // widened?" answer printed on every run is decorative.
  const fencedReport = analyzeVendorWire(FENCED, '.mdx');
  expect('#10533 — the exemption REPORTS itself: one claimed block, one suppressed occurrence',
    fencedReport.blocks === 1 && fencedReport.occurrences === 1
      && fencedReport.orphans.length === 0 && fencedReport.unterminated.length === 0);

  // A marker that matched WORD would add one occurrence per marked block and
  // defeat itself — the reason the `<!-- role-word: … -->` spelling floated on
  // the card is not the one implemented (`\brole\b` matches inside `role-word`).
  expect('#10533 — the marker token itself contains no form of the reserved word (a marker that '
    + 'did would pay for every block it exempts)',
    countMatches(VENDOR_WIRE_TOKEN) === 0 && countMatches(VW_MDX) === 0
      && countMatches(VW_MD) === 0);

  // ── Every way the MARKING could stop bounding the exemption ────────────────
  //
  // Each fixture is a marker an author might plausibly write. Each must (a) opt
  // NOTHING in — the block stays counted — and (b) be reported as an orphan, not
  // ignored. (b) is the half that matters: a marker that silently checks nothing
  // reads as intentional, and its author meets a "count grew" verdict naming
  // neither the marker nor the reason it did not take.
  const nearMisses = [
    ['a blank line between marker and fence', FENCED.replace(`${VW_MDX}\n`, `${VW_MDX}\n\n`)],
    ['the .md spelling in an .mdx file', FENCED.replace(VW_MDX, VW_MD)],
    ['a vendor nobody declared', FENCED.replace(VW_MDX, markerFor('.mdx', 'acme-corp'))],
    ['the bare token, naming no vendor', FENCED.replace(VW_MDX, `{/* ${VENDOR_WIRE_TOKEN} */}`)],
    ['a marker above PROSE rather than a fence',
      FENCED.replace(VW_MDX, `${VW_MDX}\nNot a fence.`)],
  ];
  for (const [label, text] of nearMisses) {
    const report = analyzeVendorWire(text, '.mdx');
    expect(`#10533 — ${label} opts NOTHING in (the block stays counted)`,
      vwCount(text, '.mdx') === 1 && report.blocks === 0);
    expect(`#10533 — ${label} is reported as an ORPHAN, not ignored (a placed-but-inert marker `
      + 'reads as intentional)',
      report.orphans.length === 1);
  }

  // The `.md` half. PR #10038 is this file's standing reminder that the skills
  // root is a real population and not an afterthought.
  const FENCED_MD = FENCED.replace(VW_MDX, VW_MD);
  expect('#10533 — the .md spelling opts in for a .md file (both roots admit both extensions, so '
    + 'the syntax is keyed by EXTENSION, not by root)',
    vwCount(FENCED_MD, '.md') === 0 && analyzeVendorWire(FENCED_MD, '.md').blocks === 1);
  expect('#10533 — and the .mdx spelling in a .md file opts nothing in, as an orphan (it would '
    + 'render as literal text there)',
    vwCount(FENCED, '.md') === 1 && analyzeVendorWire(FENCED, '.md').orphans.length === 1);

  // Backtick RUN LENGTH. Today's corpus holds four ```` fences wrapping ```
  // examples; a closer that ignored length would end this block on its own
  // contents and leave the last payload line counted.
  const NESTED = [
    VW_MDX,
    '````md',
    '```http',
    'POST /api/v1/auth/organization/add-member',
    '```',
    '{ "role": "member" }',
    '````',
    '',
  ].join('\n');
  expect('#10533 — a ```` block that wraps ``` examples is exempt to its OWN closing fence (a '
    + 'length-blind closer would end it on the inner fence and count the rest)',
    countMatches(NESTED) === 1 && vwCount(NESTED, '.mdx') === 0);

  // An unclosed fence runs to end of document (CommonMark), so honouring a
  // marker on one would hand a single line the whole rest of the file.
  const UNCLOSED = [VW_MDX, '```http', '{ "role": "member" }', '', 'Prose with a role.', ''].join('\n');
  const unclosedReport = analyzeVendorWire(UNCLOSED, '.mdx');
  expect('#10533 — a marker on a fence that is never closed exempts NOTHING and is reported (it '
    + 'would otherwise exempt the whole remainder of the file from one line)',
    unclosedReport.unterminated.length === 1 && unclosedReport.blocks === 0
      && vwCount(UNCLOSED, '.mdx') === 2);

  // This convention has to be documentable IN the roots it governs: a marker
  // shown inside a fence is example text, not a claim.
  const ILLUSTRATED = ['```md', VW_MDX, '```json', '{ "role": "member" }', '```', ''].join('\n');
  const illustratedReport = analyzeVendorWire(ILLUSTRATED, '.mdx');
  expect('#10533 — a marker shown INSIDE a fence is example text: it claims nothing and is not '
    + 'an orphan (this gate\'s own convention must be documentable in content/docs and skills)',
    illustratedReport.blocks === 0 && illustratedReport.orphans.length === 0
      && vwCount(ILLUSTRATED, '.mdx') === 1);

  // ── The diagnostics name the path that now exists ──────────────────────────
  //
  // The defect was reachability, not just capacity: an author hitting the
  // ratchet with a vendor payload had no discoverable remedy, and the only one
  // named was the maintainer's. Derived from the constants, so renaming the
  // token cannot leave a message pointing at a marker nothing recognises.
  const grew = grewMessage('content/docs/example.mdx', 4, 5);
  const newUse = newUseMessage('content/docs/example.mdx', 2);
  expect('#10533 — BOTH refusal messages name the vendor-wire marker (the count-GREW one is how '
    + 'this defect was actually met, and it used to name no author-takeable remedy at all)',
    grew.includes(VENDOR_WIRE_TOKEN) && newUse.includes(VENDOR_WIRE_TOKEN));
  expect('#10533 — each message renders the marker in the spelling for the file it names',
    grew.includes(markerFor('.mdx', '<vendor>')) && newUse.includes(markerFor('.mdx', '<vendor>')));
  expect('#10533 — a .md file is told the .md spelling',
    grewMessage('skills/objectstack-api/SKILL.md', 1, 2).includes(markerFor('.md', '<vendor>')));
  // The #8435 convention, held across the rewrite: the marker path is the
  // AUTHOR's, so the count-GREW message must not drag the maintainer-only label
  // onto itself by offering the baseline; the NEW-use message still offers the
  // baseline and still carries the label.
  expect('#8435 + #10533 — the count-GREW message offers no baseline expansion, so it needs no '
    + 'maintainer-only marker (the remedy it names is the author\'s own)',
    !RATCHET_EXPANSION_OFFER.test(grew) && ratchetRemedyCarriesAuthority(grew));
  expect('#8435 + #10533 — the NEW-use message still offers the baseline path AND still marks it '
    + 'maintainer-only, now as a THIRD option rather than the second',
    RATCHET_EXPANSION_OFFER.test(newUse) && ratchetRemedyCarriesAuthority(newUse));

  // The green line publishes the exemption volume, for the #9910 reason: a
  // suppressed occurrence is invisible in every ledger number and in the file
  // count alike, so "how far has this widened?" is printed, not rediscovered.
  expect('#10533 — the GREEN body states the exemption volume, and renders DIFFERENTLY when the '
    + 'exemption moves (a corpus that quietly grew claims cannot print the same green)',
    successSummary(SCANNED, PAID_OFF, NO_EXEMPT)
      !== successSummary(SCANNED, PAID_OFF, SOME_EXEMPT));
  expect('#10533 — the --update confirmation states it too (it re-baselines from counts the '
    + 'exemption already reduced)',
    updateSummary(SCANNED, PAID_OFF, NO_EXEMPT) !== updateSummary(SCANNED, PAID_OFF, SOME_EXEMPT));
  expect('#10533 — a corpus claiming NOTHING says so outright, rather than omitting the clause',
    successSummary(SCANNED, PAID_OFF, NO_EXEMPT).includes(exemptClause(NO_EXEMPT)));

  // ── The exemption at the PROGRAM level ─────────────────────────────────────
  //
  // Everything above drives a predicate. A predicate the program never consults
  // would satisfy all of it — the same "declaration that silently self-cancels"
  // shape the #9932 legs below were written against — so these build real trees
  // and read a child process's real exit status, never a pipe's.
  //
  // Both fixture files live in the SAME root on purpose: it is the extension,
  // not the root, that selects the marker syntax, and a tree that put each
  // spelling in its "own" root would pass just as well under a root-keyed table.
  const vwSandbox = mkdtempSync(join(tmpdir(), 'check-role-word-vendorwire-'));
  try {
    const [root] = ROOTS;
    const MDX = `${root}/members.mdx`;
    const MD = `${root}/members.md`;
    const buildTree = (name, files) => {
      const dir = join(vwSandbox, name);
      for (const r of ROOTS) mkdirSync(join(dir, r), { recursive: true });
      for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body);
      return dir;
    };

    // (B1) at program level, in both spellings at once. No baseline file exists
    // in these trees, so ANY counted occurrence is a NEW use and exit 1 — which
    // makes exit 0 here exactly the claim "nothing was counted".
    const passing = runIn(buildTree('pass', { [MDX]: FENCED, [MD]: FENCED_MD }));
    expect('#10533 (B1, program) — a tree whose only occurrences sit in MARKED vendor-wire '
      + 'fences is GREEN, in both marker spellings, with no baseline entry for either file',
      passing.status === 0);
    expect('#10533 (B1, program) — and the run PUBLISHES what it suppressed, so the exemption '
      + 'cannot widen unobserved',
      passing.out.includes(exemptClause({ blocks: 2, occurrences: 2 })));

    // (B2) at program level.
    const prose = runIn(buildTree('prose', { [MDX]: PROSE, [MD]: FENCED_MD }));
    expect('#10533 (B2, program) — one PROSE occurrence in a file whose fenced block is exempt '
      + 'still fails, and is reported as a NEW use',
      prose.status === 1 && prose.out.includes('NEW use of the reserved word'));

    // (B3) at program level — the leg that carries the design.
    const unmarked = runIn(buildTree('unmarked', { [MDX]: UNMARKED, [MD]: FENCED_MD }));
    expect('#10533 (B3, program) — the SAME fenced payload with its marker removed still fails '
      + '(so the green above came from the marking, not from the fence)',
      unmarked.status === 1 && unmarked.out.includes('NEW use of the reserved word'));

    // An inert marker is refused as its own class of problem, naming itself —
    // not left to surface as a bare count the author cannot connect to it.
    const orphanTree = buildTree('orphan', { [MDX]: FENCED.replace(`${VW_MDX}\n`, `${VW_MDX}\n\n`) });
    const orphan = runIn(orphanTree);
    expect('#10533 — a marker that opts nothing in fails as a MARKER problem, naming the token',
      orphan.status === 1 && orphan.out.includes('vendor-wire marker problem')
        && orphan.out.includes(VENDOR_WIRE_TOKEN));

    // And that refusal precedes the write, pinned as byte-identity rather than
    // as an exit code — the #9932 discipline, for the same reason: re-baselining
    // from counts whose author misunderstood them freezes the misunderstanding
    // into a ledger that is shrink-only.
    mkdirSync(join(orphanTree, dirname(BASELINE_PATH)), { recursive: true });
    const vwLedgerPath = join(orphanTree, BASELINE_PATH);
    const vwLedgerBefore = '{\n  "pinned": 11\n}\n';
    writeFileSync(vwLedgerPath, vwLedgerBefore);
    const orphanUpdate = runIn(orphanTree, ['--update']);
    expect('#10533 — `--update` over a tree holding an inert marker refuses BEFORE writing, '
      + 'leaving the baseline byte-identical',
      orphanUpdate.status === 1 && readFileSync(vwLedgerPath, 'utf8') === vwLedgerBefore);
  } finally {
    rmSync(vwSandbox, { recursive: true, force: true });
  }

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
    + 'by a predicate no caller has to reach. The vendor-wire exemption is pinned in all three '
    + 'directions over a fixture PROVEN to carry the reserved word: a marked fence passes, a '
    + 'prose occurrence in the same file still fails, and an UNMARKED fence still fails — so the '
    + 'exemption keys on the marking and not on being a code block. Every near-miss marker (a '
    + 'blank line, the other format\'s spelling, an undeclared vendor, the bare token, a marker '
    + 'above prose) opts nothing in AND is refused as an orphan, an unclosed claimed fence '
    + 'exempts nothing, and both refusal messages name the marker in the spelling for the file '
    + 'they name — all of it also driven through a real child process, so a predicate the '
    + 'program never consulted could not pass it.',
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
/* Vendor-wire exemptions, tallied as the scan runs — the same pass, not a second
 * one — so the volume can be printed on every run (#10533). An exemption nobody
 * can see is an exemption that widens unobserved, which is the failure mode the
 * marking was chosen to prevent in the first place. */
const exempt = { blocks: 0, occurrences: 0 };
const markerProblems = [];
for (const f of files.sort()) {
  const rel = relative('.', f).replace(/\\/g, '/');
  // File/dir names are URLs — a `role-*` slug is UI copy (counts once). A path
  // cannot be inside a fence, so the exemption never reaches this half.
  const nameHits = countMatches(rel);
  const text = readFileSync(f, 'utf8');
  const ext = extensionOf(rel);
  const vendorWire = analyzeVendorWire(text, ext);
  exempt.blocks += vendorWire.blocks;
  exempt.occurrences += vendorWire.occurrences;
  for (const n of vendorWire.orphans) markerProblems.push(orphanMarkerMessage(rel, n, ext));
  for (const n of vendorWire.unterminated) markerProblems.push(unterminatedFenceMessage(rel, n));
  const bodyHits = countMatches(text) - vendorWire.occurrences;
  const total = nameHits + bodyHits;
  if (total > 0) current[rel] = total;
}

/* Refused BEFORE the `--update` write, for the reason the missing-root probe is:
 * a marker that opts nothing in means the counts just taken are not the counts
 * its author believes were taken, and re-baselining from them would freeze that
 * misunderstanding into the ledger — silently, and in the one direction this
 * shrink-only ratchet cannot walk back. */
if (markerProblems.length) {
  console.error(`check-role-word: ${markerProblems.length} vendor-wire marker problem(s)\n`);
  for (const e of markerProblems) console.error('  • ' + e);
  process.exit(1);
}

if (update) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(updateSummary(scanned, current, exempt));
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
    errors.push(grewMessage(file, allowed, count));
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
console.log(successSummary(scanned, current, exempt));
