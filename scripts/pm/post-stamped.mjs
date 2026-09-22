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
 * tool imports that same reader and runs it over the body AS IT WILL BE
 * POSTED, so a stamp the read-side patrol could file at either position is
 * refused before the write instead of filed on a board hours later:
 *
 *   POSITIONAL  a bare stamp sits in one of those two positions. That is the
 *               act's own stamp typed by hand, which is the whole defect. Write
 *               `{{NOW}}` there; a stamp that really is a reading of something
 *               ELSE does not belong at that position at all — declare it with
 *               `{{WAS:…}}` in the body.
 *   DECLARED    a `{{WAS:…}}` renders AT one of those two positions. The
 *               declaration is spent at render time, so what lands there is bare
 *               digits the patrol reads as this act's clock. Section below.
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
 * ## A declared reading is not a spelling for those two positions (#18995)
 *
 * The parity sentence above is falsifiable, and it was false. The positional
 * walk read `maskQuotedStamps`'d text, where a declaration is blanked, so a
 * `{{WAS:…}}` on the OPENING line passed the write side — and the refusal text
 * above offered it there by name. `substituteTokens` renders a declaration as
 * its payload and nothing else, so it is SPENT at render time and the board
 * carries bare digits where the patrol reads the writing act's own clock.
 * Measured twice, on live artefacts written by FOLLOWING this file's own
 * prescription: an opening line declaring a card's close time, filed 19 minutes
 * out; a subscript line declaring a CI-log reading, filed 23 out, six such rows
 * in one sweep.
 *
 * So the positional judgement runs over the body `substituteTokens` will
 * actually send, and a stamp standing at one of those positions that is not
 * this act's own clock is refused whichever spelling put it there. The REMEDIES
 * differ where the spellings do: a typed stamp becomes `{{NOW}}`; a real
 * reading MOVES into the body and is declared there.
 *
 * Two shapes it leaves alone, both because the patrol does. A position carrying
 * MORE THAN ONE stamp once rendered — `{{NOW}}` beside a declared reading on
 * one line is that shape — is read by nobody: H56 holds that line out rather
 * than guess, and so does this. And a declaration whose value IS this act's
 * clock minute renders the bytes `{{NOW}}` would have, so refusing it would
 * refuse a body the patrol reads as perfectly stamped — the parity claim false
 * the other way round.
 *
 * ⛔ It does not widen the BARE scan, which stays value-free: a typed stamp
 * equal to this act's minute is still typed, and the positional refusal keeps
 * it. The two rules meet at the position and part at the spelling. ⛔ And a
 * declaration the value rules already refused is not ALSO filed here — one
 * typo, one refusal, the rule this file states for the calendar and direction
 * checks: a payload that is not a stamp declared nothing, so there is no
 * reading standing in the wrong place.
 *
 * ⛔ The rejected route, recorded because it is the one that reads well: render
 * a marker H56 recognises. That is a THIRD spelling both halves must learn, on
 * a board the marker is visible on, bought to keep a reading in the one
 * position where no reader can tell it from the act's own clock. The position
 * is the defect; a marker makes it survivable instead of removing it.
 *
 * ## ⛔ Never pipe this tool, then `&&` the write that follows
 *
 * The exit register above is worth exactly what the caller reads. A pipeline's
 * status is its LAST command's, so the habitual seat idiom
 * `post-stamped … | tail -3 && label-write …` hands the `&&` tail's 0 and the
 * refusal is gone: the audit comment is REFUSED, the label lands anyway, and the
 * card is left graded with nothing on it saying why — the half-state the
 * comment-before-label ordering exists to prevent, and the direction of it that
 * nobody can recover from a later read. Measured on a live card, where the seat
 * noticed eight seconds on; a turn that had ended there would have left it.
 *
 * So read the output without spending the code — redirect first, then capture:
 *
 *   node scripts/pm/post-stamped.mjs … > /tmp/p.log 2>&1; EXIT=$?; tail -3 /tmp/p.log
 *
 * or arm `set -o pipefail` before the pipeline. The rule is the caller's, not
 * this tool's, so it covers every writer beside it — `label-write.mjs` included.
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
 * ⛔ And the scan opens no escape hatch OUTSIDE a quoted span — no backslash
 * form, no entity form, no flag. What it does open is the next section, which
 * is not a spelling of the token contract at all.
 *
 * ## The contract is QUOTABLE: inside Markdown code, this tool renders text (#18543)
 *
 * The substitution used to run on bytes, so a passage QUOTING the token was
 * rewritten like any other. Measured three times inside one hour, by two
 * seats, on live artefacts:
 *
 *   ① #14251 carried a verbatim quote of this tool's OWN status line, in an
 *      inline code span inside a blockquote. The token inside the quotation was
 *      substituted and a sentence this tool never printed was published as a
 *      quotation of it. The only signal was `substitutions: 2` where the author
 *      meant 1 — a count, not a warning, and nothing compared it to intent.
 *   ② The seat filing ① hit it again in the sentence DESCRIBING ①, and a third
 *      time in the comment reporting ②. Care is not a remedy: every one of the
 *      three was written by an author who was thinking about this exact defect.
 *   ③ The dispatch claim for this card spelled both token forms inside
 *      backticks and was REFUSED `[quoted-not-a-stamp]` — the quoted route read
 *      its own documentation placeholder as a declaration. So the contract
 *      could not be quoted through this tool, nor explained through it.
 *
 * ⛔ The remedy is NOT a third spelling, and ⛔ NOT a flag. Markdown already
 * has one construct that means "this is text, not instructions", and it has it
 * in two forms — a fenced code block and a backtick code span. So:
 *
 *   INSIDE A QUOTED SPAN THIS TOOL RENDERS TEXT, NOT TOKENS.
 *
 * A reader of the stored artefact sees the rule without knowing the tool
 * exists: the backticks are right there, on the page, in the spelling every
 * other quotation on the board already uses. Nothing was added to the token
 * contract — it still has exactly two spellings — and no caller has to
 * remember a magic word it would itself have to quote to document.
 *
 * What a quoted span suppresses is exactly the three rules that READ a token:
 * substitution, the opener scan, and the quoted-stamp validation. An opener
 * inside one is not refused, a `{{WAS:…}}` inside one is not judged against
 * the calendar or the clock, and both are written out exactly as the author
 * typed them.
 *
 * ⛔ And it suppresses NOTHING that judges a stamp a human typed. This is the
 * load-bearing asymmetry, and it is the whole reason the rule is safe: quoting
 * changes what is RENDERED, never what was AUTHORED. A stamp inside a fence is
 * still digits on the board.
 *
 *   POSITIONAL  reads every line, code included. A bare stamp in a code span on
 *               the opening line is refused exactly as in prose.
 *   MIXED       triggers on the act-clock token appearing ANYWHERE in the body,
 *               quoted or not. An author who spells the token knows it exists,
 *               and a bare stamp elsewhere is ambiguous to a reader whatever
 *               backticks sit around the other one. ⛔ Deliberately NOT made
 *               quote-aware: that is the one direction this change could have
 *               weakened a refusal, and it does not take it.
 *   MASKING     `maskQuotedStamps` blanks a `{{WAS:…}}` only where it is a
 *               TOKEN. Inside a quoted span it is text, so the digits it
 *               carries stay visible to the bare-stamp scan — otherwise a
 *               stamp could hide from the contract behind backticks, which is
 *               the accident this rule must never buy.
 *
 * So the refusal surface is unchanged or STRICTER everywhere except the three
 * token rules inside a quoted span, which is the deliverable. One body changes
 * direction: `` `{{WAS:<a real stamp>}}` `` beside the act-clock token used to
 * be accepted and rendered as bare digits — that acceptance WAS defect ① — and
 * is now MIXED-refused, with the refusal saying that the stamp sits inside a
 * quotation so neither spelling will render there.
 *
 * ⛔ The count is no longer the only signal. The status line reports how many
 * openers were left VERBATIM inside quoted spans beside how many were
 * substituted, so an author who meant to quote one and stamp one reads both
 * numbers and can compare them to intent — which is what ① had no way to do.
 *
 * What a quoted span IS, exactly (`quotedSpans`), and what it deliberately is
 * not:
 *
 *   FENCED      a line opening with three or more backticks or tildes (up to
 *               three leading spaces), through its closing fence — or the end
 *               of the body, the way CommonMark ends an unclosed one. Tracked
 *               through blockquote markers, since a seat quoting a tool's
 *               output inside a quote is the shape ① was written in.
 *   CODE SPAN   a backtick run closed by a run of the SAME length, ⛔ searched
 *               within one line only. CommonMark lets a span cross lines; this
 *               does not, on purpose — under-detecting leaves today's
 *               behaviour, and today's behaviour is what every existing caller
 *               already has.
 *   ⛔ NOT      a four-space indented block. Indentation is load-bearing in
 *               lists and continuations, so reading it as a quotation would
 *               make the rule fire where no reader sees a quotation.
 *
 * The two failure directions are not symmetric, which is why that scanner is
 * conservative: under-detecting substitutes a token the author wanted verbatim
 * — the state before this rule — while over-detecting leaves an artefact
 * UNSTAMPED. The status line's verbatim count is what makes the second one
 * visible in the same breath.
 *
 * ## A quoted token is not a stamp — the carve-out's PARTNER check (#19091)
 *
 * The rule above is right and this file said so, and it landed without its
 * other half: nothing asked whether the artefact ended up STAMPED AT ALL. A
 * body whose ONLY token sits inside a quoted span is substituted by nothing —
 * correctly — and was then posted at exit 0 carrying the literal token and no
 * time. Two facts at once, and they are the two the UNKNOWN refusal names by
 * hand: the literal text on the card AND the artefact unstamped, which is the
 * quiet direction. ⇒ the refusal table had a hole at the intersection of its
 * own carve-out, reached by spelling the token CORRECTLY.
 *
 * ⚠️ Measured live, not only in a dry run. Three `Claim:` comments one act
 * posted carried their round stamp as `` `Round: fire of {{NOW}}` `` and went
 * out unstamped with the token visible (objectui#9871, #9880, #9874). The only
 * signal the caller got was this file's own read-back line — "none substituted,
 * this body carried no token, so there is no clock to check" — which was FALSE
 * of the body: it carried one. A caller who redirected the log and read
 * `exit=0`, which is the discipline this header prescribes, would have shipped
 * three claims with no reading time, and the protocol treats an artefact with
 * no reading time as 未取.
 *
 * ⛔ The criterion is NOT "0 substitutions AND ≥1 verbatim opener". A body may
 * legitimately quote the token while stamping itself by DECLARATION, and the
 * header you are reading is such a body. So the judgement is a PREDICATE over
 * the counts the render already produces (`stampVerdict`), and the refusal is
 * one of its four verdicts — ⛔ never a count read straight:
 *
 *   stamped-by-this-act      ≥1 `{{NOW}}` substituted: the clock THIS act read
 *                            is in the artefact. The ordinary case, unchanged.
 *   stamped-by-declaration   nothing substituted, ≥1 `{{WAS:…}}` rendered from
 *                            its own declaration. ACCEPTED — the artefact is
 *                            stamped, as a reading of something else the author
 *                            declared. This seat's claim comments are this
 *                            shape, and so is a body that quotes the token
 *                            beside such a declaration.
 *   unstamped-quoted-token   nothing substituted, nothing declared, and ≥1
 *                            opener that IS one of the two spellings left
 *                            verbatim inside a quotation. REFUSED,
 *                            `EXIT_REFUSED`, nothing written.
 *   no-token                 all three zero. Unchanged: the body spells no
 *                            token, and it posts.
 *
 * ⛔ `no-token` is deliberately NOT named by the new refusal, and the reason is
 * a population rather than a preference. Every filed instance CARRIED a token,
 * quoted: the defect is the contradiction between what the body SAYS and what
 * happened, and a body that never spells a token states nothing to contradict.
 * #17314's rule binds a timestamp a seat WRITES, so a body that writes none
 * breaks it nowhere. Refusing it would be a new required refusal over the whole
 * population of untokened bodies — the older, separately measured shape — and
 * this file's own rule is that a predicate tightened on one side must be
 * re-measured on the other.
 *
 * ⛔ And the count the predicate reads is NOT the status line's `verbatim`.
 * That one counts every opener left as written, a `{{` inside a quoted
 * Handlebars example included; the predicate counts only the openers that ARE
 * `{{NOW}}` or `{{WAS:…}}` (`verbatimTokens`). A body quoting a template that
 * spells neither has quoted no stamp, and refusing it would refuse a shape
 * nobody filed with a text naming a token it does not carry — which is why the
 * two counts are two fields and not one.
 *
 * ⛔ A loud warning plus a distinct exit was the declared fallback and is NOT
 * what landed, because no caller shape needs this body posted: the remedy costs
 * one token OUTSIDE the quotation, every filed instance was repaired by hand
 * afterwards, and a warning on stderr is exactly what the false read-back line
 * already was. Refusing is also the only direction that keeps the register
 * honest — `EXIT_REFUSED` already means "the body broke the stamp contract,
 * nothing written", and this is that.
 *
 * The read-back line is corrected in the same edit, because the refusal cannot
 * reach the two shapes that still get there: a declaration-stamped body carried
 * no `{{NOW}}` and IS stamped, and a body that quoted one carried a token.
 * The line now says which verdict it is standing on and what was quoted, so it
 * is true of every body that reaches it.
 *
 * ## A claim's keyed lines are refused BEFORE the write (#19152)
 *
 * A claim's three exact-value fields — `Seat:`, `Thread-read:`, `Clause-②:` — are read HERE through the functions that
 * own them, so a line those functions cannot read is `EXIT_REFUSED` before any request instead of a half-state row on
 * someone else's board hours later (five such rows off three keys in one seat's shift, the measurement behind this
 * rule). `claimKeyedLineRefusals` carries the four decisions that keep it a mirror and not a fourth dialect.
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
 *                               strip above. BOTH acts, since #18693: the
 *                               issue-body cell is measured (the section
 *                               below), so this class no longer asks which of
 *                               the two writes put the bytes there.
 *   footer-re-anchored          stored is that body with the trailing
 *                               newline(s) it SENT removed and exactly one
 *                               newline inserted before the block it already
 *                               ended in — nothing added and nothing lost,
 *                               which is why it is not the class above, whose
 *                               word is "plus".
 *   footer-blank-collapsed      stored is that body with the block's own blank
 *                               line collapsed to one newline, with or without
 *                               the strip above — sent N, stored N-1 on its
 *                               own and N-2 over a stripped trailing newline,
 *                               which is the shape a seat post's `--body`
 *                               write sends (#19048, #19312). The footer path
 *                               DOES take a byte here, and the byte is its own
 *                               separator.
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
 * ## The issue-body footer cell IS measured — and the variable that is not (#18693)
 *
 * This file used to declare that cell unmeasured and hold the body-mode append
 * in `mutated` on that ground, with a pinned control keeping it there. The cell
 * is measured, and the readings agree with one another:
 *
 *   the governed fact table  `.claude/skills/pm-dispatch/references/`
 *                            `platform-readings.md` :410 — a card created
 *                            through REST with no footer gets exactly one
 *                            synthesised (+58) — and :411 — on
 *                            `PATCH /issues/{n}`, the act `--body` performs,
 *                            a body sending the whole block and a body
 *                            sending no footer BOTH store back exactly one.
 *   live, on this channel    the skills seat's three `--body=7623` refreshes
 *                            of 2026-09-17, sent tail carrying no block:
 *                            47699 → 47757, 49671 → 49729, 52030 → 52088 —
 *                            +58 each, and that stored body ends in exactly
 *                            this block, once.
 *   a controlled contrast    two sends to one artefact the writing act owns,
 *                            differing ONLY in whether the sent tail ends in
 *                            the block, both read back byte-exact. The PR
 *                            that moved this cell carries the table.
 *
 * ⛔ What is unmeasured is not the cell — it is the WRITE CHANNEL. The triage
 * seat's two `--body=6015` refreshes the same day, tail likewise carrying no
 * block, read back IDENTICAL, and that stored body holds no footer at all.
 * Same endpoint, same shape of sent body, opposite outcome ⇒ what decides
 * whether the block is synthesised is the channel, or the identity behind it,
 * and no act here can vary that: a container holds one credential, and ⛔
 * borrowing another seat's identity is not a measurement this fleet takes.
 *
 * ⭐ And this tool does not need to know which channel it is on, which is what
 * lets the cell move at all. The read-back compares EXACT BYTES: a body that
 * came back unchanged is `identical`, a body that came back with exactly the
 * declared block appended is `footer-appended`, and the two cannot be confused
 * for each other. A cell a tool cannot tell apart is a cell it must not
 * forgive; this one it tells apart perfectly, every write, whichever way the
 * channel goes.
 *
 * ## The read-back reaches the caller as an EXIT CODE, or it reaches nobody (#18663)
 *
 * That comparison is worth exactly what the caller reads, and until this rule
 * it was printed and nothing else. Measured on a live card: a seat-post
 * refresh sent 263,533 bytes, the platform stored 257,945 — the byte count of
 * the version BEFORE that write — with the first difference at byte 6792,
 * where the new block began. The old body had been kept whole and not one byte
 * of the new one was there. The tool printed its MUTATED line and returned 0,
 * and the seat walked on to post the comments that say the conclusion had
 * already landed in the body.
 *
 * ⛔ That is NOT the pipeline trap two sections up. That one is about a caller
 * throwing the code away; this was the tool HANDING OUT a zero. A caller that
 * pipes nothing and checks `$?` — every discipline this header prescribes —
 * was still told the write had landed.
 *
 * So the verdict carries an exit code, and ONE question decides it:
 *
 *   DID EVERY BYTE THIS ACT SENT REACH THE PLATFORM?
 *
 * ⛔ Not "did the bytes come back identical" — they never do, which is the
 * whole point of the declared set above. All FIVE benign classes keep the sent
 * body's CONTENT whole: `identical` by definition, `trailing-newline-stripped`
 * gives up only newlines the platform does not keep, `footer-appended` adds
 * without removing, `footer-re-anchored` moves a newline the act itself sent,
 * and `footer-blank-collapsed` gives up one newline of the platform's OWN
 * footer separator, over any trailing newline it does not keep. Every one of
 * them exits 0.
 *
 * `mutated` is the only class that answers no, and since #18693 it is also the
 * only class that CAN: the two shapes the platform's own footer takes are
 * classes of their own, named by the two arms `footerReAnchoring` spells out,
 * so a difference this fleet has measured never reaches the word `mutated` in
 * either act.
 *
 *   APPENDED     the sent body carried no footer and the stored body is it, or
 *                its newline-trimmed form, followed by exactly the block. The
 *                platform synthesised it. Class `footer-appended`, exit 0.
 *   RE-ANCHORED  the sent body already ended in the block with trailing
 *                newline(s) after it, and the stored body is that same body
 *                with those newlines removed and exactly one newline inserted
 *                immediately before the block. Class `footer-re-anchored`,
 *                exit 0.
 *   COLLAPSED    the sent body ended in the block, with or without trailing
 *                newline(s) of its own, and the stored body is it — those
 *                newlines stripped — with the block's blank line collapsed.
 *                Class `footer-blank-collapsed`, exit 0 (#19048, #19312).
 *   NOT STORED   `mutated`, and nothing else is: a byte this act sent is not
 *                the byte the platform holds at that offset, or the stored
 *                body stops before the sent one does. `EXIT_NOT_STORED`.
 *
 * ⛔ This is not a footer exemption sneaking into the classifier — it is the
 * end of one. While the append was forgiven by `$?` and refused by the class,
 * this tool said two things about one set of bytes: `everything sent is on the
 * platform` in `$?` and `MUTATED` on stderr, with `--json` reporting
 * `body_mutated: true` beside `body_landed: true`. Now the class is the
 * measurement: `body_mutated` is false exactly when `body_landed` is true, and
 * a reader who checks one has checked the other.
 *
 * ⛔ The second shape is NOT the first one widened for tidiness, and the
 * distance between them is the whole reason this rule was filed twice. The
 * first shape reached `main` alone, and from that moment EVERY artefact a seat
 * wrote with its own attribution footer — the block the harness rule requires
 * verbatim — exited 4: sent N, stored N, equal length, the sole difference one
 * newline that had moved from after the footer to before its rule. The write
 * had landed whole every time. A seat obeying the contract above ("exit 4 ⇒
 * read the artefact, do not retry") stops on every write; a seat that stops
 * believing exit 4 is the state this rule exists to end, and one that RETRIES
 * writes the comment twice. ⭐ A predicate tightened on one side is a predicate
 * that must be re-measured on the OTHER: the danger direction was closed and
 * this one was opened in the same edit.
 *
 * ⛔ And the answer is NOT "equal length means it landed". Length answers a
 * different question in both directions: a re-anchored footer over two trailing
 * newlines is SHORTER, and any substitution of one byte for another is exactly
 * as long as what it replaced. Both arms compare a candidate BUILT from the
 * sent bytes with `===`, so a byte lost before the rule and a footer the
 * sanitizer has chewed each still exit 4 — pinned as controls.
 *
 * This retires an interim reading, and the retirement is the point of writing
 * it down: between the two landings a seat read every exit-4 artefact back by
 * hand and judged "first difference at the trailing rule, equal length ⇒
 * benign" for itself. That judgement is now the tool's, measured on exact
 * bytes, so ⛔ nobody needs to make it by eye again — and nobody should, because
 * by eye it cannot tell a moved newline from a substitution the same length.
 *
 * ⛔ The rule is a predicate over the VERDICT's own field — `readBack.class`,
 * which is an exact-bytes measurement — and ⛔ never over the byte counts. The platform normalises blank lines around a
 * trailing rule in BOTH directions, so a length comparison answers a different
 * question: "stored is shorter" is neither necessary (a re-anchored footer is
 * longer) nor sufficient (a substitution of equal length loses just as much).
 *
 * ⛔ And it does not need the PRE-WRITE body, which only `--body` ever holds.
 * "The platform kept the old one" is one INSTANCE of the class, not its
 * definition: whatever is stored, a byte that differs INSIDE the body this act
 * sent is a byte this act did not get onto the platform. One predicate covers
 * the filed hit, a truncation, a sanitizer substitution, and a `--comment`
 * write the same way — `--comment` shares this verdict, so it is judged by it
 * too, and its footer append is already clean a class earlier.
 *
 * What a caller does with a 4: RE-READ THE ARTEFACT. ⛔ Do not retry blindly.
 * The measured hit was a size refusal the platform never reported, so an
 * identical second write reproduces it exactly, and a retry loop on a body
 * edit writes that failure into the card over and over. Read what is stored,
 * work out what is missing, send a body that can land.
 *
 * ⛔ `unreadable` is deliberately NOT widened into this code. "The platform
 * returned no readable body" is a failure to VERIFY, not a measured failure to
 * store, and it keeps its UNVERIFIED line and its 0 until somebody measures
 * what that cell means — the same reason a newline that came from NOWHERE is
 * not forgiven: the platform inserting a byte the act never sent is a cell
 * nobody has measured, whatever it looks like.
 *
 * ## A size refusal is a REFUSAL, not a missing route (#18843)
 *
 * The register above had four codes and no place for the fifth thing that
 * actually happens: the platform reads the write, considers it, and refuses it
 * because the body is over the surface's cap. `rest()` threw on every non-2xx,
 * both call sites caught it as a PREREQUISITE, and a real HTTP 422 was reported
 * as 「no route, no act at all」 with the remedy 「run this where node's fetch
 * reaches api.github.com with a token that can write issues」.
 *
 * Every clause of that is wrong for this cause. The route existed — the write
 * travelled it. The token was accepted. And the remedy sends the caller to
 * another route with another token, where the same bytes are refused
 * identically: this file's own header already has the word for that shape — a
 * refusal text prescribing a refused remedy is a tool arguing with itself.
 *
 * Measured, twice, by the #18806 dev on probe objectstack#18826 (writes 5 and
 * 6): a 262,145-byte comment through `--comment=18826` answered HTTP 422, and
 * this tool exited 3. So the class is its own:
 *
 *   TRIGGER   HTTP 422, plus a refusal text that names the body's LENGTH. Both
 *             halves are required and ⛔ the class is NOT every 422: the
 *             issues listing answers 422 to deep pagination (page 99 stores,
 *             page 100 refuses — measured 2026-08-31, `check-half-states.mjs`),
 *             and that 422 is about a cursor, not a body. It keeps its 3.
 *   TEXT      the bytes this act SENT, the measured cap for the surface it
 *             sent them to, the overage between them, and the remedy that can
 *             work: SHORTEN the body or SPLIT it. ⛔ Never a route remedy —
 *             pinned held apart, in both directions, against the constant exit
 *             3 prescribes with.
 *   CODE      `EXIT_TOO_LARGE`. Nothing was written and nothing was read back,
 *             which it shares with 3; what it does not share is what a caller
 *             must DO, and the register exists to carry exactly that.
 *
 * ⛔ The cap in that text is never the number the platform's own message
 * carries. GitHub says 「maximum is 65536 characters」 on all three write
 * surfaces, and that string is false in unit AND value — objectstack#18826's
 * write 4 stored a 262,144-byte comment, four times it, and #18793 bisected the
 * issue-body surface to the same figure. It is the most likely provenance of
 * the 65,536 folklore this fleet has already had to correct once, so the text
 * quotes the platform's sentence (a reader needs to see what the platform said)
 * and names it FALSE in the same breath, beside the bisected cap. A reader who
 * re-derives a cap from a refusal's own text re-derives the false number.
 *
 * The two spellings are NOT one string, which is why the trigger is
 * case-insensitive rather than an equality: `POST /issues/{n}/comments` answers
 * `Body is too long (maximum is 65536 characters)` and
 * `PATCH /issues/comments/{id}` answers the same sentence with a lower-case
 * `body` (objectstack#18826's record, captured verbatim on both). An equality
 * pinned to the create-side capital would have left the update side at 3.
 *
 * ⛔ And the trigger does not read the platform's number even to confirm
 * itself. Keying on 「maximum is 65536」 would tie this class to a false clause,
 * so the day GitHub corrects its own text the refusal would silently fall back
 * to 3 — a gate that fails when its subject gets BETTER.
 *
 * The cap named is the cap of the surface this act wrote to, and the two are
 * separate constants on purpose: `COMMENT_BODY_LIMIT` for `--comment`
 * (`POST /issues/{n}/comments`, bisected on objectstack#18826) and
 * `ISSUE_BODY_LIMIT` for `--body` (`PATCH /issues/{n}`, bisected on #18793).
 * They hold the same number today, and ⛔ one constant for both would be a
 * reading neither bisection took: two surfaces measured independently that
 * agree is not one measurement, and the day one moves, a shared constant lies
 * about the other.
 *
 * ⚠️ The two surfaces do not refuse the same WAY, so this class is mostly the
 * comment one. On `PATCH /issues/{n}` the refusal is SILENT — 200, the old body
 * kept, nothing reported (#18793) — and that is what `EXIT_NOT_STORED` exists
 * for; a `--body` refresh over the cap still lands in 4, and only a 422 the
 * platform actually answers reaches 5. Both surfaces carry a cap here anyway,
 * because the classifier must name the cap of whatever surface it is standing
 * on rather than the one it was written for.
 *
 * ⭐ And a refusal the cap does NOT explain is reported as exactly that. If the
 * platform refuses a body at or under the measured cap, the text says the
 * refusal CONTRADICTS the reading and asks for a re-measurement instead of
 * printing an overage of zero: the cap is a measurement, and a measurement a
 * live write disagrees with is the reading that is due to move, never the write.
 *
 * The register in full, one of which a caller reads:
 *
 *   0  written, and everything sent is on the platform.
 *   1  usage — a flag or target this tool does not take. Nothing written.
 *   2  the body broke the stamp contract, or a refresh would have voided an
 *      unread knock. Nothing written.
 *   3  PREREQUISITE NOT MET — no route, no token. No act at all.
 *   4  written, and the platform did NOT store it. Go read the artefact.
 *   5  the platform ANSWERED and refused the body for its SIZE. Nothing
 *      written; shorten or split it. ⛔ Not a route problem.
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
  CLAIM_COMMENT_MARKER,
  COMMENT_BODY_LIMIT,
  EXIT_PREREQUISITE_NOT_MET,
  H56_STAMP_TOLERANCE_MIN,
  ISSUE_BODY_LIMIT,
  PROXY_FLAG,
  claimSeatNumber,
  h56EstimatedStamp,
  h56StampedReadings,
  markerMatches,
  protocolStamps,
  proxyRearmPlan,
  resolveSweepRepo,
  stampDriftMinutes,
  stampSpan,
  threadReadField,
} from './check-half-states.mjs';
import { readClause2Line } from './clause2-line.mjs';
import { isWriteMethod, noteResponse, paceWrite } from './write-pace.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_REFUSED = 2;
// 3 is EXIT_PREREQUISITE_NOT_MET, imported above: no route, no act at all.
/**
 * The write happened and the platform did NOT store what this act sent — the
 * read-back caught it and the caller must not walk on. Its own value because
 * the four outcomes tell a caller four different things to do: 1 fix the
 * command line, 2 fix the body, 3 fix the route, 4 go READ the artefact. See
 * the header's exit-register section for what a caller does with this one, and
 * for why a retry is the wrong move.
 */
export const EXIT_NOT_STORED = 4;

/**
 * The platform ANSWERED this write and refused it: the body is over the cap for
 * the surface it was sent to. Its own value because it is the one outcome the
 * other four cannot carry — nothing was written (so it is not 0 or 4) and the
 * body broke no contract of this tool's (so it is not 2), but a route existed
 * and was used (so it is not 3, whose remedy would send a caller to another
 * route to be refused identically). See the header's size-refusal section for
 * the trigger, and for why the cap in the text is never the platform's own
 * number.
 */
export const EXIT_TOO_LARGE = 5;

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

// ---------------------------------------------------------------------------
// The quoting spelling — Markdown's own "this is text, not instructions".
// The header's quotable-contract section is the authority on why this is a
// STRUCTURAL rule and not a third token.
// ---------------------------------------------------------------------------

/** The two constructs a quoted span can be, in the words a reader would use. */
export const QUOTED_SPAN_KINDS = Object.freeze({
  fenced: 'a fenced code block',
  'code-span': 'a backtick code span',
});

/**
 * A blockquote prefix, as CommonMark reads one: any number of `>` markers, each
 * allowed up to three leading spaces and one trailing space. Returned as the
 * DEPTH and the line that is left, because a fenced block inside a quote ends
 * when the quote does — and a seat quoting a tool's output inside a blockquote
 * is the exact shape the filed instance was written in.
 */
function blockquotePrefix(line) {
  let i = 0;
  let depth = 0;
  for (;;) {
    let j = i;
    let spaces = 0;
    while (j < line.length && line[j] === ' ' && spaces < 3) {
      j += 1;
      spaces += 1;
    }
    if (line[j] !== '>') break;
    j += 1;
    if (line[j] === ' ') j += 1;
    depth += 1;
    i = j;
  }
  return { depth, rest: line.slice(i) };
}

/**
 * The fence this line opens, or null. A backtick fence's info string may not
 * carry a backtick (CommonMark's rule, and the one that keeps `` `a` `` on a
 * line of prose from reading as a fence); a tilde fence's may.
 */
function fenceOpenedBy(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!m) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { char: m[1][0], length: m[1].length };
}

/** Whether this line is a closing fence for `open` — same character, at least as long, nothing else on it. */
function fenceClosedBy(line, open) {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
  return m !== null && m[1][0] === open.char && m[1].length >= open.length;
}

/**
 * Every backtick code span on one line, as offsets into the whole body.
 *
 * A run of N backticks opens; the span ends at the next run of EXACTLY N. A run
 * of a different length is content and is stepped over, and a run with no
 * matching closer is literal backticks — so `` don't use `foo `` is prose, not
 * an unterminated quotation swallowing the rest of the artefact.
 */
function codeSpansOnLine(line, base) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    let n = 0;
    while (i + n < line.length && line[i + n] === '`') n += 1;
    let j = i + n;
    let found = -1;
    while (j < line.length) {
      if (line[j] !== '`') {
        j += 1;
        continue;
      }
      let m = 0;
      while (j + m < line.length && line[j + m] === '`') m += 1;
      if (m === n) {
        found = j;
        break;
      }
      j += m;
    }
    if (found === -1) {
      i += n;
      continue;
    }
    out.push({ from: base + i, to: base + found + n, kind: 'code-span' });
    i = found + n;
  }
  return out;
}

/**
 * Every quoted span in this body, in order and non-overlapping: the ranges
 * inside which this tool renders text and reads no token at all.
 *
 * Fenced blocks are resolved first, at the line level, because Markdown parses
 * block structure before inline structure — so a backtick run inside a fence is
 * fence CONTENT and never opens a span of its own.
 */
export function quotedSpans(text) {
  const raw = String(text ?? '');
  const lines = raw.split('\n');
  const fenced = [];
  const fencedLines = new Set();
  let open = null;
  let offset = 0;

  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    const lineFrom = offset;
    const lineTo = offset + line.length;
    offset = lineTo + 1;
    const { depth, rest } = blockquotePrefix(line);

    if (open) {
      if (depth < open.depth) {
        // The blockquote holding the fence ended, so the block ended with it.
        fenced.push({ from: open.from, to: lineFrom, kind: 'fenced' });
        open = null;
      } else {
        fencedLines.add(n);
        if (fenceClosedBy(rest, open)) {
          fenced.push({ from: open.from, to: lineTo, kind: 'fenced' });
          open = null;
        }
        continue;
      }
    }

    const opened = fenceOpenedBy(rest);
    if (opened) {
      open = { ...opened, depth, from: lineFrom };
      fencedLines.add(n);
    }
  }
  if (open) fenced.push({ from: open.from, to: raw.length, kind: 'fenced' });

  const spans = [...fenced];
  offset = 0;
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    const lineFrom = offset;
    offset = lineFrom + line.length + 1;
    if (fencedLines.has(n)) continue;
    spans.push(...codeSpansOnLine(line, lineFrom));
  }
  return spans.sort((a, b) => a.from - b.from);
}

/**
 * Whether the character at `at` is inside one of `spans`.
 *
 * An opener is judged by WHERE IT STARTS — a `{{` that begins inside a
 * quotation is quoted, whatever happens to fall after it. One position, one
 * answer, so the scan, the mask and the substitution cannot come to disagree
 * about the same brace.
 */
export function insideQuotedSpan(spans, at) {
  return (spans ?? []).some((s) => at >= s.from && at < s.to);
}

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
 *
 * An opener inside a QUOTED SPAN is skipped: there it is text the author is
 * showing, and refusing it is how the contract became unquotable. It is still
 * counted — `substituteTokens` reports it as verbatim — so a skip is never
 * silent.
 */
export function unrecognisedOpeners(text, spans = quotedSpans(text)) {
  const raw = String(text ?? '');
  const quotedHere = anchoredOf(QUOTED_TOKEN_RE);
  const anyHere = anchoredOf(ANY_TOKEN_RE);
  const out = [];
  let i = 0;
  for (;;) {
    const at = raw.indexOf(TOKEN_OPENER, i);
    if (at === -1) return out;
    const rest = raw.slice(at);

    if (insideQuotedSpan(spans, at)) {
      i = at + TOKEN_OPENER.length;
      continue;
    }

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
 *
 * ⛔ A `{{WAS:…}}` inside a QUOTED SPAN is NOT blanked: there it is not a
 * declaration, it is text showing what a declaration looks like, and the digits
 * it carries are digits on the board like any others. Blanking them would let a
 * hand-typed stamp hide from the bare-stamp scan behind a pair of backticks —
 * the one accident this rule may never buy.
 */
export function maskQuotedStamps(text, spans = quotedSpans(text)) {
  return String(text ?? '').replace(globalOf(QUOTED_TOKEN_RE), (m, _inner, at) =>
    insideQuotedSpan(spans, at) ? m : ' '.repeat(m.length),
  );
}

/**
 * The values inside every `{{WAS:…}}` in this text that is a TOKEN — so the
 * ones inside a quoted span are left out, because the calendar and direction
 * rules judge a declaration and there is none there.
 */
export function quotedStampValues(text, spans = quotedSpans(text)) {
  const re = globalOf(QUOTED_TOKEN_RE);
  const out = [];
  let m;
  while ((m = re.exec(String(text ?? '')))) {
    if (!insideQuotedSpan(spans, m.index)) out.push(m[1]);
  }
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
 * Whether a declared reading names an instant inside the MINUTE this act's own
 * clock spells — the bytes `{{NOW}}` would have written at that position, at
 * either grain.
 *
 * ⛔ An equality against the rendered minute is not this question: a seconds
 * grain of the same minute is the same reading, spelled narrower, and the
 * read-side patrol — which widens a stamp to its own grain before it measures
 * anything — files nothing on it. Refusing it would be this tool refusing what
 * the patrol calls clean, which is the one disagreement between them that may
 * never open. ⛔ And it is the MINUTE, never `H56_STAMP_TOLERANCE_MIN`: that
 * number is a backward gap on the read side, and spending it here would buy
 * back the typed stamp this file exists to make unspellable.
 */
function readingIsThisMinute(stamp, nowMs) {
  const span = stampSpan(String(stamp ?? '').trim());
  if (span === null) return false;
  const minute = Math.floor(nowMs / 60000) * 60000;
  return span.from >= minute && span.from < minute + 60000;
}

/**
 * The WHOLE remedy tail for an offending stamp whose every occurrence sits
 * inside a quoted span — null when at least one of them does not, and the
 * caller then writes its ordinary remedy.
 *
 * ⛔ A tail, never a clause appended to the ordinary one. Inside a quotation
 * neither spelling is substituted, so a text that prescribes `{{WAS:…}}` THERE
 * and then takes it back in a trailing warning has prescribed a route that
 * cannot work and argued with itself in one breath — which is how a seat that
 * had ALREADY written the declaration inside the quotation read its own remedy
 * back, character for character, and disbelieved the refusal. So the route the
 * remedy names is the one that works: the same declaration, OUTSIDE the
 * quotation.
 *
 * ⛔ And it is not an exemption. The refusal still fires; only the sentence
 * telling the author what to do about it changes, which is the half that was
 * wrong.
 */
function quotedSpanRemedy(raw, spans, stamp, closed = null) {
  const text = String(raw ?? '');
  const hits = [];
  for (let at = text.indexOf(stamp); at !== -1; at = text.indexOf(stamp, at + 1)) hits.push(at);
  if (hits.length === 0 || !hits.every((at) => insideQuotedSpan(spans, at))) return null;
  const declarations = [];
  const re = globalOf(QUOTED_TOKEN_RE);
  let m;
  while ((m = re.exec(text))) {
    if (insideQuotedSpan(spans, m.index)) declarations.push([m.index, m.index + m[0].length]);
  }
  const declared = hits.every((at) => declarations.some(([from, to]) => at >= from && at < to));
  return (
    (declared
      ? `⚠️ The \`{{WAS:${stamp}}}\` you already wrote round it is inside that quotation too. Every `
      : '⚠️ Every ') +
    'occurrence of this stamp sits inside a QUOTED SPAN, where this tool renders text and substitutes ' +
    'nothing' +
    (declared
      ? ' — so what stands there is a PICTURE of a declaration, not one, and re-typing it changes nothing. '
      : ' — so writing either spelling there prints the token itself, not a time. ') +
    'The route that works is the same declaration OUTSIDE the quotation' +
    (closed ? `, once the value is one the quoted route takes at all: ${closed}` : ` — \`{{WAS:${stamp}}}\` in the prose beside it`) +
    '; or, if the quotation is an EXAMPLE, quote the placeholder form (`YYYY-MM-DDThh:mmZ`) instead of ' +
    'digits. Quoting changes what is rendered, never what was typed onto the board.'
  );
}

/**
 * Every reason this body may not be posted, in the order a reader should fix
 * them. An empty array is a body that may be written.
 *
 * `nowMs` is the clock the WRITING act holds — the same one `renderBody`
 * substitutes, passed through so the direction check judges against the instant
 * this body is being written at, never a second read taken later.
 */
export function stampRefusals(text, nowMs = Date.now(), spans = quotedSpans(text)) {
  const raw = String(text ?? '');
  const masked = maskQuotedStamps(raw, spans);
  const refusals = [];
  const now = stampNow(nowMs);

  const refusedValues = new Set();
  // ⛔ The payload AND every stamp inside it. The declared walk below reads the
  // RENDERED body, where a payload the shape rule refused stands as its own text,
  // so what it has to decline is the DIGITS a reader would see at that position —
  // the payload's whole spelling never reaches one.
  const noteRefusedValue = (value) => {
    refusedValues.add(String(value).trim());
    for (const inside of protocolStamps(value)) refusedValues.add(inside);
  };
  for (const value of quotedStampValues(raw, spans)) {
    if (protocolStamps(value).length !== 1 || protocolStamps(value)[0] !== value.trim()) {
      noteRefusedValue(value);
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
      noteRefusedValue(value);
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
    noteRefusedValue(value);
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

  // Everything above judges what a DECLARATION may SAY, and the VALUES it
  // refused are kept so the declared walk below declines a second row about a
  // value that already has one — one typo, one refusal. ⛔ Per value, never
  // body-wide: a count would let one mistyped declaration anywhere suppress the
  // row for a real declared reading at a position, so the caller repairs the
  // typo and is refused a second time by a rule that was silent the first.
  const positional = h56StampedReadings(masked);
  // ⛔ A MULTISET, not a set. Its credits exist only so the declared walk
  // declines a position the bare scan already took; keyed on position-name plus
  // stamp, a set also collapses two subscript lines carrying the SAME stamp into
  // one row, and the second line then reaches the board unnamed.
  const positionsTaken = new Map();
  const takeCredit = (key) => {
    const left = positionsTaken.get(key) ?? 0;
    if (left === 0) return false;
    positionsTaken.set(key, left - 1);
    return true;
  };
  for (const hit of positional) {
    const key = `${hit.where} :: ${hit.stamp}`;
    positionsTaken.set(key, (positionsTaken.get(key) ?? 0) + 1);
    const opener =
      `${hit.where} carries the bare stamp \`${hit.stamp}\`. That position belongs to the writing ` +
      'act, so a stamp typed there is the act\'s own time written from memory — the defect this tool ' +
      'exists to make unspellable. ';
    const closed = quotedRouteClosed(hit.stamp, nowMs);
    const quoted = quotedSpanRemedy(raw, spans, hit.stamp, closed);
    refusals.push({
      kind: 'positional',
      detail: quoted
        ? `${opener}Write \`${STAMP_TOKEN}\` there. ${quoted}`
        : closed
          ? `${opener}Write \`${STAMP_TOKEN}\` there. The quoted route is NOT open to this one: ${closed}.`
          : `${opener}Write \`${STAMP_TOKEN}\` there. A stamp that is genuinely a reading of something ` +
            'else does not belong at that position at all: move it into the BODY and declare it there ' +
            `with \`{{WAS:${hit.stamp}}}\`.`,
    });
  }

  // ⛔ The other half of the same position, and the reason this judges the
  // RENDERED body: a declaration is spent at render time, so a `{{WAS:…}}`
  // standing at one of these two positions lands as bare digits the patrol
  // reads as this act's own clock. The reader is H56's, run over the body
  // `substituteTokens` will actually send — never a second idea of what a
  // position is. The header section names the two shapes left alone, and why.
  for (const hit of h56StampedReadings(substituteTokens(raw, now, spans).body)) {
    if (refusedValues.has(hit.stamp) || readingIsThisMinute(hit.stamp, nowMs)) continue;
    if (takeCredit(`${hit.where} :: ${hit.stamp}`)) continue;
    refusals.push({
      kind: 'positional-declared',
      detail:
        `${hit.where} carries the declared reading \`{{WAS:${hit.stamp}}}\`, which renders THERE as ` +
        `the bare stamp \`${hit.stamp}\` — the quoted route writes the payload and nothing else, so ` +
        'the declaration is spent and no reader of the board can recover it. That position belongs to ' +
        'the writing act, so the read-side patrol reads those digits as this act\'s own clock and files ' +
        `them against the instant the platform stored this artefact. Write \`${STAMP_TOKEN}\` there, ` +
        'and move the quoted reading into the BODY, where a stamp is prose: the declaration is spent ' +
        'wherever it sits, and only these two positions turn what is left of it into a claim about ' +
        'this act\'s own clock.',
    });
  }

  if (raw.includes(STAMP_TOKEN)) {
    const seen = new Set(positional.map((hit) => hit.stamp));
    for (const stamp of protocolStamps(masked)) {
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      const closed = quotedRouteClosed(stamp, nowMs);
      const quoted = quotedSpanRemedy(raw, spans, stamp, closed);
      const opener = quoted
        ? `this body uses \`${STAMP_TOKEN}\` and also carries the stamp \`${stamp}\`. The clock this act ` +
          'read and a time it did not stand on one board, and a quotation does not take the second out ' +
          'of the contract. '
        : `this body uses \`${STAMP_TOKEN}\` and also carries the bare stamp \`${stamp}\`. One of the ` +
          'two clocks was read by this act and the other was typed; a reader cannot tell which. ';
      refusals.push({
        kind: 'mixed',
        detail: quoted
          ? `${opener}${quoted}`
          : closed
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
 * The body as it goes to the platform, and the counts a reader compares to
 * intent: tokens SUBSTITUTED with this act's clock, quoted stamps RENDERED from
 * their declaration, and openers left VERBATIM because they sit inside a quoted
 * span.
 *
 * One left-to-right walk rather than two regex sweeps, so every brace in the
 * body is judged against the same span map that `unrecognisedOpeners` and
 * `maskQuotedStamps` were given — three passes disagreeing about which `{{` is
 * quoted would be three spellings of one decision.
 *
 * ⛔ `verbatimTokens` is a SUBSET of `verbatim`, and the two are never the same
 * question. `verbatim` is the status line's number: every opener left as
 * written, a quoted `{{ handlebars }}` example included. `verbatimTokens`
 * counts only the openers that ARE `{{NOW}}` or `{{WAS:…}}` — the ones whose
 * literal text on the board makes a claim about a stamp — and it is what
 * `stampVerdict` reads. A body quoting braces that spell neither token has
 * quoted no stamp, and refusing it would be a refusal naming a token it does
 * not carry. `verbatimTokenSpans` carries those same openers with the span kind
 * that holds each one, because the refusal has to NAME the one it means.
 */
export function substituteTokens(raw, stamp, spans = quotedSpans(raw)) {
  const text = String(raw ?? '');
  const quotedHere = anchoredOf(QUOTED_TOKEN_RE);
  const verbatimTokenSpans = [];
  let out = '';
  let i = 0;
  let substituted = 0;
  let quoted = 0;
  let verbatim = 0;
  // BYTES, the unit every offset this file prints is counted in — a character
  // index would move the number a reader checks against `Buffer.byteLength`.
  const byteAt = (at) => Buffer.byteLength(text.slice(0, at), 'utf8');
  const spanKindAt = (at) => (spans ?? []).find((s) => at >= s.from && at < s.to)?.kind ?? null;
  for (;;) {
    const at = text.indexOf(TOKEN_OPENER, i);
    if (at === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    const rest = text.slice(at);
    const isQuoted = insideQuotedSpan(spans, at);
    if (rest.startsWith(STAMP_TOKEN)) {
      if (isQuoted) {
        verbatim += 1;
        verbatimTokenSpans.push({ span: STAMP_TOKEN, kind: spanKindAt(at), byteAt: byteAt(at) });
        out += STAMP_TOKEN;
      } else {
        substituted += 1;
        out += stamp;
      }
      i = at + STAMP_TOKEN.length;
      continue;
    }
    const was = quotedHere.exec(rest);
    if (was) {
      if (isQuoted) {
        verbatim += 1;
        verbatimTokenSpans.push({ span: was[0], kind: spanKindAt(at), byteAt: byteAt(at) });
        out += was[0];
      } else {
        quoted += 1;
        out += was[1];
      }
      i = at + was[0].length;
      continue;
    }
    // Not a token at all. Outside a quoted span `unrecognisedOpeners` has
    // already refused the body, so this branch only ever runs inside one —
    // where the braces are text and are counted as left-as-written. ⛔ NOT
    // collected as a verbatim TOKEN: it spells neither spelling, so it makes no
    // claim about a stamp and the predicate below must not read it as one.
    if (isQuoted) verbatim += 1;
    out += TOKEN_OPENER;
    i = at + TOKEN_OPENER.length;
  }
  return { body: out, substituted, quoted, verbatim, verbatimTokens: verbatimTokenSpans.length, verbatimTokenSpans };
}

/**
 * What the render PROVED about this artefact's stamp — the predicate the quoted
 * span carve-out was missing (#19091), and the one place that decides it.
 *
 * ⛔ The counts are read through here and ⛔ never straight: "0 substitutions
 * AND ≥1 verbatim opener" is the criterion the filing card excludes by name,
 * because a body may quote the token and stamp itself by declaration in the
 * same breath — this file's own header does. The header's partner-check section
 * is the authority on why each verdict is the one it is, and on why `no-token`
 * is not refused.
 */
export const STAMP_VERDICTS = Object.freeze({
  'stamped-by-this-act': "a `{{NOW}}` was substituted, so the artefact carries the clock THIS act read",
  'stamped-by-declaration':
    'nothing was substituted and a `{{WAS:…}}` rendered from its own declaration, so the artefact is stamped as a reading of something else',
  'unstamped-quoted-token':
    'nothing stamped this artefact, and an opener that IS one of the two spellings was left verbatim inside a quotation — the literal token would go onto the board with no time behind it',
  'no-token': 'the body spells no token at all, quoted or not, so there is no clock of this act\'s to check',
});

/**
 * The one verdict that must not reach the board. Named so the refusal, the
 * read-back line and the self-test read one constant rather than three copies
 * of a string.
 */
export const REFUSED_STAMP_VERDICT = 'unstamped-quoted-token';

/**
 * Which of `STAMP_VERDICTS` this render is, from the counts alone.
 *
 * The order is the precedence: this act's own clock outranks a declaration
 * (a body carrying both IS stamped by this act), a declaration outranks a
 * quoted token (the docblock shape), and a quoted token outranks nothing at all
 * — which is the whole finding, because those two used to be one outcome.
 */
export function stampVerdict({ substituted = 0, quoted = 0, verbatimTokens = 0 } = {}) {
  if (substituted > 0) return 'stamped-by-this-act';
  if (quoted > 0) return 'stamped-by-declaration';
  if (verbatimTokens > 0) return REFUSED_STAMP_VERDICT;
  return 'no-token';
}

/**
 * The refusal a caller reads when the only token in the body is a quoted one —
 * the same register as the unrecognised-opener refusal, because it is the same
 * two facts: the literal text goes on the card and the artefact is unstamped.
 *
 * It names the quoted opener (every one of them, with the construct that holds
 * it and the byte it starts at) AND the missing stamp (the counts, so a reader
 * sees that nothing was substituted and nothing declared).
 */
export function unstampedRefusalText({ substituted = 0, quoted = 0, verbatim = 0, verbatimTokenSpans = [] } = {}) {
  const rows = (verbatimTokenSpans ?? []).map(
    (s, i) =>
      `  ${i + 1}. \`${offendingSpan(s.span)}\` — left exactly as written inside ` +
      `${QUOTED_SPAN_KINDS[s.kind] ?? 'a quoted span'}, starting at byte ${s.byteAt}`,
  );
  return (
    `post-stamped: REFUSED — every token in this body sits inside a QUOTED SPAN and nothing stamped the\n` +
    `  artefact: ${substitutionSummary({ substituted, quoted, verbatim })}. Nothing was written.\n` +
    `${rows.join('\n')}\n\n` +
    '  Posting it would put the literal token text on the card AND leave the artefact unstamped, which is\n' +
    '  the quiet direction — the same two facts the unrecognised-opener refusal names, reached here by\n' +
    '  spelling the token CORRECTLY. Quoting changes what is RENDERED, never whether a stamp was read: an\n' +
    '  opener inside a quotation is text, so it is neither this act\'s clock nor a declaration of another\n' +
    '  reading.\n' +
    `  Keep the quotation AND stamp the artefact: write \`${STAMP_TOKEN}\` OUTSIDE the quotation where this\n` +
    '  act\'s own time goes, or `{{WAS:YYYY-MM-DDThh:mmZ}}` outside it when the instant is a reading of\n' +
    '  something else. A body that quotes the token beside such a declaration is ACCEPTED — that is this\n' +
    '  tool\'s own header — and a body that spells no token at all is not this refusal.'
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
  // ONE span map, read by the opener scan, the mask, the quoted-stamp
  // validation and the substitution. Computed here rather than four times
  // below so no two of them can come to disagree about which `{{` is quoted.
  const spans = quotedSpans(raw);

  // ⛔ Ahead of `stampRefusals`, and not folded into it. Its bare-stamp scan
  // reads `maskQuotedStamps`, which is built out of the very regex an
  // unrecognised opener defeats — so until every opener is a token, what that
  // scan calls "a bare stamp in the opening line" may be the inside of a token
  // nobody could parse. One opener, one refusal: the shape first, alone.
  const openers = unrecognisedOpeners(raw, spans);
  if (openers.length > 0) {
    return { ok: false, kind: 'unknown-token', openers, error: unrecognisedOpenerText(openers) };
  }

  const refusals = stampRefusals(raw, nowMs, spans);
  if (refusals.length > 0) return { ok: false, kind: 'stamp-contract', refusals, error: refusalText(refusals) };

  const stamp = stampNow(nowMs);

  // ⛔ No second leftover scan here. The one that used to sit at this line
  // matched `{{…}}` AFTER substitution, which is both too late and too narrow:
  // too late because an opener that never closes is not a leftover of anything,
  // and too narrow because its payload class excluded the braces the filed
  // artefact's payload carried. `unrecognisedOpeners` above walks every opener
  // instead, and the two stamps substituted here carry no braces — so a second
  // check at this line could never fire, and a check that cannot fire is a
  // check nobody maintains.
  const counts = substituteTokens(raw, stamp, spans);
  const { body, substituted, quoted, verbatim, verbatimTokens, verbatimTokenSpans } = counts;

  // ⛔ The partner check the quoted-span carve-out shipped without, and the LAST
  // refusal on purpose: the refusal ordering above is unchanged (positional /
  // mixed / quoted / unknown first), and this one needs the counts, which exist
  // only after the walk. A body that reaches here broke no other rule — its
  // only fault is that nothing stamped it while a token went onto the board.
  const verdict = stampVerdict(counts);
  if (verdict === REFUSED_STAMP_VERDICT) {
    return {
      ok: false,
      kind: 'unstamped',
      verdict,
      substituted,
      quoted,
      verbatim,
      verbatimTokens,
      verbatimTokenSpans,
      error: unstampedRefusalText(counts),
    };
  }
  return { ok: true, body, stamp, substituted, quoted, verbatim, verbatimTokens, verbatimTokenSpans, verdict };
}

/**
 * The three counts, in one spelling, so the DRY RUN line, the status line and
 * `--json` cannot come to describe the same render three ways.
 *
 * The VERBATIM count is the half this file was missing: before it, a body that
 * quoted the token and one that used it were distinguishable only by a
 * substitution count nothing compared to intent — which is exactly how a false
 * quotation reached #14251 at exit 0. An author who meant "stamp one, quote
 * one" now reads both numbers and sees at a glance which happened.
 */
export function substitutionSummary({ substituted = 0, quoted = 0, verbatim = 0 } = {}) {
  return (
    `${substituted} ${STAMP_TOKEN}, ${quoted} quoted` +
    ` · verbatim: ${verbatim} opener(s) inside a quoted span, left exactly as written` +
    (verbatim === 0 ? ' (none)' : '')
  );
}

// ---------------------------------------------------------------------------
// The claim's keyed lines — refused before the write (#19152)
// ---------------------------------------------------------------------------

/** What each owning reader accepts, printed BY the refusal so the fix is one line away. */
export const CLAIM_KEY_SPELLINGS = Object.freeze({
  Seat: '`Seat: domain:LANE#N` at the START of a line, lane and number both — e.g. `Seat: domain:skills#2`',
  'Thread-read': '`Thread-read: ID` at the START of a line — ONE comment id, or `none`, and nothing after it',
  'Clause-②': '`Clause-②: yes` or `Clause-②: no` at the START of a line — reasoning after the value is fine, a quotation around it is not',
});

/** PRESENCE only, `CLAIM_SEAT_DECLARATION_ANYWHERE`'s calibration one key along: case-SENSITIVE and demanding the whole
 *  payload, because off the line start no position tells a declaration from prose. Consulted solely when `threadReadField` saw none. */
const THREAD_READ_DECLARATION_ANYWHERE = /(?:\*\*)?`?Thread-read`?(?:\*\*)?[ \t]*:[ \t]*`?(?:[1-9]\d*|none)\b/;

/** The ONLY values H50's equality can ever accept: `commentIdText`'s id pattern, and the `none` it answers for a claim that
 *  opened the thread. Neither is exported from `check-half-states.mjs`, so the self-test pins this spelling against its source. */
const THREAD_READ_VALUE = /^(?:[1-9]\d*|none)$/;

/** The first line naming a key — a LOCATOR for the writer's eye, ⛔ never the judgement. */
function keyLine(text, key) {
  const hit = text.split(/\r?\n/).find((line) => line.includes(key));
  return hit === undefined ? '(no single line carries the key)' : offendingSpan(hit.trim(), 160);
}

/**
 * The keyed-line problems in a body about to be written, judged by the readers that OWN each key — ⛔ never by a rule
 * spelled here. Four decisions:
 *   IMPORTED     `claimSeatNumber` answers `null` exactly for a `Seat:` line it cannot read; `readClause2Line` answers
 *                `declared` for the shape its own control case calls correct, `Clause-②: yes — reasoning` included, so
 *                ⛔ nothing is tightened here. `Thread-read:` alone exports a FIELD and not a verdict, H50's other half
 *                being the thread this act has not fetched; what IS decidable is that a value which is neither an id
 *                nor `none` can never equal the id H50 compares it against.
 *   SCOPED       the fleet's own claim marker, ⛔ not a first-line rule — `newestLaneClaim`'s header refuses that
 *                narrowing by name — and `--comment` alone, since a claim IS a comment and a seat POST's body carries
 *                a `Seat:` line no claim reader judges.
 *   QUOTE-BLIND  all three owners read raw text, so masking a quotation here would store exactly the row the patrol
 *                then files: quoting changes what is RENDERED, never what was AUTHORED.
 *   FIRST MATCH  each reader stops at its first readable declaration — that is what a duplicate key gets.
 * @param {string} body — the bytes this act is about to send.
 * @returns {{ key: string, why: string, line: string }[]} — empty when the body is not a claim, or when every key reads.
 */
export function claimKeyedLineRefusals(body) {
  const text = String(body ?? '');
  if (!markerMatches(CLAIM_COMMENT_MARKER, text)) return [];
  const rows = [];
  if (claimSeatNumber(text) === null)
    rows.push({ key: 'Seat', line: keyLine(text, 'Seat'), why: '`claimSeatNumber` reads `null` here — the declaration is present and names no seat. The claim lands on NO seat, and H38 rows another seat\'s post over it.' });
  const thread = threadReadField(text);
  if (!thread.present && THREAD_READ_DECLARATION_ANYWHERE.test(text))
    rows.push({ key: 'Thread-read', line: keyLine(text, 'Thread-read'), why: '`threadReadField` sees NO line: the key is off the line start, so H50 reads this claim as carrying no `Thread-read:` at all.' });
  else if (thread.present && !THREAD_READ_VALUE.test(thread.value))
    rows.push({ key: 'Thread-read', line: keyLine(text, 'Thread-read'), why: `the value reads \`${offendingSpan(thread.value)}\`, which is neither one comment id nor \`none\` — H50 compares it for EQUALITY against one id, so no thread makes this match.` });
  const clause = readClause2Line(text);
  if (clause !== null && clause.kind !== 'declared')
    rows.push({ key: 'Clause-②', line: clause.line, why: clause.kind === 'malformed' ? 'the value slot holds something `readClause2Line` cannot grade — the two spellings are the closed set.' : `\`readClause2Line\` reads this as a NEAR MISS (${clause.reason}), ⛔ not a declaration — \`check-clause2-carriers.mjs --pair\` answers exit 4 on it.` });
  return rows;
}

/** The refusal a caller reads, from `claimKeyedLineRefusals`' rows. */
export function keyedLineRefusalText(rows) {
  return (
    `post-stamped: REFUSED — ${rows.length} keyed line(s) in this \`Claim:\` cannot be read by the checker that owns them. Nothing was written.\n` +
    rows.map((r, i) => `  ${i + 1}. [${r.key}] ${r.why}\n      line:  ${r.line}\n      write: ${CLAIM_KEY_SPELLINGS[r.key]}`).join('\n') +
    '\n\n  `claimSeatNumber` and `h50ThreadReadMismatch` (`check-half-states.mjs`) and `readClause2Line` (`clause2-line.mjs`)\n' +
    '  are imported HERE, so this IS the row they would file — hours earlier, and on your own claim rather than on someone\n' +
    '  else\'s post. ⛔ No flag turns it off: a line those readers cannot read is a half-state, not a formatting preference.'
  );
}

/**
 * The block the platform appends to an artefact whose sent body does not
 * already carry one: a blank line, a rule, the bare attribution line — 58
 * bytes, measured on every comment this seat's tooling posted through the REST
 * proxy, the same 58 the register records for both comment channels, and the
 * same 58 an ISSUE BODY comes back with on this seat's channel (#18693).
 *
 * ⛔ The name says COMMENT because that is the surface the block was first
 * measured on and the surface the register calls it by, ⛔ never because the
 * body cell is exempt from it: the bytes are one constant and the read-back
 * asks one question of them.
 *
 * ⛔ The exact bytes, ⛔ never a regex and ⛔ never a trim. What a read-back
 * asks is whether the difference is EXACTLY a normalisation somebody measured;
 * a pattern that matches "a footer, roughly" also forgives a footer the
 * sanitizer has chewed, which is the one mutation this verdict exists to make
 * legible.
 */
export const PLATFORM_COMMENT_FOOTER = '\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_';

/**
 * The same block over ONE newline instead of two — what the platform stores
 * when it collapses the blank line before the rule of a footer the body
 * already carried. ⛔ Derived from the constant above, ⛔ never retyped: two
 * spellings of one block are two things to keep in step.
 */
export const PLATFORM_COMMENT_FOOTER_COLLAPSED = PLATFORM_COMMENT_FOOTER.slice(1);

/**
 * The vocabulary of what a stored body can show, and what each word means.
 * Declared so the line, the `--json` field and the self-test spell one set of
 * names rather than three.
 */
export const READ_BACK_CLASSES = Object.freeze({
  unreadable: 'the platform returned no readable body — the write is UNVERIFIED',
  identical: 'the bytes came back exactly as they went out',
  'trailing-newline-stripped': 'the stored body is the sent body minus its trailing newline(s)',
  'footer-appended': "the stored body is that body plus exactly the platform's footer block",
  'footer-re-anchored':
    "the stored body is that body with the trailing newline(s) it sent moved to before the footer block's rule — nothing added, nothing lost",
  'footer-blank-collapsed':
    "the stored body is that body with the blank line immediately before the footer block's rule collapsed, over any trailing newline(s) the platform does not keep — one newline of the block's own separator gone, and no content byte touched",
  mutated: 'something nobody measured — the bytes disagree, and the offset says where',
});

// Which declared class each `footerReAnchoring` shape becomes — one map, so a
// shape never reaches a reader under a word untrue of its bytes:
// `footer-re-anchored` says "nothing lost" and the collapse loses one.
const FOOTER_SHAPE_CLASSES = Object.freeze({ appended: 'footer-appended', 're-anchored': 'footer-re-anchored', collapsed: 'footer-blank-collapsed' });

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
 * Whether the difference between the sent and the stored body is EXACTLY the
 * platform moving `PLATFORM_COMMENT_FOOTER` around, and which of the TWO
 * measured shapes it is. `null` when it is neither, which is every shape where
 * a byte this act sent is missing or different from the byte stored in its
 * place.
 *
 * The two shapes, each measured in this repository:
 *
 *   appended     the sent body carried NO footer of its own, and the stored
 *                body is it — or its newline-trimmed form — followed by
 *                exactly the footer. The platform synthesised the block.
 *   re-anchored  the sent body ALREADY ENDED in the footer block, with
 *                trailing newline(s) after it, and the stored body is that
 *                same body with those newlines removed and exactly one
 *                newline inserted immediately before the block. The bytes are
 *                the same bytes, a newline moved from after the footer to
 *                before its rule — at one trailing newline, equal length, one
 *                byte MOVED and zero lost.
 *   collapsed    the sent body ENDS in the block — after its own trailing
 *                newline(s), if it sent any — and the stored body is that
 *                same body, those newlines stripped, with the block's leading
 *                blank line collapsed to one newline. The platform really
 *                does take a byte away here, and the byte is its OWN
 *                separator; over a stripped trailing newline it takes that
 *                one too, and THAT pair is the shape a seat post's `--body`
 *                write sends (#19312).
 *
 * ## THE CRITERION — which mutations are the footer's, and which the sanitizer's
 *
 * The footer path is POSITIONAL and touches ONE span: the newline(s) between
 * the last content byte and the block's rule, plus the block itself when the
 * platform synthesises one. Inside that span it appends the block, moves a
 * trailing newline the act sent to the front of it, or collapses the blank
 * line before the rule. It has never been measured adding, removing or
 * substituting a byte anywhere else.
 *
 * The sanitizer's mutations are the other population, and they are what exit 4
 * exists for: a tag-shaped fragment eaten out of the prose, a link rewritten
 * inside the block, a size refusal the platform never reported that leaves the
 * PREVIOUS body stored, a truncation. Those land anywhere in the body.
 *
 * ⛔ So the test is positional and EXACT, ⛔ never normalised: a "non-empty
 * lines" comparison would answer clean for a whitespace-only truncation
 * anywhere in the body, a loss with no line of its own.
 *
 * ⛔ Both arms are one exact `===` against a candidate BUILT from the sent
 * bytes, ⛔ never a pattern and ⛔ never a length: a regex matching "a footer,
 * roughly" forgives a footer the sanitizer has chewed, a 58-byte delta is
 * satisfied by 58 bytes of anything at all, and "equal length" is satisfied by
 * any substitution that swaps one byte for another. Everything before the
 * block and every byte of the block itself is compared literally, so a loss
 * before the rule and a chewed footer both still answer `null`.
 *
 * ⛔ The re-anchor arm requires the sent body to have carried trailing
 * newline(s) of its own: the moved newline is one the act SENT. A stored body
 * that gained a newline from nowhere is a cell nobody has measured, and an
 * unmeasured cell is not one this tool forgives.
 *
 * ONE spelling of "the platform moved its own footer block around", read by
 * ONE caller: `classifyReadBack`, which turns each shape into its own declared
 * class through `FOOTER_SHAPE_CLASSES` — whichever act wrote the bytes.
 * `sentBodyLanded` then reads that class and nothing else.
 * Two places deciding what a footer is would be two spellings of one decision,
 * which is the defect this file spends its length avoiding; until #18693 there
 * were two, because the class gate asked which act had written the bytes while
 * the exit code did not, and the tool said MUTATED and "everything sent is on
 * the platform" about one set of bytes.
 */
export function footerReAnchoring(sent, stored) {
  if (typeof stored !== 'string') return null;
  const sentText = String(sent ?? '');
  if (stored === `${sentText}${PLATFORM_COMMENT_FOOTER}`) return { strippedNewlines: 0, shape: 'appended' };
  const trimmed = sentText.replace(/\n+$/u, '');
  const strippedNewlines = sentText.length - trimmed.length;
  if (strippedNewlines > 0 && stored === `${trimmed}${PLATFORM_COMMENT_FOOTER}`) return { strippedNewlines, shape: 'appended' };
  if (strippedNewlines > 0 && trimmed.endsWith(PLATFORM_COMMENT_FOOTER)) {
    const head = trimmed.slice(0, trimmed.length - PLATFORM_COMMENT_FOOTER.length);
    if (stored === `${head}\n${PLATFORM_COMMENT_FOOTER}`) return { strippedNewlines, shape: 're-anchored' };
  }
  // The collapse reads the TRIMMED body, so ONE arm covers the collapse alone
  // and the collapse OVER the strip — the cell this arm used to refuse as
  // unmeasured, and the shape a seat post's `--body` write actually sends: a
  // file ending in a newline whose last paragraph stands a blank line above the
  // rule, so `\n\n\n---` goes out and the block's own `\n\n---` comes back.
  // Measured 13 times in one shift (#19312), the content whole on a fresh read
  // every one of them. ⛔ The head is still compared literally, so a whitespace
  // truncation in the CONTENT — two newlines sent there, one stored — is still
  // `null` and still exits 4.
  if (trimmed.endsWith(PLATFORM_COMMENT_FOOTER)) {
    const head = trimmed.slice(0, trimmed.length - PLATFORM_COMMENT_FOOTER.length);
    if (stored === `${head}${PLATFORM_COMMENT_FOOTER_COLLAPSED}`) return { strippedNewlines, shape: 'collapsed' };
  }
  return null;
}

/**
 * Whether every byte this act sent is on the platform — the question `$?`
 * answers — read off the verdict's own CLASS and nothing else.
 *
 * Every declared normalisation keeps the sent body's CONTENT whole:
 * `identical` by definition, `trailing-newline-stripped` gives up only
 * newlines the platform does not keep, `footer-appended` adds without
 * removing, `footer-re-anchored` moves a newline the act itself sent, and
 * `footer-blank-collapsed` drops one newline of the platform's own footer
 * separator, over any trailing newline the platform does not keep — the only
 * bytes the footer path has been measured taking, and never a byte of the
 * body. So `mutated` — "something nobody
 * measured" — is the one class that can answer no, and since #18693 ONE
 * measurement decides both what the status line says and what `$?` says.
 * ⛔ `unreadable` answers YES on purpose: nothing was measured there, which is
 * a different verdict carrying a different line, and this rule does not widen
 * into it. The header's exit-register section is the authority on both halves.
 *
 * ⛔ A predicate over the class, ⛔ never over the byte counts: the platform
 * normalises blank lines around a trailing rule in both directions, so "stored
 * is shorter" is neither necessary (a re-anchored footer over two newlines is)
 * nor sufficient (a substitution of equal length loses just as much).
 */
export function sentBodyLanded(readBack) {
  return !readBack || readBack.class !== 'mutated';
}

/**
 * Which of the platform's KNOWN normalisations the stored body shows, judged
 * exactly — the whole vocabulary is `READ_BACK_CLASSES` and the reasoning is
 * the header's read-back section.
 *
 * ⛔ There is no `mode` parameter, and its absence is the point (#18693). The
 * footer rule was comment-only while the issue-body cell was unmeasured, and a
 * caller naming no act got the strict reading. That cell is measured now — on
 * the governed fact table, and live on this channel — and what this function
 * reads is EXACT BYTES, which cannot tell one act's write from another's: a
 * stored body that is the sent one plus exactly the block is `footer-appended`
 * either way, and one that is the sent one with its own trailing newline moved
 * before the block is `footer-re-anchored` either way. An act-shaped gate on
 * top of an exact-bytes comparison was a second spelling of one decision, and
 * it failed in the loud direction: the body cell printed MUTATED on nearly
 * every write a seat made while `$?` said the write had landed whole.
 *
 * ⛔ The gate is gone, ⛔ not the strictness. Everything neither arm of
 * `footerReAnchoring` matches is `mutated` and exits 4 — a footer the sanitizer
 * chewed, a link rewritten inside the block, a newline that came from nowhere,
 * a byte lost before the rule, a truncation that happens to end in the block.
 * The one predicate is asked once, and it is asked about bytes.
 */
export function classifyReadBack({ sent, stored } = {}) {
  if (typeof stored !== 'string') return { class: 'unreadable', offset: null, strippedNewlines: 0 };
  const sentText = String(sent ?? '');
  if (stored === sentText) return { class: 'identical', offset: null, strippedNewlines: 0 };

  const trimmed = sentText.replace(/\n+$/u, '');
  const strippedNewlines = sentText.length - trimmed.length;
  if (strippedNewlines > 0 && stored === trimmed) {
    return { class: 'trailing-newline-stripped', offset: null, strippedNewlines };
  }
  // Each measured shape gets its OWN word, ⛔ never one word for both: a
  // `footer-appended` that also covered the re-anchor would say "plus exactly
  // the footer" about a body that gained nothing, and a vocabulary that says
  // something untrue about the bytes is the thing this file exists to avoid.
  // `footerReAnchored` stays on the result as the measurement it always was,
  // so `--json` keeps reporting it beside the class.
  const footer = footerReAnchoring(sentText, stored);
  if (footer !== null) {
    return {
      class: FOOTER_SHAPE_CLASSES[footer.shape],
      offset: null,
      strippedNewlines: footer.strippedNewlines,
      footerReAnchored: true,
      footerShape: footer.shape,
    };
  }

  // Nothing anybody measured explains this difference, so the whole warning is
  // kept and the offset is what a reader goes and looks at. `footerReAnchored`
  // is false here by construction — the one predicate that could have answered
  // yes was just asked — and `sentBodyLanded` reads the CLASS, not this field.
  const offset = firstDifferingByte(sentText, stored);
  return {
    class: 'mutated',
    offset,
    strippedNewlines: 0,
    footerReAnchored: false,
    footerShape: null,
    sentContext: byteWindowFrom(sentText, offset),
    storedContext: byteWindowFrom(stored, offset),
  };
}

/**
 * What the read-back proves, as lines a transcript carries. `writtenAt` is the
 * platform's own clock for the write — `created_at` for a comment, `updated_at`
 * for a body edit, which is when that write actually happened.
 *
 * ⛔ It does not take the act it is about and does not need to: since #18693
 * the classification is exact bytes alone. The word for the surface survives
 * where it is actually read — `notStoredText` prints "comment" or "body" — and
 * the CLI hands `options.mode` to THAT, never here.
 *
 * ⛔ The no-substitution line reads the VERDICT, never the substitution count
 * alone (#19091). "This body carried no `{{NOW}}`" was printed over three
 * shapes at once and was FALSE of two of them: a body stamped by declaration
 * had a clock its author declared, and a body whose token was quoted carried
 * one on the board. The refusal now closes the third shape before the write, so
 * what reaches here is the first two — and the line says which, and what was
 * quoted. A line that is the only signal a caller gets must be true of every
 * body that can reach it.
 */
export function readBackVerdict({ stamp, writtenAt, sent, stored, substituted = 0, quoted = 0, verbatim = 0, verbatimTokens = 0 }) {
  const lines = [];
  const drift = substituted > 0 ? stampDriftMinutes(stamp, writtenAt, writtenAt) : null;
  const verdict = stampVerdict({ substituted, quoted, verbatimTokens });
  if (substituted === 0 && verdict === 'stamped-by-declaration') {
    lines.push(
      `  stamp: none substituted — nothing here is this act's own clock, so there is no drift to check; the` +
        ` artefact is stamped by DECLARATION (${quoted} \`{{WAS:…}}\` rendered from its own value)` +
        (verbatimTokens > 0 ? `, beside ${verbatimTokens} token(s) quoted as text` : ''),
    );
  } else if (substituted === 0 && verdict === REFUSED_STAMP_VERDICT) {
    // Unreachable through the CLI — `renderBody` refuses this verdict before a
    // write — and printed rather than omitted because this function is exported
    // and pure: a caller that hands it these counts must not be told the body
    // carried no token when it carried one.
    lines.push(
      `  ⚠️ stamp: none substituted, and this body DID carry ${verbatimTokens} token(s) — quoted as text, so` +
        ` nothing stamped the artefact. A body in this state is REFUSED before the write (exit ${EXIT_REFUSED}).`,
    );
  } else if (substituted === 0) {
    lines.push(
      `  stamp: none substituted — this body carried no ${STAMP_TOKEN} and no \`{{WAS:…}}\` anywhere, quoted` +
        ' or not, so there is no clock to check',
    );
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
  const readBack = classifyReadBack({ sent, stored });
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
  } else if (readBack.class === 'footer-re-anchored') {
    lines.push(
      `  read-back: clean — the platform re-anchored its own footer block: the newline this act sent after it` +
        ` moved to before its rule, and every byte sent IS stored (sent ${sentBytes}, stored ${storedBytes})`,
    );
  } else if (readBack.class === 'footer-blank-collapsed') {
    lines.push(
      `  read-back: clean — the platform re-anchored its own footer block: the blank line before its rule was` +
        ` COLLAPSED${readBack.strippedNewlines > 0 ? `, over ${readBack.strippedNewlines} stripped trailing newline(s)` : ''}, so the byte(s)` +
        ` short are that separator newline${readBack.strippedNewlines > 0 ? ' and the newline(s) the platform does not keep' : ''}, and` +
        ` every CONTENT byte sent IS stored (sent ${sentBytes}, stored ${storedBytes})`,
    );
  } else {
    // `mutated` means one thing now, so it says one thing: nobody measured this
    // difference, here is where it starts, and the write did not land. The
    // prescription is back on the only population it was ever for — while the
    // two footer shapes were classed `mutated`, "Read the artefact before
    // trusting it" fired on nearly every write a seat made, which is how a
    // reader learns to scroll past the one line that carries a real loss.
    lines.push(
      `  ⚠️ read-back: sent ${sentBytes} byte(s), stored ${storedBytes} — the platform ` +
        'MUTATED the body. Read the artefact before trusting it: the sanitizer eats tag-shaped fragments.',
    );
    lines.push(`     first difference at byte ${readBack.offset}: sent ${readBack.sentContext} | stored ${readBack.storedContext}`);
    lines.push(`     ⛔ a byte this act sent is NOT the byte stored at that offset — the write did NOT land. Exit ${EXIT_NOT_STORED}.`);
  }
  // The exit code lives ON the verdict so exactly one place decides it: a
  // caller that reads the lines and a caller that reads `$?` cannot come to
  // disagree about the same write.
  const landed = sentBodyLanded(readBack);
  return { lines, drift, mutated: readBack.class === 'mutated', landed, exit: landed ? EXIT_OK : EXIT_NOT_STORED, readBack };
}

/**
 * What a caller is told when the read-back proves the platform did not store
 * what was sent — printed to stderr beside the verdict lines, because the
 * decision it is asking for is "stop and go read", not "look at a warning".
 */
export function notStoredText(verdict, repo, target, mode = 'body') {
  const offset = verdict?.readBack?.offset;
  return (
    `\npost-stamped: NOT STORED — the platform kept something other than the bytes this act sent.\n\n` +
    `  The ${mode === 'comment' ? 'comment' : 'body'} was written to ${repo}#${target} and read back, and the stored bytes differ from the\n` +
    `  sent ones at byte ${offset}, INSIDE the body this act sent. That is not the platform's footer\n` +
    '  handling, which is three measured shapes and nothing else: it appends its block, it moves a\n' +
    '  trailing newline this act sent to before the block\'s rule, or it COLLAPSES the blank line in\n' +
    '  front of that rule. All three touch only the block\'s own separator — the collapse really does\n' +
    '  take one newline away, and a content byte has never been measured going with it. Here one is:\n' +
    '  something this act sent is not there.\n' +
    '  The verdict lines above carry both sides at that offset.\n\n' +
    '  Fix:  READ THE ARTEFACT before writing anything that depends on it having landed.\n' +
    '        ⛔ Do not retry blindly: the one measured hit of this shape was a size refusal the\n' +
    '        platform never reported, so an identical second write reproduces it exactly. Work out\n' +
    '        what is missing from what IS stored, then send a body that can land.\n' +
    `\n  (Exit code ${EXIT_NOT_STORED}, distinct from ${EXIT_REFUSED}'s "the body broke the stamp contract",\n` +
    `  ${EXIT_PREREQUISITE_NOT_MET}'s "no act at all" and ${EXIT_TOO_LARGE}'s "the platform answered and refused it on size" —\n` +
    '  this write HAPPENED. Capture it BEFORE any pipe:\n' +
    '  `node scripts/pm/post-stamped.mjs … > /tmp/p.log 2>&1; echo "EXIT=$?"`.)'
  );
}

// ---------------------------------------------------------------------------
// The size refusal — a 422 the platform ANSWERED, told apart from a route that
// never existed. The header's size-refusal section is the authority on the
// trigger, on why the class is not every 422, and on why the cap this text
// names is never the number the platform's own message carries.
// ---------------------------------------------------------------------------

/**
 * The status a size refusal arrives on, and the only one this class takes.
 * Measured on objectstack#18826 (comment create and comment update) and on
 * `POST /issues` (issue create) in the same run.
 */
export const SIZE_REFUSAL_STATUS = 422;

/**
 * The half of the platform's sentence this class keys on.
 *
 * ⛔ Case-INSENSITIVE because the two measured spellings are not one string:
 * the create side says `Body is too long`, the update side the same sentence
 * with a lower-case `body` (objectstack#18826, captured verbatim on both). An
 * equality pinned to either one leaves the other at exit 3.
 *
 * ⛔ And it stops before the platform's number. `maximum is 65536 characters`
 * is false in unit and value, so keying on it would tie this class to a false
 * clause and un-classify the refusal the day GitHub corrects its own text.
 *
 * ⛔ NOT global, for `PROTOCOL_STAMP_RE`'s reason: a `g`-flagged exported regex
 * carries `lastIndex` between callers.
 */
export const BODY_TOO_LONG_RE = /body is too long/i;

/** How much of the platform's refusal text a report prints. */
export const REFUSAL_TEXT_CHARS = 400;

/**
 * The surfaces this tool writes, each carrying the cap its OWN bisection
 * measured, in the unit the platform refuses in.
 *
 * ⛔ Two constants, never one shared number. They hold the same value today —
 * 256 KiB on both — and that agreement is two independent measurements
 * agreeing, not one measurement: the day the platform moves one, a shared
 * constant would lie about the other.
 *
 * ⚠️ The two do not refuse the same WAY. `POST /issues/{n}/comments` answers a
 * real 422 and writes nothing; `PATCH /issues/{n}` refuses SILENTLY — 200, the
 * old body kept, nothing reported (#18793) — which is `EXIT_NOT_STORED`'s
 * population. A `--body` refresh over the cap therefore still lands in 4. The
 * body surface carries its cap here anyway, because the classifier must name
 * the cap of the surface it is standing on and never one it was written for.
 */
export const WRITE_SURFACES = Object.freeze({
  comment: Object.freeze({
    noun: 'a comment',
    endpoint: 'POST /issues/{n}/comments',
    cap: COMMENT_BODY_LIMIT,
    measuredOn: 'objectstack#18826',
  }),
  body: Object.freeze({
    noun: 'an issue body',
    endpoint: 'PATCH /issues/{n}',
    cap: ISSUE_BODY_LIMIT,
    measuredOn: 'objectstack#18793',
  }),
});

/**
 * The remedy exit 3 prescribes, and the one a size refusal prescribes — each a
 * single constant so the two texts can be pinned HELD APART in both directions.
 * A route remedy inside a size refusal is the whole defect this class closes,
 * and a pin on a retyped sentence goes green the first time either is reworded.
 */
export const ROUTE_REMEDY = "run this where node's fetch reaches api.github.com with a token that can write issues";
export const SIZE_REMEDY = 'SHORTEN the body, or SPLIT it across more than one artefact';

/** A byte count with thousands separators, the way every reading in this fleet is quoted. */
function grouped(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/**
 * What the platform SAID, out of the response body it said it in.
 *
 * GitHub's validation envelope carries a top-level `message` plus a `message`
 * per entry in `errors`, and the sentence this class keys on arrived in an
 * entry (objectstack#18826's record quotes that entry verbatim). Both levels
 * are collected, in that order, so the text is read wherever the platform puts
 * it; a payload that is not that envelope falls back to its own bytes rather
 * than to silence — an unclassified refusal must still be able to say what it
 * was told.
 *
 * ⛔ Never truncated here. The trigger reads this string, and a cut that landed
 * mid-sentence would answer a question about the platform's text with a fact
 * about this function's window. Clipping belongs to the printing.
 */
export function platformRefusalText(raw) {
  const text = String(raw ?? '');
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (payload && typeof payload === 'object') {
    const parts = [];
    if (typeof payload.message === 'string' && payload.message !== '') parts.push(payload.message);
    for (const entry of Array.isArray(payload.errors) ? payload.errors : []) {
      if (entry && typeof entry.message === 'string' && entry.message !== '') parts.push(entry.message);
    }
    if (parts.length > 0) return parts.join(' · ');
  }
  return text.trim();
}

/**
 * The refusal this answer IS, or null — one predicate, so the classification a
 * caller reads and the text it reads cannot come to disagree.
 *
 * `null` means "not this class", which leaves the answer exactly where it was
 * before this class existed: a 422 about anything other than a body's length —
 * the issues listing's deep-pagination refusal is the measured one — keeps its
 * PREREQUISITE reading, and so does every other status.
 *
 * `explained` is the honest half. It is false when the platform refused a body
 * at or under the cap this file declares: that is a refusal the reading does
 * not cover, and the text says so instead of printing an overage of zero. A
 * live write disagreeing with a measurement moves the measurement, never the
 * write.
 */
export function sizeRefusal({ status, refusalText, mode, sentBytes } = {}) {
  if (Number(status) !== SIZE_REFUSAL_STATUS) return null;
  // ⛔ The DECLARED regex, tested directly — never a copy rebuilt from its
  // `.source` with flags retyped here. A rebuilt copy takes the pattern and
  // leaves the flags behind, so the `i` that makes the two measured spellings
  // one class would live in this line and not in the constant that documents
  // it: an ablation dropping the flag from the declaration changed nothing and
  // every case-insensitivity pin stayed green. Safe to test in place because
  // this one is pinned non-global, so it carries no `lastIndex`.
  if (!BODY_TOO_LONG_RE.test(String(refusalText ?? ''))) return null;
  const surface = Object.prototype.hasOwnProperty.call(WRITE_SURFACES, String(mode)) ? WRITE_SURFACES[String(mode)] : null;
  const cap = surface ? surface.cap : null;
  const sent = Number.isFinite(sentBytes) ? Number(sentBytes) : null;
  const explained = cap !== null && sent !== null && sent > cap;
  return {
    status: Number(status),
    mode: String(mode),
    surface,
    cap,
    sentBytes: sent,
    over: explained ? sent - cap : null,
    explained,
    platformText: String(refusalText ?? ''),
  };
}

/**
 * What a caller is told when the platform refused the write for its size.
 *
 * Printed to stderr, in the shape the other two refusals use, and carrying the
 * three things a caller needs and exit 3 could never give it: the bytes this
 * act SENT, the measured cap for the surface it sent them to, and a remedy that
 * can work. The platform's own sentence is quoted — a reader needs to see what
 * the platform said — and named FALSE in the same breath, because that sentence
 * is where the 65,536 folklore comes from.
 */
export function sizeRefusalText(refusal, repo, target) {
  const surface = refusal?.surface ?? null;
  const sent = refusal?.sentBytes;
  const sentClause = Number.isFinite(sent) ? `${grouped(sent)} byte(s)` : 'a body of unrecorded size';
  const head =
    `\npost-stamped: TOO LARGE — the platform ANSWERED this write and REFUSED it: the body is over the cap\n` +
    `for this surface. NOTHING WAS WRITTEN.\n\n` +
    `  Sent to ${repo}#${target}: ${sentClause}` +
    (surface ? ` as ${surface.noun} (\`${surface.endpoint}\`).\n` : '.\n');
  const capLines = surface
    ? `  The measured cap for ${surface.noun} is ${grouped(surface.cap)} bytes — UTF-8 BYTES, bisected on\n` +
      `  ${surface.measuredOn}, one byte either side.\n` +
      (refusal.explained
        ? `  This body is ${grouped(refusal.over)} byte(s) over it.\n`
        : '  ⚠️ …and this body is NOT over it. The platform refused a body the measured cap says stores, so\n' +
          '  that reading is the thing due to move: RE-MEASURE the cap before trusting it again, and report\n' +
          '  the refusal — a cap a live write contradicts is a cap nobody should be quoting.\n')
    : '  ⚠️ This act wrote to a surface with no declared cap, so none is named here. ⛔ A cap invented at\n' +
      '  the moment of a refusal is the folklore this class exists to end.\n';
  return (
    head +
    capLines +
    `\n  The platform said: ${String(refusal?.platformText ?? '').slice(0, REFUSAL_TEXT_CHARS)}\n` +
    '  ⛔ Its number is FALSE in unit and value — the same fleet measured a 262,144-BYTE comment stored,\n' +
    '     four times what that sentence claims as a maximum. The cap above is the bisected one; ⛔ never\n' +
    "     re-derive a cap from a refusal's own text.\n" +
    `\n  Fix:  ${SIZE_REMEDY}.\n` +
    '        ⛔ This is NOT a transport problem and there is nothing to fix about the route: the write\n' +
    '        reached the platform, was read and was refused, so the same bytes through another route with\n' +
    '        another token are refused identically.\n' +
    `\n  (Exit code ${EXIT_TOO_LARGE}, distinct from ${EXIT_PREREQUISITE_NOT_MET}'s "no route, no act at all" — this write WAS\n` +
    `  routed and answered — from ${EXIT_REFUSED}'s "the body broke the stamp contract", which is this tool's own\n` +
    `  rule and not the platform's, and from ${EXIT_NOT_STORED}'s "written but not stored", where a write HAPPENED.\n` +
    '  Capture it BEFORE any pipe: `node scripts/pm/post-stamped.mjs … > /tmp/p.log 2>&1; echo "EXIT=$?"`.)'
  );
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
  // ⏱ The throttle (#19572), on the write verbs only — the comment `POST` and
  // the body `PATCH`. A spent budget or a live stop marker refuses here, before
  // the request is made and therefore before anything can be half-written.
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token: TOKEN, kind: `post-stamped ${method}` });
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
    // ⛔ The platform's own sentence is not discarded here. Reading it is what
    // lets a refusal it ANSWERED be told from a route that never existed, and
    // the refusal reports carry it either way: a 3 that prints only a status
    // code hides the one line that says what went wrong.
    const said = platformRefusalText(await res.text().catch(() => ''));
    // ⏱ …and the sentence is what names a SECONDARY rate limit, so the marker
    // is written from the failing answer BEFORE this throws past every caller.
    if (paced) noteResponse({ token: TOKEN, status: res.status, headers: res.headers, body: said });
    const err = new Error(`${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    err.refusalText = said;
    throw err;
  }
  // ⏱ A 2xx carries a signal too: `x-ratelimit-remaining: 0` on the answer that
  // spent the last unit is the one reading that precedes the first refusal.
  if (paced) noteResponse({ token: TOKEN, status: res.status, headers: res.headers });
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

/**
 * What a caller is told when there was no act at all — built as a string rather
 * than printed, so the ONE thing this text must never say can be pinned: the
 * remedy it prescribes and the remedy a size refusal prescribes are held apart
 * in BOTH directions, and a pin that can only read one of the two goes green the
 * day the other one starts saying it.
 */
export function prerequisiteNotMetText(err) {
  const said = typeof err?.refusalText === 'string' && err.refusalText !== '' ? err.refusalText : null;
  return (
    `\npost-stamped: PREREQUISITE NOT MET — ${err?.message ?? 'no message'}\n\n` +
      // What the platform said, when it said anything at all. An answer this
      // class does not recognise is still an answer, and a report that prints
      // only the status code makes the reader go and re-run the request to see
      // the one sentence that was already in hand.
      (said ? `  The platform said: ${said.slice(0, REFUSAL_TEXT_CHARS)}\n\n` : '') +
      `  Fix:  ${ROUTE_REMEDY}\n` +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      '        itself with that flag when HTTPS_PROXY is set).\n\n' +
      '  NOTHING WAS WRITTEN, and nothing was read back. This is not a failed post and not a successful\n' +
      '  one — it is no act at all.\n' +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from ${EXIT_REFUSED}'s "the body broke the stamp\n` +
      `  contract" and from ${EXIT_TOO_LARGE}'s "the platform answered and refused the body for its size", where a\n` +
      '  route existed and the remedy above cannot help. Capture it BEFORE any pipe:\n' +
      '  `node scripts/pm/post-stamped.mjs … > /tmp/p.log 2>&1; echo "EXIT=$?"`.)'
  );
}

function reportPrerequisiteNotMet(err) {
  console.error(prerequisiteNotMetText(err));
  return EXIT_PREREQUISITE_NOT_MET;
}

function readInput(file) {
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8');
}

function rearmThroughProxy(args) {
  // `guard` is THIS tool's own variable (#18939). Without it the plan read the
  // patrol's shared name straight out of `process.env`, so a sibling
  // instrument's inherited guard answered "already re-armed" here — silently —
  // and the un-re-armed run then bypassed the proxy and answered 401 Bad
  // credentials, a false story about the credential. The own-guard `if` that
  // used to sit below was never reached for that case; the plan's own branch
  // now covers it, and PRINTS the variable through `plan.hint`.
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
    guard: PROXY_REARM_GUARD,
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
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
  '  To QUOTE the contract rather than use it, put it in Markdown code — a fenced block or a backtick',
  '  span. Inside one this tool renders TEXT: nothing is substituted, no opener is refused, no quoted',
  '  stamp is validated, and the status line reports how many openers were left verbatim beside how many',
  '  were substituted. ⛔ A bare stamp is judged inside a quotation exactly as in prose — quoting changes',
  '  what is rendered, never what was typed onto the board.',
  '  A body whose ONLY token sits inside a quotation is REFUSED: the literal token would go onto the card',
  '  with no time behind it. Quote the token AND stamp the artefact — a `{{WAS:…}}` outside the quotation',
  '  is a stamp, so a body that quotes the contract beside a declaration is accepted. A body that spells',
  '  no token at all is unchanged.',
  '  A body refresh is REFUSED while comments newer than the body\'s last write stamp exist and',
  '  --ack-through=ID does not name the newest of them — a refresh must not void an unread knock.',
  '  A `Claim:` comment\'s `Seat:`, `Thread-read:` and `Clause-②:` lines are read here by the checkers that OWN them,',
  '  and the comment is REFUSED when one cannot be read — the refusal prints the spelling that can.',
  '  The attribution footer is the caller\'s: its form differs by channel and act, so this tool adds none.',
  '',
  `  Exit: 0 written and stored · ${EXIT_USAGE} usage · ${EXIT_REFUSED} refused, nothing written ·`,
  `  ${EXIT_PREREQUISITE_NOT_MET} no route, no act at all · ${EXIT_NOT_STORED} WRITTEN BUT NOT STORED — go read the artefact,`,
  `  ⛔ do not retry blindly · ${EXIT_TOO_LARGE} TOO LARGE — the platform answered and refused the body for its size;`,
  '  it names the bytes sent and the measured cap for that surface, and the remedy is to shorten or split',
  '  the body, ⛔ never another route. Capture the code BEFORE any pipe.',
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

  // ⛔ Comments only: a claim IS a comment, and a seat POST's body carries a `Seat:` line of its own that no claim reader judges.
  const keyed = options.mode === 'comment' ? claimKeyedLineRefusals(rendered.body) : [];
  if (keyed.length > 0) {
    console.error(keyedLineRefusalText(keyed));
    return EXIT_REFUSED;
  }

  if (options.dryRun) {
    console.error(
      `post-stamped: DRY RUN — nothing was written. Substituted with \`${rendered.stamp}\` — ` +
        `${substitutionSummary(rendered)}. Stamp verdict: ${rendered.verdict} — ` +
        `${STAMP_VERDICTS[rendered.verdict]}. Target would be ` +
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
    // ⛔ Only the WRITE path is classified. A read sends no body, so a size
    // refusal cannot be what it was answered with, and the pre-read above keeps
    // its PREREQUISITE reading unchanged.
    const refusal = sizeRefusal({
      status: err?.status,
      refusalText: err?.refusalText,
      mode: options.mode,
      sentBytes: Buffer.byteLength(rendered.body, 'utf8'),
    });
    if (refusal) {
      console.error(sizeRefusalText(refusal, repoRes.repo, options.number));
      return EXIT_TOO_LARGE;
    }
    return reportPrerequisiteNotMet(err);
  }

  const verdict = readBackVerdict({
    stamp: rendered.stamp,
    writtenAt: written.writtenAt,
    sent: rendered.body,
    stored: written.stored,
    substituted: rendered.substituted,
    quoted: rendered.quoted,
    verbatim: rendered.verbatim,
    verbatimTokens: rendered.verbatimTokens,
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
          verbatim: rendered.verbatim,
          verbatim_tokens: rendered.verbatimTokens,
          stamp_verdict: rendered.verdict,
          written_at: written.writtenAt,
          drift_minutes: verdict.drift,
          body_mutated: verdict.mutated,
          body_landed: verdict.landed,
          read_back: {
            class: verdict.readBack.class,
            first_difference_byte: verdict.readBack.offset,
            footer_re_anchored: verdict.readBack.footerReAnchored ?? null,
          },
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
  } else {
    console.log(
      [
        `post-stamped: ${options.mode === 'comment' ? 'comment posted on' : 'body rewritten on'} ${repoRes.repo}#${options.number}`,
        `  ${options.mode === 'comment' ? 'comment' : 'card'}: ${written.id} ${written.url ?? '(no url returned)'}`,
        ...verdict.lines,
        ...(unread ? [unreadPassText(unread)] : []),
        `  substitutions: ${substitutionSummary(rendered)}`,
      ].join('\n'),
    );
  }

  // ⛔ The one thing a caller cannot be left to read out of prose: the write
  // happened and the platform did not keep it. Reported after the lines above
  // — they carry the offset this text sends the reader to — and on BOTH
  // output shapes, because `--json` is the one a script reads.
  if (!verdict.landed) console.error(notStoredText(verdict, repoRes.repo, options.number, options.mode));
  return verdict.exit;
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
  'the re-exec guard: the name this tool sets, and the patrol name that must not silence it': 11,
  'the token contract: the two spellings, and nothing else': 9,
  'the refusals: every route that must not reach the board': 20,
  'the opener scan: every `{{` is a token this tool renders, or the body is refused': 35,
  'the quoting spelling: Markdown code is a quotation, and a quotation is rendered as written': 52,
  'the stamp verdict: a quoted token is not a stamp, and the carve-out has a partner check': 63,
  'the calendar rule: a stamp shaped like an instant the calendar does not have': 34,
  'the direction check: a stamp no act can have read': 22,
  'the substitution: one clock, read once, written everywhere': 9,
  'the read-back: what the transcript can actually prove': 33,
  'the exit code: the read-back reaches `$?`, or it reaches nobody': 24,
  'the re-anchored footer: a newline the platform MOVED is not a byte lost': 41,
  "the collapsed blank: the footer block's own separator is not a content byte": 33,
  'the CLI: the one decision a typo must never make': 16,
  'the unread-knock check: a refresh cannot void what nobody read': 49,
  'the size refusal: a 422 the platform answered is not a route that never existed': 53,
  'the two positions: a declaration renders as bare digits, and the patrol reads digits': 17,
  'the shared rule: this tool and H56 cannot come to disagree': 6,
  'the keyed lines: a claim\'s exact-value fields, judged by the readers that own them': 20,
});
const SELF_TEST_BATTERY_FLOOR = 15;
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

  // ── the re-exec guard (#18939) ────────────────────────────────────────────
  // The plan reads the guard name THIS file sets, never a shared one. A sibling
  // instrument's inherited guard used to answer 'already re-armed' here, and the
  // un-re-armed run then bypassed the proxy and answered 401 Bad credentials —
  // a false story about the credential, printed nowhere at all.
  battery('the re-exec guard: the name this tool sets, and the patrol name that must not silence it');
  {
    const PATROL_GUARD = 'OS_HALF_STATES_PROXY_REARMED';
    const proxied = { HTTPS_PROXY: 'http://127.0.0.1:40309' };
    const rearm = (env) => proxyRearmPlan({ env, guard: PROXY_REARM_GUARD, flagSupported: true });
    const own = { ...proxied, [PROXY_REARM_GUARD]: '1' };
    const ownSource = readFileSync(SELF_PATH, 'utf8');
    t('this tool\'s guard is its own name, never the patrol\'s', PROXY_REARM_GUARD !== PATROL_GUARD);
    t('…and the patrol name pinned here IS the plan\'s default, so a rename reds this battery', proxyRearmPlan({ env: { ...proxied, [PATROL_GUARD]: '1' } }).guarded === PATROL_GUARD);
    t('a proxied run with no guard set re-execs', rearm(proxied).rearm === true);
    t('…this tool\'s OWN guard is what stops the loop', rearm(own).rearm === false);
    t('…while the patrol\'s inherited guard does NOT suppress it', rearm({ ...proxied, [PATROL_GUARD]: '1' }).rearm === true);
    t('a suppressed run SPEAKS — silence is the whole cost of this chain', rearm(own).hint === true);
    t('…naming the variable a reader has to unset', rearm(own).reason.includes(PROXY_REARM_GUARD));
    t('…and naming the 401 the silence would otherwise be read as', rearm(own).reason.includes('401 Bad credentials'));
    t('the Actions-runner leg is unchanged: no proxy, no re-exec, no extra line', rearm({ [PROXY_REARM_GUARD]: '1' }).rearm === false && rearm({ [PROXY_REARM_GUARD]: '1' }).hint === false);
    t('structural: the dispatch really hands the plan THIS file\'s guard', /\n\s+guard: PROXY_REARM_GUARD,\n/.test(ownSource));
    t('structural: the plan is imported, not restated here', /\bproxyRearmPlan\b/.test(ownSource) && !/function\s+proxyRearmPlan\b/.test(ownSource));
  }

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
  t('⭐ a DECLARED quoted stamp in the OPENING position is refused — it renders there as bare digits', kinds('The {{WAS:2026-09-08T14:00Z}} ruling stands.', NOW_MS).join() === 'positional-declared');
  t('…and the SAME declaration one line down is accepted, because no position claims it', stampRefusals('A ruling.\n\nThe {{WAS:2026-09-08T14:00Z}} ruling stands.', NOW_MS).length === 0);
  t('…and beside a token, which is the whole point of the declaration', stampRefusals('Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.').length === 0);
  t('⛔ the quoted route is not a free-text escape: a non-stamp value is refused', kinds('{{WAS:yesterday}}').includes('quoted-not-a-stamp'));
  t('⛔ …nor a smuggling route: a stamp with prose glued on is refused', kinds('{{WAS:2026-09-08T14:00Z ruling}}').includes('quoted-not-a-stamp'));
  t('surrounding whitespace inside the declaration is tolerated', stampRefusals('Note.\n\nread {{WAS: 2026-09-08T14:00Z }}', NOW_MS).length === 0);
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
  t('⛔ NO accepted form narrowed: whitespace inside the declaration still clears the scan', unrecognisedOpeners('read {{WAS: 2026-09-08T14:00Z }}').length === 0 && renderBody('Note.\n\nread {{WAS: 2026-09-08T14:00Z }}', NOW_MS).ok === true);
  t('⛔ …and the seconds grain still clears it', unrecognisedOpeners('read {{WAS:2026-09-08T14:00:30Z}}').length === 0);
  t('⛔ …and a bare stamp in prose is no opener\'s business', unrecognisedOpeners('The 2026-09-08T14:00Z ruling stands.').length === 0);
  t('⛔ the scan opens NO escape hatch: the entity spelling is not an opener, so it is prose', unrecognisedOpeners('the token &#123;&#123;NOW&#125;&#125;').length === 0);
  // ⛔ The body carries a SECOND token in prose, because a body whose only token
  // is the quoted one is now refused as unstamped (#19091) — the stamp-verdict
  // battery owns that rule and pins this same body without the stamp.
  t('⭐ a token inside backticks is a QUOTATION and is left as written — the next battery owns this rule', renderBody('Write `{{NOW}}` there, read {{NOW}}.', NOW_MS).body === 'Write `{{NOW}}` there, read 2026-09-10T06:37Z.');

  t('the span renderer escapes a newline', offendingSpan('a\nb') === 'a\\nb');
  t('…a carriage return and a tab too', offendingSpan('a\r\tb') === 'a\\r\\tb');
  t('…and any other control byte as an `\\xNN` escape, never as the byte itself', offendingSpan('a\u0007b') === 'a\\x07b');
  t('a span inside the budget is printed whole, with no ellipsis', offendingSpan('{{THEN}}') === '{{THEN}}');
  t(`a longer one is clipped to ${SPAN_BYTES} bytes and says so`, offendingSpan('x'.repeat(100)) === `${'x'.repeat(SPAN_BYTES)}…`);
  t('⛔ …and never cuts a multi-byte character in half', offendingSpan(`${'x'.repeat(SPAN_BYTES - 1)}€€`) === `${'x'.repeat(SPAN_BYTES - 1)}…`);
  t('the budget is counted in BYTES, which is the unit a dump arrives in', SPAN_BYTES === 60 && Buffer.byteLength(offendingSpan('€'.repeat(40)), 'utf8') <= SPAN_BYTES + 3);

  // The filed instance, in kind: a seat quoted this tool's OWN status line
  // verbatim — an inline code span inside a blockquote — and the token inside
  // the quotation was substituted, publishing a sentence the tool never
  // printed. Three live hits in one hour, by two seats, plus a claim the tool
  // refused for spelling its own documentation placeholder.
  battery('the quoting spelling: Markdown code is a quotation, and a quotation is rendered as written');
  const CARD_QUOTE =
    'Addendum.\n\n' +
    '> `post-stamped` reported it faithfully: 「*stamp: none substituted — this body carried no `{{NOW}}`, so there is no clock to check*」\n\n' +
    '<sub>read {{NOW}}.</sub>\n';
  const cardQuote = renderBody(CARD_QUOTE, NOW_MS);
  t('⭐ THE FILED INSTANCE: the quoted token inside an inline span inside a blockquote is left as written', cardQuote.ok === true && cardQuote.body.includes('carried no `{{NOW}}`'));
  t('⭐ …so the quotation is no longer falsified — the stamp does not appear inside it', cardQuote.body.includes('carried no `2026-09-10T06:37Z`') === false);
  t('⭐ …and the act\'s OWN token, outside the quotation, still gets the clock', cardQuote.body.includes('<sub>read 2026-09-10T06:37Z.</sub>'));
  t('⭐ …the counts now separate the two: 1 substituted, 1 verbatim, where the filed run could only say 2', cardQuote.substituted === 1 && cardQuote.verbatim === 1, `sub=${cardQuote.substituted} verb=${cardQuote.verbatim}`);
  t('⭐ …and the status line SAYS both, so a reader can compare them to intent', substitutionSummary(cardQuote).includes('1 {{NOW}}') && substitutionSummary(cardQuote).includes('verbatim: 1 opener(s)'));
  t('⛔ THE BEFORE-READING, kept as a control: the same body with the backticks removed IS substituted', renderBody(CARD_QUOTE.replace(/`\{\{NOW\}\}`/u, '{{NOW}}'), NOW_MS).substituted === 2);

  const FENCED = 'Re-check:\n\n```\nprintf \'{{NOW}}\' | node scripts/pm/post-stamped.mjs --dry-run\n```\n\n<sub>read {{NOW}}.</sub>\n';
  const fenced = renderBody(FENCED, NOW_MS);
  t('⭐ THE UNESTABLISHED POINT, measured: a FENCED block is a quotation too', fenced.ok === true && fenced.body.includes("printf '{{NOW}}'"));
  t('…with the token outside it still substituted, so fencing quotes one and not the other', fenced.substituted === 1 && fenced.verbatim === 1);
  t('⛔ …and the before-reading it replaces: the tree substituted inside a fence exactly like prose', quotedSpans('```\n{{NOW}}\n```').length === 1);
  t('a tilde fence is a fence', quotedSpans('~~~\n{{NOW}}\n~~~\n').length === 1);
  t('an info string does not stop a fence opening', renderBody('```bash\necho {{NOW}}\n```\n\nread {{NOW}}\n', NOW_MS).verbatim === 1);
  t('⛔ a backtick fence whose info string carries a backtick is NOT a fence — CommonMark\'s own rule', renderBody('```a`b\n{{NOW}}\n', NOW_MS).substituted === 1);
  t('an UNCLOSED fence quotes to the end of the body, the way CommonMark ends one', renderBody('read {{NOW}}\n\n```\ntail {{NOW}}\n', NOW_MS).verbatim === 1);
  t('⭐ a fence INSIDE a blockquote is tracked through the quote marker — the shape a seat quotes tool output in', renderBody('Tool said:\n\n> ```\n> substitutions: 2 {{NOW}}, 0 quoted\n> ```\n\nread {{NOW}}\n', NOW_MS).verbatim === 1);
  t('…and the quote ending ends the block with it, so prose after it is prose again', renderBody('> ```\n> {{NOW}}\n\nread {{NOW}}\n', NOW_MS).substituted === 1);
  t('⛔ a four-space indented block is NOT the quoting spelling — indentation is load-bearing in lists', renderBody('read {{NOW}}\n\n    {{NOW}}\n', NOW_MS).substituted === 2);

  const ELLIPSIS = 'Claim: PM loop round 1.\n\nFile surface: the tool substitutes `{{NOW}}`, and `{{WAS:...}}` cannot be quoted either.\n\n<sub>read {{NOW}}.</sub>\n';
  const ellipsis = renderBody(ELLIPSIS, NOW_MS);
  t('⭐ THE CLAIM\'S OWN REFUSAL, retired: an ellipsis payload inside backticks is quoted VERBATIM, not refused', ellipsis.ok === true && ellipsis.body.includes('`{{WAS:...}}`'));
  t('…because the quoted-stamp validation reads a DECLARATION, and inside a quotation there is none', quotedStampValues('`{{WAS:...}}`').length === 0);
  t('⛔ …the before-reading it replaces: the same payload in PROSE is still refused as not-a-stamp', kinds('the form is {{WAS:...}}', NOW_MS).join() === 'quoted-not-a-stamp');
  t('⭐ the documentation placeholder is quotable now — which is what this file\'s own refusal text spells', renderBody('The quoted route is `{{WAS:YYYY-MM-DDThh:mmZ}}`.\n\nread {{NOW}}\n', NOW_MS).ok === true);
  t('⛔ …and in prose it is still refused, so the contract did not widen by one case', kinds('The quoted route is {{WAS:YYYY-MM-DDThh:mmZ}}.', NOW_MS).join() === 'quoted-not-a-stamp');
  // ⛔ Kept byte-identical, and read through `substituteTokens` rather than
  // `renderBody`: a quoted WAS with real digits and NOTHING else is exactly the
  // `unstamped-quoted-token` body the stamp-verdict battery refuses (#19091), so the
  // three cases here stay about RENDERING and the acceptance decision is pinned
  // where it is made. ⛔ Stamping this body with `{{NOW}}` is not the fix — the
  // quoted digits are unmasked, so the MIXED refusal fires, as pinned below.
  const QUOTED_WAS_DIGITS = 'Note on the contract.\n\nExample: `{{WAS:2026-09-08T14:00Z}}` is the form.\n';
  const quotedWasDigits = substituteTokens(QUOTED_WAS_DIGITS, stampNow(NOW_MS));
  t('a WAS token with REAL digits inside a quotation renders as the TOKEN, braces and all', quotedWasDigits.body.includes('`{{WAS:2026-09-08T14:00Z}}`'));
  t('…and is counted verbatim rather than as a quoted stamp — it declared nothing', quotedWasDigits.quoted === 0 && quotedWasDigits.verbatim === 1);
  t('⛔ …and the same body in PROSE still renders the stamp from its declaration, unchanged', substituteTokens(QUOTED_WAS_DIGITS.replace(/`/gu, ''), stampNow(NOW_MS)).quoted === 1);
  t('⛔ …and in prose it is a DECLARATION, so `renderBody` takes it — the quoted one is what changed', renderBody(QUOTED_WAS_DIGITS.replace(/`/gu, ''), NOW_MS).ok === true);
  t('an unknown token NAME inside a quotation is text, not a refusal', renderBody('The typo `{{now}}` is refused.\n\nread {{NOW}}\n', NOW_MS).ok === true);
  t('…and an UNCLOSED opener inside one is text too', renderBody('Quoting `{{WAS:2026` mid-edit.\n\nread {{NOW}}\n', NOW_MS).ok === true);
  t('⛔ both are still refused in prose — the opener scan narrowed nowhere else', renderBody('The typo {{now}} is refused.', NOW_MS).ok === false && renderBody('Quoting {{WAS:2026 mid-edit.', NOW_MS).ok === false);

  // ⛔ The asymmetry this rule stands on: a quotation suppresses what RENDERS a
  // token, never what judges a stamp a human typed. Quoting changes what is
  // rendered, never what was authored — so nothing can hide a stamp behind
  // backticks.
  t('⭐ A BARE STAMP INSIDE THE QUOTING SPELLING IS REFUSED, exactly as in prose — the opening line', kinds('Claim: seat `2026-09-10T06:37Z` — dispatched.', NOW_MS).join() === 'positional');
  t('⭐ …and inside a FENCE beside the act-clock token, the MIXED refusal still fires', kinds('Verdict {{NOW}}.\n\n```\nread 2026-09-08T14:00Z\n```\n', NOW_MS).join() === 'mixed');
  t('⭐ …because `maskQuotedStamps` blanks a WAS token only where it IS a token', maskQuotedStamps('`{{WAS:2026-09-08T14:00Z}}`').includes('2026-09-08T14:00Z') && maskQuotedStamps('{{WAS:2026-09-08T14:00Z}}').includes('2026-09-08T14:00Z') === false);
  t('⭐ …so a stamp cannot hide from the contract behind backticks, which is the accident this may never buy', kinds('Verdict {{NOW}} — write `{{WAS:2026-09-08T14:00Z}}` for a quoted reading.', NOW_MS).length > 0);
  t('⛔ …and the body that refusal replaces used to be ACCEPTED and rendered as bare digits — the defect, not a feature', unrecognisedOpeners('Verdict {{NOW}} — write `{{WAS:2026-09-08T14:00Z}}` for a quoted reading.').length === 0);
  const QUOTED_TOKEN_PLUS_STAMP = 'Here is the token: `{{NOW}}`.\n\nThe board was read at 2026-09-08T14:00Z.\n';
  t('⛔ the MIXED trigger is deliberately NOT quote-aware: spelling the token anywhere means the author knows it', kinds(QUOTED_TOKEN_PLUS_STAMP, NOW_MS).join() === 'mixed');
  t('…so this change weakened no refusal — it is the one direction it could have', stampRefusals(QUOTED_TOKEN_PLUS_STAMP, NOW_MS).length === 1);
  const QUOTED_REMEDY = stampRefusals('Verdict {{NOW}}.\n\n```\nread 2026-09-08T14:00Z\n```\n', NOW_MS)[0].detail;
  t('⭐ the remedy SAYS the stamp sits inside a quotation, rather than prescribing a route that cannot work there', QUOTED_REMEDY.includes('sits inside a QUOTED SPAN'));
  t('…and names the placeholder as the way to quote an example', QUOTED_REMEDY.includes('YYYY-MM-DDThh:mmZ'));
  t('⛔ …and a stamp with even ONE unquoted occurrence gets the ordinary remedy, with no such clause', stampRefusals('Verdict {{NOW}}.\n\nread 2026-09-08T14:00Z and `2026-09-08T14:00Z`.\n', NOW_MS)[0].detail.includes('QUOTED SPAN') === false);

  const UNMATCHED = 'Write `{{NOW}} there.';
  t('⛔ an unmatched backtick opens NO span — the run needs a closer of the same length on the line', renderBody(UNMATCHED, NOW_MS).body === 'Write `2026-09-10T06:37Z there.');
  t('a double-backtick run closes on a double-backtick run', quotedSpans('``{{NOW}}``').length === 1);
  t('…and a single run inside a double one is content, not a closer', renderBody('``a `b` {{NOW}}`` read {{NOW}}', NOW_MS).substituted === 1);
  t('⛔ a code span is searched within ONE line only — conservative on purpose, so under-detection is today\'s behaviour', renderBody('`{{NOW}}\n{{NOW}}`', NOW_MS).substituted === 2);
  t('two spans on one line are two spans', quotedSpans('`a` and `b`').length === 2);
  t('a backtick run inside a FENCE is fence content, never a span of its own', quotedSpans('```\n`a` `b`\n```').length === 1);
  t('the span kinds are declared, so a reader and the code share one vocabulary', Object.keys(QUOTED_SPAN_KINDS).join() === 'fenced,code-span');
  t('an opener is judged by where it STARTS — one position, one answer for every rule', insideQuotedSpan([{ from: 0, to: 5 }], 4) === true && insideQuotedSpan([{ from: 0, to: 5 }], 5) === false);

  const PROSE_CONTROL = 'Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.';
  t('⭐ THE CONTROL: prose substitution is byte-identical — the whole point of a structural rule', renderBody(PROSE_CONTROL, NOW_MS).body === 'Verdict 2026-09-10T06:37Z — on the board read 2026-09-08T14:00Z.');
  t('…with no opener left verbatim, because no quotation is there', renderBody(PROSE_CONTROL, NOW_MS).verbatim === 0);
  t('…and the summary says so in words rather than leaving a bare zero to read', substitutionSummary(renderBody(PROSE_CONTROL, NOW_MS)).endsWith('(none)'));
  t('a body with no backtick at all has no span, so `quotedSpans` costs it nothing', quotedSpans('Claim: seat, {{NOW}} — dispatched.').length === 0);
  t('⛔ NO THIRD SPELLING was added: the tokens are still exactly two', STAMP_TOKEN === '{{NOW}}' && QUOTED_TOKEN_RE.source === '\\{\\{WAS:([^{}]*)\\}\\}');
  t('⛔ and NO flag turns substitution off — the quoting spelling lives in the body, where a reader sees it', KNOWN_FLAGS.includes('--no-substitute') === false && KNOWN_OPTIONS.includes('expect-now') === false);

  // ── the stamp verdict: the carve-out's PARTNER check (#19091) ─────────────
  // The filed defect: three live `Claim:` comments carried their round stamp as
  // a quoted `{{NOW}}`, were substituted by nothing — correctly — and posted at
  // exit 0 with the literal token on the board and no time. The carve-out above
  // is right; what it shipped without is a check that the artefact ended up
  // stamped AT ALL. ⛔ The criterion is NOT "0 substitutions and a verbatim
  // opener": this tool's own docblock is a body that quotes the token and stamps
  // itself by declaration, so the judgement is a PREDICATE over the counts.
  battery('the stamp verdict: a quoted token is not a stamp, and the carve-out has a partner check');
  const LEG_A = 'A claim whose only stamp lives inside a code span.\n\n`Round: fire of {{NOW}}`\n';
  const LEG_B = 'A claim whose stamp is in prose.\n\nRound: fire of {{NOW}}\n';
  const legA = renderBody(LEG_A, NOW_MS);
  const legB = renderBody(LEG_B, NOW_MS);
  t('⭐ LEG A, THE FILED SHAPE: a body whose ONLY token is quoted is REFUSED', legA.ok === false);
  t('⭐ …and nothing is rendered from it, so no literal token can reach the board', legA.body === undefined);
  t('…under its own refusal kind, which stands apart from the three it joins', legA.kind === 'unstamped' && ['empty', 'unknown-token', 'stamp-contract'].includes(legA.kind) === false);
  t('…and the verdict on the result names what was wrong with it', legA.verdict === REFUSED_STAMP_VERDICT);
  t('⛔ LEG B, THE CONTROL: the same body with the backticks removed is substituted exactly as before', legB.ok === true && legB.body === 'A claim whose stamp is in prose.\n\nRound: fire of 2026-09-10T06:37Z\n');
  t('…with the counts it always had', legB.substituted === 1 && legB.quoted === 0 && legB.verbatim === 0);
  t('⭐ …so the difference between the two is three backticks, and the EXIT now differs with it', legA.ok !== legB.ok);

  // The three live artefacts, replayed from the card's text: one act, one shape,
  // three cards, each posted unstamped with the token visible and repaired by
  // hand afterwards — a seat's own catch, which is what a tool exists to remove.
  const filedSpecimen = (card) => `Claim: skills seat, dispatch on ${card}\n\n\`Round: fire of {{NOW}}\`\n`;
  const SPECIMENS = ['objectui#9871', 'objectui#9880', 'objectui#9874'];
  t('⭐ THE FILED SPECIMENS: objectui#9871\'s shape is refused', renderBody(filedSpecimen(SPECIMENS[0]), NOW_MS).ok === false);
  t('⭐ …objectui#9880\'s too', renderBody(filedSpecimen(SPECIMENS[1]), NOW_MS).ok === false);
  t('⭐ …and objectui#9874\'s', renderBody(filedSpecimen(SPECIMENS[2]), NOW_MS).ok === false);
  t('⭐ …each under the ONE verdict, so the three are one finding and not three', SPECIMENS.every((c) => renderBody(filedSpecimen(c), NOW_MS).verdict === REFUSED_STAMP_VERDICT));
  t('a FENCED body of the same shape is refused too — the construct is not the rule', renderBody('Claim: skills seat.\n\n```\nRound: fire of {{NOW}}\n```\n', NOW_MS).verdict === REFUSED_STAMP_VERDICT);

  // ⭐ The two shapes that MUST stay accepted, which is why the naive criterion
  // is excluded by name. The first is this seat's own claim comment.
  const SEAT_CLAIM =
    'Claim: PM loop round 1 (skills seat)\n' +
    'Branch: `claude/issue-19091-post-stamped-unstamped-artefact`\n' +
    'File surface: `scripts/pm/post-stamped.mjs`\n\n' +
    'Serial constraints cleared: this file last landed {{WAS:2026-09-08T14:00Z}}.\n';
  const seatClaim = renderBody(SEAT_CLAIM, NOW_MS);
  t('⭐ THE SEAT\'S OWN CLAIM SHAPE: a `{{WAS:…}}` in prose beside backticked names, no `{{NOW}}`, is ACCEPTED', seatClaim.ok === true);
  t('…stamped by DECLARATION rather than by this act\'s clock', seatClaim.verdict === 'stamped-by-declaration');
  t('…and the declared stamp is what reaches the board', String(seatClaim.body).includes('this file last landed 2026-09-08T14:00Z.'));
  const DOCBLOCK_SHAPED =
    'The contract has two spellings: `{{NOW}}` is the clock this act reads, and\n' +
    '`{{WAS:YYYY-MM-DDThh:mmZ}}` declares a reading of something else.\n\n' +
    'Measured on this channel {{WAS:2026-09-08T14:00Z}}.\n';
  const docblockShaped = renderBody(DOCBLOCK_SHAPED, NOW_MS);
  t('⭐ THIS TOOL\'S OWN DOCBLOCK SHAPE: a body that QUOTES both tokens and declares a stamp is ACCEPTED', docblockShaped.ok === true);
  t('⭐ …and it is exactly the body the excluded criterion would have refused: 0 substituted, 2 verbatim', docblockShaped.substituted === 0 && docblockShaped.verbatim === 2);
  t('…both quotations reach the board as written', String(docblockShaped.body).includes('`{{NOW}}`') && String(docblockShaped.body).includes('`{{WAS:YYYY-MM-DDThh:mmZ}}`'));
  t('…while the declaration OUTSIDE them renders its own value', String(docblockShaped.body).includes('Measured on this channel 2026-09-08T14:00Z.'));

  // The predicate itself, over the counts alone — the deliverable this card
  // asked for FIRST, and the one place the decision is made.
  t('the predicate answers from the counts, with no body to read', stampVerdict({ substituted: 1 }) === 'stamped-by-this-act');
  t('⭐ this act\'s own clock outranks everything: a body carrying both IS stamped by this act', stampVerdict({ substituted: 1, quoted: 1, verbatimTokens: 3 }) === 'stamped-by-this-act');
  t('a declaration with nothing substituted is stamped by declaration', stampVerdict({ quoted: 1 }) === 'stamped-by-declaration');
  t('⭐ …and it outranks a quoted token, which is the docblock shape above', stampVerdict({ quoted: 1, verbatimTokens: 3 }) === 'stamped-by-declaration');
  t('⭐ a quoted token with nothing else is the one verdict that is refused', stampVerdict({ verbatimTokens: 1 }) === REFUSED_STAMP_VERDICT);
  t('all three counts zero is `no-token` — the pre-existing shape, still posted', stampVerdict({}) === 'no-token');
  t('…and no argument at all answers the same, never `undefined`', stampVerdict() === 'no-token');
  t('every verdict the predicate can return is DECLARED, so a reader and the code share one vocabulary', [{ substituted: 1 }, { quoted: 1 }, { verbatimTokens: 1 }, {}].every((c) => stampVerdict(c) in STAMP_VERDICTS));
  t('…and the declared set is exactly those four, so a fifth cannot arrive undocumented', Object.keys(STAMP_VERDICTS).join() === 'stamped-by-this-act,stamped-by-declaration,unstamped-quoted-token,no-token');
  t('the refused verdict is read from ONE constant rather than retyped at each site', REFUSED_STAMP_VERDICT in STAMP_VERDICTS && REFUSED_STAMP_VERDICT === 'unstamped-quoted-token');
  t('⛔ THE EXCLUDED CRITERION, pinned as excluded: 0 substitutions AND a verbatim opener is NOT the rule', stampVerdict({ substituted: 0, quoted: 1, verbatimTokens: 1 }) !== REFUSED_STAMP_VERDICT);

  // ⛔ The count the predicate reads is the TOKEN subset, never the status
  // line's `verbatim`: a quoted `{{` that spells neither token makes no claim
  // about a stamp, and refusing it would name a token the body does not carry.
  const QUOTED_HANDLEBARS = 'The template is:\n\n```\n{{ user.name }}\n```\n\nand it renders the name.\n';
  const handlebars = renderBody(QUOTED_HANDLEBARS, NOW_MS);
  t('⭐ a quoted `{{` that is NEITHER token is counted verbatim but is NOT a verbatim TOKEN', handlebars.verbatim === 1 && handlebars.verbatimTokens === 0);
  t('⭐ …so a body quoting a template and stamping nothing still posts, unrefused', handlebars.ok === true && handlebars.verdict === 'no-token');
  t('⛔ …which is why the two counts are two fields: `verbatimTokens` is a SUBSET of `verbatim`', legA.verbatimTokens <= legA.verbatim && handlebars.verbatimTokens < handlebars.verbatim);
  t('the count and the spans it is taken from cannot drift — one IS the other\'s length', docblockShaped.verbatimTokens === docblockShaped.verbatimTokenSpans.length && legA.verbatimTokens === legA.verbatimTokenSpans.length);
  t('…and each span carries the construct that holds it, so the refusal can name that', legA.verbatimTokenSpans[0].kind === 'code-span' && legA.verbatimTokenSpans[0].span === STAMP_TOKEN);
  t('…with a BYTE offset, the unit every other offset this file prints is counted in', legA.verbatimTokenSpans[0].byteAt === Buffer.byteLength(LEG_A.slice(0, LEG_A.indexOf(STAMP_TOKEN)), 'utf8'));

  // The refusal text: the same register as the unrecognised-opener refusal,
  // because it reports the same two facts.
  t('the refusal NAMES the quoted opener it means', String(legA.error).includes('`{{NOW}}`'));
  t('…and the construct that holds it, in the words a reader would use', String(legA.error).includes(QUOTED_SPAN_KINDS['code-span']));
  t('…and the MISSING STAMP, as the counts nothing had compared to intent before', String(legA.error).includes('0 {{NOW}}, 0 quoted'));
  t('…and that nothing was written', String(legA.error).includes('Nothing was written'));
  t('⭐ …and the quiet direction by name, in the UNKNOWN refusal\'s own words', String(legA.error).includes('the quiet direction') && unrecognisedOpenerText([{ kind: 'unknown-token-name', at: 0, span: '{{now}}' }]).includes('the quiet direction'));
  t('…the remedy is a token OUTSIDE the quotation, never a route that cannot work there', String(legA.error).includes('OUTSIDE the quotation'));
  t('…offering BOTH legal spellings, never only the act-clock one', String(legA.error).includes(STAMP_TOKEN) && String(legA.error).includes('{{WAS:YYYY-MM-DDThh:mmZ}}'));
  t('⭐ …and saying what is NOT refused, so a reader cannot over-read it', String(legA.error).includes('spells no token at all is not this refusal'));
  t('a FENCED offender is named as a fence rather than as a span', String(renderBody('Claim: seat.\n\n```\n{{NOW}}\n```\n', NOW_MS).error).includes(QUOTED_SPAN_KINDS.fenced));
  t('EVERY quoted token is listed, not just the first', String(renderBody('Claim: seat.\n\nRead `{{NOW}}` and `{{WAS:YYYY-MM-DDThh:mmZ}}`.\n', NOW_MS).error).split('\n').filter((l) => /^ {2}\d+\. /u.test(l)).length === 2);

  // ⛔ The refusal ORDERING is unchanged: this rule is LAST, and every refusal
  // that used to fire still fires first on a body that breaks both.
  t('⛔ an unrecognised opener in PROSE still wins, so a typo is still reported as a typo', renderBody('Claim: {{now}} — read `{{NOW}}`.', NOW_MS).kind === 'unknown-token');
  t('⛔ a bare stamp on the opening line still wins, so the positional refusal is untouched', renderBody('Claim: seat 2026-09-08T14:00Z\n\n`{{NOW}}`\n', NOW_MS).kind === 'stamp-contract');
  t('⛔ the MIXED refusal still wins, and is still not quote-aware', renderBody('Here is the token: `{{NOW}}`.\n\nThe board was read at 2026-09-08T14:00Z.\n', NOW_MS).kind === 'stamp-contract');
  t('⛔ …and an empty body is still empty, ahead of every token rule', renderBody('   \n\n', NOW_MS).kind === 'empty');

  // ⛔ THE FALSE STATUS LINE, retired. It was printed over three shapes and was
  // true of one: a declaration-stamped body HAS a clock its author declared, and
  // a body whose token was quoted DID carry one. The refusal closes the third
  // before any write; the other two now read the verdict.
  const rbLine = (counts) => readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: 'x', stored: 'x', ...counts }).lines[0];
  t('⭐ THE FALSE LINE, on a declaration-stamped body: it no longer says the body carried no token', rbLine({ substituted: 0, quoted: 1, verbatim: 2, verbatimTokens: 2 }).includes('carried no') === false);
  t('⭐ …it says the artefact is stamped by DECLARATION instead', rbLine({ substituted: 0, quoted: 1 }).includes('stamped by DECLARATION'));
  t('⭐ …and it SAYS WHAT WAS QUOTED, which is the half the old sentence could not', rbLine({ substituted: 0, quoted: 1, verbatim: 2, verbatimTokens: 2 }).includes('2 token(s) quoted as text'));
  t('…with no such clause when nothing was quoted, so the number means something', rbLine({ substituted: 0, quoted: 1 }).includes('quoted as text') === false);
  t('⭐ on a body whose token was QUOTED the line says it carried one, and names the exit that refuses it', rbLine({ substituted: 0, verbatim: 1, verbatimTokens: 1 }).includes('DID carry 1 token(s)') && rbLine({ substituted: 0, verbatimTokens: 1 }).includes(`exit ${EXIT_REFUSED}`));
  t('⛔ THE ONE SHAPE THE OLD SENTENCE WAS TRUE OF, kept: a body with no token at all still reads that way', rbLine({ substituted: 0 }).includes(`carried no ${STAMP_TOKEN}`));
  t('…and now says "quoted or not", so it cannot be read as true of a quoted one', rbLine({ substituted: 0 }).includes('quoted or not'));
  t('⛔ a substituted body\'s line is untouched — drift is still what it reports', rbLine({ substituted: 1 }).includes('drift 0 — one clock, one act'));

  // Structural: a predicate nobody is told about is a predicate nobody can act
  // on, so the verdict reaches `$?`, the dry run, `--json` and the read-back.
  const stampSource = readFileSync(SELF_PATH, 'utf8');
  t('structural: a refused render returns EXIT_REFUSED from the CLI, with nothing written', /if \(!rendered\.ok\) \{\n\s+console\.error\(rendered\.error\);\n\s+return EXIT_REFUSED;/u.test(stampSource));
  t('structural: the DRY RUN line names the verdict, so a caller reads it BEFORE a write', /Stamp verdict: \$\{rendered\.verdict\}/u.test(stampSource));
  t('structural: `--json` carries the verdict and the token count for a script to read', /stamp_verdict: rendered\.verdict,/u.test(stampSource) && /verbatim_tokens: rendered\.verbatimTokens,/u.test(stampSource));
  t('structural: the read-back is HANDED the counts its line needs, never left to guess', /verbatimTokens: rendered\.verbatimTokens,/u.test(stampSource));
  t('structural: the usage register tells a caller this body is refused', USAGE.includes('ONLY token sits inside a quotation is REFUSED'));

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

  t('\u2b50 THE CONTROL: a real instant at the MINUTE grain still renders verbatim', renderBody('Note.\n\nread {{WAS:2026-09-08T14:00Z}}', NOW_MS).body === 'Note.\n\nread 2026-09-08T14:00Z');
  t('\u2b50 \u2026and a real instant at the SECONDS grain, which this tool takes too \u2014 NOT narrowed', renderBody('Note.\n\nread {{WAS:2026-09-08T14:00:30Z}}', NOW_MS).body === 'Note.\n\nread 2026-09-08T14:00:30Z');
  t('\u2026both judged real by the round trip itself', stampRealInstant('2026-09-08T14:00Z').real === true && stampRealInstant('2026-09-08T14:00:30Z').real === true);
  t('\u2b50 a real LEAP DAY is an instant the calendar has: 2028-02-29 is not a calendar problem', stampRealInstant('2028-02-29T00:00Z').real === true && kinds('read {{WAS:2028-02-29T00:00Z}}', NOW_MS).includes('quoted-no-such-instant') === false);
  t('\u2026it is refused by the DIRECTION rule alone, because 2028 is ahead of this clock', kinds('read {{WAS:2028-02-29T00:00Z}}', NOW_MS).join() === 'quoted-in-the-future');
  t('\u2026and a leap day already PAST clears every rule', stampRefusals('Note.\n\nread {{WAS:2024-02-29T00:00Z}}', NOW_MS).length === 0);
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
  const CLASS_PROBE = [
    classifyReadBack({ sent: 'x', stored: undefined }),
    classifyReadBack({ sent: 'x', stored: 'x' }),
    classifyReadBack({ sent: 'x\n', stored: 'x' }),
    classifyReadBack({ sent: 'x', stored: `x${PLATFORM_COMMENT_FOOTER}` }),
    classifyReadBack({ sent: `x${PLATFORM_COMMENT_FOOTER}\n`, stored: `x\n${PLATFORM_COMMENT_FOOTER}` }),
    classifyReadBack({ sent: 'x', stored: 'y' }),
  ];
  t('the platform comment footer is declared as the 58 bytes measured, never a pattern', Buffer.byteLength(PLATFORM_COMMENT_FOOTER, 'utf8') === 58, `bytes=${Buffer.byteLength(PLATFORM_COMMENT_FOOTER, 'utf8')}`);
  t('every class the classifier answers with has a declared meaning', CLASS_PROBE.every((r) => r.class in READ_BACK_CLASSES), CLASS_PROBE.map((r) => r.class).join());
  t('…and those six inputs are six DIFFERENT classes, not one word repeated', new Set(CLASS_PROBE.map((r) => r.class)).size === 6, CLASS_PROBE.map((r) => r.class).join());

  const STRIPPED_SENT = `${SENT}\n`;
  const STRIPPED = rb({ sent: STRIPPED_SENT, stored: SENT });
  t('⭐ THE FILED READING: a body stored one trailing newline short is CLEAN, not MUTATED', STRIPPED.mutated === false && STRIPPED.readBack.class === 'trailing-newline-stripped');
  t('…and the line NAMES the strip rather than warning about the sanitizer', STRIPPED.lines[1].includes('clean — the platform stripped the trailing newline') && STRIPPED.lines[1].includes('⚠️') === false);
  t('…carrying both byte counts, so a reader reads the delta instead of recomputing it', STRIPPED.lines[1].includes(`sent ${Buffer.byteLength(STRIPPED_SENT, 'utf8')}, stored ${Buffer.byteLength(SENT, 'utf8')}`), STRIPPED.lines[1]);

  const APPENDED = rb({ sent: SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}` });
  t('⭐ an artefact stored with the platform footer appended is CLEAN', APPENDED.mutated === false && APPENDED.readBack.class === 'footer-appended');
  t('…and the line names the footer as the thing that was added', APPENDED.lines[1].includes('clean — the platform appended its footer'));
  t('⭐ THE MOVED CELL: those same bytes from a BODY write are CLEAN too — a MEASURED cell is not warned about', APPENDED.readBack.class === 'footer-appended' && APPENDED.mutated === false);
  t('⭐ …and the two answers about one set of bytes are now ONE: not-mutated exactly where it landed', APPENDED.mutated === false && APPENDED.landed === true && APPENDED.exit === EXIT_OK);

  const BOTH = rb({ sent: STRIPPED_SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}` });
  t('⭐ a strip AND the footer on one comment is clean, named by the footer', BOTH.mutated === false && BOTH.readBack.class === 'footer-appended' && BOTH.lines[1].includes('appended its footer'));
  t('…and the strip is said too, rather than one normalisation hiding the other', BOTH.lines[1].includes('over the stripped trailing newline'), BOTH.lines[1]);

  const UNDER = rb({ sent: 'a [b] c\n', stored: `a b c${PLATFORM_COMMENT_FOOTER}` });
  t('⭐ a real mutation UNDERNEATH an appended footer is still MUTATED', UNDER.mutated === true && UNDER.readBack.class === 'mutated');
  t('…at an offset INSIDE the body, not at the tail where the footer starts', UNDER.readBack.offset === 2, `offset=${UNDER.readBack.offset}`);
  t('…and the added line shows both sides at that byte', UNDER.lines[2].includes('first difference at byte 2') && UNDER.lines[2].includes('| stored'), UNDER.lines[2]);

  const WIDE = rb({ sent: '维护者 [x] 的裁决', stored: '维护者 x 的裁决' });
  t('⭐ a multi-byte character ahead of the difference gives a BYTE offset, never a character one', WIDE.readBack.offset === Buffer.byteLength('维护者 ', 'utf8'), `offset=${WIDE.readBack.offset}`);
  t('…and the context window opens ON the difference, not on the prefix both bodies share', WIDE.readBack.sentContext.includes('[x]'), WIDE.readBack.sentContext);
  t('…with control characters escaped, the way a refusal prints a span', rb({ sent: 'line one\nline two', stored: 'line one line two' }).readBack.sentContext.includes('\\n'));

  t('two identical bodies have no first differing byte at all', firstDifferingByte('x', 'x') === -1);
  t('…and where one is a PREFIX of the other the seam is the shorter one\'s end', firstDifferingByte('abc', 'ab') === 2);
  t('an unreadable stored body reports no offset to chase', rb({ sent: SENT, stored: undefined }).readBack.offset === null);

  // The filed hit: a seat-post refresh sent 263,533 bytes and the platform
  // stored 257,945 — the byte count of the version BEFORE that write — with
  // the first difference at byte 6792, where the new block began. The old body
  // was kept whole, the MUTATED line said exactly that, and the tool exited 0.
  // These cases pin the SPLIT inside `mutated`: the append that lost nothing
  // keeps its 0, everything else reaches `$?`.
  battery('the exit code: the read-back reaches `$?`, or it reaches nobody');
  const PREVIOUS_BODY = '**Seat post.**\n\nR+271 · the board as it stood.\n';
  const REFRESH_SENT = '**Seat post.**\n\nR+272 · the board as it stands now.\n';
  const KEPT_OLD = rb({ sent: REFRESH_SENT, stored: PREVIOUS_BODY });
  t('⭐ THE FILED SHAPE: the platform kept the PREVIOUS body, so the sent bytes did NOT land', KEPT_OLD.landed === false);
  t('⭐ …and the exit code is the not-stored one, never OK', KEPT_OLD.exit === EXIT_NOT_STORED);
  t('⛔ …while the CLASS is untouched — still MUTATED with its offset, exactly as pinned above', KEPT_OLD.mutated === true && KEPT_OLD.readBack.class === 'mutated');
  t('…the first difference sits INSIDE the body this act sent, not at its end', KEPT_OLD.readBack.offset < Buffer.byteLength(REFRESH_SENT, 'utf8'), `offset=${KEPT_OLD.readBack.offset}`);
  t('…and the verdict says the write did not land, in the same breath as the offset', KEPT_OLD.lines[3].includes('did NOT land'), KEPT_OLD.lines[3]);
  t('the report names the offset a reader has to go look at', notStoredText(KEPT_OLD, 'o/n', 6015).includes(`byte ${KEPT_OLD.readBack.offset}`));
  t('…and tells the caller to READ the artefact', notStoredText(KEPT_OLD, 'o/n', 6015).includes('READ THE ARTEFACT'));
  t('⛔ …not to retry, because an identical second write reproduces it', notStoredText(KEPT_OLD, 'o/n', 6015).includes('Do not retry blindly'));
  t('⭐ the exit register carries five distinct values — a caller reads exactly one', new Set([EXIT_OK, EXIT_USAGE, EXIT_REFUSED, EXIT_PREREQUISITE_NOT_MET, EXIT_NOT_STORED]).size === 5);
  t('⛔ …and the new one stands apart from BOTH the contract refusal and the transport failure', EXIT_NOT_STORED !== EXIT_REFUSED && EXIT_NOT_STORED !== EXIT_PREREQUISITE_NOT_MET);

  // The shape the seat hits on EVERY seat-post refresh: sent N, stored N+58.
  // The cell is measured (#18693), so it is a CLASS now — and the exit code it
  // always carried and the word the line uses finally say the same thing.
  const BODY_APPEND = rb({ sent: SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}` });
  t('⭐ THE MOVED CELL: the seat-post refresh shape is `footer-appended`, ⛔ no longer MUTATED…', BODY_APPEND.mutated === false && BODY_APPEND.readBack.class === 'footer-appended');
  t('⭐ …and still exits 0 — every byte this act sent is on the platform', BODY_APPEND.landed === true && BODY_APPEND.exit === EXIT_OK);
  t('⛔ …measured as EXACTLY the declared footer, never as a 58-byte delta', BODY_APPEND.readBack.footerReAnchored === true && footerReAnchoring(SENT, `${SENT}${'x'.repeat(58)}`) === null);
  t('…and the line names the append and carries both counts, rather than leaving a warning', BODY_APPEND.lines[1].includes('clean — the platform appended its footer') && BODY_APPEND.lines[1].includes(`sent ${Buffer.byteLength(SENT, 'utf8')}, stored ${Buffer.byteLength(SENT + PLATFORM_COMMENT_FOOTER, 'utf8')}`), BODY_APPEND.lines[1]);
  t('⭐ …over a stripped trailing newline too, which is the shape a seat post actually sends', rb({ sent: STRIPPED_SENT, stored: `${SENT}${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_OK);
  t('⭐ THE CONTROL: a trailing-newline strip was never MUTATED and still exits 0', STRIPPED.landed === true && STRIPPED.exit === EXIT_OK);
  t('⭐ …and an IDENTICAL read-back likewise', ON_TIME.landed === true && ON_TIME.exit === EXIT_OK);
  t('⭐ a real mutation UNDERNEATH an appended footer still exits non-zero — a footer masks no loss', UNDER.landed === false && UNDER.exit === EXIT_NOT_STORED);
  t('⭐ the `--comment` read-back SHARES this verdict and is judged by it: a chewed comment does not exit 0', rb({ sent: 'a [b] c', stored: 'a b c' }).exit === EXIT_NOT_STORED);
  t('⭐ …while the comment footer append it forgives a class earlier still exits 0', APPENDED.landed === true && APPENDED.exit === EXIT_OK);
  t('⛔ an UNREADABLE read-back is NOT widened into this code — UNVERIFIED is a different question', rb({ sent: SENT, stored: undefined }).exit === EXIT_OK);
  t('⭐ the rule is a predicate over the verdict\'s own CLASS, ⛔ never over the byte counts or a side field', sentBodyLanded({ class: 'mutated' }) === false && sentBodyLanded({ class: 'mutated', footerReAnchored: true }) === false);
  t('…and every non-mutated class lands by construction, whatever its byte counts say', ['unreadable', 'identical', 'trailing-newline-stripped', 'footer-appended', 'footer-re-anchored'].every((c) => sentBodyLanded({ class: c }) === true));
  t('⛔ a TRUNCATION is a loss too: a stored body that stops short of the sent one does not exit 0', rb({ sent: `${SENT} and more`, stored: SENT }).exit === EXIT_NOT_STORED);

  // The SECOND re-anchor shape, filed after the first one landed: a body that
  // already ends in the footer block gets its trailing newline moved to before
  // the rule. Equal length, one byte moved, zero lost — and until these cases
  // it exited 4 on every artefact a seat wrote with its own footer.
  //
  // The fixtures are the LIVE read-backs. Each carries the artefact's own byte
  // count, its own bytes at and around the difference — the last 24 bytes
  // before the block, taken from the fetched artefact rather than retyped — and
  // the offset that read-back recorded. The shared head is filler because every
  // byte of it is identical on both sides by construction; `firstDifferingByte`
  // walks all of it, and the pinned offset is what proves it did.
  battery('the re-anchored footer: a newline the platform MOVED is not a byte lost');
  const FOOTER_BYTES = Buffer.byteLength(PLATFORM_COMMENT_FOOTER, 'utf8');
  const liveReAnchor = ({ bytes, tail }) => {
    const head = `${'x'.repeat(bytes - Buffer.byteLength(tail, 'utf8') - 1 - FOOTER_BYTES)}${tail}`;
    return { sent: `${head}${PLATFORM_COMMENT_FOOTER}\n`, stored: `${head}\n${PLATFORM_COMMENT_FOOTER}` };
  };
  const LIVE_RE_ANCHORS = [
    { what: 'comment 5717446818 on #18426', surface: 'comment', bytes: 1591, offset: 1534, tail: 'tripped in the same act.' },
    { what: 'comment 5718507419 on #6023', surface: 'comment', bytes: 3633, offset: 3576, tail: '状,趁进场修掉)。' },
    { what: 'the body of #18739', surface: 'body', bytes: 6255, offset: 6198, tail: 'r verbatim 「同意」)' },
    { what: 'the body of #18740', surface: 'body', bytes: 5155, offset: 5098, tail: 'r verbatim 「同意」)' },
  ];
  for (const live of LIVE_RE_ANCHORS) {
    const { sent, stored } = liveReAnchor(live);
    const v = rb({ sent, stored });
    t(`⭐ THE FILED READING — ${live.what} (${live.surface}): the read-back reproduces the recorded ${live.bytes} bytes on BOTH sides`,
      Buffer.byteLength(sent, 'utf8') === live.bytes && Buffer.byteLength(stored, 'utf8') === live.bytes,
      `sent=${Buffer.byteLength(sent, 'utf8')} stored=${Buffer.byteLength(stored, 'utf8')}`);
    t(`…and its recorded first difference at byte ${live.offset}, which is where the rule stands`,
      firstDifferingByte(sent, stored) === live.offset, `offset=${firstDifferingByte(sent, stored)}`);
    t('…and it LANDED: exit 0, not the not-stored code it used to answer', v.landed === true && v.exit === EXIT_OK);
    t('…measured as the re-anchor by name, never as "equal length so probably fine"', v.readBack.class === 'footer-re-anchored' && v.readBack.footerShape === 're-anchored');
  }

  const LIVE = liveReAnchor(LIVE_RE_ANCHORS[0]);
  t('⛔ …and the CLASS is its OWN word — `footer-re-anchored`, ⛔ never `footer-appended`, whose word is "plus"',
    classifyReadBack({ ...LIVE }).class === 'footer-re-anchored' && READ_BACK_CLASSES['footer-re-anchored'].includes('nothing added, nothing lost'));
  t('⭐ ONE predicate, ⛔ no act to name: the same bytes answer the same exit code whichever write made them',
    rb({ ...LIVE }).exit === EXIT_OK && classifyReadBack({ sent: LIVE.sent, stored: LIVE.stored }).class === classifyReadBack({ ...LIVE }).class);
  t('…and the classifier takes no `mode` at all, so a caller cannot declare one that decides nothing',
    /^function classifyReadBack\(\{ sent, stored \} = \{\}\)/u.test(String(classifyReadBack)), String(classifyReadBack).slice(0, 60));
  t('⭐ the line names the re-anchor rather than sending the reader to the artefact', rb({ ...LIVE }).lines[1].includes('re-anchored its own footer block'), rb({ ...LIVE }).lines[1]);
  t('⛔ …and drops the prescription that sent a seat to re-read every write by hand', rb({ ...LIVE }).lines[1].includes('Read the artefact before trusting it') === false);
  t('…while still saying what it proves, in the words the not-stored line answers', rb({ ...LIVE }).lines[1].includes('every byte sent IS stored'), rb({ ...LIVE }).lines[1]);
  t('…and it is ONE line now: a measured normalisation sends nobody to an offset', rb({ ...LIVE }).lines.length === 2 && rb({ ...LIVE }).readBack.offset === null, String(rb({ ...LIVE }).lines.length));

  t('⭐ THE CONTROL: the APPENDED arm is untouched and still names itself', footerReAnchoring(SENT, `${SENT}${PLATFORM_COMMENT_FOOTER}`)?.shape === 'appended');
  t('…and the `footer-appended` CLASS answers to that arm alone, whichever act wrote it', APPENDED.readBack.class === 'footer-appended' && APPENDED.readBack.footerShape === 'appended');
  t('…and the body-mode append exits 0 with its warning GONE — one answer, ⛔ not two', BODY_APPEND.exit === EXIT_OK && BODY_APPEND.mutated === false);
  t('…and the appended line still says "appended", never the re-anchor\'s words', BODY_APPEND.lines[1].includes('appended its footer') && BODY_APPEND.lines[1].includes('re-anchored') === false);

  // ⛔ The exit-4 contract does not loosen by one case. Everything before the
  // block and every byte of the block itself is compared literally, so each of
  // these still answers 4 — the re-anchor masks nothing.
  const RE_HEAD = 'the seat wrote this line';
  const RE_SENT = `${RE_HEAD}${PLATFORM_COMMENT_FOOTER}\n`;
  t('⛔ THE CONTROL — a byte LOST before the rule still exits 4, re-anchored tail or not',
    rb({ sent: RE_SENT, stored: `${RE_HEAD.replace('wrote', 'wrot')}\n${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ …and a byte CHANGED before the rule, equal length on both sides, exits 4 too',
    rb({ sent: RE_SENT, stored: `${RE_HEAD.replace('this', 'that')}\n${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ …so "equal length" is NOT the test and never became one',
    Buffer.byteLength(RE_SENT, 'utf8') === Buffer.byteLength(`${RE_HEAD.replace('this', 'that')}\n${PLATFORM_COMMENT_FOOTER}`, 'utf8'));
  t('⛔ a loss INSIDE the footer block exits 4 — a chewed footer is the mutation this verdict exists to show',
    rb({ sent: RE_SENT, stored: `${RE_HEAD}\n${PLATFORM_COMMENT_FOOTER.replace('---', '--')}` }).exit === EXIT_NOT_STORED);
  t('⛔ …and a footer whose LINK was rewritten exits 4, however footer-shaped it reads',
    rb({ sent: RE_SENT, stored: `${RE_HEAD}\n${PLATFORM_COMMENT_FOOTER.replace('claude.ai/code', 'example.invalid')}` }).exit === EXIT_NOT_STORED);
  t('⭐ the re-anchor masks NO mutation elsewhere: the sanitizer chew under a moved newline still exits 4',
    rb({ sent: `a [b] c${PLATFORM_COMMENT_FOOTER}\n`, stored: `a b c\n${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ a newline that came from NOWHERE is an unmeasured cell, not a move — it exits 4',
    rb({ sent: `${RE_HEAD}${PLATFORM_COMMENT_FOOTER}`, stored: `${RE_HEAD}\n${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ …and so does a newline inserted somewhere OTHER than immediately before the block',
    rb({ sent: RE_SENT, stored: `${RE_HEAD.replace(' wrote', '\nwrote')}${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ a TRUNCATION that happens to end in the footer block exits 4 — the head is compared literally',
    rb({ sent: `${RE_HEAD} and more${PLATFORM_COMMENT_FOOTER}\n`, stored: `${RE_HEAD}\n${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ `unreadable` is still exit 0 and still UNVERIFIED — this rule did not widen into it',
    rb({ sent: RE_SENT, stored: undefined }).exit === EXIT_OK && rb({ sent: RE_SENT, stored: undefined }).lines[1].includes('UNVERIFIED'));
  t('⭐ the predicate answers the SHAPE, so a caller cannot read a re-anchor as an append or the reverse',
    footerReAnchoring(RE_SENT, `${RE_HEAD}\n${PLATFORM_COMMENT_FOOTER}`)?.shape === 're-anchored' && footerReAnchoring(RE_HEAD, `${RE_HEAD}${PLATFORM_COMMENT_FOOTER}`)?.shape === 'appended');
  t('⛔ …and `null` stays the one answer for everything neither shape covers', footerReAnchoring(RE_SENT, `${RE_HEAD}\n\n${PLATFORM_COMMENT_FOOTER}`) === null);
  // ⛔ The exit-4 report draws the boundary in prose, so it names BOTH shapes or
  // it sends the reader who hit a real loss looking for the wrong exemption.
  const LOST = rb({ sent: RE_SENT, stored: `${RE_HEAD.replace('this', 'that')}\n${PLATFORM_COMMENT_FOOTER}` });
  t('⭐ the NOT STORED report names every footer shape, not just the append it used to',
    notStoredText(LOST, 'o/n', 18709).includes('appends its block') && notStoredText(LOST, 'o/n', 18709).includes('moves a\n  trailing newline this act sent to before the block\'s rule'));
  t('…and still says the thing that decides it: something this act sent is not there',
    notStoredText(LOST, 'o/n', 18709).includes('something this act sent is not there') && notStoredText(LOST, 'o/n', 18709).includes('READ THE ARTEFACT'));

  // The THIRD footer shape (#19048), and the one that really does take a byte:
  // a body already ending in the block comes back with the blank line before its
  // rule collapsed — sent N, stored N-1, the loss INSIDE the block this act sent
  // and never in the body. Measured 5 of 5 by the triage seat and on
  // objectui#9771; every one exited 4. Each fixture reproduces ONE reading: the
  // head is filler because every byte of it is identical on both sides by
  // construction, and the two RECORDED offsets are what prove the shape — both
  // fall OUT of the fixture, neither was computed into it.
  battery('the collapsed blank: the footer block\'s own separator is not a content byte');
  const liveCollapse = (bytes) => {
    const head = 'x'.repeat(bytes - FOOTER_BYTES);
    return { sent: `${head}${PLATFORM_COMMENT_FOOTER}`, stored: `${head}${PLATFORM_COMMENT_FOOTER_COLLAPSED}` };
  };
  const LIVE_COLLAPSES = [
    { what: 'the body of objectstack#19104', bytes: 6395, offset: 6338 },
    { what: 'the body of objectui#9771', bytes: 54579, offset: 54522 },
    { what: 'the body of objectstack#19120', bytes: 4720, offset: null },
    { what: 'the body of objectstack#18572', bytes: 5282, offset: null },
  ];
  for (const live of LIVE_COLLAPSES) {
    const { sent, stored } = liveCollapse(live.bytes);
    const v = rb({ sent, stored });
    t(`⭐ THE FILED READING — ${live.what}: the read-back reproduces the recorded sent ${live.bytes} / stored ${live.bytes - 1}`,
      Buffer.byteLength(sent, 'utf8') === live.bytes && Buffer.byteLength(stored, 'utf8') === live.bytes - 1, `stored=${Buffer.byteLength(stored, 'utf8')}`);
    t('…and it LANDED: exit 0, ⛔ not the 4 this exact shape answered on every one of them', v.landed === true && v.exit === EXIT_OK);
    t('…named by its OWN word, ⛔ never the re-anchor\'s, which says nothing was lost', v.readBack.class === 'footer-blank-collapsed' && v.readBack.footerShape === 'collapsed');
    if (live.offset !== null) t(`…and the RECORDED first difference at byte ${live.offset} falls out of the fixture, ⛔ not into it`, firstDifferingByte(sent, stored) === live.offset, `offset=${firstDifferingByte(sent, stored)}`);
  }
  // #19143 and #19151 recorded only the delta — one byte short, substance
  // identical — so they are pinned as the DELTA and ⛔ not as a byte count
  // nobody wrote down.
  for (const card of [19143, 19151]) {
    const { sent, stored } = liveCollapse(4096);
    t(`⭐ THE FILED READING — the body of objectstack#${card}, recorded as "−1 byte": the delta is exactly one, and it lands`,
      Buffer.byteLength(sent, 'utf8') - Buffer.byteLength(stored, 'utf8') === 1 && rb({ sent, stored }).exit === EXIT_OK);
  }

  const COLLAPSE = liveCollapse(LIVE_COLLAPSES[0].bytes);
  t('⭐ the collapsed block IS the declared footer over one newline — ONE constant, ⛔ never a second spelling',
    `\n${PLATFORM_COMMENT_FOOTER_COLLAPSED}` === PLATFORM_COMMENT_FOOTER && Buffer.byteLength(PLATFORM_COMMENT_FOOTER_COLLAPSED, 'utf8') === FOOTER_BYTES - 1);
  t('⭐ every shape the predicate answers with maps to exactly one DECLARED class',
    Object.values(FOOTER_SHAPE_CLASSES).every((c) => c in READ_BACK_CLASSES) && new Set(Object.values(FOOTER_SHAPE_CLASSES)).size === 3);
  t('⛔ …and the collapse\'s class says a byte of the BLOCK went, never "nothing lost"',
    READ_BACK_CLASSES['footer-blank-collapsed'].includes('no content byte touched') && READ_BACK_CLASSES['footer-blank-collapsed'].includes('nothing lost') === false);
  t('⭐ the line says WHAT was tolerated — the blank line before the rule — and why: the content is whole',
    rb({ ...COLLAPSE }).lines[1].includes('blank line before its rule was COLLAPSED') && rb({ ...COLLAPSE }).lines[1].includes('every CONTENT byte sent IS stored'), rb({ ...COLLAPSE }).lines[1]);
  t('…with both byte counts, ⛔ no warning glyph and ⛔ no offset to chase', rb({ ...COLLAPSE }).lines.length === 2 && rb({ ...COLLAPSE }).lines[1].includes('⚠️') === false && rb({ ...COLLAPSE }).readBack.offset === null);

  // ⛔ The exit-4 contract does not loosen by one case: the head is compared
  // literally, so every loss the sanitizer makes still reaches `$?`.
  const C_HEAD = 'the seat wrote this line';
  const C_SENT = `${C_HEAD}${PLATFORM_COMMENT_FOOTER}`;
  const collapsedAfter = (head) => `${head}${PLATFORM_COMMENT_FOOTER_COLLAPSED}`;
  t('⛔ THE CONTROL — ONE byte CHANGED anywhere else still exits 4, collapsed tail or not', rb({ sent: C_SENT, stored: collapsedAfter(C_HEAD.replace('this', 'that')) }).exit === EXIT_NOT_STORED);
  t('⛔ …and ONE byte LOST before the rule exits 4 too', rb({ sent: C_SENT, stored: collapsedAfter(C_HEAD.replace('wrote', 'wrot')) }).exit === EXIT_NOT_STORED);
  t('⛔ a TAG-SHAPED fragment the sanitizer ate still exits 4 under a collapsed blank', rb({ sent: `a [b] c${PLATFORM_COMMENT_FOOTER}`, stored: collapsedAfter('a b c') }).exit === EXIT_NOT_STORED);
  t('⛔ a SHORTER body — a truncation that happens to end in the block — still exits 4', rb({ sent: `${C_HEAD} and more${PLATFORM_COMMENT_FOOTER}`, stored: collapsedAfter(C_HEAD) }).exit === EXIT_NOT_STORED);
  t('⛔ a loss INSIDE the block is the sanitizer\'s, ⛔ not the footer\'s, and exits 4', rb({ sent: C_SENT, stored: `${C_HEAD}${PLATFORM_COMMENT_FOOTER_COLLAPSED.replace('---', '--')}` }).exit === EXIT_NOT_STORED);
  t('⛔ BOTH newlines gone is a cell nobody measured, ⛔ not a collapse this tool forgives', rb({ sent: C_SENT, stored: `${C_HEAD}${PLATFORM_COMMENT_FOOTER.slice(2)}` }).exit === EXIT_NOT_STORED);
  t('⛔ …and the arm requires the act to have SENT the block: no footer, no collapse', footerReAnchoring(C_HEAD, collapsedAfter(C_HEAD)) === null);
  t('⭐ …and the strip AND the collapse in ONE act is the MEASURED cell now, ⛔ no longer refused as unseen', footerReAnchoring(`${C_SENT}\n`, collapsedAfter(C_HEAD))?.shape === 'collapsed');
  t('…with the strip RECORDED on the verdict, so the line can name the second byte it cost', footerReAnchoring(`${C_SENT}\n`, collapsedAfter(C_HEAD))?.strippedNewlines === 1);
  t('⭐ SHAPE B IS NOT WHAT LANDED: a whitespace-only truncation in the CONTENT still exits 4', rb({ sent: `${C_HEAD}\n\n${PLATFORM_COMMENT_FOOTER}`, stored: collapsedAfter(C_HEAD) }).exit === EXIT_NOT_STORED);
  const C_LOST = rb({ sent: C_SENT, stored: collapsedAfter(C_HEAD.replace('this', 'that')) });
  // ⛔ The falsified claim is ASSEMBLED, ⛔ never written out: `git grep` for
  // that sentence must read 0 in this file, and a pin that spells it reads 1.
  t('⛔ THE FALSIFIED SENTENCE IS GONE: the report no longer asserts the footer path removes nothing', notStoredText(C_LOST, 'o/n', 19048).includes(['takes', 'nothing', 'away'].join(' ')) === false);
  t('⭐ …and names all THREE measured shapes instead, the collapse included', notStoredText(C_LOST, 'o/n', 19048).includes('appends its block') && notStoredText(C_LOST, 'o/n', 19048).includes('moves a') && notStoredText(C_LOST, 'o/n', 19048).includes('COLLAPSES the blank line'));
  t('…while still saying the thing that decides it: something this act sent is not there', notStoredText(C_LOST, 'o/n', 19048).includes('something this act sent is not there') && notStoredText(C_LOST, 'o/n', 19048).includes('READ THE ARTEFACT'));

  // The collapse OVER the strip (#19312) — the shape a seat post's `--body`
  // write actually sends: the file ends in a newline and its last paragraph
  // stands a blank line above the rule, so three newlines go out before the
  // rule and the block's own two come back. 13 writes in one shift exited 4 on
  // it — 7 of 11 at 2026-09-20T21:40Z and 6 more at 22:31Z — every one with the
  // content whole on a fresh `GET`, which is the false NOT-STORED that invites
  // the duplicate re-post. The STORED byte counts are read off those cards; the
  // sent side is that reading's own transformation, ⛔ not a count nobody wrote.
  const liveCollapseOverStrip = (storedBytes) => {
    const head = 'x'.repeat(storedBytes - FOOTER_BYTES);
    return { sent: `${head}\n${PLATFORM_COMMENT_FOOTER}\n`, stored: `${head}${PLATFORM_COMMENT_FOOTER}` };
  };
  for (const live of [{ card: 19343, stored: 3585 }, { card: 19360, stored: 2892 }, { card: 19404, stored: 4623 }]) {
    const { sent, stored } = liveCollapseOverStrip(live.stored);
    const v = rb({ sent, stored });
    t(`⭐ THE FILED READING — the body of objectstack#${live.card}: ${live.stored} bytes stored, and the run before the rule 3 newlines sent to 2 stored`,
      Buffer.byteLength(stored, 'utf8') === live.stored && Buffer.byteLength(sent, 'utf8') === live.stored + 2, `stored=${Buffer.byteLength(stored, 'utf8')}`);
    t('…and it LANDED: exit 0, ⛔ not the 4 that told a seat thirteen landed writes were lost', v.landed === true && v.exit === EXIT_OK);
    t('…named by the collapse\'s own word, with the stripped newline RECORDED beside it', v.readBack.class === 'footer-blank-collapsed' && v.readBack.strippedNewlines === 1);
  }
  const OVER_STRIP = liveCollapseOverStrip(4096);
  t('⭐ the line names the SECOND byte out loud — ⛔ never "the one byte short" about a body two short',
    rb({ ...OVER_STRIP }).lines[1].includes('over 1 stripped trailing newline(s)') && rb({ ...OVER_STRIP }).lines[1].includes('every CONTENT byte sent IS stored'), rb({ ...OVER_STRIP }).lines[1]);
  t('⛔ THE CONTROL — one CONTENT byte different under the very same strip-and-collapse still exits 4',
    rb({ sent: `${C_HEAD}\n${PLATFORM_COMMENT_FOOTER}\n`, stored: `${C_HEAD.replace('this', 'that')}${PLATFORM_COMMENT_FOOTER}` }).exit === EXIT_NOT_STORED);
  t('⛔ …and a footer RELOCATED — the SAME bytes in another position, the card\'s own first claim — exits 4',
    rb({ sent: C_SENT, stored: `${PLATFORM_COMMENT_FOOTER}${C_HEAD}` }).exit === EXIT_NOT_STORED
      && Buffer.byteLength(C_SENT, 'utf8') === Buffer.byteLength(`${PLATFORM_COMMENT_FOOTER}${C_HEAD}`, 'utf8'));
  t('⛔ …so a MULTISET compare is still refused: equal bytes in a different order is not a normalisation',
    firstDifferingByte(C_SENT, `${PLATFORM_COMMENT_FOOTER}${C_HEAD}`) === 0);

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

  // -- #18843: a size refusal is a REFUSAL, and its text may not prescribe a
  // remedy the platform has already refused.
  //
  // The fixtures are the verbatim platform texts recorded on probe
  // objectstack#18826 (writes 5, 6, 8, 10 and 12) — ⛔ no new oversized write is
  // made to reproduce this, here or anywhere. What this battery floors is the
  // TRIGGER's two sides (the sentence it keys on, and every answer it must
  // leave alone), the CAP it names per surface, and the two remedies HELD APART
  // in both directions — a pin that only reads the size text goes green the day
  // exit 3's sentence creeps into it.
  battery('the size refusal: a 422 the platform answered is not a route that never existed');
  // Verbatim from objectstack#18826: the create side capitalises `Body`, the
  // update side does not, and `POST /issues` carries the sentence twice.
  const CREATE_422 = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'IssueComment', code: 'unprocessable', field: 'data', message: 'Body is too long (maximum is 65536 characters)' }],
    documentation_url: 'https://docs.github.com/rest',
  });
  const UPDATE_422 = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'IssueComment', code: 'unprocessable', field: 'data', message: 'body is too long (maximum is 65536 characters)' }],
  });
  const TWICE_422 = JSON.stringify({
    message: 'Validation Failed',
    errors: [
      { resource: 'Issue', code: 'unprocessable', field: 'data', message: 'Body is too long (maximum is 65536 characters)' },
      { resource: 'Issue', code: 'unprocessable', field: 'data', message: 'Body is too long (maximum is 65536 characters)' },
    ],
  });
  // The other 422 this tool can actually be answered with: the issues listing
  // refuses deep pagination (page 99 stores, page 100 refuses — measured
  // 2026-08-31). It is about a cursor and must keep its 3.
  const PAGINATION_422 = JSON.stringify({
    message: 'In order to keep the API fast for everyone, pagination is limited for this resource.',
    documentation_url: 'https://docs.github.com/rest',
  });
  const refuse = (raw, mode, sentBytes, status = 422) => sizeRefusal({ status, refusalText: platformRefusalText(raw), mode, sentBytes });
  const OVER_COMMENT = refuse(CREATE_422, 'comment', COMMENT_BODY_LIMIT + 1);
  const OVER_BODY = refuse(CREATE_422, 'body', ISSUE_BODY_LIMIT + 1);

  t('⭐ THE FILED READING: the create-side 422 is a size refusal, not a missing route', OVER_COMMENT !== null);
  t('⭐ …and the update-side spelling is the SAME class, though it is NOT the same string', refuse(UPDATE_422, 'comment', COMMENT_BODY_LIMIT + 1) !== null);
  t('⛔ …which is why the trigger is case-insensitive: the two measured sentences differ by one letter', CREATE_422.includes('Body is too long') && UPDATE_422.includes('body is too long'));
  t('the sentence said twice (the issue-create surface) is read the same way', refuse(TWICE_422, 'body', ISSUE_BODY_LIMIT + 1) !== null);
  t('⛔ THE CONTROL: the deep-pagination 422 is NOT this class — it keeps the prerequisite reading', refuse(PAGINATION_422, 'comment', 500) === null);
  t('⛔ …and neither is a 422 with no text at all', refuse('', 'comment', 500) === null);
  t('⛔ the same sentence on a 403 is not this class — the trigger needs BOTH halves', refuse(CREATE_422, 'comment', COMMENT_BODY_LIMIT + 1, 403) === null);
  t('⛔ …nor on a 500', refuse(CREATE_422, 'comment', COMMENT_BODY_LIMIT + 1, 500) === null);
  t('⛔ …nor on a 200, which no caller reaches through this path anyway', refuse(CREATE_422, 'comment', COMMENT_BODY_LIMIT + 1, 200) === null);
  t('the trigger reads the SENTENCE, so a text carrying no `maximum is` clause still classifies', sizeRefusal({ status: 422, refusalText: 'Body is too long', mode: 'comment', sentBytes: 300000 }) !== null);
  t("⛔ …and the platform's false clause ALONE does not classify — the class is never keyed on that number", sizeRefusal({ status: 422, refusalText: 'maximum is 65536 characters', mode: 'comment', sentBytes: 300000 }) === null);
  t('⛔ the exported trigger regex is not global — a `g` regex carries a cursor between callers', BODY_TOO_LONG_RE.global === false);
  t('⛔ …and the case-insensitivity lives on the DECLARATION, not retyped at the call site', BODY_TOO_LONG_RE.flags.includes('i'));

  t("the envelope's per-error message is read, which is where the sentence arrived", platformRefusalText(CREATE_422).includes('Body is too long (maximum is 65536 characters)'));
  t('…and the top-level one beside it, in that order', platformRefusalText(CREATE_422).startsWith('Validation Failed · Body is too long'));
  t('a body that is not that envelope falls back to its own bytes, never to silence', platformRefusalText('502 Bad Gateway') === '502 Bad Gateway');
  t('…and an empty answer is an empty string, never a throw', platformRefusalText('') === '' && platformRefusalText(undefined) === '');
  t('⛔ …and the text is never truncated where the trigger reads it', platformRefusalText(JSON.stringify({ message: `${'x'.repeat(REFUSAL_TEXT_CHARS * 2)} Body is too long` })).endsWith('Body is too long'));

  t('the comment surface names the comment cap', OVER_COMMENT?.cap === COMMENT_BODY_LIMIT);
  t('the issue-body surface names the issue-body cap', OVER_BODY?.cap === ISSUE_BODY_LIMIT);
  t('the two caps agree today — two bisections, one number', COMMENT_BODY_LIMIT === ISSUE_BODY_LIMIT);
  t('⛔ …and they are two constants, so the day one moves the other does not lie', WRITE_SURFACES.comment.cap === COMMENT_BODY_LIMIT && WRITE_SURFACES.body.cap === ISSUE_BODY_LIMIT);
  t("⛔ the cap is never the platform's own number", OVER_COMMENT?.cap !== undefined && OVER_COMMENT.cap !== 65536);
  t('…it is four times it, which is what was measured stored', OVER_COMMENT?.cap === 65536 * 4);
  t('⛔ a surface with no declared cap names none rather than inventing one', refuse(CREATE_422, 'reaction', 300000)?.cap === null);
  t('the surface table is frozen, so no caller edits a measurement in place', Object.isFrozen(WRITE_SURFACES) && Object.isFrozen(WRITE_SURFACES.comment));

  const OVER_TEXT = sizeRefusalText(refuse(CREATE_422, 'comment', 307200), 'objectstack-ai/objectstack', 18843);
  t('⭐ THE READER TEST: a 300 KB comment reads the bytes it SENT', OVER_TEXT.includes('307,200 byte(s)'));
  t('⭐ …the measured cap for THAT surface', OVER_TEXT.includes('262,144 bytes') && OVER_TEXT.includes('a comment'));
  t('⭐ …the overage between them', OVER_TEXT.includes('45,056 byte(s) over it'));
  t('⭐ …the remedy that can work', OVER_TEXT.includes(SIZE_REMEDY));
  t('⛔ …and NOT the remedy exit 3 prescribes, which this write already proved cannot work', OVER_TEXT.includes(ROUTE_REMEDY) === false);
  t('⛔ THE OTHER DIRECTION, so that pin cannot pass by the remedy drifting: exit 3 still prescribes it', prerequisiteNotMetText({ message: 'x' }).includes(ROUTE_REMEDY));
  t('⛔ …and exit 3 never prescribes the size one', prerequisiteNotMetText({ message: 'x' }).includes(SIZE_REMEDY) === false);
  t('the text names the endpoint the bytes went to', OVER_TEXT.includes('POST /issues/{n}/comments'));
  t('…and the bisection the cap came from', OVER_TEXT.includes('objectstack#18826'));
  t("…and quotes what the platform said, named FALSE in the same breath", OVER_TEXT.includes('maximum is 65536 characters') && OVER_TEXT.includes('FALSE in unit and value'));
  t('the size text keeps the other four codes apart by name', [EXIT_REFUSED, EXIT_PREREQUISITE_NOT_MET, EXIT_NOT_STORED].every((code) => OVER_TEXT.includes(`${code}'s`)));
  t('⭐ a reader of a 3 is told the fifth code exists, or the misclassification just moves', prerequisiteNotMetText({ message: 'x' }).includes(`${EXIT_TOO_LARGE}'s`));
  t('…and a reader of a 4 too', notStoredText({ readBack: { offset: 7 } }, 'o/r', 1).includes(`${EXIT_TOO_LARGE}'s`));
  t('the usage register carries the fifth code', USAGE.includes(`${EXIT_TOO_LARGE} TOO LARGE`));
  t('⛔ …and the prerequisite report prints what the platform said, when it said anything', prerequisiteNotMetText({ message: 'x', refusalText: 'Resource not accessible by integration' }).includes('The platform said: Resource not accessible by integration'));
  t('⛔ …and prints no such line for a throw that carries none, so the line means something', prerequisiteNotMetText({ message: 'fetch failed' }).includes('The platform said') === false);

  const AT_CAP = refuse(CREATE_422, 'comment', COMMENT_BODY_LIMIT);
  t('⭐ a refusal AT the measured cap is this class but is NOT explained by it', AT_CAP !== null && AT_CAP.explained === false);
  t('…and the overage is null rather than 0 — there is no overage to print', AT_CAP?.over === null);
  t('…so the text asks for a RE-MEASUREMENT instead of reporting a body over a cap it is not over', sizeRefusalText(AT_CAP, 'o/r', 1).includes('RE-MEASURE the cap'));
  t('⛔ THE CONTROL: the ordinary over-cap text carries no re-measurement sentence', OVER_TEXT.includes('RE-MEASURE the cap') === false);
  t('a refusal well UNDER the cap is unexplained the same way', refuse(CREATE_422, 'comment', 10)?.explained === false);
  t('…and an unrecorded size does not read as zero bytes sent', sizeRefusalText(refuse(CREATE_422, 'comment', null), 'o/r', 1).includes('a body of unrecorded size'));

  t('⭐ the exit register carries SIX distinct values — a caller reads exactly one', new Set([EXIT_OK, EXIT_USAGE, EXIT_REFUSED, EXIT_PREREQUISITE_NOT_MET, EXIT_NOT_STORED, EXIT_TOO_LARGE]).size === 6);
  t('…and the size refusal is the fifth code', EXIT_TOO_LARGE === 5);
  t('⛔ …standing apart from the transport failure it used to be reported as', EXIT_TOO_LARGE !== EXIT_PREREQUISITE_NOT_MET);
  t('⛔ …from the contract refusal, which is this tool\'s rule and not the platform\'s', EXIT_TOO_LARGE !== EXIT_REFUSED);
  t('⛔ …and from the write that HAPPENED and was not stored', EXIT_TOO_LARGE !== EXIT_NOT_STORED);

  // ⛔ The two positions the patrol reads are the other half of this tool's
  // contract, so every row here asserts the two halves AGREE about ONE body:
  // what the write side does with it, and what H56 would file on the bytes
  // that would have gone to the board. Both the reader and the row are
  // imported — this battery restates neither.
  battery('the two positions: a declaration renders as bare digits, and the patrol reads digits');
  {
    const READING = '2026-09-08T14:00Z'; // a real reading of something ELSE, two days back
    const STORED = '2026-09-10T06:37:55Z'; // the platform's write instant, seconds after this act's clock
    const posted = (body) => substituteTokens(body, stampNow(NOW_MS)).body;
    const patrolFiles = (body) => h56EstimatedStamp({ body: posted(body), created_at: STORED, updated_at: STORED }) !== null;
    const writeRefuses = (body) => stampRefusals(body, NOW_MS).length > 0;
    const agree = (body) => writeRefuses(body) === patrolFiles(body);
    const DECLARED_OPENING = `Unlock — upstream #18373 closed at {{WAS:${READING}}}.`;
    const DECLARED_SUB = `Seat post.\n\n<sub>read {{WAS:${READING}}}</sub>`;
    const DECLARED_IN_BODY = `Unlock — released {{NOW}}.\n\nUpstream #18373 closed at {{WAS:${READING}}}.`;
    const ACT_CLOCK_OPENING = 'Unlock — released {{NOW}}.';
    const HOLDOUT = `Verdict {{NOW}} — on the board read {{WAS:${READING}}}.`;
    const OWN_MINUTE = `Round opened {{WAS:${stampNow(NOW_MS)}}}.`;
    const TYPED_OPENING = `Claim: seat ${READING} — dispatched.`;

    t('⭐ THE FILED REPRO: a declared reading on the OPENING line is REFUSED', kinds(DECLARED_OPENING, NOW_MS).join() === 'positional-declared');
    t('⛔ WHY it used to pass: the positional walk read MASKED text, where a declaration is blanked', h56StampedReadings(maskQuotedStamps(DECLARED_OPENING)).length === 0);
    t('⭐ …while the patrol reads the RENDERED body, where the declaration is spent and the digits stand bare', h56StampedReadings(posted(DECLARED_OPENING))[0]?.stamp === READING);
    t('…and files a row on it, because a reading of something ELSE is not the write time', patrolFiles(DECLARED_OPENING) === true);
    t('⭐ PARITY: the two halves now answer the same about that body', agree(DECLARED_OPENING) === true);
    t('⭐ the SECOND position the card measured behaves identically', kinds(DECLARED_SUB, NOW_MS).join() === 'positional-declared' && agree(DECLARED_SUB) === true);
    t('the refusal names the position, the declaration and the digits it renders to', ['the opening line', `{{WAS:${READING}}}`, READING].every((s) => stampRefusals(DECLARED_OPENING, NOW_MS)[0]?.detail?.includes(s) === true));
    t('…and prescribes the act-clock token THERE, with the reading moved into the body', stampRefusals(DECLARED_OPENING, NOW_MS)[0]?.detail?.includes(STAMP_TOKEN) === true && stampRefusals(DECLARED_OPENING, NOW_MS)[0]?.detail?.includes('into the BODY') === true);
    t('⭐ THE CONTROL: the act-clock token at that position is ACCEPTED, and the patrol files nothing', writeRefuses(ACT_CLOCK_OPENING) === false && patrolFiles(ACT_CLOCK_OPENING) === false);
    t('⭐ …and the same declaration one line down is accepted, with the patrol silent there too', writeRefuses(DECLARED_IN_BODY) === false && patrolFiles(DECLARED_IN_BODY) === false);
    t('⛔ the patrol HOLDS OUT a rendered position carrying two stamps rather than guess, and so does this', h56StampedReadings(posted(HOLDOUT)).length === 0 && writeRefuses(HOLDOUT) === false && agree(HOLDOUT) === true);
    t('⛔ a declaration whose value IS this act\'s clock writes the bytes the token would, so it is not this refusal\'s business', writeRefuses(OWN_MINUTE) === false && patrolFiles(OWN_MINUTE) === false);
    t('⛔ the BARE scan is untouched and stays value-free: a typed stamp at that position is still refused', kinds(TYPED_OPENING, NOW_MS).join() === 'positional');
    t('…with ONE row, not two — the declared walk declines a position the bare scan already took', stampRefusals(TYPED_OPENING, NOW_MS).length === 1);
    t('…and its remedy no longer offers the quoted route AT the position, but in the body', stampRefusals(TYPED_OPENING, NOW_MS)[0].detail.includes('into the BODY') && stampRefusals(TYPED_OPENING, NOW_MS)[0].detail.includes(`{{WAS:${READING}}}`));
    t('⛔ a value the shape or direction rules already refused is not ALSO filed here — one typo, one refusal', kinds('read {{WAS:2099-01-01T00:00Z}}', NOW_MS).join() === 'quoted-in-the-future' && kinds('read {{WAS:2026-13-45T99:99Z}}', NOW_MS).join() === 'quoted-no-such-instant');
    t('structural: the walk runs over the body `substituteTokens` will SEND, and the reader is the patrol\'s own', /h56StampedReadings\(substituteTokens\(raw, now, spans\)\.body\)/u.test(stampSource) && new RegExp('function\\s+h56StampedReadings\\b').test(stampSource) === false);
  }

  battery('the shared rule: this tool and H56 cannot come to disagree');
  t('⭐ the positions this tool refuses are the ones H56 reads — one imported reader, never two', h56StampedReadings(maskQuotedStamps(OPENING)).length === 1);
  t('⭐ …so a body this tool accepts leaves H56 nothing in those positions', h56StampedReadings(maskQuotedStamps(TWO.body.replace(/2026-09-10T06:37Z/g, '{{NOW}}'))).length === 0);
  t('the tolerance is the imported constant, never a second number', H56_STAMP_TOLERANCE_MIN === 15);
  t('a stamp this tool substitutes is zero-drift against its own write instant', stampDriftMinutes(stampNow(NOW_MS), '2026-09-10T06:37:48Z') === 0);
  t('…and an estimate is beyond the tolerance by the same arithmetic', stampDriftMinutes('2026-09-10T05:27Z', '2026-09-10T06:37:48Z') > H56_STAMP_TOLERANCE_MIN);
  t('the exit register keeps a contract refusal apart from a transport failure', EXIT_REFUSED !== EXIT_PREREQUISITE_NOT_MET);

  battery('the keyed lines: a claim\'s exact-value fields, judged by the readers that own them');
  {
    const CLAIM = (...lines) => ['Claim: PM loop round 1', 'Session: `session_x`', ...lines].join('\n');
    const keys = (body) => claimKeyedLineRefusals(body).map((r) => r.key).join();
    const MISLAID_SEAT = 'Claim: PM loop round 1 — dispatched. Seat: domain:skills#2 — R1.';
    let ownerSource = ''; try { ownerSource = readFileSync(new URL('./check-half-states.mjs', import.meta.url), 'utf8'); } catch { ownerSource = ''; }
    t('⭐ a well-formed claim passes — every key reads', keys(CLAIM('Seat: `domain:skills#2`', 'Thread-read: 5747819898', 'Clause-②: no')) === '');
    t('⭐ the measured `Seat:` shape — declared inside the opening sentence — is REFUSED, on the OWNER\'s verdict and ⛔ no rule spelled here', keys(MISLAID_SEAT) === 'Seat' && claimSeatNumber(MISLAID_SEAT) === null);
    t('…and the refusal prints the spelling that reads', keyedLineRefusalText(claimKeyedLineRefusals(MISLAID_SEAT)).includes(CLAIM_KEY_SPELLINGS.Seat));
    t('a line-initial `Seat:` naming no number is refused too — the reader\'s other `null`', keys(CLAIM('Seat: domain:skills')) === 'Seat');
    t('⭐ the measured `Thread-read:` shape — a list of ids — is refused, named as a value H50\'s EQUALITY can never match', keys(CLAIM('Thread-read: 5747819898, 5752364802, 5747819899')) === 'Thread-read' && keyedLineRefusalText(claimKeyedLineRefusals(CLAIM('Thread-read: 1, 2'))).includes('EQUALITY'));
    t('`none` reads, and so does a backticked id the field reader unwraps', keys(CLAIM('Thread-read: none')) === '' && keys(CLAIM('Thread-read: `5747819898`')) === '');
    t('an id with the reason glued on, an EMPTY value and the UNFILLED placeholder are all refused', ['Thread-read: 5747819898 — the lane grading', 'Thread-read:', 'Thread-read: id of the newest comment, or none'].every((line) => keys(CLAIM(line)) === 'Thread-read'));
    t('a `Thread-read:` declared off the line start is refused, though the field reader calls it absent', keys(`Claim: x. Thread-read: 5747819898 was the tail.`) === 'Thread-read' && threadReadField('Claim: x. Thread-read: 5747819898 was the tail.').present === false);
    t('⛔ prose naming the key with no id behind it is not a declaration', keys('Claim: x. The Thread-read: line goes last.') === '');
    t('⭐ `Clause-②: yes — reasoning` is ACCEPTED — its reader\'s own control shape, ⛔ not tightened here', keys(CLAIM('Clause-②: yes — the ruling states it outright')) === '');
    t('⭐ …while the quoted-and-continued spelling that reader calls `describing` IS refused', keys(CLAIM('`Clause-②: yes` — the ruling states it outright')) === 'Clause-②');
    t('a value the clause reader cannot grade is refused', keys(CLAIM('Clause-②: YES')) === 'Clause-②' && keys(CLAIM('Clause-②: yes|no')) === 'Clause-②');
    t('⛔ ABSENCE is nobody\'s row here: no `Seat:` line is seat 1 by the owner\'s own default, and no clause line is no declaration to grade', keys(CLAIM('Thread-read: none')) === '' && keys(CLAIM('Seat: `domain:skills#2`')) === '');
    t('⛔ NOT a claim: a report carrying the same mislaid declaration is untouched', keys('os-dev-report\n\nThe claim declared Seat: domain:skills#2 mid-sentence.') === '');
    t('⭐ SCOPED by the fleet\'s marker, ⛔ not by the first line: a `Claim:` further down is judged', keys('Round report\n\nClaim: x. Seat: domain:skills#2 taken.') === 'Seat');
    t('⭐ QUOTE-BLIND: backticks round a mid-sentence declaration buy no exemption, while a line-initial one inside a FENCE still reads as the declaration the owner reads there — masking either way would store the row', keys('Claim: x, `Seat: domain:skills#2`, R1.') === 'Seat' && keys(CLAIM('```', 'Seat: domain:skills#2', '```')) === '');
    t('FIRST MATCH: a readable declaration followed by a malformed duplicate passes, exactly as the owner reads it', keys(CLAIM('Seat: `domain:skills#2`', 'Thread-read: 5747819898', 'Seat: domain:skills')) === '');
    t('↔ owner coupling: the id pattern and the `none` are `check-half-states.mjs`\'s own spellings, read off its source', ownerSource.includes('/^[1-9]\\d*$/') && ownerSource.includes("'none'") && THREAD_READ_VALUE.source.includes('[1-9]\\d*') && THREAD_READ_VALUE.test('none'));
    t('structural: the CLI runs this on `--comment` only, ⛔ never on a card body, and every reader is imported, ⛔ none restated', /const keyed = options\.mode === 'comment' \? claimKeyedLineRefusals\(rendered\.body\) : \[\];/u.test(stampSource) && new RegExp('function\\s+(claimSeatNumber|threadReadField|readClause2Line)\\b').test(stampSource) === false);
    t('the refusal names all three readers, and that no flag turns it off', ['claimSeatNumber', 'h50ThreadReadMismatch', 'readClause2Line', 'No flag turns it off'].every((s) => keyedLineRefusalText(claimKeyedLineRefusals(MISLAID_SEAT)).includes(s)));
  }

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
