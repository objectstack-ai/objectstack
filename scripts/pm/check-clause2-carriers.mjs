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
 *   node scripts/pm/check-clause2-carriers.mjs --help       # usage; no network
 *
 * ## Which board this answers about, and how a reader can tell (#16623)
 *
 * The board is a PARAMETER, resolved once per run by `resolveSweepRepo`
 * (imported): `PM_SWEEP_REPO`, else `GITHUB_REPOSITORY`, else the default. It
 * is not a property of this checkout -- this file reads no file in the tree at
 * all, so an environment variable really does retarget it, and a sibling repo's
 * seat runs `PM_SWEEP_REPO=<its repo> node scripts/pm/check-clause2-carriers.mjs
 * --pair N` to get an answer about its own board.
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
 * carriers alone, and none of them costs a changed-file listing.
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
 * ⭐ C4 and C6 are the ONLY things this file reads out of a verdict comment, and
 * neither is the verdict. C4 reads the `Implemented-by:` / `Reviewed-by:`
 * identity pair the verdict declares about its own AUTHORSHIP (a session id on
 * both, or a `mode:subagent` dev's BRANCH on the left — the grammar note beside
 * AUTHORSHIP_KEYS), on a comment recognised in EITHER live dialect — the fenced
 * `VERDICT:` marker or H51's `## Contract review` heading on this head, one
 * recognition shared with C6 (#17346, `isVerdictComment`). C6 (#17302) reads
 * that a review of record EXISTS on the
 * current head — H51's heading and head-sha facts, plus a `Reviewed-by:` line —
 * on a pair whose gate was already cleared. No PASS or FAIL token is read to
 * reach either, so the boundary above is narrowed by exactly two facts and not
 * crossed — a self-issued verdict is refused on WHO wrote it, an unrecorded one
 * on WHETHER it was written down, never on what it concluded — and both rows
 * are report-only like every other one here.
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
 * ## C6 — a cleared gate with no review of record behind it (#17302)
 *
 * The tier policy names the lane seat's own default-tier review, plus the gates,
 * as the review of record for every lane but spec and skills — and until #17302
 * nothing named WHERE that review lives or what it must contain. Measured on one
 * window by the director's leak sweep: five `Clause-②: yes` merges whose
 * carriers were hung and cleared (or never hung) with NO review-like comment on
 * the PR or its card except the dev's own `os-dev-report`. Clearing the carrier
 * was indistinguishable from never reviewing, and `--pair` — the landing
 * check's own ② — read every one of them as the COMPLETED state and answered 0.
 *
 * `references/contract-review.md` now names the record: ONE comment on the PR
 * or its card, in the shape the tier verdict already has minus the tier line —
 * 「复核记录 = 一条评论落 PR 或卡,达档与默认档同形」, 「同形 = `## Contract
 * review` 题头、所审 head sha 码段、①②③ 逐项、独立性对、PASS/FAIL 判词」 — and
 * makes every clear cite it (「凡清标同笔留 provenance 评论,引记录 id 与所判
 * head」, 「清标缺引记录即半态」). C6 is the machine half of that sentence: on a
 * pair in the COMPLETED state (declared `yes`, cleared on both carriers, head
 * unmoved — `gateBindingState`, unchanged) it reads the PR's thread and the
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
 *                         (#17302); omitting it there reads `null` → the pair
 *                         is UNJUDGED, never a missing record.
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
 * ## The request budget, per run
 *
 * `--pair N`: one open-PR listing page (100 PRs per page) plus 2 reads per card
 * the PR delivers (the card, its comment thread). A C3 candidate adds its two
 * carriers' event streams (one page each on this board) and — only once both
 * read cleared — one commit: ≤5 reads for a candidate pair, 2 for every other.
 * A pair whose card declares `Clause-②: no` adds ONE more — its changed-file
 * listing, for C5 (#16448) — and a pair in the COMPLETED state adds one more,
 * in BOTH modes: its PR's own comment thread, for C6 (#17302), cached per PR so
 * a two-card PR pays once. The sweep pays the listing once and the same
 * per-pair cost for every pair it derives. ⇒ a `--pair` run costs 3–8 requests,
 * while a 29-PR sweep costs about 60 — which is exactly GitHub's documented
 * anonymous hourly budget, one more reason the run prints the remaining count
 * instead of assuming it.
 *
 * ⭐ That last read is `--pair` ONLY, and the asymmetry is deliberate. Paying it
 * per sweep pair would push a routine sweep past the anonymous budget it
 * already sits on, and a widening tell on somebody else's pair is a board fact
 * rather than a verdict about the PR that happens to run CI next — the same
 * call the sweep/`--pair` split already makes for every other row here. In a
 * sweep `pair.files` is therefore `undefined`, which no row reads; `null` means
 * a read that WAS owed came back short, and that is UNJUDGED.
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
 *      not be, or when a COMPLETED pair's PR thread could not be (C6): an unread
 *      stream is not a never-hung gate, an unread diff is not a narrow one and
 *      an unread thread is not a missing record, so all are UNJUDGED rather
 *      than either verdict.
 *   4  they do not — or, since #16448, the declaration reads `no` while the
 *      diff carries a widening tell (row C5) — or, since #17302, the gate was
 *      cleared on both carriers and no review of record names the head (row
 *      C6). One exit code with several
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
  SWEEP_REPO_SHAPE,
  contractReviewHeadMatch,
  deliveryEvidence,
  deliveryEvidenceNote,
  claimGovernance,
  claimedBranches,
  governingClaim,
  isGateSemanticLabel,
  labelNames,
  latestMarkedComment,
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

// dispatch-gates: no-path-population -- this gate reads no file in the tree at all; its whole input is the GitHub API (PRs, their labels, and the claim comments on their cards), so no card's file surface can predict it and the honest derivation is a repo-wide undetermined one (#13519)

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
  'the exit register is distinct in every direction it must be': 6,
  'the argv contract and the board provenance (#16623)': 42,
  '#17366: the correction comment — the self-solvable exit, and the three things it is not': 65,
  '#17149: a claim that parses to ZERO branches — malformed, never absent': 26,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
// Raised by exactly the one battery #16304 adds, again by exactly the one
// #17302 adds, and again by exactly the one #17366 adds, so the roster's
// existing slack is preserved rather than tightened or loosened as a side
// effect, and once more by the one #17149 adds.
const SELF_TEST_BATTERY_FLOOR = 18;

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
 */
const CLAUSE2_KEY_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?`?Clause-②`?(?:\*\*)?[ \t]*:(.*)$/;

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
 */
function readValueToken(raw) {
  const rest = String(raw ?? '').replace(/^[ \t]+/, '');
  // Built from CLAUSE2_VALUES so the closed set is declared once: adding a
  // third reading would have to be a deliberate edit to that constant.
  const token = new RegExp(`^(?:\\*\\*)?(?:\`)?[ \\t]*(${CLAUSE2_VALUES.join('|')})(?![A-Za-z0-9_])`);
  const m = token.exec(rest);
  return m ? m[1] : null;
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
 * @returns {{ kind: 'declared', value: 'yes'|'no', line: string }
 *          | { kind: 'malformed', value: string, line: string }
 *          | { kind: 'near-miss', reason: 'inline-key'|'spelling', line: string }
 *          | null}
 *
 * Four-valued on purpose. `declared` and `malformed` are different facts about
 * a line that IS the key; `near-miss` is a fact about a line that is not. Any
 * collapse of these into "no" is the defect #13914 filed.
 *
 * The near miss carries a REASON because the two shapes owe opposite remedies:
 * `spelling` is a line that does not carry the fixed key at all, and `inline-key`
 * is a line that carries it exactly right but not at the start of a line. ⛔ The
 * reason changes the sentence, never the state — both are near misses, and a
 * near miss is not a declaration in either case.
 */
export function readClause2Line(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  let nearMiss = null;
  let inlineKey = null;
  for (const line of lines) {
    const m = CLAUSE2_KEY_LINE.exec(line);
    if (m) {
      const value = readValueToken(m[1]);
      if (value !== null) return { kind: 'declared', value, line: quoteLine(line) };
      return { kind: 'malformed', value: quoteLine(m[1], 60), line: quoteLine(line) };
    }
    if (inlineKey === null && hasInlineClause2Key(line)) inlineKey = quoteLine(line);
    if (nearMiss === null && CLAUSE2_NEAR_MISS_LINE.test(line)) nearMiss = quoteLine(line);
  }
  // The correctly-spelled key wins over a vocabulary near miss wherever the two
  // land in the body: it is the more actionable of the two residues, and reading
  // order is not a fact about which one the seat should be sent to.
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

/** Newest first — by timestamp, falling back to thread order when it is unreadable. */
function newestFirst(a, b) {
  const ap = Date.parse(a.createdAt ?? '');
  const bp = Date.parse(b.createdAt ?? '');
  if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return bp - ap;
  return b.index - a.index;
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
 * @param {{ id?: number|string, body?: string, created_at?: string }[]} commentRows
 * @param {{ id?: number|string, body?: string }[]} pool — the governing claim rows.
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
    `it supersedes claim comment ${chosen.claimId}'s own declaration, which is NOT edited and ` +
    'still reads as it was written. ⛔ Nothing was filled in on the seat\'s behalf: the value is ' +
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

/** The key as prose, for the sentences above — declared once, beside the regex that reads it. */
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
 * than restated: a claim comment is one whose body carries a LINE BEGINNING
 * `Claim:` (or `Claimed:`, optionally blockquoted), and that one spelling is
 * the whole set — so a heading-style claim (`## Claim — …`) is not a claim
 * comment here, however complete the reasoning under it, and its thread reads
 * `absent`. ⛔ Widening the predicate is not this file's to do: it is the
 * sibling's constant precisely so the two readers cannot drift, and the remedy
 * for a thread that reads `absent` is a comment in the fixed spelling.
 *
 * @param {{ body?: string, created_at?: string }[]|null} commentRows — the REST
 *   comment rows, or `null` when the thread could NOT be read.
 * @returns {{ state: 'declared'|'malformed'|'misplaced'|'missing'|'absent'|'unreadable'
 *   |'claim-branch-unparsed',
 *   value?: 'yes'|'no', detail?: string, nearMissReason?: 'inline-key'|'spelling',
 *   correctionNote?: string, malformedClaim?: object, governingClaim?: object }} —
 *   `correctionNote` rides alongside for exactly one purpose, the same way
 *   `nearMissReason` does: the rows below print it. ⛔ It is not part of the state
 *   union and no verdict, count or exit reads it. `malformedClaim` /
 *   `governingClaim` ride the same way, on the `claim-branch-unparsed` state only,
 *   so its sentence can name the comment and say what governance did instead.
 */
export function cardDeclaration(commentRows) {
  if (!Array.isArray(commentRows)) return { state: 'unreadable' };
  const governance = claimGovernance(commentRows);
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
  const claim = governance.governing;
  const claimRows = commentRows.filter((row) => CLAIM_COMMENT_MARKER.test(String(row?.body ?? '')));
  // The governing claim is the one the board is waiting on; when no comment
  // names a branch, every claim-marked comment is still a claim carrier and is
  // read, so a claim written without a branch cannot make the declaration
  // invisible.
  const governing = claim
    ? claimRows.filter((row) => (row?.created_at ?? null) === claim.createdAt)
    : claimRows;
  const pool = governing.length > 0 ? governing : claimRows;

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
  const withNote = (o) => (correctionNote === undefined ? o : { ...o, correctionNote });

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
 * The remedy that names WHO can act and HOW — the sentence #17366 was filed to
 * get, in three parts, because the old one («add the line to that claim
 * comment») named an act the claiming seat may have no tool for.
 *
 * ⛔ Nothing here prescribes a VALUE, and part (3) is a shape, never a fill-in:
 * the declaration is still the seat's judgement, written by the seat.
 */
const CORRECTION_REMEDY =
  'Remedy — WHO can act, and HOW: the CLAIMING SEAT itself, and it needs no comment edit. ' +
  `(1) ${TEMPLATE_POINTER} ` +
  '(2) ⚠️ A claim comment that is ALREADY POSTED cannot be repaired by editing it from every ' +
  'seat: the MCP GitHub tool set has no edit-an-issue-comment call, and ⛔ a second `Claim:` is ' +
  'forbidden by the claim protocol. ⛔ Do not wait for somebody outside the repository. ' +
  '(3) Post ONE new comment on this card whose FIRST line is `Clause-②-correction: 5642248126` — ' +
  'the numeric id of the claim comment it corrects, digits only — followed by the declaration in ' +
  'the fixed spelling on a line of its own, and a `Session:` line carrying the claiming session. ' +
  'The newest correction naming the governing claim SUPERSEDES that claim\'s declaration, in ' +
  'both directions; one naming any other comment, or declaring a different session, is ignored ' +
  'with a printed reason. ⛔ Never a second `Claim:`.';

export function c2DeclarationUnreadable(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
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

const AUTHORSHIP_KEY_LINES = new Map(
  AUTHORSHIP_KEYS.map((key) => [
    key,
    new RegExp(`^[ \\t]*(?:>[ \\t]*)?(?:[-*][ \\t]+)?(?:\\*\\*)?\`?${key}\`?(?:\\*\\*)?[ \\t]*:(.*)$`),
  ]),
);

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
 * ⛔ It buys NO read. `pair.prComments` is filled by `gather`'s fourth pass for
 * the COMPLETED pairs and nobody else (`needsRecordRead`), so this union is
 * opportunistic by construction: on a completed pair C4 reads card + PR, and
 * on every other pair state it reads the card thread alone — the same set C2
 * already fetched, at the same cost.
 *
 * ⚠️ The declared LIMIT that follows, stated rather than bought: a verdict on
 * a PENDING pair's PR thread is INVISIBLE here. That population is a pair whose
 * gate is still hung — the review is in flight — and buying a thread per open
 * pair to reach it would double this file's read budget for a fact that the
 * completed state re-reads a moment later anyway. ⛔ Not a fetch class; the
 * boundary is the honest answer.
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
    'admits a session only (2026-09-02 reading a)';
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
    `for widening tells: ${v.text}`
  );
}

// ---------------------------------------------------------------------------
// C6 -- the review of record on this head (#17302)
// ---------------------------------------------------------------------------

/**
 * Does this pair owe the review-of-record read -- its PR's own comment thread?
 *
 * ⭐ ONLY the completed state: declared `yes`, the gate bound and cleared on
 * both carriers, head unmoved since (`gateBindingState`, unchanged). That is the
 * one state in which `references/contract-review.md` says a record must already
 * exist -- 「复核记录 = 一条评论落 PR 或卡」, 「清标缺引记录即半态」 -- and it is
 * exactly the state the filing sweep measured five times over: `Clause-②: yes`,
 * carriers cleared, merged, and the only review-like comment anywhere the dev's
 * own report. A pair still carrying the gate owes nothing yet (the review is
 * pending, not missing); a never-hung, half-bound or moved-after-clear pair is
 * C3's row already, and two rows for one fact is the drift this file avoids.
 *
 * Exported and read by BOTH the fetch and the UNJUDGED accounting, the way
 * `needsGateHistory` and `needsWideningRead` are, so the set that owes the
 * thread and the set that gets one cannot drift apart. It reads the binding
 * state, so it can only be true once the event streams and the head commit
 * have been read -- the record pass in `gather` follows the history pass by
 * construction.
 */
export function needsRecordRead(pair) {
  return gateBindingState(pair).state === 'completed';
}

/** The `Reviewed-by:` key line, exactly as C4 reads it -- one spelling, not two. */
const REVIEWED_BY_LINE = AUTHORSHIP_KEY_LINES.get('Reviewed-by');

/**
 * The review of record for one pair -- read from the PR's thread AND the card's,
 * because the rule lets it live on either.
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
 * @returns {{ state: 'not-owed' }
 *          | { state: 'unreadable', gaps: string[] }
 *          | { state: 'absent', read: { pr: number, card: number } }
 *          | { state: 'unsigned', where: 'PR'|'card', id: number|null, sha: string, at: string|null }
 *          | { state: 'found', where: 'PR'|'card', id: number|null, sha: string, at: string|null }}
 */
export function reviewOfRecord(pair) {
  if (!needsRecordRead(pair)) return { state: 'not-owed' };
  const gaps = [];
  if (!Array.isArray(pair?.prComments)) gaps.push(`PR #${pair?.pr}'s comment thread`);
  if (!Array.isArray(pair?.cardComments)) gaps.push(`card #${pair?.card}'s comment thread`);
  const head = String(pair?.headSha ?? '');
  // A head too short to be matched by H51's span test can never find its
  // record, so it is a read that could not be made -- never an absent record.
  if (head.length < H51_SHA_MIN_HEX) gaps.push(`PR #${pair?.pr}'s head sha`);
  if (gaps.length > 0) return { state: 'unreadable', gaps };

  const tagged = [
    ...pair.prComments.map((row) => ({ row, where: 'PR' })),
    ...pair.cardComments.map((row) => ({ row, where: 'card' })),
  ];
  const onHead = tagged.filter(
    ({ row }) =>
      CONTRACT_REVIEW_HEADING_MARKER.test(String(row?.body ?? '')) &&
      contractReviewHeadMatch(row?.body, head) !== null,
  );
  const newest = latestMarkedComment(onHead.map(({ row }) => row), CONTRACT_REVIEW_HEADING_MARKER);
  if (!newest) return { state: 'absent', read: { pr: pair.prComments.length, card: pair.cardComments.length } };
  const { row, where } = onHead[newest.index];
  const found = {
    where,
    id: row?.id ?? null,
    sha: contractReviewHeadMatch(row?.body, head),
    at: row?.created_at ?? null,
  };
  const signed = String(row?.body ?? '').split(/\r?\n/).some((line) => REVIEWED_BY_LINE.test(line));
  return signed ? { state: 'found', ...found } : { state: 'unsigned', ...found };
}

/**
 * C6 -- a gate cleared on both carriers with no review of record on the head.
 *
 * The rule this row carries is the one #17302 landed: the default-tier lanes'
 * review of record is ONE comment on the PR or its card, in the tier verdict's
 * own shape minus the tier line, and every clear cites it. Before that text,
 * clearing the carrier was indistinguishable from never reviewing -- measured
 * five times in one window by the director's leak sweep -- and this file's own
 * `--pair` read every one of those pairs as the completed state and answered 0.
 *
 * ⛔ A FINDING, and the file's exit table decides that rather than a preference:
 * the row is an adverse fact about THIS pair at its own landing moment, and an
 * adverse fact rendered as 0-with-a-message is the silence this file exists
 * against. It re-blocks no legal workflow -- under the text the record precedes
 * the clear -- and a pair cleared before the text landed owes exactly one
 * comment: the review its seat already performed, written down.
 */
export function c6NoReviewOfRecord(pair) {
  const v = reviewOfRecord(pair);
  if (v.state === 'not-owed' || v.state === 'unreadable' || v.state === 'found') return null;

  const short = String(pair?.headSha ?? '').slice(0, 10);
  const head =
    `card #${pair?.card} declares \`Clause-②: yes\`, its gate was bound and cleared on BOTH carriers, and its ` +
    `open PR #${pair?.pr}${pair?.draft ? ' (draft)' : ''} still sits at the head that was cleared (\`${short}\`)`;
  const shape =
    'The record is the comment `references/contract-review.md` names -- 「复核记录 = 一条评论落 PR 或卡,达档与默认档' +
    '同形」 -- read here in H51\'s measured shape: a level-2 heading beginning `## Contract review`, this head\'s sha ' +
    'as a code span, and a `Reviewed-by:` line naming the reviewer. Existing tier verdicts already carry all three; a ' +
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
  return (
    `${head} -- and NO review of record exists on this head: ${v.read.pr} comment(s) on the PR thread and ` +
    `${v.read.card} on the card were read, and none is a \`## Contract review\` comment naming \`${short}\` with a ` +
    '`Reviewed-by:` line. This is the shape the filing sweep measured five times in one window -- a cleared gate ' +
    `with nothing behind it, indistinguishable from never reviewing. ${shape} Remedy: the owning seat writes down ` +
    'the review it already performed, in that shape, on the PR or the card, and cites it in the provenance comment ' +
    `beside the clear. ${boundary} ${NEVER_WRITES}`
  );
}

/**
 * The C6-RECORD note -- the record WAS found, and here is what to cite.
 *
 * A note rather than silence, for the landing seat's next act: the rule makes
 * the provenance comment name the record's id and the head it judged, and the
 * run has both in hand. ⚠️ Existence, not the verdict.
 */
export function c6RecordNote(pair) {
  const v = reviewOfRecord(pair);
  if (v.state !== 'found') return null;
  return (
    `review of record on this head: ${v.where} thread, ${v.id ? `comment ${v.id}` : 'a comment carrying no readable id'} ` +
    `(${v.at ?? 'undated'}) is a \`## Contract review\` comment naming \`${v.sha}\` and carrying a \`Reviewed-by:\` line -- ` +
    'cite it in the provenance comment beside the clear (「凡清标同笔留 provenance 评论,引记录 id 与所判 head」). ' +
    '⚠️ Existence, not the verdict: whether it reads PASS is precondition ① of the landing check and stays human.'
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
 * row also states, in as many words, that the claim comment was NOT edited —
 * because the whole value of the shape is that nothing had to be.
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
  // C6's own #4690 half: the record read is owed by the COMPLETED state only,
  // and an unread PR thread there is not an absent record. Reached only once
  // the binding state itself read, so a stream gap above is never doubled.
  if (gaps.length === 0) {
    const record = reviewOfRecord(pair);
    if (record.state === 'unreadable') gaps.push(...record.gaps.map((g) => `${g} (the review-of-record read)`));
  }
  if (gaps.length === 0) return null;
  return (
    `pair PR #${pair?.pr} / card #${pair?.card} — UNJUDGED: ${gaps.join(', ')} could not be read. ` +
    'An unread carrier is not a bare carrier and an unread thread is not an absent declaration; ' +
    'this pair is missing from the readings above, not clean in them.'
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
};

function noteServed(pathId) {
  readPathState.served.set(pathId, (readPathState.served.get(pathId) ?? 0) + 1);
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

/** One request on ONE path. `token` empty means: send no `authorization`. */
async function restOnce(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  noteRateLimit(res);
  if (!res.ok) {
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
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
  const out = [];
  for (let page = 1; page <= EVENT_PAGE_CAP; page++) {
    const batch = await restOrNull(`/repos/${repo}/issues/${number}/events?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) return null;
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  return null; // cap hit: the tail is unread, so the history is unread.
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
  const commit = await restOrNull(`/repos/${repo}/commits/${sha}`);
  return commit?.commit?.committer?.date ?? null;
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
  const out = [];
  for (let page = 1; page <= FILE_PAGE_CAP; page++) {
    const batch = await restOrNull(`/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) return null;
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  return null; // cap hit: the tail is unread, so the diff is unread.
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
  readCard: (repo, n) => restOrNull(`/repos/${repo}/issues/${n}`),
  readCardComments: (repo, n) => restOrNull(`/repos/${repo}/issues/${n}/comments?per_page=100`),
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
  const serve = (value) => {
    noteServed(READ_PATH_PAIR_JSON);
    return value;
  };
  return Object.freeze({
    id: READ_PATH_PAIR_JSON,
    repo: typeof doc.repo === 'string' && doc.repo.trim() ? doc.repo.trim() : null,
    listOpenPulls: () => serve(pulls),
    readCard: (_repo, n) => serve(fromDocument(doc.cards, n)),
    readCardComments: (_repo, n) => {
      const rows = fromDocument(doc.comments, n);
      return serve(Array.isArray(rows) ? rows : null);
    },
    readCarrierEvents: (_repo, n) => {
      const rows = fromDocument(doc.events, n);
      return serve(Array.isArray(rows) ? rows : null);
    },
    readHeadCommitDate: (_repo, sha) => {
      const commit = fromDocument(doc.commits, sha);
      return serve(commit?.commit?.committer?.date ?? null);
    },
    readPullFiles: (_repo, n) => {
      const rows = fromDocument(doc.files, n);
      return serve(Array.isArray(rows) ? rows : null);
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
 */
async function gather(repo, prFilter = null, reader = NETWORK_READER, { readFiles = false } = {}) {
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
      pairs.push({
        pr: pr.number,
        draft: Boolean(pr.draft),
        card: Number(n),
        headSha: pr?.head?.sha ?? null,
        prLabels: Array.isArray(pr.labels) ? labelNames(pr) : null,
        cardLabels: card && Array.isArray(card.labels) ? labelNames(card) : null,
        cardComments: Array.isArray(comments) ? comments : null,
      });
    }
  }

  // Second pass — the gate history, for the C3 candidates and nobody else.
  // `needsGateHistory` is the SAME predicate the UNJUDGED accounting reads, so
  // the set that owes a stream and the set that gets one cannot drift apart.
  for (const pair of pairs) {
    if (!needsGateHistory(pair)) continue;
    pair.cardEvents = await reader.readCarrierEvents(repo, pair.card);
    pair.prEvents = await reader.readCarrierEvents(repo, pair.pr);
    // The head commit is owed only once both carriers read CLEARED — the one
    // state whose verdict turns on head motion.
    const card = carrierGateHistory(pair.cardEvents);
    const prHist = carrierGateHistory(pair.prEvents);
    if (card.state === 'cleared' && prHist.state === 'cleared') {
      pair.headCommittedAt = await reader.readHeadCommitDate(repo, pair.headSha);
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
  if (readFiles) {
    for (const pair of pairs) {
      if (!needsWideningRead(pair)) continue;
      pair.files = await reader.readPullFiles(repo, pair.pr);
    }
  }

  // Fourth pass -- the review of record, for the COMPLETED pairs and nobody
  // else (#17302). The PR's own thread is the same endpoint the card's is
  // (`/issues/N/comments` -- a PR is an issue there), read through the same
  // `readCardComments`, so the offline document carries it in the same
  // `comments` bag keyed by the PR NUMBER and no reader grows a seventh method.
  // One read per completed pair, in BOTH modes: the population is the narrow
  // window between a clear and a landing, and a cleared gate with no record
  // behind it is precisely the board fact the filing sweep measured five
  // times. Cached per PR, so a two-card PR (#16304) pays once.
  const prThreads = new Map();
  for (const pair of pairs) {
    if (!needsRecordRead(pair)) continue;
    if (!prThreads.has(pair.pr)) prThreads.set(pair.pr, await reader.readCardComments(repo, pair.pr));
    const rows = prThreads.get(pair.pr);
    pair.prComments = Array.isArray(rows) ? rows : null;
  }
  return { pulls, pairs };
}

function renderSweep({ repo, pulls, pairs }, { json = false } = {}) {
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
    console.log(JSON.stringify({ repo, openPrs: pulls.length, pairs: pairs.length, declarationLimb, rows, notes, unjudged }, null, 2));
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
  if (rows.length === 0) {
    if (wideningGap) {
      console.error(`✗ check-clause2-carriers --pair: ${wideningGap}`);
      return EXIT_INCOMPLETE;
    }
    for (const note of notes) console.error(`ℹ️  ${note.code} — ${note.text}`);
    // Each note is keyed by its CODE, never by count: the sibling reading and
    // the review-of-record reading are two different facts about the pair, and
    // a second note kind must not put the first one's sentence in its mouth.
    const sibling = notes.some((n) => n.code === 'C2-SIBLING');
    const record = notes.some((n) => n.code === 'C6-RECORD');
    const corrected = notes.some((n) => n.code === 'C2-CORRECTION');
    console.log(
      `✓ check-clause2-carriers: PR #${pair.pr} / card #${pair.card} — the clause-② declaration is ` +
        (sibling
          ? 'readable in the fixed spelling on a SIBLING card this same PR delivers rather than on ' +
            'this card (the reading above names which, and what it says), and both carriers agree'
          : corrected
            ? 'readable in the fixed spelling on a CORRECTION comment superseding the claim\'s own ' +
              'line (the reading above names which comment, and says the claim was not edited), and ' +
              'both carriers agree'
            : 'readable in the fixed spelling and both carriers agree') +
        (record
          ? ', and a review of record names this head (the note above says which comment to cite; ' +
            'existence, not the verdict)'
          : '') +
        (widening.state === 'clean'
          ? ', and its diff carries no widening tell. ⚠️ A tell is not a proof and its absence is not one either.'
          : '.'),
    );
    return EXIT_OK;
  }
  for (const row of rows) console.error(`✗ ${row.code} — ${row.text}`);
  for (const note of notes) console.error(`ℹ️  ${note.code} — ${note.text}`);
  // The file:line list, one per line, so an author can paste it into an editor.
  for (const line of refusalLines(widening)) console.error(`    ${line}`);
  // An adverse row OUTRANKS a gap -- a tell that WAS read is a fact about this
  // pair whatever else could not be read -- but the gap is still printed, or a
  // reader would take the rows below for the whole reading.
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

export function selfTest() {
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
  // The substring trap: a claim comment that DESCRIBES the declaration carries
  // the key as a fragment inside a sentence, never as a line of its own. The
  // reader is line-anchored, so a description is MISSING and never readable.
  t('a claim comment that only DESCRIBES the line reads MISSING, never declared', cardDeclaration([CLAIM('the dev declares `Clause-②: yes|no` from the diff')]).state === 'missing');
  t('…and it carries no value — a fragment inside prose is not a reading of one', cardDeclaration([CLAIM('the dev declares `Clause-②: yes|no` from the diff')]).value === undefined);
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
  t('⭐ …and names the one comment that repairs it, first line and all', says(missingLine, 'Clause-②-correction: 5642248126'));
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
  // pair -- the shape #17302 names for the default-tier lanes too.
  //
  // ⭐ The `Implemented-by:` value carries its token FIRST after the colon, and
  // that is load-bearing rather than tidy (#17346): this fixture is the pair
  // that must read CLEAN under EVERY row, and C4's grammar has always required
  // the identity to open the value. Written `branch \`claude/…\`` -- the way two
  // of the four live specimens write it -- the same comment reads `malformed`
  // on C4 the moment C4 can see this dialect at all, which is a real carrier
  // defect and belongs on a defective specimen (the `ADOPTION` fixture below
  // keeps it), never on the reference one.
  const RECORD = (
    sha,
    lines = ['- **Implemented-by:** `claude/issue-13657-x`', `- **Reviewed-by:** \`${RECORD_SESSION}\``],
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
  // ⚠️ CONTROL, measured and NOT endorsed: the template line copied WITHOUT
  // choosing reads `yes`, because `readValueToken` takes the first token after
  // the colon and treats the rest as the seat's argument. That calibration is
  // #13914's and is untouched here.
  //
  // ⭐ FLIP TRIGGER, pre-registered: this is a key-INITIAL DESCRIBING line, which
  // is exactly the population #17098 is open against. When #17098 lands, this
  // reading becomes `kind !== 'declared'` and this case flips WITH it — change
  // the expectation in THAT PR and keep the case. ⛔ Do not delete it, and ⛔ do
  // not read its green today as an endorsement: it records what the reader does
  // now, so that the sibling fix has a measured before-state to move.
  t('⚠️ CONTROL (flips with #17098): the UNFILLED template line reads `yes` today — the token is first, the alternative is trailing prose', readClause2Line(TEMPLATE_LINE)?.value === 'yes');
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
  t('…and says the claim comment was NOT edited', says(c2CorrectionNote(repairedPair), 'NOT edited'));
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
      'the correction comment that supersedes a claim declaration with the five measured prose ' +
      'spellings held out as negatives, ' +
      'the three read paths with their offline reader, the argv contract with its usage and its '
      + 'refusal, the board provenance line, the claim whose `Branch:` line parses to ZERO '
      + 'branches — reported as an unresolvable carrier rather than discarded — and the exit '
      + 'register).',
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
    const selfTestCode = selfTest();
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
  try {
    const { pulls, pairs } = await gather(repo, only, reader, { readFiles: only !== null });
    swept = pairs.length;
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
    return renderSweep({ repo, pulls, pairs }, { json: flagIndex(argv, '--json') !== -1 });
  } catch (err) {
    return reportTransportFailure(err, { swept });
  } finally {
    // On stderr in every mode, including `--json`: the budget is a fact about
    // the RUN, and folding it into the machine channel would change a shape
    // round reports already read. A verdict that does not say which path
    // answered is a verdict a seat cannot reproduce.
    console.error(renderReadPathReport(readPathState));
  }
}

if (isEntrypoint(import.meta.url)) {
  if (flagIndex(process.argv.slice(2), '--self-test') !== -1) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-clause2-carriers self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(selfTestCode);
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
