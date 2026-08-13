#!/usr/bin/env node
// check-ratchet-remedy-authority — the farm-wide detector for the #8435
// ratchet-remedy authority convention.
//
// THE CONVENTION (#8435, established by PR #8517, extended by PR #8539 and
// PR #8549): a gate whose second remedy is editing a shrink-only ratchet /
// ledger / baseline must not present that path as the author's co-equal option.
// It must either
//
//   (a) MARK the path with the authority token `⛔ MAINTAINER-ONLY`, or
//   (b) REFUSE the weakening remedy outright.
//
// This gate enforces that DISJUNCTION. (b) is not a lesser form of (a): a gate
// that refuses satisfies the convention MORE strongly than one that marks, and
// this detector must never push a refusing gate onto the marking shape. The
// precedents are check-type-source-resolution.mjs, check-test-source-alias.mjs,
// check-adr-links.mjs and check-driver-memory-census.mjs.
//
// WHY A SWEEP AND NOT A SHARED MODULE. #8519 proposed a shared helper module as
// the enforcement route. It is not one: a module is reachable only from gates
// that choose to import it, so it standardises the gates that already agreed and
// is structurally blind to the next gate that offers a ratchet path and imports
// nothing. #8538 is the direct evidence — the sixth instance was found by
// sweeping source text, and no shared module could have found it at any quality,
// because that file imports nothing to be found by.
//
// WHY THE GLOB IS `scripts/*.{mjs,mts}` AND NEVER `scripts/*.mjs`. A census keyed
// to `.mjs` alone is the blind spot that made #8538 necessary:
// check-test-typecheck.mts is a gate like any other and a `.mjs` glob cannot see
// it. Two of the 80 scripts are `.mts` today.
//
// ── The two ⛔ tokens are DISTINCT, deliberately (triage ruling on #8540) ─────
//
// The farm carries two ⛔ tokens and they are not competing spellings of one
// idea. They state different propositions:
//
//   `⛔ MAINTAINER-ONLY`  — AUTHORITY:         this remedy is a maintainer's to take
//   `⛔ SHRINK-ONLY`      — RATCHET DIRECTION: this registry only ever shrinks
//
// A gate can carry the second and still owe the first, or carry neither because
// it refuses the remedy outright. This gate reads shrink vocabulary as EVIDENCE
// ABOUT THE REGISTRY and the authority token as the COMPLIANCE token. They are
// never interchanged.
//
// ── Division of labour with the per-gate self-tests ─────────────────────────
//
// This gate asserts the token is PRESENT in a gate that offers an expanding
// remedy. It deliberately does NOT assert the token sits in the same message as
// the offer — the six instrumented gates each carry their own self-test pinning
// placement against their own message text (the PR #8517 pattern), and those
// assertions are sharper than anything a farm-wide text sweep can be. Presence
// here, placement there. Stating the split matters: read as a placement check
// this gate looks far weaker than it is, and read as the only check the per-gate
// ones look redundant.
//
// The reason presence cannot be checked more tightly from out here is concrete:
// every instrumented gate writes the token as `${RATCHET_AUTHORITY_MARKER}`
// inside its message, so the literal 24-character token appears in the source
// ONLY at the `const` declaration — nowhere near the offer text it governs.
//
// Presence is nonetheless checked in AUTHOR-FACING text, never raw source. A gate
// whose header merely discusses the convention has told the author nothing, and
// counting that as compliance was a real hole: it was found by stripping the token
// from a real gate and watching this detector stay green, because that file's own
// header names the token in a comment. See {@link carriesAuthorityToken}.
//
// ── The control corpus is part of the deliverable ──────────────────────────
//
// A first cut of the prototype behind #8540 spelled its gap class `[^.;]`, which
// EXCLUDES THE DOT, so every offer naming its registry by path (`…baseline.json`)
// silently stopped matching and two known instances read as clean. It was caught
// only because a hand-classified control set disagreed with the detector. That is
// the same failure the convention itself is about, one level up: a measurement
// that reports a clean result while being structurally blind to a subset.
//
// So `CONTROL` below is a hand-classified fixture and it SHIPS WITH THE GATE. It
// is audited for SET EQUALITY in both directions, which is what makes a clean run
// mean something:
//
//   • a CONTROL entry the sweep no longer reaches   → STALE, fails, names itself
//   • a file the sweep reaches that CONTROL misses  → UNCLASSIFIED, fails
//   • a file whose observed class ≠ declared class  → MISCLASSIFIED, fails
//
// The first is the positive-control assertion at corpus scale. Zero findings from
// a control-less detector prove nothing; zero findings from this one mean the
// sweep still reaches all six known instances and still declines to reach the
// twenty-odd declaration registries it must not touch.
//
// ⛔ CONTROL IS A DECLARATION REGISTRY, NOT A RATCHET. Adding an entry is the
// CORRECT fix when a gate legitimately joins the convention — the farm growing a
// seventh marked gate is good news, not debt. It is deliberately never described
// as shrink-only.
//
// ⚠️ A GATE THAT DISCUSSES THE CONVENTION MUST NOT READ AS AN INSTANCE OF IT.
// This file quotes other gates' offer text, which is offer-shaped by definition.
// Those quotes live in COMMENTS, never in string literals, because the sweep
// reads author-facing text and would otherwise classify this gate as an instance
// of the convention it enforces. A self-test assertion pins the self-verdict at
// `excluded`; if it ever flips, this file started talking like an offer.
//
// Usage:
//   node scripts/check-ratchet-remedy-authority.mjs
//   node scripts/check-ratchet-remedy-authority.mjs --list       # what the sweep sees
//   node scripts/check-ratchet-remedy-authority.mjs --self-test  # the detector's own rules

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const SELF_FILE = 'check-ratchet-remedy-authority.mjs';
const SELF = `scripts/${SELF_FILE}`;

/** The compliance token. Byte-identical to every instrumented gate's const. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

// ── Reading author-facing text ──────────────────────────────────────────────
//
// The unit of measurement is the text THE AUTHOR READS — string-literal content
// — not the whole source. Comments are maintainer-facing and routinely discuss
// the very acts these gates refuse ("the second path is not a fix: it is a
// ratchet weakening"), so a sweep over raw source reads a marking gate's
// commentary as a refusal and vice versa. Code is worse: `.add(` and `Record<`
// alone produce dozens of phantom offers.
//
// The lexer must therefore be a real one. A first cut that treated `/` as
// ordinary code desynced on the first regex literal containing a quote (`/['"]/`
// is common in this farm), after which every following comment read as string
// content and every string as code — a blind spot with no symptom. There is a
// self-test assertion for exactly that fixture.

/** Chars after which a `/` opens a regex literal rather than dividing. */
function regexAllowedAfter(prev, prevWord) {
  if (prev === '') return true;
  if (/[A-Za-z0-9_$)\]]/.test(prev)) {
    // `return /re/`, `typeof /re/`, `case /re/` — a keyword, so a regex after all.
    return ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield',
      'await', 'new', 'delete', 'void', 'throw'].includes(prevWord);
  }
  return true;
}

/** Placeholder standing in for a `${…}` interpolation in author-facing text. */
const INTERP = ' ‹X› ';

/** `\n` / `\t` / `\r` become spaces; any other escape keeps its char. */
function whitespaceEscape(ch) {
  if (ch === 'n' || ch === 't' || ch === 'r') return ' ';
  return ch ?? '';
}

/**
 * Split a script into its author-facing MESSAGES.
 *
 * A message is a concatenation expression: literals joined by nothing but
 * whitespace and `+`, plus the interpolations between them. Anything else
 * between two literals — a `)`, a `,`, a statement — ends the message.
 *
 * That boundary is load-bearing, and a char-window stand-in for it is not good
 * enough. Measured: with a flat 200-character window over the whole file,
 * check-adr-anchors.mjs read as a violation because a verb at the tail of one
 * diagnostic ("add `.vN`") picked up a registry name from the head of the NEXT,
 * unrelated diagnostic ("the KNOWN_NUMBER_COLLISIONS entry … is stale"). Neither
 * message offers to expand anything; their concatenation did. A gate reported as
 * violating the convention when it does not is worse than one missed — it teaches
 * authors that this detector is noise.
 *
 * @param {string} src
 * @returns {string[]} messages, in source order
 */
export function authorFacingMessages(src) {
  const messages = [];
  let cur = null;
  const emit = (text) => { cur = cur === null ? text : cur + text; };
  const breakMessage = () => { if (cur !== null) { messages.push(cur); cur = null; } };

  const stack = [{ kind: 'code', braces: 0 }];
  let i = 0;
  const n = src.length;
  let prev = '';
  let prevWord = '';
  let gap = '';

  /** A literal is starting: does it continue the current message or begin one? */
  const openLiteral = () => {
    if (stack.length === 1 && !/^[\s+]*$/.test(gap)) breakMessage();
    gap = '';
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const d = src[i + 1];

    if (top.kind === 'code') {
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      if (c === '/' && regexAllowedAfter(prev, prevWord)) {
        i++;
        let inClass = false;
        while (i < n) {
          const r = src[i];
          if (r === '\\') { i += 2; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) { i++; break; }
          else if (r === '\n') break;
          i++;
        }
        prev = '/'; prevWord = ''; gap += ' x '; continue;
      }
      if (c === "'" || c === '"') {
        const q = c;
        openLiteral();
        i++;
        let buf = '';
        while (i < n) {
          const s = src[i];
          if (s === '\\') { buf += whitespaceEscape(src[i + 1]); i += 2; continue; }
          if (s === q) { i++; break; }
          if (s === '\n') break;
          buf += s; i++;
        }
        emit(buf);
        prev = q; prevWord = ''; continue;
      }
      if (c === '`') { openLiteral(); stack.push({ kind: 'tpl' }); i++; continue; }
      if (c === '}' && stack.length > 1 && top.braces === 0) {
        stack.pop(); i++; prev = '}'; prevWord = ''; continue;
      }
      if (c === '{') top.braces++;
      if (c === '}') top.braces--;
      if (!/\s/.test(c)) { prev = c; prevWord = /[A-Za-z0-9_$]/.test(c) ? prevWord + c : ''; }
      if (stack.length === 1) gap += c;
      i++; continue;
    }

    // Inside a template literal — its whole span is one message.
    if (c === '\\') { emit(whitespaceEscape(d)); i += 2; continue; }
    if (c === '`') { stack.pop(); prev = '`'; prevWord = ''; gap = ''; i++; continue; }
    if (c === '$' && d === '{') {
      emit(INTERP);
      stack.push({ kind: 'code', braces: 0 });
      i += 2; continue;
    }
    emit(c); i++;
  }
  breakMessage();
  return messages.map((m) => m.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ── Stage 1: the offer grammar ──────────────────────────────────────────────
//
// An OFFER is author-facing text handing the reader an act that EXPANDS a
// registry. Two word orders are accepted, because the prototype behind #8540
// demanded "add … to … REGISTRY" and so missed check-type-check-coverage.mjs
// entirely, whose text puts the registry BEFORE the noun ("add a TEST_DEBT entry
// in …"). Pure word order, and it cost that prototype a third of its recall. The
// grammar below takes the verb and looks for a target anywhere in the rest of the
// message, so neither order is privileged.
//
// ⛔ THE GAP IS NOT ALLOWED TO EXCLUDE THE DOT. Do not "tighten" the target
// patterns to a class excluding `.` — a registry named by PATH
// (`scripts/x.baseline.json`) is the commonest spelling in this farm, and
// excluding the dot makes every one of them invisible while the gate still
// reports clean. A self-test assertion pins that case.

const OFFER_VERB = /\b(?:add|adds|adding|append|appending|widen|widens|widening|expand|expanding|re-?seed)\b/gi;

/** How far past the verb a target may sit and still belong to the same offer. */
const OFFER_WINDOW = 200;

/** How far BEFORE the verb to look for a negation binding it ("do not add …"). */
const REFUSAL_LOOKBEHIND = 60;

/**
 * Modals that turn a remedy into a DESCRIPTION. "regenerating it can WIDEN it"
 * warns that an act widens a ratchet; it does not offer the act. Measured:
 * without this guard regen-artifacts.mjs read as a violation, on a data field
 * whose whole purpose is to explain why a file must NOT be auto-regenerated.
 * Deliberately only the modals of possibility — "must add" and "should add" are
 * offers, and excluding them here would be excluding real instances.
 */
const DESCRIPTIVE_MODAL = /\b(?:can|could|would|may|might|will)\s+(?:\w+\s+){0,1}$/i;

/** Registry nouns that name a target without naming an identifier. */
const REGISTRY_NOUN = /\b(?:ledger|baseline|ratchet|registry|census|allow-?list|waiver)\b/i;

/** A ledger named by PATH. The dot is INSIDE the class on purpose (see above). */
const PATH_TARGET = /\b[\w./-]*\.(?:json|mjs|mts)\b/;

/** An ALL-CAPS identifier, 4+ chars — `EXEMPT`, `TEST_DEBT`, `MOUNTS`. */
const CAPS_TARGET = /\b[A-Z][A-Z0-9_]{3,}\b/g;

/**
 * The registry an offer names, and how it was named.
 *
 * An ALL-CAPS word counts only when the script DECLARES it (`const EXEMPT = …`).
 * That one extra condition keeps prose capitals ("a MEASURED entry", "NOT a
 * co-equal option") out of the target set without a hand-maintained stop-word
 * list, which would rot the first time a gate invented a new noun.
 *
 * The `kind` matters downstream: only a DECLARED identifier is specific enough to
 * be looked up across the file. A bare noun like "the ledger" is deictic — it
 * means whatever the surrounding sentence is about — so its testimony has to come
 * from that same sentence.
 *
 * @param {string} window author-facing text from the offer verb onward
 * @param {string} src the script's raw source
 * @returns {{name: string, kind: 'path' | 'declared' | 'noun'} | null}
 */
export function offerTarget(window, src) {
  CAPS_TARGET.lastIndex = 0;
  let m;
  while ((m = CAPS_TARGET.exec(window))) {
    if (new RegExp(`\\b(?:const|let|var)\\s+${m[0]}\\b`).test(src)) {
      return { name: m[0], kind: 'declared' };
    }
  }
  const path = window.match(PATH_TARGET);
  if (path) return { name: path[0], kind: 'path' };
  const noun = window.match(REGISTRY_NOUN);
  if (noun) return { name: noun[0].toLowerCase(), kind: 'noun' };
  return null;
}

/**
 * Every offer-shaped occurrence in a script's author-facing text.
 *
 * @param {string} src
 * @returns {Array<{verb: string, message: string, window: string, context: string,
 *                  target: {name: string, kind: string}}>}
 */
export function findOffers(src) {
  const offers = [];
  for (const message of authorFacingMessages(src)) {
    OFFER_VERB.lastIndex = 0;
    let m;
    while ((m = OFFER_VERB.exec(message))) {
      const before = message.slice(0, m.index);
      if (DESCRIPTIVE_MODAL.test(before)) continue;
      const window = message.slice(m.index, m.index + OFFER_WINDOW);
      const target = offerTarget(window, src);
      if (!target) continue;
      offers.push({
        verb: m[0],
        message,
        window,
        target,
        context: message.slice(Math.max(0, m.index - REFUSAL_LOOKBEHIND), m.index + OFFER_WINDOW),
      });
    }
  }
  return offers;
}

// ── Stage 2: is the target a RATCHET, or a declaration registry? ────────────
//
// This is the precision workhorse and the whole reason a naive sweep is useless.
// "Add an entry to X" is the CORRECT fix for roughly twenty gates in this farm —
// INHERIT_JUSTIFIED, CROSS_PACKAGE_TEST_INPUTS, EXEMPT_FILES, MOUNTS, AMPLIFIERS,
// NODE_LIFECYCLE … Those are DECLARATION registries: the entry records a fact and
// recording it is the work. Marking them maintainer-only would teach the opposite
// of the rule.
//
// The discriminator is the gate's OWN TESTIMONY about the registry it names —
// structural evidence, not a keyword blacklist. Two limbs, and the gate reports
// which one fired for each instance:
//
//   SHRINK — "shrink-only", "only ratchets down", "an entry weakens a ratchet"
//   GOVERN — "the maintainer has agreed to", "a tracked exception"
//
// The GOVERN limb exists for check-driver-conformance.mjs, which contains ZERO
// shrink vocabulary and states its ledger's nature as a measured, tracked
// exception the maintainer has agreed to. That wording predates the convention in
// that file, so it is independent evidence about the ledger rather than a
// restatement of compliance. Without this limb that gate is unreachable, which is
// exactly what the #8540 prototype recorded as its second miss.
//
// ⛔ NEITHER LIMB MAY BE SATISFIED BY THE AUTHORITY TOKEN. If the token could
// anchor a target, this gate would only ever examine gates that already comply —
// it could never report a violation and would sit green forever looking useful.
// The token is scrubbed from every span before testimony is tested, and a
// self-test assertion pins it.

const SHRINK_TESTIMONY = new RegExp([
  'shrink-?only',
  'only shrinks',
  'only ratchets down',
  'ratchets down only',
  'never grows',
  'cannot grow',
  'closed to new entries',
  'EXACT ratchet',
  'weakens a ratchet',
  'ratchet weakening',
].join('|'), 'i');

const GOVERN_TESTIMONY = new RegExp([
  'maintainer has agreed',
  'maintainer to agree',
  'a maintainer action',
  'maintainer-governed',
  'tracked exception',
].join('|'), 'i');

/** How far from a DECLARED target's mention its testimony may sit in source. */
const ANCHOR_WINDOW = 400;

/**
 * Does the script testify that this offer's target is a ratchet rather than a
 * declaration registry? Returns the limb that fired, or null.
 *
 * Two search spaces, and which one applies is decided by how the target was
 * named — see {@link offerTarget}:
 *
 *   • ALWAYS the offer's own MESSAGE. "…, so an entry weakens a ratchet" sits in
 *     the same breath as the offer, which is where four of the six instances
 *     keep it.
 *   • ADDITIONALLY, for a DECLARED identifier, the raw source around every
 *     mention of it — comments included. check-type-check-coverage.mjs keeps its
 *     testimony in a comment over the const ("raise the TEST_DEBT entry — edits a
 *     SHRINK-ONLY ledger"), so a message-only sweep cannot reach it.
 *
 * Paths and bare nouns get message scope only. Widening them to file scope was
 * measured and rejected: it made every `tsconfig.json` in a gate that happens to
 * discuss ratchets read as a ratchet, which turned check-type-source-resolution's
 * CORRECT remedy into a reported violation.
 *
 * @param {string} src
 * @param {{target: {name: string, kind: string}, message: string}} offer
 * @returns {'shrink' | 'govern' | null}
 */
export function anchorFor(src, offer) {
  const spans = [offer.message];
  if (offer.target.kind === 'declared') {
    const needle = offer.target.name;
    let from = 0;
    for (;;) {
      const at = src.indexOf(needle, from);
      if (at === -1) break;
      spans.push(src.slice(Math.max(0, at - ANCHOR_WINDOW), at + needle.length + ANCHOR_WINDOW));
      from = at + needle.length;
    }
  }
  const scrub = (s) => s.split(RATCHET_AUTHORITY_MARKER).join(' ');
  for (const span of spans) if (SHRINK_TESTIMONY.test(scrub(span))) return 'shrink';
  for (const span of spans) if (GOVERN_TESTIMONY.test(scrub(span))) return 'govern';
  return null;
}

// ── Stage 3: refusal ────────────────────────────────────────────────────────
//
// Triage ruling on #8540: a gate that REFUSES the weakening remedy satisfies the
// convention more strongly than one that marks it, and is NEVER a violation. So
// refusal has to be told apart from silence, and told apart TIGHTLY.
//
// The trap is that a MARKING gate's message also ends in discouragement — "…do
// not take this path to get CI green". A loose refusal grammar reads that as a
// refusal, and then any gate could shed the token by appending a sentence. So
// refusal is recognised in exactly two shapes, both of which negate THE ACT:
//
//   BOUND       — the negation governs the verb:  "do not add it to …"
//   PREDICATION — the act is the subject:         "adding an entry is not the fix"
//
// "do not take this path" matches neither, because its verb is `take`. That is
// the distinction, and it is what keeps this stage honest.

const REFUSAL_BOUND = /\b(?:do not|don'?t|never|not)\s+(?:\w+\s+){0,2}?(?:add|adding|append|widen|widening|expand|expanding|re-?seed)\b/i;

const REFUSAL_PREDICATION = /\b(?:adding|widening|expanding|appending|re-?seeding)\b[^.]{0,100}?\b(?:is not the fix|is not a fix|are not the fix|not a fix|is not how|is not the remedy|is not an option)\b/i;

/**
 * @param {{context: string}} offer
 * @returns {boolean}
 */
export function offerIsRefused(offer) {
  return REFUSAL_BOUND.test(offer.context) || REFUSAL_PREDICATION.test(offer.context);
}

/**
 * Does this gate actually CARRY the authority token — in the text an author
 * reads, not merely somewhere in the file?
 *
 * ⛔ The distinction is the whole assertion, and a raw `src.includes(…)` gets it
 * wrong. Measured: strip the token from check-role-word.mjs's marker const and a
 * source-wide search still finds it, because the file's own header COMMENT
 * mentions the convention by name. The gate would then have gone silent for every
 * author who trips it while this detector reported the farm clean — the exact
 * shape of failure the convention exists to prevent, reproduced by its detector.
 *
 * Comments are maintainer-facing. A gate that discusses the token has not told
 * the author anything; a gate that puts it in a string has.
 *
 * @param {string} src
 * @returns {boolean}
 */
export function carriesAuthorityToken(src) {
  return authorFacingMessages(src).some((m) => m.includes(RATCHET_AUTHORITY_MARKER));
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * @typedef {'marked' | 'refused' | 'unmarked' | 'excluded'} Verdict
 *
 * marked   — offers an expanding remedy on a ratchet, and carries the token
 * refused  — every expanding offer it makes is refused outright (stronger shape)
 * unmarked — offers an expanding remedy on a ratchet with neither → VIOLATION
 * excluded — no offer, or no offer whose target is a ratchet. Declaration
 *            registries land here, which is the entire point of stage 2.
 */

/**
 * @param {string} src
 * @returns {{verdict: Verdict, live: Array<object>, refused: Array<object>, anchors: string[]}}
 */
export function classify(src) {
  const live = [];
  const refused = [];
  const anchors = [];
  for (const offer of findOffers(src)) {
    const anchor = anchorFor(src, offer);
    if (!anchor) continue;
    anchors.push(anchor);
    if (offerIsRefused(offer)) refused.push(offer);
    else live.push(offer);
  }
  if (live.length === 0) {
    return { verdict: refused.length > 0 ? 'refused' : 'excluded', live, refused, anchors };
  }
  return {
    verdict: carriesAuthorityToken(src) ? 'marked' : 'unmarked',
    live,
    refused,
    anchors,
  };
}

// ── The hand-classified control corpus ──────────────────────────────────────
//
// Hand-classified against the source on 2026-08-13; corpus = 79 pre-existing
// scripts (77 `.mjs` + 2 `.mts`) at `main` = 6b441a842, 80 with this file.
// Set-equality audited in both directions — see the header for what each
// direction catches.
//
// ⛔ This is a DECLARATION registry. Adding an entry is the correct fix when a
// gate legitimately joins the convention, and it needs no maintainer's leave. It
// is not shrink-only and must never be described as such.
//
// `marked` and `refused` entries are the POSITIVE control: the sweep must still
// reach them. `excluded` entries are the NEGATIVE control: gates whose remedy is
// "record this fact" where recording it IS the fix, plus every near-miss a naive
// sweep flagged. They are listed so a precision regression fails loudly instead
// of arriving as a plausible-looking new finding.
//
// ⚠️ Each `why` is deliberately written WITHOUT quoting the offer text it
// describes. The quotes belong in comments (this one included); a `why` string is
// author-facing, and one quoting an offer would make this gate an instance of its
// own convention. See the header's warning.
//
// The six instances, and what each one is here to prove:
//   check-engine-double-contract.mjs   PR #8517 — testimony sits in the message
//   check-type-check-coverage.mjs      PR #8517 — registry BEFORE the noun (miss ①),
//                                      testimony only in a comment over the const
//   check-role-word.mjs                PR #8539 — names its ledger by PATH
//   check-durability-…-log-level.mjs   PR #8539 — testimony parenthetical
//   check-driver-conformance.mjs       PR #8539 — ZERO shrink vocabulary (miss ②),
//                                      reachable only through the GOVERN limb
//   check-test-typecheck.mts           PR #8549 — the sixth, and the `.mts` blind spot

const CONTROL = {
  'check-engine-double-contract.mjs': {
    expect: 'marked',
    why: 'PR #8517. Its baseline is shrink-only and the message says so in the same breath.',
  },
  'check-type-check-coverage.mjs': {
    expect: 'marked',
    why: 'PR #8517. Names its ledger before the noun — the word order the #8540 prototype could not parse — and keeps its testimony in a comment over the const.',
  },
  'check-role-word.mjs': {
    expect: 'marked',
    why: 'PR #8539. Names its ledger by path, the case a dot-excluding gap class loses.',
  },
  'check-durability-degradation-log-level.mjs': {
    expect: 'marked',
    why: 'PR #8539. Testimony is a parenthetical beside the remedy.',
  },
  'check-driver-conformance.mjs': {
    expect: 'marked',
    why: 'PR #8539. No shrink vocabulary at all; reachable only through the governance limb. This is the second of the two misses recorded on #8540.',
  },
  'check-test-typecheck.mts': {
    expect: 'marked',
    why: 'PR #8549, the sixth instance and the reason the glob covers .mts.',
  },

  'check-adr-links.mjs': {
    expect: 'refused',
    why: 'Refuses by binding a negation to the verb, over a shrink-only registry.',
  },
  // The two gates below refuse by PREDICATION (the act named as subject and
  // denied) — self-test (12) pins that predicate on their exact sentence.
  //
  // Until #8576 both were recorded here as `excluded`, and that was the honest
  // reading: stage 2 declined them FIRST, because each named its target in a
  // message carrying no testimony about the registry's nature — the testimony
  // sat in a comment, where no author and no detector reads it. #8576 mirrored
  // one clause of each gate's own shrink-only comment into that same message, so
  // the target is now established as a ratchet and the refusal limb is reached.
  // Growing the refusal limb's sample from one gate to three was the point: a
  // regression in that limb used to be measured against a sample of one.
  'check-test-source-alias.mjs': {
    expect: 'refused',
    why: 'Refuses by predication. Its registry states its own nature in the same message since #8576, so stage 2 reaches it and the refusal limb is consulted.',
  },
  'check-type-source-resolution.mjs': {
    expect: 'refused',
    why: 'The other refusal precedent, refusing by the same predication shape. Its registry states its own nature in the same message since #8576, so stage 2 reaches it rather than declining on a path target.',
  },

  // ── Declaration registries and near-misses: recording the fact IS the fix ──
  'check-agent-model-declared.mjs': {
    expect: 'excluded',
    why: 'INHERIT_JUSTIFIED records why a role inherits its model. A naive-prototype false positive.',
  },
  'check-cross-package-test-inputs.mjs': {
    expect: 'excluded',
    why: 'CROSS_PACKAGE_TEST_INPUTS declares which globs a package tests read. A naive-prototype false positive.',
  },
  'check-error-code-casing.mjs': {
    expect: 'excluded',
    why: 'EXEMPT_FILES records a file whose literals are not error codes.',
  },
  'check-single-authz-resolver.mjs': {
    expect: 'excluded',
    why: 'ALLOW records a justified second resolver.',
  },
  'check-skill-compatibility-version.mjs': {
    expect: 'excluded',
    why: 'EXEMPT records a skill with no version dependency.',
  },
  'check-adr-anchors.mjs': {
    expect: 'excluded',
    why: 'Carries shrink-only registries, but its author-facing remedy names a declaration registry instead. Reached only when two unrelated diagnostics are allowed to merge, which is why messages are bounded.',
  },
  // The third gate #8576 made reader-visible, and the one that did NOT move. Its
  // testimony is governance, not shrink, and it now states that governance in
  // author-facing text — yet the verdict is unchanged, for two reasons that are
  // each about THIS DETECTOR rather than about the gate. Recorded rather than
  // engineered around: the gate's wording is correct, and bending it to satisfy a
  // grammar would be the control flattering the detector.
  'check-driver-memory-census.mjs': {
    expect: 'excluded',
    why: 'Named in the #8540 ruling as a refusal precedent, and it does refuse. Since #8576 it states its ledger governance in author-facing text too, yet it still lands here for two independent reasons: stage 1 finds no target inside the offer window of its refusal sentence, and its wording — a maintainer ruling — sits outside the governance vocabulary. Not a violation by any route; recorded so the distinction stays measured rather than assumed.',
  },
  'regen-artifacts.mjs': {
    expect: 'excluded',
    why: 'Describes a ratchet widening as a hazard to avoid, in a data field, rather than offering it. Reached only without the descriptive-modal guard.',
  },
  [SELF_FILE]: {
    expect: 'excluded',
    why: 'This gate. Its control is a declaration registry, so its own remedy is not an expanding one. If this flips, this file started talking like an offer.',
  },
};

// ── The sweep ───────────────────────────────────────────────────────────────

/** @returns {string[]} corpus filenames, sorted. `*.{mjs,mts}` — never `*.mjs`. */
export function corpusFiles() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.mjs') || f.endsWith('.mts'))
    .sort();
}

/** @returns {Map<string, ReturnType<typeof classify>>} */
export function sweep() {
  const out = new Map();
  for (const file of corpusFiles()) {
    out.set(file, classify(readFileSync(join(SCRIPTS_DIR, file), 'utf8')));
  }
  return out;
}

function list() {
  const results = sweep();
  const byVerdict = { marked: [], refused: [], unmarked: [], excluded: [] };
  for (const [file, r] of results) byVerdict[r.verdict].push({ file, r });
  console.log(`corpus: ${results.size} scripts (scripts/*.{mjs,mts})\n`);
  for (const v of ['unmarked', 'marked', 'refused']) {
    console.log(`── ${v} (${byVerdict[v].length})`);
    for (const { file, r } of byVerdict[v]) {
      console.log(`   ${file}  [anchor: ${[...new Set(r.anchors)].join('+') || '-'}]`);
      for (const o of [...r.live, ...r.refused]) {
        console.log(`       ${o.target.kind}:${o.target.name} — …${o.window.slice(0, 100).trim()}…`);
      }
    }
    console.log('');
  }
  console.log(`── excluded (${byVerdict.excluded.length}) — not an instance of the convention`);
  process.exit(0);
}

function main() {
  const results = sweep();
  const problems = [];

  // (A) The convention itself: an expanding offer with neither token nor refusal.
  for (const [file, r] of results) {
    if (r.verdict !== 'unmarked') continue;
    problems.push(
      `UNMARKED: scripts/${file} hands the author a remedy that EXPANDS a shrink-only registry, and `
      + `neither marks that path ${RATCHET_AUTHORITY_MARKER} nor turns it down outright (#8435).\n`
      + `    remedy: …${r.live[0].window.slice(0, 140).trim()}…\n`
      + `    registry: ${r.live[0].target.name} (testimony: ${r.anchors[0]})\n`
      + '    Fix: say in the same message that this path belongs to a maintainer, or turn it down\n'
      + '    outright the way check-type-source-resolution.mjs does. Turning it down is the stronger\n'
      + '    shape and this gate treats it as fully compliant — it is not a lesser option.',
    );
  }

  // (B) The control corpus, audited for set equality in BOTH directions. This is
  // the positive control at corpus scale: without it, (A) reporting nothing is
  // indistinguishable from a sweep that reads nothing at all.
  for (const [file, r] of results) {
    const declared = CONTROL[file];
    if (!declared) {
      if (r.verdict === 'excluded') continue;
      problems.push(
        `UNCLASSIFIED: scripts/${file} is reached by the sweep as "${r.verdict}", and the control `
        + `corpus in ${SELF} does not cover it.\n`
        + '    Fix: record which shape it is. That is the correct fix and needs nobody\'s leave — the\n'
        + '    control is a declaration registry, not a ratchet.',
      );
      continue;
    }
    if (declared.expect !== r.verdict) {
      problems.push(
        `MISCLASSIFIED: scripts/${file} — the control says "${declared.expect}", the sweep says `
        + `"${r.verdict}".\n    control's reason: ${declared.why}\n`
        + '    Either the gate changed shape (correct the entry) or the detector regressed (correct\n'
        + '    the detector). Do not settle this by editing whichever side is easier to edit.',
      );
    }
  }
  for (const file of Object.keys(CONTROL)) {
    if (!results.has(file)) {
      problems.push(
        `STALE: the control corpus in ${SELF} covers scripts/${file}, which is no longer in the `
        + 'corpus. Drop the entry, or restore the file.',
      );
    }
  }

  if (problems.length > 0) {
    console.error(`\n✗ check-ratchet-remedy-authority: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const counts = { marked: 0, refused: 0, unmarked: 0, excluded: 0 };
  for (const [, r] of results) counts[r.verdict] += 1;
  console.log(
    `OK  check-ratchet-remedy-authority: ${results.size} scripts swept (scripts/*.{mjs,mts}); `
    + `${counts.marked} mark the expanding remedy ${RATCHET_AUTHORITY_MARKER}, ${counts.refused} turn `
    + `it down outright, ${counts.excluded} hand out no ratchet-expanding remedy. Control corpus: `
    + `${Object.keys(CONTROL).length} hand-classified scripts, set-equality audited both ways.`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// Every assertion below is NAMED and non-overlapping by construction, so each way
// this detector can rot is reported by exactly one failure that describes the
// actual cause. The discrimination assertions matter most: a predicate that
// approved everything, or a sweep that read nothing, would keep the corpus run
// green with the convention entirely gone.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };

  // ⛔ THE OFFER VERB IS HOISTED OUT OF EVERY FIXTURE THAT CARRIES TESTIMONY.
  // A fixture spelling `add …` inline, beside the words "shrink-only", would make
  // THIS FILE hand out an anchored offer — and the sweep reads every script in
  // scripts/, this one included. Interpolation is the way out that costs nothing:
  // it collapses to a gap placeholder in the source the sweep reads, and is the
  // exact word at runtime. Assertion (17) is what keeps this honest.
  const ADD = 'add';

  // (1) The lexer. A regex literal containing a quote must not desync it — the
  // measured first-cut bug, which silently swapped comment and string space for
  // the rest of the file.
  const lexFixture = 'const RE = /[\'"]/g; // add an entry to THE_LEDGER\nconst m = "real message";\n';
  const lexed = authorFacingMessages(lexFixture);
  expect('lexer — a regex literal containing a quote does not desync comment/string space '
    + '(the comment after it must NOT be read as author-facing text)',
    lexed.includes('real message') && !lexed.some((s) => s.includes('THE_LEDGER')));

  // (2) Message boundaries. Two unrelated diagnostics must not compose into one
  // offer — the measured check-adr-anchors.mjs false positive.
  const twoMessages = 'push(`first: add \\`.vN\\` to the filename.`);\npush(`second: the KNOWN_THING entry is stale.`);\n';
  expect('message boundary — a verb in one diagnostic does not reach a registry named in the '
    + 'NEXT diagnostic (the measured check-adr-anchors.mjs false positive)',
    authorFacingMessages(twoMessages).length === 2);

  // (3) Concatenation is ONE message. The mirror of (2): if `+`-joined literals
  // were split, every real multi-part remedy would lose its testimony.
  expect('message boundary — literals joined only by `+` stay ONE message, so a remedy built '
    + 'from three literals keeps the testimony written beside it',
    authorFacingMessages(`const m = '${ADD} an entry to ' + 'the ledger. It is ' + 'shrink-only.';`).length === 1);

  const offersIn = (src) => findOffers(src);

  // (4) Offer grammar, word order A: the registry FOLLOWS a preposition.
  expect('offer grammar — word order "… to … REGISTRY" is an offer',
    offersIn(`const m = 'Fix it properly. Or ${ADD} a MEASURED entry to scripts/x.baseline.json saying why not.';`).length > 0);

  // (5) Offer grammar, word order B — #8540 miss ①. The fixture carries NO
  // preposition at all before the registry, mirroring the real text in
  // check-type-check-coverage.mjs, where the location that follows "in" is an
  // interpolated path and the registry itself sits ahead of the noun. An earlier
  // draft of this fixture read "… entry in the ledger", which the prototype's
  // defect would have matched happily — the assertion would have passed while
  // pinning nothing. Fixtures for a word-order bug have to be word-ordered.
  expect('offer grammar — a registry named BEFORE the noun, with no preposition leading to it, is '
    + 'an offer (#8540 miss ①: the prototype demanded "add … to/in … REGISTRY" and so missed '
    + 'check-type-check-coverage.mjs entirely)',
    offersIn(`const TEST_DEBT = {};\nconst m = 'Fix it properly. Or ${ADD} a TEST_DEBT entry saying why not.';`).length > 0);

  // (6) The dot. A registry named by PATH must match — the measured `[^.;]` bug.
  const byPath = offersIn("const m = 'add it to scripts/role-word-baseline.json to admit the case.';");
  expect('offer grammar — an offer naming its ledger by PATH is matched (a gap class excluding '
    + 'the dot silently loses every path-named registry while the gate still reports clean)',
    byPath.length > 0 && byPath[0].target.name === 'scripts/role-word-baseline.json');

  // (7) The descriptive-modal guard — the measured regen-artifacts.mjs case.
  //
  // The fixture keeps the tail of the real sentence, and that is the whole point:
  // an earlier draft stopped at "a fresh gap gets a fresh line", which left NO
  // target after the verb — so the offer failed for want of a target and the
  // modal guard was never consulted at all. Mutation-testing caught it: deleting
  // the guard left this assertion green. An assertion whose fixture cannot reach
  // the mechanism it names is worse than no assertion, because it reads as cover.
  expect('offer grammar — "can WIDEN it" DESCRIBES a hazard and is not an offer '
    + '(the measured regen-artifacts.mjs false positive)',
    offersIn("const m = 'a SHRINK-ONLY ratchet. Regenerating it can WIDEN it — a fresh gap gets a "
      + "fresh exemption line, which is precisely how a ratchet quietly stops ratcheting.';").length === 0);

  // (8) Stage 2 discriminates. Same offer shape, no testimony → not a ratchet.
  // This is what keeps the ~20 declaration registries out, and it is what makes
  // (9) worth having: an anchor that fired on everything would keep (9) green.
  const declSrc = `const INHERIT_JUSTIFIED = []; const m = 'write model: inherit AND ${ADD} an entry to INHERIT_JUSTIFIED saying why.';`;
  const declOffers = findOffers(declSrc);
  if (declOffers.length === 0) {
    expect('stage 2 — the declaration-registry fixture is no longer recognised as an offer at all, '
      + 'so it cannot test the anchor. Re-spell it to match the offer grammar', false);
  } else {
    expect('stage 2 — an offer over a registry the gate gives NO shrink/governance testimony about '
      + 'is NOT anchored (this is what keeps declaration registries out)',
      anchorFor(declSrc, declOffers[0]) === null);
  }

  // (9) Stage 2 reaches a real ratchet, by each limb, so (8) is not vacuous.
  const shrinkSrc = `const m = '${ADD} a MEASURED entry to the baseline saying why not. That baseline is shrink-only.';`;
  const shrinkOffers = findOffers(shrinkSrc);
  expect('stage 2 — the SHRINK limb anchors an offer whose message testifies the registry only shrinks',
    shrinkOffers.length > 0 && anchorFor(shrinkSrc, shrinkOffers[0]) === 'shrink');
  const governSrc = `const m = '${ADD} a measured entry to the ledger saying why not. A ledger entry is a tracked exception the maintainer has agreed to.';`;
  const governOffers = findOffers(governSrc);
  expect('stage 2 — the GOVERN limb anchors check-driver-conformance.mjs\'s wording, which carries '
    + 'zero shrink vocabulary (#8540 miss ②)',
    governOffers.length > 0 && anchorFor(governSrc, governOffers[0]) === 'govern');

  // (10) NON-CIRCULARITY. The authority token must never be its own anchor: a
  // detector anchored by the compliance token can only ever examine gates that
  // already comply, and can never report a violation.
  const tokenOnly = `const m = 'add an entry to the ledger. ${RATCHET_AUTHORITY_MARKER}, not a co-equal option.';`;
  const tokenOffers = findOffers(tokenOnly);
  if (tokenOffers.length === 0) {
    expect('non-circularity — the token-only fixture is no longer an offer, so it cannot test '
      + 'circularity. Re-spell it to match the offer grammar', false);
  } else {
    expect('non-circularity — the authority token ALONE does not anchor a target (a detector the '
      + 'compliance token can anchor would examine only compliant gates and never report anything)',
      anchorFor(tokenOnly, tokenOffers[0]) === null);
  }

  // (11) Refusal, BOUND shape — check-adr-links.mjs / check-driver-memory-census.mjs.
  expect('refusal — a negation bound to the verb is a refusal ("do not add it to …"), the shape '
    + 'check-adr-links.mjs and check-driver-memory-census.mjs use',
    offerIsRefused({ context: 'fix the link; do not add it to KNOWN_DEAD_TARGETS to make this green.' }));

  // (12) Refusal, PREDICATION shape — check-type-source-resolution.mjs / check-test-source-alias.mjs.
  expect('refusal — an act named as subject and denied is a refusal ("widening the registry entry '
    + 'is not the fix"), the shape the two registry gates use',
    offerIsRefused({ context: 'Add the rules to its tsconfig.json — widening the registry entry is not the fix.' }));

  // (13) Refusal DISCRIMINATES. A marking gate's closing discouragement is not a
  // refusal; if it were, any gate could shed the token by appending a sentence.
  expect('refusal — a marking gate\'s closing discouragement is NOT a refusal ("do not take this '
    + 'path to get CI green" negates `take`, not the expanding act)',
    !offerIsRefused({ context: 'add a MEASURED entry to the baseline saying why not — do not take this path to get CI green.' }));

  // (14) End-to-end: an anchored, unrefused, unmarked offer is a VIOLATION. This
  // is the assertion that proves the gate can fail at all.
  const violation = `const m = 'Fix it properly. Or ${ADD} a MEASURED entry to the baseline saying why not. That baseline is shrink-only.';`;
  expect('end-to-end — an anchored, unrefused offer with no authority token classifies as UNMARKED '
    + '(proves the gate discriminates rather than approving every script it reads)',
    classify(violation).verdict === 'unmarked');

  // (15) …and the same text carrying the token classifies as MARKED. Paired with
  // (14) by construction: exactly one of the two can fire on a broken predicate.
  expect('end-to-end — the same offer carrying the authority token classifies as MARKED',
    classify(`const T = '${RATCHET_AUTHORITY_MARKER}';\n${violation}`).verdict === 'marked');

  // (16) The corpus-scale positive control, asserted here as well as in the run:
  // the sweep must still REACH every instance the control names. This is the
  // assertion that fails when the detector goes blind — the failure mode that a
  // control-less detector reports as a clean run.
  const results = sweep();
  const unreached = Object.entries(CONTROL)
    .filter(([, d]) => d.expect === 'marked' || d.expect === 'refused')
    .filter(([f]) => !results.has(f) || results.get(f).verdict === 'excluded')
    .map(([f]) => f);
  expect(`positive control at corpus scale — the sweep still REACHES every known instance; it no `
    + `longer reaches: ${unreached.join(', ') || '(none)'}`,
    unreached.length === 0);

  // (18) Compliance is carried in AUTHOR-FACING text, not in commentary. Found by
  // reverse verification: stripping the token from a real gate left this detector
  // green, because that gate's header mentions the token in a comment.
  const commentaryOnly = `// this gate marks the path ${RATCHET_AUTHORITY_MARKER} per #8435\n`
    + `const m = 'Fix it properly. Or ${ADD} a MEASURED entry to the baseline saying why not. That baseline is shrink-only.';`;
  expect('compliance — a gate that only MENTIONS the token in a comment does not count as carrying '
    + 'it (a source-wide search reads a gate\'s own commentary as compliance, so a gate could go '
    + 'silent for authors while this detector reported the farm clean)',
    classify(commentaryOnly).verdict === 'unmarked');

  // (19) …and the mirror: the token in a string literal DOES count. Paired with
  // (18) by construction, so exactly one of the two can fire on a broken check.
  const inLiteral = `const T = '${RATCHET_AUTHORITY_MARKER}';\n`
    + `const m = 'Fix it properly. Or ${ADD} a MEASURED entry to the baseline saying why not. That baseline is shrink-only.';`;
  expect('compliance — the token declared as a string literal DOES count as carrying it, which is '
    + 'how all six instrumented gates spell it',
    classify(inLiteral).verdict === 'marked');

  // (17) This gate must not be an instance of its own convention.
  expect('self-classification — this gate is NOT an instance of the convention it enforces (its '
    + 'control is a declaration registry, and its offer-shaped quotes live in comments)',
    results.get(SELF_FILE) !== undefined && results.get(SELF_FILE).verdict === 'excluded');

  if (failures.length > 0) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-ratchet-remedy-authority --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: the lexer holds, messages are bounded, both offer word orders and path-named '
    + 'registries are reached, declaration registries are not, the authority token cannot anchor '
    + 'itself, refusal is told apart from discouragement, and the sweep still reaches every known '
    + 'instance.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--list')) list();
else main();
