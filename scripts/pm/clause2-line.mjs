#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * clause2-line — the fleet's ONE reader of the `Clause-②: yes | no`
 * declaration line, and nothing else.
 *
 * ## Why this file exists, and what it deliberately does NOT carry
 *
 * The declaration line and the contract REVIEW were one mechanism and are no
 * longer: ruling record 5770886272 on #19061 retired the `needs:contract-review`
 * gate label, the `--pair` landing pre-check, the double-carrier discipline and
 * the independence pair as a requirement, and KEPT two things that have nothing
 * to do with who reviewed a diff — one `## Contract review` record per governed
 * PR, and this declaration line. The line answers a semver question
 * (「本卡放宽接受集或扩大公开面吗」) and an ADR-0087 disposition question; both
 * are read on every PR by two gates that are in CI, and neither is a question
 * about review.
 *
 * So the reader moved out from under the sweep. `check-changeset-no-major.mjs`
 * and `check-adr-0087-registration.mjs` run in `lint.yml` and
 * `pr-automation.yml` on every PR, and in `cut-rc.yml` on a dispatched cut.
 * `release.yml` names them in PROSE only (`:358`, `:590` — why a major cannot
 * reach that lane), runs neither, and therefore never loads this module. Before
 * this extraction each gate pulled in `pm/check-clause2-carriers.mjs` — ten
 * thousand lines and a nine-module closure of sweep machinery — to reach forty
 * lines of line reading. Their closure is now this file, which imports NOTHING:
 * no node builtin, no first-party module. That is load-bearing twice over —
 * `check-changeset-no-major.mjs` states that it still runs before
 * `pnpm install`, and both gates stage their own first-party closure into a
 * throwaway repo for their I1/I2 fixtures.
 *
 * This file was STEP ① of that ruling; step ② retired the rule text and step ③
 * the label — its constant, the queue guard's label leg, the half-state rows
 * that patrolled it and the changeset gate's label carrier are gone from this
 * tree. What still stands beside this reader is `check-clause2-carriers.mjs`,
 * kept only because the queue guard's Tier S leg lazily imports its record
 * recognisers and `--template`; its `--pair` sweep is retired by the ruling and
 * nothing runs it, and the file goes once those recognisers are extracted.
 *
 * ## ⛔ One reader, and this is it
 *
 * `check-clause2-carriers.mjs` imports these symbols back rather than keeping a
 * copy, and so does `pm/post-stamped.mjs`. The condition the arm (#16421) landed
 * under is that the direction has a single legal spelling read in a single
 * place: a second parser anywhere — a regex in a gate, a "close enough" match in
 * a sweep — is the drift every docblock below refuses by name. Add a reading
 * HERE or not at all.
 *
 * ⛔ Nothing in this file reads a board, a comment thread, a label or a PR. It
 * is pure: text in, a four-valued reading out. Everything that talks to GitHub
 * stayed behind in the sweep.
 */

// ---------------------------------------------------------------------------
// Limb ② — the declaration, read in the fixed spelling and nowhere near prose
// ---------------------------------------------------------------------------

/**
 * The two readings that ARE a declaration. Written out rather than derived from
 * a pattern so that a reader of this file sees the closed set the way
 * `SKILL.md` states it — 恰这两种拼写.
 */
export const CLAUSE2_VALUES = Object.freeze(['yes', 'no']);

/**
 * The DIRECTION ARM — the closed pair a declaration may name after its value.
 *
 * ## Why an arm exists at all (#16421)
 *
 * The value answers ONE question: 「本卡放宽接受集或扩大公开面吗」. A diff that
 * NARROWS a published accept set answers it `no` truthfully — and a narrowing is
 * a breaking change. So `no` was carrying two facts that need opposite handling,
 * and the one needing the most was the one nothing could see: measured on
 * #16296, a value-domain narrowing shipped to consumers with every gate green,
 * because `check-adr-0087-registration.mjs` read breaking-ness out of a
 * `**BREAKING**` PROSE BANNER the author simply did not type. Maintainer ruling,
 * director summon #17, decision batch #2 item 1, option B — #16421 comment
 * 5572145955, 2026-09-07 — verbatim 「同意」.
 *
 * ## The arm is OPTIONAL, and that is a measurement, not a kindness
 *
 * Every declaration on the board the day this landed reads `Clause-②: no` with
 * no parenthetical arm (5 of 13 open PRs carry a declaration; all five read
 * `no`, and #18268's carries trailing em-dash reasoning and still no paren). A
 * mandatory arm would have invalidated all five overnight. An ABSENT arm
 * therefore declares NO DIRECTION — the reading a body written before this
 * change gets, byte-identically to what it got before it existed.
 *
 * ## The four combinations, and the one that is refused
 *
 *   `yes` / `yes (widening)`  — a widening. The second spelling is the first,
 *                               said out loud; both take at least `minor`.
 *   `yes (narrowing)`         — a diff that widens one surface and narrows
 *                               another. Both facts are true and both are read.
 *   `no (narrowing)`          — NOT a widening, but breaking. This is the whole
 *                               point of the arm.
 *   `no (widening)`           — ⛔ MALFORMED. The value says "this does not
 *                               widen" and the arm says it does; a reader that
 *                               picked either one of the two would be guessing.
 */
export const CLAUSE2_ARMS = Object.freeze(['widening', 'narrowing']);

/**
 * The key, and the decoration tolerated around it.
 *
 * Tolerated because a seat writes it without meaning anything by it, and
 * reading it as absent is how #10063 sat blocked in silence (the H4 lesson,
 * one item over): an optional leading blockquote `>` — SKILL.md's own claim
 * template is a blockquote — an optional list bullet, and backtick or bold
 * wrapping on the key. ⛔ NOT tolerated: a different key, a different case, a
 * full-width colon, or the space-separated prose form `Clause ②:` that two of
 * the three measured cards actually wrote. Those are near misses and are
 * reported as such below; they are not declarations.
 *
 * ⭐ Three capture groups, and the first two exist for #17098: whether the key
 * was OPENED with a backtick, and whether that backtick CLOSED before the
 * colon. The pattern has always tolerated both ticks; what it could not say is
 * WHICH of them it consumed — and a span closed around the key (a declaration,
 * merely backticked) differs from a span still open at the colon (the VALUE is
 * inside quoted text, and the line is a quotation of the spelling) by nothing
 * else on the line. ⛔ The tolerated decoration is byte-identical to what it
 * was: the groups report the match, they do not widen it.
 */
const CLAUSE2_KEY_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?(`?)Clause-②(`?)(?:\*\*)?[ \t]*:(.*)$/;

/**
 * A line that MENTIONS the clause without being the machine declaration — used
 * only to make a "no reading" row actionable by quoting what was there instead.
 * ⛔ It never produces a verdict: widening the predicate to absorb these is the
 * tolerant-consumer direction #12409 bans by name.
 */
const CLAUSE2_NEAR_MISS_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*#][ \t]*)*(?:\*\*)?`?\s*Clause[ \t-]*(?:②|2|two)(?![\w]).*$/i;

/**
 * The SECOND near-miss shape, and the one both patterns above are blind to: the
 * key in the FIXED spelling, on a line that starts with something else.
 *
 * `Domain: \`domain:cli\` · Clause-②: no` is a natural way to write a compact
 * claim header, and it reaches neither pattern above — both anchor at `^` and
 * tolerate only line-start decoration before the key. So the line was invisible
 * TWICE: not read as a declaration (correct), and not quoted back as a near miss
 * either (the whole job of the mechanism above). What the seat was told instead
 * was that the SPELLING was wrong, on a line spelled exactly right.
 *
 * ⛔ This is a REPORTER, never a reader. It changes what this file SAYS about a
 * line it does not read; it changes nothing about what it ACCEPTS.
 * `CLAUSE2_KEY_LINE` is untouched, and must stay untouched: 「a predicate that
 * reads prose is a heuristic, and the measured terminus of that direction is a
 * check that can barely fail」.
 *
 * ⭐ And the reason that red line is structural rather than stylistic: this
 * reader decides "is this line a declaration?" by POSITION ALONE. Loosening the
 * position rule to catch the shape above would, by the same stroke, promote more
 * merely-DESCRIBING prose into candidate declarations — the opposite direction,
 * measured on the same regex. So the detector below deliberately fires only
 * where the key is NOT at the start of a line, and a key-initial line reaches it
 * never: whatever a key-initial line reads as, this file does not move it.
 *
 * The prefix set is the decoration the two patterns above already tolerate
 * (whitespace, a blockquote `>`, a list bullet, `#`, backtick/bold wrapping). A
 * line whose key is preceded by only that is a DECORATION near miss and keeps
 * the spelling remedy; a line whose key is preceded by anything else is a
 * PLACEMENT near miss and gets a remedy that names placement.
 */
const CLAUSE2_KEY_TEXT = 'Clause-②';
const CLAUSE2_KEY_COLON = /^`?(?:\*\*)?[ \t]*:/;
const CLAUSE2_LINE_START_DECORATION = /^[ \t>\-*#`]*$/;

/**
 * Does this line carry the fixed key, followed by its colon, at a position no
 * line-start decoration can explain?
 *
 * @param {string} line
 * @returns {boolean}
 */
function hasInlineClause2Key(line) {
  const s = String(line ?? '');
  let from = 0;
  for (;;) {
    const at = s.indexOf(CLAUSE2_KEY_TEXT, from);
    if (at < 0) return false;
    from = at + CLAUSE2_KEY_TEXT.length;
    // The key alone is not the shape; it is the key AND its colon, so a bare
    // mention of `Clause-②` in a sentence is left to the pattern above.
    if (!CLAUSE2_KEY_COLON.test(s.slice(from))) continue;
    if (!CLAUSE2_LINE_START_DECORATION.test(s.slice(0, at))) return true;
  }
}

/**
 * The value token, read immediately after the colon.
 *
 * ⚠️ Trailing text after the token is ACCEPTED, and the calibration is not
 * mine: #13914's own control case is described as "the PM claim comment on
 * #12297 carries `Clause-②: yes` **with reasoning**" and is recorded there as
 * the shape that is CORRECT. A reader that rejected a reason on the same line
 * would grade the card's own control as a defect — and on the live board
 * 2026-08-31 it rejected four real claims whose reasoning was parenthetical.
 * So the rule is: the token must be the FIRST thing after the colon, and it
 * must be exactly `yes` or `no`. What a seat writes after it is their argument,
 * which this file does not read and must not.
 *
 * ⛔ That is not a relaxation toward prose. `Clause-②: probably not`,
 * `Clause-②: YES`, `Clause-②: nope` and an empty value all stay MALFORMED,
 * because none of them opens with the token. The boundary is a character
 * class, not a judgement.
 *
 * ⭐ One more shape joins them for #17098: a token followed by an
 * ALTERNATION. The class above ends at `[A-Za-z0-9_]` and `|` is not in it,
 * so `yes|no` opened with a valid token and returned `yes` — a MENU read as
 * a CHOICE, which is how a seat's own spelling instruction became its card's
 * judgement. It is refused HERE, alongside `Clause-②: <yes|no>` and every
 * other unfilled template, because it is the same fact about the same slot:
 * the value was never chosen. `clause2LineDescribes` states the four axes
 * behind putting it here rather than beside the describing tells.
 *
 * ⛔ The refusal is ADJACENCY, never a scan: only a `|` that is the next
 * non-blank character after the token. The reasoning #13914's control shape
 * allows may contain a pipe anywhere later — a table column, a shell
 * pipeline — and is untouched.
 */
function matchValueToken(raw) {
  const rest = String(raw ?? '').replace(/^[ \t]+/, '');
  // Built from CLAUSE2_VALUES so the closed set is declared once: adding a
  // third reading would have to be a deliberate edit to that constant.
  const token = new RegExp(`^(?:\\*\\*)?(?:\`)?[ \\t]*(${CLAUSE2_VALUES.join('|')})(?![A-Za-z0-9_])(?![ \\t]*\\|)`);
  const m = token.exec(rest);
  // `after` is the REST OF THE LINE, handed on so the arm is read from the same
  // single pass. ⛔ Not a second parser: the arm reader below never sees the key,
  // the colon or the value — only what this match did not consume.
  return m ? { value: m[1], after: rest.slice(m[0].length) } : null;
}

function readValueToken(raw) {
  return matchValueToken(raw)?.value ?? null;
}

/**
 * The ARM token, read immediately after the value. (#16421)
 *
 * ## The shape, and the one calibration it inherits
 *
 * The arm is a PARENTHETICAL opened as the next non-blank thing after the value
 * — `Clause-②: no (narrowing)` — and the arm word is the FIRST token inside it.
 * That is `readValueToken`'s own calibration, one slot along: the token comes
 * first and what follows it is the seat's argument, which this file does not
 * read. So `no (narrowing — the IANA zone domain)` reads the arm and keeps the
 * reason, exactly as `no — …` keeps trailing reasoning today.
 *
 * ⚠️ The closing decoration is stripped first, and that is not cosmetic:
 * `**\`no\`** (narrowing)` closes the backtick and the bold AFTER the value, so
 * a reader that looked for `(` at position 0 would miss the arm on the exact
 * spelling this file's own remedy sentence teaches.
 *
 * ## Three outcomes, because a near miss must not read as an absence
 *
 *   `{ arm: 'widening'|'narrowing' }` — the fixed spelling, exactly.
 *   `{ arm: null }`                   — no parenthetical, or one that is plainly
 *                                       reasoning (`no (nothing published
 *                                       moves)`). The overwhelming live shape.
 *   `{ bad: <token> }`                — ⛔ the parenthetical OPENS with a word of
 *                                       the arm family and is not one of the two
 *                                       spellings: `(narrowed)`, `(Narrowing)`,
 *                                       `(widen)`, and the unfilled template
 *                                       `(widening|narrowing)`. Read as ABSENT
 *                                       these fail OPEN — a declared narrowing
 *                                       silently stops being declared, which is
 *                                       the defect the arm exists to remove. The
 *                                       caller turns this into `malformed`, the
 *                                       state this file already owns for "the
 *                                       slot holds something ungradeable".
 *
 * ⛔ The alternation refusal is `readValueToken`'s, for `readValueToken`'s
 * reason: `(widening|narrowing)` is a MENU, and a seat that pasted the template
 * without choosing has not declared a direction.
 *
 * @param {string} after — the line remainder `matchValueToken` did not consume.
 * @returns {{ arm: 'widening'|'narrowing'|null, bad?: string }}
 */
function readArmToken(after) {
  // Closers come off in the mirror order the value's openers went on: the value
  // pattern consumed `**` then a backtick, so a decorated value closes backtick
  // then `**`.
  const rest = String(after ?? '').replace(/^`?(?:\*\*)?[ \t]*/, '');
  if (!rest.startsWith('(')) return { arm: null };
  const exact = new RegExp(`^\\([ \\t]*(${CLAUSE2_ARMS.join('|')})(?![A-Za-z0-9_])(?![ \\t]*\\|)`);
  const hit = exact.exec(rest);
  if (hit) return { arm: hit[1] };
  // Not the fixed spelling. Only a word of the arm FAMILY is a near miss; any
  // other parenthetical is ordinary reasoning and is left alone.
  const near = /^\([ \t]*(?:\*\*)?`?[ \t]*([A-Za-z|]+)/.exec(rest);
  return near && /widen|narrow/i.test(near[1]) ? { arm: null, bad: near[1] } : { arm: null };
}

/**
 * Does this MATCHING line describe the declaration instead of making one?
 * (#17098)
 *
 * ## The defect, in one line
 *
 * `CLAUSE2_KEY_LINE` decides "is this a declaration?" by POSITION, and a bullet
 * teaching the spelling puts the key in exactly the position a declaration
 * does. So a standing-rules bullet quoting both spellings read `declared`, and
 * on a claim comment whose only key-initial line was that bullet, the
 * EXPLANATION became the card's declaration — measured fail-closed on #16454
 * (a true `no` that hung `needs:contract-review` on both carriers) and measured
 * fail-OPEN on #17277 / #17290, where the declaration limb read `yes` from the
 * dispatching seat's own boilerplate and `--pair` exited 0, which is a landing
 * pre-check's precondition ②. ⭐ The seat that documents the spelling is the
 * seat that defeats the check.
 *
 * ## Two STRUCTURAL tells, and neither is a reading of prose
 *
 * ⛔ Loosening or tightening the POSITION rule was never available: the header
 * one section up states why, and the reporter below it fires only where the key
 * is not line-initial. So both tells below are facts about the line's markdown
 * STRUCTURE, decided without reading a word of what the seat wrote:
 *
 *   TWICE-NAMED — the fixed key appears more than once on the line. A
 *     declaration names the key once; a line naming it twice is showing both
 *     spellings, which is the measured shape of the card's own specimen.
 *   QUOTED-AND-CONTINUED — the key's inline-code span was opened before the
 *     key, was NOT closed before the colon, closes later on the line, and the
 *     line then CONTINUES outside that span. The value is inside a quotation
 *     and the seat is talking about it. ⭐ The continuation is load-bearing in
 *     both directions: a line that is only the quoted declaration
 *     (`` `Clause-②: yes` ``, optionally bolded) is a DECLARATION and stays one
 *     — that spelling is what this file's own remedy sentence teaches, so
 *     refusing it would make the gate reject the shape it prescribes.
 *
 * ## What is NOT a tell here — the alternation, and why
 *
 * ⚠️ `readValueToken`'s token class ends at `[A-Za-z0-9_]`, so `Clause-②:
 * yes|no` opens with a valid token and returned `yes`: a MENU read as a CHOICE.
 * That is the same defect, and it is repaired one function down — as
 * `malformed`, ⛔ not as a describing near miss, and the four axes agree:
 *
 *   业务需求 — measured: the live specimen (a bulleted, bolded, backticked
 *     instruction) already fires QUOTED-AND-CONTINUED, so routing the
 *     alternation to `malformed` costs nothing on any occurrence on the board.
 *     The only line where the alternation is the SOLE tell is an undecorated
 *     `Clause-②: yes|no` — a seat that pasted the template and did not choose.
 *   长远合理性 — one state per fact. "The value slot holds a menu" is one fact
 *     and it already has a state: `Clause-②: <yes|no>` reads `malformed`
 *     today, as do `YES`, `nope` and an empty value. A second state for the
 *     same fact is the dialect direction.
 *   防 AI 写错 — the two remedies are not interchangeable. `malformed` names
 *     the two spellings and says CHOOSE; the describing remedy says ADD a line
 *     above. For an unfilled template the act that exists is choosing, and
 *     "add a line above" invites a second, duplicate declaration. Strictness
 *     is identical either way — both are a C2 row at exit 4.
 *   不扩散 — three near-miss reasons where two structural ones carry every
 *     measured shape is a widened surface with no pull behind it.
 *
 * @param {string} line — the whole line, for the twice-named count.
 * @param {RegExpExecArray} m — this line's `CLAUSE2_KEY_LINE` match.
 * @returns {boolean}
 */
function clause2LineDescribes(line, m) {
  const s = String(line ?? '');
  // TWICE-NAMED. `indexOf` from the last hit, so an overlap cannot double-count.
  let seen = 0;
  for (let at = s.indexOf(CLAUSE2_KEY_TEXT); at >= 0; at = s.indexOf(CLAUSE2_KEY_TEXT, at + CLAUSE2_KEY_TEXT.length)) {
    if (++seen > 1) return true;
  }
  // QUOTED-AND-CONTINUED. The span is open at the colon exactly when the key's
  // leading tick was consumed and its trailing one was not.
  if (m[1] !== '`' || m[2] === '`') return false;
  const closesAt = String(m[3] ?? '').indexOf('`');
  if (closesAt < 0) return false;
  // Trailing bold and whitespace close the line; anything else continues it.
  return !/^[ \t]*(?:\*\*)?[ \t]*$/.test(String(m[3]).slice(closesAt + 1));
}

/** A quoted line for a finding row — capped, because a claim comment can be long. */
export function quoteLine(line, cap = 160) {
  const s = String(line ?? '').trim().replace(/\s+/g, ' ');
  return s.length <= cap ? s : `${s.slice(0, cap)}…`;
}

/**
 * Read the declaration limb out of ONE comment or body.
 *
 * @param {string} text
 * @returns {{ kind: 'declared', value: 'yes'|'no', arm: 'widening'|'narrowing'|null, line: string }
 *          | { kind: 'malformed', value: string, line: string }
 *          | { kind: 'near-miss', reason: 'describing'|'inline-key'|'spelling', line: string }
 *          | null}
 *
 * Four-valued on purpose. `declared` and `malformed` are different facts about
 * a line that IS the key; `near-miss` is a fact about a line that is not. Any
 * collapse of these into "no" is the defect #13914 filed.
 *
 * ⭐ `arm` (#16421) is the DIRECTION the declaration names, from
 * {@link CLAUSE2_ARMS}, and `null` when it names none — which is what every
 * declaration written before the arm existed says, and says unchanged. It is the
 * ONE spelling of the direction in this fleet: `check-adr-0087-registration.mjs`
 * and `check-changeset-no-major.mjs` import this reader rather than growing a
 * parser each, which is the ruling's own condition on the change.
 *
 * The near miss carries a REASON because the shapes owe different remedies:
 * `spelling` is a line that does not carry the fixed key at all; `inline-key`
 * is a line that carries it exactly right but not at the start of a line; and
 * `describing` (#17098) is a line that carries it exactly right, at the start
 * of a line, and is QUOTING the spelling rather than declaring a value —
 * `clause2LineDescribes` holds the two structural tells. ⛔ The reason changes
 * the sentence, never the state — all three are near misses, and a near miss
 * is not a declaration in any of the three cases.
 *
 * ⭐ A describing line is SKIPPED, not returned: the scan continues past it.
 * That is the half of #17098 the fixture could not see. `readClause2Line`
 * returns on the first line that IS a declaration attempt, and a quotation is
 * not one — so a claim comment whose real declaration sits BELOW its
 * standing-rules bullet is now read from the declaration, where first-match
 * previously stopped at the bullet. The describing line is kept only as the
 * residue to quote back when nothing else on the body reads.
 */
export function readClause2Line(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  let read = null;
  let describing = null;
  let nearMiss = null;
  let inlineKey = null;
  for (const line of lines) {
    const m = CLAUSE2_KEY_LINE.exec(line);
    if (m) {
      // #17098: a line that QUOTES the spelling is not a declaration attempt,
      // so it neither answers nor stops the scan. ⛔ It is not `malformed`
      // either — that state sends the seat to fix a value on a line that was
      // never making a claim about one.
      if (clause2LineDescribes(line, m)) {
        if (describing === null) describing = quoteLine(line);
        continue;
      }
      if (read !== null) continue;
      const hit = matchValueToken(m[3]);
      // #16421. The arm is read in the SAME pass, from what the value match did
      // not consume, and two shapes collapse into the `malformed` this file
      // already owns rather than growing a state each:
      //   * a near-arm spelling (`readArmToken`'s `bad`), and
      //   * the CONTRADICTION `no (widening)` — "does not widen" beside "widens".
      // Both are a value slot nobody can grade, which is what `malformed` means
      // here, and both fail CLOSED. ⛔ Neither may read as an absent arm: that is
      // the direction a declared narrowing disappears in.
      const armRead = hit === null ? { arm: null } : readArmToken(hit.after);
      const contradiction = hit?.value === 'no' && armRead.arm === 'widening';
      read = hit !== null && armRead.bad === undefined && !contradiction
        ? { kind: 'declared', value: hit.value, arm: armRead.arm, line: quoteLine(line) }
        : { kind: 'malformed', value: quoteLine(m[3], 60), line: quoteLine(line) };
      continue;
    }
    if (inlineKey === null && hasInlineClause2Key(line)) inlineKey = quoteLine(line);
    if (nearMiss === null && CLAUSE2_NEAR_MISS_LINE.test(line)) nearMiss = quoteLine(line);
  }
  if (read !== null) return read;
  // The correctly-spelled key wins over a vocabulary near miss wherever the two
  // land in the body: it is the more actionable of the two residues, and reading
  // order is not a fact about which one the seat should be sent to. By the same
  // rule a DESCRIBING line outranks both: it carries the key in the fixed
  // spelling AND at the start of a line, so of the three it is the one whose
  // remedy is a single line the seat can write without moving anything.
  if (describing !== null) return { kind: 'near-miss', reason: 'describing', line: describing };
  if (inlineKey !== null) return { kind: 'near-miss', reason: 'inline-key', line: inlineKey };
  return nearMiss === null ? null : { kind: 'near-miss', reason: 'spelling', line: nearMiss };
}
