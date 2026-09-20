#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-clause2-carriers — makes the clause-② enqueue gate's limbs LEGIBLE:
 * the dual carrier is asserted by mechanism, and a limb nobody can read is
 * reported as a missing reading rather than passing for a decision
 * (#13922 · #12409 · #13914).
 *
 *   node scripts/pm/check-clause2-carriers.mjs              # live sweep, report-only
 *   node scripts/pm/check-clause2-carriers.mjs --pair 13910 # ONE PR: a pre-arm predicate
 *   node scripts/pm/check-clause2-carriers.mjs --json       # the sweep, for round reports
 *   node scripts/pm/check-clause2-carriers.mjs --self-test  # offline, no network
 *   node scripts/pm/check-clause2-carriers.mjs --template   # the record, copyable; no network
 *   node scripts/pm/check-clause2-carriers.mjs --help       # usage; no network
 *
 * ## Every run STATES what it judged from (#18456)
 *
 * Every run past the board resolution closes with a fenced `clause2 input
 * record` block on stderr: the board and which of the three sources answered,
 * the read path and every request it issued, the pair and the evidence it was
 * derived from, the comments read, the claim comment SELECTED as the carrier
 * with the rule that selected it and every candidate it rejected, each pooled
 * claim's body fingerprint, and this file's own blob hash and path.
 *
 * ⭐ Two runs that DISAGREE about one pair are settled by DIFFING their two
 * blocks — ⛔ never by re-running until one side wins. The block has the same
 * field roster on every exit (0, 4, a refusal, a transport failure) precisely
 * so the diff is line for line, and the blob line says whether the two runs
 * were even the same instrument. The full reasoning is at INPUT_RECORD_VERSION.
 *
 * ## Which board this answers about, and how a reader can tell (#16623)
 *
 * The board is a PARAMETER, resolved once per run by `resolveSweepRepo`
 * (imported): `PM_SWEEP_REPO`, else `GITHUB_REPOSITORY`, else the default. It
 * is not a property of this checkout -- this file reads no BOARD DATA out of a
 * tree, so an environment variable really does retarget it, and a sibling repo's
 * seat runs `PM_SWEEP_REPO=<its repo> node scripts/pm/check-clause2-carriers.mjs
 * --pair N` to get an answer about its own board.
 *
 * ⚠️ Since #18456 it reads exactly ONE file out of the checkout: its OWN source,
 * for the blob hash the input record prints. That is provenance and nothing
 * else -- no state, row, count or exit consults it -- so the sentence above
 * holds where it matters and is amended rather than quietly left false.
 *
 * ⚠️ That was TRUE before this file said so, and saying so is the fix (#16623).
 * The filing seat grepped THIS file for a repo flag, found nothing, and
 * concluded the capability was absent -- while `resolveSweepRepo` sat in the
 * import block eight lines from where it stopped reading. The resolver already
 * returns `source` alongside `repo`; the run simply never printed it, so a
 * DELIBERATE target and the DEFAULT fallback rendered identically. Every run
 * now opens with a provenance line that names both.
 *
 *   # the SAME predicate with no private token and no network at all — the pair
 *   # pre-fetched into a document, named as a file or fed on stdin:
 *   node scripts/pm/check-clause2-carriers.mjs --pair 13910 --pair-json pair.json
 *   node scripts/pm/check-clause2-carriers.mjs --pair 13910 --pair-json -
 *
 * Since #16448 `--pair` also carries C5 — the WIDENING TELL row: a diff that
 * adds a schema key, a closed-set member, a published export or a registry
 * entry while its card declares `Clause-②: no`. The tells themselves live in
 * `check-widening-tells.mjs` (imported, with its own self-test); this file
 * supplies the declaration and the diff and joins them.
 *
 * ## The gate, and the three limbs it is supposed to stand on
 *
 * `scripts/pm/ensure-pm-labels.sh` states the gate in its own words: a PR whose
 * ACTUAL diff touches the contract surface — or whose CARD'S CLAIM COMMENT
 * declares `Clause-②: yes` (the content limb, judged from the card,
 * path-independent) — but which was dispatched below the contract-review tier
 * waits outside the queue under `needs:contract-review` until the review
 * sub-round clears it. So: ① a path limb, ② a declaration limb, ③ the label
 * itself, which the maintainer's ruling of 2026-08-22 puts on BOTH carriers
 * (「简化一点是否可以直接挂 PR 侧」「两边都挂好」).
 *
 * ## What already existed, and why this file is not it (measured, 2026-08-31)
 *
 * ⚠️ The filing card says the dual-carrier rule "has no enforcement at all" and
 * that "there is no check anywhere that a `needs:contract-review` on one
 * carrier implies it on the other". That is NOT true and the correction is the
 * reason this file has the shape it has: `h31ContractReviewCarrierSplit` in
 * `scripts/pm/check-half-states.mjs` is exactly that check, both directions, it
 * names the offending carrier, and it has a standing caller —
 * `.github/workflows/half-state-patrol.yml`, four times a day, last green
 * 2026-08-31T13:42:41Z. Building a second carrier comparison as though H31 did
 * not exist would have produced two predicates that can disagree about the same
 * pair, which is the drift this tree punishes everywhere else. So the split
 * comparison here IMPORTS H31's label constant and H31's delivery relation
 * rather than restating either.
 *
 * What H31 cannot do is the part the cards actually measured:
 *
 *   1. **Agreement on ABSENCE is H31's silent case, by construction.** It fires
 *      on a SPLIT. A pair carrying the gate on NEITHER carrier is, to H31,
 *      clean — and "silent on all three limbs at once" is precisely the shape
 *      #13922 measured live on PR #13910 / card #13476: the author had declared
 *      clause ② in their own PR body, and no limb was in a state to fire. A
 *      comparison of two carriers cannot report a gate that is missing from
 *      both of them.
 *   2. **Nothing reads limb ②.** The declaration lives in the card's claim
 *      comment in a FIXED machine spelling, and this repo had no reader for it
 *      at all — measured by grep over `scripts/` and `.github/workflows/`: the
 *      token appears in a label DESCRIPTION and in prose, never in a predicate.
 *      #13914 measured the consequence on the board: 2 of 3 cards in one review
 *      round carried the declaration as prose or in the PR body instead, and a
 *      card with no declaration is today indistinguishable from a card that
 *      declared `no`. One of those is a decision; the other is a missing
 *      reading, and they must not look the same.
 *   3. **Its delivery channel trims.** H31 is one row family among ~38 in a
 *      report rendered into one pinned issue body — measured on the 13:42Z run:
 *      231 findings, 74 rendered, "157 further row(s) omitted to fit GitHub's
 *      issue-body limit". A gate row competes for space on equal terms with
 *      board-hygiene rows, and the anchor then reads clean on the gate. This
 *      file answers one question and prints only its own rows, so nothing it
 *      finds can be crowded out by something else's inventory.
 *
 * ## What this file deliberately does NOT do
 *
 * **It does not evaluate limb ① (the path limb), and that is a boundary, not a
 * gap.** The contract surface is already declared once, in `SUSPECT_TIER_GLOBS`
 * in `scripts/pm/dispatch-gates.mjs`, whose own docblock insists the path
 * reading is "a HINT, never a verdict" because clause ② is judged from a card's
 * CONTENT. A second declaration of that surface here would be a hand copy of a
 * register — the exact drift `check:pm-governed-prose` exists to stop one
 * family over. C1–C4 are all derivable from the declaration and the two
 * carriers alone, and none of them costs a changed-file listing. C7 reads a
 * line out of a comment: free beside a gate clear, where the C6 pass already
 * fetched the thread, and ONE read per pair on the `--pair` path since #18174,
 * where the record is judged on every pair that has one.
 *
 * ⭐ C5 (#16448) is the one row that reads a DIFF, and it is still not limb ①.
 * Limb ① asks "does this card's file surface suggest the contract tier?" and
 * answers with a hint; C5 asks "does this diff have the SHAPE of a widening,
 * while its card declared `no`?" and answers about the pair. The tells, the
 * surfaces and the refusal sentence all live in `check-widening-tells.mjs`,
 * which IMPORTS `SUSPECT_TIER_GLOBS` rather than restating it — so the contract
 * surface is still declared exactly once in this tree. The maintainer's
 * condition on the directional clause-② ruling (#16349) was that the direction
 * claim become checkable instead of trusted, and this row is that condition;
 * `SUSPECT_TIER_GLOBS`'s own docblock had already promised the reading ("the
 * PR's ACTUAL diff passes the clause-② enqueue gate before the card may
 * enqueue — the diff is a fact; the card's semantics were a prediction") and
 * pointed at a gate that, until #16448, was a human.
 *
 * **It relaxes no spelling.** `Clause-②: yes` / `Clause-②: no` are the only two
 * readings that count, and prose is not one of them. #12409 measured where the
 * tolerant direction ends: on its corpus a strict `Contract review: PASS`
 * marker matched 5 of 35 removals while an "any PASS token" reading matched 26
 * — a check that can barely fail. Decoration around the line is tolerated the
 * way H4 tolerates it (a leading blockquote, a list bullet, backticks, bold),
 * because that is markdown a seat writes without meaning anything by it; the
 * KEY and the VALUE are literal. A near-miss spelling is reported IN the row so
 * the residue is actionable, and it still does not count as a declaration. So
 * is the other near miss, the one where the key is spelled exactly right and
 * sits mid-line after another field: that line is quoted back with a remedy
 * naming PLACEMENT rather than spelling, and it is not read as a declaration
 * either — what moved is the sentence, never the accept set.
 *
 * **POSITION means LINE-INITIAL, never TOP-OF-BODY (#17959).** The key must
 * open its own line modulo the decoration above; WHICH line it opens is a fact
 * this reader has never consulted. `readClause2Line` walks every line of the
 * carrier and answers from the first one that IS a declaration attempt, so
 * closing-keyword lines, a summary paragraph or a whole section above the
 * declaration hide nothing. ⚠️ Worth writing down because a human census read
 * it the other way and reported a merged PR as carrying no declaration at all.
 * Measured on PR #17819's merged head `b280ae29`, whose body opens with two
 * `Fixes` lines, a blank, and then a bold-wrapped declaration on line 4: this
 * reader answers `declared` / `no`, and so does the OTHER gate that reads the
 * limb — `check-changeset-no-major.mjs` imports THIS function and applies it to
 * `github.event.pull_request.body`, which is the `Check Changeset` step the
 * ruling named.
 *
 * ⭐ The same PR is the live control for the QUOTED-AND-CONTINUED tell, because
 * it carried BOTH shapes of one sentence. It was OPENED with the key inside a
 * backtick span the line then talks on outside of, and `Check Changeset`
 * refused that (run 34684118255, 2026-09-12T08:47:01Z, exit 1, "a near miss,
 * not a declaration", LEVEL AXIS NOT MEASURED); the seat rewrote the span as
 * bold, and the `edited` re-run on the SAME head read it (run 34684357221,
 * 08:52:36Z, "✓ LEVEL AXIS: this PR declares clause-② `no`"). ⛔ So no accept
 * set moves for this card: the bold form was already admitted, the
 * quoted-and-continued form was already refused, and a spelling widened to
 * make that red go green would have refused the very form this file's own
 * remedy sentence prescribes. What #17959 adds is the PIN and this paragraph.
 *
 * **It writes nothing.** No label, ever — hanging or clearing a review gate
 * from a checker would be issuing the review verdict, which is 自查放行 and is
 * the one thing the whole clause-② chain forbids. Same call H31 makes, for the
 * same reason.
 *
 * **It reads no verdict VALUE, and the PASS half of the recovery rule stays
 * human.** `references/contract-review.md` states the human reading as
 * 「PASS + 无标 + head 未动 = 已清标非被剥;head 后移或无结论才重挂」. C3
 * mechanizes the second and third conjuncts — 无标, from the labels, and
 * head 未动, from the head commit's date — and deliberately not the first:
 * #12409 measured a strict `Contract review: PASS` marker at 5 of 35 removals
 * against 26 for an "any PASS token" reading, i.e. a check that can barely fail,
 * and reading a verdict to clear a gate is the 自查放行 this file already
 * refuses. Consequence for a reader of exit 0: it means "the gate was bound by
 * the discipline and cleared, and nothing has moved since", NEVER "the review
 * passed". Precondition ① of the landing check is still a human reading a PASS
 * comment on the card.
 *
 * ⭐ C4, C6 and C7 are the ONLY things this file reads out of a verdict comment,
 * and none of the three is the verdict. C4 reads the `Implemented-by:` / `Reviewed-by:`
 * identity pair the verdict declares about its own AUTHORSHIP (a session id on
 * both, or a `mode:subagent` dev's BRANCH on the left — the grammar note beside
 * AUTHORSHIP_KEYS), on a comment recognised in EITHER live dialect — the fenced
 * `VERDICT:` marker or H51's `## Contract review` heading on this head, one
 * recognition shared with C6 (#17346, `isVerdictComment`). C6 (#17302) reads
 * that a review of record EXISTS on the
 * current head — H51's heading and head-sha facts, plus a `Reviewed-by:` line —
 * on a pair whose gate was already cleared. C7 (#17915, widened by #18174)
 * reads the third
 * provenance line, `Served-tier:` — WHAT served the round that produced the
 * verdict, on EVERY pair that carries a record rather than only beside a clear, which the reviewing seat reads out of its own transcript's
 * harness-stamped `model` field, ⛔ never off the dispatch `model` parameter,
 * which is configuration and not a reading — and refuses a clearance whose
 * token is not EXACTLY the NAME `CONTRACT_REVIEW_TIER`, the identifier-free
 * spelling `AGENTS.md` requires of a comment (#18060), on the comparison that
 * constant's own docblock declares and that nothing in this tree performed
 * before. No PASS or FAIL
 * token is read to reach any of the three, so the boundary above is narrowed by
 * exactly three facts and not crossed — a self-issued verdict is refused on WHO
 * wrote it, an unrecorded one on WHETHER it was written down, an off-tier one on
 * WHAT SERVED it, never on what any of them concluded — and all three rows are
 * report-only like every other one here.
 *
 * ## How a COMPLETED review is told from a gate that never ran (#14155)
 *
 * A `Clause-②: yes` declaration is HISTORY — it stays on the thread forever. The
 * label is STATE — a completed review clears it from both carriers, by rule. So
 * every clause-② pair that completes its review lands in exactly the shape C3
 * hunts: declared `yes`, gate on neither carrier. Measured 2026-09-01 on PR
 * #13864 / card #13657 — PASS at head `9af92aa3`, both carriers cleared nine
 * seconds apart, C3 fired on the legitimate clear. Read literally that made the
 * landing check's precondition ② unsatisfiable after its own clear: `--pair`
 * could only answer 0 in the window BETWEEN the PASS and the clear, which is the
 * wrong order, and every landed pair kept its C3 row on every later sweep.
 *
 * The evidence that separates the two needs no verdict comment: the **label
 * event stream** on each carrier. A gate that was bound leaves a `labeled`; a
 * review that completed leaves an `unlabeled`; a fail-open leaves neither. C3
 * therefore reads both carriers' streams and answers four distinguishable
 * states — never hung (the fail-open, the row as it was), hung-then-cleared with
 * the head unmoved (the completed state: clean), hung-then-cleared with the head
 * moved since (the 重挂-owed state), and bound on one carrier only (one removal
 * where a legitimate clear leaves two — the strip signature). An unreadable
 * stream is UNJUDGED, never clean.
 *
 * **The cost stays bounded**: streams are fetched for pairs already in C3's
 * candidate shape (declared `yes`, bare on both carriers) and for nobody else,
 * and the head commit only once both carriers read cleared. `needsGateHistory`
 * is the one predicate the reader and the UNJUDGED accounting share, so the set
 * that owes a stream and the set that gets one cannot drift apart.
 *
 * ## One PR, two cards — the FOURTH reading of the declaration limb (#16304)
 *
 * The declaration limb is keyed on the CARD, and the judgement it reads is a
 * property of the PR's CONTRACT INCREMENT. Those coincide for the one-card /
 * one-PR case C2 was built on (#13910/#13476, #13914), and they come apart the
 * moment one PR delivers two cards. Measured on PR #16243, which carried
 * `Fixes #15542` and `Closes #15854` on two separate lines: `--pair 16243`
 * derived BOTH pairs, the first read `Clause-②: yes` from #15542's claim
 * comment, and the second exited 4 naming a remedy no legitimate act could
 * supply. #15854's own maintainer ruling (`5557098503`) reads 「both halves are
 * one `domain:spec` PR, and this card closes when that PR lands」, so it is
 * never separately dispatched and never receives a claim comment; this file's
 * own ⛔ forbids writing one on the claiming seat's behalf, and that card
 * additionally carried `pm:retriage`, where a `Claim:` is a dispatch act the PM
 * protocol forbids outright.
 *
 * ⚠️ The PAIRING was not wrong, and that is what narrows the question. GitHub
 * itself closed #15854 one second after the merge, on the same relation
 * `prDeliversCard` read. The predicate asks the RIGHT cards; it asked one of
 * them in a PLACE that a legitimate workflow cannot fill without manufacturing
 * the artifact the checker looks for. What was missing was never the judgement
 * — it sat on #15542 twice before any code was written — but a SECOND
 * machine-readable copy of it, on a card whose protocol gives it no carrier.
 *
 * ⭐ So the limb gets a FOURTH READING rather than a wider predicate: *a card
 * delivered by a PR whose SIBLING card carries the declaration*. It prints a
 * row of its own — naming the card, the delivering PR, the sibling that carries
 * the declaration and the value read from that sibling's claim — and it does
 * not exit 4.
 *
 * ⛔ What it is NOT, in three parts, because each is a direction this file has
 * already refused somewhere else:
 *
 *   1. **It relaxes no spelling.** The sibling's declaration is read by the
 *      SAME `cardDeclaration` over the SAME imported `CLAIM_COMMENT_MARKER`,
 *      and only a `declared` state on that sibling's own claim comment counts.
 *      Prose on the sibling is still prose, a near miss is still a near miss.
 *      #12409's boundary is untouched: the gap was in WHICH CARRIER IS ASKED,
 *      never in WHAT COUNTS AS AN ANSWER.
 *   2. **It narrows `prDeliversCard` by not one card.** The pair is derived
 *      exactly as before and still gets a row of its own; the delivery relation
 *      is the sibling module's and is neither restated nor filtered here. (That
 *      was direction 2 in the filing, and the landing measurement excluded it —
 *      teaching the predicate to stop asking about a card a PR really delivers
 *      removes the very population the enqueue gate exists to cover.)
 *   3. **It cannot read a #13914-class absence as declared, by construction.**
 *      The reading fires ONLY when the subject card has NO CLAIM COMMENT AT ALL
 *      — the `absent` state, which is exactly the state a never-separately-
 *      dispatched card is in — and ONLY when some OTHER card of the same
 *      delivering PR declares. A card that WAS dispatched carries a claim
 *      comment by protocol, so a dispatched card whose declaration line is
 *      missing reads `missing`, not `absent`, and keeps its C2 row and its
 *      exit 4. And #13914's own shape is one card and one PR: it has no sibling
 *      to read, so it cannot reach this row at all. Both halves are pinned as
 *      CONTROLS in the self-test, beside the #16243 specimen.
 *
 * ⚠️ What the row asserts is therefore a LOCATION, never a substitution: the
 * declaration governing this PR's increment exists, in the fixed spelling, on
 * the sibling it names — and a reader must still satisfy themselves that it
 * covers THIS card's half of the increment. That is precisely why the reading
 * PRINTS rather than going quiet, and why it is a fourth reading rather than a
 * silent pass.
 *
 * ## C6 — a record owed on this head, and none behind it (#17302; lane-keyed by #18536)
 *
 * The lane rule (the maintainer's, restated on #18536 — 「曾经要求只有 spec 和
 * skills 需要 fable,其他 opus 就够了,理论上其他车道不需要契约复审」) owes the
 * contract review at `CONTRACT_REVIEW_TIER` in the spec and skills lanes on
 * EVERY delivered round, `Clause-②: yes` or `no`, and in no other lane: there
 * the three landing pre-checks and the gates are the whole bar, ⛔ no
 * default-tier "self-review" record is demanded and ⛔ no at-tier subagent is
 * spawned. A `yes` outside those two lanes is a limb hit, and limb-hit work is
 * the spec lane's whichever seat found it — it MOVES there rather than being
 * reviewed where it sits. Until #17302 nothing named WHERE a review of record
 * lives or what it must contain. Measured on one
 * window by the director's leak sweep: five `Clause-②: yes` merges whose
 * carriers were hung and cleared (or never hung) with NO review-like comment on
 * the PR or its card except the dev's own `os-dev-report`. Clearing the carrier
 * was indistinguishable from never reviewing, and `--pair` — the landing
 * check's own ② — read every one of them as the COMPLETED state and answered 0.
 *
 * `references/contract-review.md` now names the record: ONE comment on the PR
 * or its card, in the shape the tier verdict already has minus the tier line —
 * 「复核记录 = 一条评论落 PR 或卡,席内与子代理同形」, 「同形 = `## Contract
 * review` 题头、所审 head sha 独占码段、①②③ 逐项、独立性对、PASS/FAIL」 — and
 * makes every clear cite it (「凡清标同笔留 provenance 评论,引记录 id 与所判
 * head」, 「清标缺引记录即半态」). C6 is the machine half of that sentence: on a
 * pair in the COMPLETED state (declared `yes`, cleared on both carriers, head
 * unmoved — `gateBindingState`, unchanged) — and, since #18536, on a `Clause-②:
 * no` pair whose CARD sits in a lane that owes the review on every round
 * (`laneOwesReview`, read off the card's `domain:*` labels) — it reads the PR's thread and the
 * card's for a comment in H51's measured shape — a level-2 heading beginning
 * `## Contract review` and this head's sha as a code span, both IMPORTED from
 * `check-half-states.mjs` rather than restated — that also carries a
 * `Reviewed-by:` line, read by C4's own key regex. Absent ⇒ a FINDING row and
 * exit 4; present ⇒ a NOTE naming the comment, so the provenance comment can
 * cite it; present without the line ⇒ a finding that names the comment and the
 * missing line.
 *
 * ⛔ A FINDING, not an advisory, and the file's own table decides that: the row
 * is a fact about THIS pair at its own landing moment — a gate cleared with
 * nothing behind it — and an adverse fact rendered as 0-with-a-message is the
 * silence this file exists against. It re-blocks no legal workflow: under the
 * rule text the record precedes the clear, so a pair that followed it reads
 * clean, and a pair cleared before the text landed owes exactly one comment —
 * the review its seat already performed, written down — before `--pair` will
 * answer 0. The sweep stays report-only (rows print, exit 0), so the board-wide
 * transition costs nothing; only a pair being landed is judged.
 *
 * ⛔ What it does NOT read, and why. No verdict WORD: H51 is verdict-agnostic by
 * construction, this file's header bans verdict-reading as 自查放行, and the
 * live corpus already writes the word two ways (a fenced `VERDICT: PASS` on the
 * 2026-09-01 board that C4's discriminator was measured on; `**Verdict: PASS
 * WITH FINDINGS**` under an `## Contract review` heading on every 2026-09-09
 * specimen) — a regex for it would be a third spelling, the "check that can
 * barely fail" #12409 measured. ⭐ #17346 answered the same two dialects the
 * other way round, and it is worth reading as one decision: C4 now recognises
 * a verdict COMMENT in both (`isVerdictComment`, H51's two facts reused), while
 * neither row reads the verdict WORD in either. What a comment IS stays
 * measurable; what it CONCLUDED stays human. No ①②③
 * line items: they are prose the seat reads. So exit 0 still means "a review of
 * record exists on this head and names a reviewer", never "the review passed";
 * precondition ① of the landing check stays human.
 *
 * ## The self-solvable exit — one CORRECTION comment (#17366)
 *
 * The declaration limb was a ONE-WAY DOOR, and it was measured five times in
 * one shift across two roles: a seat writes the line as prose, the reader
 * above correctly refuses it, and the seat then has NO sanctioned act that
 * repairs it. The MCP GitHub tool set has no edit-an-issue-comment call, so a
 * seat holding only that set cannot rewrite the line it wrote; the claim
 * protocol forbids a second `Claim:`; and this file's own ⛔ forbids the
 * checker filling the line in. Three closed doors left a green PR — 38 checks,
 * 0 failures — waiting on somebody OUTSIDE the repository to retype one line.
 * That is the cost the card priced: not time, a human.
 *
 * ⭐ The exit is a FOURTH act, performable with the one tool a seat certainly
 * has — posting a comment — in a shape fixed tightly enough that reading it
 * relaxes nothing:
 *
 *     Clause-②-correction: 5642248126
 *     Clause-②: no
 *     Session: `session_01MCLBsUgfykL74aU716rzVK`
 *
 * The FIRST line's key names, in digits, the CLAIM COMMENT ID this comment
 * corrects. The newest correction naming the card's governing claim supersedes
 * that claim's declaration — in BOTH directions, so a wrong VALUE is repaired
 * by the same act as an unreadable one. A correction naming any other comment
 * is IGNORED WITH A PRINTED REASON, never silently.
 *
 * ⛔ Three things it is not, each one a direction this file already refuses:
 *
 *   1. **It relaxes no spelling.** The declaration inside a correction is read
 *      by the SAME `CLAUSE2_KEY_LINE` through the SAME `readClause2Line`, so
 *      prose in a correction is prose exactly as it is in a claim. What moved
 *      is WHICH COMMENT may carry the declaration — the same move #16304 made
 *      when it asked a sibling CARD — never what counts as an answer. #12409's
 *      boundary moves by not one character, and the card's own five measured
 *      prose spellings are pinned as negatives in the self-test.
 *   2. **It is not a second `Claim:`.** The first line carries a key of its
 *      own, which `CLAIM_COMMENT_MARKER` does not match, so a correction never
 *      enters the claim pool, never becomes the governing claim and cannot
 *      re-dispatch the card. It is also excluded from the MISPLACED scan: a
 *      recognised correction is this limb's designated second carrier, not a
 *      declaration written in a place the predicate does not look.
 *      ⭐ The prohibition this exit exists for — 「the claim protocol forbids a
 *      second `Claim:`」, three lines up — had no enforcing reader until
 *      #18828: a seat that wrote the second line anyway was RANKED, not
 *      refused, and the record called it a SUPERSESSION at exit 0.
 *      `claimRepeats` / `c8SecondClaimSameSeat` downstairs are that reader, and
 *      the correction above is the first of the two acts its remedy names.
 *   3. **It is not the checker filling anything in.** The value is the seat's
 *      own, written by the seat, in the fixed spelling. This file reads it and
 *      still writes nothing.
 *
 * ## Attribution: a DECLARED identity, and why that is the honest ceiling
 *
 * A correction must be the CLAIMING seat's own act, or it is one seat
 * declaring on another's behalf — the thing the C2 row's ⛔ forbids. The
 * carrier is the `Session:` line the claim protocol already makes mandatory
 * (SKILL.md 〈模板与表〉, 「session ID 不可省」, and 「`mode:subagent` 的 dev 与
 * PM 同会话同 ID」 — so the session is exactly the granularity of "the claiming
 * seat"), and a correction is ATTRIBUTED when its `Session:` equals the
 * governing claim's.
 *
 * ⚠️ That is a DECLARED identity, never a verified one. The value is copyable
 * text, and under this fleet's shared GitHub identity `user.login`
 * distinguishes nobody — which is precisely why the comparison is on the
 * declared session rather than on the comment's author. It is the ceiling C4
 * already works at: what a comment SAYS about its own authorship is
 * measurable, who typed it is not.
 *
 * ⛔ And no branch of it may become a NEW one-way door, which is the defect
 * this whole section exists to remove. A correction whose session differs from
 * the claim's, or which carries no `Session:` line, is ignored with a reason
 * that NAMES AN ACT THE CLAIMING SEAT CAN PERFORM — post one from the claiming
 * session — rather than a state nobody can leave. And a governing claim that
 * carries no `Session:` line at all leaves nothing to compare: the correction
 * APPLIES, and the note says attribution could not be verified and why.
 * Refusing there would have rebuilt the door one room over.
 *
 * ## The three read paths — a seat's ACCESS must not decide whether ② is checkable
 *
 * Precondition ② is read by the seat that LANDS the pair, and the carrier
 * defects that provoked this widening all happened in sessions whose GitHub
 * access was MCP-only. A checker that runs only where a private token is
 * exported is not a check on those pairs; it is a check somewhere else. So the
 * reads are tried in a fixed order, and the order is REPORTED rather than
 * assumed:
 *
 *   (i)   `GITHUB_TOKEN` / `GH_TOKEN`, when the environment exports one — still
 *         the first choice: the largest budget, and the only path that can read
 *         a private board at all. ⭐ A credential the API REFUSES (401/403) is
 *         retired for the rest of the run instead of failing the read, because
 *         a stale or scope-poor token must never make a PUBLIC pair unreadable
 *         — that is the one shape where a single-path reader answers "unread"
 *         about a pair anyone can read.
 *   (ii)  the same request with NO `authorization` header. These boards are
 *         public, so this reads them; the reader has always omitted the header
 *         when no token was exported, and what changes here is that the path is
 *         DECLARED, reachable as a fallback from a refused token, and reported.
 *         ⚠️ Who serves a header-less read is NOT settled by its success —
 *         measured 2026-09-04 from a CCR container: a header-less read of a PR
 *         answered HTTP 200 carrying `x-ratelimit-limit: 15000`, and a
 *         header-less `GET /user` answered with an identity, i.e. the egress
 *         proxy attaches a credential of its own. GitHub's documented ANONYMOUS
 *         core budget is 60/hour per IP. Both regimes are in play depending on
 *         where this runs, so a run PRINTS the `x-ratelimit-remaining` it
 *         actually saw and ⛔ never states a budget it did not measure.
 *   (iii) `--pair-json FILE`, or `--pair-json -` for stdin — the pair
 *         PRE-FETCHED into a document and judged with no network at all, which
 *         is the path an MCP-only seat has. Naming a document makes it the
 *         WHOLE input: nothing is fetched, so the reading is exactly
 *         reproducible and can never be half a document and half a live board.
 *         The document is written in the API's own shapes, so nothing is
 *         re-parsed on the way in and no second reader can drift from the live
 *         one:
 *
 *           {
 *             "repo":     optional — the `owner`/`name` string this run
 *                         resolved. A disagreement is REFUSED, never judged.
 *             "pulls":    [ one `/pulls` row per PR: number, draft, body,
 *                           head.ref, head.sha, labels ]  (or "pull", one row)
 *             "cards":    { "13476": the `/issues/N` payload }
 *             "comments": { "13476": the `/issues/N/comments` rows }
 *                         — the SAME bag, keyed by the PR NUMBER, carries the
 *                         PR's own thread (a PR is an issue at that endpoint),
 *                         owed by a pair in the COMPLETED state for C6
 *                         (#17302) and — on the `--pair` path — by EVERY pair,
 *                         whose record C7 judges (#18174); omitting it there
 *                         reads `null` → the pair is UNJUDGED, never a missing
 *                         record.
 *             "events":   { "13476": the `/issues/N/events` rows }  — optional
 *             "commits":  { "HEAD-SHA": { commit: { committer: { date } } } }
 *                         — optional
 *             "files":    { "13910": the `/pulls/N/files` rows }  — optional,
 *                         keyed by PR NUMBER (not card), because that is what
 *                         the endpoint is keyed by. Owed only by a pair whose
 *                         card declares `Clause-②: no`; omitting it there
 *                         reads `null` → C5 UNJUDGED, never a narrow diff.
 *           }
 *
 *         ⛔ A key the document does not carry reads `null`, which is UNJUDGED
 *         — never an absent label, never an empty thread. A comments entry
 *         present and empty is a real empty thread; OMITTING it is a missing
 *         reading, and #4690 is the whole reason those two must not look alike.
 *
 * ⛔ Exit 2 keeps its meaning — "the pair could not be formed, so nothing about
 * it was judged", never a clearance — and every refusal now NAMES the paths
 * tried, so a seat can tell "no network reached this board" from "that PR is
 * not open".
 *
 * ## Which channel answered, per RESOURCE — the per-seat fact (#16833)
 *
 * The path report above is about the RUN. It cannot answer the question a seat
 * actually has when `--pair` goes UNJUDGED at step ② of 落地前检: *my* container
 * answered `403` on this carrier's `/issues/N/events`, and two other containers
 * that re-took the same reading answered `200`. Before this, "the stream is
 * unreachable" was a GLOBAL assumption standing in for a PER-SEAT fact, and the
 * only way to find the delta was for a seat to notice it by accident.
 *
 * So every read this run could not complete is recorded WHERE IT FAILED — the
 * channel it was tried on, in the same `(i)`/`(ii)`/`(iii)` spelling the path
 * report uses, and what the platform answered on it (an HTTP status, a
 * transport fault with no status at all, a page cap that went short, or the
 * `--pair-json` bag and key the document omits) — and rides on the pair as
 * `pair.reads`, so the UNJUDGED sentence names the CHANNEL, the ANSWER and the
 * CARRIER together.
 *
 * ⛔ Three things this deliberately is NOT. It is not a new evidence source: no
 * predicate reads `pair.reads`, and an evidence source merely ASSUMED readable
 * is exactly what would turn today's honest exit 2 into a silent clearance.
 * It is not a relaxation: an unread stream is as unread as it ever was, the
 * pair is as UNJUDGED, and 0/1/2/3/4 keep their meanings to the letter. And it
 * is not an inference: a read with no recorded answer SAYS so rather than
 * borrowing the last channel that happened to work, because a diagnosis that
 * guesses is worse than one that is absent.
 *
 * ## The request budget, per run
 *
 * `--pair N`: one open-PR listing page (100 PRs per page) plus 2 reads per card
 * the PR delivers (the card, its comment thread). ⚠️ The thread is a LADDER
 * rather than a request (#18683): one page per 100 comments up to
 * `COMMENT_PAGE_CAP`, so a thread of 99 comments or fewer is the one read this
 * paragraph has always described, a thread of exactly 100 costs two (a full
 * page is indistinguishable from a finished one), and the longest thread on
 * this board on 2026-09-17 — 895 comments — would cost nine. No card in the
 * clause-② population reached 15 that day, so the totals below are measured
 * ones rather than upper bounds. A C3 candidate adds its two
 * carriers' event streams (one page each on this board) and — only once both
 * read cleared — one commit: ≤5 reads for a candidate pair, 2 for every other.
 * A pair whose card declares `Clause-②: no` adds ONE more — its changed-file
 * listing, for C5 (#16448). Its PR's own comment thread is one read too, cached
 * per PR so a two-card PR pays once, and it is owed by two different
 * populations: in BOTH modes by a pair in the COMPLETED state, for C6 (#17302),
 * and on the `--pair` path by EVERY pair, because C7 judges the record wherever
 * one exists (#18174). The sweep pays the listing once and the same
 * per-pair cost for every pair it derives. ⇒ a `--pair` run costs 4–9 requests,
 * while a 29-PR sweep costs about 60 — measured at 64 on 2026-09-17, 28 pairs,
 * with and without the comment ladder alike — which is about GitHub's documented
 * anonymous hourly budget, one more reason the run prints the remaining count
 * instead of assuming it.
 *
 * ⭐ Those two reads are `--pair` ONLY, and the asymmetry is deliberate. Paying
 * either per sweep pair would push a routine sweep past the anonymous budget it
 * already sits on, and an adverse fact on somebody else's pair is a board fact
 * rather than a verdict about the PR that happens to run CI next — the same
 * call the sweep/`--pair` split already makes for every other row here. In a
 * sweep `pair.files` is therefore `undefined`, which no row reads, and a
 * non-gated pair's `prComments` is undefined too, which the locator reports as
 * a gap nobody asked it for — so the `--pair` path alone asks
 * (`locatedRecordUnjudged`). `null` means a read that WAS owed came back short,
 * and that is UNJUDGED.
 *
 * ## Exit codes — the refusal to read as clean, in one table
 *
 * Sweep mode (default, and `--json`):
 *   0  swept COMPLETELY. Zero rows and forty rows both exit 0: a board fact is
 *      not a fact about whichever PR happens to run CI next, so failing a build
 *      over it would punish the wrong actor (`check-half-states.mjs`'s header
 *      argues this at length, and this file is the same family).
 *   1  bad usage — could not sweep at all. Since #16623 this also covers an
 *      argument this file does not honour: it is refused BEFORE any read, so
 *      the refusal is about the invocation and never about a board.
 *      ⛔ Deliberately NOT 2, which `dispatch-gates.mjs` uses for the same
 *      refusal — 2 here is a VERDICT (UNJUDGED), and a seat reading `$?` must
 *      never be able to read a mistyped invocation as an incomplete sweep.
 *      `--help` is not an error: it answers and exits 0, also before any read.
 *   2  swept, but INCOMPLETE: at least one pair whose card, labels or comments
 *      could not be read. An unread carrier is NOT a bare carrier and an unread
 *      thread is NOT an absent declaration (#4690): incomplete must never read
 *      as clean, which on a report-only tool is the sharper risk, because a
 *      quiet run looks exactly like a healthy board.
 *   3  PREREQUISITE NOT MET — the transport could not reach the API at all.
 *      The constant is imported from `check-half-states.mjs` so the family has
 *      ONE code for this, and that script's `--probe` is the one classifier;
 *      this file points at it rather than growing a second one.
 *
 * `--pair` is a PREDICATE about the pair named on the command line — a fact
 * about THAT PR, which is why it may answer adversely where the sweep may not.
 * It shares 1/2/3 with the sweep and adds one code of its own:
 *   0  the pair's clause-② limbs are legible and its carriers agree — which
 *      INCLUDES the completed state: a declared `yes` whose gate was hung on
 *      both carriers, cleared from both, and whose head has not moved since
 *      (#14155) — and whose governing verdict, if it carries the authorship
 *      pair at all, was not issued by the session that wrote the diff.
 *      ⚠️ 0 is not "the review passed"; the PASS reading is human and
 *      is precondition ① of the landing check, not this exit code.
 *      ⭐ Since #16304 it also covers the FOURTH READING: a card carrying no
 *      claim comment of its own, delivered by a PR whose sibling card carries
 *      the declaration. The limb IS read — in the fixed spelling, from a
 *      carrier the PR itself designates by delivering it — so the pair is
 *      neither UNJUDGED nor adverse, and a row prints saying where the
 *      declaration lives and what it reads. ⛔ That is not the
 *      "0-with-a-message" the entry for 4 below bans: that ⛔ forbids
 *      rendering an ADVERSE verdict as 0, and this reading is not one.
 *   2  also the answer when a C3 candidate's event stream or head commit could
 *      not be read, when a `Clause-②: no` pair's changed-file listing could
 *      not be, or when a PR thread could not be — a COMPLETED pair's or a
 *      spec/skills-lane `no` pair's, which C6 owes (#17302, #18536), or, on
 *      the `--pair` path, ANY pair's, whose record C7
 *      judges (#18174): an unread
 *      stream is not a never-hung gate, an unread diff is not a narrow one and
 *      an unread thread is not a missing record, so all are UNJUDGED rather
 *      than either verdict.
 *   4  they do not — or, since #16448, the declaration reads `no` while the
 *      diff carries a widening tell (row C5) — or, since #17302, the gate was
 *      cleared on both carriers and no review of record names the head (row
 *      C6) — or, since #18536, the card sits in the spec or skills lane, the
 *      declaration reads `no`, and no review of record names the head (row C6
 *      as well: the lane owes the record on every round) — or, since #17915
 *      and on every pair carrying a record since #18174,
 *      the record's `Served-tier:` line does not read at the declared tier (row
 *      C7) — or, since #18862, two or more LIVE claims by DIFFERENT authors
 *      stand on the card with no `Release:` from the earlier holder between
 *      them and the taking claim is dated after
 *      `CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT` (row C9; a hand-over dated at or
 *      before it is a note, never the exit). One exit code with several
 *      adverse reasons is the shape this table already had: the ROW says which,
 *      and the exit says only "a verdict about this pair, adverse".
 *      Deliberately NOT 3: a verdict about the PAIR must be
 *      impossible to confuse with "the environment could not answer", so a
 *      seat reading `$?` cannot turn a refusal into a clearance. And ⛔ never
 *      0-with-a-message: silence is what this whole file exists against.
 *      ⛔ And it is NOT the fourth reading (#16304). That reading is not a
 *      verdict about the pair at all: the limb is legible, on the carrier the
 *      PR designates. Giving it a NEW non-zero code would have been the same
 *      refusal wearing a different number — `references/contract-review.md`
 *      states the landing check's ② as 「0 = 双肢一致…4 = 任一不成立」, so any
 *      non-zero re-blocks the legal workflow this reading exists to unblock,
 *      while telling a seat nothing the ROW does not already say. The row says
 *      which; the exit says only the class. That split is this table's rule,
 *      not an exception carved for this case.
 *
 * ## The standing caller
 *
 * On demand, and the PM round — the `check:pm-governed-merges` posture, whose
 * live half has no schedule either. The `check:pm-clause2-carriers` step in
 * `lint.yml` runs the SELF-TEST only: the sweep reads a shared board over the
 * network and its non-zero exits classify the ENVIRONMENT, which is not a
 * verdict about the PR running it. ⛔ Do not "promote" the sweep into that step
 * — that would be a new merge gate over board state, which is the thing the
 * family has already decided against three times.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  CLAIM_COMMENT_MARKER,
  CONTRACT_REVIEW_HEADING_MARKER,
  CONTRACT_REVIEW_LABEL,
  DEFAULT_SWEEP_REPO,
  EXIT_PREREQUISITE_NOT_MET,
  H51_SHA_MIN_HEX,
  PROXY_FLAG,
  RELEASE_COMMENT_MARKER,
  SWEEP_REPO_SHAPE,
  branchNameTarget,
  closingKeywordTargets,
  contractReviewHeadMatch,
  deliveryEvidence,
  deliveryEvidenceNote,
  partOfTargets,
  claimGovernance,
  claimedBranches,
  governingClaim,
  isGateSemanticLabel,
  labelNames,
  latestMarkedComment,
  markerMatches,
  ownershipMarkerNearMisses,
  prDeliversCard,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';
import {
  EXIT_INCOMPLETE as WT_EXIT_INCOMPLETE,
  EXIT_OK as WT_EXIT_OK,
  EXIT_REFUSED as WT_EXIT_REFUSED,
  EXIT_USAGE as WT_EXIT_USAGE,
  REFUSAL_SENTENCE,
  refusalLines,
  wideningRefusal,
} from './check-widening-tells.mjs';
// The tier the strip is judged against. IMPORTED, never restated: its own
// docblock makes `dispatch-gates.mjs` the one line in `scripts/pm/**` and
// `.claude/skills/pm-dispatch/**` where the model id is spelled as a VALUE,
// and a second value site here is exactly the drift that let the declared
// tier and the served one differ unnoticed (#17915).
import { CONTRACT_REVIEW_TIER } from './dispatch-gates.mjs';

/**
 * The lanes that OWE a review of record on EVERY round they deliver -- the
 * maintainer's lane rule, restated on #18536 and carried into
 * `references/contract-review.md` 「按车道」: the contract review at
 * `CONTRACT_REVIEW_TIER` is owed in the spec and skills lanes, `Clause-②: yes`
 * or `no`, and in no other lane. Read off the CARD's labels: `domain:*` is
 * produced by triage and lives on the card, never on the PR. ⛔ Not a second
 * statement of the policy -- the reference is the rule; this list is the one
 * predicate `--pair` reads from it, and the self-test pins it at exactly two.
 */
export const LANES_OWING_REVIEW = Object.freeze(['domain:spec', 'domain:skills']);

/**
 * Does this pair's CARD sit in a lane that owes the review of record on every
 * round? `null` when the card's labels could not be read -- already an UNJUDGED
 * gap in `pairUnjudged`, so no reader here turns a missing read into 「not
 * owed」. ⛔ Says nothing about a `yes`: a `Clause-②: yes` is a limb hit and is
 * owed wherever it sits (limb-hit work is the spec lane's, whichever seat found
 * it -- see `c6NoReviewOfRecord`); this predicate only widens the owed
 * population to the `no` rounds of the two lanes.
 */
export function laneOwesReview(pair) {
  const labels = pair?.cardLabels;
  if (!Array.isArray(labels)) return null;
  return labels.some((name) => LANES_OWING_REVIEW.includes(name));
}

// -- Why this file no longer declares that it has NO path population (#17915) --
//
// It carried the `no-path-population` marker until C7 landed, on the reading
// that this gate "reads no file in the tree at all; its whole input is the
// GitHub API (PRs, their labels, and the claim comments on their cards), so no
// card's file surface can predict it" (#13519). The INPUT half of that is still
// exactly true -- no BOARD DATA is read out of a tree, and the three read paths
// above are the whole of what this gate consumes. (#18456 opens one tracked
// file, this one, to hash it for the input record; it feeds no reading, so the
// prediction argument is untouched.)
//
// ⭐ The OTHER half stopped being true, and a declaration that stopped being
// true is the shape C7 itself exists against. C7 compares against
// `CONTRACT_REVIEW_TIER`, which is declared in `dispatch-gates.mjs` and
// imported above, so a card editing that constant DOES predict this gate: it
// moves the value every clearance is judged against, and the self-test that
// pins the comparison is the thing that should run. Keeping the marker would
// have said the opposite, in the file whose own row refuses exactly that.
//
// ⚠️ The import channel over-reaches on the way, and naming it here is the
// honest half of the trade. A followed module contributes its OWN literals, so
// this family now also inherits `.github/workflows` -- a directory this file
// never opens, on a gate whose CI step runs the self-test only. The designed
// narrowing (`inherited-population`, declared by the followed module) cannot
// express this case: it is per-MODULE, and the same module's globs ARE a real
// population for the sibling that reads them. So the lead is imprecise and
// stated, rather than silenced by a declaration that is false.
//
// ⛔ Do NOT "fix" the inherited lead by restating the tier here. The constant
// keeps exactly one value site across `scripts/pm/**` and
// `.claude/skills/pm-dispatch/**`, and a second value site is precisely what
// let the declared tier and the served one drift apart unnoticed.

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// `failed.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// The counts are a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'the declaration reader: the fixed spelling, and everything that is not': 15,
  'the card-level declaration: every state, none collapsed into another': 13,
  'C1, replaying the 2026-08-31 measured table': 12,
  'C2, the row this file exists for': 26,
  '#16304: the fourth reading — one PR, two cards, and the controls that keep exit 4': 39,
  'C3, the direction a carrier comparison cannot see': 7,
  '#14155: the COMPLETED state, and the three it must stay distinct from': 18,
  'the event reader itself': 9,
  'the cost bound, stated as one predicate both sides read': 6,
  'C4: the independence clause\'s carrier (maintainer 2026-09-01 「同意 A」)': 89,
  'the #13910 specimen, end to end': 2,
  'pairing, derived from the same relation H8/H31 read': 3,
  'the three read paths: ordered, offline-capable, and named in every refusal': 24,
  'C5: the direction claim checked against the diff (#16448)': 16,
  'C6: the review of record on this head, and the carrier the rule text names (#17302)': 40,
  'C7: the tier that SERVED the verdict the strip stands on (#17915)': 43,
  '#18174: the `Served-tier:` reading on EVERY pair that has a record, never only beside a gate clear': 28,
  'the exit register is distinct in every direction it must be': 6,
  'the argv contract and the board provenance (#16623)': 42,
  '#17366: the correction comment — the self-solvable exit, and the three things it is not': 65,
  '#17149: a claim that parses to ZERO branches — malformed, never absent': 26,
  '#17098: a key-INITIAL line that DESCRIBES the spelling — the half the fixture did not cover': 48,
  '#17959: POSITION is the LINE, not the body — the merged #17819 specimen in both its shapes': 10,
  '#18042: the copyable record TEMPLATE — the one machine-read artefact with nothing to copy': 24,
  '#18141: the head sha sits in a span of ITS OWN — the key-in-span spelling, refused and NAMED': 19,
  '#17919: the correction remedy names THIS card\'s claim comment, never another card\'s': 24,
  '#16833: an UNJUDGED refusal names the CHANNEL that answered, what it answered, and which carrier': 30,
  '#18456: the `--pair` input record — the same block on every exit, so two runs that disagree can be diffed': 38,
  '#18701: ONE thread set -- what the template STATES is what the queue guard READS': 16,
  '#18719: a RETRACTED claim leaves the pool — a withdrawn claim never governs': 46,
  '#18683: the card-comment read pages to a cap — past 100 is UNJUDGED, ⛔ never a truncated pool': 27,
  '#18764: a DECORATED claim ENTERS the pool — ONE reading, and it is the sibling\'s': 24,
  '#18828: a SECOND `Claim:` by ONE seat — the writer-side prohibition, finally READ': 52,
  '#18536: the lane-keyed owed population — spec and skills owe the record on EVERY round, other lanes owe none, a `yes` outside them is spec-lane work': 30,
  '#18862: cross-author LIVE claims with no `Release:` between — the hand-over the protocol never wrote, named; judged only after its effective instant': 52,
  '#16770: the exit-0 line says which carriers agreed — LABEL carriers — and that the PR body was not read': 14,
  '#18892: the claim comment\'s EDIT reading — taken from the two stamps already in hand, reported and never failed': 10,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
// Raised by exactly the one battery #16304 adds, again by exactly the one
// #17302 adds, and again by exactly the one #17366 adds, so the roster's
// existing slack is preserved rather than tightened or loosened as a side
// effect, and once more by the one #17149 adds, by the one #17098 adds, by the
// one #17915 adds, by the one #17959 adds, by the one #18042 adds, and by the
// one #18174 adds, and by the one #18141 adds, and by the one #17919 adds, and
// by the one #16833 adds, and by the one #18456 adds, and by the one #18719
// adds, and by the one #18683 adds, and by the one #18764 adds, and by the one
// #18828 adds, and by the one #18536 adds, and by the one #18862 adds, and by
// the one #16770 adds, and by the one #18892 adds.
const SELF_TEST_BATTERY_FLOOR = 36;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const SELF_PATH = fileURLToPath(import.meta.url);
const PROXY_REARM_GUARD = 'OS_CLAUSE2_CARRIERS_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_INCOMPLETE = 2;
/** Re-exported so a caller reads ONE table, not two. Value owned by the sibling. */
export { EXIT_PREREQUISITE_NOT_MET };
/** `--pair` only: the pair's limbs are illegible or its carriers disagree. */
export const EXIT_PAIR_ADVERSE = 4;

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
function quoteLine(line, cap = 160) {
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

// ---------------------------------------------------------------------------
// The self-solvable exit — one CORRECTION comment (#17366)
// ---------------------------------------------------------------------------

/**
 * The correction comment's FIRST-LINE key, and the claim comment id it names.
 *
 * Spelled so that it can never be mistaken for the declaration key one section
 * up: `Clause-②-correction` is not `Clause-②` followed by a colon, so
 * `CLAUSE2_KEY_LINE`, `hasInlineClause2Key` and `CLAIM_COMMENT_MARKER` all miss
 * it by construction rather than by ordering. The decoration tolerated is
 * exactly the decoration `CLAUSE2_KEY_LINE` tolerates — markdown a seat writes
 * without meaning anything by it — and nothing else.
 *
 * The id is DIGITS. ⛔ No angle brackets anywhere in the shape: GitHub's body
 * sanitizer eats tag-shaped fragments, backticked ones included, so a carrier
 * spelled with them can be stored short and read as absent — a second one-way
 * door in a mechanism that exists to remove one.
 */
const CLAUSE2_CORRECTION_KEY_LINE =
  /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?`?Clause-②-correction`?(?:\*\*)?[ \t]*:[ \t]*`?(\d{1,20})`?(?![0-9])/;

/** The `Session:` line both carriers of the attribution comparison are read from. */
const SESSION_KEY_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?`?Session`?(?:\*\*)?[ \t]*:(.*)$/;

/**
 * The session a comment DECLARES about itself, or null.
 *
 * Read through the file's one `SESSION_TOKEN`, so a session id has a single
 * spelling here whether it arrives on a verdict's `Reviewed-by:` line or on a
 * claim's `Session:` line. The token must be the FIRST thing after the colon,
 * the same calibration `readValueToken` states: `Session: \`session_x\` (GitHub
 * \`os-sales\`, skills seat)` reads, and what follows the token is the seat's
 * prose, which this file does not read.
 *
 * ⛔ `Claude-Session:` is a different key and is not matched: only line-start
 * decoration may precede `Session`, and `Claude-` is not decoration.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function readSessionId(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = SESSION_KEY_LINE.exec(line);
    if (!m) continue;
    const rest = String(m[1] ?? '').replace(/^[ \t]+/, '').replace(/^(?:\*\*)?`?[ \t]*/, '');
    const hit = SESSION_TOKEN.exec(rest);
    if (hit) return hit[1];
  }
  return null;
}

/**
 * Read ONE comment as a correction, or null when it is not one.
 *
 * ⭐ The key must be on the comment's FIRST non-blank line, which is what makes
 * the comment DEDICATED. A correction is a carrier, not a remark: a claim, a
 * round report or a review that happens to quote the key further down is not
 * one, and a heading or a mid-line form is not one either. That is the same
 * call `cardDeclaration` makes about `Claim:` — the carrier is recognised by a
 * fixed shape, and everything else on the thread is prose.
 *
 * The declaration INSIDE the correction is read by `readClause2Line`, the same
 * reader, over the same `CLAUSE2_KEY_LINE`. A correction whose declaration is
 * prose, malformed or absent reads `value: null` — it is still recognised as a
 * correction, so that the row can say what is wrong with it instead of leaving
 * the seat to guess why nothing changed.
 *
 * @param {{ id?: number|string, body?: string, created_at?: string }} row
 * @returns {{ id: string|null, createdAt: string|null, claimId: string,
 *   value: 'yes'|'no'|null, line?: string, session: string|null }|null}
 */
export function readClause2Correction(row) {
  const body = String(row?.body ?? '');
  const first = body.split(/\r?\n/).find((line) => line.trim() !== '');
  if (first === undefined) return null;
  const m = CLAUSE2_CORRECTION_KEY_LINE.exec(first);
  if (!m) return null;
  const read = readClause2Line(body);
  return {
    id: row?.id === undefined || row?.id === null ? null : String(row.id),
    createdAt: row?.created_at ?? null,
    claimId: m[1],
    value: read?.kind === 'declared' ? read.value : null,
    line: read?.kind === 'declared' ? read.line : read?.line,
    session: readSessionId(body),
  };
}

/**
 * The issue a comment row SAYS it belongs to, or null when it says nothing.
 *
 * REST comment rows carry `issue_url`, and its tail is the parent issue's
 * number — the same resolution #17919's control performed by hand: comment
 * 5642248126 resolves to `/issues/17366` while the card under test was #17425,
 * and the card's own governing claim resolves to `/issues/17425`. So the
 * endpoint answers this correctly and a row's parent is readable without a
 * second request.
 *
 * ⛔ Absence of the field is NOT evidence of a foreign parent. An offline
 * `--pair-json` document and this file's own fixtures both carry rows without
 * it, and a row that states nothing about its parent contradicts nothing. Only
 * a POSITIVE disagreement is a mismatch — a guard that read absence as a
 * mismatch would drop ids it has no reason to doubt.
 *
 * @param {{ issue_url?: string }} row
 * @returns {number|null}
 */
export function commentCardNumber(row) {
  const m = /\/issues\/(\d{1,9})(?:$|[/?#])/.exec(String(row?.issue_url ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * WHICH comment id the correction remedy may name — #17919's ⭐.
 *
 * The remedy's part (3) tells a seat to post `Clause-②-correction: N`, and N
 * has to be THIS card's governing claim comment: a correction naming any other
 * comment is IGNORED by `applicableCorrection`, so a wrong N sends the seat to
 * perform an act that cannot land. It used to be a LITERAL baked into the
 * remedy string — 5642248126, the #17366 specimen — so every C2 row on every
 * card printed a real comment id belonging to a different card, inside a
 * verdict about this one. That is the class #17919 was filed on, and it is not
 * a selection at all: nothing selected that comment, and no `issue_url` guard
 * over a selection could have caught a constant.
 *
 * ⭐ The cut is therefore one level up: the only ids this file may print in a
 * remedy are ids it READ from the pool `cardDeclaration` is judging, and each
 * one is checked against the card under test before it is printed. A row whose
 * declared parent is another card is dropped and SAID, ⛔ never silently; when
 * nothing survives, the remedy names no id at all rather than a plausible one.
 * ⛔ Fail-closed on a missing card number too: an id that cannot be checked is
 * an id that cannot be shown to be this card's.
 *
 * ⛔ This resolves NO verdict and NO exit. It decides which digits a sentence
 * carries; the state, the row and the exit code are whatever they already were.
 *
 * @param {{ id?: number|string, issue_url?: string }[]|null} pool — the claim
 *   rows `cardDeclaration` built its readings from, and nothing else.
 * @param {number|string|null} card — the card under test.
 * @returns {{ id: string|null, candidates: string[],
 *   foreign: { id: string, card: number }[], card: number|null }}
 */
export function correctionTarget(pool, card) {
  const under = Number(card);
  const known = Number.isFinite(under) && under > 0 ? under : null;
  const candidates = [];
  const foreign = [];
  for (const row of Array.isArray(pool) ? pool : []) {
    if (row?.id === undefined || row?.id === null) continue;
    const parent = commentCardNumber(row);
    if (known !== null && parent !== null && parent !== known) {
      foreign.push({ id: String(row.id), card: parent });
      continue;
    }
    candidates.push(String(row.id));
  }
  return {
    id: known !== null && candidates.length === 1 ? candidates[0] : null,
    candidates,
    foreign,
    card: known,
  };
}

/** Newest first — by timestamp, falling back to thread order when it is unreadable. */
function newestFirst(a, b) {
  const ap = Date.parse(a.createdAt ?? '');
  const bp = Date.parse(b.createdAt ?? '');
  if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return bp - ap;
  return b.index - a.index;
}

/**
 * The claim comment's own EDIT reading, from the two stamps ALREADY on the row
 * this reader holds — ⛔ never asserted, which is what #18892 measured: the note
 * below testified 「NOT edited」 about objectui#9764's claim 5724909959, whose
 * `updated_at` is 29 min past its `created_at`. THREE readings, ⛔ never two — a
 * missing stamp is a GAP, ⛔ not an unedited; ⛔ report-only per that ruling, an
 * edit is legitimate and moves no exit. The untaken testimony was the defect. */
function claimEditReading(row) {
  const [c, u] = [row?.created_at, row?.updated_at].map((v) => (typeof v === 'string' ? v : null));
  if (c === null || u === null) return 'whether it has been EDITED is NOT READ — its row carries no `created_at`/`updated_at` pair to compare, so ⛔ read that as a gap and never as "unedited"';
  if (c === u) return `it reads UNEDITED — its \`created_at\` and \`updated_at\` are both \`${c}\``;
  return `⚠️ it WAS EDITED at \`${u}\` (\`created_at\` \`${c}\`) — REPORTED and ⛔ never a failure: read its edit history before taking the declaration under it for the one the seat first wrote`;
}

/**
 * Which correction, if any, governs this card's declaration — and when none
 * does, WHY, in a sentence that names an act the claiming seat can perform.
 *
 * ⛔ Every `ignored` branch owes a reachable remedy. The card this mechanism
 * closes was filed because three sanctioned acts were closed at once; a refusal
 * here that a seat cannot answer would rebuild that door one room over, so the
 * note always names what to post next.
 *
 * @param {{ id?: number|string, body?: string, created_at?: string, updated_at?: string }[]} commentRows
 * @param {{ id?: number|string, body?: string, created_at?: string, updated_at?: string }[]} pool — the governing claim rows.
 * @returns {{ state: 'none' }
 *   | { state: 'applies', value: 'yes'|'no', detail?: string, note: string }
 *   | { state: 'ignored', note: string }}
 */
function applicableCorrection(commentRows, pool) {
  const corrections = [];
  commentRows.forEach((row, index) => {
    const read = readClause2Correction(row);
    if (read) corrections.push({ ...read, index });
  });
  if (corrections.length === 0) return { state: 'none' };

  const claimById = new Map();
  for (const row of pool) {
    if (row?.id === undefined || row?.id === null) continue;
    claimById.set(String(row.id), row);
  }
  const sorted = [...corrections].sort(newestFirst);
  const names = (c) => `\`${CLAUSE2_CORRECTION_KEY_TEXT}: ${c.claimId}\``;
  const chosen = sorted.find((c) => claimById.has(c.claimId)) ?? null;

  if (chosen === null) {
    const known = [...claimById.keys()];
    return {
      state: 'ignored',
      note:
        `a correction comment is on the thread (${names(sorted[0])}) but it names a comment that is ` +
        'NOT this card\'s governing claim, so it corrects nothing here and is IGNORED — ⛔ never ' +
        'silently, because a seat that posted it would otherwise wait on a repair that never ' +
        'happened. ' +
        (known.length > 0
          ? `The governing claim comment's id is ${known.join(' or ')}; post one correction naming it.`
          : 'The governing claim comment carries no id in this reading, so no correction can be ' +
            'matched to it — that is a gap in the reading, not a defect in the correction.'),
    };
  }
  if (chosen.value === null) {
    return {
      state: 'ignored',
      note:
        `the correction comment ${names(chosen)} carries no readable declaration` +
        (chosen.line ? `; the nearest thing in it is ${JSON.stringify(chosen.line)}` : '') +
        '. A correction is read by the SAME reader as a claim — the fixed spelling is ' +
        '`Clause-②: yes` or `Clause-②: no`, exactly those two, on a line of its own — so prose in ' +
        'a correction is prose. IGNORED; post one carrying the line in that spelling.',
    };
  }

  const claimRow = claimById.get(chosen.claimId);
  const claimSession = readSessionId(claimRow?.body);
  const shared =
    `it supersedes claim comment ${chosen.claimId}'s own declaration, and ${claimEditReading(claimRow)}. ` +
    '⛔ Nothing was filled in on the seat\'s behalf: the value is ' +
    'the seat\'s, in the fixed spelling, and this script still writes nothing.';

  if (claimSession === null) {
    return {
      state: 'applies',
      value: chosen.value,
      detail: chosen.line,
      note:
        `the declaration is read from a CORRECTION comment (${names(chosen)}) as ` +
        `\`Clause-②: ${chosen.value}\`, and ${shared} ⚠️ ATTRIBUTION NOT VERIFIED: the governing ` +
        'claim comment carries no `Session:` line, so there is nothing to compare the correction ' +
        'against. The reading stands — refusing it would put the card back in the state this ' +
        'mechanism exists to end — but a reader owes it a second look, and the claim that omitted ' +
        'the line is the thing to fix (SKILL.md 〈模板与表〉: 「session ID 不可省」).',
    };
  }
  if (chosen.session === null) {
    return {
      state: 'ignored',
      note:
        `the correction comment ${names(chosen)} carries no \`Session:\` line, so it does not say ` +
        'whose act it is. A correction is the CLAIMING seat\'s own judgement rewritten, and ⛔ no ' +
        'seat may declare on another\'s behalf — so the line is required, not decoration. ' +
        `IGNORED; post one carrying \`Session:\` with the claiming session (\`${claimSession}\`, ` +
        'which the governing claim declares).',
    };
  }
  if (chosen.session !== claimSession) {
    return {
      state: 'ignored',
      note:
        `the correction comment ${names(chosen)} declares session \`${chosen.session}\` while the ` +
        `governing claim declares \`${claimSession}\`. ⛔ A correction is the CLAIMING seat's own ` +
        'act; a different session rewriting it would be one seat declaring on another\'s behalf, ' +
        'which is the refusal the C2 row states. IGNORED; the claiming session posts the ' +
        'correction itself.',
    };
  }
  return {
    state: 'applies',
    value: chosen.value,
    detail: chosen.line,
    note:
      `the declaration is read from a CORRECTION comment (${names(chosen)}) as ` +
      `\`Clause-②: ${chosen.value}\`, attributed to the claiming session \`${claimSession}\` — the ` +
      'same session the governing claim declares. ⚠️ A DECLARED identity, never a verified one: ' +
      'the value is copyable text and the fleet writes under one GitHub login, so the comparison ' +
      `is on what the comments SAY, exactly as C4's is. And ${shared}`,
  };
}

// ---------------------------------------------------------------------------
// #18719 — a RETRACTED claim leaves the pool.
//
// The pool was every comment matching `CLAIM_COMMENT_MARKER`, ranked by
// recency. A RETRACTION carries no `Claim:` line of its own, so it was never IN
// the pool and could not remove the claim it retracts. Measured on #18373:
// `os-bill`'s claim 5717315121 (15:53:24Z) was withdrawn by the same seat 84
// seconds later (5717333576, 15:54:48Z, assignee cleared in the same stroke),
// and the selector went on naming the withdrawn record GOVERNING — pointing at
// `claude/issue-18373-include-bare-directory-provenance`, a branch origin does
// not have — while the seat actually working the card (`os-litant`,
// 5717143021, the card's only assignee) read SUPERSEDED. An arbiter that names
// the WRONG owner is worse than one that names none, because it looks like it
// answered.
//
// ⛔ The repair is NOT a re-sort: every ordering of a pool that still contains
// the withdrawn record picks a withdrawn record, and the next retraction is
// exactly as invisible. What changes is MEMBERSHIP — the selector READS the
// retraction.
//
// ## One predicate, ONE channel — the `Release:` line, read the sibling's way
//
// A claim leaves the pool when a LATER comment BY THE SAME AUTHOR retracts it,
// and a retraction is the `Release:` line AGENTS.md and SKILL.md name as the
// act that takes a card out of a seat's hands 「释放是显式动作:让卡离手者同笔清
// assignee + `Release:` 行(会话/因/去向);下一任重新认领。」 It needs no id,
// because it is a statement about its own author: it retracts that author's
// OLDER claims. It is READ THROUGH `markerMatches` — the sibling's ONE reading
// of an ownership marker (#18680, #18764): the bare marker first, then the
// shared stripper per line with a markdown list item refused — so a seat that
// writes `**Release:**` or `` `Release:` `` has released exactly as one that
// writes it bare. The constant itself is IMPORTED rather than restated, for
// `CLAIM_COMMENT_MARKER`'s reason: two readers of one thread must not drift.
//
// ⚠️ That the reading is the sibling's and ⛔ not the raw constant is MEASURED,
// not tidiness. Before #18829 A this channel tested `RELEASE_COMMENT_MARKER`
// against the raw body, and two of the twelve cross-author pairs #18862 counted
// (2026-09-18T00:47Z) stood only because of it: `os-warren`'s backticked
// `` `Release:` `` on #17852 (5700605769) and `claude[bot]`'s bolded
// `**Release:**` on objectui#7848 (5617804323) were real releases the raw
// constant could not see under their decoration, so the released claims stayed
// LIVE in the pool and the later claimant read as a silent takeover. Both are
// replayed in the self-test.
//
// ## The PROSE channel this section carried, and why it is GONE (#18773 A, #18829 A)
//
// PR #18770 taught this reader a second channel: a line OPENING with a
// retraction act from a closed roster (`retract` · `withdraw` · 撤回 · 撤销 ·
// 作废) AND naming the claim by comment id, undecorated by a stripper of this
// file's own that removed `_` and then every leading non-letter/non-digit
// character. It read one measured specimen — #18373's 「🚨 **撤回上一条认领
// (`5717315121`)…」 — and in doing so inferred an act the governed text never
// declared. The maintainer ruled (batch #156 item 3, letter A): a retraction
// 「is a `Release:` line — the same act, the same three fields, 去向 =
// 「让先到者」」, and 「⛔ B — a reader inferring an act from a verb replays the
// next spelling; ⛔ C — a dated tolerance for a channel with one specimen」. In
// the same batch (item 4, letter A) the file's second undecorator was ruled out
// of existence: 「the protocol's definition of a decorated ownership line is
// the shared claim reading」 — the two strippers had been run over one
// twelve-spelling fixture set and disagreed on five (`__Claim:__`, `- Claim:`,
// `* Claim:`, `🚨 Claim:`, `## Claim:` read as the directive through the
// second stripper and as nothing through the shared reading).
//
// ⇒ the anchor roster, the comment-id scan and the second stripper are DELETED,
// not disabled. The specimen is replayed in the self-test in the direction the
// ruling accepted: the prose line retracts nothing, the withdrawn claim stands
// again, and the thread is NAMED by the cross-author row below (#18862) rather
// than read silently. The sigil-led shape the stripper used to swallow is the
// SIBLING's named near miss (`leading-sigil` in
// `OWNERSHIP_MARKER_NEAR_MISS_FORMS`), audible where every other refused
// ownership spelling is. A seat that wants the #18373 outcome writes the act
// the protocol names, in the spelling it names.
//
// ## Why SAME AUTHOR is load-bearing, not tidiness
//
// Only the seat that wrote a claim can withdraw it; anyone else's line is
// DISCUSSION of a release, which is not one. The measured shape is on the
// #18373 thread itself: `os-litant` — the OTHER seat — wrote about the
// withdrawn claim twice (5717775707, 5717738051), and a reader without the
// author test becomes a way for any participant to void any owner's record by
// describing it.
//
// An UNREADABLE author on either side retracts NOTHING. Fail-closed is the
// direction that leaves the existing record standing, and it is the only
// direction that cannot manufacture a retraction out of a missing field.
//
// ⚠️ Under one shared GitHub identity the author test is VACUOUS — every seat
// writes as the same login. That is the fleet's accepted blind spot (AGENTS.md
// 「per-seat identities are not introduced」), stated here rather than repaired
// here: this reader cannot invent an identity the API does not carry.
// ---------------------------------------------------------------------------

/**
 * The login that wrote one row, or `null` when the row carries none.
 *
 * `null` is a REFUSAL, never a wildcard: every comparison below fails closed on
 * it, so a row shape that drops `user` can only ever leave claims standing.
 */
function rowAuthor(row) {
  const login = row?.user?.login;
  return typeof login === 'string' && login.trim() !== '' ? login : null;
}

/**
 * Is `candidate` LATER than `claim` on this thread?
 *
 * The file's one recency rule, in its strict form: `created_at` decides when
 * both stamps read and differ, and a tie or an unreadable stamp falls back to
 * THREAD ORDER. ⛔ Never `>=` here — a comment is not later than itself, and a
 * retraction posted BEFORE the claim it names retracts nothing.
 */
function laterOnThread(candidate, claim) {
  return candidate.stamp !== null && claim.stamp !== null && candidate.stamp !== claim.stamp
    ? candidate.stamp > claim.stamp
    : candidate.index > claim.index;
}

/**
 * Does this comment carry the act that retracts its author's older claims — a
 * `Release:` line, read the sibling's way — and if so, which channel does the
 * record print? `null` when it is not one.
 *
 * ONE channel since #18773 A. The `Release:` line names its target by
 * AUTHORSHIP, not by id: whoever writes it has released what they held, so no
 * comment id is required or read. `markerMatches` is the reading, ⛔ never the
 * raw constant (the two decorated live releases the raw test missed are in the
 * section header above).
 *
 * @param {{ body?: string }} row
 * @returns {string|null} the channel, as the sentence the record prints.
 */
function retractionChannel(row) {
  if (markerMatches(RELEASE_COMMENT_MARKER, String(row?.body ?? ''))) {
    return 'the protocol `Release:` line — the act that takes a card out of a seat\'s hands, read through the '
      + 'sibling\'s one reading (a decorated `**Release:**` is the same act as a bare one)';
  }
  return null;
}

/** The rule the pool's MEMBERSHIP is judged by, written out once and PRINTED. */
export const CLAIM_RETRACTION_RULE =
  'A claim LEAVES the pool when a LATER comment BY THE SAME AUTHOR retracts it, and a retraction is '
  + 'the protocol `Release:` line — ONE channel, read through the sibling reader\'s ONE reading of the '
  + 'marker (`markerMatches`: the bare marker first, then the shared stripper per line, a markdown LIST '
  + 'ITEM refused), needing no id because it retracts its own author\'s older claims. ⛔ Never a prose '
  + 'line, whatever act opens it (#18773 A: a reader inferring an act from a verb replays the next '
  + 'spelling — a withdrawal before work is a `Release:` line with 去向 「让先到者」), ⛔ never a DIFFERENT '
  + 'author\'s line, ⛔ never a line older than the claim it takes back, and ⛔ never an unreadable '
  + 'author on either side. A retracted claim is listed RETRACTED with the retracting comment id — '
  + '⛔ never SUPERSEDED, ⛔ never dropped from the listing.';

/**
 * Every claim comment on this thread that a LATER comment RETRACTED, keyed by
 * the claim ROW itself.
 *
 * ⭐ ONE derivation, for `claimCarrierSelection`'s reason: the membership test
 * and the sentence that explains a rejection read the same map, so the pool and
 * the record cannot describe two different retractions.
 *
 * The retractor reported is the FIRST one in thread order: a claim withdrawn
 * twice was withdrawn when it was withdrawn, and naming the later mention would
 * date the act wrongly.
 *
 * @param {{ id?: number|string, body?: string, created_at?: string,
 *   user?: { login?: string } }[]|null} commentRows
 * @returns {Map<object, { id: string, author: string, at: string, channel: string }>}
 */
export function claimRetractions(commentRows) {
  const rows = Array.isArray(commentRows) ? commentRows : [];
  const indexed = rows.map((row, index) => {
    const parsed = Date.parse(row?.created_at ?? '');
    return {
      row,
      index,
      stamp: Number.isFinite(parsed) ? parsed : null,
      author: rowAuthor(row),
    };
  });
  const out = new Map();
  for (const claim of indexed) {
    // The sibling's ONE reading of the claim marker (#18764) — ⛔ never a second one.
    if (!markerMatches(CLAIM_COMMENT_MARKER, String(claim.row?.body ?? ''))) continue;
    // Fail closed, twice: an unattributable claim cannot be matched against an
    // author, and an unattributable candidate cannot be the seat that wrote it.
    if (claim.author === null) continue;
    for (const candidate of indexed) {
      if (candidate.row === claim.row) continue;
      if (candidate.author === null || candidate.author !== claim.author) continue;
      if (!laterOnThread(candidate, claim)) continue;
      const channel = retractionChannel(candidate.row);
      if (channel === null) continue;
      out.set(claim.row, {
        id: String(candidate.row?.id ?? '(no id)'),
        author: candidate.author,
        at: candidate.row?.created_at ?? '(no readable date)',
        channel,
      });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// #18828 — a SECOND `Claim:` by ONE seat. The prohibition is on the WRITING,
// and until this row nothing READ it.
//
// The rule is this file's own, in the #17366 block upstairs: 「the claim
// protocol forbids a second `Claim:`」. It is the reason the correction key
// exists at all and the reason that key is a DIFFERENT key — a correction never
// enters the pool, never governs, and cannot re-dispatch the card. What the
// reader did with a thread that carried a second claim anyway was RANK it: the
// governing-claim selector takes the newest LIVE claim that parses a branch and
// prints the loser as 「a SUPERSEDED claim」 — clean, green, exit 0. ⇒ a
// writer-side prohibition with no enforcing reader, and the word the record
// reached for («SUPERSEDED») is the word for a transition the protocol
// DESIGNED, said about a line the protocol says must not be written.
//
// ⚠️ Measured before this row was written, over both boards this gate reads,
// at 2026-09-18T00:05Z: 533 open cards in `objectstack-ai/objectstack`, 416 in
// `objectstack-ai/objectui` (949, of which 167 carry at least one claim
// comment). The five the filing card named — #18540 · #18677 · #18748 ·
// #18651 · #18778 — each carry TWO live `Claim:` comments by `os-support-ai`
// and zero corrections, and #18559 is the control: one claim plus the
// sanctioned `Clause-②-correction: 5721425131`. ⛔ The repair of those five is
// their author's; this file only names them.
//
// ## MEMBERSHIP first, and that is what makes the state REPAIRABLE
//
// The state is read over the LIVE claims — `claimRetractions` is the authority
// on 「retracted」, exactly as it is for governance (#18719) — and ⛔ never over
// the raw claim listing. Two consequences, both deliberate:
//
//   · a re-claim AFTER a `Release:` of the first is the protocol working: the
//     first no longer stands, one live claim is left, and the thread reads
//     exactly as it did before this row existed;
//   · a seat that ALREADY wrote a second claim has an act that clears the row —
//     a `Release:` of what it holds, then one fresh claim. ⭐ That is the whole
//     lesson of #17366 one screen up: a state whose only repair is an act no
//     seat can perform is a green PR waiting on somebody outside the
//     repository. A rule written over the WRITING moment instead ("there was no
//     retraction strictly BETWEEN the two lines") would have been unrepairable
//     by construction — nothing un-writes a comment, and the MCP tool set has
//     no edit-a-comment call — so this row would have been a permanent red with
//     a remedy sentence nobody could execute. ⛔ Not that.
//
// ## ⛔ What this row is NOT
//
//   1. **Not a second selector.** `CLAIM_SELECTION_RULE` and the governing
//      claim are untouched for every shape; the pool is what it was. This is an
//      ADDITIONAL reading of the same thread, and `claimCarrierSelection` stays
//      a pure function of the rows it is handed with the same return shape.
//   2. **Not a widened marker.** `CLAIM_COMMENT_MARKER` is read through
//      `markerMatches` — the sibling's ONE reading (#18764) — so a decorated
//      `**Claim:**` is counted here exactly as a bare one is counted there, and
//      ⛔ this file does not grow a second reader of the marker.
//   3. **Not a cross-seat ownership rule.** Two live claims by DIFFERENT
//      authors are a separate state — the triage's p1 escalation condition —
//      and this row stays silent on it: a row that answered both would make
//      one sentence out of two states. That state has its own reader since
//      #18862: row C9 (`claimHandovers`, one section down), with its own
//      remedy and its own effective instant.
//   4. **Not a NOTE.** The `--pair` path answers `EXIT_PAIR_ADVERSE`. An
//      adverse fact rendered as 0-with-a-message is the silence this file
//      exists against, and it is what the old SUPERSEDED reading already was.
// ---------------------------------------------------------------------------

/** The rule this row is judged by, written out once and PRINTED beside it. */
export const CLAIM_REPEAT_RULE =
  'The claim protocol forbids a SECOND `Claim:`: a card is claimed once, and the seat that must '
  + 'correct its own declaration writes `Clause-②-correction: <claim comment id>` — a DIFFERENT key, '
  + 'which `CLAIM_COMMENT_MARKER` does not match, so a correction never enters the pool, never governs '
  + 'and cannot re-dispatch the card. TWO OR MORE LIVE claim comments BY ONE AUTHOR on one thread is '
  + 'therefore a state the protocol says cannot be written, and it is NAMED here — every comment id, '
  + 'the author, and the repair — ⛔ never printed as a SUPERSESSION, which is the word for a '
  + 'transition the protocol designed. MEMBERSHIP comes first: a RETRACTED claim does not stand, so a '
  + 'fresh claim after a `Release:` of the first is the protocol working and reads exactly as it did '
  + 'before. ⛔ Two live claims by DIFFERENT authors are not this state — that is a separate reading '
  + 'and this row does not make it (row C9 does, #18862). ⛔ An unattributable row is never counted, the way `claimRetractions` '
  + 'fails closed on one.';

/** The repair, in the seat's own acts — printed with every instance of the row. */
export const CLAIM_REPEAT_REMEDY =
  'Repair, by the seat that holds them and ⛔ by nobody else: post `Clause-②-correction: <claim comment '
  + 'id>` when what needs fixing is the declaration the claim carries (the #17366 exit — it corrects the '
  + 'line without touching the claim, and nothing has to be edited), or post `Release:` and then ONE '
  + 'fresh `Claim:` when the card really is being re-taken (the release retracts what this seat holds, so '
  + 'the fresh claim is the only one standing). ⛔ Never a second `Claim:` under a live one, and ⛔ never '
  + 'a `Release:` or a correction posted on another seat\'s behalf.';

/**
 * Every author holding MORE THAN ONE LIVE claim comment on this thread.
 *
 * A sibling pure reader beside `claimRetractions` and built on it: the same map
 * decides membership here and for governance, so the pool and this row cannot
 * describe two different retractions. ⛔ It resolves no state, no row and no
 * exit code — `c8SecondClaimSameSeat` renders the verdict and `pairInputRecord`
 * renders the reading, both from this one derivation.
 *
 * Ordering is the file's one recency rule (`laterOnThread`), used to ORDER the
 * record rather than to pick a winner: `first` is the claim that stood, and
 * every row in `repeats` is a line written under it.
 *
 * @param {{ id?: number|string, body?: string, created_at?: string,
 *   user?: { login?: string } }[]|null} commentRows
 * @returns {{ author: string, claims: object[], ids: string[], first: object,
 *   repeats: object[] }[]} one entry per author, in thread order.
 */
export function claimRepeats(commentRows) {
  const rows = Array.isArray(commentRows) ? commentRows : [];
  const retracted = claimRetractions(rows);
  const indexed = rows.map((row, index) => {
    const parsed = Date.parse(row?.created_at ?? '');
    return { row, index, stamp: Number.isFinite(parsed) ? parsed : null, author: rowAuthor(row) };
  });
  const byAuthor = new Map();
  for (const claim of indexed) {
    // The sibling's ONE reading of the marker (#18764) — ⛔ never a second one.
    if (!markerMatches(CLAIM_COMMENT_MARKER, String(claim.row?.body ?? ''))) continue;
    // A withdrawn claim does not stand, so it neither carries this prohibition
    // nor receives it: ⭐ the same MEMBERSHIP-first order governance takes.
    if (retracted.has(claim.row)) continue;
    // Fail closed, exactly as `claimRetractions` does: a row this file cannot
    // attribute is never counted as some seat's second anything.
    if (claim.author === null) continue;
    if (!byAuthor.has(claim.author)) byAuthor.set(claim.author, []);
    byAuthor.get(claim.author).push(claim);
  }
  const out = [];
  for (const [author, claims] of byAuthor) {
    if (claims.length < 2) continue;
    const ordered = [...claims].sort((a, b) => (laterOnThread(a, b) ? 1 : laterOnThread(b, a) ? -1 : 0));
    out.push({
      author,
      claims: ordered.map((c) => c.row),
      ids: ordered.map((c) => String(c.row?.id ?? '(no id)')),
      first: ordered[0].row,
      repeats: ordered.slice(1).map((c) => c.row),
    });
  }
  return out;
}

/**
 * The repeat state as ONE sentence per author — shared by the row that refuses
 * and the input record that reports what was read, so the two cannot disagree
 * about how many claims are involved or which ones.
 */
function claimRepeatSentences(groups) {
  const when = (row) => `${String(row?.id ?? '(no id)')} at ${row?.created_at ?? '(no readable date)'}`;
  return groups.map(
    (g) =>
      `\`${g.author}\` holds ${g.claims.length} LIVE claim comment(s) here — ${g.claims.map(when).join(', ')} `
      + `— of which ${String(g.first?.id ?? '(no id)')} is the claim that stood and the other `
      + `${g.repeats.length} (${g.repeats.map((r) => String(r?.id ?? '(no id)')).join(', ')}) `
      + 'was written under it, un-retracted',
  );
}

// ---------------------------------------------------------------------------
// #18862 — cross-author LIVE claims with no `Release:` between: the hand-over
// the protocol never wrote, NAMED.
//
// The protocol sanctions exactly ONE way a card changes hands: the holder's
// `Release:` line (AGENTS.md's release clause; SKILL.md 「释放是显式动作:让卡
// 离手者同笔清 assignee + `Release:` 行(会话/因/去向);下一任重新认领。」; the
// dead-claim reclaim is a `Release:` with cause too). What the reader did with
// a thread on which a SECOND seat claimed under a first seat's live claim was
// RANK it: `claimCarrierSelection` took the newest live claim that parses a
// branch as governing and printed the older one as 「a SUPERSEDED claim」 at
// exit 0 — the newer seat's `Branch:` and `Clause-②` handed to every
// downstream reader, and nothing anywhere saying that ownership had moved
// without the act the protocol names.
//
// ⚠️ Measured (the #18828 dev's sweep, 2026-09-18T00:47:37Z–00:48:42Z, both
// boards this gate reads — 529 open cards in objectstack, 413 in objectui, 163
// carrying at least one claim comment; three rows re-read by the triage seat
// at 02:09Z): TWELVE open cards carried live `Claim:` comments from two or
// more DIFFERENT authors with no retraction between — objectstack #13503,
// #14026, #15811, #17852; objectui #4730, #7070, #7696, #7804, #7848, #7924,
// #8115, #9370. #17852's pair was eight hours apart: two running seats on one
// card. objectui#9370's second claim says 「⛔ NOT a re-claim」 in its own
// first line and was ranked governing anyway — the reader reads order, not
// intent. #15811's assignee had moved to the second claimant with no
// `Release:` anywhere. Five of the twelve involve `claude[bot]`, the retired
// automation identity.
//
// ## The ruling (batch #154 item 2, letter b — maintainer 「同意」 2026-09-18T04:56Z)
//
// 「**Reader**: `check-clause2-carriers.mjs` gains one named state beside
// `claimRepeats` (C8, same-author): **cross-author live claims with no
// `Release:` between** — its own row, its own remedy sentence (the holder
// posts `Release:`; the taker posts nothing until then), exit 4. ⛔ Not a
// widening of C8 (a correction cannot repair a hand-over). **Effective date**:
// the row judges only pairs whose second `Claim:` is dated after the PR
// carrying the row lands; earlier pairs are listed as informational, never
// red.」 And: 「⛔ **a** — reds twelve cards on history the readers themselves
// created; ⛔ **c** — the next silent hand-over has no reader.」
//
// ## MEMBERSHIP first — the same authority C8 and governance read
//
// The state is read over the LIVE claims: `claimRetractions` decides what
// stands, and since #18773 A a retraction is the `Release:` line read the
// sibling's way. Two consequences, both deliberate:
//
//   · a `Release:` by the earlier holder — BEFORE the taker's claim or AFTER
//     it — retracts the holder's claim, one author is left holding a live
//     claim, and the row is silent: the repair is an act the holder can
//     perform at any time, which is what makes the state REPAIRABLE (the
//     #17366 lesson C8 states one section up). A taker that yields writes its
//     OWN `Release:` with 去向 「让先到者」 (#18773 A) and clears it the same
//     way;
//   · two of the twelve measured pairs — objectui#7848 and #7924 — carried the
//     holder's `Release:` all along, decorated (`**Release:**`, a backticked
//     one), and stood only because the retraction reader tested the raw
//     constant. They clear by #18829 A alone, with no seat posting anything;
//     the self-test replays both.
//
// ## The EFFECTIVE INSTANT, and why it is a constant in this file
//
// The ruling splits history from the rule: a pair whose SECOND claim is dated
// after the rule landed is JUDGED (row C9, exit 4); one whose second claim is
// dated before it is LISTED — a note and an input-record field, never a row,
// never the exit. `CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT` below is that instant:
// the UTC minute at which this row was authored, frozen. It names the rule's
// LANDING WINDOW — the `domain:skills` seat reconciles by hand every pair whose
// second claim falls between this instant and the PR's merge, exactly as it
// reconciles the twelve before it (ruling item 2: the seat's act, ⛔ not the
// reader's) — and it is a constant rather than a merge date read from git
// because a reader that consulted history to decide what it judges would
// judge differently in every checkout. ⛔ Strictly AFTER: a claim stamped at
// the instant itself is history. An unreadable stamp cannot be shown to be
// after it and is LISTED, never judged — fail-closed in the direction that
// leaves the record standing.
//
// ## Hand-overs, not pairs of authors
//
// The reading walks the live, attributable claims in thread order and names a
// HAND-OVER at every point where the author changes from the previous live
// claim's author — so A, B, A' is two hand-overs (B took from A, A took back
// from B) and A, B, B' is one hand-over (B's second claim is C8's row, ⛔ not
// a second hand-over). ONE row per thread naming every hand-over, exactly as
// C8 names every repeat in one row; the row is JUDGED when ANY hand-over's
// claim is dated after the instant, and the sentence says which ones are.
//
// ## ⛔ What this row is NOT
//
//   1. **Not a widening of C8.** The remedies differ — a correction repairs a
//      declaration and cannot repair a hand-over — and the states are
//      disjoint by construction: C8 groups live claims BY ONE author, this row
//      reads the author CHANGES between them. A thread can earn both (A, B,
//      B'), and then it earns both rows, ⛔ never one sentence out of two
//      states. C8's own pin that it is silent on the cross-author shape
//      stands; what changed is that the shape now has a reader.
//   2. **Not a second selector.** `CLAIM_SELECTION_RULE` and the governing
//      claim are untouched for every shape: the newer claim still governs and
//      the older is still listed SUPERSEDED in the record. This is an
//      ADDITIONAL reading of the same thread, and `claimCarrierSelection`
//      keeps its return shape.
//   3. **Not a judgement of history.** The twelve measured rows, and every
//      pair dated before the instant, are LISTED — a `C9-BEFORE-EFFECTIVE`
//      note and the `claim.handover` field — so the record is complete and
//      the exit is unmoved. ⛔ Never red on them (ruling ⛔ a).
//   4. **Not an identity rule.** `claude[bot]` is an author like any other
//      here; that its claims are dead is the seat's knowledge and the seat's
//      `Release:` with cause (SKILL.md's dead-claim reclaim), ⛔ not a special
//      case in the reader. An unattributable row is never counted, the way
//      `claimRetractions` fails closed on one.
//   5. **Not a NOTE when judged.** The `--pair` path answers
//      `EXIT_PAIR_ADVERSE` on a judged hand-over. An adverse fact rendered as
//      0-with-a-message is the silence this file exists against.
// ---------------------------------------------------------------------------

/**
 * The instant this row became a rule — the UTC minute at which it was authored.
 *
 * Frozen. It names the rule's LANDING WINDOW: a hand-over whose taking claim is
 * dated strictly after it is JUDGED, one dated at or before it is LISTED; the
 * `domain:skills` seat reconciles by hand every pair whose second claim falls
 * between this instant and the PR's merge, together with the twelve before it.
 * ⛔ Never moved forward to quieten a row and ⛔ never derived from git.
 */
export const CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT = '2026-09-19T03:45Z';
const CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_STAMP = Date.parse(CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT);

/** The rule this row is judged by, written out once and PRINTED beside it. */
export const CLAIM_HANDOVER_RULE =
  'The protocol sanctions ONE way a card changes hands: the HOLDER\'s `Release:` line (会话 / 因 / 去向). '
  + 'TWO OR MORE LIVE claim comments BY DIFFERENT AUTHORS on one thread with no `Release:` from the '
  + 'earlier holder between them is therefore a hand-over the protocol never wrote, and it is NAMED here — '
  + 'every live claim, its author, its date, each point where the author changes, and the repair — '
  + '⛔ never printed as a SUPERSESSION, which is the word for a transition the protocol designed. '
  + 'MEMBERSHIP comes first: a RETRACTED claim does not stand, so a holder\'s `Release:` (posted before '
  + 'or after the taker\'s claim, bare or decorated) leaves one author holding and reads as the protocol '
  + 'working. EFFECTIVE INSTANT: a hand-over is JUDGED (row C9, exit 4) only when the taking claim is '
  + `dated strictly after ${CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT}; one dated at or before it, or with no `
  + 'readable date, is LISTED as informational and moves no exit. ⛔ Two live claims by ONE author are '
  + 'C8\'s state, not this one. ⛔ An unattributable row is never counted.';

/** The repair, in the seats' own acts — printed with every judged instance of the row. */
export const CLAIM_HANDOVER_REMEDY =
  'Repair, by the seats that hold the claims and ⛔ by nobody else: the HOLDER (the earlier live claimant) '
  + 'posts `Release:` — 会话 / 因 / 去向 naming the taker — which is the one hand-over the protocol '
  + 'sanctions; the TAKER posts nothing until then: no work under a claim the holder has not released, '
  + '⛔ never a second `Claim:`, ⛔ never a `Release:` on the holder\'s behalf. A taker that yields '
  + 'instead posts its OWN `Release:` with 去向 「让先到者」 (a withdrawal before work is a `Release:` '
  + 'line), which retracts its claim and clears this row the same way. ⛔ No `Clause-②-correction:` '
  + 'repairs this state: a correction fixes a declaration, and a hand-over is not a declaration.';

/**
 * The cross-author hand-over state of one thread, or `null` when the live,
 * attributable claims are all one author's (or there are none, or the thread
 * is unread).
 *
 * A sibling pure reader beside `claimRepeats`, built on the same
 * `claimRetractions` map, so governance, C8 and this row cannot describe three
 * different retractions. ⛔ It resolves no state, no row and no exit code —
 * `c9CrossAuthorLiveClaims` renders the judged verdict, `c9HandoverNote` the
 * informational listing and `pairInputRecord` the reading, all from this one
 * derivation.
 *
 * Ordering is the file's one recency rule (`laterOnThread`), used to ORDER the
 * live claims: `holder` is the claim that stood, and every hand-over is a
 * later live claim whose author differs from the live claim before it.
 *
 * @param {{ id?: number|string, body?: string, created_at?: string,
 *   user?: { login?: string } }[]|null} commentRows
 * @returns {{ holder: object, holderAuthor: string, live: object[], authors: string[],
 *   handovers: { from: object, to: object, fromAuthor: string, toAuthor: string,
 *     at: string, dated: 'after'|'at-or-before'|'unreadable', judged: boolean }[],
 *   judged: boolean, effectiveAt: string }|null}
 */
export function claimHandovers(commentRows) {
  if (!Array.isArray(commentRows)) return null;
  const retracted = claimRetractions(commentRows);
  const indexed = commentRows.map((row, index) => {
    const parsed = Date.parse(row?.created_at ?? '');
    return { row, index, stamp: Number.isFinite(parsed) ? parsed : null, author: rowAuthor(row) };
  });
  const live = indexed.filter((c) =>
    // The sibling's ONE reading of the marker (#18764); a withdrawn claim does
    // not stand (#18719); an unattributable row is never counted.
    markerMatches(CLAIM_COMMENT_MARKER, String(c.row?.body ?? '')) && !retracted.has(c.row) && c.author !== null);
  const ordered = [...live].sort((a, b) => (laterOnThread(a, b) ? 1 : laterOnThread(b, a) ? -1 : 0));
  const authors = [...new Set(ordered.map((c) => c.author))];
  if (authors.length < 2) return null;
  const handovers = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const from = ordered[i - 1];
    const to = ordered[i];
    if (from.author === to.author) continue;
    const dated = to.stamp === null ? 'unreadable' : to.stamp > CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_STAMP ? 'after' : 'at-or-before';
    handovers.push({
      from: from.row,
      to: to.row,
      fromAuthor: from.author,
      toAuthor: to.author,
      at: to.row?.created_at ?? '(no readable date)',
      dated,
      judged: dated === 'after',
    });
  }
  return {
    holder: ordered[0].row,
    holderAuthor: ordered[0].author,
    live: ordered.map((c) => c.row),
    authors,
    handovers,
    judged: handovers.some((h) => h.judged),
    effectiveAt: CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT,
  };
}

/**
 * The hand-over state as ONE sentence — shared by the row that judges, the note
 * that lists and the input record that reports what was read, so the three
 * cannot disagree about which claims are involved or which are judged.
 */
function claimHandoverSentence(state) {
  const when = (row) => `${String(row?.id ?? '(no id)')} at ${row?.created_at ?? '(no readable date)'}`;
  const judgedCount = state.handovers.filter((h) => h.judged).length;
  const datedWord = (h) => (h.dated === 'after'
    ? `dated AFTER the effective instant ${state.effectiveAt} — JUDGED`
    : h.dated === 'unreadable'
      ? 'with NO readable date — listed, informational, never judged'
      : `dated at or before the effective instant ${state.effectiveAt} — listed, informational`);
  return `${state.authors.length} authors hold LIVE claim comments here with no \`Release:\` from the earlier holder `
    + `between them — \`${state.holderAuthor}\`'s ${when(state.holder)} is the claim that stood; `
    + state.handovers.map((h) => `\`${h.toAuthor}\`'s ${when(h.to)} took the card from \`${h.fromAuthor}\` (${datedWord(h)})`).join('; ')
    + ` — ${state.handovers.length} hand-over(s), ${judgedCount} judged, ${state.handovers.length - judgedCount} informational`;
}

/**
 * The rule that picks the declaration limb's CARRIER, written out once.
 *
 * It is a sentence and not a comment because the record below PRINTS it: a
 * reader diffing two runs has to be able to tell "the two runs selected
 * different comments" from "the two runs applied different rules", and a rule
 * that lives only in a docblock cannot be compared against a run.
 */
export const CLAIM_SELECTION_RULE =
  'the GOVERNING claim — the NEWEST comment whose body carries a line beginning `Claim:`/`Claimed:` '
  + '(read through the sibling reader\'s ONE reading, `markerMatches`: the bare marker first, then the '
  + 'shared stripper per line, with a markdown LIST ITEM refused — so a decorated `**Claim:**` is the '
  + 'same record as a bare one and ⛔ the two readers of this thread cannot answer differently) '
  + 'AND whose `Branch:` line parses at least one protocol-shaped branch (newest by `created_at`; an '
  + 'unreadable stamp or a tie falls back to thread order, later row wins). The pool is every claim '
  + 'comment sharing that `created_at`; when NO claim names a branch at all, every claim comment is '
  + 'the pool. ⛔ Not earliest, ⛔ not a session match, ⛔ not the one whose body mentions the key. '
  + `MEMBERSHIP comes first: ${CLAIM_RETRACTION_RULE}`;

// ---------------------------------------------------------------------------
// #18764 — a DECORATED claim ENTERS the pool. ONE reading, and it is the
// sibling's.
//
// The pool and the retraction indexer each tested `CLAIM_COMMENT_MARKER`
// against the RAW body. The constant anchors the bare word at line start and
// tolerates leading whitespace and one `>` — nothing else — so a claim a seat
// wrote as `**Claim:** …` or `` `Claim:` … `` was not SUPERSEDED here, it was
// never a candidate: not listed, not rejected, not named anywhere in the
// record. Meanwhile `claimGovernance`, imported from the same sibling, had
// already been reading both markers through `markerMatches` since #18680, so
// ONE FUNCTION held both answers at once — governance saw the bolded claim and
// the pool beside it did not.
//
// Measured on the two live records the #18764 escalation named (read
// 2026-09-17T22:02Z; ⚠️ both cards have since left that state and the reading
// is stated with its time for that reason), replayed through `--pair-json`:
//
//   a bolded/backticked claim carrying its own `Branch:` and `Clause-②: no`
//     → `claim.selected: none — no comment on this thread carries a line
//       beginning `Claim:``, the limb read MISPLACED and `--pair` exited 4,
//       prescribing a `Clause-②-correction:` for a line the seat had already
//       written in the right place.
//   a BARE older claim declaring `yes` beneath a DECORATED newer one declaring
//     `no` → the OLD claim governed the declaration, the reading answered
//     `DECLARED yes`, and the newer record was not even listed as rejected.
//     ⭐ That is the expensive direction: not a missing reading but a WRONG
//     value, reported with every appearance of having been read.
//
// ⛔ The repair is NOT a `\*\*` added to `CLAIM_COMMENT_MARKER`. Decoration is
// an OPEN set (#18680 settled that), so admitting one spelling buys exactly
// that spelling and replays this card on the next one — and the constant is
// the PROTOCOL's spelling, which is why every reader imports it rather than
// restating it. ⛔ Nor is it a second undecorator written here: this file
// would then own a definition of "decorated" that the sibling could drift
// from, which is the very failure the card names. What both raw tests do
// instead is READ THROUGH `markerMatches` — the sibling's one reading, bare
// test first (so the change is provably additive: no body that matched
// yesterday stops matching) and the shared stripper after it, with the list
// item refused there and the near-miss vocabulary
// (`OWNERSHIP_MARKER_NEAR_MISS_FORMS`) kept where it lives. ⛔ That vocabulary
// is the sibling's and is not re-declared here.
//
// ## The OTHER undecorator this file kept is GONE, and that is a RULING (#18829 A)
//
// Until #18829 the retraction channel one section up read its lines through a
// second stripper — `_` removed, then every leading non-letter/non-digit
// character — and the card asked whether the file should end up with one
// undecoration path. The two paths were run over one twelve-spelling fixture
// set: 5 of 12 read DIFFERENTLY (`__Claim:__`, `- Claim:`, `* Claim:`,
// `## Claim:`, `🚨 Claim:` read as the directive through the second stripper
// and as nothing through `markerMatches`). Both directions carried a live
// specimen — the #18373 retraction opens with a sigil, and H20 pins a list item
// as not a claim — so the file pinned the divergence rather than closing it,
// and filed the choice.
//
// The maintainer chose (batch #156 item 4, letter A): 「The protocol's
// definition of a decorated ownership line is the shared claim reading. The
// retraction channel adopts it; the 🚨-led #18373 line becomes a **named**
// near-miss row with its own fixture … ⛔ B — 「one thread, two readings」
// returns with the next spelling; ⛔ C — refused by `H20` and by #18680.」
// With #18773 A landing in the same round the prose retraction channel itself
// retired, so what adopted the shared reading is the `Release:` channel — the
// only retraction channel left — and the sigil question shrank to that
// spelling. ⇒ ONE path: every ownership line this file reads, claim or release,
// goes through `markerMatches`; the twelve spellings read the SAME here as one
// file over (5 disagreements → 0, pinned); the sigil-led shape is the sibling's
// `leading-sigil` near-miss row, audible instead of stripped. ⛔ This file owns
// no definition of 「decorated」 and grows none.
// ---------------------------------------------------------------------------

/**
 * WHICH claim comment this reading is built from, and which it is not — the
 * input half of the declaration limb (#18456).
 *
 * ⭐ ONE derivation, and that is the whole point. `cardDeclaration` used to
 * compute the governance and the pool inline, so nothing outside it could
 * state which comment had been selected without RE-deriving it — and a second
 * derivation of a selection rule is exactly how a record ends up describing a
 * reading the verdict did not take. This function is that derivation;
 * `cardDeclaration` calls it and the record renders it, so the two cannot
 * disagree about the carrier by construction.
 *
 * ⛔ It resolves no state, no row and no exit code: it reports WHICH comments
 * the reading is built from and WHY each other claim is not one of them. The
 * declaration itself is still read by `readClause2Line` from the pool, exactly
 * as before, and this function is a pure function of the rows it is handed.
 *
 * @param {{ id?: number|string, body?: string, created_at?: string }[]|null} commentRows
 * @returns {{ readable: boolean, rule: string, claims: object[], pool: object[],
 *   governing: { branches: string[], createdAt: string|null }|null,
 *   malformed: object|null, rejected: { row: object, reason: string }[] }}
 */
export function claimCarrierSelection(commentRows) {
  const rule = CLAIM_SELECTION_RULE;
  if (!Array.isArray(commentRows)) {
    return {
      readable: false, rule, claims: [], live: [], retracted: new Map(),
      pool: [], governing: null, malformed: null, rejected: [],
    };
  }
  // ⛔ MEMBERSHIP before recency (#18719). A withdrawn claim is not a stale
  // candidate to be out-ranked — it is not a candidate. Governance is resolved
  // over the thread with the retracted claims REMOVED, so the newest-branch
  // rule can never land on a record its own author has taken back, and so the
  // `malformed` reading below is about a LIVE claim rather than a dead one.
  const retracted = claimRetractions(commentRows);
  const governance = claimGovernance(commentRows.filter((row) => !retracted.has(row)));
  // ⭐ The full claim listing KEEPS the retracted rows: the record names them
  // RETRACTED below. A pool that silently shrank would replace one invisible
  // fact with another.
  const claims = commentRows.filter((row) => markerMatches(CLAIM_COMMENT_MARKER, String(row?.body ?? '')));
  const live = claims.filter((row) => !retracted.has(row));
  const governing = governance.governing;
  const matched = governing ? live.filter((row) => (row?.created_at ?? null) === governing.createdAt) : [];
  const pool = governing && matched.length > 0 ? matched : live;
  const rejected = claims
    .filter((row) => !pool.includes(row))
    .map((row) => {
      const gone = retracted.get(row);
      return {
        row,
        reason: gone
          ? `RETRACTED — comment ${gone.id} at ${gone.at}, by the same author (\`${gone.author}\`), `
            + `takes it back via ${gone.channel}. ⛔ NOT superseded: a withdrawn claim is not a `
            + `candidate for governance at all, whatever its date`
          : `a SUPERSEDED claim — it is not the newest LIVE claim that parses a branch, so it is not `
            + `the governing claim (this one is stamped ${row?.created_at ?? 'with no readable date'}; `
            + `the governing claim is stamped ${governing?.createdAt ?? 'unreadably'})`,
      };
    });
  return {
    readable: true, rule, claims, live, retracted,
    pool, governing, malformed: governance.malformed, rejected,
  };
}

const CLAUSE2_CORRECTION_KEY_TEXT = 'Clause-②-correction';

/**
 * The declaration limb of one CARD, judged over its comment thread.
 *
 * The designated carrier is the card's governing CLAIM comment — SKILL.md puts
 * the line in the claim shape, and the enqueue gate's content limb is described
 * as "judged from the card". So a declaration living anywhere else on the
 * thread is a real, separate state (`misplaced`): the seat did the thinking and
 * wrote it down, in a place the gate's predicate does not read. Reporting that
 * as `absent` would blame the wrong thing, and reporting it as `declared` would
 * bless a carrier the gate cannot use.
 *
 * ⭐ "Not read" is TWO facts, and they are returned as two states because the
 * remedies differ and one count over both describes neither. `absent` — no
 * comment on the thread is a claim comment at all, so the carrier this limb
 * reads does not exist and no line could have been read from it; what is owed
 * is the claim comment. `missing` — a claim comment IS there and carries no
 * declaration line; the carrier exists and the line is what is owed.
 *
 * ⭐ A THIRD fact sits underneath both of them, and it is not a reading of the
 * declaration at all: WHICH claim comment is the carrier. The designated
 * carrier is the GOVERNING claim, and governance is resolved by a branch parse
 * — so a newest claim comment that names no parseable branch used to be
 * discarded, silently handing this limb an OLDER claim's declaration to read.
 * That is `claim-branch-unparsed`, and it is returned BEFORE any line is read
 * from any comment, because every reading below it would be a reading of the
 * wrong comment. It is neither of the two not-read states above and ⛔ never a
 * `no`: an unparsed claim is an UNCLASSIFIED result, and the caller accounts it
 * as UNJUDGED (exit 2) rather than as a verdict about this pair. The measured
 * cost of the silence is on #16322 — the limb read a superseded `Clause-②: no`
 * and exited 4 for two rounds — and its sharper half is the sibling that passed
 * because the older claim happened to agree.
 *
 * The predicate that separates them is `CLAIM_COMMENT_MARKER`, imported rather
 * than restated, and OFFERED through `markerMatches` — the sibling's one
 * reading (#18764), imported for the same reason the constant is. A claim
 * comment is one whose body carries a LINE BEGINNING `Claim:` (or `Claimed:`,
 * optionally blockquoted), read bare first and then with the shared
 * decoration stripped, so `**Claim:**` and `` `Claim:` `` are that same line
 * and ⛔ not a second spelling this file admits on its own. A heading-style
 * claim (`## Claim — …`) is still not a claim comment here, however complete
 * the reasoning under it, and its thread reads `absent`. ⛔ Widening the
 * predicate is not this file's to do: the constant AND the reading are the
 * sibling's precisely so the two readers cannot drift, and the remedy for a
 * thread that reads `absent` is a comment in the fixed spelling.
 *
 * @param {{ body?: string, created_at?: string }[]|null} commentRows — the REST
 *   comment rows, or `null` when the thread could NOT be read.
 * @returns {{ state: 'declared'|'malformed'|'misplaced'|'missing'|'absent'|'unreadable'
 *   |'claim-branch-unparsed',
 *   value?: 'yes'|'no', detail?: string, nearMissReason?: 'describing'|'inline-key'|'spelling',
 *   correctionNote?: string, malformedClaim?: object, governingClaim?: object }} —
 *   `correctionNote` rides alongside for exactly one purpose, the same way
 *   `nearMissReason` does: the rows below print it. ⛔ It is not part of the state
 *   union and no verdict, count or exit reads it. `malformedClaim` /
 *   `governingClaim` ride the same way, on the `claim-branch-unparsed` state only,
 *   so its sentence can name the comment and say what governance did instead.
 */
export function cardDeclaration(commentRows, { card = null } = {}) {
  if (!Array.isArray(commentRows)) return { state: 'unreadable' };
  // ⭐ ONE derivation of the carrier, shared with the input record (#18456):
  // the governance, the claim rows and the pool below are this function's
  // return, so the block that STATES which comment was selected and the
  // reading that was taken FROM it cannot describe two different comments.
  const selection = claimCarrierSelection(commentRows);
  const governance = { governing: selection.governing, malformed: selection.malformed };
  // ⛔ FIRST, and ahead of the correction read (#17366) as well as of every
  // line read below. When the newest claim comment parses to zero branches,
  // `governing` is an OLDER claim or nothing at all — so the pool the reads
  // below are built from is the wrong carrier, and a correction naming that
  // older claim's id would be applied to it too. Every one of those readings
  // would be about a comment the seat has already replaced, which is the
  // silence this state exists to end. ⛔ Never resolved by guessing a branch
  // out of the claim's prose: the reader is not widened here or anywhere.
  if (governance.malformed) {
    return {
      state: 'claim-branch-unparsed',
      malformedClaim: governance.malformed,
      governingClaim: governance.governing,
    };
  }
  // The governing claim is the one the board is waiting on; when no comment
  // names a branch, every claim-marked comment is still a claim carrier and is
  // read, so a claim written without a branch cannot make the declaration
  // invisible. Both sets come from the selection above.
  // ⛔ The LIVE claims, never the full listing (#18719): a retracted claim is
  // not a carrier, so a thread whose every claim was withdrawn owes the claim
  // comment (`absent`) rather than a line on a record nobody stands behind
  // (`missing`). The not-read state this file already has, ⛔ not a fabricated
  // carrier.
  const claimRows = selection.live;
  const pool = selection.pool;
  // WHICH comment id a remedy printed below may name, resolved from the SAME
  // pool the readings are built from and from nowhere else (#17919). It rides
  // alongside exactly as `correctionNote` does: the rows below print it, and
  // ⛔ no state, verdict, count or exit reads it.
  const target = correctionTarget(pool, card);

  // The CORRECTION reading comes first (#17366), and it supersedes in BOTH
  // directions: an unreadable claim declaration and a claim declaration whose
  // VALUE the seat got wrong are repaired by the same act, because the seat has
  // no edit for either. `applicableCorrection` never widens what counts as an
  // answer — the correction's own line is read by `readClause2Line` — so what
  // this branch changes is WHICH COMMENT carried it, never WHAT was accepted.
  const correction = applicableCorrection(commentRows, pool);
  if (correction.state === 'applies') {
    return {
      state: 'declared', value: correction.value, detail: correction.detail, correctionNote: correction.note,
    };
  }
  // An IGNORED correction rides along on whatever the thread reads without it,
  // so the row below can say why the repair did not land. ⛔ It never changes
  // the state: a correction that was not read is not a declaration.
  const correctionNote = correction.state === 'ignored' ? correction.note : undefined;
  const withNote = (o) => ({
    ...o,
    ...(correctionNote === undefined ? {} : { correctionNote }),
    correctionTarget: target,
  });

  let malformed = null;
  let nearMiss = null;
  for (const row of pool) {
    const read = readClause2Line(row?.body);
    if (read?.kind === 'declared') return withNote({ state: 'declared', value: read.value, detail: read.line });
    if (read?.kind === 'malformed' && malformed === null) malformed = read;
    if (read?.kind === 'near-miss' && nearMiss === null) nearMiss = read;
  }
  if (malformed) return withNote({ state: 'malformed', detail: malformed.line });

  // Not in the claim carrier. Is it on the thread at all? That distinction is
  // the whole point of this function.
  //
  // ⛔ A recognised CORRECTION comment is skipped here, and that is the #17366
  // mechanism's own boundary rather than a convenience: a correction is this
  // limb's designated second carrier, so reading its line as MISPLACED would
  // send the seat to move a line that is already where the rule puts it. An
  // IGNORED correction is skipped for the same reason — the note above says
  // what is wrong with it, and `misplaced` would say something false.
  for (const row of commentRows) {
    if (readClause2Correction(row) !== null) continue;
    const read = readClause2Line(row?.body);
    if (read?.kind === 'declared') return withNote({ state: 'misplaced', value: read.value, detail: read.line });
    if (read?.kind === 'malformed' && malformed === null) malformed = read;
    if (read?.kind === 'near-miss' && nearMiss === null) nearMiss = read;
  }
  if (malformed) return withNote({ state: 'malformed', detail: malformed.line });
  // Which of the two not-read states this is, told apart by whether the carrier
  // exists at all. `claimRows` is non-empty exactly when some comment matched
  // the imported claim predicate, and `pool` is derived from it — so this asks
  // the same question the reading above asked and cannot answer it differently.
  // `nearMissReason` rides alongside the quoted line for exactly one purpose:
  // the row below picks its REMEDY sentence from it. ⛔ It is not part of the
  // state union and no verdict, count or exit reads it — a near miss with a
  // correctly-spelled key is the same `missing` this function has always
  // returned, and #12409's boundary moves by not one character.
  return withNote({
    state: claimRows.length > 0 ? 'missing' : 'absent',
    detail: nearMiss?.line,
    nearMissReason: nearMiss?.reason,
  });
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

const NEVER_WRITES =
  'Report-only: ⛔ never a label written from this script — hanging or clearing a review gate ' +
  'from a checker would be issuing the verdict, which is 自查放行.';

/**
 * ⚠️ The two directions of the split are NOT ranked here, and the refusal is
 * deliberate: the two standing sources rank them OPPOSITELY, which is a real
 * disagreement rather than a wording accident.
 *
 *   `check-half-states.mjs` H31 calls the CARD-bare direction "the more
 *   dangerous half", because to the enqueue path an ungated card is a card that
 *   was never gated.
 *   #13922 calls the PR-bare direction the fail-open, because "it is the
 *   carrier the enqueue gate reads", and on #13910 it was the only limb left.
 *
 * Both readings are sound about their own consumer, and this file has no
 * standing to choose between them — picking one would print an adjudication as
 * a derivation. So each direction states its own consequence and neither is
 * called worse. WHICH carrier the enqueue gate actually reads is a protocol
 * question for the maintainer; until it is answered, a split is a split.
 */
const RANKING_UNSETTLED =
  '⚠️ Which direction is the worse one is NOT settled: H31 calls the card-bare direction the ' +
  'more dangerous half (an ungated card enqueues past a live gate) while #13922 calls the ' +
  'PR-bare direction the fail-open (the PR is the carrier the enqueue gate reads). This row ' +
  'ranks neither — a split is a split, and which carrier the gate reads is a protocol question.';

const DUAL_CARRIER =
  'The gate is a DUAL carrier (maintainer 2026-08-22, 「两边都挂好」), hung in one stroke and ' +
  'cleared in one stroke. The second carrier is not decoration: it is the only machine-readable ' +
  'evidence that a gate was CLEARED rather than STRIPPED — a legitimate clear leaves two removals ' +
  'seconds apart, a strip leaves one — and 「闸门被剥不是红灯是放行」, so 「被剥」 and 「从未挂过」 ' +
  'are indistinguishable in the evidence without it.';

/**
 * One pair, as this file reads it.
 *
 * @typedef {object} Pair
 * @property {number} pr
 * @property {boolean} [draft]
 * @property {number} card
 * @property {string[]|null} prLabels   null = could not be read
 * @property {string[]|null} cardLabels null = could not be read
 * @property {{ body?: string, created_at?: string }[]|null} cardComments null = could not be read
 */

/** Did this carrier's labels come back readable? */
function gated(labels) {
  return Array.isArray(labels) ? labels.includes(CONTRACT_REVIEW_LABEL) : null;
}

/**
 * C1 — the two carriers of one gate disagree.
 *
 * The same fact H31 reports, anchored on the PAIR rather than on the card, so a
 * seat can ask it about the one PR in front of it. Both directions, and the
 * dangerous one is named as such: an ungated card with a gated PR reads, to the
 * enqueue path, as a card that was never gated.
 */
export function c1CarrierSplit(pair) {
  const onCard = gated(pair?.cardLabels);
  const onPr = gated(pair?.prLabels);
  if (onCard === null || onPr === null) return null; // unreadable — accounted as UNJUDGED, not clean.
  if (onCard === onPr) return null;
  // The PAIRING's own evidence (#16706). This row's dangerous half tells a
  // reader a live fail-open is in front of them, and the measured specimen that
  // produced one was a pair derived from an accounting sentence — so the row
  // states what the pairing rests on, in the same breath as the consequence.
  // A pair from a caller that predates the field carries no `evidence` at all;
  // it prints as it always did rather than claiming a reading nobody took.
  const bits = [];
  if (pair.draft) bits.push('draft');
  if (pair?.evidence !== undefined) bits.push(deliveryEvidenceNote(pair.evidence));
  const draft = bits.length > 0 ? ` (${bits.join(', ')})` : '';
  if (onCard && !onPr) {
    return (
      `\`${CONTRACT_REVIEW_LABEL}\` on card #${pair.card} while its delivering open PR ` +
      `#${pair.pr}${draft} does NOT carry it — the pair was written half way: either the hang ` +
      'never reached the PR side (「PR 一存在即挂」, and the PR exists), or a PASS cleared the PR ' +
      'side and stopped there, leaving the card gated behind a review that has already passed. ' +
      'Consequence on this side: the PR carrier — the one a seat reads before flipping ready — ' +
      `is bare, so nothing on the PR itself says a review is outstanding. ${RANKING_UNSETTLED} ` +
      `${DUAL_CARRIER} ${NEVER_WRITES}`
    );
  }
  return (
    `\`${CONTRACT_REVIEW_LABEL}\` on delivering open PR #${pair.pr}${draft} while card ` +
    `#${pair.card} does NOT carry it — the same split, written from the other end. ` +
    'Consequence on this side: to the enqueue path an ungated card is a card that was never ' +
    'gated, so the review this PR is still waiting on is invisible to the queue and the card ' +
    'can be enqueued straight past a gate that is demonstrably live one carrier over — and it ' +
    'is equally invisible to the review round\'s own label query over the cards. ' +
    `${RANKING_UNSETTLED} ${DUAL_CARRIER} ${NEVER_WRITES}`
  );
}

/**
 * C2 — the declaration limb has no reading.
 *
 * ⭐ The row this file exists for. A card that declared `no` made a decision; a
 * card with nothing to read made none, and until now the two looked the same to
 * every consumer. The sentence therefore leads with WHICH state this is, and
 * never prescribes a value: ⛔ nobody may fill the line in on another seat's
 * behalf, because the declaration IS the judgement.
 *
 * ⭐ "Nothing to read" is itself two readings, and each gets its own sentence
 * because each names a different remedy. A thread with no claim comment — no
 * comment carrying a line that BEGINS `Claim:`, which is the whole of the
 * predicate — has no carrier for the limb at all, and what it owes is that
 * comment; a heading-style claim (`## Claim — …`) is that case, not a claim
 * comment short of a line. A thread whose claim comment carries no
 * `Clause-②:` line has the carrier and owes the line. Reporting both as one
 * "no reading" told a seat neither which of the two it was in nor what to
 * write, and let a round report state one number about two different owings.
 */
const TEMPLATE_POINTER =
  'The claim template in `.claude/skills/pm-dispatch/SKILL.md` 〈模板与表〉 already carries the ' +
  'literal `Clause-②: yes | no` line: COPY the template\'s line rather than composing one. Every ' +
  'one of the five misses measured in the filing shift was a line composed from memory, and no ' +
  'seat needs to know this regex to satisfy it.';

/**
 * Why part (3) could not name an id, or which id it refused — always printed,
 * ⛔ never silent.
 *
 * A remedy that quietly drops the id reads as a remedy that never had one, and
 * #17919's whole cost was a number nobody could account for standing inside a
 * verdict. So each branch says which reading produced the gap, and the foreign
 * branch names the comment and the card it declared, so a reader can open both.
 */
function correctionTargetNote(target) {
  const parts = [];
  for (const f of target?.foreign ?? []) {
    parts.push(
      `⚠️ Comment ${f.id} was read on this card's claim pool but declares issue #${f.card} as its ` +
      'own parent, so it is NOT named above: an id from another card\'s thread names a comment ' +
      'this card\'s correction can never match, and a reader would take it for this card\'s claim. ' +
      '⛔ Dropped loudly rather than printed — #17919.',
    );
  }
  if ((target?.id ?? null) !== null) return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
  if ((target?.card ?? null) === null) {
    parts.push(
      '⚠️ No id is named above because this reading carries no card number to check one against, ' +
      'and an id that cannot be checked cannot be shown to be this card\'s. Read the claim ' +
      'comment\'s id off the card\'s own thread.',
    );
  } else if ((target?.candidates?.length ?? 0) === 0) {
    parts.push(
      '⚠️ No id is named above because this reading found no claim comment id on card ' +
      `#${target.card}'s own thread. ⛔ A specimen id from another card is not a stand-in: read ` +
      'the id off the claim comment on this card.',
    );
  } else {
    parts.push(
      `⚠️ No single id is named above because card #${target.card}'s claim pool carries more than ` +
      `one readable id (${target.candidates.join(' or ')}); name the ONE this correction repairs.`,
    );
  }
  return ` ${parts.join(' ')}`;
}

/**
 * The remedy that names WHO can act and HOW — the sentence #17366 was filed to
 * get, in three parts, because the old one («add the line to that claim
 * comment») named an act the claiming seat may have no tool for.
 *
 * ⛔ Nothing here prescribes a VALUE, and part (3) is a shape, never a fill-in:
 * the declaration is still the seat's judgement, written by the seat.
 *
 * ⭐ It is a FUNCTION of the card under test since #17919, and that is the fix
 * rather than a refactor. As a constant it carried a literal comment id — the
 * #17366 specimen, 5642248126, which lives on card #17366 — so every C2 row on
 * every card printed a real id belonging to a different card inside a verdict
 * about this one, and a reader had nothing in the output to tell it apart from
 * a comment the checker had selected. A constant cannot be right about a card
 * it does not know; the only ids printable here are ids read from this card's
 * own claim pool, and `correctionTarget` is where that is decided.
 *
 * ⛔ Nothing here changes a state, a row's existence or an exit code. A row
 * that printed before prints now, with the same verdict; what moves is which
 * digits part (3) carries, and whether it carries any.
 */
function correctionRemedy(target) {
  const id = target?.id ?? null;
  const shape = id === null
    ? 'whose FIRST line is the key `Clause-②-correction:` followed by the numeric id of the ' +
      'claim comment it corrects, digits only'
    : `whose FIRST line is \`Clause-②-correction: ${id}\` — the numeric id of the claim comment ` +
      `it corrects, digits only, read from card #${target.card}'s own thread`;
  return (
    'Remedy — WHO can act, and HOW: the CLAIMING SEAT itself, and it needs no comment edit. ' +
    `(1) ${TEMPLATE_POINTER} ` +
    '(2) ⚠️ A claim comment that is ALREADY POSTED cannot be repaired by editing it from every ' +
    'seat: the MCP GitHub tool set has no edit-an-issue-comment call, and ⛔ a second `Claim:` is ' +
    'forbidden by the claim protocol. ⛔ Do not wait for somebody outside the repository. ' +
    `(3) Post ONE new comment on this card ${shape} — followed by the declaration in ` +
    'the fixed spelling on a line of its own, and a `Session:` line carrying the claiming session. ' +
    'The newest correction naming the governing claim SUPERSEDES that claim\'s declaration, in ' +
    'both directions; one naming any other comment, or declaring a different session, is ignored ' +
    `with a printed reason. ⛔ Never a second \`Claim:\`.${correctionTargetNote(target)}`
  );
}

export function c2DeclarationUnreadable(pair) {
  // ⭐ The card number travels WITH the thread (#17919): the remedy this row
  // prints may name a comment id, and an id is only printable once it has been
  // checked against the card being judged.
  const d = cardDeclaration(pair?.cardComments ?? null, { card: pair?.card ?? null });
  const head = `card #${pair.card} (delivering open PR #${pair.pr}${pair.draft ? ' (draft)' : ''})`;
  // An IGNORED correction is appended to whichever row the thread earns, so a
  // seat that DID try the self-solvable exit is told why it did not land — ⛔
  // never left to read a row that describes only the claim and conclude the
  // correction was never seen (#17366).
  const withCorrection = (row) => (row === null || d.correctionNote === undefined
    ? row
    : `${row} ⚠️ A correction comment WAS posted and did NOT take effect: ${d.correctionNote}`);
  const fixed = `the fixed spelling is \`Clause-②: yes\` or \`Clause-②: no\`, exactly those two`;
  const notADecision =
    'A missing reading is NOT a declared `no`: one of those is a decision and the other is an ' +
    'absent one, and the enqueue gate\'s content limb — the ONLY limb that can fire for a PR ' +
    'whose diff touches no contract path — has nothing to read. ⛔ Do not fill the line in on ' +
    'the claiming seat\'s behalf; the declaration IS the judgement. ⛔ And do not relax the ' +
    'spelling to accept the prose: a predicate that reads prose is a heuristic, and the measured ' +
    'terminus of that direction is a check that can barely fail.';
  return withCorrection(c2Sentence(d, head, fixed, notADecision));
}

/**
 * The C2 sentence itself, one per state — split out so the correction note is
 * appended in exactly one place rather than on each branch.
 */
function c2Sentence(d, head, fixed, notADecision) {
  // Built once, from the ids this reading actually read off this card's thread.
  const CORRECTION_REMEDY = correctionRemedy(d.correctionTarget);
  switch (d.state) {
    case 'declared':
      return null;
    case 'unreadable':
      return null; // accounted as UNJUDGED by the caller — never silently clean.
    case 'claim-branch-unparsed':
      // Same posture, same reason: the carrier itself is unresolved, so this is
      // UNJUDGED rather than a verdict about the pair, and `pairUnjudged` prints
      // the whole sentence and raises exit 2. ⛔ Returning a C2 row here would
      // make an unclassified result exit 4 — a verdict — which is exactly the
      // reading the filing card refuses ('never a no').
      return null;
    case 'misplaced':
      return (
        `${head} — the \`Clause-②\` declaration is MISPLACED: the fixed spelling appears on the ` +
        `thread (${JSON.stringify(d.detail)}) but NOT in the card's claim comment, which is the ` +
        'carrier the enqueue gate\'s content limb reads. The thinking was done and written down; ' +
        `it is in a place the predicate does not look. The line belongs in the claim comment — ` +
        `${fixed}. ${CORRECTION_REMEDY} ${NEVER_WRITES}`
      );
    case 'malformed':
      return (
        `${head} — the \`Clause-②\` line is MALFORMED: ${JSON.stringify(d.detail)} carries the key ` +
        `but not one of the two values, so there is no reading. ${fixed}. ${notADecision} ` +
        `${CORRECTION_REMEDY} ${NEVER_WRITES}`
      );
    case 'missing':
      // #17098: the key is at the start of a line, spelled exactly right, and
      // the line is QUOTING the spelling rather than declaring a value. The
      // state is `missing` and exits 4 exactly as it always did; what changes
      // is that this line USED TO BE READ as the card's declaration, so the
      // remedy has to say what the seat is looking at. ⛔ It never tells the
      // seat to edit the quoted line: an explanation of the protocol is a
      // correct thing to have written.
      if (d.nearMissReason === 'describing') {
        return (
          `${head} — NO READING on the declaration limb: the thread carries the key in the ` +
          `fixed spelling and at the START of a line, on ${JSON.stringify(d.detail)}, but that ` +
          'line QUOTES the spelling rather than declaring a value — it names the key twice, or ' +
          'holds the key inside an inline-code span the line goes on talking outside of. ⛔ A ' +
          'quotation of the protocol is not a judgement about this diff, and the two are told ' +
          'apart by the line\'s markdown structure, never by reading its words. ⛔ There is ' +
          'nothing to fix on the quoted line — it is a correct thing to have written. What is ' +
          'owed is a declaration of its OWN, ABOVE it: this limb reads the first line that IS ' +
          `a declaration attempt, so position is the whole remedy — ${fixed}. ` +
          `${CORRECTION_REMEDY} ${notADecision} ${NEVER_WRITES}`
        );
      }
      // The key is on the thread, spelled exactly right, and simply not at the
      // start of a line. The state is unchanged — it was not read, so it is
      // still `missing` and still exits 4 — but the remedy that ships with the
      // sentence below sends the seat to inspect SPELLING, which for this shape
      // is a search for a typo that is not there. Naming the placement is the
      // whole of the change; ⛔ nothing here accepts the line.
      if (d.nearMissReason === 'inline-key') {
        return (
          `${head} — NO READING on the declaration limb, and the PLACEMENT of the key is what is ` +
          `wrong, NOT its spelling: the thread carries the key in the fixed spelling, on ` +
          `${JSON.stringify(d.detail)}, but not at the START of a line. This limb is read ` +
          'line-anchored — only whitespace, a blockquote `>`, a list bullet and backtick/bold ' +
          'wrapping may precede the key — so a key that follows another field on a shared line is ' +
          'not read, however correctly it is spelled. ⛔ There is no typo to find on that line. ' +
          'The `Clause-②: yes|no` line belongs on a line of its OWN, unchanged otherwise — ' +
          `${fixed}. ${CORRECTION_REMEDY} ${notADecision} ${NEVER_WRITES}`
        );
      }
      return (
        `${head} — NO READING on the declaration limb, and the DECLARATION LINE is what is ` +
        `missing: the card's claim comment is there and carries no \`Clause-②:\` line in the ` +
        'fixed spelling' +
        (d.detail ? `, and the nearest thing on the thread is ${JSON.stringify(d.detail)}` : '') +
        `. That claim comment owes the line — ${fixed}. ${CORRECTION_REMEDY} ${notADecision} ` +
        `${NEVER_WRITES}`
      );
    default:
      return (
        `${head} — NO READING on the declaration limb, and the CLAIM COMMENT is what is ` +
        'missing: no comment on the card\'s thread is a claim comment, so the carrier this limb ' +
        'reads does not exist and no line could have been read from it' +
        (d.detail ? `; the nearest thing on the thread is ${JSON.stringify(d.detail)}` : '') +
        '. Remedy — WHO can act, and HOW: the claiming seat, with one comment it can post today. ' +
        'Write the claim comment with a first line beginning `Claim:`, then the ' +
        `\`Clause-②: yes|no\` line; ${fixed}. ${TEMPLATE_POINTER} A heading-style claim ` +
        '(`## Claim — …`) is not a claim comment to this predicate, however complete the ' +
        `reasoning under it. ${notADecision} ${NEVER_WRITES}`
      );
  }
}

// ---------------------------------------------------------------------------
// The FOURTH reading of the declaration limb — one PR, two cards (#16304)
// ---------------------------------------------------------------------------

/**
 * The OTHER cards this same PR delivers, and what each one's OWN claim comment
 * declares.
 *
 * ⛔ Read through `cardDeclaration` — the same function, the same imported
 * `CLAIM_COMMENT_MARKER`, the same two spellings. Only a `declared` state on a
 * sibling's own claim comment is a carrier here: `misplaced`, `malformed`,
 * `missing`, `absent`, `claim-branch-unparsed` and `unreadable` are all NOT
 * declarations on the sibling either, exactly as they are not on the subject
 * card — and the unparsed one least of all, since on that sibling this file
 * cannot even say WHICH comment would have carried the line. Nothing about what
 * counts as an answer moves in this function; what moves is only which card is
 * being asked.
 *
 * The siblings are drawn from the SAME derived pair set the caller is
 * rendering, so a sibling is by construction a card `prDeliversCard` said this
 * PR delivers — never a card named by a reader, and never a card from another
 * PR. A caller that passes no set gets an empty list, which is the fail-closed
 * direction: the subject card then reads exactly as it did before #16304.
 *
 * @param {{ pr?: number, card?: number }} pair
 * @param {{ pr?: number, card?: number, cardComments?: object[]|null }[]|null} pairs
 * @returns {{ card: number, value: 'yes'|'no', detail?: string }[]}
 */
export function siblingDeclarations(pair, pairs) {
  const out = [];
  if (!pair || !Array.isArray(pairs)) return out;
  const seen = new Set();
  for (const other of pairs) {
    if (!other || other === pair) continue;
    if (Number(other.pr) !== Number(pair.pr)) continue;
    if (Number(other.card) === Number(pair.card)) continue;
    if (seen.has(Number(other.card))) continue;
    const d = cardDeclaration(other?.cardComments ?? null);
    if (d.state !== 'declared') continue;
    seen.add(Number(other.card));
    out.push({ card: Number(other.card), value: d.value, detail: d.detail });
  }
  return out;
}

/**
 * Is THIS pair in the fourth reading's shape?
 *
 * The ONE predicate the row, the row suppression and the sweep tally all read —
 * the same discipline `needsGateHistory` and `needsWideningRead` follow, so the
 * set that gets the fourth reading and the set that is kept out of the C2 count
 * cannot drift apart.
 *
 * ⭐ `absent` and nothing else. That is the whole #13914 guard, and it is
 * structural rather than argued: `absent` means NO comment on the thread begins
 * a line `Claim:`, which is the state of a card that was never separately
 * dispatched — and a card that WAS dispatched carries a claim comment by
 * protocol, so a dispatched card whose declaration line is missing reads
 * `missing` and keeps its C2 row and its exit 4. `malformed`, `misplaced` and
 * `missing` all mean a seat DID read this card and owes it something a
 * legitimate act can supply; none of them is covered here. Neither is
 * `claim-branch-unparsed`, and for a sharper reason: that state means this file
 * could not resolve which comment is the carrier AT ALL, so borrowing a
 * sibling's declaration would answer a question this card has not yet been able
 * to ask. It is UNJUDGED (exit 2), which the caller reaches before any row.
 */
export function readsSiblingDeclaration(pair, pairs) {
  if (cardDeclaration(pair?.cardComments ?? null).state !== 'absent') return false;
  return siblingDeclarations(pair, pairs).length > 0;
}

/**
 * The fourth reading, as a printed row.
 *
 * ⚠️ It asserts a LOCATION, never a substitution. The declaration is not moved
 * onto this card, no value is attributed to it, and the row says in as many
 * words that a reader must still satisfy themselves the sibling's reading
 * covers this card's half of the increment. Going quiet instead would be the
 * one thing this whole file exists against — and it would also hide the case
 * where two siblings declare DIFFERENTLY, which is a real state and is named
 * here rather than resolved by fiat (the same call `RANKING_UNSETTLED` makes
 * one row up: this file reports a disagreement, it does not rank one).
 */
export function c2SiblingDeclared(pair, pairs) {
  if (!readsSiblingDeclaration(pair, pairs)) return null;
  const siblings = siblingDeclarations(pair, pairs);
  const head = `card #${pair.card} (delivering open PR #${pair.pr}${pair.draft ? ' (draft)' : ''})`;
  const where = siblings
    .map((s) => `card #${s.card} declares \`Clause-②: ${s.value}\`${s.detail ? ` (${JSON.stringify(s.detail)})` : ''}`)
    .join('; ');
  const disagree =
    new Set(siblings.map((s) => s.value)).size > 1
      ? '⚠️ Those siblings do NOT agree with each other, and this row does not pick between them: ' +
        'one PR has one contract increment, so a reader owes an answer about which reading governs ' +
        'it before the pair enqueues. '
      : '';
  return (
    `${head} — the declaration limb has NO READING ON THIS CARD, and the CLAIM COMMENT is why: no ` +
    "comment on its thread begins a line `Claim:`, so the carrier this limb reads does not exist. " +
    '⭐ But this PR delivers more than one card, and the declaration governing its contract ' +
    `increment IS readable, in the fixed spelling, on a SIBLING card the same PR delivers — ${where}. ` +
    'That is the FOURTH reading of this limb (#16304) and it is neither of the two not-read ' +
    'states: nothing is owed on this card. A card that closes when its sibling\'s PR lands is ' +
    'never separately dispatched, so it never receives a claim comment, and the only act that ' +
    'could put one there is the act this file forbids — ⛔ writing the declaration on the claiming ' +
    `seat's behalf. ${disagree}⚠️ What a reader must still verify: that the sibling's reading ` +
    'covers THIS card\'s half of the increment too. The declaration was made about the PR; this ' +
    'row asserts only WHERE it lives and what it says, and ⛔ never moves it onto this card. ' +
    '⛔ This reading needs a sibling that DECLARED: a PR delivering exactly one card, or one whose ' +
    'other cards carry no claim comment with a `Clause-②:` line, still gets the C2 row and exit 4, ' +
    `unchanged. ${NEVER_WRITES}`
  );
}

// ---------------------------------------------------------------------------
// The gate's HISTORY — what tells a completed review from one that never ran
// ---------------------------------------------------------------------------

/**
 * The gate's history on ONE carrier, read from that carrier's own label events.
 *
 * ⚠️ The rows arrive OLDEST FIRST, so a caller that reads only the first page
 * of a long carrier gets the oldest events and never sees the removal — which
 * reads as "still hung" or "never hung" depending on the truncation point. The
 * live reader below therefore pages to exhaustion and hands `null` when it
 * could not; ⛔ a short read is never a history.
 *
 * Sorted here rather than trusted: the endpoint's order is documented, but this
 * function is also fed self-test fixtures, and a reading that depends on the
 * caller's ordering is a reading that breaks silently when the caller changes.
 *
 * @param {{event?: string, created_at?: string, label?: {name?: string},
 *          actor?: {login?: string}}[]|null} events — that carrier's event
 *   rows, or `null` when the stream could NOT be read.
 * @returns {{ state: 'never-hung' }
 *          | { state: 'hung', at: string, actor: string|null }
 *          | { state: 'cleared', at: string, actor: string|null }
 *          | { state: 'unreadable' }}
 */
export function carrierGateHistory(events) {
  if (!Array.isArray(events)) return { state: 'unreadable' };
  const gate = [];
  for (const e of events) {
    if (!e || (e.event !== 'labeled' && e.event !== 'unlabeled')) continue;
    // The SAME label constant H31 and H35 read, imported, never restated.
    if (!isGateSemanticLabel(e.label?.name)) continue;
    const ms = Date.parse(e.created_at ?? '');
    // ⛔ An undated gate event is not a droppable row: dropping it would move
    // the "last event" and could turn a live hang into a clear. Refuse instead.
    if (!Number.isFinite(ms)) return { state: 'unreadable' };
    gate.push({ verb: e.event, at: String(e.created_at), actor: e.actor?.login ?? null, ms });
  }
  if (gate.length === 0) return { state: 'never-hung' };
  gate.sort((a, b) => a.ms - b.ms);
  const last = gate[gate.length - 1];
  return { state: last.verb === 'labeled' ? 'hung' : 'cleared', at: last.at, actor: last.actor };
}

/**
 * Is this pair in C3's candidate shape — the ONLY shape whose event streams are
 * read?
 *
 * The cost bound, stated as a predicate so the live reader and the UNJUDGED
 * accounting cannot disagree about which pairs owe an event stream. A pair that
 * declared `no`, or that still carries the gate on either carrier, is answered
 * from the labels alone and costs nothing extra.
 */
export function needsGateHistory(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
  if (d.state !== 'declared' || d.value !== 'yes') return false;
  const onCard = gated(pair?.cardLabels);
  const onPr = gated(pair?.prLabels);
  if (onCard === null || onPr === null) return false; // already UNJUDGED on labels.
  return !onCard && !onPr;
}

/**
 * What the two event streams say about the gate this declaration should bind.
 *
 * ⭐ The distinction #14155 filed: a `Clause-②: yes` declaration is HISTORY and
 * stays on the thread forever, while the label is STATE that a completed review
 * clears from both carriers by rule — so every pair that completes its review
 * lands in the same shape as the fail-open C3 hunts, and before this function
 * the two were indistinguishable. The label EVENTS separate them without going
 * anywhere near a verdict comment: a gate that was bound leaves a `labeled`, and
 * a review that completed leaves an `unlabeled` on each carrier.
 *
 * ⛔ This is NOT the PASS half. The recovery rule in `references/contract-review.md`
 * reads 「PASS + 无标 + head 未动 = 已清标非被剥」; the PASS conjunct stays human,
 * because #12409 measured PASS-token matching as a check that can barely fail
 * and this file's own header bans verdict-reading as 自查放行. What is
 * mechanized here is the other two conjuncts — 无标 and head 未动 — and a clean
 * answer therefore means "the gate was bound and cleared by the discipline, and
 * nothing has moved since", never "the review passed".
 *
 * @returns {{ state: 'not-candidate' }
 *          | { state: 'unreadable', gaps: string[] }
 *          | { state: 'never-hung' }
 *          | { state: 'still-hung' }
 *          | { state: 'half-bound', bound: 'card'|'pr', at: string }
 *          | { state: 'completed', clearedAt: string }
 *          | { state: 'moved-after-clear', clearedAt: string, headAt: string }}
 */
export function gateBindingState(pair) {
  if (!needsGateHistory(pair)) return { state: 'not-candidate' };
  const card = carrierGateHistory(pair?.cardEvents ?? null);
  const pr = carrierGateHistory(pair?.prEvents ?? null);

  const gaps = [];
  if (card.state === 'unreadable') gaps.push(`card #${pair?.card}'s label event stream`);
  if (pr.state === 'unreadable') gaps.push(`PR #${pair?.pr}'s label event stream`);
  if (gaps.length > 0) return { state: 'unreadable', gaps };

  if (card.state === 'never-hung' && pr.state === 'never-hung') return { state: 'never-hung' };
  // Both carriers are bare NOW (that is the candidate shape), so a trailing
  // `labeled` means the stream and the labels disagree — a read this file will
  // not reconcile by picking a winner.
  if (card.state === 'hung' || pr.state === 'hung') return { state: 'still-hung' };
  if (card.state === 'never-hung' || pr.state === 'never-hung') {
    const bound = card.state === 'cleared' ? 'card' : 'pr';
    return { state: 'half-bound', bound, at: bound === 'card' ? card.at : pr.at };
  }

  // Both cleared. The conservative anchor is the EARLIER removal: a review
  // concluded before either carrier was touched, so motion after the first
  // clear is motion after the conclusion.
  const clearedMs = Math.min(Date.parse(card.at), Date.parse(pr.at));
  const clearedAt = Date.parse(card.at) <= Date.parse(pr.at) ? card.at : pr.at;
  const headAt = pair?.headCommittedAt ?? null;
  const headMs = Date.parse(headAt ?? '');
  if (!Number.isFinite(headMs)) {
    return { state: 'unreadable', gaps: [`PR #${pair?.pr}'s head commit date`] };
  }
  if (headMs > clearedMs) return { state: 'moved-after-clear', clearedAt, headAt: String(headAt) };
  return { state: 'completed', clearedAt };
}

/**
 * C3 — a declared `yes` whose gate is on NEITHER carrier, refined by the event
 * stream into the states that shape actually covers.
 *
 * The fail-open direction is the one a carrier COMPARISON is structurally blind
 * to: agreement on absence is H31's silent case. Measured live on PR #13910 /
 * card #13476 (2026-08-31), where the author had identified their own change as
 * clause-② and written it down, and not one of the three mechanisms that exist
 * to catch that was in a state to fire.
 *
 * ⚠️ But bare-on-both is also where a LEGITIMATELY cleared pair lands, measured
 * on PR #13864 / card #13657 (2026-09-01, #14155): review PASS at head
 * `9af92aa3`, both carriers cleared in one stroke nine seconds apart, and C3
 * fired on the completed state. Read literally, that made the landing check's
 * ② unsatisfiable after its own clear — the check could only pass in the window
 * between PASS and clear, which is the wrong order. The event stream is what
 * tells the two apart, so this row now fires on three distinguishable adverse
 * states and stays silent on the completed one.
 */
export function c3DeclaredYesUngated(pair) {
  const binding = gateBindingState(pair);
  if (binding.state === 'not-candidate') return null;
  if (binding.state === 'unreadable') return null; // UNJUDGED by the caller — never silently clean.
  if (binding.state === 'completed') return null; // ⭐ #14155: the completed state, and the only clean one.

  const head = `card #${pair.card} declares \`Clause-②: yes\` while NEITHER it nor its delivering open PR #${pair.pr}${pair.draft ? ' (draft)' : ''} carries \`${CONTRACT_REVIEW_LABEL}\``;
  const readsEvents =
    'The label EVENT STREAM on both carriers is what separates this from a legitimately cleared ' +
    'pair — a completed review clears the gate from both carriers by rule, so the declaration ' +
    '(history, permanent) outliving the label (state, cleared) is the NORMAL end state and is not ' +
    'reported here. ⛔ No verdict comment is read to reach that: the PASS half stays human.';

  switch (binding.state) {
    case 'moved-after-clear':
      return (
        `${head} — the gate WAS bound and cleared (last removal ${binding.clearedAt}), but the PR's ` +
        `head has MOVED since: its head commit is dated ${binding.headAt}. The review that cleared ` +
        'this gate judged a different tree, so the clear no longer covers what would land. This is ' +
        'the 重挂-owed state the recovery rule already names — 「head 后移或无结论才重挂」 — and ' +
        `the re-hang is a seat's act, not this script's. ${readsEvents} ${NEVER_WRITES}`
      );
    case 'half-bound':
      return (
        `${head} — and the gate was bound on the ${binding.bound === 'card' ? 'CARD' : 'PR'} carrier ` +
        `only (cleared ${binding.at}), with no hang ever recorded on the other. ${DUAL_CARRIER} One ` +
        'removal where a legitimate clear leaves two is the strip signature, so this pair cannot be ' +
        'read as a completed review. ⚠️ The repo-wide, windowed form of this question is H35 in ' +
        '`check-half-states.mjs`, which judges removals against the 同笔 stroke window; this row is ' +
        'the per-pair form and is unbounded in time, so it also sees a pair gated long before that ' +
        `window opened. ${readsEvents} ${NEVER_WRITES}`
      );
    case 'still-hung':
      return (
        `${head} — yet the label event stream ends on a HANG for at least one carrier, so the two ` +
        'readings of the same gate disagree: the labels say bare, the events say hung. One of them ' +
        'is stale, and this file does not pick a winner by fiat — re-read both carriers before ' +
        `treating this pair as either gated or clear. ${readsEvents} ${NEVER_WRITES}`
      );
    default:
      return (
        `${head}, and the event stream shows the gate was NEVER HUNG on either carrier — the ` +
        'gate the declaration is supposed to bind was never bound at all, so the content limb fired ' +
        'in prose and nothing downstream is holding the door. ⚠️ A comparison of the two carriers ' +
        'cannot see this: agreement on ABSENCE is its silent case, which is why the declaration is ' +
        `read here rather than inferred from the labels. ${readsEvents} ${NEVER_WRITES}`
      );
  }
}

// ---------------------------------------------------------------------------
// The verdict's AUTHORSHIP — the independence clause, given a carrier
// ---------------------------------------------------------------------------

/**
 * The discriminator: what makes a comment a contract-review VERDICT.
 *
 * Chosen from the live corpus rather than invented — the verdicts on the board
 * open a fenced block whose first line is `VERDICT: PASS`, alongside
 * `REVIEWED-HEAD:` and `CLAUSE-2-PATH:`/`CLAUSE-2-CONTENT:`. The key is read the
 * way `CLAUSE2_KEY_LINE` reads its own: the colon must follow the key, and the
 * same markdown decoration is tolerated because a seat writes it without meaning
 * anything by it.
 *
 * ⛔ The corpus also supplies the near miss that makes the colon load-bearing:
 * an os-dev report on the same board writes `` `VERDICT command-exit 0` `` in
 * prose, repeatedly. A discriminator that merely looked for the WORD would read
 * a build log as a review verdict; requiring the colon leaves it silent.
 */
const VERDICT_MARKER = /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?`?VERDICT`?(?:\*\*)?[ \t]*:/;

/**
 * Is this comment a contract-review verdict at all — in EITHER live dialect.
 *
 * ⭐ The corpus moved and the discriminator did not (#17346). `VERDICT_MARKER`
 * was measured on the 2026-09-01 board, where a verdict opened a fenced block
 * whose first line was `VERDICT: PASS`. Every contract-review verdict measured
 * on the 2026-09-09 board is written the other way — a `## Contract review`
 * heading, the reviewed head as a code span, `**Verdict: PASS WITH FINDINGS**`
 * in bold mixed case — and carries no uppercase `VERDICT:` line anywhere. Read
 * with the 2026-09-01 marker alone, all four measured specimens answered `null`
 * (PR #17073 comments 5597841101 / 5600239551, PR #17116 5600627944, PR #17090
 * 5598904803), so C4 had NO live population: `--pair` exit 0 said nothing about
 * independence for any pair reviewed in the current dialect, and the
 * self-review shape this row exists to refuse could not be reached at all.
 *
 * ⭐ The second dialect is H51's, IMPORTED and not restated —
 * `CONTRACT_REVIEW_HEADING_MARKER` plus `contractReviewHeadMatch` against this
 * pair's head, the same two facts C6 recognises a review of record with. One
 * recognition, two rows: C4 and C6 can never disagree about what a verdict
 * comment looks like, which is the drift a second regex here would be.
 *
 * ⛔ NOT a regex for the verdict WORD, in either dialect. This file's header
 * bans verdict-reading as 自查放行, H51 is verdict-agnostic by construction,
 * and the corpus already spells the word two ways — the "check that can barely
 * fail" #12409 measured. What is read is that a verdict comment EXISTS and who
 * it says wrote and reviewed the diff, never what it concluded.
 *
 * ⭐ The head is what keeps the heading path honest, and it is REQUIRED for it:
 * a comment that merely quotes a review heading is not a verdict on this head,
 * and `contractReviewHeadMatch` answers `null` below `H51_SHA_MIN_HEX`. A
 * caller with no head in hand therefore gets exactly the 2026-09-01 reading —
 * the fenced marker alone — rather than a looser one.
 */
function isVerdictComment(body, headSha) {
  if (String(body ?? '').split(/\r?\n/).some((line) => VERDICT_MARKER.test(line))) return true;
  return CONTRACT_REVIEW_HEADING_MARKER.test(String(body ?? '')) && contractReviewHeadMatch(body, headSha) !== null;
}

/**
 * The two lines a verdict carries about its own authorship, in the ONE spelling
 * that counts (maintainer 2026-09-01, verbatim and untranslated: 「同意 A」).
 *
 * `Implemented-by:` names the IDENTITY that produced the diff — read from the
 * implementation claim, not invented; a `mode:remote` dev's session id, a
 * `mode:subagent` dev's branch (maintainer 2026-09-02, reading a) — and
 * `Reviewed-by:` names the session rendering the verdict. Case-sensitive,
 * exactly like the `Clause-②` key one section up: this file has one convention
 * for machine spellings and a second one would be the drift it exists against.
 */
export const AUTHORSHIP_KEYS = Object.freeze(['Implemented-by', 'Reviewed-by']);

/**
 * A machine key line, in this file's ONE convention: the key is literal and
 * case-sensitive, the decoration a seat writes without meaning anything by it
 * (a leading blockquote, a list bullet, backtick or bold wrapping on the key
 * and its colon) is tolerated, and the rest of the line is the raw value.
 *
 * Factored out rather than copied so a second key added later cannot arrive
 * with a second convention -- the drift this file refuses one family over.
 */
function keyLineRegex(key) {
  return new RegExp(`^[ \\t]*(?:>[ \\t]*)?(?:[-*][ \\t]+)?(?:\\*\\*)?\`?${key}\`?(?:\\*\\*)?[ \\t]*:(.*)$`);
}

const AUTHORSHIP_KEY_LINES = new Map(AUTHORSHIP_KEYS.map((key) => [key, keyLineRegex(key)]));

/**
 * The value token — an IDENTITY, read immediately after the colon.
 *
 * The same calibration `readValueToken` states for `Clause-②`: the token must be
 * the FIRST thing after the colon, and what a seat writes after it is their
 * argument, which this file does not read. Real verdicts wrap the ID in
 * backticks, so the same decoration is tolerated and nothing else is.
 *
 * ⭐ TWO grammars, and which key admits which is the whole of the 2026-09-02
 * ruling's reading a (verbatim and untranslated: 「同意」). A `mode:subagent` dev
 * has no session of its own — under that backend the dev IS a subagent of the
 * dispatching seat, so a seat-session token on `Implemented-by:` would name the
 * REVIEWER by construction and make every subagent-dispatched card read as a
 * self-review, which is the false positive this reading forecloses. Its identity
 * bit is the one the claim protocol already gives it: its BRANCH, carried on the
 * implementation claim's own `Branch:` line, so a reader can cross-check the
 * token rather than take the verdict's word for it. `Implemented-by:` therefore
 * admits a branch as a first-class value beside a session id (a `mode:remote`
 * dev keeps its session), while `Reviewed-by:` admits a SESSION ONLY — a verdict
 * is rendered by a seat, and a seat always has one.
 *
 * ⭐ The two grammars are DISJOINT, which is what keeps the comparison the
 * ruling's own: `claude/…` can never equal `session_…`, so equality on the pair
 * still means exactly what the ruling says it means — the SAME SESSION on both
 * lines — and a branch on the left is silent without a second rule to say so.
 *
 * ⛔ `Reviewed-by:` is NOT widened for the isolated review subagent, and that is
 * the 2026-09-02 ruling held rather than a gap (#17346). Every 2026-09-09
 * specimen writes the value as prose naming the reviewing MODEL and its
 * transcript-verification count, because an isolated reviewer has no session of
 * its own. ⛔ The fixtures below carry the SHAPE and not the model id: the tier
 * constant has exactly one spelling in this tree (`dispatch-gates.mjs`), and a
 * review label or fixture that names a model is the thing the maintainer ruled
 * against — 「needs:fable-review 这个标签不好,下次模型升级怎么办」. Admitting that prose would retire the reading: a value that names no
 * identity compares to nothing, so the equality test that IS the independence
 * clause would answer about every pair the way it answers about none. The
 * remedy is on the WRITING side, and the identity it needs already exists —
 * the seat that RENDERS or ADOPTS the verdict has a session, and an adoption
 * record already carries it (specimen 5597841101 names
 * `session_01Tep4AYXZvyBA7jsvne5KZV` in its own opening sentence, one line
 * above a `Reviewed-by:` line that names no session at all).
 * `references/contract-review.md` :35 states it for the author; here a prose
 * value reads `malformed`, which is a verdict written without its reviewer's
 * session — a true reading of a real carrier defect, ⛔ never a false positive
 * to be tolerated away in the reader.
 */
const SESSION_TOKEN = /^(session_[A-Za-z0-9]+)(?![A-Za-z0-9_])/;

/**
 * A `mode:subagent` dev's identity: the branch the claim protocol names it by.
 * Anchored on the `claude/` prefix every dispatched branch carries and closed on
 * an alphanumeric, so the seat's reasoning may follow the token — a trailing
 * `,` or `.` belongs to the prose, never to the branch.
 */
const BRANCH_TOKEN = /^(claude\/[A-Za-z0-9._/-]*[A-Za-z0-9])/;

/**
 * The markdown decoration a VALUE may open with — stripped, in any order and
 * any repetition, before either token regex is applied.
 *
 * ⭐ Measured, and the fix for a genuine asymmetry (#17346). The key regexes
 * tolerate `**Implemented-by:**` — bold wrapping the key AND its colon — which
 * is what every 2026-09-09 specimen writes. But the colon inside the bold means
 * the captured VALUE opens with the closing `**`, and the old token regexes
 * admitted a leading `**` only when a backtick or the token followed it with no
 * space between: on `- **Implemented-by:** \`claude/issue-x\`` the value read
 * `"** \`claude/issue-x\`"` and BOTH tokens answered `null`. So the key was
 * recognised, the value was not, and the pair read `malformed` on a comment
 * whose author had written a perfectly good identity — a false positive
 * produced by the reader, which is a different fact from the corpus's own
 * prose values and is fixed HERE rather than tolerated downstream.
 *
 * ⛔ It strips DECORATION only — spaces, `**`, backticks — never a word. The
 * near misses the ruling turns on are untouched: `branch \`claude/…\``,
 * `the dev on claude/…` and the corpus's `isolated <model> subagent` all stop
 * the strip at their first letter, so the token is still required to be the
 * FIRST thing after the colon and its decoration.
 */
const VALUE_DECORATION = /^(?:[ \t]+|\*\*|`)+/;

function stripValueDecoration(raw) {
  return String(raw ?? '').replace(VALUE_DECORATION, '');
}

function readSessionToken(raw) {
  const m = SESSION_TOKEN.exec(stripValueDecoration(raw));
  return m ? m[1] : null;
}

/** The `Implemented-by:` value — a session id, or a dev branch. */
function readImplementerToken(raw) {
  const rest = stripValueDecoration(raw);
  const m = SESSION_TOKEN.exec(rest) ?? BRANCH_TOKEN.exec(rest);
  return m ? m[1] : null;
}

/**
 * What each key admits, and what it is called when it admits nothing. Per KEY,
 * because the two identities are not interchangeable: a reviewer is a seat and
 * has a session, an implementer may be a subagent and has only its branch.
 */
const AUTHORSHIP_KEY_VALUES = new Map([
  ['Implemented-by', { read: readImplementerToken, noun: 'identity — neither a session id nor a `claude/…` dev branch' }],
  ['Reviewed-by', { read: readSessionToken, noun: 'session ID' }],
]);

/**
 * The authorship pair declared by ONE comment.
 *
 * @returns {{ kind: 'pair', implementedBy: string, reviewedBy: string, line: string }
 *          | { kind: 'malformed', detail: string }
 *          | { kind: 'legacy' }
 *          | null}
 *
 * Four-valued for the same reason `readClause2Line` is. `null` says the comment
 * is not a verdict at all; `legacy` says it IS a verdict and carries neither
 * line — the shape every verdict on the board had before this ruling, and one
 * that ⛔ must never turn a historic pair red. `malformed` is a carrier that was
 * STARTED and left unreadable, which is a different fact from never starting it:
 * a comparison needs two IDs, and half a pair compares to nothing.
 *
 * `headSha` is what the heading dialect is recognised against, and it is
 * OPTIONAL: omitted, `isVerdictComment` falls back to the fenced marker alone,
 * so a caller that has no head reads exactly what this function read before
 * #17346 rather than something looser.
 */
export function readVerdictAuthorship(text, headSha) {
  if (!isVerdictComment(text, headSha)) return null;
  const lines = String(text ?? '').split(/\r?\n/);

  const seen = new Map();
  for (const line of lines) {
    for (const [key, re] of AUTHORSHIP_KEY_LINES) {
      if (seen.has(key)) continue;
      const m = re.exec(line);
      if (m) seen.set(key, { token: AUTHORSHIP_KEY_VALUES.get(key).read(m[1]), line: quoteLine(line) });
    }
  }
  if (seen.size === 0) return { kind: 'legacy' };

  const missing = AUTHORSHIP_KEYS.filter((key) => !seen.has(key));
  const unreadable = AUTHORSHIP_KEYS.filter((key) => seen.has(key) && seen.get(key).token === null);
  if (missing.length > 0 || unreadable.length > 0) {
    const parts = [];
    for (const key of missing) parts.push(`no \`${key}:\` line`);
    for (const key of unreadable) parts.push(`\`${key}:\` carries no readable ${AUTHORSHIP_KEY_VALUES.get(key).noun} (${JSON.stringify(seen.get(key).line)})`);
    return { kind: 'malformed', detail: parts.join('; ') };
  }
  return {
    kind: 'pair',
    implementedBy: seen.get('Implemented-by').token,
    reviewedBy: seen.get('Reviewed-by').token,
    line: seen.get('Reviewed-by').line,
  };
}

/**
 * The threads C4 judges a pair's authorship on — the card's always, the PR's
 * when it is already in hand.
 *
 * ⭐ ONE carrier, two threads, because that is what the rule text says: the
 * record is 「一条评论落 PR 或卡」, so a reader that consulted only one of them
 * would answer about where the seat happened to post rather than about the
 * pair. Measured 2026-09-10 on the corpus that filed #17346: all four live
 * verdicts sit on the PR thread and NONE of the three delivering cards
 * (#16657, #16861, #16335) carries a `## Contract review` heading at all —
 * 0 of 3 — so a card-only C4 stays silent on the live board however good its
 * discriminator is.
 *
 * ⛔ It buys NO read, and it reads whatever IS in hand. `pair.prComments` is
 * filled by `gather`'s fourth pass — for the COMPLETED pairs in both modes
 * (`needsRecordRead`), and for EVERY pair on the `--pair` path since #18174,
 * where C7 judges the record wherever one exists — so this union is
 * opportunistic by construction: it reads card + PR wherever the PR thread was
 * bought, and the card thread alone everywhere else — the same set C2 already
 * fetched, at the same cost.
 *
 * ⭐ So the reach of C4 follows the reads the run makes, and #18174 widened it
 * on the landing path as a CONSEQUENCE rather than as a second decision: a
 * verdict on a pending or non-gated pair's PR thread, previously invisible, is
 * now judged by `--pair` for the independence pair it declares. That direction
 * only ever adds verdicts to a reading whose newest-governs rule already lets a
 * later independent verdict displace an older self-review, so it relaxes
 * nothing — and it is pinned in both directions rather than left to be
 * discovered.
 *
 * ⚠️ The declared LIMIT that survives, stated rather than bought: in a SWEEP a
 * verdict on a non-completed pair's PR thread is INVISIBLE here, because the
 * sweep buys no thread for it — doing so per open pair would double this
 * file's read budget for a fact the landing check reads a moment later anyway.
 * ⛔ Not a fetch class; the boundary is the honest answer.
 *
 * A card thread that could not be READ is `null` and stays `null` — an unread
 * thread is never an absent verdict (#4690). A PR thread that was owed and came
 * back short is `null` too, and is deliberately NOT doubled into this reading:
 * `reviewOfRecord` already owns that gap and `pairUnjudged` already prints it,
 * so the pair is UNJUDGED and never renders clean.
 */
export function verdictThreadRows(pair) {
  const card = pair?.cardComments;
  if (!Array.isArray(card)) return null;
  const pr = pair?.prComments;
  return Array.isArray(pr) ? [...card, ...pr] : card;
}

/**
 * The authorship state of one pair's verdict threads, judged on its GOVERNING
 * verdict.
 *
 * ⭐ The newest verdict that carries the pair governs, and the choice is
 * load-bearing rather than tidy: a self-review followed by an independent
 * re-review is precisely the REMEDY this row asks for, so a rule that judged
 * every verdict ever posted would leave the remediated pair red on every later
 * sweep — the exact defect #14155 had to repair in C3, where a row that could
 * never be cleared made the landing check's own precondition unsatisfiable. A
 * verdict carrying NEITHER line is not a candidate at all: it is history from
 * before the carrier existed and cannot be judged, so it neither cleans a pair
 * nor dirties one.
 *
 * ⚠️ Newest-governs is also the ONE direction in which recognising more
 * verdicts can turn an existing exit 4 into an exit 0: a newer independent
 * verdict, previously invisible because it was written in the heading dialect
 * or posted on the PR thread, displaces an older card-thread self-review. That
 * is this row's own declared remedy arriving through a widened reading, not a
 * relaxation — the self-review it replaces was cleared by a seat that did not
 * write the diff, which is exactly what the row asks for — and it is pinned in
 * both directions in the self-test rather than left to be discovered.
 *
 * @param {{ id?: number, body?: string, created_at?: string }[]|null} commentRows
 * @param {string|null|undefined} headSha the head the heading dialect is recognised against
 * @returns {{ state: 'unreadable', reason: string }
 *          | { state: 'none' }
 *          | { state: 'independent', implementedBy: string, reviewedBy: string }
 *          | { state: 'self-review', session: string, at: string, id: number|null, detail: string }
 *          | { state: 'malformed', at: string, id: number|null, detail: string }}
 */
export function verdictAuthorship(commentRows, headSha) {
  if (!Array.isArray(commentRows)) return { state: 'unreadable', reason: 'the comment thread could not be read' };

  const candidates = [];
  for (const row of commentRows) {
    const read = readVerdictAuthorship(row?.body, headSha);
    if (read === null || read.kind === 'legacy') continue;
    const ms = Date.parse(row?.created_at ?? '');
    // ⛔ An undated candidate is not a droppable row: dropping it would move the
    // GOVERNING verdict, which is the whole reading. Refuse, exactly as
    // `carrierGateHistory` refuses an undated gate event.
    if (!Number.isFinite(ms)) return { state: 'unreadable', reason: 'a contract-review verdict comment carries no readable date' };
    candidates.push({ read, at: String(row.created_at), id: row?.id ?? null, ms });
  }
  if (candidates.length === 0) return { state: 'none' };

  candidates.sort((a, b) => a.ms - b.ms);
  const governing = candidates[candidates.length - 1];
  if (governing.read.kind === 'malformed') {
    return { state: 'malformed', at: governing.at, id: governing.id, detail: governing.read.detail };
  }
  const { implementedBy, reviewedBy } = governing.read;
  // ⭐ Equality IS the same-session test, and needs no second rule to be one:
  // the two identity grammars are disjoint, so a `mode:subagent` dev's branch on
  // the left can never equal the reviewing seat's session on the right. That is
  // reading a of the 2026-09-02 ruling, mechanized — a subagent-dispatched card
  // reads INDEPENDENT, and only a seat that coded in-session and passed its own
  // diff reads self-review.
  if (implementedBy !== reviewedBy) return { state: 'independent', implementedBy, reviewedBy };
  return { state: 'self-review', session: implementedBy, at: governing.at, id: governing.id, detail: governing.read.line };
}

/**
 * C4 — the governing contract-review verdict reviewed its own author's diff.
 *
 * ⭐ The independence clause, which until now lived in prose alone. The in-seat
 * review path is a COMPENSATING control for dispatching below the review tier,
 * and every argument for it assumes the reviewer did not write the diff:
 * `references/contract-review.md` scopes it to 「低档实现者的契约增量,非自身
 * 产物」 and its isolation sub-rule refuses to feed an isolated reviewer even
 * 「派发席自己的结论(污染即失独立性)」. A verdict whose author wrote the diff
 * is past the far end of that scale, and to every downstream mechanism — the
 * enqueue gate, the landing check's precondition ①, the audit sweep — it is
 * indistinguishable from one that passed an independent review.
 *
 * The reading costs nothing new: the card's comment thread is already fetched
 * for the declaration limb, and the PR's is added only when `gather` already
 * holds it (`verdictThreadRows`), so no pair owes an extra request for this row.
 */
export function c4VerdictSelfReview(pair) {
  const v = verdictAuthorship(verdictThreadRows(pair), pair?.headSha);
  if (v.state === 'unreadable') return null; // UNJUDGED by the caller — never silently clean.
  if (v.state === 'none' || v.state === 'independent') return null;

  const head = `card #${pair?.card} (delivering open PR #${pair?.pr}${pair?.draft ? ' (draft)' : ''})`;
  const where = `${v.at}${v.id ? `, comment ${v.id}` : ''}`;
  const fixed =
    'the fixed spelling names the identity that produced the diff, read from the implementation ' +
    'claim — `Implemented-by: session_…` for a `mode:remote` dev, `Implemented-by: claude/…` (its ' +
    'BRANCH) for a `mode:subagent` dev, which has no session of its own — and `Reviewed-by: ' +
    'session_…` for the session rendering this verdict, which is a seat and always has one; each ' +
    'token immediately after its colon, the seat\'s reasoning free to follow it. ⭐ An ISOLATED ' +
    'review subagent has no session either, and its `Reviewed-by:` value is still a session: the ' +
    'seat that RENDERS or ADOPTS the verdict writes its OWN session there — 「渲染或采纳裁决的席位' +
    '写自己的 session」 — which every adoption record already carries in its opening sentence. ⛔ ' +
    'Prose naming the reviewing MODEL is not an identity: it compares to nothing, and this key ' +
    'admits a session only (2026-09-02 reading a). ⭐ `--template` prints the whole record with both ' +
    'lines already spelled: COPY it rather than composing one -- every measured miss of this pair was ' +
    'a line written from memory against a rule that had no template to copy';
  const legacyIsSilent =
    '⚠️ A verdict carrying NEITHER line is a LEGACY verdict and is silent here — it predates the ' +
    'carrier and ⛔ is never turned red by its absence.';

  if (v.state === 'malformed') {
    return (
      `${head} — its governing contract-review verdict (${where}) carries the authorship pair HALF ` +
      `WRITTEN: ${v.detail}. Both lines or neither — half a pair compares to nothing, so there is ` +
      `no reading of independence here, and a started carrier left unreadable is a different fact ` +
      `from one never started. ${fixed}. ${legacyIsSilent} ${NEVER_WRITES}`
    );
  }
  return (
    `${head} — its governing contract-review verdict (${where}) is a SELF-REVIEW: \`Implemented-by:\` ` +
    `and \`Reviewed-by:\` name the SAME session \`${v.session}\` (${JSON.stringify(v.detail)}). The ` +
    'in-seat review is a COMPENSATING control for dispatching below the review tier, and every ' +
    'argument for it assumes the reviewer did not write the diff: the clause scopes it to 「低档实现' +
    '者的契约增量,非自身产物」 and its isolation sub-rule will not feed a reviewer even 「派发席自己' +
    '的结论(污染即失独立性)」. So this verdict does NOT count as an independent review, and ⛔ no ' +
    'downstream mechanism may read it as one — not the enqueue gate, not the landing check\'s ' +
    'precondition ①, not the audit sweep. Remedy: a seat that did NOT write the diff renders a ' +
    'second verdict carrying its own pair; the NEWEST verdict carrying the lines governs, so an ' +
    'independent re-review CLEARS this row rather than leaving the pair red forever. ⚠️ Boundary: ' +
    'both IDs are SELF-DECLARED by the verdict comment — this file compares them to each other and ' +
    'cross-checks neither against the implementation claim, so the row catches the honest ' +
    `self-review, not a forged pair. ${NEVER_WRITES}`
  );
}

// ---------------------------------------------------------------------------
// C5 -- the direction claim, checked against the diff (#16448 / #16349)
// ---------------------------------------------------------------------------

/**
 * Does this pair owe a changed-file listing?
 *
 * ⭐ ONLY a card that DECLARED `no`. The whole point of the #16349 ruling is
 * that `no` is the reading which BUYS a lower tier, so `no` is the reading that
 * must be checkable; a `yes` already routes to contract review and a tell on
 * top of it decides nothing. Every other declaration state (`missing`,
 * `absent`, `malformed`, `misplaced`, `unreadable`) is C2's row and not this
 * one's: two readers of the same limb is the drift this file was written to
 * avoid one family over.
 *
 * It is exported and used by BOTH the fetch and the UNJUDGED accounting, the
 * way `needsGateHistory` is, so the set that owes a listing and the set that
 * gets one cannot drift apart -- and a pair that owes nothing can never be
 * reported as missing a read the reader was never going to make.
 */
export function needsWideningRead(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
  return d.state === 'declared' && d.value === 'no';
}

/**
 * The widening verdict for one pair -- the sibling gate, given this pair's
 * declaration and diff.
 *
 * The tells, the surfaces and the refusal sentence all live in
 * `check-widening-tells.mjs`; this function is the JOIN and nothing else, so
 * the shape of a tell is stated once in the tree.
 */
export function pairWidening(pair, repo) {
  if (!needsWideningRead(pair)) return { state: 'not-applicable', rows: [], gaps: [], text: null };
  return wideningRefusal({ declaration: 'no', files: pair?.files ?? null, repo });
}

/**
 * C5 -- a widening tell on a diff whose card declares `Clause-②: no`.
 *
 * The #16349 ruling made clause ② DIRECTIONAL on the maintainer's explicit
 * condition that the direction claim become checkable instead of trusted. This
 * row is that condition: `SUSPECT_TIER_GLOBS`'s own docblock already promised
 * that "whichever tier is dispatched, the PR's ACTUAL diff passes the clause-②
 * enqueue gate before the card may enqueue -- the diff is a fact; the card's
 * semantics were a prediction", and until #16448 that gate was a human reading.
 *
 * ⚠️ A TELL, never a proof, in BOTH directions: a false negative is the cost
 * the ruling accepted when it took the directional reading, and a false
 * POSITIVE is repaired in the matcher — ⛔ not paid for by the author. This
 * file priced it at "one word in the claim comment" until #16822 measured the
 * price: the exit-0 condition is "no tell, OR the declaration is not `no`", so
 * the only word that clears a false tell is `Clause-②: no` → `yes` — a
 * widening recorded in a governance ledger that did not happen, and afterwards
 * indistinguishable from one that did. ⛔ Nothing about this row is relaxed by
 * saying so: the exit stays non-zero and stays a hard block. So this row never
 * asserts that the diff widens -- it asserts that the diff has the SHAPE of one
 * that does, while the claim says it does not, and names the file:line so the
 * author can answer with the file open.
 */
export function c5WideningTell(pair, repo) {
  const v = pairWidening(pair, repo);
  if (v.state !== 'refused') return null;
  const head = `card #${pair?.card} (delivering open PR #${pair?.pr}${pair?.draft ? ' (draft)' : ''})`;
  return (
    `${head} declares \`Clause-②: no\` while its diff carries ${v.rows.length} widening tell(s) -- ` +
    `${REFUSAL_SENTENCE}. ${v.rows.map((r) => `${r.file}:${r.line} (${r.tell})`).join(', ')}. ` +
    'Neither reading is overturned here: the declaration stands as written and the diff stands as ' +
    `pushed, and they disagree. ${NEVER_WRITES}`
  );
}

/**
 * C5's own #4690 half -- a diff this file could not READ is not a narrow diff.
 *
 * Reached only for a pair that owes the listing, so a `yes` pair and a pair
 * with no declaration can never be reported as missing a read nobody owed.
 */
export function wideningUnjudged(pair, repo) {
  const v = pairWidening(pair, repo);
  if (v.state !== 'unreadable' && v.state !== 'incomplete') return null;
  return (
    `pair PR #${pair?.pr} / card #${pair?.card} declares \`Clause-②: no\`, and its diff is UNJUDGED ` +
    `for widening tells: ${v.text}` +
    renderReadDiagnosis(pair?.reads) // #16833 — the same diagnosis, same words.
  );
}

// ---------------------------------------------------------------------------
// C6 -- the review of record on this head (#17302)
// ---------------------------------------------------------------------------

/**
 * Does this pair owe the review-of-record read -- its PR's own comment thread?
 *
 * ⭐ TWO populations, and only these. First, the completed state: declared
 * `yes`, the gate bound and cleared on both carriers, head unmoved since
 * (`gateBindingState`, unchanged). That is the state in which
 * `references/contract-review.md` says a record must already exist --
 * 「复核记录 = 一条评论落 PR 或卡」, 「清标缺引记录即半态」 -- and it is
 * exactly the state the filing sweep measured five times over: `Clause-②: yes`,
 * carriers cleared, merged, and the only review-like comment anywhere the dev's
 * own report. A pair still carrying the gate owes nothing yet (the review is
 * pending, not missing); a never-hung, half-bound or moved-after-clear pair is
 * C3's row already, and two rows for one fact is the drift this file avoids.
 *
 * ⭐ Second, since #18536: a `Clause-②: no` pair whose CARD sits in the spec or
 * skills lane (`laneOwesReview`). The lane rule owes the review at tier on
 * EVERY round those two lanes deliver, `yes` or `no` -- 「交付后复核只 spec 与
 * skills 车道欠,每轮达档」 -- and a `no` round hangs no carrier, so there is no
 * label to mark its review "pending": the record either names the head or the
 * pair is not landable (it stays draft and out of the queue, the charter's safe
 * state). The measured pair is the card's own: PRs #18530 / #18529 (cards
 * #18010 / #18301, `domain:spec`, `Clause-②: no`) read 0 here with no record on
 * either head while the rule text owed one. A `no` outside those lanes still
 * owes nothing -- 「余车道零契约复核」 -- and that half is pinned unmoved.
 *
 * Exported and read by BOTH the fetch and the UNJUDGED accounting, the way
 * `needsGateHistory` and `needsWideningRead` are, so the set that owes the
 * thread and the set that gets one cannot drift apart. It reads the binding
 * state, so it can only be true once the event streams and the head commit
 * have been read -- the record pass in `gather` follows the history pass by
 * construction.
 *
 * ⚠️ It is C6's population, not the record READ's, since #18174. The `--pair`
 * path buys the PR thread for every pair, because C7 judges the record wherever
 * one exists; what this predicate still decides is who OWES a record (and so
 * whose absence is a finding), who gets the thread in a SWEEP, and which gap
 * `pairUnjudged` accounts for as against `locatedRecordUnjudged`.
 */
export function needsRecordRead(pair) {
  if (gateBindingState(pair).state === 'completed') return true;
  const d = cardDeclaration(pair?.cardComments ?? null);
  return d.state === 'declared' && d.value === 'no' && laneOwesReview(pair) === true;
}

/** The `Reviewed-by:` key line, exactly as C4 reads it -- one spelling, not two. */
export const REVIEWED_BY_LINE = AUTHORSHIP_KEY_LINES.get('Reviewed-by');

/**
 * The `Served-tier:` key line -- the THIRD provenance fact a verdict declares
 * about itself, read with `Reviewed-by:`'s own discipline (#17915).
 *
 * ⭐ A fact about what PRODUCED the verdict, never the verdict. `Reviewed-by:`
 * says WHO rendered it; this says WHAT SERVED the round that rendered it. The
 * READING behind it is the harness-stamped served-model field of the reviewer's
 * own transcript, ⛔ never the dispatch `model` parameter, which is
 * CONFIGURATION and not a reading -- that distinction is the whole defect: a
 * passed parameter and a served tier can differ, and until this row nothing in
 * the tree compared them, so a round served below tier cleared a carrier
 * indistinguishably from one served at it.
 *
 * ⛔ But the reading stays in the transcript and the LINE carries only the
 * constant's NAME -- 「值写常量名 `CONTRACT_REVIEW_TIER`」 -- because a record is
 * a GitHub comment and `AGENTS.md` lets no model identifier land in one
 * (#18060). See `CONTRACT_REVIEW_TIER_NAME` for why that costs no evidence.
 *
 * ⛔ The key is read ANYWHERE in the comment, on its own line. The rule text
 * asks the author to put it FIRST (「同形含首行 `Served-tier:`」) because a
 * reader should not have to hunt for it; a reader that REFUSED it below some
 * line number would be rejecting correct records over decoration, which is the
 * false-positive direction this file spends its self-test avoiding.
 */
const SERVED_TIER_LINE = keyLineRegex('Served-tier');

/**
 * The value token -- an opaque tier identifier.
 *
 * ⭐ Closed on an alphanumeric or a `]`, so a real id keeps its whole shape
 * (a bracketed context suffix included) while a trailing `.` or `,` stays with
 * the prose. What a seat writes AFTER the token is its argument, which this
 * file does not read -- so a value that opens with prose reads as that prose
 * and compares unequal, loudly, rather than being scanned for a model name
 * somewhere in the sentence. ⚠️ That looseness is precisely the false-positive
 * mode measured on the hand-rolled probes this row replaces: a bare model-name
 * token matched inside a QUOTED prior record, and a correct verdict came one
 * grep away from being voided.
 */
const TIER_TOKEN = /^([A-Za-z0-9](?:[A-Za-z0-9._:[\]-]*[A-Za-z0-9\]])?)/;

/**
 * The STAMP CONTROL that may precede the tier -- `N/M`, measured on the live
 * corpus and named by the ruling itself.
 *
 * ⭐ Corrected from a fixture against the board, which is the correction this
 * family has had to make before (#17346: the corpus moved and the discriminator
 * did not). Every record the remediation rounds write spells the value
 * `75/75 \`<tier>\`` -- the at-tier stamp count over the total, THEN the tier --
 * and the ruling's own specimen is written the same way. A reader that demanded
 * the tier token immediately after the colon would have refused every verdict
 * produced under the rule it enforces, on its first day.
 *
 * ⛔ And the count is not decoration to be skipped: it IS the zero-hit control
 * the discipline requires -- a stamp reading is void unless the same probe
 * returned a non-zero count on the same transcript -- and a count that is not
 * FULL is the 「回退证据」 whose own rule text voids the verdict entire. So it
 * is read, and it is judged: absent, the tier alone decides (the ruling's
 * minimum, and nothing the ruling permits is refused); present, it must be
 * non-zero and total.
 */
const STAMP_CONTROL = /^(\d+)[ \t]*\/[ \t]*(\d+)(?![\d/])/;

/**
 * Does a declared stamp control STAND? Absent is vacuous; present must be
 * total and non-zero. One predicate, so the row and the note cannot disagree.
 */
export function servedStampsHold(stamps) {
  return stamps === null || (stamps.total > 0 && stamps.atTier === stamps.total);
}

/**
 * The ONE token a `Served-tier:` line may carry -- the constant's NAME, ⛔ never
 * its VALUE (#18060).
 *
 * ⭐ `AGENTS.md` is unqualified about the surface: 「no model identifier lands in
 * a PR title or body, a comment, a changeset, a doc or a code comment」 -- and a
 * review of record IS a comment. The first spelling of this row compared the
 * token to the constant's VALUE, so a record could clear a carrier ONLY by
 * carrying a model identifier into the very artifact that rule names; the gate
 * would have cemented the violation rather than a habit. The NAME is governed
 * text, carries the same fact, and lands no identifier.
 *
 * ⭐ Nothing evidential is lost, and that is why this needed no ruling to trade
 * away: the line was never the reading. 「⛔ 自述档位与传参皆非读数」 -- the
 * reading is the seat's transcript grep against the constant's value, which
 * produces no repository artifact at all. What the line carries is the
 * DECLARATION plus its `N/N` stamp control, and both survive the rename.
 *
 * ⛔ Still EXACT: this is the one accepted token, no family and no prefix floor.
 */
export const CONTRACT_REVIEW_TIER_NAME = 'CONTRACT_REVIEW_TIER';

/**
 * The id form of a model name -- the word claude, a hyphen, a model word.
 *
 * A SHAPE and not a list, so a model nobody has named yet binds for the same
 * reason the shipped ones do -- the same rule `check-commit-card-trailers.mjs`
 * binds over a trailer value, spelled here rather than imported because that
 * file is the pre-push entrypoint and this one is imported by the merge-queue
 * guard. The battery pins the two together through the constant's own value.
 */
const MODEL_IDENTIFIER_FORM = /\bclaude-[a-z]+(?:[-.][a-z0-9]+)*\b/i;

/**
 * Is this token a model identifier -- the thing `AGENTS.md` keeps out of a
 * comment?
 *
 * Two limbs: the constant's own VALUE, which is the token this row used to
 * REQUIRE (so a record written correctly under the old rule is named for what
 * it is, never read as an ordinary off-tier miss), and the id SHAPE.
 *
 * ⛔ A caller must NEVER echo a token this returns true for: quoting it back
 * would put the identifier straight into the artifact the rule is about, which
 * is how a refusal becomes a second violation.
 */
export function isModelIdentifierToken(value) {
  const text = String(value ?? '');
  return text === CONTRACT_REVIEW_TIER || MODEL_IDENTIFIER_FORM.test(text);
}

/** The whole reading, as one verdict: at tier, on a control that stands. */
export function servedTierStands(served) {
  return served?.state === 'read' && served.value === CONTRACT_REVIEW_TIER_NAME && servedStampsHold(served.stamps);
}

/**
 * What one comment declares about the tier that served it.
 *
 * @returns {{ state: 'missing', stamps: null }
 *          | { state: 'unreadable', line: string, stamps: object|null }
 *          | { state: 'read', value: string, stamps: object|null }}
 *
 * Every shape carries `stamps`, so a caller never has to test for the key.
 *
 * `stamps` is the `N/M` control when the value carried one, `null` when it did
 * not -- read here, judged by `servedStampsHold`, so the reading and the
 * verdict stay two steps.
 *
 * Three-valued for the reason `readVerdictAuthorship` is four-valued: a carrier
 * that was never started and one that was started and left unreadable are
 * different facts about the seat that wrote it, and they earn different
 * remedies. Both are refusals -- neither is a reading equal to the constant.
 */
export function readServedTier(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = SERVED_TIER_LINE.exec(line);
    if (!m) continue;
    let rest = stripValueDecoration(m[1]);
    let stamps = null;
    const control = STAMP_CONTROL.exec(rest);
    if (control) {
      stamps = { atTier: Number(control[1]), total: Number(control[2]) };
      rest = stripValueDecoration(rest.slice(control[0].length));
    }
    const token = TIER_TOKEN.exec(rest);
    return token
      ? { state: 'read', value: token[1], stamps }
      : { state: 'unreadable', line: quoteLine(line), stamps };
  }
  return { state: 'missing', stamps: null };
}

// ---------------------------------------------------------------------------
// The record TEMPLATE — the one machine-read artefact with nothing to copy (#18042)
// ---------------------------------------------------------------------------

/**
 * The placeholders the printed record ships with.
 *
 * ⭐ Every one of them PARSES through the readers that judge the real thing, so
 * a seat who copies the block and replaces nothing still gets a record whose
 * SHAPE is legible — what an unedited paste changes is whose record it is, never
 * whether it reads. That is exactly the property the four measured misses did
 * not have: `Implemented-by: branch claude/…` was never copied from anything, it
 * was composed from the prose rule one file over, and C4 refused all four as
 * HALF WRITTEN — two of them after they had already reached `main`.
 *
 * ⛔ The head placeholder is git's null oid, deliberately and not decoratively:
 * it is a hex code span, so `contractReviewHeadMatch` recognises the SHAPE and
 * the template is provably round-trippable — and it can prefix NO real head, so
 * a record pasted with the placeholder left in is read as a review of some other
 * head and C6 refuses it. Fail-closed in the one direction that matters.
 *
 * ⛔ No angle brackets in any of them. GitHub's body sanitizer eats tag-shaped
 * fragments, backticked ones included — `CLAUSE2_CORRECTION_KEY_LINE` states the
 * same fact for the correction carrier — so a placeholder spelled that way would
 * be eaten out of the very comment a seat pastes it into, and a template whose
 * placeholders vanish on arrival is worse than no template.
 */
export const RECORD_TEMPLATE_PLACEHOLDERS = Object.freeze({
  headSha: '0'.repeat(40),
  // ⛔ ASSEMBLED, never spelled as one span -- and for the same reason the
  // repo-shape example in `main`'s refusal below is spelled in two: the
  // dispatch derivation reads any quoted path-shaped literal in a module body
  // as the population this gate watches, and a branch placeholder names no
  // tracked file. Spelled whole, it made this family's ONLY declared literal a
  // dead one, which `check:declared-population-live` refuses out loud -- a gate
  // telling the derivation it reads a population while the derivation reads
  // none. Neither half carries a separator, so neither is admitted, and this
  // file goes on declaring no path population at all (it reads no file in the
  // tree). ⛔ Do not re-join these into one literal to tidy it.
  implementedBy: ['claude', 'issue-NNNN-slug'].join('/'),
  reviewedBy: 'session_SEATSESSIONID',
});

/**
 * The record itself — the lines a seat copies, and nothing else.
 *
 * ⭐ Rendered from the same constants the readers compare against
 * (`CONTRACT_REVIEW_TIER_NAME` here, the two token grammars above), so the
 * template cannot teach a spelling this file refuses. The self-test drives THIS
 * function's output back through `readVerdictAuthorship`, `readServedTier` and
 * `contractReviewHeadMatch`, which is what makes "copy it" a safe instruction.
 *
 * ⛔ The head sha is a code span of its OWN. The live corpus wrote the whole
 * `Head-sha: …` pair inside one span, and `H51_SHA_SPAN` matches a span that is
 * hex and nothing else — so that spelling names no head, and a record written it
 * is read as a review of nothing. The key stays outside the span here.
 *
 * @param {{headSha?: string, implementedBy?: string, reviewedBy?: string}} values
 * @returns {string[]}
 */
export function contractReviewRecordLines(values = {}) {
  const { headSha, implementedBy, reviewedBy } = { ...RECORD_TEMPLATE_PLACEHOLDERS, ...values };
  return [
    '## Contract review',
    '',
    `Served-tier: \`${CONTRACT_REVIEW_TIER_NAME}\``,
    `Head-sha: \`${headSha}\``,
    '',
    '### ① Derived judgments',
    '',
    '### ② Semver level',
    '',
    '### ③ Boundary flags',
    '',
    `Implemented-by: \`${implementedBy}\``,
    `Reviewed-by: \`${reviewedBy}\``,
    '',
    '**VERDICT: PASS**',
  ];
}

/** Where the copyable region starts and ends, so "copy it" names a boundary. */
export const RECORD_TEMPLATE_FENCE_START = '----- copy from here; replace the three placeholders -----';
export const RECORD_TEMPLATE_FENCE_END = '----- to here -----';

/**
 * ⭐ WHERE A REVIEW OF RECORD LIVES — the ONE set every reader in this regime
 * searches and every printed instruction names.
 *
 * The governed text decides this and the constant does not; what the constant
 * stops is TWO TOOLS ANSWERING IT DIFFERENTLY. The rule is quoted rather than
 * paraphrased because it IS the operative criterion, and untranslated because
 * rewriting a quoted ruling rewrites the ruling:
 *
 *   > 复核记录 = 一条评论落 PR 或卡，达档与默认档同形
 *
 * — `references/contract-review.md` 〈复核归属与资格〉, with SKILL.md
 * 〈入队与落地〉 saying the same in the same words
 * (「记录 = 同形评论落 PR 或卡」) and the landing check's own ① repeating it
 * (「即 PR 或卡上同形的复核记录」). Two carriers, one record.
 *
 * ⚖️ THE MEASURED COST of spelling that set twice, on one pull request in one
 * day: the skills seat posted its `## Contract review` on carrier card #18426
 * (comment 5716694216) — a location `--template` offers in those exact words —
 * and this file's `--pair` read it as a record on the card thread. The merge
 * queue's own guard read the PR thread ALONE, answered
 * 「0 comment(s) read on the PR thread」 and dequeued PR #18689 `CI_FAILURE`. A
 * SECOND COPY of the same comment, on the PR thread, is what cured it. The two
 * tools already shared every recogniser; what they did not share was the set of
 * threads to run them over.
 *
 * ⛔ So nothing here spells a thread set of its own. `locateReviewOfRecord`
 * builds the rows it searches from this list, `contractReviewTemplateLines`
 * builds the sentence it prints from it, and `check-governed-queue-guard.mjs`
 * fetches one thread per entry in it — which is what the cross-tool pin in this
 * file's self-test measures, by DRIVING that guard rather than by restating the
 * two sets beside each other.
 *
 *   `where`   the tag a located record carries, so a row can name its thread
 *   `rows`    the key a pair carries that thread's comment rows under
 *   `number`  the key a pair carries that thread's issue number under
 *   `words`   how that location is NAMED to a human, in reading order
 */
export const REVIEW_OF_RECORD_THREADS = Object.freeze([
  Object.freeze({ where: 'PR', rows: 'prComments', number: 'pr', words: 'the PR' }),
  Object.freeze({ where: 'card', rows: 'cardComments', number: 'card', words: 'its card' }),
]);

/**
 * The location in the words every instruction prints — DERIVED from the set
 * above, so an instruction can never offer a thread no reader searches.
 */
export const REVIEW_OF_RECORD_LOCATION = REVIEW_OF_RECORD_THREADS.map((thread) => thread.words).join(' or ');

/**
 * The grades `deliveryEvidence` answers with, STRONGEST FIRST — the ranking that
 * function already applies internally, written down here because a caller
 * choosing AMONG several delivered cards needs it as data and
 * `check-half-states.mjs` exports the relation rather than its ordering.
 *
 * ⛔ A MIRROR, so the self-test MEASURES it rather than trusting it: every
 * neighbouring pair is driven through `deliveryEvidence` on a body that could
 * grade either way, and the set is held equal to the kinds `deliveryEvidenceNote`
 * recognises. A grade added or reordered upstream reds here instead of silently
 * re-ranking a governance reading.
 */
export const DELIVERY_EVIDENCE_PRECEDENCE = Object.freeze(['closing-keyword', 'part-of', 'part-of-inline', 'branch-name']);

/**
 * The card a pull request DELIVERS, as a number — the other half of the pair a
 * record read needs, for a caller that holds the pull request and no board.
 *
 * ⭐ DERIVED THROUGH `deliveryEvidence`, never beside it: this function only
 * enumerates the numbers a body or a branch name could be naming, and then asks
 * the ONE relation `derivePairs`, H8 and H31 already ask whether each is
 * delivered. So it can never accept a card that relation rejects, and the
 * precedence between a closing keyword, a `Part of` declaration and the branch
 * name stays where it is written down rather than being graded twice.
 *
 * ⛔ AMBIGUITY IS NOT RESOLVED, it is REPORTED. A body naming two cards at the
 * same strength delivers both, and picking one of them would decide which
 * thread a governance reading searches by an accident of number order. The
 * caller gets `card: null` and a reason it can print; on the queue guard that
 * is the REFUSING direction (no card thread is searched, so no record can be
 * found on one), which is the direction a governance reading is wrong in
 * safely.
 *
 * @param {object} pr — a REST pull row: `body`, and `head.ref` for the fallback
 * @returns {{ card: number, evidence: string } | { card: null, reason: string }}
 */
export function deliveredCardNumber(pr) {
  const body = String(pr?.body ?? '');
  const candidates = new Set([
    ...closingKeywordTargets(body).keys(),
    ...partOfTargets(body).keys(),
    ...[branchNameTarget(pr?.head?.ref)].filter((n) => n !== null && n !== undefined),
  ]);
  const delivered = [];
  for (const n of candidates) {
    const evidence = deliveryEvidence(pr, n);
    if (evidence === null) continue;
    delivered.push({ card: Number(n), evidence, rank: DELIVERY_EVIDENCE_PRECEDENCE.indexOf(evidence) });
  }
  if (delivered.length === 0) {
    return {
      card: null,
      reason:
        'its body names no card (no closing keyword and no `Part of` declaration) and its branch is not '
        + 'the protocol dev-branch shape, so no card thread could be located for it',
    };
  }
  const best = Math.min(...delivered.map((row) => row.rank));
  const strongest = delivered.filter((row) => row.rank === best);
  if (strongest.length > 1) {
    return {
      card: null,
      reason:
        `it delivers ${strongest.length} cards at the same strength (${strongest.map((row) => `#${row.card}`).join(', ')}, `
        + `${deliveryEvidenceNote(strongest[0].evidence)}), so WHICH card thread carries its record is not derivable `
        + 'from the pull request alone',
    };
  }
  return { card: strongest[0].card, evidence: strongest[0].evidence };
}

/**
 * What `--template` prints: the record, fenced, with the calibration around it.
 *
 * ⭐ The notes live OUTSIDE the fence and carry no key-initial line, so nothing
 * here can be mistaken for a second declaration by any reader in this file —
 * and a seat who copies the fenced region alone loses none of the record.
 *
 * ⭐ The ⛔ note is the whole card: the value is the FIRST thing after the colon.
 * Prose said so in `references/contract-review.md` and four consecutive readers
 * wrote a leading word anyway. A template shows it instead of saying it.
 */
export function contractReviewTemplateLines(values = {}) {
  return [
    'check-clause2-carriers --template — the contract-review record of record, copyable. It is',
    `ONE comment on ${REVIEW_OF_RECORD_LOCATION}; the NEWEST one naming this head governs.`,
    '',
    '⛔ The value is the FIRST thing after the colon. A leading word — "branch ", "the dev on " —',
    '   IS the value as far as the reader is concerned, the pair is refused HALF WRITTEN, and a',
    '   half-written pair is worse than none: a record carrying neither line is a legacy verdict',
    '   and stays silent, so writing one line badly is the only way to be refused.',
    '',
    RECORD_TEMPLATE_FENCE_START,
    ...contractReviewRecordLines(values),
    RECORD_TEMPLATE_FENCE_END,
    '',
    `  · Served-tier     the constant's NAME, ${CONTRACT_REVIEW_TIER_NAME}, ⛔ never a model id; an`,
    '                    at-tier/total stamp control may precede it — 75/75, then the constant.',
    '  · Head-sha        the head you reviewed, 7 to 40 hex in a span of ITS OWN; a span holding',
    '                    the key as well is not a sha, and the record then names no head.',
    '  · Implemented-by  the identity that produced the diff, read off the implementation claim:',
    "                    a mode:subagent dev's BRANCH, a mode:remote dev's session id.",
    '  · Reviewed-by     the session that RENDERS or ADOPTS the verdict — a session only. Prose',
    '                    naming the reviewing model is not an identity and compares to nothing.',
    '  · VERDICT         PASS or FAIL, in caps; FAIL strips the two carriers exactly as PASS does.',
    '  ⛔ Replace every placeholder. Left in, the null-oid head names no commit and the record is',
    '     read as a review of some other head — refused, never silently adopted.',
    '  ⛔ And keep angle brackets out of what you paste: the body sanitizer eats tag-shaped',
    '     fragments, backticked ones included, so a field spelled that way is stored short and',
    '     read as absent.',
  ];
}

/**
 * LOCATE the review of record for one pair -- read from the PR's thread AND the
 * card's, because the rule lets it live on either -- WITHOUT asking what state
 * the gate is in.
 *
 * ⭐ The gate-independent half, split out by #18174. `reviewOfRecord` below is
 * this function under C6's population gate, and the two readings had been one
 * function: a pair that owed no record answered `not-owed` BEFORE any thread
 * was read, so every row downstream of it inherited C6's scope whether or not
 * the fact it judges has that scope. C7's does not -- 「无此行不成裁决」 is a
 * property of a RECORD, on whatever pair carries one -- and the consequence was
 * measured on one board in one day: record 5661052272 (PR #18157 / card #17991,
 * non-gated) carried `Served-tier: 2433/2444, then `CONTRACT_REVIEW_TIER``, a
 * spelling this file's own reader answers `unreadable` for, and `--pair`
 * answered 0; the SAME spelling on objectui PR #9486 / card #9191 (record
 * 5662548425) was refused exit 4 -- because that pair's gate had been hung and
 * cleared. One rule, two answers, decided by a fact the rule does not mention.
 *
 * ⛔ The split moves no recognition. Every fact below -- the heading, the head
 * sha, the `Reviewed-by:` line, the newest-governs choice -- is the same one
 * C6 read before, in the same order; what moved is WHERE the population gate
 * sits, and it now sits on C6's own row rather than under both of them.
 *
 * ## The recognition shape, and why it is H51's and not a new one
 *
 * `check-half-states.mjs` H51 already reads "a contract-review verdict on THIS
 * head" out of a thread, and measured its shape over four live dialects: a
 * level-2 heading whose line begins `## Contract review`, plus the head sha
 * written as a code span somewhere in the comment. Both facts are IMPORTED
 * from it (`CONTRACT_REVIEW_HEADING_MARKER`, `contractReviewHeadMatch`) rather
 * than restated, and the newest such comment is chosen by the same
 * `latestMarkedComment` H47 resolves with. The filter is
 * `latestContractReviewOnHead`'s, spelled out here because that finder returns
 * an id and not the row, and the row is what the third fact is read from.
 *
 * ⭐ The third fact is the CARRIER the rule text names -- 「独立性对」: a
 * `Reviewed-by:` line, read by C4's own key regex so the two rows cannot
 * disagree about what one looks like. Its VALUE is not judged here: who
 * reviewed, and whether that is the implementer, is C4's row. This row asks
 * only that the record names a reviewer at all, which is what separates a
 * review of record from a dev's own report -- and from the shape the filing
 * sweep found on the seat's side: an ACCEPT paragraph carrying the head and the
 * line under a bold first line, with no heading anywhere.
 *
 * ⛔ Not read: the verdict WORD (the file's boundary, and the corpus already
 * spells it two ways) and the ①②③ items (prose the seat reads).
 *
 * @returns {{ state: 'unreadable', gaps: string[] }
 *          | { state: 'absent', read: { pr: number, card: number } }
 *          | { state: 'unsigned', where: 'PR'|'card', id: number|null, sha: string, at: string|null }
 *          | { state: 'found', where: 'PR'|'card', id: number|null, sha: string, at: string|null }}
 */
export function locateReviewOfRecord(pair) {
  const gaps = [];
  // \u2b50 THE THREAD SET IS READ FROM `REVIEW_OF_RECORD_THREADS`, never spelled
  // here: this loop, the template's printed sentence and the queue guard's
  // fetches are the three consumers of that one list, and the whole point of it
  // is that no two of them can name different threads (#18701).
  for (const thread of REVIEW_OF_RECORD_THREADS) {
    if (!Array.isArray(pair?.[thread.rows])) gaps.push(`${thread.where} #${pair?.[thread.number]}'s comment thread`);
  }
  const head = String(pair?.headSha ?? '');
  // A head too short to be matched by H51's span test can never find its
  // record, so it is a read that could not be made -- never an absent record.
  if (head.length < H51_SHA_MIN_HEX) gaps.push(`PR #${pair?.pr}'s head sha`);
  if (gaps.length > 0) return { state: 'unreadable', gaps };

  const tagged = REVIEW_OF_RECORD_THREADS.flatMap((thread) =>
    pair[thread.rows].map((row) => ({ row, where: thread.where })),
  );
  const onHead = tagged.filter(
    ({ row }) =>
      CONTRACT_REVIEW_HEADING_MARKER.test(String(row?.body ?? '')) &&
      contractReviewHeadMatch(row?.body, head) !== null,
  );
  const newest = latestMarkedComment(onHead.map(({ row }) => row), CONTRACT_REVIEW_HEADING_MARKER);
  if (!newest) {
    return {
      state: 'absent',
      read: Object.fromEntries(REVIEW_OF_RECORD_THREADS.map((thread) => [thread.number, pair[thread.rows].length])),
    };
  }
  const { row, where } = onHead[newest.index];
  const found = {
    where,
    id: row?.id ?? null,
    sha: contractReviewHeadMatch(row?.body, head),
    at: row?.created_at ?? null,
    // The provenance fact C7 judges, read off the SAME comment this row chose,
    // so the two can never disagree about which verdict governs this head.
    served: readServedTier(row?.body),
  };
  const signed = String(row?.body ?? '').split(/\r?\n/).some((line) => REVIEWED_BY_LINE.test(line));
  return signed ? { state: 'found', ...found } : { state: 'unsigned', ...found };
}

/**
 * The review of record C6 judges -- the locator above, under C6's population.
 *
 * ⭐ ONE extra state, `not-owed`, and it is the whole difference: C6's row is a
 * fact about a record OWED (`needsRecordRead`: the completed state, and since
 * #18536 the `no` rounds of the spec and skills lanes), so a pair that owes
 * none is never refused for lacking one. #18174 left the scope where it was --
 * what that card moved is C7, which reads the locator directly because the fact
 * IT judges belongs to the record rather than to the clear; #18536 widened the
 * scope by lane, and the rows read the same one comment.
 *
 * ⛔ Both rows still read ONE comment, chosen once, by one recognition: this
 * function adds a gate in front of `locateReviewOfRecord` and changes nothing
 * about which comment comes back, so C6 and C7 can no more disagree about the
 * governing record than they could when they shared a function body.
 *
 * @returns {{ state: 'not-owed' }
 *          | ReturnType<typeof locateReviewOfRecord>}
 */
export function reviewOfRecord(pair) {
  if (!needsRecordRead(pair)) return { state: 'not-owed' };
  return locateReviewOfRecord(pair);
}

/**
 * The key-and-sha-in-ONE-span spelling -- the shape `H51_SHA_SPAN` cannot read.
 *
 * The key is the one `contractReviewRecordLines` prints, and the self-test
 * derives its fixture by collapsing THAT line rather than retyping the key, so
 * a template that renamed it reds here instead of drifting silently.
 */
export const HEAD_KEY_IN_SPAN = /`\s*Head-sha\s*:\s*([0-9a-fA-F]{7,40})\s*`/;

/**
 * The refused spelling, NAMED where the absence is reported (#18141).
 *
 * ⛔ A DIAGNOSIS, never a second accepted spelling. `H51_SHA_SPAN` matches a
 * span that is hex and nothing else, so a record writing its head as
 * `Head-sha: …` inside ONE span names no head, and a complete review written
 * that way reads exactly like a pair that was never reviewed at all. That was
 * the trap: `references/contract-review.md` :28 said 「head sha 码段」 and never
 * that the span holds the sha ALONE, so a seat reading it in good faith wrote
 * the refused spelling. The prose now says 「独占码段」 and this function is its
 * machine half -- read only AFTER the locator has answered `absent`, choosing
 * no comment and admitting none, so the accept set stays exactly one spelling.
 * What it buys is the seat's next edit: 「no record at all」 and 「a record whose
 * span carries the key」 stop printing the same sentence.
 *
 * ⛔ A comment the locator can already read is never this finding, whichever
 * span carried the head -- measured on the live corpus specimen (PR #17986's
 * comment 5652813288), whose `Head-sha:` span names nothing but which is still
 * FOUND today, because its prose happens to quote the head in a bare span of
 * its own. The defect is the spelling, not that comment.
 *
 * @returns {{ where: 'PR'|'card', id: number|null, sha: string, at: string|null } | null}
 */
export function headSpanHoldsKey(pair) {
  const head = String(pair?.headSha ?? '').toLowerCase();
  if (head.length < H51_SHA_MIN_HEX) return null;
  const tagged = [
    ...(Array.isArray(pair?.prComments) ? pair.prComments.map((row) => ({ row, where: 'PR' })) : []),
    ...(Array.isArray(pair?.cardComments) ? pair.cardComments.map((row) => ({ row, where: 'card' })) : []),
  ];
  const keyed = tagged.filter(({ row }) => {
    const body = String(row?.body ?? '');
    if (!CONTRACT_REVIEW_HEADING_MARKER.test(body)) return false;
    if (contractReviewHeadMatch(body, head) !== null) return false;
    const m = HEAD_KEY_IN_SPAN.exec(body);
    return m !== null && head.startsWith(m[1].toLowerCase());
  });
  // The same newest-of idiom the locator resolves with, never a second one.
  const newest = latestMarkedComment(keyed.map(({ row }) => row), CONTRACT_REVIEW_HEADING_MARKER);
  if (!newest) return null;
  const { row, where } = keyed[newest.index];
  return {
    where,
    id: row?.id ?? null,
    sha: HEAD_KEY_IN_SPAN.exec(String(row?.body ?? ''))[1],
    at: row?.created_at ?? null,
  };
}

/**
 * C6 -- a record owed on this head, and none behind it.
 *
 * The rule this row carries is the one #17302 landed and #18536 re-keyed by
 * lane: the review of record is ONE comment on the PR or its card, in the tier
 * verdict's own shape, and it is owed in the spec and skills lanes on every
 * round they deliver -- a cleared `yes` cites it in the provenance comment
 * beside the clear; a `no` round there owes it before the pair is landable.
 * Before that text, clearing the carrier was indistinguishable from never
 * reviewing -- measured five times in one window by the director's leak sweep
 * -- and this file's own `--pair` read every one of those pairs as the
 * completed state and answered 0; the lane half was measured on PRs #18530 /
 * #18529, spec-lane `no` rounds that read 0 with no record on either head.
 *
 * ⭐ Three remedies, one row, chosen by where the pair SITS: a cleared `yes`
 * inside the spec or skills lane writes the review it already performed down;
 * a `no` round inside those lanes gets the review at tier (in-seat or by the
 * at-tier subagent) before landing; a cleared `yes` OUTSIDE them is a limb hit
 * on another lane's card, and the remedy is lane ROUTING -- the work is the
 * spec lane's, whichever seat found it -- ⛔ never a default-tier self-review
 * and ⛔ never an at-tier subagent spawned from that lane. The exit is the
 * same 4 in all three: the pair is not landable as it stands.
 *
 * ⛔ A FINDING, and the file's exit table decides that rather than a preference:
 * the row is an adverse fact about THIS pair at its own landing moment, and an
 * adverse fact rendered as 0-with-a-message is the silence this file exists
 * against. It re-blocks no legal workflow -- under the text the record precedes
 * the clear, and precedes the landing of a spec/skills `no` round -- and a pair
 * cleared before the text landed owes exactly one comment: the review its seat
 * already performed, written down.
 */
export function c6NoReviewOfRecord(pair) {
  const v = reviewOfRecord(pair);
  if (v.state === 'not-owed' || v.state === 'unreadable' || v.state === 'found') return null;

  const short = String(pair?.headSha ?? '').slice(0, 10);
  const cleared = gateBindingState(pair).state === 'completed';
  const inLane = laneOwesReview(pair) === true;
  const lanes = (Array.isArray(pair?.cardLabels) ? pair.cardLabels : []).filter((name) => LANES_OWING_REVIEW.includes(name));
  const draft = pair?.draft ? ' (draft)' : '';
  const head = cleared
    ? `card #${pair?.card} declares \`Clause-②: yes\`, its gate was bound and cleared on BOTH carriers, and its ` +
      `open PR #${pair?.pr}${draft} still sits at the head that was cleared (\`${short}\`)`
    : `card #${pair?.card} declares \`Clause-②: no\` and carries ${lanes.map((l) => `\`${l}\``).join(', ')}, a lane that ` +
      `owes the contract review on EVERY round it delivers, and its open PR #${pair?.pr}${draft} is at head \`${short}\``;
  const shape =
    'The record is the comment `references/contract-review.md` names -- 「复核记录 = 一条评论落 PR 或卡,席内与子代理' +
    '同形」 -- read here in H51\'s measured shape: a level-2 heading beginning `## Contract review`, this head\'s sha ' +
    'as a code span of ITS OWN (「所审 head sha 独占码段」: a span carrying the key as well is not a sha and names no ' +
    'head), and a `Reviewed-by:` line naming the reviewer. Existing tier verdicts already carry all three; a ' +
    'dev\'s own report, or an ACCEPT paragraph with the head and the line but no heading, is not one -- and ' +
    '「清标缺引记录即半态」.';
  const boundary =
    '⛔ Verdict-agnostic: no PASS or FAIL token is read to reach this -- the PASS half of the landing check stays ' +
    'human -- and the ①②③ line items are prose the seat reads, not this file.';

  if (v.state === 'unsigned') {
    return (
      `${head} -- a \`## Contract review\` comment naming this head exists (${v.where} thread, ` +
      `${v.id ? `comment ${v.id}` : 'no readable id'}, ${v.at ?? 'undated'}, names \`${v.sha}\`) but carries ` +
      'NO `Reviewed-by:` line, so it names no reviewer and is not a review of record. ' +
      `${shape} Remedy: the reviewing seat posts the record with its independence pair (\`Implemented-by:\` / ` +
      '`Reviewed-by:`) -- the NEWEST heading comment on this head governs, so a corrected record clears the row -- ' +
      `and cites it in the provenance comment beside the clear. ${boundary} ${NEVER_WRITES}`
    );
  }
  const read =
    `${head} -- and NO review of record exists on this head: ${v.read.pr} comment(s) on the PR thread and ` +
    `${v.read.card} on the card were read, and none is a \`## Contract review\` comment naming \`${short}\` with a ` +
    '`Reviewed-by:` line.';

  // The two ways a pair reaches this row print two sentences, because they ask
  // two different things of the seat: writing a review down, or respelling one
  // that was already written. ⛔ The spelling is still refused either way.
  const keyed = headSpanHoldsKey(pair);
  if (keyed) {
    return (
      `${read} ⚠️ The SPELLING is why, and this pair is NOT the empty case: the ${keyed.where} thread's ` +
      `${keyed.id ? `comment ${keyed.id}` : 'comment carrying no readable id'} (${keyed.at ?? 'undated'}) carries ` +
      `the heading and writes this head INSIDE one code span, as \`Head-sha: ${keyed.sha}\`. A span is read as a ` +
      'sha only when it is hex and nothing else, so a span carrying the key as well names no head, and a complete ' +
      `review written that way reads here exactly like no review at all. ${shape} Remedy: the reviewing seat ` +
      'reposts the record with the key OUTSIDE the span and the sha in a span of its OWN -- `--template` prints ' +
      'the whole record -- and cites it in the provenance comment beside the clear. ' +
      `${boundary} ${NEVER_WRITES}`
    );
  }
  if (!cleared) {
    // #18536: a `no` round of the spec or skills lane. No carrier ever rode
    // it, so nothing marks its review pending: the record either names the
    // head or the pair is not landable.
    return (
      `${read} Under the lane rule every round the spec and skills lanes deliver gets the contract review at the ` +
      'contract-review tier, `Clause-②: yes` or `no`, and until its record exists the PR is not landable: it stays ' +
      `draft and out of the queue (the charter's safe state). ${shape} Remedy: the lane seat reviews at tier -- in-seat ` +
      'when its served tier is the constant, otherwise by the at-tier review subagent it spawns -- and posts the record ' +
      'on the PR or the card (`--template` prints it). When that subagent cannot start, the wait IS the state, and the ' +
      `maintainer's own review is the only bypass, by their word each time. ${boundary} ${NEVER_WRITES}`
    );
  }
  if (!inLane) {
    // #18536: a cleared `yes` on a card OUTSIDE the two lanes. The `yes` is a
    // limb hit, and limb-hit work is the spec lane's whichever seat found it
    // -- the remedy is routing, not a review from the lane that cleared it.
    const labels = Array.isArray(pair?.cardLabels) ? pair.cardLabels.filter((name) => name.startsWith('domain:')) : [];
    return (
      `${read} This is the shape the filing sweep measured five times in one window -- a cleared gate with nothing ` +
      `behind it, indistinguishable from never reviewing -- and this pair's card sits OUTSIDE the spec and skills lanes ` +
      `(${labels.length ? labels.map((l) => `\`${l}\``).join(', ') : 'no `domain:*` label'}), ` +
      'so a `Clause-②: yes` there is a limb hit: limb-hit work is the spec lane\'s, whichever seat found it, and the ' +
      `clear this pair made stands on nothing this lane can produce. ${shape} Remedy -- lane ROUTING, ⛔ not a self-review: ` +
      're-lane the item to the spec lane (the card\'s `domain:*` becomes `domain:spec` through `pm:retriage`, or the ' +
      'contract work is split to a spec-lane card or PR -- 「新 `packages/spec` 工作恒由 `domain:spec` 席收口」) and let ' +
      'that lane\'s review at the contract-review tier produce the record; or, if the `yes` was a false declaration, ' +
      'correct it with a `Clause-②-correction:` comment on the card. ⛔ This lane neither writes a default-tier record nor ' +
      `spawns the at-tier subagent. ${boundary} ${NEVER_WRITES}`
    );
  }
  return (
    `${read} This is the shape the filing sweep measured five times in one window -- a cleared gate ` +
    `with nothing behind it, indistinguishable from never reviewing. ${shape} Remedy: the owning seat writes down ` +
    'the review it already performed, in that shape, on the PR or the card, and cites it in the provenance comment ' +
    `beside the clear. ${boundary} ${NEVER_WRITES}`
  );
}

/**
 * The C6-RECORD note -- the record WAS found, and here is what it says.
 *
 * A note rather than silence, for the landing seat's next act: the rule makes
 * the provenance comment name the record's id and the head it judged, and the
 * run has both in hand. ⚠️ Existence, not the verdict.
 *
 * ⭐ It reads the LOCATOR since #18174, for the reason C7 does: what a record
 * declares is a fact about the record. So a pair that owes no clear -- the
 * ordinary `Clause-②: no` pair -- and that nevertheless carries a record on its
 * head now PRINTS what that record says, instead of answering 0 with the record
 * unmentioned. ⛔ A reader of exit 0 must be able to tell "the record was read
 * and its `Served-tier:` stands" from "no record was ever looked at", and until
 * this note was widened those two printed identically.
 *
 * ⛔ The CITATION half stays C6's, because the act it names is C6's: only a
 * pair in the completed state has a provenance comment beside a clear to cite
 * the record in. On every other pair the note says what the record IS and what
 * it declares, and prescribes nothing -- a note never invents an act its pair
 * does not owe.
 */
export function c6RecordNote(pair) {
  const v = locateReviewOfRecord(pair);
  if (v.state !== 'found') return null;
  const cleared = gateBindingState(pair).state === 'completed';
  const owed = needsRecordRead(pair);
  const inLane = laneOwesReview(pair) === true;
  return (
    `review of record on this head: ${v.where} thread, ${v.id ? `comment ${v.id}` : 'a comment carrying no readable id'} ` +
    `(${v.at ?? 'undated'}) is a \`## Contract review\` comment naming \`${v.sha}\` and carrying a \`Reviewed-by:\` line -- ` +
    (cleared
      ? 'cite it in the provenance comment beside the clear (「凡清标同笔留 provenance 评论,引记录 id 与所判 head」). '
      : owed
        ? 'the lane rule owes this record on every round this lane delivers, `Clause-②: no` included, and it exists -- nothing else is prescribed here. '
        : '⛔ This pair owes no clear, so nothing is prescribed here: the record is reported because it EXISTS on this head, and what it declares is judged wherever it exists. ') +
    (cleared && !inLane
      ? '⚠️ This pair\'s card sits OUTSIDE the spec and skills lanes: under the lane rule a `Clause-②: yes` there is spec-lane work that moves there, so the seat landing this pair answers for which lane produced this record -- it is reported, not endorsed. '
      : '') +
    (servedTierStands(v.served)
      ? 'Its `Served-tier:` names the tier constant' +
        (v.served.stamps ? ` on a stamp control of ${v.served.stamps.atTier}/${v.served.stamps.total}` : '') +
        (cleared
          ? ', so the strip stands on C7 as well as on this row. '
          : ', so it reads at tier on C7 as well as on this row. ')
      : 'Its `Served-tier:` does NOT stand — C7 says what it reads, and this pair is adverse. ') +
    '⚠️ Existence, not the verdict: whether it reads PASS is precondition ① of the landing check and stays human.'
  );
}

// ---------------------------------------------------------------------------
// C7 -- the tier that SERVED the verdict the strip stands on (#17915)
// ---------------------------------------------------------------------------

/**
 * C7 -- a carrier cleared on a verdict whose served tier is not the declared one.
 *
 * ## The defect, and why a comparison had to exist somewhere
 *
 * `CONTRACT_REVIEW_TIER`'s own docblock declares the comparison against the
 * SERVED tier EXACT -- 「never a family or prefix floor」 -- and until this row
 * NOTHING in the tree performed it. The dispatching seat passes a model as a
 * parameter, and a parameter is CONFIGURATION, not a reading: the served tier
 * can differ from it, silently. The docblock also said the re-review round's
 * opening self-check reads the constant, and it does -- but a self-check is a
 * prose instruction to the reviewer, so a round that simply does not run it
 * produces a verdict INDISTINGUISHABLE from one that did. Measured over one
 * fleet's transcripts on the harness-stamped served-model field: 11 rounds
 * served below a declared tier across four days and eleven PRs, five of them
 * the only clearance a merged `Clause-②: yes` pair ever had. ⇒ declared ≠
 * enforced, on the gate that decides whether a public-contract widening was
 * reviewed at all.
 *
 * ⭐ So the verdict carries the READING, and the strip is gated on it. The
 * reviewer's transcript is not a thing a checker can open; the value it stamps
 * is. Writing it into the verdict turns a per-seat habit into a carrier, and
 * this row is the only consumer that habit now needs.
 *
 * ## The population -- EVERY pair that has a record, and why it stopped being C6's (#18174)
 *
 * The first spelling of this row read `reviewOfRecord`, whose `not-owed` gate
 * is C6's -- the completed state, declared `yes`, the gate bound and CLEARED on
 * both carriers. So the reading was performed beside a gate clear and nowhere
 * else, and the rule it carries says nothing about a gate: 「无此行不成裁决」 is
 * a property of a RECORD. Measured on one board in one day, one spelling, two
 * answers: record 5661052272 (objectstack PR #18157 / card #17991, `Clause-②`
 * never declared `yes`, gate never hung) carried `Served-tier: 2433/2444, then
 * `CONTRACT_REVIEW_TIER`` -- `unreadable` to this file's own reader -- and
 * `--pair` answered **0**, so it stood as the review of record for a landing on
 * `origin/main`; record 5662548425 (objectui PR #9486 / card #9191), the SAME
 * spelling, was refused **4** with this row's text -- because THAT pair's gate
 * had been hung and cleared. ⇒ declared ≠ enforced, one path of two.
 *
 * ⭐ So the population is now every pair whose record `locateReviewOfRecord`
 * FINDS on the head: the gate's state decides whether a record is OWED (C6's
 * question), never whether the one in hand READS. Two shapes stay untouched,
 * and they are the ones that have no record rather than the ones that never
 * hung a gate:
 *
 *   1. **A pair with NO record on this head** is ⛔ never refused for lacking
 *      the line -- on a `Clause-②: no` pair that owes none this is the ordinary
 *      case and it stays silent (C6's 「not-owed」 is untouched), and on a pair
 *      that OWES one the absence is C6's row.
 *   2. **An absent or unsigned record** is C6's row where C6 is owed, and no
 *      row owns a fact twice. C7 speaks only about a record the locator FOUND
 *      -- signed, on this head -- so the two rows read one comment, chosen
 *      once, by one recognition, and can never both fire.
 *
 * ⚠️ A pair STILL CARRYING the gate is now reachable, and that is the ruling's
 * own moment rather than an overreach: the rule text puts this reading 「清标前」
 * -- BEFORE the clear -- so a record already posted on this head is judged while
 * the gate is still on, which is the only ordering in which exit 4 can stop
 * anything. A pair whose review is genuinely pending has no record yet and
 * stays in shape 1.
 *
 * ⛔ What did NOT move: the accept set (one token, the constant's NAME), the
 * exactness, the refusal of a missing line, and the remedy -- re-post the
 * record in the identifier-free live shape; the NEWEST heading comment on the
 * head governs. This row is widened in POPULATION only, in the direction its
 * own rule text already named.
 *
 * ## The refusal, and what it is NOT
 *
 * ⛔ Still no verdict WORD. This row reads a provenance fact of the same family
 * as `Reviewed-by:` -- what produced the verdict, never what it concluded -- so
 * the file's 自查放行 boundary is narrowed by one more FACT and not crossed.
 * Exit 4 (a limb not standing), ⛔ never 3: the environment answered fine, the
 * limb did not stand.
 *
 * ⛔ And the comparison is EXACT, by the constant's own instruction: no family
 * match, no prefix floor, no "close enough" -- widening a governance gate's
 * accept set is the maintainer's decision, not a checker's convenience. A
 * missing line and an unreadable one are refused beside a below-tier one,
 * because 「无此行不成裁决」: a verdict that declares nothing about what served
 * it is the pre-ruling shape, which is the shape with no reading in it at all.
 *
 * ⚠️ A historic record written before the rule landed reads MISSING and earns
 * this row. That is the same transition C6 priced and it re-blocks no legal
 * workflow: the sweep stays report-only, only a pair being LANDED is judged,
 * and the pair owes exactly one act -- the reviewing seat posts the record
 * again carrying the reading its own transcript already stamped.
 *
 * ## The token is the constant's NAME, and an identifier is named as one (#18060)
 *
 * The first spelling of this row compared the token to the constant's VALUE, so
 * a record could clear a carrier ONLY by carrying a model identifier into a
 * GitHub comment -- which `AGENTS.md` forbids in terms, naming「a comment」
 * without qualification. A gate is much harder to walk back than a habit, so
 * the accepted token is now `CONTRACT_REVIEW_TIER_NAME` and a token of
 * identifier SHAPE -- the old spelling included -- is refused with a remedy
 * that names that rule and ⛔ never quotes the token back. Quoting it would put
 * the identifier in one more artifact, which is how a refusal becomes a second
 * violation.
 *
 * ⛔ The row is not WIDENED by any of this: the line is still required, a
 * missing one is still a refusal, and the accepted token is still exactly one.
 */
export function c7ServedTierBelow(pair) {
  // ⭐ The LOCATOR, not `reviewOfRecord` (#18174): what a record declares about
  // the tier that served it is a fact about the record, so it is judged on
  // every pair that has one and not only on the pair that owed one.
  const v = locateReviewOfRecord(pair);
  if (v.state !== 'found') return null;
  if (servedTierStands(v.served)) return null;

  // ⭐ WHICH act the record is standing under is read from the gate, not
  // assumed (#18174): on the completed state it is the clearance the ruling
  // gates, and on every other pair it is the record itself, judged 「清标前」 or
  // on a pair that owes no clear at all. The refusal is the same refusal; a
  // sentence naming a clear that never happened would be the row's own text
  // telling the reader something untrue about their pair.
  const standsOn = needsRecordRead(pair)
    ? 'the verdict the clear stands on'
    : 'the review of record on this head (no clear rides on it -- the line is judged because the RECORD carries it)';
  const where =
    `PR #${pair?.pr}${pair?.draft ? ' (draft)' : ''} / card #${pair?.card}: ${standsOn} -- ` +
    `${v.where} thread, ${v.id ? `comment ${v.id}` : 'a comment carrying no readable id'} ` +
    `(${v.at ?? 'undated'}), naming head \`${v.sha}\``;
  const stamps = v.served.stamps ?? null;
  const control =
    stamps === null
      ? ''
      : ` Its stamp control reads ${stamps.atTier}/${stamps.total}` +
        (servedStampsHold(stamps)
          ? ', which stands.'
          : stamps.total === 0
            ? ' -- a ZERO reading, which is void by the standing control: a zero counts only when the same probe ' +
              'returns a non-zero stamp count on the same transcript.'
            : ' -- NOT total, which is the 「回退证据」 the rule text voids a verdict entire for: some messages of ' +
              'the round were served by something else.');
  const reading =
    v.served.state === 'read'
      ? isModelIdentifierToken(v.served.value)
        ? 'spells its `Served-tier:` token as a MODEL IDENTIFIER rather than the constant\'s NAME -- ⛔ the token ' +
          'is NOT quoted back here, because printing it would land the identifier in one more artifact'
        : servedStampsHold(stamps)
          ? `declares \`Served-tier:\` as \`${v.served.value}\``
          : `declares the tier \`${v.served.value}\` on a stamp control that does not stand`
      : v.served.state === 'unreadable'
        ? `carries a \`Served-tier:\` line with no readable tier token (${v.served.line})`
        : 'carries NO `Served-tier:` line at all, so it declares nothing about what served it';
  const rule =
    'The rule this row carries is `references/contract-review.md`\'s -- 「同形含首行 `Served-tier:`:值写常量名 ' +
    '`CONTRACT_REVIEW_TIER`;无此行不成裁决,模板见 `--template`」 and 「清标前 `--pair`:`Served-tier:` ≠ 常量名 ⇒ exit 4,' +
    '点名 PR、评论、读数;型号串按 `AGENTS.md` 拒」. The token is the constant\'s NAME, ⛔ never its VALUE: ' +
    '`AGENTS.md` -- 「no model identifier lands in a PR title or body, a comment, a changeset, a doc or a code ' +
    'comment」 -- and a review of record IS a comment, so a token of that shape is refused beside an off-tier one. ' +
    '⛔ Nothing evidential rides on that spelling, because the line was never the reading (「⛔ 自述档位与传参皆非读数」): ' +
    'the reading is the seat\'s own grep of the HARNESS-STAMPED served-model field of the reviewing round\'s ' +
    'transcript, ⛔ never the dispatch `model` parameter, which is configuration and not a reading -- a grep that ' +
    'leaves no repository artifact, which is why it may compare against the constant\'s value where this line may ' +
    'not carry it. The comparison is EXACT, never a family or prefix floor -- widening a governance gate\'s accept ' +
    'set is the maintainer\'s decision.';
  const remedy =
    'Remedy: re-review this head at the declared tier and post the record carrying the reading, or -- if the round ' +
    'WAS at tier -- post the record again; either way its `Served-tier:` line spells the constant\'s NAME, ' +
    'optionally prefixed by the `N/N` stamp control the seat read off its own transcript. ⛔ A record whose token ' +
    'is a model identifier is refused even when the round WAS at tier, on `AGENTS.md`\'s comment rule -- the repair ' +
    'is to re-post it in the identifier-free spelling, never to widen this row. The NEWEST heading comment on this ' +
    'head governs, so a corrected record clears this row without touching the carrier.';
  const boundary =
    '⛔ Verdict-agnostic: no PASS or FAIL token is read to reach this -- what produced the verdict is measurable, ' +
    'what it concluded stays human -- and the constant is read from `dispatch-gates.mjs`, never restated here.';
  return `${where} -- ${reading}, and the accepted token is the NAME \`CONTRACT_REVIEW_TIER\`.${control} ${rule} ${remedy} ${boundary} ${NEVER_WRITES}`;
}

/**
 * C7's own #4690 half -- a thread this file could not READ is not a pair
 * without a record (#18174).
 *
 * ⭐ The gap C6's accounting cannot own. `pairUnjudged` reports the
 * review-of-record read for the pairs that OWE one, and a pair that owes none
 * is `not-owed` there whatever its threads say -- correct for C6, and silence
 * for C7 the moment C7 stopped sharing C6's population. So the landing check
 * asks this question separately: the record read was BOUGHT for this pair, and
 * if the threads or the head could not be read, the pair is UNJUDGED rather
 * than clean.
 *
 * ⛔ Called from the `--pair` path ONLY, exactly as `wideningUnjudged` is, and
 * for the same reason: the sweep does not buy the thread for a pair that owes
 * no record (the budget paragraph in this file's header is the authority), so
 * a sweep asking this would report every non-gated pair as UNJUDGED for a read
 * it was never going to make. A pair that owes the read is skipped here and
 * accounted for by `pairUnjudged`, so no gap is reported twice.
 */
export function locatedRecordUnjudged(pair) {
  if (needsRecordRead(pair)) return null;
  const v = locateReviewOfRecord(pair);
  if (v.state !== 'unreadable') return null;
  return (
    `pair PR #${pair?.pr} / card #${pair?.card} owes no review of record, and whether it HAS one ` +
    `could not be read: ${v.gaps.join(', ')}. A record on this head is judged for what its ` +
    '`Served-tier:` line declares wherever it exists (「无此行不成裁决」), so an unread thread here is a ' +
    'missing reading, never a pair without a record.' +
    renderReadDiagnosis(pair?.reads) // #16833 — the same diagnosis, same words.
  );
}

/**
 * C8 — a SECOND `Claim:` by the SAME seat, named (#18828).
 *
 * ⭐ A VERDICT, and the file's own table decides that exactly as it decided C4's:
 * the row is a fact about THIS pair — a line the claim protocol says must not be
 * written, standing on the thread the declaration limb is judged over — and an
 * adverse fact rendered as 0-with-a-message is the silence this file exists
 * against. It is also, precisely, what the old reading WAS: `rejected: 1 … a
 * SUPERSEDED claim`, exit 0, in the register reserved for a transition the
 * protocol designed.
 *
 * ⛔ It re-blocks no legal workflow. A card claimed once reads as it always did;
 * a re-claim after a `Release:` reads as it always did; a `Clause-②-correction:`
 * is not a claim and never was. What it refuses is the one shape the protocol
 * already forbade in writing, and the sentence carries the two acts that clear
 * it — both performable by the seat that wrote the line, with the one tool every
 * seat certainly has.
 *
 * ⛔ Never prescribes WHICH repair: the declaration is the seat's judgement and
 * a checker that chose between a correction and a release would be choosing
 * whether the card is being re-taken. It names both and writes nothing.
 */
export function c8SecondClaimSameSeat(pair) {
  const groups = claimRepeats(pair?.cardComments ?? null);
  if (groups.length === 0) return null;
  return (
    `card #${pair?.card} (delivering open PR #${pair?.pr}) — ${claimRepeatSentences(groups).join(' · ')}. `
    + `${CLAIM_REPEAT_RULE} ${CLAIM_REPEAT_REMEDY} ${NEVER_WRITES}`
  );
}

/**
 * C9 — cross-author LIVE claims with no `Release:` between, JUDGED (#18862).
 *
 * ⭐ A VERDICT, for C8's reason: the row is a fact about THIS pair — two seats
 * holding live claims on the thread the declaration limb is judged over, with
 * no sanctioned hand-over between them — and an adverse fact rendered as
 * 0-with-a-message is the silence this file exists against. It is also,
 * precisely, what the old reading WAS: `rejected: 1 … a SUPERSEDED claim`,
 * exit 0, on twelve cards.
 *
 * ⛔ It judges NOTHING dated at or before `CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT`:
 * that half is `c9HandoverNote`, a note, and the ruling's 「earlier pairs are
 * listed as informational, never red」 is the line between the two.
 *
 * ⛔ Never prescribes WHICH seat acts: the holder's `Release:` and the taker's
 * own yielding `Release:` are both named, and the file writes nothing.
 */
export function c9CrossAuthorLiveClaims(pair) {
  const state = claimHandovers(pair?.cardComments ?? null);
  if (state === null || !state.judged) return null;
  return (
    `card #${pair?.card} (delivering open PR #${pair?.pr}) — ${claimHandoverSentence(state)}. `
    + `${CLAIM_HANDOVER_RULE} ${CLAIM_HANDOVER_REMEDY} ${NEVER_WRITES}`
  );
}

/**
 * The informational half of C9 — a hand-over whose every taking claim is dated
 * at or before the effective instant (#18862). A NOTE: it prints in full, on
 * the sweep and on `--pair`, and moves no exit.
 *
 * ⭐ It PRINTS rather than going quiet, for the reason the fourth reading does:
 * the twelve measured rows are history the readers themselves created, and a
 * record that dropped them would replace one invisible fact with another. The
 * reconciliation is the `domain:skills` seat's, by hand, on the cards.
 */
export function c9HandoverNote(pair) {
  const state = claimHandovers(pair?.cardComments ?? null);
  if (state === null || state.judged) return null;
  return (
    `card #${pair?.card} (delivering open PR #${pair?.pr}) — ${claimHandoverSentence(state)}. `
    + `LISTED, ⛔ not judged: every hand-over here is dated at or before the effective instant ${state.effectiveAt} `
    + '(or carries no readable date), and the ruling reads 「earlier pairs are listed as informational, never red」. '
    + 'The reconciliation is the domain:skills seat\'s, by hand: the holder posts `Release:`, or the taker yields '
    + 'with its own (去向 「让先到者」). This note moves no exit.'
  );
}

/**
 * Every FINDING row for one pair, in reporting order.
 *
 * `pairs` — the derived set this pair came from — is optional and defaults to
 * none, which is the fail-closed direction: a caller that does not supply the
 * delivery set gets exactly the rows this function returned before #16304,
 * including the C2 row on a card whose sibling would have carried the
 * declaration. ⛔ The fourth reading is never a FINDING and is never returned
 * from here: it belongs to `pairNotes`, so a round report's "N clause-②
 * finding(s)" can never count a pair that owes nothing.
 */
export function pairRows(pair, pairs = null) {
  const rows = [];
  const split = c1CarrierSplit(pair);
  if (split) rows.push({ code: 'C1', text: split });
  // The SAME predicate `pairNotes` reads, so a pair can never be both counted
  // as a C2 finding and reported as the fourth reading — or as neither.
  const decl = readsSiblingDeclaration(pair, pairs) ? null : c2DeclarationUnreadable(pair);
  if (decl) rows.push({ code: 'C2', text: decl });
  const ungated = c3DeclaredYesUngated(pair);
  if (ungated) rows.push({ code: 'C3', text: ungated });
  const selfReview = c4VerdictSelfReview(pair);
  if (selfReview) rows.push({ code: 'C4', text: selfReview });
  const record = c6NoReviewOfRecord(pair);
  if (record) rows.push({ code: 'C6', text: record });
  // ⭐ After C6 and never instead of it: C6 asks whether a record was OWED and
  // exists on this head, C7 asks what served the round that wrote the record in
  // hand. One comment, chosen once by `locateReviewOfRecord` -- C6 reads it
  // under its own population gate and C7 reads it directly (#18174) -- so the
  // two rows can never disagree about which verdict is being read, and an
  // absent or unsigned record earns exactly one row, C6's, where C6 is owed.
  const servedTier = c7ServedTierBelow(pair);
  if (servedTier) rows.push({ code: 'C7', text: servedTier });
  // ⭐ Last, and ORTHOGONAL to every row above it: C1–C7 read the gate's
  // carriers, its declaration and the round that served the verdict, and this
  // one reads the THREAD those readings are taken over — a line the claim
  // protocol says must not be written, which the selector above ranks as a
  // designed supersession at exit 0. A pair can earn it beside any other row,
  // and it is a row rather than a note for the reason `c8SecondClaimSameSeat`
  // states (#18828).
  const repeatClaim = c8SecondClaimSameSeat(pair);
  if (repeatClaim) rows.push({ code: 'C8', text: repeatClaim });
  // ⭐ Beside C8 and disjoint from it: C8 reads one author's repeats, this row
  // reads the author CHANGES between live claims — a hand-over the protocol
  // never wrote — and judges only those dated after its effective instant; an
  // earlier one is `pairNotes`' `C9-BEFORE-EFFECTIVE`, never a row (#18862).
  const handover = c9CrossAuthorLiveClaims(pair);
  if (handover) rows.push({ code: 'C9', text: handover });
  return rows;
}

/**
 * Every NOTE for one pair — a reading that is not a finding.
 *
 * Kept apart from `pairRows` because the two feed different consumers: a
 * finding raises the `--pair` exit and is counted in the sweep's finding
 * total, a note does neither. Both read `readsSiblingDeclaration`, so the row
 * a pair gets and the count it lands in are decided once.
 */
/**
 * The correction reading, as a printed NOTE (#17366).
 *
 * ⭐ It PRINTS rather than going quiet, for the reason the fourth reading does:
 * a pair that answers 0 because a CORRECTION comment carries its declaration is
 * answering about a carrier the claim comment does not hold, and a seat reading
 * only `$?` must be able to find out from the run which comment was read. The
 * shape's whole value is that nothing had to be EDITED, so the row states that
 * as a reading it takes from the claim's two stamps, ⛔ never as one it assumes.
 */
export function c2CorrectionNote(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
  if (d.state !== 'declared' || d.correctionNote === undefined) return null;
  return `card #${pair?.card} (delivering open PR #${pair?.pr}) — ${d.correctionNote}`;
}

export function pairNotes(pair, pairs = null) {
  const notes = [];
  const sibling = c2SiblingDeclared(pair, pairs);
  if (sibling) notes.push({ code: 'C2-SIBLING', text: sibling });
  const correction = c2CorrectionNote(pair);
  if (correction) notes.push({ code: 'C2-CORRECTION', text: correction });
  const record = c6RecordNote(pair);
  if (record) notes.push({ code: 'C6-RECORD', text: record });
  // The informational half of C9: a cross-author hand-over dated at or before
  // the effective instant is LISTED here and moves no exit (#18862).
  const handover = c9HandoverNote(pair);
  if (handover) notes.push({ code: 'C9-BEFORE-EFFECTIVE', text: handover });
  return notes;
}

/**
 * The declaration limb's two not-read states, counted separately for one sweep.
 *
 * The summary line is where a round report takes its number from, so a single
 * "no reading" count is one number said about two different owings: a card
 * whose claim comment carries no declaration line owes that line, while a card
 * with no claim comment owes the claim comment first, and a reader of the
 * total can tell neither how many of each nor which remedy to send. Two
 * numbers, two labels.
 *
 * The tally reads the SAME `cardDeclaration` the rows read, so a count can
 * never disagree with the rows printed under it. `declared`, `misplaced`,
 * `malformed`, `claim-branch-unparsed` and `unreadable` are counted into
 * neither — each is its own reading with its own row, and an unreadable thread
 * or an unresolvable claim carrier is UNJUDGED rather than either not-read
 * state. ⛔ Counting an unparsed claim under `absent` would be the old silence
 * wearing a number: it would say "this card has no claim comment" about a card
 * that has one.
 *
 * ⭐ Since #16304 the `absent` population is split once more, for the same
 * reason it was split from `missing` in the first place: a card with no claim
 * comment whose SIBLING carries the declaration owes NOTHING, and counting it
 * beside the cards that owe a claim comment is again one number said about two
 * different owings. It is counted under `sibling`, from the same predicate the
 * rows read — the tally takes the whole pair set, so the sibling relation is
 * computable here without a second reader.
 *
 * @param {{ pr?: number, card?: number, cardComments?: object[]|null }[]|null} pairs
 * @returns {{ absent: number, missing: number, sibling: number }}
 */
export function declarationLimbTally(pairs) {
  const tally = { absent: 0, missing: 0, sibling: 0 };
  for (const pair of pairs ?? []) {
    const { state } = cardDeclaration(pair?.cardComments ?? null);
    if (state === 'absent') {
      if (readsSiblingDeclaration(pair, pairs)) tally.sibling += 1;
      else tally.absent += 1;
    } else if (state === 'missing') tally.missing += 1;
  }
  return tally;
}

/**
 * The UNJUDGED sentence for a card whose newest claim comment parses to ZERO
 * branches (#17149) — the declaration limb's carrier, unresolved.
 *
 * ⚠️ It reports a CARRIER problem and says nothing about the declaration: the
 * card may well carry a correctly-spelled line, and this run cannot tell
 * whether it is the current one. Reporting it as `missing` would send the seat
 * looking for a line that is there; reporting it as a `no` would manufacture a
 * decision nobody made. The sentence names the comment, says what governance
 * did instead, and gives the one remedy — a `Branch:` line of its own.
 *
 * ⛔ Nothing here widens the branch reader. The remedy is on the WRITE side,
 * which is the same call the sibling script's H34 makes for the claim marker
 * and for the same standing ruling (⛔ 不放宽谓词).
 */
export function claimBranchUnparsedGap(pair, decl) {
  const m = decl?.malformedClaim ?? {};
  const governing = decl?.governingClaim ?? null;
  const which = m.id === null || m.id === undefined ? 'a comment carrying no readable id' : `comment ${m.id}`;
  const instead = governing
    ? `governance FELL BACK to an OLDER claim (${governing.createdAt ?? 'undated'}, naming ` +
      `${(governing.branches ?? []).map((b) => `\`${b}\``).join(', ') || 'no branch'}), so the ` +
      'declaration this run would otherwise have read is that older comment\'s — a SUPERSEDED ' +
      'reading, and when it happens to agree with the current one the result is a green that is ' +
      'right for the wrong reason'
    : 'NOTHING governs this card, so the limb would otherwise have read `absent` — "no claim ' +
      'comment was written", which is false: one was';
  return (
    `pair PR #${pair?.pr} / card #${pair?.card} — UNJUDGED: the card's NEWEST claim comment ` +
    `(${which}, ${m.createdAt ?? 'undated'}) matches the claim marker but its \`Branch:\` directive ` +
    `parses to ZERO branches, so the carrier this limb reads cannot be resolved. ${instead}. ` +
    'An unparsed claim is an UNCLASSIFIED result, ⛔ never an absent declaration and ⛔ never a ' +
    'declared `no` — this pair is missing from the readings above, not clean in them and not ' +
    'adverse in them. Remedy — the CLAIMING SEAT, with one comment: name the branch on a ' +
    '`Branch:` line of its OWN (`` Branch: `claude/issue-<n>-<slug>` ``), ⛔ not inside the ' +
    '`Claim:` sentence, which no reader parses. ⚠️ A whole shift of claims reading this way is a ' +
    'SEAT TEMPLATE fault, not a typo. ' +
    NEVER_WRITES
  );
}

/**
 * What this pair could NOT be judged on — the #4690 half.
 *
 * Returned separately from the rows so a caller can never render an incomplete
 * pair as a clean one: the sweep counts these and exits 2 while still printing
 * whatever it did manage to read.
 */
export function pairUnjudged(pair) {
  const gaps = [];
  if (!Array.isArray(pair?.cardLabels)) gaps.push(`card #${pair?.card}'s labels`);
  if (!Array.isArray(pair?.prLabels)) gaps.push(`PR #${pair?.pr}'s labels`);
  if (!Array.isArray(pair?.cardComments)) gaps.push(`card #${pair?.card}'s comment thread`);
  // The thread WAS read and the carrier still cannot be resolved (#17149).
  // Placed after the read checks so an unread thread is never reported as a
  // malformed claim, and before every limb below it because each of those
  // reads a comment chosen by the governance this state says is broken.
  if (gaps.length === 0) {
    const decl = cardDeclaration(pair?.cardComments ?? null);
    if (decl.state === 'claim-branch-unparsed') return claimBranchUnparsedGap(pair, decl);
  }
  // The gate history is owed by C3 CANDIDATES only — the cost bound and the
  // accounting read one predicate, so a pair can never owe a stream the live
  // reader was never going to fetch. An unread stream is not a never-hung gate.
  if (gaps.length === 0) {
    const binding = gateBindingState(pair);
    if (binding.state === 'unreadable') gaps.push(...binding.gaps);
  }
  // C4's own #4690 half: a verdict this file could not ORDER is not a verdict
  // it read as independent. Reached only once the thread itself read, so the
  // unreadable-thread gap above is never doubled. It reads `verdictThreadRows`
  // — the same set C4 judges — so the set that is accounted for and the set
  // that is judged cannot drift apart.
  if (gaps.length === 0) {
    const authorship = verdictAuthorship(verdictThreadRows(pair), pair?.headSha);
    if (authorship.state === 'unreadable') gaps.push(`pair PR #${pair?.pr} / card #${pair?.card}'s verdict authorship (${authorship.reason})`);
  }
  // C6's own #4690 half: the record is OWED by the COMPLETED state only, and an
  // unread PR thread there is not an absent record. Reached only once the
  // binding state itself read, so a stream gap above is never doubled. ⛔ The
  // other half -- a pair that owes no record but whose thread the `--pair` path
  // bought anyway -- is `locatedRecordUnjudged`, asked from that path alone, so
  // a sweep never reports a gap in a read it was never going to make.
  if (gaps.length === 0) {
    const record = reviewOfRecord(pair);
    if (record.state === 'unreadable') gaps.push(...record.gaps.map((g) => `${g} (the review-of-record read)`));
  }
  if (gaps.length === 0) return null;
  return (
    `pair PR #${pair?.pr} / card #${pair?.card} — UNJUDGED: ${gaps.join(', ')} could not be read. ` +
    'An unread carrier is not a bare carrier and an unread thread is not an absent declaration; ' +
    'this pair is missing from the readings above, not clean in them.' +
    // ⭐ #16833: WHICH channel was tried and WHAT it answered, per carrier —
    // appended, so the sentence above is byte-identical for a pair whose reads
    // simply were not diagnosed, and the verdict it carries is untouched.
    renderReadDiagnosis(pair?.reads)
  );
}

// ---------------------------------------------------------------------------
// Pairing — derived, never recalled
// ---------------------------------------------------------------------------

/**
 * The card each open PR delivers, via `prDeliversCard` — the SAME relation H8
 * and H31 read, imported rather than restated so this file can never disagree
 * with them about which PR delivers which card.
 *
 * Measured on the 2026-08-31 board: every one of the seven pairs the filing
 * cards tabulated carries a closing or `Part of` keyword in its PR body naming
 * its card, and every branch name carries the fallback too — 7 of 7, both
 * channels. Pairing is a derivation here, not an assumption.
 *
 * Each pair carries the EVIDENCE its derivation rests on (#16706), because the
 * derivation is exactly where a false pair enters this file: a body whose prose
 * said 「part of #N already landed」 about another card derived a pair that
 * never existed, and C1 then reported its dangerous half against it in the same
 * words a real split gets. The kind rides on the pair so the row can say what
 * it was built from; ⛔ it is never a filter here — a pair is derived exactly
 * when `prDeliversCard` says so, as before.
 *
 * @param {object[]} openPrs
 * @param {number[]} cardNumbers — the open cards the sweep holds.
 */
export function derivePairs(openPrs, cardNumbers) {
  const pairs = [];
  for (const pr of openPrs ?? []) {
    if (!pr || pr.merged_at) continue;
    for (const n of cardNumbers ?? []) {
      if (prDeliversCard(pr, String(n))) {
        pairs.push({
          pr: pr.number,
          card: Number(n),
          draft: Boolean(pr.draft),
          evidence: deliveryEvidence(pr, String(n)),
          prRow: pr,
        });
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

/** The three read paths, named once so every message renders from this set. */
export const READ_PATH_TOKEN = 'token';
export const READ_PATH_PUBLIC = 'public';
export const READ_PATH_PAIR_JSON = 'pair-json';

/**
 * The order the paths are tried in, for one named set of inputs.
 *
 * A named document is EXCLUSIVE rather than last: a run that mixed a
 * pre-fetched pair with live reads would answer about neither reproducibly,
 * and "half the document, half the board" is exactly the kind of composite
 * reading this file refuses everywhere else.
 */
export function readPathPlan({ token = '', pairJson = false } = {}) {
  if (pairJson) return [READ_PATH_PAIR_JSON];
  return token ? [READ_PATH_TOKEN, READ_PATH_PUBLIC] : [READ_PATH_PUBLIC];
}

/**
 * What this run actually did, so a refusal can name it rather than describe the
 * paths in the abstract. Written by the reader, read only by the reporters.
 */
const readPathState = {
  tokenPresent: Boolean(TOKEN),
  /** `{ status }` once a credential is refused — retired, not fatal. */
  tokenRetired: null,
  /** path id -> requests it served. */
  served: new Map(),
  /** where the pre-fetched document came from, once one is named. */
  pairJsonSource: null,
  /** the last `x-ratelimit-*` headers seen, whatever the status. */
  rate: null,
  /** the path id that last served a read, for the cap/short-read diagnosis. */
  lastServed: null,
  /**
   * EVERY read this run issued, in order — the run's own statement of what it
   * judged from (#18456). Written by the readers, read only by the record.
   * ⛔ Never consulted by a predicate: a request ledger is provenance.
   */
  requests: [],
};

/**
 * File one request — the channel, the exact path, what came back, and how many
 * rows it carried.
 *
 * ⭐ The row COUNT is the field that earns its place: a page requested with
 * `per_page=100` that answers with exactly 100 rows is indistinguishable, in
 * every other line this file prints, from a thread that simply ends there.
 */
function noteRequest(channel, path, answer, rows = null) {
  readPathState.requests.push({
    n: readPathState.requests.length + 1,
    channel,
    path,
    answer,
    rows: typeof rows === 'number' ? rows : null,
  });
}

function noteServed(pathId) {
  readPathState.served.set(pathId, (readPathState.served.get(pathId) ?? 0) + 1);
  // The channel that last ANSWERED, so a read that fails without a refusal —
  // a page cap, a short listing — can name the channel it was served on
  // instead of reporting no channel at all (#16833).
  readPathState.lastServed = pathId;
}

/**
 * Record the budget headers off ANY response, including a failing one — a 403
 * for an exhausted quota is precisely the response whose remaining count a
 * reader needs, and it is the one a `res.ok` guard would throw away.
 */
function noteRateLimit(res) {
  const headers = res?.headers;
  if (!headers || typeof headers.get !== 'function') return;
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  if (limit === null && remaining === null) return;
  readPathState.rate = {
    limit,
    remaining,
    used: headers.get('x-ratelimit-used'),
    resource: headers.get('x-ratelimit-resource'),
  };
}

/**
 * The budget line — the count this run SAW, never the one its regime is
 * supposed to have (the header-less path is served anonymously in one place and
 * by a proxy-attached identity in another, and those budgets differ by 250x).
 */
export function renderRateNote(rate) {
  if (!rate || (rate.limit === null && rate.remaining === null)) {
    return 'rate limit: no `x-ratelimit-*` header was seen, so the remaining budget is UNKNOWN — ⛔ not "plenty".';
  }
  return `rate limit seen (${rate.resource ?? 'core'}): ${rate.remaining ?? '?'} of ${rate.limit ?? '?'} remaining.`;
}

/**
 * The paths tried, in one line, for every refusal this file prints.
 *
 * Pure in its argument so the self-test drives it without a network, and so a
 * message can never claim a path that did not run.
 */
export function renderReadPathReport(state) {
  const served = state?.served instanceof Map ? state.served : new Map();
  const count = (id) => served.get(id) ?? 0;
  const token = !state?.tokenPresent
    ? 'absent from this environment (GITHUB_TOKEN / GH_TOKEN)'
    : state.tokenRetired
      ? `present but REFUSED (HTTP ${state.tokenRetired.status}) — retired for the rest of this run`
      : `present, served ${count(READ_PATH_TOKEN)} read(s)`;
  const pairJson = state?.pairJsonSource
    ? `read from ${state.pairJsonSource}, served ${count(READ_PATH_PAIR_JSON)} read(s)`
    : 'not named — hand a pre-fetched pair to `--pair-json FILE` (or `--pair-json -`) to judge with no network at all';
  return (
    `read paths — (i) token: ${token}; (ii) token-less public read: served ${count(READ_PATH_PUBLIC)} ` +
    `read(s); (iii) --pair-json: ${pairJson}. ${renderRateNote(state?.rate ?? null)}`
  );
}

/**
 * The channel each read path is called by in a refusal, spelled ONCE.
 *
 * Same numerals and same words as `renderReadPathReport` above, because a seat
 * comparing the per-read diagnosis with the run's path report is comparing two
 * sentences about the same three channels — and two spellings of one channel is
 * how a reader ends up believing there are four.
 */
export const READ_PATH_LABELS = Object.freeze({
  [READ_PATH_TOKEN]: '(i) token',
  [READ_PATH_PUBLIC]: '(ii) token-less public read',
  [READ_PATH_PAIR_JSON]: '(iii) --pair-json',
});

/**
 * The CHANNEL diagnosis — which path was tried for ONE resource, and what the
 * platform answered on it (#16833).
 *
 * ⭐ The gap this closes, measured on this very card: a seat whose container
 * answers `403` on `/issues/N/events` gets exit 2 and the sentence "card #N's
 * label event stream could not be read" — correct, and indistinguishable from a
 * rate limit, a 404, a network fault, or a document that simply omits the key.
 * Two of the three containers that re-took that reading answered 200, so
 * "the stream is unreachable" was a GLOBAL assumption doing duty for a PER-SEAT
 * fact. This makes it a fact: the refusal names the channel, the answer and the
 * carrier.
 *
 * ⛔ It changes no predicate and adds no evidence source. An unread stream is
 * exactly as unread as it was, the pair is exactly as UNJUDGED, and every exit
 * code is unchanged — what moves is only what the message can tell a reader.
 * The diagnosis is therefore a pure render of what the READER recorded: it
 * never infers a channel, and a read with nothing recorded says so rather than
 * borrowing the last channel that happened to answer.
 */
export function renderReadDiagnosis(reads) {
  const entries = (Array.isArray(reads) ? reads : []).filter((r) => r && typeof r.subject === 'string');
  if (entries.length === 0) return '';
  const parts = entries.map((entry) => {
    const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    // A retry and a page ladder both answer the same thing twice, and one read
    // reported as two refusals reads like two problems. Consecutive IDENTICAL
    // answers collapse and carry their count; ⛔ two DIFFERENT answers never
    // do — "403 then 502" is the reading, and a count would erase half of it.
    const runs = [];
    for (const a of attempts) {
      const last = runs[runs.length - 1];
      if (last && last.channel === a?.channel && last.answer === a?.answer) {
        last.count += 1;
        continue;
      }
      runs.push({ channel: a?.channel, answer: a?.answer, count: 1 });
    }
    const tried = runs.length === 0
      ? 'NO channel recorded an answer — ⛔ an unrecorded channel, never a channel that answered'
      : runs
        .map((a) => {
          const label = READ_PATH_LABELS[a.channel] ?? `(?) ${String(a.channel)}`;
          const again = a.count > 1 ? ` (${a.count}× — the same answer on every attempt)` : '';
          return `${label} answered ${a.answer ?? 'nothing this run recorded'}${again}`;
        })
        .join(', then ');
    return `${entry.subject} — ${tried}`;
  });
  return (
    ' Channel diagnosis, one entry per read this run could not complete: ' + parts.join('; ') +
    '. ⛔ A channel that refused is a measured fact about THIS seat\'s access to THAT resource and ' +
    'about nothing else — ⛔ never a fact about the pair, and ⛔ never a clearance. It is what lets ' +
    'a seat tell its own container\'s answer from the board\'s without taking a second reading by ' +
    'accident.'
  );
}

/**
 * The attempts belonging to the read currently in flight, or `null` when no
 * read is being diagnosed. Written by `restOnce`, drained by `diagnosedRead`.
 */
let inFlightAttempts = null;

function noteAttempt(channel, answer) {
  if (inFlightAttempts) inFlightAttempts.push({ channel, answer });
}

/** Channel diagnoses this run filed, keyed by the RESOURCE that went unread. */
const readDiagnoses = new Map();

/** The ledger key for one resource — the reader files it, `gather` reads it. */
export function readDiagnosisKey(kind, id) {
  return `${kind}:${id}`;
}

/** File one diagnosis. The LAST filing wins — a retried read is one read. */
function fileReadDiagnosis(key, attempts) {
  readDiagnoses.set(key, (attempts ?? []).map((a) => ({ channel: a.channel, answer: a.answer })));
}

/**
 * Run one LOGICAL read (all of its pages, both rungs of the ladder, every
 * retry) with its channel attempts recorded, and file them under `key` when it
 * comes back unread.
 *
 * ⛔ A read that SUCCEEDS files nothing: the diagnosis reports refusals, so a
 * resource WITH an entry is one this run did not get, and a resource without
 * one is not evidence of anything at all.
 */
async function diagnosedRead(key, read) {
  const outer = inFlightAttempts;
  inFlightAttempts = [];
  try {
    const value = await read();
    if (value === null || value === undefined) fileReadDiagnosis(key, inFlightAttempts);
    return value;
  } finally {
    inFlightAttempts = outer;
  }
}

/**
 * Hang the diagnosis for `key` on the pair, under the SAME words the gap that
 * reports it uses, so a reader matches the two by sight rather than by guess.
 *
 * ⛔ Called on the null branch ALONE: a pair carries an entry only for a read
 * that actually came back unread.
 */
function attachReadDiagnosis(pair, key, subject) {
  const attempts = readDiagnoses.get(key);
  if (!attempts) return;
  if (!Array.isArray(pair.reads)) pair.reads = [];
  if (pair.reads.some((r) => r.subject === subject)) return;
  pair.reads.push({ subject, attempts });
}

/** One request on ONE path. `token` empty means: send no `authorization`. */
async function restOnce(path, token) {
  const channel = token ? READ_PATH_TOKEN : READ_PATH_PUBLIC;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    // ⛔ A transport fault IS an answer for this purpose: "no status at all" is
    // exactly the reading a seat behind a refusing proxy needs, and it is the
    // one a status-only diagnosis would render as silence.
    noteAttempt(channel, `no HTTP response (${err?.message ?? 'transport error'})`);
    noteRequest(channel, path, `no HTTP response (${err?.message ?? 'transport error'})`);
    throw err;
  }
  noteRateLimit(res);
  if (!res.ok) {
    noteAttempt(channel, `HTTP ${res.status}`);
    noteRequest(channel, path, `HTTP ${res.status}`);
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  noteRequest(channel, path, `HTTP ${res.status}`, Array.isArray(json) ? json.length : null);
  return json;
}

/**
 * One read, down the path ladder: the token first, then the same request with
 * no `authorization` header.
 *
 * ⛔ The fallback is reached on 401/403 ONLY — a refused CREDENTIAL. Every other
 * status (404, 5xx, a network throw) is a fact about the RESOURCE or the route
 * and is raised unchanged, because retrying those without a header would turn
 * one honest failure into two and still fail.
 */
async function rest(path) {
  if (TOKEN && !readPathState.tokenRetired) {
    try {
      const json = await restOnce(path, TOKEN);
      noteServed(READ_PATH_TOKEN);
      return json;
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
      readPathState.tokenRetired = { status: err.status };
      console.error(
        `ℹ️  the token in GITHUB_TOKEN/GH_TOKEN was refused (HTTP ${err.status}); falling back to the ` +
          'token-less public read for the rest of this run. ⛔ A credential this board refuses is not a ' +
          'reason to answer "unread" about a public pair.',
      );
    }
  }
  const json = await restOnce(path, '');
  noteServed(READ_PATH_PUBLIC);
  return json;
}

/**
 * Read one path, or `null` — used where a per-pair gap must not abort the
 * sweep.
 *
 * One retry, because the failure this sweep provokes is a SECONDARY rate limit
 * from issuing two reads per pair back to back, and a transient 403 that lands
 * as an UNJUDGED row costs a reader the same attention as a real one. Measured
 * on the 2026-08-31 board: 3 of 25 pairs came back unjudged on the first pass
 * with no retry. ⛔ One retry, not a loop: a sweep that keeps trying is a sweep
 * that hides an exhausted quota, and the UNJUDGED row is the correct answer
 * once the read has genuinely failed.
 */
async function restOrNull(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await rest(path);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

/** The #13544 re-exec, planned by the sibling and performed here. */
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
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning')
    ? ['--disable-warning=UNDICI-EHPA']
    : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(
    `⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); ` +
      'continuing in-process — every request will bypass the proxy.',
  );
  return null;
}

/**
 * Every open PR on the board, paged to exhaustion.
 *
 * Each page gets the same ONE retry the per-pair reads get, and for a sharper
 * reason: a failure here is TOTAL. Measured 2026-08-31 — a transient `HTTP 502`
 * on page 1 refused a whole `--pair` run that would otherwise have answered in
 * a second. The refusal itself was correct (exit 3, "0 pair(s) had been read",
 * ⛔ never a clean board), which is exactly why it should not be spent on a
 * blip. ⛔ Still one retry, not a loop: a second failure is the answer.
 */
async function listOpenPulls(repo) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const path = `/repos/${repo}/pulls?state=open&per_page=100&page=${page}`;
    let batch;
    try {
      batch = await rest(path);
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
      batch = await rest(path); // a second failure throws, and the caller refuses.
    }
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * The sentence a CAPPED read files, written ONCE for every ladder in this file.
 *
 * ⭐ What was measured (#18683) was not a missing sentence: it was two reads in
 * ONE file giving OPPOSITE defaults on "I did not read everything" — the two
 * that page answered `null` (UNJUDGED, fail-CLOSED), and the un-paged one
 * judged the claim pool from whatever the first page happened to contain
 * (fail-OPEN, on the read that arbitrates OWNERSHIP). A shared sentence is the
 * half of that a reader can check by sight; the shared LADDER below is the half
 * that cannot drift at all.
 */
export function pageCapNote(cap, noun) {
  return `${cap} page(s) of 100 ${noun} each, all of them full — the tail is past this file's `
    + 'page cap and therefore unread';
}

/**
 * What ONE paged read DID — the pages it issued, the cap it was allowed, and
 * whether it hit it. Keyed by the same `readDiagnosisKey` the diagnosis is,
 * written by `pagedListRead`, drained by `gather` for the input record.
 *
 * ⛔ Never consulted by a predicate: a ladder record is provenance, exactly as
 * the request ledger is.
 */
const readLadders = new Map();

/** The ladder one resource's read took, or `null` when no ladder ran for it. */
export function readLadderRecord(key) {
  return readLadders.get(key) ?? null;
}

/**
 * File the ladder a DOCUMENT-backed read did not take: one read, no cap, and
 * the field says so rather than rendering as a page count the document never
 * paid for.
 */
function noteDocumentRead(key) {
  readLadders.set(key, { pages: 1, cap: null, capped: false, complete: true });
}

/**
 * ONE list endpoint, paged to exhaustion — or `null`.
 *
 * ⛔ Never a partial array, and that is the whole property: a caller cannot
 * tell a short read from a quiet carrier, so a read that did not finish answers
 * UNJUDGED rather than handing back the part that arrived. All three of this
 * file's list reads go through here, so ⛔ no two of them can disagree again
 * about what an unfinished read defaults to (#18683).
 *
 * `readPage` answers one page's rows or `null`. The ladder stops on the FIRST
 * short page — ⛔ no wasted request — and refuses on the cap.
 */
async function pagedListRead({ key, cap, noun, readPage }) {
  const out = [];
  for (let page = 1; page <= cap; page++) {
    const batch = await readPage(page);
    if (!Array.isArray(batch)) {
      readLadders.set(key, { pages: page, cap, capped: false, complete: false });
      return null;
    }
    out.push(...batch);
    if (batch.length < 100) {
      readLadders.set(key, { pages: page, cap, capped: false, complete: true });
      return out;
    }
  }
  // ⛔ Not a refusal: every page ANSWERED and the resource is still unread, so
  // the diagnosis names the channel that served and says what went short rather
  // than reporting a channel nobody tried (#16833).
  noteAttempt(readPathState.lastServed ?? READ_PATH_PUBLIC, pageCapNote(cap, noun));
  readLadders.set(key, { pages: cap, cap, capped: true, complete: false });
  return null; // cap hit: the tail is unread, so the resource is unread.
}

/**
 * The page cap on ONE card's — or one PR's — COMMENT thread.
 *
 * ⭐ This is the read that arbitrates OWNERSHIP: the governing claim, the pool
 * its membership is resolved over, and the `Clause-②` line the declaration limb
 * reads all come out of these rows. Read short, it does not merely lose detail
 * — it loses a NEWER claim, so a superseded carrier governs and its declaration
 * is read as though it were the live one. Measured on the 101-row fixture
 * (#18683): the un-paged read answered `absent` on a thread whose 101st comment
 * was the only claim, and `DECLARED \`yes\`` on a thread whose 101st comment
 * withdrew that value.
 *
 * Ten pages is 1,000 comments. Sized on this board, 2026-09-17: the longest
 * open thread of any kind is seat post #6015 at 895 comments (nine pages), the
 * next four are #12708 at 365, #6023 at 241, #6017 at 206 and #6024 at 187, the
 * longest thread carrying a queue label is #13799 at 117, and the longest card
 * in the clause-② population — the 28 pairs the sweep derived that day — is
 * #17534 at 14. So the cap clears the whole board today with a page to spare,
 * and it is the SAME ten `EVENT_PAGE_CAP` uses, because a reader comparing two
 * caps in one file should have to remember one number. A thread that exceeds it
 * is answered `null` → UNJUDGED, never clean (#4690).
 */
export const COMMENT_PAGE_CAP = 10;

/**
 * One carrier's comment thread, paged to exhaustion — or `null`.
 *
 * ⛔ Never the first page alone: that is what this function exists to stop
 * being. A truncated pool is a pool, and nothing downstream can tell it from a
 * complete one.
 */
async function readCardComments(repo, number) {
  const key = readDiagnosisKey('comments', number);
  return diagnosedRead(key, () => pagedListRead({
    key,
    cap: COMMENT_PAGE_CAP,
    noun: 'comments',
    readPage: (page) => restOrNull(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`),
  }));
}

/**
 * The page cap on ONE carrier's label event stream.
 *
 * Events arrive OLDEST FIRST, so the reading needs the LAST page, not the
 * first: a stream read short does not merely lose detail, it loses the removal
 * and reads as a live hang or a never-hung gate. Ten pages is 1,000 events on a
 * single card, well past anything the board produces; a carrier that exceeds it
 * is answered `null` → UNJUDGED, never clean (#4690).
 */
export const EVENT_PAGE_CAP = 10;

/**
 * One carrier's gate history, paged to exhaustion — or `null`.
 *
 * ⛔ Never a partial array: a caller cannot tell a short read from a quiet
 * carrier, and the whole point of this stream is to distinguish "no hang" from
 * "hang I did not read".
 */
async function readCarrierEvents(repo, number) {
  const key = readDiagnosisKey('events', number);
  return diagnosedRead(key, () => pagedListRead({
    key,
    cap: EVENT_PAGE_CAP,
    noun: 'events',
    readPage: (page) => restOrNull(`/repos/${repo}/issues/${number}/events?per_page=100&page=${page}`),
  }));
}

/**
 * The head commit's date, for the head-motion half — or `null`.
 *
 * ⚠️ The boundary, stated where the reading is taken: this is COMMIT METADATA,
 * not a push timestamp. A normal push writes the committer date at push time,
 * which is what makes the reading work; a force-push that lands a deliberately
 * backdated commit would read as unmoved. The unforgeable alternative
 * (`head_ref_force_pushed`) lives only on the TIMELINE endpoint, which caps at
 * 250 events and truncates SILENTLY — and a capped read backing a CLEAN verdict
 * is the fail-open shape this family refuses everywhere else, so the exact,
 * uncapped, one-request reading is preferred with its residual hole named. The
 * PASS conjunct of the recovery rule stays human and is what closes it.
 */
async function readHeadCommitDate(repo, sha) {
  if (!sha) return null;
  return diagnosedRead(readDiagnosisKey('commit', sha), async () => {
    const commit = await restOrNull(`/repos/${repo}/commits/${sha}`);
    return commit?.commit?.committer?.date ?? null;
  });
}

/**
 * The PAGE CAP on one PR's changed-file listing.
 *
 * Three pages is 300 files, past anything this board's PRs produce, and the
 * files that matter here are a handful of contract sources. A PR that exceeds
 * it is answered `null` -> UNJUDGED, never clean: a listing read short does not
 * merely lose detail, it loses the very file whose added key is the tell.
 */
export const FILE_PAGE_CAP = 3;

/**
 * One PR's changed files, with their patches, paged to exhaustion -- or `null`.
 *
 * Owed by the widening-tell reading ALONE, and only for a pair whose card
 * declares `Clause-②: no` (`needsWideningRead`, the same predicate the
 * UNJUDGED accounting reads), so no pair can owe a request the live reader was
 * never going to make.
 *
 * ⛔ Never a partial array, for the reason `readCarrierEvents` states one
 * function over: a caller cannot tell a short read from a narrow diff.
 */
async function readPullFiles(repo, number) {
  const key = readDiagnosisKey('files', number);
  return diagnosedRead(key, () => pagedListRead({
    key,
    cap: FILE_PAGE_CAP,
    noun: 'files',
    readPage: (page) => restOrNull(`/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`),
  }));
}

/**
 * The six reads `gather` performs, named once.
 *
 * A reader implements every one of them and may answer with a value OR a
 * promise of one (`gather` awaits either), which is what lets the offline
 * reader be plain and synchronous while the live one is not. The list is a
 * constant so the self-test can assert both readers against the same roster
 * instead of discovering a missing method at 3am on a live board.
 */
export const READER_METHODS = Object.freeze([
  'listOpenPulls',
  'readCard',
  'readCardComments',
  'readCarrierEvents',
  'readHeadCommitDate',
  'readPullFiles',
]);

/** Paths (i) and (ii): the network, down the ladder `rest` implements. */
const NETWORK_READER = Object.freeze({
  id: 'network',
  repo: null,
  listOpenPulls: (repo) => listOpenPulls(repo),
  readCard: (repo, n) => diagnosedRead(readDiagnosisKey('card', n), () => restOrNull(`/repos/${repo}/issues/${n}`)),
  readCardComments: (repo, n) => readCardComments(repo, n),
  readCarrierEvents: (repo, n) => readCarrierEvents(repo, n),
  readHeadCommitDate: (repo, sha) => readHeadCommitDate(repo, sha),
  readPullFiles: (repo, n) => readPullFiles(repo, n),
});

/** A resource the document does not carry — `null`, i.e. UNJUDGED (#4690). */
function fromDocument(bag, key) {
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return null;
  const value = bag[String(key)];
  return value === undefined ? null : value;
}

/**
 * Path (iii): a pre-fetched pair, judged with no network at all.
 *
 * ⛔ It answers `null` for anything the document omits, which every caller
 * already reads as UNJUDGED. That asymmetry is the whole safety property: a
 * document can only make this file say LESS about a pair, never more, so a
 * hand-assembled input cannot manufacture a clean reading out of a gap.
 *
 * @throws when the document is not a pair document — bad INPUT, reported as
 *   usage (exit 1) rather than as a fact about the pair.
 */
export function pairJsonReader(doc, { source = 'the --pair-json document' } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`--pair-json: ${source} is not a JSON object, so it names no pair to judge.`);
  }
  const pulls = Array.isArray(doc.pulls) ? doc.pulls : doc.pull && typeof doc.pull === 'object' ? [doc.pull] : null;
  if (!pulls) {
    throw new Error(
      `--pair-json: ${source} carries no \`pulls\` array and no single \`pull\` object. One `+
        'PR row is the minimum a pair can be formed from (number, draft, body, head.ref, head.sha, labels).',
    );
  }
  const serve = (value, what) => {
    noteServed(READ_PATH_PAIR_JSON);
    // The document is a read path like any other, so it files the same request
    // ledger entry the network paths do (#18456) — a record whose `requests`
    // block went empty on this path would read as a run that read nothing.
    noteRequest(
      READ_PATH_PAIR_JSON,
      `${source} -> ${what}`,
      value === null || value === undefined ? 'absent from the document' : 'present',
      Array.isArray(value) ? value.length : null,
    );
    return value;
  };
  // ⭐ The document's own refusal, in the same register the network channels
  // report theirs (#16833): a key the document omits is a read this seat could
  // not complete, and naming the bag and the id is what turns "UNJUDGED" into a
  // one-line remedy — ⛔ it is still UNJUDGED, exactly as before.
  const served = (key, bag, id, value) => {
    if (value === null || value === undefined) {
      fileReadDiagnosis(key, [
        {
          channel: READ_PATH_PAIR_JSON,
          answer: `${source} carries no \`${bag}\` entry for \`${id}\` (add one, or take the reading live)`,
        },
      ]);
    }
    return serve(value, `${bag}[${id}]`);
  };
  return Object.freeze({
    id: READ_PATH_PAIR_JSON,
    repo: typeof doc.repo === 'string' && doc.repo.trim() ? doc.repo.trim() : null,
    listOpenPulls: () => serve(pulls, 'pulls'),
    readCard: (_repo, n) => served(readDiagnosisKey('card', n), 'cards', n, fromDocument(doc.cards, n)),
    readCardComments: (_repo, n) => {
      const rows = fromDocument(doc.comments, n);
      // The document serves the thread whole, so the ladder field states THAT
      // rather than rendering unset beside a reading that really was complete.
      if (Array.isArray(rows)) noteDocumentRead(readDiagnosisKey('comments', n));
      return served(readDiagnosisKey('comments', n), 'comments', n, Array.isArray(rows) ? rows : null);
    },
    readCarrierEvents: (_repo, n) => {
      const rows = fromDocument(doc.events, n);
      return served(readDiagnosisKey('events', n), 'events', n, Array.isArray(rows) ? rows : null);
    },
    readHeadCommitDate: (_repo, sha) => {
      const commit = fromDocument(doc.commits, sha);
      return served(readDiagnosisKey('commit', sha), 'commits', sha, commit?.commit?.committer?.date ?? null);
    },
    readPullFiles: (_repo, n) => {
      const rows = fromDocument(doc.files, n);
      return served(readDiagnosisKey('files', n), 'files', n, Array.isArray(rows) ? rows : null);
    },
  });
}

/**
 * A document that names a DIFFERENT board than this run resolved — refused, in
 * the same words and for the same reason the repo resolver refuses one: a
 * report about the wrong repo reads exactly like a report about this one.
 */
export function pairJsonRepoConflict(docRepo, repo) {
  if (!docRepo || docRepo === repo) return null;
  return (
    `--pair-json names ${JSON.stringify(docRepo)} but this run resolved ${JSON.stringify(repo)}. ` +
    'Refusing to judge one board\'s pair under another board\'s name — a report about the wrong ' +
    'repo reads exactly like a report about this one.'
  );
}

/**
 * Gather the pairs and everything each row needs.
 *
 * A PR's delivering card is read from the PR body/branch, so the card set is
 * whatever those name — no open-issue listing is paged for it. That keeps the
 * sweep's cost at one PR listing plus two reads per pair, plus — for the C3
 * candidates ALONE — their two event streams and one head commit.
 *
 * `landingReads` is the `--pair` path's extra budget, and it buys exactly two
 * things a report-only sweep does not: the changed-file listing C5 reads
 * (#16448) and, since #18174, the PR's own comment thread for a pair that owes
 * no record but may carry one. Both are one read per pair on a run that judges
 * ONE pair, and both would push a 29-pair sweep past the anonymous hourly
 * budget it already sits on — the same sweep/`--pair` split every other row
 * here makes.
 */
async function gather(repo, prFilter = null, reader = NETWORK_READER, { landingReads = false } = {}) {
  const pulls = (await reader.listOpenPulls(repo)).filter((pr) => (prFilter ? pr.number === prFilter : true));
  const pairs = [];
  for (const pr of pulls) {
    const body = String(pr?.body ?? '');
    const named = new Set(
      [...body.matchAll(/#(\d{1,7})\b/g)].map((m) => m[1]).concat(String(pr?.head?.ref ?? '').match(/issue-(\d+)/)?.[1] ?? []),
    );
    for (const n of named) {
      if (!prDeliversCard(pr, n)) continue;
      const card = await reader.readCard(repo, n);
      const comments = await reader.readCardComments(repo, n);
      const pair = {
        pr: pr.number,
        draft: Boolean(pr.draft),
        card: Number(n),
        headSha: pr?.head?.sha ?? null,
        // ⭐ The pairing's own inputs, carried for the input record (#18456)
        // and read by nothing else: the evidence kind is the SAME call
        // `prDeliversCard` just made, so the block states the derivation that
        // actually formed this pair rather than a second opinion about it.
        evidence: deliveryEvidence(pr, n),
        prBody: body,
        headRef: pr?.head?.ref ?? null,
        prLabels: Array.isArray(pr.labels) ? labelNames(pr) : null,
        cardLabels: card && Array.isArray(card.labels) ? labelNames(card) : null,
        cardComments: Array.isArray(comments) ? comments : null,
        // ⭐ The LADDER the thread was read down (#18683), carried for the
        // input record and read by nothing else: two runs that disagree about
        // a pool can now be diffed on how much of the thread each one saw.
        cardCommentRead: readLadderRecord(readDiagnosisKey('comments', n)),
      };
      // ⭐ The channel diagnosis rides on the pair (#16833), attached under the
      // SAME words the gap that reports it uses, and only where the read came
      // back unread — so nothing about a pair that read cleanly moves at all.
      if (pair.cardLabels === null) attachReadDiagnosis(pair, readDiagnosisKey('card', n), `card #${pair.card}'s labels`);
      if (pair.cardComments === null) {
        attachReadDiagnosis(pair, readDiagnosisKey('comments', n), `card #${pair.card}'s comment thread`);
      }
      pairs.push(pair);
    }
  }

  // Second pass — the gate history, for the C3 candidates and nobody else.
  // `needsGateHistory` is the SAME predicate the UNJUDGED accounting reads, so
  // the set that owes a stream and the set that gets one cannot drift apart.
  for (const pair of pairs) {
    if (!needsGateHistory(pair)) continue;
    pair.cardEvents = await reader.readCarrierEvents(repo, pair.card);
    if (pair.cardEvents === null) {
      attachReadDiagnosis(pair, readDiagnosisKey('events', pair.card), `card #${pair.card}'s label event stream`);
    }
    pair.prEvents = await reader.readCarrierEvents(repo, pair.pr);
    if (pair.prEvents === null) {
      attachReadDiagnosis(pair, readDiagnosisKey('events', pair.pr), `PR #${pair.pr}'s label event stream`);
    }
    // The head commit is owed only once both carriers read CLEARED — the one
    // state whose verdict turns on head motion.
    const card = carrierGateHistory(pair.cardEvents);
    const prHist = carrierGateHistory(pair.prEvents);
    if (card.state === 'cleared' && prHist.state === 'cleared') {
      pair.headCommittedAt = await reader.readHeadCommitDate(repo, pair.headSha);
      if (pair.headCommittedAt === null) {
        attachReadDiagnosis(pair, readDiagnosisKey('commit', pair.headSha), `PR #${pair.pr}'s head commit date`);
      }
    }
  }

  // Third pass -- the changed-file listing, for the widening reading (#16448).
  //
  // ⭐ `--pair` ONLY, and only for the pairs that declared `no`. The report-only
  // SWEEP deliberately does not pay for it: a 29-PR sweep already costs about
  // GitHub's whole documented anonymous hourly budget, one row per pair here
  // would push it past that, and a widening tell on somebody else's pair is a
  // board fact rather than a verdict about the PR that happens to run next --
  // the same call the sweep/`--pair` split already makes everywhere else in
  // this file. `pair.files` is therefore `undefined` in a sweep, which no row
  // reads, and `null` only when a read that WAS owed came back short.
  if (landingReads) {
    for (const pair of pairs) {
      if (!needsWideningRead(pair)) continue;
      pair.files = await reader.readPullFiles(repo, pair.pr);
      if (pair.files === null) {
        attachReadDiagnosis(pair, readDiagnosisKey('files', pair.pr), `PR #${pair.pr}'s changed-file listing`);
      }
    }
  }

  // Fourth pass -- the review of record. The PR's own thread is the same
  // endpoint the card's is (`/issues/N/comments` -- a PR is an issue there),
  // read through the same `readCardComments`, so the offline document carries
  // it in the same `comments` bag keyed by the PR NUMBER and no reader grows a
  // seventh method. Cached per PR, so a two-card PR (#16304) pays once.
  //
  // Three populations, one pass:
  //   · in BOTH modes, the COMPLETED pairs (#17302) -- the narrow window
  //     between a clear and a landing, where a cleared gate with no record
  //     behind it is precisely the board fact the filing sweep measured five
  //     times over;
  //   · in BOTH modes, the `Clause-②: no` pairs whose card sits in the spec
  //     or skills lane (#18536, `needsRecordRead`'s second population) -- the
  //     lane rule owes the record on every round those lanes deliver, and a
  //     `no` round hangs no carrier that could mark its review pending;
  //   · on the `--pair` path, EVERY pair (#18174) -- because what a record's
  //     `Served-tier:` line declares is a fact about the record, judged on
  //     whatever pair carries one, and the pair that carried the measured
  //     defect (PR #18157, record 5661052272) never hung the gate at all.
  //     ⛔ Not bought per sweep pair: the budget paragraph above says why, and
  //     `locatedRecordUnjudged` is called from the same `--pair` path, so the
  //     set that owes this thread and the set that gets one cannot drift apart.
  const prThreads = new Map();
  for (const pair of pairs) {
    if (!landingReads && !needsRecordRead(pair)) continue;
    if (!prThreads.has(pair.pr)) prThreads.set(pair.pr, await reader.readCardComments(repo, pair.pr));
    const rows = prThreads.get(pair.pr);
    pair.prComments = Array.isArray(rows) ? rows : null;
    pair.prCommentRead = readLadderRecord(readDiagnosisKey('comments', pair.pr));
    if (pair.prComments === null) {
      attachReadDiagnosis(pair, readDiagnosisKey('comments', pair.pr), `PR #${pair.pr}'s comment thread`);
    }
  }
  return { pulls, pairs };
}

// ---------------------------------------------------------------------------
// The INPUT RECORD — what this run judged FROM, stated (#18456)
// ---------------------------------------------------------------------------

/**
 * ## The defect: `--pair` was not reproducible, and nothing it printed could
 * settle which of two disagreeing runs had read what
 *
 * Measured on ONE pair — PR #17917 / card #17425 — on 2026-09-13, three
 * first-hand runs of the same command with an identical script blob: **0 at
 * 02:57Z, 4 (MISPLACED) at 03:04:09Z, 0 at 03:58:33Z**. Two explanations were
 * ruled out with controls: no comment on that thread was ever edited (all 16
 * rows carry `created_at == updated_at`), and this file resolves its board from
 * the environment alone, so the working directory cannot retarget it. ⇒ The
 * cause is still UNKNOWN, and the two runs could not be compared because
 * neither had SAID what it read.
 *
 * ⭐ That is the gap this block closes, and it is deliberately not a fix for
 * the non-determinism: it makes the INPUT of a run a printed artefact, so two
 * runs that disagree are settled by DIFFING their two blocks — ⛔ never by
 * re-running until one side wins, which is what the board did three times and
 * learned nothing from. A verdict a second reader cannot reproduce is not a
 * clearance, and the landing pre-check ② is exactly where that costs something.
 *
 * ## What it states, and why each field is in it
 *
 *   · the BOARD and which of the three sources answered — a report about the
 *     wrong repo reads exactly like a report about this one;
 *   · the READ PATH and the API surface behind it, plus EVERY request the run
 *     issued, in order, with its channel, its answer and its ROW COUNT — a page
 *     asked for with `per_page=100` that answers with exactly 100 rows is the
 *     one shape a truncated read and a complete one share;
 *   · the PAIRING: which PR, which card, and the evidence `prDeliversCard`
 *     derived it from, quoted off the body line that carried it;
 *   · the COMMENTS read, by count, id list and newest id — the set the
 *     declaration limb is judged over;
 *   · the CLAIM COMMENT selected as the carrier, the RULE that selected it,
 *     and every other claim it rejected WITH the reason — so "the two runs
 *     selected different comments" is distinguishable from "the two runs
 *     applied different rules";
 *   · the REPEAT reading (#18828): which author, if any, holds more than one
 *     LIVE claim comment on this thread, with every id — a fact about the rows
 *     that were read, stated where the SUPERSEDED sentence used to be the only
 *     trace of it. ⚠️ The verdict it earns is row C8's; ⛔ no field here
 *     resolves one;
 *   · a BODY FINGERPRINT (bytes + `sha256:`) on each claim in the pool. ⭐ This
 *     is the field the measured 0/4/0 actually needs: the 4 was `misplaced`,
 *     which on that thread requires the governing claim to have carried NO
 *     readable declaration while the superseded one did — and the governing
 *     claim's line 3 is `Clause-②: no` in the fixed spelling. Same ids and a
 *     different verdict is only possible if the BYTES differed, and nothing
 *     printed the bytes;
 *   · the PR-BODY line, read by the same reader — ⚠️ stated as an input and
 *     ⛔ not as a limb: no row here judges the PR body, and this field changes
 *     that by not one character;
 *   · this file's own blob hash and the path it ran from, plus a UTC stamp —
 *     "the blob was identical on both sides" was a CLAIM in the measured
 *     incident, and this makes it a printed fact a seat can check with
 *     `git hash-object` against the path the block names.
 *
 * ## Where it goes, and its shape
 *
 * STDERR, in every mode, beside the board provenance line and the read-path
 * report and for the same reason those are there: stdout is contractually the
 * ANSWER, and provenance on stdout travels into a round report that pastes it
 * as though it were part of the finding. The `--json` sweep carries the same
 * record under `inputs` — ⭐ the same record, never a second format.
 *
 * The block is fence-delimited and line-oriented: `key: value`, one declared
 * key per line, in roster order, on EVERY exit — 0, 4, a refusal, a transport
 * failure. A field this run could not fill renders an explicit token; ⛔ a
 * field is never dropped, because a block whose shape moves with the verdict
 * cannot be diffed against the other one. A value too long for one line
 * continues on indented lines below its key.
 *
 * ⛔ Nothing here resolves a state, a row, a count or an exit code, and the
 * record reads no verdict. It is what the run READ, never what it concluded.
 */
export const INPUT_RECORD_VERSION = 1;
export const INPUT_RECORD_OPEN = `----- clause2 input record v${INPUT_RECORD_VERSION} -----`;
export const INPUT_RECORD_CLOSE = '----- end clause2 input record -----';

/** What a declared field renders as when this run never filled it. */
export const INPUT_RECORD_UNSET = '(not set by this run — ⛔ a declared field is never dropped)';

/**
 * The RUN half of the roster: the fields every block carries, in order.
 *
 * ⭐ Pinned as NAMES, the same call `SELF_TEST_BATTERIES` and `KNOWN_FLAGS`
 * make one family over: a renderer that walks a declared roster cannot lose a
 * field by dropping the code that filled it — the field renders unset and
 * SAYS so — and a field added to the builder without an entry here is named by
 * this file's own self-test instead of appearing in half the blocks.
 */
export const INPUT_RECORD_RUN_FIELDS = Object.freeze([
  'record.version',
  'run.utc',
  'run.mode',
  'run.script.path',
  'run.script.blob',
  'run.script.bytes',
  'run.node',
  'board.repo',
  'board.source',
  'read.plan',
  'read.api',
  'read.token',
  'read.served',
  'read.pair-json',
  'run.requests',
  'pairs.derived',
]);

/** The PAIR half of the roster — repeated per derived pair, in order. */
export const INPUT_RECORD_PAIR_FIELDS = Object.freeze([
  'pr',
  'card',
  'derivation',
  'head-sha',
  'card-comments',
  'card-comment-pages',
  'card-comment-ids',
  'card-comment-newest',
  'pr-comments',
  'pr-comment-pages',
  'pr-comment-ids',
  'pr-comment-newest',
  'claim.rule',
  'claim.selected',
  'claim.rejected',
  'claim.repeat',
  'claim.handover',
  'claim.clause2-line',
  'pr-body.clause2-line',
]);

/**
 * The git blob sha1 of some bytes — the hash `git hash-object` prints.
 *
 * Git's, and not a plain digest, precisely so a reader can CHECK it:
 * `git hash-object scripts/pm/check-clause2-carriers.mjs` against the path the
 * block names is a one-command verification of "same blob on both sides",
 * which was asserted rather than shown in the incident this record exists for.
 *
 * ⚠️ The NUL separator git's format requires is written as a byte rather than
 * as a literal in this source: `check:nul-bytes` refuses a raw control byte in
 * a tracked file, and an escape that renders to one is the same byte.
 */
export function gitBlobSha1(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.length}`, 'utf8'))
    .update(Buffer.from([0]))
    .update(body)
    .digest('hex');
}

/** Bytes + a short content digest — the "same ids, different bytes" field. */
export function bodyFingerprint(body) {
  const buf = Buffer.from(String(body ?? ''), 'utf8');
  return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 12) };
}

let selfProvenanceCache = null;

/**
 * This file, as it is ON DISK in the tree this run was invoked from.
 *
 * ⚠️ The ONE file this gate reads out of a checkout, and the header's sentence
 * upstairs is amended rather than quietly falsified: it reads its own source
 * for PROVENANCE and reads no board data from any tree. Nothing about the
 * verdict moves — no state, row, count or exit consults this — so an
 * environment variable still retargets the board exactly as before, and an
 * unreadable file yields a stated absence rather than a refusal.
 */
export function selfProvenance() {
  if (selfProvenanceCache === null) {
    try {
      const bytes = readFileSync(SELF_PATH);
      selfProvenanceCache = { path: SELF_PATH, blob: gitBlobSha1(bytes), bytes: bytes.length };
    } catch (err) {
      selfProvenanceCache = {
        path: SELF_PATH,
        blob: null,
        bytes: null,
        reason: err?.message ?? 'unreadable',
      };
    }
  }
  return selfProvenanceCache;
}

/** An id list, whole while it is short and first/last/count once it is not. */
export function renderIdList(rows, cap = 12) {
  const ids = (Array.isArray(rows) ? rows : []).map((r) => String(r?.id ?? '(no id)'));
  if (ids.length === 0) return 'none';
  if (ids.length <= cap) return ids.join(',');
  return `${ids[0]} … ${ids[ids.length - 1]} (${ids.length} ids; the middle ${ids.length - 2} are elided)`;
}

/**
 * The NEWEST row of a thread, by the SAME recency rule the carrier selection
 * uses — `created_at`, ties and unreadable stamps by thread order, later wins.
 * ⛔ Not "the last row the API returned": that is what a re-ordered page would
 * change, and telling the two apart is half of what this record is for.
 */
export function newestRow(rows) {
  let best = null;
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const parsed = Date.parse(row?.created_at ?? '');
    const stamp = Number.isFinite(parsed) ? parsed : null;
    const candidate = { row, stamp, index };
    if (best === null) best = candidate;
    else if (candidate.stamp === null || best.stamp === null) {
      if (candidate.index > best.index) best = candidate;
    } else if (candidate.stamp >= best.stamp) best = candidate;
  });
  return best?.row ?? null;
}

/**
 * `<id> at <created_at> by <login>` — one row named the way every field here
 * names one.
 *
 * ⭐ The LOGIN is part of the name (#18719). The card's assignee is the LABEL
 * face of ownership and the governing claim is the SELECTOR face; on #18373
 * they disagreed for hours and nothing printed the two side by side, so the
 * contradiction had to be reconstructed by hand. ⚠️ The assignee itself is ⛔
 * not read on this path — this block states the selector face and says whose
 * comment it is, which is the half this record can buy without a new request.
 */
function namedRow(row) {
  if (!row) return 'none';
  const login = row?.user?.login;
  const by = typeof login === 'string' && login.trim() !== '' ? `\`${login}\`` : '(no readable author)';
  return `${String(row?.id ?? '(no id)')} at ${row?.created_at ?? '(no readable date)'} by ${by}`;
}

/**
 * ONE paged read, stated as an INPUT: the pages it issued, the cap it was
 * allowed, and which of the four ways it ended.
 *
 * ⭐ The field the asymmetry closed with (#18683). A thread of exactly 100 rows
 * and a thread whose tail was dropped are the same `100 row(s)` in every other
 * line this block prints; they differ HERE, because the complete one stopped on
 * a short page and the truncated one did not stop at all.
 */
export function ladderReading(ladder, noun) {
  if (!ladder) return '(no paged read of this thread was taken on this path)';
  if (ladder.cap === null) {
    return '1 read, served whole from the pre-fetched document — ⛔ no page ladder applies to it';
  }
  if (ladder.capped) {
    return `CAPPED — ${ladder.pages} of ${ladder.cap} page(s) of 100 ${noun} each were requested and `
      + 'EVERY ONE came back full, so the tail is past the cap and the thread is UNREAD (UNJUDGED) '
      + '— ⛔ never a truncated pool, ⛔ never a clean reading';
  }
  if (!ladder.complete) {
    return `${ladder.pages} of ${ladder.cap} page(s) requested; page ${ladder.pages} came back UNREAD, `
      + 'so the thread is unread — the cap was ⛔ not what stopped it';
  }
  return `${ladder.pages} of ${ladder.cap} page(s) requested — the ladder stopped on a SHORT page, so `
    + 'the thread is COMPLETE';
}

/** What `readClause2Line` read out of one body, stated as an INPUT. */
function clause2Reading(body) {
  const read = readClause2Line(body);
  if (read === null) return 'no line in this body reaches the reader — neither a declaration nor a near miss';
  if (read.kind === 'declared') {
    return `DECLARED \`${read.value}\`${read.arm ? ` (arm: ${read.arm})` : ''} — ${quoteLine(read.line)}`;
  }
  return `${read.kind.toUpperCase()}${read.reason ? `/${read.reason}` : ''} — ${quoteLine(read.line)}`;
}

/** The PR body line that carried the pairing, quoted — or what stood in for it. */
function derivationLine(pair) {
  const kind = pair?.evidence ?? null;
  const note = deliveryEvidenceNote(kind);
  if (kind === 'branch-name') {
    return `\`branch-name\` (${note}) — head.ref: ${pair?.headRef ?? '(unread)'}`;
  }
  const body = String(pair?.prBody ?? '');
  const marker = `#${pair?.card}`;
  const line = body.split('\n').find((l) => l.includes(marker)) ?? null;
  return `\`${kind ?? 'unread'}\` (${note})${line === null ? ' — no body line naming this card was found' : ` — body line: ${quoteLine(line)}`}`;
}

/**
 * ONE pair's input half, as a flat map of declared keys.
 *
 * Every key in `INPUT_RECORD_PAIR_FIELDS` is filled, including the ones a
 * given path does not buy: `--pair` reads the PR's own thread and a sweep does
 * not, and "this path does not read it" is a different fact from "it came back
 * unread" — the two render as two sentences and ⛔ never as one silence.
 */
export function pairInputRecord(pair) {
  const selection = claimCarrierSelection(pair?.cardComments ?? null);
  const pool = selection.pool ?? [];
  const out = {
    pr: String(pair?.pr ?? '(none)'),
    card: String(pair?.card ?? '(none)'),
    derivation: derivationLine(pair),
    'head-sha': pair?.headSha ?? '(unread)',
    'card-comments': Array.isArray(pair?.cardComments)
      ? `${pair.cardComments.length} row(s)`
      : 'UNREAD — the thread could not be read, so this pair is UNJUDGED',
    'card-comment-pages': ladderReading(pair?.cardCommentRead ?? null, 'comments'),
    'card-comment-ids': Array.isArray(pair?.cardComments) ? renderIdList(pair.cardComments) : '(unread)',
    'card-comment-newest': Array.isArray(pair?.cardComments) ? namedRow(newestRow(pair.cardComments)) : '(unread)',
    'pr-comments':
      pair?.prComments === undefined
        ? '(not read on this path — the sweep buys the PR thread only for a pair that owes a record)'
        : Array.isArray(pair.prComments)
          ? `${pair.prComments.length} row(s)`
          : 'UNREAD — the PR thread could not be read',
    'pr-comment-pages': pair?.prComments === undefined
      ? '(not read on this path — the sweep buys the PR thread only for a pair that owes a record)'
      : ladderReading(pair?.prCommentRead ?? null, 'comments'),
    'pr-comment-ids': Array.isArray(pair?.prComments)
      ? renderIdList(pair.prComments)
      : pair?.prComments === undefined ? '(not read on this path)' : '(unread)',
    'pr-comment-newest': Array.isArray(pair?.prComments)
      ? namedRow(newestRow(pair.prComments))
      : pair?.prComments === undefined ? '(not read on this path)' : '(unread)',
    'claim.rule': selection.rule,
  };

  if (!selection.readable) {
    out['claim.selected'] = 'none — the card thread is UNREAD, so no carrier could be selected';
  } else if (selection.malformed) {
    out['claim.selected'] =
      `NONE — the newest claim comment (${selection.malformed.id ?? '(no readable id)'} at `
      + `${selection.malformed.createdAt ?? '(no readable date)'}) parses ZERO branches, so governance `
      + 'is unresolvable and no declaration is read from any comment (state `claim-branch-unparsed`)';
  } else if (pool.length === 0) {
    // Two different facts, and ⛔ never one sentence: a thread nobody claimed
    // owes a claim comment; a thread whose every claim was WITHDRAWN owes a
    // fresh one from whoever picks the card up. Saying the first about the
    // second would report the record the seats wrote as a record they did not.
    out['claim.selected'] = (selection.claims ?? []).length === 0
      ? 'none — no comment on this thread carries a line beginning `Claim:`'
      : `none — all ${selection.claims.length} claim comment(s) on this thread are RETRACTED (listed `
        + 'below), so there is no carrier and ⛔ none is fabricated from a withdrawn record';
  } else {
    out['claim.selected'] = [
      `${pool.length} comment(s) in the pool`,
      ...pool.map((row) => {
        const fp = bodyFingerprint(row?.body);
        return `${namedRow(row)} — ${fp.bytes} bytes, sha256:${fp.sha256}`;
      }),
    ];
  }

  const rejected = selection.rejected ?? [];
  out['claim.rejected'] = rejected.length === 0
    ? 'none — every claim comment on this thread is in the pool'
    : [
      `${rejected.length} claim comment(s) rejected`,
      ...rejected.map((r) => `${namedRow(r.row)} — ${r.reason}`),
    ];

  // ⭐ The same derivation the C8 row renders, so the record and the verdict
  // cannot disagree about how many claims one seat holds or which they are
  // (#18828). ⚠️ A READING of the rows — ⛔ not the verdict, which is the row.
  const repeats = claimRepeats(pair?.cardComments ?? null);
  out['claim.repeat'] = !Array.isArray(pair?.cardComments)
    ? 'UNREAD — the thread could not be read, so no repeat reading was taken'
    : repeats.length === 0
      ? 'none — no author holds more than one LIVE claim comment on this thread'
      : [
        `${repeats.length} author(s) holding more than one LIVE claim comment — the protocol forbids a `
        + 'second `Claim:` (row C8 is the verdict; this line is what was read)',
        ...claimRepeatSentences(repeats),
      ];

  // ⭐ The same derivation the C9 row and note render (#18862). A READING —
  // ⛔ not the verdict, which is the row, and not the listing, which is the note.
  const handover = claimHandovers(pair?.cardComments ?? null);
  out['claim.handover'] = !Array.isArray(pair?.cardComments)
    ? 'UNREAD — the thread could not be read, so no hand-over reading was taken'
    : handover === null
      ? `none — every LIVE claim comment on this thread is one author's (effective instant ${CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT})`
      : [
        `${handover.authors.length} author(s) hold LIVE claim comments with no \`Release:\` between — `
        + (handover.judged
          ? 'JUDGED (row C9 is the verdict; this line is what was read)'
          : 'LISTED, informational (every hand-over is dated at or before the effective instant; note C9-BEFORE-EFFECTIVE)'),
        claimHandoverSentence(handover),
      ];

  out['claim.clause2-line'] = pool.length === 0
    ? '(no carrier, so no line was read from one)'
    : pool.length === 1
      ? clause2Reading(pool[0]?.body)
      : [
        `${pool.length} carriers; the FIRST that declares wins`,
        ...pool.map((row) => `${String(row?.id ?? '(no id)')}: ${clause2Reading(row?.body)}`),
      ];

  out['pr-body.clause2-line'] = `${clause2Reading(pair?.prBody)} `
    + '⚠️ stated as an INPUT only — ⛔ no row here judges the PR body; the declaration limb is '
    + 'judged from the card, and `check-changeset-no-major.mjs` is what reads this line.';

  return out;
}

/**
 * The whole record — the run half plus one map per derived pair.
 *
 * Pure in its arguments, so the self-test drives every shape of it offline and
 * a block can never claim a path, a request or a pair that did not happen.
 */
export function buildInputRecord({
  repoRes = null,
  mode = null,
  state = null,
  pairs = null,
  self = null,
  now = null,
  node = process.version,
} = {}) {
  const served = state?.served instanceof Map ? state.served : new Map();
  const count = (id) => served.get(id) ?? 0;
  const requests = Array.isArray(state?.requests) ? state.requests : [];
  const plan = readPathPlan({
    token: state?.tokenPresent ? 'present' : '',
    pairJson: Boolean(state?.pairJsonSource),
  });
  const run = {
    'record.version': String(INPUT_RECORD_VERSION),
    'run.utc': (now instanceof Date ? now : new Date()).toISOString(),
    'run.mode': mode ?? '(unstated)',
    'run.script.path': self?.path ?? '(unstated)',
    'run.script.blob': self?.blob
      ? `${self.blob} (git blob sha1 — check it with \`git hash-object\` on the path above)`
      : `UNREAD — ${self?.reason ?? 'this run could not read its own source'}`,
    'run.script.bytes': self?.bytes === null || self?.bytes === undefined ? '(unread)' : String(self.bytes),
    'run.node': String(node),
    'board.repo': repoRes?.repo ?? '(the board was never resolved on this run)',
    'board.source': repoRes
      ? repoRes.source === 'default'
        ? 'default — NEITHER PM_SWEEP_REPO NOR GITHUB_REPOSITORY answered'
        : `${repoRes.source} — this run was deliberately targeted`
      : '(the board was never resolved on this run)',
    'read.plan': plan.map((id) => READ_PATH_LABELS[id] ?? String(id)).join(' then '),
    'read.api': state?.pairJsonSource
      ? `no network: every read is served from ${state.pairJsonSource}`
      : `${API} (REST, accept application/vnd.github+json)`,
    'read.token': !state?.tokenPresent
      ? 'absent from this environment (GITHUB_TOKEN / GH_TOKEN)'
      : state.tokenRetired
        ? `present but REFUSED (HTTP ${state.tokenRetired.status}) — retired for the rest of this run`
        : 'present',
    'read.served': `${READ_PATH_TOKEN}=${count(READ_PATH_TOKEN)}, ${READ_PATH_PUBLIC}=`
      + `${count(READ_PATH_PUBLIC)}, ${READ_PATH_PAIR_JSON}=${count(READ_PATH_PAIR_JSON)}`,
    'read.pair-json': state?.pairJsonSource ?? '(not named — this run read the network)',
    'run.requests': requests.length === 0
      ? '0 — this run issued no read at all'
      : [
        `${requests.length} read(s), in the order they were issued`,
        ...requests.map((r) => {
          const label = READ_PATH_LABELS[r.channel] ?? `(?) ${String(r.channel)}`;
          const rows = r.rows === null ? '' : ` (${r.rows} row(s))`;
          return `#${r.n} ${label} ${r.path} -> ${r.answer}${rows}`;
        }),
      ],
    'pairs.derived': pairs === null
      ? 'NONE — no pair was formed on this run, so nothing below was judged'
      : `${pairs.length} pair(s)`,
  };
  return { run, pairs: (pairs ?? []).map((pair) => pairInputRecord(pair)) };
}

/**
 * Keys the builder produced that the roster does not declare — ⛔ empty, or
 * the block has a field nothing pins. Read by the self-test, and printed in
 * the block itself so a live run cannot hide one either.
 */
export function undeclaredRecordFields(record) {
  const out = [];
  for (const key of Object.keys(record?.run ?? {})) {
    if (!INPUT_RECORD_RUN_FIELDS.includes(key)) out.push(key);
  }
  for (const pair of record?.pairs ?? []) {
    for (const key of Object.keys(pair ?? {})) {
      if (!INPUT_RECORD_PAIR_FIELDS.includes(key) && !out.includes(`pair.${key}`)) out.push(`pair.${key}`);
    }
  }
  return out;
}

/** One declared field, plus its indented continuation lines when it has any. */
function recordFieldLines(key, value) {
  if (value === undefined) return [`${key}: ${INPUT_RECORD_UNSET}`];
  if (Array.isArray(value)) {
    return [`${key}: ${value[0] ?? INPUT_RECORD_UNSET}`, ...value.slice(1).map((line) => `  ${line}`)];
  }
  return [`${key}: ${value}`];
}

/**
 * The block, rendered from the roster and from nowhere else.
 *
 * ⭐ It walks the DECLARED keys rather than the record's own: that is what
 * makes the shape the same on exit 0, exit 4 and every refusal, which is the
 * property the whole card turns on — two blocks are diffable line for line,
 * and a field that stopped being filled shows up as an unset field rather than
 * as a line that is simply not there.
 */
export function renderInputRecord(record) {
  const lines = [INPUT_RECORD_OPEN];
  for (const key of INPUT_RECORD_RUN_FIELDS) lines.push(...recordFieldLines(key, record?.run?.[key]));
  const pairs = Array.isArray(record?.pairs) ? record.pairs : [];
  pairs.forEach((pair, i) => {
    for (const key of INPUT_RECORD_PAIR_FIELDS) lines.push(...recordFieldLines(`pair.${i + 1}.${key}`, pair?.[key]));
  });
  const undeclared = undeclaredRecordFields(record);
  if (undeclared.length > 0) {
    lines.push(
      `record.undeclared: ${undeclared.join(', ')} — field(s) this run filled that the roster does `
        + 'not declare, so nothing pins them. Add them to the roster.',
    );
  }
  lines.push(
    'record.how-to-read: two runs that DISAGREE about one pair are settled by diffing their two '
      + 'blocks — ⛔ never by re-running until one side wins. The blob line says whether the two '
      + 'runs were even the same instrument.',
    INPUT_RECORD_CLOSE,
  );
  return lines;
}

function renderSweep({ repo, pulls, pairs, inputs = null }, { json = false } = {}) {
  const rows = [];
  const notes = [];
  const unjudged = [];
  for (const pair of pairs) {
    for (const row of pairRows(pair, pairs)) rows.push({ pr: pair.pr, card: pair.card, ...row });
    for (const note of pairNotes(pair, pairs)) notes.push({ pr: pair.pr, card: pair.card, ...note });
    const gap = pairUnjudged(pair);
    if (gap) unjudged.push({ pr: pair.pr, card: pair.card, text: gap });
  }
  const declarationLimb = declarationLimbTally(pairs);
  if (json) {
    // ⭐ The SAME record the block on stderr renders, in the SAME shape, under
    // one key — ⛔ never a second format (#18456). A round report that pastes
    // this JSON carries what the run read beside what it found.
    console.log(JSON.stringify({ repo, openPrs: pulls.length, pairs: pairs.length, declarationLimb, rows, notes, unjudged, inputs }, null, 2));
  } else {
    console.log(
      `check-clause2-carriers: ${pairs.length} card/PR pair(s) derived from ${pulls.length} open ` +
        `PR(s) in ${repo} — ${rows.length} clause-② finding(s), ${notes.length} note(s), ` +
        `${unjudged.length} pair(s) UNJUDGED. ` +
        `Declaration limb not read: ${declarationLimb.absent} with NO CLAIM COMMENT (a line ` +
        `beginning \`Claim:\` is the whole set) and ${declarationLimb.missing} with a claim ` +
        'comment but NO DECLARATION LINE — two readings, two remedies, ⛔ never one number. ' +
        `Read from a SIBLING card the same PR delivers: ${declarationLimb.sibling} — the fourth ` +
        'reading (#16304), which owes nothing and is deliberately counted apart from the two ' +
        'above. Report-only: findings are patrol input, not a gate verdict.',
    );
    for (const row of rows) console.log(`- **${row.code}** #${row.pr} / #${row.card} — ${row.text}`);
    for (const note of notes) console.log(`- **${note.code}** #${note.pr} / #${note.card} — ${note.text}`);
    for (const gap of unjudged) console.log(`- **UNJUDGED** ${gap.text}`);
    if (rows.length === 0 && unjudged.length === 0) {
      console.log('- (no findings, and every pair was fully read — a clean board, not a short read.)');
    }
  }
  return unjudged.length > 0 ? EXIT_INCOMPLETE : EXIT_OK;
}

// -- What the exit-0 line is allowed to claim (#16770) ----------------------
//
// The green line used to end with a bare three-word clause -- 「and both …
// carriers … agree」, written out nowhere in this file on purpose, because the
// #16770 pin scans this source for it -- in all three of its branches. In THIS
// file 「carrier」 means a LABEL carrier -- `gated()` asks
// "Did this carrier's labels come back readable?", C1 compares the
// `needs:contract-review` label on the card against the same label on the PR,
// and the docblock's limb ③ imports the maintainer's 2026-08-22 dual-carrier
// ruling for exactly that. So the clause was TRUE, about labels.
//
// ⚠️ But 「carrier」 is also this tree's word for the DOCUMENTS that carry the
// clause-② declaration (the card's claim comment; the PR body), and the clause
// sat one comma away from 「the clause-② declaration is …」. Read at landing
// time on a real pair it takes a careful reader as a denial that the two
// DECLARATIONS diverge -- a denial this gate has never been in a position to
// make: it reads the declaration from the CARD and has no reader for the PR
// body at all (`declarationFromPullRequest` lives in
// `scripts/check-changeset-no-major.mjs` and is never imported here). Two live
// pairs were measured in that state, each costing hand repair after landing.
//
// ⛔ The fix is the SENTENCE, not a join: naming one document authoritative, or
// teaching this gate to read the PR body and refuse on a disagreement, both
// need the ruling #16303 is still waiting for. Until it lands the line states
// what it COMPARED and says plainly what it did NOT read.
const LABEL_CARRIERS_AGREE =
  `and the \`${CONTRACT_REVIEW_LABEL}\` LABEL is in the same state on both LABEL carriers (this ` +
  'card and this PR)';

// Appended to the whole green line rather than folded into the clause above,
// so it survives whichever optional clauses follow it and lands as its own
// sentence. ⛔ It must never be phrased as a verdict ON the PR body: this run
// did not read that document, so it can report the non-read and nothing else.
const PR_BODY_NOT_READ =
  '⚠️ The clause above compares LABELS, ⛔ never two declarations: this run read the clause-② ' +
  'declaration from the CARD only and did NOT read the PR body, so a PR body declaring the ' +
  'opposite of this card is neither compared nor denied here (#16770).';

/**
 * The exit-0 line for one pair, built apart from `renderPair` so the self-test
 * pins the sentence the run actually prints rather than a copy of it.
 *
 * @param {{ pr: number, card: number, sibling?: boolean, corrected?: boolean,
 *   record?: boolean, wideningClean?: boolean }} parts
 * @returns {string}
 */
export function greenPairLine({ pr, card, sibling = false, corrected = false, record = false, wideningClean = false }) {
  return (
    `✓ check-clause2-carriers: PR #${pr} / card #${card} — the clause-② declaration is ` +
    (sibling
      ? 'readable in the fixed spelling on a SIBLING card this same PR delivers rather than on ' +
        `this card (the reading above names which, and what it says), ${LABEL_CARRIERS_AGREE}`
      : corrected
        ? 'readable in the fixed spelling on a CORRECTION comment superseding the claim\'s own line ' +
          '(the ℹ️ reading printed above on stderr names which comment, and states what that claim ' +
          'comment\'s own `created_at`/`updated_at` say about whether it was edited), ' + LABEL_CARRIERS_AGREE
        : `readable in the fixed spelling, ${LABEL_CARRIERS_AGREE}`) +
    (record
      ? ', and a review of record names this head (the note above says which comment it is, and ' +
        'whether this pair owes anything about it; existence, not the verdict)'
      : '') +
    (wideningClean
      ? ', and its diff carries no widening tell. ⚠️ A tell is not a proof and its absence is not one either.'
      : '.') +
    ` ${PR_BODY_NOT_READ}`
  );
}

function renderPair(pair, repo, pairs = null) {
  const gap = pairUnjudged(pair);
  if (gap) {
    console.error(`✗ check-clause2-carriers --pair: ${gap}`);
    return EXIT_INCOMPLETE;
  }
  const rows = pairRows(pair, pairs);
  // ⭐ A NOTE, not a finding: it prints in both branches below and raises no
  // exit code. ⛔ It is not silence — the reading is stated in full, on stderr
  // beside the rows, because a seat that reads only `$?` must still be able to
  // find out from the run WHY this pair answered 0 without a declaration of
  // its own (#16304).
  const notes = pairNotes(pair, pairs);
  const widening = pairWidening(pair, repo);
  const wideningRow = c5WideningTell(pair, repo);
  if (wideningRow) rows.push({ code: 'C5', text: wideningRow });
  const wideningGap = wideningUnjudged(pair, repo);
  // ⭐ The record read this path BUYS for a pair that owes none (#18174), and
  // its gap, kept beside C5's for the same reason: `pairUnjudged` accounts for
  // the reads a SWEEP makes, and these two are the landing check's own.
  const recordGap = locatedRecordUnjudged(pair);
  if (rows.length === 0) {
    if (wideningGap || recordGap) {
      for (const g of [recordGap, wideningGap]) {
        if (g) console.error(`✗ check-clause2-carriers --pair: ${g}`);
      }
      return EXIT_INCOMPLETE;
    }
    for (const note of notes) console.error(`ℹ️  ${note.code} — ${note.text}`);
    // Each note is keyed by its CODE, never by count: the sibling reading and
    // the review-of-record reading are two different facts about the pair, and
    // a second note kind must not put the first one's sentence in its mouth.
    const sibling = notes.some((n) => n.code === 'C2-SIBLING');
    const record = notes.some((n) => n.code === 'C6-RECORD');
    const corrected = notes.some((n) => n.code === 'C2-CORRECTION');
    console.log(greenPairLine({
      pr: pair.pr,
      card: pair.card,
      sibling,
      corrected,
      record,
      wideningClean: widening.state === 'clean',
    }));
    return EXIT_OK;
  }
  for (const row of rows) console.error(`✗ ${row.code} — ${row.text}`);
  for (const note of notes) console.error(`ℹ️  ${note.code} — ${note.text}`);
  // The file:line list, one per line, so an author can paste it into an editor.
  for (const line of refusalLines(widening)) console.error(`    ${line}`);
  // An adverse row OUTRANKS a gap -- a tell that WAS read is a fact about this
  // pair whatever else could not be read -- but the gap is still printed, or a
  // reader would take the rows below for the whole reading.
  if (recordGap) console.error(`⚠️  ${recordGap}`);
  if (wideningGap) console.error(`⚠️  ${wideningGap}`);
  console.error(
    `check-clause2-carriers: PR #${pair.pr} / card #${pair.card} is NOT clause-② legible ` +
      `(exit ${EXIT_PAIR_ADVERSE}). ⛔ This is a verdict about this pair, not about the environment.`,
  );
  return EXIT_PAIR_ADVERSE;
}

function reportTransportFailure(err, { swept }) {
  console.error(
    `check-clause2-carriers: PREREQUISITE NOT MET — ${err.message}. ${swept} pair(s) had been read ` +
      'when it failed, so this run is NOT a reading of a clean board. This file does not classify ' +
      'transport: run `node scripts/pm/check-half-states.mjs --probe`, which is the family\'s one ' +
      `classifier, and read its verdict. (Exit ${EXIT_PREREQUISITE_NOT_MET} — capture it BEFORE any ` +
      'pipe: `node scripts/pm/check-clause2-carriers.mjs > /tmp/c2.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// Self-test — offline, and the fixtures are the measured board
// ---------------------------------------------------------------------------

const CLAIM = (extra) => ({
  created_at: '2026-08-31T17:00:00Z',
  body: `Claim: PM loop round R1\nBranch: \`claude/issue-13476-unresolvable-engine-403\`\n${extra ?? ''}`,
});

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export async function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    cases.push({ name, ok: Boolean(ok), detail });
  };
  const says = (s, frag) => typeof s === 'string' && s.includes(frag);

  // -- the declaration reader: the fixed spelling, and everything that is not --
  battery('the declaration reader: the fixed spelling, and everything that is not');
  t('the two fixed spellings read as declarations', readClause2Line('Clause-②: yes')?.value === 'yes' && readClause2Line('Clause-②: no')?.value === 'no');
  t('a blockquoted claim line still reads (SKILL.md writes the claim as a blockquote)', readClause2Line('> Clause-②: no')?.value === 'no');
  t('a bulleted, bolded, backticked line still reads — decoration is markdown, not meaning', readClause2Line('- **`Clause-②`**: **`yes`**')?.value === 'yes');
  t('the PROSE form is NOT a declaration', readClause2Line('## Clause ②: **yes**')?.kind === 'near-miss');
  t('…and it is reported as a near miss so the row can quote it', says(readClause2Line('## Clause ②: **yes**')?.line, 'Clause ②'));
  t('an uppercase VALUE is malformed, not a yes', readClause2Line('Clause-②: YES')?.kind === 'malformed');
  t('a prose value on the key line is malformed, not a reading', readClause2Line('Clause-②: probably not')?.kind === 'malformed');
  t('an empty value is malformed', readClause2Line('Clause-②:')?.kind === 'malformed');
  // The #12297 control shape: the token, then the seat's reasoning. #13914
  // records that comment as CORRECT, so a reader that rejected it would grade
  // the card's own control as the defect (measured: it rejected four real
  // claims on the 2026-08-31 board before this case was written).
  t('the token followed by REASONING is a declaration — #13914\'s control shape', readClause2Line('Clause-②: yes — widens the accept set')?.value === 'yes');
  t('…including the bold-wrapped, parenthesised form seats actually write', readClause2Line('**Clause-②: no**(仅移动 import/注释)')?.value === 'no');
  t('⛔ but a word merely STARTING with the token is not the token', readClause2Line('Clause-②: nope')?.kind === 'malformed' && readClause2Line('Clause-②: not applicable')?.kind === 'malformed');
  t('the closed set is read from CLAUSE2_VALUES, so a third reading needs an edit there', CLAUSE2_VALUES.length === 2 && CLAUSE2_VALUES.every((v) => readClause2Line(`Clause-②: ${v}`)?.value === v));
  // -- the DIRECTION ARM (#16421) — both arms, both directions -----------------
  //
  // ⭐ Both directions are pinned for each arm, because one direction alone
  // cannot tell a reading from a constant: `narrowing` must READ, and `widening`
  // must NOT read as a narrowing — a gate that classified both as breaking would
  // pass an arm test that only ever asked "did something come back?".
  t('ARM: `no (narrowing)` reads the arm — the shape the whole card exists for', readClause2Line('Clause-②: no (narrowing)')?.arm === 'narrowing');
  t('ARM: `yes (widening)` reads the OTHER arm, and is not a narrowing', readClause2Line('Clause-②: yes (widening)')?.arm === 'widening');
  t('ARM: `yes (narrowing)` — a diff may widen one surface and narrow another', readClause2Line('Clause-②: yes (narrowing)')?.value === 'yes' && readClause2Line('Clause-②: yes (narrowing)')?.arm === 'narrowing');
  t('ARM: ⛔ `no (widening)` CONTRADICTS itself and is malformed, never a silent pick', readClause2Line('Clause-②: no (widening)')?.kind === 'malformed');
  t('ARM: a near-arm spelling is malformed, ⛔ never an absent arm — that direction fails OPEN', ['(narrowed)', '(Narrowing)', '(widen)', '(narrowings)'].every((p) => readClause2Line(`Clause-②: no ${p}`)?.kind === 'malformed'));
  t('ARM: the unfilled template `(widening|narrowing)` is a MENU, not a choice', readClause2Line('Clause-②: no (widening|narrowing)')?.kind === 'malformed');
  t('ARM: decoration closes AFTER the value, so the taught spelling still carries an arm', readClause2Line('- **`Clause-②`**: **`no`** (narrowing)')?.arm === 'narrowing');
  t('ARM: the arm keeps its reasoning, the same calibration the value has', readClause2Line('Clause-②: no (narrowing — the IANA zone domain)')?.arm === 'narrowing');
  t('ARM: the closed pair is read from CLAUSE2_ARMS, so a third arm needs an edit there', CLAUSE2_ARMS.length === 2 && CLAUSE2_ARMS.every((a) => readClause2Line(`Clause-②: yes (${a})`)?.arm === a));
  // ⛔ CONTROLS. The arm is OPTIONAL and every declaration on the board the day
  // this landed had none; if these flip, five in-flight PRs lost their reading.
  t('⛔ CONTROL: the two bare spellings are byte-identical reads carrying NO arm', CLAUSE2_VALUES.every((v) => readClause2Line(`Clause-②: ${v}`)?.value === v && readClause2Line(`Clause-②: ${v}`)?.arm === null));
  t('⛔ CONTROL: an ordinary parenthetical is reasoning, not a malformed arm', readClause2Line('Clause-②: no (nothing published moves)')?.value === 'no' && readClause2Line('Clause-②: no (nothing published moves)')?.arm === null);
  t('⛔ CONTROL: #18268\'s live em-dash reasoning still reads `no` with no arm', readClause2Line('Clause-②: no — this diff adds an optional field (`CloudConfig`) and a flag fallback.')?.value === 'no');
  t('a very long claim line is quoted back CAPPED, so one row cannot swamp the report', (readClause2Line(`Clause-②: maybe ${'x'.repeat(400)}`)?.line ?? '').length < 200);
  t('a card that never mentions the clause reads null', readClause2Line('Claim: whatever\nBranch: x') === null);
  t('⛔ the reader never invents a value from an adjacent word', readClause2Line('this card is clause 2 yes in substance')?.kind !== 'declared');
  // The inline-key near miss. Each case below pins ONE line and says only what
  // that line shows: the measured shape is `Domain: … · Clause-②: no`, which is
  // how a compact claim header is written and which reached NEITHER pattern.
  t('this exact shared-line header — `Domain: `domain:cli` · Clause-②: no` — is reported as a near miss', readClause2Line('Domain: `domain:cli` · Clause-②: no')?.kind === 'near-miss');
  t('…reasoned INLINE-KEY, so the row that quotes it can name placement instead of spelling', readClause2Line('Domain: `domain:cli` · Clause-②: no')?.reason === 'inline-key');
  t('…and ⛔ NOT read as a declaration: this line is exactly as unread as it was before', readClause2Line('Domain: `domain:cli` · Clause-②: no')?.kind !== 'declared');
  t('…and the row quotes THAT line, not the key alone', says(readClause2Line('Domain: `domain:cli` · Clause-②: no')?.line, 'Domain:'));
  // ⛔ The reporter fires only where the key is NOT at the start of a line. The
  // key-INITIAL direction is a different card's (#17098) and is not moved here;
  // this pins the property of THIS change — a key-initial line never reaches the
  // inline-key reason — rather than pinning what that direction currently reads.
  t('⛔ a key-INITIAL line is never reasoned inline-key — decoration before the key is not placement', readClause2Line('## Clause-②: yes')?.reason === 'spelling');
  t('…nor is a bulleted, blockquoted or backticked key: `> - `Clause-②` : yes` still reads DECLARED, untouched', readClause2Line('> - `Clause-②` : yes')?.kind === 'declared');
  t('⛔ a mid-line mention with NO colon is not the inline shape — the reporter looks for the key AND its colon', readClause2Line('Domain: x · Clause-② is not touched here') === null);
  t('the inline-key residue wins over a vocabulary near miss written ABOVE it — reading order is not a fact about the remedy', readClause2Line('## Clause ②: **yes**\nDomain: x · Clause-②: no')?.reason === 'inline-key');

  // -- the card-level declaration: every state, none collapsed into another --
  battery('the card-level declaration: every state, none collapsed into another');
  t('a claim comment carrying the line reads DECLARED', cardDeclaration([CLAIM('Clause-②: no')]).state === 'declared');
  t('…and keeps the value', cardDeclaration([CLAIM('Clause-②: yes')]).value === 'yes');
  t('a thread with no claim comment at all reads ABSENT — no carrier, so no line could be read', cardDeclaration([{ body: 'a triage note, and nothing that begins a line with the claim key', created_at: '2026-08-31T10:00:00Z' }]).state === 'absent');
  // The claim predicate is a LINE BEGINNING `Claim:`, and that one spelling is
  // the whole set. A heading-style claim carries no such line, so the thread
  // has no claim carrier at all and what it owes is the comment, not the line.
  t('a heading-style claim is NOT a claim comment — the thread reads ABSENT, not missing-a-line', cardDeclaration([{ body: '## Claim — PM loop round R1\nBranch: `claude/issue-13476-unresolvable-engine-403`\nDomain: `domain:engine`', created_at: '2026-08-31T10:00:00Z' }]).state === 'absent');
  t('the #13910 shape — a claim comment with no Clause-② line — reads MISSING: the carrier is there, the line is not', cardDeclaration([CLAIM('Domain: `domain:engine`')]).state === 'missing');
  t('⛔ ABSENT and MISSING are two readings, never one — one owes a comment, the other a line', cardDeclaration([{ body: 'a triage note, and nothing that begins a line with the claim key', created_at: '2026-08-31T10:00:00Z' }]).state !== cardDeclaration([CLAIM('Domain: x')]).state);
  // A claim comment that DESCRIBES the declaration rather than making one.
  //
  // ⚠️ This assertion states a GENERAL property and for a long time had ONE
  // case under it — prose before the key, which the line-anchored reader never
  // matched at all. #17098 measured the other half: with the key FIRST, after
  // markdown decoration, the same describing line read `declared`, so the
  // sentence was false in general while its own case was green. ⛔ Both halves
  // are asserted here, at the sentence that claims them; the #17098 battery
  // below carries the mechanism, the measured specimens and the controls.
  t('a claim comment that only DESCRIBES the line reads MISSING, never declared', cardDeclaration([CLAIM('the dev declares `Clause-②: yes|no` from the diff')]).state === 'missing');
  t('…and it carries no value — a fragment inside prose is not a reading of one', cardDeclaration([CLAIM('the dev declares `Clause-②: yes|no` from the diff')]).value === undefined);
  t('⭐ …and the same is true KEY-FIRST, which is the half this sentence used to claim without covering', cardDeclaration([CLAIM('- **`Clause-②: yes` / `Clause-②: no`** — the value alone on its line, machine-read.')]).state === 'missing');
  t('⭐ …carrying no value there either — the fail-OPEN half, where a `yes` was invented out of a spelling lesson', cardDeclaration([CLAIM('- **`Clause-②: yes` / `Clause-②: no`** — the value alone on its line, machine-read.')]).value === undefined);
  t('⛔ neither not-read state is `no`', cardDeclaration([CLAIM('Domain: x')]).state !== 'declared' && cardDeclaration([{ body: 'a triage note, and nothing that begins a line with the claim key', created_at: '2026-08-31T10:00:00Z' }]).state !== 'declared');
  t('the line in a NON-claim comment reads MISPLACED, not absent and not declared', cardDeclaration([CLAIM('Domain: x'), { body: 'Clause-②: yes', created_at: '2026-08-31T11:00:00Z' }]).state === 'misplaced');
  t('a malformed line in the claim comment reads MALFORMED', cardDeclaration([CLAIM('Clause-②: Yes')]).state === 'malformed');
  t('an UNREADABLE thread reads unreadable — never absent (#4690)', cardDeclaration(null).state === 'unreadable');
  t('the most recent claim governs — a re-claimed card is judged on the live claim', cardDeclaration([
    { created_at: '2026-08-30T09:00:00Z', body: 'Claim: old\nBranch: `claude/issue-13476-old`\nClause-②: yes' },
    { created_at: '2026-08-31T09:00:00Z', body: 'Claim: new\nBranch: `claude/issue-13476-new`\nClause-②: no' },
  ]).value === 'no');

  // -- C1, replaying the 2026-08-31 measured table ---------------------------
  battery('C1, replaying the 2026-08-31 measured table');
  const L = CONTRACT_REVIEW_LABEL;
  const pair = (o) => ({ pr: 13910, card: 13476, draft: true, prLabels: [], cardLabels: [], cardComments: [CLAIM('Clause-②: no')], ...o });
  // The seven pairs the filing cards tabulated, at the moment a human looked.
  const BOARD = [
    { pr: 13870, card: 13576, prLabels: [L], cardLabels: [L] },        // in sync
    { pr: 13834, card: 13651, prLabels: [L], cardLabels: [L] },        // in sync
    { pr: 13829, card: 13578, prLabels: [L], cardLabels: [] },         // card missing
    { pr: 13857, card: 13608, prLabels: [L], cardLabels: [] },         // card missing
    { pr: 13864, card: 13657, prLabels: [L], cardLabels: [] },         // card missing
    { pr: 13910, card: 13476, prLabels: [], cardLabels: [L] },         // PR missing — the fail-open
    { pr: 13923, card: 13762, prLabels: [L], cardLabels: [] },         // card missing (the 7th, minted later)
  ].map((p) => pair(p));
  const split = BOARD.map((p) => c1CarrierSplit(p));
  t('replaying the measured board flags exactly the 5 desynced pairs', split.filter(Boolean).length === 5, JSON.stringify(split.map(Boolean)));
  t('…and stays silent on the 2 pairs that were in sync', split[0] === null && split[1] === null);
  t('…naming the PR on the card-side-missing direction', says(split[2], '#13829') && says(split[2], '#13578'));
  t('…and stating the consequence of the PR-bare direction on its own terms', says(split[5], 'nothing on the PR itself says a review is outstanding'));
  t('…and the card-bare direction on its own', says(split[2], 'invisible to the queue'));
  t('⛔ neither direction is ranked — the two standing sources rank them oppositely', says(split[2], 'ranks neither') && says(split[5], 'ranks neither'));
  t('…and the row names both readings so the disagreement is visible, not resolved by fiat', says(split[5], 'H31 calls the card-bare direction') && says(split[5], '#13922 calls the'));
  t('a pair gated on neither carrier is NOT a split — agreement on absence is C1\'s silent case', c1CarrierSplit(pair({ prLabels: [], cardLabels: [] })) === null);
  t('an unreadable carrier never manufactures a split', c1CarrierSplit(pair({ prLabels: null, cardLabels: [L] })) === null);
  t('C1 states the dual-carrier rule it is asserting', says(split[5], '两边都挂好'));
  t('C1 says a strip and a never-hung gate are indistinguishable without the second carrier', says(split[5], '被剥'));
  t('C1 never prescribes a write from this script', says(split[5], '自查放行'));

  // -- C2, the row this file exists for --------------------------------------
  battery('C2, the row this file exists for');
  const missingLine = c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Domain: x')] }));
  t('a card with no Clause-② line in its claim comment produces a C2 row', typeof missingLine === 'string');
  t('…and says NO READING in as many words', says(missingLine, 'NO READING'));
  t('…and names the DECLARATION LINE as the thing that is missing', says(missingLine, 'DECLARATION LINE is what is missing'));
  t('…and sends the remedy to the claim comment that is already there', says(missingLine, 'That claim comment owes the line'));
  // #17366: the remedy names WHO can act and HOW. The sentence it replaced
  // («add the line to that claim comment») named an act a seat holding only the
  // MCP tool set has no call for, which is the one-way door the card measured.
  t('⭐ …and the remedy names WHO can act', says(missingLine, 'WHO can act, and HOW: the CLAIMING SEAT'));
  t('⭐ …and states that an already-posted claim comment is not editable from every seat', says(missingLine, 'no edit-an-issue-comment call'));
  // ⚠️ This case used to read `says(missingLine, 'Clause-②-correction: 5642248126')`
  // — it PINNED a literal comment id belonging to card #17366 as the remedy's
  // content, on a row rendered for card #13476. The assertion was green for as
  // long as the defect held, which is how #17919's class survived a self-test
  // of 689 cases: a pin written from the thing it pins asserts nothing about
  // whether the thing is right. What is pinned now is the PROPERTY — the
  // remedy names the correction comment's key, and any id it names is one read
  // off THIS card's thread.
  t('⭐ …and names the one comment that repairs it, first line and all', says(missingLine, 'Clause-②-correction:'));
  t('⛔ …carrying no id HERE, because this fixture\'s claim rows carry none — and ⛔ never a specimen id from another card (#17919)', says(missingLine, '5642248126') === false && says(missingLine, 'found no claim comment id on card #13476'));
  t('⛔ …while still forbidding a second `Claim:`', says(missingLine, 'Never a second `Claim:`'));
  const noClaim = c2DeclarationUnreadable(pair({ cardComments: [{ body: 'a triage note, and nothing that begins a line with the claim key', created_at: '2026-08-31T10:00:00Z' }] }));
  t('a thread with no claim comment produces a C2 row of its own', typeof noClaim === 'string');
  t('…and names the CLAIM COMMENT as the thing that is missing, not the line', says(noClaim, 'CLAIM COMMENT is what is missing'));
  t('…and its remedy names the fixed first-line spelling', says(noClaim, 'first line beginning `Claim:`'));
  t('…and names the heading-style claim as the shape that does not count', says(noClaim, '## Claim —'));
  t('the heading-style thread gets that same row — the shape the predicate never matched', c2DeclarationUnreadable(pair({ cardComments: [{ body: '## Claim — PM loop round R1\nBranch: `claude/issue-13476-unresolvable-engine-403`\nDomain: `domain:engine`', created_at: '2026-08-31T10:00:00Z' }] })) === noClaim);
  t('⛔ the two not-read rows are DIFFERENT sentences — one number over both describes neither', missingLine !== noClaim);
  t('…and both still say it is not a declared `no`', says(missingLine, 'NOT a declared') && says(noClaim, 'NOT a declared'));
  t('…and both refuse to have the line filled in on the seat\'s behalf', says(missingLine, 'Do not fill the line in') && says(noClaim, 'Do not fill the line in'));
  t('…and both forbid relaxing the spelling to prose', says(missingLine, 'do not relax the') && says(noClaim, 'do not relax the'));
  t('…and both quote the fixed spelling so the remedy is executable', says(missingLine, 'Clause-②: yes') && says(noClaim, 'Clause-②: yes'));
  // The summary line is what a round report quotes, so the two readings are
  // counted apart there too — from the same reader the rows use.
  const TALLY = [
    pair({ cardComments: [CLAIM('Clause-②: no')] }),
    pair({ cardComments: [CLAIM('Domain: x')] }),
    pair({ cardComments: [CLAIM('Domain: y')] }),
    pair({ cardComments: [{ body: 'a triage note, and nothing that begins a line with the claim key', created_at: '2026-08-31T10:00:00Z' }] }),
    pair({ cardComments: null }),
  ];
  t('the sweep counts the two not-read states separately', declarationLimbTally(TALLY).missing === 2 && declarationLimbTally(TALLY).absent === 1, JSON.stringify(declarationLimbTally(TALLY)));
  t('…and counts a DECLARED card into neither', declarationLimbTally([pair({ cardComments: [CLAIM('Clause-②: yes')] })]).absent === 0 && declarationLimbTally([pair({ cardComments: [CLAIM('Clause-②: yes')] })]).missing === 0);
  t('…and an UNREADABLE thread into neither — it is UNJUDGED, never a not-read declaration', declarationLimbTally([pair({ cardComments: null })]).absent === 0 && declarationLimbTally([pair({ cardComments: null })]).missing === 0);
  t('…and a MISPLACED declaration into neither — it has its own row and its own remedy', declarationLimbTally([pair({ cardComments: [CLAIM('Domain: x'), { body: 'Clause-②: yes', created_at: '2026-08-31T11:00:00Z' }] })]).missing === 0);
  const nearMiss = c2DeclarationUnreadable(pair({ cardComments: [CLAIM('## Clause ②: **yes**')] }));
  t('a prose declaration still produces the C2 row — prose is not a reading', typeof nearMiss === 'string');
  t('…and the row quotes what WAS there, so the residue is actionable', says(nearMiss, 'Clause ②'));
  // The inline-key row. The measured claim comment is a compact header — the
  // key correctly spelled, after another field, on a shared line.
  const INLINE = 'Domain: `domain:cli` · Clause-②: no';
  const inlineRow = c2DeclarationUnreadable(pair({ cardComments: [CLAIM(INLINE)] }));
  t('a claim comment whose only Clause-② key sits mid-line produces a C2 row', typeof inlineRow === 'string');
  t('…and that row names PLACEMENT as what is wrong', says(inlineRow, 'PLACEMENT of the key is what is wrong'));
  t('…and says in as many words that the spelling is NOT it', says(inlineRow, 'NOT its spelling') && says(inlineRow, 'no typo to find'));
  t('…and quotes the offending line, which is what makes the residue actionable', says(inlineRow, 'Domain: `domain:cli`'));
  t('…and its remedy is to put the line on one of its OWN, not to hunt a misspelling', says(inlineRow, 'line of its OWN'));
  t('⛔ it is a DIFFERENT sentence from the row a claim comment with no key at all gets', inlineRow !== missingLine);
  t('⛔ and the state behind it is still MISSING — the sentence moved, the accept set did not', cardDeclaration([CLAIM(INLINE)]).state === 'missing');
  t('⛔ …with no value read off that line', cardDeclaration([CLAIM(INLINE)]).value === undefined);
  t('⛔ and the sweep still counts it as one NOT-READ card, exactly as before', declarationLimbTally([pair({ cardComments: [CLAIM(INLINE)] })]).missing === 1);
  t('…and the row still carries the standing refusal to relax the spelling', says(inlineRow, 'do not relax the') && says(inlineRow, 'Do not fill the line in'));
  // A thread with no claim comment owes the COMMENT, so that remedy does not
  // change; what it gains is the quotation it never had.
  const inlineNoClaim = c2DeclarationUnreadable(pair({ cardComments: [{ body: INLINE, created_at: '2026-08-31T10:00:00Z' }] }));
  t('a NON-claim comment carrying the inline key still owes the CLAIM COMMENT', says(inlineNoClaim, 'CLAIM COMMENT is what is missing'));
  t('…and now quotes that line as the nearest thing on the thread', says(inlineNoClaim, 'Domain: `domain:cli`'));
  const misplaced = c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Domain: x'), { body: 'Clause-②: yes', created_at: '2026-08-31T11:00:00Z' }] }));
  t('a declaration outside the claim comment reads MISPLACED, with its own sentence', says(misplaced, 'MISPLACED'));
  t('…and says the thinking was done, only in the wrong carrier', says(misplaced, 'not in a place') || says(misplaced, 'place the predicate does not look'));
  t('a malformed value produces its own row rather than passing as `no`', says(c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Clause-②: Yes')] })), 'MALFORMED'));
  t('a correctly declared card produces NO C2 row', c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('an unreadable thread produces no C2 row — it is UNJUDGED instead, never clean', c2DeclarationUnreadable(pair({ cardComments: null })) === null);
  t('…and the unjudged accounting names the thread that could not be read', says(pairUnjudged(pair({ cardComments: null })), 'comment thread'));

  // -- #16304: the fourth reading — one PR, two cards -------------------------
  //
  // ★ The measured specimen — PR #16243 carried `Fixes #15542` and `Closes
  // #15854` on two separate lines, so `--pair 16243` derived two pairs and
  // exited 4 on the second. #15542 was claimed and declared `Clause-②: yes`
  // before any code was written; #15854 by its own maintainer ruling closes
  // when that PR lands, is never separately dispatched, never receives a claim
  // comment, and additionally carried `pm:retriage`, where a `Claim:` is a
  // dispatch act the PM protocol forbids. GitHub closed it one second after
  // the merge on the same relation, so the PAIR was right and the PLACE the
  // declaration was demanded from was not.
  //
  // ⭐ Every case below that begins ⛔ CONTROL is the other half: the shapes
  // that must keep the C2 row and exit 4, byte for byte, or this reading would
  // be the #13914 absence read as a declaration.
  battery('#16304: the fourth reading — one PR, two cards, and the controls that keep exit 4');
  const sibPair = (o) => ({ pr: 16243, card: 15854, draft: false, prLabels: [], cardLabels: [], cardComments: [], ...o });
  const RULING_ONLY = [{ body: 'Ruling: both halves are one `domain:spec` PR, and this card closes when that PR lands.', created_at: '2026-09-04T11:00:00Z' }];
  const DECLARING_SIBLING = sibPair({ card: 15542, cardComments: [CLAIM('Clause-②: yes')] });
  const SUBJECT = sibPair({ cardComments: RULING_ONLY });
  const SET = [DECLARING_SIBLING, SUBJECT];

  t('the sibling this same PR delivers is found, with the value from its own claim', JSON.stringify(siblingDeclarations(SUBJECT, SET).map((s) => [s.card, s.value])) === '[[15542,"yes"]]', JSON.stringify(siblingDeclarations(SUBJECT, SET)));
  t('⛔ a card is never its own sibling', siblingDeclarations(DECLARING_SIBLING, SET).every((s) => s.card !== 15542));
  t('⛔ a card delivered by a DIFFERENT PR is not a sibling', siblingDeclarations(SUBJECT, [{ ...DECLARING_SIBLING, pr: 99999 }, SUBJECT]).length === 0);
  t('⛔ a sibling whose claim carries no declaration is not a carrier', siblingDeclarations(SUBJECT, [sibPair({ card: 15542, cardComments: [CLAIM('Domain: x')] }), SUBJECT]).length === 0);
  t('⛔ a sibling whose declaration is PROSE is not a carrier — ⛔ the spelling is NOT relaxed here', siblingDeclarations(SUBJECT, [sibPair({ card: 15542, cardComments: [CLAIM('## Clause ②: **yes**')] }), SUBJECT]).length === 0);
  t('⛔ a sibling whose value is MALFORMED is not a carrier', siblingDeclarations(SUBJECT, [sibPair({ card: 15542, cardComments: [CLAIM('Clause-②: Yes')] }), SUBJECT]).length === 0);
  t('⛔ a sibling whose declaration is MISPLACED is not a carrier — the claim comment is the carrier there too', siblingDeclarations(SUBJECT, [sibPair({ card: 15542, cardComments: [CLAIM('Domain: x'), { body: 'Clause-②: yes', created_at: '2026-09-05T10:00:00Z' }] }), SUBJECT]).length === 0);
  t('⛔ a sibling whose thread could not be READ is not a carrier (#4690)', siblingDeclarations(SUBJECT, [sibPair({ card: 15542, cardComments: null }), SUBJECT]).length === 0);

  t('the reading fires on the measured #16243 shape', readsSiblingDeclaration(SUBJECT, SET) === true);
  const dispatchedSubject = sibPair({ cardComments: [CLAIM('Domain: `domain:spec`')] });
  t('⛔ CONTROL — a DISPATCHED card (claim comment, no line) reads MISSING, not absent, and is NOT covered: the #13914 guard', readsSiblingDeclaration(dispatchedSubject, [DECLARING_SIBLING, dispatchedSubject]) === false);
  t('⛔ CONTROL — a MALFORMED line on the subject is not covered either — a seat DID read that card', readsSiblingDeclaration(sibPair({ cardComments: [CLAIM('Clause-②: Yes')] }), SET) === false);
  t('⛔ CONTROL — nor a MISPLACED one: it has its own row and its own reachable remedy', readsSiblingDeclaration(sibPair({ cardComments: [CLAIM('Domain: x'), { body: 'Clause-②: no', created_at: '2026-09-05T10:00:00Z' }] }), SET) === false);
  t('⛔ CONTROL — a PR delivering exactly ONE card has no sibling to read', readsSiblingDeclaration(SUBJECT, [SUBJECT]) === false);
  t('⛔ CONTROL — a caller that passes no delivery set gets the pre-#16304 reading: fail-closed', readsSiblingDeclaration(SUBJECT, null) === false);

  t('the C2 FINDING row is suppressed in the fourth reading\'s shape', pairRows(SUBJECT, SET).every((r) => r.code !== 'C2'), JSON.stringify(pairRows(SUBJECT, SET).map((r) => r.code)));
  t('…and the reading is a NOTE instead, under a code of its own', pairNotes(SUBJECT, SET).map((n) => n.code).join() === 'C2-SIBLING');
  t('⛔ CONTROL — with no declaring sibling the C2 row comes straight back', pairRows(SUBJECT, [SUBJECT]).some((r) => r.code === 'C2'));
  t('⛔ CONTROL — …and it is BYTE-IDENTICAL to the row this file printed before #16304', pairRows(SUBJECT, [SUBJECT]).find((r) => r.code === 'C2')?.text === c2DeclarationUnreadable(SUBJECT));
  t('⛔ CONTROL — …and that shape produces no note at all', pairNotes(SUBJECT, [SUBJECT]).length === 0);

  const sibRow = c2SiblingDeclared(SUBJECT, SET);
  t('the note names the card it is about', says(sibRow, 'card #15854'));
  t('…and the delivering PR', says(sibRow, 'PR #16243'));
  t('…and the sibling card that carries the declaration', says(sibRow, 'card #15542 declares'));
  t('…and the VALUE read from that sibling\'s own claim', says(sibRow, '`Clause-②: yes`'));
  t('…and quotes the line it read, so the reading is checkable without a second run', says(sibRow, '"Clause-②: yes"'));
  t('…and says in as many words that nothing is owed on this card', says(sibRow, 'nothing is owed on this card'));
  t('…and asserts a LOCATION, never a substitution', says(sibRow, 'never moves it onto this card'));
  t('…and names what a reader must still verify for themselves', says(sibRow, 'must still verify'));
  t('…and keeps the ⛔ against filling the line in on the claiming seat\'s behalf', says(sibRow, 'writing the declaration on the claiming'));
  t('…and states, in the row itself, the control that keeps exit 4 reachable', says(sibRow, 'still gets the C2 row and exit 4'));
  t('…and still writes no label', says(sibRow, '自查放行'));

  const OTHER_SIBLING = sibPair({ card: 15999, cardComments: [CLAIM('Clause-②: no')] });
  const bothRow = c2SiblingDeclared(SUBJECT, [DECLARING_SIBLING, OTHER_SIBLING, SUBJECT]);
  t('two siblings that DISAGREE are both named — the row quotes neither away', says(bothRow, '#15542 declares `Clause-②: yes`') && says(bothRow, '#15999 declares `Clause-②: no`'));
  t('…and the disagreement is STATED rather than resolved by fiat', says(bothRow, 'do NOT agree with each other'));
  t('…while agreeing siblings say nothing about a disagreement', !says(sibRow, 'do NOT agree'));

  t('the sweep counts the fourth reading APART from the two owings', JSON.stringify(declarationLimbTally(SET)) === JSON.stringify({ absent: 0, missing: 0, sibling: 1 }), JSON.stringify(declarationLimbTally(SET)));
  t('⛔ CONTROL — the same card with no declaring sibling is still counted ABSENT, and still owes a claim comment', declarationLimbTally([SUBJECT]).absent === 1 && declarationLimbTally([SUBJECT]).sibling === 0);

  const pr16243 = { number: 16243, draft: false, labels: [], body: 'Fixes #15542\nCloses #15854\n', head: { ref: 'claude/issue-15542-additive-key' } };
  const derived16243 = derivePairs([pr16243], [15542, 15854]);
  t('#16304 specimen: the two-card PR still derives BOTH pairs — ⛔ `prDeliversCard` is NOT narrowed', derived16243.length === 2, JSON.stringify(derived16243.map((p) => p.card)));
  t('…and both are graded as the strong closing-keyword channel, as GitHub itself read them', derived16243.every((p) => p.evidence === 'closing-keyword'));
  // ⛔ The #13914 shape itself — one card, one PR, no claim comment. It cannot
  // reach this reading, because there is no second card to read from.
  const solo13914 = derivePairs([{ number: 13910, draft: true, labels: [], body: 'Fixes #13476\n', head: { ref: 'claude/issue-13476-x' } }], [13476])
    .map((p) => ({ ...p, prLabels: [], cardLabels: [], cardComments: [] }));
  t('⛔ CONTROL — the #13914 shape keeps its C2 row: one card and one PR has no sibling to read', pairRows(solo13914[0], solo13914).some((r) => r.code === 'C2'));
  t('⛔ CONTROL — …and no note is manufactured for it', pairNotes(solo13914[0], solo13914).length === 0);

  // -- C3, the direction a carrier comparison cannot see ----------------------
  battery('C3, the direction a carrier comparison cannot see');
  // A declared `yes`, bare on both carriers — C3's candidate shape. The event
  // stream is what says WHICH of the four states this is.
  const declaredYes = (o) => pair({ prLabels: [], cardLabels: [], cardComments: [CLAIM('Clause-②: yes')], ...o });
  const EV = (verb, at, actor = 'os-support-ai') => ({
    event: verb,
    created_at: at,
    label: { name: CONTRACT_REVIEW_LABEL },
    actor: { login: actor },
  });
  // The 2026-09-01 measurement (#14155), verbatim: PR #13864 / card #13657.
  const CARD_HUNG = EV('labeled', '2026-08-31T16:55:54Z', 'os-warren');
  const CARD_CLEARED = EV('unlabeled', '2026-09-01T08:54:47Z');
  const PR_HUNG = EV('labeled', '2026-08-31T15:19:53Z', 'claude[bot]');
  const PR_CLEARED = EV('unlabeled', '2026-09-01T08:54:56Z');
  const HEAD_AT_PASS = '2026-09-01T08:16:59Z'; // head 9af92aa3, the tree the review judged.

  const neverHung = declaredYes({ cardEvents: [], prEvents: [] });
  const ungated = c3DeclaredYesUngated(neverHung);
  t('a declared `yes` the events show was NEVER HUNG still produces a C3 row', typeof ungated === 'string');
  t('…and says why a carrier comparison cannot see it', says(ungated, 'agreement on ABSENCE'));
  t('…and says in as many words that the gate was never bound', says(ungated, 'NEVER HUNG'));
  t('a declared `no` with no gate anywhere is NOT a C3 row — that is a decision', c3DeclaredYesUngated(pair({ cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('a declared `yes` WITH the gate hung is not a C3 row', c3DeclaredYesUngated(pair({ prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')] })) === null);
  t('an ABSENT declaration is not a C3 row — C2 owns that fact, and no row owns it twice', c3DeclaredYesUngated(pair({ cardComments: [CLAIM('Domain: x')] })) === null);
  t('an unreadable carrier never manufactures a C3 row', c3DeclaredYesUngated(pair({ cardLabels: null, cardComments: [CLAIM('Clause-②: yes')] })) === null);

  // -- #14155: the COMPLETED state, and the three it must stay distinct from --
  battery('#14155: the COMPLETED state, and the three it must stay distinct from');
  const HEAD_9AF9 = '9af92aa3'; // the head the 2026-09-01 review judged, as the board abbreviated it.
  const RECORD_SESSION = 'session_01489YWhZEoHT9oXshiyywQy';
  // The review of record, in the shape measured on every 2026-09-09 specimen:
  // the `## Contract review` heading, the head as a code span, the independence
  // pair -- the shape #17302 names, and #18536 keys by lane.
  //
  // ⭐ The `Implemented-by:` value carries its token FIRST after the colon, and
  // that is load-bearing rather than tidy (#17346): this fixture is the pair
  // that must read CLEAN under EVERY row, and C4's grammar has always required
  // the identity to open the value. Written `branch \`claude/…\`` -- the way two
  // of the four live specimens write it -- the same comment reads `malformed`
  // on C4 the moment C4 can see this dialect at all, which is a real carrier
  // defect and belongs on a defective specimen (the `ADOPTION` fixture below
  // keeps it), never on the reference one.
  // ⭐ The `Served-tier:` line is part of the reference shape since #17915, for
  // the same reason the independence pair is: this fixture is the pair that
  // must read CLEAN under EVERY row, and a record that declares nothing about
  // what served it is refused by C7 -- 「无此行不成裁决」. Its token is the
  // constant's NAME, ⛔ never its value and never a spelled model id (#18060):
  // a record is a GitHub comment, the tier keeps exactly one value site in this
  // tree, and a fixture is not a second one.
  const RECORD = (
    sha,
    lines = [
      '- **Implemented-by:** `claude/issue-13657-x`',
      `- **Reviewed-by:** \`${RECORD_SESSION}\``,
      `- **Served-tier:** 121/121 \`${CONTRACT_REVIEW_TIER_NAME}\``,
    ],
    at = '2026-09-01T08:50:00Z',
    id = 3301,
  ) => ({
    id,
    created_at: at,
    body: [`## Contract review (clause ②) — **PASS** · head \`${sha}\``, '', ...lines, '', '### ① Derived judgments', '- none', '### ② semver', '- patch', '### ③ Boundary flags', '- none'].join('\n'),
  });
  const RECORD_ON_9AF9 = RECORD(HEAD_9AF9);
  const completed = declaredYes({
    pr: 13864,
    card: 13657,
    headSha: HEAD_9AF9,
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: HEAD_AT_PASS,
    prComments: [RECORD_ON_9AF9], // #17302: the completed state now also carries its record.
  });
  t('⭐ the measured 2026-09-01 clear (#13864/#13657) produces NO C3 row — the completed state is clean', c3DeclaredYesUngated(completed) === null, JSON.stringify(gateBindingState(completed)));
  t('…and the pair is CLEAN overall, not merely C3-silent', pairRows(completed).length === 0 && pairUnjudged(completed) === null);
  t('…and the disposition names it `completed`, anchored on the earlier removal', gateBindingState(completed).state === 'completed' && gateBindingState(completed).clearedAt === '2026-09-01T08:54:47Z');
  t('…which is exactly what the landing check\'s ② could never answer before', gateBindingState(completed).state !== 'never-hung');

  const movedAfter = declaredYes({
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: '2026-09-01T10:30:00Z', // a commit landed AFTER the clear.
  });
  const movedRow = c3DeclaredYesUngated(movedAfter);
  t('a cleared gate whose head MOVED afterwards is adverse, not clean', typeof movedRow === 'string');
  t('…and is named as the 重挂-owed state the recovery rule already carries', says(movedRow, '重挂') && says(movedRow, 'head 后移'));
  t('…and quotes both dates, so the reader can check the ordering', says(movedRow, '2026-09-01T10:30:00Z') && says(movedRow, '2026-09-01T08:54:47Z'));
  t('…and the re-hang is never performed from here', says(movedRow, '自查放行'));
  t('the head-motion comparison is against the EARLIER removal — motion after the first clear counts', gateBindingState(declaredYes({
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: '2026-09-01T08:54:50Z', // between the two removals.
  })).state === 'moved-after-clear');

  const halfBound = declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [] });
  const halfRow = c3DeclaredYesUngated(halfBound);
  t('a gate bound on ONE carrier only is adverse — one removal where a clear leaves two', typeof halfRow === 'string');
  t('…and names the strip signature the dual-carrier rule already states', says(halfRow, 'strip signature') && says(halfRow, '两边都挂好'));
  t('…and points at H35 rather than re-judging the windowed repo-wide form', says(halfRow, 'H35'));
  t('…in both directions', gateBindingState(declaredYes({ cardEvents: [], prEvents: [PR_HUNG, PR_CLEARED] })).bound === 'pr');

  t('an UNREADABLE stream is never a never-hung gate — it is UNJUDGED (#4690)', c3DeclaredYesUngated(declaredYes({ cardEvents: null, prEvents: [] })) === null);
  t('…and the unjudged accounting names the stream that could not be read', says(pairUnjudged(declaredYes({ cardEvents: null, prEvents: [] })), 'label event stream'));
  t('…so an unread stream can never render as a clean pair', pairUnjudged(declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: null })) !== null);
  t('a cleared pair whose HEAD COMMIT could not be read is UNJUDGED, not clean', says(pairUnjudged(declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [PR_HUNG, PR_CLEARED], headCommittedAt: null })), 'head commit date'));
  t('labels bare but the stream ending on a HANG is a disagreement, reported not resolved', says(c3DeclaredYesUngated(declaredYes({ cardEvents: [CARD_HUNG], prEvents: [PR_HUNG, PR_CLEARED] })), 'the labels say bare, the events say hung'));

  // -- the event reader itself ------------------------------------------------
  battery('the event reader itself');
  t('an empty stream reads NEVER HUNG — readable, and nothing was hung', carrierGateHistory([]).state === 'never-hung');
  t('a null stream reads UNREADABLE — the distinction the whole row turns on', carrierGateHistory(null).state === 'unreadable');
  t('the LAST event decides, and the reader sorts rather than trusting arrival order', carrierGateHistory([CARD_CLEARED, CARD_HUNG]).state === 'cleared' && carrierGateHistory([CARD_HUNG, CARD_CLEARED]).state === 'cleared');
  t('…so a newest-first page cannot invert the verdict', carrierGateHistory([CARD_CLEARED, CARD_HUNG]).at === CARD_CLEARED.created_at);
  t('a re-hung gate reads HUNG, not cleared', carrierGateHistory([CARD_HUNG, CARD_CLEARED, EV('labeled', '2026-09-01T09:30:00Z')]).state === 'hung');
  t('⛔ events for OTHER labels are not the gate\'s history', carrierGateHistory([{ event: 'labeled', created_at: '2026-08-31T08:00:18Z', label: { name: 'priority:p1' } }]).state === 'never-hung');
  t('⛔ non-label events are ignored', carrierGateHistory([{ event: 'ready_for_review', created_at: '2026-08-31T08:00:18Z' }]).state === 'never-hung');
  t('⛔ an UNDATED gate event refuses the whole reading — dropping it could move the last event', carrierGateHistory([CARD_HUNG, { event: 'unlabeled', created_at: null, label: { name: CONTRACT_REVIEW_LABEL } }]).state === 'unreadable');
  t('the gate label is the sibling\'s constant, not a second spelling', carrierGateHistory([EV('labeled', '2026-08-31T16:55:54Z')]).state === 'hung');

  // -- the cost bound, stated as one predicate both sides read ---------------
  battery('the cost bound, stated as one predicate both sides read');
  t('a declared `no` owes NO event stream — the cost bound', needsGateHistory(pair({ cardComments: [CLAIM('Clause-②: no')] })) === false);
  t('a pair still carrying the gate owes none either', needsGateHistory(pair({ prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')] })) === false);
  t('an ABSENT declaration owes none — C2 already owns that pair', needsGateHistory(pair({ cardComments: [CLAIM('Domain: x')] })) === false);
  t('only the C3 candidate shape owes one', needsGateHistory(declaredYes({})) === true);
  t('…and a pair that owes nothing is never UNJUDGED for a stream it was never going to be asked for', pairUnjudged(pair({ cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('the page cap exists, because the stream arrives OLDEST FIRST and a short read loses the removal', Number.isInteger(EVENT_PAGE_CAP) && EVENT_PAGE_CAP > 0);

  // -- C4: the independence clause's carrier (maintainer 2026-09-01 「同意 A」) --
  battery('C4: the independence clause\'s carrier (maintainer 2026-09-01 「同意 A」)');
  // The fixtures are the measured verdict shape, not an invented one: the live
  // verdicts open a fenced block whose first line is `VERDICT: PASS`, with
  // `REVIEWED-HEAD:` beside it, and the session IDs are the two real ones from
  // the round that filed this row — the seat that wrote the diff, and the
  // independently summoned seat that re-reviewed it.
  const IMPL_SESSION = 'session_015adLit3ZYASJiXwxKG78Wi';
  const REVIEW_SESSION = 'session_01489YWhZEoHT9oXshiyywQy';
  const VERDICT = (pairLines, at = '2026-09-01T11:21:18Z') => ({
    created_at: at,
    body: ['契约复审(总监席)', '', '```', 'VERDICT: PASS', 'REVIEWED-HEAD: a16839529 (PR #14191)', ...pairLines, 'FINDINGS: 无阻断。', '```'].join('\n'),
  });
  const SELF_PAIR = [`Implemented-by: \`${IMPL_SESSION}\``, `Reviewed-by: \`${IMPL_SESSION}\``];
  const INDEPENDENT_PAIR = [`Implemented-by: \`${IMPL_SESSION}\``, `Reviewed-by: \`${REVIEW_SESSION}\``];
  // A declared `no` deliberately: C4 is independent of the declaration limb, and
  // this base isolates it from C3's candidate shape so an event-stream gap
  // cannot stand in for the accounting under test. The `yes` direction is pinned
  // by the reporting-order case at the end of this section.
  const reviewed = (rows) => pair({ cardComments: [CLAIM('Clause-②: no'), ...rows] });

  // the discriminator, and the near miss the same board supplies
  t('a fenced `VERDICT:` line makes a comment a verdict — the measured shape', readVerdictAuthorship(VERDICT(SELF_PAIR).body)?.kind === 'pair');
  t('⛔ the WORD alone is not the discriminator: a build log writing `VERDICT command-exit 0` is not a verdict', readVerdictAuthorship('`VERDICT command-exit 0`, **71/71 tasks successful**, zero tracked-file churn afterwards.') === null);
  t('…nor is the same phrase introduced by prose', readVerdictAuthorship('all `VERDICT command-exit 0`:') === null);
  t('⛔ the two lines OUTSIDE a verdict comment are not a verdict — a claim carrying them reads null', readVerdictAuthorship(`Claim: x\nImplemented-by: \`${IMPL_SESSION}\`\nReviewed-by: \`${REVIEW_SESSION}\``) === null);

  // the four mandated states of one verdict
  t('a SAME-session pair reads as a pair, with both IDs kept', readVerdictAuthorship(VERDICT(SELF_PAIR).body)?.implementedBy === IMPL_SESSION && readVerdictAuthorship(VERDICT(SELF_PAIR).body)?.reviewedBy === IMPL_SESSION);
  t('a DISTINCT-session pair reads as a pair too — the comparison is the row\'s job, not the reader\'s', readVerdictAuthorship(VERDICT(INDEPENDENT_PAIR).body)?.reviewedBy === REVIEW_SESSION);
  t('⭐ a LEGACY verdict carrying neither line reads `legacy`, never malformed', readVerdictAuthorship(VERDICT([]).body)?.kind === 'legacy');
  t('ONE line alone is MALFORMED — half a pair compares to nothing', readVerdictAuthorship(VERDICT([`Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.kind === 'malformed');
  t('…and the row can say WHICH line is missing', says(readVerdictAuthorship(VERDICT([`Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.detail, 'Implemented-by'));
  t('a key with no readable session ID is MALFORMED, not a reading', readVerdictAuthorship(VERDICT(['Implemented-by: the dispatching seat', `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.kind === 'malformed');
  t('…and says so rather than blaming the absent line', says(readVerdictAuthorship(VERDICT(['Implemented-by: the dispatching seat', `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.detail, 'no readable identity'));
  t('…naming BOTH identities that key admits, so the remedy is executable for either dev backend', says(readVerdictAuthorship(VERDICT(['Implemented-by: the dispatching seat', `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.detail, 'session id') && says(readVerdictAuthorship(VERDICT(['Implemented-by: the dispatching seat', `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.detail, 'claude/'));

  // the spelling, mirroring the Clause-② reader exactly
  t('the token may be followed by the seat\'s reasoning — the same calibration Clause-② uses', readVerdictAuthorship(VERDICT([`Implemented-by: ${IMPL_SESSION} (implementation claim, 09:24Z)`, `Reviewed-by: ${REVIEW_SESSION}`]).body)?.implementedBy === IMPL_SESSION);
  t('decoration around the keys is tolerated — bullets, bold, backticks', readVerdictAuthorship(VERDICT([`- **\`Implemented-by\`**: \`${IMPL_SESSION}\``, `- **\`Reviewed-by\`**: \`${REVIEW_SESSION}\``]).body)?.kind === 'pair');
  t('⛔ a different CASE is a different key — one convention for machine spellings, not two', readVerdictAuthorship(VERDICT([`IMPLEMENTED-BY: \`${IMPL_SESSION}\``, `REVIEWED-BY: \`${IMPL_SESSION}\``]).body)?.kind === 'legacy');
  t('⛔ a bare word after the colon is not a session ID', readVerdictAuthorship(VERDICT(['Implemented-by: me', 'Reviewed-by: me']).body)?.kind === 'malformed');

  // the row itself — the four mandated outcomes
  const selfRow = c4VerdictSelfReview(reviewed([VERDICT(SELF_PAIR)]));
  t('⭐ a same-session verdict FIRES C4', typeof selfRow === 'string');
  t('…and names it a SELF-REVIEW in as many words', says(selfRow, 'SELF-REVIEW'));
  t('…and quotes the session both lines name', says(selfRow, IMPL_SESSION));
  t('…and quotes the clause it is the carrier for', says(selfRow, '非自身产物') && says(selfRow, '污染即失独立性'));
  t('…and states that no downstream mechanism may read it as an independent review', says(selfRow, 'does NOT count as an independent review'));
  t('…and gives the remedy, which is another seat\'s verdict — never this script\'s write', says(selfRow, 'did NOT write the diff') && says(selfRow, '自查放行'));
  t('…and names the residual hole: both IDs are SELF-DECLARED', says(selfRow, 'SELF-DECLARED'));
  t('⭐ a distinct-session verdict produces NO row — that is the shape the clause asks for', c4VerdictSelfReview(reviewed([VERDICT(INDEPENDENT_PAIR)])) === null);
  t('⭐ a LEGACY verdict with neither line is SILENT — absence never turns a historic pair red', c4VerdictSelfReview(reviewed([VERDICT([])])) === null);
  t('…and so is a thread with no verdict at all', c4VerdictSelfReview(pair({ cardComments: [CLAIM('Clause-②: yes')] })) === null);
  const halfRow4 = c4VerdictSelfReview(reviewed([VERDICT([`Reviewed-by: \`${REVIEW_SESSION}\``])]));
  t('⭐ a ONE-LINE-only verdict is its own reportable malformed state', typeof halfRow4 === 'string' && says(halfRow4, 'HALF'));
  t('…and quotes the fixed spelling so the remedy is executable', says(halfRow4, 'Implemented-by: session_') && says(halfRow4, 'Reviewed-by: session_'));
  t('…including the subagent BRANCH form, the half a session-only spelling could not express', says(halfRow4, 'Implemented-by: claude/'));
  t('…and says in the same breath that a legacy verdict is NOT this state', says(halfRow4, 'LEGACY') && says(halfRow4, 'never turned red'));
  t('C4 never prescribes a write from this script either', says(halfRow4, '自查放行'));

  // the SUBAGENT identity — reading a (maintainer 2026-09-02, verbatim 「同意」)
  // A `mode:subagent` dev has no session of its own, so the implementation claim
  // names it by its BRANCH; a session token on that line would name the
  // dispatching seat and make every subagent-dispatched card a false self-review.
  const DEV_BRANCH = 'claude/issue-14209-review-template-half';
  const SUBAGENT_PAIR = [`Implemented-by: \`${DEV_BRANCH}\``, `Reviewed-by: \`${REVIEW_SESSION}\``];
  t('⭐ a `mode:subagent` dev is named by its BRANCH, and that reads as a first-class pair', readVerdictAuthorship(VERDICT(SUBAGENT_PAIR).body)?.kind === 'pair' && readVerdictAuthorship(VERDICT(SUBAGENT_PAIR).body)?.implementedBy === DEV_BRANCH);
  t('⭐ …so a subagent-dispatched card is SILENT — the reviewing seat did not write the diff', c4VerdictSelfReview(reviewed([VERDICT(SUBAGENT_PAIR)])) === null);
  t('…and it reads INDEPENDENT rather than unjudged — silence here is a reading, not a gap', verdictAuthorship([VERDICT(SUBAGENT_PAIR)]).state === 'independent' && pairUnjudged(reviewed([VERDICT(SUBAGENT_PAIR)])) === null);
  t('⭐ …while the same-session pair still FIRES: widening the grammar did not disarm the row', typeof c4VerdictSelfReview(reviewed([VERDICT(SELF_PAIR)])) === 'string');
  t('the branch token ends at the branch — the seat\'s reasoning may follow it', readVerdictAuthorship(VERDICT([`Implemented-by: ${DEV_BRANCH} (implementation claim, 16:29Z)`, `Reviewed-by: ${REVIEW_SESSION}`]).body)?.implementedBy === DEV_BRANCH);
  t('…and a trailing sentence mark belongs to the prose, never to the branch', readVerdictAuthorship(VERDICT([`Implemented-by: ${DEV_BRANCH}.`, `Reviewed-by: ${REVIEW_SESSION}`]).body)?.implementedBy === DEV_BRANCH);
  t('⛔ `Reviewed-by:` admits a session ONLY — a verdict is rendered by a seat, and a seat has one', readVerdictAuthorship(VERDICT([`Implemented-by: \`${DEV_BRANCH}\``, `Reviewed-by: \`${DEV_BRANCH}\``]).body)?.kind === 'malformed');
  t('…and says WHICH key refused the token, not the other one', says(readVerdictAuthorship(VERDICT([`Implemented-by: \`${DEV_BRANCH}\``, `Reviewed-by: \`${DEV_BRANCH}\``]).body)?.detail, 'Reviewed-by') && !says(readVerdictAuthorship(VERDICT([`Implemented-by: \`${DEV_BRANCH}\``, `Reviewed-by: \`${DEV_BRANCH}\``]).body)?.detail, '`Implemented-by:` carries'));
  t('⛔ a bare `claude` with no branch path is not an identity', readVerdictAuthorship(VERDICT(['Implemented-by: claude', `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.kind === 'malformed');
  t('⛔ nor is a branch that merely appears LATER in the line — the token is first after the colon', readVerdictAuthorship(VERDICT([`Implemented-by: the dev on ${DEV_BRANCH}`, `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.kind === 'malformed');

  // the governing verdict — why the newest one carrying the pair decides
  t('⭐ a self-review followed by an INDEPENDENT re-review reads clean — the remedy clears the row', c4VerdictSelfReview(reviewed([VERDICT(SELF_PAIR, '2026-09-01T11:21:18Z'), VERDICT(INDEPENDENT_PAIR, '2026-09-01T12:56:27Z')])) === null);
  t('…and the reverse order still fires, so a later self-review is not hidden by an earlier clean one', typeof c4VerdictSelfReview(reviewed([VERDICT(INDEPENDENT_PAIR, '2026-09-01T09:00:00Z'), VERDICT(SELF_PAIR, '2026-09-01T12:56:27Z')])) === 'string');
  t('…and arrival order does not decide it — the reader sorts', verdictAuthorship([VERDICT(INDEPENDENT_PAIR, '2026-09-01T12:56:27Z'), VERDICT(SELF_PAIR, '2026-09-01T11:21:18Z')]).state === 'independent');
  t('a LEGACY verdict posted after a self-review does not clean it — it is not a candidate at all', verdictAuthorship([VERDICT(SELF_PAIR, '2026-09-01T11:21:18Z'), VERDICT([], '2026-09-01T13:00:00Z')]).state === 'self-review');

  // #4690, C4's half: unread is never clean
  t('an UNREADABLE thread produces no C4 row — it is UNJUDGED instead', c4VerdictSelfReview(pair({ cardComments: null })) === null);
  t('an UNDATED verdict refuses the ordering rather than guessing it', verdictAuthorship([VERDICT(SELF_PAIR, null)]).state === 'unreadable');
  t('…and the unjudged accounting names it, so the pair cannot render as clean', says(pairUnjudged(reviewed([VERDICT(SELF_PAIR, null)])), 'verdict authorship'));
  t('…while a dated, judged verdict adds no gap of its own', pairUnjudged(reviewed([VERDICT(INDEPENDENT_PAIR)])) === null);
  t('C4 costs no extra request — it reads the thread C2 already fetched', needsGateHistory(reviewed([VERDICT(SELF_PAIR)])) === false);

  // -- #17346: the 2026-09-09 dialect, and the reviewer identity it needs ----
  //
  // ⭐ The fixtures are the live specimens the card measured, read via
  // repo-scoped REST on 2026-09-10 and trimmed to what the reader reads: the
  // heading, the head as a code span, the authorship pair. Under the 2026-09-01
  // marker alone every one of them answered `null`, so C4 had NO live
  // population and the self-review shape it exists to refuse was unreachable.
  const LIVE_HEAD_73 = 'de0bd50469a6c5f20102f67e0901c43fe316567c';
  const LIVE_HEAD_16 = 'e91934804197f5336aafdcc0bef0a0cccef1be83';
  const ADOPTING_SEAT = 'session_01Tep4AYXZvyBA7jsvne5KZV';
  const DEV_16861 = 'session_012zTkyNHJ7TkuN2oXtP5x37';
  // Dialect ① — comment 5597841101 (PR #17073), a director-seat ADOPTION
  // record: its own sentence first, H51's heading on a LATER line, the pair
  // written bare at the end. BOTH values are prose — `branch` puts a word
  // before the branch token, and `Reviewed-by:` names the summon rather than a
  // session — and the session the reviewer line owes is one line above it.
  const LIVE_ADOPTION = {
    id: 5597841101,
    created_at: '2026-09-09T07:19:12Z',
    body: [
      `**Director seat adoption record** — summon #20, \`${ADOPTING_SEAT}\`. The verdict below is adopted **verbatim** from an isolated contract-review subagent.`,
      '',
      '---',
      '',
      `## Contract review (\`CONTRACT_REVIEW_TIER\`, isolated seat) — PR #17073 @ \`${LIVE_HEAD_73}\``,
      '',
      '**Verdict: PASS WITH FINDINGS**',
      '',
      'Implemented-by: branch `claude/issue-16657-raw-exec-operator-detail-cause`',
      'Reviewed-by: director seat summon #20 (isolated fable subagent, transcript-verified before adoption)',
    ].join('\n'),
  };
  // Dialect ② — comment 5600239551 (PR #17073): heading first, the pair as bold
  // bullets, the reviewer named by MODEL rather than by a session.
  const LIVE_BOLD = {
    id: 5600239551,
    created_at: '2026-09-09T10:17:06Z',
    body: [
      `## Contract review (clause ②) — **PASS WITH FINDINGS**, no blocking item · head \`${LIVE_HEAD_73}\``,
      '',
      '- **Implemented-by:** branch `claude/issue-16657-raw-exec-operator-detail-cause` @ `de0bd50469`',
      '- **Reviewed-by:** isolated review subagent, **transcript-verified**: 105 harness-stamped model fields, one distinct value.',
    ].join('\n'),
  };
  // Dialect ③ — comment 5600627944 (PR #17116): the verdict word bolded INSIDE
  // the heading, and the implementer's session present but not first after the
  // colon.
  const LIVE_HEADING_VERDICT = {
    id: 5600627944,
    created_at: '2026-09-09T10:49:48Z',
    body: [
      `## Contract review at \`CONTRACT_REVIEW_TIER\` — **Verdict: PASS WITH FINDINGS** (audit reading; director seat, \`session_017Js5kTpTtxieBjPyScgxJ3\`)`,
      '',
      `PR #17116 · verdict pinned to head \`${LIVE_HEAD_16}\` · reviewed 10:36Z–10:46Z.`,
      '- **Reviewed-by:** isolated review subagent, transcript-verified (89 harness stamps), adopted **verbatim** below.',
      `- **Implemented-by:** the \`domain:services\` seat's dev \`${DEV_16861}\` (\`mode:subagent\`), branch \`claude/issue-16861-already-have-admin-unordered-cap\`.`,
    ].join('\n'),
  };
  // The same 2026-09-09 dialect written the way :35 now names — the ADOPTING
  // seat's own session on `Reviewed-by:`, the dev's branch on the left.
  const LIVE_WRITTEN_RIGHT = {
    id: 5600239552,
    created_at: '2026-09-09T10:18:00Z',
    body: [
      `## Contract review (clause ②) — **PASS WITH FINDINGS** · head \`${LIVE_HEAD_73}\``,
      '',
      '- **Implemented-by:** `claude/issue-16657-raw-exec-operator-detail-cause`',
      `- **Reviewed-by:** \`${ADOPTING_SEAT}\` (adopting seat; the isolated subagent that rendered the text has no session of its own)`,
    ].join('\n'),
  };
  const live = (rows, o) => pair({ headSha: LIVE_HEAD_73, cardComments: [CLAIM('Clause-②: no'), ...rows], ...o });

  // the discriminator, second dialect — H51's two facts, reused and not re-spelled
  t('⭐ the 2026-09-09 ADOPTION dialect is a verdict — heading on a later line, head as a code span', readVerdictAuthorship(LIVE_ADOPTION.body, LIVE_HEAD_73) !== null);
  t('⭐ …so is the bold-bullet dialect', readVerdictAuthorship(LIVE_BOLD.body, LIVE_HEAD_73) !== null);
  t('⭐ …and the one that bolds the verdict word INSIDE the heading', readVerdictAuthorship(LIVE_HEADING_VERDICT.body, LIVE_HEAD_16) !== null);
  t('⛔ CONTROL — all three read `null` under the 2026-09-01 marker alone, which is the defect #17346 filed', [LIVE_ADOPTION, LIVE_BOLD, LIVE_HEADING_VERDICT].every((r) => readVerdictAuthorship(r.body) === null));
  t('⛔ the head is REQUIRED for the heading path — a caller with none keeps exactly the 2026-09-01 reading', readVerdictAuthorship(LIVE_BOLD.body, undefined) === null && readVerdictAuthorship(LIVE_BOLD.body, null) === null);
  t('⛔ …and a heading naming ANOTHER head is not a verdict on this one — a quoted heading stays silent', readVerdictAuthorship(LIVE_BOLD.body, '0ldhead00abc') === null);
  t('⛔ a head too short for H51\'s span test recognises nothing rather than everything', readVerdictAuthorship(LIVE_BOLD.body, 'de0bd5') === null);
  t('⛔ the verdict WORD is still not a discriminator in either dialect — bold `**Verdict: PASS**` with no heading and no fenced line is not a verdict', readVerdictAuthorship(`**Verdict: PASS WITH FINDINGS** on head \`${LIVE_HEAD_73}\``, LIVE_HEAD_73) === null);
  t('⛔ nor is a `###` sub-heading — the marker is H51\'s, so its calibration is inherited, not re-spelled', readVerdictAuthorship(LIVE_BOLD.body.replace(/^## /, '### '), LIVE_HEAD_73) === null);
  t('⭐ the fenced 2026-09-01 dialect still reads with a head in hand — the new path ADDS, it never displaces', readVerdictAuthorship(VERDICT(SELF_PAIR).body, LIVE_HEAD_73)?.kind === 'pair');

  // the reviewer grammar — HELD, with the remedy on the writing side
  t('⭐ the 2026-09-09 dialect with a bold `**Reviewed-by:**` and a SESSION reads as a first-class pair', readVerdictAuthorship(LIVE_WRITTEN_RIGHT.body, LIVE_HEAD_73)?.kind === 'pair');
  t('…with both tokens read — the dev\'s branch on the left, the adopting seat\'s session on the right', readVerdictAuthorship(LIVE_WRITTEN_RIGHT.body, LIVE_HEAD_73)?.implementedBy === 'claude/issue-16657-raw-exec-operator-detail-cause' && readVerdictAuthorship(LIVE_WRITTEN_RIGHT.body, LIVE_HEAD_73)?.reviewedBy === ADOPTING_SEAT);
  t('⭐ …and C4 judges it NORMALLY: independent, so no row', c4VerdictSelfReview(live([LIVE_WRITTEN_RIGHT])) === null);
  t('⭐ …while the same dialect naming ONE session on both lines FIRES C4 — the row now has a live population', says(c4VerdictSelfReview(live([{ ...LIVE_WRITTEN_RIGHT, body: LIVE_WRITTEN_RIGHT.body.replace('`claude/issue-16657-raw-exec-operator-detail-cause`', `\`${ADOPTING_SEAT}\``) }])), 'SELF-REVIEW'));
  const proseRow = c4VerdictSelfReview(live([LIVE_BOLD]));
  t('⭐ a PROSE `Reviewed-by:` value with no session token reads MALFORMED — the ruling is held, not widened', typeof proseRow === 'string' && says(proseRow, 'HALF'));
  t('…naming the missing token by what the key admits', says(proseRow, '`Reviewed-by:` carries no readable session ID'));
  t('…and quoting the offending line back, so the repair is located', says(proseRow, 'isolated review subagent'));
  t('…and naming the WRITING-side remedy: the rendering or adopting seat writes its OWN session', says(proseRow, '渲染或采纳裁决的席位写自己的 session') && says(proseRow, 'ADOPTS'));
  t('…and refusing the model name as an identity in as many words', says(proseRow, 'Prose naming the reviewing MODEL is not an identity'));
  t('…and pointing at the comment, not merely the timestamp', says(proseRow, 'comment 5600239551'));
  t('⛔ it is NOT a false positive: the adoption specimen carries the seat session one line ABOVE a `Reviewed-by:` line that names none', LIVE_ADOPTION.body.includes(ADOPTING_SEAT) && readVerdictAuthorship(LIVE_ADOPTION.body, LIVE_HEAD_73)?.kind === 'malformed');
  t('⛔ and the implementer half is measured the same way — a session that is not FIRST after the colon is not the token', readVerdictAuthorship(LIVE_HEADING_VERDICT.body, LIVE_HEAD_16)?.kind === 'malformed' && says(readVerdictAuthorship(LIVE_HEADING_VERDICT.body, LIVE_HEAD_16)?.detail, '`Implemented-by:` carries no readable identity'));
  t('⭐ so the live corpus reads MALFORMED, never `pair` and never silent — three specimens, three carrier defects', [LIVE_ADOPTION, LIVE_BOLD].every((r) => readVerdictAuthorship(r.body, LIVE_HEAD_73)?.kind === 'malformed') && readVerdictAuthorship(LIVE_HEADING_VERDICT.body, LIVE_HEAD_16)?.kind === 'malformed');

  // the decoration asymmetry the same corpus exposed — key tolerant, value not
  t('⭐ `- **Implemented-by:** `+backticked value reads — the colon sits INSIDE the bold, which is what every 2026-09-09 specimen writes', readVerdictAuthorship(LIVE_WRITTEN_RIGHT.body, LIVE_HEAD_73)?.implementedBy === 'claude/issue-16657-raw-exec-operator-detail-cause');
  t('…and the same decoration on `Reviewed-by:` reads its session', readVerdictAuthorship(LIVE_WRITTEN_RIGHT.body, LIVE_HEAD_73)?.reviewedBy === ADOPTING_SEAT);
  t('⛔ the strip eats DECORATION only, never a word: `branch `+token is still refused', readVerdictAuthorship(VERDICT(['Implemented-by: branch `claude/issue-x`', `Reviewed-by: \`${REVIEW_SESSION}\``]).body)?.kind === 'malformed');
  t('⛔ …and a bold PROSE value is refused on both keys', readVerdictAuthorship(VERDICT(['Implemented-by: **the dispatching seat**', 'Reviewed-by: **the skills seat, this session**']).body)?.kind === 'malformed');
  t('⛔ …so the live reviewer prose stays malformed after the fix — the ruling was held, not quietly widened', readVerdictAuthorship(LIVE_BOLD.body, LIVE_HEAD_73)?.kind === 'malformed');
  t('⭐ the C6 reference record is legal under BOTH rows — a pair for C4, a found record for C6', readVerdictAuthorship(RECORD_ON_9AF9.body, HEAD_9AF9)?.kind === 'pair' && readVerdictAuthorship(RECORD_ON_9AF9.body, HEAD_9AF9)?.implementedBy === 'claude/issue-13657-x');

  // which threads C4 reads, per pair state — stated, and bought for nothing
  const COMPLETED_BASE = { pr: 13864, card: 13657, headSha: HEAD_9AF9, cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [PR_HUNG, PR_CLEARED], headCommittedAt: HEAD_AT_PASS };
  const onHeadVerdict = (lines, at, id) => ({ id, created_at: at, body: [`## Contract review (clause ②) — **PASS** · head \`${HEAD_9AF9}\``, '', ...lines].join('\n') });
  const PR_SELF = onHeadVerdict([`- **Implemented-by:** \`${IMPL_SESSION}\``, `- **Reviewed-by:** \`${IMPL_SESSION}\``], '2026-09-01T08:50:00Z', 3401);
  const PR_INDEP = onHeadVerdict([`- **Implemented-by:** \`${IMPL_SESSION}\``, `- **Reviewed-by:** \`${REVIEW_SESSION}\``], '2026-09-01T08:52:00Z', 3402);
  t('⭐ on a COMPLETED pair C4 reads the PR thread too — the rule puts the record 「一条评论落 PR 或卡」', typeof c4VerdictSelfReview(declaredYes({ ...COMPLETED_BASE, prComments: [PR_SELF] })) === 'string');
  t('…and names the PR-thread comment it judged', says(c4VerdictSelfReview(declaredYes({ ...COMPLETED_BASE, prComments: [PR_SELF] })), 'comment 3401'));
  t('⭐ the union is the DECLARED limit, not a fetch: with no `prComments` in hand C4 reads the card thread alone', c4VerdictSelfReview(declaredYes({ ...COMPLETED_BASE })) === null && verdictThreadRows(declaredYes({ ...COMPLETED_BASE })).length === 1);
  t('⛔ an unread PR thread is not doubled into C4 — C6 owns that gap, and the pair is UNJUDGED there', c4VerdictSelfReview(declaredYes({ ...COMPLETED_BASE, prComments: null })) === null && says(pairUnjudged(declaredYes({ ...COMPLETED_BASE, prComments: null })), 'review-of-record read'));
  t('⛔ an unread CARD thread still refuses the whole reading, PR thread in hand or not (#4690)', verdictThreadRows({ cardComments: null, prComments: [PR_SELF] }) === null && c4VerdictSelfReview({ cardComments: null, prComments: [PR_SELF] }) === null);
  t('⭐ newest-governs spans the two threads: a newer INDEPENDENT verdict on the PR thread clears a card self-review', c4VerdictSelfReview(declaredYes({ ...COMPLETED_BASE, cardComments: [CLAIM('Clause-②: yes'), VERDICT(SELF_PAIR, '2026-09-01T08:40:00Z')], prComments: [PR_INDEP] })) === null);
  t('⭐ …and the reverse direction is not hidden either: a newer PR-thread self-review fires over an older clean card verdict', says(c4VerdictSelfReview(declaredYes({ ...COMPLETED_BASE, cardComments: [CLAIM('Clause-②: yes'), VERDICT(INDEPENDENT_PAIR, '2026-09-01T08:40:00Z')], prComments: [PR_SELF] })), 'SELF-REVIEW'));
  t('C4 still costs no extra request — the PR thread it reads is the one the COMPLETED state already owed', needsRecordRead(declaredYes({ ...COMPLETED_BASE, prComments: [PR_SELF] })) === true && needsGateHistory(live([LIVE_BOLD])) === false);

  // the reporting order, and the rows that were already there
  t('C4 reports AFTER the three existing rows, and never displaces one', pairRows(pair({ prLabels: [L], cardLabels: [], cardComments: [CLAIM('Clause-②: yes'), VERDICT(SELF_PAIR)] })).map((r) => r.code).join(',') === 'C1,C4');
  t('…and a self-reviewed pair is adverse even when every carrier reading is clean', pairRows(reviewed([VERDICT(SELF_PAIR)])).map((r) => r.code).join(',') === 'C4');

  // -- the #13910 specimen, end to end ---------------------------------------
  battery('the #13910 specimen, end to end');
  const specimen = pair({ pr: 13910, card: 13476, prLabels: [], cardLabels: [L], cardComments: [CLAIM('Domain: `domain:engine`')] });
  const specimenRows = pairRows(specimen).map((r) => r.code);
  t('the measured #13910 specimen produces BOTH the split row and the no-reading row', specimenRows.includes('C1') && specimenRows.includes('C2'), JSON.stringify(specimenRows));
  t('…and no C3 row, because that card declared nothing at all', !specimenRows.includes('C3'));

  // -- pairing, derived from the same relation H8/H31 read --------------------
  battery('pairing, derived from the same relation H8/H31 read');
  const prRow = (n, card, ref) => ({ number: n, draft: true, labels: [], body: `Fixes #${card}\n`, head: { ref } });
  t('a PR body naming its card pairs with it', derivePairs([prRow(13910, 13476, 'claude/issue-13476-x')], [13476]).length === 1);
  t('a PR body naming another card does NOT pair on a stale branch name', derivePairs([prRow(13910, 9999, 'claude/issue-13476-x')], [13476]).length === 0);
  t('a branch name is the fallback when the body says nothing', derivePairs([{ number: 1, labels: [], body: 'no refs here', head: { ref: 'claude/issue-13476-x' } }], [13476]).length === 1);

  // -- #16706: the pair carries the EVIDENCE it was derived from -------------
  //
  // ★ The measured specimen — objectui PR #8354, whose "Serial constraints"
  // section said 「part of #7918 already landed …」 about a DIFFERENT card with
  // its own separate PR. The pair below is the one this file derived from that
  // sentence, and the C1 row it emitted told the reader a live fail-open was in
  // front of them. The relation is unchanged, so the pair is still derived —
  // what changed is that the row now says what it was built from.
  const PROSE_8354 =
    'Note that **part of #7918** already landed as `4f9f1ee` (PR #8226, memoising two of ' +
    'the lazy getters); this PR does not touch the getters.';
  const body8354 = `Fixes #7760\n\n## Serial constraints\n\n- ${PROSE_8354}\n`;
  const pr8354 = { number: 8354, draft: true, labels: [], body: body8354, head: { ref: 'claude/issue-7760-lazy-mirror-input-type-args' } };

  const inlinePair = derivePairs([pr8354], [7918]);
  t('#16706: the prose sentence still derives the pair — the relation is NOT narrowed here', inlinePair.length === 1);
  t('#16706: …and the pair records that the match was not at the declaration position', inlinePair[0]?.evidence === 'part-of-inline');
  const keywordPair = derivePairs([pr8354], [7760]);
  t('#16706: the real `Fixes` relation on the same body is graded as the strong channel', keywordPair[0]?.evidence === 'closing-keyword');
  // CONTROL — the same body with that ONE sentence deleted derives nothing.
  t('#16706 control: deleting the sentence removes the pair entirely', derivePairs([{ ...pr8354, body: 'Fixes #7760\n\n## Serial constraints\n\n' }], [7918]).length === 0);

  // …and the C1 row PRINTS it — the row the card was filed about.
  const c1Inline = c1CarrierSplit({ ...inlinePair[0], prLabels: [CONTRACT_REVIEW_LABEL], cardLabels: [], cardComments: [CLAIM('Clause-②: yes')] });
  t('#16706: the C1 dangerous half still fires on the derived pair', typeof c1Inline === 'string');
  t('#16706: …and now names the evidence beside the PR', String(c1Inline).includes('#8354 (draft, ⚠️ via `Part of` NOT at the declaration position'));
  t('#16706: …while the consequence paragraph it always carried is untouched', String(c1Inline).includes('an ungated card is a card that was never'));
  // A strong-channel pair prints the strong phrase, so the two are DISTINGUISHABLE
  // in the row — which is the whole point of the card.
  const c1Keyword = c1CarrierSplit({ ...keywordPair[0], prLabels: [CONTRACT_REVIEW_LABEL], cardLabels: [], cardComments: [CLAIM('Clause-②: yes')] });
  t('#16706: a keyword-sourced row reads differently from an inline-sourced one', String(c1Keyword).includes('via a closing keyword') && !String(c1Keyword).includes('NOT at the declaration position'));
  // ⛔ A pair from a caller that predates the field claims no reading at all.
  t('#16706: a pair with no evidence field prints exactly as it always did', String(c1CarrierSplit({ pr: 13910, card: 13476, draft: true, prLabels: [CONTRACT_REVIEW_LABEL], cardLabels: [], cardComments: [] })).includes('#13910 (draft)'));

  // -- the three read paths ---------------------------------------------------
  //
  // The offline reader is exercised against the SAME predicates the live path
  // feeds (`pairRows` / `pairUnjudged`), because the point of path (iii) is not
  // that a document parses — it is that a pair read from one is judged by the
  // identical code, and answers UNJUDGED wherever the document is silent.
  battery('the three read paths: ordered, offline-capable, and named in every refusal');
  const DOC = {
    pulls: [
      {
        number: 13910,
        draft: true,
        body: 'Part of #13476',
        head: { ref: 'claude/issue-13476-unresolvable-engine-403', sha: 'f00dcafe' },
        labels: [],
      },
    ],
    cards: { 13476: { number: 13476, labels: [] } },
    comments: { 13476: [CLAIM('Clause-②: no')] },
  };
  const docReader = pairJsonReader(DOC, { source: 'the self-test fixture' });
  const refuses = (fn, frag) => {
    try {
      fn();
      return false;
    } catch (err) {
      return frag ? says(err.message, frag) : true;
    }
  };
  const plan = (input) => JSON.stringify(readPathPlan(input));
  t(
    'a token exported: it is tried FIRST, and the public read is its fallback',
    plan({ token: 'x' }) === JSON.stringify([READ_PATH_TOKEN, READ_PATH_PUBLIC]),
  );
  t(
    'no token: the public read IS the ladder — this file never refuses before trying',
    plan({}) === JSON.stringify([READ_PATH_PUBLIC]),
  );
  t(
    'a named document is EXCLUSIVE, not last — ⛔ never half a document and half a live board',
    plan({ token: 'x', pairJson: true }) === JSON.stringify([READ_PATH_PAIR_JSON]),
  );
  t(
    'both readers implement every method gather calls, so neither can miss one live',
    READER_METHODS.every((m) => typeof NETWORK_READER[m] === 'function')
      && READER_METHODS.every((m) => typeof docReader[m] === 'function'),
  );
  t('a document that is not an object is refused as INPUT, never judged as a pair', refuses(() => pairJsonReader(null)));
  t('a document with no PR row is refused, and the message names what a row needs', refuses(() => pairJsonReader({}), 'pulls'));
  t('the single-`pull` spelling is accepted — one pre-fetched pair is the ergonomic case', pairJsonReader({ pull: DOC.pulls[0] }).listOpenPulls().length === 1);
  t('the document serves the PR row the live listing would have', docReader.listOpenPulls().length === 1);
  t('…the card', docReader.readCard('owner/name', 13476)?.number === 13476);
  t('…and the comment thread that carries the declaration', Array.isArray(docReader.readCardComments('owner/name', 13476)));
  const fetchedRow = docReader.listOpenPulls()[0];
  const fetchedPair = {
    pr: fetchedRow.number,
    draft: Boolean(fetchedRow.draft),
    card: 13476,
    headSha: fetchedRow.head.sha,
    prLabels: labelNames(fetchedRow),
    cardLabels: labelNames(docReader.readCard('owner/name', 13476)),
    cardComments: docReader.readCardComments('owner/name', 13476),
  };
  t(
    'a pre-fetched pair is JUDGED by the same predicates — legible, carriers agree, nothing unread',
    pairRows(fetchedPair).length === 0 && pairUnjudged(fetchedPair) === null,
  );
  t(
    'a thread the document OMITS reads null — UNJUDGED, ⛔ never an absent declaration',
    pairJsonReader({ pulls: DOC.pulls }).readCardComments('owner/name', 13476) === null
      && says(pairUnjudged({ ...fetchedPair, cardComments: null }), 'UNJUDGED'),
  );
  t(
    'a thread present and EMPTY is a real empty read, and stays distinct from an omitted one',
    Array.isArray(pairJsonReader({ pulls: DOC.pulls, comments: { 13476: [] } }).readCardComments('owner/name', 13476)),
  );
  t('a card the document omits reads null, so its labels are UNREAD rather than bare', docReader.readCard('owner/name', 99999) === null);
  t('an event stream the document omits reads null — an unread stream is not a never-hung gate', docReader.readCarrierEvents('owner/name', 13476) === null);
  t(
    '…and one the document carries is served',
    Array.isArray(pairJsonReader({ pulls: DOC.pulls, events: { 13476: [] } }).readCarrierEvents('owner/name', 13476)),
  );
  t(
    'the head commit date is read from the document, and is null when it is not there',
    pairJsonReader({ pulls: DOC.pulls, commits: { f00dcafe: { commit: { committer: { date: '2026-09-04T09:00:00Z' } } } } })
      .readHeadCommitDate('owner/name', 'f00dcafe') === '2026-09-04T09:00:00Z'
      && docReader.readHeadCommitDate('owner/name', 'f00dcafe') === null,
  );
  t('a document naming ANOTHER board is refused rather than judged under this one\'s name', says(pairJsonRepoConflict('owner/other', 'owner/name'), 'Refusing'));
  t(
    '…and one that names this board, or names none at all, is not refused',
    pairJsonRepoConflict('owner/name', 'owner/name') === null && pairJsonRepoConflict(null, 'owner/name') === null,
  );
  const report = renderReadPathReport({ served: new Map() });
  t(
    'a refusal names all THREE paths, so a seat can tell "no network" from "not open"',
    ['(i) token', '(ii) token-less public read', '(iii) --pair-json'].every((frag) => says(report, frag)),
  );
  t(
    'a REFUSED token is reported as retired, never as absent',
    says(renderReadPathReport({ tokenPresent: true, tokenRetired: { status: 403 }, served: new Map() }), 'REFUSED (HTTP 403)'),
  );
  t('an ABSENT token is reported as absent — which of the two it was is the seat\'s next move', says(report, 'absent from this environment'));
  t('the run prints the remaining budget it SAW', says(renderRateNote({ limit: '15000', remaining: '14576', resource: 'core' }), '14576 of 15000'));
  t('…and refuses to state a budget it did not see, rather than implying plenty', says(renderRateNote(null), 'UNKNOWN'));

  // -- #16833: the refusal names the CHANNEL, the ANSWER and the CARRIER ------
  //
  // The path report one battery up is about the RUN. This one is about ONE
  // RESOURCE: the measured shape is a container that answers 403 on a carrier's
  // `/issues/N/events` while two other containers answer 200 on the same URL,
  // which the old sentence rendered identically to a 404, a rate limit, a
  // transport fault and a document that simply omits the key.
  //
  // ⛔ Every case here is about the MESSAGE. The predicate cases are the
  // controls at the end: an unread stream still answers UNJUDGED and a readable
  // one still answers exactly what it did, because a diagnosis that moved a
  // verdict would be the silent clearance this card's own constraint forbids.
  battery('#16833: an UNJUDGED refusal names the CHANNEL that answered, what it answered, and which carrier');
  const CARD_STREAM = 'card #13476\'s label event stream';
  const PR_STREAM = 'PR #13910\'s label event stream';
  const refused403 = (subject) => ({
    subject,
    attempts: [
      { channel: READ_PATH_TOKEN, answer: 'HTTP 403' },
      { channel: READ_PATH_PUBLIC, answer: 'HTTP 403' },
    ],
  });
  const streamUnread = declaredYes({ cardEvents: null, prEvents: [] });
  const streamDiagnosed = { ...streamUnread, reads: [refused403(CARD_STREAM)] };
  const diagnosedMsg = pairUnjudged(streamDiagnosed);
  // ⛔ Pinned as subject-BESIDE-channel, never as "the subject appears
  // somewhere in the message": the gap list already names the carrier, so a
  // case that merely greps for it stays green on a message carrying no
  // diagnosis at all — measured, by ablating the subject away and watching the
  // weaker spelling of this very case pass.
  t('the refusal names WHICH CARRIER went unread, beside the channel that refused it', says(diagnosedMsg, `${CARD_STREAM} — (i) token answered HTTP 403`));
  t('…WHICH CHANNEL was tried, in the path report\'s own numbering', says(diagnosedMsg, '(i) token answered'));
  t('…the FALLBACK channel too, in the order the ladder tried them', says(diagnosedMsg, ', then (ii) token-less public read answered'));
  t('…and WHAT THE PLATFORM ANSWERED — the 403 this card was filed on', says(diagnosedMsg, 'HTTP 403'));
  t('⭐ so a seat can tell its own container\'s answer from the board\'s without re-reading by accident', says(diagnosedMsg, 'THIS seat\'s access'));
  t('⛔ and the refusal still refuses: a named channel is never a clearance', says(diagnosedMsg, 'never a clearance'));
  // ⛔ DIRECTION ①, the whole safety property: the verdict does not move.
  t('⛔ an unread stream is STILL UNJUDGED — the diagnosis is appended to the verdict, never instead of it', typeof diagnosedMsg === 'string' && says(diagnosedMsg, 'UNJUDGED'));
  t('…carrying the unmoved sentence verbatim, ⛔ not a softened one', says(diagnosedMsg, 'missing from the readings above, not clean in them.'));
  t('…and the pair reads exactly as unread WITHOUT the diagnosis as with it — the gap set is untouched', says(pairUnjudged(streamUnread), CARD_STREAM) && pairUnjudged(streamUnread).endsWith('not clean in them.'));
  // ⛔ DIRECTION ②: a READABLE stream keeps the verdict it always had.
  const streamRead = declaredYes({ cardEvents: [], prEvents: [] });
  t('⛔ CONTROL: a pair whose streams READ is not UNJUDGED, with or without the field', pairUnjudged(streamRead) === null && pairUnjudged({ ...streamRead, reads: [] }) === null);
  t('⛔ CONTROL: …and its C3 verdict is the one it always was — a diagnosis reads no predicate', typeof c3DeclaredYesUngated(streamRead) === 'string' && c3DeclaredYesUngated({ ...streamRead, reads: [refused403(CARD_STREAM)] }) === c3DeclaredYesUngated(streamRead));
  t('⛔ CONTROL: a caller that predates the field prints exactly what it printed before', pairUnjudged({ ...streamUnread, reads: undefined }) === pairUnjudged(streamUnread));
  t('⛔ CONTROL: a non-array `reads` is ignored rather than rendered as half a diagnosis', renderReadDiagnosis('403') === '' && renderReadDiagnosis(null) === '' && renderReadDiagnosis([]) === '');
  // The channels, each in its own spelling, and the answers that are not statuses.
  t('the `--pair-json` channel is named as itself — the path an MCP-only seat has', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [{ channel: READ_PATH_PAIR_JSON, answer: 'pair.json carries no `events` entry for `13476`' }] }]), '(iii) --pair-json answered'));
  t('…and its answer names the BAG and the KEY to add, so the remedy is one line', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [{ channel: READ_PATH_PAIR_JSON, answer: 'pair.json carries no `events` entry for `13476`' }] }]), 'no `events` entry for `13476`'));
  t('a transport fault with NO status is an answer, ⛔ never rendered as silence', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [{ channel: READ_PATH_PUBLIC, answer: 'no HTTP response (fetch failed)' }] }]), 'no HTTP response (fetch failed)'));
  t('a page cap that went short names the cap, ⛔ never a refusal nobody got', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [{ channel: READ_PATH_TOKEN, answer: '10 page(s) of 100 events each, all of them full — the tail is past this file\'s page cap and therefore unread' }] }]), 'past this file\'s page cap'));
  t('⛔ an entry with NO recorded attempt SAYS so — it never borrows the last channel that worked', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [] }]), 'NO channel recorded an answer'));
  t('…and that entry can never be read as a channel that answered', !says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [] }]), 'answered HTTP'));
  t('an unrecognised channel id renders VISIBLY rather than vanishing from the ladder', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [{ channel: 'mcp', answer: 'HTTP 403' }] }]), '(?) mcp answered HTTP 403'));
  t('the three labels are read from READ_PATH_LABELS, so a fourth channel needs an edit there', Object.keys(READ_PATH_LABELS).length === 3 && READ_PATH_LABELS[READ_PATH_TOKEN] === '(i) token');
  t('⛔ CONTROL: the labels are the PATH REPORT\'s own spellings — one channel, ⛔ never two names', Object.values(READ_PATH_LABELS).every((label) => says(renderReadPathReport({ served: new Map() }), label.split(' ')[0])));
  // BOTH carriers, and the other two sentences that report an unread read.
  const bothUnread = { ...declaredYes({ cardEvents: null, prEvents: null }), reads: [refused403(CARD_STREAM), refused403(PR_STREAM)] };
  t('two unread carriers produce two entries, each naming its own carrier beside its own answer', says(pairUnjudged(bothUnread), `${CARD_STREAM} — (i) token`) && says(pairUnjudged(bothUnread), `${PR_STREAM} — (i) token`));
  t('…in the order the reader attached them, ⛔ never merged into one reading', pairUnjudged(bothUnread).indexOf(`${CARD_STREAM} — (i)`) < pairUnjudged(bothUnread).indexOf(`${PR_STREAM} — (i)`));
  t('C5\'s own UNJUDGED sentence carries the same diagnosis, in the same words', says(String(wideningUnjudged({ ...pair({ files: null }), reads: [refused403('PR #13910\'s changed-file listing')] }, 'objectstack-ai/objectstack')), '(i) token answered HTTP 403'));
  t('…and so does the located-record one, so no refusal in this file is channel-silent', says(String(locatedRecordUnjudged({ ...pair({ prComments: null }), reads: [refused403('PR #13910\'s comment thread')] })), '(i) token answered HTTP 403'));
  t('⛔ CONTROL: each of those two is unchanged when nothing was diagnosed', String(wideningUnjudged(pair({ files: null }), 'objectstack-ai/objectstack')).endsWith(String(pairWidening(pair({ files: null }), 'objectstack-ai/objectstack').text)) && !says(String(locatedRecordUnjudged(pair({ prComments: null }))), 'Channel diagnosis'));
  t('the ledger key is one spelling for both the reader and the attach side', readDiagnosisKey('events', 13476) === 'events:13476');
  // The retry and the page ladder answer the same thing twice; one read
  // reported as two refusals reads like two problems.
  const twice = [{ channel: READ_PATH_PUBLIC, answer: 'HTTP 403' }, { channel: READ_PATH_PUBLIC, answer: 'HTTP 403' }];
  t('a repeated identical answer collapses and CARRIES ITS COUNT — one read, not two problems', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: twice }]), 'HTTP 403 (2× — the same answer on every attempt)'));
  t('⛔ …and two DIFFERENT answers are never collapsed — "403 then 502" is the whole reading', says(renderReadDiagnosis([{ subject: CARD_STREAM, attempts: [twice[0], { channel: READ_PATH_PUBLIC, answer: 'HTTP 502' }] }]), 'HTTP 403, then (ii) token-less public read answered HTTP 502'));

  // -- the exit register is distinct in every direction it must be -----------
  // -- C5: the direction claim, checked against the diff (#16448) -----------
  //
  // The tells themselves are the SIBLING's, with its own 120-case self-test;
  // what is pinned here is the JOIN — which pairs owe a diff read, what a pair
  // that owes none reports, and that a tell reaches the exit register.
  battery('C5: the direction claim checked against the diff (#16448)');
  const WIDENS = [{
    filename: 'packages/spec/src/kernel/plugin.zod.ts',
    status: 'modified',
    patch: "@@ -95,0 +95,1 @@\n+  'workflow',",
  }];
  const NARROWS = [{
    filename: 'packages/spec/src/kernel/plugin.zod.ts',
    status: 'modified',
    patch: "@@ -95,1 +95,0 @@\n-  'legacy',",
  }];
  const declaring = (value, files) => ({ pr: 13910, card: 13476, draft: false, cardLabels: [], prLabels: [], cardComments: [CLAIM(`Clause-②: ${value}`)], files });
  t('only a card that DECLARED `no` owes a changed-file listing', needsWideningRead(declaring('no', null)) === true);
  t('⛔ a `yes` owes none — it already routes to contract review', needsWideningRead(declaring('yes', null)) === false);
  t('⛔ a card with a claim comment but NO declaration owes none — that is C2\'s row, not C5\'s', needsWideningRead({ cardComments: [CLAIM('Domain: `domain:engine`')] }) === false);
  t('⛔ an UNREADABLE thread owes none — a second reader of the same limb is the drift this file avoids', needsWideningRead({ cardComments: null }) === false);
  t('a widening tell on a `no` pair is a C5 row', typeof c5WideningTell(declaring('no', WIDENS), 'objectstack-ai/objectstack') === 'string');
  t('…naming the file:line', says(c5WideningTell(declaring('no', WIDENS), 'objectstack-ai/objectstack'), 'packages/spec/src/kernel/plugin.zod.ts:95'));
  t('…and carrying the card\'s own refusal sentence, unparaphrased', says(c5WideningTell(declaring('no', WIDENS), 'objectstack-ai/objectstack'), REFUSAL_SENTENCE));
  t('…and the never-writes boundary every other row carries', says(c5WideningTell(declaring('no', WIDENS), 'objectstack-ai/objectstack'), '自查放行'));
  t('⛔ the SAME diff with `yes` is not a row — a tell never blocks the honest declaration', c5WideningTell(declaring('yes', WIDENS), 'objectstack-ai/objectstack') === null);
  t('⛔ a removal-only diff with `no` is not a row — the ruling is directional', c5WideningTell(declaring('no', NARROWS), 'objectstack-ai/objectstack') === null);
  t('a `no` pair whose listing could NOT be read is UNJUDGED, never clean', typeof wideningUnjudged(declaring('no', null), 'objectstack-ai/objectstack') === 'string');
  t('…and it is not also a row — unread is not adverse', c5WideningTell(declaring('no', null), 'objectstack-ai/objectstack') === null);
  t('⛔ a `yes` pair with no listing is NOT unjudged — it never owed one', wideningUnjudged(declaring('yes', null), 'objectstack-ai/objectstack') === null);
  t('a sweep pair (files never fetched) that declared `no` reads as owing the listing', needsWideningRead({ cardComments: [CLAIM('Clause-②: no')] }) === true);
  t('the reader roster carries the sixth read, so both readers must implement it', READER_METHODS.includes('readPullFiles'));
  t('…and the offline document serves it from its own `files` bag', typeof pairJsonReader({ pulls: [], files: { 13910: [] } }).readPullFiles === 'function');

  // -- C6: the review of record on this head (#17302) -------------------------
  //
  // ★ The measured shapes, both directions. The record is the 2026-09-09
  // board's verdict shape (heading, head as a code span, the independence
  // pair); the controls are the two shapes the filing sweep found INSTEAD of
  // one -- a dev's own `os-dev-report`, and a seat's ACCEPT paragraph carrying
  // the head and a `Reviewed-by:` line under a bold first line with no heading
  // at all (the skills seat's own, card #17285, 2026-09-10) -- plus H51's
  // dialects and the states that owe no read.
  battery('C6: the review of record on this head, and the carrier the rule text names (#17302)');
  const bare = (o) => declaredYes({ pr: 13864, card: 13657, headSha: HEAD_9AF9, cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [PR_HUNG, PR_CLEARED], headCommittedAt: HEAD_AT_PASS, prComments: [], ...o });
  // the cost bound: only the completed state owes the read
  t('only the COMPLETED state owes the review-of-record read', needsRecordRead(bare({})) === true);
  t('⛔ a declared `no` owes none — the gate never rode it', needsRecordRead(pair({ cardComments: [CLAIM('Clause-②: no')] })) === false);
  t('⛔ a pair still carrying the gate owes none — the review is pending, not missing', needsRecordRead(pair({ prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')] })) === false);
  t('⛔ a never-hung gate owes none — that is C3\'s row, and no row owns a fact twice', needsRecordRead(declaredYes({ cardEvents: [], prEvents: [] })) === false);
  t('⛔ a half-bound gate owes none', needsRecordRead(declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [] })) === false);
  t('⛔ a gate whose head MOVED after the clear owes none — the 重挂 row already covers it', needsRecordRead(bare({ headCommittedAt: '2026-09-01T10:30:00Z' })) === false);
  t('⛔ an unreadable stream owes none — it is already UNJUDGED', needsRecordRead(bare({ cardEvents: null })) === false);
  // recognition — the measured record, on either carrier
  const onPr = reviewOfRecord(bare({ prComments: [RECORD_ON_9AF9] }));
  t('the 2026-09-09 verdict shape on the PR thread reads FOUND', onPr.state === 'found');
  t('…naming where it was found, its id and the head span it names', JSON.stringify([onPr.where, onPr.id, onPr.sha]) === JSON.stringify(['PR', 3301, HEAD_9AF9]), JSON.stringify(onPr));
  const onCard = reviewOfRecord(bare({ cardComments: [CLAIM('Clause-②: yes'), RECORD_ON_9AF9] }));
  t('the same comment on the CARD thread reads FOUND too — the rule lets it live on either', onCard.state === 'found' && onCard.where === 'card');
  const absentRow = c6NoReviewOfRecord(bare({}));
  t('⭐ a cleared gate with NO record on either thread is a C6 row', typeof absentRow === 'string');
  t('…that says NO review of record in as many words, and names the head', says(absentRow, 'NO review of record') && says(absentRow, HEAD_9AF9));
  t('…and states what was read — both threads, with their counts', says(absentRow, '0 comment(s) on the PR thread') && says(absentRow, '1 on the card'));
  t('…and quotes the rule it is the carrier for', says(absentRow, '复核记录 = 一条评论落 PR 或卡') && says(absentRow, '清标缺引记录即半态'));
  t('…and names the shape, so the remedy is executable', says(absentRow, '## Contract review') && says(absentRow, 'Reviewed-by:'));
  t('…and is verdict-agnostic, and never writes', says(absentRow, 'PASS half') && says(absentRow, '自查放行'));
  // H51's head-identity test, and its dialects
  t('⛔ a record naming an OLDER head is not a record on this head — 「head 后移或无结论才重挂」 read forwards', reviewOfRecord(bare({ prComments: [RECORD('0ldhead00')] })).state === 'absent');
  const ADOPTION = { id: 3302, created_at: '2026-09-01T08:52:00Z', body: `**Director seat adoption record** — the verdict below is adopted verbatim.\n\n---\n\n## Contract review (\`CONTRACT_REVIEW_TIER\`, isolated seat) — PR #13864 @ \`${HEAD_9AF9}\`\n\n- **Reviewed-by:** isolated subagent, adopted by \`${RECORD_SESSION}\`\n- **Implemented-by:** branch \`claude/issue-13657-x\`` };
  t('a director ADOPTION record — heading on a later line — reads FOUND: H51\'s fourth dialect, line-anchored', reviewOfRecord(bare({ prComments: [ADOPTION] })).state === 'found');
  t('a blockquoted heading still reads — H51 tolerates the `>` a seat writes without meaning it', reviewOfRecord(bare({ prComments: [{ ...RECORD_ON_9AF9, body: RECORD_ON_9AF9.body.replace(/^## /, '> ## ') }] })).state === 'found');
  t('⛔ a `###` sub-heading is not the marker', reviewOfRecord(bare({ prComments: [{ ...RECORD_ON_9AF9, body: RECORD_ON_9AF9.body.replace(/^## /, '### ') }] })).state === 'absent');
  t('⛔ the heading mentioned inside a paragraph is not the marker', reviewOfRecord(bare({ prComments: [{ ...RECORD_ON_9AF9, body: RECORD_ON_9AF9.body.replace(/^## /, 'see the ## ') }] })).state === 'absent');
  // the two shapes the sweep found INSTEAD of a record
  const DEV_REPORT = { id: 3303, created_at: '2026-09-01T08:40:00Z', body: `os-dev-report\n\n\`\`\`json\n{ "issue": 13657, "pr": "https://github.com/o/r/pull/13864", "summary": "landed at \`${HEAD_9AF9}\`" }\n\`\`\`` };
  t('⛔ a bare os-dev-report naming the head is NOT a record — the implementer is not the reviewer', reviewOfRecord(bare({ prComments: [DEV_REPORT], cardComments: [CLAIM('Clause-②: yes'), DEV_REPORT] })).state === 'absent');
  const SEAT_ACCEPT = { id: 3304, created_at: '2026-09-01T08:45:00Z', body: `**ACCEPT — PR #13864 (head \`${HEAD_9AF9}\`) reviewed in-seat at the contract-review tier** (skills seat, session \`${RECORD_SESSION}\`).\n\n- Implemented-by: os-dev subagent on branch \`claude/issue-13657-x\`.\n- Reviewed-by: the skills seat, this session — independence pair holds.` };
  t('⛔ a seat\'s ACCEPT paragraph — head and `Reviewed-by:` under a bold first line, NO heading — is NOT a record: the measured 2026-09-10 shape this rule changes', reviewOfRecord(bare({ cardComments: [CLAIM('Clause-②: yes'), SEAT_ACCEPT] })).state === 'absent');
  // the third fact — the carrier the rule text names
  const UNSIGNED = RECORD(HEAD_9AF9, ['- **Implemented-by:** branch `claude/issue-13657-x`'], '2026-09-01T08:50:00Z', 3305);
  const unsignedRow = c6NoReviewOfRecord(bare({ prComments: [UNSIGNED] }));
  t('a heading comment on this head with NO `Reviewed-by:` line reads UNSIGNED, and is a row', reviewOfRecord(bare({ prComments: [UNSIGNED] })).state === 'unsigned' && typeof unsignedRow === 'string');
  t('…that names the comment and the missing line, not the whole shape', says(unsignedRow, 'comment 3305') && says(unsignedRow, 'NO `Reviewed-by:` line'));
  t('…and it is a DIFFERENT sentence from the absent row', unsignedRow !== absentRow);
  t('…and still never writes', says(unsignedRow, '自查放行'));
  t('the NEWEST heading comment on this head governs — a signed record after an unsigned one clears the row', reviewOfRecord(bare({ prComments: [UNSIGNED, RECORD(HEAD_9AF9, undefined, '2026-09-01T08:55:00Z', 3306)] })).state === 'found');
  t('…and an unsigned one after a signed one is the reading, in either arrival order', reviewOfRecord(bare({ prComments: [RECORD(HEAD_9AF9, [], '2026-09-01T08:55:00Z', 3307), RECORD(HEAD_9AF9, undefined, '2026-09-01T08:50:00Z', 3306)] })).state === 'unsigned');
  t('`Reviewed-by:` is read by C4\'s key regex — bullets, bold and backticks read; a different CASE does not', reviewOfRecord(bare({ prComments: [RECORD(HEAD_9AF9, ['- **`Reviewed-by`**: `session_x`'])] })).state === 'found' && reviewOfRecord(bare({ prComments: [RECORD(HEAD_9AF9, ['REVIEWED-BY: `session_x`'])] })).state === 'unsigned');
  // #4690, C6's half: unread is never clean
  t('an UNREADABLE PR thread is UNJUDGED, never clean — no row, and the accounting names the read', c6NoReviewOfRecord(bare({ prComments: null })) === null && says(pairUnjudged(bare({ prComments: null })), 'review-of-record read'));
  t('a completed pair from a caller that predates the read (no `prComments` at all) is UNJUDGED too — fail-closed', says(pairUnjudged(declaredYes({ pr: 13864, card: 13657, headSha: HEAD_9AF9, cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [PR_HUNG, PR_CLEARED], headCommittedAt: HEAD_AT_PASS })), 'PR #13864\'s comment thread'));
  t('a completed pair whose head sha is too short to match is UNJUDGED, not absent', says(pairUnjudged(bare({ headSha: 'abc' })), 'head sha'));
  // the completed specimen, whole
  t('⭐ the #14155 specimen WITH its record still reads CLEAN overall — the landing check\'s ② answers 0 after a legitimate clear', pairRows(completed).length === 0 && pairUnjudged(completed) === null, JSON.stringify(pairRows(completed).map((r) => r.code)));
  t('…and now prints the C6-RECORD note naming the comment, so the provenance comment can cite it', pairNotes(completed).map((n) => n.code).join() === 'C6-RECORD' && says(pairNotes(completed)[0]?.text, 'comment 3301') && says(pairNotes(completed)[0]?.text, '引记录 id 与所判 head'));
  t('…and the note says existence, not the verdict', says(pairNotes(completed)[0]?.text, 'stays human'));
  t('C6 reports AFTER C4 and never displaces a row', pairRows(bare({ cardComments: [CLAIM('Clause-②: yes'), VERDICT(SELF_PAIR)] })).map((r) => r.code).join(',') === 'C4,C6');
  t('C6 is a FINDING — it rides the exit, not the notes', pairRows(bare({})).some((r) => r.code === 'C6') && pairNotes(bare({})).length === 0);
  t('the offline document serves the PR thread from the same `comments` bag, keyed by the PR number', Array.isArray(pairJsonReader({ pulls: DOC.pulls, comments: { 13910: [] } }).readCardComments('owner/name', 13910)));
  t('…and one it omits reads null — UNJUDGED, ⛔ never a missing record', pairJsonReader({ pulls: DOC.pulls }).readCardComments('owner/name', 13910) === null);

  // -- #18141: the head sha's span holds the sha ALONE -----------------------
  //
  // ★ The trap, both halves. `references/contract-review.md` :28 said only
  // 「head sha 码段」, so a seat reading it in good faith wrote the key and the
  // sha into ONE span -- the live corpus spelling -- and a span is read as a
  // sha only when it is hex and nothing else, so that record names no head and
  // a complete review reads exactly like a pair nobody ever reviewed. The prose
  // now says 「独占码段」. Here the reader pins that the refused spelling stays
  // REFUSED -- ⛔ a second accepted spelling would be the trap's twin -- and
  // that the row NAMES it, so the seat's next act is one respell, not a hunt.
  battery('#18141: the head sha sits in a span of ITS OWN — the key-in-span spelling, refused and NAMED');
  // ⛔ Derived by collapsing the TEMPLATE's own line, never retyped: the key the
  // diagnosis matches is the key `--template` prints, so a template that
  // renamed it reds here instead of leaving this battery green about nothing.
  const OWN_SPAN = contractReviewRecordLines({ headSha: HEAD_9AF9, implementedBy: 'claude/issue-13657-x', reviewedBy: RECORD_SESSION }).join('\n');
  const IN_SPAN = OWN_SPAN.replace(/^([A-Za-z-]+): `([0-9a-fA-F]{7,40})`$/m, '`$1: $2`');
  const KEYED_ROW = { id: 3401, created_at: '2026-09-01T08:50:00Z', body: IN_SPAN };
  const NEWER_RECORD = RECORD(HEAD_9AF9, undefined, '2026-09-01T08:55:00Z', 3403);
  const keyedPair = bare({ prComments: [KEYED_ROW] });
  const keyedRow = c6NoReviewOfRecord(keyedPair);
  t('⭐ the template writes the key OUTSIDE the span, and that record names the head', IN_SPAN !== OWN_SPAN && contractReviewHeadMatch(OWN_SPAN, HEAD_9AF9) === HEAD_9AF9);
  t('⛔ …and the SAME record with the key folded INTO the span names no head — the defect isolated to the fold', contractReviewHeadMatch(IN_SPAN, HEAD_9AF9) === null);
  t('⛔ so it is not a review of record: the accept set is still exactly one spelling', reviewOfRecord(keyedPair).state === 'absent');
  t('…and the pair is a C6 row, exactly as if nothing had been written', typeof keyedRow === 'string');
  t('⭐ but the row NAMES the spelling, quoting the span the seat actually wrote', says(keyedRow, `\`Head-sha: ${HEAD_9AF9}\``) && says(keyedRow, 'comment 3401'));
  t('…and says WHERE it read it, so the seat opens the right thread', says(keyedRow, "the PR thread's comment 3401"));
  t('…and prescribes the fix in the rule\'s own words — key outside, sha in a span of its OWN', says(keyedRow, 'in a span of its OWN') && says(keyedRow, '所审 head sha 独占码段'));
  t('…pointing at the template as the thing to COPY, never a shape to compose', says(keyedRow, '`--template`'));
  t('⛔ and it is a DIFFERENT sentence from the empty case — the two stopped printing alike', says(keyedRow, 'The SPELLING is why') && !says(keyedRow, 'indistinguishable from never reviewing') && says(absentRow, 'indistinguishable from never reviewing') && !says(absentRow, 'The SPELLING is why'));
  t('⛔ verdict-agnostic and never writes, exactly like the sentence it stands beside', says(keyedRow, 'PASS half') && says(keyedRow, '自查放行'));
  t('⛔ a heading-less comment carrying the head is the plain absence, not this diagnosis', headSpanHoldsKey(bare({ cardComments: [CLAIM('Clause-②: yes'), SEAT_ACCEPT] })) === null);
  t('⛔ a keyed span naming an OLDER head is the plain absence too — this row speaks about THIS head', headSpanHoldsKey(bare({ prComments: [{ ...KEYED_ROW, body: IN_SPAN.replace(HEAD_9AF9, 'facefeed') }] })) === null);
  t('⛔ and a head too short to match is refused before any of it — unreadable is not a spelling verdict', headSpanHoldsKey(bare({ headSha: 'abc', prComments: [KEYED_ROW] })) === null);
  t('the NEWEST refused spelling is the one named, when a thread carries two', headSpanHoldsKey(bare({ prComments: [KEYED_ROW, { ...KEYED_ROW, id: 3405, created_at: '2026-09-01T09:10:00Z' }] }))?.id === 3405);
  // ⭐ The live corpus specimen's own shape: the refused line, and the head
  // quoted in a bare span somewhere in the prose. It reads FOUND today -- the
  // spelling is the defect, not that comment -- and this diagnosis stays silent.
  const RESCUED = { id: 3402, created_at: '2026-09-01T08:51:00Z', body: `${IN_SPAN}\n\nCross-file staleness, searched at \`${HEAD_9AF9}\`.` };
  t('⭐ the refused line BESIDE a bare sha span elsewhere in the prose reads FOUND — and is not this finding', reviewOfRecord(bare({ prComments: [RESCUED] })).state === 'found' && headSpanHoldsKey(bare({ prComments: [RESCUED] })) === null);
  t('⭐ a correct record beside a refused one is FOUND, in either arrival order', reviewOfRecord(bare({ prComments: [KEYED_ROW, NEWER_RECORD] })).state === 'found' && reviewOfRecord(bare({ prComments: [RECORD(HEAD_9AF9, undefined, '2026-09-01T08:45:00Z', 3404), KEYED_ROW] })).state === 'found');
  t('…and the locator chooses the CORRECT one — a refused spelling is never chosen over it, and never chosen at all', locateReviewOfRecord(bare({ prComments: [KEYED_ROW, NEWER_RECORD] })).id === 3403 && locateReviewOfRecord(bare({ prComments: [RECORD(HEAD_9AF9, undefined, '2026-09-01T08:45:00Z', 3404), KEYED_ROW] })).id === 3404);
  t('…so no C6 row and no spelling sentence on a pair that has a real record', c6NoReviewOfRecord(bare({ prComments: [KEYED_ROW, NEWER_RECORD] })) === null);
  t('the PROSE, the template and the reader name ONE spelling — and the template still round-trips', says(keyedRow, '独占码段') && contractReviewHeadMatch(contractReviewTemplateLines({ headSha: HEAD_9AF9 }).join('\n'), HEAD_9AF9) === HEAD_9AF9);


  // -- C7: the tier that SERVED the verdict the strip stands on (#17915) -----
  //
  // ★ The declared comparison, performed. `CONTRACT_REVIEW_TIER`'s docblock
  // calls the comparison against the SERVED tier EXACT and nothing performed
  // it: 11 measured rounds served below a declared tier, five of them the only
  // clearance a merged `Clause-②: yes` pair ever had. The three specimens the
  // ruling names are pinned first -- at tier green, below tier red, line
  // missing red -- then the EXACTNESS (no family, no prefix), then the
  // populations this row must never reach, which are the ones that owe no
  // verdict at all.
  //
  // ⛔ No specimen spells a real model id in SOURCE. The at-tier one uses the
  // constant's NAME, the below-tier one an obviously synthetic value, and the
  // near-miss ones are DERIVED from the name -- the tier keeps exactly one
  // value site in this tree, and a fixture is not a second one. The one
  // specimen that carries the VALUE reaches it through the IMPORTED constant,
  // and it is there to prove the identifier is REFUSED (#18060).
  battery('C7: the tier that SERVED the verdict the strip stands on (#17915)');
  const TIER_LINES = (value) => [
    '- **Implemented-by:** `claude/issue-13657-x`',
    `- **Reviewed-by:** \`${RECORD_SESSION}\``,
    `- **Served-tier:** \`${value}\``,
  ];
  const SERVED = (value, at = '2026-09-01T08:50:00Z', id = 3401) => RECORD(HEAD_9AF9, TIER_LINES(value), at, id);
  const NO_TIER_LINE = RECORD(HEAD_9AF9, TIER_LINES('x').slice(0, 2), '2026-09-01T08:50:00Z', 3402);
  const BELOW = 'example-below-tier';
  // the three the ruling names
  t('⭐ AT TIER — the reference record declares the constant and earns NO C7 row', c7ServedTierBelow(bare({ prComments: [RECORD_ON_9AF9] })) === null, JSON.stringify(reviewOfRecord(bare({ prComments: [RECORD_ON_9AF9] })).served));
  t('…and it declares it with the constant\'s NAME, so the record a seat posts carries NO model identifier', RECORD_ON_9AF9.body.includes(CONTRACT_REVIEW_TIER_NAME) && !RECORD_ON_9AF9.body.includes(CONTRACT_REVIEW_TIER));
  const belowRow = c7ServedTierBelow(bare({ prComments: [SERVED(BELOW)] }));
  t('⭐ BELOW TIER — a clearance standing on an off-tier verdict is a C7 row', typeof belowRow === 'string');
  t('…naming the PR, the verdict comment and the served value — the three the refusal owes', says(belowRow, 'PR #13864') && says(belowRow, 'comment 3401') && says(belowRow, BELOW));
  t('…and naming the required tier by its CONSTANT, never by its value', says(belowRow, '`CONTRACT_REVIEW_TIER`') && !says(belowRow, CONTRACT_REVIEW_TIER));
  const missingRow = c7ServedTierBelow(bare({ prComments: [NO_TIER_LINE] }));
  t('⭐ LINE MISSING — a verdict that declares nothing about what served it is refused too', typeof missingRow === 'string');
  t('…and says so, rather than reporting a tier it never read', says(missingRow, 'NO `Served-tier:` line') && !says(missingRow, 'Served-tier: '));
  t('…and is a DIFFERENT sentence from the below-tier row — two facts, two remedies', missingRow !== belowRow);
  // the value reader, and the exactness the constant's own docblock declares
  const unreadableRow = c7ServedTierBelow(bare({ prComments: [SERVED('')] }));
  t('a `Served-tier:` line with no readable token is STARTED-and-unreadable, not missing', reviewOfRecord(bare({ prComments: [SERVED('')] })).served.state === 'unreadable' && typeof unreadableRow === 'string');
  t('…and the row quotes the line back, so the residue is actionable', says(unreadableRow, 'no readable tier token'));
  t('⛔ a FAMILY prefix is refused — the comparison is EXACT, never a floor', typeof c7ServedTierBelow(bare({ prComments: [SERVED(CONTRACT_REVIEW_TIER_NAME.split('_')[0])] })) === 'string');
  t('⛔ …and so is a value that merely STARTS with the constant', typeof c7ServedTierBelow(bare({ prComments: [SERVED(`${CONTRACT_REVIEW_TIER_NAME}_EXAMPLE_SUFFIX`)] })) === 'string');
  // ⭐ #18060 — the accepted token is the constant's NAME, and the spelling this
  // row once REQUIRED is now itself a refusal: `AGENTS.md` lets no model
  // identifier land in a comment, and a review of record IS a comment.
  const identityRow = c7ServedTierBelow(bare({ prComments: [SERVED(CONTRACT_REVIEW_TIER)] }));
  t('⭐ the constant\'s VALUE — a literal model identifier — is REFUSED, though it is what this row once required', typeof identityRow === 'string');
  t('…and the refusal ⛔ never quotes the token back, so a refusal is not a second violation', !says(identityRow, CONTRACT_REVIEW_TIER) && says(identityRow, 'NOT quoted back here'));
  t('…and it names `AGENTS.md`\'s rule, which is WHY the accepted token changed', says(identityRow, 'AGENTS.md') && says(identityRow, 'a comment, a changeset, a doc or a code comment'));
  // ⛔ The specimen below is a model NOBODY has shipped, so it identifies no
  // model and spelling it lands no identifier -- the same device
  // `check-commit-card-trailers.mjs` uses to prove its own rule binds a SHAPE.
  const shapeRow = c7ServedTierBelow(bare({ prComments: [SERVED('claude-example-9-9')] }));
  t('⛔ a model id nobody has shipped binds too — the refusal reads a SHAPE, never a list', typeof shapeRow === 'string' && !says(shapeRow, 'claude-example-9-9'));
  t('⇒ the two refusals differ exactly on quoting: a safe token is echoed, an identifier is never', says(belowRow, BELOW) && !says(identityRow, CONTRACT_REVIEW_TIER));
  t('the identifier predicate binds the constant\'s own VALUE, so a tier bump cannot slip past it', isModelIdentifierToken(CONTRACT_REVIEW_TIER) && !isModelIdentifierToken(CONTRACT_REVIEW_TIER_NAME) && !isModelIdentifierToken(BELOW));
  t('⛔ and the row is NOT widened by any of it — one accepted token, and a missing line is still a refusal', servedTierStands(readServedTier(`Served-tier: \`${CONTRACT_REVIEW_TIER_NAME}\``)) && !servedTierStands(readServedTier('Served-tier: `CONTRACT_REVIEW_TIER_X`')) && readServedTier('no line here').state === 'missing');
  t('the value must be FIRST after the colon — prose in front is read as the value and compares unequal', readServedTier(`Served-tier: read 139/139 as ${CONTRACT_REVIEW_TIER_NAME}`).value === 'read');
  t('decoration around the key reads, exactly as it does for `Reviewed-by:`', readServedTier(`- **Served-tier:** \`${CONTRACT_REVIEW_TIER_NAME}\``).value === CONTRACT_REVIEW_TIER_NAME && readServedTier(`> Served-tier: ${CONTRACT_REVIEW_TIER_NAME}`).value === CONTRACT_REVIEW_TIER_NAME);
  t('⛔ a different CASE is a different key — one convention for machine spellings', readServedTier(`SERVED-TIER: ${CONTRACT_REVIEW_TIER_NAME}`).state === 'missing');
  t('the line is read anywhere in the comment — the rule asks the AUTHOR for the top, the reader refuses nobody over placement', c7ServedTierBelow(bare({ prComments: [RECORD(HEAD_9AF9, [...TIER_LINES(CONTRACT_REVIEW_TIER_NAME).slice(0, 2), '', 'some prose', ...TIER_LINES(CONTRACT_REVIEW_TIER_NAME).slice(2)])] })) === null);
  t('the NEWEST record on this head governs — a corrected record clears the row without touching the carrier', c7ServedTierBelow(bare({ prComments: [SERVED(BELOW), SERVED(CONTRACT_REVIEW_TIER_NAME, '2026-09-01T08:53:00Z', 3403)] })) === null);
  // the populations this row must never reach
  // ⚠️ Since #18174 this row's population is every pair that HAS a record, so
  // each case below pins the shape it names -- a pair with NO record, threads
  // READ and empty -- rather than passing because the thread was never fetched.
  // The other half of each, the same pair WITH a record, is the #18174 battery.
  t('⛔ a `Clause-②: no` pair with NO record on its head is NEVER refused for lacking the line', c7ServedTierBelow(pair({ headSha: HEAD_9AF9, prComments: [], cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('⛔ a pair still carrying the gate, with no record yet, owes nothing — the review is pending, not off tier', c7ServedTierBelow(pair({ headSha: HEAD_9AF9, prComments: [], prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')] })) === null);
  t('⛔ a never-hung gate with no record is C3\'s row and reaches this one not at all', c7ServedTierBelow(declaredYes({ headSha: HEAD_9AF9, prComments: [], cardEvents: [], prEvents: [] })) === null);
  t('⛔ …and a record naming an OLDER head is not this head\'s record, on any pair', c7ServedTierBelow(pair({ headSha: HEAD_9AF9, prComments: [SERVED(BELOW, '2026-09-01T08:50:00Z', 3405)].map((r) => ({ ...r, body: r.body.replace(HEAD_9AF9, '0ldhead00') })) })) === null);
  t('a gate whose head MOVED after the clear keeps its 重挂 row AND earns this one — two facts, two remedies', pairRows(bare({ prComments: [SERVED(BELOW)], headCommittedAt: '2026-09-01T10:30:00Z' })).map((r) => r.code).join(',') === 'C3,C7');
  t('⛔ an ABSENT record earns C6 and nothing else — one fact, one row', pairRows(bare({})).map((r) => r.code).join(',') === 'C6');
  const unsignedCodes = pairRows(bare({ prComments: [RECORD(HEAD_9AF9, ['- **Implemented-by:** `claude/issue-13657-x`'], '2026-09-01T08:50:00Z', 3404)] })).map((r) => r.code);
  t('⛔ an UNSIGNED record likewise — C7 speaks only about a record C6 FOUND', unsignedCodes.includes('C6') && !unsignedCodes.includes('C7'), JSON.stringify(unsignedCodes));
  t('⇒ C6 and C7 can never BOTH fire — they read one comment, chosen once by `reviewOfRecord`', [bare({}), bare({ prComments: [SERVED(BELOW)] }), bare({ prComments: [NO_TIER_LINE] }), bare({ prComments: [RECORD_ON_9AF9] })].every((x) => pairRows(x).filter((r) => r.code === 'C6' || r.code === 'C7').length <= 1));
  // the exit it rides, and the boundary it keeps
  t('C7 is a FINDING — it rides the exit, and never arrives as a note', pairRows(bare({ prComments: [SERVED(BELOW)] })).some((r) => r.code === 'C7') && pairNotes(bare({ prComments: [SERVED(BELOW)] })).every((n) => n.code !== 'C7'));
  t('…and an off-tier record never gets the C6-RECORD sentence that says the strip stands', !says(pairNotes(bare({ prComments: [SERVED(BELOW)] }))[0]?.text, 'the strip stands on C7'));
  t('…and the exit a finding raises is 4, the limb-not-standing code, ⛔ never 3', EXIT_PAIR_ADVERSE === 4 && EXIT_PAIR_ADVERSE !== EXIT_PREREQUISITE_NOT_MET);
  t('the row quotes the rule text it is the carrier for, in both halves', says(belowRow, '无此行不成裁决') && says(belowRow, '点名 PR、评论、读数'));
  t('…and states the reading is the harness stamp, ⛔ not the dispatch parameter', says(belowRow, 'HARNESS-STAMPED') && says(belowRow, 'dispatch `model` parameter'));
  t('…and is verdict-agnostic, and never writes', says(belowRow, 'what it concluded stays human') && says(belowRow, '自查放行'));
  t('an at-tier clear prints the reading in the C6-RECORD note, so a reader of exit 0 can see the strip stood on it', says(pairNotes(completed)[0]?.text, 'Served-tier'));
  // ⭐ The LIVE spelling, corrected from a fixture against the board. Every
  // record the remediation rounds write, and the ruling's own specimen, put the
  // STAMP CONTROL first: `75/75 \`<tier>\``. A reader that demanded the tier
  // token immediately after the colon would have refused every verdict written
  // under the rule it enforces, on day one.
  t('⭐ the LIVE value shape — stamp control, then the tier — reads at tier and stands', servedTierStands(readServedTier(`Served-tier: 75/75 \`${CONTRACT_REVIEW_TIER_NAME}\``)));
  t('…and the count is READ, not skipped', JSON.stringify(readServedTier(`Served-tier: 138/138 \`${CONTRACT_REVIEW_TIER_NAME}\``).stamps) === JSON.stringify({ atTier: 138, total: 138 }));
  t('…on a bulleted, bolded key too — the shape the seats actually post', servedTierStands(readServedTier(`- **Served-tier:** 102/102 \`${CONTRACT_REVIEW_TIER_NAME}\``)));
  t('⛔ a ZERO control is void — a zero counts only against a non-zero stamp count on the same transcript', servedTierStands(readServedTier(`Served-tier: 0/0 \`${CONTRACT_REVIEW_TIER_NAME}\``)) === false);
  t('⛔ a control that is not TOTAL is 回退证据, and the tier alone does not rescue it', servedTierStands(readServedTier(`Served-tier: 12/133 \`${CONTRACT_REVIEW_TIER_NAME}\``)) === false);
  t('⛔ …and that is a C7 row, whose text names the count rather than only the tier', says(c7ServedTierBelow(bare({ prComments: [SERVED(`12/133 \`${CONTRACT_REVIEW_TIER_NAME}\``)] })), '12/133') && says(c7ServedTierBelow(bare({ prComments: [SERVED(`12/133 \`${CONTRACT_REVIEW_TIER_NAME}\``)] })), '回退证据'));
  t('⛔ a count with NO tier after it declares no tier — unreadable, never a reading', readServedTier('Served-tier: 75/75').state === 'unreadable');
  t('⭐ an ABSENT control is vacuous, never a refusal — the ruling\'s minimum is the tier alone', readServedTier(`Served-tier: \`${CONTRACT_REVIEW_TIER_NAME}\``).stamps === null && servedStampsHold(null));
  t('the control is judged by ONE predicate the row and the note both read', servedStampsHold({ atTier: 5, total: 5 }) && !servedStampsHold({ atTier: 5, total: 6 }) && !servedStampsHold({ atTier: 0, total: 0 }));
  t('⛔ a below-tier value with a PERFECT control is still refused — the control never substitutes for the tier', typeof c7ServedTierBelow(bare({ prComments: [SERVED('99/99 example-below-tier')] })) === 'string');
  t('the reference fixture itself carries the live shape, so the clean pair is clean for the right reason', says(RECORD_ON_9AF9.body, '121/121') && pairRows(completed).length === 0);

  // -- #18174: the reading is a fact about the RECORD, not about the clear ---
  //
  // ★ The defect, measured on one board in one day and one spelling: record
  // 5661052272 (objectstack PR #18157 / card #17991, never declared `Clause-②:
  // yes`, gate never hung) carried the continuation form below, which this
  // file's own `readServedTier` answers `unreadable` for -- and `--pair`
  // answered 0, so it stood as the review of record for a landing on
  // `origin/main`. The SAME spelling on objectui PR #9486 / card #9191 (record
  // 5662548425) was refused exit 4 with C7's text, because THAT pair's gate had
  // been hung and cleared. One rule, two answers, decided by a fact the rule
  // (「无此行不成裁决」) does not mention.
  //
  // ⛔ The pins below move no accept set and no recognition: every case reads
  // the SAME `readServedTier`, the SAME heading/head-sha recognition and the
  // SAME one accepted token. What they pin is the POPULATION -- and, beside it,
  // the three things that did NOT widen: C6's row, the sweep's read budget and
  // the note's prescription.
  battery('#18174: the `Served-tier:` reading on EVERY pair that has a record, never only beside a gate clear');
  const MEASURED_SPELLING = `2433/2444, then \`${CONTRACT_REVIEW_TIER_NAME}\``;
  // A NON-GATED pair: `Clause-②: no`, bare on both carriers, no event stream --
  // `needsRecordRead` false, which is exactly the pair the old reader skipped.
  const nonGated = (rows) => pair({ pr: 18157, card: 17991, draft: false, headSha: HEAD_9AF9, prComments: rows });
  const MEASURED_RECORD = SERVED(MEASURED_SPELLING, '2026-09-14T08:17:29Z', 3501);
  const measuredRow = c7ServedTierBelow(nonGated([MEASURED_RECORD]));
  t('⭐ THE MEASURED PAIR — a NON-GATED pair whose record carries the continuation spelling is a C7 row, where it answered 0', typeof measuredRow === 'string');
  t('…and the reading behind it is `unreadable`, the same one the gated pair was refused on', readServedTier(`Served-tier: ${MEASURED_SPELLING}`).state === 'unreadable');
  t('⇒ ONE spelling now reads the SAME on a gated and a non-gated pair — the defect was one rule with two answers', typeof c7ServedTierBelow(bare({ prComments: [MEASURED_RECORD] })) === 'string');
  t('…and the row names the record rather than a clear this pair never had', says(measuredRow, 'no clear rides on it') && !says(measuredRow, 'the verdict the clear stands on'));
  t('…while the completed pair\'s row still names the clear it really does stand under', says(c7ServedTierBelow(bare({ prComments: [SERVED(BELOW)] })), 'the verdict the clear stands on'));
  t('…and it quotes the rule text and the remedy unchanged — widened in POPULATION only', says(measuredRow, '无此行不成裁决') && says(measuredRow, 'The NEWEST heading comment on this head governs'));
  t('⭐ the LIVE shape on the same non-gated pair earns NO row — the reader refuses the defect, not the record', c7ServedTierBelow(nonGated([RECORD_ON_9AF9])) === null);
  t('…including the minimum the ruling permits, the tier alone with no stamp control', c7ServedTierBelow(nonGated([SERVED(`\`${CONTRACT_REVIEW_TIER_NAME}\``, '2026-09-15T02:55:31Z', 3502)])) === null);
  // the populations that did NOT widen
  t('⛔ a non-gated pair with NO record is silent on BOTH rows — C6\'s 「not-owed」 is untouched', c7ServedTierBelow(nonGated([])) === null && c6NoReviewOfRecord(nonGated([])) === null);
  t('…and is not UNJUDGED either: nothing was owed, and nothing was missing', locatedRecordUnjudged(nonGated([])) === null && pairUnjudged(nonGated([])) === null);
  t('⛔ C6 does not follow C7 into the widened population — an absent record on a pair that owes none is no row', c6NoReviewOfRecord(nonGated([])) === null && reviewOfRecord(nonGated([])).state === 'not-owed');
  // Neither authorship line, so C4 reads it as the legacy verdict it is and
  // stays silent: what this fixture isolates is the record's own state.
  const UNSIGNED_OFF_TIER = RECORD(HEAD_9AF9, [TIER_LINES(BELOW)[2]], '2026-09-14T08:17:29Z', 3503);
  t('⛔ an UNSIGNED record on a non-gated pair is judged by neither row — C7 speaks only about a record the locator FOUND', pairRows(nonGated([UNSIGNED_OFF_TIER])).length === 0, JSON.stringify(locateReviewOfRecord(nonGated([UNSIGNED_OFF_TIER])).state));
  t('…and the same unsigned record on a pair that OWES one is C6\'s row, exactly as before', pairRows(bare({ prComments: [UNSIGNED_OFF_TIER] })).map((r) => r.code).join(',') === 'C6');
  t('⇒ C6 and C7 can never both fire on the widened population either', [nonGated([]), nonGated([RECORD_ON_9AF9]), nonGated([UNSIGNED_OFF_TIER]), nonGated([MEASURED_RECORD])].every((x) => pairRows(x).filter((r) => r.code === 'C6' || r.code === 'C7').length <= 1));
  // 「清标前」 — the moment the rule text puts this reading at
  const stillHung = (rows) => pair({ headSha: HEAD_9AF9, prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')], prComments: rows });
  t('a pair STILL CARRYING the gate, with a record already on the head, IS a row — the rule reads 「清标前」', typeof c7ServedTierBelow(stillHung([SERVED(BELOW, '2026-09-01T08:50:00Z', 3504)])) === 'string');
  t('…and one whose review is genuinely pending has no record yet and stays silent', c7ServedTierBelow(stillHung([])) === null);
  // the note: it prints on the widened population, and prescribes nothing there
  const ungatedNote = pairNotes(nonGated([RECORD_ON_9AF9]));
  t('the C6-RECORD note prints on a non-gated pair, so exit 0 says WHICH record was read', ungatedNote.map((n) => n.code).join() === 'C6-RECORD' && says(ungatedNote[0]?.text, 'comment 3301'));
  t('…and prescribes no clear this pair does not owe', says(ungatedNote[0]?.text, 'owes no clear') && !says(ungatedNote[0]?.text, '凡清标同笔留'));
  t('…while the completed pair still gets the citation half — that act is C6\'s and stays C6\'s', says(pairNotes(completed)[0]?.text, '引记录 id 与所判 head'));
  // the read the landing path BUYS, and the gap that read owes
  t('a non-gated pair whose PR thread could not be read is UNJUDGED on the landing path, never clean', says(locatedRecordUnjudged(nonGated(null)), 'comment thread') && c7ServedTierBelow(nonGated(null)) === null);
  t('…and a head sha too short to match is a gap there too, never an absent record', says(locatedRecordUnjudged(pair({ headSha: 'abc', prComments: [] })), 'head sha'));
  t('⛔ a pair that OWES the record is skipped there — `pairUnjudged` owns that gap, so no gap is reported twice', locatedRecordUnjudged(bare({ prComments: null })) === null && says(pairUnjudged(bare({ prComments: null })), 'review-of-record read'));
  t('⛔ and the SWEEP\'s cost bound is unmoved — a non-gated pair still owes no thread there', needsRecordRead(nonGated([MEASURED_RECORD])) === false);
  // ⚠️ The CONSEQUENCE for C4, pinned in both directions rather than left to
  // be discovered: the landing path now has the PR thread for every pair, and
  // `verdictThreadRows` reads what is in hand, so a verdict that was invisible
  // there is judged for the independence pair it declares. Nothing about C4
  // moved; what moved is which threads a `--pair` run has read.
  const SELF_RECORD = RECORD(HEAD_9AF9, [
    `- **Implemented-by:** \`${RECORD_SESSION}\``,
    `- **Reviewed-by:** \`${RECORD_SESSION}\``,
    TIER_LINES(CONTRACT_REVIEW_TIER_NAME)[2],
  ], '2026-09-14T08:17:29Z', 3505);
  t('⚠️ a SELF-REVIEWED record on a non-gated pair is now C4\'s row on the landing path — the thread is in hand, so it is read', pairRows(nonGated([SELF_RECORD])).map((r) => r.code).join(',') === 'C4', JSON.stringify(pairRows(nonGated([SELF_RECORD])).map((r) => r.code)));
  t('…and the INDEPENDENT record on the same pair stays clean — the live control\'s own shape, whole', pairRows(nonGated([RECORD_ON_9AF9])).length === 0 && pairUnjudged(nonGated([RECORD_ON_9AF9])) === null);
  t('⛔ and a SWEEP still cannot see it: with no PR thread bought, C4 reads the card thread alone, exactly as before', c4VerdictSelfReview(pair({ headSha: HEAD_9AF9 })) === null);
  // one comment, chosen once, by one recognition
  const bothRead = bare({ prComments: [RECORD_ON_9AF9] });
  t('the locator and the gated reader choose ONE comment — same id, same head span, on the pair where both answer', JSON.stringify([locateReviewOfRecord(bothRead).id, locateReviewOfRecord(bothRead).sha]) === JSON.stringify([reviewOfRecord(bothRead).id, reviewOfRecord(bothRead).sha]));
  t('⛔ and off that population the gated reader still answers `not-owed` — C6\'s scope is unmoved by the split', reviewOfRecord(nonGated([MEASURED_RECORD])).state === 'not-owed' && locateReviewOfRecord(nonGated([MEASURED_RECORD])).state === 'found');

  // -- #18536: the lane-keyed owed population -----------------------------------
  //
  // ★ The maintainer's lane rule, restated on #18536: the contract review at
  // the contract-review tier is owed in the spec and skills lanes on EVERY
  // delivered round, `yes` or `no`, and in no other lane. The measured pair is
  // the card's own: PRs #18530 / #18529 (cards #18010 / #18301, `domain:spec`,
  // `Clause-②: no`) read 0 here with no record on either head. What is pinned:
  // the two-lane constant; the `no` rounds of those lanes now OWE the record
  // (a row when absent, the note when found, UNJUDGED when unreadable); a `no`
  // anywhere else still owes none; and a cleared `yes` outside the two lanes
  // keeps its row and its exit while its remedy becomes lane ROUTING -- never
  // a self-review, never an at-tier subagent spawned from that lane.
  battery('#18536: the lane-keyed owed population — spec and skills owe the record on EVERY round, other lanes owe none, a `yes` outside them is spec-lane work');
  const SPEC = 'domain:spec';
  const SKILLS = 'domain:skills';
  const CLI = 'domain:cli';
  t('the owing lanes are exactly spec and skills — the maintainer\'s two, frozen', JSON.stringify(LANES_OWING_REVIEW) === JSON.stringify([SPEC, SKILLS]) && Object.isFrozen(LANES_OWING_REVIEW));
  t('a `domain:spec` card owes the review', laneOwesReview(pair({ cardLabels: [SPEC] })) === true);
  t('a `domain:skills` card owes it too', laneOwesReview(pair({ cardLabels: [SKILLS, 'priority:p2'] })) === true);
  t('⛔ a `domain:cli` card owes none — 「余车道零契约复核」', laneOwesReview(pair({ cardLabels: [CLI] })) === false);
  t('⛔ a card with NO `domain:*` label owes none — the existing fixtures\' assumption, pinned', laneOwesReview(pair({ cardLabels: [] })) === false);
  t('⛔ unreadable card labels answer null, never a lane — the labels gap is already UNJUDGED', laneOwesReview(pair({ cardLabels: null })) === null && says(pairUnjudged(pair({ cardLabels: null })), 'labels'));
  // the `no` rounds of the two lanes: the measured pair, in fixture form
  const laneNo = (labels, rows) => pair({ pr: 18530, card: 18010, draft: true, headSha: HEAD_9AF9, cardLabels: labels, cardComments: [CLAIM('Clause-②: no')], prComments: rows });
  t('⭐ THE MEASURED PAIR — a spec-lane `no` round OWES the review-of-record read', needsRecordRead(laneNo([SPEC], [])) === true);
  t('…and a skills-lane `no` round owes it too', needsRecordRead(laneNo([SKILLS], [])) === true);
  t('⛔ a cli-lane `no` round owes none — the population widened by lane, not to every `no`', needsRecordRead(laneNo([CLI], [])) === false && needsRecordRead(laneNo([], [])) === false);
  const specNoRow = c6NoReviewOfRecord(laneNo([SPEC], []));
  t('⭐ a spec-lane `no` round with NO record on the head is a C6 row — where it answered 0', typeof specNoRow === 'string' && pairRows(laneNo([SPEC], [])).map((r) => r.code).join(',') === 'C6');
  t('…that names the declaration, the lane and the head, and says NO review of record', says(specNoRow, 'Clause-②: no') && says(specNoRow, SPEC) && says(specNoRow, HEAD_9AF9) && says(specNoRow, 'NO review of record'));
  t('…and carries the lane rule — every round, `yes` or `no`, draft and out of the queue until the record exists', says(specNoRow, 'EVERY round') && says(specNoRow, '`Clause-②: yes` or `no`') && says(specNoRow, 'draft and out of the queue'));
  t('…and the remedy is the lane\'s review at tier, in-seat or by the at-tier subagent, with the unavailable-tier state and its one bypass named', says(specNoRow, 'in-seat') && says(specNoRow, 'at-tier review subagent') && says(specNoRow, 'cannot start') && says(specNoRow, 'only bypass'));
  t('…and it does NOT describe a clear this round never had', !says(specNoRow, 'bound and cleared') && !says(specNoRow, 'beside the clear'));
  t('…while keeping the shape, the verdict-agnostic boundary and the never-writes clause', says(specNoRow, '## Contract review') && says(specNoRow, 'Reviewed-by:') && says(specNoRow, 'PASS half') && says(specNoRow, '自查放行'));
  t('a skills-lane `no` round reads the same row', pairRows(laneNo([SKILLS], [])).map((r) => r.code).join(',') === 'C6' && says(c6NoReviewOfRecord(laneNo([SKILLS], [])), SKILLS));
  t('⛔ a cli-lane `no` round with no record is silent on every row and not UNJUDGED — nothing owed, nothing missing', pairRows(laneNo([CLI], [])).length === 0 && pairUnjudged(laneNo([CLI], [])) === null && locatedRecordUnjudged(laneNo([CLI], [])) === null);
  // the record, found: the note, and nothing prescribed that a `no` round does not owe
  const specNoFound = laneNo([SPEC], [RECORD_ON_9AF9]);
  t('a spec-lane `no` round WITH its record is clean — no row, and the landing check answers 0', pairRows(specNoFound).length === 0 && pairUnjudged(specNoFound) === null);
  const specNoNote = pairNotes(specNoFound);
  t('…and prints the C6-RECORD note naming the comment', specNoNote.map((n) => n.code).join() === 'C6-RECORD' && says(specNoNote[0]?.text, 'comment 3301'));
  t('…that says the LANE owes this record, `no` included, and prescribes no clear-citation this round has no clear for', says(specNoNote[0]?.text, 'every round this lane delivers') && says(specNoNote[0]?.text, '`Clause-②: no` included') && !says(specNoNote[0]?.text, '凡清标同笔留') && !says(specNoNote[0]?.text, 'owes no clear'));
  t('…and reads at tier on C7 as well', says(specNoNote[0]?.text, 'reads at tier on C7'));
  t('an UNSIGNED record on a spec-lane `no` round is C6\'s row, not C7\'s — one fact, one row', pairRows(laneNo([SPEC], [UNSIGNED_OFF_TIER])).map((r) => r.code).join(',') === 'C6');
  t('a below-tier record on a spec-lane `no` round is C7\'s row, not C6\'s — the record was found', pairRows(laneNo([SPEC], [SERVED(BELOW)])).map((r) => r.code).join(',') === 'C7');
  t('⇒ C6 and C7 can never both fire on the lane population either', [laneNo([SPEC], []), laneNo([SPEC], [RECORD_ON_9AF9]), laneNo([SPEC], [UNSIGNED_OFF_TIER]), laneNo([SPEC], [SERVED(BELOW)])].every((x) => pairRows(x).filter((r) => r.code === 'C6' || r.code === 'C7').length <= 1));
  // #4690: unread is never clean, and the gap is owned once
  t('a spec-lane `no` round whose PR thread could not be read is UNJUDGED, never clean — and `pairUnjudged` owns that gap', c6NoReviewOfRecord(laneNo([SPEC], null)) === null && says(pairUnjudged(laneNo([SPEC], null)), 'review-of-record read') && locatedRecordUnjudged(laneNo([SPEC], null)) === null);
  t('the sweep BUYS the thread for a spec-lane `no` round — the set that owes and the set that gets one read one predicate', needsRecordRead(laneNo([SPEC], [])) === true);
  // the cleared `yes`, by lane: the row and its exit are unmoved; the remedy is not
  t('a cleared `yes` INSIDE the spec lane is owed and, absent, is the row it always was — write the review down', needsRecordRead(bare({ cardLabels: [SPEC] })) === true && says(c6NoReviewOfRecord(bare({ cardLabels: [SPEC] })), 'writes down') && !says(c6NoReviewOfRecord(bare({ cardLabels: [SPEC] })), 'lane ROUTING'));
  t('…and inside the skills lane likewise', says(c6NoReviewOfRecord(bare({ cardLabels: [SKILLS] })), 'writes down'));
  const cliYesRow = c6NoReviewOfRecord(bare({ cardLabels: [CLI] }));
  t('⭐ a cleared `yes` OUTSIDE the two lanes keeps its row and its exit — the `yes` is a limb hit and limb-hit work is owed', needsRecordRead(bare({ cardLabels: [CLI] })) === true && pairRows(bare({ cardLabels: [CLI] })).map((r) => r.code).join(',') === 'C6');
  t('…but its remedy is lane ROUTING, ⛔ not a self-review — re-lane to spec, or correct a false `yes`', says(cliYesRow, 'lane ROUTING') && says(cliYesRow, 'not a self-review') && says(cliYesRow, '`domain:spec`') && says(cliYesRow, 'Clause-②-correction:') && says(cliYesRow, 'whichever seat found it'));
  t('…and it names the card\'s lane, refuses a default-tier record and refuses the at-tier subagent from that lane', says(cliYesRow, CLI) && says(cliYesRow, 'neither writes a default-tier record nor') && says(cliYesRow, 'spawns the at-tier subagent') && !says(cliYesRow, 'writes down the review it already performed'));
  t('…and a card with NO `domain:*` label reads the same routing remedy, saying so', says(c6NoReviewOfRecord(bare({ cardLabels: [] })), 'no `domain:*` label') && says(c6NoReviewOfRecord(bare({ cardLabels: [] })), 'lane ROUTING'));
  t('a cleared `yes` outside the lanes WITH a record found is clean, and the note reports the record without endorsing the lane', pairRows(bare({ cardLabels: [CLI], prComments: [RECORD_ON_9AF9] })).length === 0 && says(pairNotes(bare({ cardLabels: [CLI], prComments: [RECORD_ON_9AF9] }))[0]?.text, 'reported, not endorsed'));
  t('…while the same record inside the spec lane is cited beside the clear with no such warning', says(pairNotes(bare({ cardLabels: [SPEC], prComments: [RECORD_ON_9AF9] }))[0]?.text, '引记录 id 与所判 head') && !says(pairNotes(bare({ cardLabels: [SPEC], prComments: [RECORD_ON_9AF9] }))[0]?.text, 'not endorsed'));
  // the populations that did NOT move
  t('⛔ a `yes` still carrying the gate in the spec lane owes nothing yet — the review is pending, not missing', needsRecordRead(pair({ prLabels: [L], cardLabels: [L, SPEC], cardComments: [CLAIM('Clause-②: yes')] })) === false);
  t('⛔ a never-hung `yes` in the spec lane is C3\'s row, not C6\'s — no row owns a fact twice', needsRecordRead(declaredYes({ cardLabels: [SPEC], cardEvents: [], prEvents: [] })) === false);

  battery('the exit register is distinct in every direction it must be');
  const codes = [EXIT_OK, EXIT_USAGE, EXIT_INCOMPLETE, EXIT_PREREQUISITE_NOT_MET, EXIT_PAIR_ADVERSE];
  t('every exit code is distinct — a verdict can never be read as an environment complaint', new Set(codes).size === codes.length, JSON.stringify(codes));
  t('the adverse-pair code is NOT the prerequisite code', EXIT_PAIR_ADVERSE !== EXIT_PREREQUISITE_NOT_MET);
  t('the prerequisite code is the sibling\'s, imported rather than re-picked', EXIT_PREREQUISITE_NOT_MET === 3);
  // The widening gate is a second file with its own exits; a seat reading `$?`
  // must read ONE table. The pin is written HERE, on the importing side, so the
  // two modules stay acyclic.
  t('the widening gate\'s REFUSED is this file\'s adverse-pair code', WT_EXIT_REFUSED === EXIT_PAIR_ADVERSE);
  t('…its INCOMPLETE is this file\'s INCOMPLETE', WT_EXIT_INCOMPLETE === EXIT_INCOMPLETE);
  t('…and its OK and USAGE agree too', WT_EXIT_OK === EXIT_OK && WT_EXIT_USAGE === EXIT_USAGE);

  // -- the argv contract and the board provenance (#16623) -------------------
  //
  // The card that filed this was itself the failure it describes: its author
  // grepped THIS file for a repo flag, found nothing, and concluded the
  // capability was absent -- while `resolveSweepRepo` sat in the import block.
  // So the cases below pin the two halves that would have answered them: the
  // board says on what basis it is the board, and an argument this file does
  // not honour is refused instead of silently changing nothing.
  battery('the argv contract and the board provenance (#16623)');
  const refusalText = (argv) => (argvRefusalLines(argv) ?? []).join('\n');
  const usageText = usageLines().join('\n');
  const THIS_BOARD = 'objectstack-ai/objectstack';
  const OTHER_BOARD = 'objectstack-ai/objectui';

  // -- (2) --help / -h answer, and answer BEFORE anything is read ------------
  t('--help is recognised', wantsHelp(['--help']) === true);
  t('…and the short spelling seats actually type', wantsHelp(['-h']) === true);
  t('⛔ a bare run is NOT a help request — it is the sweep', wantsHelp([]) === false);
  t('⛔ nor is any other honoured flag', wantsHelp(['--json']) === false && wantsHelp(['--pair', '13910']) === false);
  t('⛔ and help is not refused as an unknown argument', argvRefusalLines(['--help']) === null && argvRefusalLines(['-h']) === null);
  t('the usage text names every flag this file honours, rendered from the table', [...KNOWN_FLAGS.keys()].every((f) => usageText.includes(f)));
  t('…and it names the env var that retargets the board — the fact the filing seat could not find', usageText.includes('PM_SWEEP_REPO'));
  t('…and the runner variable beside it, so the precedence is legible', usageText.includes('GITHUB_REPOSITORY'));
  t('…and the fallback board is the sibling\'s constant, imported rather than retyped', usageText.includes(DEFAULT_SWEEP_REPO));
  t('help exits OK — a question answered is not an error', EXIT_OK === 0);

  // -- (1) the board says on what basis it is the board ----------------------
  t('the default fallback is named AS a fallback', says(boardProvenanceLine({ repo: THIS_BOARD, source: 'default' }), 'source: default'));
  t('…and carries the action that changes it, which is the whole finding', says(boardProvenanceLine({ repo: THIS_BOARD, source: 'default' }), 'set PM_SWEEP_REPO to target another repo'));
  t('an explicit target names PM_SWEEP_REPO as the source', says(boardProvenanceLine({ repo: OTHER_BOARD, source: 'PM_SWEEP_REPO' }), 'source: PM_SWEEP_REPO'));
  t('…and a runner names GITHUB_REPOSITORY', says(boardProvenanceLine({ repo: OTHER_BOARD, source: 'GITHUB_REPOSITORY' }), 'source: GITHUB_REPOSITORY'));
  t('the board itself is in the line in every case', says(boardProvenanceLine({ repo: OTHER_BOARD, source: 'PM_SWEEP_REPO' }), OTHER_BOARD));
  t('⭐ a deliberate target and the fallback are DIFFERENT lines — the defect, in one assertion', boardProvenanceLine({ repo: THIS_BOARD, source: 'default' }) !== boardProvenanceLine({ repo: THIS_BOARD, source: 'PM_SWEEP_REPO' }));
  // Driven through the real resolver, not a hand-built shape: the line and the
  // resolution cannot drift apart, and `source` is proven to be what it renders.
  t('the line is fed by resolveSweepRepo itself, so the two cannot disagree', says(boardProvenanceLine(resolveSweepRepo({ PM_SWEEP_REPO: OTHER_BOARD })), OTHER_BOARD) && says(boardProvenanceLine(resolveSweepRepo({ PM_SWEEP_REPO: OTHER_BOARD })), 'PM_SWEEP_REPO'));
  t('…and a bare environment renders the default leg through that same resolver', says(boardProvenanceLine(resolveSweepRepo({})), 'source: default'));

  // -- (3) an argument this file does not honour is REFUSED ------------------
  t('an unknown flag is REFUSED rather than ignored', argvRefusalLines(['--this-flag-does-not-exist']) !== null);
  t('…and the refusal NAMES it', says(refusalText(['--this-flag-does-not-exist']), '--this-flag-does-not-exist'));
  t('…the filing card\'s own probe — an unknown flag with a value, beside a real one — names the unknown one', says(refusalText(['--issue', '7760', '--json']), '--issue'));
  t('…and every refusal prints what IS honoured, so the next attempt can be right', [...KNOWN_FLAGS.keys()].every((f) => says(refusalText(['--nope']), f)));
  t('…including the env precedence, which is where the filing seat\'s question actually lived', says(refusalText(['--nope']), 'PM_SWEEP_REPO'));
  t('a joined value spelling is refused, showing the spelling this file takes', says(refusalText([`--pair=13910`]), '--pair 13910'));
  t('a stray positional is refused too — this file reads none', says(refusalText(['16623']), '16623'));
  t('…and is pointed at the flag a PR number belongs to', says(refusalText(['16623']), '--pair'));
  t('⭐ but a repo-SHAPED positional is pointed at the mechanism that really retargets the board', says(refusalText([OTHER_BOARD]), `set PM_SWEEP_REPO='${OTHER_BOARD}'`));
  t('…which is exactly what the filing seat reached for and could not find', says(refusalText(['--repo', OTHER_BOARD]), 'PM_SWEEP_REPO'));
  t('⛔ two bad arguments are both named, never just the first', says(refusalText(['--a', '--b']), '--a') && says(refusalText(['--a', '--b']), '--b'));

  // -- every honoured invocation still parses, unchanged ---------------------
  t('a bare run is not refused', argvRefusalLines([]) === null);
  t('--self-test still parses', argvRefusalLines(['--self-test']) === null);
  t('--pair N still parses, and N is its VALUE rather than a stray positional', argvRefusalLines(['--pair', '13910']) === null);
  t('--pair-json <path> still parses', argvRefusalLines(['--pair', '13910', '--pair-json', 'pair.json']) === null);
  t('…and its stdin spelling is a value, not a flag', argvRefusalLines(['--pair', '13910', '--pair-json', '-']) === null);
  t('--json still parses', argvRefusalLines(['--json']) === null);
  t('every honoured flag together still parses', argvRefusalLines(['--pair', '13910', '--pair-json', '-', '--json']) === null);
  t('⛔ a value-taking flag whose value is MISSING never eats the flag after it', argvRefusalLines(['--pair', '--json']) === null);

  // -- the table is what the parse reads, so the two cannot drift ------------
  t('a parse site looks its flag up in the table', flagIndex(['--pair', '1'], '--pair') === 0 && flagIndex([], '--json') === -1);
  t('⛔ and a lookup for a flag NOT in the table throws rather than answering', (() => { try { flagIndex([], '--not-in-the-table'); return false; } catch { return true; } })());
  t('the usage line is rendered from the table, values and all', usageText.includes('--pair-json path'));

  // -- the refusal's exit, against the pinned register -----------------------
  t('an argv refusal exits USAGE, never a verdict code', EXIT_USAGE !== EXIT_OK && EXIT_USAGE !== EXIT_INCOMPLETE && EXIT_USAGE !== EXIT_PAIR_ADVERSE && EXIT_USAGE !== EXIT_PREREQUISITE_NOT_MET);
  t('⛔ and NOT dispatch-gates\' usage exit of 2, which is this file\'s UNJUDGED verdict', EXIT_USAGE === 1 && EXIT_INCOMPLETE === 2);

  // -- #17366: the correction comment, the self-solvable exit ---------------
  //
  // The card's acceptance list, in order: (1) a seat writing per the template
  // gets a machine-readable declaration without knowing this regex; (2) the
  // five prose spellings measured in the filing shift STILL do not read; (3)
  // the state is self-solvable — the claiming seat repairs an unreadable
  // declaration with ONE comment, no edit of the original, no second `Claim:`,
  // nobody outside the repository.
  battery('#17366: the correction comment — the self-solvable exit, and the three things it is not');
  const C_SESSION = 'session_01MCLBsUgfykL74aU716rzVK';
  const C_OTHER_SESSION = 'session_01YKEjmbYNvYWJvWGSWx26zK';
  const C_CLAIM_ID = 5642248126;
  // The claim carrier as the board actually writes it: the template's lines, a
  // comment id, and the `Session:` line the protocol makes mandatory.
  const CLAIMED = (extra, o = {}) => ({
    id: o.id ?? C_CLAIM_ID,
    created_at: o.created_at ?? '2026-09-12T00:41:08Z',
    // ⭐ EQUAL on a comment nobody edited: the default is the unedited control, and an edited fixture names `updated_at` alone (#18892).
    updated_at: o.updated_at ?? o.created_at ?? '2026-09-12T00:41:08Z',
    body:
      `Claim: PM loop round 1\n` +
      (o.session === null ? '' : `Session: \`${o.session ?? C_SESSION}\`\n`) +
      'Branch: `claude/issue-17366-clause2-correction-shape`\n' +
      `${extra ?? ''}`,
  });
  const CORRECTION = (lines, o = {}) => ({
    id: o.id ?? 5650000001,
    created_at: o.created_at ?? '2026-09-12T01:00:00Z',
    body: lines.join('\n'),
  });
  const FIXED_CORRECTION = (value = 'no', o = {}) =>
    CORRECTION(
      [
        `Clause-②-correction: ${o.claimId ?? C_CLAIM_ID}`,
        `Clause-②: ${value}`,
        ...(o.session === null ? [] : [`Session: \`${o.session ?? C_SESSION}\``]),
      ],
      o,
    );

  // (1) The template's line, read by the same reader a seat never has to know.
  const TEMPLATE_LINE = 'Clause-②: yes | no';
  t('⭐ criterion 1: the template\'s key with `no` substituted reads DECLARED', readClause2Line('Clause-②: no')?.value === 'no');
  t('⭐ …and with `yes` substituted', readClause2Line('Clause-②: yes')?.value === 'yes');
  t('…and the template line the seat copies is exactly the fixed key, so the two cannot drift', TEMPLATE_LINE.startsWith('Clause-②:'));
  // ⭐ FLIPPED, as the pre-registration above this line required: the template
  // line copied WITHOUT choosing used to read `yes`, because `readValueToken`
  // took the first token after the colon and treated the rest as the seat's
  // argument — so an UNFILLED template read as a judgement. #17098 refuses the
  // alternation in `readValueToken`, and the case is kept rather than deleted,
  // with its expectation moved: the before-state it recorded is the thing the
  // assertion below is now measuring the absence of.
  //
  // ⚠️ It is `malformed` and ⛔ NOT a describing near miss: the line is an
  // unfilled TEMPLATE — one key, no inline-code span — so the fact about it is
  // that its value slot holds a menu, which is the fact `Clause-②: <yes|no>`
  // has always carried. `clause2LineDescribes` holds the four axes.
  t('⭐ the UNFILLED template line is NOT a declaration — a menu is not a choice (#17098)', readClause2Line(TEMPLATE_LINE)?.kind !== 'declared');
  t('…and it carries NO value: ⛔ the first alternative is never taken as the answer', readClause2Line(TEMPLATE_LINE)?.value !== 'yes' && readClause2Line(TEMPLATE_LINE)?.value !== 'no');
  t('…reading MALFORMED, the same state the angle-bracket placeholder has always read', readClause2Line(TEMPLATE_LINE)?.kind === 'malformed' && readClause2Line('Clause-②: <yes|no>')?.kind === 'malformed');
  t('…and the row quotes the unfilled slot back, so the seat sees what it copied', says(readClause2Line(TEMPLATE_LINE)?.line, 'yes | no'));
  t('⭐ the C2 rows point at the TEMPLATE rather than at a regex', says(missingLine, '〈模板与表〉') && says(noClaim, '〈模板与表〉'));
  t('…and tell the seat to COPY it rather than compose one', says(missingLine, 'COPY the template'));
  t('⛔ and the pointer prescribes no VALUE — the declaration is still the judgement', says(missingLine, 'Do not fill the line in'));

  // (2) The negative control: the five spellings measured on the filing shift.
  // Rows 2-5 of the card's table are one text ("同上") written on four cards, so
  // the set is pinned as five INSTANCES of two distinct spellings and named as
  // such rather than padded into five different strings.
  const MEASURED_PROSE = [
    '`Clause-②` holds at `no`.',            // #1, PR #17289's body
    '条款② **`no`**(复用…)',                 // #2, card #17335's Claim:
    '条款② **`no`**(复用…)',                 // #3, card #17337 — 同上
    '条款② **`no`**(复用…)',                 // #4, card #16659 — 同上
    '条款② **`no`**(复用…)',                 // #5, card #16549 — still unrepaired when the card was filed
  ];
  t('⭐ criterion 2: none of the five measured spellings reads as a declaration', MEASURED_PROSE.every((line) => readClause2Line(line)?.kind !== 'declared'));
  t('⭐ …and none of them declares from a CLAIM comment either', MEASURED_PROSE.every((line) => cardDeclaration([CLAIMED(line)]).state !== 'declared'));
  t('⛔ …nor does the correction mechanism admit one of them: prose in a correction is prose', cardDeclaration([CLAIMED('Domain: x'), CORRECTION([`Clause-②-correction: ${C_CLAIM_ID}`, MEASURED_PROSE[1], `Session: \`${C_SESSION}\``])]).state !== 'declared');
  t('the #1 spelling is reported as a SPELLING near miss, so the residue is quoted back', readClause2Line(MEASURED_PROSE[0])?.reason === 'spelling');
  t('⛔ …and never as an inline-key placement miss — there is no key-plus-colon on that line', readClause2Line(MEASURED_PROSE[0])?.reason !== 'inline-key');
  t('the #2-#5 spelling reaches NO pattern at all — 条款② carries no `Clause` token', readClause2Line(MEASURED_PROSE[1]) === null);
  t('…so its card reads MISSING with no residue to quote, which is a true reading and not a silence', cardDeclaration([CLAIMED(MEASURED_PROSE[1])]).state === 'missing');
  t('⛔ the five instances cover exactly the two carriers the card measured, and both stay unread', readClause2Line(MEASURED_PROSE[0])?.kind !== 'declared' && readClause2Line(MEASURED_PROSE[4])?.kind !== 'declared');
  t('⛔ CONTROL: the accept set did not move — the fixed spelling still reads, in both values', readClause2Line('Clause-②: yes')?.value === 'yes' && readClause2Line('Clause-②: no')?.value === 'no');
  t('⛔ CONTROL: and the tolerated decoration still reads, no wider and no narrower', readClause2Line('> - **`Clause-②`**: `no`')?.value === 'no');

  // (3) Self-solvability, end to end: the state, the one comment, the exit.
  const BROKEN_THREAD = [CLAIMED(MEASURED_PROSE[1])];
  const REPAIRED_THREAD = [CLAIMED(MEASURED_PROSE[1]), FIXED_CORRECTION('no')];
  const brokenPair = pair({ cardComments: BROKEN_THREAD });
  const repairedPair = pair({ cardComments: REPAIRED_THREAD });
  t('⭐ criterion 3, BEFORE: the card reads MISSING — the declaration limb has no reading', cardDeclaration(BROKEN_THREAD).state === 'missing');
  t('⭐ …and `--pair` earns a C2 finding, which is its exit 4', pairRows(brokenPair).some((r) => r.code === 'C2'));
  t('⭐ AFTER one correction comment: the limb reads DECLARED', cardDeclaration(REPAIRED_THREAD).state === 'declared');
  t('⭐ …carrying the seat\'s own value', cardDeclaration(REPAIRED_THREAD).value === 'no');
  t('⭐ …and `--pair` has no C2 finding left to raise', pairRows(repairedPair).every((r) => r.code !== 'C2'));
  t('⛔ and the original claim comment is BYTE-IDENTICAL across the two threads — nothing was edited', BROKEN_THREAD[0].body === REPAIRED_THREAD[0].body);
  t('⛔ the correction is NOT a second `Claim:` — the claim predicate does not match it', CLAIM_COMMENT_MARKER.test(FIXED_CORRECTION().body) === false);
  t('⛔ …so the governing claim does not move, and the card is not re-claimed', governingClaim(REPAIRED_THREAD)?.createdAt === governingClaim(BROKEN_THREAD)?.createdAt);
  t('⛔ nor is the correction read as a MISPLACED declaration — it is the designated second carrier', cardDeclaration(REPAIRED_THREAD).state !== 'misplaced');
  t('the reading PRINTS: a note names the correction rather than answering 0 in silence', typeof c2CorrectionNote(repairedPair) === 'string');
  t('…and STATES the claim comment\'s edit reading, measured from its own two stamps (#18892)', says(c2CorrectionNote(repairedPair), 'UNEDITED'));
  t('…and names the comment id it corrects, so a reader can find it', says(c2CorrectionNote(repairedPair), String(C_CLAIM_ID)));
  t('…and states the attribution ceiling rather than claiming a verification', says(c2CorrectionNote(repairedPair), 'DECLARED identity, never a verified one'));
  t('…and it rides as a NOTE, never as a finding — pairNotes carries it, pairRows does not', pairNotes(repairedPair).some((n) => n.code === 'C2-CORRECTION') && pairRows(repairedPair).every((r) => r.code !== 'C2-CORRECTION'));
  t('the sweep counts a corrected card as DECLARED — neither owing a line nor owing a comment', declarationLimbTally([repairedPair]).missing === 0 && declarationLimbTally([repairedPair]).absent === 0);

  // A wrong VALUE is the same door: the seat has no edit for that either.
  t('⭐ a correction supersedes a READABLE claim declaration too — a wrong value is repairable by the same act', cardDeclaration([CLAIMED('Clause-②: yes'), FIXED_CORRECTION('no')]).value === 'no');
  t('…and the reverse direction reads the same way', cardDeclaration([CLAIMED('Clause-②: no'), FIXED_CORRECTION('yes')]).value === 'yes');
  t('the NEWEST correction naming the governing claim wins', cardDeclaration([
    CLAIMED('Clause-②: yes'),
    FIXED_CORRECTION('no', { id: 1, created_at: '2026-09-12T01:00:00Z' }),
    FIXED_CORRECTION('yes', { id: 2, created_at: '2026-09-12T02:00:00Z' }),
  ]).value === 'yes');
  t('…and an unreadable timestamp falls back to thread order, never to "fresh"', cardDeclaration([
    CLAIMED('Clause-②: yes'),
    FIXED_CORRECTION('yes', { id: 1, created_at: 'not a date' }),
    FIXED_CORRECTION('no', { id: 2, created_at: 'not a date' }),
  ]).value === 'no');

  // Every refusal names an act the claiming seat can perform — ⛔ no branch of
  // this mechanism may be a new one-way door.
  const wrongId = cardDeclaration([CLAIMED(MEASURED_PROSE[1]), FIXED_CORRECTION('no', { claimId: 4242424242 })]);
  t('⛔ a correction naming a comment that is not the governing claim does NOT apply', wrongId.state === 'missing');
  t('…and is ignored with a PRINTED reason, never silently', says(wrongId.correctionNote, 'IGNORED'));
  t('…that names the id to use instead', says(wrongId.correctionNote, String(C_CLAIM_ID)));
  t('…and the C2 row carries it, so a seat that tried is told why it did not land', says(c2DeclarationUnreadable(pair({ cardComments: [CLAIMED(MEASURED_PROSE[1]), FIXED_CORRECTION('no', { claimId: 4242424242 })] })), 'did NOT take effect'));
  const otherSeat = cardDeclaration([CLAIMED(MEASURED_PROSE[1]), FIXED_CORRECTION('no', { session: C_OTHER_SESSION })]);
  t('⛔ a correction from a DIFFERENT session does not apply — no seat declares on another\'s behalf', otherSeat.state === 'missing');
  t('…and the reason names both sessions, so the remedy is executable', says(otherSeat.correctionNote, C_OTHER_SESSION) && says(otherSeat.correctionNote, C_SESSION));
  const noSession = cardDeclaration([CLAIMED(MEASURED_PROSE[1]), FIXED_CORRECTION('no', { session: null })]);
  t('⛔ a correction with no `Session:` line does not apply — it does not say whose act it is', noSession.state === 'missing');
  t('…and the reason names the session to write', says(noSession.correctionNote, C_SESSION));
  const proseCorrection = cardDeclaration([CLAIMED(MEASURED_PROSE[1]), CORRECTION([`Clause-②-correction: ${C_CLAIM_ID}`, MEASURED_PROSE[0], `Session: \`${C_SESSION}\``])]);
  t('⛔ a correction whose declaration is PROSE does not apply — the same reader judges both carriers', proseCorrection.state === 'missing');
  t('…and says so by quoting the fixed spelling rather than by going quiet', says(proseCorrection.correctionNote, 'Clause-②: yes'));
  // ⛔ The one branch that must NOT refuse: a claim with no session leaves
  // nothing to compare, and refusing there would rebuild the door one room over.
  const unverifiable = cardDeclaration([CLAIMED(MEASURED_PROSE[1], { session: null }), FIXED_CORRECTION('no')]);
  t('⭐ a claim carrying no `Session:` line still gets its correction applied — ⛔ no new one-way door', unverifiable.state === 'declared' && unverifiable.value === 'no');
  t('…and the note says attribution could NOT be verified, and why', says(unverifiable.correctionNote, 'ATTRIBUTION NOT VERIFIED'));

  // The shape itself: what is a correction, and what is merely near one.
  t('the correction key tolerates the same decoration the declaration key does', cardDeclaration([CLAIMED(MEASURED_PROSE[1]), CORRECTION([`> - **\`Clause-②-correction\`**: \`${C_CLAIM_ID}\``, 'Clause-②: no', `Session: \`${C_SESSION}\``])]).state === 'declared');
  t('⛔ a MID-LINE correction key is not a correction — the key is read at line start', readClause2Correction({ id: 9, body: `Domain: x · Clause-②-correction: ${C_CLAIM_ID}\nClause-②: no` }) === null);
  t('⛔ a HEADING form is not a correction either', readClause2Correction({ id: 9, body: `## Clause-②-correction: ${C_CLAIM_ID}\nClause-②: no` }) === null);
  t('⛔ nor is the key buried below the first line — a correction is a DEDICATED comment', readClause2Correction({ id: 9, body: `Round report.\nClause-②-correction: ${C_CLAIM_ID}\nClause-②: no` }) === null);
  t('…but a leading BLANK line does not disqualify one', readClause2Correction({ id: 9, body: `\nClause-②-correction: ${C_CLAIM_ID}\nClause-②: no` })?.claimId === String(C_CLAIM_ID));
  t('⛔ a non-numeric id is not the shape — the id is digits, so no angle-bracketed token can be eaten by the sanitizer', readClause2Correction({ id: 9, body: 'Clause-②-correction: the claim above\nClause-②: no' }) === null);
  t('⛔ the correction key never reads as the DECLARATION key — `Clause-②-correction:` is not `Clause-②:`', readClause2Line(`Clause-②-correction: ${C_CLAIM_ID}`)?.kind !== 'declared');
  t('⛔ …and it is not read as an inline-key placement miss either', readClause2Line(`Clause-②-correction: ${C_CLAIM_ID}`)?.reason !== 'inline-key');
  t('a thread with NO correction reads exactly as it always did', cardDeclaration([CLAIMED('Clause-②: no')]).state === 'declared' && cardDeclaration([CLAIMED('Clause-②: no')]).correctionNote === undefined);
  t('⛔ CONTROL: the MISPLACED reading survives — a bare declaration in a NON-correction comment is still misplaced', cardDeclaration([CLAIMED('Domain: x'), { id: 7, body: 'Clause-②: yes', created_at: '2026-09-12T01:00:00Z' }]).state === 'misplaced');

  // The `Session:` reader, which both sides of the attribution comparison use.
  t('the session token is read through the file\'s one SESSION_TOKEN, backticks and all', readSessionId('Session: `session_abc123`') === 'session_abc123');
  t('…with the seat\'s prose allowed to follow it, the Clause-② calibration', readSessionId('Session: `session_abc123` (GitHub `os-sales`, skills seat), claimed at 00:41Z') === 'session_abc123');
  t('⛔ `Claude-Session:` is a different key and is not matched', readSessionId('Claude-Session: https://claude.ai/code/session_abc123') === null);
  t('⛔ a line with no readable token reads null, not a guess', readSessionId('Session: the skills seat') === null);
  t('⛔ and a body with no session line at all reads null', readSessionId('Claim: round 1\nBranch: `claude/issue-1-x`') === null);

  // The exit register is untouched: the correction is a new INPUT to C2, never
  // a new verdict family.
  t('⛔ no new exit code was minted for the correction reading', new Set([EXIT_OK, EXIT_USAGE, EXIT_INCOMPLETE, EXIT_PREREQUISITE_NOT_MET, EXIT_PAIR_ADVERSE]).size === 5);
  t('…and a repaired pair answers with the SAME code a never-broken one does', pairRows(repairedPair).length === pairRows(pair({ cardComments: [CLAIMED('Clause-②: no')] })).length);

  // -- #17149: a claim that parses to ZERO branches ---------------------------
  //
  // The declaration limb's carrier is the GOVERNING claim, and governance is
  // resolved by a branch parse. A newest claim comment naming no parseable
  // branch used to be discarded, and this file then read a declaration off a
  // comment the seat had already replaced — silently, and in BOTH directions:
  // wrong when the two disagreed, and right-for-the-wrong-reason when they
  // agreed. The fixtures below are the MEASURED bodies, quoted rather than
  // paraphrased, so a future widening of the branch reader cannot make this
  // battery pass by accident.
  battery('#17149: a claim that parses to ZERO branches — malformed, never absent');
  // Card #16322, comments 5593513389 (2026-09-08T23:46:51Z) and 5594909614
  // (2026-09-09T02:35:21Z) as posted: the branch named INSIDE the `Claim:`
  // sentence, with no `Branch:` line anywhere. The two declare OPPOSITE values,
  // which is what made the fallback visible at all.
  const INLINE_OLD = {
    id: 5593513389,
    created_at: '2026-09-08T23:46:51Z',
    body:
      'Claim: session_01ADLdAs2pVcH17h9tZKWMBg — branch `claude/issue-16322-analytics-daterange-closed-vocabulary-drivers`\n\n' +
      'Clause-②: no\n',
  };
  const INLINE_NEW = {
    id: 5594909614,
    created_at: '2026-09-09T02:35:21Z',
    body:
      'Claim: session_01ADLdAs2pVcH17h9tZKWMBg — branch `claude/issue-16322-analytics-daterange-closed-vocabulary-drivers`\n\n' +
      'Clause-②: yes\n',
  };
  // The live board, 2026-09-12T02:53Z: the same spelling, a different seat's
  // template, four claims inside three seconds. Card #16175's newest claim is
  // branchless while its 2026-09-06 claim parses — and names a DIFFERENT branch.
  const LIVE_BRANCHLESS = {
    id: 5642984850,
    created_at: '2026-09-12T02:53:06Z',
    body: 'Claim: session_012GKcPZbMoGq7WPzKLfRBTU · claude/issue-16175-staleness-mtime-false-refusal\nClause-②: no\n',
  };
  const LIVE_PARSES = {
    id: 5557414924,
    created_at: '2026-09-06T06:19:06Z',
    body: 'Claim: PM loop\nBranch: `claude/issue-16175-regen-sibling-stale-rules`\nClause-②: no\n',
  };
  const INLINE_THREAD = [INLINE_OLD, INLINE_NEW];
  const unparsedDecl = cardDeclaration(INLINE_THREAD);
  t('⭐ the measured inline spelling reads CLAIM-BRANCH-UNPARSED — the carrier could not be resolved', unparsedDecl.state === 'claim-branch-unparsed');
  t('⛔ …and NOT `declared`: the line that IS on the thread belongs to a comment this run cannot confirm is current', unparsedDecl.state !== 'declared');
  t('⛔ …nor `absent`, which would say no claim comment was written — one was', unparsedDecl.state !== 'absent');
  t('⛔ …nor `missing`, which would send the seat looking for a line that is there', unparsedDecl.state !== 'missing');
  t('…and it carries NO value — an unclassified result is never a reading', unparsedDecl.value === undefined);
  t('the state names the comment it could not parse', unparsedDecl.malformedClaim?.id === 5594909614);
  // The BEFORE-state, quantified rather than recalled: both comments carry a
  // readable line, and they DISAGREE. That is why reading the wrong one was a
  // wrong answer and not merely an unlucky one.
  t('⭐ the superseded comment carried a readable declaration, and the two DISAGREE', readClause2Line(INLINE_OLD.body)?.value === 'no' && readClause2Line(INLINE_NEW.body)?.value === 'yes');
  // The reading PRINTS, and it is UNJUDGED (exit 2) rather than a verdict.
  const unparsedPair = pair({ cardComments: INLINE_THREAD });
  const unparsedGap = pairUnjudged(unparsedPair);
  t('⭐ the pair is UNJUDGED and the reading prints in full — ⛔ never silence', typeof unparsedGap === 'string' && unparsedGap.length > 0);
  t('…naming the comment id, so a reader can open it', says(unparsedGap, '5594909614'));
  t('…and the remedy, which is a `Branch:` line of its OWN', says(unparsedGap, '`Branch:` line of its OWN'));
  t('…and saying in as many words that this is not a declared `no`', says(unparsedGap, 'never a declared `no`'));
  t('…and that a whole shift reading this way is a TEMPLATE fault rather than a typo', says(unparsedGap, 'SEAT TEMPLATE fault'));
  t('⛔ and it raises NO C2 finding — an unclassified result must never be rendered as an adverse verdict', pairRows(unparsedPair).every((r) => r.code !== 'C2'));
  t('⛔ nor any other finding row on this pair', pairRows(unparsedPair).length === 0);
  // The live specimen, and the fallback shape at its sharpest: the older claim
  // names a DIFFERENT branch, so every reader downstream probes the wrong ref.
  const liveDecl = cardDeclaration([LIVE_PARSES, LIVE_BRANCHLESS]);
  t('⭐ the live 2026-09-12 specimen reads the same way', liveDecl.state === 'claim-branch-unparsed');
  t('…and the state names the older claim governance would have fallen back to', liveDecl.governingClaim?.createdAt === '2026-09-06T06:19:06Z');
  t('⚠️ …whose branch is a DIFFERENT one, so the fallback is not even about the same work', liveDecl.governingClaim?.branches.join(',') === 'claude/issue-16175-regen-sibling-stale-rules');
  t('…and the printed gap names that older claim rather than leaving the reader to guess', says(pairUnjudged(pair({ cardComments: [LIVE_PARSES, LIVE_BRANCHLESS] })), 'claude/issue-16175-regen-sibling-stale-rules'));
  // CONTROLS — the accept set did not move in either direction.
  t('⛔ CONTROL: a well-formed newest claim still governs, and its value is read', cardDeclaration([
    { id: 1, created_at: '2026-08-30T09:00:00Z', body: 'Claim: old\nBranch: `claude/issue-1-old`\nClause-②: yes' },
    { id: 2, created_at: '2026-08-31T09:00:00Z', body: 'Claim: new\nBranch: `claude/issue-1-new`\nClause-②: no' },
  ]).value === 'no');
  t('⛔ CONTROL: an OLDER branchless claim is spent and raises nothing — governance is correct', cardDeclaration([
    { id: 1, created_at: '2026-08-30T09:00:00Z', body: 'Claim: session_x · claude/issue-1-old\nClause-②: yes' },
    { id: 2, created_at: '2026-08-31T09:00:00Z', body: 'Claim: new\nBranch: `claude/issue-1-new`\nClause-②: no' },
  ]).state === 'declared');
  t('⛔ CONTROL: #16170\'s bulleted `Branch:` directive still parses, so its card is unaffected', cardDeclaration([
    { id: 1, created_at: '2026-08-31T09:00:00Z', body: 'Claim: PM loop\n- Branch: `claude/issue-15511-zh-gap-helptext`\nClause-②: no' },
  ]).state === 'declared');
  t('⛔ CONTROL: a thread with no claim comment at all still reads ABSENT', cardDeclaration([{ id: 1, body: 'a triage note', created_at: '2026-08-31T10:00:00Z' }]).state === 'absent');
  t('⛔ CONTROL: an unreadable thread still reads UNREADABLE — never the new state', cardDeclaration(null).state === 'unreadable');
  // The new state is nobody else's state: it is counted into neither not-read
  // population and it is not the #16304 fourth reading's `absent`.
  t('the tally counts it under NEITHER not-read population', declarationLimbTally([unparsedPair]).absent === 0 && declarationLimbTally([unparsedPair]).missing === 0);
  t('⛔ …and the fourth reading is unavailable on it — a sibling cannot answer a question this card could not ask', readsSiblingDeclaration(unparsedPair, [unparsedPair, pair({ card: 999, cardComments: [CLAIM('Clause-②: yes')] })]) === false);
  t('⛔ …nor is such a card a CARRIER for a sibling of its own', siblingDeclarations(pair({ card: 999, pr: 13910 }), [pair({ card: 999, pr: 13910 }), { pr: 13910, card: 13476, cardComments: INLINE_THREAD }]).length === 0);
  // ⛔ The fix is the STATE, not a widening: the branch reader's accept set is
  // byte-identical, which is what keeps the next unrecognised spelling loud.
  t('⛔ the branch reader was NOT widened — the inline spelling still parses to zero', claimedBranches(INLINE_NEW.body).length === 0);
  t('⛔ …and the claim marker still matches it, which is what makes the two-anchor split a STATE', CLAIM_COMMENT_MARKER.test(INLINE_NEW.body) === true);

  // -- #17098: the key-INITIAL describing line ------------------------------
  //
  // The one-sided fixture this battery exists to finish is one section up, in
  // the card-level battery: 「a claim comment that only DESCRIBES the line reads
  // MISSING, never declared」. Its case put PROSE BEFORE THE KEY, so the line
  // never matched `CLAUSE2_KEY_LINE` at all and the assertion passed for a
  // reason narrower than the sentence it was written under. The half it did not
  // cover — the key FIRST, after markdown decoration — read `declared`, and the
  // general property the sentence states was false while its own case was green.
  //
  // ⭐ Both halves are now pinned, and they are pinned from the MEASURED
  // specimens rather than from invented ones: the filing card's standing-rules
  // bullet, and the dispatch-template bullet a second seat measured on #17277 /
  // #17290 — where this defect fired in the FAIL-OPEN direction, the declaration
  // limb reading `yes` from the dispatching seat's own boilerplate while
  // `--pair` exited 0 into a landing pre-check.
  battery('#17098: a key-INITIAL line that DESCRIBES the spelling — the half the fixture did not cover');
  // The filing card's specimen (#17098 body), and the second seat's (5636056726).
  const D_CARD_BULLET = '- **`Clause-②: yes` / `Clause-②: no`** — the value alone on its line, machine-read.';
  const D_TEMPLATE_BULLET = '- **`Clause-②: yes|no` must appear in the PR BODY at column 0.** `Check Changeset` reads it there…';
  t('⭐ the filing card\'s own specimen is NOT a declaration', readClause2Line(D_CARD_BULLET)?.kind !== 'declared');
  t('⭐ …and neither is the second seat\'s measured dispatch-template bullet', readClause2Line(D_TEMPLATE_BULLET)?.kind !== 'declared');
  t('⛔ neither yields a value — the defect was a `yes` invented out of a spelling lesson', readClause2Line(D_CARD_BULLET)?.value === undefined && readClause2Line(D_TEMPLATE_BULLET)?.value === undefined);
  t('…both are reasoned DESCRIBING, so the row can say what the seat is looking at', readClause2Line(D_CARD_BULLET)?.reason === 'describing' && readClause2Line(D_TEMPLATE_BULLET)?.reason === 'describing');
  t('⛔ …and NOT `malformed`, which would send the seat to fix a value on a line that claims none', readClause2Line(D_CARD_BULLET)?.kind === 'near-miss' && readClause2Line(D_TEMPLATE_BULLET)?.kind === 'near-miss');
  t('…and each quotes ITS OWN line back, capped, so the residue is actionable', says(readClause2Line(D_CARD_BULLET)?.line, 'machine-read') && says(readClause2Line(D_TEMPLATE_BULLET)?.line, 'column 0'));
  // The card level: the general property, now true of BOTH halves.
  t('⭐ the card-level reading is MISSING on the key-INITIAL half — the property the sentence states', cardDeclaration([CLAIM(D_CARD_BULLET)]).state === 'missing');
  t('⭐ …and on the second seat\'s bullet too', cardDeclaration([CLAIM(D_TEMPLATE_BULLET)]).state === 'missing');
  t('⛔ …carrying no value in either case — this is the fail-OPEN half, where a `yes` reached exit 0', cardDeclaration([CLAIM(D_CARD_BULLET)]).value === undefined && cardDeclaration([CLAIM(D_TEMPLATE_BULLET)]).value === undefined);
  t('…and the prose-FIRST half still reads MISSING, by its own reason — the two halves are one property, not one mechanism', cardDeclaration([CLAIM('the dev declares `Clause-②: yes|no` from the diff')]).state === 'missing' && cardDeclaration([CLAIM('the dev declares `Clause-②: yes|no` from the diff')]).nearMissReason === 'inline-key');

  // -- the two tells, each pinned ALONE so neither can be carrying the other --
  t('TELL 1 — the fixed key named TWICE on one line is a quotation of the spelling', readClause2Line('- Clause-②: yes, or Clause-②: no — pick one')?.reason === 'describing');
  t('TELL 2 — the key inside an inline-code span the line goes on talking outside of', readClause2Line('- `Clause-②: yes` is what a dev writes when the diff touches the spec')?.reason === 'describing');
  t('⛔ TELL 2 is CONTINUATION, not quoting: the quoted declaration ALONE on its line is a declaration', readClause2Line('`Clause-②: yes`')?.value === 'yes');
  t('⛔ …and bolded around the span too — that spelling is what this file\'s own remedy sentence teaches', readClause2Line('**`Clause-②: no`**')?.value === 'no');
  t('⛔ …while a span closed around the KEY was never the shape at all', readClause2Line('`Clause-②`: no — scripts only')?.value === 'no');
  t('the tells are STRUCTURAL — the same words with the markdown removed declare, and the same markdown with other words describes', readClause2Line('Clause-②: yes is what a dev writes when the diff touches the spec')?.value === 'yes' && readClause2Line('- `Clause-②: no` was yesterday\'s answer')?.reason === 'describing');

  // -- the alternation, refused in the VALUE reader rather than here ---------
  t('⭐ a bare alternation is refused: `yes|no` is a menu, not a choice', readClause2Line('Clause-②: yes|no')?.kind !== 'declared');
  t('…in either order, and spaced', readClause2Line('Clause-②: no|yes')?.kind !== 'declared' && readClause2Line('Clause-②: yes | no')?.kind !== 'declared');
  t('…reading MALFORMED, the state `Clause-②: <yes|no>` has always read — one fact, one state', readClause2Line('Clause-②: yes|no')?.kind === 'malformed' && readClause2Line('Clause-②: <yes|no>')?.kind === 'malformed');
  t('⛔ the refusal is ADJACENCY, never a scan: a pipe later in the reasoning is the seat\'s argument', readClause2Line('Clause-②: no — see the table | column two')?.value === 'no');

  // -- SKIPPED, not returned: the scan continues past a describing line ------
  //
  // What a seat had to do BY HAND on three live cards (#17277 · #17290 · #17596)
  // was place a real declaration ABOVE the instructional line, because
  // first-match-wins made position the whole remedy. A describing line is no
  // longer a match, so the order stops mattering.
  t('⭐ a real declaration BELOW a describing bullet is read — first-match no longer stops at a quotation', cardDeclaration([CLAIM(`${D_TEMPLATE_BULLET}\nClause-②: no`)]).value === 'no');
  t('…and ABOVE it, which is what the seat had to do by hand', cardDeclaration([CLAIM(`Clause-②: no\n${D_TEMPLATE_BULLET}`)]).value === 'no');
  t('⛔ …and the two orders now read the SAME — the defect was that they did not', cardDeclaration([CLAIM(`${D_CARD_BULLET}\nClause-②: yes`)]).value === cardDeclaration([CLAIM(`Clause-②: yes\n${D_CARD_BULLET}`)]).value);
  t('a MALFORMED line below a describing one still reads malformed — skipping a quotation is not skipping a failure', cardDeclaration([CLAIM(`${D_CARD_BULLET}\nClause-②: probably`)]).state === 'malformed');

  // -- the row: what the seat is told, and what it is NOT told ---------------
  const describingRow = c2DeclarationUnreadable(pair({ cardComments: [CLAIM(D_TEMPLATE_BULLET)] }));
  t('a claim comment whose only key line is a quotation produces a C2 row', typeof describingRow === 'string');
  t('…that says NO READING, so the state is not dressed up as a verdict', says(describingRow, 'NO READING'));
  t('…and names QUOTING as what the line is doing, rather than sending the seat after a typo', says(describingRow, 'QUOTES the spelling rather than declaring a value'));
  t('⭐ …and says in as many words that there is nothing to fix on the quoted line', says(describingRow, 'nothing to fix on the quoted line'));
  t('⭐ …and that the remedy is a declaration of its OWN, ABOVE it', says(describingRow, 'a declaration of its OWN, ABOVE it'));
  t('…and quotes the line, so the seat can see which one it means', says(describingRow, 'column 0'));
  t('⛔ …and still refuses to fill the value in on the seat\'s behalf', says(describingRow, 'Do not fill the line in'));
  t('⛔ …and is a DIFFERENT sentence from the placement row and from the bare missing row — three residues, three remedies', describingRow !== c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Domain: `domain:cli` · Clause-②: no')] })) && describingRow !== c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Domain: x')] })));
  t('the pair is counted as MISSING in the tally — a not-read declaration, never a clean one', declarationLimbTally([pair({ cardComments: [CLAIM(D_TEMPLATE_BULLET)] })]).missing === 1);
  t('⛔ …and is NOT a carrier for a sibling card — a quotation cannot answer another card\'s question', siblingDeclarations(pair({ card: 999, pr: 13910 }), [pair({ card: 999, pr: 13910 }), { pr: 13910, card: 13476, cardComments: [CLAIM(D_TEMPLATE_BULLET)] }]).length === 0);

  // -- CONTROLS: #12297 and #13914 are not undone by any of the above --------
  //
  // ⛔ Both are deliberate and both were named as un-undoable by the filing
  // card. #12297: reasoning may FOLLOW the value. #13914: the reading is
  // FOUR-valued, and no state collapses into another.
  t('⛔ CONTROL #12297: the token followed by reasoning is still a declaration', readClause2Line('Clause-②: yes — widens the accept set')?.value === 'yes');
  t('⛔ CONTROL #12297: …including the bold-wrapped parenthesised form seats actually write', readClause2Line('**Clause-②: no**(仅移动 import/注释)')?.value === 'no');
  t('⛔ CONTROL #12297: …and reasoning that itself contains backticks — a span the KEY never opened is not the key\'s span', readClause2Line('Clause-②: yes — `packages/spec` moves')?.value === 'yes');
  t('⛔ CONTROL #12297: …and a parenthesised reason after a bulleted, bolded key', readClause2Line('- **Clause-②: no** (scripts only)')?.value === 'no');
  t('⛔ CONTROL: every decoration the key line has always tolerated still declares', ['Clause-②: yes', '> Clause-②: yes', '- Clause-②: yes', '**Clause-②: yes**', '`Clause-②`: yes', '- **`Clause-②`**: **`yes`**', '> - `Clause-②` : yes'].every((l) => readClause2Line(l)?.value === 'yes'));
  t('⛔ CONTROL #13914: all four readings remain reachable and distinct', new Set([
    readClause2Line('Clause-②: yes')?.kind,
    readClause2Line('Clause-②: probably not')?.kind,
    readClause2Line('## Clause ②: **yes**')?.kind,
    String(readClause2Line('Claim: nothing here')),
  ]).size === 4);
  t('⛔ CONTROL #13914: …and the near miss is still three-reasoned, never collapsed to one', new Set([
    readClause2Line('## Clause ②: **yes**')?.reason,
    readClause2Line('Domain: x · Clause-②: no')?.reason,
    readClause2Line(D_CARD_BULLET)?.reason,
  ]).size === 3);
  t('⛔ CONTROL: the accept set moved for DESCRIBING lines only — the two fixed spellings are byte-identical reads', CLAUSE2_VALUES.every((v) => readClause2Line(`Clause-②: ${v}`)?.value === v));
  t('⛔ CONTROL: the near-miss and inline-key reporters are untouched — a mid-line key is still placement, not describing', readClause2Line('Domain: `domain:cli` · Clause-②: no')?.reason === 'inline-key');
  t('⛔ CONTROL: a correction comment\'s own declaration still reads — the describing tells do not reach it', readClause2Correction(FIXED_CORRECTION('no'))?.value === 'no');

  // -- the `pool = claimRows` fallback: measured UNREACHABLE, left alone -----
  //
  // The dispatch pointer asked whether `cardDeclaration`'s
  // `governing.length > 0 ? governing : claimRows` fallback — which reads the
  // FIRST claim comment by thread order rather than the newest — should be made
  // recency-aware. It is measured DEAD after #17149, and a dead branch is a
  // report line rather than a rewrite. The two arms, pinned so the measurement
  // is re-runnable rather than recalled:
  //
  //   `claim` non-null  → it came from a row matching the SAME claim predicate
  //                       `claimRows` filters on, so `governing` always has
  //                       that row in it and is never empty.
  //   `claim` null      → `claimGovernance` returns a null `governing` only
  //                       when no claim row parses a branch, and that same
  //                       condition sets `malformed`, which returns
  //                       `claim-branch-unparsed` ABOVE this line. So a null
  //                       `claim` that reaches here means there were no claim
  //                       comments at all, and `claimRows` is empty too.
  t('⭐ arm 1: a governing claim always leaves a non-empty pool, so the fallback cannot fire', cardDeclaration([
    { id: 1, created_at: '2026-08-30T09:00:00Z', body: 'Claim: old\nBranch: `claude/issue-1-old`\nClause-②: yes' },
    { id: 2, created_at: '2026-08-31T09:00:00Z', body: 'Claim: new\nBranch: `claude/issue-1-new`\nClause-②: no' },
  ]).value === 'no');
  t('⭐ arm 2: every claim branchless ⇒ CLAIM-BRANCH-UNPARSED, returned above the pool', cardDeclaration([
    { id: 1, created_at: '2026-08-30T09:00:00Z', body: 'Claim: session_x · claude/issue-1-old\nClause-②: yes' },
    { id: 2, created_at: '2026-08-31T09:00:00Z', body: 'Claim: session_x · claude/issue-1-new\nClause-②: no' },
  ]).state === 'claim-branch-unparsed');
  t('⭐ arm 2: …and NO claim comment at all ⇒ ABSENT, with an empty pool either way', cardDeclaration([{ id: 1, body: 'a triage note', created_at: '2026-08-31T10:00:00Z' }]).state === 'absent');
  t('⛔ …so no thread reaches this limb with a null governing claim AND a non-empty claim set — the fallback is dead code, left as it stands', cardDeclaration([
    { id: 1, created_at: '2026-08-30T09:00:00Z', body: 'Claim: session_x · claude/issue-1-old\nClause-②: yes' },
  ]).state !== 'declared');

  // -- #17959: POSITION is the LINE, not the body ---------------------------
  //
  // The merged specimen, kept as bytes rather than as a memory of it. PR #17819
  // opens with two closing-keyword lines and a blank one and carries the
  // declaration on line 4; the census that produced the filing card read that
  // body as carrying no declaration, while both gates read `no`. The SAME PR
  // carried the refused shape first — one sentence, two markdown spans — so the
  // accepted and the refused form are pinned here as one pair, against one
  // measured PR, and neither reading is moved by this battery.
  battery('#17959: POSITION is the LINE, not the body — the merged #17819 specimen in both its shapes');
  const P17819_HEAD = 'Fixes #17456\nFixes #17762\n\n';
  const P17819_REASON = ' — the diff adds no exported symbol, no key on a published payload and no registration; '
    + 'it narrows three existing implementations onto the signatures they already declare.';
  const P17819_MERGED = P17819_HEAD + '**Clause-②: no**' + P17819_REASON;
  const P17819_OPENED = P17819_HEAD + '`Clause-②: no`' + P17819_REASON;
  t('⭐ the MERGED body reads DECLARED — bold-wrapped, on line 4, with closing keywords above it', readClause2Line(P17819_MERGED)?.kind === 'declared');
  t('…carrying the value the seat wrote, which is what `Check Changeset` printed on run 34684357221', readClause2Line(P17819_MERGED)?.value === 'no');
  t('…and quoting LINE 4 back, never the first line — the row names the line it actually read', says(readClause2Line(P17819_MERGED)?.line, 'Clause-②: no') && !says(readClause2Line(P17819_MERGED)?.line, 'Fixes'));
  t('⛔ POSITION is the LINE: the same line alone at the top reads identically, and BOTH read `no`', readClause2Line('**Clause-②: no**' + P17819_REASON)?.value === 'no' && readClause2Line(P17819_MERGED)?.value === 'no');
  t('⛔ …and pushing it further down changes nothing either — no line index is consulted', readClause2Line('a\nb\nc\nd\ne\n**Clause-②: no**' + P17819_REASON)?.value === 'no');
  t('⭐ the shape the SAME PR was OPENED with is NOT a declaration — the span opens before the key and the line talks on outside it', readClause2Line(P17819_OPENED)?.kind === 'near-miss');
  t('…reasoned DESCRIBING, the reading `Check Changeset` refused on run 34684118255 at exit 1', readClause2Line(P17819_OPENED)?.reason === 'describing');
  t('⭐ the two bodies differ by exactly the two decoration markers, and the readings differ with them', P17819_MERGED.replace('**Clause-②: no**', '`Clause-②: no`') === P17819_OPENED && readClause2Line(P17819_OPENED)?.kind !== readClause2Line(P17819_MERGED)?.kind);
  t('⛔ the reader is CARRIER-agnostic — the same text on this file\'s own carrier, the claim comment, reads the same', cardDeclaration([CLAIM(P17819_MERGED)]).state === 'declared' && cardDeclaration([CLAIM(P17819_MERGED)]).value === 'no');
  t('⛔ CONTROL: neither reading moved for this card — bold declared and quoted-and-continued described before it too', readClause2Line('**Clause-②: no**')?.value === 'no' && readClause2Line('`Clause-②: no` — yesterday\'s answer')?.reason === 'describing');

  battery('#18042: the copyable record TEMPLATE — the one machine-read artefact with nothing to copy');
  //
  // The card, in one line: `references/contract-review.md` DESCRIBES the record
  // in prose and the skill shipped nothing to copy, so four in-seat records in
  // one session wrote `Implemented-by: branch claude/…`, C4 refused all four as
  // HALF WRITTEN, and two of them reached `main` — where C6 then reads「no
  // review of record on that head」. The remedy this family prescribes
  // elsewhere — COPY the template's line rather than composing one — was
  // unfollowable for this one artefact. So the checker that ENFORCES the shape
  // now EMITS it, and these cases are what make "copy it" a safe instruction:
  // the printed bytes are driven back through the very readers that judge a
  // real record, in both directions.
  const TPL_TEXT = contractReviewTemplateLines().join('\n');
  const TPL_RECORD = contractReviewRecordLines().join('\n');
  const TPL_NULL_HEAD = RECORD_TEMPLATE_PLACEHOLDERS.headSha;
  const TPL_REAL_HEAD = 'a90a9f26794e5a2c34c1eded83ba0e25087e4433';
  // The specimen: PR #17986's `## Contract review` comment 5652813288, whose
  // pair is the measured miss — carried verbatim, and then with the ONE word
  // removed, so the case isolates the defect to the word rather than asserting
  // it. ⛔ The session id is the filing epic's own, not a model identifier.
  const TPL_SPECIMEN = (implemented) => [
    '## Contract review',
    '',
    `\`${TPL_REAL_HEAD}\``,
    '',
    `Implemented-by: ${implemented}`,
    'Reviewed-by: session_015c5G6TmpMKgnusmTpD7Ntt',
    '',
    '**VERDICT: PASS**',
  ].join('\n');

  t('⭐ the PRINTED template round-trips through the reader that judges the real thing', readVerdictAuthorship(TPL_TEXT, TPL_NULL_HEAD)?.kind === 'pair');
  t('…reading the BRANCH placeholder as the implementer, never the prose around it', readVerdictAuthorship(TPL_TEXT, TPL_NULL_HEAD)?.implementedBy === RECORD_TEMPLATE_PLACEHOLDERS.implementedBy);
  t('…and the SESSION placeholder as the reviewer', readVerdictAuthorship(TPL_TEXT, TPL_NULL_HEAD)?.reviewedBy === RECORD_TEMPLATE_PLACEHOLDERS.reviewedBy);
  t('the fenced record ALONE reads the same — the notes around it are not load-bearing', readVerdictAuthorship(TPL_RECORD, TPL_NULL_HEAD)?.kind === 'pair');
  t('⛔ and the notes cannot be mistaken for a second declaration — no key-initial line outside the fence', readVerdictAuthorship(TPL_TEXT, TPL_NULL_HEAD)?.implementedBy === readVerdictAuthorship(TPL_RECORD, TPL_NULL_HEAD)?.implementedBy);
  t('filled in with a real head and real identities, it still reads as a pair', readVerdictAuthorship(contractReviewRecordLines({ headSha: TPL_REAL_HEAD, implementedBy: 'claude/issue-18042-contract-review-record-template', reviewedBy: 'session_01DAcomhvR9kKizeYgg89Vo8' }).join('\n'), TPL_REAL_HEAD)?.implementedBy === 'claude/issue-18042-contract-review-record-template');
  t('its `Served-tier:` line STANDS, read by C7\'s own reader', servedTierStands(readServedTier(TPL_TEXT)));
  t('⛔ carrying the constant\'s NAME — and no model identifier anywhere in the whole output', readServedTier(TPL_TEXT).value === CONTRACT_REVIEW_TIER_NAME && !isModelIdentifierToken(TPL_TEXT));
  t('C6\'s two facts hold: the `## Contract review` heading…', CONTRACT_REVIEW_HEADING_MARKER.test(TPL_TEXT));
  t('…and a head sha in a code span of ITS OWN, which is what makes it findable at all', contractReviewHeadMatch(TPL_TEXT, TPL_NULL_HEAD) === TPL_NULL_HEAD);
  t('⛔ CONTROL: the live corpus spelling puts the KEY inside the span, and then no head is found', contractReviewHeadMatch(`## Contract review\n\n\`Head-sha: ${TPL_REAL_HEAD}\``, TPL_REAL_HEAD) === null);
  t('⛔ the head placeholder is git\'s null oid and prefixes NO real head — an unedited paste is refused, never silently adopted', contractReviewHeadMatch(TPL_TEXT, TPL_REAL_HEAD) === null);
  t('⭐ the measured miss is REFUSED by the same reader — one leading word and the value is gone', readVerdictAuthorship(TPL_RECORD.replace('Implemented-by: `', 'Implemented-by: branch `'), TPL_NULL_HEAD)?.kind === 'malformed');
  t('…and the refusal names the KEY that is unreadable, not the line that is absent', says(readVerdictAuthorship(TPL_RECORD.replace('Implemented-by: `', 'Implemented-by: branch `'), TPL_NULL_HEAD)?.detail, 'Implemented-by'));
  t('⭐ the SPECIMEN, verbatim: the value four in-seat records carried, two of them onto `main`', readVerdictAuthorship(TPL_SPECIMEN('branch claude/issue-17780-plugin-lifecycle-duration-units'), TPL_REAL_HEAD)?.kind === 'malformed');
  t('⭐ …and the SAME record with that one word removed reads clean — the word IS the entire defect', readVerdictAuthorship(TPL_SPECIMEN('claude/issue-17780-plugin-lifecycle-duration-units'), TPL_REAL_HEAD)?.kind === 'pair');
  t('the template SHOWS the rule prose failed to convey, and says it too', says(TPL_TEXT, 'FIRST thing after the colon'));
  t('…naming the refusal a leading word earns, so the note and C4\'s row agree', says(TPL_TEXT, 'HALF WRITTEN'));
  t('the stamp control the rule line traded away survives HERE, where the author copies from', says(TPL_TEXT, '75/75'));
  t('⛔ no angle bracket anywhere in the output — the body sanitizer eats tag-shaped placeholders', !TPL_TEXT.includes('<') && !TPL_TEXT.includes('>'));
  t('⛔ nor an unfilled MENU in the record — one value per slot, never the `yes|no` shape this file refuses', !TPL_RECORD.includes('|'));
  t('`--template` is an honoured flag, so the parse, the usage text and the refusal all know it', KNOWN_FLAGS.has('--template') && argvRefusalLines(['--template']) === null && usageLines().join('\n').includes('--template'));
  t('⛔ …spelled as taking NO value, so it can never eat the argument after it', KNOWN_FLAGS.get('--template').value === null);
  // The branch placeholder is ASSEMBLED in the module body so the derivation
  // does not read it as a dead path population. This pin spells the printed
  // form OUT, here where the scan does not reach, so the assembly can never
  // quietly print something else -- and so a future tidy that re-joins it into
  // one literal is caught by `check:declared-population-live` rather than by
  // nobody. ⛔ Not derived from the constant: a pin written from the thing it
  // pins asserts nothing.
  t('⭐ the printed placeholder is EXACTLY the branch form, assembled or not', says(TPL_RECORD, 'Implemented-by: `claude/issue-NNNN-slug`') && RECORD_TEMPLATE_PLACEHOLDERS.implementedBy === 'claude/issue-NNNN-slug');

  // -- #17919: the remedy's id is THIS card's, or there is none -------------
  //
  // The class in one line: part (3) of the C2 remedy carried a LITERAL comment
  // id — 5642248126, the #17366 specimen — so a verdict about card #17425
  // printed a real `Claim:` comment id belonging to card #17366, and nothing in
  // the output told a reader that. ⛔ Nothing SELECTED that comment: a constant
  // makes no selection, so an `issue_url` guard over a selection would have
  // been a guard that can never fire. The cut is therefore at the ids this file
  // may PRINT: they come from the pool the reading was built from, and each is
  // checked against the card under test first.
  //
  // ⚠️ Every case below is about the digits in a sentence. The states, the rows
  // and the exits are pinned UNMOVED by the controls at the end, because a
  // guard that turned a loud wrong answer into a quiet wrong one would be worse
  // than the defect it closes.
  battery('#17919: the correction remedy names THIS card\'s claim comment, never another card\'s');
  const C19_URL = (n) => 'https://api.github.com/repos/objectstack-ai/objectstack/issues/' + n;
  const C19_CLAIM = (o) => ({
    id: (o && o.id !== undefined) ? o.id : 5650083758,
    issue_url: (o && o.issue_url !== undefined) ? o.issue_url : C19_URL(13476),
    created_at: '2026-09-12T02:00:00Z',
    body: 'Claim: PM loop round R1\nBranch: `claude/issue-13476-unresolvable-engine-403`\n'
      + ((o && o.extra) || 'Domain: `domain:engine`'),
  });
  const C19_ROW = (rows) => c2DeclarationUnreadable(pair({ cardComments: rows }));
  const C19_OWN = C19_ROW([C19_CLAIM()]);
  t('⭐ the remedy names the id of THIS card\'s own claim comment', says(C19_OWN, 'Clause-②-correction: 5650083758'));
  t('…and says which card\'s thread that id was read from, so a reader can check it', says(C19_OWN, 'read from card #13476\'s own thread'));
  t('⛔ …and the #17366 specimen id appears nowhere in it', says(C19_OWN, '5642248126') === false);

  // Every state that prints the remedy, in one sweep. ⚠️ Each row is asserted
  // to EXIST first: `says(null, x) === false` would pass for a row that stopped
  // being printed, which is the vacuous form this battery exists to refuse.
  const C19_STATES = [
    ['misplaced', [C19_CLAIM(), { id: 5650083759, issue_url: C19_URL(13476), body: 'Clause-②: yes', created_at: '2026-09-12T03:00:00Z' }]],
    ['malformed', [C19_CLAIM({ extra: 'Clause-②: Yes' })]],
    ['missing', [C19_CLAIM()]],
    ['missing/describing', [C19_CLAIM({ extra: '- **`Clause-②: yes` / `Clause-②: no`** — the value alone on its line, machine-read.' })]],
    ['missing/inline-key', [C19_CLAIM({ extra: 'Domain: `domain:cli` · Clause-②: no' })]],
  ];
  const C19_RENDERED = C19_STATES.map(([name, rows]) => [name, C19_ROW(rows)]);
  t('⭐ every C2 state that prints the remedy prints a row at all — the controls are not vacuous', C19_RENDERED.every(([, row]) => typeof row === 'string' && row.length > 0), JSON.stringify(C19_RENDERED.map(([n, r]) => [n, typeof r])));
  t('⭐ …and NOT ONE of them carries a comment id from another card', C19_RENDERED.every(([, row]) => !says(row, '5642248126')), JSON.stringify(C19_RENDERED.filter(([, r]) => says(r, '5642248126')).map(([n]) => n)));
  t('…each naming this card\'s own claim comment instead', C19_RENDERED.every(([, row]) => says(row, 'Clause-②-correction: 5650083758')));

  // ⭐ Direction 1 — a guard that SUPPRESSES a correct message is worse than
  // the defect. Nothing is suppressed: the row, its state and its sentence are
  // what they were, and only the id is withheld — loudly.
  const C19_FOREIGN_ROWS = [C19_CLAIM({ id: 5642248126, issue_url: C19_URL(17366) })];
  const C19_FOREIGN = C19_ROW(C19_FOREIGN_ROWS);
  t('⛔ a claim row declaring ANOTHER card as its parent still produces its C2 row — nothing is suppressed', typeof C19_FOREIGN === 'string' && says(C19_FOREIGN, 'NO READING'));
  t('…with the same STATE the same thread earns on its own card — the guard moves no verdict', cardDeclaration(C19_FOREIGN_ROWS, { card: 13476 }).state === cardDeclaration([C19_CLAIM()], { card: 13476 }).state);
  t('⛔ …and that comment\'s id is NOT named in the remedy', says(C19_FOREIGN, 'Clause-②-correction: 5642248126') === false);
  t('⭐ …the drop is LOUD: the row names the comment and the issue it declared', says(C19_FOREIGN, 'Comment 5642248126') && says(C19_FOREIGN, 'declares issue #17366'));
  t('…and still names the key, so the remedy stays performable', says(C19_FOREIGN, 'Clause-②-correction:'));

  // The parent reader, and its same-subject control.
  t('a comment row resolves to the issue its `issue_url` names', commentCardNumber({ issue_url: C19_URL(17366) }) === 17366);
  t('⛔ CONTROL — the SAME reader on the governing claim resolves to the card under test', commentCardNumber({ issue_url: C19_URL(17425) }) === 17425);
  t('a row carrying no `issue_url` states NOTHING about its parent', commentCardNumber({}) === null);
  t('…so absence is not read as a mismatch — only a positive disagreement is', correctionTarget([{ id: 7 }], 13476).id === '7');
  t('…and a positive disagreement withholds the id', correctionTarget([{ id: 7, issue_url: C19_URL(17366) }], 13476).id === null);
  t('…naming the card it declared, so the reason is checkable', correctionTarget([{ id: 7, issue_url: C19_URL(17366) }], 13476).foreign[0].card === 17366);
  t('⛔ FAIL-CLOSED without a card number: an id that cannot be checked is not printed', correctionTarget([{ id: 7 }], null).id === null);
  t('⛔ …and more than one readable id names none of them alone', correctionTarget([{ id: 7 }, { id: 8 }], 13476).id === null);
  t('⛔ …nor does a pool with no ids at all invent one', correctionTarget([{ body: 'Claim: x' }], 13476).id === null);

  // ⛔ Never silent: each no-id branch says which reading produced the gap.
  const C19_TWO = C19_ROW([C19_CLAIM({ id: 11 }), C19_CLAIM({ id: 12 })]);
  t('⭐ two readable ids name NEITHER, and name both as candidates', says(C19_TWO, '11 or 12') && says(C19_TWO, 'Clause-②-correction: 11') === false);
  t('a thread whose claim rows carry no id says so, rather than printing nothing', says(C19_ROW([CLAIM('Domain: x')]), 'found no claim comment id on card #13476'));

  // ⭐ Direction 2 — a pair judged correctly today is judged identically.
  t('⛔ a DECLARED card still reads declared, and still earns NO C2 row', cardDeclaration([CLAIM('Clause-②: no')], { card: 13476 }).state === 'declared' && C19_ROW([CLAIM('Clause-②: no')]) === null);
  t('…and the reading is the same with and without the card number — the guard reads no verdict', cardDeclaration([CLAIM('Clause-②: no')]).value === cardDeclaration([CLAIM('Clause-②: no')], { card: 13476 }).value);
  t('⛔ …an ABSENT thread\'s row is untouched: it names no claim comment to correct in the first place', C19_ROW([{ body: 'a triage note, and nothing that begins a line with the claim key', created_at: '2026-08-31T10:00:00Z' }]) === noClaim);

  // -- #18456: the `--pair` input record ------------------------------------
  //
  // The pins are about the BLOCK's shape rather than about any verdict: what
  // the card measured was two runs that disagreed and could not be compared,
  // so what must not rot is (a) every declared field is present on every exit,
  // (b) the exit-0 and exit-4 blocks carry the SAME keys, and (c) the fields a
  // diff actually turns on — the selected carrier, its body fingerprint and the
  // line read from it — say what they read.
  battery('#18456: the `--pair` input record — the same block on every exit, so two runs that disagree can be diffed');
  const R56_REPO = { valid: true, repo: 'objectstack-ai/objectstack', source: 'default' };
  const R56_TARGETED = { valid: true, repo: 'objectstack-ai/objectui', source: 'PM_SWEEP_REPO' };
  const R56_SELF = { path: '/w/scripts/pm/check-clause2-carriers.mjs', blob: 'a'.repeat(40), bytes: 1234 };
  const R56_NOW = new Date('2026-09-17T12:00:00Z');
  const R56_REQ = [
    { n: 1, channel: READ_PATH_TOKEN, path: '/pulls?state=open&per_page=100&page=1', answer: 'HTTP 200', rows: 100 },
    { n: 2, channel: READ_PATH_PUBLIC, path: '/issues/17425/comments?per_page=100', answer: 'HTTP 403', rows: null },
  ];
  const R56_STATE = (extra = {}) => ({
    tokenPresent: true,
    tokenRetired: null,
    served: new Map([[READ_PATH_TOKEN, 5], [READ_PATH_PUBLIC, 1]]),
    pairJsonSource: null,
    rate: null,
    lastServed: READ_PATH_TOKEN,
    requests: R56_REQ,
    ...extra,
  });
  const R56_CLAIM = (id, createdAt, extra) => ({
    id,
    created_at: createdAt,
    body: `Claim: PM loop round R1\nBranch: \`claude/issue-17425-x\`\n${extra ?? ''}`,
  });
  const R56_GOVERNING = R56_CLAIM(5650083758, '2026-09-13T01:57:23Z', 'Clause-②: no');
  const R56_SUPERSEDED = R56_CLAIM(5622080790, '2026-09-10T16:34:31Z', 'Clause-②: yes');
  const R56_PAIR = (extra = {}) => ({
    pr: 17917,
    card: 17425,
    headSha: 'd7d22bf4bebc4f0065b932556b07a9330d7822b2',
    evidence: 'closing-keyword',
    prBody: 'Fixes #17425\n\nClause-②: no',
    headRef: 'claude/issue-17425-x',
    cardComments: [R56_SUPERSEDED, R56_GOVERNING],
    prComments: [],
    ...extra,
  });
  const R56_BUILD = (pairs, extra = {}) =>
    buildInputRecord({
      repoRes: R56_REPO, mode: '--pair 17917', state: R56_STATE(), pairs, self: R56_SELF, now: R56_NOW,
      node: 'v22.0.0', ...extra,
    });
  // Exit 0 shape (a declaring governing claim), exit 4 shape (the same thread
  // with the governing claim's line unreadable — the MISPLACED state), and a
  // refusal that formed no pair at all.
  const R56_OK = R56_BUILD([R56_PAIR()]);
  const R56_MISPLACED = R56_BUILD([R56_PAIR({
    cardComments: [R56_SUPERSEDED, R56_CLAIM(5650083758, '2026-09-13T01:57:23Z', 'Domain: `domain:spec`')],
  })]);
  const R56_REFUSAL = R56_BUILD(null);
  const R56_LINES = (rec) => renderInputRecord(rec);
  const R56_KEYS = (rec) => R56_LINES(rec).filter((l) => /^[a-z]/.test(l)).map((l) => l.slice(0, l.indexOf(':')));
  const R56_FIELD = (rec, key) => {
    const lines = R56_LINES(rec);
    const at = lines.findIndex((l) => l.startsWith(`${key}: `));
    if (at === -1) return null;
    const out = [lines[at].slice(key.length + 2)];
    for (let i = at + 1; i < lines.length && lines[i].startsWith('  '); i++) out.push(lines[i].trim());
    return out.join('\n');
  };

  t('the block is fenced, so a seat can cut exactly it out of a log', R56_LINES(R56_OK)[0] === INPUT_RECORD_OPEN && R56_LINES(R56_OK).at(-1) === INPUT_RECORD_CLOSE);
  t('every declared RUN field is present, in roster order, on exit 0', INPUT_RECORD_RUN_FIELDS.every((f, i) => R56_KEYS(R56_OK)[i] === f));
  t('…and on a refusal that formed NO pair — the same run half, ⛔ never a shorter block', INPUT_RECORD_RUN_FIELDS.every((f, i) => R56_KEYS(R56_REFUSAL)[i] === f));
  t('every declared PAIR field is present once per derived pair, prefixed by its index', INPUT_RECORD_PAIR_FIELDS.every((f) => R56_KEYS(R56_OK).includes(`pair.1.${f}`)));
  t('⭐ the exit-0 block and the exit-4 (MISPLACED) block carry an IDENTICAL key list — the diffability property this card exists for', R56_KEYS(R56_OK).join('|') === R56_KEYS(R56_MISPLACED).join('|'));
  t('…and the refusal block\'s run half is that same key list, so all three diff against each other', R56_KEYS(R56_REFUSAL).slice(0, INPUT_RECORD_RUN_FIELDS.length).join('|') === R56_KEYS(R56_OK).slice(0, INPUT_RECORD_RUN_FIELDS.length).join('|'));
  t('⛔ a declared field this run never filled RENDERS, with a token saying so — it is never dropped', says(renderInputRecord({ run: {}, pairs: [] }).join('\n'), INPUT_RECORD_UNSET));
  t('…and a block with nothing in it still carries every declared key', INPUT_RECORD_RUN_FIELDS.every((f) => renderInputRecord({ run: {}, pairs: [] }).some((l) => l.startsWith(`${f}: `))));
  t('the roster declares EVERY key the builder fills — a field outside it is a field nothing pins', undeclaredRecordFields(R56_OK).length === 0);
  t('…and one that is outside it is NAMED in the block rather than printed in silence', says(renderInputRecord({ run: { 'run.invented': 'x' }, pairs: [] }).join('\n'), 'record.undeclared: run.invented'));
  t('the board is stated with WHICH source answered — a fallback and a deliberate target are two sentences', says(R56_FIELD(R56_OK, 'board.source'), 'NEITHER PM_SWEEP_REPO') && says(R56_FIELD(R56_BUILD([R56_PAIR()], { repoRes: R56_TARGETED }), 'board.source'), 'PM_SWEEP_REPO — this run was deliberately targeted'));
  t('…and the board VALUE is printed beside it', R56_FIELD(R56_BUILD([R56_PAIR()], { repoRes: R56_TARGETED }), 'board.repo') === 'objectstack-ai/objectui');
  t('the read path is named from the SAME labels every refusal uses', says(R56_FIELD(R56_OK, 'read.plan'), READ_PATH_LABELS[READ_PATH_TOKEN]));
  t('a `--pair-json` run names that path AND the document it was served from', (() => { const r = R56_BUILD([R56_PAIR()], { state: R56_STATE({ pairJsonSource: 'pair.json', served: new Map([[READ_PATH_PAIR_JSON, 6]]) }) }); return says(R56_FIELD(r, 'read.plan'), READ_PATH_LABELS[READ_PATH_PAIR_JSON]) && R56_FIELD(r, 'read.pair-json') === 'pair.json'; })());
  t('…and says the network was not read at all on that path', says(R56_BUILD([R56_PAIR()], { state: R56_STATE({ pairJsonSource: 'pair.json' }) }).run['read.api'], 'no network'));
  t('every request is numbered and carries its channel, its path and the answer', says(R56_FIELD(R56_OK, 'run.requests'), '#1') && says(R56_FIELD(R56_OK, 'run.requests'), '/pulls?state=open&per_page=100&page=1') && says(R56_FIELD(R56_OK, 'run.requests'), 'HTTP 200'));
  t('⭐ a page that came back FULL states its row count — a truncated read and a complete one differ nowhere else', says(R56_FIELD(R56_OK, 'run.requests'), '(100 row(s))'));
  t('a refused request states the status it was refused with', says(R56_FIELD(R56_OK, 'run.requests'), 'HTTP 403'));
  t('⛔ a run that issued NO read says so, rather than rendering an empty field', says(R56_BUILD(null, { state: R56_STATE({ requests: [] }) }).run['run.requests'], 'issued no read at all'));
  t('the SELECTION RULE is printed, not merely applied — two runs must be comparable on the rule too', says(R56_FIELD(R56_OK, 'pair.1.claim.rule'), 'NEWEST') && says(R56_FIELD(R56_OK, 'pair.1.claim.rule'), '`Branch:`'));
  t('…and it is the one constant, so the printed rule cannot drift from the applied one', R56_OK.pairs[0]?.['claim.rule'] === CLAIM_SELECTION_RULE && claimCarrierSelection([]).rule === CLAIM_SELECTION_RULE);
  t('the SELECTED carrier is named by id and by date', says(R56_FIELD(R56_OK, 'pair.1.claim.selected'), '5650083758') && says(R56_FIELD(R56_OK, 'pair.1.claim.selected'), '2026-09-13T01:57:23Z'));
  t('⭐ …with a BODY FINGERPRINT: the one field that tells "same ids, different bytes" apart', says(R56_FIELD(R56_OK, 'pair.1.claim.selected'), 'sha256:') && says(R56_FIELD(R56_OK, 'pair.1.claim.selected'), ' bytes,'));
  t('⭐ …and it MOVES when only the bytes move: same ids, same count, same newest, different verdict', R56_FIELD(R56_OK, 'pair.1.card-comment-ids') === R56_FIELD(R56_MISPLACED, 'pair.1.card-comment-ids') && R56_FIELD(R56_OK, 'pair.1.claim.selected') !== R56_FIELD(R56_MISPLACED, 'pair.1.claim.selected'));
  t('every REJECTED candidate is named, with the reason it is not the carrier', says(R56_FIELD(R56_OK, 'pair.1.claim.rejected'), '5622080790') && says(R56_FIELD(R56_OK, 'pair.1.claim.rejected'), 'SUPERSEDED'));
  t('…and a thread whose claims are all in the pool says THAT, rather than going quiet', says(R56_BUILD([R56_PAIR({ cardComments: [R56_GOVERNING] })]).pairs[0]?.['claim.rejected'], 'none — every claim comment'));
  t('a claim that parses ZERO branches leaves NO carrier, and the block names that claim', (() => { const r = R56_BUILD([R56_PAIR({ cardComments: [{ id: 7, created_at: '2026-09-13T05:00:00Z', body: 'Claim: round R2\nClause-②: no' }] })]); return says(r.pairs[0]?.['claim.selected'], 'parses ZERO branches') && says(r.pairs[0]?.['claim.selected'], '7'); })());
  t('an UNREAD thread reads UNREAD, ⛔ never 0 rows', says(R56_BUILD([R56_PAIR({ cardComments: null })]).pairs[0]?.['card-comments'], 'UNREAD'));
  t('the line READ from the carrier is stated — declared, near miss or nothing', says(R56_FIELD(R56_OK, 'pair.1.claim.clause2-line'), 'DECLARED `no`') && says(R56_MISPLACED.pairs[0]?.['claim.clause2-line'], 'no line in this body reaches the reader'));
  t('a short id list is printed whole; a long one keeps its FIRST, its LAST and the true count', renderIdList([{ id: 1 }, { id: 2 }]) === '1,2' && says(renderIdList(Array.from({ length: 40 }, (_, i) => ({ id: i + 1 }))), '1 … 40 (40 ids'));
  t('the NEWEST row is the newest by `created_at`, ⛔ not the last row the API returned', newestRow([{ id: 2, created_at: '2026-09-13T09:00:00Z' }, { id: 1, created_at: '2026-09-13T01:00:00Z' }])?.id === 2);
  t('…and an unreadable stamp falls back to thread order, the recency rule the carrier selection uses', newestRow([{ id: 1, created_at: 'nonsense' }, { id: 2, created_at: 'nonsense' }])?.id === 2);
  t('the PAIRING quotes the body line it was derived from', says(R56_FIELD(R56_OK, 'pair.1.derivation'), 'closing-keyword') && says(R56_FIELD(R56_OK, 'pair.1.derivation'), 'Fixes #17425'));
  t('…and the branch-name fallback names the head ref instead of quoting a line that does not exist', says(R56_BUILD([R56_PAIR({ evidence: 'branch-name', prBody: 'no declaration at all' })]).pairs[0]?.derivation, 'head.ref: claude/issue-17425-x'));
  t('the PR-BODY line is read and stated — ⛔ and stated as an INPUT, never as a limb', says(R56_FIELD(R56_OK, 'pair.1.pr-body.clause2-line'), 'DECLARED `no`') && says(R56_FIELD(R56_OK, 'pair.1.pr-body.clause2-line'), '⛔ no row here judges the PR body'));
  t('the blob hash is git\'s, so `git hash-object` on the path the block names verifies it', gitBlobSha1('') === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' && gitBlobSha1('hello') === 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  t('…and this run states the file it ran FROM, which is what "the same blob on both sides" needs', says(R56_FIELD(R56_OK, 'run.script.path'), 'check-clause2-carriers.mjs') && says(R56_FIELD(R56_OK, 'run.script.blob'), 'git hash-object'));
  t('a source this run could not read says so, rather than printing a hash of nothing', says(buildInputRecord({ self: { path: '/x', blob: null, bytes: null, reason: 'ENOENT' } }).run['run.script.blob'], 'UNREAD'));
  // ⛔ CONTROLS — the record reads no verdict and derives no second selection.
  t('⛔ CONTROL: the selection the block prints IS the pool `cardDeclaration` judged — ONE derivation', (() => { const rows = [R56_SUPERSEDED, R56_GOVERNING]; const sel = claimCarrierSelection(rows); return sel.pool.length === 1 && sel.pool[0] === R56_GOVERNING && cardDeclaration(rows).value === 'no'; })());
  t('⛔ CONTROL: building the record changes no reading — the same rows read the same way after it', (() => { const rows = [R56_SUPERSEDED, R56_GOVERNING]; const before = cardDeclaration(rows).state; buildInputRecord({ pairs: [R56_PAIR()] }); return cardDeclaration(rows).state === before; })());
  t('⛔ CONTROL: the record carries no verdict, no exit code and no finding row', !says(R56_LINES(R56_OK).join('\n'), 'exit ') && !says(R56_LINES(R56_OK).join('\n'), 'PASS'));

  // -- #18701: ONE thread set -- what the template STATES, the guard READS -----
  //
  // ⭐ THE PIN THE CARD ASKS FOR, and it is a MEASUREMENT rather than two lists
  // written side by side. The stated set is read out of the text `--template`
  // actually prints; the read set is obtained by DRIVING
  // `check-governed-queue-guard.mjs` once per thread, with a record copied from
  // this file's own template sitting on that thread ALONE. Edit either side by
  // itself -- drop a location from the sentence, or stop the guard fetching a
  // carrier -- and the two sets stop matching here.
  //
  // ⛔ The guard is imported LAZILY, from a function body. This file reaches
  // that module at module scope already (through `check-half-states.mjs`'s
  // top-level await), so the import below is a cache hit; what it must never
  // become is a top-level `await` in the dispatch, which that guard's own
  // docblock records as an exit-13 deadlock for BOTH modules.
  battery('#18701: ONE thread set -- what the template STATES is what the queue guard READS');
  const GUARD = await import('./check-governed-queue-guard.mjs');
  const TEMPLATE_TEXT = contractReviewTemplateLines().join('\n');
  const THREAD_SET = REVIEW_OF_RECORD_THREADS.map((thread) => thread.where).join();

  // STATED -- read off the printed instruction, never restated here.
  const stated = REVIEW_OF_RECORD_THREADS.filter((thread) => TEMPLATE_TEXT.includes(thread.words)).map((thread) => thread.where).join();

  // READ -- measured by driving the guard's references tier, one run per thread.
  const PIN_HEAD = 'dead1234beef5678'.padEnd(40, '0');
  const PIN_PR = 4101;
  const PIN_CARD = 4102;
  // ⭐ The fixture record IS what `--template` tells a seat to paste, so this
  // pin also answers "is the thing we tell them to copy accepted where we tell
  // them to put it" -- in both places, on the same run.
  const PIN_RECORD = {
    id: 7701,
    created_at: '2026-09-16T10:00:00Z',
    body: contractReviewRecordLines({ headSha: PIN_HEAD, reviewedBy: 'session_01PINSEAT' }).join('\n'),
  };
  // A Tier S path (the register's `.claude/**` row since #19133; the fact layer
  // under it was the whole tier under #18020). The control below asks the
  // register, so a row moving tiers reddens here instead of silently driving
  // the approval leg.
  const TIER_S_PATH = '.claude/skills/pm-dispatch/references/contract-review.md';
  t('⛔ CONTROL: the fixture path is Tier S under the register, so the record leg is the one being driven', GUARD.governedTierFor([TIER_S_PATH]) === GUARD.TIER_S);
  const pinRun = async (where) => {
    const threadsRead = [];
    const verdict = await GUARD.runGuard({
      event: GUARD.EVENT_MERGE_GROUP,
      rows: [{ sha: 'e'.repeat(40), subject: `x (#${PIN_PR})`, pr: PIN_PR, paths: [TIER_S_PATH] }],
      fetchReviews: async () => [],
      fetchPull: async () => ({ sha: PIN_HEAD, body: `Fixes #${PIN_CARD}`, headRef: `claude/issue-${PIN_CARD}-x` }),
      fetchComments: async (n) => {
        threadsRead.push(n);
        return (n === PIN_PR ? 'PR' : 'card') === where ? [PIN_RECORD] : [];
      },
      loadRecognisers: GUARD.loadRecordRecognisers,
    });
    return { verdict, threadsRead, record: verdict.entries[0]?.record ?? null };
  };
  const pinRuns = [];
  for (const thread of REVIEW_OF_RECORD_THREADS) pinRuns.push([thread.where, await pinRun(thread.where)]);
  const readSet = pinRuns.filter(([, r]) => r.verdict.exitCode === GUARD.EXIT_CLEAR && r.record?.state === 'stands').map(([where]) => where).join();

  t(`⭐ the set the TEMPLATE states IS the set the GUARD reads (${THREAD_SET})`, stated === THREAD_SET && readSet === THREAD_SET, `stated=[${stated}] read=[${readSet}]`);
  t('⛔ CONTROL: the pin is not vacuous -- the set has two locations, not one', REVIEW_OF_RECORD_THREADS.length === 2 && stated.includes('PR') && stated.includes('card'));
  t('…and each run located the record on the thread it was posted to, not on the other one', pinRuns.every(([where, r]) => r.record?.where === where), JSON.stringify(pinRuns.map(([w, r]) => [w, r.record?.where])));
  t('…and the guard fetched exactly ONE thread per entry in the set, no more and no fewer', pinRuns.every(([, r]) => r.threadsRead.join() === `${PIN_PR},${PIN_CARD}`), JSON.stringify(pinRuns.map(([, r]) => r.threadsRead)));
  t('⛔ CONTROL: with the record on NEITHER thread the same run is refused -- the pin can fail', await (async () => { const none = await pinRun('nowhere'); return none.verdict.exitCode !== GUARD.EXIT_CLEAR && none.record?.state === 'absent'; })());
  t('the guard prints the location in the WORDS this file owns, so a seat is told one thing', GUARD.REVIEW_OF_RECORD_LOCATION === REVIEW_OF_RECORD_LOCATION && TEMPLATE_TEXT.includes(`ONE comment on ${REVIEW_OF_RECORD_LOCATION}`));

  // The reader itself is built FROM the set, so a thread added to it is a thread
  // searched -- the property the two consumers above rest on.
  const PIN_PAIR = { pr: PIN_PR, card: PIN_CARD, headSha: PIN_HEAD, prComments: [], cardComments: [] };
  t('`locateReviewOfRecord` accounts for EVERY thread in the set, by the keys the set itself declares', (() => { const r = locateReviewOfRecord(PIN_PAIR); return r.state === 'absent' && REVIEW_OF_RECORD_THREADS.every((thread) => Object.hasOwn(r.read, thread.number)); })());
  t('…and a thread the pair does not carry is a GAP named in the words the set itself declares', (() => { const r = locateReviewOfRecord({ ...PIN_PAIR, cardComments: null }); return r.state === 'unreadable' && r.gaps.some((g) => g.includes(`card #${PIN_CARD}`)); })());

  // `deliveredCardNumber` -- the other half the guard needs, and it asks the ONE
  // relation rather than grading evidence a second time.
  const PIN_PULL = (body, ref = 'feat/none') => ({ number: PIN_PR, body, head: { ref } });
  t('a closing keyword names the card', deliveredCardNumber(PIN_PULL(`Fixes #${PIN_CARD}`)).card === PIN_CARD && deliveredCardNumber(PIN_PULL(`Fixes #${PIN_CARD}`)).evidence === 'closing-keyword');
  t('a `Part of` declaration names it too, at its own grade', deliveredCardNumber(PIN_PULL(`Part of #${PIN_CARD}`)).evidence === 'part-of');
  t('the branch name is the fallback, and ONLY when the body declares nothing', deliveredCardNumber(PIN_PULL('no declaration', `claude/issue-${PIN_CARD}-x`)).evidence === 'branch-name' && deliveredCardNumber(PIN_PULL('Fixes #4444', `claude/issue-${PIN_CARD}-x`)).card === 4444);
  t('⛔ a body naming NO card yields no card and a reason, never a guess', (() => { const r = deliveredCardNumber(PIN_PULL('nothing here')); return r.card === null && r.reason.includes('names no card'); })());
  t('⛔ two cards at the SAME strength yield NEITHER, and the reason names both', (() => { const r = deliveredCardNumber(PIN_PULL('Fixes #4444\nFixes #5555')); return r.card === null && r.reason.includes('#4444') && r.reason.includes('#5555'); })());
  t('…while a STRONGER grade still decides, so a stray `Part of` beside a keyword is not a tie', deliveredCardNumber(PIN_PULL(`Fixes #${PIN_CARD}\n\npart of #4444 already landed`)).card === PIN_CARD);
  t('⛔ CONTROL: the ranking belongs to `deliveryEvidence` -- every grade it answers is ranked here, none invented', DELIVERY_EVIDENCE_PRECEDENCE.every((kind) => deliveryEvidenceNote(kind) !== 'evidence unread') && new Set(DELIVERY_EVIDENCE_PRECEDENCE).size === DELIVERY_EVIDENCE_PRECEDENCE.length);
  t('…and it is ranked in the order that function applies, measured pair by pair', DELIVERY_EVIDENCE_PRECEDENCE.indexOf(deliveryEvidence(PIN_PULL(`Fixes #1\nPart of #2`), '1')) < DELIVERY_EVIDENCE_PRECEDENCE.indexOf(deliveryEvidence(PIN_PULL(`Fixes #1\nPart of #2`), '2')) && DELIVERY_EVIDENCE_PRECEDENCE.indexOf('part-of') < DELIVERY_EVIDENCE_PRECEDENCE.indexOf('branch-name'));

  // -- #18719: a RETRACTED claim leaves the pool -----------------------------
  //
  // The pool used to be closed under addition: a `Claim:` comment entered it
  // and nothing ever took one out, so the withdrawal that the protocol calls an
  // explicit act was the one act the arbiter could not see. These cases pin the
  // MEMBERSHIP rule — ONE channel since #18773 A, the `Release:` line read the
  // sibling's way — each shape against the control that makes it a reading
  // rather than a coincidence.
  battery('#18719: a RETRACTED claim leaves the pool — a withdrawn claim never governs');

  // The #18373 thread, replayed OFFLINE and ⛔ never re-graded: that card is
  // CLOSED and another seat's. Ids, stamps and logins are the REAL ones; each
  // body carries the load-bearing LINES of the real comment, extracted from the
  // REST rows rather than retyped — so a case here fails when the reader
  // changes, ⛔ never when a transcription slipped. The six rows are the thread
  // as PR #18770 read it; `os-try-charles` claimed the card later
  // (5726117004, 2026-09-18T06:29:23Z) and is deliberately not replayed here.
  const RTX_18373 = [
  {
    // the triage comment — no `Claim:` line, so never a pool candidate
    id: 5716318188,
    created_at: '2026-09-17T14:45:28Z',
    user: { login: 'os-sam' },
    body: '**Triage:`pm:queue` · `priority:p1` · `domain:spec` · 类型 Bug · 摘 `finding`** · 2026-09-17T14:45Z · 分诊席 #6015 · R+275',
  },
  {
    // `os-litant` — the claim the card is actually being worked on, and the card's only assignee
    id: 5717143021,
    created_at: '2026-09-17T15:40:44Z',
    user: { login: 'os-litant' },
    body: [
      'Claim: PM loop round 2026-09-17 R1',
      'Session: `session_01LvwGppdonww4zGLWZo5rho`',
      'Branch: `claude/issue-18373-type-source-resolution-bare-dir-include`',
      'Clause-②: no',
    ].join('\n'),
  },
  {
    // `os-bill` — claimed 13 minutes later, and withdrawn 84 seconds after that
    id: 5717315121,
    created_at: '2026-09-17T15:53:24Z',
    user: { login: 'os-bill' },
    body: [
      'Claim: PM loop round 8',
      'Session: `session_01JbZnqu8bt6YqfJsr9vaFb3`',
      'Branch: `claude/issue-18373-include-bare-directory-provenance`',
      'Clause-②: no',
    ].join('\n'),
  },
  {
    // THE RETRACTION as the seat wrote it — prose, no `Claim:` line and no `Release:` line
    id: 5717333576,
    created_at: '2026-09-17T15:54:48Z',
    user: { login: 'os-bill' },
    body: '🚨 **撤回上一条认领(`5717315121`)—— 本卡已由 `os-litant` 在先认领,本席晚了 13 分钟。** `domain:spec` seat 2(`session_01JbZnqu8bt6YqfJsr9vaFb3`,座位贴 #18549)。⏱️ 本条读数取自同一动作:2026-09-17T15:54Z。',
  },
  {
    // `os-litant`'s report line: a retraction verb and its OWN claim id, mid-line
    id: 5717738051,
    created_at: '2026-09-17T16:22:40Z',
    user: { login: 'os-litant' },
    body: '      "question": "The governing-claim instrument now names a retracted claim. check-clause2-carriers --pair 18708 (exit 0) selects comment 5717315121 as governing and marks my dispatch\'s 5717143021 as SUPERSEDED, because the retraction 5717333576 carries no `Claim:` line and so is not in the pool. Is that worth a rule change?",',
  },
  {
    // `os-litant` describing the retraction: a verb, another seat's claim id
    id: 5717775707,
    created_at: '2026-09-17T16:25:37Z',
    user: { login: 'os-litant' },
    body: '- ⚠️ 但它暴露了一个**工具缺陷**:`check-clause2-carriers --pair 18708` 仍机械地把**那条已撤回的** `5717315121` 选为 governing claim —— 因为撤回评论不带 `Claim:` 行,不在候选池里。**本席另行立卡**,⛔ 不在本卡处理。',
  },
  ];
  const RTX_LIVE_CLAIM = 5717143021;
  const RTX_WITHDRAWN = 5717315121;
  const RTX_RETRACTION = 5717333576;
  const RTX_LIVE_BRANCH = 'claude/issue-18373-type-source-resolution-bare-dir-include';
  const RTX_GHOST_BRANCH = 'claude/issue-18373-include-bare-directory-provenance';
  const RTX_ROW_OF = (id) => RTX_18373.find((r) => r.id === id);
  // The same thread with the retraction RE-SPELLED as the act the protocol
  // names — the three fields, 去向 「让先到者」 (#18773 A) — once bare, once
  // decorated exactly as the seat decorated its prose (a sigil, then bold), and
  // once with the bold alone. Everything else byte-identical.
  const RTX_RESPELL = (line) => RTX_18373.map((r) => (r.id === RTX_RETRACTION ? { ...r, body: line } : r));
  const RTX_DECLARED_LINE = 'Release: session `session_01JbZnqu8bt6YqfJsr9vaFb3` · 因:本卡已由 `os-litant` 在先认领,本席晚了 13 分钟 · 去向:让先到者';
  const RTX_18373_DECLARED = RTX_RESPELL(RTX_DECLARED_LINE);
  const RTX_18373_SIGIL = RTX_RESPELL(`🚨 **${RTX_DECLARED_LINE.replace('Release:', 'Release:**')}`);
  const RTX_18373_BOLD = RTX_RESPELL(`**${RTX_DECLARED_LINE.replace('Release:', 'Release:**')}`);
  const RTX_NOW = claimCarrierSelection(RTX_18373);
  const RTX_REASON = (sel, id) => sel.rejected.find((r) => r.row.id === id)?.reason ?? '';
  const RTX_RECORD = (rows) => {
    const rec = pairInputRecord({ pr: 18708, card: 18373, cardComments: rows, headSha: 'offline' });
    const flat = (v) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));
    return { selected: flat(rec['claim.selected']), rejected: flat(rec['claim.rejected']), rule: flat(rec['claim.rule']) };
  };

  // ⭐ THE SPECIMEN, both ways (#18773 A · #18829 A).
  t('⭐ #18773 A: the PROSE retraction retracts NOTHING — the anchor roster, the id scan and the second stripper are gone', !claimRetractions(RTX_18373).has(RTX_ROW_OF(RTX_WITHDRAWN)));
  t('…so the withdrawn claim STANDS again and, being the newest live claim that parses a branch, governs — the cost ruling A priced and accepted (⛔ C: a dated tolerance for one specimen)', RTX_NOW.pool.length === 1 && RTX_NOW.pool[0].id === RTX_WITHDRAWN && (RTX_NOW.governing?.branches ?? []).join() === RTX_GHOST_BRANCH, JSON.stringify(RTX_NOW.pool.map((r) => r.id)));
  t('…and the live claimant reads SUPERSEDED in the record, ⛔ never RETRACTED — the selector is untouched; what moved is what counts as a retraction', /a SUPERSEDED claim/.test(RTX_REASON(RTX_NOW, RTX_LIVE_CLAIM)) && RTX_NOW.rejected.every((r) => !r.reason.startsWith('RETRACTED')));
  t('⛔ …and never DROPPED: the full claim listing still carries both records', RTX_NOW.claims.length === 2 && RTX_NOW.claims.some((r) => r.id === RTX_WITHDRAWN) && RTX_NOW.claims.some((r) => r.id === RTX_LIVE_CLAIM));
  t('⭐ the DECLARED spelling: the same seat, the same stroke, writing the act the protocol names — `Release:` … 去向:让先到者 — takes the claim out', claimRetractions(RTX_18373_DECLARED).has(RTX_18373_DECLARED.find((r) => r.id === RTX_WITHDRAWN)) && claimCarrierSelection(RTX_18373_DECLARED).pool.map((r) => r.id).join() === String(RTX_LIVE_CLAIM));
  t('…and the branch it then names is the ONE ref origin actually has', (claimCarrierSelection(RTX_18373_DECLARED).governing?.branches ?? []).join() === RTX_LIVE_BRANCH);
  t('…with the withdrawn claim listed RETRACTED, naming the release comment, and the record naming the live claimant as selected', RTX_REASON(claimCarrierSelection(RTX_18373_DECLARED), RTX_WITHDRAWN).startsWith('RETRACTED') && RTX_REASON(claimCarrierSelection(RTX_18373_DECLARED), RTX_WITHDRAWN).includes(String(RTX_RETRACTION)) && RTX_RECORD(RTX_18373_DECLARED).selected.includes('os-litant') && !RTX_RECORD(RTX_18373_DECLARED).selected.includes('os-bill'));
  t('⭐ decorated as the seat decorated it — 🚨 **Release:** — it is STILL not read: a sigil is not decoration; the shared stripper strips `*` and backticks and nothing else', !claimRetractions(RTX_18373_SIGIL).has(RTX_18373_SIGIL.find((r) => r.id === RTX_WITHDRAWN)));
  t('…and that shape is NAMED by the sibling\'s vocabulary as `leading-sigil` — audible one file over, ⛔ not stripped here (#18829 A)', ownershipMarkerNearMisses([RTX_18373_SIGIL.find((r) => r.id === RTX_RETRACTION)]).map((m) => m.form).join() === 'leading-sigil');
  t('⛔ CONTROL: the bold alone, sigil removed — **Release:** — IS read, through the sibling\'s one reading', claimRetractions(RTX_18373_BOLD).has(RTX_18373_BOLD.find((r) => r.id === RTX_WITHDRAWN)));
  t('⛔ CONTROL: the raw constant refuses that same bolded body — the reading is `markerMatches`, ⛔ not a widened constant', RELEASE_COMMENT_MARKER.test(RTX_18373_BOLD.find((r) => r.id === RTX_RETRACTION).body) === false && markerMatches(RELEASE_COMMENT_MARKER, RTX_18373_BOLD.find((r) => r.id === RTX_RETRACTION).body) === true);
  t('⛔ CONTROL: the three re-spellings really differ from the prose and from each other', new Set([RTX_ROW_OF(RTX_RETRACTION).body, RTX_DECLARED_LINE, RTX_18373_SIGIL.find((r) => r.id === RTX_RETRACTION).body, RTX_18373_BOLD.find((r) => r.id === RTX_RETRACTION).body]).size === 4);

  // ⭐ The two LIVE decorated releases #18862's sweep could not see (read
  // 2026-09-19T03:30Z; ids, stamps, logins and lines are the REST rows'). Each
  // is a real release by the earlier holder that the raw constant refused, so
  // the released claim stayed in the pool and the later claimant read as a
  // silent takeover. Two of the twelve pairs clear by THIS change alone.
  const S2_17852_CLAIM = { id: 5700342438, created_at: '2026-09-16T15:46:37Z', user: { login: 'os-warren' }, body: [
    'Claim: `domain:spec` execution seat, session `session_01KB5PFtxuy1x3dcR5gxudx6`, 2026-09-16T15:45Z. Assignee set in the same label write (`pm:queue` → `pm:dispatched`, read back and matched). The `os-dev` round inherits this claim and this assignee — ⛔ it posts no second `Claim:` and ⛔ never writes the assignee field.',
    'Branch: `claude/issue-17852-zod-record-proto-drop`',
    '**Clause-②: no** — the card\'s landable half is *pinning an invariant that already holds by accident*. No key is added to a published payload and no accept set moves. ⇒ the PR body carries its own line-initial `Clause-②: no` line, because there is no carrier label to declare it. ⚠️ If the measurement shows the fix needs an accept set or a published parse contract to move, **stop and report** — this seat re-declares here, ⛔ the dev does not, and ⛔ the dev neither hangs nor strips `needs:contract-review` (that carrier is the seat\'s).',
  ].join('\n') };
  const S2_17852_RELEASE = { id: 5700605769, created_at: '2026-09-16T16:05:46Z', user: { login: 'os-warren' }, body: '`Release:` session `session_01KB5PFtxuy1x3dcR5gxudx6` · 因 = 轮次证伪了卡片的 latent 前提,剩下的方向选择落在人工地板(契约变化 / 破坏性动作) · 去向 = 维护者决策箱。assignee 同笔清空,下一任重新认领。' };
  const S2_7848_CLAIM = { id: 5617516036, created_at: '2026-09-10T10:53:27Z', user: { login: 'claude[bot]' }, body: [
    'Claim: session `session_01FhBNJcLRZLe8M87VcUgpKr` · branch `claude/issue-7848-live-margin` · assignee `baozhoutao`',
    'Clause-②: no',
  ].join('\n') };
  const S2_7848_RELEASE = { id: 5617804323, created_at: '2026-09-10T11:16:19Z', user: { login: 'claude[bot]' }, body: '**Release:** session `session_01FhBNJcLRZLe8M87VcUgpKr` · cause **re-priced on a new measurement** (the aggregate is healthy; the tight line is now `ui-components`) · destination **the decision box**. Assignee cleared and `pm:dispatched` → `needs-user-decision` in the same write.' };
  t('⭐ #17852: os-warren\'s backticked `Release:` (5700605769) retracts his own claim (5700342438)', claimRetractions([S2_17852_CLAIM, S2_17852_RELEASE]).get(S2_17852_CLAIM)?.id === '5700605769');
  t('⭐ objectui#7848: claude[bot]\'s bolded **Release:** (5617804323) retracts its own claim (5617516036)', claimRetractions([S2_7848_CLAIM, S2_7848_RELEASE]).get(S2_7848_CLAIM)?.id === '5617804323');
  t('⛔ CONTROL: the raw constant refuses BOTH release bodies — exactly the reading that counted the pairs', RELEASE_COMMENT_MARKER.test(S2_17852_RELEASE.body) === false && RELEASE_COMMENT_MARKER.test(S2_7848_RELEASE.body) === false);
  t('⛔ CONTROL: a DIFFERENT author\'s decorated release retracts nothing — the author test is untouched by the reading', claimRetractions([S2_17852_CLAIM, { ...S2_17852_RELEASE, user: { login: 'os-litant' } }]).size === 0);
  t('…and the released claim then leaves the pool, so the record says RETRACTED rather than ranking it', says(RTX_RECORD([S2_17852_CLAIM, S2_17852_RELEASE]).selected, 'RETRACTED'));

  // ⛔ No line of PROSE retracts, opening or not — the verb reading is the
  // channel #18773 A retired. Both lines below are real bytes off the #18373
  // thread; the first is the report that FILED #18719.
  const RTX_OWN_REPORT = RTX_ROW_OF(5717738051);
  const RTX_DESCRIPTION = RTX_ROW_OF(5717775707);
  t('⛔ a seat REPORTING the defect does not commit it — a verb and its own claim id, mid-line, retract nothing', !claimRetractions(RTX_18373).has(RTX_ROW_OF(RTX_LIVE_CLAIM)) && RTX_OWN_REPORT.user.login === RTX_ROW_OF(RTX_LIVE_CLAIM).user.login && /retract/i.test(RTX_OWN_REPORT.body) && RTX_OWN_REPORT.body.includes(String(RTX_LIVE_CLAIM)));
  t('⛔ …nor does a THIRD seat describing the withdrawal — verb, id, wrong author', RTX_DESCRIPTION.body.includes('撤回') && RTX_DESCRIPTION.body.includes(String(RTX_WITHDRAWN)) && RTX_DESCRIPTION.user.login !== RTX_ROW_OF(RTX_WITHDRAWN).user.login && !claimRetractions(RTX_18373).has(RTX_ROW_OF(RTX_WITHDRAWN)));

  // The shapes, synthetic so each one varies exactly one thing.
  const RTX_ROW = (id, at, login, lines) => ({ id, created_at: at, user: { login }, body: [].concat(lines).join('\n') });
  const RTX_CLAIM = (id, at, login, value = 'no') => RTX_ROW(id, at, login, ['Claim: round 1', 'Branch: `claude/issue-4242-x`', `Clause-②: ${value}`]);
  const RTX_A = RTX_CLAIM(6000000011, '2026-09-17T10:00:00Z', 'seat-a');
  const RTX_B = RTX_CLAIM(6000000012, '2026-09-17T11:00:00Z', 'seat-b');
  const RTX_RELEASE_B = (line = 'Release: session X, cause: 先到者是 seat-a, 去向: 让先到者') => RTX_ROW(6000000013, '2026-09-17T12:00:00Z', 'seat-b', line);
  const RTX_POOL_IDS = (rows) => claimCarrierSelection(rows).pool.map((r) => r.id).join();

  t('⛔ #18773 A, pinned on purpose: a line OPENING with 撤回 and naming the claim\'s id — the exact shape PR #18770 read — retracts nothing now; the act has ONE spelling', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('撤回本席的认领 `6000000012` —— 先到者是 seat-a')]) === '6000000012');
  t('⛔ …and the English stems with it — `retract` / `withdraw` opening a line are prose', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('retracted: my claim `6000000012`, seat-a was first')]) === '6000000012' && RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('withdraw `6000000012`')]) === '6000000012');
  t('shape (1) — a `Release:` line from the claim\'s own author, no id at all, takes it out', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B()]) === '6000000011');
  t('⛔ shape (1) CONTROL: the same `Release:` posted BEFORE the claim retracts nothing', RTX_POOL_IDS([RTX_A, RTX_ROW(6000000013, '2026-09-17T10:30:00Z', 'seat-b', 'Release: session X, cause: y, 去向: queue'), RTX_B]) === '6000000012');
  t('shape (2) — a `Release:` from a DIFFERENT author retracts nobody else\'s claim', RTX_POOL_IDS([RTX_A, RTX_B, RTX_ROW(6000000013, '2026-09-17T12:00:00Z', 'seat-c', 'Release: session Z, cause: y, 去向: queue')]) === '6000000012');
  t('⛔ shape (2) CONTROL: the live claimant\'s claim still GOVERNS, it is not merely un-rejected', (() => { const sel = claimCarrierSelection([RTX_A, RTX_B, RTX_ROW(6000000013, '2026-09-17T12:00:00Z', 'seat-c', 'Release: session Z')]); return sel.governing?.createdAt === RTX_B.created_at && sel.rejected.every((r) => !r.reason.startsWith('RETRACTED')); })());
  t('shape (3) — a DECORATED `**Release:**` from the claim\'s own author takes it out — the one reading (#18829 A)', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('**Release:** session X, 去向: 让先到者')]) === '6000000011');
  t('…and the backticked spelling with it, and the blockquoted bold', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('`Release:` session X, 去向: 让先到者')]) === '6000000011' && RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('> **Release:** session X')]) === '6000000011');
  t('⛔ shape (3) CONTROL: a markdown LIST ITEM `- Release:` is not a release, so it retracts nothing — the sibling\'s refusal (H20\'s shape) holds on this side too', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('- Release: session X, 去向: queue')]) === '6000000012');
  t('⛔ …and a sigil-led `🚨 Release:` retracts nothing either — the shape the second stripper would have swallowed', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('🚨 Release: session X, 去向: 让先到者')]) === '6000000012');
  t('⛔ …and `Released:` is a MALFORMED release, ⛔ not a dialect — the marker is the sibling\'s, unwidened', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('Released: session X')]) === '6000000012');
  t('bare `release` PROSE is not the act — a version release is not a retraction; the word at line start with the colon is the whole discriminator', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('release 阻塞在 `6000000012` 上,等维护者')]) === '6000000012');
  t('⛔ a `Release:` mentioned MID-LINE retracts nothing — the marker is anchored at line start', RTX_POOL_IDS([RTX_A, RTX_B, RTX_RELEASE_B('the seat will post Release: once the ruling lands')]) === '6000000012');
  t('⛔ an unreadable author on the RETRACTOR retracts nothing — fail closed, never a wildcard', RTX_POOL_IDS([RTX_A, RTX_B, { id: 6000000013, created_at: '2026-09-17T12:00:00Z', body: 'Release: session X' }]) === '6000000012');
  t('⛔ an unreadable author on the CLAIM is not retractable either', RTX_POOL_IDS([RTX_A, { id: 6000000012, created_at: '2026-09-17T11:00:00Z', body: ['Claim: r', 'Branch: `claude/issue-4242-x`'].join('\n') }, RTX_RELEASE_B()]) === '6000000012');
  t('⛔ a RETRACTED claim\'s declaration is not the one read — the LIVE carrier\'s line is', cardDeclaration([RTX_CLAIM(6000000011, '2026-09-17T10:00:00Z', 'seat-a', 'no'), RTX_CLAIM(6000000012, '2026-09-17T11:00:00Z', 'seat-b', 'yes'), RTX_RELEASE_B()]).value === 'no');
  // ⭐ Every claim retracted ⇒ a state this file ALREADY has, ⛔ never a
  // fabricated carrier and ⛔ never the withdrawn record's own value. WHICH
  // existing state depends on what is left on the thread, and both are pinned
  // because collapsing them would describe neither: a withdrawn claim that
  // carried a declaration leaves that line ON the thread with no carrier under
  // it (`misplaced`, a C2 row, the value ⛔ not accepted), and one that carried
  // none leaves nothing to read at all (`absent`).
  t('⭐ every claim retracted, declaration left on the thread ⇒ `misplaced` — a finding, ⛔ not a reading', (() => { const rows = [RTX_B, RTX_RELEASE_B()]; const d = cardDeclaration(rows); return claimCarrierSelection(rows).pool.length === 0 && d.state === 'misplaced'; })());
  t('⛔ …and the withdrawn record\'s OWN value is never handed back as the card\'s declaration', (() => { const rows = [RTX_CLAIM(6000000012, '2026-09-17T11:00:00Z', 'seat-b', 'yes'), RTX_RELEASE_B()]; return cardDeclaration(rows).state !== 'declared'; })());
  t('⭐ …and with nothing left to read the state is `absent` — the carrier is owed, ⛔ not invented', (() => { const rows = [RTX_ROW(6000000012, '2026-09-17T11:00:00Z', 'seat-b', ['Claim: r', 'Branch: `claude/issue-4242-x`']), RTX_RELEASE_B()]; return cardDeclaration(rows).state === 'absent'; })());
  t('⛔ CONTROL: without the retraction that same thread reads `missing` — the claim IS the carrier', cardDeclaration([RTX_ROW(6000000012, '2026-09-17T11:00:00Z', 'seat-b', ['Claim: r', 'Branch: `claude/issue-4242-x`'])]).state === 'missing');
  t('…and the record SAYS that, instead of reporting a thread nobody claimed', RTX_RECORD([RTX_B, RTX_RELEASE_B()]).selected.includes('RETRACTED'));
  t('⛔ CONTROL: a thread with no claim at all still reads as the OTHER sentence', RTX_RECORD([RTX_ROW(6000000013, '2026-09-17T12:00:00Z', 'seat-b', 'no claim here')]).selected.includes('no comment on this thread carries'));
  t('ONE derivation: the map the selection rejects from is the map `claimRetractions` returns', (() => { const rows = [RTX_A, RTX_B, RTX_RELEASE_B()]; const sel = claimCarrierSelection(rows); return sel.retracted.size === 1 && sel.retracted.get(RTX_B)?.id === '6000000013' && claimRetractions(rows).get(RTX_B)?.id === '6000000013'; })());
  t('⛔ an unreadable thread retracts nothing and carries the empty halves', claimRetractions(null).size === 0 && claimCarrierSelection(null).live.length === 0 && claimCarrierSelection(null).retracted.size === 0);
  t('the printed RULE carries the membership half, so two runs are comparable on it', RTX_RECORD(RTX_18373).rule.includes(CLAIM_RETRACTION_RULE) && CLAIM_SELECTION_RULE.includes(CLAIM_RETRACTION_RULE));
  t('⭐ …and it says ONE channel and names the verb reading as refused, so a reader is not left to infer why prose no longer retracts', CLAIM_RETRACTION_RULE.includes('ONE channel') && CLAIM_RETRACTION_RULE.includes('Never a prose line') && CLAIM_RETRACTION_RULE.includes('让先到者'));
  t('…and the channel sentence the record prints says the reading is the sibling\'s', (claimRetractions([RTX_A, RTX_B, RTX_RELEASE_B()]).get(RTX_B)?.channel ?? '').includes('sibling\'s one reading'));

  // -- #18683: the card-comment read pages like its two siblings -------------
  //
  // What the card measured was an ASYMMETRY inside ONE file, not a missing
  // feature: two list reads paged to a cap and answered `null` on it
  // (fail-CLOSED), and the third — the one the governing-claim POOL is built
  // from — issued one `per_page=100` request and judged from whatever came back
  // (fail-OPEN, on the read that arbitrates ownership). The pins below are
  // about that DEFAULT rather than about any one verdict: a thread read short
  // is UNJUDGED, a thread read whole carries its newest claim, and the input
  // record says which of the two happened.
  battery('#18683: the card-comment read pages to a cap — past 100 is UNJUDGED, ⛔ never a truncated pool');
  const L83_FILLER = (i) => ({
    id: 6000000000 + i,
    created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    user: { login: 'os-filler' },
    body: `ordinary comment ${i} — nothing on this line begins with the claim key`,
  });
  const L83_CLAIM = (id, at, value) => ({
    id,
    created_at: at,
    user: { login: 'os-justin' },
    body: `Claim: PM loop round\nBranch: \`claude/issue-77001-x\`\nClause-②: ${value}`,
  });
  // The 101st row, past the first page in both fixtures below.
  const L83_NEW = L83_CLAIM(6000000101, '2026-09-17T23:59:59Z', 'no');
  // The 1st row of the second fixture: an OLDER claim, inside the first page,
  // declaring the OPPOSITE value.
  const L83_OLD = L83_CLAIM(6000000001, '2026-09-01T00:00:00Z', 'yes');
  const L83_PAD = (n, from = 1) => Array.from({ length: n }, (_, i) => L83_FILLER(i + from));
  const L83_THREAD = [...L83_PAD(100), L83_NEW];
  const L83_SUPERSEDING = [L83_OLD, ...L83_PAD(99, 2), L83_NEW];
  // A page server with GitHub's own semantics AND a request counter: what the
  // ladder COSTS is a pin here, not an implementation detail — a ladder that
  // kept asking after a short page would be a correct reading bought at ten
  // times the budget the header paragraph promises.
  const L83_READ = async (rows, key, { cap = COMMENT_PAGE_CAP, refuseFrom = null } = {}) => {
    const calls = [];
    const out = await pagedListRead({
      key,
      cap,
      noun: 'comments',
      readPage: (page) => {
        calls.push(page);
        if (refuseFrom !== null && page >= refuseFrom) return null;
        return rows.slice((page - 1) * 100, page * 100);
      },
    });
    return { out, calls: calls.join(','), ladder: readLadderRecord(key) };
  };

  t('the comment read has a DECLARED cap, exactly as the two reads that always paged do', Number.isInteger(COMMENT_PAGE_CAP) && COMMENT_PAGE_CAP > 0);
  const L83_FULL = await L83_READ(L83_THREAD, readDiagnosisKey('comments', 770011));
  t('⭐ the 101st comment REACHES the reader — the thread is read whole, ⛔ not to the end of page one', L83_FULL.out?.length === 101 && L83_FULL.out.at(-1) === L83_NEW);
  t('⭐ …so a claim past row 100 ENTERS the pool, and GOVERNS it', (() => { const sel = claimCarrierSelection(L83_FULL.out); return sel.pool.length === 1 && sel.pool[0] === L83_NEW; })());
  t('⭐ …and the declaration limb reads ITS line', cardDeclaration(L83_FULL.out).state === 'declared' && cardDeclaration(L83_FULL.out).value === 'no');
  t('⛔ CONTROL: the same thread cut at row 100 reads `absent` — the reading the un-paged read produced', cardDeclaration(L83_THREAD.slice(0, 100)).state === 'absent' && claimCarrierSelection(L83_THREAD.slice(0, 100)).pool.length === 0);
  const L83_SUP = await L83_READ(L83_SUPERSEDING, readDiagnosisKey('comments', 770012));
  t('⭐ a NEWER claim past the page boundary supersedes the one inside it, and the older one is LISTED', (() => { const sel = claimCarrierSelection(L83_SUP.out); return sel.pool.length === 1 && sel.pool[0] === L83_NEW && sel.rejected.some((r) => r.row === L83_OLD); })());
  t('⛔ CONTROL: cut at row 100 the SUPERSEDED carrier governs and its `yes` is what the limb reads — the fail-OPEN direction', (() => { const cut = L83_SUPERSEDING.slice(0, 100); const sel = claimCarrierSelection(cut); return sel.pool[0] === L83_OLD && cardDeclaration(cut).value === 'yes'; })());
  t('⭐ …so the two readings of ONE thread DISAGREE on the declaration — the defect stated as one comparison', cardDeclaration(L83_SUP.out).value === 'no' && cardDeclaration(L83_SUPERSEDING.slice(0, 100)).value === 'yes');
  const L83_CAPPED = await L83_READ(L83_PAD(COMMENT_PAGE_CAP * 100 + 1), readDiagnosisKey('comments', 770013));
  t('⭐ a thread past the cap answers `null` — UNJUDGED, ⛔ never the pages that did arrive', L83_CAPPED.out === null);
  t('⭐ …and `null` is neither `missing` nor `absent` nor a carrier: it is `unreadable`', cardDeclaration(L83_CAPPED.out).state === 'unreadable' && claimCarrierSelection(L83_CAPPED.out).readable === false);
  t('…and the ladder records that the CAP is what stopped it', L83_CAPPED.ladder?.capped === true && L83_CAPPED.ladder.pages === COMMENT_PAGE_CAP);
  t('⭐ the ladder stops on the first SHORT page — two requests for a 101-row thread, ⛔ not ten', L83_FULL.calls === '1,2');
  t('…and a thread that fits inside one page costs ONE request', (await L83_READ(L83_PAD(1), readDiagnosisKey('comments', 770014))).calls === '1');
  t('⭐ …while a thread of EXACTLY 100 rows costs two, because a full page is indistinguishable from a finished one', (await L83_READ(L83_PAD(100), readDiagnosisKey('comments', 770015))).calls === '1,2');
  const L83_REFUSED = await L83_READ(L83_PAD(101), readDiagnosisKey('comments', 770016), { refuseFrom: 2 });
  t('a page that came back UNREAD ends the ladder, and the thread is `null` rather than its first page', L83_REFUSED.out === null && L83_REFUSED.calls === '1,2');
  t('…and the record says the CAP was ⛔ not what stopped it — two different facts, never one sentence', L83_REFUSED.ladder?.capped === false && L83_REFUSED.ladder.complete === false && says(ladderReading(L83_REFUSED.ladder, 'comments'), 'the cap was ⛔ not what stopped it'));
  t('the input record DECLARES the ladder field for BOTH threads this file reads', INPUT_RECORD_PAIR_FIELDS.includes('card-comment-pages') && INPUT_RECORD_PAIR_FIELDS.includes('pr-comment-pages'));
  t('⭐ …and it states the pages issued AND the cap, so two runs can be diffed on how much of the thread each read', says(ladderReading(L83_FULL.ladder, 'comments'), `2 of ${COMMENT_PAGE_CAP} page(s)`) && says(ladderReading(L83_FULL.ladder, 'comments'), 'COMPLETE'));
  t('⭐ …and a CAPPED read says UNJUDGED in the field itself, ⛔ never a row count', says(ladderReading(L83_CAPPED.ladder, 'comments'), 'CAPPED') && says(ladderReading(L83_CAPPED.ladder, 'comments'), 'UNJUDGED') && !says(ladderReading(L83_CAPPED.ladder, 'comments'), 'COMPLETE'));
  t('a path that took no ladder SAYS so, rather than rendering a page count it never paid for', says(ladderReading(null, 'comments'), 'no paged read'));
  t('…and the `--pair-json` document says it was served whole in ONE read', (() => { const r = pairJsonReader({ pulls: [], comments: { 13476: [] } }); r.readCardComments('owner/name', 13476); return says(ladderReading(readLadderRecord(readDiagnosisKey('comments', 13476)), 'comments'), 'served whole from the pre-fetched document'); })());
  t('⭐ the rendered block carries the ladder line beside the row count, on both threads', (() => { const lines = renderInputRecord(buildInputRecord({ pairs: [{ pr: 1, card: 2, cardComments: L83_FULL.out, cardCommentRead: L83_FULL.ladder, prComments: [], prCommentRead: L83_FULL.ladder }] })).join('\n'); return says(lines, 'pair.1.card-comment-pages:') && says(lines, 'pair.1.pr-comment-pages:') && says(lines, '101 row(s)'); })());
  t('⛔ CONTROL: the ladder fields are DECLARED, so the block does not name them as keys nothing pins', undeclaredRecordFields(buildInputRecord({ pairs: [{ pr: 1, card: 2, cardComments: [], cardCommentRead: L83_FULL.ladder, prComments: [] }] })).length === 0);
  t('⛔ CONTROL: the SIBLING caps are untouched by this card — ten event pages, three file pages', EVENT_PAGE_CAP === 10 && FILE_PAGE_CAP === 3);
  t('⭐ all three list reads render ONE cap sentence, so this file can no longer hold two defaults', pageCapNote(EVENT_PAGE_CAP, 'events') === `${EVENT_PAGE_CAP} page(s) of 100 events each, all of them full — the tail is past this file's page cap and therefore unread` && pageCapNote(COMMENT_PAGE_CAP, 'comments') === `${COMMENT_PAGE_CAP} page(s) of 100 comments each, all of them full — the tail is past this file's page cap and therefore unread`);
  t('⭐ …and a capped comment read FILES that sentence under its own diagnosis key, the way its siblings do', await (async () => {
    const key = readDiagnosisKey('comments', 770017);
    const rows = L83_PAD(100);
    const value = await diagnosedRead(key, () => pagedListRead({ key, cap: 2, noun: 'comments', readPage: () => rows }));
    const hung = {};
    attachReadDiagnosis(hung, key, 'card #770017\'s comment thread');
    return value === null && says(JSON.stringify(hung.reads ?? []), 'page cap and therefore unread');
  })());
  t('⛔ CONTROL: the diagnosis KEY is unchanged, so every sentence already keyed to `comments` still finds it', readDiagnosisKey('comments', 770017) === 'comments:770017');

  // -- #18764: a DECORATED claim ENTERS the pool -----------------------------
  //
  // The two live records the escalation named, replayed OFFLINE and ⛔ never
  // re-graded: they are another repository's cards and another seat's work.
  // Ids, stamps and the load-bearing LINES are the real ones, read from the
  // REST rows at 2026-09-17T22:02Z — ⚠️ both cards have since left the state
  // they were read in, which is why the reading carries its time. The bodies
  // below ADD the `Branch:` / `Clause-②` lines the real comments did not carry:
  // without them the thread reads `claim-branch-unparsed` on BOTH sides of this
  // change (measured), and the defect this battery pins is the one that only
  // shows once a claim is otherwise complete.
  battery('#18764: a DECORATED claim ENTERS the pool — ONE reading, and it is the sibling\'s');
  const D64 = (id, at, body, login = 'os-sales') => ({ id, created_at: at, user: { login }, body });
  const D64_BOLD = D64(5721120402, '2026-09-17T20:57:09Z', [
    '**Claim:** card objectui#9660, by the `domain:spec` @ objectui execution seat, session `session_01UanLVj6xvbS6puBCewLr8L`.',
    'Branch: `claude/issue-9660-named-test-invocation`',
    'Clause-②: no',
  ].join('\n'));
  const D64_TICK = D64(5720184809, '2026-09-17T19:41:36Z', [
    '`Claim:` card objectui#9717, by the `domain:spec` @ objectui execution seat, session `session_01UanLVj6xvbS6puBCewLr8L`.',
    'Branch: `claude/issue-9717-doc-component-types`',
    'Clause-②: no',
  ].join('\n'));
  // The older BARE claim, declaring the OPPOSITE value — so "the wrong carrier
  // governs" is a WRONG VALUE here and not merely a missing one.
  const D64_BARE_OLD = D64(5700000001, '2026-09-17T18:00:00Z', [
    'Claim: the older BARE claim',
    'Branch: `claude/issue-9660-older-bare`',
    'Clause-②: yes',
  ].join('\n'));
  const D64_POOL = (rows) => claimCarrierSelection(rows).pool.map((r) => r.id).join(',');
  const D64_RECORD = (rows) => {
    const rec = pairInputRecord({ pr: 9999, card: 9660, cardComments: rows, headSha: 'offline' });
    return { selected: [rec['claim.selected']].flat().join('\n'), rejected: [rec['claim.rejected']].flat().join('\n') };
  };

  t('⭐ a BOLD claim ENTERS the pool — the state it could not reach at all before', D64_POOL([D64_BOLD]) === String(D64_BOLD.id), D64_POOL([D64_BOLD]));
  t('…and GOVERNS: the branch resolved is the one IT names', (claimCarrierSelection([D64_BOLD]).governing?.branches ?? []).join() === 'claude/issue-9660-named-test-invocation');
  t('…and the declaration limb reads the `Clause-②` line OFF IT', cardDeclaration([D64_BOLD]).state === 'declared' && cardDeclaration([D64_BOLD]).value === 'no');
  t('⛔ CONTROL — the CONSTANT is NOT widened: the raw marker still refuses that same body', CLAIM_COMMENT_MARKER.test(D64_BOLD.body) === false);
  t('⭐ the BACKTICKED spelling is the same record, by the same reading', D64_POOL([D64_TICK]) === String(D64_TICK.id));
  t('…with its own `Branch:` line resolved', (claimCarrierSelection([D64_TICK]).governing?.branches ?? []).join() === 'claude/issue-9717-doc-component-types');
  t('…and its own declaration read', cardDeclaration([D64_TICK]).value === 'no');
  t('⛔ CONTROL: the raw marker refuses the backticked body too', CLAIM_COMMENT_MARKER.test(D64_TICK.body) === false);
  t('⭐ a DECORATED NEWER claim SUPERSEDES a BARE older one — the pool is the newest, not the readable one', D64_POOL([D64_BARE_OLD, D64_BOLD]) === String(D64_BOLD.id), D64_POOL([D64_BARE_OLD, D64_BOLD]));
  t('…and the older record is LISTED, as SUPERSEDED rather than dropped', says(D64_RECORD([D64_BARE_OLD, D64_BOLD]).rejected, 'a SUPERSEDED claim') && says(D64_RECORD([D64_BARE_OLD, D64_BOLD]).rejected, String(D64_BARE_OLD.id)));
  t('⭐ …and the VALUE the limb reads is the newer one', cardDeclaration([D64_BARE_OLD, D64_BOLD]).value === 'no');
  t('⛔ CONTROL: the older record declares the OPPOSITE, so selecting the wrong carrier is a WRONG value, ⛔ not a missing one', cardDeclaration([D64_BARE_OLD]).value === 'yes');
  t('the input record NAMES the decorated row it selected — by id and by date', says(D64_RECORD([D64_BOLD]).selected, String(D64_BOLD.id)) && says(D64_RECORD([D64_BOLD]).selected, '2026-09-17T20:57:09Z'));
  t('⛔ CONTROL: the same thread read the other way says nobody claimed at all', says(D64_RECORD([D64(1, '2026-09-17T20:57:09Z', 'no claim on this line')]).selected, 'no comment on this thread carries'));

  // The retraction index reads the SAME predicate, so a decorated claim is
  // retractable by its own author — ⛔ never a record that can be written but
  // never withdrawn.
  const D64_RELEASE = D64(5721120999, '2026-09-17T21:30:00Z', 'Release: session `session_01UanLVj6xvbS6puBCewLr8L` — 去向 `pm:queue`');
  t('⭐ the retraction index SEES a decorated claim — it is retractable by its own author', claimRetractions([D64_BOLD, D64_RELEASE]).has(D64_BOLD));
  t('…and the pool then says every claim on the thread is RETRACTED, ⛔ not that none was written', says(D64_RECORD([D64_BOLD, D64_RELEASE]).selected, 'RETRACTED'));
  t('⛔ CONTROL: a DIFFERENT author\'s release retracts nothing, decorated or not', claimRetractions([D64_BOLD, { ...D64_RELEASE, user: { login: 'os-other' } }]).size === 0);

  // The refusals are the SIBLING's and are pinned here as still-refused: this
  // file admits no spelling of its own, so a form the sibling names as a NEAR
  // MISS must not become a claim by arriving through this door.
  t('⛔ a markdown LIST ITEM is still not a claim — the shape the shared reading refuses to undecorate through', D64_POOL([D64(2, '2026-09-17T20:00:00Z', '- Claim: seat.\nBranch: `claude/issue-1-x`')]) === '');
  t('⛔ a HEADING-style claim is still not one', D64_POOL([D64(3, '2026-09-17T20:00:00Z', '## Claim: seat.\nBranch: `claude/issue-1-x`')]) === '');
  t('⛔ UNDERSCORE emphasis is still a NAMED near miss, ⛔ not a claim', markerMatches(CLAIM_COMMENT_MARKER, '__Claim:__ seat.') === false);
  t('⛔ and the `Clause-②-correction:` comment does not enter the pool through the new door either', D64_POOL([FIXED_CORRECTION('no')]) === '' && markerMatches(CLAIM_COMMENT_MARKER, FIXED_CORRECTION('no').body) === false);
  t('⛔ provably ADDITIVE: a bare claim this file already read reads exactly as before', claimCarrierSelection([CLAIM('Clause-②: no')]).pool.length === 1);

  // ⭐ ONE undecoration path (#18829 A). The file used to keep a second stripper
  // for retraction lines — `_` removed, then every leading non-letter/non-digit
  // character — and the two paths were run over one twelve-spelling fixture
  // set: 5 of 12 read differently. The maintainer ruled the shared claim
  // reading the protocol's ONE definition of a decorated ownership line and the
  // second stripper deleted; the sigil-led shape it swallowed is the sibling's
  // named near miss. The twelve are replayed below through the one path, on
  // both sides it now serves — the pool and the retraction index.
  const D64_TWELVE = [
    ['Claim: seat.', true], ['**Claim:** seat.', true], ['`Claim:` seat.', true], ['> Claim: seat.', true], ['> **Claim:** seat.', true],
    ['__Claim:__ seat.', false], ['- Claim: seat.', false], ['* Claim: seat.', false], ['🚨 Claim: seat.', false], ['## Claim: seat.', false],
    ['Claim of ownership: seat.', false], ['Claiming: seat.', false],
  ];
  const D64_AS_CLAIM = (line) => D64(9, '2026-09-17T20:00:00Z', `${line}\nBranch: \`claude/issue-1-x\``);
  t('⭐ the twelve spellings the card compared read the SAME through the one path — 5 disagreements → 0: the POOL agrees with `markerMatches` on every one', D64_TWELVE.every(([line, reads]) => markerMatches(CLAIM_COMMENT_MARKER, line) === reads && claimCarrierSelection([D64_AS_CLAIM(line)]).pool.length === (reads ? 1 : 0)), D64_TWELVE.map(([l]) => `${JSON.stringify(l)}:${claimCarrierSelection([D64_AS_CLAIM(l)]).pool.length}`).join(' '));
  t('…and the retraction INDEX agrees on every one too — no second operand is left for a disagreement', D64_TWELVE.every(([line, reads]) => claimRetractions([D64_AS_CLAIM(line), D64_RELEASE]).size === (reads ? 1 : 0)));
  t('⛔ CONTROL: the table is not vacuous — 5 of the 12 read and 7 do not', D64_TWELVE.filter(([, r]) => r).length === 5 && D64_TWELVE.length === 12);
  t('⛔ `- Claim:` and `* Claim:` stay NOT a claim (H20) — the refusal is the sibling\'s, on both sides of this file', ['- Claim: seat.', '* Claim: seat.'].every((l) => markerMatches(CLAIM_COMMENT_MARKER, l) === false && claimCarrierSelection([D64_AS_CLAIM(l)]).pool.length === 0));
  t('⭐ the sigil-led spelling is refused here AND named one file over as `leading-sigil` — audible, never stripped', markerMatches(CLAIM_COMMENT_MARKER, '🚨 Claim: PM loop round 1') === false && ownershipMarkerNearMisses([{ id: 1, body: '🚨 Claim: PM loop round 1' }]).map((m) => m.form).join() === 'leading-sigil');
  t('⛔ the second stripper and the prose anchor roster are GONE from this module — absence pinned on the SOURCE, with the surviving reading as the control', (() => { const own = readFileSync(SELF_PATH, 'utf8'); return !own.includes('undecorate' + 'RetractionLine') && !own.includes('RETRACTION_PROSE' + '_ANCHORS') && own.includes('markerMatches(RELEASE_COMMENT_MARKER'); })());

  // -- #18828: a SECOND `Claim:` by ONE seat, NAMED -------------------------
  //
  // The rule is this file's own (#17366 block, upstairs): the claim protocol
  // forbids a second `Claim:`. What the reader did with one was RANK it —
  // `rejected: 1 … a SUPERSEDED claim`, exit 0 — so a writer-side prohibition
  // had no enforcing reader, and the record used the word for a transition the
  // protocol DESIGNED about a line it says must not be written.
  //
  // ⭐ The pins below are per DIRECTION, and each one carries its own
  // non-vacuity control: an assertion that some thread is silent proves nothing
  // unless the SAME thread, with one thing changed, is named.
  battery('#18828: a SECOND `Claim:` by ONE seat — the writer-side prohibition, finally READ');
  const R28 = (id, at, login, lines) => ({ id, created_at: at, user: { login }, body: [].concat(lines).join('\n') });
  const R28_SEAT = 'os-support-ai';
  const R28_CLAIM = (id, at, login, o = {}) =>
    R28(id, at, login, [
      `${o.marker ?? 'Claim:'} PM loop round ${o.round ?? 1}`,
      `Session: \`session_01DvvamiacK328idtBYJBxV3\``,
      o.branch === null ? 'Branch: named in the PR body' : `Branch: \`${o.branch ?? 'claude/issue-4242-first'}\``,
      'Clause-②: no',
    ]);
  const R28_A = R28_CLAIM(7100000001, '2026-09-18T01:00:00Z', R28_SEAT);
  const R28_B = R28_CLAIM(7100000002, '2026-09-18T02:00:00Z', R28_SEAT, { round: 2, branch: 'claude/issue-4242-second' });
  const R28_PAIR = (rows) => ({ pr: 18999, card: 18828, draft: true, prLabels: [], cardLabels: [], cardComments: rows });
  const R28_CODES = (rows) => pairRows(R28_PAIR(rows)).map((r) => r.code);
  const R28_ROW = (rows) => pairRows(R28_PAIR(rows)).find((r) => r.code === 'C8')?.text ?? '';
  const R28_FIELD = (rows, key) => [pairInputRecord(R28_PAIR(rows))[key]].flat().join('\n');
  const R28_IDS = (rows) => claimRepeats(rows).map((g) => g.ids.join('+')).join(' | ');

  // (a) the shape the card measured five times over.
  t('⭐ (a) two LIVE claims by ONE seat, no retraction between them — ONE named group carrying BOTH ids', R28_IDS([R28_A, R28_B]) === '7100000001+7100000002', R28_IDS([R28_A, R28_B]));
  t('…and `--pair` earns a C8 FINDING, which is its exit 4', R28_CODES([R28_A, R28_B]).includes('C8'), R28_CODES([R28_A, R28_B]).join());
  t('⛔ …a VERDICT and never a NOTE: the code lives in `pairRows`, and `pairNotes` does not carry it', pairNotes(R28_PAIR([R28_A, R28_B])).every((n) => n.code !== 'C8') && EXIT_PAIR_ADVERSE === 4 && EXIT_PAIR_ADVERSE !== EXIT_OK);
  t('…the ROW names the author and BOTH comment ids', says(R28_ROW([R28_A, R28_B]), R28_SEAT) && says(R28_ROW([R28_A, R28_B]), '7100000001') && says(R28_ROW([R28_A, R28_B]), '7100000002'));
  t('…and it names BOTH sanctioned repairs — the correction key and the `Release:`', says(R28_ROW([R28_A, R28_B]), 'Clause-②-correction') && says(R28_ROW([R28_A, R28_B]), '`Release:`'));
  t('…and the input record READS the same two ids, beside the carrier it selected', says(R28_FIELD([R28_A, R28_B], 'claim.repeat'), '7100000001') && says(R28_FIELD([R28_A, R28_B], 'claim.repeat'), '7100000002'));
  t('⛔ CONTROL: ONE claim by that same seat is silent — no group, no row, and the record says so', R28_IDS([R28_A]) === '' && !R28_CODES([R28_A]).includes('C8') && says(R28_FIELD([R28_A], 'claim.repeat'), 'none — no author holds'));
  t('⛔ CONTROL: the SELECTOR did not move — the newest still governs and the older is still listed SUPERSEDED', claimCarrierSelection([R28_A, R28_B]).pool.map((r) => r.id).join() === '7100000002' && says(R28_FIELD([R28_A, R28_B], 'claim.rejected'), 'a SUPERSEDED claim'));
  t('⛔ …and the refusal is an ADDITIONAL reading, ⛔ not a new selector: same pool, same rejected count as before', claimCarrierSelection([R28_A, R28_B]).rejected.length === 1 && claimCarrierSelection([R28_A, R28_B]).claims.length === 2 && CLAIM_SELECTION_RULE.includes('the GOVERNING claim'));

  // (b) the p1 shape — a SEPARATE reading since #18862 (row C9), ⛔ never this one.
  const R28_OTHER = R28_CLAIM(7100000003, '2026-09-18T02:00:00Z', 'os-litant', { round: 2, branch: 'claude/issue-4242-second' });
  const R28_OTHER_AFTER = { ...R28_OTHER, created_at: '2026-09-20T02:00:00Z' };
  t('⭐ (b) two live claims by DIFFERENT authors ⇒ ⛔ NOT this state — C8 is silent on the hand-over', R28_IDS([R28_A, R28_OTHER]) === '' && !R28_CODES([R28_A, R28_OTHER]).includes('C8'));
  t('⭐ …and the reader that SPEAKS on it is C9 (#18862): dated after its instant the thread earns C9 and ⛔ not C8 — one state, one row, never both from two authors with one claim each', R28_CODES([R28_A, R28_OTHER_AFTER]).includes('C9') && !R28_CODES([R28_A, R28_OTHER_AFTER]).includes('C8') && claimHandovers([R28_A, R28_OTHER_AFTER])?.judged === true);
  t('…dated before it (as this fixture is) the same thread is LISTED by C9\'s note, and C8 still says nothing', pairNotes(R28_PAIR([R28_A, R28_OTHER])).some((n) => n.code === 'C9-BEFORE-EFFECTIVE') && !R28_CODES([R28_A, R28_OTHER]).includes('C9') && R28_IDS([R28_A, R28_OTHER]) === '');
  t('⛔ CONTROL: the SELECTOR reads as it did — the newer governs and the older is listed SUPERSEDED in the record; what moved is the VERDICT, from exit 0 to C9\'s row', claimCarrierSelection([R28_A, R28_OTHER]).pool.map((r) => r.id).join() === '7100000003' && says(R28_FIELD([R28_A, R28_OTHER], 'claim.rejected'), 'a SUPERSEDED claim'));
  t('⛔ CONTROL: make those two authors ONE and the same thread is named by C8 — the author test is what decides', R28_IDS([R28_A, { ...R28_OTHER, user: { login: R28_SEAT } }]) === '7100000001+7100000003');
  t('…and the rule PRINTED with the row says so in as many words, and names the row that makes the other reading', CLAIM_REPEAT_RULE.includes('DIFFERENT authors are not this state') && CLAIM_REPEAT_RULE.includes('row C9'));

  // (c) MEMBERSHIP first — a re-claim after a release is the protocol working.
  const R28_RELEASE = R28(7100000010, '2026-09-18T01:30:00Z', R28_SEAT, 'Release: session `session_01DvvamiacK328idtBYJBxV3`, cause: 本卡改派, 去向: `pm:queue`');
  const R28_BOLD_RELEASE = R28(7100000011, '2026-09-18T01:30:00Z', R28_SEAT, '**Release:** session `session_01DvvamiacK328idtBYJBxV3`, cause: 本卡改派, 去向: `pm:queue`');
  t('⭐ (c) a fresh claim AFTER a `Release:` of the first ⇒ silent — a retracted claim does not stand', R28_IDS([R28_A, R28_RELEASE, R28_B]) === '' && !R28_CODES([R28_A, R28_RELEASE, R28_B]).includes('C8'));
  t('…and the first is still listed RETRACTED, with the 「⛔ NOT superseded」 wording byte-unchanged', says(R28_FIELD([R28_A, R28_RELEASE, R28_B], 'claim.rejected'), 'RETRACTED') && says(R28_FIELD([R28_A, R28_RELEASE, R28_B], 'claim.rejected'), '⛔ NOT superseded: a withdrawn claim is not a candidate for governance at all, whatever its date'));
  t('…and a DECORATED `**Release:**` clears it the same way — the one reading (#18829 A), ⛔ a `Release:`-only rule since #18773 A', R28_IDS([R28_A, R28_BOLD_RELEASE, R28_B]) === '' && RELEASE_COMMENT_MARKER.test(R28_BOLD_RELEASE.body) === false);
  t('⛔ CONTROL: drop the retraction and those same two claims are named — the release is what clears it', R28_IDS([R28_A, R28_B]) === '7100000001+7100000002');
  t('⭐ the repair is PERFORMABLE after the fact: `Release:` then ONE fresh claim leaves exactly one standing', R28_IDS([R28_A, R28_B, R28(7100000012, '2026-09-18T03:00:00Z', R28_SEAT, 'Release: session `x`, cause: 修复本席的双认领, 去向: `pm:queue`'), R28_CLAIM(7100000013, '2026-09-18T04:00:00Z', R28_SEAT, { round: 3 })]) === '');

  // (d) the sanctioned exit stays the sanctioned exit.
  const R28_CORRECTION = R28(7100000020, '2026-09-18T02:00:00Z', R28_SEAT, [
    'Clause-②-correction: 7100000001',
    'Clause-②: no',
    'Session: `session_01DvvamiacK328idtBYJBxV3`',
  ]);
  t('⭐ (d) a `Clause-②-correction:` as the LATER row is not a claim — silent, and the pool never saw it', R28_IDS([R28_A, R28_CORRECTION]) === '' && !R28_CODES([R28_A, R28_CORRECTION]).includes('C8') && markerMatches(CLAIM_COMMENT_MARKER, R28_CORRECTION.body) === false);
  t('…and the #17366 exit still WORKS: the declaration is read off the correction, untouched by this row', cardDeclaration([R28_A, R28_CORRECTION]).state === 'declared' && cardDeclaration([R28_A, R28_CORRECTION]).correctionNote !== undefined);
  t('⛔ CONTROL: write that same correction as a SECOND `Claim:` instead and it is named — which is the whole card', R28_IDS([R28_A, R28_B]) !== '' && says(R28_ROW([R28_A, R28_B]), 'never enters the pool'));

  // (e) ONE reading of the marker, and it is the sibling's (#18764).
  const R28_BOLD = R28_CLAIM(7100000030, '2026-09-18T02:00:00Z', R28_SEAT, { marker: '**Claim:**', round: 2 });
  const R28_TICK = R28_CLAIM(7100000031, '2026-09-18T02:00:00Z', R28_SEAT, { marker: '`Claim:`', round: 2 });
  t('⭐ (e) a DECORATED second claim (`**Claim:**`) is counted exactly as a bare one', R28_IDS([R28_A, R28_BOLD]) === '7100000001+7100000030');
  t('…and the backticked spelling with it', R28_IDS([R28_A, R28_TICK]) === '7100000001+7100000031');
  t('⛔ CONTROL: the raw constant REFUSES both bodies — the counting is the sibling\'s ONE reading, ⛔ not a second reader here', CLAIM_COMMENT_MARKER.test(R28_BOLD.body) === false && CLAIM_COMMENT_MARKER.test(R28_TICK.body) === false && markerMatches(CLAIM_COMMENT_MARKER, R28_BOLD.body) === true);
  t('⛔ CONTROL: a markdown LIST ITEM is not a claim, so it is not a SECOND one either — the refusals are the sibling\'s', R28_IDS([R28_A, R28(7100000032, '2026-09-18T02:00:00Z', R28_SEAT, '- Claim: PM loop round 2\nBranch: `claude/issue-4242-second`')]) === '');

  // (f) the prohibition is on the WRITING, ⛔ not on the parse.
  const R28_UNPARSED = R28_CLAIM(7100000040, '2026-09-18T02:00:00Z', R28_SEAT, { round: 2, branch: null });
  t('⭐ (f) a second claim whose `Branch:` parses to ZERO branches is still a second claim', R28_IDS([R28_A, R28_UNPARSED]) === '7100000001+7100000040');
  t('…and it is named even though governance itself is unresolvable on that thread', cardDeclaration([R28_A, R28_UNPARSED]).state === 'claim-branch-unparsed' && R28_CODES([R28_A, R28_UNPARSED]).includes('C8'));
  t('⛔ CONTROL: give that same row a parseable branch and the two are named just the same — the parse fires nothing', R28_IDS([R28_A, { ...R28_UNPARSED, body: R28_B.body }]) === '7100000001+7100000040');

  // (g) one refusal per seat, ⛔ never one per pair.
  const R28_C = R28_CLAIM(7100000050, '2026-09-18T03:00:00Z', R28_SEAT, { round: 3, branch: 'claude/issue-4242-third' });
  t('⭐ (g) THREE claims by one seat ⇒ ONE refusal naming all three', claimRepeats([R28_A, R28_B, R28_C]).length === 1 && R28_IDS([R28_A, R28_B, R28_C]) === '7100000001+7100000002+7100000050');
  t('…and exactly ONE C8 row on the pair — ⛔ not one per ordered pair, which would have been three', R28_CODES([R28_A, R28_B, R28_C]).filter((c) => c === 'C8').length === 1);
  t('…with all three ids in the sentence a reader is handed', says(R28_ROW([R28_A, R28_B, R28_C]), '7100000001') && says(R28_ROW([R28_A, R28_B, R28_C]), '7100000002') && says(R28_ROW([R28_A, R28_B, R28_C]), '7100000050'));
  t('⛔ CONTROL: retract two of the three and one standing claim is left — silent', R28_IDS([R28_A, R28_B, R28(7100000051, '2026-09-18T02:30:00Z', R28_SEAT, 'Release: session `x`, cause: y, 去向: `pm:queue`'), R28_C]) === '');

  // (h) fail closed on an unattributable row — the way `claimRetractions` does.
  const R28_NO_USER = { id: 7100000060, created_at: '2026-09-18T02:00:00Z', body: R28_B.body };
  t('⭐ (h) an unattributable LATER row is never counted — ⛔ `null` is a refusal, never a wildcard', R28_IDS([R28_A, R28_NO_USER]) === '' && !R28_CODES([R28_A, R28_NO_USER]).includes('C8'));
  t('…and an unattributable FIRST row is not counted either — both sides fail closed', R28_IDS([{ id: 7100000061, created_at: '2026-09-18T01:00:00Z', body: R28_A.body }, R28_B]) === '');
  t('…and TWO unattributable rows are not ONE seat either — ⛔ `null` never groups with `null`', R28_IDS([{ id: 7100000062, created_at: '2026-09-18T01:00:00Z', body: R28_A.body }, { id: 7100000063, created_at: '2026-09-18T02:00:00Z', body: R28_B.body }]) === '');
  t('…and the direction is STATED in the rule the row prints, so silence here is readable rather than inferred', CLAIM_REPEAT_RULE.includes('unattributable row is never counted'));
  t('⛔ CONTROL: give that same row a login and it is named — the attribution is what was missing', R28_IDS([R28_A, { ...R28_NO_USER, user: { login: R28_SEAT } }]) === '7100000001+7100000060');

  // (i) the seat's own shape: a later comment that QUOTES or DISCUSSES the word.
  const R28_QUOTE = R28(7100000070, '2026-09-18T02:00:00Z', R28_SEAT, [
    '⚠️ 本席上一条 `Claim:` 的申报行写错了,已另发 `Clause-②-correction:` 更正,⛔ 未再发一条认领。',
    '      "question": "the governing-claim instrument reads a second Claim: as a SUPERSESSION",',
  ]);
  const R28_ROUND_REPORT = R28(7100000071, '2026-09-18T03:00:00Z', R28_SEAT, [
    '## 轮次报告 — `domain:cli` 执行 PM 席',
    '- 本轮认领 3 张卡;每张 Claim: 行均由本席发出。',
  ]);
  t('⭐ (i) a later same-author comment that QUOTES the word is not a claim — the marker is read at LINE START', R28_IDS([R28_A, R28_QUOTE]) === '' && !R28_CODES([R28_A, R28_QUOTE]).includes('C8'));
  t('…and a round report mentioning the word mid-line is not one either', R28_IDS([R28_A, R28_ROUND_REPORT]) === '');
  t('…both of them together with the claim still leave exactly one standing claim on the thread', claimCarrierSelection([R28_A, R28_QUOTE, R28_ROUND_REPORT]).live.length === 1);
  t('⛔ CONTROL: move that same word to the OPENING of a line and it IS a second claim', R28_IDS([R28_A, R28(7100000072, '2026-09-18T02:00:00Z', R28_SEAT, 'Claim: 本席重新认领\nBranch: `claude/issue-4242-second`')]) === '7100000001+7100000072');

  // The unread and empty halves — ⛔ never a clean reading.
  t('⛔ an UNREAD thread names nobody and reads nothing', claimRepeats(null).length === 0 && c8SecondClaimSameSeat({ pr: 1, card: 2, cardComments: null }) === null);
  t('…and the record SAYS unread rather than reporting a clean thread', says(R28_FIELD(null, 'claim.repeat'), 'UNREAD'));
  t('⛔ an EMPTY thread is silent, and says the other sentence', claimRepeats([]).length === 0 && says(R28_FIELD([], 'claim.repeat'), 'none — no author holds'));

  // ⭐ The LIVE census, replayed from the real rows the filing card named.
  // Population: both boards this gate reads, at 2026-09-18T00:05Z — 533 open
  // cards in `objectstack-ai/objectstack`, 416 in `objectstack-ai/objectui`,
  // 167 of them carrying at least one claim comment. The five below are the
  // measured instances on the objectstack board, all by one seat; #18559 is the
  // same seat on the same shift doing it the sanctioned way.
  const R28_LIVE = (id, at, head) => R28(id, at, R28_SEAT, [
    head,
    '',
    'Claim: session `session_01DvvamiacK328idtBYJBxV3`',
    'Branch: `claude/issue-18540-actions-native-error-leak`',
    'Clause-②: no',
  ]);
  const R28_LIVE_CARDS = [
    [18540, R28_LIVE(5719079496, '2026-09-17T18:09:58Z', '## 认领 — `domain:cli` 执行 PM 席'), R28_LIVE(5720020876, '2026-09-17T19:28:06Z', '## 认领(补正,取代 `5719079496` 的申报行)— `domain:cli` 执行 PM 席')],
    [18677, R28_LIVE(5720104138, '2026-09-17T19:34:43Z', '## 认领'), R28_LIVE(5720190458, '2026-09-17T19:42:03Z', '## 认领(补正)')],
    [18748, R28_LIVE(5720212595, '2026-09-17T19:43:49Z', '## 认领'), R28_LIVE(5720888122, '2026-09-17T20:36:49Z', '## 认领(补正)')],
    [18651, R28_LIVE(5721424769, '2026-09-17T21:23:22Z', '## 认领'), R28_LIVE(5721997887, '2026-09-17T22:20:07Z', '## 认领(补正)')],
    [18778, R28_LIVE(5721425530, '2026-09-17T21:23:25Z', '## 认领'), R28_LIVE(5722028692, '2026-09-17T22:23:32Z', '## 认领(补正)')],
  ];
  t('⭐ the five measured instances (2026-09-18T00:05Z) are ALL named — ⛔ five green readings before this row', R28_LIVE_CARDS.every(([, a, b]) => claimRepeats([a, b]).length === 1));
  t('…each naming its own two comment ids and the one seat that wrote them', R28_LIVE_CARDS.every(([, a, b]) => R28_IDS([a, b]) === `${a.id}+${b.id}` && claimRepeats([a, b])[0]?.author === R28_SEAT), R28_LIVE_CARDS.map(([n, a, b]) => `${n}:${R28_IDS([a, b])}`).join(' '));
  t('⛔ …and every one of them read GREEN before, as a SUPERSESSION — the measurement this row answers', R28_LIVE_CARDS.every(([, a, b]) => says(R28_FIELD([a, b], 'claim.rejected'), 'a SUPERSEDED claim')));
  t('⛔ CONTROL #18559 — the same seat, same shift, the SANCTIONED shape: one claim plus a correction ⇒ silent', (() => {
    const claim = R28_LIVE(5721425131, '2026-09-17T21:23:24Z', '## 认领 — `domain:cli` 执行 PM 席 #6024');
    const correction = R28(5721779100, '2026-09-17T21:57:34Z', R28_SEAT, ['Clause-②-correction: 5721425131', 'Clause-②: no', 'Session: `session_01DvvamiacK328idtBYJBxV3`']);
    return claimRepeats([claim, correction]).length === 0 && !R28_CODES([claim, correction]).includes('C8');
  })());
  t('⭐ …and that control IS the repair this row prints, which is why the row prints it', says(R28_ROW([R28_A, R28_B]), 'Clause-②-correction: <claim comment id>'));

  // ONE derivation — the record and the verdict cannot disagree. ⛔ Every
  // assertion below reads the group defensively: under an ablation the pin
  // must FAIL, and a pin that THROWS aborts the run and names nothing.
  t('the repeat field is DECLARED in the pair roster, so it renders on every block, filled or not', INPUT_RECORD_PAIR_FIELDS.includes('claim.repeat'));
  t('⭐ ONE derivation: the ids the ROW names are the ids the RECORD names', (claimRepeats([R28_A, R28_B])[0]?.ids ?? []).length === 2 && (claimRepeats([R28_A, R28_B])[0]?.ids ?? []).every((id) => says(R28_ROW([R28_A, R28_B]), id) && says(R28_FIELD([R28_A, R28_B], 'claim.repeat'), id)));
  t('⛔ the row is not in the sweep\'s NOTE family and the record carries no verdict word for it', !says(R28_FIELD([R28_A, R28_B], 'claim.repeat'), 'exit 4') && says(R28_FIELD([R28_A, R28_B], 'claim.repeat'), 'row C8 is the verdict'));

  // -- #18862: cross-author LIVE claims with no `Release:` between ------------
  //
  // The ruling's shape, pinned per DIRECTION with a non-vacuity control each
  // (a thread that is silent proves nothing unless the SAME thread, with one
  // thing changed, is named), then the twelve measured rows replayed from the
  // REST rows. Judged / listed is the effective instant's line, and both halves
  // are pinned on the same fixture with only the taker's date moved.
  battery('#18862: cross-author LIVE claims with no `Release:` between — the hand-over the protocol never wrote, named; judged only after its effective instant');
  const X62 = (id, at, login, lines) => ({ id, created_at: at, user: { login }, body: [].concat(lines).join('\n') });
  const X62_CLAIM = (id, at, login, branch = 'claude/issue-4343-first') => X62(id, at, login, ['Claim: PM loop round 1', `Branch: \`${branch}\``, 'Clause-②: no']);
  const X62_BEFORE = '2026-09-18T10:00:00Z';
  const X62_BEFORE2 = '2026-09-18T11:00:00Z';
  const X62_AFTER = '2026-09-20T10:00:00Z';
  const X62_AFTER2 = '2026-09-20T11:00:00Z';
  const X62_HOLDER = X62_CLAIM(7200000001, X62_BEFORE, 'seat-holder');
  const X62_TAKER_AFTER = X62_CLAIM(7200000002, X62_AFTER, 'seat-taker', 'claude/issue-4343-second');
  const X62_TAKER_BEFORE = X62_CLAIM(7200000003, X62_BEFORE2, 'seat-taker', 'claude/issue-4343-second');
  const X62_PAIR = (rows) => ({ pr: 19999, card: 18862, draft: true, prLabels: [], cardLabels: [], cardComments: rows });
  const X62_CODES = (rows) => pairRows(X62_PAIR(rows)).map((r) => r.code);
  const X62_NOTES = (rows) => pairNotes(X62_PAIR(rows)).map((n) => n.code);
  const X62_ROW = (rows) => pairRows(X62_PAIR(rows)).find((r) => r.code === 'C9')?.text ?? '';
  const X62_NOTE = (rows) => pairNotes(X62_PAIR(rows)).find((n) => n.code === 'C9-BEFORE-EFFECTIVE')?.text ?? '';
  const X62_FIELD = (rows, key) => [pairInputRecord(X62_PAIR(rows))[key]].flat().join('\n');
  const X62_CHAIN = (rows) => (claimHandovers(rows)?.handovers ?? []).map((h) => `${h.fromAuthor}>${h.toAuthor}${h.judged ? '!' : ''}`).join(' ');
  const X62_SHIFT = (rows, days) => rows.map((r) => ({ ...r, created_at: new Date(Date.parse(r.created_at) + days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z') }));

  // (a) the judged shape — the taker dated AFTER the instant.
  t('⭐ (a) two LIVE claims by DIFFERENT authors, the taker dated AFTER the instant ⇒ ONE named hand-over, JUDGED', X62_CHAIN([X62_HOLDER, X62_TAKER_AFTER]) === 'seat-holder>seat-taker!' && claimHandovers([X62_HOLDER, X62_TAKER_AFTER])?.judged === true, X62_CHAIN([X62_HOLDER, X62_TAKER_AFTER]));
  t('…and `--pair` earns a C9 FINDING, which is its exit 4', X62_CODES([X62_HOLDER, X62_TAKER_AFTER]).includes('C9') && EXIT_PAIR_ADVERSE === 4 && EXIT_PAIR_ADVERSE !== EXIT_OK, X62_CODES([X62_HOLDER, X62_TAKER_AFTER]).join());
  t('⛔ …a VERDICT and never a NOTE: no `C9-BEFORE-EFFECTIVE` note rides beside a judged row', !X62_NOTES([X62_HOLDER, X62_TAKER_AFTER]).includes('C9-BEFORE-EFFECTIVE'));
  t('…the ROW names both authors, both comment ids and the instant it judged against', says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'seat-holder') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'seat-taker') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), '7200000001') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), '7200000002') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT));
  t('…and carries the ruling\'s remedy sentence: the HOLDER posts `Release:`, the TAKER posts nothing until then, and a yield is the taker\'s own `Release:` with 去向 「让先到者」', says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'the HOLDER (the earlier live claimant) posts `Release:`') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'the TAKER posts nothing until then') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), '让先到者'));
  t('…and says a correction cannot repair it — ⛔ not a widening of C8, in the row\'s own words', says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'a hand-over is not a declaration') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'never printed as a SUPERSESSION'));
  t('⛔ C8 is SILENT on that same thread — the new row is the one that speaks, never both for two authors with one claim each', !X62_CODES([X62_HOLDER, X62_TAKER_AFTER]).includes('C8') && claimRepeats([X62_HOLDER, X62_TAKER_AFTER]).length === 0);
  t('⛔ CONTROL: the SELECTOR did not move — the newer still governs and the older is still listed SUPERSEDED in the record; the verdict is the row\'s', claimCarrierSelection([X62_HOLDER, X62_TAKER_AFTER]).pool.map((r) => r.id).join() === '7200000002' && says(X62_FIELD([X62_HOLDER, X62_TAKER_AFTER], 'claim.rejected'), 'a SUPERSEDED claim') && CLAIM_SELECTION_RULE.includes('the GOVERNING claim'));
  t('…and the input record READS the same state beside the carrier it selected', says(X62_FIELD([X62_HOLDER, X62_TAKER_AFTER], 'claim.handover'), '7200000001') && says(X62_FIELD([X62_HOLDER, X62_TAKER_AFTER], 'claim.handover'), '7200000002') && says(X62_FIELD([X62_HOLDER, X62_TAKER_AFTER], 'claim.handover'), 'JUDGED'));

  // (b) the informational shape — the SAME pair, the taker dated BEFORE the instant.
  t('⭐ (b) the SAME pair with the taker dated at or before the instant ⇒ LISTED, ⛔ not judged', X62_CHAIN([X62_HOLDER, X62_TAKER_BEFORE]) === 'seat-holder>seat-taker' && claimHandovers([X62_HOLDER, X62_TAKER_BEFORE])?.judged === false);
  t('…no C9 row and no C8 row, so the exit is unmoved', !X62_CODES([X62_HOLDER, X62_TAKER_BEFORE]).includes('C9') && !X62_CODES([X62_HOLDER, X62_TAKER_BEFORE]).includes('C8'));
  t('…and a `C9-BEFORE-EFFECTIVE` NOTE instead, naming both ids and saying in as many words that it moves no exit', X62_NOTES([X62_HOLDER, X62_TAKER_BEFORE]).includes('C9-BEFORE-EFFECTIVE') && says(X62_NOTE([X62_HOLDER, X62_TAKER_BEFORE]), '7200000001') && says(X62_NOTE([X62_HOLDER, X62_TAKER_BEFORE]), '7200000003') && says(X62_NOTE([X62_HOLDER, X62_TAKER_BEFORE]), 'This note moves no exit') && says(X62_NOTE([X62_HOLDER, X62_TAKER_BEFORE]), 'listed as informational, never red'));
  t('…and the record says LISTED, informational, and names the note', says(X62_FIELD([X62_HOLDER, X62_TAKER_BEFORE], 'claim.handover'), 'LISTED') && says(X62_FIELD([X62_HOLDER, X62_TAKER_BEFORE], 'claim.handover'), 'C9-BEFORE-EFFECTIVE'));
  t('⛔ CONTROL: the note and the row are ONE derivation — move only the taker\'s date and the same sentence moves from note to row', says(X62_NOTE([X62_HOLDER, X62_TAKER_BEFORE]), 'took the card from `seat-holder`') && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), 'took the card from `seat-holder`') && X62_ROW([X62_HOLDER, X62_TAKER_BEFORE]) === '' && X62_NOTE([X62_HOLDER, X62_TAKER_AFTER]) === '');

  // (c) the instant itself.
  const X62_AT = `${CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT.slice(0, -1)}:00Z`;
  const X62_AT_PLUS_ONE = new Date(Date.parse(X62_AT) + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  t('⭐ (c) the instant is STRICT: a taker stamped exactly AT it is history; one minute later is judged', X62_CHAIN([X62_HOLDER, X62_CLAIM(7200000004, X62_AT, 'seat-taker')]) === 'seat-holder>seat-taker' && X62_CHAIN([X62_HOLDER, X62_CLAIM(7200000004, X62_AT_PLUS_ONE, 'seat-taker')]) === 'seat-holder>seat-taker!');
  t('…and the constant is a UTC minute in ISO shape, parseable, and in the PAST — a future instant would list every pair forever', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT) && Number.isFinite(Date.parse(CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT)) && Date.parse(CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT) < Date.now());
  t('…and the rule PRINTED with the row carries the instant, so two runs are comparable on it', CLAIM_HANDOVER_RULE.includes(CROSS_AUTHOR_CLAIM_ROW_EFFECTIVE_AT) && says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), CLAIM_HANDOVER_RULE.slice(0, 80)));
  t('⛔ an UNREADABLE date on the taker is LISTED, never judged — fail closed toward the standing record; give it a date after and it is judged', claimHandovers([X62_HOLDER, { ...X62_TAKER_AFTER, created_at: 'not a date' }])?.handovers.map((h) => h.dated).join() === 'unreadable' && claimHandovers([X62_HOLDER, { ...X62_TAKER_AFTER, created_at: 'not a date' }])?.judged === false && says(X62_NOTE([X62_HOLDER, { ...X62_TAKER_AFTER, created_at: 'not a date' }]), 'NO readable date') && claimHandovers([X62_HOLDER, X62_TAKER_AFTER])?.judged === true);

  // (d) MEMBERSHIP first — a release by the holder, or by the taker, clears it.
  const X62_RELEASE = (id, at, login, line = 'Release: session `session_x`, 因: 交接, 去向: `seat-taker`') => X62(id, at, login, line);
  t('⭐ (d) the holder\'s `Release:` AFTER the taker\'s claim clears it — one author left, silent, no note', claimHandovers([X62_HOLDER, X62_TAKER_AFTER, X62_RELEASE(7200000010, X62_AFTER2, 'seat-holder')]) === null && !X62_CODES([X62_HOLDER, X62_TAKER_AFTER, X62_RELEASE(7200000010, X62_AFTER2, 'seat-holder')]).includes('C9') && X62_NOTES([X62_HOLDER, X62_TAKER_AFTER, X62_RELEASE(7200000010, X62_AFTER2, 'seat-holder')]).length === 0);
  t('…and the holder\'s `Release:` BEFORE the taker\'s claim is the protocol working — a re-claim after a release', claimHandovers([X62_HOLDER, X62_RELEASE(7200000010, '2026-09-19T12:00:00Z', 'seat-holder'), X62_TAKER_AFTER]) === null);
  t('…and a DECORATED `**Release:**` by the holder clears it the same way — the one reading (#18829 A); the raw constant refuses that body', claimHandovers([X62_HOLDER, X62_TAKER_AFTER, X62_RELEASE(7200000010, X62_AFTER2, 'seat-holder', '**Release:** session `session_x` · 去向 `seat-taker`')]) === null && RELEASE_COMMENT_MARKER.test('**Release:** session `session_x` · 去向 `seat-taker`') === false);
  t('…and the TAKER\'s own `Release:` (去向 「让先到者」) clears it too — the #18773 A withdrawal', claimHandovers([X62_HOLDER, X62_TAKER_AFTER, X62_RELEASE(7200000011, X62_AFTER2, 'seat-taker', 'Release: session `session_y`, 因: 先到者在先, 去向: 让先到者')]) === null);
  t('⛔ CONTROL: a `Release:` by a THIRD author clears nothing — the pair is still judged', claimHandovers([X62_HOLDER, X62_TAKER_AFTER, X62_RELEASE(7200000012, X62_AFTER2, 'seat-third')])?.judged === true);
  t('⛔ CONTROL: a PROSE withdrawal by the taker (「撤回…」, the claim\'s id named) clears nothing now — the act has one spelling (#18773 A)', claimHandovers([X62_HOLDER, X62_TAKER_AFTER, X62(7200000013, X62_AFTER2, 'seat-taker', '撤回本席的认领 `7200000002` —— 先到者是 seat-holder')])?.judged === true);

  // (e) same-author and mixed threads — C8 and C9 are disjoint states.
  const X62_A2 = X62_CLAIM(7200000020, X62_AFTER2, 'seat-holder', 'claude/issue-4343-third');
  const X62_B2 = X62_CLAIM(7200000021, X62_AFTER2, 'seat-taker', 'claude/issue-4343-third');
  const X62_C = X62_CLAIM(7200000022, X62_AFTER2, 'seat-third', 'claude/issue-4343-third');
  t('⭐ (e) two live claims by ONE author ⇒ C8\'s alone — no hand-over, no note', claimHandovers([X62_HOLDER, X62_A2]) === null && X62_CODES([X62_HOLDER, X62_A2]).includes('C8') && !X62_CODES([X62_HOLDER, X62_A2]).includes('C9') && X62_NOTES([X62_HOLDER, X62_A2]).length === 0);
  t('⭐ A, B, B′ ⇒ ONE hand-over (A→B) beside C8\'s row for B — both rows, never one sentence out of two states', X62_CHAIN([X62_HOLDER, X62_TAKER_AFTER, X62_B2]) === 'seat-holder>seat-taker!' && X62_CODES([X62_HOLDER, X62_TAKER_AFTER, X62_B2]).includes('C8') && X62_CODES([X62_HOLDER, X62_TAKER_AFTER, X62_B2]).includes('C9'));
  t('⭐ A, B, A′ ⇒ TWO hand-overs (A→B, B→A) — the author CHANGES are what is named, ⛔ not the distinct author pairs', X62_CHAIN([X62_HOLDER, X62_TAKER_AFTER, X62_A2]) === 'seat-holder>seat-taker! seat-taker>seat-holder!');
  t('⭐ three authors A, B, C ⇒ two hand-overs in ONE row — ⛔ never one row per hand-over', X62_CHAIN([X62_HOLDER, X62_TAKER_AFTER, X62_C]) === 'seat-holder>seat-taker! seat-taker>seat-third!' && X62_CODES([X62_HOLDER, X62_TAKER_AFTER, X62_C]).filter((c) => c === 'C9').length === 1);
  t('…and a thread judged on ONE hand-over among several is judged — the informational ones are still listed in the same sentence', X62_CHAIN([X62_HOLDER, X62_TAKER_BEFORE, X62_C]) === 'seat-holder>seat-taker seat-taker>seat-third!' && says(X62_ROW([X62_HOLDER, X62_TAKER_BEFORE, X62_C]), '1 judged, 1 informational'));

  // (f) fail closed on an unattributable row — the way `claimRetractions` does.
  t('⭐ (f) an unattributable LATER row is never counted — ⛔ `null` is a refusal, never a wildcard', claimHandovers([X62_HOLDER, { id: 7200000030, created_at: X62_AFTER, body: X62_TAKER_AFTER.body }]) === null);
  t('…nor an unattributable FIRST row', claimHandovers([{ id: 7200000031, created_at: X62_BEFORE, body: X62_HOLDER.body }, X62_TAKER_AFTER]) === null);
  t('⛔ CONTROL: give that same row a login and it is named — the attribution is what was missing', X62_CHAIN([X62_HOLDER, { id: 7200000030, created_at: X62_AFTER, user: { login: 'seat-taker' }, body: X62_TAKER_AFTER.body }]) === 'seat-holder>seat-taker!');

  // The unread and empty halves — ⛔ never a clean reading.
  t('⛔ an UNREAD thread names nobody: null state, no row, no note, and the record says UNREAD', claimHandovers(null) === null && c9CrossAuthorLiveClaims({ pr: 1, card: 2, cardComments: null }) === null && c9HandoverNote({ pr: 1, card: 2, cardComments: null }) === null && says(X62_FIELD(null, 'claim.handover'), 'UNREAD'));
  t('⛔ an EMPTY thread and a one-author thread are silent, and say the other sentence', claimHandovers([]) === null && says(X62_FIELD([], 'claim.handover'), 'none — every LIVE claim comment') && says(X62_FIELD([X62_HOLDER], 'claim.handover'), 'none — every LIVE claim comment'));

  // ⭐ THE TWELVE MEASURED ROWS, replayed from the REST rows (read
  // 2026-09-19T03:30Z through the proxy; ids, stamps, logins and the
  // load-bearing LINES are the real ones — the claim line, its `Branch:` /
  // `Clause-②` lines where the comment carried them, and every `Release:`
  // line). ⚠️ Threads move: #15811 and #18373 have CLOSED since, #17852 gained
  // a third claimant (os-elon-musk, 2026-09-18T22:04Z) — which is why the
  // reading below carries its time and names the pair it finds TODAY.
  const X62_LIVE = {
    'objectstack#13503': [
      { id: 5511498840, created_at: '2026-09-02T14:51:25Z', user: { login: 'claude[bot]' }, body: 'Claim: session `session_01WLJQhde67SeTccsmnBVarV` (domain:devx execution seat, seat post #6023) — R1 wave 8. **Measurement card — the deliverable is a classification report on this issue, not a PR.**' },
      { id: 5511828156, created_at: '2026-09-02T15:14:17Z', user: { login: 'claude[bot]' }, body: 'Claim: session `session_01WLJQhde67SeTccsmnBVarV` (domain:devx execution seat, seat post #6023) — R1 wave 8. Measurement card, no repo change. Deliverable below.' },
      { id: 5534928818, created_at: '2026-09-04T02:45:07Z', user: { login: 'claude[bot]' }, body: ['Claim: PM loop round R7 — **PR 1 only (the base-ref guard); the deletion is NOT dispatched**', 'Branch: `claude/issue-13503-reaper-base-ref-guard`', 'Clause-②: no (per the ruling)'].join('\n') },
      { id: 5534987871, created_at: '2026-09-04T02:53:29Z', user: { login: 'baozhoutao' }, body: 'Claim: session `session_012zGPuVVX3deAx9LdjK8jCk` (domain:devx execution seat, os-dev subagent) — **PR 1 only: the reaper\'s base-ref guard + its self-test row.**' },
    ],
    'objectstack#14026': [
      { id: 5486688759, created_at: '2026-09-01T00:26:07Z', user: { login: 'hotlong' }, body: '`Claim:` session `9474bf6f-d90c-5a21-b347-0245cc7e5487` · branch `claude/issue-14026-wizard-named-mapping`' },
      { id: 5552047289, created_at: '2026-09-05T13:11:17Z', user: { login: 'claude[bot]' }, body: ['Claim: `domain:cli` execution seat, session `session_01ARYe3yQTQCUFm5qPYNgKaJ`', 'Branch: `claude/issue-14026-import-mapping-selector-probe`', 'Clause-②: no'].join('\n') },
    ],
    'objectstack#15811': [
      { id: 5629615394, created_at: '2026-09-11T04:45:52Z', user: { login: 'os-bill' }, body: ['Claim: session_01MkQhmuuJAVDjmeWNixwDDH', 'Branch: `claude/issue-15811-evaluated-slot-census`', 'Clause-②: no'].join('\n') },
      { id: 5712959532, created_at: '2026-09-17T10:37:05Z', user: { login: 'os-litant' }, body: ['Claim: PM loop round 3', 'Branch: `claude/issue-15811-evaluated-slot-narrowing`', 'Clause-②: no'].join('\n') },
    ],
    'objectstack#17852': [
      { id: 5700342438, created_at: '2026-09-16T15:46:37Z', user: { login: 'os-warren' }, body: ['Claim: `domain:spec` execution seat, session `session_01KB5PFtxuy1x3dcR5gxudx6`, 2026-09-16T15:45Z. Assignee set in the same label write (`pm:queue` → `pm:dispatched`, read back and matched). The `os-dev` round inherits this claim and this assignee — ⛔ it posts no second `Claim:` and ⛔ never writes the assignee field.', 'Branch: `claude/issue-17852-zod-record-proto-drop`', '**Clause-②: no** — the card\'s landable half is *pinning an invariant that already holds by accident*. No key is added to a published payload and no accept set moves. ⇒ the PR body carries its own line-initial `Clause-②: no` line, because there is no carrier label to declare it. ⚠️ If the measurement shows the fix needs an accept set or a published parse contract to move, **stop and report** — this seat re-declares here, ⛔ the dev does not, and ⛔ the dev neither hangs nor strips `needs:contract-review` (that carrier is the seat\'s).'].join('\n') },
      { id: 5700605769, created_at: '2026-09-16T16:05:46Z', user: { login: 'os-warren' }, body: '`Release:` session `session_01KB5PFtxuy1x3dcR5gxudx6` · 因 = 轮次证伪了卡片的 latent 前提,剩下的方向选择落在人工地板(契约变化 / 破坏性动作) · 去向 = 维护者决策箱。assignee 同笔清空,下一任重新认领。' },
      { id: 5722689444, created_at: '2026-09-17T23:37:05Z', user: { login: 'os-litant' }, body: ['Claim: PM loop round 2026-09-17 R2', 'Branch: `claude/issue-17852-zod-record-proto-drop`', 'Clause-②: yes'].join('\n') },
      { id: 5736740985, created_at: '2026-09-18T22:04:12Z', user: { login: 'os-elon-musk' }, body: ['Claim: the `domain:spec` execution seat takes this card at 2026-09-18T22:04Z under the maintainer\'s ruling **A, narrow** (batch #154 item 1, comment 5725370319, 「同意」). Both serial constraints seat 4 recorded at 5725825370 have cleared. ⛔ The ruling is implemented as written and is not re-argued; ⛔ neither 甲, nor 乙, nor this card\'s B / C / D is implemented.', 'Branch: `claude/issue-17852-record-key-preparse-guard`', 'Clause-②: yes — the ruling states it outright (「Accept set narrows for three names nobody writes ⇒ `Clause-②: yes`;spec lane at-tier review;changeset `@objectstack/spec` minor」). It is also what the maintainer\'s own take-order test returns: a document whose `fields` carry `__proto__` is ACCEPTED today and REFUSED after the fix — the same input, a different answer, in the tightening direction.'].join('\n') },
    ],
    'objectui#4730': [
      { id: 5395356257, created_at: '2026-08-24T12:43:47Z', user: { login: 'yinlianghui' }, body: ['Claim: PM loop round 38', 'Branch: `claude/issue-4730-console-objectview-dead-keys`', 'Clause-②: **no** — deleting locale keys with zero readers changes no contract accept/reject behaviour and widens no public surface. It is a removal executed under a recorded maintainer ruling.'].join('\n') },
      { id: 5451169358, created_at: '2026-08-28T10:01:53Z', user: { login: 'os-sales' }, body: 'Claim: `domain:ui` execution seat, PM session `session_01CRJge11jso9TpXRWFt1Z49`, branch `claude/issue-4730-i18n-dead-key-batch`.' },
    ],
    'objectui#7070': [
      { id: 5486631561, created_at: '2026-09-01T00:18:59Z', user: { login: 'os-warren' }, body: ['Claim: PM loop round 3 (`domain:ui` seat)', 'Branch: `claude/issue-7070-gantt-fabricated-date-fields`', 'Clause-②: **no** as scoped. Removing a fabricated default narrows what the *view layer invents*, not what a published contract accepts. ⚠️ If your measurement shows the gantt renderer has no refusal path and the honest fix turns out to move a published surface, say so — the tier follows the finding.'].join('\n') },
      { id: 5524602206, created_at: '2026-09-03T10:52:52Z', user: { login: 'claude[bot]' }, body: 'Claim: step ③ of the 2026-09-01 ruling (总监批 #28, comment 5494805467) — delete the two `created_at` floors at the plugin faces.' },
    ],
    'objectui#7696': [
      { id: 5562678212, created_at: '2026-09-06T22:38:38Z', user: { login: 'os-justin' }, body: '`Claim:` session `session_01YBWFb5YgMU5dw8p2VKj16S` · branch `claude/issue-7696-analytics-local-select-dimension-i18n`' },
      { id: 5662680923, created_at: '2026-09-14T10:40:21Z', user: { login: 'os-tesla' }, body: ['Claim: PM loop round R37', 'Branch: `claude/issue-7696-analytics-starvation-path-measurement`', 'Clause-②: no'].join('\n') },
    ],
    'objectui#7804': [
      { id: 5649902688, created_at: '2026-09-13T01:17:51Z', user: { login: 'os-tesla' }, body: ['Claimed: objectstack-ai/objectui#7804 — the **`plugin-kanban`** slice, dispatched to an `os-dev` seat by the `domain:ui` PM seat (`os-tesla`) at R33.', 'Clause-②: yes'].join('\n') },
      { id: 5650183110, created_at: '2026-09-13T02:19:14Z', user: { login: 'os-tesla' }, body: ['Claimed: objectstack-ai/objectui#7804 — the **`plugin-detail`** slice, dispatched to an `os-dev` seat by the `domain:ui` PM seat (`os-tesla`) at R34.', 'Clause-②: yes'].join('\n') },
      { id: 5652400741, created_at: '2026-09-13T09:16:42Z', user: { login: 'os-sam' }, body: ['Claimed: objectstack-ai/objectui#7804 — the **`plugin-detail`** slice, dispatched to an `os-dev` seat by the `domain:ui` PM seat (`os-tesla`) at R34.', 'Clause-②: yes', 'Branch: `claude/issue-7804-detail-arm`'].join('\n') },
      { id: 5672230114, created_at: '2026-09-14T23:28:09Z', user: { login: 'os-tesla' }, body: ['Claim: `domain:ui` execution seat — slice 1 of the handler-key burn-down, `DataTableSchema`', 'Branch: `claude/issue-7804-data-table-handler-keys`', 'Clause-②: yes'].join('\n') },
      { id: 5672790801, created_at: '2026-09-15T00:26:33Z', user: { login: 'os-tesla' }, body: ['Claim: `domain:ui` execution seat — slice 2 of the handler-key burn-down, the `objectql.ts` plain-interface group', 'Branch: `claude/issue-7804-objectql-handler-keys`', 'Clause-②: yes'].join('\n') },
      { id: 5681570956, created_at: '2026-09-15T14:07:49Z', user: { login: 'os-justin' }, body: ['Claim: PM loop round R1', 'Branch: `claude/issue-7804-listview-handler-keys-slice3`', 'Clause-②: yes — declared `yes` because this slice is **mixed-direction** and the widening half is real: the released note measures that `ListViewRuntimeProps` declares `onNavigate` and `onDensityChange` but **not** `onAddRecord` / `onBulkAction` / `onPageSizeChange`, so 「some keys want **adding** to `ListViewRuntimeProps`」 — adding a member to a published TypeScript interface **widens a declared public surface**, even though the zod-arm half (refusing keys the passthrough currently accepts and KEEPS) narrows. ⛔ The narrowing half does not cancel the widening half, and 「拿不准 ⇒ 按 `yes`」 applies to the mix. ⚠️ Per this lane\'s recorded tier ruling (`5612097546`, objectstack#17285) a `yes` here obliges the **carrier plus an in-seat review record of the required shape**, ⛔ not a contract-review-tier build'].join('\n') },
      { id: 5683570146, created_at: '2026-09-15T16:01:31Z', user: { login: 'os-justin' }, body: 'Release: PM loop round R1' },
      { id: 5706734325, created_at: '2026-09-17T00:50:47Z', user: { login: 'os-justin' }, body: ['Claim: PM loop round 2', 'Branch: `claude/issue-7804-handler-key-ledger-next-slice`', 'Clause-②: yes'].join('\n') },
      { id: 5707789209, created_at: '2026-09-17T02:58:27Z', user: { login: 'os-justin' }, body: '`Release:` `session_012EpHzwH4wTy5sd7ibkD2yq` · **partial landing** — objectui#9647 (slice 4, the `TreeViewSchema` arm, merged `604476d97de7`) · remainder **stays on this card**, ⛔ no re-homing, ⛔ no `pm:retriage`.' },
      { id: 5710581530, created_at: '2026-09-17T07:19:50Z', user: { login: 'os-justin' }, body: ['Claim: `domain:ui` execution seat, `session_012EpHzwH4wTy5sd7ibkD2yq` — **slice 6** of the handler-key burn-down: the `form.zod.ts` group. ⛔ Partial, ⛔ no closing keyword; this card stays open with the rest of its ledger.', 'Branch: `claude/issue-7804-form-handler-keys-slice6`', 'Clause-②: yes'].join('\n') },
      { id: 5710740327, created_at: '2026-09-17T07:34:45Z', user: { login: 'os-justin' }, body: '`Release:` `session_012EpHzwH4wTy5sd7ibkD2yq` · 因 = **前提证伪(派发席的过失,非 dev 的)** · 去向 = **回 `pm:queue`,⛔ 不加 `pm:retriage`** —— 卡的路由没问题,错的是本席选的 slice。闸门 `needs:contract-review` 同笔清除:⛔ 无交付、⛔ 无复核发生、⛔ 无记录可引。' },
    ],
    'objectui#7848': [
      { id: 5617516036, created_at: '2026-09-10T10:53:27Z', user: { login: 'claude[bot]' }, body: ['Claim: session `session_01FhBNJcLRZLe8M87VcUgpKr` · branch `claude/issue-7848-live-margin` · assignee `baozhoutao`', 'Clause-②: no'].join('\n') },
      { id: 5617804323, created_at: '2026-09-10T11:16:19Z', user: { login: 'claude[bot]' }, body: '**Release:** session `session_01FhBNJcLRZLe8M87VcUgpKr` · cause **re-priced on a new measurement** (the aggregate is healthy; the tight line is now `ui-components`) · destination **the decision box**. Assignee cleared and `pm:dispatched` → `needs-user-decision` in the same write.' },
      { id: 5638718748, created_at: '2026-09-11T18:06:36Z', user: { login: 'baozhoutao' }, body: '**Claim:** PM seat `domain:devx @ objectui`, session `session_01FhBNJcLRZLe8M87VcUgpKr`, dispatching **ruling item (1) only** to branch `claude/issue-7848-ui-components-slimming-census`.' },
      { id: 5639098952, created_at: '2026-09-11T18:40:59Z', user: { login: 'baozhoutao' }, body: '**Claim:** PM seat `domain:devx @ objectui`, session `session_01FhBNJcLRZLe8M87VcUgpKr`, dispatching **ruling item (2)** to branch `claude/issue-7848-record-absorbed-drift`.' },
    ],
    'objectui#7924': [
      { id: 5612023012, created_at: '2026-09-10T03:05:10Z', user: { login: 'os-warren' }, body: ['Claim: session `session_01Jmxdo7bmeqCQHLSfmLVX9w` (PM seat `domain:spec`, dispatching `os-dev`) · branch `claude/issue-7924-namedlistview-liveness-census`', 'Clause-②: no'].join('\n') },
      { id: 5613413938, created_at: '2026-09-10T04:58:10Z', user: { login: 'os-warren' }, body: '`Release:` **PR #8933 MERGED** — verified on the tree by content, ⛔ not from an API field. `pm:dispatched` → **`pm:queue`**, assignee cleared. ⛔ **The card does NOT close** (`Refs`, not `Fixes`): the census is done, the **disposition is not**, and it lives on objectui#7928.' },
      { id: 5719639605, created_at: '2026-09-17T18:55:52Z', user: { login: 'os-sales' }, body: ['Claim:', 'Branch: `claude/issue-7924-named-list-view-unread-members`', 'Clause-②: no'].join('\n') },
    ],
    'objectui#8115': [
      { id: 5577907812, created_at: '2026-09-08T01:54:03Z', user: { login: 'claude[bot]' }, body: ['Claim: PM loop round R46 — `domain:devx @ objectui` execution seat.', 'Branch: `claude/issue-8115-doc-type-exemptions`'].join('\n') },
      { id: 5594703484, created_at: '2026-09-09T02:09:54Z', user: { login: 'yinlianghui' }, body: ['Claim: PM loop round 1 (consolidated seat, maintainer-ordered takeover from `session_01FhBNJcLRZLe8M87VcUgpKr`) — ruled execution under option A, reading A₁ (answered above); start gate: the dev starts when a slot frees under the cap of 5 and after objectui#8114 is claimed ahead of it; the claim is posted now so the slot is held', 'Branch: `claude/issue-8115-doc-type-exemptions-a1`', 'Clause-②: no — a documentation gate over package READMEs; no published package surface moves (objectui `scripts/**` is not shipped)'].join('\n') },
    ],
    'objectui#9370': [
      { id: 5652138683, created_at: '2026-09-13T08:11:05Z', user: { login: 'os-tesla' }, body: ['Claim: objectui#9370 — move the three published `skills/objectui` guides off the retired `data` root and the retired `bind` resolution', 'Clause-②: yes'].join('\n') },
      { id: 5689310818, created_at: '2026-09-15T23:07:33Z', user: { login: 'os-justin' }, body: ['Claim: objectui#9370 — branch-line recovery of the standing claim (⛔ NOT a re-claim, ⛔ NOT a re-judgement)', 'Branch: `claude/issue-9370-skills-data-root`', 'Clause-②: yes'].join('\n') },
    ],
  };
  const X62_TEN = ['objectstack#13503', 'objectstack#14026', 'objectstack#15811', 'objectstack#17852', 'objectui#4730', 'objectui#7070', 'objectui#7696', 'objectui#7804', 'objectui#8115', 'objectui#9370'];
  const X62_TWO = ['objectui#7848', 'objectui#7924'];
  t('⭐ (h) the twelve are all here, and the two lists partition them', X62_TEN.length + X62_TWO.length === 12 && [...X62_TEN, ...X62_TWO].every((k) => Array.isArray(X62_LIVE[k]) && X62_LIVE[k].length >= 2) && Object.keys(X62_LIVE).length === 12);
  t('⭐ TEN still carry a cross-author hand-over today — every one LISTED, ⛔ none judged: all predate the instant', X62_TEN.every((k) => claimHandovers(X62_LIVE[k]) !== null && claimHandovers(X62_LIVE[k]).judged === false && X62_NOTES(X62_LIVE[k]).includes('C9-BEFORE-EFFECTIVE') && !X62_CODES(X62_LIVE[k]).includes('C9')), X62_TEN.map((k) => `${k}:${X62_CHAIN(X62_LIVE[k]) || '(none)'}`).join(' | '));
  t('⭐ …and TWO — objectui#7848 and #7924 — clear by #18829 A ALONE: the holder\'s decorated `Release:` is now READ, one author is left, nothing is named and no seat posted anything', X62_TWO.every((k) => claimHandovers(X62_LIVE[k]) === null && X62_NOTES(X62_LIVE[k]).every((c) => c !== 'C9-BEFORE-EFFECTIVE')), X62_TWO.map((k) => `${k}:${X62_CHAIN(X62_LIVE[k]) || '(none)'}`).join(' | '));
  t('⛔ CONTROL: drop that release row and each of the two is named again — the release is what clears it, and the raw constant refused it', X62_TWO.every((k) => { const rel = X62_LIVE[k].filter((r) => markerMatches(RELEASE_COMMENT_MARKER, r.body) && !markerMatches(CLAIM_COMMENT_MARKER, r.body)); return rel.length >= 1 && rel.every((r) => RELEASE_COMMENT_MARKER.test(r.body) === false) && claimHandovers(X62_LIVE[k].filter((r) => !rel.includes(r))) !== null; }));
  t('⭐ #17852: os-warren\'s backticked `Release:` takes his claim out, so the hand-over named TODAY is os-litant → os-elon-musk (2026-09-18T22:04Z), ⛔ not the os-warren / os-litant pair the sweep counted', X62_CHAIN(X62_LIVE['objectstack#17852']) === 'os-litant>os-elon-musk' && says(X62_FIELD(X62_LIVE['objectstack#17852'], 'claim.rejected'), 'RETRACTED'));
  t('⭐ objectui#9370: the second claim says 「⛔ NOT a re-claim」 in its first line and is named anyway — the reader reads order, ⛔ not intent', X62_CHAIN(X62_LIVE['objectui#9370']) === 'os-tesla>os-justin' && X62_LIVE['objectui#9370'].some((r) => r.body.includes('NOT a re-claim')));
  t('⭐ objectui#7804: os-justin\'s two backticked releases take his claims out; what stands is os-tesla ×4 (C8) and os-sam — C8 AND a listed hand-over each way, both from one thread', X62_CHAIN(X62_LIVE['objectui#7804']) === 'os-tesla>os-sam os-sam>os-tesla' && X62_CODES(X62_LIVE['objectui#7804']).includes('C8') && claimRepeats(X62_LIVE['objectui#7804']).map((g) => g.author).join() === 'os-tesla');
  t('⭐ objectstack#13503: three claude[bot] claims (C8) then baozhoutao — the retired identity is an author like any other here; its dead-claim `Release:` is the seat\'s act', X62_CHAIN(X62_LIVE['objectstack#13503']) === 'claude[bot]>baozhoutao' && X62_CODES(X62_LIVE['objectstack#13503']).includes('C8'));
  t('⭐ the three rows the triage seat re-read — #15811, #17852, objectui#9370 — each read GREEN before, as a SUPERSESSION: the measurement this row answers', ['objectstack#15811', 'objectstack#17852', 'objectui#9370'].every((k) => says(X62_FIELD(X62_LIVE[k], 'claim.rejected'), 'a SUPERSEDED claim')));
  t('⭐ every one of the ten, re-dated SIXTY days forward as if after the instant (the oldest real stamp is 2026-08-24), is JUDGED — the row is reachable on the real shapes, ⛔ not only on synthetic ones', X62_TEN.every((k) => claimHandovers(X62_SHIFT(X62_LIVE[k], 60))?.judged === true && X62_CODES(X62_SHIFT(X62_LIVE[k], 60)).includes('C9')), X62_TEN.map((k) => `${k}:${X62_CHAIN(X62_SHIFT(X62_LIVE[k], 60))}`).join(' | '));
  t('⛔ CONTROL: the shift is not vacuous — every real taking claim is dated BEFORE the instant as written', X62_TEN.every((k) => claimHandovers(X62_LIVE[k]).handovers.every((h) => h.dated === 'at-or-before')));
  // ⭐ #18373 — the #18719 specimen under #18773 A. The prose line no longer
  // retracts, so the thread carries two live authors, and THIS row is what
  // keeps that visible: listed, ⛔ not silent, and cleared by the act the
  // protocol names.
  t('⭐ #18373 after #18773 A: two live authors — os-litant, then os-bill — LISTED by this row, so the retired channel\'s cost is visible rather than silent', X62_CHAIN(RTX_18373) === 'os-litant>os-bill' && X62_NOTES(RTX_18373).includes('C9-BEFORE-EFFECTIVE') && !X62_CODES(RTX_18373).includes('C9'));
  t('…and the taker\'s own `Release:` (os-bill yields, 去向 让先到者) is what clears it — the same thread in the declared spelling names nobody', claimHandovers(RTX_18373_DECLARED) === null);

  // ONE derivation — the row, the note and the record cannot disagree.
  t('the hand-over field is DECLARED in the pair roster, so it renders on every block, filled or not', INPUT_RECORD_PAIR_FIELDS.includes('claim.handover'));
  t('⭐ ONE derivation: the ids the ROW names are the ids the RECORD names', ['7200000001', '7200000002'].every((id) => says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), id) && says(X62_FIELD([X62_HOLDER, X62_TAKER_AFTER], 'claim.handover'), id)));
  t('⛔ the informational note is not in the FINDING family and the record carries no verdict word for it', !says(X62_FIELD([X62_HOLDER, X62_TAKER_BEFORE], 'claim.handover'), 'exit 4') && says(X62_FIELD([X62_HOLDER, X62_TAKER_BEFORE], 'claim.handover'), 'LISTED'));
  t('⛔ C8\'s rule text still says the cross-author shape is not its state — and now names the row that reads it', CLAIM_REPEAT_RULE.includes('DIFFERENT authors are not this state') && CLAIM_REPEAT_RULE.includes('row C9'));
  t('the row is REPORT-ONLY, in the words every row prints', says(X62_ROW([X62_HOLDER, X62_TAKER_AFTER]), NEVER_WRITES));

  // -- #16770: the exit-0 line claims a LABEL comparison, never a declaration one --
  //
  // ⭐ A reworded sentence drifts back unless something holds it, and the thing
  // that has to be held is a NEGATIVE: the old bare clause -- 「and both …
  // carriers … agree」, assembled below as `G_BARE` rather than spelled out --
  // must not return to a green line. So this battery drives BOTH directions.
  //
  //   positive — the line NAMES what it compared (the label, both carriers) and
  //              STATES the non-read (the PR body), in all three of its branches
  //   negative — the bare phrase is absent, pinned on the SOURCE so a revert
  //              anywhere in the green line's construction reds, ⛔ not only a
  //              revert of the constant the positive cases read
  //
  // ⛔ The forbidden phrase is ASSEMBLED at runtime, never written out here: a
  // literal in the pin would be a hit in the very scan the pin performs, and
  // the case would fail on the day it was written. The idiom is this file's
  // own (the #18773 source-absence pin above), including its firing control —
  // a scan that finds nothing proves nothing until the same scan is shown to
  // find something.
  battery('#16770: the exit-0 line says which carriers agreed — LABEL carriers — and that the PR body was not read');
  const G_BARE = ['both', 'carriers', 'agree'].join(' ');
  const G_BRANCHES = [
    ['plain', greenPairLine({ pr: 16761, card: 16568 })],
    ['sibling', greenPairLine({ pr: 16761, card: 16568, sibling: true })],
    ['correction', greenPairLine({ pr: 16761, card: 16568, corrected: true })],
  ];
  const G_ALL = [
    ...G_BRANCHES.map(([, line]) => line),
    greenPairLine({ pr: 16761, card: 16568, record: true, wideningClean: true }),
    greenPairLine({ pr: 16761, card: 16568, sibling: true, record: true, wideningClean: true }),
    greenPairLine({ pr: 16761, card: 16568, corrected: true, record: true, wideningClean: true }),
  ];
  for (const [name, line] of G_BRANCHES) {
    t(`the ${name} branch names the LABEL as what agreed, ⛔ not "carriers" unqualified`, says(line, `the \`${CONTRACT_REVIEW_LABEL}\` LABEL is in the same state on both LABEL carriers (this card and this PR)`), line);
  }
  t('⛔ NEGATIVE, every branch and every optional clause: the bare phrase is gone from the printed line', G_ALL.every((line) => !line.includes(G_BARE)), G_ALL.find((line) => line.includes(G_BARE)));
  t('⛔ NEGATIVE, on the SOURCE: the bare phrase appears nowhere in this file, so a revert in the green line\'s construction reds even if these constants are bypassed', !readFileSync(SELF_PATH, 'utf8').includes(G_BARE));
  // ⛔ The control asserts the READ, ⛔ never the wording — the wording is held
  // by the branch cases above, which drive the builder rather than grep for its
  // text. A control that scanned for the new phrase would be satisfied by this
  // battery's own assertion strings, which is the shape `#16304`'s note at the
  // head of this self-test names: a pin written from the thing it pins.
  t('⛔ CONTROL — the source read is not empty or misdirected: the SAME read reaches this file\'s green-line builder', readFileSync(SELF_PATH, 'utf8').includes('export function greenPairLine('));
  t('every branch states the non-read in the same words, ⛔ never a per-branch paraphrase', G_ALL.every((line) => says(line, PR_BODY_NOT_READ)));
  t('the non-read names the DOCUMENT that was not read — the PR body — and the one that was', says(PR_BODY_NOT_READ, 'did NOT read the PR body') && says(PR_BODY_NOT_READ, 'from the CARD only'));
  t('…and it reports a NON-READ, ⛔ never a verdict about that document', says(PR_BODY_NOT_READ, 'neither compared nor denied here'));
  t('the non-read sentence is LAST, so the optional record and widening clauses cannot bury it', G_ALL.every((line) => line.endsWith(PR_BODY_NOT_READ)));
  t('the widening clause still reads as it did — this card reworded the agreement clause, ⛔ nothing else', says(greenPairLine({ pr: 1, card: 2, wideningClean: true }), 'its diff carries no widening tell. ⚠️ A tell is not a proof and its absence is not one either.'));
  t('…and so does the review-of-record clause', says(greenPairLine({ pr: 1, card: 2, record: true }), 'a review of record names this head'));
  t('⛔ CONTROL: the label the line names is the constant C1 compares, ⛔ not a second spelling of it', says(LABEL_CARRIERS_AGREE, CONTRACT_REVIEW_LABEL) && CONTRACT_REVIEW_LABEL === 'needs:contract-review');
  t('the pair is still identified in the line, in the spelling the round reports paste', says(G_BRANCHES[0][1], '✓ check-clause2-carriers: PR #16761 / card #16568 — the clause-② declaration is readable in the fixed spelling'));

  // -- #18892: the EDIT reading, taken rather than asserted. ⭐ Measured specimen:
  // objectui#9764's claim 5724909959 was EDITED (`created_at` 2026-09-18T03:54:37Z
  // vs `updated_at` 04:23:23Z) and the note testified 「NOT edited」 anyway. The
  // retired sentence is ASSEMBLED below, or the source pin hits itself (#16770).
  battery('#18892: the claim comment\'s EDIT reading — taken from the two stamps already in hand, reported and never failed');
  const E_EDITED = [CLAIMED(MEASURED_PROSE[1], { updated_at: '2026-09-18T04:23:23Z' }), FIXED_CORRECTION('no')];
  const E_UNEDITED = [CLAIMED(MEASURED_PROSE[1]), FIXED_CORRECTION('no')];
  const E_NOSTAMP = [{ ...CLAIMED(MEASURED_PROSE[1]), updated_at: undefined }, FIXED_CORRECTION('no')];
  const E_NOTE = (thread) => c2CorrectionNote(pair({ cardComments: thread }));
  const E_SRC = readFileSync(SELF_PATH, 'utf8');
  t('⭐ the EDITED specimen is REPORTED in the note, in as many words', says(E_NOTE(E_EDITED), 'WAS EDITED'));
  t('…naming the edit instant beside the creation one, so a reader can open that comment\'s history', says(E_NOTE(E_EDITED), '2026-09-18T04:23:23Z') && says(E_NOTE(E_EDITED), '2026-09-12T00:41:08Z'));
  t('⭐ an UNEDITED claim reads as a MEASURED unedited, naming both stamps it compared', says(E_NOTE(E_UNEDITED), 'UNEDITED') && says(E_NOTE(E_UNEDITED), 'created_at') && says(E_NOTE(E_UNEDITED), 'updated_at'));
  t('⭐ a row carrying NO `updated_at` reads NOT READ — ⛔ never "unedited", which is this defect one room over', says(E_NOTE(E_NOSTAMP), 'NOT READ') && says(E_NOTE(E_NOSTAMP), 'never as "unedited"'));
  t('⭐ the three readings are three DIFFERENT sentences — one sentence for all three was the defect', new Set([E_NOTE(E_EDITED), E_NOTE(E_UNEDITED), E_NOTE(E_NOSTAMP)]).size === 3);
  t('⛔ REPORT-ONLY: an edited claim raises NO C2 finding, so the exit register does not move', pairRows(pair({ cardComments: E_EDITED })).every((r) => r.code !== 'C2'));
  t('⛔ …and reads DECLARED at the seat\'s own value, exactly as the unedited thread does', cardDeclaration(E_EDITED).state === cardDeclaration(E_UNEDITED).state && cardDeclaration(E_EDITED).value === 'no');
  t('⭐ the green line points at that reading and says what it STATES, ⛔ never testifying to the edit itself', says(greenPairLine({ pr: 1, card: 2, corrected: true }), '`created_at`/`updated_at`'));
  t('⛔ …and the clause that asserted an unread fact is gone from the printed line', !says(greenPairLine({ pr: 1, card: 2, corrected: true }), 'says the claim was not edited'));
  t('⛔ NEGATIVE, on the SOURCE: no branch of this file asserts the unread 「NOT edited」 any more', !E_SRC.includes(['still reads as', 'it was written'].join(' ')));
  t('⛔ CONTROL — the same source read is not empty or misdirected: it reaches the reader this card added', E_SRC.includes(['function claimEdit', 'Reading('].join('')));

  // -- The floor: every declared battery RAN, and ran its cases (#13489) -----
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => { cases.push({ name: message, ok: false }); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-clause2-carriers self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-clause2-carriers self-test: ${cases.length} cases pass (fixed-spelling reader, the ` +
      'declaration states with the two not-read readings kept apart — no claim comment, and a claim '
      + 'comment with no line — the fourth reading for a card whose sibling carries the declaration '
      + 'with the controls that keep exit 4 reachable, the 2026-08-31 seven-pair replay, the four gate-binding states ' +
      'replayed from the 2026-09-01 clear, the verdict-authorship pair and its legacy silence, ' +
      'the review of record on the completed state with the two shapes that are not one, ' +
      'the `Served-tier:` reading judged on EVERY pair that carries a record — the measured ' +
      'non-gated spelling beside the live one, with C6\'s population, the sweep\'s read budget ' +
      'and the note\'s prescription pinned unmoved — ' +
      'the correction comment that supersedes a claim declaration with the five measured prose ' +
      'spellings held out as negatives, ' +
      'the three read paths with their offline reader, the argv contract with its usage and its '
      + 'refusal, the board provenance line, the claim whose `Branch:` line parses to ZERO '
      + 'branches — reported as an unresolvable carrier rather than discarded, the key-INITIAL '
      + 'line that QUOTES the spelling held apart from one that declares a value in BOTH halves '
      + 'of that property, the input record whose field roster is the same on exit 0, on exit 4 '
      + 'and on a refusal — with the selected carrier, its body fingerprint and the rejected '
      + 'candidates each stated, the DECORATED claim that enters the pool and governs through '
      + 'the sibling\'s one reading — the constant unwidened, and ONE undecoration path for claim and '
      + 'release alike, the prose retraction channel retired and the twelve spellings replayed through it, '
      + 'the SECOND `Claim:` by one seat named as the state '
      + 'the protocol forbids writing rather than ranked as a supersession — per direction, with a '
      + 'non-vacuity control each and the five measured instances replayed — the lane-keyed owed population, '
      + 'spec and skills owing the record on every round, other lanes owing none, a `yes` outside them routed to '
      + 'the spec lane rather than self-reviewed — the cross-author hand-over, two seats holding live claims on '
      + 'one card with no `Release:` between, named as the state the protocol never wrote, judged only after '
      + 'its effective instant and LISTED before it, the twelve measured rows replayed with the two that clear '
      + 'by the one reading alone — and the exit register).',
  );

  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// The argv contract, and the board's provenance (#16623)
// ---------------------------------------------------------------------------

/**
 * Every flag this file honours, what its value is spelled as, and what it does.
 *
 * ⭐ ONE table, and it is why the three things that used to disagree cannot:
 * the parse looks every flag up through `flagIndex`, which THROWS on a flag
 * that is not here; the refusal below decides what is an argument by asking it;
 * and the usage text is rendered from it rather than typed beside it. A flag
 * added to the parse without an entry here fails in this file's own self-test,
 * instead of becoming a spelling the tool honours in one place and refuses in
 * another.
 *
 * `value` is the value's spelling in the usage line, or `null` for a flag that
 * takes none -- which is also how the refusal knows whether the NEXT argument
 * belongs to this flag or is an argument of its own.
 */
export const KNOWN_FLAGS = new Map([
  ['--help', { value: null, does: 'print this text and exit 0, without reading any board' }],
  ['-h', { value: null, does: 'the same' }],
  ['--self-test', { value: null, does: "run this file's own battery, offline -- no board is read" }],
  ['--template', { value: null, does: 'print the copyable contract-review record and exit 0 -- no board is read' }],
  ['--pair', { value: 'N', does: 'judge ONE open PR by number -- a predicate about that pair' }],
  ['--pair-json', { value: 'path', does: 'read the pair from a document (`-` = stdin) instead of the network' }],
  ['--json', { value: null, does: 'emit the sweep on stdout as JSON' }],
]);

/** How a flag and its value are spelled together, for the usage text. */
function flagSpelling(flag, value) {
  return value === null ? flag : `${flag} ${value}`;
}

/**
 * The usage text -- rendered from the table above and from the resolver's own
 * precedence, so neither can drift from what the tool actually does.
 *
 * ⭐ The env paragraph is the half #16623 is about. A seat reading only this
 * script used to have no way to learn that the board is a parameter at all.
 */
export function usageLines() {
  return [
    'usage: node scripts/pm/check-clause2-carriers.mjs '
      + [...KNOWN_FLAGS].map(([flag, { value }]) => `[${flagSpelling(flag, value)}]`).join(' '),
    '',
    ...[...KNOWN_FLAGS].map(([flag, { value, does }]) => `  ${flagSpelling(flag, value).padEnd(18)}  ${does}`),
    '',
    '  Which board is read is resolved PER RUN, not from this checkout -- this file reads no file in',
    '  the tree at all. The precedence is `resolveSweepRepo`\'s, imported from check-half-states.mjs:',
    '',
    ...[
      ['PM_SWEEP_REPO=owner/name', "an explicit target; a sibling repo's seat uses this"],
      ['GITHUB_REPOSITORY', 'what Actions sets, i.e. the repo the workflow is installed in'],
      [DEFAULT_SWEEP_REPO, 'the fallback, for a bare terminal'],
    ].map(([source, why], i, all) => {
      // Width derived from the entries, so the imported default cannot outgrow
      // a hardcoded column and run into its own description.
      const w = Math.max(...all.map(([s2]) => s2.length)) + 2;
      return `    ${i + 1}. ${source.padEnd(w)}${why}`;
    }),
    '',
    '  Every run prints which of the three answered, so a deliberate target and the fallback are',
    '  never the same line. ⛔ A report about the wrong board reads exactly like a report about this one.',
  ];
}

/** Did the caller ask for usage? Read through the table, like every other flag. */
export function wantsHelp(argv) {
  return flagIndex(argv, '--help') !== -1 || flagIndex(argv, '-h') !== -1;
}

/**
 * Where `flag` sits in argv, or -1 -- the ONE lookup every parse site uses.
 *
 * The throw is the point. `argv.indexOf('--pair')` is correct and unguarded: it
 * will as happily find a flag the refusal and the usage text have never heard
 * of, which is exactly how a file grows a flag it honours and does not
 * document. Routing every lookup through the table makes that unreachable
 * rather than merely unlikely.
 */
export function flagIndex(argv, flag) {
  if (!KNOWN_FLAGS.has(flag)) {
    throw new Error(
      `check-clause2-carriers: the parse asked for '${flag}', which is not in KNOWN_FLAGS. That table `
        + 'is what the usage text and the unrecognised-argument refusal are derived from, so a flag '
        + 'missing from it is one this file would honour in silence and refuse in the same run. Add it there.',
    );
  }
  return argv.indexOf(flag);
}

/**
 * Every argument this file does not honour -- or `null` when there is none.
 *
 * ## Why an unrecognised argument is a REFUSAL and not a warning
 *
 * Measured on the filing seat's container, where the board could be read:
 * `--this-flag-does-not-exist` produced a full, well-formed report about this
 * file's own board and exited 0 -- byte-identical to a bare run. So a typo and
 * a deliberate invocation were the same command, and `--help` -- the one thing
 * a seat types to find out what the flags ARE -- ran a network sweep instead of
 * answering.
 *
 * That matters more here than on a dispatch-time tool. This is a LANDING
 * pre-check with nothing behind it: its whole purpose is to show that a review
 * gate was CLEARED rather than STRIPPED, and 「闸门被剥不是红灯是放行」 -- so a
 * well-formed `0 pair(s) UNJUDGED` reads exactly like a clean board whether or
 * not the caller's argument meant anything. ⭐ An impossible-to-fail reading is
 * indistinguishable from a reading that passed.
 *
 * ⛔ A positional argument is refused on the same ground and not a softer one:
 * this file reads NO positional argument at all, so `… 16623` is a number the
 * tool never looked at, above a full-board report that exits 0.
 */
export function argvRefusalLines(argv) {
  const unknownFlags = [];
  const positionals = [];
  const joined = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (KNOWN_FLAGS.has(arg)) {
      if (KNOWN_FLAGS.get(arg).value === null) continue;
      const next = argv[i + 1];
      // Consume the value ONLY when one is really there. A missing or
      // flag-shaped value is the flag's own site's refusal to report, with its
      // own message; swallowing the next token here would hide that flag from
      // this pass and name the wrong argument as the wrong one.
      if (next !== undefined && (next === '-' || !next.startsWith('-'))) i++;
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0 && KNOWN_FLAGS.has(arg.slice(0, eq))) joined.push(arg);
    else if (arg.startsWith('-')) unknownFlags.push(arg);
    else positionals.push(arg);
  }
  const named = [...unknownFlags, ...joined, ...positionals];
  if (named.length === 0) return null;

  const lines = [
    `check-clause2-carriers: REFUSING — ${named.map((a) => `'${a}'`).join(', ')} `
      + `${named.length === 1 ? 'is not an argument' : 'are not arguments'} this file honours.`,
  ];
  for (const flag of joined) {
    const at = flag.indexOf('=');
    lines.push(
      `  '${flag}' spells its value with '='. Every value here is the NEXT argument: `
        + `'${flag.slice(0, at)} ${flag.slice(at + 1)}'.`,
    );
  }
  for (const arg of positionals) {
    // ⭐ A value shaped like a repo gets pointed at the mechanism that actually
    // retargets the board, because that is the confusion this whole change is
    // about: the filing seat reached for `--repo <owner>/<name>`, and the
    // answer it needed was an environment variable it never saw named.
    lines.push(
      SWEEP_REPO_SHAPE.test(arg)
        ? `  '${arg}' looks like a repo. The board is not an argument — set PM_SWEEP_REPO='${arg}' to target it.`
        : `  '${arg}' is not a flag, and this file reads no positional argument at all — a PR number goes to '--pair'.`,
    );
  }
  lines.push(
    '  ⛔ Not a warning: an unrecognised argument used to change NOTHING — same report, same board, same exit —',
    '  so a typo and a deliberate invocation were the same command. This is a landing pre-check with nothing',
    '  behind it, and a well-formed report reads exactly like a clean one whatever you meant to ask for.',
    '',
    ...usageLines(),
  );
  return lines;
}

/**
 * WHICH board this run reads, and ON WHAT BASIS -- the line #16623 exists for.
 *
 * `resolveSweepRepo` has always returned `source` beside `repo`; the run simply
 * never printed it, so `PM_SWEEP_REPO=objectstack-ai/objectui` and a bare
 * terminal falling back to the default rendered as the same sentence. The value
 * was already computed. This renders it.
 *
 * ⚠️ It goes to STDERR in every mode, `--json` included, for the reason the read
 * path report next door states: stdout is contractually the ANSWER, and a
 * provenance line on stdout would travel into the round report that pastes it
 * as though it were part of the finding.
 */
export function boardProvenanceLine({ repo, source }) {
  const detail = source === 'default'
    ? 'source: default — set PM_SWEEP_REPO to target another repo'
    : `source: ${source}`;
  return `check-clause2-carriers: every row below is read from ${repo} (${detail}).`;
}

// ---------------------------------------------------------------------------

async function main(argv) {
  if (flagIndex(argv, '--self-test') !== -1) {
    const selfTestCode = await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-clause2-carriers self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return selfTestCode;
  }

  // ⭐ Usage and argv BEFORE the board, and both before any read. A caller
  // asking what the flags are must not be answered with a network sweep, and an
  // unrecognised argument must be refused while the refusal can still be about
  // the argument rather than about a board nobody asked for (#16623).
  if (wantsHelp(argv)) {
    for (const line of usageLines()) console.log(line);
    return EXIT_OK;
  }
  // ⭐ Beside usage, and for the same reason: a seat asking for the record to
  // COPY must not be answered with a network sweep -- and the remedy this file
  // prints in its own refusals has to be reachable from a bare terminal (#18042).
  if (flagIndex(argv, '--template') !== -1) {
    for (const line of contractReviewTemplateLines()) console.log(line);
    return EXIT_OK;
  }
  const argvRefusal = argvRefusalLines(argv);
  if (argvRefusal) {
    for (const line of argvRefusal) console.error(line);
    return EXIT_USAGE;
  }

  const repoRes = resolveSweepRepo(process.env);
  if (!repoRes.valid) {
    console.error(
      // The example is spelled `owner`/`name` rather than as one backticked
      // span deliberately: the dispatch derivation reads any quoted path-shaped
      // literal in a module body as a declared population, and the one-span
      // spelling was this family's ONLY such literal — a slug that names no
      // tracked file, so the family declared a population that reached nothing
      // and printed as an ordinary silence (#13519). Split, it is not a path.
      `check-clause2-carriers: ${repoRes.source}=${JSON.stringify(repoRes.repo)} is not a ` +
        'repository in `owner`/`name` form. Refusing to fall back to a different board — a report ' +
        'about the wrong repo reads exactly like a report about this one.',
    );
    return EXIT_USAGE;
  }
  const repo = repoRes.repo;
  // Printed before the first request, so a run that dies in transport has still
  // said which board it was about -- the state the filing seat was in.
  console.error(boardProvenanceLine(repoRes));

  // ⭐ Everything from here on runs inside ONE try/finally, so the input record
  // (#18456) and the read-path report reach a reader on EVERY exit past the
  // board -- a usage refusal on `--pair-json` included. A block that printed
  // only beside a verdict would be missing from exactly the refusals two seats
  // most need to compare.
  let record = null;
  const pairFlagIdx = flagIndex(argv, '--pair');
  const mode = pairFlagIdx === -1
    ? (flagIndex(argv, '--json') === -1 ? 'sweep' : 'sweep --json')
    : `--pair ${argv[pairFlagIdx + 1] ?? '(no value)'}`;
  try {
    return await runBoard(argv, repo, repoRes, (built) => { record = built; });
  } finally {
    console.error(renderReadPathReport(readPathState));
    for (const line of renderInputRecord(
      record ?? buildInputRecord({
        repoRes, mode, state: readPathState, pairs: null, self: selfProvenance(), now: new Date(),
      }),
    )) {
      console.error(line);
    }
  }
}

/**
 * The board half of `main` -- everything that needs a resolved repo.
 *
 * Split out for one reason: the input record and the read-path report are owed
 * on every exit below, and a `finally` around the whole of it is the only shape
 * that cannot be lost by a `return` added later (#18456). `keepRecord` hands
 * the built record back so the caller's `finally` prints the SAME one `--json`
 * emitted rather than a second reading of the same run.
 */
async function runBoard(argv, repo, repoRes, keepRecord) {
  const pairFlag = flagIndex(argv, '--pair');
  let only = null;
  if (pairFlag !== -1) {
    only = Number(argv[pairFlag + 1]);
    if (!Number.isInteger(only) || only <= 0) {
      console.error('check-clause2-carriers: --pair needs a PR number. ⛔ Silence is not a clearance.');
      return EXIT_USAGE;
    }
  }

  const pairJsonFlag = flagIndex(argv, '--pair-json');
  let reader = NETWORK_READER;
  if (pairJsonFlag !== -1) {
    const named = argv[pairJsonFlag + 1];
    if (!named || named.startsWith('--')) {
      console.error(
        'check-clause2-carriers: --pair-json needs a file path, or `-` for stdin. ⛔ Silence is not a clearance.',
      );
      return EXIT_USAGE;
    }
    const source = named === '-' ? 'stdin' : named;
    let raw;
    try {
      raw = readFileSync(named === '-' ? 0 : named, 'utf8');
    } catch (err) {
      console.error(
        `check-clause2-carriers: --pair-json could not read ${source} — ${err.message}. ⛔ Not a ` +
          'clearance: no pair was formed, so nothing was judged.',
      );
      return EXIT_USAGE;
    }
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      console.error(`check-clause2-carriers: --pair-json: ${source} is not JSON — ${err.message}.`);
      return EXIT_USAGE;
    }
    try {
      reader = pairJsonReader(doc, { source });
    } catch (err) {
      console.error(`check-clause2-carriers: ${err.message}`);
      return EXIT_USAGE;
    }
    const conflict = pairJsonRepoConflict(reader.repo, repo);
    if (conflict) {
      console.error(`check-clause2-carriers: ${conflict}`);
      return EXIT_USAGE;
    }
    readPathState.pairJsonSource = source;
  }

  let swept = 0;
  const mode = only === null
    ? (flagIndex(argv, '--json') === -1 ? 'sweep' : 'sweep --json')
    : `--pair ${only}`;
  try {
    const { pulls, pairs } = await gather(repo, only, reader, { landingReads: only !== null });
    swept = pairs.length;
    // Built ONCE, after every read this run makes and before anything is
    // printed: `--json` emits it and the caller's `finally` renders it.
    const built = buildInputRecord({
      repoRes, mode, state: readPathState, pairs, self: selfProvenance(), now: new Date(),
    });
    keepRecord(built);
    if (only !== null) {
      if (pairs.length === 0) {
        console.error(
          `check-clause2-carriers: PR #${only} is not open, or names no card this file can derive ` +
            '(no closing/`Part of` keyword in its body and no `issue-N` branch name). ⛔ Not a ' +
            'clearance — the pair could not be formed, so nothing about it was judged. ' +
            'Which reads were tried, and on which path, is the line below.',
        );
        return EXIT_INCOMPLETE;
      }
      let worst = EXIT_OK;
      for (const p of pairs) {
        // The WHOLE derived set is passed, because the fourth reading is a fact
        // about the PR's delivery set rather than about one pair — and it is
        // the set `gather` derived, so a sibling is always a card
        // `prDeliversCard` said this PR delivers.
        const code = renderPair(p, repo, pairs);
        if (code !== EXIT_OK) worst = code === EXIT_INCOMPLETE && worst === EXIT_PAIR_ADVERSE ? worst : code;
      }
      return worst;
    }
    return renderSweep({ repo, pulls, pairs, inputs: built }, { json: flagIndex(argv, '--json') !== -1 });
  } catch (err) {
    return reportTransportFailure(err, { swept });
  }
}

if (isEntrypoint(import.meta.url)) {
  if (flagIndex(process.argv.slice(2), '--self-test') !== -1) {
    // ⭐ `.then`, ⛔ never a top-level `await`. `selfTest` became async to take a
    // LAZY import of `check-governed-queue-guard.mjs` for the cross-tool pin
    // (#18701), and that guard's own docblock records what a top-level await in
    // an entrypoint dispatch costs on this cycle: node exits 13 with "Detected
    // unsettled top-level await" and BOTH modules stop loading.
    selfTest().then((selfTestCode) => {
      if (!selfTestReachedVerdict) {
        console.error(
          '\n✗ check-clause2-carriers self-test: selfTest() returned without reaching its verdict,\n'
            + 'so no success line was printed. Exiting 0 here would report a self-test\n'
            + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
      }
      process.exit(selfTestCode);
    });
  } else {
    // ⭐ Answered HERE, above the proxy re-exec, so neither usage nor a refused
    // argument spawns a child process or opens a socket. `main` judges both
    // again -- the same two functions -- so the guard cannot be lost by a
    // caller that reaches `main` another way.
    const cliArgv = process.argv.slice(2);
    if (wantsHelp(cliArgv)) {
      for (const line of usageLines()) console.log(line);
      process.exit(EXIT_OK);
    }
    if (flagIndex(cliArgv, '--template') !== -1) {
      for (const line of contractReviewTemplateLines()) console.log(line);
      process.exit(EXIT_OK);
    }
    const cliRefusal = argvRefusalLines(cliArgv);
    if (cliRefusal) {
      for (const line of cliRefusal) console.error(line);
      process.exit(EXIT_USAGE);
    }
    const rearmed = rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
