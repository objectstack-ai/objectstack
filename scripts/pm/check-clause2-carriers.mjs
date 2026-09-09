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
 * the residue is actionable, and it still does not count as a declaration.
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
 * ⭐ C4 is the ONE thing this file reads out of a verdict comment, and it is not
 * the verdict: the `Implemented-by:` / `Reviewed-by:` identity pair the verdict
 * declares about its own AUTHORSHIP (a session id on both, or a `mode:subagent`
 * dev's BRANCH on the left — the grammar note beside AUTHORSHIP_KEYS). No PASS
 * or FAIL token is read to reach it, so the boundary above is narrowed by
 * exactly one fact and not crossed — a self-issued verdict is refused on WHO
 * wrote it, never on what it concluded, and the row is report-only like every
 * other one here.
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
 * listing, for C5 (#16448). The sweep pays the listing once and the same
 * per-pair cost for every pair it derives. ⇒ a `--pair` run costs 3–7 requests,
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
 *      not be read, or when a `Clause-②: no` pair's changed-file listing could
 *      not be: an unread stream is not a never-hung gate and an unread diff is
 *      not a narrow one, so both are UNJUDGED rather than either verdict.
 *   4  they do not — or, since #16448, the declaration reads `no` while the
 *      diff carries a widening tell (row C5). One exit code with several
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
  CONTRACT_REVIEW_LABEL,
  DEFAULT_SWEEP_REPO,
  EXIT_PREREQUISITE_NOT_MET,
  PROXY_FLAG,
  SWEEP_REPO_SHAPE,
  deliveryEvidence,
  deliveryEvidenceNote,
  governingClaim,
  isGateSemanticLabel,
  labelNames,
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
  'C4: the independence clause\'s carrier (maintainer 2026-09-01 「同意 A」)': 52,
  'the #13910 specimen, end to end': 2,
  'pairing, derived from the same relation H8/H31 read': 3,
  'the three read paths: ordered, offline-capable, and named in every refusal': 24,
  'C5: the direction claim checked against the diff (#16448)': 16,
  'the exit register is distinct in every direction it must be': 6,
  'the argv contract and the board provenance (#16623)': 42,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
// Raised by exactly the one battery #16304 adds, so the roster's existing slack
// is preserved rather than tightened or loosened as a side effect.
const SELF_TEST_BATTERY_FLOOR = 15;

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
 *          | { kind: 'near-miss', line: string }
 *          | null}
 *
 * Four-valued on purpose. `declared` and `malformed` are different facts about
 * a line that IS the key; `near-miss` is a fact about a line that is not. Any
 * collapse of these into "no" is the defect #13914 filed.
 */
export function readClause2Line(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  let nearMiss = null;
  for (const line of lines) {
    const m = CLAUSE2_KEY_LINE.exec(line);
    if (m) {
      const value = readValueToken(m[1]);
      if (value !== null) return { kind: 'declared', value, line: quoteLine(line) };
      return { kind: 'malformed', value: quoteLine(m[1], 60), line: quoteLine(line) };
    }
    if (nearMiss === null && CLAUSE2_NEAR_MISS_LINE.test(line)) nearMiss = quoteLine(line);
  }
  return nearMiss === null ? null : { kind: 'near-miss', line: nearMiss };
}

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
 * @returns {{ state: 'declared'|'malformed'|'misplaced'|'missing'|'absent'|'unreadable',
 *   value?: 'yes'|'no', detail?: string }}
 */
export function cardDeclaration(commentRows) {
  if (!Array.isArray(commentRows)) return { state: 'unreadable' };
  const claim = governingClaim(commentRows);
  const claimRows = commentRows.filter((row) => CLAIM_COMMENT_MARKER.test(String(row?.body ?? '')));
  // The governing claim is the one the board is waiting on; when no comment
  // names a branch, every claim-marked comment is still a claim carrier and is
  // read, so a claim written without a branch cannot make the declaration
  // invisible.
  const governing = claim
    ? claimRows.filter((row) => (row?.created_at ?? null) === claim.createdAt)
    : claimRows;
  const pool = governing.length > 0 ? governing : claimRows;

  let malformed = null;
  let nearMiss = null;
  for (const row of pool) {
    const read = readClause2Line(row?.body);
    if (read?.kind === 'declared') return { state: 'declared', value: read.value, detail: read.line };
    if (read?.kind === 'malformed' && malformed === null) malformed = read;
    if (read?.kind === 'near-miss' && nearMiss === null) nearMiss = read;
  }
  if (malformed) return { state: 'malformed', detail: malformed.line };

  // Not in the claim carrier. Is it on the thread at all? That distinction is
  // the whole point of this function.
  for (const row of commentRows) {
    const read = readClause2Line(row?.body);
    if (read?.kind === 'declared') return { state: 'misplaced', value: read.value, detail: read.line };
    if (read?.kind === 'malformed' && malformed === null) malformed = read;
    if (read?.kind === 'near-miss' && nearMiss === null) nearMiss = read;
  }
  if (malformed) return { state: 'malformed', detail: malformed.line };
  // Which of the two not-read states this is, told apart by whether the carrier
  // exists at all. `claimRows` is non-empty exactly when some comment matched
  // the imported claim predicate, and `pool` is derived from it — so this asks
  // the same question the reading above asked and cannot answer it differently.
  return { state: claimRows.length > 0 ? 'missing' : 'absent', detail: nearMiss?.line };
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
export function c2DeclarationUnreadable(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
  const head = `card #${pair.card} (delivering open PR #${pair.pr}${pair.draft ? ' (draft)' : ''})`;
  const fixed = `the fixed spelling is \`Clause-②: yes\` or \`Clause-②: no\`, exactly those two`;
  const notADecision =
    'A missing reading is NOT a declared `no`: one of those is a decision and the other is an ' +
    'absent one, and the enqueue gate\'s content limb — the ONLY limb that can fire for a PR ' +
    'whose diff touches no contract path — has nothing to read. ⛔ Do not fill the line in on ' +
    'the claiming seat\'s behalf; the declaration IS the judgement. ⛔ And do not relax the ' +
    'spelling to accept the prose: a predicate that reads prose is a heuristic, and the measured ' +
    'terminus of that direction is a check that can barely fail.';
  switch (d.state) {
    case 'declared':
      return null;
    case 'unreadable':
      return null; // accounted as UNJUDGED by the caller — never silently clean.
    case 'misplaced':
      return (
        `${head} — the \`Clause-②\` declaration is MISPLACED: the fixed spelling appears on the ` +
        `thread (${JSON.stringify(d.detail)}) but NOT in the card's claim comment, which is the ` +
        'carrier the enqueue gate\'s content limb reads. The thinking was done and written down; ' +
        `it is in a place the predicate does not look. Move the line into the claim comment — ` +
        `${fixed}. ${NEVER_WRITES}`
      );
    case 'malformed':
      return (
        `${head} — the \`Clause-②\` line is MALFORMED: ${JSON.stringify(d.detail)} carries the key ` +
        `but not one of the two values, so there is no reading. ${fixed}. ${notADecision} ` +
        `${NEVER_WRITES}`
      );
    case 'missing':
      return (
        `${head} — NO READING on the declaration limb, and the DECLARATION LINE is what is ` +
        `missing: the card's claim comment is there and carries no \`Clause-②:\` line in the ` +
        'fixed spelling' +
        (d.detail ? `, and the nearest thing on the thread is ${JSON.stringify(d.detail)}` : '') +
        `. Remedy: add the line to that claim comment — ${fixed}. ${notADecision} ${NEVER_WRITES}`
      );
    default:
      return (
        `${head} — NO READING on the declaration limb, and the CLAIM COMMENT is what is ` +
        'missing: no comment on the card\'s thread is a claim comment, so the carrier this limb ' +
        'reads does not exist and no line could have been read from it' +
        (d.detail ? `; the nearest thing on the thread is ${JSON.stringify(d.detail)}` : '') +
        '. Remedy: write the claim comment with a first line beginning `Claim:`, then the ' +
        `\`Clause-②: yes|no\` line; ${fixed}. A heading-style claim (\`## Claim — …\`) is not a ` +
        'claim comment to this predicate, however complete the reasoning under it. ' +
        `${notADecision} ${NEVER_WRITES}`
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
 * `missing`, `absent` and `unreadable` are all NOT declarations on the sibling
 * either, exactly as they are not on the subject card. Nothing about what
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
 * legitimate act can supply; none of them is covered here.
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
 */
const SESSION_TOKEN = /^(?:\*\*)?(?:`)?[ \t]*(session_[A-Za-z0-9]+)(?![A-Za-z0-9_])/;

/**
 * A `mode:subagent` dev's identity: the branch the claim protocol names it by.
 * Anchored on the `claude/` prefix every dispatched branch carries and closed on
 * an alphanumeric, so the seat's reasoning may follow the token — a trailing
 * `,` or `.` belongs to the prose, never to the branch.
 */
const BRANCH_TOKEN = /^(?:\*\*)?(?:`)?[ \t]*(claude\/[A-Za-z0-9._/-]*[A-Za-z0-9])/;

function readSessionToken(raw) {
  const m = SESSION_TOKEN.exec(String(raw ?? '').replace(/^[ \t]+/, ''));
  return m ? m[1] : null;
}

/** The `Implemented-by:` value — a session id, or a dev branch. */
function readImplementerToken(raw) {
  const rest = String(raw ?? '').replace(/^[ \t]+/, '');
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
 */
export function readVerdictAuthorship(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (!lines.some((line) => VERDICT_MARKER.test(line))) return null;

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
 * The authorship state of one CARD's thread, judged on its GOVERNING verdict.
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
 * @param {{ body?: string, created_at?: string }[]|null} commentRows
 * @returns {{ state: 'unreadable', reason: string }
 *          | { state: 'none' }
 *          | { state: 'independent', implementedBy: string, reviewedBy: string }
 *          | { state: 'self-review', session: string, at: string, detail: string }
 *          | { state: 'malformed', at: string, detail: string }}
 */
export function cardVerdictAuthorship(commentRows) {
  if (!Array.isArray(commentRows)) return { state: 'unreadable', reason: 'the comment thread could not be read' };

  const candidates = [];
  for (const row of commentRows) {
    const read = readVerdictAuthorship(row?.body);
    if (read === null || read.kind === 'legacy') continue;
    const ms = Date.parse(row?.created_at ?? '');
    // ⛔ An undated candidate is not a droppable row: dropping it would move the
    // GOVERNING verdict, which is the whole reading. Refuse, exactly as
    // `carrierGateHistory` refuses an undated gate event.
    if (!Number.isFinite(ms)) return { state: 'unreadable', reason: 'a contract-review verdict comment carries no readable date' };
    candidates.push({ read, at: String(row.created_at), ms });
  }
  if (candidates.length === 0) return { state: 'none' };

  candidates.sort((a, b) => a.ms - b.ms);
  const governing = candidates[candidates.length - 1];
  if (governing.read.kind === 'malformed') {
    return { state: 'malformed', at: governing.at, detail: governing.read.detail };
  }
  const { implementedBy, reviewedBy } = governing.read;
  // ⭐ Equality IS the same-session test, and needs no second rule to be one:
  // the two identity grammars are disjoint, so a `mode:subagent` dev's branch on
  // the left can never equal the reviewing seat's session on the right. That is
  // reading a of the 2026-09-02 ruling, mechanized — a subagent-dispatched card
  // reads INDEPENDENT, and only a seat that coded in-session and passed its own
  // diff reads self-review.
  if (implementedBy !== reviewedBy) return { state: 'independent', implementedBy, reviewedBy };
  return { state: 'self-review', session: implementedBy, at: governing.at, detail: governing.read.line };
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
 * for the declaration limb, so no pair owes an extra request for this row.
 */
export function c4VerdictSelfReview(pair) {
  const v = cardVerdictAuthorship(pair?.cardComments ?? null);
  if (v.state === 'unreadable') return null; // UNJUDGED by the caller — never silently clean.
  if (v.state === 'none' || v.state === 'independent') return null;

  const head = `card #${pair?.card} (delivering open PR #${pair?.pr}${pair?.draft ? ' (draft)' : ''})`;
  const fixed =
    'the fixed spelling names the identity that produced the diff, read from the implementation ' +
    'claim — `Implemented-by: session_…` for a `mode:remote` dev, `Implemented-by: claude/…` (its ' +
    'BRANCH) for a `mode:subagent` dev, which has no session of its own — and `Reviewed-by: ' +
    'session_…` for the session rendering this verdict, which is a seat and always has one; each ' +
    'token immediately after its colon, the seat\'s reasoning free to follow it';
  const legacyIsSilent =
    '⚠️ A verdict carrying NEITHER line is a LEGACY verdict and is silent here — it predates the ' +
    'carrier and ⛔ is never turned red by its absence.';

  if (v.state === 'malformed') {
    return (
      `${head} — its governing contract-review verdict (${v.at}) carries the authorship pair HALF ` +
      `WRITTEN: ${v.detail}. Both lines or neither — half a pair compares to nothing, so there is ` +
      `no reading of independence here, and a started carrier left unreadable is a different fact ` +
      `from one never started. ${fixed}. ${legacyIsSilent} ${NEVER_WRITES}`
    );
  }
  return (
    `${head} — its governing contract-review verdict (${v.at}) is a SELF-REVIEW: \`Implemented-by:\` ` +
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
export function pairNotes(pair, pairs = null) {
  const notes = [];
  const sibling = c2SiblingDeclared(pair, pairs);
  if (sibling) notes.push({ code: 'C2-SIBLING', text: sibling });
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
 * `malformed` and `unreadable` are counted into neither — each is its own
 * reading with its own row, and an unreadable thread is UNJUDGED rather than
 * either not-read state.
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
  // The gate history is owed by C3 CANDIDATES only — the cost bound and the
  // accounting read one predicate, so a pair can never owe a stream the live
  // reader was never going to fetch. An unread stream is not a never-hung gate.
  if (gaps.length === 0) {
    const binding = gateBindingState(pair);
    if (binding.state === 'unreadable') gaps.push(...binding.gaps);
  }
  // C4's own #4690 half: a verdict this file could not ORDER is not a verdict
  // it read as independent. Reached only once the thread itself read, so the
  // unreadable-thread gap above is never doubled.
  if (gaps.length === 0) {
    const authorship = cardVerdictAuthorship(pair?.cardComments ?? null);
    if (authorship.state === 'unreadable') gaps.push(`card #${pair?.card}'s verdict authorship (${authorship.reason})`);
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
    console.log(
      `✓ check-clause2-carriers: PR #${pair.pr} / card #${pair.card} — the clause-② declaration is ` +
        (notes.length > 0
          ? 'readable in the fixed spelling on a SIBLING card this same PR delivers rather than on ' +
            'this card (the reading above names which, and what it says), and both carriers agree'
          : 'readable in the fixed spelling and both carriers agree') +
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
  t('…and sends the remedy to the claim comment that is already there', says(missingLine, 'add the line to that claim comment'));
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
  const completed = declaredYes({
    pr: 13864,
    card: 13657,
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: HEAD_AT_PASS,
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
  t('…and it reads INDEPENDENT rather than unjudged — silence here is a reading, not a gap', cardVerdictAuthorship([VERDICT(SUBAGENT_PAIR)]).state === 'independent' && pairUnjudged(reviewed([VERDICT(SUBAGENT_PAIR)])) === null);
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
  t('…and arrival order does not decide it — the reader sorts', cardVerdictAuthorship([VERDICT(INDEPENDENT_PAIR, '2026-09-01T12:56:27Z'), VERDICT(SELF_PAIR, '2026-09-01T11:21:18Z')]).state === 'independent');
  t('a LEGACY verdict posted after a self-review does not clean it — it is not a candidate at all', cardVerdictAuthorship([VERDICT(SELF_PAIR, '2026-09-01T11:21:18Z'), VERDICT([], '2026-09-01T13:00:00Z')]).state === 'self-review');

  // #4690, C4's half: unread is never clean
  t('an UNREADABLE thread produces no C4 row — it is UNJUDGED instead', c4VerdictSelfReview(pair({ cardComments: null })) === null);
  t('an UNDATED verdict refuses the ordering rather than guessing it', cardVerdictAuthorship([VERDICT(SELF_PAIR, null)]).state === 'unreadable');
  t('…and the unjudged accounting names it, so the pair cannot render as clean', says(pairUnjudged(reviewed([VERDICT(SELF_PAIR, null)])), 'verdict authorship'));
  t('…while a dated, judged verdict adds no gap of its own', pairUnjudged(reviewed([VERDICT(INDEPENDENT_PAIR)])) === null);
  t('C4 costs no extra request — it reads the thread C2 already fetched', needsGateHistory(reviewed([VERDICT(SELF_PAIR)])) === false);

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
      'the three read paths with their offline reader, the argv contract with its usage and its '
      + 'refusal, the board provenance line, and the exit register).',
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
