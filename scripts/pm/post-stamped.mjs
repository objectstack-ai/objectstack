#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * post-stamped — write a seat artefact to GitHub with a stamp this act read (#17314).
 *
 *   node scripts/pm/post-stamped.mjs --comment=17314 --file=body.md
 *   node scripts/pm/post-stamped.mjs --comment=17314          # body on stdin
 *   node scripts/pm/post-stamped.mjs --body=17314 --file=seat-post.md
 *   node scripts/pm/post-stamped.mjs --dry-run --comment=17314 --file=body.md
 *   node scripts/pm/post-stamped.mjs --self-test              # offline, no network at all
 *
 * ## The invariant, and the spelling this removes
 *
 * Every timestamp a seat writes into a GitHub comment or body — the reading
 * time in a subscript line, the `YYYY-MM-DDThh:mmZ` on claims, dispatches,
 * verdicts, round reports and seat-post edits — must come from a clock read by
 * the same act that writes the text, never from the seat's sense of elapsed
 * time. The protocol has required the stamp for a while; what it could not
 * remove is that an ESTIMATED stamp had a spelling. A seat typed the digits.
 *
 * Filed as MECHANICAL because the discipline remedy is spent: the triage seat
 * post records the same failure twice — R+164 (「轮次计时全靠感觉,错了约 4
 * 倍」), then R+165, ~70 minutes off with roughly fifteen audit comments
 * carrying the estimate — with a "measure it next time" note written BETWEEN
 * them that did not hold.
 *
 * So the seat writes a TOKEN and this tool writes the time:
 *
 *   `{{NOW}}`                    the clock read in THIS invocation.
 *   `{{WAS:2026-09-08T14:00Z}}`  a stamp that is a reading of something ELSE,
 *                                declared as such and rendered verbatim. The
 *                                seconds grain (`2026-09-08T14:00:30Z`) is
 *                                taken here too.
 *
 * There is no third spelling, and no flag that turns the contract off.
 *
 * ## What it refuses, and why the refusal is positional
 *
 * `check-half-states.mjs`'s H56 reads two POSITIONS as belonging to the writing
 * act: the artefact's OPENING line, and a subscript reading-time line. This
 * tool imports that same reader, so the write side refuses exactly what the
 * read-side patrol would file:
 *
 *   POSITIONAL  a bare stamp sits in one of those two positions. That is the
 *               act's own stamp typed by hand, which is the whole defect. Write
 *               `{{NOW}}`, or `{{WAS:…}}` if it really is a quoted reading.
 *   MIXED       the body uses `{{NOW}}` AND carries a bare stamp somewhere
 *               else. The author knows the token and typed a time anyway; that
 *               typed one is the estimate. This is the case the filing card
 *               names by hand.
 *   QUOTED      a `{{WAS:…}}` value is not one stamp and nothing else, or names
 *               an instant LATER than the clock this act holds. See the
 *               direction section below.
 *   UNKNOWN     a double-brace opener that is not one of the two tokens. A
 *               mistyped `{{now}}` would otherwise post literally AND leave the
 *               artefact unstamped, which is the quiet direction. See the
 *               opener scan below for what "not one of the two" now covers.
 *
 * ⛔ The positional refusal is NOT the mixed one widened for tidiness. Mixed
 * alone leaves the estimated stamp fully spellable — a seat that never types
 * `{{NOW}}` is never refused — so mixed alone would not have caught the
 * recorded failure, whose comments carried no token at all.
 *
 * ## The quoted route has a DIRECTION, not only a shape (#17763)
 *
 * Checking that a `{{WAS:…}}` value is shaped like a stamp leaves the estimate
 * spellable through the one escape this tool offers by name: a seat whose sense
 * of elapsed time runs AHEAD types its guess, is refused positionally, and the
 * refusal's own second option takes that same guess unchanged. The recorded
 * failures were forward-skewed, which is exactly the half a shape check cannot
 * see. So a quoted value is judged against the clock this act holds as well:
 * the quoted route renders a reading of something ELSE, and an instant that has
 * not happened yet is provably not a reading of anything.
 *
 * The boundary, and the two grains it is taken at. The accepted shape has a
 * minute form and a seconds form — `YYYY-MM-DDThh:mmZ` and
 * `YYYY-MM-DDThh:mm:ssZ` — and BOTH are quotable; a stamp names the SPAN of its
 * own grain (`stampSpan`, imported — the same widening H56 makes before it
 * measures drift), and the value is a possible reading exactly while that span
 * has STARTED. So a stamp equal to the act's own minute is ACCEPTED — a reading
 * taken at any instant inside this minute is spelled exactly that way — and the
 * refusal begins at the first minute whose start the clock has not reached. A
 * seconds-grained value is judged on its own second, which is narrower than the
 * minute around it, never on that minute.
 *
 * ⛔ There is no skew tolerance, and `H56_STAMP_TOLERANCE_MIN` is not one.
 * That number measures how far a WRITE may land after the read it carries — a
 * backward gap on the read side. Spending it forward here would reopen a
 * quarter-hour window on the very direction the recorded failures took.
 *
 * The same judgement corrects what the OTHER refusals offer: the positional and
 * mixed texts hand the seat `{{WAS:<the typed stamp>}}` with the stamp filled
 * in, so when that stamp is one the quoted route would itself refuse — later
 * than this act's clock, or naming no instant at all (the section below) — they
 * must stop offering a route that will refuse it. A refusal text prescribing a
 * refused remedy is a tool arguing with itself.
 *
 * A bare stamp OUTSIDE those two positions is passed through with a note on
 * stderr rather than refused: prose quoting a ruling's date is a reading of
 * something else, and refusing it would push seats back onto the channel this
 * tool exists to replace.
 *
 * ## The digits must name an instant the calendar HAS (#18289)
 *
 * The shape rule is the protocol's stamp REGEX, and a regex counts digits:
 * `2026-13-45T99:99Z` satisfies every class in it. The direction rule then let
 * it through in the quiet direction — `stampSpan` asks `Date.parse`, which
 * answers NaN, so the span is null, so "is this later than now" is `false`. Not
 * future, therefore not refused: the value was rendered VERBATIM and
 * `--dry-run` reported "1 quoted stamp(s) rendered verbatim" at exit 0. A stamp
 * no clock could ever have shown went onto the board as a reading.
 *
 * `Date.parse` has two ways of not meaning what the digits say, and only the
 * first one is loud:
 *
 *   NaN          a field outside its own range — month 13 or 00, day 45 or 00,
 *                hour 99, minute 99, second 60. Nothing comes back to judge.
 *   ROLLED OVER  a field inside its range but not on the calendar — 31 April,
 *                29 February in a non-leap year, hour 24. These are rolled
 *                FORWARD silently, so `2026-04-31T00:00Z` is a real number: the
 *                one that spells 2026-05-01. It parses, it is in the past, and
 *                it is not the date its own text names. Measured on this
 *                runtime, not assumed.
 *
 * One rule refuses both: re-render the instant it parsed to, at the stamp's own
 * grain, and require the bytes back unchanged (`stampRealInstant`). A value
 * that round-trips to a different date is not a reading of the instant it
 * names — it is a typo this tool would otherwise publish as a measurement,
 * which is the defect the whole file exists to close, reached by another road.
 *
 * ⛔ The round trip is not a second shape check, and the three rules fire one
 * at a time. The shape rule owns what a quoted payload may SAY (one stamp and
 * nothing else); this one owns whether the thing it says EXISTS; the direction
 * rule owns whether the clock has reached it. A payload that fails the shape is
 * never also filed as a calendar problem, and a date the calendar does not have
 * is never also filed as a direction one — one typo, one refusal.
 *
 * ⛔ And it narrows nothing. Every value this tool accepted before — both
 * grains, a leap day in a leap year, whitespace inside the declaration —
 * round-trips by construction, because a stamp the calendar has is exactly what
 * `Date.parse` returns unchanged.
 *
 * ## EVERY `{{` is a token this tool can render, or the body is refused (#18284)
 *
 * The UNKNOWN refusal above used to run AFTER substitution, over whatever
 * `{{…}}` the two regexes had left behind. Both of those regexes spell their
 * payload `[^{}]*`, so a token-shaped opener whose payload carries a BRACE, or
 * that never closes at all, matched neither one — it was not substituted,
 * because nothing recognised it, and it was not refused either, because the
 * leftover scan could not see it. It was copied to the board verbatim.
 *
 * That is not a hypothetical. A seat filled a `{{WAS:…}}` slot from a shell
 * variable, the read failed, and the variable held a multi-line Node dump —
 * which carries braces. `--dry-run` printed its DRY RUN line reporting "0
 * token(s) substituted, 0 quoted stamp(s) rendered verbatim", the live write
 * printed 「comment posted」, and the stored comment carried the opener, the
 * dump and the closer. A leftover double-brace opener in a stored artefact is
 * never intended by anyone.
 *
 * So the check moved AHEAD of substitution and changed what it walks: not the
 * tokens a regex happens to match, but every `{{` in the body, each of which
 * must be `{{NOW}}` or a `{{WAS:…}}` whose payload is brace-free and closed.
 * Four shapes are refused there — an unknown token NAME, an opener with no
 * closer, a brace inside the payload, a second opener before the first closes
 * — and the refusal prints the offending span so the typo is findable.
 *
 * ⛔ The scan judges the SHAPE and stops. Whether an admitted `{{WAS:…}}`
 * payload is really an instant, and one the clock has reached, stays with
 * `stampRefusals` — two places deciding "what is a quoted stamp" is two
 * spellings of one decision, which is the defect this file spends its length
 * avoiding. What the scan guarantees `stampRefusals` is the thing that rule
 * could not previously assume: that `maskQuotedStamps` consumed every opener,
 * so the BARE-stamp scan underneath it is reading prose and not the inside of a
 * token nobody could parse.
 *
 * ⛔ And the scan opens no escape hatch. There has never been one — no
 * backslash form, no entity form — and a token inside backticks is still
 * substituted, because a fence is a rendering instruction and the substitution
 * runs on bytes. A body that must SHOW a token spells it some other way.
 *
 * ## ⚖️ Why this ACTS by default, where `sweep-closed-cards.mjs` dry-runs
 *
 * Its sibling next door defaults to a dry run and needs `--write`, because it
 * is a machine deciding BY ITSELF which of thousands of archived cards to
 * write to: the blast radius is the board and the operator sees the list only
 * afterwards. This tool writes ONE artefact, to a target the caller named on
 * the command line, from a body the caller wrote. Demanding a second flag on
 * top of `--comment=17314` is a second spelling of one decision, and a helper
 * with friction gets bypassed for the channel that has none — which is the
 * failure this card exists to close. `--dry-run` prints the substituted body
 * and writes nothing.
 *
 * ## The read-back, which is what makes the transcript proof
 *
 * After the write the artefact is fetched again and three things are printed:
 * the id and URL, the platform's own `created_at` (`updated_at` for a body
 * edit, which is when that write happened), and the DRIFT between the stamp
 * this run substituted and that instant — the same measurement H56 makes on
 * the corpus, taken at write time, against the same imported tolerance. The
 * stored bytes are then compared with the bytes sent, judged by the declared
 * set below, so a body the platform's sanitizer mutated is reported instead of
 * assumed — and a body the platform merely NORMALISED is named instead of
 * warned about.
 *
 * ## The read-back names the normalisations, or its warning is noise (#18296)
 *
 * That comparison was `stored === sent`, and GitHub stores no body
 * byte-for-byte. Measured across one shift: every body refresh read back one
 * byte short (the platform strips the trailing newline), every comment 58 bytes
 * long (it appends its footer block) — and the ONE real mutation of that shift,
 * a token the sanitizer ate out of a PR's provenance line, printed the SAME
 * sentence as all of them. A warning that fires on nearly every write is not a
 * warning: a seat learns to scroll past it, which is exactly how that token
 * went unread until the next re-read.
 *
 * So the stored body is judged against a DECLARED set of normalisations, each
 * one measured in this repository, and the line NAMES the one it saw:
 *
 *   identical                   the bytes came back as they went out.
 *   trailing-newline-stripped   stored is the sent body minus its trailing
 *                               newline(s) — the reading every `--body`
 *                               refresh takes, and every comment whose sent
 *                               body already ended in the footer block.
 *   footer-appended             stored is that body plus EXACTLY
 *                               `PLATFORM_COMMENT_FOOTER`, with or without the
 *                               strip above. ⛔ COMMENT MODE ONLY: whether the
 *                               platform synthesises a footer for a footer-less
 *                               ISSUE BODY is unmeasured, and an unmeasured
 *                               cell is not a cell this tool forgives — a
 *                               footer on a body read-back stays MUTATED until
 *                               somebody measures it.
 *   mutated                     anything else — the warning, kept whole, plus
 *                               the FIRST DIFFERING BYTE and what stands at it
 *                               on each side.
 *
 * ⛔ An exact declared set, ⛔ never a tolerant comparison. Trimming both sides
 * or matching the footer with a pattern buys the same quiet by making the tool
 * agree with whatever it is shown, and what it would then agree with is a
 * footer the sanitizer has chewed or a whitespace edit nobody made. The
 * declared set forgives what was measured and stays loud about everything else,
 * which is the only version of this line a reader can act on.
 *
 * ⛔ And the offset is counted in BYTES, never in characters or lines: the line
 * already counts bytes on both sides, the platform's own deltas are quoted in
 * bytes, and a multi-byte character ahead of the difference must not move the
 * number a reader checks against `Buffer.byteLength`. The mutated line carries
 * up to `SPAN_BYTES` bytes from each body starting AT that offset — every byte
 * before it is identical in both by construction, so a window spent on them
 * would print the one thing already known.
 *
 * ## The unread-knock check on a body refresh (#17905)
 *
 * The read side of the seat-post protocol reads the body plus the comments
 * NEWER THAN THE BODY'S LAST EDIT — approved on purpose, and kept. Its cost is
 * that a body refresh closes that window on every comment inside it: a knock
 * nobody has read yet is not "old" afterwards, it is gone, and the knocker gets
 * no signal. Measured: a director-ruled cross-lane request knocked on a seat
 * post at 13:20Z, the body was refreshed at 15:58Z, and the request reached the
 * seat nine hours later, by escalation to a card. So `--body` REFUSES to write
 * while comments newer than the body's last write exist and the refresh names
 * none of them:
 *
 *   --ack-through=ID   the id of the NEWEST comment on the card — which a seat
 *                      cannot know without reading the tail to its end, so the
 *                      flag is a proof of reading, not a switch. Naming an older
 *                      comment is refused with the ones that landed after it,
 *                      and a comment that lands between the read and the write
 *                      is refused the same way.
 *
 * "The body's last write" has no platform field: the REST issue object carries
 * `updated_at`, which moves on comments and labels too, and the body's edit
 * history is GraphQL-only, which agent containers cannot reach. So the instant
 * is read from the body ITSELF — the newest protocol stamp in the stored body
 * that names an instant the calendar HAS, which is this tool's own `{{NOW}}`
 * whenever the last refresh came through it (the protocol says every seat-post
 * stamp does). ⚠️ That derivation is a LOWER bound: a refresh that carried no
 * `{{NOW}}`, or one made by hand, leaves an older stamp behind, so MORE
 * comments count as newer, never fewer — the check may ask for an
 * acknowledgement it did not strictly need, and cannot skip one it did. A body
 * with no stamp at all counts every comment, and says so.
 *
 * "Names an instant the calendar has" is the load-bearing half of that promise,
 * not a politeness. `Date.parse` rolls an impossible date FORWARD and hands back
 * an ordinary number, so a stored `2026-04-31T00:00Z` reads as 1 May — LATER
 * than its own digits — and a knock at 30 April falls outside a window measured
 * from it: the derivation would have SHRUNK, which is the one direction it may
 * never move. So a stamp `stampRealInstant` judges unreal (NaN or rolled over —
 * the same round trip the write side refuses a quoted stamp with, one predicate
 * and never two) is not read as the last write at all. The derivation falls
 * back to the newest REAL stamp, which is earlier, so the window only widens;
 * a body whose stamps are ALL unreal lands on the no-stamp rule above and
 * counts every comment. Nothing else changes — a card with nothing newer is
 * still written, because refusing a refresh nobody knocked on would break the
 * same acceptance the next paragraph states. Refusal and pass both NAME the
 * stamps that were not read: a window wider than the body looks is a thing the
 * transcript has to be able to say.
 *
 * ⛔ It cannot tell a knock from any other comment: under one shared identity
 * the author field names no seat, and content is not classified. So the control
 * the acceptance demands — "no unread knock ⇒ the refresh is not affected" —
 * holds exactly as stated: no comment newer than the last write ⇒ no flag, no
 * refusal, and the write is what it was before this check existed; one newer
 * comment of any kind ⇒ one flag naming it. `--comment` is untouched (a comment
 * voids nothing), and `--dry-run` stays offline and does not run it.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  H56_STAMP_TOLERANCE_MIN,
  PROXY_FLAG,
  h56StampedReadings,
  protocolStamps,
  proxyRearmPlan,
  resolveSweepRepo,
  stampDriftMinutes,
  stampSpan,
} from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_REFUSED = 2;

/**
 * The re-exec guard, per script rather than shared with its neighbours: two
 * scripts sharing one guard name means the first one's re-exec silently
 * disarms the second's when they run in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_POST_STAMPED_PROXY_REARMED';

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/** The token a seat writes where the act's own stamp goes. */
export const STAMP_TOKEN = '{{NOW}}';

/**
 * The declared QUOTED stamp — a reading of something else, rendered verbatim.
 *
 * ⛔ NOT global, for `PROTOCOL_STAMP_RE`'s reason: an exported `g`-flagged
 * regex carries `lastIndex` between callers. Every use below builds its own.
 */
export const QUOTED_TOKEN_RE = /\{\{WAS:([^{}]*)\}\}/;

/**
 * Any well-formed `{{…}}` token — an opener, a brace-free payload, a closer.
 * Read by the opener scan to tell a token with an unknown NAME (`{{now}}`, and
 * the rest of the typo family) from one that does not close at all.
 */
export const ANY_TOKEN_RE = /\{\{[^{}]*\}\}/;

const globalOf = (re) => new RegExp(re.source, 'g');
const anchoredOf = (re) => new RegExp(`^${re.source}`);

/** The double-brace pair every token in this contract is built out of. */
const TOKEN_OPENER = '{{';
const TOKEN_CLOSER = '}}';

/** How much of an offending span a refusal prints. */
export const SPAN_BYTES = 60;

/**
 * The C0 controls that have a spelling everybody reads; the rest get `\xNN`.
 * ⛔ Written as escapes rather than as the bytes themselves — a raw control
 * byte in a source file is what `check:nul-bytes` exists to keep out.
 */
const CONTROL_ESCAPES = Object.freeze({ '\n': '\\n', '\r': '\\r', '\t': '\\t' });
const CONTROL_RE = /[\u0000-\u001f\u007f]/gu;

/**
 * An offending span as a refusal can print it: the first `SPAN_BYTES` BYTES,
 * every control character spelled out, one line.
 *
 * Bytes rather than characters because the span this exists for is a shell
 * variable that went wrong — a Node dump, a stack trace, a whole file — and a
 * refusal that inlines it raw stops being readable at exactly the moment a
 * reader needs it. The cut is taken on the byte, then a half-character left at
 * the edge is dropped rather than printed as a replacement glyph.
 */
export function offendingSpan(text, limit = SPAN_BYTES) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  const clipped = buf.byteLength > limit;
  const head = clipped
    ? buf.subarray(0, limit).toString('utf8').replace(/\uFFFD+$/u, '')
    : buf.toString('utf8');
  return `${escapeControls(head)}${clipped ? '…' : ''}`;
}

/**
 * Every control character in a piece of text, spelled the way `offendingSpan`
 * spells it — one rendering of "show me the offender", shared by the refusals
 * and by the read-back's first-difference context, never two.
 */
function escapeControls(text) {
  return String(text ?? '').replace(CONTROL_RE, (ch) => CONTROL_ESCAPES[ch] ?? `\\x${ch.codePointAt(0).toString(16).padStart(2, '0')}`);
}

/** Why an opener is not a token, in the words the refusal prints. */
export const OPENER_REASONS = Object.freeze({
  'unknown-token-name': 'a well-formed token, but not one this tool knows',
  'unclosed-opener': 'an opener with no closer after it anywhere in the body',
  'brace-in-payload': 'a brace inside the payload, so no token ends here',
  'nested-opener': 'a second opener before this one is closed',
});

/**
 * Every `{{` in this text that is not one of the two tokens, in the order a
 * reader meets them. An empty array is a body whose every opener renders.
 *
 * The walk is positional rather than a regex sweep on purpose: the defect this
 * closes is an opener NO regex in this file matches, so a scan built out of
 * those same regexes would walk straight past it again. What the regexes are
 * still used for is recognition at a known position — anchored, so the one
 * definition of "a quoted token" serves both the scan and the substitution.
 */
export function unrecognisedOpeners(text) {
  const raw = String(text ?? '');
  const quotedHere = anchoredOf(QUOTED_TOKEN_RE);
  const anyHere = anchoredOf(ANY_TOKEN_RE);
  const out = [];
  let i = 0;
  for (;;) {
    const at = raw.indexOf(TOKEN_OPENER, i);
    if (at === -1) return out;
    const rest = raw.slice(at);

    if (rest.startsWith(STAMP_TOKEN)) {
      i = at + STAMP_TOKEN.length;
      continue;
    }
    const quoted = quotedHere.exec(rest);
    if (quoted) {
      // A recognised SHAPE. Whether the payload is an instant the clock has
      // reached is `stampRefusals`' rule, not this one.
      i = at + quoted[0].length;
      continue;
    }
    const wellFormed = anyHere.exec(rest);
    if (wellFormed) {
      out.push({ kind: 'unknown-token-name', at, span: wellFormed[0] });
      i = at + wellFormed[0].length;
      continue;
    }

    const close = raw.indexOf(TOKEN_CLOSER, at + TOKEN_OPENER.length);
    if (close === -1) {
      // Nothing after an unclosed opener can be resynchronised on: every later
      // `{{` is arguably inside it. One refusal, naming where it starts.
      out.push({ kind: 'unclosed-opener', at, span: rest });
      return out;
    }
    const span = raw.slice(at, close + TOKEN_CLOSER.length);
    out.push({
      kind: span.slice(TOKEN_OPENER.length).includes(TOKEN_OPENER) ? 'nested-opener' : 'brace-in-payload',
      at,
      span,
    });
    i = close + TOKEN_CLOSER.length;
  }
}

/** The refusal a caller reads when an opener is not a token this tool renders. */
export function unrecognisedOpenerText(problems) {
  const rows = (problems ?? []).map(
    (p, i) => `  ${i + 1}. [${p.kind}] ${OPENER_REASONS[p.kind] ?? p.kind} — \`${offendingSpan(p.span)}\``,
  );
  return (
    `post-stamped: REFUSED — ${rows.length} double-brace opener(s) in this body are not tokens this tool\n` +
    '  can render. Nothing was written.\n' +
    `${rows.join('\n')}\n\n` +
    '  Posting them would put the literal text on the card AND leave the artefact unstamped, which is\n' +
    '  the quiet direction: an opener nothing recognises is substituted by nothing and refused by\n' +
    `  nothing. The tokens this tool knows are \`${STAMP_TOKEN}\` and \`{{WAS:YYYY-MM-DDThh:mmZ}}\`; a\n` +
    '  mistyped one is a typo, and a typo must never decide whether a stamp was read. (Spans are\n' +
    `  clipped to ${SPAN_BYTES} bytes with control characters escaped, so a payload that arrived from a\n` +
    '  shell read gone wrong stays readable.)'
  );
}

/** The clock, in the protocol's own spelling. */
export function stampNow(ms = Date.now()) {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/**
 * The text with every declared quoted stamp blanked to spaces of equal length,
 * so a scan for BARE stamps sees only the ones nobody declared — and so line
 * numbers, columns and the opening line are all still where they were.
 */
export function maskQuotedStamps(text) {
  return String(text ?? '').replace(globalOf(QUOTED_TOKEN_RE), (m) => ' '.repeat(m.length));
}

/** The values inside every `{{WAS:…}}` in this text. */
export function quotedStampValues(text) {
  const re = globalOf(QUOTED_TOKEN_RE);
  const out = [];
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push(m[1]);
  return out;
}

/**
 * The seconds grain, in the same spelling `stampSpan` uses to pick its widening
 * — mirrored rather than imported, because `stampSpan` does not export the
 * test. A self-test case holds the two equal, so a change on either side is a
 * red rather than a silent disagreement about which second a stamp names.
 */
const SECONDS_GRAIN_RE = /\d{2}:\d{2}:\d{2}Z$/;

/**
 * Whether `stamp` names an instant the calendar actually HAS — and, when it
 * does not, the date it names instead.
 *
 * `Date.parse` fails two different ways here and only one of them is visible.
 * An out-of-range field (month 13, day 45, 99:99) gives NaN. A field inside its
 * range but not on the calendar (31 April, 29 February in a non-leap year, hour
 * 24) is rolled FORWARD into the next real date and returned as an ordinary
 * number — so `2026-04-31T00:00Z` parses, sits in the past, and is not the date
 * its digits spell. So the test is a ROUND TRIP: re-render the parsed instant
 * at the stamp's own grain and require the bytes back.
 *
 * ⛔ `rolledTo` is null for the NaN half and a stamp for the rolled-over half,
 * never the input — so a caller cannot report a rollover that did not happen.
 */
export function stampRealInstant(stamp) {
  const text = String(stamp ?? '').trim();
  const span = stampSpan(text);
  if (span === null) return { real: false, rolledTo: null };
  const rolledTo = `${new Date(span.from).toISOString().slice(0, SECONDS_GRAIN_RE.test(text) ? 19 : 16)}Z`;
  return rolledTo === text ? { real: true, rolledTo: null } : { real: false, rolledTo };
}

/**
 * Whether `stamp` names an instant the clock this act holds has NOT reached.
 *
 * The stamp is widened to its own grain first (`stampSpan`, imported rather
 * than re-derived — H56 measures drift against the same span, and two spellings
 * of "which minute is this" would let the write side and the read side disagree
 * about the boundary). A value is a possible reading exactly while its span has
 * started, so the current minute is accepted and the next one is not.
 *
 * A value that names no instant is NOT future — it is `stampRealInstant`'s
 * business, and answering `true` here would file one typo under two kinds.
 */
export function stampIsFuture(stamp, nowMs = Date.now()) {
  const span = stampSpan(String(stamp ?? '').trim());
  return span !== null && span.from > nowMs;
}

/**
 * Why the quoted route cannot take this bare stamp, as the clause a remedy text
 * appends — or null when the route IS open to it.
 *
 * The positional and mixed refusals hand the seat `{{WAS:<the typed stamp>}}`
 * with the stamp filled in, so a stamp the quoted route would itself refuse
 * must not be offered through it. One predicate for both texts and both
 * closures: two spellings of "may this be quoted" is how a remedy comes to
 * prescribe a refusal.
 */
function quotedRouteClosed(stamp, nowMs) {
  if (!stampRealInstant(stamp).real) {
    return `\`${stamp}\` names no instant the calendar has, so it is not a reading of anything either`;
  }
  if (stampIsFuture(stamp, nowMs)) {
    return (
      `\`${stamp}\` is later than the clock this act holds (\`${stampNow(nowMs)}\`), so it cannot be a ` +
      'reading of something else either'
    );
  }
  return null;
}

/**
 * Every reason this body may not be posted, in the order a reader should fix
 * them. An empty array is a body that may be written.
 *
 * `nowMs` is the clock the WRITING act holds — the same one `renderBody`
 * substitutes, passed through so the direction check judges against the instant
 * this body is being written at, never a second read taken later.
 */
export function stampRefusals(text, nowMs = Date.now()) {
  const raw = String(text ?? '');
  const masked = maskQuotedStamps(raw);
  const refusals = [];
  const now = stampNow(nowMs);

  for (const value of quotedStampValues(raw)) {
    if (protocolStamps(value).length !== 1 || protocolStamps(value)[0] !== value.trim()) {
      refusals.push({
        kind: 'quoted-not-a-stamp',
        detail:
          `\`{{WAS:${offendingSpan(value)}}}\` does not declare a stamp. The quoted route renders a reading of ` +
          'something else VERBATIM, so its contents must be one `YYYY-MM-DDThh:mmZ` and nothing else — ' +
          'it is a declaration, not a free-text escape from the contract.',
      });
      continue;
    }
    const calendar = stampRealInstant(value);
    if (!calendar.real) {
      refusals.push({
        kind: 'quoted-no-such-instant',
        detail:
          `\`{{WAS:${offendingSpan(value)}}}\` is shaped like a stamp but names no instant the calendar has` +
          (calendar.rolledTo === null
            ? ' — a field is outside its own range, so it does not parse at all. '
            : ` — it rolls over to \`${calendar.rolledTo}\`, which is a different date from the one its digits ` +
              'spell. ') +
          'The quoted route renders a reading of something ELSE verbatim, and no clock has ever shown an ' +
          'instant that does not exist — the digit shape is satisfied by month 13 and 99:99 alike, so a ' +
          'value that clears it is still a typo until the calendar agrees. Correct the digits to the ' +
          `instant that was actually read, or write \`${STAMP_TOKEN}\` if it is this act's own clock.`,
      });
      continue;
    }
    if (!stampIsFuture(value, nowMs)) continue;
    refusals.push({
      kind: 'quoted-in-the-future',
      detail:
        `\`{{WAS:${value}}}\` declares an instant LATER than the clock this act holds (\`${now}\`). The ` +
        'quoted route renders a reading of something ELSE verbatim, and a time that has not happened yet ' +
        'is provably not a reading of anything — it is an estimate with a declaration wrapped round it, ' +
        `which is the defect this tool exists to make unspellable. Write \`${STAMP_TOKEN}\` if it is this ` +
        'act\'s own clock, or correct the value to the instant that was actually read. There is no skew ' +
        'tolerance here, forward: a stamp the clock has not reached is not nearly a reading.',
    });
  }

  const positional = h56StampedReadings(masked);
  for (const hit of positional) {
    const opener =
      `${hit.where} carries the bare stamp \`${hit.stamp}\`. That position belongs to the writing ` +
      'act, so a stamp typed there is the act\'s own time written from memory — the defect this tool ' +
      'exists to make unspellable. ';
    const closed = quotedRouteClosed(hit.stamp, nowMs);
    refusals.push({
      kind: 'positional',
      detail: closed
        ? `${opener}Write \`${STAMP_TOKEN}\` there. The quoted route is NOT open to this one: ${closed}.`
        : `${opener}Write \`${STAMP_TOKEN}\` there, or \`{{WAS:${hit.stamp}}}\` if it ` +
          'is genuinely a reading of something else.',
    });
  }

  if (raw.includes(STAMP_TOKEN)) {
    const seen = new Set(positional.map((hit) => hit.stamp));
    for (const stamp of protocolStamps(masked)) {
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      const opener =
        `this body uses \`${STAMP_TOKEN}\` and also carries the bare stamp \`${stamp}\`. One of the ` +
        'two clocks was read by this act and the other was typed; a reader cannot tell which. ';
      const closed = quotedRouteClosed(stamp, nowMs);
      refusals.push({
        kind: 'mixed',
        detail: closed
          ? `${opener}Make it \`${STAMP_TOKEN}\` if it is this act's own. The quoted route is NOT open to ` +
            `it: ${closed}.`
          : `${opener}Declare ` +
            `it with \`{{WAS:${stamp}}}\` if it is a quoted reading, or make it \`${STAMP_TOKEN}\` if it ` +
            'is this act\'s own.',
      });
    }
  }

  return refusals;
}

/** The refusal a caller reads, from `stampRefusals`' rows. */
export function refusalText(refusals) {
  const rows = (refusals ?? []).map((r, i) => `  ${i + 1}. [${r.kind}] ${r.detail}`);
  return (
    `post-stamped: REFUSED — ${rows.length} stamp-contract problem(s) in the body. Nothing was written.\n` +
    `${rows.join('\n')}\n\n` +
    `  The contract has exactly two spellings: \`${STAMP_TOKEN}\` for the clock this act reads, and\n` +
    '  `{{WAS:YYYY-MM-DDThh:mmZ}}` for a stamp that is a reading of something else — an instant the\n' +
    '  clock has already reached, since nothing can be read out of the future. There is no flag that\n' +
    '  turns it off — a stamp typed from memory is the defect, not a formatting preference.'
  );
}

/**
 * The body as it will be written, or the refusal. Pure, so every branch that
 * decides whether a write happens at all is pinned offline.
 */
export function renderBody(text, nowMs = Date.now()) {
  const raw = String(text ?? '');
  if (raw.trim().length === 0) {
    return {
      ok: false,
      kind: 'empty',
      error:
        'post-stamped: REFUSED — the body is empty. An empty artefact posted to a card is noise a\n' +
        '  reader has to judge; supply a body with --file=PATH or on stdin.',
    };
  }
  // ⛔ Ahead of `stampRefusals`, and not folded into it. Its bare-stamp scan
  // reads `maskQuotedStamps`, which is built out of the very regex an
  // unrecognised opener defeats — so until every opener is a token, what that
  // scan calls "a bare stamp in the opening line" may be the inside of a token
  // nobody could parse. One opener, one refusal: the shape first, alone.
  const openers = unrecognisedOpeners(raw);
  if (openers.length > 0) {
    return { ok: false, kind: 'unknown-token', openers, error: unrecognisedOpenerText(openers) };
  }

  const refusals = stampRefusals(raw, nowMs);
  if (refusals.length > 0) return { ok: false, kind: 'stamp-contract', refusals, error: refusalText(refusals) };

  const stamp = stampNow(nowMs);
  let quoted = 0;
  let body = raw.replace(globalOf(QUOTED_TOKEN_RE), (_m, inner) => {
    quoted += 1;
    return inner;
  });
  const substituted = body.split(STAMP_TOKEN).length - 1;
  body = body.split(STAMP_TOKEN).join(stamp);

  // ⛔ No second leftover scan here. The one that used to sit at this line
  // matched `{{…}}` AFTER substitution, which is both too late and too narrow:
  // too late because an opener that never closes is not a leftover of anything,
  // and too narrow because its payload class excluded the braces the filed
  // artefact's payload carried. `unrecognisedOpeners` above walks every opener
  // instead, and the two stamps substituted here carry no braces — so a second
  // check at this line could never fire, and a check that cannot fire is a
  // check nobody maintains.
  return { ok: true, body, stamp, substituted, quoted };
}

/**
 * The block the platform appends to a COMMENT whose sent body does not already
 * carry one: a blank line, a rule, the bare attribution line — 58 bytes,
 * measured on every comment this seat's tooling posted through the REST proxy,
 * and the same 58 the register records for both comment channels.
 *
 * ⛔ The exact bytes, ⛔ never a regex and ⛔ never a trim. What a read-back
 * asks is whether the difference is EXACTLY a normalisation somebody measured;
 * a pattern that matches "a footer, roughly" also forgives a footer the
 * sanitizer has chewed, which is the one mutation this verdict exists to make
 * legible.
 */
export const PLATFORM_COMMENT_FOOTER = '\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_';

/**
 * The vocabulary of what a stored body can show, and what each word means.
 * Declared so the line, the `--json` field and the self-test spell one set of
 * names rather than three.
 */
export const READ_BACK_CLASSES = Object.freeze({
  unreadable: 'the platform returned no readable body — the write is UNVERIFIED',
  identical: 'the bytes came back exactly as they went out',
  'trailing-newline-stripped': 'the stored body is the sent body minus its trailing newline(s)',
  'footer-appended': "the stored body is that body plus exactly the platform's comment footer",
  mutated: 'something nobody measured — the bytes disagree, and the offset says where',
});

/**
 * The first byte at which two bodies disagree, or `-1` when they do not.
 *
 * UTF-8 BYTES, because that is the unit both halves of this line already count
 * in and the unit the platform's own deltas are quoted in. Where one body is a
 * PREFIX of the other the answer is the shorter one's length — the first byte
 * it does not have — so a pure append and a pure truncation both land at the
 * seam rather than reporting "no difference".
 */
export function firstDifferingByte(sent, stored) {
  const a = Buffer.from(String(sent ?? ''), 'utf8');
  const b = Buffer.from(String(stored ?? ''), 'utf8');
  const shared = Math.min(a.byteLength, b.byteLength);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.byteLength === b.byteLength ? -1 : shared;
}

/**
 * Up to `limit` bytes of one body starting AT a byte offset, escaped the way a
 * refusal escapes a span. The window opens at the offset rather than around it
 * because every byte before it is identical in both bodies by construction.
 *
 * A window that starts at or past the end of its body prints `(end of body)`:
 * where one body is a prefix of the other, "this one stops here" IS the
 * finding, and an empty string would render it as nothing at all.
 */
function byteWindowFrom(text, from, limit = SPAN_BYTES) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  if (!Number.isInteger(from) || from < 0 || from >= buf.byteLength) return '(end of body)';
  const clipped = buf.byteLength > from + limit;
  const shown = buf
    .subarray(from, from + limit)
    .toString('utf8')
    .replace(/^�+/u, '')
    .replace(/�+$/u, '');
  return `${from > 0 ? '…' : ''}${escapeControls(shown)}${clipped ? '…' : ''}`;
}

/**
 * Which of the platform's KNOWN normalisations the stored body shows, judged
 * exactly — the whole vocabulary is `READ_BACK_CLASSES` and the reasoning is
 * the header's read-back section.
 *
 * ⛔ `mode` defaults to `body`, the STRICT side, and the comment-only footer
 * rule must be asked for by name. A default that forgave a footer wherever it
 * appeared would be a second warning nobody can act on — the defect this
 * function was rewritten to close — and the issue-body cell is UNMEASURED: no
 * reading in this repository says whether the platform synthesises a footer for
 * a footer-less body, so that shape stays MUTATED with its offset until one
 * does.
 */
export function classifyReadBack({ sent, stored, mode = 'body' } = {}) {
  if (typeof stored !== 'string') return { class: 'unreadable', offset: null, strippedNewlines: 0 };
  const sentText = String(sent ?? '');
  if (stored === sentText) return { class: 'identical', offset: null, strippedNewlines: 0 };

  const trimmed = sentText.replace(/\n+$/u, '');
  const strippedNewlines = sentText.length - trimmed.length;
  if (strippedNewlines > 0 && stored === trimmed) {
    return { class: 'trailing-newline-stripped', offset: null, strippedNewlines };
  }
  if (mode === 'comment') {
    if (stored === `${sentText}${PLATFORM_COMMENT_FOOTER}`) {
      return { class: 'footer-appended', offset: null, strippedNewlines: 0 };
    }
    if (strippedNewlines > 0 && stored === `${trimmed}${PLATFORM_COMMENT_FOOTER}`) {
      return { class: 'footer-appended', offset: null, strippedNewlines };
    }
  }

  const offset = firstDifferingByte(sentText, stored);
  return {
    class: 'mutated',
    offset,
    strippedNewlines: 0,
    sentContext: byteWindowFrom(sentText, offset),
    storedContext: byteWindowFrom(stored, offset),
  };
}

/**
 * What the read-back proves, as lines a transcript carries. `writtenAt` is the
 * platform's own clock for the write — `created_at` for a comment, `updated_at`
 * for a body edit, which is when that write actually happened. `mode` is the
 * act this verdict is about, and it is load-bearing: the footer rule is
 * comment-only, so a verdict that does not know which act it read cannot apply
 * it — and gets the strict reading rather than a guess.
 */
export function readBackVerdict({ stamp, writtenAt, sent, stored, substituted = 0, mode = 'body' }) {
  const lines = [];
  const drift = substituted > 0 ? stampDriftMinutes(stamp, writtenAt, writtenAt) : null;
  if (substituted === 0) {
    lines.push(`  stamp: none substituted — this body carried no ${STAMP_TOKEN}, so there is no clock to check`);
  } else if (drift === null) {
    lines.push(`  ⚠️ stamp: \`${stamp}\` substituted, but the platform returned no readable write time — NOT MEASURED`);
  } else if (drift === 0) {
    lines.push(`  stamp: \`${stamp}\` · platform wrote it at ${writtenAt} · drift 0 — one clock, one act`);
  } else {
    lines.push(
      `  ⚠️ stamp: \`${stamp}\` · platform wrote it at ${writtenAt} · drift ${drift} min` +
        (drift > H56_STAMP_TOLERANCE_MIN
          ? ` — BEYOND the ${H56_STAMP_TOLERANCE_MIN}-minute tolerance; H56 will file this artefact`
          : ` — within the ${H56_STAMP_TOLERANCE_MIN}-minute tolerance`),
    );
  }
  const sentBytes = Buffer.byteLength(String(sent ?? ''), 'utf8');
  const storedBytes = typeof stored === 'string' ? Buffer.byteLength(stored, 'utf8') : null;
  const readBack = classifyReadBack({ sent, stored, mode });
  if (readBack.class === 'unreadable') {
    lines.push('  ⚠️ read-back: the stored body could not be read — the write is UNVERIFIED, not verified');
  } else if (readBack.class === 'identical') {
    lines.push(`  read-back: ${sentBytes} byte(s) stored, IDENTICAL to what was sent`);
  } else if (readBack.class === 'trailing-newline-stripped') {
    lines.push(`  read-back: clean — the platform stripped the trailing newline (sent ${sentBytes}, stored ${storedBytes})`);
  } else if (readBack.class === 'footer-appended') {
    lines.push(
      `  read-back: clean — the platform appended its footer${readBack.strippedNewlines > 0 ? ', over the stripped trailing newline' : ''}` +
        ` (sent ${sentBytes}, stored ${storedBytes})`,
    );
  } else {
    lines.push(
      `  ⚠️ read-back: sent ${sentBytes} byte(s), stored ${storedBytes} — the platform ` +
        'MUTATED the body. Read the artefact before trusting it: the sanitizer eats tag-shaped fragments.',
    );
    lines.push(`     first difference at byte ${readBack.offset}: sent ${readBack.sentContext} | stored ${readBack.storedContext}`);
  }
  return { lines, drift, mutated: readBack.class === 'mutated', readBack };
}

/**
 * The instant the stored body was last written, as far as the body itself can
 * say: its NEWEST protocol stamp that names a real instant, judged as an
 * instant (a seconds-grained stamp and a minute-grained one compare by
 * `stampSpan`, never as strings).
 *
 * Always an object. `stamp`/`from` are null when the body carries no stamp this
 * may read — the same population as "no stamp at all", on purpose — and
 * `unreal` carries the stamps it refused, each with the date it rolls over to
 * (`null` for the half that does not parse at all, so a caller cannot report a
 * rollover that did not happen).
 *
 * ONE predicate decides what may be read: `stampRealInstant`, the round trip
 * the write side refuses a quoted stamp with. Reading a stamp through
 * `Date.parse` alone lets an impossible date roll FORWARD into a LATER instant
 * and NARROW the unread window, which is the one direction the header forbids —
 * so NaN and rollover are one class here, not two accidents of the parser.
 *
 * A lower bound on the true last write — see the header — so a caller using it
 * as "since" over-includes, never under.
 */
export function lastWriteStamp(storedBody) {
  let best = null;
  const unreal = [];
  for (const stamp of protocolStamps(storedBody)) {
    const calendar = stampRealInstant(stamp);
    if (!calendar.real) {
      unreal.push({ stamp, rolledTo: calendar.rolledTo });
      continue;
    }
    const span = stampSpan(stamp);
    if (!best || span.from > best.from) best = { stamp, from: span.from };
  }
  return { stamp: best?.stamp ?? null, from: best?.from ?? null, unreal };
}

const commentCreatedMs = (c) => {
  const at = Date.parse(String(c?.created_at ?? ''));
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY; // unreadable ⇒ newest, never silently old
};

/**
 * The ONE order the unread window is judged in: `created_at` first, then `id`
 * for the comments that share one (same-second writes — a batch, a bot). Both
 * the newest pick and the "landed after" set read THIS comparator, so the two
 * can never disagree about which comment follows which: a same-second later id
 * that is the newest is also, necessarily, after the acknowledged one. Judged
 * on `created_at` alone, it was the newest AND absent from the set — a refusal
 * whose head counted 0 comments after the very id it was refusing.
 *
 * `id` breaks only an exact tie, so it never outranks the clock; comments whose
 * `created_at` is unreadable share one instant (+∞) and are ordered by id, the
 * same tie the sort already resolved that way.
 */
const byCommentOrder = (a, b) => commentCreatedMs(a) - commentCreatedMs(b) || Number(a?.id) - Number(b?.id);

/**
 * Whether this refresh may write over the card's comment tail. Pure: the
 * caller hands in the stored body and the comments it fetched; the population
 * judged is every comment CREATED at or after the minute of the newest stamp in
 * the body that names a real instant (an edit to an older comment is not a
 * knock the read window knows) — and EVERY comment when the body carries no
 * such stamp, whether it carries none at all or only impossible ones.
 *
 *   ok, kind 'none-newer'      nothing newer than the last write — the control
 *   ok, kind 'acknowledged'    `ackThrough` names the newest of the newer ones
 *   refused 'unacknowledged'   newer comments exist and no id was named
 *   refused 'ack-not-newest'   the named id is on the card but newer ones followed
 *   refused 'ack-unknown'      the named id is not a comment on this card
 */
export function unreadComments({ storedBody, comments, ackThrough = null }) {
  const since = lastWriteStamp(storedBody);
  const all = Array.isArray(comments) ? comments : [];
  const newer = all
    .filter((c) => since.from === null || commentCreatedMs(c) >= since.from)
    .sort(byCommentOrder);
  const newest = newer.length > 0 ? newer[newer.length - 1] : null;
  const base = { since, newer, newest, ackThrough };
  if (newer.length === 0) return { ...base, ok: true, kind: 'none-newer', after: [] };
  if (ackThrough === null) return { ...base, ok: false, kind: 'unacknowledged', after: newer };
  if (Number(newest.id) === Number(ackThrough)) return { ...base, ok: true, kind: 'acknowledged', after: [] };
  const named = all.find((c) => Number(c?.id) === Number(ackThrough));
  if (!named) return { ...base, ok: false, kind: 'ack-unknown', after: newer };
  return { ...base, ok: false, kind: 'ack-not-newest', after: newer.filter((c) => byCommentOrder(c, named) > 0) };
}

const commentRow = (c, i) => {
  const first = String(c?.body ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
  const shown = first.length > 96 ? `${first.slice(0, 96)}…` : first;
  return `  ${i + 1}. ${c?.id ?? '?'} · ${c?.created_at ?? '(no created_at)'} · ${c?.user?.login ?? '?'} · ${shown}`;
};

/**
 * The stamps `lastWriteStamp` refused to read, as the rows a refusal carries.
 * Rendered in ONE place so the refusal and the transcript cannot come to
 * describe the same skipped stamp two ways.
 */
const unrealStampRows = (unreal) =>
  unreal.map(
    (u) =>
      `    · \`${u.stamp}\` — ` +
      (u.rolledTo === null
        ? 'a field is outside its own range, so it does not parse at all'
        : `it rolls over to \`${u.rolledTo}\`, a LATER instant than the date its own digits spell`),
  );

/** The refusal a caller reads when `unreadComments` says no. */
export function unreadRefusalText(check, number) {
  const sinceText = check.since.stamp ? `the body's last write stamp (\`${check.since.stamp}\`)` : 'the body\'s last write';
  const newestId = check.newest?.id ?? '?';
  const head =
    check.kind === 'ack-unknown'
      ? `post-stamped: REFUSED — --ack-through=${check.ackThrough} names no comment on #${number}. Nothing was written.`
      : check.kind === 'ack-not-newest'
        ? `post-stamped: REFUSED — --ack-through=${check.ackThrough} is not the newest comment on #${number}: ` +
          `${check.after.length} comment(s) landed after it. Nothing was written.`
        : `post-stamped: REFUSED — ${check.newer.length} comment(s) on #${number} are newer than ${sinceText} ` +
          'and this refresh acknowledges none of them. Nothing was written.';
  const lines = [head];
  lines.push(
    '  A body refresh closes the read window (the comments newer than the body\'s last edit) on every',
    '  comment inside it — a knock nobody has read yet would simply vanish, and the knocker would see',
    '  silence. Read the tail to its end, receipt every request it carries (a reply comment, or a',
    `  carry-over into the body), then re-run with --ack-through=${newestId} — the newest comment.`,
  );
  if (check.since.stamp === null && check.since.unreal.length === 0) {
    lines.push(
      '  ⚠️ The stored body carries NO protocol stamp, so EVERY comment on the card counts as newer than',
      `  its last write. Put \`${STAMP_TOKEN}\` in the body so the next refresh measures from this write.`,
    );
  } else if (check.since.stamp === null) {
    lines.push(
      '  ⚠️ No stamp in the stored body names an instant the calendar HAS, so none of them is read as the',
      '  last write and EVERY comment on the card counts as newer — a date nothing can have been written',
      `  on may not narrow this window. Put \`${STAMP_TOKEN}\` in the body so the next refresh measures from`,
      '  this write.',
      ...unrealStampRows(check.since.unreal),
    );
  } else {
    lines.push(
      '  (The stamp is a lower bound on the last write — a refresh that carried no token leaves an older',
      '  stamp behind — so this list can be longer than the true unread set, never shorter.)',
    );
    if (check.since.unreal.length > 0) {
      lines.push(
        `  ⚠️ ${check.since.unreal.length} stamp(s) in the body name no instant the calendar has and were NOT read as the`,
        '  last write; the window measures from the newest REAL stamp instead, so it is WIDER here, never',
        '  narrower.',
        ...unrealStampRows(check.since.unreal),
      );
    }
  }
  lines.push(...check.after.map(commentRow));
  return lines.join('\n');
}

/** The one line a transcript carries when the check passed. */
export function unreadPassText(check) {
  const sinceText = check.since.stamp
    ? `the body's last write stamp \`${check.since.stamp}\``
    : 'the body (which carries no stamp that names an instant)';
  const skipped =
    check.since.unreal.length === 0
      ? ''
      : ` (${check.since.unreal.length} stamp(s) naming no instant the calendar has were NOT read as the last write: ` +
        `${check.since.unreal.map((u) => `\`${u.stamp}\``).join(', ')} — the window is wider, never narrower)`;
  return check.kind === 'none-newer'
    ? `  unread check: no comment newer than ${sinceText}${skipped} — nothing to acknowledge`
    : `  unread check: ${check.newer.length} comment(s) newer than ${sinceText}${skipped}, acknowledged through ${check.newest?.id} (the newest)`;
}

/** The flags this tool takes. An argument outside this set is a typo, and a typo is refused. */
export const KNOWN_FLAGS = Object.freeze(['--dry-run', '--json', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['comment', 'body', 'file', 'repo', 'ack-through']);

export function readOption(argv, name) {
  const prefix = `--${name}=`;
  const hit = (argv ?? []).find((a) => a.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}

/**
 * Parse argv into the run's options, or refuse. Pure, so the refusals are
 * pinned offline — this is the layer that decides WHERE a write lands, and a
 * misread target is an artefact posted onto somebody else's card.
 */
export function parseOptions(argv) {
  const args = argv ?? [];
  for (const arg of args) {
    if (KNOWN_FLAGS.includes(arg)) continue;
    const named = /^--([a-z-]+)=/.exec(arg);
    if (named && KNOWN_OPTIONS.includes(named[1])) continue;
    return {
      ok: false,
      error: `\`${arg}\` is not an argument this tool takes. Flags: ${KNOWN_FLAGS.join(' ')}; options: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}.`,
    };
  }
  const comment = readOption(args, 'comment');
  const body = readOption(args, 'body');
  if (comment !== null && body !== null) {
    return { ok: false, error: '--comment and --body name two different acts. Pass one: --comment=N posts a new comment, --body=N rewrites the card body.' };
  }
  if (comment === null && body === null) {
    return { ok: false, error: 'no target. Pass --comment=N to post a comment, or --body=N to rewrite a card body.' };
  }
  const raw = comment ?? body;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, error: `\`${raw}\` is not a card number. --${comment === null ? 'body' : 'comment'}=N takes the issue number.` };
  }
  const ack = readOption(args, 'ack-through');
  let ackThrough = null;
  if (ack !== null) {
    if (comment !== null) {
      return { ok: false, error: '--ack-through belongs to a body refresh (--body=N). A comment voids nothing, so it has nothing to acknowledge.' };
    }
    ackThrough = Number(ack);
    if (!Number.isInteger(ackThrough) || ackThrough <= 0) {
      return { ok: false, error: `\`${ack}\` is not a comment id. --ack-through=ID takes the numeric id of the newest comment on the card.` };
    }
  }
  return {
    ok: true,
    options: {
      mode: comment === null ? 'body' : 'comment',
      number,
      file: readOption(args, 'file'),
      repo: readOption(args, 'repo'),
      ackThrough,
      dryRun: args.includes('--dry-run'),
      json: args.includes('--json'),
    },
  };
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * The card body and every comment created at or after `sinceMs` (all of them
 * when `sinceMs` is not a number). REST's `since` filters on `updated_at`, a
 * superset of what `unreadComments` judges, so the pages fetched are the tail
 * and nothing the pure filter needs is left behind.
 */
async function readCardTail(repo, number, sinceMs) {
  const card = await rest(`/repos/${repo}/issues/${number}`);
  const since = Number.isFinite(sinceMs) ? `&since=${encodeURIComponent(new Date(sinceMs).toISOString())}` : '';
  const comments = [];
  for (let page = 1; ; page++) {
    const rows = await rest(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}${since}`);
    comments.push(...(Array.isArray(rows) ? rows : []));
    if (!Array.isArray(rows) || rows.length < 100) break;
  }
  return { card, comments };
}

async function writeArtefact(repo, options, body) {
  if (options.mode === 'comment') {
    const created = await rest(`/repos/${repo}/issues/${options.number}/comments`, { method: 'POST', body: { body } });
    const back = await rest(`/repos/${repo}/issues/comments/${created?.id}`);
    return { id: created?.id ?? null, url: back?.html_url ?? created?.html_url ?? null, writtenAt: back?.created_at ?? created?.created_at ?? null, stored: back?.body };
  }
  const patched = await rest(`/repos/${repo}/issues/${options.number}`, { method: 'PATCH', body: { body } });
  const back = await rest(`/repos/${repo}/issues/${options.number}`);
  return { id: options.number, url: back?.html_url ?? patched?.html_url ?? null, writtenAt: back?.updated_at ?? patched?.updated_at ?? null, stored: back?.body };
}

function reportPrerequisiteNotMet(err) {
  console.error(
    `\npost-stamped: PREREQUISITE NOT MET — ${err.message}\n\n` +
      `  Fix:  run this where node's fetch reaches api.github.com with a token that can write issues\n` +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      '        itself with that flag when HTTPS_PROXY is set).\n\n' +
      '  NOTHING WAS WRITTEN, and nothing was read back. This is not a failed post and not a successful\n' +
      '  one — it is no act at all.\n' +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from ${EXIT_REFUSED}'s "the body broke the stamp\n` +
      '  contract". Capture it BEFORE any pipe: `node scripts/pm/post-stamped.mjs … > /tmp/p.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

function readInput(file) {
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8');
}

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  if (process.env[PROXY_REARM_GUARD] === '1') return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

const USAGE = [
  'post-stamped — write a seat artefact to GitHub with a stamp this act read, never one typed from memory.',
  '',
  '  node scripts/pm/post-stamped.mjs --comment=N [--file=PATH] [--repo=OWNER/NAME] [--dry-run] [--json]',
  '  node scripts/pm/post-stamped.mjs --body=N    [--file=PATH] [--repo=OWNER/NAME] [--ack-through=ID] [--dry-run] [--json]',
  '  node scripts/pm/post-stamped.mjs --self-test',
  '',
  '  With no --file the body is read from stdin.',
  `  In the body: \`${STAMP_TOKEN}\` is the clock this run reads; \`{{WAS:YYYY-MM-DDThh:mmZ}}\` declares a`,
  '  stamp that is a reading of something else — at either grain the protocol takes, the minute above or',
  '  the seconds form `YYYY-MM-DDThh:mm:ssZ`. A bare stamp on the opening line, or on a subscript',
  '  reading-time line, is REFUSED — that position belongs to the writing act. A quoted stamp LATER',
  '  than the clock this run reads is REFUSED too — the future is not a thing anyone read — and so is',
  '  one whose digits name no instant the calendar has (month 13, 99:99, 31 April), whether it fails to',
  '  parse at all or rolls over silently to another date.',
  '  A body refresh is REFUSED while comments newer than the body\'s last write stamp exist and',
  '  --ack-through=ID does not name the newest of them — a refresh must not void an unread knock.',
  '  The attribution footer is the caller\'s: its form differs by channel and act, so this tool adds none.',
].join('\n');

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`post-stamped: ${parsed.error}`);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  const repoRes = options.repo ? { repo: options.repo, source: '--repo', valid: /^[^/\s]+\/[^/\s]+$/.test(options.repo) } : resolveSweepRepo(process.env);
  if (!repoRes.valid) {
    console.error(
      `post-stamped: ${repoRes.source}=${JSON.stringify(repoRes.repo)} is not a repository in \`owner\`/\`name\` ` +
        'form. Refusing to fall back to a different board — an artefact posted onto the wrong repo is worse ' +
        'than one not posted.',
    );
    return EXIT_USAGE;
  }

  let input;
  try {
    input = readInput(options.file);
  } catch (err) {
    console.error(`post-stamped: could not read the body (${err.message}).`);
    return EXIT_USAGE;
  }

  const rendered = renderBody(input);
  if (!rendered.ok) {
    console.error(rendered.error);
    return EXIT_REFUSED;
  }

  if (options.dryRun) {
    console.error(
      `post-stamped: DRY RUN — nothing was written. ${rendered.substituted} token(s) substituted with ` +
        `\`${rendered.stamp}\`, ${rendered.quoted} quoted stamp(s) rendered verbatim. Target would be ` +
        `${repoRes.repo}#${options.number} (${options.mode}).` +
        (options.mode === 'body' ? ' The unread-comment check reads the card and runs only on a live write.' : ''),
    );
    console.log(rendered.body);
    return EXIT_OK;
  }

  // A body refresh first reads the tail it is about to close the window on.
  let unread = null;
  if (options.mode === 'body') {
    let tail;
    try {
      const probe = await rest(`/repos/${repoRes.repo}/issues/${options.number}`);
      tail = await readCardTail(repoRes.repo, options.number, lastWriteStamp(probe?.body).from);
    } catch (err) {
      return reportPrerequisiteNotMet(err);
    }
    unread = unreadComments({ storedBody: tail.card?.body, comments: tail.comments, ackThrough: options.ackThrough });
    if (!unread.ok) {
      console.error(unreadRefusalText(unread, options.number));
      return EXIT_REFUSED;
    }
  }

  let written;
  try {
    written = await writeArtefact(repoRes.repo, options, rendered.body);
  } catch (err) {
    return reportPrerequisiteNotMet(err);
  }

  const verdict = readBackVerdict({
    stamp: rendered.stamp,
    writtenAt: written.writtenAt,
    sent: rendered.body,
    stored: written.stored,
    substituted: rendered.substituted,
    // The act, not a guess: the footer rule is comment-only, and this is the
    // one place that knows which of the two writes just happened.
    mode: options.mode,
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          repo: repoRes.repo,
          target: options.number,
          mode: options.mode,
          id: written.id,
          url: written.url,
          stamp: rendered.stamp,
          substituted: rendered.substituted,
          quoted: rendered.quoted,
          written_at: written.writtenAt,
          drift_minutes: verdict.drift,
          body_mutated: verdict.mutated,
          read_back: { class: verdict.readBack.class, first_difference_byte: verdict.readBack.offset },
          ...(unread
            ? {
                unread_check: {
                  since: unread.since.stamp,
                  unreal_stamps: unread.since.unreal.map((u) => u.stamp),
                  newer: unread.newer.length,
                  ack_through: unread.ackThrough,
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return EXIT_OK;
  }

  console.log(
    [
      `post-stamped: ${options.mode === 'comment' ? 'comment posted on' : 'body rewritten on'} ${repoRes.repo}#${options.number}`,
      `  ${options.mode === 'comment' ? 'comment' : 'card'}: ${written.id} ${written.url ?? '(no url returned)'}`,
      ...verdict.lines,
      ...(unread ? [unreadPassText(unread)] : []),
      `  substitutions: ${rendered.substituted} ${STAMP_TOKEN}, ${rendered.quoted} quoted`,
    ].join('\n'),
  );
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// --self-test — offline, no network, every branch above driven by fixtures.
//
// The battery ledger this self-test's floor is evaluated against: `battery()`
// opens one, every assertion is attributed to the one most recently opened, and
// a section that stops running names ITSELF at the floor rather than going
// quiet. The counts are a FLOOR, never an equality — adding cases is ordinary
// work and must not go red.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the token contract: the two spellings, and nothing else': 9,
  'the refusals: every route that must not reach the board': 20,
  'the opener scan: every `{{` is a token this tool renders, or the body is refused': 35,
  'the calendar rule: a stamp shaped like an instant the calendar does not have': 34,
  'the direction check: a stamp no act can have read': 22,
  'the substitution: one clock, read once, written everywhere': 9,
  'the read-back: what the transcript can actually prove': 33,
  'the CLI: the one decision a typo must never make': 16,
  'the unread-knock check: a refresh cannot void what nobody read': 49,
  'the shared rule: this tool and H56 cannot come to disagree': 6,
});
const SELF_TEST_BATTERY_FLOOR = 10;
const UNATTRIBUTED_BATTERY = '(unattributed)';

let selfTestReachedVerdict = false;

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const cases = [];
  const t = (name, ok, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: Boolean(ok), detail });
  };

  const NOW_MS = Date.parse('2026-09-10T06:37:48Z');
  const kinds = (text, ms) => stampRefusals(text, ms).map((r) => r.kind);

  battery('the token contract: the two spellings, and nothing else');
  t('the act-clock token is `{{NOW}}`', STAMP_TOKEN === '{{NOW}}');
  t('the clock renders in the protocol spelling — minutes, Z, no seconds', stampNow(NOW_MS) === '2026-09-10T06:37Z');
  t('…truncated, never rounded: 06:37:48 is still 06:37', stampNow(Date.parse('2026-09-10T06:37:48Z')) === stampNow(Date.parse('2026-09-10T06:37:02Z')));
  t('⛔ the quoted-token regex is NOT global — an exported `g` regex carries a cursor between callers', QUOTED_TOKEN_RE.global === false);
  t('⛔ …and neither is the leftover-token one', ANY_TOKEN_RE.global === false);
  t('masking a quoted stamp preserves the body length, so positions do not move', maskQuotedStamps('a {{WAS:2026-09-08T14:00Z}} b').length === 'a {{WAS:2026-09-08T14:00Z}} b'.length);
  t('…and leaves no stamp behind for the bare scan to find', protocolStamps(maskQuotedStamps('{{WAS:2026-09-08T14:00Z}}')).length === 0);
  t('the quoted values are readable on their own', quotedStampValues('x {{WAS:2026-09-08T14:00Z}} y')[0] === '2026-09-08T14:00Z');
  t('…and two of them are both read, not just the first', quotedStampValues('{{WAS:2026-09-08T14:00Z}} {{WAS:2026-09-09T01:00Z}}').length === 2);

  battery('the refusals: every route that must not reach the board');
  const OPENING = 'Claim: skills seat, session `session_x`, 2026-09-10T06:37Z — dispatched.';
  t('⭐ a bare stamp on the OPENING line is refused', kinds(OPENING).includes('positional'));
  t('…and the refusal names the position rather than guessing at meaning', stampRefusals(OPENING)[0].detail.includes('the opening line'));
  t('…and offers both legal spellings by name', stampRefusals(OPENING)[0].detail.includes('{{NOW}}') && stampRefusals(OPENING)[0].detail.includes('{{WAS:2026-09-10T06:37Z}}'));
  t('a bare stamp on a subscript reading-time line is refused', kinds('Seat post\n\n<sub>read 2026-09-10T06:37Z</sub>').includes('positional'));
  t('⭐ the same body with the token instead is ACCEPTED', stampRefusals('Claim: skills seat, {{NOW}} — dispatched.').length === 0);
  t('⭐ MIXED — the token plus a bare stamp elsewhere is refused', kinds('Claim: {{NOW}}\n\nThe board was read at 2026-09-08T14:00Z.').includes('mixed'));
  t('…and the mixed refusal says a reader cannot tell the two clocks apart', stampRefusals('Claim: {{NOW}}\n\nread 2026-09-08T14:00Z').find((r) => r.kind === 'mixed').detail.includes('a reader cannot tell which'));
  t('⛔ a bare stamp in PROSE with no token is NOT refused — quoting a ruling is a reading of something else', stampRefusals('Title\n\nThe 2026-09-08T14:00Z ruling stands.').length === 0);
  t('a DECLARED quoted stamp is accepted even in the opening position', stampRefusals('The {{WAS:2026-09-08T14:00Z}} ruling stands.').length === 0);
  t('…and beside a token, which is the whole point of the declaration', stampRefusals('Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.').length === 0);
  t('⛔ the quoted route is not a free-text escape: a non-stamp value is refused', kinds('{{WAS:yesterday}}').includes('quoted-not-a-stamp'));
  t('⛔ …nor a smuggling route: a stamp with prose glued on is refused', kinds('{{WAS:2026-09-08T14:00Z ruling}}').includes('quoted-not-a-stamp'));
  t('surrounding whitespace inside the declaration is tolerated', stampRefusals('{{WAS: 2026-09-08T14:00Z }}').length === 0);
  t('a mistyped token is refused rather than posted literally', renderBody('Claim: {{now}} — dispatched.', NOW_MS).kind === 'unknown-token');
  t('…and the refusal names the survivor so the typo is findable', renderBody('Claim: {{now}}', NOW_MS).error.includes('{{now}}'));
  t('…and says why the quiet direction is the dangerous one', renderBody('Claim: {{now}}', NOW_MS).error.includes('leave the artefact unstamped'));
  t('an EMPTY body is refused — an empty artefact is noise a reader must judge', renderBody('   \n\n', NOW_MS).kind === 'empty');
  t('every refusal reaches the caller as text naming the two spellings', refusalText(stampRefusals(OPENING)).includes('{{WAS:YYYY-MM-DDThh:mmZ}}'));
  t('…and states that no flag turns the contract off', refusalText(stampRefusals(OPENING)).includes('There is no flag'));
  t('…and that nothing was written', refusalText(stampRefusals(OPENING)).includes('Nothing was written'));

  // The filed artefact's shape, in kind: a shell read failed and the quoted
  // slot took a multi-line Node dump. Dumps carry braces, and both payload
  // classes in this file are `[^{}]*`, so nothing matched and the opener was
  // copied to the board — neither rendered nor refused.
  battery('the opener scan: every `{{` is a token this tool renders, or the body is refused');
  const CARD_DUMP =
    'Merged at {{WAS:[eval]:1\n' +
    'JSON.parse(process.env.LANDED).mergedAt\n' +
    '                              ^\n' +
    "SyntaxError: Unexpected token '}' in JSON at position 0}} — read from the merge commit.";
  t('⭐ the filed repro: a quoted slot holding a Node dump is REFUSED, not copied to the board', renderBody(CARD_DUMP, NOW_MS).ok === false);
  t('…and nothing is rendered from it', renderBody(CARD_DUMP, NOW_MS).body === undefined);
  t('⛔ WHY it used to pass: neither payload class can cross a brace, so nothing matched at all', QUOTED_TOKEN_RE.test(CARD_DUMP) === false && ANY_TOKEN_RE.test(CARD_DUMP) === false);
  t('…so the scan walks openers positionally and names the brace', unrecognisedOpeners(CARD_DUMP)[0].kind === 'brace-in-payload');
  t('…and the refusal prints the span with its newlines ESCAPED', renderBody(CARD_DUMP, NOW_MS).error.split('\n')[2].includes('[eval]:1\\n'));
  t('⛔ …so the dump never reaches the refusal text raw, at any length', renderBody(CARD_DUMP, NOW_MS).error.includes('\nJSON.parse(process.env') === false);

  const MULTI_LINE_PAYLOAD = 'Merged at {{WAS:[eval]:1\nSyntaxError: Unexpected end of JSON input}} — read from the log.';
  t('a quoted payload spanning LINES is refused', renderBody(MULTI_LINE_PAYLOAD, NOW_MS).ok === false);
  t('…by the shape rule, which owns what a quoted payload may say', kinds(MULTI_LINE_PAYLOAD, NOW_MS).join() === 'quoted-not-a-stamp');
  t('…and its span is escaped and clipped too — one spelling of "show me the offender"', stampRefusals(MULTI_LINE_PAYLOAD, NOW_MS)[0].detail.includes('[eval]:1\\nSyntaxError'));

  t('an unknown token NAME is refused', renderBody('Claim: {{THEN}} — dispatched.', NOW_MS).ok === false);
  t('…named as a well-formed token this tool does not know', unrecognisedOpeners('{{THEN}}')[0].kind === 'unknown-token-name');
  t('…and the recorded `{{now}}` typo is that same kind', unrecognisedOpeners('Claim: {{now}}')[0].kind === 'unknown-token-name');

  const UNCLOSED = 'Landing provenance\n\nMerged at {{WAS:2026-09-08T14:00Z — read from the merge commit.';
  t('an opener with NO closer is refused', renderBody(UNCLOSED, NOW_MS).ok === false);
  t('…named as exactly that, rather than guessed at', unrecognisedOpeners(UNCLOSED)[0].kind === 'unclosed-opener');
  t('…and the act-clock token is not exempt: an unclosed `{{NOW` is refused too', unrecognisedOpeners('Claim {{NOW — dispatched.')[0].kind === 'unclosed-opener');
  const UNCLOSED_OPENING = 'Claim: skills seat, {{WAS:2026-09-08T14:00Z — dispatched.';
  t('⭐ ONE opener, ONE refusal: an unclosed opener is reported as the opener it is', renderBody(UNCLOSED_OPENING, NOW_MS).kind === 'unknown-token');
  t('⛔ …and NOT as the positional refusal the unmasked payload would otherwise raise', kinds(UNCLOSED_OPENING, NOW_MS).includes('positional') && renderBody(UNCLOSED_OPENING, NOW_MS).error.includes('positional') === false);
  t('a DOUBLED opener is refused', unrecognisedOpeners('Claim {{{{NOW}}}} — dispatched.')[0].kind === 'nested-opener');
  t('…and a NESTED one, a quoted slot wrapped round the act-clock token', unrecognisedOpeners('Board read {{WAS:{{NOW}}}}.')[0].kind === 'nested-opener');
  t('every opener is walked, not only the first', unrecognisedOpeners('Claim {{now}} and board read {{WAS:{}}}.').length === 2);

  const SCAN_CONTROL = 'Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.';
  t('⭐ THE CONTROL: one valid `{{NOW}}` and one valid quoted stamp still render', renderBody(SCAN_CONTROL, NOW_MS).ok === true);
  t('…with the scan finding nothing to refuse', unrecognisedOpeners(SCAN_CONTROL).length === 0);
  t('…and the rendered body carrying no opener at all', renderBody(SCAN_CONTROL, NOW_MS).body.includes('{{') === false);
  t('⛔ NO accepted form narrowed: whitespace inside the declaration still clears the scan', unrecognisedOpeners('read {{WAS: 2026-09-08T14:00Z }}').length === 0 && renderBody('read {{WAS: 2026-09-08T14:00Z }}', NOW_MS).ok === true);
  t('⛔ …and the seconds grain still clears it', unrecognisedOpeners('read {{WAS:2026-09-08T14:00:30Z}}').length === 0);
  t('⛔ …and a bare stamp in prose is no opener\'s business', unrecognisedOpeners('The 2026-09-08T14:00Z ruling stands.').length === 0);
  t('⛔ the scan opens NO escape hatch: the entity spelling is not an opener, so it is prose', unrecognisedOpeners('the token &#123;&#123;NOW&#125;&#125;').length === 0);
  t('⛔ …and a token inside backticks is STILL substituted — a fence is not an escape', renderBody('Write `{{NOW}}` there.', NOW_MS).body === 'Write `2026-09-10T06:37Z` there.');

  t('the span renderer escapes a newline', offendingSpan('a\nb') === 'a\\nb');
  t('…a carriage return and a tab too', offendingSpan('a\r\tb') === 'a\\r\\tb');
  t('…and any other control byte as an `\\xNN` escape, never as the byte itself', offendingSpan('a\u0007b') === 'a\\x07b');
  t('a span inside the budget is printed whole, with no ellipsis', offendingSpan('{{THEN}}') === '{{THEN}}');
  t(`a longer one is clipped to ${SPAN_BYTES} bytes and says so`, offendingSpan('x'.repeat(100)) === `${'x'.repeat(SPAN_BYTES)}…`);
  t('⛔ …and never cuts a multi-byte character in half', offendingSpan(`${'x'.repeat(SPAN_BYTES - 1)}€€`) === `${'x'.repeat(SPAN_BYTES - 1)}…`);
  t('the budget is counted in BYTES, which is the unit a dump arrives in', SPAN_BYTES === 60 && Buffer.byteLength(offendingSpan('€'.repeat(40)), 'utf8') <= SPAN_BYTES + 3);

  // The filed repro: the protocol's own digit shape, filled with an instant no
  // calendar has. `Date.parse` answers NaN, the span is null, and a null span
  // is "not future" — so before this rule the value was RENDERED, and
  // `--dry-run` said so at exit 0.
  battery('the calendar rule: a stamp shaped like an instant the calendar does not have');
  const NO_SUCH = 'The board was read at {{WAS:2026-13-45T99:99Z}}.';
  t('\u2b50 the filed repro: month 13, day 45, 99:99 is REFUSED, not rendered verbatim', kinds(NO_SUCH, NOW_MS).includes('quoted-no-such-instant'));
  t('\u2b50 \u2026so the whole body is refused and NOTHING is rendered', renderBody(NO_SUCH, NOW_MS).ok === false && renderBody(NO_SUCH, NOW_MS).body === undefined);
  t('\u26d4 WHY it used to pass: the shape regex counts digits and this satisfies it', protocolStamps('2026-13-45T99:99Z').length === 1);
  t('\u26d4 \u2026and the direction rule reads its NaN span as "not future"', stampIsFuture('2026-13-45T99:99Z', NOW_MS) === false);
  t('\u2026so the refusal is the calendar one and NOT the direction one \u2014 one typo, one refusal', kinds(NO_SUCH, NOW_MS).join() === 'quoted-no-such-instant');
  t('\u2026and the refusal prints the offending span in the row form', stampRefusals(NO_SUCH, NOW_MS)[0].detail.includes('{{WAS:2026-13-45T99:99Z}}'));
  t('\u2026saying the calendar has no such instant', stampRefusals(NO_SUCH, NOW_MS)[0].detail.includes('names no instant the calendar has'));

  t('an impossible MONTH is refused', kinds('read {{WAS:2026-13-01T00:00Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('an impossible DAY is refused', kinds('read {{WAS:2026-01-45T00:00Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('an impossible HOUR is refused', kinds('read {{WAS:2026-01-01T99:00Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('an impossible MINUTE is refused', kinds('read {{WAS:2026-01-01T00:99Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('\u2026and a zero month or day, which is the same range failure from below', kinds('read {{WAS:2026-00-01T00:00Z}}', NOW_MS).includes('quoted-no-such-instant') && kinds('read {{WAS:2026-01-00T00:00Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('\u2026an impossible SECOND at the seconds grain too', kinds('read {{WAS:2026-01-01T00:00:60Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('none of those parses at all, so the refusal reports no rollover', stampRealInstant('2026-13-45T99:99Z').rolledTo === null);

  // The quiet half: these PARSE. `Date.parse` rolls a date that is not on the
  // calendar forward into one that is, so the number is real and in the past
  // — the direction rule has nothing to say and the value was rendered.
  t('\u2b50 the 31st of a 30-day month is REFUSED', kinds('read {{WAS:2026-04-31T00:00Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('\u26d4 \u2026although it PARSES and sits in the past \u2014 which is why no earlier rule caught it', stampSpan('2026-04-31T00:00Z') !== null && stampIsFuture('2026-04-31T00:00Z', NOW_MS) === false);
  t('\u2026and the refusal names the date it silently rolled over to', stampRefusals('read {{WAS:2026-04-31T00:00Z}}', NOW_MS)[0].detail.includes('rolls over to `2026-05-01T00:00Z`'));
  t('\u2b50 a 29 February in a NON-leap year is REFUSED', kinds('read {{WAS:2027-02-29T00:00Z}}', NOW_MS).includes('quoted-no-such-instant'));
  t('\u2026rolled to the 1 March it actually parses to', stampRealInstant('2027-02-29T00:00Z').rolledTo === '2027-03-01T00:00Z');
  t('\u26d4 \u2026and NOT also filed as a direction problem, though 2027 is ahead of this clock', kinds('read {{WAS:2027-02-29T00:00Z}}', NOW_MS).join() === 'quoted-no-such-instant');
  t('hour 24 rolls into the next day and is refused as the date it is not', stampRealInstant('2026-09-10T24:00Z').rolledTo === '2026-09-11T00:00Z');

  t('\u2b50 THE CONTROL: a real instant at the MINUTE grain still renders verbatim', renderBody('read {{WAS:2026-09-08T14:00Z}}', NOW_MS).body === 'read 2026-09-08T14:00Z');
  t('\u2b50 \u2026and a real instant at the SECONDS grain, which this tool takes too \u2014 NOT narrowed', renderBody('read {{WAS:2026-09-08T14:00:30Z}}', NOW_MS).body === 'read 2026-09-08T14:00:30Z');
  t('\u2026both judged real by the round trip itself', stampRealInstant('2026-09-08T14:00Z').real === true && stampRealInstant('2026-09-08T14:00:30Z').real === true);
  t('\u2b50 a real LEAP DAY is an instant the calendar has: 2028-02-29 is not a calendar problem', stampRealInstant('2028-02-29T00:00Z').real === true && kinds('read {{WAS:2028-02-29T00:00Z}}', NOW_MS).includes('quoted-no-such-instant') === false);
  t('\u2026it is refused by the DIRECTION rule alone, because 2028 is ahead of this clock', kinds('read {{WAS:2028-02-29T00:00Z}}', NOW_MS).join() === 'quoted-in-the-future');
  t('\u2026and a leap day already PAST clears every rule', stampRefusals('read {{WAS:2024-02-29T00:00Z}}', NOW_MS).length === 0);
  t('\u2b50 the act\'s OWN minute is still accepted \u2014 the boundary rule is untouched', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', NOW_MS).length === 0);
  t('\u26d4 whitespace inside the declaration is no escape: the value is trimmed before it is judged', kinds('read {{WAS: 2026-13-45T99:99Z }}', NOW_MS).includes('quoted-no-such-instant'));
  t('\u26d4 a payload that fails the SHAPE is not also filed as a calendar problem', kinds('{{WAS:2026-13-45T99:99Z ruling}}', NOW_MS).join() === 'quoted-not-a-stamp');
  t('the grain test mirrors `stampSpan`\'s own widening, minute and second alike', stampSpan('2026-09-08T14:00Z').to - stampSpan('2026-09-08T14:00Z').from === 60000 && stampSpan('2026-09-08T14:00:30Z').to - stampSpan('2026-09-08T14:00:30Z').from === 1000);

  // The remedy texts hand a bare stamp back through the quoted route, so the
  // route's two closures must both shut the offer off.
  const POSITIONAL_NO_SUCH = 'Claim: skills seat, 2026-13-45T99:99Z \u2014 dispatched.';
  t('\u2b50 the POSITIONAL refusal stops offering a quoted route that would refuse the stamp', stampRefusals(POSITIONAL_NO_SUCH, NOW_MS)[0]?.detail?.includes('{{WAS:2026-13-45T99:99Z}}') === false);
  t('\u2026saying instead that the calendar has no such instant', stampRefusals(POSITIONAL_NO_SUCH, NOW_MS)[0]?.detail?.includes('names no instant the calendar has') === true);
  t('the MIXED refusal likewise', stampRefusals('Claim: {{NOW}}\n\nread 2026-13-45T99:99Z', NOW_MS).find((r) => r.kind === 'mixed')?.detail?.includes('{{WAS:2026-13-45T99:99Z}}') === false);

  // The clock this act holds is 06:37:48 — so 06:37Z is the minute it is IN,
  // 06:38Z the first minute it has not reached, and 06:51Z sits 14 minutes
  // ahead, inside H56's drift tolerance and still not a thing anyone read.
  battery('the direction check: a stamp no act can have read');
  const CARD_REPRO = 'Verdict {{NOW}} — on the board read {{WAS:2099-01-01T00:00Z}}.';
  t('⭐ the filed repro: a 2099 quoted stamp is REFUSED, not rendered verbatim', kinds(CARD_REPRO, NOW_MS).includes('quoted-in-the-future'));
  t('…and the refusal names the clock it was judged against', stampRefusals(CARD_REPRO, NOW_MS)[0]?.detail?.includes('2026-09-10T06:37Z') === true);
  t('…and says a time that has not happened is not a reading of anything', stampRefusals(CARD_REPRO, NOW_MS)[0]?.detail?.includes('provably not a reading of anything') === true);
  t('⭐ …so the whole body is refused and NOTHING is rendered', renderBody(CARD_REPRO, NOW_MS).ok === false && renderBody(CARD_REPRO, NOW_MS).body === undefined);
  t('⛔ a PAST quoted stamp is untouched — the route this closes is one direction only', renderBody('Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.', NOW_MS).body?.includes('board read 2026-09-08T14:00Z.') === true);
  t('⭐ BOUNDARY: a stamp equal to the act\'s OWN minute is ACCEPTED — a reading taken inside 06:37 is spelled 06:37Z', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', NOW_MS).length === 0);
  t('⭐ …and the first minute the clock has NOT reached is refused', kinds('read {{WAS:2026-09-10T06:38Z}}', NOW_MS).includes('quoted-in-the-future'));
  t('…the acceptance opens ON the tick: a clock standing exactly at 06:37:00 accepts 06:37Z', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', Date.parse('2026-09-10T06:37:00Z')).length === 0);
  t('…and one millisecond before it does not — the span must have STARTED, not be about to', kinds('read {{WAS:2026-09-10T06:37Z}}', Date.parse('2026-09-10T06:37:00Z') - 1).includes('quoted-in-the-future'));
  t('⛔ no forward skew window: 14 minutes ahead is refused though H56 tolerates 14 minutes of DRIFT', kinds('read {{WAS:2026-09-10T06:51Z}}', NOW_MS).includes('quoted-in-the-future') && H56_STAMP_TOLERANCE_MIN === 15);
  t('the grain is the stamp\'s own: 06:37:49Z is one second ahead of 06:37:48 and is refused', kinds('read {{WAS:2026-09-10T06:37:49Z}}', NOW_MS).includes('quoted-in-the-future'));
  t('…while the same instant spelled to the minute is not', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', NOW_MS).length === 0);
  t('⛔ a shape failure is NOT also filed as a direction one — one typo, one refusal', kinds('{{WAS:2099-01-01T00:00Z ruling}}', NOW_MS).join() === 'quoted-not-a-stamp');
  t('…and the shape refusals still fire, unchanged', kinds('{{WAS:yesterday}}', NOW_MS).includes('quoted-not-a-stamp'));
  t('an unreadable value is nobody\'s idea of the future', stampIsFuture('yesterday', NOW_MS) === false);
  t('⭐ the `{{NOW}}` route is untouched: a token-only body still renders on this act\'s clock', renderBody('Claim: {{NOW}} — dispatched.', NOW_MS).body === 'Claim: 2026-09-10T06:37Z — dispatched.');
  const POSITIONAL_FUTURE = 'Claim: skills seat, 2099-01-01T00:00Z — dispatched.';
  t('⭐ the POSITIONAL refusal stops handing a future estimate back through the quoted route', stampRefusals(POSITIONAL_FUTURE, NOW_MS)[0]?.detail?.includes('{{WAS:2099-01-01T00:00Z}}') === false);
  t('…and says instead that the stamp is later than the clock this act holds', stampRefusals(POSITIONAL_FUTURE, NOW_MS)[0]?.detail?.includes('later than the clock this act holds') === true);
  t('…while a PAST typed stamp is still offered the quoted route, which is the whole control', stampRefusals(OPENING, NOW_MS)[0]?.detail?.includes('{{WAS:2026-09-10T06:37Z}}') === true);
  const MIXED_FUTURE = 'Claim: {{NOW}}\n\nThe board was read at 2099-01-01T00:00Z.';
  t('the MIXED refusal likewise stops offering a route that would refuse it', stampRefusals(MIXED_FUTURE, NOW_MS).find((r) => r.kind === 'mixed')?.detail?.includes('{{WAS:2099-01-01T00:00Z}}') === false);
  t('…and a past bare stamp keeps the declaration on offer', stampRefusals('Claim: {{NOW}}\n\nread 2026-09-08T14:00Z', NOW_MS).find((r) => r.kind === 'mixed')?.detail?.includes('{{WAS:2026-09-08T14:00Z}}') === true);
  t('⛔ the clock defaults to Date.now() rather than to "no judgement" when a caller omits it', stampRefusals('read {{WAS:2099-01-01T00:00Z}}').map((r) => r.kind).includes('quoted-in-the-future'));

  battery('the substitution: one clock, read once, written everywhere');
  const TWO = renderBody('Claim: {{NOW}}\n\nRound opened {{NOW}}.', NOW_MS);
  t('a body that clears the contract renders', TWO.ok === true);
  t('⭐ two tokens get the SAME stamp — one clock, read once', TWO.body.split('2026-09-10T06:37Z').length - 1 === 2);
  t('…counted for the transcript', TWO.substituted === 2);
  t('…and the stamp is the clock handed in, never a second read', TWO.stamp === '2026-09-10T06:37Z');
  const QUOTED = renderBody('Verdict {{NOW}} on the board read {{WAS:2026-09-08T14:00Z}}.', NOW_MS);
  t('a quoted stamp renders VERBATIM', QUOTED.body.includes('board read 2026-09-08T14:00Z.'));
  t('…counted apart from the substituted ones', QUOTED.quoted === 1 && QUOTED.substituted === 1);
  t('nothing else in the body moves', renderBody('# Title\n\n- a\n- b\n', NOW_MS).body === '# Title\n\n- a\n- b\n');
  t('a body with no token at all is still postable', renderBody('os-dev-report\n\n{"issue": 17314}', NOW_MS).ok === true);
  t('…and reports zero substitutions rather than pretending to a clock', renderBody('os-dev-report', NOW_MS).substituted === 0);

  battery('the read-back: what the transcript can actually prove');
  const SENT = 'Claim: 2026-09-10T06:37Z';
  const ON_TIME = readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 1 });
  t('⭐ a stamp inside the minute the platform stored it reads as ZERO drift', ON_TIME.drift === 0);
  t('…said in one line a transcript carries', ON_TIME.lines[0].includes('one clock, one act'));
  t('…and the bytes are compared, not assumed', ON_TIME.lines[1].includes('IDENTICAL to what was sent'));
  const LATE = readBackVerdict({ stamp: '2026-09-10T05:27Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 1 });
  t('⭐ a stamp 70 minutes from its own write is loud', LATE.drift === 70);
  t('…and names the patrol that will file it', LATE.lines[0].includes('H56 will file this artefact'));
  t('a drift inside the tolerance says so instead', readBackVerdict({ stamp: '2026-09-10T06:30Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 1 }).lines[0].includes('within the'));
  t('an unreadable write time is NOT MEASURED, never zero drift', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: null, sent: SENT, stored: SENT, substituted: 1 }).lines[0].includes('NOT MEASURED'));
  t('…and its drift is null rather than a number', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: null, sent: SENT, stored: SENT, substituted: 1 }).drift === null);
  t('a body with no substitution claims no clock', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 0 }).lines[0].includes('no clock to check'));
  t('⭐ a body the platform MUTATED is reported, not assumed identical', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: `${SENT} x`, substituted: 1 }).mutated === true);
  t('…and the sanitizer is named as the thing to go read about', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: `${SENT} x`, substituted: 1 }).lines[1].includes('sanitizer'));
  t('an unreadable stored body is UNVERIFIED, never verified', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: undefined, substituted: 1 }).lines[1].includes('UNVERIFIED'));

  // The platform normalises nearly every body it stores, so a verdict that only
  // knows `stored === sent` warns on nearly every write — and the one real
  // mutation of a shift then reads exactly like the noise around it. The cases
  // below pin the MEASURED normalisations as clean and named, and pin that
  // everything else keeps the warning and gains an offset a reader can chase.
  const rb = (extra) => readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', substituted: 1, ...extra });
  const FIVE = [
    classifyReadBack({ sent: 'x', stored: undefined }),
    classifyReadBack({ sent: 'x', stored: 'x' }),
    classifyReadBack({ sent: 'x\n', stored: 'x' }),
    classifyReadBack({ sent: 'x', stored: `x${PLATFORM_COMMENT_FOOTER}`, mode: 'comment' }),
    classifyReadBack({ sent: 'x', stored: 'y' }),
  ];
  t('the platform comment footer is declared as the 58 bytes measured, never a pattern', Buffer.byteLength(PLATFORM_COMMENT_FOOTER, 'utf8') === 58, `bytes=${Buffer.byteLength(PLATFORM_COMMENT_FOOTER, 'utf8')}`);
  t('every class the classifier answers with has a declared meaning', FIVE.every((r) => r.class in READ_BACK_CLASSES), FIVE.map((r) => r.class).join());
  t('…and those five inputs are five DIFFERENT classes, not one word repeated', new Set(FIVE.map((r) => r.class)).size === 5);

  const STRIPPED_SENT = `${SENT}\n`;
  const STRIPPED = rb({ sent: STRIPPED_SENT, stored: SENT, mode: 'body' });
  t('⭐ THE FILED READING: a body stored one trailing newline short is CLEAN, not MUTATED', STRIPPED.mutated === false && STRIPPED.readBack.class === 'trailing-newline-stripped');
  t('…and the line NAMES the strip rather than warning about the sanitizer', STRIPPED.lines[1].includes('clean — the platform stripped the trailing newline') && STRIPPED.lines[1].includes('⚠️') === false);
  t('…carrying both byte counts, so a reader reads the delta instead of recomputing it', STRIPPED.lines[1].includes(`sent ${Buffer.byteLength(STRIPPED_SENT, 'utf8')}, stored ${Buffer.byteLength(SENT, 'utf8')}`), STRIPPED.lines[1]);

  const APPENDED = rb({ sent: SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}`, mode: 'comment' });
  t('⭐ a COMMENT stored with the platform footer appended is CLEAN', APPENDED.mutated === false && APPENDED.readBack.class === 'footer-appended');
  t('…and the line names the footer as the thing that was added', APPENDED.lines[1].includes('clean — the platform appended its footer'));
  t('⭐ THE CONTROL: the same append in BODY mode stays MUTATED — an unmeasured cell is not forgiven', rb({ sent: SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}`, mode: 'body' }).mutated === true);
  t('…and a caller naming NO mode gets that strict reading, never the lenient one', rb({ sent: SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}` }).mutated === true);

  const BOTH = rb({ sent: STRIPPED_SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}`, mode: 'comment' });
  t('⭐ a strip AND the footer on one comment is clean, named by the footer', BOTH.mutated === false && BOTH.readBack.class === 'footer-appended' && BOTH.lines[1].includes('appended its footer'));
  t('…and the strip is said too, rather than one normalisation hiding the other', BOTH.lines[1].includes('over the stripped trailing newline'), BOTH.lines[1]);

  const UNDER = rb({ sent: 'a [b] c\n', stored: `a b c${PLATFORM_COMMENT_FOOTER}`, mode: 'comment' });
  t('⭐ a real mutation UNDERNEATH an appended footer is still MUTATED', UNDER.mutated === true && UNDER.readBack.class === 'mutated');
  t('…at an offset INSIDE the body, not at the tail where the footer starts', UNDER.readBack.offset === 2, `offset=${UNDER.readBack.offset}`);
  t('…and the added line shows both sides at that byte', UNDER.lines[2].includes('first difference at byte 2') && UNDER.lines[2].includes('| stored'), UNDER.lines[2]);

  const WIDE = rb({ sent: '维护者 [x] 的裁决', stored: '维护者 x 的裁决', mode: 'comment' });
  t('⭐ a multi-byte character ahead of the difference gives a BYTE offset, never a character one', WIDE.readBack.offset === Buffer.byteLength('维护者 ', 'utf8'), `offset=${WIDE.readBack.offset}`);
  t('…and the context window opens ON the difference, not on the prefix both bodies share', WIDE.readBack.sentContext.includes('[x]'), WIDE.readBack.sentContext);
  t('…with control characters escaped, the way a refusal prints a span', rb({ sent: 'line one\nline two', stored: 'line one line two', mode: 'comment' }).readBack.sentContext.includes('\\n'));

  t('two identical bodies have no first differing byte at all', firstDifferingByte('x', 'x') === -1);
  t('…and where one is a PREFIX of the other the seam is the shorter one\'s end', firstDifferingByte('abc', 'ab') === 2);
  t('an unreadable stored body reports no offset to chase', rb({ sent: SENT, stored: undefined }).readBack.offset === null);

  battery('the CLI: the one decision a typo must never make');
  t('a comment target parses', parseOptions(['--comment=17314']).options.mode === 'comment');
  t('…with the number read as a number', parseOptions(['--comment=17314']).options.number === 17314);
  t('a body target parses', parseOptions(['--body=17314']).options.mode === 'body');
  t('⛔ both targets at once is refused — they are two different acts', parseOptions(['--comment=1', '--body=2']).ok === false);
  t('⛔ no target at all is refused, never defaulted', parseOptions([]).ok === false);
  t('⛔ a non-numeric target is refused rather than coerced', parseOptions(['--comment=seventeen']).ok === false);
  t('⛔ a zero or negative target is refused', parseOptions(['--comment=0']).ok === false);
  t('⛔ an unknown flag is a typo and is refused', parseOptions(['--comment=1', '--wrte']).ok === false);
  t('…and the refusal lists what the tool does take', parseOptions(['--comment=1', '--wrte']).error.includes('--dry-run'));
  t('--dry-run is carried through', parseOptions(['--comment=1', '--dry-run']).options.dryRun === true);
  t('--json is carried through', parseOptions(['--comment=1', '--json']).options.json === true);
  t('--repo and --file are read as values, not flags', parseOptions(['--comment=1', '--repo=o/n', '--file=b.md']).options.repo === 'o/n');
  t('--ack-through=ID is read as the newest comment id, with --body', parseOptions(['--body=6017', '--ack-through=5646143629']).options.ackThrough === 5646143629);
  t('…and absent, it is null rather than zero', parseOptions(['--body=1']).options.ackThrough === null);
  t('⛔ --ack-through with --comment is refused — a comment voids nothing', parseOptions(['--comment=1', '--ack-through=5']).ok === false);
  t('⛔ a non-numeric --ack-through is refused rather than coerced', parseOptions(['--body=1', '--ack-through=newest']).ok === false);

  // The filed shape: the body last written (and stamped) at 10:00Z, a knock at
  // 13:20:47Z, a refresh attempted at 15:58Z — which is where the knock died.
  battery('the unread-knock check: a refresh cannot void what nobody read');
  const SEAT_BODY = '**Seat post.**\n\n## 当前 PM\n\n🟢 seat · 自 2026-09-12T10:00Z 就座;前任 2026-09-11T22:00Z 离任。\n';
  const KNOCK = { id: 5646143629, created_at: '2026-09-12T13:20:47Z', user: { login: 'engine-seat' }, body: '敲门:a director ruling assigns this seat an incremental contract review.' };
  const OLDER = { id: 5640000000, created_at: '2026-09-11T23:30:00Z', user: { login: 'someone' }, body: 'audit: handover' };
  const LATER = { id: 5648793698, created_at: '2026-09-12T20:05:00Z', user: { login: 'engine-seat' }, body: 'escalation' };
  const filed = unreadComments({ storedBody: SEAT_BODY, comments: [OLDER, KNOCK] });
  t('⭐ the filed shape: a knock newer than the body\'s last stamp, no acknowledgement ⇒ REFUSED', filed.ok === false && filed.kind === 'unacknowledged');
  t('…the last write is read from the body\'s own newest stamp, never from updated_at', filed.since?.stamp === '2026-09-12T10:00Z');
  t('…the knock is the one comment listed; the older one is outside the window', filed.after.length === 1 && filed.after[0].id === 5646143629);
  t('…and the refusal names the newest id as the flag to pass', unreadRefusalText(filed, 6017).includes('--ack-through=5646143629'));
  t('…says nothing was written', unreadRefusalText(filed, 6017).includes('Nothing was written'));
  t('…and lists the comment so the seat reads it, not a count', unreadRefusalText(filed, 6017).includes('5646143629 · 2026-09-12T13:20:47Z · engine-seat'));
  const control = unreadComments({ storedBody: SEAT_BODY, comments: [OLDER] });
  t('⭐ THE CONTROL: no comment newer than the last write ⇒ accepted with no flag at all', control.ok === true && control.kind === 'none-newer');
  t('…and an empty card is accepted the same way', unreadComments({ storedBody: 'no stamp here', comments: [] }).ok === true);
  t('⭐ acknowledging the newest comment ⇒ accepted', unreadComments({ storedBody: SEAT_BODY, comments: [OLDER, KNOCK], ackThrough: 5646143629 }).kind === 'acknowledged');
  const stale = unreadComments({ storedBody: SEAT_BODY, comments: [OLDER, KNOCK, LATER], ackThrough: 5646143629 });
  t('⛔ acknowledging an OLDER comment is refused — the flag proves reading, it is not a switch', stale.ok === false && stale.kind === 'ack-not-newest');
  t('…with exactly the comments that landed after the acknowledged one', stale.after.length === 1 && stale.after[0].id === 5648793698);
  t('…and the refusal points at the newest', unreadRefusalText(stale, 6017).includes('--ack-through=5648793698'));
  t('⛔ an id that is not on the card is refused, never trusted', unreadComments({ storedBody: SEAT_BODY, comments: [KNOCK], ackThrough: 42 }).kind === 'ack-unknown');
  t('an acknowledgement with nothing newer is moot, not an error', unreadComments({ storedBody: SEAT_BODY, comments: [OLDER], ackThrough: 5640000000 }).ok === true);
  t('⭐ a body with NO stamp counts every comment as newer — the conservative direction', unreadComments({ storedBody: 'nothing stamped', comments: [OLDER] }).kind === 'unacknowledged');
  t('…and the refusal says to put the token in the body', unreadRefusalText(unreadComments({ storedBody: 'x', comments: [OLDER] }), 1).includes('{{NOW}}'));
  t('the newest stamp is judged as an instant: seconds-grained 10:00:30Z outranks minute-grained 10:00Z', lastWriteStamp('a 2026-09-12T10:00Z b 2026-09-12T10:00:30Z').stamp === '2026-09-12T10:00:30Z');
  t('…and a later minute outranks an earlier seconds-grained one', lastWriteStamp('2026-09-12T10:00:30Z then 2026-09-12T10:01Z').stamp === '2026-09-12T10:01Z');
  t('BOUNDARY: a comment inside the stamp\'s own minute counts as newer — the seat may not have seen it', unreadComments({ storedBody: SEAT_BODY, comments: [{ id: 1, created_at: '2026-09-12T10:00:05Z' }] }).ok === false);
  t('…and one at the last second of the minute before does not', unreadComments({ storedBody: SEAT_BODY, comments: [{ id: 1, created_at: '2026-09-12T09:59:59Z' }] }).ok === true);
  t('the newest is by created_at, not by input order', unreadComments({ storedBody: SEAT_BODY, comments: [LATER, KNOCK] }).newest.id === 5648793698);
  t('a comment with an unreadable created_at is newer, never silently old', unreadComments({ storedBody: SEAT_BODY, comments: [{ id: 7, created_at: 'n/a' }] }).ok === false);
  // The post-stamped reading: a STORED body whose newest stamp names no instant
  // the calendar has. `Date.parse` rolls 31 April FORWARD to 1 May, so reading
  // it as the last write moved the window LATER and a knock inside the gap read
  // as "none-newer" — the derivation shrank, which the header forbids. The
  // write side refuses such a stamp; a stored body can still carry one by hand,
  // through the platform's own editor, or from before this tool existed.
  const ROLLED_BODY = '**Seat post.**\n\n🟢 seat · 自 2026-04-31T00:00Z 就座。\n';
  const NO_PARSE_BODY = '**Seat post.**\n\n🟢 seat · 自 2026-13-45T99:99Z 就座。\n';
  const ROLLED_OVER_REAL_BODY = '**Seat post.**\n\n🟢 seat · 自 2026-04-31T00:00Z 就座;前任 2026-04-29T09:00Z 离任。\n';
  const GAP_KNOCK = { id: 5678039238, created_at: '2026-04-30T12:00:00Z', user: { login: 'engine-seat' }, body: '敲门:a knock inside the rollover gap.' };
  const rolled = unreadComments({ storedBody: ROLLED_BODY, comments: [GAP_KNOCK] });
  t('⭐ THE FILED READING: a knock inside a rolled-over stamp\'s gap is NOT "none-newer"', rolled.kind !== 'none-newer', `kind=${rolled.kind}`);
  t('…it is refused as unacknowledged — the window may only widen', rolled.ok === false && rolled.kind === 'unacknowledged');
  t('…because the rolled-over stamp is not read as the last write at all', rolled.since.stamp === null && rolled.since.from === null);
  t('…and the stamp it would not read is named, with the date it actually rolls to', rolled.since.unreal.length === 1 && rolled.since.unreal[0].stamp === '2026-04-31T00:00Z' && rolled.since.unreal[0].rolledTo === '2026-05-01T00:00Z');
  t('…the refusal says THAT, rather than claiming the body carries no stamp', unreadRefusalText(rolled, 18293).includes('2026-04-31T00:00Z') && unreadRefusalText(rolled, 18293).includes('names an instant the calendar HAS'));
  t('…and still points at the newest comment as the flag to pass', unreadRefusalText(rolled, 18293).includes('--ack-through=5678039238'));
  const noParse = unreadComments({ storedBody: NO_PARSE_BODY, comments: [GAP_KNOCK] });
  t('⭐ a stamp that does not parse AT ALL reaches the same outcome — one rule, not two accidents', noParse.kind === 'unacknowledged' && noParse.since.stamp === null);
  t('…and reports no rollover it did not have', noParse.since.unreal.length === 1 && noParse.since.unreal[0].rolledTo === null);
  const fellBack = unreadComments({ storedBody: ROLLED_OVER_REAL_BODY, comments: [GAP_KNOCK] });
  t('⭐ with an older REAL stamp beside it the window measures from THAT one — earlier, so wider', fellBack.since.stamp === '2026-04-29T09:00Z');
  t('…so the same knock still counts as newer', fellBack.ok === false && fellBack.after.length === 1 && fellBack.after[0].id === 5678039238);
  t('…and the refusal says the window is WIDER here, never narrower', unreadRefusalText(fellBack, 18293).includes('WIDER here, never') && unreadRefusalText(fellBack, 18293).includes('2026-04-31T00:00Z'));
  t('⭐ --ack-through naming the newest comment still clears a body with no readable stamp', unreadComments({ storedBody: ROLLED_BODY, comments: [GAP_KNOCK], ackThrough: 5678039238 }).kind === 'acknowledged');
  t('⭐ THE ACCEPTANCE CONTROL: nothing newer ⇒ the refresh is still written, unreal stamp or not', unreadComments({ storedBody: ROLLED_BODY, comments: [] }).ok === true);
  t('…and the pass line names the stamp the derivation did not read', unreadPassText(unreadComments({ storedBody: ROLLED_BODY, comments: [] })).includes('2026-04-31T00:00Z'));
  t('⭐ THE CONTROL, UNCHANGED: a body whose stamps are all real is judged exactly as before', control.ok === true && control.kind === 'none-newer' && control.since.stamp === '2026-09-12T10:00Z' && control.since.unreal.length === 0);
  t('…and its pass line carries no skipped-stamp clause at all', unreadPassText(control).includes('NOT read as the last write') === false);
  t('a body with NO stamp stays distinguishable from one with only unreal stamps', lastWriteStamp('nothing stamped').unreal.length === 0 && lastWriteStamp(ROLLED_BODY).unreal.length === 1);
  t('lastWriteStamp always answers an object, so no caller can read a null as "no stamp problem"', lastWriteStamp('nothing stamped').stamp === null && Array.isArray(lastWriteStamp('nothing stamped').unreal));
  t('the pass line names what was measured against', unreadPassText(control).includes('2026-09-12T10:00Z'));

  // The post-stamped reading, second one: two comments written inside ONE
  // second (a batch, a bot). `newest` breaks that tie on `id`, so the LOWER id
  // is not the newest and the refresh is rightly refused — but the "landed
  // after" set was derived from `created_at` ALONE, so the refusal's head
  // counted 0 comment(s) after the very id it was refusing and listed none of
  // them: a count contradicting the refusal it sits in. One comparator answers
  // both now.
  const PAIR_LOW = { id: 5679000100, created_at: '2026-09-12T11:00:00Z', user: { login: 'engine-seat' }, body: 'batch write, first' };
  const PAIR_HIGH = { id: 5679000101, created_at: '2026-09-12T11:00:00Z', user: { login: 'engine-seat' }, body: 'batch write, second' };
  const sameSecond = unreadComments({ storedBody: SEAT_BODY, comments: [PAIR_LOW, PAIR_HIGH], ackThrough: 5679000100 });
  t('⭐ THE FILED READING: same-second comments, the ack naming the LOWER id ⇒ refused as ack-not-newest', sameSecond.ok === false && sameSecond.kind === 'ack-not-newest');
  t('…and the later id COUNTS as after it — the count no longer contradicts the refusal it sits in', sameSecond.after.length === 1 && sameSecond.after[0].id === 5679000101, `after=${JSON.stringify(sameSecond.after.map((c) => c.id))}`);
  t('…so the refusal head reads 1, not 0', unreadRefusalText(sameSecond, 18295).includes('1 comment(s) landed after it'));
  t('…and lists that comment, so the seat reads it rather than a count', unreadRefusalText(sameSecond, 18295).includes('5679000101 · 2026-09-12T11:00:00Z · engine-seat'));
  t('…the newest pick and the after set read ONE order: whoever is newest is in the set the refusal lists', sameSecond.newest.id === 5679000101 && sameSecond.after.some((c) => Number(c.id) === Number(sameSecond.newest.id)));
  t('⭐ THE CONTROL, UNCHANGED: an ordinary later-SECOND comment is after the acknowledged one exactly as before', stale.kind === 'ack-not-newest' && stale.after.length === 1 && stale.after[0].id === 5648793698);
  t('⭐ same second, the ack naming the HIGHER id ⇒ cleared, it IS the newest', unreadComments({ storedBody: SEAT_BODY, comments: [PAIR_LOW, PAIR_HIGH], ackThrough: 5679000101 }).kind === 'acknowledged');
  t('…and the ack naming the newest still clears in the ordinary case too', unreadComments({ storedBody: SEAT_BODY, comments: [OLDER, KNOCK], ackThrough: 5646143629 }).ok === true);

  battery('the shared rule: this tool and H56 cannot come to disagree');
  t('⭐ the positions this tool refuses are the ones H56 reads — one imported reader, never two', h56StampedReadings(maskQuotedStamps(OPENING)).length === 1);
  t('⭐ …so a body this tool accepts leaves H56 nothing in those positions', h56StampedReadings(maskQuotedStamps(TWO.body.replace(/2026-09-10T06:37Z/g, '{{NOW}}'))).length === 0);
  t('the tolerance is the imported constant, never a second number', H56_STAMP_TOLERANCE_MIN === 15);
  t('a stamp this tool substitutes is zero-drift against its own write instant', stampDriftMinutes(stampNow(NOW_MS), '2026-09-10T06:37:48Z') === 0);
  t('…and an estimate is beyond the tolerance by the same arithmetic', stampDriftMinutes('2026-09-10T05:27Z', '2026-09-10T06:37:48Z') > H56_STAMP_TOLERANCE_MIN);
  t('the exit register keeps a contract refusal apart from a transport failure', EXIT_REFUSED !== EXIT_PREREQUISITE_NOT_MET);

  // The floor, evaluated last: a battery that stops running names itself here.
  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floorFailures = [];
  const floorFailure = (text) => floorFailures.push(text);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR} — a section that stopped being declared is a section nothing floors.`);
  }
  for (const [name, count] of batterySeen) {
    if (!(name in SELF_TEST_BATTERIES)) {
      floorFailure(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
    }
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const text of floorFailures) console.error(`  ✗ ${text}`);
  if (failed.length > 0 || floorFailures.length > 0) {
    for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    console.error(`✗ post-stamped self-test: ${failed.length} of ${cases.length} case(s) failed, ${floorFailures.length} floor problem(s).`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`✓ post-stamped self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network, no token.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ post-stamped self-test: selfTest() returned without reaching its verdict, so no success\n' +
          'line was printed. Exiting 0 here would report a self-test that never finished as a self-test\n' +
          'that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else {
    // ⛔ Not on a dry run: that path makes no request, so re-execing it would
    // spawn a second process to prove a route nothing is about to use.
    const rearmed = process.argv.includes('--dry-run') ? null : rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
