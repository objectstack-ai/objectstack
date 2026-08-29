#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PM half-state sweeper (#7341 item 2) — REPORT-ONLY enumeration of the
 * label/assignee invariants the dispatch protocol calls "过夜半状态".
 *
 *   node scripts/pm/check-half-states.mjs               # sweep the live repo
 *   node scripts/pm/check-half-states.mjs --probe       # can live mode run HERE? (no sweep)
 *   node scripts/pm/check-half-states.mjs --self-test   # verify the predicates offline
 *   node scripts/pm/check-half-states.mjs --format=markdown [--provenance='…']
 *                                                       # the same sweep, rendered for an issue body
 *
 * ## The standing caller (#9844)
 *
 * For most of this file's life its consumer was "a PM seat's patrol round" —
 * which is to say, nobody's calendar. A shift covering two lanes declared a
 * queue empty from memory while eight malformed claims (H2) and an unenumerated
 * backlog sat on the board; not one predicate here had fired, because nothing
 * standing ever called them. An alarm added to a script nobody runs is still
 * silence, and the transport note below explains why "some seat should run it"
 * kept not happening: the live sweep cannot run inside a PM session container
 * at all.
 *
 * So the caller is now `.github/workflows/half-state-patrol.yml` — a scheduled
 * workflow, on a runner where the transport prerequisite is met, landing the
 * result by rewriting ONE pinned anchor issue in place (edit history is the
 * archive; never a comment per run). `--format=markdown` exists for exactly
 * that consumer, and `--provenance` lets the caller stamp its own run identity
 * into a body this script otherwise renders repo-agnostically.
 *
 * What did NOT change, and must not: this stays report-only. The workflow never
 * fails a build over findings and never writes a label. The one thing it DOES
 * treat as a failure is its own non-delivery — a patrol that cannot land its
 * report is the disease, not a finding.
 *
 * ## Adopting the patrol in a sibling repo (#11217)
 *
 * The pair (this file + that workflow) is copied VERBATIM into a sibling repo;
 * the only per-repo input is one repository variable naming that repo's anchor
 * issue (`HALF_STATE_ANCHOR_ISSUE`). Each install runs on its own runner with
 * its own `GITHUB_TOKEN` and reads its own board — ⛔ no cross-repo credential
 * anywhere, which is the route ruled at grading rather than a matrix job.
 *
 * Two things make "verbatim" actually safe, and both are new: the swept repo is
 * resolved from the runner's own `GITHUB_REPOSITORY` rather than a hardcoded
 * default (`resolveSweepRepo` carries the argument), and the workflow REFUSES
 * to run with an unconfigured anchor instead of writing this repo's anchor
 * number in someone else's repo. It was measured worth doing: with three of the
 * four repos uninstalled, 37 of the fleet's 59 open `pm:blocked` cards had
 * never been swept, and 7 of objectui's 12 machine-readable blocks were
 * already expired when a human read them by hand.
 *
 * What still does NOT travel, stated so a reader does not assume it does:
 * cross-repo `Blocked-by:` targets stay unresolvable per install (each token
 * reads its own repo), so H19 reports them as UNJUDGED — accepted, and made
 * loud separately.
 *
 * ## Why report-only, and why the exit code is ALWAYS 0 on a completed sweep
 *
 * The pm-dispatch state model (.claude/skills/pm-dispatch/SKILL.md, "State
 * model") says the labels ARE the state machine, and its label discipline says
 * 「状态变更不过夜」: a label applied without its paired signal is a state no
 * sweep can interpret. Those half-states occur in practice — a card carried
 * `pm:queue` AND `pm:dispatched` simultaneously for ~14 hours (#5925's
 * 2026-08-09 correction comment); another sat dispatched with an assignee and
 * no claim for 48h+ (the #5925 stale-claim reclaim) — and today finding them
 * is a manual read of every card. This script is the mechanical enumerator.
 *
 * It is deliberately NOT a gate: a half-state is a fact about a live, shared
 * board, not about the PR that happens to run CI next — failing an unrelated
 * PR over board state would punish the wrong actor (the same reasoning that
 * keeps `check:platform-checklist` out of CI, lint.yml's own note). So a
 * completed sweep exits 0 whether it found 0 or 40 violations; the findings
 * are the output, and the consumer is a PM seat's patrol round (the standby
 * posture in SKILL.md documents the invocation). Only a sweep that could not
 * run (network, auth, bad usage) exits non-zero — per #4690, "could not read
 * the input" must never look like "input is clean".
 *
 * ## The invariants (each names its protocol source)
 *
 *   H1  `pm:dispatched` with no assignee — dispatch marks a claim; a claim is
 *       assign + claim comment (state model / step 4).
 *   H2  assignee set on a pm-tracked card, but no claim comment on the thread
 *       (a comment whose body carries a "Claim:" line) — the assignee field
 *       alone cannot say WHICH session owns it (step 4; #4588). The marker is
 *       read with an OPTIONAL leading blockquote ">", because step 4's own
 *       claim template is a blockquote (SKILL.md, "> Claim: …") — the predicate
 *       used to reject the exact shape the skill tells every seat to write, and
 *       reported a correctly-claimed card as a half-state (#7488, measured on
 *       #6752). The strictness either side of that marker is deliberate and
 *       stays: the line must BEGIN with the word, so ordinary prose containing
 *       "claim" is not a claim comment.
 *   H3  `pm:queue` + `pm:dispatched` both present — reads as available to the
 *       queue view and in-flight to the lane view; neither is trustworthy
 *       (#5925 2026-08-09 correction, the measured specimen).
 *   H4  `pm:blocked` with a `Blocked-by:` line in NEITHER channel — body nor
 *       comment. The machine half of the label is that line; without it the
 *       unlock sweep can never return the card (state model, label
 *       discipline). It reads TWO channels because seats write two: the MCP
 *       body-escaping hazard (#8813) makes a body rewrite the riskier write,
 *       so the line is deliberately parked in a comment — 26 of 40 blocked
 *       cards were body-clean at the 2026-08-19 census, and a body-only read
 *       reported every one of them as having left the machine nothing. Either
 *       channel discharges the duty; the finding names both so a reader knows
 *       which one to fix (#8941, and the #9948 gauge-recalibration ruling).
 *       The line may be DECORATED in either channel — 「`Blocked-by: #9612`」
 *       is the natural markdown for a line meant to be grepped, and reading it
 *       as absent left #10063 permanently blocked in silence (#10102). H9's
 *       `Restart-when:` shares that anchor AND, since #10403, this two-channel
 *       read; the history of the closed asymmetry is stated at H9.
 *   H5  `pm:seat` sticker whose title/assignee pair is out of sync — the
 *       seat-sticker protocol makes 标题、assignee、正文 a same-write triple:
 *       a title claiming 🟢 <login> must have that login as assignee; a title
 *       claiming ⏳ vacant must have none. (Routine seats declare 🟢 Routine
 *       and are exempt from the assignee half — bots can't be assigned.)
 *   H6  `pm:seat` sticker whose body exceeds ~10 KB — the seat-post protocol
 *       bounds the live body to current state (six-section template, #7583,
 *       maintainer-accepted 2026-08-11); an oversized body means shift
 *       narration is accreting where per-card state already lives (cards,
 *       PRs, round reports). Soft report-only signal: the remedy is a
 *       takeover-style compaction (edit history is the archive), never
 *       truncation. #6019 reached ~61 KB and exceeded tool read limits
 *       before this rule existed.
 *   H7  an OPEN PULL REQUEST whose body declares `Part of #N` while ALSO
 *       carrying a closing keyword bound to that same `#N` — contradictory by
 *       construction. `Part of` is the protocol saying "merging this must NOT
 *       close the card"; a closing keyword is GitHub being told it must.
 *       GitHub wins, silently, on merge. This was the first item over PULL
 *       REQUESTS rather than issues, because the PR body is the surface where
 *       the fact is still fixable — see the next section.
 *   H8  a card's delivering PR is MERGED while the card still carries
 *       `pm:dispatched` — the merge's paired write (drop the label, re-grade
 *       the remainder) never landed (#8683). Delivery is read from merged PR
 *       bodies with H7's code-stripped extractors (`Part of #N`, or a closing
 *       keyword bound to `#N` — either way an OPEN dispatched card named by a
 *       merged PR is a half-state, whichever mechanism failed), and — for the
 *       bodies that declare NO delivery at all — from the PR's own branch name
 *       (#11036: a merged PR whose body said only `Refs #10757` left its card
 *       dispatched and unreported for ~22h in a sweep that got six other H8
 *       rows right). The precedence is deliberate and the widening's whole
 *       safety margin; `prDeliversCard` carries the argument. Live mode
 *       feeds H8 a bounded window of recently merged PRs, so it is a patrol
 *       accelerator, never an exhaustive audit: a delivery older than the
 *       window is invisible, and the finding clears when the paired write
 *       lands, not when the PR ages out.
 *       H8 is ALSO handed the open-PR list the sweep already holds (#10468):
 *       a card delivered in halves keeps `pm:dispatched` legitimately while
 *       its last half is open, and the row used to fire on every sweep until
 *       that half landed — prescribing a DESTRUCTIVE de-labelling against the
 *       most active card on the board. That case now emits a distinct quieter
 *       sentence that names both sides and says the label is correct, rather
 *       than falling silent: silence would lose the genuine #8683 case where
 *       the last half is later ABANDONED. See the predicate.
 *   H9  `pm:on-hold` without a machine-fireable `Restart-when:` line in
 *       EITHER channel — the state model (post 2026-08-16 ruling) makes the
 *       hold state legal
 *       ONLY with a machine-readable exit: `Restart-when: closed <owner/repo>#N`
 *       (fired by the same unlock scan as `Blocked-by:`, and since #10403 over
 *       the same TWO channels — body OR comment, the H4/H14 contract; a
 *       comment-parked exit fired and sat unnoticed ~2 days under the old
 *       body-only read) or a one-line executable predicate. A hold nothing can fire
 *       is indistinguishable from an abandoned card. `Restart-when: manual — …`
 *       counts as MISSING, deliberately: the protocol says a card no mechanism
 *       can revive is closed `not planned` (reason + provenance in the closing
 *       comment), so accepting a `manual` line here would hand every seat a
 *       one-word spelling that defeats the invariant this item enforces.
 *   H10 `priority:p0`, open, unassigned, and no activity past the threshold —
 *       p0 is queue-jump priority (dispatched immediately, past batch and
 *       round boundaries), so an unclaimed p0 holding still for longer than
 *       any legal round latency almost always means NO seat's scan scope
 *       covers the queue it sits in (the measured specimen: a correctly
 *       triaged p0 that sat ~36h because the label queue it was routed to had
 *       no named reader). Staleness is read from `updated_at` — an
 *       unparseable timestamp reports as a finding, never as fresh (#4690:
 *       "could not read the input" must not look like "input is clean").
 *   H11 the important-parked inventory — a card carrying an importance signal
 *       (native type `Bug`, or a `bug` / `security` / `priority:*` label)
 *       sitting in `pm:blocked` or `pm:on-hold` and open past the threshold.
 *       Maintainer concern, 2026-08-16, verbatim: 「我担心的优先的，重要的问
 *       题，比如bug 被放进 blocked 或者 on-hold 没人理会」. Distinct from H10
 *       (p0 + UNASSIGNED regardless of state): H11 is the broader
 *       importance × parked-state cross, so every triage fire prints the
 *       inventory of important cards that a parked state could otherwise
 *       hide indefinitely. Report-only like everything here — the remedy is
 *       the triage round re-checking the card's exit liveness, not a gate.
 *   H12 an OPEN, non-draft PR with auto-merge unarmed and no activity past
 *       the threshold — the orphan-landing detector (queue-steward
 *       retirement, maintainer-ruled 2026-08-16: the retired seat's one
 *       genuine gap). In this protocol a dev PR is flipped ready only at
 *       review ACCEPT, so ready = reviewed by construction; a reviewed PR
 *       that left the merge queue (or never entered it) with nobody handling
 *       it would otherwise wait silently forever. Patrol input, not a gate.
 *   H13 a card carrying `domain:*` with NO pm-state label, aged past one
 *       sweep cycle — the half-annotated shape the protocol's own
 *       single-label writes produce by design, which the triage sweep's
 *       disjunct ③ ("有 domain:* 无 pm-state") exists to heal hourly. In that
 *       shape the card is invisible to every seat's candidate query (routing
 *       landed, the state machine never did), and it is ALSO invisible to
 *       every label-scoped listing in this sweep — the shape is defined by
 *       the absence of the labels the other listings key on — so H13 is the
 *       one item that needs an UNSCOPED listing. Aged past a cycle it is a
 *       defect of the HEALING LOOP, not inventory (maintainer, 2026-08-19,
 *       verbatim: 「项目经理等分诊,但是没有切换 label,导致挂了很久。」「我
 *       刚和他说了他才处理。」— the measured specimen, its body self-declaring
 *       P0/data-integrity, sat ~26h until poked by hand). A louder line fires
 *       when the card's own title/body self-declares P0/data-integrity: for
 *       that class the emergency-triage channel (immediate triage subagent)
 *       is the mandated move, never the hourly Routine.
 *   H14 `pm:blocking` cache incoherence, in BOTH directions, read off the
 *       `Blocked-by:` reverse index this sweep already has the bodies for.
 *       `pm:blocking` is not a state a seat sets: the state model makes it a
 *       CACHE the triage sweep derives from that index (「分诊 sweep 自
 *       `Blocked-by:` 索引推导的缓存,⛔ 不手工挂」), and the lane selection
 *       order ranks it second only to `priority:p0`. A cache with a ranking
 *       consumer and no coherence check drifts in two different ways, and
 *       each lies differently: a card carrying the label that NOTHING targets
 *       is boosted past fresher work on the authority of a dependency that
 *       does not exist (worse than an absent label — it lies with authority),
 *       while a card that IS targeted and does NOT carry it is a real
 *       unblocker the selection order cannot see. Report-only, and pointedly
 *       so: the producer is the triage sweep's derivation pass, so the remedy
 *       is always a derivation that runs, never a label written from here.
 *       The index it reads is the UNION of both channels (body ∪ comment),
 *       for the same reason H4 reads both — and here the cost of reading one
 *       was measured: #9465 and #9968 were reported stale while their
 *       dependents (#9709/#9828 and #9969/#9652) stated the wait in comments.
 *       That is the 「量具错位」 the 2026-08-19 ruling on #9948 named — 「修量
 *       具而非追假 stale」 — and both shapes are regression pins now. The two
 *       directions treat an INCOMPLETE index differently on purpose: stale is
 *       a claim about absent evidence and is suspended when any gated comment
 *       fetch failed, while missing is a claim about evidence in hand and
 *       cannot be manufactured by reading more. See the predicate.
 *       Both directions were non-empty at the reading this item landed on
 *       (2026-08-19, 234 open cards, 17 `Blocked-by:` body lines): ONE stale
 *       card and FIVE missing ones, with not a single coherent pairing on the
 *       board — the cache had no reader checking it and had drifted to 0%
 *       agreement with the index it is derived from.
 *   H15 the oldest UNCLAIMED `pm:blocking` card and its age — one row, no
 *       threshold, selection-order compliance made visible (maintainer,
 *       2026-08-19: 「然后车道项目经理应该优先处理 blocking」). Where H14 asks
 *       whether the cache is TRUE, H15 asks whether anyone acted on it: a
 *       lane that keeps taking fresher picks past an unclaimed blocking card
 *       now says so on the anchor, by name. Deliberately not an alarm and
 *       deliberately unconditional — see the rationale on the predicate for
 *       why this one carries no threshold constant.
 *   H16 an OPEN, non-draft PR sitting in a MERGE CONFLICT
 *       (`mergeable_state` = `dirty`) past the threshold — the one board state
 *       no instrument here could express before it (devx incident,
 *       maintainer-approved 2026-08-19, verbatim: 「同意你的建议」). A conflict
 *       is not a red check: it starts no CI run, raises no event, and turns no
 *       check-run red, so every signal a patrol reads by proxy keeps reporting
 *       health — and when auto-merge is ARMED the PR additionally reads as
 *       "the queue is handling it" (H12's own reading, correct there and
 *       exactly wrong here). The measured specimen hung ~4h with nobody aware.
 *       The incident's lesson, verbatim: 「一个无法表达某状态的仪器,会把它报成
 *       它能表达的最近状态。」 — which is what H1–H15 were doing to this state.
 *       Two consequences shape the item. It is the only one needing a per-PR
 *       GET (`mergeable_state` is absent from the `/pulls` LIST payload and
 *       lives on the single-PR endpoint alone), taken for CANDIDATES only and
 *       never fatal to the sweep. And it deliberately does NOT read
 *       `auto_merge` in the finding-reducing direction H12 does: auto-merge
 *       does not resolve conflicts, so an armed dirty PR is the disease, not a
 *       handler. `unknown`/null readings are SKIPPED and never vouched for —
 *       GitHub computes mergeability asynchronously, so that reading is the
 *       platform saying "ask again later", not a state to name.
 *
 * ## H17 — the one item here that is NOT an invariant
 *
 *   H17 the on-hold TRIGGER-FILE INDEX — an inventory SECTION, not a
 *       predicate, and the only thing in this file that can never produce a
 *       finding. Each row is an open `pm:on-hold` card and the repo-relative
 *       files its hold comment(s) or body name as opportunistic-restart
 *       triggers. A card appearing in it is a hold in perfectly good standing;
 *       the row exists so a dispatching seat can intersect its file surface
 *       against the board's held cards by GLANCING at the anchor it already
 *       reads at the top of every round.
 *
 *       It is here because that intersection was measured NOT RUNNING (#10034,
 *       2026-08-19): across six cards the named trigger files were touched
 *       NINETEEN times and the rider was carried ZERO times. The mechanism is
 *       real and maintainer-accepted (2026-08-11), but it existed only as a
 *       remembered protocol step — in SKILL.md and in the hold comments
 *       themselves — and a written step nobody executes is worse than none,
 *       because holds are PRICED assuming it runs.
 *
 *       ⛔ Why it is NOT in `dispatch-gates.mjs`, where the intersection is
 *       actually wanted: that script runs in a seat container, whose live
 *       GitHub read is 403 — the same transport fact this file's prerequisite
 *       classifier exists to name. Building the intersection there would
 *       re-create the disease one layer down: a second mechanism that cannot
 *       execute. The patrol runs on a runner where the transport prerequisite
 *       is met, so it gathers and renders; the seat reads. No new seat-side
 *       dependency, and the behaviour closes through a surface that already
 *       has a standing caller.
 *
 *       Extraction is deterministic and refuses to guess: a closed set of
 *       anchor terms (`H17_TRIGGER_ANCHOR_TERMS`, derived from a nine-card
 *       census) plus the canonical `Restart-touch:` channel locate the clause,
 *       and every candidate token is validated against `git ls-files`.
 *       Anything unverifiable is DROPPED, so the index under-reports and never
 *       invents — a fabricated row would send a seat to intersect against a
 *       path that does not exist, and that intersection would silently never
 *       hit, which is the original defect wearing a new mask.
 *
 * ## H18 — `pm:retriage` aged past one triage cycle
 *
 *   H18 an open card carrying `pm:retriage` past the threshold — the label's
 *       own state model (maintainer ruling 2026-08-19/20, verbatim: 「同意 并
 *       存」) has it COEXIST with the card's standing `pm:*` label rather than
 *       replace it: the objecting seat applies it alongside its evidence
 *       comment, and the triage Routine — which re-judges every `pm:retriage`
 *       card each fire, high priority (SKILL.md) — is the only remover. That
 *       division of duties is H13's healing-loop shape again: a label nobody
 *       re-checks for age is the next "state nobody is watching", and without
 *       this item nothing here would say so. Aged past one cycle the row names
 *       the card and its coexisting standing `pm:*` label; `pm:retriage`
 *       present with NO such label gets its own note instead — the
 *       coexistence the state model requires is itself missing, so the
 *       disputed grading is unidentifiable (异议对象不明) from the label set
 *       alone. Age is read from `updated_at`, the same proxy H13 uses for the
 *       same reason: this sweep makes no per-card timeline fetch for the
 *       label-APPLICATION event, and every triage re-judgement (grade kept or
 *       changed) bumps `updated_at`, so a stale reading means nothing touched
 *       the card since some triage pass — which is exactly the failure this
 *       item exists to name. Report-only and NOT loud, like H14–H16: the
 *       remedy is the triage Routine's next fire, never a label written here.
 *
 * ## H19 — the question that ENDS a block
 *
 *   H19 an open `pm:blocked` card whose `Blocked-by:` target has CLOSED — the
 *       block has outlived its blocker. Two items already read that line and
 *       NEITHER expires a block: H4 asks whether the line EXISTS, H14 asks the
 *       REVERSE index (does anything target THIS card). Nothing asked whether
 *       the issue the line NAMES is still open, so an expired block sat in
 *       complete silence with a well-formed line, a correct label and no row
 *       anywhere. Two measured instances, both found by READING and neither by
 *       any gauge: a card whose comment-borne `Blocked-by:` target closed at
 *       09:03:37Z and which sat blocked ~4.5h after that, released only when a
 *       human walked the lane's dependency graph; and one whose body-borne,
 *       backtick-decorated target closed at 07:58:08Z and which was released
 *       only by a manual triage pass. Targets are read from BOTH channels
 *       through the shared decorated-directive reader — one of the two
 *       measured cards states its blocker only in a comment, so a body-only
 *       read would have seen half the evidence the item was filed on — and
 *       cross-repo targets are resolved rather than dropped (the opposite call
 *       from `buildBlockingIndex`, and both are right: the index asks which
 *       LOCAL card is waiting, H19 asks whether THAT issue is still open).
 *       Three target states, never two: a target that could not be resolved
 *       fires its own quieter row saying the liveness is UNJUDGED, because a
 *       silently dropped target reads as a healthy block forever — this item's
 *       own disease in a new mask (#4690). Report-only, and pointedly: the
 *       release is a protocol procedure with two mechanical double-checks
 *       (state model, 「放行双查」) over the card's conversion comments and its
 *       merged-PR timeline, so this row surfaces the candidate and the unlock
 *       sweep releases it — ⛔ never a label written from this script.
 *
 * ## H20 — the question that says a dispatch actually HAPPENED
 *
 *   H20 an open `pm:dispatched` card whose claim comment names a branch for
 *       which NO REMOTE REF EXISTS AT ALL, older than the lane's
 *       dispatch→first-commit baseline (`DISPATCHED_NO_REF_STALE_MINUTES`).
 *       Claiming and dispatching are two acts with a gap between them: the
 *       claim is an atom the protocol defines carefully (assign + label swap
 *       in one write, the claim comment, a race re-read) and LAUNCHING the dev
 *       is a third act outside it that nothing binds to the first two. A seat
 *       interrupted between them — a maintainer message answered, a tool
 *       error, lost context — leaves a card that is `pm:dispatched`, assigned,
 *       carrying a full claim comment naming a branch and a worktree, with no
 *       agent anywhere working it. ⭐ It is INVISIBLE FROM THE CARD: every
 *       field is correct, and only the absence of something elsewhere is
 *       wrong, which is why a skill sentence could not carry it and a row
 *       must. Measured on #8878 (2026-08-20): claim comment at ~14:05Z, the
 *       dispatch call never made, 74 minutes `pm:dispatched` with nobody on it
 *       until a patrol tick compared branch heads. Every adjacent row declines
 *       it for a reason of its own — H2 wants a MISSING claim comment and this
 *       one is complete, H4/H14 want `Blocked-by:`, H9 wants a hold, H8 wants
 *       a merged PR and nothing here ever ran — so the shape had no reader.
 *       ⛔ The key is NO REF AT ALL and never "no PR yet": a dev inside a long
 *       build legitimately has a ref and no PR for over an hour (measured
 *       repeatedly on this lane), so a PR-keyed row would fire hardest on the
 *       healthiest dev on the board. The guarantee is structural — the
 *       predicate is handed a ref state and nothing else. Three ref states,
 *       never two, exactly as H19 landed them: `exists` is healthy, `absent`
 *       fires, and an UNREADABLE probe fires its own quieter row saying the
 *       dispatch is unjudged, because a ref read dropped in silence reads as a
 *       healthy dispatch forever (#4690). ⚠️ The symptom is identical to a dev
 *       agent that DIED and the remedies are opposite (a dead agent needs a
 *       probe, an undispatched claim needs a dispatch), so the row names both
 *       readings rather than diagnosing one. Report-only like everything here:
 *       the remedy is a dispatch or a withdrawn claim, never a label written
 *       from this script.
 *   H21 an OPEN PULL REQUEST whose body binds a closing keyword to a `#N` the
 *       body never declared itself `Part of`, inside a SENTENCE that reads as
 *       not closing it ("Filed, not fixed: #10240", "out of scope: closes
 *       #N"). H7's own rationale covers this whole class while H7's predicate
 *       covers one spelling of it — H7 is bound to a `Part of #N` declaration
 *       and a body that declares `Part of` for nothing is silent by
 *       construction, however plainly it says the card stays open. Measured
 *       specimen (#10392): PR #10241 carried no `Part of` and the sentence
 *       "Filed, not fixed: #10240"; #10240 closed `completed` two seconds
 *       after that merge and read as finished until a human reopened it a day
 *       later. ⛔ The trigger is the NEGATION WINDOW and never keyword
 *       presence: 277 of the 300 most recently merged bodies carry a closing
 *       keyword bound to a number (301 matches), so a presence rule would
 *       report every correct PR in the corpus. The negation is the author's
 *       own statement of intent contradicting the instruction beside it, which
 *       is what makes accident separable from intent at all. The window is a
 *       SENTENCE, measured: widening it to the whole body turns 0 false
 *       positives into 13, all of them one legitimate fourteen-card close
 *       (#10714). Disjoint from H7 by construction — a number already declared
 *       `Part of` is H7's row and is skipped here. Report-only, and
 *       deliberately not imported by the blocking gate that reuses H7's
 *       predicate: widening the class must not silently widen a check that
 *       fails builds.
 *   H22 a CLOSED card still carrying a `pm:*` STATE label — the one item here
 *       that reads closed issues, and the reason it has to (#10688). H8's
 *       subject is a write that has not happened yet, but the card is usually
 *       closed by the same merge that discharges the PR, so whether H8 ever
 *       fired was decided by a race it normally loses: once the card closes,
 *       no run looks at it again and the duty is discharged by disappearance.
 *       Measured at filing: 129 of the 500 most recently updated closed cards
 *       carried a live `pm:` label, 118 of them `pm:dispatched`. Direction A of
 *       that card — ONE bounded closed reader, every other collector still
 *       open-only, so the race closes without widening the sweep. The window is
 *       the stated boundary and it is load-bearing here: a 2026-08-22 re-measure
 *       paged past 500 closed `pm:dispatched` carriers repo-wide, so an
 *       unbounded read would bury every other item under one-time historical
 *       residue. Recent residue is a live duty; the deep tail is a backfill
 *       question. Report-only like the rest — the remedy is a label write a
 *       seat performs, never one this script performs.
 *   H23 a SQUASH COMMIT MESSAGE on the default branch carrying `Part of #N`
 *       and a closing keyword bound to that same `#N` — H7's contradiction on
 *       the SECOND surface GitHub closes cards from, and the only item here
 *       that reads commits (#10942). Every closing-keyword reader this repo
 *       owns takes a PR body: H7 and H21 above, and the blocking gate
 *       `scripts/check-partof-closing-keyword.mjs`. GitHub's parser also acts
 *       on commit messages that land on the default branch, and this repo
 *       squash-merges, so every merged PR writes exactly one such message that
 *       nothing read. ⭐ The message is COMPOSED AT MERGE TIME from the
 *       branch's own commit messages, not from the PR body — so the
 *       contradiction can exist on `main` while every body was clean, and a
 *       body-side guard is not merely looking in the wrong place, it is
 *       looking at a text that never contained it (measured on PR #9478: body
 *       clean under H7 and under the gate, squash message carrying both).
 *       Measured 2026-08-22 over all 1,546 first-parent messages in the pinned
 *       window 2026-08-11T00:00Z…08-22T18:00Z: 270 bindings across 234
 *       messages, 6 carrying the contradiction, all 6 multi-commit branches
 *       whose squash concatenated a `Part of` trailer and a closing trailer.
 *       ⛔ The extractors run at `markdown: false` here and MUST: a commit
 *       message is not markdown, so backticks do not neutralise a keyword, and
 *       the finding sentence therefore prescribes REWORDING and never H7's
 *       backtick remedy — an author who has internalised the body remedy is
 *       exactly who will misapply it here. H21's negation window is
 *       deliberately NOT ported: it flags 0 of the 270 on this surface, because commit messages carry no
 *       `## Out of scope` register. Report-only and measure-first by ruling
 *       (2026-08-22); a blocking posture for this surface is a later card on
 *       its own baseline.
 *
 * ## H24 + H25 — the queue/assignee contradiction, and the state that closes it
 *
 *   H24 an OPEN card carrying `pm:queue` with a NON-EMPTY assignee — the queue
 *       view reads it as dispatchable, the claim rule reads it as taken, and
 *       both readers are right about the field they read, so the card is
 *       available to everyone and forbidden to everyone at once. A pure
 *       intersection of two fields: no threshold, no timestamp, no identity
 *       test. Every adjacent row declines the shape for a reason of its own —
 *       H1 wants NO assignee, H2 wants a MISSING claim comment (the measured
 *       carriers have complete ones), H3 wants two LABELS while here the
 *       second half of the contradiction is a FIELD — which is how 17 cards
 *       across three repos (2026-08-23 census: 6 objectstack, 10 objectui, 1
 *       cloud) sat in it with nothing reporting them. The measured origin is a
 *       state ROLLBACK that swaps the label and leaves the field: of the three
 *       rollback paths, only dead-claim reclamation ever named the assignee
 *       drop, so H8's and H19's remedy sentences now name it too (「同笔摘
 *       assignee」). ⚠️ The field carries two meanings — dead agent claims and
 *       genuine human ownership — and the row deliberately does NOT try to tell
 *       them apart: the ruling of 2026-08-23 puts the rule FIRST and any
 *       true-ownership exemption in an explicit marker LATER, never the other
 *       way round. It names the login instead, and states the asymmetric
 *       remedy (an agent may clear agent residue; ⛔ never a human's).
 *   H25 `pm:awaiting-maintainer` coexisting with another pm STATE label — the
 *       exclusivity half of the new state ruled in on 2026-08-23 (「可以新标
 *       签,最好 pm: 开头」). The state exists because the board had no legal
 *       place for "everything mechanical is done, a human must now act":
 *       `needs-user-decision` is the ruling inbox (the ruling here is already
 *       given) and `pm:on-hold` requires a machine-fireable `Restart-when:`
 *       (H9), which this card can never have. Each forbidden pairing is a
 *       specific lie about which mechanism will release the card, and the row
 *       names the one it found. Written while the population is zero, which is
 *       the cheapest moment to pin a vocabulary. The label also joins H11's
 *       parked inventory, H13's state vocabulary and H22's residue set, so the
 *       new state is a first-class citizen of every reader rather than a hole
 *       four rows wide. ⛔ Deferred, declared rather than dropped: the SKILL.md
 *       state-model row (its protocol face) and applying the label to the
 *       specimen card, which is a seat's write.
 *
 * ## H26 — the block that nothing can ever release
 *
 *   H26 an open `pm:blocked` card whose resolvable `Blocked-by:` target is OPEN
 *       and parked in a state that can never close — `pm:on-hold` or
 *       `needs-user-decision`, both by definition states a card sits in WHILE
 *       OPEN. The unlock predicate is "the target closed", so such a block is
 *       structurally indefinite and nothing reported it: the waiting card is
 *       perfectly well-formed (H4 clean, target resolves, target open, so H19
 *       clean, label correct), and H9 — the nearest neighbour — audits the HELD
 *       card rather than the waiting one. Six measured instances, all found by
 *       a human reading: two cloud cards on one hold parked since July, a third
 *       on another, and objectos's ENTIRE blocked inventory (2 of 2) waiting on
 *       its single unanswered decision card, which is also the only item in the
 *       fleet's decision inbox — one ruling clears that repo. A second leg on
 *       the same data flags a target that is itself `pm:blocked` (the wait is
 *       transitive: the measured chain was real one hop up and false two hops
 *       up, its target being an H19 finding on the same sweep) — it names the
 *       hop rather than chasing it, which would cost a request per hop and can
 *       cycle. FREE: H19 already resolves every distinct target, and a resolved
 *       target's labels rode in on a payload this sweep had already paid for.
 *       ⛔ Not a judgement that the block is wrong — waiting on a deferred card
 *       is sometimes right; the row says the wait has no releasing mechanism,
 *       which is a fact a human should be handed rather than discover.
 *       Deliberately NOT reported: a target labelled `pm:queue` while titled
 *       `[Decision]` (one of the six). That is a mislabelling, not a fact in
 *       the labels, and a title heuristic would make this sweeper guess at
 *       intent.
 *
 * ## H27 — the claim is perfect and the claimant is dead
 *
 *   H27 an open `pm:dispatched` card whose claim is TEXTBOOK-CORRECT — assignee
 *       set, a first-line `Claim:` comment, a named branch that EXISTS on the
 *       remote — where that branch has not moved since the claim, no PR
 *       delivers the card, and the claim is older than the protocol's own
 *       ~24h stale line (`DEAD_CLAIM_STALE_HOURS`). This is the shape a dev
 *       agent that DIED leaves behind, and the measured cause arrives in
 *       batches: one shared-account capacity limit killed three concurrently
 *       dispatched agents at 05:50Z, leaving three cards on which every
 *       predicate in this file passed. ⭐ Its danger is not that it goes
 *       unreported but that it reads as HEALTHY: the next PM's round-open
 *       mutual-exclusion read looks for the latest non-self `Claim:` on a
 *       lane's dispatched cards, so a dead claim is read as a live claim by
 *       another session and the lane stays off the card — the protocol's own
 *       mutual-exclusion mechanism converting a corpse into a lane-wide block.
 *       H20 is the near neighbour and misses it BY CONSTRUCTION rather than by
 *       oversight: `.claude/agents/os-dev.md` makes pushing the empty branch
 *       the FIRST action of the task (a write-route probe), so a
 *       protocol-compliant agent that dies still leaves a ref and lands
 *       outside H20's no-ref-at-all population. The better the dev follows the
 *       protocol, the more invisible its death — which is why the two rows are
 *       disjoint by construction (H20 fires only when NO branch resolves, H27
 *       only when one does) and why neither could be widened into the other.
 *       ⛔ The threshold is QUOTED, not measured: the fleet has 2 liveness
 *       samples and that is not a distribution, so the row mechanizes SKILL.md's
 *       existing 死认领回收 line (「认领 >~24h」) — the same 24h the seat-post
 *       patrol already calls 「与既有回收线同一条」, one number in the protocol
 *       with two readers. ⚠️ Reporting is not reclaiming, and the row says so:
 *       the protocol's reclaim rule applies to a branch that does NOT exist and
 *       states 「有带提交活分支的认领永不回收」, so this row prescribes the
 *       three-state recovery INSPECTION (remote / container disk / gone, found
 *       work handed on flagged UNVERIFIED — `references/dispatch-runbook.md`)
 *       and never an assignee drop. It deliberately under-reports the dev that
 *       pushed one commit and then died (its branch moved after the claim), for
 *       the same reason — that is precisely the card the protocol protects.
 *
 * ## H28 — the STALE BODY LINE that shadowed the live blocker
 *
 *   H28 an open `pm:blocked` card whose BODY names a `Blocked-by:` target that
 *       has CLOSED while a COMMENT names one that is still OPEN. The body is
 *       the canonical home for the line, so this is the re-park written half:
 *       a seat found the body's upstream closed, carded the real prerequisite,
 *       wrote the NEW blocker into a comment — and left the spent one in the
 *       body. Measured: one card sat in exactly this shape while its real
 *       blocker was open and `pm:dispatched`, and it was RELEASED to `pm:queue`
 *       on the strength of the stale line.
 *       ⚠️ The mechanism half is the gate that used to sit in front of the
 *       liveness read. `needsBlockedByComments` skips a card whose body already
 *       carries a line — correct for H4, which only asks whether the line
 *       EXISTS — but H19/H26 borrowed that gathering and so resolved ONLY the
 *       stale body target, found it closed, and published "the block has
 *       outlived its blocker": a FALSE unlock candidate, on three consecutive
 *       sweeps. The liveness read is therefore UNGATED now
 *       (`needsBlockerLivenessComments`), and H4's cheap question stays cheap.
 *       Ungating alone would only turn the false candidate into a PARTIAL one,
 *       so this row is its pair: it names the stale body line as the thing to
 *       fix and asks for the live blocker to be MIGRATED to the body, enforcing
 *       the canonical-home doctrine at the moment the wrong shape is written
 *       rather than trusting a seat to remember it mid-re-park.
 *       FREE: the same resolutions H19 and H26 already hold, asked a third
 *       question — which CHANNEL each target arrived in.
 *
 * ## The close mechanism, measured (#8293)
 *
 * A half-delivered card (#8131) was closed `completed` two seconds after its
 * PR (#8277) merged, although that PR's body opened with `Part of #8131` and
 * carried an explicit warning against auto-closing it. The card was filed on
 * the hypothesis that GitHub's *development-sidebar* link closes on merge
 * "regardless of the description's wording", the keyword path having been ruled
 * out by a scan for closing keywords.
 *
 * That hypothesis is REFUTED and the scan was wrong. The PR body's own warning
 * sentence read, verbatim: "…the PM should close #8131 deliberately once #8136
 * lands." GitHub's closing-keyword parser matches `close` + `#8131` and ignores
 * every bit of the surrounding prose — the modal "should", the negation in the
 * clause before it, the whole paragraph arguing the card must stay open. The
 * sentence written to PREVENT the auto-close is what performed it.
 *
 * Four live readings pin the parser's actual shape, and each is a fixture in
 * the self-test below:
 *
 *   1. keyword + `#N` in PROSE closes it — #8277's `close #8131`: closing link
 *      created, card closed on merge.
 *   2. the SAME body's `#8136`, one clause later behind the word "once" and no
 *      keyword, got NO closing link and survived the merge untouched (it was
 *      closed deliberately 3.5 h later). Same body, same merge, opposite
 *      outcomes — which no sidebar-link hypothesis can explain, and which is
 *      the measurement that refutes it.
 *   3. `Part of #N` alone does NOT close — #8261/#8103, the same round's other
 *      partial-delivery PR, which stayed open exactly as the protocol intends.
 *      The "non-uniformity" the card flagged as its lead is fully explained by
 *      the presence or absence of a keyword; nothing else differed.
 *   4. keyword + `#N` inside INLINE CODE does NOT close — measured live on open
 *      PR #8454, whose body says "the dispatch asked for `Fixes #8284`" inside
 *      backticks while #8284 carries no closing link at all. This is why the
 *      predicate strips markdown code before scanning: without that step it
 *      flags the exact shape a careful author writes when EXPLAINING that they
 *      deliberately did not use the keyword.
 *
 *   5. keyword + `#N` inside a FENCED BLOCK does not close either — and the
 *      closing link is created at PR-OPEN time, not at merge. Both were settled
 *      by one controlled reading on 2026-08-13 (#8476 step 1). A throwaway PR
 *      (#8523, empty commit, closed unmerged) carried three arms in ONE body at
 *      one moment: `Fixes #8520` inside a fenced block, `Fixes #8521` inside an
 *      inline span, and a plain-prose `Fixes #8522`. Read seconds after that PR
 *      opened, `closed_by_pull_requests` was EMPTY on #8520 and on #8521, and
 *      carried #8523 (state OPEN) on #8522. The prose arm is the positive
 *      control that makes the two nulls readable at all: without it, "no link
 *      on the fenced arm" cannot be told apart from "closing links only
 *      materialize on merge".
 *
 * So the strip rule is a false negative in neither direction, and the merge is
 * no part of the mechanism: the contradiction exists, and is fixable, from the
 * moment a PR opens. That is what lets the same predicate back a PR-scoped
 * BLOCKING gate (`scripts/check-partof-closing-keyword.mjs`, which imports
 * `h7PartOfWithClosingKeyword` from here) as well as this report-only sweep.
 * H7 stays in the sweep regardless — patrol coverage of PRs whose CI predates
 * that gate — and nothing about this file's report-only contract changes.
 *
 * Scope of the remedy that lands HERE: this is the report-only detector, not a
 * suppression. Suppressing at source means telling authors not to put a closing
 * keyword next to another card's number, which is protocol text living outside
 * `scripts/pm/**` — deliberately left to the card that owns that text.
 *
 * The body half of H5 (the 「当前 PM」 paragraph) is NOT machine-checked here:
 * seat-sticker bodies are prose with no pinned grammar, and a fuzzy parser
 * would report phantom desyncs — the #4690 shape in mirror image. The
 * title/assignee pair is the mechanical half; the sweep prints the sticker
 * URL so the patrol reads the body itself.
 *
 * ## Transport prerequisite — MEASURED per run, never assumed (#7412)
 *
 * Live mode talks to `api.github.com` over node's global `fetch`, and that needs
 * two things this repo's agent containers do NOT uniformly provide:
 *
 *   1. a route to `api.github.com` from NODE. Node's `fetch` (undici) ignores
 *      `HTTPS_PROXY`, so it does not share the path `curl`, `gh` and the
 *      `mcp__github__*` tools take. A container where `curl https://api.github.com`
 *      answers 200 can be one where this script reaches nothing, and the reverse
 *      also occurs. `curl` is therefore NOT a valid pre-flight for this script;
 *      the probe below is.
 *   2. either NO token, or a token that really is a GitHub credential.
 *      `GITHUB_TOKEN` / `GH_TOKEN` being SET does not make them GitHub tokens:
 *      in agent containers both are commonly the agent proxy's own 14-character
 *      `prox…` placeholder. Sending that as a Bearer earns a hard 401 — strictly
 *      WORSE than sending nothing, because the token fallback at `TOKEN` turns a
 *      container where anonymous access WOULD have worked into one where the
 *      sweep cannot start.
 *
 * The paragraph this replaces claimed "unauthenticated works at 60 req/h". That
 * is not a fact about this script's environment. Four container classes have
 * been measured and no two agree:
 *
 *   PM seat session (#7412 as filed) — proxy denies the host (curl 403 with and
 *       without the token), node fetch 401. GitHub access is MCP-only there, so
 *       live mode cannot run at all.
 *   Triage Routine (#7412 comment, 2026-08-11) — host reachable AND the injected
 *       `GITHUB_TOKEN` is a real credential (`/rate_limit` 200, 15000 core
 *       quota). Live mode runs fully.
 *   Cloud dev session (this change's own measurement, 2026-08-11) — node fetch
 *       reaches the host, but NEITHER identity can read the board: the token is
 *       the `prox…` placeholder (401 Bad credentials), and anonymous is 403
 *       `API rate limit exceeded for <ip>` because the 60 req/h anonymous quota
 *       is counted per EGRESS IP and was already spent by other containers
 *       behind the same NAT. Meanwhile `curl` answered 200 BOTH ways, because it
 *       honours HTTPS_PROXY and the proxy substitutes a real credential — the
 *       misleading pre-flight point 1 warns about, measured.
 *   Proxy-mediated cloud session (#9946, measured 2026-08-19) — the same
 *       container class as above, but with node routed THROUGH the agent proxy
 *       (`NODE_OPTIONS=--use-env-proxy`, which is what a seat is told to use for
 *       live GitHub reads from node). The proxy substitutes a real credential
 *       for the placeholder, so ACCOUNT-scoped endpoints answer as GitHub and
 *       the identity is genuine — while every REPO-scoped endpoint is refused by
 *       the proxy itself. Live mode cannot run, and the reading that used to say
 *       it could is the reason this probe now has a second stage.
 *
 * That fourth class is the one that broke the probe, and its mechanism is worth
 * stating exactly, because the obvious hypothesis is WRONG and was measured to
 * be wrong. `/rate_limit` there is not the proxy fabricating a quota: it carries
 * `server: github.com`, a real `x-github-request-id`, and a 15000-limit core
 * quota, and `GET /user` on the same transport returns the real login. GitHub
 * really did answer, and the credential really does authenticate. What the proxy
 * intercepts is the OTHER side — the repo-scoped reads:
 *
 *   GET /rate_limit                          -> 200, remaining 14979, server: github.com
 *   GET /user                                -> 200, the real login
 *   GET /repos/objectstack-ai/objectstack    -> 403, NO x-ratelimit-* headers,
 *                                               NO server: github.com, and a body
 *                                               from the proxy vendor, not GitHub
 *
 * So no amount of care applied to `/rate_limit` can classify this container: the
 * account-scoped observation is genuinely healthy, and is identical to the
 * Routine runner's. Only a REPO-scoped read separates them, which is why the
 * probe now takes one — and why `GET /user` would not have done: it is
 * account-scoped and answers 200 here. The discriminator is not "a real
 * endpoint", it is "the KIND of endpoint the sweep actually needs".
 *
 * Two things this fourth class deliberately does NOT do, both because the file
 * has already recorded the decision against them:
 *   - it does not pattern-match the proxy's refusal body. That body is a vendor
 *     string that can change under us, and this classifier stays narrow about
 *     what it will name (the `looksLikeStaleWorkspaceDist` posture below).
 *   - it does not read the 14-character `prox…` token shape as disqualifying.
 *     Token shape enriches wording and never gates a request — an unknown future
 *     prefix must still be SENT so GitHub gets to be the judge — and in this very
 *     class that placeholder IS swapped for a working credential, so the shape
 *     would have mispredicted the outcome in both directions.
 * What it matches instead is a pure structural contradiction, with no vendor
 * string and no shape test in it: the quota endpoint reports thousands of core
 * requests available, and a core request just got refused.
 *
 * The third class also produced the trap worth naming: `/rate_limit` is EXEMPT
 * from the limit it reports. With the quota spent it still answers 200 (carrying
 * `x-ratelimit-remaining: 0`) while every other endpoint answers 403 — so a
 * probe that reads only the status code cheerfully green-lights a sweep that
 * cannot make one request. The first draft of the probe below did exactly that.
 * `probeIsUsable` is that lesson, and the self-test pins it.
 *
 * So the script PROBES before it sweeps, in two stages, and the staging is the
 * whole cost story:
 *
 *   1. `GET /rate_limit` — costs no core quota, and is what separates the first
 *      three classes from each other (unreachable / bad credential / exhausted).
 *      Any verdict OTHER than `reachable` stops here, exactly as before.
 *   2. `GET /repos/{OWNER_REPO}` — fired ONLY when stage 1 came back
 *      `reachable`, i.e. only on the path that used to return a green. Costs
 *      one core request, accepted deliberately (#9946): a probe whose answer
 *      does not predict what the sweep can do is worth less than the request it
 *      saves, and the sweep it green-lights spends a request per label page
 *      anyway.
 *
 * Consequence worth being explicit about: the three FAILING classes cost exactly
 * what they cost before (one request, no core quota), and the healthy path costs
 * one core request more than it did. Nothing on a failing path got slower or
 * more expensive.
 *
 * A failed probe prints a classified PREREQUISITE NOT MET report naming
 * which of the two requirements is unmet and the one command that satisfies it —
 * never a sweep result. `--probe` runs that check alone, which is what a seat
 * should use to answer "can live mode run in THIS container?".
 *
 * The repo-scoped stage is an OPTIONAL observation on the pure classifier, not a
 * required one: `classifyTransportProbe` handed no `repo` reading classifies the
 * account-scoped evidence alone, exactly as it always did. That keeps the other
 * importer of this classifier (`scripts/pm/ci-failure.mjs`, which reads the
 * Actions API and gathers its own account-scoped observations) behaving
 * identically. The guarantee that THIS script never green-lights on stage 1
 * alone therefore lives in `probeTransport` / `needsRepoProbe`, which is where
 * the gathering policy belongs — and it is pinned in the self-test.
 *
 * Deliberately NOT decided here: whether these scripts should grow an MCP-backed
 * transport or a required-real-token doctrine. That depends on where
 * `scripts/pm/**` live modes are meant to execute, which is a maintainer call
 * (#7412 triage, explicitly out of scope). This change only stops the file from
 * lying about the transport it has. It does not drop, substitute or re-route the
 * token, so a container where the sweep worked before works identically after.
 *
 * REST only, never GraphQL (Operational notes 3: the loop's hot path stays on
 * the core quota).
 *
 * ## Exit codes
 *
 *   0  the sweep completed — 0 or 40 findings alike (report-only, see above).
 *   3  PREREQUISITE NOT MET — a classified transport failure. Nothing was swept,
 *      and the report says so instead of implying a clean board.
 *   2  the sweep could not run for a reason this file cannot classify. The
 *      pre-existing catch-all, kept so an unfamiliar failure stays loud (#4690).
 *
 * 2 and 3 are both non-zero, so any wrapper reading non-zero as failure behaves
 * exactly as before. The split exists so a patrol can tell "this container was
 * never able to run the live sweep" (3 — expected, go run it elsewhere) from
 * "something broke" (2 — investigate).
 */

import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { isEntrypoint } from '../invoked-as.mjs';

/**
 * The repo this file sweeps when nothing says otherwise. It is a FALLBACK for a
 * seat's terminal, never the answer on a runner — see `resolveSweepRepo`.
 */
export const DEFAULT_SWEEP_REPO = 'objectstack-ai/objectstack';

/** `owner/name`, GitHub's own character set for both halves. */
export const SWEEP_REPO_SHAPE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * WHICH repo this sweep reads — resolved, and the resolution is the whole
 * point of the parameterisation (#11217).
 *
 * ## The trap this closes, measured
 *
 * The patrol pair (this file + `.github/workflows/half-state-patrol.yml`) is
 * installed in objectstack only, so 37 of the fleet's 59 open `pm:blocked`
 * cards had never been machine-swept, and a hand-run of H19's predicate over
 * objectui's blocked inventory found SEVEN blocks whose blocker had already
 * closed — 58% of that repo's machine-readable blocks were false, some for a
 * week. The difference was never discipline: one repo has a caller and three
 * do not.
 *
 * The fix is adoption by COPY — a sibling repo takes both files verbatim, runs
 * them with its OWN `GITHUB_TOKEN` against its own board, and writes its own
 * anchor (the route ruled at grading: per-repo installs, zero new credentials,
 * ⛔ never a matrix with a cross-repo token). And a hardcoded default is
 * exactly what makes "verbatim" unsafe: a copy of this file in objectui, run
 * with no `PM_SWEEP_REPO`, would cheerfully sweep OBJECTSTACK and write the
 * findings into objectui's anchor — a full, green, entirely wrong report, whose
 * only symptom is card numbers that do not exist in the repo reading them.
 *
 * So the resolution order is:
 *
 *   1. `PM_SWEEP_REPO` — the explicit override, unchanged, and still first: a
 *      seat pointing this at another board is a deliberate act.
 *   2. `GITHUB_REPOSITORY` — what Actions sets on every runner, i.e. the repo
 *      the workflow is INSTALLED IN. This is the line that makes a verbatim
 *      copy correct by default, and it is why the default below can never be
 *      reached on a runner.
 *   3. `DEFAULT_SWEEP_REPO` — a seat's terminal, where neither is set.
 *
 * The objectstack leg is unchanged by construction: its runner sets
 * `GITHUB_REPOSITORY=objectstack-ai/objectstack`, which is the same string the
 * hardcoded default carried, so every request path is byte-identical. The
 * workflow ALSO passes `PM_SWEEP_REPO: ${{ github.repository }}` — belt and
 * braces, and it keeps the wiring visible where a reader of the workflow looks.
 *
 * A malformed value is REFUSED rather than silently replaced by the default:
 * substituting a different board for the one the caller named is how a report
 * about the wrong repo gets written, which is the disease above. The refusal
 * happens at the CLI so that importers of this module (`ci-failure.mjs` takes
 * the transport classifier) are unaffected by a variable they never read.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ repo: string, source: string, valid: boolean }}
 */
export function resolveSweepRepo(env = {}) {
  const candidates = [
    ['PM_SWEEP_REPO', env.PM_SWEEP_REPO],
    ['GITHUB_REPOSITORY', env.GITHUB_REPOSITORY],
  ];
  for (const [source, raw] of candidates) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    return { repo: value, source, valid: SWEEP_REPO_SHAPE.test(value) };
  }
  return { repo: DEFAULT_SWEEP_REPO, source: 'default', valid: true };
}

const SWEEP_REPO = resolveSweepRepo(process.env);
const OWNER_REPO = SWEEP_REPO.repo;
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Predicates — pure functions over the REST issue shape, so the self-test can
// drive them with fixtures and the live sweep stays a thin fetch loop.
// ---------------------------------------------------------------------------

export function labelNames(issue) {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

/**
 * The "awaiting a manual maintainer action" state (#11196 fix 5, maintainer
 * ruling 2026-08-23, verbatim: 「可以新标签,最好 pm: 开头」 — the spelling is
 * finalized here, in the implementing PR the ruling sent it to).
 *
 * It exists because the board had NO legal state for its shape, and the two
 * adjacent states are both wrong in a way that made a card oscillate between
 * them (the measured specimen, #7276: everything mechanical is done and the
 * remaining action is the maintainer clicking through a Routines UI):
 *
 *   `needs-user-decision`  is the DECISION inbox — a question awaiting an
 *                          answer. Here the decision is already made; what is
 *                          outstanding is an ACT, and parking it in the inbox
 *                          makes the inbox lie about how many rulings are owed.
 *   `pm:on-hold`           requires a machine-fireable `Restart-when:` line
 *                          (H9), and `Restart-when: manual — …` counts as
 *                          MISSING there by deliberate design. A hold is the
 *                          one state this card can never be well-formed in.
 *
 * ⛔ It is defined here, at the top of the predicates, and not beside the item
 * that introduced it: four separate readers key on it (H11's parked inventory,
 * H13's state vocabulary, H22's residue set, H25's exclusivity) and a module
 * constant they all import cannot drift the way four string literals would —
 * which is the failure family this whole file belongs to.
 *
 * Deliberately NOT decided here, and declared rather than dropped: the
 * SKILL.md state-model table row (its protocol face — who applies it, who
 * removes it, what a card in it owes) lands separately, and applying the label
 * to the specimen card is the seat's write, never this script's.
 */
export const AWAITING_MAINTAINER_LABEL = 'pm:awaiting-maintainer';

export function h1DispatchedNoAssignee(issue) {
  const labels = labelNames(issue);
  return labels.includes('pm:dispatched') && (issue.assignees ?? []).length === 0;
}

/**
 * The claim-comment marker, shared by the two items that read it — H2 ("is
 * there a claim at all") and H20 ("what does the current claim NAME"). One
 * constant rather than two copies on purpose: a marker that drifts between
 * readers produces the worst possible pair of answers, where one item calls a
 * card claimed and the other calls the same comment prose.
 *
 * The strictness either side of it is H2's, unchanged and deliberate (#7488):
 * an OPTIONAL leading blockquote `>` because SKILL.md step 4's own claim
 * template is a blockquote, and the line must BEGIN with the word so ordinary
 * prose containing "claim" is not a claim comment. No `g` flag — a shared
 * regex carrying `lastIndex` between callers is a state bug waiting for its
 * second reader.
 *
 * ## The separator is ONE character, and that is a maintainer ruling (2026-08-11)
 *
 * `.claude/skills/pm-dispatch/SKILL.md` records it verbatim: 「首行以字面
 * `Claim:` 开头是机器判据(维护者 2026-08-11 裁定;巡查谓词只认这一个拼写且保持
 * 严格,修法是全舰队向文档拼写收敛,⛔ 不放宽谓词)」. So a dash-written or
 * fullwidth-written claim is a MALFORMED claim, not an unrecognised dialect,
 * and the repair direction is the WRITE side. ⛔ Do not widen this class to
 * accept another separator — that is the one change the ruling closes. What
 * the patrol gained instead is visibility: `h34ClaimShapedNonCanonicalSeparator`
 * reports the near miss on its own row without redefining what a claim IS.
 *
 * ⚠️ The class was `[::]` until #12090 — U+003A written TWICE, not "ASCII or
 * fullwidth" as three separate readers (this file's own H33 note, the filing
 * card's body, and a grading comment) each assumed from its shape. U+FF1A has
 * never matched here, measured by codepoint and by a live probe over 172
 * dispatched cards (0 fullwidth claims). Collapsed to a single `:` so the code
 * stops implying an affordance it never honored; behaviour is byte-identical,
 * and the fullwidth spelling now surfaces on the H34 row like every other
 * non-canonical separator.
 */
export const CLAIM_COMMENT_MARKER = /^\s*>?\s*Claim(?:ed)?\s*:/mi;

export function h2AssigneeNoClaimComment(issue, commentBodies) {
  const labels = labelNames(issue);
  const pmTracked = labels.some((l) => l === 'pm:queue' || l === 'pm:dispatched');
  if (!pmTracked || (issue.assignees ?? []).length === 0) return false;
  return !commentBodies.some((b) => CLAIM_COMMENT_MARKER.test(b ?? ''));
}

export function h3QueueAndDispatched(issue) {
  const labels = labelNames(issue);
  return labels.includes('pm:queue') && labels.includes('pm:dispatched');
}

// ---------------------------------------------------------------------------
// The `Blocked-by:` COMMENT channel — read by H4 and by the H14 index alike.
//
// Since #10403 the comment channel is no longer `Blocked-by:`-only: H9's
// `Restart-when:` reads it too, through its own gated fallback in the sweep
// (see the H9 section for the incident that closed the asymmetry). The two
// directives share one anchor AND one channel contract now, so "H4 tolerates
// X" and "H4 reads comments" both generalise to H9 — the boundary notes below
// apply to either directive's comment read.
//
// ## Stated boundary: no read-closure cut-off, because REST carries none
//
// The seat-post protocol's read-closure rule is 「只读晚于正文最后编辑时间的
// 评论」 — comments NEWER than the body's last edit — on the stated ground that
// 「两个时刻都是平台盖章的硬读数,比对即得」. One of those two stamps is not
// available here. A comment's `created_at` is on every row, but an ISSUE's
// body-edit time is on no REST payload at all: the issues API carries
// `created_at`/`updated_at` only, body edit history lives behind GraphQL
// `userContentEdits`, and this file is REST-only by a standing operational
// note (the loop's hot path stays on the core quota). The issue timeline
// endpoint does not record body edits either.
//
// So the cut-off is NOT implemented, rather than implemented against a proxy.
// The one proxy in reach — `updated_at` — is worse than nothing: it bumps when
// a comment is POSTED, so "newer than the body's last edit" would be false for
// every comment ever written, and the fallback would read nothing while
// looking like it read. A check that cannot fail is the shape this file exists
// to catch, not to add.
//
// Reading the whole first page instead errs in ONE direction, and it is the
// safe one. Extra evidence can only ADD `Blocked-by:` edges: it can clear an
// H4 row (the duty really was discharged, in the other channel) and it can
// clear an H14 stale row (something really is waiting), which is the
// recalibration #9948 ruled for. What it cannot do is invent a card's silence.
// The residual cost is a genuinely OBSOLETE comment edge — a line written, then
// the body rewritten to drop the dependency — which needs the source card to
// still be open, still labelled, and still body-clean; in that state the source
// card is itself mis-stated, and surfacing its edge is not the worse error.
// The seat rule's own rationale (「评论无界增长」, a token tax) does not bite
// here either: the fetch is gated to a bounded candidate set and capped at one
// page, the same trade H2, H16 and H17 make.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DECORATED DIRECTIVE LINES — the shared anchor for `Blocked-by:` (H4, H14)
// and `Restart-when:` (H9). #10102, ruled option C on 2026-08-20.
//
// ## What the old anchors required, and the two harms that cost
//
// Both directives are machine-readable lines written by hand IN MARKDOWN, so
// authors code-format them: 「`Restart-when: …`」 is the natural spelling for a
// line whose whole purpose is that a machine greps it. The original anchors
// (`^\s*` for H9, `^[ \t]*` for H4/H14) accept only whitespace before the key,
// and a backtick is not whitespace — so a DECORATED directive read as an
// ABSENT one. Measured twice on 2026-08-20, once on each predicate, failing in
// OPPOSITE directions:
//
//   - #9591 — 「`Restart-when: the v18 major development cycle opens …`」 in
//     the body. H9 reported "no `Restart-when:` body line" against a legal,
//     maintainer-commissioned hold, and H9's own remedy text told the reading
//     seat to close it `not planned`. LOUD, and destructive if believed.
//   - #10063 — 「`Blocked-by: #9612`」 in the body. H4 reported the line absent
//     in both channels, and the unlock sweep — which greps that same literal —
//     could never have returned the card. SILENT and permanent: no row, no
//     alarm, no expiry. That half has no detection channel of its own, which
//     is why documenting the strictness (option B) was not enough.
//
// Nothing in either documented predicate ever required the line to start bare,
// and no self-test covered a decorated one: an untested gap, not deliberate
// strictness.
//
// ## What is tolerated
//
// In front of the key: indentation, ONE `-`/`*` list bullet, and any run of
// inline-code backticks or `**` bold markers. A `**` may also sit between the
// key word and its colon (`**Blocked-by**:`) or immediately after the colon
// (`**Blocked-by:**`), because that is what a bolded directive actually looks
// like; likewise a closing backtick when only the key was code-formatted
// (「`Blocked-by:` #123」). A trailing marker MATCHING one that opened the line
// is stripped off the captured value, so 「`Restart-when: closed acme/w#9`」
// yields the same value the bare line yields — the trailing backtick never
// reaches the `manual` test or the ref scan.
//
// ## What is deliberately NOT tolerated — the strictness that stays
//
//   - The KEY's spelling and case. The unlock scan greps the literal, so
//     `restart-when:` is a line the machinery cannot see and must still be
//     flagged. Decoration is about what SURROUNDS the directive; the directive
//     itself stays byte-stable. A decorated lowercase key is still a finding.
//   - A bullet needs its trailing space (`- Blocked-by:`, never
//     `-Blocked-by:`) — that space is what makes it a list bullet rather than
//     the first character of a word.
//   - The whole prefix stays anchored to the line start, so a mid-sentence
//     mention 「seats park the `Blocked-by: #1` line in comments」 is prose,
//     not a directive — the property the old anchors were really protecting.
//   - A line whose value is nothing but decoration (「`Restart-when:`」) still
//     counts as valueless. Stripping can empty a value, so the extractor drops
//     empties AFTER cleaning rather than trusting the match to be non-empty.
//
// The residual is the shape this relaxation cannot reach — a key the grep
// itself cannot see — and H9's finding text now names that possibility
// explicitly instead of prescribing a close.
// ---------------------------------------------------------------------------

/** Decoration markers tolerated around a directive: inline code and bold. */
const DIRECTIVE_MARKER = String.raw`(?:\`|\*\*)`;

/**
 * Everything a directive line may carry BEFORE its key, captured so the value
 * cleaner can tell which trailing marker would be a MATCHING one.
 *
 * `[ \t]*` rather than `\s*` at the head, for both predicates now: `\s`
 * matches newlines, so with a /g/m extractor a run of blank lines could let a
 * match begin on an earlier line than the one it reads. H9 used `^\s*` and H4
 * `^[ \t]*`; the strict one is right and loses no real match, since `^` under
 * /m already anchors at the directive's own line start.
 */
const DIRECTIVE_PREFIX = String.raw`[ \t]*(?:[-*][ \t]+)?((?:${DIRECTIVE_MARKER}[ \t]*)*)`;

/** The key itself, with the bold/code markers a decorated one may carry. */
const directiveKey = (key) => String.raw`${key}(?:\*\*)?:(?:${DIRECTIVE_MARKER})?`;

/**
 * Drop the trailing decoration that MATCHES what opened the line.
 *
 * "Matching" is load-bearing: a value that legitimately ends in a backtick
 * (「Blocked-by: #1 `see note`」) opened bare and keeps every byte, while a
 * line that opened with a backtick gives its closing one back. Looping covers
 * the nested form (「**`Blocked-by: #1`**」).
 */
function stripMatchingDecoration(value, opener) {
  let out = String(value).trim();
  for (;;) {
    if (opener.includes('`') && out.endsWith('`')) {
      out = out.slice(0, -1).trim();
      continue;
    }
    if (opener.includes('**') && out.endsWith('**')) {
      out = out.slice(0, -2).trim();
      continue;
    }
    break;
  }
  return out;
}

/**
 * Every value carried by a `<key>:` directive line in this text, decoration
 * removed, empties dropped — the one reader H9 and the `Blocked-by:` index
 * share, so a decoration tolerated for one is tolerated for both.
 *
 * Exported for the self-test: the cleaning step has no other observable
 * surface (H9 reports a sentence, the index reports refs), and a value that
 * silently kept its trailing backtick is exactly the regression this shares a
 * cause with.
 *
 * @param {string} text
 * @param {'Blocked-by'|'Restart-when'} key
 * @returns {string[]}
 */
export function directiveValues(text, key) {
  const re = new RegExp(`^${DIRECTIVE_PREFIX}${directiveKey(key)}[ \\t]*(\\S.*)$`, 'gm');
  const out = [];
  for (const m of String(text ?? '').matchAll(re)) {
    const value = stripMatchingDecoration(m[2], m[1]);
    if (value) out.push(value);
  }
  return out;
}

/**
 * Is there a machine-readable `Blocked-by:` line in this text?
 *
 * H4's presence test — the BODY channel and the COMMENT channel ask the same
 * question of the same shape, rather than two subtly different ones.
 *
 * A presence test, deliberately, and NOT `blockedByTargets(...).length > 0`:
 * the two readers of this line answer different questions and must keep
 * doing so. H4 asks 「did the author leave the machine anything at all」 —
 * `Blocked-by: TBD` and `Blocked-by: objectstack-ai/objectui#4356` both
 * discharge the duty — while the index asks 「which LOCAL open card does this
 * wait on」 and correctly extracts nothing from either. Collapsing them would
 * make H4 fire on a card whose cross-repo blocker is stated perfectly well.
 *
 * It is also not `directiveValues(...).length > 0`, for one preserved
 * behaviour: the `\s*` after the key spans newlines, so a value written on the
 * FOLLOWING line has always cleared H4, and tightening that here would fire
 * new rows on live cards for a reason this card never ruled on. What the
 * decoration work adds is the leading prefix, a closing marker, and the
 * requirement that SOMETHING which is not itself decoration follows — without
 * that last clause 「`Blocked-by:`」 would read as a line whose value is its
 * own closing backtick, turning a valueless line into a false clear.
 */
const BLOCKED_BY_PRESENT = new RegExp(
  `^${DIRECTIVE_PREFIX}${directiveKey('Blocked-by')}\\s*(?:[\`*]+[ \\t]*)?[^\\s\`*]`,
  'm',
);

export function hasBlockedByLine(text) {
  return BLOCKED_BY_PRESENT.test(text ?? '');
}

/**
 * Which cards are worth a `Blocked-by:` comment fetch.
 *
 * Exported for the same reason `h17NeedsComments` and `h16NeedsDetail` are: a
 * policy that decides what gets READ AT ALL is where a silent hole would live,
 * so it is pinned by the self-test rather than buried in the sweep loop.
 *
 * Gated on a CLEAN BODY first, then on state:
 *
 *   - `pm:blocked` — the population H4 judges, and the edge SOURCES the index
 *     is missing (a seat parks the line in a comment; the body stays clean).
 *   - `pm:blocking` — the population H14's stale direction judges. Their own
 *     comments matter as index sources too: a `pm:blocking` card that is
 *     itself waiting on another `pm:blocking` card contributes the very edge
 *     that defends that other card from a stale verdict.
 *
 * A card whose body already carries the line is never fetched: its duty is
 * discharged in the channel the machinery already reads, and the census bound
 * this gate exists to honour (~2/3 of blocked cards are body-clean) is exactly
 * the complement.
 */
export function needsBlockedByComments(issue) {
  if (hasBlockedByLine(issue?.body)) return false;
  const labels = labelNames(issue ?? {});
  return labels.includes('pm:blocked') || labels.includes('pm:blocking');
}

/**
 * Every `Blocked-by:` ref carried by a card's comments, in order.
 *
 * The comment channel read the way the INDEX reads it — `blockedByTargets`
 * per comment body, this file's one parser for the line, so cross-repo and
 * self-reference filtering downstream behave identically whichever channel a
 * ref arrived in.
 */
export function commentBlockedByTargets(commentBodies) {
  const out = [];
  for (const body of commentBodies ?? []) out.push(...blockedByTargets(body));
  return out;
}

/**
 * H4 — null when clean, else the finding sentence.
 *
 * ## Two channels, one duty (#8941 / #10061)
 *
 * The label's machine half is a `Blocked-by:` line, and the reason it must
 * exist is the unlock sweep: without one, nothing can ever return the card.
 * But seats deliberately park that line in a COMMENT rather than the body —
 * the MCP body-escaping hazard (#8813) makes a body rewrite the riskier
 * write — and 26 of 40 blocked cards measured on 2026-08-19 were body-clean
 * for exactly that reason. Reading the body alone reported every one of them
 * as a card that had left the machine nothing, which is false: the duty was
 * met, in the other channel. So a comment carrying the line CLEARS H4, and the
 * finding sentence names both channels so a reader can tell which one to fix.
 *
 * ## Three input states, never two (#4690)
 *
 * `commentBodies` distinguishes them deliberately:
 *
 *   - `undefined` — the channel was not consulted (a caller reading bodies
 *     only). The sentence claims nothing about comments, and this is exactly
 *     the pre-#10061 reading, preserved rather than silently upgraded.
 *   - `null` — consulted and UNREADABLE. The row still FIRES, because going
 *     quiet here would make a transport failure shrink the patrol below where
 *     it stood before the fallback existed; the sentence says the second
 *     channel could not be read instead of asserting that it is empty.
 *   - `string[]` — read. Both channels judged, for real.
 *
 * The unreadable case fires where H14's stale direction goes QUIET on the same
 * failure, and the asymmetry is deliberate, not an inconsistency. H4's remedy
 * is "add a line" — idempotent, cheap, and harmless if a comment already had
 * one. H14-stale's remedy is "drop a label the selection order depends on" —
 * destructive, and the measured false positive this whole fallback exists to
 * end. An unreadable reading must surface on the cheap side and must never
 * drive the expensive one.
 */
export function h4BlockedNoBlockedBy(issue, commentBodies) {
  if (!labelNames(issue).includes('pm:blocked')) return null;
  if (hasBlockedByLine(issue.body)) return null;
  const remedy =
    ' The unlock sweep greps this literal line, so without it in SOME channel nothing can ' +
    'ever return this card to the queue — the block outlives its blocker in silence.';
  if (commentBodies === undefined) {
    return '`pm:blocked` without a `Blocked-by:` body line.' + remedy;
  }
  if (commentBodies === null) {
    return (
      '`pm:blocked` without a `Blocked-by:` body line, and this card\'s comment thread could ' +
      'NOT be read this sweep — so the second channel (a `Blocked-by:` line parked in a comment, ' +
      'which is how most blocked cards on this board state it) is unjudged, not empty. Read the ' +
      'thread by hand before acting: an unreadable channel is not an absent one (#4690).' + remedy
    );
  }
  if (commentBodies.some((body) => hasBlockedByLine(body))) return null;
  return (
    '`pm:blocked` with a `Blocked-by:` line in NEITHER channel — not in the body, and not in any ' +
    'comment on the thread (both were read). Either channel discharges the duty: seats park the ' +
    'line in a comment on purpose, because rewriting a body through the MCP escaping hazard ' +
    '(#8813) is the riskier write. So this is not a formatting nit — no machine reader anywhere ' +
    'knows what this card is waiting for.' + remedy
  );
}

// H5 returns null (in sync), a string naming the desync, or undefined when the
// title doesn't parse as a seat sticker (reported as its own finding — an
// unparseable status board row is a desync of the board itself).
export function h5SeatStickerDesync(issue) {
  const m = /^\[PM seat\]\s*(.*?)\s*—\s*(.*)$/u.exec(issue.title ?? '');
  if (!m) return 'title does not match 「[PM seat] <seat> — <status>」';
  const status = m[2].trim();
  const assignees = (issue.assignees ?? []).map((a) => a.login);
  if (status.startsWith('🟢')) {
    // The login is only the FIRST whitespace-delimited token after the emoji.
    // Everything past it — the `(session_…)` parenthetical every active seat
    // title carries by protocol, and any `·`-separated suffix (in-flight
    // counts, queue depth, a body-edit timestamp) — is display, not identity,
    // and must never be compared against the assignee list (#9926: this used
    // to take the WHOLE remainder as the holder, so a consistent seat post
    // like `🟢 os-warren (session_…)` mismatched `[os-warren]` on every
    // sweep).
    const holder = status.replace('🟢', '').trim().split(/\s+/u)[0] ?? '';
    if (holder === 'Routine') return null; // Routine seats keep assignee empty by design
    if (!assignees.includes(holder)) {
      return `title says 🟢 ${holder} but assignees are [${assignees.join(', ') || 'none'}]`;
    }
    return null;
  }
  if (status.startsWith('⏳')) {
    return assignees.length > 0
      ? `title says ⏳ vacant but assignees are [${assignees.join(', ')}]`
      : null;
  }
  if (status.startsWith('⏸️') || status.startsWith('⏸')) return null; // paused: assignee state is the maintainer's call
  return `unrecognized status word 「${status}」`;
}

// H6 — soft size bound on seat-sticker bodies (#7583). Report-only like every
// other item; the threshold is deliberately generous (the compacted #6019 body
// is ~4.5 KB, the pathological one was ~61 KB) so a healthy six-section body
// never trips it. Byte length, not code points: the read-limit failure this
// guards against is byte-sized.
export const SEAT_BODY_SOFT_LIMIT = 10_000;

export function h6SeatBodyOversized(issue, limit = SEAT_BODY_SOFT_LIMIT) {
  if (!labelNames(issue).includes('pm:seat')) return false;
  return Buffer.byteLength(issue.body ?? '', 'utf8') > limit;
}

// ---------------------------------------------------------------------------
// H7 — `Part of #N` contradicted by a closing keyword on the same PR body.
//
// Pure string predicates over a PR body, so the self-test drives them with the
// real specimens from #8293 rather than with invented ones.
// ---------------------------------------------------------------------------

/**
 * GitHub's closing keywords, exactly — `close`/`closes`/`closed`,
 * `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved`.
 *
 * The `\b` after each alternative is load-bearing in the direction of FEWER
 * findings: `closing` and `fixing` are NOT closing keywords, and both occur
 * constantly in exactly the prose this predicate reads ("merging this and
 * closing #8284 would drop the severe half" — open PR #8454, which must not be
 * flagged for that sentence). A fresh regex per call: a module-level `/g`
 * literal shared between `matchAll` calls is a `lastIndex` bug waiting to be
 * introduced by the next reader.
 *
 * The separator is HORIZONTAL whitespace only (plus GitHub's optional colon),
 * which is a deliberate narrowing in both directions. Allowing `\s*` lets the
 * keyword bind to a reference on a LATER line — and since `stripMarkdownCode`
 * blanks code lines rather than deleting them, a `close` before a fenced block
 * then spliced onto a `#N` after it, producing a finding for two tokens that
 * were never adjacent in the source. The self-test pins that splice. The cost
 * is a keyword separated from its reference by a line break, a shape none of
 * the measured specimens use.
 */
function closingKeywordRe() {
  return /\b(clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))\b[ \t]*:?[ \t]*#(\d+)\b/gi;
}

function partOfRe() {
  return /\bPart of\s+#(\d+)\b/gi;
}

/**
 * Blank out markdown code — fenced blocks and inline spans — so the scan sees
 * only the text GitHub's own reference parser acts on.
 *
 * MEASURED for inline spans (#8293, reading 4): open PR #8454 carries
 * "`Fixes #8284`" in backticks and #8284 has NO closing link, so GitHub does
 * not fire inside a code span. Skipping this step would make the predicate
 * report every author who correctly explains that they did NOT use the keyword
 * — turning the guard into noise on precisely the careful PRs.
 *
 * MEASURED for fenced blocks too, as of 2026-08-13 (#8476 step 1): a throwaway
 * PR (#8523) carried `Fixes #8520` inside a fence, `Fixes #8521` inside an
 * inline span and a plain-prose `Fixes #8522` in ONE body, and seconds after it
 * opened — unmerged — `closed_by_pull_requests` was empty on the fenced and
 * inline targets while the prose target already carried the link. The prose arm
 * is the positive control: it proves the link mechanism was live and readable
 * during the reading, so the two nulls mean "the parser does not fire here" and
 * not "links appear only on merge".
 *
 * That closes the one unknown this doc used to carry (the fence rule was
 * previously taken on the argument that PR bodies routinely quote whole other
 * bodies, templates and logs, and scanning those would bury real findings under
 * quoted text). Both spellings are now measured, so stripping is correct rather
 * than merely reasonable, and a blocking gate may rely on it.
 *
 * Lines are replaced by empty strings rather than deleted so that nothing is
 * spliced together across a stripped block into an accidental match.
 *
 * ## `{ inline: false }` — the same fence parser, opposite need (H17)
 *
 * H17 reads the INSIDE of inline spans: a hold comment names its trigger files
 * as backticked repo-relative paths, so blanking spans would delete the entire
 * signal. It still wants fenced blocks gone, and for the same reason H7 does —
 * a hold comment routinely quotes `git grep` output and file:line evidence
 * inside a fence, and those are citations, not triggers (measured on #8656,
 * whose fenced block lists three `packages/spec/src/**` paths that are prose
 * evidence for the card and name no trigger at all).
 *
 * So the option exists rather than a second fence parser: one fence-closing
 * rule, read two ways, and neither reader can drift from the other. The
 * default is unchanged, so every existing caller keeps byte-identical output.
 */
export function stripMarkdownCode(body, { inline = true } = {}) {
  const out = [];
  let fence = null;
  for (const line of String(body ?? '').split('\n')) {
    const m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      // A fence closes on a marker of the same character, at least as long.
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (m) {
      fence = m[1];
      out.push('');
      continue;
    }
    out.push(inline ? line.replace(/`+[^`\n]*`+/g, ' ') : line);
  }
  return out.join('\n');
}

/**
 * ## The `{ markdown: false }` half — the SURFACE the text came from (H23)
 *
 * Both extractors below take one option, and it selects a *surface* rather than
 * a strictness. `markdown: true` (the default, and every pre-existing caller)
 * means the text is a PR or issue BODY, where GitHub renders markdown before its
 * reference parser runs and a keyword inside a code span or fence therefore does
 * NOT fire — measured, twice, in `stripMarkdownCode`'s docblock.
 *
 * `markdown: false` means the text is a COMMIT MESSAGE. GitHub's closing-keyword
 * parser reads commit messages on the default branch too, and a commit message
 * is not markdown: there is no renderer in front of it, so backticks and fences
 * are ordinary characters and a keyword sitting inside them binds exactly like
 * one in plain prose. Stripping there would delete real bindings and hand the
 * author a remedy that does not work — H23's whole point, argued at length in
 * its section.
 *
 * ⛔ The asymmetry is not a tuning knob and must not be "unified" later: the two
 * surfaces genuinely differ in GitHub's own behavior, so a single reading is
 * wrong for one of them whichever way it is set. One extractor read two ways,
 * the same shape `stripMarkdownCode`'s own `{ inline }` option takes, so the two
 * surfaces can never drift onto two different grammars. The default is
 * unchanged, so every existing caller keeps byte-identical output.
 */

/** The `#N` a body declares itself only PART of. */
export function partOfTargets(body, { markdown = true } = {}) {
  const text = markdown ? stripMarkdownCode(body) : String(body ?? '');
  return new Set([...text.matchAll(partOfRe())].map((m) => m[1]));
}

/** `#N` -> the closing keyword bound to it (first occurrence wins, for the message). */
export function closingKeywordTargets(body, { markdown = true } = {}) {
  const found = new Map();
  const text = markdown ? stripMarkdownCode(body) : String(body ?? '');
  for (const m of text.matchAll(closingKeywordRe())) {
    if (!found.has(m[2])) found.set(m[2], m[1]);
  }
  return found;
}

/**
 * H7 — null when clean, else the finding sentence.
 *
 * Bound PER ISSUE NUMBER, never "body has `Part of` anywhere AND a keyword
 * anywhere": a PR that is `Part of #A` and legitimately `Fixes #B` is a normal,
 * correct shape and must stay clean. Open PR #8471 is the live specimen —
 * `Part of #8247` with a keyword bound to #8245 — and it is not a finding.
 */
export function h7PartOfWithClosingKeyword(pr) {
  const body = pr?.body ?? '';
  const declared = partOfTargets(body);
  if (declared.size === 0) return null;
  const closing = closingKeywordTargets(body);
  const clashes = [...declared].filter((n) => closing.has(n));
  if (clashes.length === 0) return null;
  return clashes
    .map(
      (n) =>
        `body says \`Part of #${n}\` but also carries \`${closing.get(n)} #${n}\` — ` +
        `GitHub's closing-keyword parser ignores the surrounding prose (negations and ` +
        `modals included), so merging this closes #${n}. Reword to "#${n} is not ` +
        `addressed here" / "out of scope: #${n}", or put the keyword in backticks.`,
    )
    .join('; ');
}

// ---------------------------------------------------------------------------
// H8 — delivering PR merged, card still `pm:dispatched` (#8683).
//
// Pure over the shapes the sweep already consumes (REST issue + `/pulls`
// rows), reusing H7's code-stripped extractors so the measured reference-
// parser behavior (#8293) carries over. No new API layer.
// ---------------------------------------------------------------------------

/**
 * The card number a protocol dev-branch NAMES — `claude/issue-<n>-<slug>` — as
 * a string, or null when the ref is not that shape.
 *
 * Anchored end to end, and deliberately a second READER of one shape rather
 * than a second shape: `CLAIM_BRANCH_SHAPE` is the same pattern spelled for
 * `matchAll` over prose, and the self-test pins the two against each other so a
 * future change to the branch convention cannot move one reader and leave the
 * other answering the old way. (It is not literally that constant because a
 * shared `g` regex carries `lastIndex` between callers — the warning on it.)
 */
export function branchNameTarget(ref) {
  const m = /^claude\/issue-(\d+)-[A-Za-z0-9][A-Za-z0-9._-]*$/.exec(String(ref ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Does this PR deliver card `n`? The one delivery relation H8 reads, shared by
 * its merged side and its open side so the two can never drift apart.
 *
 * Two channels, in a deliberate PRECEDENCE rather than a disjunction:
 *
 *  1. **The body** — `Part of #N`, or a closing keyword bound to `#N`, read
 *     through `stripMarkdownCode` (a body QUOTING either spelling in backticks
 *     does not deliver). Bound per issue number exactly like H7.
 *  2. **The branch name**, and ONLY when the body declares no delivery at all.
 *
 * ## Why the branch name is a FALLBACK and not a third `||` term
 *
 * Every dev branch here is `claude/issue-<n>-<slug>` by protocol, and every PR
 * row already carries `head.ref` — so a delivery whose body spells the relation
 * some third way (the measured specimen: a merged PR whose body said only
 * `Refs #10757`, leaving its card dispatched and invisible for ~22h while the
 * same sweep reported six other H8 rows correctly) is recoverable at no API
 * cost. That is the widening this channel exists for.
 *
 * But widening the delivery relation has a cost the fix must pay, and reading
 * the branch as merely one more disjunct does not pay it: a branch cut for card
 * N and then RE-SCOPED — the body now delivering a different card — would be
 * counted as delivering N forever, on the authority of a name nobody updated.
 * The body is the channel an author actually maintains; the branch name is
 * fixed at `git worktree add` time and is evidence only when nothing better
 * exists. So a body that declares ANY delivery is authoritative, and the branch
 * name is consulted only for the bodies that declare none — which is exactly
 * the population the specimen came from, and no other.
 */
export function prDeliversCard(pr, n) {
  const target = String(n);
  const body = pr?.body ?? '';
  const partOf = partOfTargets(body);
  const closing = closingKeywordTargets(body);
  if (partOf.has(target) || closing.has(target)) return true;
  // The body spoke — about some OTHER card. A stale branch name does not
  // overrule it (the re-scope case above).
  if (partOf.size > 0 || closing.size > 0) return false;
  return branchNameTarget(pr?.head?.ref) === target;
}

/**
 * H8 — null when clean, else the finding sentence.
 *
 * Delivery is `prDeliversCard` (body first, branch name as the fallback its
 * docblock justifies). Only `merged_at`-set PRs count on the merged side —
 * closed-unmerged is an abandoned attempt, not a delivery.
 *
 * ## The open side, and why this row DOWNGRADES rather than falls silent
 *
 * `openPrs` is the open-PR list the sweep already holds (its summary line
 * reports it), so consulting it costs no request. Without it H8 could not ask
 * the question that decides the answer — *is there ALSO an unmerged PR
 * delivering this card?* — and on a card delivered in halves it fired on every
 * sweep from the first half's merge until the last half landed, pointing at the
 * card whose remaining work was most active and prescribing a DESTRUCTIVE write
 * against it: "drop `pm:dispatched`". A reader who followed that row de-labelled
 * a card with an open PR, which then read as un-dispatched and was liable to be
 * re-dispatched — two agents on one card, the exact outcome the claim protocol
 * exists to prevent (#10468, measured on #9834 + open PR #10226).
 *
 * Silence would fix the harm and buy a new one, and the card's caveat says so:
 * it loses the genuine #8683 case where the last half is later ABANDONED — the
 * merged half really is delivered, the card really is stale, and nothing would
 * ever say so again. So the half-delivered case gets its own quieter sentence
 * instead: it names both sides, states the counts, and — the whole point —
 * says `pm:dispatched` is CORRECT here and must not be dropped. The destructive
 * prescription fires only when every delivering PR has merged.
 *
 * Drafts are deliberately NOT filtered out of the open side: the measured
 * specimen (#10226) was `draft: true`, and a draft delivering half is exactly
 * the live work this row must not step on.
 */
export function h8MergedPrStillDispatched(issue, mergedPrs, openPrs) {
  if (!labelNames(issue).includes('pm:dispatched')) return null;
  const n = String(issue.number);
  const delivering = [];
  for (const pr of mergedPrs ?? []) {
    if (!pr?.merged_at) continue;
    if (prDeliversCard(pr, n)) delivering.push(pr);
  }
  if (delivering.length === 0) return null;
  const list = delivering
    .map((p) => `#${p.number} (merged ${String(p.merged_at).slice(0, 10)})`)
    .join(', ');

  const stillOpen = [];
  for (const pr of openPrs ?? []) {
    // A merged row appearing in the open list is not an outstanding half; the
    // merged side above already judged it.
    if (pr?.merged_at) continue;
    if (prDeliversCard(pr, n)) stillOpen.push(pr);
  }
  if (stillOpen.length > 0) {
    const openList = stillOpen
      .map((p) => `#${p.number}${p.draft ? ' (draft)' : ''}`)
      .join(', ');
    const total = delivering.length + stillOpen.length;
    return (
      `delivered IN PART — ${delivering.length} of ${total} delivering PR(s) merged ` +
      `(${list}), while ${openList} is still OPEN against this card. ` +
      `\`pm:dispatched\` is CORRECT here and must NOT be dropped: the card is not ` +
      `finished, and de-labelling it would read as un-dispatched work and invite a ` +
      `second seat onto it. No action — this row exists so an abandoned last half is ` +
      `still visible, not to prescribe one.`
    );
  }

  return (
    `delivering PR ${list} is MERGED but the card still carries \`pm:dispatched\` — ` +
    `the merge's paired write never landed. Drop \`pm:dispatched\` and re-grade the ` +
    `remainder (re-queue, close, or block the un-delivered half) in the same stroke, ` +
    `and 「同笔摘 assignee」 — the landing re-label owes the ASSIGNEE DROP too. A ` +
    `re-graded card that keeps the finished dev's assignee lands straight in H24's ` +
    `two-views contradiction (\`pm:queue\` + assigned = dispatchable to the queue view, ` +
    `taken to the claim rule), which is how 17 cards across three repos got stuck where ` +
    `nobody could legally move them (#11196). ⚠️ Agent identity only: a HUMAN assignment ` +
    `may be real ownership and is ⛔ never cleared by an agent.`
  );
}

// ---------------------------------------------------------------------------
// H9 — `pm:on-hold` without a machine-fireable `Restart-when:` line in EITHER
// channel.
//
// Same shape as H4 (the label's machine half is a written line): the same
// decorated-directive anchor, and — since #10403 — the same channel contract:
//
//   H4 / H14  `Blocked-by:`     body OR comment  (since PR #10075)
//   H9        `Restart-when:`   body OR comment  (since #10403)
//
// H9 was body-only on purpose while the unlock machinery was: a condition
// parked in a comment genuinely did not exist to a body-only grep, and this
// detector surfaced exactly that population rather than hiding it (#10102
// documented the asymmetry so a seat generalising from H4 would not get an H9
// row it could not explain). What retired the asymmetry is a measured cost on
// the machinery side: a machine-fireable exit (`Restart-when: closed #N`)
// parked in a COMMENT fired when its target closed, and nothing noticed for
// ~2 days, because no reader consulted that channel. Seats park directives in
// comments deliberately — the MCP body-escaping hazard (#8813) makes a body
// rewrite the riskier write, the same measurement that widened `Blocked-by:`
// (26 of 40 blocked cards body-clean, 2026-08-19). So scan and gauge moved
// TOGETHER (#10403's one-PR scope): the sweep reads hold comments for
// `Restart-when:` through the same gated-fallback pattern as `Blocked-by:`,
// and H9 counts a comment-channel line as a line. Widening H9 alone would
// have made the gauge claim coverage the machinery lacked — the split #10102
// existed to prevent, run in the opposite direction.
// ---------------------------------------------------------------------------

/**
 * Does this text carry a `Restart-when:` value some mechanism could fire?
 *
 * The one fireability test H9 and its comment-fetch gate share, so "the body
 * already answers this card" means the same thing in both places. `manual…`
 * counts as NOT fireable, deliberately — see H9's header note.
 */
export function hasFireableRestartWhen(text) {
  return directiveValues(text, 'Restart-when').some((v) => !/^manual\b/i.test(v));
}

/**
 * Which cards are worth a `Restart-when:` comment fetch — H9's gathering
 * policy, exported and pinned for the same reason `needsBlockedByComments`
 * is: a policy that decides what gets READ AT ALL is where a silent hole
 * would live. Gated on the body NOT already answering (a fireable body line
 * clears H9 without the network), then on the one label H9 judges.
 */
export function needsRestartWhenComments(issue) {
  if (hasFireableRestartWhen(issue?.body)) return false;
  return labelNames(issue ?? {}).includes('pm:on-hold');
}

/**
 * H9 — null when clean, else the finding sentence.
 *
 * Legal iff SOME `Restart-when:` line in EITHER channel carries a value that
 * is not `manual…`. The line may be decorated (see the shared directive
 * reader) in either channel; the KEY may not. The spelling is case-sensitive
 * and byte-stable like `Blocked-by:` (H4): the scan that fires these lines
 * greps the literal, so a lowercase variant is a line the machinery cannot
 * see and must be flagged, not tolerated.
 *
 * ## Three input states, never two (#4690) — the H4 contract, verbatim
 *
 *   - `undefined` — the comment channel was not consulted (a caller reading
 *     bodies only). The sentence claims nothing about comments.
 *   - `null` — consulted and UNREADABLE. The row still FIRES and says the
 *     second channel could not be read instead of asserting it is empty:
 *     H9's remedy is "add or repair a line" — cheap and idempotent — so the
 *     unreadable reading surfaces on the cheap side, exactly as H4 argues.
 *   - `string[]` — read. Both channels judged, for real.
 *
 * ## The remedy text is deliberately not "close it" (#10102)
 *
 * This row's old sentence offered "add the line, or apply the protocol's
 * default: … closed `not planned`" as co-equal branches. Read literally
 * against a FALSE row — #9591, whose legal `Restart-when:` was invisible only
 * because it was wrapped in backticks — that prescribes closing a
 * maintainer-commissioned card, and it reads as a legitimate cleanup while
 * doing it. Tolerating decoration removes the measured cause; it cannot remove
 * the class, because any future unparsed spelling produces the same "no line"
 * row. So the sentence now names the possibility it cannot rule out and orders
 * the remedies: verify, unwrap, add — and only then, for a card that really
 * has no fireable exit, close.
 */
export function h9OnHoldNoRestartWhen(issue, commentBodies) {
  if (!labelNames(issue).includes('pm:on-hold')) return null;
  if (hasFireableRestartWhen(issue.body)) return null;
  const commentsRead = Array.isArray(commentBodies);
  if (commentsRead && commentBodies.some((b) => hasFireableRestartWhen(b))) return null;
  const values = [
    ...directiveValues(issue.body, 'Restart-when'),
    ...(commentsRead ? commentBodies : []).flatMap((b) => directiveValues(b, 'Restart-when')),
  ];
  const shape =
    values.length > 0
      ? 'its only `Restart-when:` is `manual`, which no mechanism can fire'
      : commentsRead
        ? 'no `Restart-when:` line in EITHER channel — not in the body, and not in any comment ' +
          'on the thread (both were read)'
        : 'no `Restart-when:` body line this scan could read';
  const unreadable =
    commentBodies === null
      ? ' And this card\'s comment thread could NOT be read this sweep — the second channel (a ' +
        '`Restart-when:` line parked in a comment, which the unlock scan reads too) is unjudged, ' +
        'not empty. Read the thread by hand before acting: an unreadable channel is not an ' +
        'absent one (#4690).'
      : '';
  const unparsed =
    values.length === 0
      ? ` ⚠️ READ THE ${commentsRead ? 'BODY AND THE THREAD' : 'BODY'} BEFORE ACTING: a line ` +
        `that IS there but which this scan cannot parse looks exactly like an absent one. ` +
        `Decoration is tolerated (backticks, a \`-\`/\`*\` bullet, \`**\` bold), but a ` +
        `mis-spelled or lowercased key is not — the unlock scan greps the literal. If the line ` +
        `is there, unwrap or re-spell it; that is the whole fix, and no state change is due.`
      : '';
  return (
    `\`pm:on-hold\` with ${shape} — the hold state is legal only with a machine-fireable exit ` +
    `(\`Restart-when: closed <owner/repo>#N\`, or a one-line executable predicate).${unreadable}${unparsed} ` +
    `Add or repair the line first. Closing is the LAST resort and applies only to a card that ` +
    `genuinely has no fireable exit: such a card is closed \`not planned\` with reason + ` +
    `provenance in the closing comment (type:Bug holds re-route instead — see the state model's ` +
    `Bug branch). Channel: like \`Blocked-by:\` (H4/H14), a \`Restart-when:\` line counts from ` +
    `the body OR a comment — either channel discharges the duty, and the unlock scan reads both ` +
    `(#10403 closed the old body-only gap).`
  );
}

// ---------------------------------------------------------------------------
// H10 — stale unclaimed p0 (routing-gap backstop).
// ---------------------------------------------------------------------------

/**
 * H10 threshold — p0 protocol latency is measured in minutes-to-hours (queue
 * jump, dispatch past batch limits), so 24h of silence while unclaimed exceeds
 * any legal round latency severalfold while still tolerating weekend lulls;
 * the measured no-reader specimen sat ~36h and would have been caught a day
 * earlier.
 */
export const P0_UNCLAIMED_STALE_HOURS = 24;

/**
 * H10 — null when clean, else the finding sentence.
 *
 * Deliberately the bare conjunction the protocol names (p0 + open + unassigned
 * + stale): no carve-out for decision/blocked/hold states, because a p0 aging
 * in ANY box is exactly what the triage brief should be showing the maintainer
 * — the flag is report-only and p0 volume is tiny by construction.
 */
export function h10StaleUnclaimedP0(issue, nowMs = Date.now()) {
  if (!labelNames(issue).includes('priority:p0')) return null;
  if ((issue.assignees ?? []).length > 0) return null;
  const updated = Date.parse(issue.updated_at ?? '');
  const ageHours = Number.isFinite(updated) ? (nowMs - updated) / 3_600_000 : null;
  if (ageHours !== null && ageHours <= P0_UNCLAIMED_STALE_HOURS) return null;
  const reading =
    ageHours === null
      ? 'its `updated_at` is unreadable (an unreadable timestamp must not read as fresh)'
      : `no activity for ~${Math.round(ageHours)}h (threshold ${P0_UNCLAIMED_STALE_HOURS}h)`;
  return (
    `\`priority:p0\`, open and unassigned, with ${reading} — p0 is queue-jump priority, so a ` +
    `stale unclaimed one usually means no seat's declared scan scope covers the queue it sits ` +
    `in. Put it in the triage round brief / decision box and name its reader.`
  );
}

// ---------------------------------------------------------------------------
// H11 — the important-parked inventory (maintainer concern, 2026-08-16).
// ---------------------------------------------------------------------------

/**
 * H11 threshold — importance signals parked in `pm:blocked`/`pm:on-hold` are
 * exactly the cards the maintainer fears go unwatched; 7 days is one full
 * triage week — long enough that a legitimate short park has cleared, short
 * enough that a real defect cannot age a release cycle out of sight.
 */
export const IMPORTANT_PARKED_STALE_DAYS = 7;

/**
 * The states H11 counts as PARKED — every state in which an open card is
 * legitimately not being worked, so an importance signal can sit inside it
 * indefinitely without anyone's queue showing it.
 *
 * `pm:awaiting-maintainer` joined the set with the state itself (#11196 fix 5)
 * rather than being left for a later card, because the omission would have
 * re-created H11's own defect one state to the left: a `bug` card parked
 * awaiting a manual action is the exact inventory the maintainer named
 * (2026-08-16, 「我担心的优先的,重要的问题…被放进 blocked 或者 on-hold 没人理
 * 会」), and a new parked state invisible to the inventory row is a new place
 * for it to hide.
 */
export const PARKED_STATE_LABELS = ['pm:blocked', 'pm:on-hold', AWAITING_MAINTAINER_LABEL];

/**
 * H11 — null when clean, else the finding sentence.
 *
 * Importance is read from BOTH the native issue type (`Bug`, object or string
 * shape — REST serializes it as an object) and the label vocabulary
 * (`bug` / `security` / any `priority:*`), because the triage protocol only
 * types new cards and deliberately does not backfill the stock — a label-only
 * reading would hide exactly the older cards most at risk of being forgotten.
 * Age is `created_at` ("open longer than", per the card); an unreadable
 * timestamp flags rather than reading as fresh (#4690 direction, same as H10).
 */
export function h11ImportantParked(issue, nowMs = Date.now()) {
  const labels = labelNames(issue);
  const parked = labels.some((l) => PARKED_STATE_LABELS.includes(l));
  if (!parked) return null;
  const typeName = typeof issue.type === 'string' ? issue.type : issue.type?.name;
  const signals = [];
  if (typeName === 'Bug') signals.push('type:Bug');
  for (const l of labels) {
    if (l === 'bug' || l === 'security' || l.startsWith('priority:')) signals.push(l);
  }
  if (signals.length === 0) return null;
  const created = Date.parse(issue.created_at ?? '');
  const ageDays = Number.isFinite(created) ? (nowMs - created) / 86_400_000 : null;
  if (ageDays !== null && ageDays <= IMPORTANT_PARKED_STALE_DAYS) return null;
  const state = PARKED_STATE_LABELS.find((l) => labels.includes(l));
  const age =
    ageDays === null
      ? 'an unreadable `created_at` (which must not read as fresh)'
      : `open ~${Math.round(ageDays)}d`;
  // The exit a parked card owes is state-specific, so the remedy names the one
  // this card actually has: a hold/block is re-checked mechanically, while
  // `pm:awaiting-maintainer` has no machine exit BY CONSTRUCTION (that is why
  // it exists), and prescribing a `Restart-when:` re-check for it would send
  // the reader to look for a line the state is defined by not having.
  const exit =
    state === AWAITING_MAINTAINER_LABEL
      ? `This state has NO machine exit by construction — the release is the maintainer action the ` +
        `card names — so an important card in it ages out of sight unless a human is re-asked. ` +
        `Re-surface it to the maintainer in the triage round.`
      : `Re-check the card's \`Blocked-by:\` / \`Restart-when:\` liveness in the triage round.`;
  return (
    `important card parked: ${signals.join(' + ')} sitting in \`${state}\`, ${age} ` +
    `(threshold ${IMPORTANT_PARKED_STALE_DAYS}d) — the important-parked inventory exists so a bug ` +
    `or security card cannot age out of sight inside a parked state. ${exit}`
  );
}

// ---------------------------------------------------------------------------
// H12 — orphan landing: a reviewed-and-ready PR out of the queue, unhandled
// (queue-steward retirement, maintainer-ruled 2026-08-16).
// ---------------------------------------------------------------------------

/**
 * H12 threshold — the landing cycle whose absence this flags is measured in
 * minutes (flip → queue → merge ≈ 15–30 min per PR; a queue kick draws the
 * merge-queue-triage workflow's comment within minutes of the red run).
 * Every handling act — a re-queue, a triage or audit comment, a push, a
 * label — bumps the PR's `updated_at`, so hours of TOTAL silence on a ready
 * PR exceeds the whole cycle severalfold; 6h still tolerates a congested
 * queue day and the longest measured landing latencies.
 */
export const ORPHAN_LANDING_STALE_HOURS = 6;

/**
 * H12 — null when clean, else the finding sentence.
 *
 * "Reviewed" is read from `draft === false`: this protocol flips a dev PR
 * ready only at review ACCEPT (the ready → queue path), and parks everything
 * else — un-reviewed work, ADR-class human-merge deliverables, dependency-red
 * stashes — as DRAFTS, so ready = reviewed by construction and drafts are out
 * of scope however old. A row without a real `draft` field is out of scope
 * too: this predicate must not flag shapes it cannot read.
 *
 * `auto_merge` is read ONLY in the finding-reducing direction (armed = the
 * queue machinery holds the PR = someone is handling it). The platform notes
 * forbid that field as a landing VERDICT (timeline events are the authority);
 * here a stale field costs at most a missed report-only flag, never a wrong
 * landing decision. `changeset-release/*` heads are excluded by name: the
 * Version Packages PR is born ready by the release bot and is the
 * maintainer's alone to merge (Guardrails), so it would flag on every sweep
 * by design. An unreadable `updated_at` flags rather than reads as fresh
 * (#4690 direction, same as H10/H11).
 */
export function h12OrphanLanding(pr, nowMs = Date.now()) {
  if (!pr || pr.draft !== false || pr.merged_at) return null;
  if (pr.auto_merge) return null;
  if ((pr.head?.ref ?? '').startsWith('changeset-release/')) return null;
  const updated = Date.parse(pr.updated_at ?? '');
  const ageHours = Number.isFinite(updated) ? (nowMs - updated) / 3_600_000 : null;
  if (ageHours !== null && ageHours <= ORPHAN_LANDING_STALE_HOURS) return null;
  const reading =
    ageHours === null
      ? 'an unreadable `updated_at` (which must not read as fresh)'
      : `no activity for ~${Math.round(ageHours)}h (threshold ${ORPHAN_LANDING_STALE_HOURS}h)`;
  return (
    `ready (= reviewed, in this protocol) with auto-merge unarmed and ${reading} — an orphan ` +
    `landing: the PR left the merge queue (or never entered it) and no one is handling it. ` +
    `The owning lane PM's landing window should re-read the queue-triage comment and gate-job ` +
    `conclusions, then re-queue, fix, or park it as a draft with a stated reason.`
  );
}

// ---------------------------------------------------------------------------
// H13 — domain:* without any pm-state label, aged past one sweep cycle
// (maintainer-reported incident, 2026-08-19).
// ---------------------------------------------------------------------------

/**
 * The label vocabulary that counts as "a pm-state" for H13, mirroring the
 * triage sweep's disjunct ③: any of these makes the card visible to a named
 * reader (queue view, lane view, unlock scan, decision inbox, finding
 * grading round, epic index, seat registry), so their absence — with routing
 * already present — is the invisible half-annotated shape. `pm:blocking` is
 * deliberately NOT here: it is a derived priority cache, not a state, and a
 * card carrying only it is exactly as invisible to candidate queries.
 */
export const PM_STATE_LABELS = [
  'pm:queue',
  'pm:dispatched',
  'pm:blocked',
  'pm:on-hold',
  // A card awaiting a manual maintainer action HAS a state and a named reader
  // (the triage round re-surfaces it), so it is not the half-annotated shape
  // H13 reports. Omitting it here would make every card in the new state a
  // standing H13 finding two hours after it entered — a new label that fires a
  // false row on every carrier is worse than no label at all.
  AWAITING_MAINTAINER_LABEL,
  'pm:epic',
  'pm:seat',
  'needs-user-decision',
  'finding',
];

/**
 * Labels whose NORMAL shape is domain-without-pm-state, excluded by the
 * sweep's own protocol text (SKILL.md, Backlog sweep): flagging them would
 * report the protocol's design as a defect.
 */
export const H13_EXEMPT_LABELS = ['tracking', 'status:parked', 'qa-run'];

/**
 * H13 threshold — "one sweep cycle": the triage Routine fires HOURLY and its
 * disjunct ③ heals exactly this shape every round, so a card still in it
 * after 2h has survived at least one full healing round it should not have —
 * the alarm reads a failure of the healing loop, never routine intake
 * latency (a just-landed domain label sits here only for the sweep's own
 * ~2-minute settle window, two orders of magnitude under the threshold).
 * Age reads `updated_at`: it needs no timeline fetch, and every healing
 * write would bump it, so a stale `updated_at` in this shape means nothing
 * touched the card at all. The measured specimen sat ~26h; at 2h it would
 * have been flagged a day earlier.
 */
export const DOMAIN_HALF_STATE_STALE_HOURS = 2;

/**
 * The prefix H13 stamps on a self-declared-P0 row. Exported because a SECOND
 * reader now depends on it: the markdown renderer sorts loud rows to the top
 * of the anchor body (see `renderMarkdown`). A shared constant, not a string
 * literal in two files — the loudness and the thing that reads the loudness
 * must never be able to drift apart, which is the whole failure family this
 * script belongs to.
 */
export const P0_SUSPECT_MARKER = '🚨 P0-SUSPECT:';

/**
 * Whether the card's own title/body self-declares P0 / data-integrity — the
 * incident card carried its emergency-triage trigger in its body while the
 * seat that saw it "waited for triage" in session memory. Read through
 * `stripMarkdownCode` (H7 reading 4's careful-author protection carries
 * over: a body QUOTING `P0` in backticks is not a self-declaration).
 */
export function h13SelfDeclaredP0(issue) {
  const text = stripMarkdownCode(`${issue?.title ?? ''}\n${issue?.body ?? ''}`);
  return /\bp0\b/i.test(text) || /data[\s-]?integrity/i.test(text);
}

/**
 * H13 — null when clean, else the finding sentence (louder for a
 * self-declared P0/data-integrity card, whose mandated route is the
 * emergency-triage channel, not the next Routine fire). An unreadable
 * `updated_at` flags rather than reads as fresh (#4690 direction, same as
 * H10/H11/H12).
 */
export function h13DomainWithoutPmState(issue, nowMs = Date.now()) {
  const labels = labelNames(issue);
  if (!labels.some((l) => l.startsWith('domain:'))) return null;
  if (labels.some((l) => PM_STATE_LABELS.includes(l))) return null;
  if (labels.some((l) => H13_EXEMPT_LABELS.includes(l))) return null;
  const updated = Date.parse(issue.updated_at ?? '');
  const ageHours = Number.isFinite(updated) ? (nowMs - updated) / 3_600_000 : null;
  if (ageHours !== null && ageHours <= DOMAIN_HALF_STATE_STALE_HOURS) return null;
  const reading =
    ageHours === null
      ? 'an unreadable `updated_at` (which must not read as fresh)'
      : `~${Math.round(ageHours)}h without activity (threshold ${DOMAIN_HALF_STATE_STALE_HOURS}h)`;
  const base =
    `\`domain:*\` with no pm-state label and ${reading} — routing landed, the state machine ` +
    `never did, so the card is invisible to every seat's candidate query. A half-state older ` +
    `than one sweep cycle is a defect of the healing loop (triage sweep disjunct ③), not ` +
    `inventory: pair the domain label with its pm-state in one write, oldest first.`;
  if (!h13SelfDeclaredP0(issue)) return base;
  return (
    `${P0_SUSPECT_MARKER} the card's own title/body self-declares P0/data-integrity, and for that ` +
    `class the emergency-triage channel (immediate triage subagent) is the mandated move, ` +
    `never the hourly Routine. ${base}`
  );
}

// ---------------------------------------------------------------------------
// H14 + H15 — the `pm:blocking` cache and the order that consumes it
// (maintainer-approved 2026-08-19, verbatim: 「同意」).
//
// Both items read ONE structure, built once per sweep from bodies the unscoped
// pass already fetched: the `Blocked-by:` reverse index. Everything above is a
// predicate over a single card; these two are the first that need the whole
// open set, because incoherence is a relation between two cards and "oldest"
// is a relation among many. That is a shape difference, not a contract change
// — they stay pure functions over listings the caller supplies, so the
// self-test drives them offline exactly like H1–H13.
// ---------------------------------------------------------------------------

/**
 * The `Blocked-by:` line's refs, in the order written.
 *
 * ## Why this is the file's FIRST parser for a line H4 already reads
 *
 * H4 asks only "is there such a line", so its regex is a presence test and
 * extracts nothing; no other script in the repo parses these lines at all
 * (the unlock scan is a seat procedure over a grep, not code). So there is no
 * second parser to converge on here — this is the first, and H4 keeps its own
 * cheaper question rather than being rewritten around this one.
 *
 * ## Two decisions that change what gets reported
 *
 * 1. **Code context is NOT stripped from the TEXT**, unlike H7/H8/H13. Those
 *    predicates read PROSE and must protect the careful author who quotes a
 *    spelling in backticks. This one models a MACHINE READER: the state model
 *    calls the line 「机器可 grep 的反向索引」, and the unlock scan that
 *    consumes it greps the literal — so a fenced `Blocked-by:` line really
 *    does fire the live machinery, whatever the author meant. Skipping fenced
 *    regions here would report coherence against an index nothing uses; H4
 *    (the same line's other reader) does not skip them either.
 *
 *    What IS removed is the decoration wrapping the directive itself —
 *    「`Blocked-by: #9612`」 names a blocker (#10102, and see the shared
 *    reader above). That is the opposite move from H7/H8/H13's: they drop a
 *    line because it sits in code, this one reads a line whose code markers
 *    are the author formatting a directive. Both serve the same test — would
 *    the unlock sweep's grep act on this line — and its answer here is yes.
 * 2. **Only the LEADING ref run is taken.** Real lines carry trailing prose —
 *    「Blocked-by: #9689 (the relocation it needs is the same edit)」 — and
 *    prose can name a second card that is context, not a blocker. Scanning
 *    the whole value would manufacture a dependent for it, and the cost lands
 *    on a THIRD card (a phantom "missing cache" row against someone who did
 *    nothing wrong). So the scan walks refs and separators from the start of
 *    the value and stops at the first token that is neither.
 *
 * The key is matched case-sensitively and line-anchored, byte-stable like H4
 * and H9: a lowercase or mid-sentence spelling is a line the real scan cannot
 * see, and reading it here would report an index the machinery does not have.
 *
 * @param {string} body
 * @returns {{ repo: string|null, number: number }[]}
 */
export function blockedByTargets(body) {
  const out = [];
  // The shared decorated-directive reader: the value arrives trimmed and with
  // a matching trailing marker already removed, so the ref walk below sees
  // 「#9823」 whether the author wrote it bare, bulleted, bolded or in code.
  for (const value of directiveValues(body, 'Blocked-by')) {
    let rest = value;
    for (;;) {
      const ref = /^[\s,;+、]*(?:and[ \t]+)?([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)?#(\d+)/u.exec(rest);
      if (!ref) break;
      out.push({ repo: ref[1] ?? null, number: Number(ref[2]) });
      rest = rest.slice(ref[0].length);
    }
  }
  return out;
}

/**
 * target issue number -> the open issue numbers whose bodies declare it a
 * blocker, built from ONE listing (the unscoped open-issue pass).
 *
 * Cross-repo refs are dropped, and that is load-bearing rather than tidy:
 * 「Blocked-by: objectstack-ai/objectui#4356」 is a real line on this board, and
 * reading its number as a LOCAL target would invent a dependent for whatever
 * this repo's #4356 happens to be — a phantom finding against an unrelated
 * card. A ref qualified with this repo (either `owner/repo#N` or the bare
 * repo name) is kept; a bare `#N` is local by definition.
 *
 * Self-references are dropped too: a card cannot be its own unblocker, and
 * counting one would make it permanently `pm:blocking`-worthy on its own say-so.
 *
 * @param {{ number: number, body?: string }[]} issues — OPEN issues only. The
 *   index's whole meaning is "open cards that are waiting", so the caller's
 *   listing is what bounds it; a closed dependent must not hold a label alive.
 * ## Two channels, UNIONED — never a priority order (#10061)
 *
 * `options.comments` supplies, per source card number, the comment bodies the
 * sweep's gated fallback read. Refs found there are added to the refs found in
 * the body; neither channel wins, because both are real. A card whose body
 * says `Blocked-by: #A` and whose comment says `Blocked-by: #B` is waiting on
 * BOTH, and a priority order would silently drop one of two live dependencies
 * — the same class of loss as reading the body alone, just rarer.
 *
 * Dedup is per (target, source) as before, so a card naming one target in both
 * channels is listed once. Cross-repo and self-reference filtering is applied
 * to comment-borne refs identically: the ref is filtered by what it SAYS, and
 * the channel it arrived in changes nothing about that.
 *
 * A source card absent from the map contributes its body only — which is every
 * card the gate did not select, and is why the map is a bound on cost rather
 * than a change of meaning.
 *
 * @param {{ repo?: string, comments?: Map<number, string[]> }} [options] —
 *   `repo` is `owner/repo`, defaulting to the swept one.
 */
export function buildBlockingIndex(issues, options = {}) {
  const ownerRepo = options.repo ?? OWNER_REPO;
  const bareRepo = ownerRepo.split('/').pop();
  const comments = options.comments ?? null;
  const index = new Map();
  for (const issue of issues ?? []) {
    const refs = [
      ...blockedByTargets(issue.body),
      ...commentBlockedByTargets(comments?.get?.(issue.number)),
    ];
    for (const { repo, number } of refs) {
      if (repo !== null && repo !== ownerRepo && repo !== bareRepo) continue;
      if (number === issue.number) continue;
      const deps = index.get(number) ?? [];
      if (!deps.includes(issue.number)) deps.push(issue.number);
      index.set(number, deps);
    }
  }
  return index;
}

/**
 * How many dependent card numbers a missing-cache row names before it counts
 * the rest. The row exists to be ACTED on — a reader wants to see who is
 * waiting — but the markdown renderer writes into a body with a hard cap and
 * a fold, and an unbounded fan-out list is the one row that could push others
 * off the end. Five names the whole set for every fan-out measured on this
 * board (the largest was one) while bounding the pathological case.
 */
export const BLOCKING_DEPENDENT_LIST_CAP = 5;

/**
 * H14 — null when the cache agrees with the index, else the finding sentence.
 *
 * ## The two directions do NOT owe the index the same completeness (#10061)
 *
 * They make opposite claims, so an INCOMPLETE index endangers exactly one:
 *
 *   - STALE ("nothing targets it") is a claim about ABSENT evidence. Every
 *     edge the sweep failed to read is a card that might be pointing at this
 *     one, so an index with any unread source cannot support the claim at all.
 *     `options.indexComplete === false` therefore silences this direction —
 *     unreadable evidence is not absent evidence (#4690), and the remedy this
 *     row prescribes (drop a label the selection order ranks second only to
 *     `priority:p0`) is destructive enough that a guess is worse than silence.
 *     The summary line's `comment fallback read on X of Y` is what states the
 *     gap, exactly as H16's and H17's `read X of Y` do for theirs.
 *   - MISSING ("targeted, but the label never landed") is a claim about
 *     evidence IN HAND. Reading more sources can only ADD edges, never remove
 *     one, so an incomplete index cannot manufacture this row. It stays live
 *     regardless — going quiet there would trade a real finding for nothing.
 *
 * This is the recalibration #9948 ruled for on 2026-08-19 (「修量具而非追假
 * stale」): the measured false stales #9465 and #9968 were both cards whose
 * dependents state the wait in a COMMENT, and both are pinned in the self-test.
 *
 * ## STALE is also repo-local, and the row says so (#10139)
 *
 * `buildBlockingIndex` only ever scans THIS repo's open-issue listing, so
 * `indexComplete` measures whether the comment fallback read every candidate
 * — it says nothing about sibling repos. A dependent living in `objectui` or
 * `cloud` with a `Blocked-by:` line naming this card is invisible to the
 * index by construction, not by any read failure, so `indexComplete` cannot
 * gate it and never claims to. The STALE sentence therefore does not read as
 * exhaustive over "no dependent anywhere" — only "no dependent in this
 * repo" — and its remedy is conditional on a cross-repo check rather than an
 * instruction to drop the label outright: `Blocked-by:` edges are
 * protocol-legal across repos (contract-first splits use them routinely),
 * and #7917 / objectui#4356 is a live one this row would otherwise have
 * instructed a reader to sever.
 *
 * @param {object} issue — an OPEN issue.
 * @param {Map<number, number[]>} index — from `buildBlockingIndex`.
 * @param {{ indexComplete?: boolean }} [options] — `false` when any gated
 *   comment fetch failed, i.e. the index is known to be missing edges.
 */
export function h14BlockingCacheIncoherent(issue, index, options = {}) {
  const carries = labelNames(issue).includes('pm:blocking');
  const dependents = index?.get?.(issue.number) ?? [];
  const indexComplete = options.indexComplete ?? true;
  if (carries && dependents.length === 0) {
    if (!indexComplete) return null;
    return (
      '`pm:blocking` carried while no open card\'s `Blocked-by:` line — body OR comment — targets ' +
      'it, judged against the two-channel index — a stale derived cache, scoped to THIS REPO ONLY: ' +
      'no dependent found in this repo; cross-repo dependents are not swept, so this is not a claim ' +
      'of exhaustiveness over the population — `Blocked-by:` edges are legally cross-repo. The label ' +
      'is not a state a seat sets: the triage sweep derives it from the `Blocked-by:` reverse index, ' +
      'and the lane selection order ranks it second only to `priority:p0`. So a stale one is worse ' +
      'than an absent one — it boosts a card nothing depends on, with authority. Report-only: verify ' +
      'cross-repo dependents before the triage sweep\'s derivation pass drops the label (or the ' +
      'missing `Blocked-by:` line landing on the card that really is waiting), never a label written ' +
      'from this script.'
    );
  }
  if (!carries && dependents.length > 0) {
    const shown = dependents.slice(0, BLOCKING_DEPENDENT_LIST_CAP);
    const named = shown.map((n) => `#${n}`).join(', ');
    const more = dependents.length > shown.length ? ` +${dependents.length - shown.length} more` : '';
    return (
      `targeted by ${dependents.length} open card(s)' \`Blocked-by:\` line, body or comment ` +
      `(${named}${more}), but ` +
      'NOT carrying `pm:blocking` — a real unblocker the selection order cannot see. The label is ' +
      'the derived cache that makes a card outrank everything but `priority:p0`; without it this ' +
      'card competes on age alone while the cards waiting on it cannot start. Report-only: the ' +
      'remedy is the triage sweep\'s derivation pass applying the label, never a hand-applied one.'
    );
  }
  return null;
}

/**
 * H15 — the oldest open, UNASSIGNED `pm:blocking` card, or null.
 *
 * ## No threshold constant, deliberately
 *
 * Every other aged item here (H10/H11/H12/H13) answers "has this been
 * abandoned?", and a threshold is what turns silence into an alarm. This row
 * answers a different question — "is the lane taking blocking cards first?" —
 * and the honest answer is a NUMBER, every run, for the reader to judge. A
 * threshold would re-introduce exactly the judgement call the row exists to
 * hand over, and would go quiet on the days the board is worst behaved but
 * still under it. So: unconditional, one row, no constant. Nothing reddens
 * (nothing in this file ever does).
 *
 * ## The age is the CARD's, not the label's, and says so
 *
 * `created_at`, the same quantity the selection order's own within-rank
 * tie-break reads (同级按卡龄). The label's age would be the sharper number
 * and is not available: it lives in a per-card timeline fetch this sweep
 * deliberately never makes (the H2 comment fetch is the one exception, and it
 * is confined to candidates). Reporting card age and NAMING it as card age
 * beats reporting a number whose meaning the reader has to guess.
 *
 * An unreadable `created_at` sorts as maximally old rather than being skipped
 * — the #4690 direction the whole file keeps: a value that cannot be read must
 * surface, never quietly drop out of a "the oldest is…" claim.
 *
 * @param {object[]} issues — the open listing.
 * @returns {{ issue: object, message: string } | null}
 */
export function h15OldestUnclaimedBlocking(issues, nowMs = Date.now()) {
  const candidates = [];
  let blockingTotal = 0;
  for (const issue of issues ?? []) {
    if (!labelNames(issue).includes('pm:blocking')) continue;
    blockingTotal++;
    if ((issue.assignees ?? []).length > 0) continue;
    const created = Date.parse(issue.created_at ?? '');
    candidates.push({
      issue,
      ageHours: Number.isFinite(created) ? (nowMs - created) / 3_600_000 : null,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      (b.ageHours ?? Infinity) - (a.ageHours ?? Infinity) || a.issue.number - b.issue.number,
  );
  const [oldest] = candidates;
  const age =
    oldest.ageHours === null
      ? 'an unreadable `created_at` (sorted as maximally old — a timestamp that cannot be read must ' +
        'surface, never drop out of an "oldest is…" claim)'
      : `open ~${Math.round(oldest.ageHours)}h`;
  return {
    issue: oldest.issue,
    message:
      `oldest UNCLAIMED \`pm:blocking\` card: ${age}, ${candidates.length} of ${blockingTotal} open ` +
      '`pm:blocking` card(s) unassigned. The lane selection order puts `pm:blocking` second only to ' +
      '`priority:p0`, so an unclaimed one aging while fresher cards are picked is selection-order ' +
      'drift — visible here by name instead of only in a seat\'s memory. Age is the CARD\'s ' +
      '(`created_at`, the same quantity the order\'s within-rank tie-break reads), not the label\'s: ' +
      'that would need a per-card timeline fetch this sweep never makes. Visibility row — no ' +
      'threshold, it reports unconditionally, and like everything here it is patrol input, not a verdict.',
  };
}

// ---------------------------------------------------------------------------
// H16 — an open, non-draft PR stuck in a merge conflict (devx incident,
// maintainer-approved 2026-08-19: 「同意你的建议」).
//
// The first item whose input the sweep cannot get from a listing: everything
// above reads rows the label/PR/merged passes already fetched, while
// `mergeable_state` exists only on the single-PR endpoint. The gathering
// policy that keeps that affordable is `h16NeedsDetail`, below, and it is
// pinned in the self-test for the same reason `needsRepoProbe` is — a policy
// that decides what gets READ AT ALL is where a silent hole would live.
// ---------------------------------------------------------------------------

/**
 * H16 threshold — the window a normal conflict resolution gets before the
 * conflict counts as STUCK.
 *
 * ## Which timestamp this ages, and why (the honest part)
 *
 * A merge conflict has NO timestamp of its own. `mergeable_state` is a verdict
 * about the PR as it stands at the moment of the read; neither the PR row nor
 * any listing this sweep makes records WHEN the PR became `dirty`. So the age
 * read here is the PR's `updated_at` — the last time anything touched the PR —
 * used as a PROXY, on the reading the incident supports: a freshly-pushed
 * dirty PR is being worked (its author is mid-resolution), while a dirty PR
 * nothing has touched for hours is one nobody has noticed.
 *
 * The proxy's error direction, stated here rather than discovered later: a
 * conflict created MINUTES ago on a PR last touched hours ago flags at once,
 * because `updated_at` measures silence on the PR and not the age of the
 * conflict — and the usual cause (`main` advancing under an open PR) does not
 * touch the PR row at all, so it does not bump the clock. That over-reports in
 * exactly one shape and under-reports in none, which is the direction this
 * file keeps everywhere: a report-only row whose remedy is identical either
 * way (merge base, resolve) costs its reader one glance, while the opposite
 * bias is the silence the incident is made of.
 *
 * ⛔ It must not be "fixed" by dating the conflict from a per-PR timeline
 * fetch. That is an extra request per candidate to sharpen a report-only row,
 * and this sweep declines that trade everywhere else it arises — H15 declines
 * it by name for the age of a label. The proxy is named in the finding text so
 * the reader knows which quantity they are being shown.
 *
 * ## Why 2h
 *
 * Conflicts on this board are overwhelmingly created by `main` advancing under
 * an open PR (~18 merges on a working day), not by authors writing
 * incompatible code, so resolution is mechanical — merge `main`, fix the
 * overlap, push — and a lane PM's landing window turns over far faster than
 * that. 2h leaves a normal resolution a full window while catching the
 * measured incident (~4h unnoticed) at roughly half its life. It matches
 * `DOMAIN_HALF_STATE_STALE_HOURS` for the same underlying reason rather than
 * by coincidence: both measure a loop that should already have turned over,
 * not intake latency.
 */
export const MERGE_CONFLICT_STALE_HOURS = 2;

/**
 * The card(s) a stuck PR is holding up, so the row names the delivery and not
 * only the branch. Read with H7's code-stripped extractors, exactly as H8
 * reads delivery: `Fixes #N` (any closing keyword bound to `#N`) or
 * `Part of #N` — both mean "this card is waiting on this PR", which is the
 * question a reader of a stuck-conflict row is actually asking. A body that
 * merely QUOTES either spelling in backticks names nothing (#8293 reading 4).
 *
 * Returns numbers in ascending order; an empty array when the body declares no
 * card, which is a normal shape (not every PR carries one) and is why the
 * finding text appends the clause only when it is non-empty.
 */
export function h16HeldCards(body) {
  const out = new Set();
  for (const n of closingKeywordTargets(body).keys()) out.add(Number(n));
  for (const n of partOfTargets(body)) out.add(Number(n));
  return [...out].sort((a, b) => a - b);
}

/**
 * Whether this PR is worth spending a per-PR GET on — the gathering policy,
 * separate from the verdict and exported so the self-test can pin the one
 * property that matters: it must never be NARROWER than the predicate, or the
 * sweep would silently stop being able to find rows H16 would have flagged.
 *
 * It answers from the LIST row alone, using the halves of the predicate that
 * do not need `mergeable_state`: non-draft, not merged, and either aged past
 * the threshold or carrying a timestamp that cannot be read. So the request
 * count is bounded by the STUCK population rather than the open one — the same
 * candidate-gating idiom as H2's comment fetch, which is confined to the cards
 * H2 can actually judge.
 *
 * An unreadable `updated_at` is a candidate deliberately: the predicate treats
 * it as a finding rather than as fresh (#4690), so a gate that skipped it here
 * would drop exactly the row the predicate promises to surface.
 *
 * `changeset-release/*` is deliberately NOT excluded, unlike in H12. There the
 * Version Packages PR would flag on every sweep BY DESIGN (born ready, never
 * armed, the maintainer's alone to merge). A dirty one is nothing of the kind:
 * it is regenerated from `main` on every push, so it has no normal state in
 * which it sits conflicted for hours — if it ever does, that is a real finding
 * about the release bot, not a false positive to suppress.
 */
export function h16NeedsDetail(pr, nowMs = Date.now()) {
  if (!pr || pr.draft !== false || pr.merged_at) return false;
  const updated = Date.parse(pr.updated_at ?? '');
  if (!Number.isFinite(updated)) return true;
  return (nowMs - updated) / 3_600_000 > MERGE_CONFLICT_STALE_HOURS;
}

/**
 * Whether the H16 detail pass failed as a TRANSPORT rather than leaving a
 * bounded gap — the #4690 judgement at row granularity, pure so the self-test
 * pins it (the sweep loop that consumes it is a thin `for`, deliberately).
 *
 * The distinction it draws is the whole posture. "Some candidates unread" is a
 * gap the report states out loud (the summary line's `read X of Y`) and the
 * rest of the sweep is still worth printing — every other item's findings are
 * already gathered. "No candidate readable at all" is not a bounded gap: it is
 * a sweep whose H16 pass examined nothing while printing as though it had, and
 * a quiet H16 section is then indistinguishable from a board with no
 * conflicts. That one must surface as the prerequisite failure it is.
 *
 * Zero candidates is NOT a failure: a board where nothing was stale enough to
 * be worth a request is a real, clean reading, and treating it as a transport
 * fault would fail the sweep on the healthiest possible board.
 */
export function h16DetailPassUnreadable(candidates, probed) {
  return (candidates ?? 0) > 0 && (probed ?? 0) === 0;
}

/**
 * H16 — null when clean, else the finding sentence. Takes the SINGLE-PR
 * payload (the listing row carries no `mergeable_state`).
 *
 * ## The readings that are skips, not findings
 *
 * GitHub computes mergeability ASYNCHRONOUSLY. A read taken while that
 * background job is still running answers `unknown` (with `mergeable` null),
 * which is neither "clean" nor "dirty" — it is no reading at all. Only the
 * literal `dirty` fires: an unknown is skipped in SILENCE, never vouched for
 * and never guessed, which is this file's standing narrowness discipline (the
 * transport classifier's refusal to name what it cannot name, same posture).
 *
 * That is the one place H16 departs from the #4690 direction the aged items
 * take, and the asymmetry is deliberate rather than an inconsistency: an
 * unreadable `updated_at` is a value that SHOULD have been readable and whose
 * absence hides a real card, while `unknown` is the platform correctly saying
 * "ask again later" — firing on it would put a row on the anchor for every PR
 * whose mergeability happened to be cold at sweep time, which is noise that
 * would bury the real rows. The timestamp half keeps the #4690 direction
 * unchanged (an unreadable `updated_at` still flags).
 *
 * Drafts are out of scope (parked deliberately, H12's reading), and a row
 * without a real `draft` field is out of scope too — this predicate must not
 * flag a shape it cannot read.
 *
 * ## Why `auto_merge` is NOT read here, unlike H12
 *
 * H12 treats armed auto-merge as finding-REDUCING: the queue machinery holds
 * the PR, so someone is handling it. H16 must not, and that is the whole
 * incident — the measured specimen sat dirty with auto-merge ARMED, and the
 * arming is precisely what made every proxy signal read healthy while nothing
 * at all was happening. Auto-merge does not resolve conflicts: a PR armed
 * while dirty simply never lands. Here the armed state is evidence OF the
 * disease, never of a handler, and the self-test pins that in both directions.
 */
export function h16StuckMergeConflict(pr, nowMs = Date.now()) {
  if (!pr || pr.draft !== false || pr.merged_at) return null;
  if (pr.mergeable_state !== 'dirty') return null;
  const updated = Date.parse(pr.updated_at ?? '');
  const ageHours = Number.isFinite(updated) ? (nowMs - updated) / 3_600_000 : null;
  if (ageHours !== null && ageHours <= MERGE_CONFLICT_STALE_HOURS) return null;
  const reading =
    ageHours === null
      ? 'an unreadable `updated_at` (which must not read as fresh)'
      : `untouched for ~${Math.round(ageHours)}h (threshold ${MERGE_CONFLICT_STALE_HOURS}h)`;
  const held = h16HeldCards(pr.body);
  const holding =
    held.length === 0
      ? ''
      : `, holding ${held.length === 1 ? 'card' : 'cards'} ${held.map((n) => `#${n}`).join(', ')}`;
  return (
    `open, non-draft and in MERGE CONFLICT (\`mergeable_state: dirty\`), ${reading}${holding} — a ` +
    'conflict starts no CI run, raises no event and turns no check red, so every proxy signal ' +
    'keeps reading healthy (armed auto-merge included: it does NOT resolve conflicts, and a PR ' +
    'armed while dirty simply never lands). The owning lane PM merges `main` into the branch, ' +
    'resolves it, and re-arms afterwards. Age is the PR\'s `updated_at`, not the conflict\'s: a ' +
    'conflict carries no timestamp of its own, and base advancing does not touch the PR row.'
  );
}

// ---------------------------------------------------------------------------
// H17 — the on-hold TRIGGER-FILE INDEX. Not a predicate: an inventory.
//
// ## What it is for (#10034, measured 0-for-19)
//
// The opportunistic-restart mechanism is a maintainer-accepted design
// (2026-08-11): a hold comment names the FILES whose next edit should wake the
// card, and a dispatching seat is supposed to intersect its dispatch's file
// surface against those lists before dispatching. The audit that produced this
// item measured the intersection never running in any lane: across six cards
// the named trigger files were touched NINETEEN times and the rider was
// carried ZERO times. The mechanism existed in SKILL.md and in hold comments;
// no seat's loop executed it.
//
// The fix is not another written protocol step. It is to put the list where
// the seat is already looking: the patrol anchor, which the dispatch protocol
// now makes the first thing read each round. This section renders card → files
// so the intersection is a GLANCE at a rendered table rather than a
// remembered procedure over 79 hold comments nobody opens.
//
// ## Why it lives on the PATROL side and not in `dispatch-gates.mjs`
//
// The obvious shape — teach the dispatch gate to grep hold comments — cannot
// run where the dispatch gate runs. A seat container's live GitHub read is 403
// (the repo-scoped transport fact this whole file's prerequisite classifier
// exists to name), so an intersection built into `dispatch-gates.mjs` would be
// a second mechanism that never executes: exactly the disease, re-created one
// layer down. The patrol runs on a GitHub Actions runner where the transport
// prerequisite is met, so the gathering happens there and the seat reads the
// rendered result. Zero new runtime dependency on the seat side.
//
// ## REPORT-ONLY, and more strictly than the predicates above
//
// Every H1–H16 row is an assertion that something is WRONG. An H17 row asserts
// nothing of the kind: a hold naming trigger files is a hold in perfectly good
// standing. So this item writes no label, has no staleness threshold, and can
// never produce a finding — it is inventory, rendered next to the findings
// because that is the page the reader already opens. The only bound in it is a
// RENDER budget (`H17_INDEX_ROW_CAP`), which is the same class of constant as
// `MARKDOWN_BODY_BUDGET` and not a judgement about the board.
//
// ## The extraction is deterministic, and drops what it cannot verify
//
// ⛔ No fuzzy parsing, and no LLM in the loop. Two stages, both closed:
//
//   1. ANCHOR. A line qualifies only if it carries one of a closed set of
//      terms (`H17_TRIGGER_ANCHOR_TERMS`) or is a canonical `Restart-touch:`
//      line. Everything else in the comment is ignored, however path-shaped.
//   2. VALIDATE. Every candidate token is checked against `git ls-files`. A
//      token that is not a TRACKED FILE is DROPPED — never guessed at, never
//      normalised into something that would match. This is what makes the
//      index safe to render without review: a wrong row would send a seat to
//      intersect against a path that does not exist, and the intersection
//      would silently never hit.
//
// The census that produced the term set is in `H17_TRIGGER_ANCHOR_TERMS`.
// ---------------------------------------------------------------------------

/**
 * The closed set of anchor terms, matched case-insensitively as substrings of
 * a single line. Derived from a read of nine open/just-released `pm:on-hold`
 * cards (2026-08-19, #10034's measurement round) — seven of which carry a
 * trigger-file clause, and all seven of those are covered here:
 *
 *   `trigger file`  — #8897 (`**Trigger file: \`…\`**`), #8984
 *                     (`Restart condition (named trigger files)`), #9139
 *                     (`**Trigger files** (opportunistic-restart clause)`),
 *                     #8662 (`**Opportunistic trigger files**`), #8883
 *                     (`**Restart condition (trigger files):**`)
 *   `opportunistic` — #8656 (`3. **opportunistic:** any PR already editing …`),
 *                     #9139, #8662
 *   `restart condition` — #8331 (`Named restart conditions: ① …`), #8883,
 *                     #8984, #8662
 *
 * ⛔ `rider` is deliberately NOT in the set, though it is the mechanism's own
 * name. It is the word the AUDIT and RELEASE comments use ("the armed rider
 * fired three times without being carried — PRs #9869, #9990 and #10005 all
 * touched `.github/workflows/lint.yml`"), so admitting it would harvest the
 * post-mortem prose of holds that are no longer held, as though the file were
 * still a live trigger. Measured on #8331's release comment, which contains a
 * tracked path and names no trigger at all.
 *
 * The two cards in the sample with NO trigger clause (#9707, #9276 — both
 * `Restart-when: closed …#N` holds) match no term and correctly contribute no
 * row. That is the negative half of the census, and it is pinned in the
 * self-test.
 */
export const H17_TRIGGER_ANCHOR_TERMS = ['trigger file', 'opportunistic', 'restart condition'];

/**
 * The CANONICAL machine-readable channel this index also reads, proposed by
 * #10034 and not yet adopted anywhere on the board.
 *
 * Same discipline as `Blocked-by:` (H4) and `Restart-when:` (H9): a
 * case-sensitive literal at the start of a line, ONE path per line, so the
 * value needs no parsing at all. Today it matches ZERO live cards, and that is
 * the intended state — the mechanism precedes the convention deliberately, so
 * that the day a hold is written with `Restart-touch:` lines the index already
 * reads them and no second change is owed. The prose-anchor extraction above
 * is what serves the 79 holds written before it exists.
 *
 * Fresh regex per call: a shared module-level `/g` literal is a `lastIndex`
 * bug waiting for the next reader (the same note `closingKeywordRe` carries).
 */
export function restartTouchRe() {
  return /^[ \t]*(?:>[ \t]*)*(?:[-*+][ \t]+)?Restart-touch:[ \t]*(\S[^\n]*)$/gm;
}

/**
 * How far past an anchor line the list scan will follow.
 *
 * Two of the seven measured clauses put their paths in a bulleted list UNDER
 * the anchor sentence (#8984's three docs pages, #8662's two gate files)
 * rather than on the anchor line itself, so the scan has to cross into the
 * list — and once it does, something has to stop it from swallowing an entire
 * card body when an anchor term happens to appear above a long unrelated list.
 *
 * The longest measured trigger list is 3 items. 12 leaves 4× headroom while
 * bounding the blast radius of a stray anchor to a dozen lines. It is a
 * PARSING bound, not a threshold on board state: nothing about the board
 * changes what it means, and no row is suppressed by it that a hold author
 * could not fix by writing a shorter list.
 */
export const H17_LIST_SCAN_LIMIT = 12;

/**
 * The rendered-row cap, and the reason it is a budget rather than a judgement.
 *
 * The index is reserved OUT of `MARKDOWN_BODY_BUDGET` before the findings rows
 * are laid out, so that it can never be silently truncated away by a noisy
 * board — but the reservation itself has to be bounded, or a pathological run
 * could starve the findings list to render inventory. At the measured rate (7
 * of 79 open holds carry a clause) 40 is ~5× headroom. An overflow is
 * ANNOUNCED, never silent (#4690).
 */
export const H17_INDEX_ROW_CAP = 40;

/** Is this line a markdown list item (the shape a trigger list is written in)? */
function isListItemLine(line) {
  return /^[ \t]{0,6}(?:[-*+]|\d{1,2}[.)])[ \t]+\S/.test(line);
}

/**
 * Every backticked span on one line, unwrapped and trimmed.
 *
 * Backticks are the ONLY delivery shape read, and that narrowness is the
 * precision. All seven measured clauses backtick their paths; admitting bare
 * prose tokens would mean deciding whether `rest-server.ts` in a sentence is a
 * trigger or a mention, which is the LLM-grade judgement this item refuses to
 * make. A hold that names its trigger without backticks contributes no row and
 * is invisible here — a stated boundary, and the argument for the
 * `Restart-touch:` convention rather than a reason to widen the parser.
 */
function backtickedSpans(line) {
  return [...String(line ?? '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
}

/**
 * Stage 1 — the candidate tokens a text declares as trigger files, BEFORE any
 * validation. Exported so the self-test can pin the anchor/continuation rules
 * separately from the tracked-file oracle, which needs a checkout.
 *
 * Reads fenced blocks out (citations, not triggers) and inline spans IN (the
 * signal itself) — the `{ inline: false }` half of `stripMarkdownCode`.
 *
 * The continuation rule, in the shape the measurement forced: from an anchor
 * line, harvest that line's spans, then — allowing at most ONE blank line, as
 * markdown requires before a list — consume the consecutive list block that
 * follows, up to `H17_LIST_SCAN_LIMIT` items. A blank line AFTER the list has
 * started ends it, so the scan cannot rejoin the prose on the far side.
 *
 * ## The under-report this leaves, found while reverse-verifying
 *
 * A path on a WRAPPED continuation line — the author hard-wrapped the clause
 * and the path landed on the next source line, which is neither the anchor nor
 * a list item — is not harvested. All seven measured clauses put the path on
 * the anchor line or in a list item, because GitHub comment bodies are written
 * as long unwrapped source lines, so the shape is currently hypothetical. It
 * is recorded rather than fixed: widening the scan to "any following line"
 * would re-admit the prose this bounds away, and the error direction here is
 * the one this whole item keeps — a missing row costs a seat the intersection
 * it would have got anyway before #10034, while a wrong row sends it to
 * intersect against a file nobody nominated.
 *
 * @param {string} text an issue body or a single comment body
 * @returns {string[]} raw candidate tokens, in document order, not deduped
 */
export function h17TriggerFileCandidates(text) {
  const stripped = stripMarkdownCode(text, { inline: false });
  const lines = stripped.split('\n');
  const out = [];

  // The canonical channel first — a whole-line value, so no span is needed and
  // a bare (unbackticked) path is accepted here and ONLY here.
  for (const m of stripped.matchAll(restartTouchRe())) {
    out.push(m[1].trim().replace(/^`+|`+$/g, '').trim());
  }

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (!H17_TRIGGER_ANCHOR_TERMS.some((term) => lower.includes(term))) continue;
    out.push(...backtickedSpans(lines[i]));

    let j = i + 1;
    let blanks = 0;
    let started = false;
    let taken = 0;
    while (j < lines.length && taken < H17_LIST_SCAN_LIMIT) {
      const line = lines[j];
      if (line.trim() === '') {
        if (started) break;
        if (++blanks > 1) break;
        j++;
        continue;
      }
      if (!isListItemLine(line)) break;
      out.push(...backtickedSpans(line));
      started = true;
      taken++;
      j++;
    }
  }
  return out;
}

/**
 * Stage 2 — candidates from every text of one card, validated against the
 * tracked-file set and returned sorted and deduped.
 *
 * `isTracked` is injected rather than read here so the whole extraction stays
 * pure and the self-test can drive it with a fixture set instead of a
 * checkout. A token the oracle does not recognise is DROPPED in silence: the
 * measured decoys are `Field` and `FIXTURE_CAPTURED_NEGATED` (backticked
 * identifiers sitting inside real trigger clauses on #8656 and #8662) and
 * `scripts/check-type-check-coverage.mjs:1679` (a real path with a line suffix
 * — tracked as a file, NOT as that token, so the suffix form correctly fails).
 * Each of those is a row this index would otherwise have rendered wrong.
 *
 * @param {string[]} texts card body plus every hold-comment body
 * @param {(path: string) => boolean} isTracked
 * @returns {string[]}
 */
export function h17TriggerFiles(texts, isTracked) {
  const found = new Set();
  for (const text of texts ?? []) {
    for (const token of h17TriggerFileCandidates(text)) {
      if (token && isTracked(token)) found.add(token);
    }
  }
  return [...found].sort();
}

/**
 * The gathering policy — which cards are worth a comment fetch.
 *
 * Open `pm:on-hold` cards ONLY, which is exactly the population the index
 * describes. The same candidate-gating idiom as H2's comment fetch and H16's
 * detail GET: the request count is bounded by the population the item can
 * actually speak about, never by the open board. Exported for the same reason
 * `h16NeedsDetail` is — a policy that decides what gets READ AT ALL is where a
 * silent hole would live.
 */
export function h17NeedsComments(issue) {
  return labelNames(issue).includes('pm:on-hold');
}

/**
 * Build the rendered index rows from cards already in hand.
 *
 * Cards contributing no validated path are omitted entirely rather than
 * rendered empty: a hold with no trigger clause is the normal majority shape
 * (2 of the 9 measured, and most of the 79 on the board), and printing 70
 * empty rows would bury the handful that carry the signal this section exists
 * to deliver.
 *
 * @param {Array<{ issue: object, texts: string[] }>} entries
 * @param {(path: string) => boolean} isTracked
 * @returns {Array<{ issue: object, files: string[] }>} ascending by number
 */
export function h17IndexRows(entries, isTracked) {
  const rows = [];
  for (const { issue, texts } of entries ?? []) {
    const files = h17TriggerFiles(texts, isTracked);
    if (files.length > 0) rows.push({ issue, files });
  }
  return rows.sort((a, b) => (a.issue?.number ?? 0) - (b.issue?.number ?? 0));
}

/**
 * The tracked-file oracle. Returns a Set, or `null` when it could not be read.
 *
 * `-z` rather than plain `ls-files`: git QUOTES paths containing non-ASCII or
 * special bytes in the default output ("packages/\303\251.ts"), and a quoted
 * form would never match the token a hold comment backticks — silently
 * dropping exactly the paths hardest to notice missing. The NUL-separated form
 * is byte-exact.
 *
 * An EMPTY result reads as unavailable, not as "nothing is tracked". The
 * difference is the whole #4690 posture at oracle granularity: an empty set
 * would validate away every candidate and render a confidently empty index —
 * the shape indistinguishable from a board where no hold names a trigger file,
 * which is the silence this item exists to end.
 */
function readTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const set = new Set(out.split('\0').filter(Boolean));
    return set.size > 0 ? set : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// H18 — `pm:retriage` aged past one triage cycle (maintainer-ruled
// 2026-08-19/20, verbatim: 「同意 并存」). See the header doc for the full
// rationale; the code here is deliberately small and mirrors H13's shape —
// same threshold reasoning, same `updated_at` proxy, same unscoped population.
// ---------------------------------------------------------------------------

/**
 * H18 threshold — one triage-Routine cycle, the same reasoning as
 * `DOMAIN_HALF_STATE_STALE_HOURS`: the Routine fires HOURLY and re-judges
 * every `pm:retriage` card "each fire, high priority" (SKILL.md, 「`pm:retriage`
 * 重判每 fire 高优先处理」), so a card still carrying the label after 2h has
 * survived at least one re-judgement pass it should not have. Age is read
 * from `updated_at` rather than a per-card timeline fetch for the
 * label-APPLICATION event: this sweep makes that fetch for no item (H13's
 * same proxy choice, for the same reason — see `h13DomainWithoutPmState`),
 * and every triage write on the card (grade kept or changed) bumps
 * `updated_at`, so a stale reading here means nothing touched the card since
 * any triage pass at all, which is exactly the failure this item exists to
 * name.
 */
export const RETRIAGE_STALE_HOURS = 2;

/**
 * H18 — null when clean, else the finding sentence. `pm:retriage` coexists
 * with the card's standing `pm:*` label by design (ensure-pm-labels.sh's own
 * comment on the label object: "COEXISTS … and ⛔ never replaces it"), so a
 * clean-shaped row names that coexisting label; `pm:retriage` present with NO
 * other `pm:*` label is a shape the state model does not define, and that
 * absence is worth its own sentence rather than a silently empty list — the
 * disputed grading is unidentifiable (异议对象不明) from the label set alone.
 * An unreadable `updated_at` flags rather than reads as fresh, same as
 * H10–H13 (#4690).
 */
export function h18RetriageAged(issue, nowMs = Date.now()) {
  const labels = labelNames(issue);
  if (!labels.includes('pm:retriage')) return null;
  const updated = Date.parse(issue.updated_at ?? '');
  const ageHours = Number.isFinite(updated) ? (nowMs - updated) / 3_600_000 : null;
  if (ageHours !== null && ageHours <= RETRIAGE_STALE_HOURS) return null;
  const reading =
    ageHours === null
      ? 'an unreadable `updated_at` (which must not read as fresh)'
      : `~${Math.round(ageHours)}h without activity (threshold ${RETRIAGE_STALE_HOURS}h)`;
  const coexisting = labels.filter((l) => l.startsWith('pm:') && l !== 'pm:retriage');
  const carrying =
    coexisting.length > 0
      ? `alongside its standing ${coexisting.map((l) => `\`${l}\``).join(', ')}`
      : 'ALONE, with no coexisting standing `pm:*` label — the disputed grading is unidentifiable (异议对象不明)';
  return (
    `\`pm:retriage\` carried ${carrying}, ${reading} — the objecting seat's grade is still undecided past ` +
    `one triage cycle. The triage Routine re-judges every \`pm:retriage\` card each fire (SKILL.md); a card ` +
    `still here past the threshold is a re-judgement pass that did not run, not inventory: resolve the ` +
    `grade (keep or change) and drop the label in the same write, oldest first.`
  );
}

// ---------------------------------------------------------------------------
// H19 — a block that OUTLIVED its blocker.
//
// The one question about a block that nothing here asked. Two items already
// read the `Blocked-by:` line and NEITHER expires a block: H4 asks whether the
// line EXISTS, H14 asks the REVERSE index (does anything target THIS card).
// The question that actually ENDS a block — is the issue it names still open?
// — had no reader at all, so a block outlives its blocker in complete silence:
// well-formed line, correct label, no row anywhere.
//
// Measured on this board, both found by READING and neither by any gauge:
//
//   • `Blocked-by: #10126` parked in a COMMENT; the target closed
//     2026-08-20T09:03:37Z; the card sat blocked ~4.5 h past that and was
//     released only because a human walked the lane's dependency graph.
//   • 「`Blocked-by: #9612`」 in the BODY, backtick-decorated (the decorated-
//     directive shape); the target closed 2026-08-20T07:58:08Z; released only
//     by a manual triage pass.
//
// Both shapes are fixtures in the self-test, and between them they are why the
// target list is read from BOTH channels through the shared reader rather than
// from the body alone: one of the two measured cards states its blocker only
// in a comment, so a body-only H19 would have seen exactly half of the
// evidence this row was filed on.
//
// ## Report-only, and pointedly so
//
// The release is a protocol procedure with two mechanical double-checks the
// state model spells out (`pm:blocked`/`pm:on-hold` row, 「放行双查(两查皆机
// 械、零判断)」), and neither is a thing this file could perform: they read the
// card's conversion-comment history and its merged-PR timeline. So this row
// surfaces the CANDIDATE and the unlock sweep releases it. ⛔ Never a label
// written from this script — the same posture H14 holds for `pm:blocking`.
// ---------------------------------------------------------------------------

/**
 * One `Blocked-by:` ref as a canonical, comparable target.
 *
 * `blockedByTargets` returns the ref AS WRITTEN (`{repo: null | 'objectui' |
 * 'objectstack-ai/objectui', number}`), and three spellings can name one
 * issue. Collapsing them here is what makes the per-target cache a real cache
 * rather than three cache entries and three requests for one answer.
 *
 * An UNQUALIFIED repo name (`objectui#4356`) is resolved against the swept
 * repo's OWNER. That is a guess, and it is a SAFE one in the only direction
 * that matters: if the owner is wrong the fetch fails and the target reports
 * as `unresolved` — named on the row, never silently dropped and never read
 * as closed. A guess that can only ever produce an "I could not tell" is
 * worth making; one that could produce a false finding would not be.
 *
 * Note `buildBlockingIndex` makes the opposite call on the same ref shape and
 * both are right: the INDEX drops cross-repo refs because reading `objectui#N`
 * as a local number would invent a dependent for an unrelated card, while H19
 * resolves them because the target's repo is part of the address it fetches.
 * One asks "which LOCAL card is waiting", the other "is THAT issue still open".
 *
 * @param {{ repo: string|null, number: number }} ref
 * @param {string} [ownerRepo] — `owner/repo`, defaulting to the swept one.
 * @returns {{ key: string, repo: string, number: number, local: boolean }}
 */
export function blockerTargetKey(ref, ownerRepo = OWNER_REPO) {
  const owner = ownerRepo.split('/')[0];
  const written = ref?.repo ?? null;
  const repo =
    written === null ? ownerRepo : written.includes('/') ? written : `${owner}/${written}`;
  const number = Number(ref?.number);
  return { key: `${repo}#${number}`, repo, number, local: repo === ownerRepo };
}

/**
 * Every DISTINCT `Blocked-by:` target one card names, both channels, in the
 * order written — the input H19 resolves.
 *
 * Channels are UNIONED exactly as `buildBlockingIndex` unions them, and for
 * the same reason: a card whose body says `#A` and whose comment says `#B` is
 * waiting on BOTH, so a priority order would silently drop one live blocker.
 * Dedup is by canonical key, so a card that states one target in both channels
 * (the natural shape when a seat backfills the body line later) is resolved
 * once and listed once.
 *
 * Self-references are dropped, as in the index: a card cannot be its own
 * blocker, and resolving one would always answer `open` (the card is in the
 * open listing by construction) — a permanent no-op that costs a row of noise
 * in every explanation of what H19 read.
 *
 * ## The comment channel is UNGATED here (#11747)
 *
 * `commentBodies` is what `needsBlockerLivenessComments` gathered, and that
 * gate is the label alone — it does NOT skip a card whose body already carries
 * a line, which is where `needsBlockedByComments` (H4's gate, correctly) stops.
 * The bound this note used to record was a real defect: a card with a body line
 * AND a second, different blocker parked in a comment had its comment-borne
 * target invisible here, so a RE-PARK — body line spent, new blocker in a
 * comment — resolved only the closed target and published a false unlock
 * candidate. Both channels now, unconditionally, for every `pm:blocked` card.
 *
 * `undefined` (unconsulted) and `null` (consulted, unreadable) still contribute
 * nothing; the `null` case is a card H4 is already firing on with a sentence
 * that says the thread could not be read, which is the louder and more accurate
 * place for it.
 *
 * @param {object} issue
 * @param {string[]|null|undefined} commentBodies
 * @param {string} [ownerRepo]
 */
export function blockerTargetsFor(issue, commentBodies, ownerRepo = OWNER_REPO) {
  const refs = [
    ...blockedByTargets(issue?.body),
    ...commentBlockedByTargets(commentBodies),
  ];
  const out = [];
  const seenKeys = new Set();
  for (const ref of refs) {
    const target = blockerTargetKey(ref, ownerRepo);
    if (!Number.isFinite(target.number)) continue;
    if (target.local && target.number === issue?.number) continue;
    if (seenKeys.has(target.key)) continue;
    seenKeys.add(target.key);
    out.push(target);
  }
  return out;
}

/**
 * Which cards H19 resolves targets for — exported for the same reason every
 * other gathering policy here is: a policy that decides what gets READ AT ALL
 * is where a silent hole would live.
 *
 * `pm:blocked` and nothing else, which is the ruled scope and also the exact
 * population H4 judges — the two items then say complementary things about one
 * set of cards ("did you leave the machine a line" / "is what the line names
 * still running"). A card carrying a `Blocked-by:` line WITHOUT the label is
 * deliberately out of scope: that is a different half-state (a wait nobody
 * declared), and inventing a row for it here would report against cards whose
 * line is documentation rather than state.
 */
export function needsBlockerLiveness(issue) {
  return labelNames(issue ?? {}).includes('pm:blocked');
}

/**
 * Which cards buy a comment fetch FOR THE LIVENESS READ — deliberately NOT
 * `needsBlockedByComments`, and the difference is the defect this gate exists
 * to end (#11747).
 *
 * That gate skips any card whose BODY already carries a `Blocked-by:` line,
 * which is exactly right for the question IT serves: H4 asks whether the author
 * left the machine anything at all, and a body line answers that without the
 * network. H19 and H26 ask a different question — is what the line names still
 * RUNNING — and for that question a body line is not an answer, it is one
 * channel's worth of targets. Borrowing H4's gate made the liveness read resolve
 * ONLY the body target on precisely the cards where the body is most likely to
 * be spent: a RE-PARK. A seat that finds the body's upstream closed, cards the
 * real prerequisite and writes the new blocker into a comment leaves a card
 * whose body names a closed issue and whose comment names an open one — and the
 * gated read saw only the closed one, published "the block has outlived its
 * blocker", and a card was released into an open blocker on the strength of it.
 *
 * So the liveness read is ungated: every `pm:blocked` card contributes both
 * channels, always. The cost is the gate's own complement — one comment fetch
 * per blocked card that HAS a body line (15 of 33 in the 2026-08-24 census),
 * bounded by an inventory the sweep already pages and paid once per sweep off
 * the SHARED comment cache, so a card H2/H4/H17 already fetched costs nothing.
 * ⛔ H4's gate is deliberately left alone: making the cheap question expensive
 * would buy nothing — a body line really does discharge the duty H4 audits.
 */
export function needsBlockerLivenessComments(issue) {
  return needsBlockerLiveness(issue);
}

/**
 * How many targets a row names before it counts the rest — the same render
 * budget `BLOCKING_DEPENDENT_LIST_CAP` keeps, for the same reason (the
 * markdown renderer writes into a body with a hard cap and a fold). Every
 * blocked card measured on this board names one or two targets, so five names
 * the whole set in practice while bounding the pathological case.
 */
export const H19_TARGET_LIST_CAP = 5;

/**
 * `#N` for a local target, `owner/repo#N` for a cross-repo one, + its note.
 *
 * An unresolved target carries the disambiguating repo reading when one was
 * taken (#11218), so the CAUSE is legible per target rather than only in the
 * aggregate sentence — a reader walking rows must be able to tell "we cannot
 * see that repo" from "that number is not there" without leaving the row.
 * `repoReadable === undefined` (no probe taken, e.g. a LOCAL target) renders
 * exactly as it always did.
 */
function namedTargets(rows) {
  const shown = rows.slice(0, H19_TARGET_LIST_CAP);
  const named = shown
    .map((r) => {
      const ref = `\`${r.local ? `#${r.number}` : r.key}\``;
      if (r.state === 'closed') return `${ref}${r.closedAt ? ` (closed ${r.closedAt})` : ' (closed)'}`;
      if (r.state === 'unresolved') {
        const why =
          r.repoReadable === false
            ? `${r.detail ? `${r.detail}; ` : ''}\`${r.repo}\` is NOT readable to this sweep's credential`
            : r.repoReadable === true
              ? `${r.detail ? `${r.detail}; ` : ''}\`${r.repo}\` IS readable, so that number is not there`
              : r.detail ?? '';
        return `${ref}${why ? ` (${why})` : ''}`;
      }
      return ref;
    })
    .join(', ');
  const more = rows.length > shown.length ? ` +${rows.length - shown.length} more` : '';
  return `${named}${more}`;
}

/**
 * H19 — null when every named target is still open, else the finding sentence.
 *
 * ## Three target states, never two (#4690)
 *
 * A resolution is `open`, `closed`, or `unresolved`, and the third is the one
 * the row exists to keep visible. "Could not be read" is not "still open": a
 * target dropped in silence reads as a healthy block FOREVER, which is
 * precisely this item's own disease wearing a new mask. So an unresolved
 * target FIRES a row — a quieter one, which says the liveness is unjudged
 * rather than asserting anything about the block.
 *
 * ## The cause is MEASURED now, not guessed — and still never inferred (#11218)
 *
 * This row used to refuse to name a CAUSE for an unresolved target, on solid
 * grounds: a 404 on `owner/repo#N` is equally "that repo is not reachable to
 * this credential" and "that issue number does not exist in a perfectly
 * reachable repo", and this file's standing posture is to refuse to name what it
 * cannot DISTINGUISH (the transport classifier's narrowness, H16's refusal to
 * vouch for an `unknown` mergeability).
 *
 * The two ARE distinguishable, by one extra reading, and refusing to make it was
 * leaving a real fact on the floor. `GET /repos/<owner>/<name>` answers whether
 * this credential can see the repo AT ALL, independently of any issue number in
 * it. Repo readable + issue 404 ⇒ the number does not exist there. Repo 404 ⇒ a
 * CREDENTIAL SCOPE gap, and the target is unjudgeable for a reason that has
 * nothing to do with the card. That is the same two-stage shape
 * `classifyRepoRead` already uses on the swept repo — a second reading turning
 * an ambiguous refusal into a named one — and it costs ONE request per distinct
 * SIBLING repo per sweep (2 on this board), cached, never per target.
 *
 * ⛔ What did NOT change is the posture: the row still reports only what it
 * OBSERVED. The probe is a measurement, not an inference, and where it is
 * unavailable the wording falls back to the old undiagnosed sentence rather than
 * guessing.
 *
 * ## Why this is the whole of the cross-repo half that CAN land here
 *
 * The unresolvable class is cross-repo by construction — the contract-first
 * split manufactures it (a parent plus one sub-issue per repo, the downstream
 * carrying `Blocked-by:`). Giving the resolver a genuine cross-repo READ needs a
 * credential the patrol does not hold and by standing ruling will not be given:
 * the workflow header states it (「⛔ Each install uses its OWN
 * `secrets.GITHUB_TOKEN` and reads its own repo. No cross-repo credential, no
 * matrix over repos, no PAT」 — refused at grading, per-repo install chosen
 * instead), and Actions' own token is repo-scoped by construction, so this is not
 * a knob this file could turn even if it wanted to. ⛔ Widening it is a
 * routing/security decision and not this script's to take.
 *
 * The accepted consequence, named in that same ruling, is that a cross-repo
 * target stays UNJUDGED in each install. This row's job is therefore to make
 * that UNJUDGED honest and LOUD rather than to pretend it away — which is what
 * the probe above and the anti-truncation handling in `renderMarkdown` do.
 *
 * ## A PARTIAL discharge is reported as partial, not as an unblock
 *
 * A card naming two blockers where one has closed is very possibly still
 * legitimately blocked. The row says how many closed and how many are still
 * open and leaves the judgement where the protocol puts it — with the unlock
 * sweep's double-checks. Report-only means the row never decides; it also
 * means the row must not go quiet on a half-expired block, because "one of
 * your two blockers landed" is exactly the state a seat cannot see by looking.
 *
 * @param {object} issue — an OPEN issue.
 * @param {{ key: string, number: number, local: boolean,
 *   state: 'open'|'closed'|'unresolved', closedAt?: string|null,
 *   detail?: string|null }[]} resolutions — this card's targets, resolved.
 */
export function h19BlockOutlivedBlocker(issue, resolutions) {
  if (!needsBlockerLiveness(issue)) return null;
  const rows = resolutions ?? [];
  if (rows.length === 0) return null;
  const closed = rows.filter((r) => r.state === 'closed');
  const unresolved = rows.filter((r) => r.state === 'unresolved');
  const open = rows.filter((r) => r.state === 'open');
  if (closed.length === 0 && unresolved.length === 0) return null;

  const release =
    ' Report-only, and the release is NOT this script\'s to make: the state model gives it two ' +
    'mechanical double-checks (`pm:blocked`/`pm:on-hold` row, 「放行双查」) — ① release only against the ' +
    'condition carried by the MOST RECENT conversion comment, never an earlier blocker on the thread (a ' +
    'condition already spent, re-fired, reinstates an expired premise as the current one), and ② refuse ' +
    'to release when the card carries a MERGED PR newer than that conversion comment (the card moved on ' +
    'after the condition was written, so the cited fact can be true and no longer current). This row ' +
    'surfaces the candidate; the unlock sweep releases it — ⛔ never a label written from this script. ' +
    'When that release does happen, its paired write includes 「同笔摘 assignee」: a card returned to ' +
    '`pm:queue` still carrying the assignee of the seat that parked it is dispatchable to the queue ' +
    'view and taken to the claim rule at the same time (H24), which is the state the unlock scan was ' +
    'measured leaving behind — ⚠️ agent identity only, a HUMAN assignment is ⛔ never cleared by an agent.';

  if (closed.length > 0) {
    const rest =
      open.length > 0
        ? ` ${open.length} target(s) are still open (${namedTargets(open)}), so this is a PARTIAL ` +
          'discharge and the card may still be legitimately blocked — the row reports it, it does not ' +
          'decide it.'
        : ' Every target it names is closed: nothing this card declared a wait on is still running.';
    const alsoUnresolved =
      unresolved.length === 0
        ? ''
        : ` A further ${unresolved.length} target(s) could not be resolved this sweep ` +
          `(${namedTargets(unresolved)}) and are unjudged, not open (#4690).`;
    return (
      `\`pm:blocked\` while ${closed.length} of ${rows.length} \`Blocked-by:\` target(s) — read from body ` +
      `OR comment — ${closed.length === 1 ? 'is' : 'are'} CLOSED (${namedTargets(closed)}): the block has ` +
      'outlived its blocker. Nothing else here asks this question — H4 asks whether the line EXISTS, H14 ' +
      'asks the REVERSE index — so an expired block sits with a well-formed line, a correct label and no ' +
      'row anywhere: one measured card sat ~4.5h past its blocker\'s close and was found only by a human ' +
      'walking the graph, another was released only by a manual triage pass.' +
      rest +
      alsoUnresolved +
      release
    );
  }

  const scoped = unresolved.filter((r) => r.repoReadable === false);
  const scopeNote =
    scoped.length === 0
      ? ' A cross-repo target resolves only when its repo answers this sweep\'s credential.'
      : ` ⚠️ ${scoped.length} of them are unjudgeable for a reason that has NOTHING to do with this ` +
        'card: the repo itself does not answer this sweep\'s credential (measured directly, by a ' +
        'separate `GET /repos/<owner>/<name>` — not inferred from the issue 404). That is the ' +
        'cross-repo class the contract-first split manufactures, and it is a standing, ACCEPTED ' +
        'limit rather than a defect to chase: each patrol install reads its own repo with its own ' +
        'repo-scoped token by ruling, so no re-run and no re-read of this card will ever resolve ' +
        'these. ⛔ Do not "fix" it on the card — judge the target BY HAND, or take a credential ' +
        'change to routing/security, whose call it is.';
  return (
    `\`pm:blocked\` and ${unresolved.length} of ${rows.length} \`Blocked-by:\` target(s) could NOT be ` +
    `resolved this sweep (${namedTargets(unresolved)}) — so whether this block has outlived its blocker ` +
    'is UNJUDGED, not confirmed. Unread is not still-open (#4690): a target dropped in silence reads as ' +
    'a healthy block forever, which is the exact failure this item exists to end, so it is named here ' +
    'instead. ⚠️ UNJUDGED is not a quiet row and must not be skimmed as one: this card\'s block is ' +
    'exactly as unverified as if nothing had been read at all.' +
    scopeNote +
    (open.length > 0
      ? ` The card's other ${open.length} target(s) did resolve, and are still open.`
      : '') +
    release
  );
}

// ---------------------------------------------------------------------------
// H20 — a `pm:dispatched` card whose claimed branch has NO REMOTE REF AT ALL.
//
// Claiming and dispatching are two acts with a gap between them (#10312).
// The protocol's CLAIM is a careful atom — assign + label swap in one write,
// the claim comment, a race re-read — and LAUNCHING the dev is a third act
// outside that atom which nothing binds to the first two. So a seat can
// complete a perfectly well-formed claim and then not dispatch: a maintainer
// message arrives and is answered, a tool errors, context is lost. What is
// left behind is a card that is `pm:dispatched`, assigned, carrying a full
// claim comment naming a branch and a worktree — and no agent anywhere is
// working on it.
//
// ⭐ Why this needed a ROW and not a rule: the failure is INVISIBLE FROM THE
// CARD. Every field on it is correct. Only the absence of something ELSEWHERE
// is wrong, and no reader of the card can see it — every seat and every gauge
// reads it as work in progress. A skill sentence ("a claim is not complete
// until the agent is launched") is a rule, and it fails the same way the first
// time someone is interrupted; the mechanism has to live where the absence is
// observable.
//
// The adjacent rows each decline it, for a good reason of its own:
//   H2   assignee with NO claim comment — here the claim comment is present
//        and complete, which is exactly the point.
//   H4 / H14  `Blocked-by:` — not a blocked card.
//   H9   `pm:on-hold` without `Restart-when:` — not held.
//   H8   a MERGED PR while still dispatched — nothing merged; nothing ran.
// Nothing asked whether a card labelled `pm:dispatched` is actually BEING
// WORKED. That is the same missing question H19 asks about a block: a state
// label asserting an external fact that nothing re-checks.
//
// ## Measured — #8878, 2026-08-20
//
// The claim comment (`5356927509`) was posted at ~14:05Z. Before the dispatch
// tool was called a maintainer message arrived and was answered, and the
// second half never happened. The card sat `pm:dispatched` with nobody on it
// for 74 MINUTES, until a patrol tick compared branch heads and found no ref.
//
// ⚠️ The interruption is the MECHANISM, not an excuse: any seat that answers a
// message, hits a tool error, or loses context between the claim and the launch
// produces the same state. And ⚠️ the symptom is IDENTICAL to a dev agent that
// died (no branch, no PR, no report) while the remedies are OPPOSITE — a dead
// agent needs a probe, an undispatched claim needs a dispatch. So the row
// reports the observation and names both readings; it does not diagnose one.
//
// ## ⛔ The key is "NO REF AT ALL" — never "no PR yet"
//
// This is the one thing the item must not get wrong, and the filing card is
// explicit: a dev inside a long build legitimately has a ref and no PR for
// over an hour, which that round measured repeatedly. Keying on the PR would
// fire hardest on the healthiest dev on the board. The guarantee here is
// structural rather than a matter of care — `h20DispatchedNoBranchRef` is
// handed a REF STATE and nothing else, so it cannot see a PR and cannot key on
// one — and the ref-exists-with-no-PR shape is a regression pin below.
//
// ## Three ref states, never two (#4690)
//
// `exists` → healthy, no row. `absent` → the finding. `unreadable` (any
// non-404 failure) → its OWN quieter row saying the dispatch is unjudged. The
// third is the one the row exists to keep visible: a ref read dropped in
// silence reads as a healthy dispatch forever, which is this item's own
// disease wearing a new mask. H19 landed the same three-way shape for the same
// reason, and this follows it deliberately rather than inventing a second
// spelling.
// ---------------------------------------------------------------------------

/**
 * H20's threshold, and the only one in this file measured in MINUTES — because
 * the interval it bounds is a minutes-scale quantity and rounding it to hours
 * would either miss the measured incident or wait three times as long as it
 * needs to.
 *
 * ## The measured basis
 *
 * This lane's dispatch→draft-PR latency was measured at 35–50 minutes, and a
 * dev PUSHES ITS BRANCH well before the PR — the branch is the first thing an
 * os-dev creates, ahead of the first edit (the branch-push probe is step 1 of
 * the dev contract), so the observable this row keys on lands minutes into a
 * run rather than at its end. 60 minutes therefore sits above the whole
 * measured PR band while keying on a signal that arrives far earlier, which is
 * why it can be this tight without firing on a slow dev.
 *
 * Against the specimen: #8878 sat 74 minutes, so 60 catches it with 14 minutes
 * to spare. The card's own recommendation was "around 60 minutes with no ref at
 * all", and this is that number.
 */
export const DISPATCHED_NO_REF_STALE_MINUTES = 60;

/**
 * The protocol's dev-branch shape — `claude/issue-<n>-<slug>`. This row has an
 * observable at all only because the protocol already writes one: the claim
 * comment NAMES the thing whose absence is the finding.
 *
 * A `Branch:` line naming some OTHER shape (a bare `main`, a hand-cut
 * `feat/…`) is deliberately left unmatched, which puts the card out of this
 * row's scope entirely. The alternative — probing whatever text follows the
 * colon — would spend ref reads on prose and manufacture findings out of
 * typos. Under-reporting on an unrecognised spelling is the same call H17's
 * extractor makes, for the same reason: a fabricated row sends a reader to
 * check something that was never there.
 *
 * ⚠️ `g` is load-bearing (`matchAll` requires it) and therefore this constant
 * is for `matchAll` ONLY — `.test()`/`.exec()` on a shared global regex carry
 * `lastIndex` between callers and answer differently on alternate calls.
 */
export const CLAIM_BRANCH_SHAPE = /claude\/issue-\d+-[A-Za-z0-9][A-Za-z0-9._-]*/g;

/** How many branches one row names before it counts the rest — H19's budget, same grounds. */
export const H20_BRANCH_LIST_CAP = 5;

/**
 * Every protocol-shaped branch named by a `Branch:` directive in one comment
 * body, de-duplicated, in the order written.
 *
 * Only the `Branch:` LINE is read, not the whole comment: a claim comment also
 * quotes worktree paths and sibling branches in prose, and the directive line
 * is the field the protocol actually fills in. Decoration is expected and
 * tolerated — 「Branch: `claude/issue-10312-…`」 is the natural markdown for a
 * line meant to be grepped, and the same decorated-directive lesson H4 paid
 * for (#10102) applies verbatim here.
 *
 * ⚠️ The separator class here carried the SAME duplicated-U+003A typo the claim
 * marker did (`[::]`, two ASCII colons, never the fullwidth U+FF1A its shape
 * implied) and is collapsed with it in #12090 — byte-identical behaviour, one
 * fewer place where the code reads as if it honoured a spelling it does not.
 * See `CLAIM_COMMENT_MARKER`'s note for the codepoint reading and the live
 * probe behind it.
 */
export function claimedBranches(body) {
  const out = [];
  const text = String(body ?? '');
  for (const line of text.matchAll(/^\s*>?\s*Branch(?:es)?\s*:\s*(.*)$/gim)) {
    for (const hit of String(line[1] ?? '').matchAll(CLAIM_BRANCH_SHAPE)) {
      if (!out.includes(hit[0])) out.push(hit[0]);
    }
  }
  return out;
}

/**
 * The claim this card is CURRENTLY waiting on — the MOST RECENT claim comment
 * that names a branch — or null when no comment does.
 *
 * ## Why the most recent, and not the first or the union
 *
 * The same call H19's release double-check ① makes about conversion comments,
 * for the same reason: a claim already spent, re-read as current, reinstates
 * an expired premise. A re-claimed card (the #5925 stale-claim reclaim is the
 * measured shape) carries two claim comments, and the older one describes work
 * the board is no longer waiting on — judging it would report a dead branch
 * that everybody has already agreed is dead.
 *
 * An UNPARSEABLE `created_at` does not disqualify a comment: it falls back to
 * thread order for the recency comparison, and the age it yields is `null`,
 * which the predicate treats as "must not read as fresh" — H10/H13/H18's
 * standing call on an unreadable timestamp (#4690).
 *
 * @param {{ body?: string, created_at?: string }[]} commentRows — the REST
 *   comment rows, NOT bodies: this item is the only reader here that needs a
 *   timestamp, which is why the sweep's cache holds rows.
 * @returns {{ branches: string[], createdAt: string|null } | null}
 */
export function governingClaim(commentRows) {
  const rows = Array.isArray(commentRows) ? commentRows : [];
  let best = null;
  rows.forEach((row, index) => {
    const body = String(row?.body ?? '');
    if (!CLAIM_COMMENT_MARKER.test(body)) return;
    const branches = claimedBranches(body);
    if (branches.length === 0) return;
    const parsed = Date.parse(row?.created_at ?? '');
    const stamp = Number.isFinite(parsed) ? parsed : null;
    const candidate = { branches, createdAt: row?.created_at ?? null, stamp, index };
    if (best === null) {
      best = candidate;
      return;
    }
    const newer = stamp === null || best.stamp === null ? index > best.index : stamp >= best.stamp;
    if (newer) best = candidate;
  });
  return best === null ? null : { branches: best.branches, createdAt: best.createdAt };
}

/**
 * How old the governing claim is, in minutes — `null` when the timestamp is
 * unreadable, which is NOT the same as young (#4690) and is why this returns
 * three-valued rather than a number with a sentinel.
 */
export function claimAgeMinutes(claim, nowMs = Date.now()) {
  const posted = Date.parse(claim?.createdAt ?? '');
  return Number.isFinite(posted) ? (nowMs - posted) / 60_000 : null;
}

/**
 * Which cards buy a ref read — exported for the reason every gathering policy
 * here is: a policy that decides what gets READ AT ALL is where a silent hole
 * would live.
 *
 * `pm:dispatched` (regardless of assignee — an unassigned dispatched card is
 * H1's finding and can still carry a claim naming a branch), a governing claim
 * that names at least one protocol-shaped branch, and an age past the
 * threshold. The age gate is a GATHERING gate as well as a predicate gate on
 * purpose: a young card is not stuck, so probing it would spend a request to
 * learn nothing, and the row says nothing about it either way. The predicate
 * re-checks the age independently so an over-gathering caller still cannot
 * produce a row about a fresh claim.
 */
export function h20NeedsRefProbe(issue, claim, nowMs = Date.now()) {
  if (!labelNames(issue ?? {}).includes('pm:dispatched')) return false;
  if (!claim || (claim.branches ?? []).length === 0) return false;
  const age = claimAgeMinutes(claim, nowMs);
  return age === null || age > DISPATCHED_NO_REF_STALE_MINUTES;
}

/** `` `branch` `` for each named ref, capped at the render budget, + its note. */
function namedBranches(rows) {
  const shown = rows.slice(0, H20_BRANCH_LIST_CAP);
  const named = shown
    .map((r) => `\`${r.branch}\`${r.state === 'unreadable' && r.detail ? ` (${r.detail})` : ''}`)
    .join(', ');
  return `${named}${rows.length > shown.length ? ` +${rows.length - shown.length} more` : ''}`;
}

/**
 * H20 — null when the claimed branch exists (or the card is out of scope),
 * else the finding sentence.
 *
 * ## What it is NOT given, and why that is the design
 *
 * It receives the card, the governing claim and a REF STATE per branch. It is
 * given no PR list, no merge state and no timeline, so ⛔ "no PR yet" is not a
 * thing this predicate could key on even by accident — the guarantee the
 * filing card asked for, made structural instead of remembered.
 *
 * ## The three-state fold
 *
 *   any `exists`      → clean. Something IS on the board for this card, and
 *                       whether it has a PR yet is none of this row's business.
 *   all `absent`      → the finding. Nothing was ever pushed for this claim.
 *   any `unreadable`  → the quieter row. "No ref at all" is an assertion about
 *                       absence, and an unread probe cannot support it, so the
 *                       row says the dispatch is UNJUDGED rather than either
 *                       vouching for it or claiming a finding it did not
 *                       measure.
 *
 * An EMPTY `refStates` means the caller never probed; that is a caller
 * contract, not a reading, and it yields no row — H19's identical treatment of
 * absent resolutions.
 *
 * @param {object} issue — an OPEN issue.
 * @param {{ branches: string[], createdAt: string|null }|null} claim
 * @param {{ branch: string, state: 'exists'|'absent'|'unreadable',
 *   detail?: string|null }[]} refStates
 */
export function h20DispatchedNoBranchRef(issue, claim, refStates, nowMs = Date.now()) {
  if (!labelNames(issue ?? {}).includes('pm:dispatched')) return null;
  if (!claim || (claim.branches ?? []).length === 0) return null;
  const age = claimAgeMinutes(claim, nowMs);
  if (age !== null && age <= DISPATCHED_NO_REF_STALE_MINUTES) return null;
  const rows = refStates ?? [];
  if (rows.length === 0) return null;
  if (rows.some((r) => r.state === 'exists')) return null;
  const unreadable = rows.filter((r) => r.state === 'unreadable');
  const absent = rows.filter((r) => r.state === 'absent');
  if (absent.length === 0 && unreadable.length === 0) return null;

  const reading =
    age === null
      ? 'an unreadable claim timestamp (which must not read as fresh)'
      : `~${Math.round(age)} min after the claim was posted (threshold ${DISPATCHED_NO_REF_STALE_MINUTES} min)`;

  const remedy =
    ' Report-only: the remedy is a DISPATCH or a withdrawn claim, ⛔ never a label written from this ' +
    'script — the same posture H14 holds for `pm:blocking` and H19 for a released block.';

  if (unreadable.length > 0) {
    return (
      `\`pm:dispatched\` and the remote ref for ${unreadable.length} of ${rows.length} claimed branch(es) ` +
      `could NOT be read this sweep (${namedBranches(unreadable)}) — so whether anything is working this ` +
      'card is UNJUDGED, not confirmed. Unread is not absent and it is not present either (#4690): a ref ' +
      'probe dropped in silence reads as a healthy dispatch forever, which is the exact failure this item ' +
      'exists to end, so it is named here instead. The status is reported and the cause is not guessed at.' +
      (absent.length > 0
        ? ` The card's other ${absent.length} claimed branch(es) DID resolve, and have no ref ` +
          `(${namedBranches(absent)}) — but "no ref at all" is a claim about every branch this card names, ` +
          'and one unread probe is enough to withhold it.'
        : '') +
      remedy
    );
  }

  return (
    `\`pm:dispatched\` with a complete claim comment naming ${namedBranches(absent)} — and NO SUCH REMOTE ` +
    `REF EXISTS, ${reading}. Claiming and dispatching are two acts with a gap between them: the claim is ` +
    'an atom (assign + label swap in one write, the claim comment, a race re-read) and LAUNCHING the dev ' +
    'is a third act outside it, so a seat interrupted between the two leaves exactly this card — every ' +
    'field correct, every gauge reading "in progress", nobody working it. It is invisible from the card ' +
    'itself: only the absence of something elsewhere is wrong. The measured specimen sat 74 min before a ' +
    'patrol tick compared branch heads. ⚠️ This symptom is IDENTICAL to a dev agent that died (no branch, ' +
    'no PR, no report) and the remedies are OPPOSITE — a dead agent needs a probe, an undispatched claim ' +
    "needs a dispatch — so read the claiming seat's own action sequence before assuming either. ⛔ This " +
    'row keys on NO REF AT ALL, never on "no PR yet": a dev inside a long build legitimately has a ref ' +
    'and no PR for over an hour. One reading to rule out first: if this card\'s delivery already MERGED, ' +
    'the branch is gone by design and the missing paired write is H8\'s, not this one.' +
    remedy
  );
}

// ---------------------------------------------------------------------------
// H21 — a closing keyword bound to `#N` inside a sentence that NEGATES it
// (#10392). H7's rationale, minus H7's `Part of` precondition.
//
// ## The gap, and the card it cost
//
// H7's header states the rule in fully general terms — GitHub's parser "matches
// the keyword plus the number and ignores the surrounding prose entirely,
// negations and modals included, so the sentence an author writes to PREVENT an
// auto-close is exactly what performs it on merge". The PREDICATE behind that
// sentence is narrower than the sentence: it is bound to a `Part of #N`
// declaration and fires only when the same `#N` carries both. A body that
// declares `Part of` for nothing is silent by construction, however plainly it
// says it is not closing the card.
//
// Measured specimen — PR #10241, merged 2026-08-20T15:10:06Z. Its body carries
// no `Part of` anywhere and this sentence under `## Out of scope`:
//
//     Filed, not fixed: #10240 — the same leak through the **delete** verb.
//
// Issue #10240 closed `completed` at 15:10:08Z — two seconds later — with a
// closing-link summary naming #10241 and nothing else. #10240 is a genuine
// unfixed defect (attachment tombstoning no-ops on a predicate delete); it read
// as finished until a human reopened it a day later. The author wrote the
// sentence to record that the card was deliberately LEFT OPEN, and the sentence
// closed it. H7 was silent, exactly as designed.
//
// ## Why this is a window and not "flag every closing keyword"
//
// The naive widening is not available and the corpus says so quantitatively: a
// PR cannot declare which cards it intends to close except BY using the keyword,
// so a rule over keyword-presence alone cannot separate intent from accident.
// Over the 300 most recently merged PR bodies (below), 277 carry a closing
// keyword bound to a number and there are 301 such matches — flagging keyword
// presence would produce 301 findings, every one of them a correct PR.
//
// The negation is what makes the two separable, because it is the AUTHOR'S OWN
// statement of intent sitting in the same sentence as the instruction that
// contradicts it. That is a contradiction internal to one sentence, which is
// the same shape H7 already reports across `Part of` and a keyword.
//
// ## The window bound is load-bearing — measured, not assumed
//
// Corpus (2026-08-21, this change's own stage-1 measurement): the 300 most
// recently merged PRs into `main`, bodies as the API returns them,
// 2026-08-19T15:13:23Z … 2026-08-21T19:11:30Z, 2,564,259 body characters, no
// empty bodies. Read through `stripMarkdownCode`, exactly as H7 reads.
//
//   window scope             flagged / 301 keyword matches
//   sentence (this rule)       1   — PR #10241, the specimen. 0 false positives.
//   paragraph                  1   — same single hit
//   whole body before match   14   — 13 false positives
//   anywhere in body         301   — the naive shape; useless
//
// All 13 whole-body false positives are ONE PR (#10714) which legitimately
// closes fourteen cards with a wall of `Fixes #N` lines and merely contains a
// negation word somewhere earlier in a long body. A body-scoped negation check
// would red-flag the most correct multi-close PR in the corpus thirteen times.
// That is why the window is a sentence and why it is stated in code rather than
// left to a reviewer's judgement.
//
// The result is not clean for lack of opportunity, which is the failure mode a
// 0-of-301 number invites: the same corpus carries 116 sentences in exactly the
// deliberate-non-closure register this rule reads — `## Out of scope`,
// "filed, not fixed here", "#N is not addressed here", "#N remains open". The
// register is everywhere; only one author put a closing keyword next to the
// number. Two near-misses are worth naming because they are the specimen's
// wording almost exactly and are correctly clean: #10876's "## Out of scope —
// filed, not repaired here" and #10851's "filed, not fixed here" — neither
// binds a keyword to a number.
//
// Second corpus, a different surface and the same answer: all 1,418 squash
// commit messages on `main` (2026-08-11 … 2026-08-21) — a surface GitHub's
// closing-keyword parser also reads — carry 228 keyword+`#N` matches across 197
// commits and produce 0 flags. That arm contributes no true positive either:
// commit messages here do not carry the `## Out of scope` register at all.
//
// ## Report-only, and deliberately NOT wired to the blocking gate
//
// `scripts/check-partof-closing-keyword.mjs` imports `h7PartOfWithClosingKeyword`
// and FAILS a PR on it. This predicate is deliberately a separate function that
// that gate does not import, so widening the class cannot silently widen a
// blocking check. Report-only first is the commissioned order (#10392 triage,
// 2026-08-21): measure, ship the row, and let a promotion to blocking be its own
// decision with these numbers in hand. Nothing about this file's report-only
// contract changes, and the existing patrol workflow already calls the sweep, so
// no workflow edit is part of this.
//
// ## Disjoint from H7 by construction
//
// A number already declared `Part of #N` is H7's row and is skipped here, so the
// two never double-report one number. H7 keeps that class whether or not the
// sentence is negated (its own self-test pins a negated `Part of` body as an H7
// finding); this rule takes the class H7 cannot see — a keyword bound to a
// number the body never declared itself part of.
// ---------------------------------------------------------------------------

/**
 * The negation / filing markers, EXACTLY as measured above.
 *
 * The set is pinned to the measured one on purpose: a marker added later
 * without re-running the corpus would inherit a "0 false positives" number it
 * was never measured under. Each was also measured ALONE against both corpora
 * and each is independently clean; `not` and `filed` are the two that fire on
 * the specimen.
 *
 * The bare noun `file`/`files` is deliberately NOT a marker although it too
 * measured clean. It carries no negation or filing sense — "this file fixes
 * #123" is a normal, correct close — and it is one of the most common nouns in
 * this repo's prose, so it is the marker most likely to turn into a false
 * positive on a corpus this one did not sample.
 */
const NEGATED_CLOSE_MARKER_RE =
  /\b(?:not|cannot|never|no longer|filed|filing|out of scope|rather than|instead of|without|remains open)\b|\bn't\b/i;

/**
 * The start offset of the sentence containing `idx`.
 *
 * Boundaries are sentence-ending punctuation, a blank line (paragraph break),
 * and a markdown structural line start (heading, list item, table row, block
 * quote). A PLAIN single newline is deliberately NOT a boundary: PR bodies are
 * soft-wrapped but commit messages in this repo are hard-wrapped at ~72
 * columns, so prose sentences routinely span lines there, and treating every
 * newline as a break would blind the window on exactly the second corpus.
 *
 * Exported for the self-test: the window is the whole design, so it is pinned
 * directly rather than only through the predicate's verdict.
 */
export function sentenceStartOffset(text, idx) {
  const head = String(text ?? '').slice(0, idx);
  let best = 0;
  for (const re of [
    /[.!?][)\]"'`]*[ \t\n]/g,
    /\n[ \t]*\n/g,
    /\n[ \t]*(?:#{1,6}\s|[-*+]\s|\d+\.\s|\||>)/g,
  ]) {
    let m;
    while ((m = re.exec(head)) !== null) {
      const end = m.index + m[0].length;
      if (end > best) best = end;
    }
  }
  return best;
}

/**
 * H21 — null when clean, else the finding sentence.
 *
 * Reads the same code-stripped text H7 reads, so a keyword quoted in backticks
 * or parked in a fence is not a finding here either — the measured reason is in
 * `stripMarkdownCode`.
 */
export function h21NegatedClosingKeyword(pr) {
  const body = pr?.body ?? '';
  const text = stripMarkdownCode(body);
  const declared = partOfTargets(body);
  const hits = [];
  for (const m of text.matchAll(closingKeywordRe())) {
    const [full, keyword, number] = m;
    if (declared.has(number)) continue; // H7 owns that number
    const start = sentenceStartOffset(text, m.index);
    if (!NEGATED_CLOSE_MARKER_RE.test(text.slice(start, m.index))) continue;
    hits.push({
      keyword,
      number,
      sentence: text.slice(start, m.index + full.length).replace(/\s+/g, ' ').trim(),
    });
  }
  if (hits.length === 0) return null;
  return hits
    .map(
      (h) =>
        `body carries \`${h.keyword} #${h.number}\` in a sentence that reads as NOT closing it — ` +
        `"${h.sentence}". GitHub's closing-keyword parser matches the keyword plus the number and ` +
        `ignores the surrounding prose entirely, negations included, so merging this closes ` +
        `#${h.number} and the sentence written to prevent that is what performs it. The measured ` +
        `specimen (PR #10241, "Filed, not fixed: #10240") closed a genuine unfixed card two seconds ` +
        `after merge, and a closed card reads as finished. Reword so no closing keyword sits next ` +
        `to that number — "#${h.number} is not addressed here" / "out of scope: #${h.number}" / ` +
        `"#${h.number} remains open" — or put the keyword in backticks.`,
    )
    .join('; ');
}

// ---------------------------------------------------------------------------
// H22 — a CLOSED card still carrying a `pm:*` STATE label (#10688).
//
// Every other item here is scoped to open issues by construction, and for most
// of them that is right. It is a gap for H8 specifically, because H8's whole
// subject is a write that has not happened yet — and the card is usually closed
// by the same merge that discharges the PR, often by a `Closes #N` in the same
// instant. So whether H8 ever got to fire was decided by a RACE: if the patrol
// happened to run between "PR merged" and "card closed" the finding was raised;
// if the card closed first — the normal path — the duty was silently discharged
// by disappearance, because no run would ever look at that card again.
//
// Measured at filing (2026-08-21, the 500 most recently updated closed issues):
// 129 closed cards still carried a live `pm:` label, 118 of them
// `pm:dispatched` — the signature of exactly the write H8 was built to catch,
// unmet at scale because the card closed first.
//
// This is direction A of that card: keep the open-only default for every other
// collector and add ONE bounded closed reader, so the race closes without
// widening the sweep. It is the direction matching what H8 already claims to be
// for. The counterargument — that labels on a closed card are historical
// metadata — does not dispose of it: `pm:dispatched` is not descriptive, it is
// a claim of in-flight-ness, and this file's own H8 treats leaving it set as a
// defect worth a named rule. If that is a defect at 09:00 while the card is
// open and not a defect at 09:01 once it closes, the rule is about the board's
// tidiness rather than about the duty, and H8's text says otherwise.
// ---------------------------------------------------------------------------

/**
 * The `pm:*` labels that are STATE CLAIMS, and therefore residue on a closed
 * card. Exactly the five the #10688 census measured.
 *
 * ⚠️ This is deliberately NOT `PM_STATE_LABELS` (H13's), and the two must not
 * be unified on the strength of the similar name. H13 asks "does any label make
 * this card visible to a named reader?", so its list carries `finding`,
 * `needs-user-decision`, `pm:epic` and `pm:seat` and deliberately OMITS
 * `pm:blocking`. H22 asks a different question — "does this label CLAIM work is
 * in flight?" — and the answers diverge in both directions: `pm:blocking` is
 * such a claim (it is what the lane selection order ranks on) while `finding`
 * and `needs-user-decision` are perfectly good states for a closed card to have
 * ended in. Sharing one list would make H22 report every closed finding card on
 * the board and miss the blocking-cache residue entirely.
 *
 * Three `pm:*` labels are excluded here because they are not claims that work
 * is in flight:
 *
 *   `pm:seat`     a seat-registry post's TYPE sticker — the protocol carrier
 *                 itself, whose label is what makes the seat list page a board.
 *                 A closed seat card keeps it as identity, not as state.
 *   `pm:epic`     a delegation marker on a parent, the same kind of identity.
 *   `pm:retriage` a request for re-judgement. Plausibly residue too, and it did
 *                 not appear in the census — so it stays out until something
 *                 measures it, rather than being widened in on a hunch. The
 *                 set is one edit away when that measurement exists.
 */
export const PM_RESIDUE_LABELS = [
  'pm:dispatched',
  'pm:queue',
  'pm:blocked',
  'pm:on-hold',
  'pm:blocking',
  // `pm:awaiting-maintainer` is residue on a closed card for the same reason
  // `pm:on-hold` is: it claims an action is still OWED. It joins the set with
  // the state itself (#11196 fix 5) rather than waiting for a census the way
  // `pm:retriage` does, and the two cases are not alike — `pm:retriage` was
  // measured absent from a live population, while this label has no live
  // population at all yet. Adding it now costs nothing (it can only match a
  // card that carries it) and means the state cannot accumulate exactly the
  // closed-card residue this row exists to catch before anyone measures it.
  AWAITING_MAINTAINER_LABEL,
];

/**
 * H22 — null when the closed card is clean, else the finding sentence.
 *
 * Gated on the card being CLOSED: handed an open issue it returns null, so the
 * predicate cannot double-report the population every other item already reads.
 * That gate is the predicate's own, not the caller's, because it is the one
 * thing separating this row from a restatement of H3.
 *
 * `floor` is the optional dated closure floor (see `resolveClosureFloor`): a
 * `Date` before which a closed card is out of scope, or null for "judge every
 * card in the window", which is the default and this repo's own behaviour.
 *
 * ⚠️ A card whose `closed_at` cannot be read is judged, NOT skipped. The floor
 * is a scope decision that needs a date to make; without one the card's
 * position relative to the cutover is UNKNOWN, and silently dropping it would
 * narrow the pass on unread data — #4690 in the direction this file refuses
 * everywhere else. The listing endpoint always carries `closed_at` on a closed
 * issue, so fail-open costs no noise in practice; it just keeps the one
 * unreadable card visible instead of disappeared.
 *
 * @param {any} issue
 * @param {Date | null} [floor]
 */
export function h22ClosedCardPmResidue(issue, floor = null) {
  if (issue?.state !== 'closed') return null;
  if (floor) {
    const closedAt = Date.parse(issue.closed_at ?? '');
    // Strictly BEFORE the floor is out of scope; a card closed ON the cutover
    // date is the first day the convention applies and is judged.
    if (!Number.isNaN(closedAt) && closedAt < floor.getTime()) return null;
  }
  const residue = labelNames(issue ?? {}).filter((l) => PM_RESIDUE_LABELS.includes(l));
  if (residue.length === 0) return null;
  const list = residue.map((l) => `\`${l}\``).join(', ');
  const reason = issue.state_reason ? ` (closed \`${issue.state_reason}\`)` : '';
  return (
    `card is CLOSED${reason} but still carries ${list} — a state label is a claim that work ` +
    `is in flight, and the card left the board without the paired write that clears it. ` +
    `H8 would have flagged this while the card was open; it closed first, which is the ` +
    `normal path rather than the rare one. Strip the \`pm:*\` state label(s); no other ` +
    `write is owed, the card is already closed.`
  );
}

// ---------------------------------------------------------------------------
// H23 — the SECOND SURFACE: a squash commit message on the default branch that
// carries `Part of #N` and a closing keyword bound to that same `#N` (#10942).
//
// ## The gap
//
// Every closing-keyword reader this repo owns is handed a PULL REQUEST BODY.
// H7 and H21 above take a `pr` and read `pr.body`;
// `scripts/check-partof-closing-keyword.mjs` — the blocking gate — is handed
// `PR_BODY` by `.github/workflows/partof-closing-keyword-guard.yml`. GitHub's
// closing-keyword parser acts on TWO surfaces: the PR body, and the COMMIT
// MESSAGES of commits that land on the default branch. This repo squash-merges,
// so every merged PR contributes exactly one commit message to `main`, and that
// message was never read by anything here.
//
// ## The mechanism, and why a body-side guard could not have caught it
//
// The squash message is COMPOSED AT MERGE TIME from the branch's own commit
// messages — not from the PR body. All six specimens below are multi-commit
// branches where one commit's trailer said `Fixes #N` and another's said
// `Part of #N`; the squash concatenated them, and the contradiction was
// manufactured by the assembly. Measured on the clearest one, PR #9478: its
// BODY carries a closing keyword bound to #9320 and no `Part of` anywhere, so
// the body is clean under H7 and under the blocking gate, and correctly so —
// the contradictory text existed in no body at all. This is why the row cannot
// be "H7 with a wider input": there is a text on `main` that no body ever held.
//
// ## Measured (2026-08-22, this change's own stage-1 pass)
//
// Corpus: all 1,546 first-parent commit messages on `main` in the window
// 2026-08-11T00:00:00Z … 2026-08-22T18:00:00Z (first and last message
// 2026-08-11T01:21:16Z … 2026-08-22T17:59:02Z), read with the extractors above at
// `markdown: false`. `main` is LINEAR — 1,975 commits reachable, 1,975 on the
// first-parent walk, 0 merge commits — so the commit list and the squash-message
// list are the same list, and the REST reader below needs no first-parent filter.
//
// ⚠️ The window bounds are spelled as full ISO instants on purpose. `git log
// --since=2026-08-11` is an APPROXIDATE: git fills the unspecified time-of-day
// from *now*, so a bare date silently slides the corpus forward as the clock
// moves — two runs of this measurement twelve minutes apart returned 1,443 and
// 1,441 messages for what read as one window. Anyone re-deriving these numbers
// must pin both instants or they are measuring a different corpus.
//
//   270 closing-keyword bindings across 234 messages
//     6 messages carry `Part of #N` AND a keyword bound to that same `#N`
//         sha          card      keyword    (columns kept apart on purpose — see
//         0c24898c0    10377     Fixes       the remedy note below; this file
//         d7283250d    10219     Fixes       must not itself put a keyword next
//         af2a989be     9320     Fixes       to a live card number)
//         3db37957c     8355     Fixes
//         7e06f51ee     8060     Fixes
//         30536e37c     7828     Fixes
//   1,545 of 1,546 subjects end with the squash marker `(#PR)`
//       0 of those 1,545 trailing markers are bound as a card by the extractor
//
// That last number is the PR-correlation guarantee, and it is measured rather
// than argued: the separator in `closingKeywordRe` is horizontal whitespace and
// an optional colon, so the `(` in `… (#11085)` stands between any preceding
// keyword and the number and no subject's own PR marker can ever be read as a
// card binding. `commitSubjectPrNumber` reads it as what it is instead.
//
// ⚠️ Six rows are evidence that the shape REACHES `main` unguarded, not six
// adjudicated wrong closes. In every one the lead commit's `Fixes #N` looks
// deliberate, so the finding sentence reports the contradiction and explicitly
// declines to adjudicate it — the reader checks the card. Deciding whether this
// class ever earns a BLOCKING posture is a later card on its own baseline
// (grading ruling, 2026-08-22): this row exists to measure the surface first,
// exactly the posture #10392 was required to take for the body surface.
//
// ## The remedy text differs from H7's and H21's, and that is the point
//
// H7 and H21 both end with "or put the keyword in backticks", which is CORRECT
// for a body and FALSE here: a commit message is not markdown, nothing renders
// it, and backticks are ordinary characters to the parser. An author who has
// internalised the body remedy is precisely the author who will reach for it on
// this surface, so the sentence says out loud that it does not work here and
// gives the only remedy that does — reword, so no closing keyword sits next to
// the number. The self-test pins the difference in BOTH directions (H7's
// sentence carries the backtick clause; this one must never carry it), because
// the realistic regression is someone copying H7's tail across.
//
// ## Why H21's negation window is NOT ported to this surface
//
// Measured, on the same 1,546-message corpus: H21's window and marker set flag
// 0 of the 270 bindings. Commit messages here do not carry the deliberate-
// non-closure register at all — no `## Out of scope`, no "filed, not fixed
// here" — because that register belongs to a PR body's prose sections. Porting
// it would add a second predicate over this surface with zero measured yield
// and its own false-positive risk, so it stays out until something measures a
// reason for it. (`sentenceStartOffset` was already written with this surface in
// mind — its docblock declines to treat a plain newline as a boundary precisely
// because commit messages hard-wrap at ~72 columns — so the port is available to
// a later card at no design cost.)
//
// ## And why stripping is not merely "harmless to skip"
//
// On this corpus the two readings agree exactly — 270 bindings either way, and
// the same 6 findings — so the asymmetry buys no finding today, and saying
// otherwise would be a claim the measurement does not support. It is not clean
// for lack of opportunity, which is the failure mode a 0-difference number
// invites: 1,064 of the 1,546 messages DO carry markdown-looking code (a squash
// body routinely quotes the PR body whole), 487 of those carry a `#N` inside the
// code region and 361 carry a closing-keyword word inside it. But not one
// carries a keyword and a number ADJACENT inside code — which is why the two
// readings agree. The population is everywhere; no author has
// yet landed the two adjacent inside a fence. The first who does — most likely
// the author following the body-surface remedy — is the case the surface-correct
// reading catches and a stripped reading would silently drop.
// ---------------------------------------------------------------------------

/**
 * The squash marker a commit SUBJECT ends with — `(#PR)` — or null.
 *
 * Read off the first line only, and anchored to its end: that is where the
 * merge writes it, and a `(#123)` in the message BODY is quoted prose from
 * somewhere else, not this commit's delivery. Measured at 1,545 of 1,546
 * subjects in the corpus above, which is why the correlation is worth having
 * for free rather than through a per-commit `/pulls` request.
 */
export function commitSubjectPrNumber(message) {
  const subject = String(message ?? '').split('\n', 1)[0];
  const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  return m ? m[1] : null;
}

/**
 * H23 — null when the commit message is clean, else the finding sentence.
 *
 * Pure over the REST commit row (`{ sha, html_url, commit: { message } }`), like
 * every predicate here, so the self-test drives it with the real specimens.
 *
 * The extractors are H7's, at `markdown: false` — same functions, different
 * surface. Bound PER CARD NUMBER exactly as H7 binds: a message that is
 * `Part of #A` and separately closes #B is the normal correct shape and stays
 * clean.
 */
export function h23CommitMessageContradiction(commit) {
  const message = commit?.commit?.message ?? '';
  const declared = partOfTargets(message, { markdown: false });
  if (declared.size === 0) return null;
  const closing = closingKeywordTargets(message, { markdown: false });
  const clashes = [...declared].filter((n) => closing.has(n));
  if (clashes.length === 0) return null;

  const sha = String(commit?.sha ?? '').slice(0, 9) || '(unknown sha)';
  const pr = commitSubjectPrNumber(message);
  const via = pr ? ` (landed by PR #${pr})` : '';
  const cards = clashes.map((n) => `#${n}`).join(', ');
  const pairs = clashes.map((n) => `\`Part of #${n}\` and \`${closing.get(n)}\` bound to #${n}`).join('; ');

  return (
    `squash commit \`${sha}\`${via} carries BOTH instructions in one message — ${pairs}. ` +
    `GitHub's closing-keyword parser reads commit messages on the default branch exactly as it ` +
    `reads a PR body, and ignores the surrounding prose, so this message already told GitHub to ` +
    `close ${cards} when it landed. No body-side guard could have seen it: the squash message is ` +
    `composed at merge time from the branch's own commit messages, so the contradiction need never ` +
    `have existed in any body (measured on PR #9478, whose body is clean under H7 and under the ` +
    `blocking gate). Re-read ${cards} and judge its state deliberately — this row reports the ` +
    `contradiction and does NOT adjudicate whether the close was intended. ` +
    `⚠️ For the next message: a commit message is NOT markdown — nothing renders it, so backticks ` +
    `and fences are ordinary characters here and quoting the keyword does not neutralise it. That ` +
    `is the PR-BODY remedy (H7's and H21's sentences end with it, correctly, for bodies) and it is ` +
    `false on this surface. The only fix here is to REWORD, so that no closing keyword sits next to ` +
    `a card number.`
  );
}

// ---------------------------------------------------------------------------
// H24 — an OPEN card that is `pm:queue` AND assigned: the board saying two
// contradictory things about one card at once (#11196 fix 1).
//
// ## Why it is its own row rather than a widening of H1/H2/H3
//
// Every adjacent row declines this shape for a reason of its own, which is how
// 17 cards across three repos sat in it with nothing reporting them: H1 wants a
// dispatched card with NO assignee (this one HAS one), H2 wants a MISSING claim
// comment (the measured carriers have complete ones — they were claimed, worked
// and then rolled back), and H3 wants two LABELS (here exactly one label is
// present and the second half of the contradiction lives in a different FIELD).
// The shape falls precisely between them.
//
// ## What the contradiction costs
//
// The two readers disagree and BOTH are right about what they read:
//
//   the queue view    reads `pm:queue` as "dispatchable now";
//   the claim rule    reads a non-empty assignee as "taken, ⛔ never reassign".
//
// So the card is simultaneously available to everyone and forbidden to
// everyone, and the outcome is not a race but PARALYSIS — a card nobody can
// legally move, in the one state no seat has a reason to look at twice. The
// census this row was filed on (2026-08-23, REST full pagination): 135 open
// `pm:queue` cards in objectstack of which 6 were assigned, 146/10 in objectui,
// 19/1 in cloud.
//
// ## Zero judgement, by construction — and the ordering that makes it safe
//
// The predicate is a pure intersection of two fields with no threshold, no
// timestamp and no identity test in it. That is deliberate: the same census
// found the assignee field carrying TWO different meanings (dead agent claims
// left by a state rollback, and genuine human ownership on a handful of
// objectui cards), and a row that tried to tell them apart would be guessing at
// the one thing this file refuses to guess at. The maintainer's ruling settles
// the order (2026-08-23): the rule lands FIRST and any true-ownership exemption
// is an explicit marker LATER — never the other way round. An exemption
// invented here, in the absence of that marker, would silently un-report the
// exact population the row exists for.
//
// ⛔ And the remedy is asymmetric, so the sentence says so: an agent may clear
// a dead agent claim on the evidence, and must NEVER clear a human's
// assignment.
// ---------------------------------------------------------------------------

/**
 * H24 — null when clean, else the finding sentence.
 *
 * Gated on the card being OPEN (like H22's gate, in mirror image): a closed
 * card carrying `pm:queue` is H22's residue row, and reporting it here too
 * would double-count one card under two items that prescribe different writes.
 * `state` is absent from some fixtures and every live open listing sets it, so
 * only an explicit `closed` declines — an unknown state is judged, never used
 * as a silent exemption.
 */
export function h24QueuedWithAssignee(issue) {
  if (issue?.state === 'closed') return null;
  if (!labelNames(issue ?? {}).includes('pm:queue')) return null;
  const logins = (issue?.assignees ?? [])
    .map((a) => (typeof a === 'string' ? a : a?.login))
    .filter(Boolean);
  if (logins.length === 0) return null;
  return (
    `\`pm:queue\` while ASSIGNED to ${logins.map((l) => `\`${l}\``).join(', ')} — the board makes ` +
    'two contradictory claims about this one card: the queue view reads `pm:queue` as ' +
    'dispatchable NOW, and the claim protocol reads a non-empty assignee as TAKEN (⛔ never ' +
    'reassign). Both readers are right about what they read, so the card is available to everyone ' +
    'and forbidden to everyone at once — not a race, a card nobody can legally move. The measured ' +
    'origin is a state ROLLBACK that swapped the label and left the field: the landing re-label ' +
    'and the unlock scan both owe 「同笔摘 assignee」 and only dead-claim reclamation ever said ' +
    'so (17 carriers across three repos at the 2026-08-23 census). Remedy: whichever write set ' +
    '`pm:queue` owes the assignee drop in the SAME stroke — do it now. ⚠️ Asymmetric: an agent ' +
    'identity in that field is dead-claim residue and may be cleared on its evidence; a HUMAN ' +
    'assignment may be real ownership and ⛔ must never be cleared by an agent — take it to the ' +
    'maintainer. This row fires either way and states the login so the reader can tell them ' +
    'apart: the rule lands first and an ownership exemption is an explicit marker later, never ' +
    'the other way round (ruling 2026-08-23).'
  );
}

// ---------------------------------------------------------------------------
// H25 — `pm:awaiting-maintainer` coexisting with another pm STATE label
// (#11196 fix 5, the exclusivity half of the new state).
//
// The state model makes the pm state labels ONE-OF: each is a claim about
// where the card is, and two of them at once leaves every reader to pick. H3
// is the same invariant for the one pair that was measured drifting, and this
// row is the same invariant for the newest state — written now, while the
// population is zero, because the cheapest moment to pin a vocabulary is
// before anything can carry it.
//
// Each coexistence is a specific lie, not a generic tidiness complaint:
//
//   + `pm:queue`             dispatchable AND waiting on a human — H24's
//                            two-views contradiction with a different second
//                            half, and the shape this whole family is about.
//   + `pm:dispatched`        a dev is on it AND nobody is: the label pair says
//                            an agent is working a card whose next act is the
//                            maintainer's.
//   + `pm:blocked`           two different release mechanisms are declared at
//                            once (an unlock scan over `Blocked-by:`, and a
//                            human act), so neither reader can tell which one
//                            will actually free it.
//   + `pm:on-hold`           the hold requires a machine-fireable
//                            `Restart-when:` (H9) and this state exists
//                            precisely for the card that cannot have one.
//                            Carrying both claims an exit that does not exist.
//   + `needs-user-decision`  the decision inbox says a RULING is owed; this
//                            state says a ruling was already given and an ACT
//                            is owed. Both at once inflates the inbox with a
//                            question nobody has to answer.
//
// ⛔ Deliberately NOT here, and deferred rather than dropped: any requirement
// that the card NAME the awaited action. That is a grammar for a protocol face
// the SKILL.md state-model row has not been written for yet, and inventing one
// in the sweeper would make the sweeper the author of the protocol it audits.
// ---------------------------------------------------------------------------

/** The states `pm:awaiting-maintainer` must never coexist with. */
export const AWAITING_MAINTAINER_EXCLUSIVE_LABELS = [
  'pm:queue',
  'pm:dispatched',
  'pm:blocked',
  'pm:on-hold',
  'needs-user-decision',
];

/**
 * Why each coexistence is a contradiction — one clause per label, so the
 * finding names the specific lie rather than "these two labels disagree".
 */
const AWAITING_MAINTAINER_CONFLICT_REASON = {
  'pm:queue': 'dispatchable now AND waiting on a human act',
  'pm:dispatched': 'an agent is working it AND the next act is the maintainer\'s',
  'pm:blocked': 'two different release mechanisms declared at once (unlock scan vs. a human act)',
  'pm:on-hold': 'a hold owes a machine-fireable `Restart-when:` (H9) and this state is for the card that cannot have one',
  'needs-user-decision': 'the decision inbox says a ruling is owed; this state says one was already given',
};

/** H25 — null when clean, else the finding sentence. */
export function h25AwaitingMaintainerExclusivity(issue) {
  if (issue?.state === 'closed') return null;
  const labels = labelNames(issue ?? {});
  if (!labels.includes(AWAITING_MAINTAINER_LABEL)) return null;
  const conflicts = AWAITING_MAINTAINER_EXCLUSIVE_LABELS.filter((l) => labels.includes(l));
  if (conflicts.length === 0) return null;
  const named = conflicts
    .map((l) => `\`${l}\` (${AWAITING_MAINTAINER_CONFLICT_REASON[l]})`)
    .join('; ');
  return (
    `\`${AWAITING_MAINTAINER_LABEL}\` coexists with ${named} — the pm state labels are ONE-OF, ` +
    'and two state claims on one card leave every reader to pick which is true. The awaiting ' +
    'state is the card whose remaining work is a MANUAL maintainer action, which is exactly why ' +
    'it has no machine exit; pairing it with a state that declares a different exit tells the ' +
    'unlock scan, the queue view and the decision inbox three different stories. Keep the ONE ' +
    'state that is true and drop the other(s) in a single write.'
  );
}

// ---------------------------------------------------------------------------
// H29 — the pm state labels are ONE-OF, GENERALLY (#11179).
//
// H3 and H25 are both this invariant, each pinned to the carrier that was
// measured drifting: H3 to the one pair (`pm:queue` + `pm:dispatched`), H25 to
// the one label (`pm:awaiting-maintainer`, written while its population was
// still zero). Between them the vocabulary has six members and fifteen pairs,
// and eleven of those pairs had no reader at all — including the two this card
// was filed on:
//
//   • `pm:queue` + `needs-user-decision` — the state model defines `pm:queue`
//     as 「无可问之事」, so the pair is a card that is simultaneously ready to
//     dispatch and waiting on a ruling. The measured seat behaviour was exactly
//     that: the analysis was posted, the decision label went on, and the queue
//     label was never taken off — 「判断做了(有分析产出),状态写入没做」.
//   • `pm:queue` + `pm:blocked` — the unlock/park transitions are two
//     INDEPENDENT label writes with no exclusivity invariant between them, so a
//     half-finished park leaves both. The measured specimen sat dual-hung for
//     three days.
//
// LIVE at the time of writing (2026-08-24 board read): #11534 carries
// `needs-user-decision` + `pm:blocked` — a third pair, in a third direction,
// which is the point: pinning pairs one at a time is how the family kept
// producing a new unreported shape. This row asks the invariant itself.
//
// ## It reports the pairs no other row owns, and only those
//
// A breach must be reported ONCE. H3 owns `pm:queue` + `pm:dispatched` (with
// its own measured specimen and its own sentence) and H25 owns every pair
// containing `pm:awaiting-maintainer` (with a per-label clause naming the
// specific lie). So this row skips exactly those and reports the remainder —
// and on a card carrying THREE states it still reports the pairs the others do
// not, rather than going silent because one of them fired. Both exclusions are
// pinned in the self-test, in both directions: the excluded pair is silent
// HERE and the owning row does fire on it.
//
// ## Free, and report-only
//
// Two label reads on a card the sweep already holds — no request. ⛔ Never a
// label written from this script: which state is TRUE is a judgement about the
// card (is it waiting on a ruling, or on a blocker, or on nothing?), and the
// same half-written transition that produced the pair would be reproduced by a
// sweeper guessing at it. The row names both claims and asks for ONE write.
// ---------------------------------------------------------------------------

/**
 * The ONE-OF vocabulary, in ONE place: the awaiting state plus the five it
 * excludes. Derived from H25's list rather than re-typed, so the two rows can
 * never disagree about what a "pm state" is — the same single-constant
 * discipline `AWAITING_MAINTAINER_LABEL` itself was introduced with, and the
 * failure family this whole file belongs to.
 *
 * ⚠️ This is the THIRD `pm:*` label set in this file, and the three are
 * deliberately different questions with deliberately different answers. Do not
 * unify them on the strength of the similar names — the self-test pins all
 * three pairwise:
 *
 *   `PM_STATE_LABELS`      (H13) "does any label make this card VISIBLE to a
 *                          named reader?" — so it carries `finding`, `pm:epic`
 *                          and `pm:seat`, none of which is a position on the
 *                          work state machine.
 *   `PM_RESIDUE_LABELS`    (H22) "does this label CLAIM work is in flight?" —
 *                          so it carries `pm:blocking` (a derived priority
 *                          cache, not a state) and drops `needs-user-decision`
 *                          (a fine state to close in).
 *   `PM_EXCLUSIVE_STATE_LABELS` (H25/H29) "is this a position the card can be
 *                          IN, such that two of them contradict?" — identity
 *                          stickers (`pm:seat`, `pm:epic`) legally coexist
 *                          with any state and are out; `pm:blocking` and
 *                          `pm:retriage` are annotations ON a state and are
 *                          out; `finding` is a card KIND rather than a
 *                          position and is out. `needs-user-decision` is IN,
 *                          because a card awaiting a ruling is somewhere, and
 *                          somewhere else is a contradiction.
 */
export const PM_EXCLUSIVE_STATE_LABELS = [
  AWAITING_MAINTAINER_LABEL,
  ...AWAITING_MAINTAINER_EXCLUSIVE_LABELS,
];

/**
 * What each state claims ON ITS OWN — one clause, so a row names the two
 * contradicting claims rather than complaining that two labels are present.
 *
 * Deliberately NOT merged with H25's `AWAITING_MAINTAINER_CONFLICT_REASON`:
 * that map says what a pairing WITH THE AWAITING STATE specifically lies about
 * (it reads as the second half of one sentence), while this one says what the
 * label asserts by itself, which is what a general pair needs on both sides.
 * The self-test pins that every `PM_EXCLUSIVE_STATE_LABELS` member has an entry, so the
 * vocabulary cannot be half-extended the way four string literals would be.
 */
export const PM_STATE_CLAIM = {
  'pm:queue': 'dispatchable NOW, with nothing left to ask',
  'pm:dispatched': 'an agent is working it under a live claim',
  'pm:blocked': 'it cannot start until a `Blocked-by:` target closes',
  'pm:on-hold': 'it is parked behind a machine-fireable `Restart-when:`',
  [AWAITING_MAINTAINER_LABEL]: 'its remaining work is a manual maintainer action',
  'needs-user-decision': 'a maintainer RULING is owed before anything can move',
};

/** A pair as an order-independent key, so the exclusions cannot depend on label order. */
const pmStatePairKey = (a, b) => [a, b].sort().join('|');

/**
 * The pairs another row already reports, by key. `pm:queue` + `pm:dispatched`
 * is H3's; every pair containing the awaiting label is H25's (handled by the
 * label test below rather than enumerated, so a future member added to
 * `AWAITING_MAINTAINER_EXCLUSIVE_LABELS` is covered without a second edit).
 */
const H3_PAIR_KEY = pmStatePairKey('pm:queue', 'pm:dispatched');

/** H29 — null when at most one state claim stands, else the finding sentence. */
export function h29PmStateExclusivity(issue) {
  if (issue?.state === 'closed') return null;
  const labels = labelNames(issue ?? {});
  const present = PM_EXCLUSIVE_STATE_LABELS.filter((l) => labels.includes(l));
  if (present.length < 2) return null;
  const pairs = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i];
      const b = present[j];
      if (a === AWAITING_MAINTAINER_LABEL || b === AWAITING_MAINTAINER_LABEL) continue; // H25's
      if (pmStatePairKey(a, b) === H3_PAIR_KEY) continue; // H3's
      pairs.push([a, b]);
    }
  }
  if (pairs.length === 0) return null;
  const named = pairs
    .map(([a, b]) => `\`${a}\` (${PM_STATE_CLAIM[a]}) + \`${b}\` (${PM_STATE_CLAIM[b]})`)
    .join('; ');
  return (
    `two pm STATE labels on one card — ${named} — and the state labels are ONE-OF: each is a ` +
    'claim about where the card IS, so two of them leave the queue view, the lane view, the ' +
    'unlock scan and the decision inbox to pick which one they believe, and every one of them ' +
    'picks differently. The measured origin is never a disagreement about the card: it is a ' +
    'TRANSITION written as an ADD instead of a REPLACE — the judgement was made and posted, and ' +
    'the half of the write that costs nothing but bookkeeping (dropping the state being left) ' +
    'was skipped. `pm:queue` in particular is defined as 「无可问之事」, so pairing it with any ' +
    'other state contradicts its own definition rather than merely competing with it. Remedy: ' +
    'decide which ONE state is true and drop the rest in a single write — and write every ' +
    'transition as replace-not-add so the pair cannot recur. Report-only: ⛔ never a label ' +
    'written from this script, because which state is true is a judgement about the card and a ' +
    'sweeper guessing at it would reproduce the very half-write that made the pair.'
  );
}

// ---------------------------------------------------------------------------
// H30 — a `pm:queue` card rotting unclaimed (#11179).
//
// `pm:queue` is the one ACTIVE state on the board: it asserts the card is
// dispatchable now, with nothing left to ask. Every other aged row here
// (H10/H11/H12/H13/H18) watches a state where waiting is legal and asks whether
// the wait has gone too long. This one watches the state where waiting is not a
// state at all, and asks why nothing happened.
//
// The measured incident: three cards left in `pm:queue` while the seat that
// owned them had already produced the analysis that should have moved them
// (「判断做了(有分析产出),状态写入没做(纯开销的那半)」). Nothing on the
// board said so, because a queued card looks exactly like a queued card no
// matter how long it has been one — the queue view's ordinary contents and a
// forgotten card are the same rows.
//
// ## The horizon, and why it is NOT H11's 7 days
//
// The aging SHAPE is H11's — `updated_at`, report-only, threshold named in the
// row, an unreadable stamp flagging rather than reading as fresh. The NUMBER is
// not, and reusing it would have been the mistake: 7 days is calibrated for a
// PARKED state, where a legitimate short park has cleared by then. Measured
// against all 40 open `pm:queue` cards on 2026-08-24:
//
//   >1d 17 · >2d 10 · >3d 8 · >4d 4 · >5d 3 · >7d 0
//
// At 7 days the row cannot fire on today's board at all — a check that cannot
// fail is the shape this file exists to catch, not to add. At 1 day it reports
// 43% of the queue, which is queue DEPTH rather than rot. 3 days is the
// smallest horizon that clears the ordinary depth while still exceeding the
// measured dual-hang this card was filed on (3 days), and it names 8 of 40 —
// a minority a human can actually walk.
//
// ## What the row asks for, and what it refuses to judge
//
// It does NOT say the card is wrong, and it does not rank it. It forces ONE
// explicit transition — dispatch it, convert it to `needs-user-decision`,
// withdraw it, or rewrite it — because the failure this closes is a decision
// that was made and never written down. Report-only, and pointedly: a sweeper
// that re-labelled here would be choosing the transition, which is the whole
// judgement. ⛔ Never a label written from this script.
// ---------------------------------------------------------------------------

/**
 * H30 threshold — 3 days, derived above from the live distribution rather than
 * inherited from H11's parked horizon. Days rather than hours because the queue
 * is legitimately deep: the unit has to be one a reader would call "sat there".
 */
export const QUEUE_ROT_STALE_DAYS = 3;

/** H30 — null when clean, else the finding sentence. */
export function h30QueueRotting(issue, nowMs = Date.now()) {
  if (issue?.state === 'closed') return null;
  if (!labelNames(issue ?? {}).includes('pm:queue')) return null;
  const updated = Date.parse(issue?.updated_at ?? '');
  const ageDays = Number.isFinite(updated) ? (nowMs - updated) / 86_400_000 : null;
  if (ageDays !== null && ageDays <= QUEUE_ROT_STALE_DAYS) return null;
  const reading =
    ageDays === null
      ? 'an unreadable `updated_at` (which must not read as fresh)'
      : `~${Math.round(ageDays)}d with no activity of any kind (threshold ${QUEUE_ROT_STALE_DAYS}d)`;
  return (
    `\`pm:queue\` with ${reading} — the queue is the one state that asserts the card is ` +
    'dispatchable NOW with nothing left to ask, so a card sitting in it is not inventory the ' +
    'way a parked card is: it is a card the lane keeps passing over. The measured shape is a ' +
    'judgement that WAS made and never written (「判断做了(有分析产出),状态写入没做」) — the ' +
    'analysis lands in a comment and the state stays where it was, which is indistinguishable ' +
    'from an ordinary queued card at every glance. This row does not judge the card and does ' +
    'not rank it: it asks for ONE explicit transition — dispatch it, convert it to ' +
    '`needs-user-decision` if it turns out to carry an unanswered question (the queue means ' +
    '「无可问之事」), park it with a machine-fireable exit, withdraw it, or rewrite a premise ' +
    'that no longer holds. Report-only: ⛔ never a label written from this script — choosing ' +
    'which of those transitions applies is the whole judgement.'
  );
}

// ---------------------------------------------------------------------------
// H31 — the contract-review gate carried on ONE of its two carriers (#11179).
//
// `needs:contract-review` is a DUAL-carrier gate: the ruling
// (maintainer 2026-08-22, 「简化一点是否可以直接挂 PR 侧」「两边都挂好」) puts it
// on the card AND on the PR, hung in one stroke and — the half that failed —
// cleared in one stroke, each carrier written through the label discipline's
// read-modify-write + read-back (SKILL.md 2026-08-18: 「承载闸门语义的标签……挂与
// 清两向同此四步,闸门被剥不是红灯是放行」).
//
// Two writes, one postcondition, and nothing ever checked the pair. The
// measured miss: a PASS verdict was posted, the PR carrier was cleared, and the
// card carrier was not — so the card stayed gated behind a review that had
// already passed, and the only evidence that anything was wrong was the label
// itself, on a card nobody was looking at.
//
// The other direction is the dangerous one and the same row catches it: a gate
// stripped from the card while the PR still carries it reads, to the enqueue
// path, as a card that was never gated. 「闸门被剥不是红灯是放行」 — a stripped
// gate is a GREEN light, and 「被剥」 and 「从未挂过」 are indistinguishable in
// the evidence. A row comparing the two carriers is the only reader that can
// tell them apart.
//
// LIVE at the time of writing (2026-08-24): card #11427 carries the gate while
// its delivering open PR #11844 does not.
//
// ## The silence that is NOT a bug: a card with no delivering open PR
//
// `references/contract-review.md` makes card-side-FIRST legal and expected:
// 「PR 一存在即挂,报告先于 PR 到达则先挂卡侧、ACCEPT 时补齐 PR 侧」. So a gated
// card with no PR yet is a correct intermediate state, not a premature hang,
// and this row stays silent on it — deliberately declining the "gate label on a
// card with no PR carrier is premature" shape, which would report the protocol's
// own prescribed sequence as a defect. The comparison begins when a delivering
// PR exists, which is exactly when the pair becomes checkable.
//
// ## Free, and bounded
//
// The open-PR listing is already in hand (H7/H12/H21 list it, H8 already passes
// it around for the same delivery question), and the delivery relation is
// `prDeliversCard` — the same body-first/branch-fallback relation H8 reads, so
// this row can never disagree with H8 about which PR delivers which card. No
// request, no new parser. MERGED PRs are deliberately out of scope: the gate
// governs enqueue and landing while the PR is open, and a merged carrier is a
// closed-out stroke rather than a live half-write.
//
// Report-only, and emphatically: this is a GATE. ⛔ Never a label written from
// this script — a sweeper that hung or cleared a review gate would be issuing
// the review verdict, and the one thing the whole clause-② chain forbids is
// 自查放行.
// ---------------------------------------------------------------------------

/** The clause-② gate label — one constant, both carriers. */
export const CONTRACT_REVIEW_LABEL = 'needs:contract-review';

/**
 * H31 — null when the two carriers agree (or the comparison is not yet
 * possible), else the finding sentence.
 *
 * A PR row whose `labels` is not an array is one this sweep could not read, and
 * it is EXCLUDED from the comparison rather than counted as unlabelled: reading
 * an unreadable carrier as a bare one would manufacture a finding out of a read
 * failure, which is the #4690 direction this file keeps in the one place it
 * actually matters — the direction that invents evidence.
 *
 * @param {object} issue — an OPEN issue.
 * @param {object[]} openPrs — the open-PR listing the sweep already holds.
 */
export function h31ContractReviewCarrierSplit(issue, openPrs) {
  if (issue?.state === 'closed') return null;
  const n = String(issue?.number ?? '');
  if (!n || n === '0') return null;
  const delivering = (openPrs ?? []).filter(
    (pr) => pr && !pr.merged_at && Array.isArray(pr.labels) && prDeliversCard(pr, n),
  );
  if (delivering.length === 0) return null; // card-side-first is legal — see the header note.
  const cardGated = labelNames(issue ?? {}).includes(CONTRACT_REVIEW_LABEL);
  const gatedPrs = delivering.filter((pr) => labelNames(pr).includes(CONTRACT_REVIEW_LABEL));
  const barePrs = delivering.filter((pr) => !labelNames(pr).includes(CONTRACT_REVIEW_LABEL));
  const list = (prs) => prs.map((p) => `#${p.number}${p.draft ? ' (draft)' : ''}`).join(', ');
  const contract =
    'The gate is a DUAL carrier — 「两边都挂好」, hung in one stroke and cleared in one ' +
    'stroke, each carrier written read-modify-write with a READ-BACK ' +
    '(「闸门被剥不是红灯是放行」: a stripped gate is a GREEN light, and 「被剥」 and 「从未挂过」 are ' +
    'indistinguishable in the evidence, so the read-back is the only way either is ever ' +
    'noticed). Report-only: ⛔ never a label written from this script — hanging or clearing a ' +
    'review gate from a sweeper would be issuing the verdict, which is 自查放行.';
  if (cardGated && barePrs.length > 0) {
    return (
      `\`${CONTRACT_REVIEW_LABEL}\` on the CARD while its delivering open PR ${list(barePrs)} ` +
      'does NOT carry it — the two carriers of one gate disagree, so the pair was written half ' +
      'way: either the hang never reached the PR side (「PR 一存在即挂」, and the PR exists), or ' +
      'a PASS cleared the PR side and stopped there, leaving the card gated behind a review that ' +
      `has already passed. ${contract}`
    );
  }
  if (!cardGated && gatedPrs.length > 0) {
    return (
      `\`${CONTRACT_REVIEW_LABEL}\` on the delivering open PR ${list(gatedPrs)} while the CARD ` +
      'does NOT carry it — the more dangerous half of the same split: to the enqueue path an ' +
      'ungated card is a card that was never gated, so the review chain this PR is still waiting ' +
      'on is invisible to the queue, and the card can be enqueued straight past a gate that is ' +
      `demonstrably still live one carrier over. ${contract}`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// H26 — a block whose target can never CLOSE, and the stale chain (#11219).
//
// The unlock predicate is "the `Blocked-by:` target CLOSED". `pm:on-hold` and
// `needs-user-decision` are, by definition, states a card sits in WHILE OPEN.
// A block naming such a target is therefore structurally indefinite: nothing in
// the machinery can ever fire it, and until this row nothing said so.
//
// ## Why every existing check passes on these cards
//
// The waiting card is perfectly well-formed — it has its machine-readable line
// (H4 clean), its target resolves, the target is open (H19 clean), its label is
// correct. H9 is the nearest neighbour and asks the mirror question: it audits
// the HELD card for a fireable `Restart-when:`. Nobody audited the card WAITING
// on one. So the card passes every gauge and still cannot move — which is why
// the six measured instances were found by a human reading, not by any sweep:
//
//   cloud#1119, cloud#799  -> cloud#987      (`pm:on-hold`), parked since July
//   cloud#861              -> cloud#855      (`pm:on-hold`)
//   objectos#75, #135      -> objectos#68    (`needs-user-decision`)
//   cloud#1332             -> cloud#1331     (`pm:queue`, titled `[Decision]`)
//
// The last row is deliberately NOT reported by this predicate: a decision card
// wearing a work label is a mislabelling to fix, not a fact readable from the
// labels this row reads, and inventing a title heuristic would make the sweeper
// guess at intent. Two of the rows are one repo's ENTIRE blocked inventory
// waiting on its one unanswered decision card — one ruling clears the repo.
//
// ## The second leg: the stale chain
//
// `cloud#1395` -> `objectstack#10101`, which is OPEN, so the block reads live.
// But #10101 was itself an H19 finding on the same sweep: both of ITS blockers
// had already closed. The block was real one level up and false two levels up,
// and a single-level predicate cannot see that. Flagging a target that is
// itself `pm:blocked` is the cheap, honest version of that: it does not chase
// the chain (which would cost a request per hop and could cycle), it says the
// wait is TRANSITIVE so a reader knows to look one level further.
//
// ## Quota
//
// Free. H19 already resolves each distinct target — from an open listing this
// sweep holds, or with one GET — and a resolved target's LABELS are a field
// that was already in the payload. Nothing here adds a request; the resolution
// rows simply stopped throwing the labels away.
//
// Report-only, and pointedly not a judgement that the block is WRONG: waiting
// on a deferred card is sometimes exactly right. The row says this block has no
// mechanism that will ever release it, which is the thing a human should see
// rather than discover in a hand sweep.
// ---------------------------------------------------------------------------

/**
 * Target states that can never satisfy the unlock predicate, because they are
 * states an OPEN card sits in. `pm:blocked` is deliberately not here — that is
 * the chain leg below, and it says something different: the target CAN close,
 * once its own blocker does.
 */
export const INDEFINITE_TARGET_LABELS = ['pm:on-hold', 'needs-user-decision'];

/**
 * H26 — null when every open target can still close on its own, else the
 * finding sentence.
 *
 * ## What an unjudged target does here, and why it is silent rather than loud
 *
 * A row whose `labels` is not an array is one this sweep could not read, and
 * every such target is ALREADY firing H19's unresolved branch on this very
 * card, with a sentence that says the liveness is unjudged. Repeating it here
 * would double-report one gap under two items; the #4690 duty is discharged,
 * once, in the item that owns it.
 *
 * @param {object} issue — an OPEN issue.
 * @param {{ key: string, number: number, local: boolean,
 *   state: 'open'|'closed'|'unresolved', labels?: string[]|null }[]} resolutions
 */
export function h26BlockOnIndefiniteTarget(issue, resolutions) {
  if (!needsBlockerLiveness(issue)) return null;
  const open = (resolutions ?? []).filter(
    (r) => r?.state === 'open' && Array.isArray(r.labels),
  );
  if (open.length === 0) return null;

  const indefinite = open
    .map((r) => ({ row: r, states: INDEFINITE_TARGET_LABELS.filter((l) => r.labels.includes(l)) }))
    .filter((r) => r.states.length > 0);
  // A target that is BOTH parked and blocked is named once, under the reading
  // that ends the wait forever rather than the one that merely lengthens it.
  const chained = open.filter(
    (r) => r.labels.includes('pm:blocked') && !indefinite.some((i) => i.row.key === r.key),
  );
  if (indefinite.length === 0 && chained.length === 0) return null;

  const parts = [];
  if (indefinite.length > 0) {
    const named = indefinite
      .slice(0, H19_TARGET_LIST_CAP)
      .map(
        ({ row, states }) =>
          `\`${row.local ? `#${row.number}` : row.key}\` (${states.map((s) => `\`${s}\``).join(' + ')})`,
      )
      .join(', ');
    const more =
      indefinite.length > H19_TARGET_LIST_CAP
        ? ` +${indefinite.length - H19_TARGET_LIST_CAP} more`
        : '';
    parts.push(
      `\`pm:blocked\` on ${indefinite.length} target(s) that can never CLOSE: ${named}${more}. ` +
        'The unlock predicate is "the `Blocked-by:` target closed", and `pm:on-hold` / ' +
        '`needs-user-decision` are by definition states a card sits in WHILE OPEN — so this ' +
        'block has NO MECHANISM THAT WILL EVER RELEASE IT. Every existing check passes on this ' +
        'card (the line is present, the target resolves, the target is open, the label is ' +
        'correct), which is why the measured instances were found by a human reading and by no ' +
        'gauge; H9 asks the mirror question about the HELD card and nothing asked about the ' +
        'WAITING one. ⚠️ Not a claim that the block is wrong — waiting on a deferred card is ' +
        'sometimes exactly right. It says the wait is indefinite BY CONSTRUCTION, so the release ' +
        'has to come from the target\'s own state changing (a ruling answered, a hold restarted) ' +
        'and someone has to want that.',
    );
  }
  if (chained.length > 0) {
    const named = chained
      .slice(0, H19_TARGET_LIST_CAP)
      .map((r) => `\`${r.local ? `#${r.number}` : r.key}\``)
      .join(', ');
    const more =
      chained.length > H19_TARGET_LIST_CAP ? ` +${chained.length - H19_TARGET_LIST_CAP} more` : '';
    parts.push(
      `The wait is TRANSITIVE: ${named}${more} ${chained.length === 1 ? 'is' : 'are'} itself ` +
        '`pm:blocked`, so this card is waiting on a card that is waiting. A single-level ' +
        'predicate cannot see past one hop, and the measured chain was real one level up and ' +
        'FALSE two levels up (the target was an H19 finding on the same sweep — both of ITS ' +
        'blockers had closed). This row does not chase the chain; it says to look one level ' +
        'further.',
    );
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// H27 — the claim is PERFECT and the claimant is gone (#11248).
//
// H20 above asks whether a dispatch ever HAPPENED, and keys on NO REMOTE REF AT
// ALL. This row asks the opposite-shaped question: the ref exists, the claim is
// textbook-correct, and nothing has moved since. The two are disjoint by
// construction — H20 fires only when no branch resolves, H27 only when one
// does — and neither could be widened into the other without losing the
// property that makes it safe.
//
// ## Why the ref EXISTS in the failure this row is built on
//
// The dev-agent definition makes pushing the empty branch the FIRST action of
// the task, before any edit, as a write-route probe (`.claude/agents/os-dev.md`
// rule 1). So an agent that dies at any point after its first minute — which is
// every point that matters — leaves a branch ON THE REMOTE. That protocol step
// is correct and worth keeping, but it has a side effect nobody priced: it
// converts the dead-agent case out of H20's population and into a population
// with no reader at all. The better the dev follows the protocol, the more
// invisible its death.
//
// ## The measured incident
//
// Three devs were dispatched concurrently and all three died at once on one
// shared-account capacity limit — fleet-wide exhaustion is a single point of
// failure for every agent in flight, so this arrives in batches, not singly.
// Each card was left `pm:dispatched`, assigned, carrying a claim comment whose
// first line is literally `Claim:`, naming a branch that exists. Every
// predicate in this file passed. Worse than merely unreported: the next PM's
// round-open mutual-exclusion read looks for the latest non-self `Claim:` on a
// lane's dispatched cards, so it reads those corpses as LIVE claims by another
// session and stays off them. The protocol's own mutual-exclusion mechanism
// converts a dead claim into a lane-wide block.
//
// ## Threshold: the protocol's own line, not a new heuristic
//
// SKILL.md already carries a stale-claim reclaim rule at 「认领 >~24h」, so this
// row mechanizes an existing protocol threshold rather than inventing a
// liveness distribution the fleet does not have (the filing card is explicit
// that 2 samples is not a distribution). The same 24 hours is already the seat
// -post patrol's own line — 「与既有回收线同一条」 — so the number has one
// source in the protocol and two readers, rather than two numbers.
//
// ⚠️ The protocol's reclaim rule and this row are NOT the same act, and the
// remedy sentence keeps them apart. That rule reclaims a claim whose branch
// does not exist, and it says 「有带提交活分支的认领永不回收」 — a claim whose
// branch carries commits is never reclaimed. This row fires on branches that DO
// exist, some of them carrying commits, so it deliberately prescribes the
// recovery INSPECTION and never the reclaim: reporting a card is not reclaiming
// it, and the row must not be readable as authority to drop an assignee the
// protocol protects.
// ---------------------------------------------------------------------------

/**
 * The protocol's own stale-claim line, in hours (SKILL.md 死认领回收). The one
 * threshold in this file that is QUOTED rather than measured — see the section
 * note above for why a measured one would be worse here.
 */
export const DEAD_CLAIM_STALE_HOURS = 24;

/** How old the governing claim is in HOURS — `null` when unreadable, as H20. */
export function claimAgeHours(claim, nowMs = Date.now()) {
  const minutes = claimAgeMinutes(claim, nowMs);
  return minutes === null ? null : minutes / 60;
}

/**
 * Which cards buy the branch-activity read — exported for the same reason
 * `h20NeedsRefProbe` is: a policy that decides what is READ AT ALL is where a
 * silent hole would live.
 *
 * A claim younger than the threshold is not stale, so it buys nothing and this
 * row says nothing about it either way. An UNREADABLE claim timestamp is
 * gathered rather than skipped — it must not read as fresh (#4690) — and the
 * predicate then declines to judge it out loud.
 */
export function h27NeedsClaimLivenessRead(issue, claim, nowMs = Date.now()) {
  if (!labelNames(issue ?? {}).includes('pm:dispatched')) return false;
  if (!claim || (claim.branches ?? []).length === 0) return false;
  const age = claimAgeHours(claim, nowMs);
  return age === null || age > DEAD_CLAIM_STALE_HOURS;
}

/**
 * Does any PR this sweep holds deliver card `n`? The delivery relation is
 * `prDeliversCard` — H8's, deliberately shared rather than re-derived, so the
 * two rows can never disagree about what "has a PR" means.
 *
 * Counted per channel because the two windows have different reach: the open
 * listing is effectively complete (paged to exhaustion), while the merged one
 * is a bounded recency window (`MERGED_WINDOW_PAGES`). That asymmetry is what
 * the finding sentence has to disclose, so it is preserved here rather than
 * collapsed into a boolean.
 */
export function claimDelivery(n, openPrs, mergedPrs) {
  const target = String(n);
  const open = (openPrs ?? []).filter((pr) => prDeliversCard(pr, target)).length;
  const merged = (mergedPrs ?? []).filter((pr) => pr?.merged_at && prDeliversCard(pr, target)).length;
  return { open, merged };
}

/**
 * Did this branch move AFTER the claim was posted? Three-valued, never two:
 * `true` / `false` / `null` when either timestamp is unreadable — an unread
 * comparison is not a "no" (#4690), and collapsing it would let one unparseable
 * date manufacture a finding about a card nobody measured.
 */
export function branchMovedSinceClaim(refState, claim) {
  const head = Date.parse(refState?.headCommittedAt ?? '');
  const posted = Date.parse(claim?.createdAt ?? '');
  if (!Number.isFinite(head) || !Number.isFinite(posted)) return null;
  return head > posted;
}

/**
 * H27 — null when clean, else the finding sentence.
 *
 * ## The conjunction, and why each term is load-bearing
 *
 *   `pm:dispatched`          the card still claims to be in flight
 *   claim older than 24h     the protocol's own stale line
 *   a claimed branch EXISTS  (else it is H20's row, not this one)
 *   NO branch moved since    the claim — nothing was pushed for this dispatch
 *   no PR delivers the card  neither open nor within the merged window
 *
 * ⛔ Dropping the branch-activity term would give exactly the PR-keyed row H20
 * refuses to be, and it is refused there for a measured reason: a dev inside a
 * long build legitimately has a ref and no PR for over an hour. That objection
 * is answered here by BOTH remaining terms and not by the threshold alone — a
 * dev 24 hours in with commits landing is excluded by branch activity, and a
 * dev with a PR open is excluded by delivery. What is left is a branch that has
 * not moved since it was claimed, with nothing to show for a day.
 *
 * ## What it under-reports, stated rather than discovered
 *
 * A dev that pushed one commit and THEN died is not reported: its branch moved
 * after the claim, so the activity term clears it. That is the measured shape
 * of one of the three incident cards, and widening the term to "no activity in
 * the last 24h" would catch it — at the cost of colliding with the protocol's
 * 「有带提交活分支的认领永不回收」, which is a rule about exactly that card.
 * Under-reporting on a card the protocol protects is the same call H17's
 * extractor and H20's branch-shape matcher make: a row a reader cannot act on
 * is worse than no row.
 *
 * @param {object} issue — an OPEN issue.
 * @param {{ branches: string[], createdAt: string|null }|null} claim
 * @param {{ branch: string, state: 'exists'|'absent'|'unreadable',
 *   headCommittedAt?: string|null }[]} refStates
 * @param {{ open: number, merged: number }} delivery — `claimDelivery`.
 */
export function h27DeadClaimNoProgress(issue, claim, refStates, delivery, nowMs = Date.now()) {
  if (!labelNames(issue ?? {}).includes('pm:dispatched')) return null;
  if (!claim || (claim.branches ?? []).length === 0) return null;
  const age = claimAgeHours(claim, nowMs);
  if (age !== null && age <= DEAD_CLAIM_STALE_HOURS) return null;

  const rows = refStates ?? [];
  if (rows.length === 0) return null;
  const present = rows.filter((r) => r.state === 'exists');
  // No ref at all is H20's row; an unreadable probe is H20's quieter one. This
  // row speaks only about branches it KNOWS are there.
  if (present.length === 0) return null;

  // A delivery in either channel ends the question: an open PR is live work (or
  // work already handed over), and a merged one is H8's row about a paired
  // write, never this row's about a dead agent.
  const { open = 0, merged = 0 } = delivery ?? {};
  if (open > 0 || merged > 0) return null;

  const moved = present.map((r) => branchMovedSinceClaim(r, claim));
  if (moved.some((m) => m === true)) return null;

  const named = namedBranches(present.map((r) => ({ branch: r.branch, state: r.state })));
  const recovery =
    ' Report-only, and pointedly NOT a reclaim: the protocol reclaims a claim whose branch does ' +
    'NOT exist and states 「有带提交活分支的认领永不回收」, so a row about a branch that DOES ' +
    'exist can never be authority to drop an assignee. The remedy is the post-kill recovery ' +
    'inspection (`references/dispatch-runbook.md`): probe the claimant, then read all THREE ' +
    'states — on the remote / on the container disk only / gone — and hand anything found to a ' +
    'replacement flagged UNVERIFIED. ⛔ Never a label written from this script.';

  if (moved.some((m) => m === null)) {
    return (
      `\`pm:dispatched\` with a complete claim naming ${named}, and whether that branch has MOVED ` +
      'since the claim could not be determined this sweep (an unreadable claim or head-commit ' +
      'timestamp) — so this dispatch is UNJUDGED, not confirmed healthy. Unread is not "no ' +
      'activity" and it is not "activity" either (#4690); a liveness comparison dropped in ' +
      'silence reads as a working dev forever, which is the exact failure this item exists to ' +
      'end. Read the branch and the claim by hand.' +
      recovery
    );
  }

  const reading =
    age === null
      ? 'an unreadable claim timestamp (which must not read as fresh)'
      : `~${Math.round(age)}h after the claim was posted (threshold ${DEAD_CLAIM_STALE_HOURS}h, the ` +
        "protocol's own stale-claim line)";

  return (
    `\`pm:dispatched\` with a PERFECT claim — assignee set, a first-line \`Claim:\` comment, and ` +
    `${named} present on the remote — that has NOT MOVED SINCE IT WAS CLAIMED, with no PR ` +
    `delivering the card, ${reading}. This is what a dev agent that DIED leaves behind, and the ` +
    'measured cause arrives in batches rather than singly: one shared-account capacity limit ' +
    'killed three concurrently-dispatched agents at once. ⭐ The card is indistinguishable from ' +
    'healthy in-flight work from the card itself — every field is correct, which is why no ' +
    'predicate here fired on it: H1 wants a missing assignee, H2 a missing claim comment, H8 a ' +
    'merged PR, and H20 no remote ref at all. H20 misses it BY CONSTRUCTION, not by accident: ' +
    'the dev-agent definition makes pushing the empty branch the first action of the task, so a ' +
    'protocol-compliant agent that dies still leaves a ref. Left unreported it does worse than ' +
    "sit there — the next PM's round-open mutual-exclusion read treats a dead `Claim:` as a live " +
    'claim by another session and stays off the card, so one dead agent blocks the lane. ⛔ Rule ' +
    'out one reading first: a delivery that merged BEFORE this sweep\'s merged window ' +
    `(${MERGED_WINDOW_PAGES} pages) is invisible here, so a card whose PR landed days ago and ` +
    'whose branch was never deleted can reach this row — check the card for a merged delivery ' +
    'before treating it as a death.' +
    recovery
  );
}

// ---------------------------------------------------------------------------
// H28 — the STALE BODY LINE that shadowed the live blocker (#11747).
//
// The body is the canonical home for `Blocked-by:`; a comment is a legal second
// channel, deliberately, because rewriting a body through the MCP escaping
// hazard is the riskier write. Those two facts are consistent right up to the
// moment a card is RE-PARKED, and then they collide: the seat that finds the
// body's upstream closed cards the real prerequisite, writes the NEW blocker
// into a comment — the cheap, safe write — and leaves the SPENT one in the
// body. The card is now stating two blockers, one of them a fact about the
// past, and the machinery cannot tell which is current from the line alone.
//
// ## Why ungating the liveness read is necessary and NOT sufficient
//
// Before `needsBlockerLivenessComments`, the liveness read borrowed H4's gate
// and so read only the body on exactly these cards: it resolved the closed
// target, found nothing else, and published "every target it names is closed:
// nothing this card declared a wait on is still running" — a false unlock
// candidate, three sweeps running, acted on once. Ungating fixes the falsehood:
// the same card now resolves both targets and H19 reports 1 of 2 closed, a
// PARTIAL discharge that says the card may still be legitimately blocked.
//
// But PARTIAL is where H19's duty ends. It reports the block, not the WRITE
// that produced the ambiguity, and it says nothing about which channel is
// carrying the live blocker — so the stale body line survives, and the next
// re-park writes the same shape again. This row is the pair: it names the body
// line as spent, names the live blocker sitting in a comment, and asks for the
// migration. That is what makes the canonical-home doctrine enforced rather
// than merely written down — the failure this whole card measured is a doctrine
// that existed in prose and was not complied with, and prose is what failed.
//
// ## The exact shape, and what it deliberately does NOT fire on
//
// Fires only on the CONJUNCTION: a body-named target that is CLOSED **and** a
// comment-named target, absent from the body, that is OPEN. Each half alone is
// a different, healthy-or-already-reported state:
//
//   - body closed, no live comment target -> H19's ordinary expired block. The
//     line is spent and so is the wait; there is nothing to migrate.
//   - body open + comment open -> two live blockers stated in two channels.
//     Untidy, not wrong, and no row: both are current, and demanding a body
//     rewrite for tidiness would push seats at the very write the comment
//     channel exists to avoid.
//   - a target named in BOTH channels -> not a migration candidate at all; the
//     body already carries it. Only a comment-ONLY live target can be missing
//     from the canonical home.
//   - an UNRESOLVED target on either side is silent here. H19 already fires the
//     unjudged sentence on that card (#4690), and a migration instruction built
//     on a target this sweep could not read would be a guess.
//
// ## Quota
//
// Free. H19 and H26 already hold these resolutions; this row asks the same rows
// a third question — which CHANNEL each target arrived in — which the sweep can
// answer from bodies it has already read.
//
// Report-only. The remedy is a body rewrite by the owning seat; ⛔ never a
// label or a body written from this script.
// ---------------------------------------------------------------------------

/**
 * The canonical keys a card names in ONE channel — the split H28 needs and the
 * only thing it adds to what H19 already computed.
 *
 * Deliberately built from the same `blockedByTargets` + `blockerTargetKey` pair
 * the union uses, rather than a second parser: a channel split that recognised
 * a different set of spellings than the union would report migrations for
 * targets the union never resolved.
 *
 * @returns {Set<string>} canonical `owner/repo#N` keys.
 */
export function blockerChannelKeys(text, issue, ownerRepo = OWNER_REPO) {
  const keys = new Set();
  for (const ref of blockedByTargets(text)) {
    const target = blockerTargetKey(ref, ownerRepo);
    if (!Number.isFinite(target.number)) continue;
    if (target.local && target.number === issue?.number) continue;
    keys.add(target.key);
  }
  return keys;
}

/**
 * H28 — null when the body's line is not shadowing a live comment-borne
 * blocker, else the finding sentence.
 *
 * @param {object} issue — an OPEN issue.
 * @param {{ key: string, number: number, local: boolean,
 *   state: 'open'|'closed'|'unresolved', closedAt?: string|null }[]} resolutions
 * @param {string[]|null|undefined} commentBodies — as gathered for the liveness
 *   read. `undefined`/`null` contribute no comment channel, so no row.
 */
export function h28StaleBodyBlockerLine(issue, resolutions, commentBodies, ownerRepo = OWNER_REPO) {
  if (!needsBlockerLiveness(issue)) return null;
  const rows = resolutions ?? [];
  if (rows.length === 0) return null;

  const bodyKeys = blockerChannelKeys(issue?.body, issue, ownerRepo);
  const commentKeys = new Set();
  for (const body of commentBodies ?? []) {
    for (const key of blockerChannelKeys(body, issue, ownerRepo)) commentKeys.add(key);
  }
  if (bodyKeys.size === 0 || commentKeys.size === 0) return null;

  const spent = rows.filter((r) => r.state === 'closed' && bodyKeys.has(r.key));
  const live = rows.filter(
    (r) => r.state === 'open' && commentKeys.has(r.key) && !bodyKeys.has(r.key),
  );
  if (spent.length === 0 || live.length === 0) return null;

  return (
    `\`pm:blocked\` whose BODY names ${spent.length} CLOSED \`Blocked-by:\` target(s) ` +
    `(${namedTargets(spent)}) while a COMMENT names ${live.length} that ${live.length === 1 ? 'is' : 'are'} ` +
    `still OPEN (${namedTargets(live)}) and appear(s) nowhere in the body — so the body line is ` +
    'STALE: it states a wait that is over, and the wait that is actually running is parked in the ' +
    'channel the body is supposed to be the canonical home for. This is the written half of a ' +
    'RE-PARK: a seat found the body\'s upstream closed, carded the real prerequisite, and wrote ' +
    'the new blocker into a comment (the cheaper, safer write) without spending the body line. ' +
    '⚠️ Read what that costs before the migration: until the liveness read was ungated this card ' +
    'resolved ONLY the closed body target and was published as a card whose every blocker had ' +
    'closed — a FALSE unlock candidate, and one such card was released to `pm:queue` while its ' +
    'real blocker was open and dispatched. The row now fires alongside H19\'s PARTIAL discharge ' +
    'rather than instead of it: H19 says the block is half-expired, this says WHICH half is ' +
    'documentation. Remedy: rewrite the body line to name the live blocker (the comment stays as ' +
    'history), so the next reader — human or sweep — finds the current wait in the canonical ' +
    'home. ⛔ Report-only: never a body or a label written from this script.'
  );
}

// ---------------------------------------------------------------------------
// H32 — a HELD seat sitting idle over a non-empty lane queue (#11706).
//
// Every other row here watches a CARD or a PR. This one watches the SEAT, and
// it is the first: the patrol could see a card that nobody moved and could not
// see a lane whose seat had stopped moving it. The filing seat reported its own
// defect — it ended round after round with 「要我继续派吗?」 while in-flight was
// zero and 40+ dispatchable cards sat in its queue — against a skill clause that
// already says ⛔ 不等人闸 in as many words. So ⛔ this row adds no prose rule:
// the rule is not missing, the DETECTABILITY was (「规则不缺,措辞也不含糊」).
//
// ## The shape, and why it is the same two-signals-unpaired register as the rest
//
// The board asserts two things that cannot both be healthy: a lane that has
// dispatchable work and nothing in flight, and a seat that declares itself HELD.
// Either one alone is ordinary — an empty lane is a finished lane, and a held
// seat with work in flight is a working seat. Together they say the lane's
// throughput is zero while someone is on the clock for it, which is invisible
// from any single card: every queued card looks exactly like an ordinary queued
// card (that is H30's whole point), and the seat post looks exactly like a seat
// post.
//
// ## The threshold, derived the H30 way — from the measured distribution
//
// Grading declined to let this number be guessed and named the precedent
// (`QUEUE_ROT_STALE_DAYS`, derived from the live queue-age distribution). So it
// is measured, from the quantity the card itself names — the gap between one
// claim and the next on a lane that is working.
//
// Census, 2026-08-25, every `Claim:` comment on the six active objectstack
// lanes' open `pm:dispatched` cards plus the recently-closed window (n = 169
// inter-claim gaps, per-lane then pooled):
//
//   p50 7 min · p75 41 min · p90 324 min · p95 731 min · max 6073 min
//
// The distribution is BIMODAL and reading it as one hump is the trap: inside a
// dispatch wave a seat claims a batch minutes apart (hence p50 = 7), and between
// waves it goes quiet for hours. The upper mode is the one this threshold has to
// clear. Inspected individually, all 12 gaps above 480 min span a shift boundary
// or a night — `domain:devx` 2026-08-19T11:48 → 08-23T17:01, `domain:engine`
// 08-24T15:22 → 08-25T01:47 across a 收班/开轮 pair — i.e. NOT an active seat
// pausing, which is the population this row must never report. Nothing measured
// between waves WITHIN a held shift reached 480.
//
// 480 minutes (8h) therefore sits above the whole measured active-seat tail and
// below the cross-shift band that dominates everything past it. The patrol fires
// four times a day, so an idle seat surfaces on the second sweep after the
// threshold passes — a detection latency well inside the shift it is wasting.
//
// ⚠️ The threshold is the LAST gate, not the main one. Three structural gates in
// front of it do the real narrowing, and they are why this number can be this
// tight without manufacturing accusations. A false 怠工 row costs a working seat
// an argument; a late one costs six hours. The asymmetry is deliberate.
//
// ## Legitimate waits are excluded STRUCTURALLY, never by the threshold
//
// Grading was explicit: a seat whose latest marker names a live blocker (等 CI /
// 等裁决 / 等人工步骤, or an awaiting-class state) is exempt REGARDLESS of
// elapsed time. That is the difference between a seat that is idle and a seat
// that is waiting, and no amount of clock can tell them apart — only the seat's
// own declaration can. So the exemption is a read of the latest marker, and it
// is unbounded: a seat blocked for three days is not reported by this row.
// ---------------------------------------------------------------------------

/**
 * H32's idleness horizon — 8 hours, derived in the header above from the
 * measured inter-claim distribution rather than chosen. Minutes rather than
 * days (H30's unit) because the quantity it bounds is a within-shift interval:
 * a seat's round is hours long, and a horizon in days could not fire inside the
 * shift it is about.
 */
export const SEAT_IDLE_STALE_MINUTES = 480;

/**
 * Markers that put a seat in a DECLARED WAIT — the structural exemption, read
 * off the seat's latest marker and unbounded by time.
 *
 * A closed set of measured terms, in `H17_TRIGGER_ANCHOR_TERMS`'s register and
 * for its reason: an invented spelling would exempt nothing that exists, and a
 * loose one would exempt everything. Both spellings of each wait are carried
 * because seat posts are written in both languages and neither is canonical.
 *
 * ⚠️ Under-matching here FIRES the row on a seat that really is waiting, which
 * is the expensive direction — so this list is the one part of H32 that should
 * grow the moment a seat is seen declaring a wait in a spelling it lacks.
 */
export const SEAT_WAIT_MARKERS = [
  '等 ci',
  '等ci',
  '等裁决',
  '等待裁决',
  '等人工',
  '等维护者',
  '等人合',
  '决策箱',
  'awaiting',
  'awaiting-maintainer',
  'blocked',
  'blocked-by',
  'needs-user-decision',
  'waiting on ci',
  'waiting for ci',
  'waiting on a ruling',
  'waiting on the maintainer',
];

/**
 * Does this seat marker declare a live wait? Case-folded substring over the
 * marker body — deliberately LOOSER than the anchored first-line reads
 * elsewhere in this file, because the asymmetry runs the other way here: a
 * missed exemption is a false accusation against a working seat, while an
 * over-eager one merely keeps this row quiet on a seat a human can still see.
 */
export function seatDeclaresWait(markerBody) {
  const text = String(markerBody ?? '').toLowerCase();
  return SEAT_WAIT_MARKERS.some((term) => text.includes(term));
}

/**
 * The lane a seat post speaks for, parsed from its title, plus whether that
 * lane is READABLE FROM THIS BOARD.
 *
 * Seat titles are `[PM seat] <lane> — <status>`, and the lane half is one of
 * three measured shapes (2026-08-25 census, all 12 open seat posts):
 *
 *   `domain:engine`               — a lane on THIS board
 *   `domain:devx @ objectui`      — a lane on a SIBLING board
 *   `repo:cloud` / `skills` / `triage (objectstack-wide)`
 *
 * The `foreign` flag is the load-bearing half and it exists for the same reason
 * H19 refuses to guess at a cross-repo 404: this sweep reads ONE repo. A seat
 * whose lane lives in a sibling repo has an inventory this patrol cannot see at
 * all, so its queue reads as EMPTY here — and an empty queue makes this row
 * silent, which is the harmless direction, but only by accident. Naming the
 * class keeps the accident from turning into a finding the day the counting
 * changes. `repo:*`-scoped and lane-less seats (`triage`) are foreign for the
 * same reason: there is no `domain:*` label to count a lane inventory against.
 *
 * @returns {{ lane: string|null, foreign: boolean }}
 */
export function seatLane(issue) {
  const m = /^\[PM seat\]\s*(.*?)\s*—\s*(.*)$/u.exec(issue?.title ?? '');
  if (!m) return { lane: null, foreign: true };
  const raw = m[1].trim();
  // An `@ <repo>` suffix names the board the lane lives on. Present ⇒ the lane
  // is only READABLE there, whatever its `domain:*` spelling says here.
  const at = /^(.*?)\s*@\s*(\S+)\s*$/u.exec(raw);
  const lane = (at ? at[1] : raw).trim();
  const elsewhere = at ? at[2] !== SWEEP_REPO.repo.split('/')[1] : false;
  if (!/^domain:[a-z0-9][a-z0-9._-]*$/i.test(lane)) return { lane: null, foreign: true };
  return { lane, foreign: elsewhere };
}

/**
 * Is this seat post declaring a HELD seat — a 🟢 with a real holder?
 *
 * Reuses `h5SeatStickerDesync`'s reading of the status word rather than
 * re-deriving it, so the two items can never disagree about what 🟢 means. A
 * ⏳ vacant / 🔴 收班 vacant / ⏸️ paused seat is deliberately OUT of scope: an
 * unheld seat over a non-empty queue is a ROUTING gap (nobody is on the clock),
 * not the 怠工 this row is about, and reporting it here would put an accusation
 * on a seat that has correctly said it is not working. The queue cards
 * themselves are H30's population and are reported there, on their own terms.
 *
 * `Routine` seats are held by a scheduled caller with no claim cadence of their
 * own, so they are excluded on the same grounds `h5SeatStickerDesync` excludes
 * them from the assignee comparison.
 */
export function seatIsHeld(issue) {
  const m = /^\[PM seat\]\s*(.*?)\s*—\s*(.*)$/u.exec(issue?.title ?? '');
  if (!m) return false;
  const status = m[2].trim();
  if (!status.startsWith('🟢')) return false;
  const holder = status.replace('🟢', '').trim().split(/\s+/u)[0] ?? '';
  return holder.length > 0 && holder !== 'Routine';
}

/**
 * The seat's latest utterance — the marker whose age is this row's clock and
 * whose text carries the wait exemption.
 *
 * Recency is `created_at` with a THREAD-ORDER fallback, exactly as
 * `governingClaim` resolves it and for the same reason: an unparseable stamp
 * must not silently promote an older comment to "latest". An unreadable stamp
 * yields a `null` age, which the predicate treats as "must not read as fresh"
 * — H10/H13/H18/H20's standing call on an unreadable timestamp (#4690).
 *
 * @param {{ body?: string, created_at?: string }[]} commentRows
 * @returns {{ body: string, createdAt: string|null } | null}
 */
export function latestSeatMarker(commentRows) {
  const rows = Array.isArray(commentRows) ? commentRows : [];
  let best = null;
  rows.forEach((row, index) => {
    const parsed = Date.parse(row?.created_at ?? '');
    const stamp = Number.isFinite(parsed) ? parsed : null;
    const candidate = { body: String(row?.body ?? ''), createdAt: row?.created_at ?? null, stamp, index };
    if (best === null) {
      best = candidate;
      return;
    }
    const newer = stamp === null || best.stamp === null ? index > best.index : stamp >= best.stamp;
    if (newer) best = candidate;
  });
  return best === null ? null : { body: best.body, createdAt: best.createdAt };
}

/** How old the seat's latest marker is, in minutes — `null` when unreadable (#4690). */
export function seatMarkerAgeMinutes(marker, nowMs = Date.now()) {
  const posted = Date.parse(marker?.createdAt ?? '');
  return Number.isFinite(posted) ? (nowMs - posted) / 60_000 : null;
}

/**
 * Which seat posts buy a comment fetch — exported for the reason every
 * gathering policy here is: a policy that decides what gets READ AT ALL is
 * where a silent hole would live.
 *
 * A HELD seat on a lane THIS board can count, and nothing else. The `foreign`
 * and unheld cases are decided from the title alone, so the fetch is bought
 * only for seats this row could actually speak about — 6 of the 12 open seat
 * posts at the 2026-08-25 census, and the only comment fetches the seat
 * population has ever bought (the H2 branch explicitly skips `pm:seat`).
 */
export function h32NeedsSeatComments(issue) {
  if (!labelNames(issue ?? {}).includes('pm:seat')) return false;
  if (!seatIsHeld(issue)) return false;
  return !seatLane(issue).foreign;
}

/**
 * H32 — null when clean, else the finding sentence.
 *
 * @param {object} issue — the seat post.
 * @param {{ body: string, createdAt: string|null }|null|undefined} marker —
 *   the latest seat-post comment. `undefined` unconsulted, `null` unreadable.
 * @param {{ unclaimed: number, inFlight: number }} lane — the lane inventory,
 *   counted off listings this sweep already holds.
 */
export function h32SeatIdleOverQueue(issue, marker, lane, nowMs = Date.now()) {
  if (!labelNames(issue ?? {}).includes('pm:seat')) return null;
  if (!seatIsHeld(issue)) return null;
  const { lane: laneName, foreign } = seatLane(issue);
  if (foreign || !laneName) return null;

  const unclaimed = Number(lane?.unclaimed ?? 0);
  const inFlight = Number(lane?.inFlight ?? 0);
  // The board half. Both halves are required: an empty queue is a finished
  // lane, and work in flight is a working seat.
  if (!(unclaimed > 0 && inFlight === 0)) return null;

  // An unconsulted or unreadable thread declines to judge rather than firing.
  // The asymmetry against H4 (which fires on an unreadable channel) is
  // deliberate and runs on the same rule H4 states: H4's remedy is "add a
  // line", cheap and idempotent, so an unreadable channel can safely fire it.
  // This row's output is an accusation that a named holder is not working, and
  // an unread thread is exactly where a declared wait would have been. Firing
  // blind here would manufacture the false positive the wait exemption exists
  // to prevent.
  if (marker === undefined || marker === null) return null;
  if (seatDeclaresWait(marker.body)) return null;

  const age = seatMarkerAgeMinutes(marker, nowMs);
  if (age !== null && age <= SEAT_IDLE_STALE_MINUTES) return null;
  const clock =
    age === null
      ? 'an unreadable marker timestamp (which must not read as fresh)'
      : `~${Math.round(age)} min since the seat's latest marker (threshold ${SEAT_IDLE_STALE_MINUTES} min)`;

  return (
    `\`pm:seat\` HELD, and its lane \`${laneName}\` has ${unclaimed} unclaimed \`pm:queue\` card(s) with ` +
    `NOTHING in flight — ${clock}. The board is asserting two things that cannot both be healthy: a lane ` +
    'with dispatchable work and zero throughput, and a named holder on the clock for it. Neither half is ' +
    'visible from any card — a queued card looks exactly like an ordinary queued card however long it has ' +
    'been one (H30), and a seat post looks exactly like a seat post — which is why the measured incident ' +
    'was reported by the seat ITSELF and by no gauge: it ended round after round with 「要我继续派吗?」 ' +
    'while in-flight was zero and 40+ dispatchable cards sat in the queue, against a clause that already ' +
    'says ⛔ 不等人闸 in as many words. ⛔ So this row is NOT a new rule and must not be read as one — the ' +
    'rule is not missing, the detectability was (「规则不缺,措辞也不含糊」). ⚠️ A DECLARED wait is exempt ' +
    'here regardless of elapsed time: a latest marker naming 等 CI / 等裁决 / 等人工步骤 or an ' +
    'awaiting-class state silences this row, so a seat that IS waiting states it and is not reported. ' +
    'That is also the remedy when this fires and the wait is real — say what it is waiting on, in the ' +
    'marker. Otherwise the move is the one the clause already names: dispatch the next wave, or hand the ' +
    'seat over and mark it vacant so the lane reads as unheld rather than held-and-still. Report-only: ' +
    '⛔ never a label, a title or a marker written from this script — which of those two moves applies is ' +
    'the whole judgement.'
  );
}

// ---------------------------------------------------------------------------
// H33 — an in-flight claim written BEFORE the ruling that now stands (#11724).
//
// The filing seat skipped the mandatory decision re-read under speed-up and
// wrote a dispatch order that INVERTED a standing triage ruling — the ruling
// scoped the work to option 1 executed as a sweep and said in as many words
// that options 2/3 were 「file, don't fold in」; the order forbade the sweep and
// pointed the dev at 2/3. The dev followed the LATER ruling (correct) and
// reported the conflict, seeing one of the three contradictions.
//
// ⛔ Like H32 this adds no rule. The step exists, and the same session had
// already been saved by it twice that day — two cards whose bodies said 「A/B
// 未决」 while triage had long since ruled direction A in a COMMENT. Grading
// declined the other half of the card's remedy menu (a mandatory
// `Prior rulings read:` claim field) on the card's own reasoning: a field 99%
// filled with `none` is ritual, and a ritual field is as untrustworthy as none.
// What it promoted is this — structurally decidable, no threshold, no ritual,
// and silent on the overwhelming majority of cards, which carry no ruling at all.
//
// ## What the row actually asserts, precisely
//
// NOT "the dispatcher failed to read" — that is unobservable. What is observable
// is an ORDERING: the claim that put this card in flight is older than a ruling
// now standing on its thread. The dispatch order therefore cannot carry that
// ruling's constraints, whether it was written blind to a ruling already there
// or overtaken by one posted after. Both readings have the same consequence and
// the same remedy, which is why the row does not try to tell them apart: a dev
// is working from an order that predates the current ruling, and somebody has to
// re-read before the work lands rather than after.
//
// Same two-signals-unpaired register as the rest: a standing ruling and an
// in-flight claim, which should be paired and are not.
//
// ## Measured yield — a LOW-yield row, and silence is its normal reading
//
// Run over the live board on 2026-08-25 it reports NOTHING: of 54 open
// `pm:dispatched` cards, 27 carry no claim this file's marker can read (see
// `latestClaimComment`'s blind-spot note), 4 carry no ruling at all, and on the
// remainder every ruling PRECEDES its claim — which is the healthy ordering and
// exactly what the row wants to see.
//
// That a check reports nothing today is worth distinguishing from a check that
// CANNOT report anything — H30's header makes the point, and it is the reason
// this number was measured rather than assumed. Over the recently-closed window
// the shape is real and rare: 4 of the 107 closed cards carrying a readable
// claim have a ruling posted after it (#11781, #11673, #11106, #10166; the gaps
// run 8 min to ~17 h). So the expected steady state is a quiet row that fires a
// few times a week, in H23's register (~6 in 1,546) rather than H30's.
// ---------------------------------------------------------------------------

/**
 * What counts as a TRIAGE RULING comment — a closed set of measured opening
 * shapes, in `H17_TRIGGER_ANCHOR_TERMS`'s register and for its reason.
 *
 * Census of every comment on 40 open `pm:dispatched` cards (2026-08-25), by
 * first non-empty line with markdown decoration stripped:
 *
 *   `Triage: lands in …` · `Triage routing: domain:skills + finding` ·
 *   `Triage (first-touch grading): …` · `Triage (Routine seat, hourly round): …` ·
 *   `Triage: → decision inbox …` · `Concentrated triage batch: …` ·
 *   `Concentrated triage batch (final tail): …` · `Concentrated triage round: …` ·
 *   `Skills-lane self-triage (run-to-empty fire): …` · `Grading (skills seat, …)` ·
 *   `Maintainer ruling — option 1: …`
 *
 * Anchored at the START of the first line, never a substring of the body, and
 * the reason is measured too: the same census carries 「Serial-constraint
 * addendum … the triage comment above」 and 「⚠️ Section 3's REST-fallback claim
 * needs qualifying」 — prose that MENTIONS a ruling or a claim without being
 * one. A contains-match would read both as rulings and manufacture a row on
 * every card that discusses its own triage. Under-reporting on an unrecognised
 * spelling is H17's and H20's standing call, for H20's stated reason: a
 * fabricated row sends a reader to check something that was never there.
 */
export const TRIAGE_RULING_ANCHORS = [
  /^triage\b/iu,
  /^concentrated\s+triage\b/iu,
  /^[\w:@.-]+[\s-]lane\s+self-triage\b/iu,
  /^grading\b/iu,
  /^maintainer\s+ruling\b/iu,
];

/**
 * Is this comment body a triage ruling? Read from its FIRST non-empty line,
 * with markdown decoration stripped — seats bold and blockquote these openings
 * (「**Triage: …**」, 「> Triage routing: …」) and the decorated-directive lesson
 * H4 paid for (#10102) applies verbatim.
 */
export function isTriageRulingComment(body) {
  const first = String(body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return false;
  const bare = first.replace(/^[>\s]*/u, '').replace(/[*_`#]/gu, '').trim();
  return TRIAGE_RULING_ANCHORS.some((re) => re.test(bare));
}

/**
 * The newest `Claim:` comment on a thread, WITH its timestamp — and
 * deliberately not `governingClaim`, which is the same read narrowed to claims
 * that name a protocol-shaped BRANCH.
 *
 * That narrowing is right for H20/H27, whose whole question is about the branch
 * a claim names. It would be wrong here and would silently empty this row's
 * population: the measured claim census carries 「Claim: PM loop round R6」 — a
 * well-formed claim naming no branch of its own — and the shape is still live.
 * Re-measured 2026-08-27 over 161 pm-tracked cards and every comment on them:
 * of 19 canonical claim comments, 3 name no protocol-shaped branch, and on 3
 * cards this row reads a claim `governingClaim` cannot (「Claim: PM loop round 1
 * (QA wave #9296)」 is one). What this row needs from a claim is only WHEN it
 * was written.
 *
 * ⛔ A second specimen used to stand beside the first — 「Claim pointer: folded
 * into the 11678 family dispatch」, offered as another well-formed branchless
 * claim. It is not one, and it is not in this row's population at all:
 * `CLAIM_COMMENT_MARKER` wants the colon directly after the word, and here the
 * word is followed by ` pointer`, so the marker has never matched it. Under the
 * same 2026-08-11 ruling that governs the dash spellings it is a MALFORMED
 * claim — and unlike those it is invisible to H34 as well, which reports only a
 * punctuation separator (that gap was measured and deliberately left open; see
 * H34's header). The paragraph's conclusion is unaffected: it rests on the
 * first specimen, which is real, and on the live count above.
 *
 * ## ⚠️ The inherited blind spot, and what it is NOT (#12090)
 *
 * `CLAIM_COMMENT_MARKER` requires the canonical colon, and some live claims are
 * written with an em dash instead (「Claim — <seat>, session …」), which the
 * marker does not match. Those cards are invisible to this row.
 *
 * ⛔ They are NOT well-formed claims in a dialect this file fails to read. The
 * maintainer's 2026-08-11 ruling makes the literal `Claim:` the single machine
 * criterion and closes the widening explicitly (SKILL.md step 4, quoted in full
 * at `CLAIM_COMMENT_MARKER`), so a dash-written claim is MALFORMED and the
 * repair is the write side. This paragraph used to call them 「real claims,
 * correctly formed」 — a straight contradiction of the protocol this file
 * enforces, and the exact shape of drift the strictness exists to prevent.
 *
 * Inherited on purpose rather than patched here. Defining a second, WIDER
 * notion of "a claim" for H33 alone would leave the file disagreeing with
 * itself about what a claim IS — H2 would go on calling those cards claimless
 * while H33 read their claims off the same threads — and a file that
 * contradicts itself about its own vocabulary is a worse defect than the gap.
 * The consequence here is UNDER-reporting, which is the direction this file
 * takes on every unrecognised spelling (H17's extractor, H20's branch shape),
 * never a fabricated row.
 *
 * Where those claims DO surface is H34, which reports the near miss as its own
 * observation and points the seat at the canonical spelling — visibility
 * without redefining the vocabulary.
 *
 * @param {{ body?: string, created_at?: string }[]} commentRows
 * @returns {{ createdAt: string|null } | null}
 */
export function latestClaimComment(commentRows) {
  const rows = Array.isArray(commentRows) ? commentRows : [];
  let best = null;
  rows.forEach((row, index) => {
    if (!CLAIM_COMMENT_MARKER.test(String(row?.body ?? ''))) return;
    const parsed = Date.parse(row?.created_at ?? '');
    const stamp = Number.isFinite(parsed) ? parsed : null;
    const candidate = { createdAt: row?.created_at ?? null, stamp, index };
    if (best === null) {
      best = candidate;
      return;
    }
    const newer = stamp === null || best.stamp === null ? index > best.index : stamp >= best.stamp;
    if (newer) best = candidate;
  });
  return best === null ? null : { createdAt: best.createdAt };
}

/**
 * H33 — null when clean, else the finding sentence.
 *
 * Both timestamps must be READABLE for the row to fire, and that is the one
 * place this item declines where its neighbours insist. Elsewhere an unreadable
 * stamp must not read as fresh, because there the stamp is an AGE and the
 * conservative reading is "old". Here the stamp is one side of an ORDER
 * comparison, and an unreadable one does not make the comparison conservative —
 * it makes it undefined. A row asserting that a claim predates a ruling, built
 * on a stamp nobody could read, would be a fabricated ordering, which is worse
 * than a missing row (#4690 cuts the other way when the unread datum is not the
 * finding but its evidence).
 *
 * @param {object} issue — an OPEN issue.
 * @param {{ body?: string, created_at?: string }[]|null|undefined} commentRows
 */
export function h33ClaimPredatesRuling(issue, commentRows) {
  if (!labelNames(issue ?? {}).includes('pm:dispatched')) return null;
  if (!Array.isArray(commentRows)) return null;
  const claim = latestClaimComment(commentRows);
  const claimStamp = Date.parse(claim?.createdAt ?? '');
  if (!Number.isFinite(claimStamp)) return null;

  const rulings = commentRows
    .filter((row) => isTriageRulingComment(row?.body))
    .map((row) => ({ at: row?.created_at ?? null, stamp: Date.parse(row?.created_at ?? '') }))
    .filter((r) => Number.isFinite(r.stamp) && r.stamp > claimStamp)
    .sort((a, b) => b.stamp - a.stamp);
  if (rulings.length === 0) return null;

  const newest = rulings[0];
  return (
    `\`pm:dispatched\` whose latest \`Claim:\` comment (${claim.createdAt}) PREDATES ` +
    `${rulings.length} triage-ruling comment(s) on this same card, the newest posted ${newest.at} — so ` +
    'the order this card is in flight under was written before the ruling that now stands on its thread, ' +
    'and cannot be carrying that ruling\'s constraints. ⚠️ The row asserts an ORDERING, not a state of ' +
    'mind: whether the dispatcher wrote blind to a ruling already there or was overtaken by one posted ' +
    'after is not observable and does not change the remedy. The measured cost of the first reading: a ' +
    'dispatch order INVERTED a standing ruling — the ruling scoped the work to option 1 executed as a ' +
    'sweep and said 「file, don\'t fold in」 about options 2/3, and the order forbade the sweep and ' +
    'pointed the dev at 2/3. The dev followed the later ruling and reported the conflict, seeing one of ' +
    'three contradictions. Remedy: re-read the ruling against the dispatch order NOW, while the work is ' +
    'still in flight and the correction is a message rather than a rollback — and if they disagree, say ' +
    'so on the card so the dev is not left arbitrating between two orders. ⛔ This is not a new rule: the ' +
    're-read step exists, and the same session it failed on had already been saved by it twice that day. ' +
    'Report-only: ⛔ never a label written from this script.'
  );
}

// ---------------------------------------------------------------------------
// H34 — a claim-shaped comment with a NON-CANONICAL SEPARATOR (#12090).
//
// The card that filed this measured 24 of 54 open `pm:dispatched` cards
// carrying 「Claim — <seat>, session …」 with an EM DASH, invisible to
// `CLAIM_COMMENT_MARKER`, and proposed widening the class. That proposal is
// CLOSED, and this row is what was taken instead.
//
// ## Why the predicate is not widened — the ruling, verbatim
//
// `.claude/skills/pm-dispatch/SKILL.md` (step 4 of the claim protocol) records
// 「首行以字面 `Claim:` 开头是机器判据(维护者 2026-08-11 裁定;巡查谓词只认这
// 一个拼写且保持严格,修法是全舰队向文档拼写收敛,⛔ 不放宽谓词)」. Under that
// ruling a dash-written claim is a MALFORMED claim, H2's row on it is a CORRECT
// report, and the repair is the write side converging on the documented
// spelling. Widening the reader would make the enforced protocol drift away
// from the written one permanently — the declared-≠-enforced shape this repo
// treats as a defect everywhere else — and would do it by editing a maintainer
// ruling's own text, which is not a patrol script's call.
//
// ## …and why the gap is nevertheless real, which is what this row closes
//
// The cost the card found is not only H2's loudness. `governingClaim` gates on
// the same marker before reading `Branch:`, so a card claimed with a dash buys
// no ref probe and can never produce an H20 「no remote ref」 or H27 「dead
// claim」 row: it sits OUTSIDE dispatch-liveness entirely, silently, for as long
// as it is in flight. H33 inherits the same blindness. So the malformed claim
// costs one noisy row and three quiet ones, and the quiet ones are the
// expensive direction.
//
// This row makes the malformed spelling VISIBLE without redefining what a claim
// is. `Claim:` stays the single machine criterion — H2/H20/H27/H33 are
// untouched, byte for byte — and the near miss is reported as its own,
// separately-named observation whose remedy points at the canonical spelling.
// The file therefore never disagrees with itself about its own vocabulary,
// which is the objection that kept the gap open.
//
// ## Measured, fresh, at dispatch time (2026-08-25 ~15:00Z)
//
// Over the LIVE open `pm:dispatched` population (45 cards): 40 colon-form,
// 1 dash-only, 0 hyphen, 0 fullwidth, 4 with no claim in any spelling. The
// filing card's 24-of-54 has already decayed to 1-of-45 in a day — the
// maintainer's prescribed convergence is working, which is precisely why the
// widening was not worth a ruling. Over the 128 `pm:dispatched` cards closed
// since 2026-08-24 the shape is recurring rather than historical: 13 dash-only
// claims, clustered in identifiable seat batches. So this row's expected steady
// state is quiet — H23's register, not H30's — and its value is that a seat
// writing the wrong spelling learns about it while the card is still in flight,
// which is how a fleet converges.
//
// ## Deliberately NOT the whole near-miss space
//
// Two suppressions, both under-reporting on purpose (H17's and H20's standing
// direction — a fabricated row sends a reader to check something that was never
// there):
//
//   • A thread that ALSO carries a canonical claim is silent here. That card is
//     machine-visible, so the row would have no remedy to offer. The residual
//     it accepts: a RE-claim written with a dash over an older colon claim
//     leaves `governingClaim` reading the stale one. Narrower than the shape
//     this row is for, and naming it would cost a row on every card that ever
//     wrote a dash claim once.
//   • A claim-shaped line whose remainder carries none of the protocol's own
//     content (a session reference, the word "seat", or a protocol-shaped
//     branch anywhere in the comment) is silent. 「Claim - see above」 in prose
//     is not evidence that a claim was attempted.
//
// ## The WORD position — measured 2026-08-27, and NOT widened
//
// A filed finding asked whether the separator class should cover a WORD where
// the punctuation goes, on the strength of 「Claim pointer: folded into the
// 11678 family dispatch」 — a string `latestClaimComment`'s header cited as a
// claim the marker reads, which it never was. Measured before answering,
// because the header above says this row's strictness was paid for once and
// a widening is exactly what it was paid to prevent.
//
// The census: 161 pm-tracked cards — 13 open `pm:dispatched`, 76 open
// `pm:queue`, 72 `pm:dispatched` closed since 2026-08-26 — and all 343 comments
// on them, classified by what follows a line-opening claim word. 19 canonical
// `Claim:`; 2 with a declared punctuation separator (both EM DASH, both on
// threads with no canonical claim — this row's live population, and it fires);
// and ZERO with a distinct word in the separator position. The 「Claim pointer:」
// specimen occurs nowhere on the board: its only live instance is the finding
// card quoting this file quoting it.
//
// So the widening buys nothing measurable, and it would spend the conservative
// half's whole margin to buy it. `Claim` followed by a word is ordinary English
// — 「Claiming this card」, 「Claim comments are …」 — where `Claim` followed by
// an em dash is not; `looksLikeClaimContent` would carry that load for a
// population of zero. RECORDED, NOT WIDENED.
//
// The same census found three OTHER shapes invisible to both markers, recorded
// so a later reader can reopen the question on numbers instead of re-measuring
// — and each is already harmless for a DIFFERENT reason, which is the actual
// finding:
//
//   • 2 「Claim (dev): …」 openings. Both threads ALSO carry a canonical claim,
//     so the first suppression above already covers them: they are a SECOND
//     claim comment on a machine-visible card, never a substitute for one.
//   • 2 inflected openings (「Claiming this card. session …」) and 1 decorated
//     with backticks (「`Claim:` devx@objectstack seat …」). All three sit on
//     UNASSIGNED cards, which this row and H2 both decline to judge — the
//     residual already declared above.
//
// Three different shapes, three different reasons, none of them this one. Each
// is its own question with its own noise floor if it ever acquires a population.
// ---------------------------------------------------------------------------

/**
 * The separators a claim-shaped line is measured to carry INSTEAD of the
 * canonical colon, each with the name the row prints. Codepoints are spelled
 * out rather than pasted: these characters are visually near-identical to each
 * other and to the colon, and a row that says 「EM DASH (U+2014)」 tells a seat
 * what to search for in a way a rendered glyph cannot.
 *
 * U+FF1A is here, and it is the reason it can be: the claim marker's class
 * looked like it accepted it for the whole of this file's life and never did
 * (see `CLAIM_COMMENT_MARKER`). In a protocol whose own SKILL.md is written in
 * Chinese, 「Claim：」 is a plausible spelling; it was invisible to every reader
 * and is now merely non-canonical, which is a state a seat can act on.
 */
export const NON_CANONICAL_CLAIM_SEPARATORS = [
  ['—', 'EM DASH (U+2014)'],
  ['–', 'EN DASH (U+2013)'],
  ['-', 'HYPHEN-MINUS (U+002D)'],
  ['：', 'FULLWIDTH COLON (U+FF1A)'],
];

/**
 * A claim-shaped opening whose separator is not the canonical colon.
 *
 * Mirrors `CLAIM_COMMENT_MARKER`'s strictness deliberately — same optional
 * blockquote, same must-BEGIN-with-the-word anchor, same absence of `g` — so
 * that the two markers partition claim-shaped openings rather than overlapping.
 * The prose control the strictness was paid for (#7488) is still excluded here
 * for the same reason it is there: 「the next seat should claim: only after the
 * ruling lands」 does not BEGIN with the word.
 *
 * ⚠️ `[ \t]*`, NOT `\s*`, on both sides of the word. `\s` matches a NEWLINE, so
 * `Claim\n- something` would put a markdown BULLET's hyphen in the separator
 * position and read an ordinary list as a malformed claim — and a hyphen is the
 * commonest line-opening character in this repo's comment bodies, where the
 * colon marker never had to care (a line starting with `:` is not a thing
 * anyone writes).
 *
 * Stated precisely, because it is easy to over-claim: `nearMissClaimSeparators`
 * already runs this regex per SPLIT LINE, so the reader below is safe either
 * way and the character class is not what saves it. What the class protects is
 * this constant AS AN EXPORT — it is `m`-flagged and reusable, and a future
 * caller doing `CLAIM_NEAR_MISS_MARKER.test(body)` over a whole comment gets
 * the right answer only because of it. Both properties are pinned separately in
 * the self-test, at the regex and at the reader, so neither can go green on the
 * other's behalf.
 *
 * Capture groups: 1 = the separator, 2 = the rest of the line.
 */
export const CLAIM_NEAR_MISS_MARKER = new RegExp(
  `^[ \\t]*>?[ \\t]*Claim(?:ed)?[ \\t]*([${NON_CANONICAL_CLAIM_SEPARATORS.map(([ch]) => `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`).join('')}])[ \\t]*(.*)$`,
  'mi'
);

/**
 * Does this line's remainder carry the claim protocol's own content?
 *
 * The conservative half of the detection. The protocol's claim comment is
 * required to name a session ID and a branch, and the measured dash claims do:
 * 「Claim — skills seat `session_01RM…`. Folded dispatch …」 and 「Claim —
 * domain:cli lane execution seat, session 019siH5jDmk5hrayvfyojUqR, round
 * R36」. Requiring one of those tokens is what separates an attempted claim
 * from a line that merely opens with the word.
 *
 * A protocol-shaped branch is accepted from ANYWHERE in the comment rather than
 * from the opening line, because the template puts `Branch:` on its own line —
 * the same reason `claimedBranches` reads a directive line rather than the
 * first one.
 */
export function looksLikeClaimContent(remainder, body) {
  if (/\bsessions?\b|\bseat\b/iu.test(String(remainder ?? ''))) return true;
  return claimedBranches(body).length > 0;
}

/**
 * Which non-canonical separators this comment body opens a claim-shaped line
 * with — de-duplicated, in the order declared, empty when none does.
 *
 * @param {string} body
 * @returns {string[]} the printable separator NAMES
 */
export function nearMissClaimSeparators(body) {
  const text = String(body ?? '');
  const found = [];
  for (const line of text.split('\n')) {
    const hit = CLAIM_NEAR_MISS_MARKER.exec(line);
    if (!hit) continue;
    if (!looksLikeClaimContent(hit[2], text)) continue;
    const name = NON_CANONICAL_CLAIM_SEPARATORS.find(([ch]) => ch === hit[1])?.[1];
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * H34 — null when clean, else the finding sentence.
 *
 * Gated on the SAME population H2 judges (pm-tracked, assigned) and read off
 * the SAME comment bodies that branch already fetched, so the row costs no
 * request at all. It fires only where H2 fires — no canonical claim on the
 * thread — which makes every H34 row a companion that EXPLAINS its card's H2
 * row rather than a second accusation about the same fact.
 *
 * The residual that gate accepts, stated rather than dropped: an UNASSIGNED
 * `pm:dispatched` card buys no comment fetch here and so is never judged. That
 * card is H1's finding in its own right, and its dispatch is already the thing
 * being questioned.
 *
 * @param {object} issue — an OPEN issue.
 * @param {(string|null|undefined)[]} commentBodies
 */
export function h34ClaimShapedNonCanonicalSeparator(issue, commentBodies) {
  const labels = labelNames(issue ?? {});
  const pmTracked = labels.some((l) => l === 'pm:queue' || l === 'pm:dispatched');
  if (!pmTracked || (issue?.assignees ?? []).length === 0) return null;
  if (!Array.isArray(commentBodies)) return null;
  // A card with a readable claim is machine-visible; the row has no remedy for it.
  if (commentBodies.some((b) => CLAIM_COMMENT_MARKER.test(String(b ?? '')))) return null;

  const separators = [];
  let lines = 0;
  for (const body of commentBodies) {
    const names = nearMissClaimSeparators(body);
    if (names.length === 0) continue;
    lines += 1;
    for (const name of names) if (!separators.includes(name)) separators.push(name);
  }
  if (separators.length === 0) return null;

  return (
    `a claim-shaped comment whose separator is NOT the canonical colon — ${lines} comment(s), ` +
    `${separators.join(' + ')} where the protocol writes \`Claim:\` — and NO comment on this thread ` +
    'matches the marker. So this card reads as CLAIMLESS to H2 (its row on this card is correct, not a ' +
    'false positive) and sits outside dispatch-liveness entirely: `governingClaim` gates on the same ' +
    'marker before reading `Branch:`, so H20 can never report a missing remote ref for it and H27 can ' +
    'never report a dead claim — the two rows that exist to catch an abandoned dispatch. Remedy, and it ' +
    'is the WRITE side: the claiming seat re-posts (or edits) the claim so its FIRST line begins with ' +
    'the literal `Claim:`, per SKILL.md step 4 — 「首行以字面 `Claim:` 开头是机器判据(维护者 ' +
    '2026-08-11 裁定;巡查谓词只认这一个拼写且保持严格,修法是全舰队向文档拼写收敛,⛔ 不放宽谓词)」. ' +
    '⛔ The patrol predicate is NOT widened to accept the separator this card used; that is the one ' +
    'repair the ruling closes. Report-only: ⛔ never a label written from this script.'
  );
}

// ---------------------------------------------------------------------------
// H35 — a gate label REMOVED with no matching review-chain evidence (#11881).
//
// H31 above compares the gate's two carriers as they stand NOW and says, in its
// own header, exactly what it cannot do: 「闸门被剥不是红灯是放行」 — a stripped
// gate is a GREEN light, and 「被剥」 and 「从未挂过」 are indistinguishable in
// the evidence. A label that was removed is ABSENT, and absence has two causes.
// Every reader in this file until now has been a reader of STATE, so none of
// them can separate the two. This row reads the EVENT that produced the state.
//
// The filing card's measurement is what makes the question concrete: on PR
// #11470 the erasing actor was a SEAT (`claude[bot]`, 33 and 92 minutes after
// the Auto Label job), not a workflow — so the whole-set-PUT gate that shipped
// for that incident sweeps `.github/workflows/**`, `.github/actions/**` and
// `scripts/**` and cannot reach the actor at all. Seats write through the API at
// runtime. The compensating control the card asks for is DETECTION, and the
// triage ruling (2026-08-25 14:58Z) scoped this card to exactly that: a
// report-only patrol, adding detection and weakening no gate. ⛔ Escalation and
// enforcement are a LATER card and deliberately absent here.
//
// ## The transport, and why this row costs no per-card fetch
//
// The obvious reading — fetch each card's timeline — is the trade this sweep
// declines everywhere it arises (H15 declines it by name for the age of a
// label; H16's header forbids "fixing" its proxy with one). This row does not
// need it. `GET /repos/{repo}/issues/events` is a REPO-WIDE, newest-first
// stream of the same `labeled`/`unlabeled` rows, and it carries the full issue
// payload — number, state, CURRENT labels, body — on every row. So the whole
// population is one paginated window of the shape this file already keeps three
// of (H8's merged-PR window, H23's commit window, H22's closed-issue window),
// and the per-card cost is zero. PRs arrive through it too: a pull request IS
// an issue to this endpoint, which is what lets one window see both carriers of
// a dual-carrier gate.
//
// MEASURED 2026-08-26T01:26:58Z, 160 pages: 16,000 events spanning
// 2026-08-22T15:35:07Z … 2026-08-26T01:26:58Z = 3.41 days ⇒ ~4,691 events/day.
//
// ## What counts as "matching review-chain evidence" — and why it is STRUCTURAL
//
// `references/contract-review.md` names the evidence for a legitimate clear:
// 「PASS 评论 + 标签缺失 + PR head 自复审后未动 = 已复审清标,不是被剥」. Read
// literally that makes the discriminator a PASS COMMENT, and a predicate built
// on it does not survive measurement. The verdicts are free prose and their
// wording varies card to card — `**Contract review: PASS**`,
// `**Contract review — PASS**`, `## Post-merge contract-review verdict: **PASS**`
// were all live in one 18-hour window — so over the 35 card-side removals in
// that window a strict marker matched 5 and a loose one matched 10. Widening
// the regex until the rest match is the tolerant-consumer antipattern this repo
// forbids by name, and its end state is worse than noise: an "any PASS token"
// reading matched 26 of 35, including threads whose PASS was about something
// else entirely — a check that can barely fail, which is the shape this file
// exists to CATCH rather than to add.
//
// The protocol leaves a second, MACHINE-READABLE definition of the same event,
// and this row uses that one: 「PR 与卡双载体同笔挂」…「PASS 双载体同笔清标」 —
// the gate is hung in one stroke and cleared in one stroke, ACROSS BOTH
// CARRIERS. A legitimate clear therefore leaves TWO removals, one per carrier,
// seconds apart, by the same actor. A strip leaves ONE. That is a structural
// invariant taken from the protocol's own words, not a parse of prose, and it
// is the reason this row can decline the comment fetch as well as the timeline
// fetch.
//
// ## The stroke window, derived from the measured gap distribution
//
// Same corpus, 206 gate removals: for each, the gap to the nearest removal on
// the OPPOSITE carrier kind by the SAME actor.
//
//   ≤1s  50 | ≤2s  65 | ≤3s   5 | ≤5s  21 | ≤10s 16 | ≤30s 11 | ≤60s  4
//   (60,90]s  0   ← the distribution is EMPTY here
//   ≤120s 4 | ≤300s 1 | then 1000s, 3344s, … hours
//
// The same-stroke cluster ends at 101s and the next observation is 275s — a
// 2.7x jump across an empty region. `H35_SAME_STROKE_SECONDS = 120` sits inside
// that gap, so the threshold is a reading rather than a preference: no value
// between 102 and 274 classifies the corpus differently. The tail past 120s is
// hours wide, which is a different stroke by any reading. The batching is why
// the cluster has width at all — the review Routine runs hourly and 「每小时一轮
// 即天然攒批」, and a measured batch cleared 4 PRs + 4 cards in 14 seconds.
//
// ## Three outcomes, never two (#4690)
//
// A lone removal is NOT automatically a strip, and the corpus says so loudly.
// 34 of 36 lone removals were gates that had been hung on the CARD ONLY — the
// PR carrier never carried the label at all (verified per-PR: PR #12401 and PR
// #12287, the two most recent, have zero gate events in their entire history).
// For a single-carrier gate there is no second carrier to clear, so a lone
// clear is exactly what a CORRECT clear looks like, and flagging it would
// report the majority shape of the board as a violation.
//
// So the removal is judged against its own HANG, which the same window already
// carries: a gate hung in a dual stroke and cleared in a lone one is the pair
// written half way — that is the finding. A gate hung lone and cleared lone is
// internally consistent and gets the file's UNJUDGED treatment instead of a
// verdict: there is no structural evidence in EITHER direction, which is not
// the same as evidence of correctness, and 「read, and it carries nothing」 vs
// 「could not be read」 is the pair this whole file refuses to conflate. A
// removal whose hang predates the window is `undated` and is counted, never
// guessed at.
//
// ⚠️ The unjudgeable class is the honest residue of this card, and it is the
// LARGER half: measured 29 over 3.41 days against 0 half-writes. Where the
// dual-carrier discipline is actually followed it holds — 0 half-write clears
// in 206 removals — and the exposure has moved to single-carrier gates, which
// no carrier comparison (H31's or this one's) can ever adjudicate. Closing THAT
// half needs a producer-side change (a canonical machine-readable verdict, or
// the PR-side hang that 「PR 一存在即挂」 already requires), which is a decision
// this row records rather than takes.
//
// ## What is reported, and the deliberate asymmetry in the two classes
//
// `half-write` is reported for any carrier, open or closed: a gate cleared half
// way on a PR that then merged is the bypass that already happened, and the
// population is ~0/day so it cannot flood the report. `unjudgeable` is reported
// only while the carrier is still OPEN and the label still ABSENT — that is the
// subset a reader can still act on, and it is the difference between 0.22 rows
// per run and 8.5. Measured live subset: 3 cards over 3.41 days.
//
// A removal whose label is back is SILENT in both classes. That is the
// read-back working — the card's own §2 names the 13-minute re-application on
// #11470 as「consistent with an accidental loss caught by read-back」— and a row
// for it would report the control functioning as a defect.
//
// Report-only, and emphatically: like H31 this row's subject is a GATE. ⛔ Never
// a label written from this script — a sweeper that re-hung a review gate would
// be issuing the review verdict, which is 自查放行.
// ---------------------------------------------------------------------------

/**
 * The gate-semantic label family this row patrols.
 *
 * MEASURED on the live repo 2026-08-26 (`GET /labels`, 57 labels): the family
 * has exactly ONE member. It is a LIST rather than the bare constant because
 * the ruling names a family and the next gate label must join it here rather
 * than fork a row — but the list is not speculative padding, and
 * `needs-user-decision` deliberately stays out of it: it marks a card awaiting
 * a maintainer, not a review chain with a dual-carrier hang/clear protocol, so
 * the same-stroke invariant below is meaningless for it.
 */
export const GATE_SEMANTIC_LABELS = [CONTRACT_REVIEW_LABEL];

/** Is this label one the row patrols? */
export function isGateSemanticLabel(name) {
  return GATE_SEMANTIC_LABELS.includes(String(name ?? ''));
}

/**
 * How far apart two carrier writes can be and still be 「同笔」 — 120s, read
 * out of the empty region between the measured 101s and 275s (header above).
 */
export const H35_SAME_STROKE_SECONDS = 120;

/**
 * The issue-event production rate, MEASURED — the divisor the window below
 * uses, in the same executable shape H8's window uses `MEASURED_MERGES_PER_DAY`.
 *
 *   read     2026-08-26T01:26:58Z, `GET /repos/{repo}/issues/events`, 160 pages
 *   window   2026-08-22T15:35:07Z … 2026-08-26T01:26:58Z  (3.41 days)
 *   rows     16,000 events, of which 415 carried a gate-semantic label
 *   rate     16,000 / 3.41 = ~4,691 events/day
 */
export const MEASURED_ISSUE_EVENTS_PER_DAY = 4691;

/**
 * The detection horizon — 12h, i.e. TWO patrol cycles at the 6-hourly cadence.
 *
 * One cycle would put every removal within one run of aging out, so a single
 * failed or skipped run loses the finding permanently (this is a horizon, not a
 * retry budget — H8's window states the same thing). Two cycles means every
 * removal is seen by at least two consecutive runs. Past the horizon the
 * finding is not delayed, it is gone: nothing else in this file reads events.
 */
export const H35_EVENT_WINDOW_HOURS = 12;

/**
 * The quota backstop, in pages of 100.
 *
 * At the measured rate the horizon needs `eventWindowPages()` = 24 pages; the
 * cap is 30, which absorbs a day ~25% busier than the corpus before truncating.
 * A run that HITS the cap has a short window, and the summary line says so —
 * a truncated window must never read as a clean one (#4690).
 */
export const H35_EVENT_PAGE_CAP = 30;

/**
 * Pages of 100 needed to cover `hours` at the measured event rate. The
 * arithmetic is executable rather than prose for the reason `windowCoverageDays`
 * exists: a rate that moves must move the derivation with it, where a test can
 * see it.
 */
export function eventWindowPages(
  hours = H35_EVENT_WINDOW_HOURS,
  ratePerDay = MEASURED_ISSUE_EVENTS_PER_DAY,
  perPage = 100,
) {
  if (!Number.isFinite(hours) || !Number.isFinite(ratePerDay) || ratePerDay <= 0) return null;
  if (!Number.isFinite(perPage) || perPage <= 0) return null;
  return Math.ceil(((hours / 24) * ratePerDay) / perPage);
}

/** Every `labeled`/`unlabeled` event in a window that carries a gate-semantic label. */
export function gateLabelEvents(events) {
  return (events ?? []).filter(
    (e) =>
      e &&
      (e.event === 'labeled' || e.event === 'unlabeled') &&
      isGateSemanticLabel(e.label?.name),
  );
}

/** Is this event row on a PULL REQUEST carrier rather than a card? */
function eventOnPullRequest(event) {
  return Boolean(event?.issue?.pull_request);
}

/** Does the carrier this event names still carry the label the event moved? */
function carrierStillLabelled(event) {
  const name = String(event?.label?.name ?? '');
  return (event?.issue?.labels ?? []).some((l) => l?.name === name);
}

/**
 * Is `event` half of a 「同笔」 dual-carrier stroke? True when the SIBLING
 * carrier saw the same verb, on the same label, by the same actor, within the
 * stroke window.
 *
 * `siblingNumbers` resolves the other carrier and is INJECTED rather than
 * derived here: the sweep answers it with `prDeliversCard` over the PR windows
 * it already holds, which is the same delivery relation H8 and H31 read — so
 * the three rows can never disagree about which PR delivers which card. It
 * returns `null` when the relation is unresolvable (no delivering PR in the
 * windows, a body that declares nothing), and an unresolvable sibling means NOT
 * PAIRED — which routes the removal to a judged-against-its-hang path below,
 * never straight to a finding.
 */
export function pairedAcrossCarriers(event, gateEvents, options = {}) {
  const { sameStrokeSeconds = H35_SAME_STROKE_SECONDS, siblingNumbers = () => null } = options;
  const at = Date.parse(event?.created_at ?? '');
  if (!Number.isFinite(at)) return false;
  const siblings = siblingNumbers(event);
  if (!Array.isArray(siblings) || siblings.length === 0) return false;
  const wanted = new Set(siblings.map((n) => Number(n)));
  const actor = String(event?.actor?.login ?? '');
  const label = String(event?.label?.name ?? '');
  const onPr = eventOnPullRequest(event);
  return (gateEvents ?? []).some((o) => {
    if (!o || o === event) return false;
    if (o.event !== event.event) return false;
    if (String(o.label?.name ?? '') !== label) return false;
    if (String(o.actor?.login ?? '') !== actor) return false;
    if (eventOnPullRequest(o) === onPr) return false;
    if (!wanted.has(Number(o.issue?.number))) return false;
    const t = Date.parse(o.created_at ?? '');
    return Number.isFinite(t) && Math.abs(t - at) <= sameStrokeSeconds * 1000;
  });
}

/** The most recent hang of the same label on the same carrier BEFORE `removal`. */
export function precedingHang(removal, gateEvents) {
  const at = Date.parse(removal?.created_at ?? '');
  if (!Number.isFinite(at)) return null;
  const label = String(removal?.label?.name ?? '');
  const number = Number(removal?.issue?.number);
  const hangs = (gateEvents ?? [])
    .filter(
      (e) =>
        e &&
        e.event === 'labeled' &&
        String(e.label?.name ?? '') === label &&
        Number(e.issue?.number) === number &&
        Number.isFinite(Date.parse(e.created_at ?? '')) &&
        Date.parse(e.created_at) < at,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return hangs[0] ?? null;
}

/**
 * H35's classifier — the three-valued half, asserted directly by the self-test.
 *
 * @returns one of:
 *   `'not-applicable'` the row is not an `unlabeled` of a gate-semantic label
 *   `'rehung'`         the carrier carries the label again (read-back worked)
 *   `'paired'`         cleared in a 「同笔」 dual-carrier stroke — the evidence
 *   `'half-write'`     hung in a dual stroke, cleared in a lone one — FINDING
 *   `'unjudgeable'`    hung lone and cleared lone (single-carrier gate)
 *   `'undated'`        no hang inside the window; declines to judge
 */
export function h35RemovalVerdict(removal, gateEvents, options = {}) {
  if (!removal || removal.event !== 'unlabeled') return 'not-applicable';
  if (!isGateSemanticLabel(removal.label?.name)) return 'not-applicable';
  if (carrierStillLabelled(removal)) return 'rehung';
  if (pairedAcrossCarriers(removal, gateEvents, options)) return 'paired';
  const hang = precedingHang(removal, gateEvents);
  if (!hang) return 'undated';
  return pairedAcrossCarriers(hang, gateEvents, options) ? 'half-write' : 'unjudgeable';
}

/** Shared tail — the posture, stated on every row this block emits. */
const H35_CONTRACT =
  'Report-only: ⛔ never a label written from this script — re-hanging a review gate from a sweeper ' +
  'would be issuing the verdict, which is 自查放行. Detection only; escalation and enforcement are ' +
  'a later card by the 2026-08-25 ruling.';

/**
 * H35 — null when the removal needs no row, else the finding sentence.
 *
 * Two classes reach a row, and they say different things on purpose. The
 * `open`/`absent` narrowing applies to `unjudgeable` ONLY and the header states
 * why: that class is common and actionable only while the carrier is live,
 * while `half-write` is ~0/day and names damage that may already have landed.
 *
 * @param {object} removal — an `unlabeled` event row from the repo-wide window.
 * @param {object[]} gateEvents — every gate-semantic label event in that window.
 */
export function h35GateRemovalWithoutEvidence(removal, gateEvents, options = {}) {
  const verdict = h35RemovalVerdict(removal, gateEvents, options);
  const label = String(removal?.label?.name ?? '');
  const actor = String(removal?.actor?.login ?? 'an unreadable actor');
  const at = String(removal?.created_at ?? 'an unreadable time');
  const carrier = eventOnPullRequest(removal) ? 'PULL REQUEST' : 'CARD';

  if (verdict === 'half-write') {
    return (
      `\`${label}\` was REMOVED from this ${carrier} by \`${actor}\` at ${at} in a LONE stroke, ` +
      'while the hang it clears was written across BOTH carriers — so the pair was cleared half way. ' +
      '「PASS 双载体同笔清标」 makes a legitimate clear two removals seconds apart, one per carrier; ' +
      'this one has no sibling within ' +
      `${H35_SAME_STROKE_SECONDS}s. Either the clear never reached the second carrier, or the label ` +
      'was stripped — and 「闸门被剥不是红灯是放行」, so the failure direction is TOWARD release: an ' +
      'ungated carrier reads to the enqueue path as one that was never gated. Remedy is a READ, not a ' +
      'write: check the card thread for a current review verdict before re-hanging — 「PASS 评论 + 标签' +
      `缺失 + PR head 自复审后未动 = 已复审清标,不是被剥」. ${H35_CONTRACT}`
    );
  }

  if (verdict === 'unjudgeable') {
    if (removal?.issue?.state !== 'open') return null;
    return (
      `\`${label}\` was removed from this open ${carrier} by \`${actor}\` at ${at} and the gate is ` +
      'still absent — UNJUDGED, not clean. The hang it clears was ALSO a lone stroke: this gate only ' +
      'ever had ONE carrier, so 「双载体同笔清标」 leaves no structural evidence in either direction ' +
      'and no carrier comparison — H31\'s or this row\'s — can say whether it was cleared or stripped. ' +
      'The only remaining evidence is a review verdict written as free prose, which has no canonical ' +
      'machine-readable form (measured: a strict marker matched 5 of 35 removals, a loose one 10), so ' +
      'this row declines to parse it rather than widen into a check that cannot fail. Two producer-side ' +
      'repairs would each make this judgeable: hang the PR carrier as 「PR 一存在即挂」 already ' +
      `requires, or give the verdict a canonical marker. ${H35_CONTRACT}`
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// H36 — two open PRs holding the same changed file, one side already ACCEPTED
// or armed (#12286).
//
// ## The incident, and what exactly went unheld
//
// Two open PRs edited one runtime source file across lanes for ~4h. The
// later-opened one merged first; the earlier — reviewed, ACCEPTED, 32/32
// checks green — was left in a silent merge conflict. Nothing mechanical
// objected, and the single-claim gate was RIGHT not to: its header forbids
// per-incident growth of `SINGLE_CLAIM_PATHS`, and its declared scope held.
// What is unheld is LEGIBILITY: the same-file fence lives in a claim comment
// in one lane's thread, so a second seat that never asks the cross-lane
// question gets no signal from anywhere. The platform volunteers nothing
// either: `mergeable_state` stayed `unknown` throughout (computed lazily), so
// the seat's first reading was wrong and it armed auto-merge on a dirty head.
//
// ## What this row is — patrol INPUT, never a verdict
//
// A pair sharing a changed file is often perfectly fine (the incident's own
// two sides were additive and semantically safe). The row does not judge the
// pair; it makes the hold visible on the anchor every seat already reads, so
// the cross-lane walk the claim shape requires has a mechanical backstop for
// the case where a seat skipped or misjudged it — which is exactly the
// two-possibility fork the incident could not distinguish after the fact.
// Report-only like everything here: the remedy is a PROBE — fetch the PR ref,
// `git merge-tree --write-tree` against today's main answers "would this land
// clean" for free — never a label and never a gate.
//
// ## Why "ACCEPTED/armed" gates the row
//
// A pair of unarmed drafts is ordinary concurrent work-in-progress; the walk
// at their own dispatch time is the instrument for that. The board state
// worth a standing row is the incident's: a side that is DONE — ready
// (= reviewed by construction here: dev PRs flip ready only at review
// ACCEPT) or armed — can be silently passed by the other side landing first,
// after which every proxy signal reads healthy while it rots. `auto_merge`
// is read in the finding-INCREASING direction only, H16's argument exactly:
// arming resolves no conflict, so an armed side is more at risk, not handled.
//
// ## The noise floor is CLOSED, and argued from the single-claim gate's data
//
// That gate's header measured shared-changed-path collisions over ~650 PRs:
// the top repo-wide pairs are the lock file (33), a plugin manifest (21) and
// the root manifest (15) — ordinary concurrent work in a repo taking ~18
// merges a day. Pairing on those would put a row on the anchor every sweep
// and bury the one that matters. So exactly two spellings are excluded, both
// shared BY CONSTRUCTION, and the closed set is pinned by the self-test
// against per-incident growth (the discipline `SINGLE_CLAIM_PATHS` applies
// to itself): the pnpm lockfile (touched by any PR moving dependencies, and
// merged mechanically) and `.changeset/` (every PR ADDS a uniquely-named
// file there — a collision on one is not a source-file hold).
// `changeset-release/*` PRs are excluded as CANDIDATES for the matching
// reason: the Version Packages PR consumes every changeset file on the
// board, so it would pair with essentially every open PR, and it is
// regenerated from `main` on every push — it holds nothing.
//
// ## Bounded, and bounded honestly
//
// The files fetch is ONE page per candidate, candidates being the open PRs
// this sweep already listed — bounded by the open population (~19 at the
// reading this landed on). A PR with more changed files than the page has
// the tail unread: that can only MISS a pair, never invent one, and both the
// summary line's `read X of Y` and a per-row truncation sentence say so.
// Positive evidence only — this row never asserts "no overlap".
// ---------------------------------------------------------------------------

/** The closed noise floor — exact spellings, then prefixes. See the banner. */
export const H36_SHARED_PATH_NOISE = Object.freeze(['pnpm-lock.yaml']);
export const H36_SHARED_PREFIX_NOISE = Object.freeze(['.changeset/']);
export const H36_FILES_PAGE_SIZE = 100;
export const H36_SAMPLE_PATHS = 3;

export function h36NoisePath(path) {
  const p = String(path ?? '');
  if (H36_SHARED_PATH_NOISE.includes(p)) return true;
  return H36_SHARED_PREFIX_NOISE.some((prefix) => p.startsWith(prefix));
}

/** ACCEPTED (ready = reviewed by construction) or armed — the at-risk side. */
export function h36AcceptedOrArmed(pr) {
  if (!pr) return false;
  return pr.draft === false || pr.auto_merge != null;
}

/**
 * Whether this open PR is worth a files page — the gathering policy, H16's
 * idiom: answerable from the LIST row alone, and never NARROWER than the
 * predicate's population. A pair needs one accepted/armed side, but the
 * OTHER side can be any open PR (a draft included — the incident's second
 * side was one when the window opened), so every open PR outside the
 * changeset-release exclusion is a candidate.
 */
export function h36NeedsFiles(pr) {
  if (!pr || pr.merged_at) return false;
  return !String(pr.head?.ref ?? '').startsWith('changeset-release/');
}

/** The all-failed transport judgement — H16's, verbatim in shape. */
export function h36DetailPassUnreadable(candidates, probed) {
  return (candidates ?? 0) > 0 && (probed ?? 0) === 0;
}

/**
 * The pair rows. `filesByPr` maps PR number → `{ paths, truncated }`; a PR
 * absent from the map was unread (a failed page) and simply cannot pair —
 * the coverage pair reports that shortfall, and a missed pair is the only
 * possible consequence. One row per PAIR, keyed to the accepted/armed side
 * (both accepted: the earlier-created one), because that is the side that
 * silently rots when the other lands first; the other side is named in the
 * sentence.
 */
export function h36SharedFileHolds(openPrs, filesByPr) {
  const rows = [];
  const prs = (openPrs ?? []).filter((pr) => h36NeedsFiles(pr));
  prs.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  for (let i = 0; i < prs.length; i++) {
    for (let j = i + 1; j < prs.length; j++) {
      const a = prs[i];
      const b = prs[j];
      if (!h36AcceptedOrArmed(a) && !h36AcceptedOrArmed(b)) continue;
      const fa = filesByPr?.get?.(a.number);
      const fb = filesByPr?.get?.(b.number);
      if (!fa || !fb) continue;
      const inB = new Set((fb.paths ?? []).filter((p) => !h36NoisePath(p)));
      const shared = (fa.paths ?? []).filter((p) => !h36NoisePath(p) && inB.has(p));
      if (shared.length === 0) continue;
      const key = h36AcceptedOrArmed(a) ? a : b;
      const other = key === a ? b : a;
      const state =
        key.auto_merge != null
          ? key.draft === false
            ? 'ready AND armed'
            : 'armed'
          : 'ready (reviewed by construction)';
      const sample = shared
        .slice(0, H36_SAMPLE_PATHS)
        .map((p) => `\`${p}\``)
        .join(', ');
      const more = shared.length > H36_SAMPLE_PATHS ? `, +${shared.length - H36_SAMPLE_PATHS} more` : '';
      const truncated =
        fa.truncated || fb.truncated
          ? ' One side\'s file list was TRUNCATED at the page size, which can only have hidden MORE overlap.'
          : '';
      rows.push([
        key,
        `open and ${state}, sharing ${shared.length} changed file(s) with open PR #${other.number} ` +
          `(${sample}${more}) — a cross-lane same-file hold made visible: the fence otherwise lives ` +
          'only in one lane\'s claim comment, and `mergeable_state` volunteers nothing (`unknown` is ' +
          'not a reading). Patrol input, NOT a verdict — both sides may be additive and disjoint. ' +
          'Whichever lands second re-probes before (re-)arming: fetch the PR ref and run ' +
          '`git merge-tree --write-tree` against current `main` — the zero-quota reading GitHub ' +
          `never volunteers.${truncated}`,
      ]);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// H37 — a FAMILY DISPATCH whose per-member label writes did not all land
// (#12629).
//
// ## The incident, and the exact reason nothing said so
//
// A family dispatch folds N already-triaged cards into ONE dev run: one shared
// branch named after the CHAIN HEAD, one worktree, one PR — and one
// `pm:dispatched` write PER MEMBER. Those writes are N separate calls with
// nothing tying them together, so a partial run is possible and produced no
// signal at all. Measured on the filing seat's own error: in a 3-card fold it
// wrote 2 of the 3, leaving one member carrying a member-pointer claim comment
// naming the chain head while its label still read `pm:queue`.
//
// That combination is a lie in the DISPATCHABLE direction — the queue label
// says "free to claim" about a card a fold already holds — and every per-card
// predicate in this file reads it as clean, CORRECTLY:
//
//   - H1/H2/H3/H24/H29 key on `assignee` x label x claim-comment pairings ON
//     ONE CARD. That card had no assignee and a consistent-looking `pm:queue`.
//   - The fold's own record lives in the CHAIN HEAD's claim comment, on
//     another card. Nothing joined the two.
//   - The seat's in-flight ledger is its seat post, which lists the fold by
//     its HEAD.
//
// The mirror direction is measured too, on this card's own grading round:
// #12200 was left `pm:dispatched` WITH its assignee after the fold's recovery
// had declared release — the same non-atomic write failing the other way, and
// equally invisible until a seat happened to look. Both directions are rows
// here, because a predicate that reported only the first would have said
// nothing about the second instance on the very card that filed it.
//
// ## The join, and why the BRANCH is the whole of it
//
// The fold convention (SKILL.md, step 4 -> 家族派发的折叠认领约定) is:
//
//     共享分支按链首卡命名,每张成员卡各留认领评论并点名该分支
//
// — the shared branch is named for the chain head, and EVERY member card
// leaves its own claim comment naming that branch (a member with no branch of
// its own is the design, not a half-state). So the fold's roster is already
// written on the board in a machine-readable field: the `Branch:` directive
// this file has read since H20, through `claimedBranches` / `governingClaim`.
//
// A card whose governing claim names `claude/issue-H-...` with H NOT its own
// number IS the member pointer, and a branch carrying at least one such
// claimant IS a live fold. That single reading covers BOTH halves the filing
// card asks to join — 「a member pointer on this card」 and 「named as a member
// in a live `Claim:` on another open card」 — because the shared branch is the
// one string both of them spell, and each member's claim names it.
//
// ⛔ No prose scraping, deliberately. A claim comment names sibling cards,
// serial-constraint predecessors and blocker targets as bare `#N` in its own
// text — the specimen on this row's own filing card names the chain that HELD
// this script — so scanning claim prose for card numbers would manufacture
// members out of the one field the protocol fills in correctly. H20's header
// makes the same call about branch spellings, for the same reason: a fabricated
// row sends a reader to check something that was never there.
//
// ## What the row compares, in BOTH directions
//
// Per fold, the HEAD's own state says whether the fold is in flight, and every
// other claimant is read against it:
//
//   head `pm:dispatched`         -> IN FLIGHT. A claimant without
//                                   `pm:dispatched` is a missed write — the
//                                   filing seat's own error.
//   head CLOSED, or open without -> RELEASED. A claimant still carrying
//   `pm:dispatched`                 `pm:dispatched` is residue — #12200's
//                                   mirror.
//   head open + undispatched,    -> the HEAD's own half of the write is the one
//   some claimant dispatched        that missed. The row lands on the head, and
//                                   it is visible from the members' claims and
//                                   from nothing else on the board.
//   head in neither population   -> UNRESOLVABLE, and the row DECLINES rather
//                                   than picking a side (H19's call).
//
// A fold in which NOTHING is dispatched — head included — is deliberately
// quiet. It is indistinguishable from an abandoned or not-yet-launched fold,
// and those cards are already H30's population on their own terms.
// Under-report over fabricate is this file's standing direction.
//
// ## The noise floor is CLOSED, and it is the ordinary case
//
// Exactly ONE exclusion, and it covers essentially the whole board: a claim
// naming its OWN card's branch is not fold evidence. Every solo dispatch here
// writes exactly that, so without the exclusion this row would fire on every
// dispatched card in existence. A branch is a fold branch only when some
// claimant is not its head. ⛔ Nothing else is suppressed by name — this row
// carries no per-incident exclusion list to grow, which is the discipline H36's
// closed noise floor states and `SINGLE_CLAIM_PATHS` applies to itself.
//
// ## Bounded, and bounded honestly
//
// Round 1 is FREE. It reads the claim threads this sweep ALREADY holds: every
// open `pm:dispatched` card (the dispatch-liveness loop) and every assigned
// pm-tracked card (H2's fetch). So fold DISCOVERY converges on the open
// `pm:dispatched` population, exactly as the filing card bounds it — a fold
// with a dispatched member announces itself there at no cost.
//
// Round 2 buys ONE comment page per open `pm:queue` card, and ONLY when round 1
// actually saw a live fold. A board with no fold in flight therefore costs
// NOTHING, and a board with one costs at most the queue page count (40 open
// `pm:queue` cards at the 2026-08-24 census H30 measured, against a 15,000/h
// core quota and four sweeps a day). It is bought for `pm:queue` because that
// is precisely where the dispatchable-direction lie parks — a card the queue
// offers while a fold already holds it — and it is the one population whose
// threads no other item here reads.
//
// Positive evidence only. A member page that fails drops that card out of the
// roster — a MISS, never an invention — and the coverage pair reports it, with
// an all-failed pass named in the summary as the transport it is (#4690). The
// pass does NOT rethrow, unlike H16's and H36's: those rows ARE their detail
// pass, while two of this row's three directions are free and already gathered,
// so discarding the sweep would cost more readings than it protects. ⛔ This
// row never asserts that a fold's writes all landed.
//
// Report-only like everything here: the remedy is a seat re-reading the fold's
// members and writing the missing half. ⛔ Never a label written from this
// script.
// ---------------------------------------------------------------------------

/** How many fold members one row names before it counts the rest — H19/H20's budget, same grounds. */
export const H37_MEMBER_LIST_CAP = 5;

/**
 * The live folds on this board, keyed by the SHARED BRANCH.
 *
 * @param {{ number: number, branches: string[] }[]} claims — one entry per card
 *   whose governing claim named at least one protocol-shaped branch.
 * @returns {Map<string, { head: number, claimants: number[] }>} branch ->
 *   the chain head the branch is named for, and every card claiming it.
 *
 * The single exclusion IS the noise floor (see the banner): a branch whose only
 * claimant is its own head is ordinary solo work and never a fold. Branch keys
 * come back sorted so a roster is deterministic for a reader and for the
 * self-test; claimants are sorted for the same reason.
 */
export function h37FoldBranches(claims) {
  const byBranch = new Map();
  for (const claim of claims ?? []) {
    const number = Number(claim?.number);
    if (!Number.isFinite(number)) continue;
    for (const branch of claim?.branches ?? []) {
      // ⚠️ The null check is separate from the finiteness one and must stay so:
      // `branchNameTarget` returns NULL for a branch it cannot read, and
      // `Number(null)` is 0 — a perfectly finite head number for a card that
      // does not exist. Collapsing the two mints a phantom fold on every
      // unreadable branch spelling, which then gates the round-2 member read on
      // nothing (caught by this row's own pin).
      const target = branchNameTarget(branch);
      if (target === null) continue;
      const head = Number(target);
      if (!Number.isFinite(head)) continue;
      if (!byBranch.has(branch)) byBranch.set(branch, { head, claimants: [] });
      const entry = byBranch.get(branch);
      if (!entry.claimants.includes(number)) entry.claimants.push(number);
    }
  }
  const folds = new Map();
  for (const branch of [...byBranch.keys()].sort()) {
    const entry = byBranch.get(branch);
    if (!entry.claimants.some((n) => n !== entry.head)) continue;
    folds.set(branch, {
      head: entry.head,
      claimants: [...entry.claimants].sort((a, b) => a - b),
    });
  }
  return folds;
}

/**
 * Whether the fold headed by `head` is in flight, released, or unreadable —
 * four-valued, because "open but not dispatched" and "closed" are the same
 * RELEASE for a member's verdict while only the first can carry a row of its
 * own.
 *
 * `unknown` is the #4690 state and is kept distinct from both: a head this
 * sweep never listed cannot be reported as released, which would accuse every
 * dispatched member of residue on the strength of a card nobody read.
 */
export function h37HeadState(head, openByNumber, closedByNumber) {
  const n = Number(head);
  const open = openByNumber?.get?.(n);
  if (open) return labelNames(open).includes('pm:dispatched') ? 'in-flight' : 'open-undispatched';
  return closedByNumber?.get?.(n) ? 'closed' : 'unknown';
}

/**
 * The member classifier — asserted directly by the self-test, H35's idiom, so
 * the three-way fold is pinned independently of any sentence it produces.
 *
 * @param {'in-flight'|'open-undispatched'|'closed'|'unknown'} headState
 * @param {boolean} memberDispatched
 * @returns {'undispatched-member'|'dispatched-residue'|'clean'|'unresolvable-head'}
 */
export function h37MemberVerdict(headState, memberDispatched) {
  if (headState === 'unknown') return 'unresolvable-head';
  if (headState === 'in-flight') return memberDispatched ? 'clean' : 'undispatched-member';
  return memberDispatched ? 'dispatched-residue' : 'clean';
}

/** Which cards buy a member comment page — the gathering policy, exported like every other. */
export function h37NeedsMemberRead(issue, foldsSeen) {
  if (!((foldsSeen ?? 0) > 0)) return false;
  const labels = labelNames(issue ?? {});
  if (labels.includes('pm:dispatched')) return false;
  return labels.includes('pm:queue');
}

/**
 * Whether the member pass failed as a TRANSPORT rather than leaving a bounded
 * gap — H16's judgement, shared in shape and deliberately not re-derived. Zero
 * candidates is a clean reading (no fold was live, or the queue is empty), never
 * a fault.
 */
export function h37MemberPassUnreadable(candidates, probed) {
  return (candidates ?? 0) > 0 && (probed ?? 0) === 0;
}

/** `#N` for each fold member, capped at the render budget, + its note. */
function namedMembers(numbers) {
  const shown = numbers.slice(0, H37_MEMBER_LIST_CAP);
  const named = shown.map((n) => `#${n}`).join(', ');
  return `${named}${numbers.length > shown.length ? ` +${numbers.length - shown.length} more` : ''}`;
}

/**
 * The rows. One per CARD whose own `pm:dispatched` disagrees with the fold it
 * claims, keyed to that card because that is where the missing write belongs.
 *
 * A claimant this sweep did not list as open is skipped rather than judged: the
 * roster is assembled from claim TEXT, and a number that resolves to nothing
 * open here is not evidence of anything (H19's treatment of an absent
 * resolution, and the same reason `h37HeadState` keeps `unknown` separate).
 *
 * @param {Map<string, { head: number, claimants: number[] }>} folds
 * @param {Map<number, object>} openByNumber
 * @param {Map<number, object>} closedByNumber
 */
export function h37FamilyMemberDrift(folds, openByNumber, closedByNumber) {
  const rows = [];
  for (const [branch, entry] of folds ?? new Map()) {
    const head = entry?.head;
    const headState = h37HeadState(head, openByNumber, closedByNumber);
    if (headState === 'unknown') continue;
    const members = (entry?.claimants ?? []).filter((n) => n !== head);
    const dispatchedMembers = [];
    const pending = [];
    for (const n of members) {
      const card = openByNumber?.get?.(n);
      if (!card) continue;
      const dispatched = labelNames(card).includes('pm:dispatched');
      if (dispatched) dispatchedMembers.push(n);
      pending.push([card, h37MemberVerdict(headState, dispatched)]);
    }
    for (const [card, verdict] of pending) {
      if (verdict === 'undispatched-member') {
        rows.push([
          card,
          `carries a family-dispatch member pointer at \`${branch}\` — the shared branch of the fold ` +
            `headed by #${head}, which IS \`pm:dispatched\` — while this card carries none. The fold's ` +
            'per-member label writes are separate calls with nothing tying them together, so a partial ' +
            'run leaves the queue offering a card the fold already holds, and every per-card predicate ' +
            'here reads it as clean. Patrol input, NOT a verdict — a claim may name another card\'s ' +
            'branch for a reason that is not a fold (a cross-lane hand-off, a mistyped branch). Remedy: ' +
            `re-read the fold's members off \`${branch}\` and write the missing half (assign + state in ` +
            'ONE write), or correct the branch this claim names. Claimants seen on that branch: ' +
            `${namedMembers(entry?.claimants ?? [])}.`,
        ]);
      } else if (verdict === 'dispatched-residue') {
        rows.push([
          card,
          `still carries \`pm:dispatched\` while the fold it claims — \`${branch}\`, headed by #${head} ` +
            `— has ${headState === 'closed' ? 'CLOSED' : 'released the state (open, no `pm:dispatched`)'}. ` +
            'That is the same non-atomic family write failing in the MIRROR direction, and it reads to ' +
            'every per-card predicate as an ordinary in-flight card. Patrol input, NOT a verdict — this ' +
            'member may still have work of its own outstanding. Remedy: clear the residue in the write ' +
            'that cleared the head (drop `pm:dispatched` and the assignee together — H24\'s ' +
            '「同笔摘 assignee」), or re-dispatch it on its own card and its own branch if work remains. ' +
            `Claimants seen on that branch: ${namedMembers(entry?.claimants ?? [])}.`,
        ]);
      }
    }
    if (headState === 'open-undispatched' && dispatchedMembers.length > 0) {
      rows.push([
        openByNumber.get(Number(head)),
        `is the chain head of \`${branch}\` and carries NO \`pm:dispatched\`, while ` +
          `${dispatchedMembers.length} card(s) claiming that branch do (${namedMembers(dispatchedMembers)}) ` +
          '— the head\'s own half of the fold\'s label write is the one that did not land, and it is ' +
          'visible ONLY from those members\' claims: nothing on this card says so. Patrol input, NOT a ' +
          'verdict — the members may equally be pointing at the wrong branch. Remedy: confirm which ' +
          'reading holds, then write the missing half here or correct the claims that name it.',
      ]);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Report rendering — pure over (findings, counts), so `--self-test` pins both
// media offline. The live sweep below picks a renderer and prints it; nothing
// about WHAT is swept or WHICH predicates fire depends on the format.
//
// Two media exist because this script gained a second consumer. The first is a
// terminal: a patrol round reads the plain lines and scrolls. The second is a
// pinned anchor ISSUE BODY, rewritten in place by the scheduled workflow that
// gave this sweeper a standing caller (`.github/workflows/half-state-patrol.yml`)
// — a surface with a fold, a hard size cap, and readers who will not scroll.
// That difference, and only that, is why the two renderers order rows
// differently; see `renderMarkdown`.
// ---------------------------------------------------------------------------

/** Accepted `--format` values. An unrecognized one is a usage error (exit 2). */
export const OUTPUT_FORMATS = ['plain', 'markdown'];

/**
 * GitHub's hard cap on an issue body, and the budget the markdown renderer
 * keeps under it. A body that exceeds the cap is REJECTED by the API — the
 * whole run's report would vanish over one long row — so the renderer trims
 * and SAYS it trimmed. Silent truncation is the #4690 shape (an unreadable
 * result must not read as a clean one), so the omission notice is part of the
 * rendered body, never a log line the anchor's reader never sees.
 */
export const ISSUE_BODY_LIMIT = 65536;
export const MARKDOWN_BODY_BUDGET = 60000;

/** Is this finding one of H13's louder self-declared-P0 rows? */
export function isLoudFinding(message) {
  return String(message ?? '').startsWith(P0_SUSPECT_MARKER);
}

/**
 * The marker an UNJUDGED row carries — a row reporting that an input could not
 * be read, as opposed to one reporting a state that was read (#11218).
 *
 * ## Why this needs to exist at all: the promise was measurably false
 *
 * The summary sentence has been saying 「each unresolved target is named on its
 * own card's row, never dropped」 — and on the 2026-08-25T02:08Z sweep it was
 * not true. That run resolved 25 of 28 targets and rendered FIVE H19 rows, all
 * of them same-repo and closed-led; not one carried an unresolved target,
 * because the markdown body ran out of budget and 199 rows were trimmed. The
 * rows the header promised were never dropped had been dropped, by the trim,
 * while the header went on promising it.
 *
 * That is precisely #4690 wearing this item's own uniform: "could not read the
 * input" rendered as clean, inside the mechanism built to stop exactly that. A
 * reader could not have caught it either — the trimmed rows announce themselves
 * only as a COUNT, so 「199 further row(s) omitted」 and 「every unresolved target
 * is named」 sat in one body, contradicting each other, with nothing to say which
 * was true.
 *
 * The fix is ordering, not budget: unjudged rows sort ahead of judged ones, so
 * the trim can only ever fall on rows that DID make a determination. Judged rows
 * are recoverable from the run log and say so; an unjudged one is the report's
 * only trace of a gap in what was read. This is the same reservation
 * `renderTriggerIndex` gets and for the same reason — a section whose absence is
 * indistinguishable from good news must not be what the trim eats.
 */
export const UNJUDGED_MARKER = '⚠️ UNJUDGED:';

/**
 * Is this row an unjudged one — an input that could not be read, rather than a
 * state that was?
 *
 * Two sources, deliberately: the explicit marker, and H19's unresolved-branch
 * sentence, which is load-bearing prose that predates the marker and is pinned
 * by the self-test. Matching the sentence rather than only the marker keeps the
 * protection working for the population it was measured on rather than only for
 * rows written after it.
 */
export function isUnjudgedFinding(message) {
  const text = String(message ?? '');
  return text.startsWith(UNJUDGED_MARKER) || text.includes('is UNJUDGED, not confirmed');
}

/**
 * Every counter the summary sentence reads OFF `stats` — the forwarding
 * contract between the sweep and the renderers, in one place.
 *
 * ## Why this is a list and not eleven hand-written lines
 *
 * It used to be eleven hand-written lines, and two of them were missing.
 * `dispatchRefTargets`/`dispatchRefRead` were computed by the H20/H27 pass and
 * never copied into `counts`, so the dispatch-liveness clause rendered
 * `read on 0 of 0` on every live sweep from the day it was added — the
 * 2026-08-25T02:08Z run said it had read no branch at all while publishing two
 * H20 findings, which only a non-empty ref cache can produce.
 *
 * The failure is invisible by construction: `counts.x ?? 0` renders a missing
 * key and a genuine zero identically, and a genuine zero is a legitimate
 * reading ("nothing to probe this sweep"). So the coverage pair — the mechanism
 * whose entire job is to prove a pass examined something — was the one thing in
 * the report that could go quiet without any evidence that it had. #4690,
 * wearing the uniform of the check built to prevent it.
 *
 * Enumerating the keys makes the assembly mechanical: `sweep()` copies THIS
 * list, so adding a counter to `stats` and forgetting to forward it is no
 * longer possible, and the self-test can assert the contract directly rather
 * than re-deriving it from a rendered sentence.
 */
export const SWEEP_COUNT_KEYS = [
  'conflictCandidates',
  'conflictProbed',
  'sharedFileCandidates',
  'sharedFileProbed',
  'liveFolds',
  'memberReadCandidates',
  'memberReadProbed',
  'fallbackCandidates',
  'fallbackProbed',
  'restartCandidates',
  'restartProbed',
  'blockerTargets',
  'blockerResolved',
  'dispatchRefTargets',
  'dispatchRefRead',
  'crossRepoProbed',
  'crossRepoUnreadable',
  'seatCandidates',
  'seatMarkersRead',
  'commits',
  'commitBindings',
  'commitBindingMessages',
];

/**
 * The summary sentence both media end on — the one line that says what was
 * READ, not just what was found. It is the difference between "the board is
 * clean" and "nothing was swept", and it carries the report-only contract so
 * a reader who sees only this line cannot mistake it for a gate verdict.
 *
 * H16's two numbers are here for a reason the other counts do not have: it is
 * the only item whose input can fail PER ROW. A detail GET that fails leaves
 * that PR unjudged and the sweep still prints — correctly, since every other
 * item's findings are already gathered — so without these numbers a pass that
 * read nothing would be indistinguishable from a board with no conflicts. That
 * is the #4690 shape at row granularity, and the pair (`read X of Y`) is what
 * makes it visible. `??  0` rather than required: a caller assembling counts
 * without them still renders a sentence, never the string `undefined`.
 *
 * @param {{ repo: string, issues: number, unscoped: number, prs: number,
 *   merged: number, closed?: number, conflictProbed?: number, conflictCandidates?: number,
 *   holdProbed?: number, holdCandidates?: number, fallbackProbed?: number,
 *   fallbackCandidates?: number, restartProbed?: number,
 *   restartCandidates?: number, blockerResolved?: number,
 *   blockerTargets?: number, crossRepoProbed?: number,
 *   crossRepoUnreadable?: number, seatMarkersRead?: number,
 *   seatCandidates?: number, commits?: number, commitBindings?: number,
 *   commitBindingMessages?: number, closedFloor?: string }} counts
 * @param {number} findingCount
 */

export function summaryLine(counts, findingCount) {
  const probed = counts.conflictProbed ?? 0;
  const candidates = counts.conflictCandidates ?? 0;
  const held = counts.holdProbed ?? 0;
  const holdCandidates = counts.holdCandidates ?? 0;
  // The third `read X of Y` pair, and the one with a consequence the other two
  // do not have: a shortfall here does not merely leave rows out, it SILENCES
  // H14's stale direction (see the predicate). A reader seeing a quiet stale
  // section needs this number to tell "the cache is coherent" from "the sweep
  // declined to judge it".
  const fbProbed = counts.fallbackProbed ?? 0;
  const fbCandidates = counts.fallbackCandidates ?? 0;
  // H9's pair (#10403), same shape as H17's over the same fetches but for the
  // candidate set H9 judges. A shortfall here is not silent — an unreadable
  // thread fires its own card's H9 row — so like H19/H20 this is a total, owed
  // because a pass that read no thread must not print as a board whose holds
  // all answered from the body (#4690).
  const rwProbed = counts.restartProbed ?? 0;
  const rwCandidates = counts.restartCandidates ?? 0;
  // The fourth pair, and the one whose shortfall is NOT silent: an unresolved
  // `Blocked-by:` target fires its own H19 row on the card that names it, so
  // this number is a total rather than the only place the gap is visible. It
  // is still owed, for the reason every pair here is owed — a pass that
  // resolved nothing must not read the same as a board whose blocks are all
  // still live (#4690).
  const btResolved = counts.blockerResolved ?? 0;
  const btTargets = counts.blockerTargets ?? 0;
  // H19's cross-repo reachability readings (#11218) — how many DISTINCT sibling
  // repos this sweep probed directly, and how many refused. Reported because it
  // is what turns an unresolved cross-repo target from a guess into a
  // measurement, and because a reader needs to know the limit is structural
  // (a ruling) rather than a transient failure worth re-running.
  const crossRepoProbed = counts.crossRepoProbed ?? 0;
  const crossRepoUnreadable = counts.crossRepoUnreadable ?? 0;
  // H35's event window (#11881). Reported as a pair for the same reason every
  // pair above is: this is the file's ONLY reader of event history, so if the
  // window came up short there is no second reader to notice. `truncated` means
  // the page cap bound before the horizon was reached — the run saw less than
  // its stated 12h and must not read as a board with no gate removals in it.
  // The `unjudgeable` count is carried into the summary deliberately: it is the
  // measured residue of this row (29 over the 3.41-day derivation corpus, against
  // 0 half-writes), and burying it would let a quiet H35 section read as "the
  // gate is watched" when most removals are structurally unwatchable.
  const gateRemovals = counts.gateRemovals ?? 0;
  const gateEventPages = counts.eventPages ?? 0;
  const gateUnjudgeable = counts.gate_unjudgeable ?? 0;
  const gateUndated = counts.gate_undated ?? 0;
  const gateWindowTruncated = Boolean(counts.eventWindowTruncated);
  // H32's coverage pair — held, own-board seats and how many had their marker
  // thread read. A shortfall is not silent (an unread thread makes H32 DECLINE
  // to judge that seat, which is the quiet direction), so this is the only
  // place a reader could see that a seat went unexamined.
  const seatsRead = counts.seatMarkersRead ?? 0;
  const seatCandidates = counts.seatCandidates ?? 0;
  // The fifth pair, H20's, and the same shape as H19's for the same reason: an
  // unreadable ref fires its own card's quieter row, so this is a total rather
  // than the only place the gap shows. Still owed — a pass that read no ref at
  // all must not read the same as a board where every dispatch is live (#4690).
  const refRead = counts.dispatchRefRead ?? 0;
  const refTargets = counts.dispatchRefTargets ?? 0;
  // H23's coverage numbers. Not a `read X of Y` pair — nothing here can fail per
  // row — but the same duty in the measure-first register the row was
  // commissioned in (#10942): the row's yield is ~6 in 1,546, so a quiet H23 is
  // the normal reading and the ONLY thing separating "this surface was read and
  // is clean" from "no commit message was read at all" is these counts. The
  // binding totals ride along because they are what a later blocking-promotion
  // decision needs and they cost nothing to carry.
  const commits = counts.commits ?? 0;
  const commitBindings = counts.commitBindings ?? 0;
  const commitBindingMessages = counts.commitBindingMessages ?? 0;
  return (
    `check-half-states: swept ${counts.issues} open pm-/p0-labeled issue(s), ${counts.unscoped} open ` +
    `issue(s) in the unscoped pass (H13–H15, H18), ${counts.prs} open PR(s) ` +
    `(merge state read on ${probed} of ${candidates} H16 candidate(s)) ` +
    `and ${counts.merged} recently-merged PR(s) in ${counts.repo} — ${findingCount} half-state(s) found. ` +
    `H22 read ${counts.closed ?? 0} recently-closed issue(s) for \`pm:*\` state residue (bounded window; ` +
    `older closed carriers are outside it by design` +
    `${counts.closedFloor ? `, and only cards closed on/after ${counts.closedFloor} are judged — ` +
      'earlier closures predate the strip-on-close convention and are NOT a reading about them' : ''}). ` +
    `H23 read ${commits} squash commit message(s) from the default branch's recent window, carrying ` +
    `${commitBindings} closing-keyword binding(s) across ${commitBindingMessages} message(s) ` +
    `(bounded window; a message that landed before it is invisible by design). ` +
    `Hold comments read on ${held} of ${holdCandidates} H17 candidate(s). ` +
    `\`Blocked-by:\` comment fallback read on ${fbProbed} of ${fbCandidates} candidate(s)` +
    `${fbProbed < fbCandidates ? " — H14's stale direction is SUSPENDED for this sweep (the index is known incomplete)" : ''}. ` +
    `\`Restart-when:\` hold comments read on ${rwProbed} of ${rwCandidates} H9 candidate(s)` +
    `${rwProbed < rwCandidates ? " — each unread thread fires its own card's H9 row, never dropped" : ''}. ` +
    `Blocker liveness (H19): targets resolved on ${btResolved} of ${btTargets} distinct \`Blocked-by:\` ` +
    `target(s) named by open \`pm:blocked\` card(s)` +
    `${
      btResolved < btTargets
        ? ` — the ${btTargets - btResolved} unresolved target(s) are named on their own cards' rows, and ` +
          'those rows sort ABOVE the size trim so they cannot be what a truncated body drops (#11218: ' +
          'this clause used to be an unconditional promise, and on the 2026-08-25T02:08Z sweep it was ' +
          'false — 199 rows were trimmed and not one rendered row carried an unresolved target)'
        : ''
    }` +
    `${
      crossRepoProbed > 0
        ? ` Cross-repo reachability was measured directly on ${crossRepoProbed} sibling repo(s), of which ` +
          `${crossRepoUnreadable} do(es) not answer this credential — those targets are unjudgeable by ` +
          'ruling (each install reads its own repo with its own repo-scoped token) and ⛔ no re-run ' +
          'resolves them.'
        : ''
    } ` +
    `Dispatch liveness (H20 + H27): remote branch read on ${refRead} of ${refTargets} distinct claimed ` +
    `branch(es) named by open \`pm:dispatched\` card(s) past the ${DISPATCHED_NO_REF_STALE_MINUTES}-minute ` +
    `threshold — one read serving both rows, so H27's ${DEAD_CLAIM_STALE_HOURS}h population is a subset ` +
    'of this one and costs no request of its own' +
    `${refRead < refTargets ? ' — each unread branch is named on its own card\'s row, never dropped' : ''}. ` +
    `Seat liveness (H32): marker thread read on ${seatsRead} of ${seatCandidates} HELD seat post(s) whose ` +
    'lane is countable on THIS board — a seat held for a sibling repo\'s lane is out of scope here (its ' +
    'inventory is unreadable from this sweep, so an empty-looking queue would mean nothing), and an ' +
    'unread thread makes H32 decline to judge that seat rather than accuse it. ' +
    `Gate-removal patrol (H35): ${gateRemovals} removal(s) of a gate-semantic label read from ` +
    `${gateEventPages} page(s) of the repo-wide issue-event stream over the last ` +
    `${H35_EVENT_WINDOW_HOURS}h — no per-card timeline fetch. ${gateUnjudgeable} of them are ` +
    'UNJUDGEABLE (a gate that only ever had ONE carrier leaves 「双载体同笔清标」 no evidence in ' +
    'either direction, so neither H31 nor H35 can say cleared-or-stripped)' +
    `${gateUndated > 0 ? `, and ${gateUndated} more had no hang inside the window` : ''}` +
    `${
      gateWindowTruncated
        ? ` ⚠️ The event window was TRUNCATED at the ${H35_EVENT_PAGE_CAP}-page cap before reaching ` +
          `the ${H35_EVENT_WINDOW_HOURS}h horizon — this run saw LESS than its stated window, so a ` +
          'quiet H35 section here is a short read, not a clean board.'
        : '.'
    } ` +
    `Shared-file holds (H36): changed-file page read on ${counts.sharedFileProbed ?? 0} of ` +
    `${counts.sharedFileCandidates ?? 0} open PR(s) — a pair needs both sides read, so a shortfall ` +
    'can only MISS a hold, never invent one. ' +
    `Family folds (H37): ${counts.liveFolds ?? 0} live shared branch(es) claimed by more than their ` +
    `own chain head, and a member comment page read on ${counts.memberReadProbed ?? 0} of ` +
    `${counts.memberReadCandidates ?? 0} open \`pm:queue\` card(s) — that second read is bought ONLY ` +
    'when a fold is live, so 0 of 0 is a board with no fold in flight rather than a pass that ' +
    'skipped one, and an unread member can only MISS a drifted write, never invent one.' +
    `${
      h37MemberPassUnreadable(counts.memberReadCandidates, counts.memberReadProbed)
        ? ' ⚠️ NO member page was readable on this run, so H37 saw a live fold and judged its queue ' +
          'side on NOTHING — a quiet H37 section here is the transport, not a fold whose writes all ' +
          'landed.'
        : ''
    } ` +
    `Report-only: findings are patrol input, not a gate verdict.`
  );
}

/**
 * The H17 section, in either medium — one builder so the two renderers can
 * never drift on WHAT the index says, only on how it is marked up.
 *
 * Returns `[]` when no index was supplied at all, which keeps every existing
 * two-argument call byte-identical: a caller that does not gather the index
 * gets the report it always got, rather than a section claiming an empty
 * board.
 *
 * The three states it can be in are deliberately distinguishable, because two
 * of them look identical if you let them (#4690):
 *
 *   - oracle unreadable  → says so, loudly, and claims nothing about holds
 *   - read, nothing found → says the holds were READ and name no tracked file
 *   - read, rows          → the index
 *
 * @param {{ rows: Array<{issue: object, files: string[]}>, candidates?: number,
 *   probed?: number, tracked?: number|null }} [index]
 * @param {{ markdown?: boolean }} [options]
 */
export function renderTriggerIndex(index, { markdown = false } = {}) {
  if (!index) return [];
  const rows = index.rows ?? [];
  const probed = index.probed ?? 0;
  const candidates = index.candidates ?? 0;
  const read = `read on ${probed} of ${candidates} open \`pm:on-hold\` card(s)`;
  const head = markdown
    ? ['### On-hold trigger-file index (H17)', '']
    : ['', 'On-hold trigger-file index (H17)'];

  if (index.tracked == null) {
    head.push(
      `⚠️ The tracked-file oracle (\`git ls-files\`) could not be read, so NO candidate path was ` +
        `validated and this index is EMPTY BY FAILURE, not by finding. Run the patrol from inside a ` +
        `checkout. (${read}.)`,
    );
    return head;
  }

  const intro =
    `Before dispatching, intersect your dispatch's file surface against this list and NAME any card ` +
    `it hits in the dispatch brief. These are the trigger files open holds declare — the ` +
    `opportunistic-restart mechanism (maintainer-accepted 2026-08-11) whose intersection was ` +
    `measured at 0-for-19 while it lived only as a remembered protocol step (#10034). Report-only: ` +
    `a card here is a hold in good standing, never a finding. Extraction is deterministic — every ` +
    `path shown is a tracked file; anything unverifiable was dropped rather than guessed, so this ` +
    `list under-reports and never invents. (${read}; ${index.tracked} tracked file(s) in the oracle.)`;
  head.push(intro, '');

  if (rows.length === 0) {
    head.push(
      markdown
        ? '_No open hold names a tracked trigger file. The holds were READ — this is a clean reading, not an unread one._'
        : '  (no open hold names a tracked trigger file — read, not unread)',
    );
    return head;
  }

  const shown = rows.slice(0, H17_INDEX_ROW_CAP);
  for (const { issue, files } of shown) {
    if (markdown) {
      head.push(
        `- [#${issue.number}](${issue.html_url}) — ${files.map((f) => `\`${f}\``).join(', ')}`,
      );
    } else {
      head.push(`  #${issue.number} ${files.join(', ')}`, `     ${issue.html_url}`);
    }
  }
  if (rows.length > shown.length) {
    const omitted = `… ${rows.length - shown.length} further card(s) omitted at the H17_INDEX_ROW_CAP render budget; the full list is in the workflow run log.`;
    head.push(markdown ? `- _${omitted}_` : `  ${omitted}`);
  }
  return head;
}

/**
 * The terminal report — byte-identical to what this script printed before the
 * format switch existed. Findings arrive already sorted by issue number and
 * that order is kept: a terminal has no fold, so there is nothing for a
 * priority sort to buy here, and changing it would churn every seat's habit.
 *
 * The H17 index sits BETWEEN the findings and the summary line, which is the
 * one placement the terminal medium allows: the summary sentence must stay the
 * last line of the report (it is what a seat reads off the bottom of a scroll,
 * and the self-test pins it there), while the index must not be separated from
 * the rows by it. In the anchor body the ordering question resolves differently
 * — see `renderMarkdown`.
 */
export function renderPlain(findings, counts, options = {}) {
  const lines = findings.map(
    ([issue, code, msg]) => `  ${code} #${issue.number} ${msg}\n     ${issue.html_url}`,
  );
  lines.push(...renderTriggerIndex(options.triggerIndex, { markdown: false }));
  lines.push(summaryLine(counts, findings.length));
  return lines.join('\n');
}

/**
 * Provenance is a one-line string the CALLER supplies (`--provenance=…`): the
 * script knows it swept, it does not know it was a GitHub Actions run #123 at
 * commit abc1234, and teaching it would couple a repo-agnostic sweeper to one
 * caller. Collapsed to a single line and length-capped here rather than
 * trusted: it is interpolated into a markdown italic line, and a newline in it
 * would silently break the header apart.
 */
export function normalizeProvenance(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * The anchor-body report.
 *
 * Row order differs from `renderPlain` on purpose, and the reason is the
 * medium: this body is READ AT A FOLD and TRIMMED AT A CAP. A P0-SUSPECT row
 * sitting at position 38 of 40 — or trimmed off the end entirely — is exactly
 * the silence this sweeper's standing caller exists to end, so loud rows sort
 * first and are therefore the last things truncation could ever reach. Within
 * each band the issue-number order is preserved, so the list is still stable
 * run to run and diffable in the anchor's edit history.
 *
 * The header is deliberately restated every run rather than left as a
 * hand-written preamble the workflow must not clobber: the body is owned by
 * this generator, end to end, so there is no half of it that a run can leave
 * stale. First line is a bare literal marker with no angle brackets — the
 * board's markers are grepped as literal text, never as comment syntax,
 * because GitHub's body sanitizer eats short `<…>` fragments on write.
 */
export function renderMarkdown(findings, counts, options = {}) {
  const provenance = normalizeProvenance(options.provenance);
  const sweptAt = options.sweptAt instanceof Date ? options.sweptAt : new Date();
  // Three ranks, and the middle one is load-bearing (#11218): P0-suspect rows,
  // then UNJUDGED rows, then everything else by card number. The trim below
  // eats the TAIL, so this ordering is what makes the summary's "never dropped"
  // clause true — see `UNJUDGED_MARKER` for the sweep on which it was false.
  const rows = [...findings].sort(
    (a, b) =>
      Number(isLoudFinding(b[2])) - Number(isLoudFinding(a[2])) ||
      Number(isUnjudgedFinding(b[2])) - Number(isUnjudgedFinding(a[2])) ||
      a[0].number - b[0].number,
  );
  const loudCount = rows.filter(([, , msg]) => isLoudFinding(msg)).length;
  const unjudgedCount = rows.filter(([, , msg]) => isUnjudgedFinding(msg)).length;

  const head = [
    'os-half-state-sweep — machine-findable marker for this generated view.',
    '',
    '**Generated view — not a second tracker.** Authority lives on each card and PR (one-board rule);' +
      ' this body is rewritten IN PLACE by the scheduled patrol workflow' +
      ' (`.github/workflows/half-state-patrol.yml`) on every run, and the edit history is the archive.' +
      ' **Report-only**: every row is patrol input, never a gate verdict, and this sweep never fixes a' +
      ' state. Each predicate and the protocol clause it enforces are documented in' +
      ' `scripts/pm/check-half-states.mjs`.',
    '',
    `_Swept ${sweptAt.toISOString()}${provenance ? ` · ${provenance}` : ''}_`,
    '',
    'The timestamp above is the patrol\'s own heartbeat: a `Swept` line that stops advancing means the' +
      ' standing caller died, which is the failure this anchor was created to make visible. Read it' +
      ' before you read the rows.',
    '',
  ];

  if (loudCount > 0) {
    head.push(
      `🚨 **${loudCount} P0-SUSPECT row(s) in this sweep** — for that class the mandated move is the` +
        ' emergency-triage channel (an immediate triage subagent), never waiting for the next hourly' +
        ' Routine fire. They are sorted to the top of the list below.',
      '',
    );
  }

  if (unjudgedCount > 0) {
    head.push(
      `⚠️ **${unjudgedCount} UNJUDGED row(s) in this sweep** — an input this patrol could NOT read,` +
        ' not a state it read and found clean. They are sorted above the ordinary rows so the' +
        " body's size trim can never be what removes them (#4690, #11218), and they are the rows to" +
        ' judge BY HAND: nothing in a later sweep will resolve them on its own.',
      '',
    );
  }

  head.push(`**${summaryLine(counts, rows.length)}**`, '');

  // The H17 index is built BEFORE the findings are laid out and appended
  // AFTER them: findings are alarms and keep the top of the body, while the
  // index is the reference a dispatching seat reads on purpose. Building it
  // first is what lets its length be RESERVED out of the budget below, so a
  // noisy board can never truncate the index away — the trim then falls on
  // finding rows, which announce their own omission and are recoverable from
  // the run log. An index silently missing from the anchor would restore
  // exactly the 0-for-19 silence this section exists to end.
  const indexBlock = renderTriggerIndex(options.triggerIndex, { markdown: true });
  const indexText = indexBlock.length > 0 ? `\n\n${indexBlock.join('\n')}` : '';

  if (rows.length === 0) {
    head.push(
      '✅ No half-states found in this sweep. This line means the board was READ and is clean — a sweep' +
        ' that could not RUN replaces this whole body with a prerequisite/failure report instead, so a' +
        ' green anchor is never the sound of a broken sweeper.',
    );
    return `${head.join('\n')}${indexText}`;
  }

  head.push('### Findings', '', '');
  const body = head.join('\n');
  const rendered = [];
  let used = body.length + indexText.length;
  for (let i = 0; i < rows.length; i++) {
    const [issue, code, msg] = rows[i];
    const line = `- **${code}** [#${issue.number}](${issue.html_url}) — ${msg}`;
    // Reserve room for the omission notice itself, so the trim can always
    // announce itself even when it fires on the very last row.
    const notice = `\n- _… ${rows.length - i} further row(s) omitted to fit GitHub's issue-body limit; the full list is in the workflow run log._`;
    if (used + line.length + 1 + notice.length > MARKDOWN_BODY_BUDGET) {
      rendered.push(notice.slice(1));
      break;
    }
    rendered.push(line);
    used += line.length + 1;
  }
  return `${body}${rendered.join('\n')}${indexText}`;
}

/**
 * Output options off argv. Pure, so `--self-test` pins the usage errors too:
 * a mistyped `--format` must be a LOUD non-zero exit, never a silent fallback
 * to plain text that would leave the anchor updated with an unreadable body.
 *
 * @param {string[]} argv
 * @returns {{ format: string, provenance: string, error?: string }}
 */
export function parseOutputOptions(argv) {
  const out = { format: 'plain', provenance: '' };
  for (const arg of argv ?? []) {
    const fmt = /^--format=([\s\S]*)$/.exec(arg);
    if (fmt) {
      if (!OUTPUT_FORMATS.includes(fmt[1])) {
        return {
          ...out,
          error: `unknown --format=${fmt[1]} — expected one of: ${OUTPUT_FORMATS.join(', ')}`,
        };
      }
      out.format = fmt[1];
      continue;
    }
    const prov = /^--provenance=([\s\S]*)$/.exec(arg);
    if (prov) out.provenance = normalizeProvenance(prov[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transport prerequisite — the classifier (pure) and the probe that feeds it.
//
// Modelled on `scripts/cli-build-prerequisite.mjs`: the knowledge lives in pure
// functions the self-test can drive with the REAL measured observations, and the
// WORDING stays here, next to the only code that knows what it did not check.
// Kept in this file rather than shared with the CLI-build prerequisites — those
// classify a subprocess's stderr, this classifies HTTP observations; a common
// module would be one name over two unrelated corpora.
// ---------------------------------------------------------------------------

/** The exit code for a classified transport prerequisite failure (see header). */
export const EXIT_PREREQUISITE_NOT_MET = 3;

/**
 * What the token in the environment LOOKS like — never whether it is valid; only
 * GitHub can say that, and a 401 is it saying so. This exists to enrich the
 * report ("…and it carries no GitHub token prefix"), never to pre-reject a token:
 * pre-rejecting on shape would silently drop a credential in a format GitHub
 * added after this line was written, which is the confident-wrong-diagnosis
 * failure the sibling module is built to avoid.
 *
 * `redacted` is prefix-plus-length, the same form #7412 used to report the
 * `prox…` placeholder. A real token's first four characters are its public
 * prefix, so this is safe to print; the rest never is.
 *
 * @param {string} token
 * @returns {{ present: boolean, shape: 'absent'|'github-prefix'|'legacy-40-hex'|'unrecognized', redacted: string }}
 */
export function describeToken(token) {
  const t = String(token ?? '');
  if (!t) return { present: false, shape: 'absent', redacted: '<unset>' };
  const redacted = `${t.slice(0, 4)}… (len ${t.length})`;
  if (/^(?:gh[pousr]_|github_pat_)/.test(t)) return { present: true, shape: 'github-prefix', redacted };
  if (/^[0-9a-f]{40}$/.test(t)) return { present: true, shape: 'legacy-40-hex', redacted };
  return { present: true, shape: 'unrecognized', redacted };
}

/**
 * Whether a probe result means "requests will actually go through" — which is
 * NOT the same as "the probe returned 200".
 *
 * `/rate_limit` is exempt from the rate limit it reports: with the anonymous
 * quota spent it still answers 200, carrying `x-ratelimit-remaining: 0`, while
 * `/repos/…/issues` answers 403 `API rate limit exceeded`. Measured on this
 * change's own container, where the first draft of this probe green-lit a sweep
 * that then failed on its very first page. A `null` remaining (header absent) is
 * treated as usable: absence is not evidence of exhaustion, and the in-loop net
 * is the backstop.
 */
export function probeIsUsable(result) {
  if (!result || result.networkError) return false;
  return result.status === 200 && result.rateLimitRemaining !== 0;
}

/**
 * `x-ratelimit-remaining` as a number, or null when the header is absent.
 *
 * The null matters and `Number()` alone will not give it: `Number(null)` is 0,
 * and a 401 carries no rate-limit headers at all — so the naive read turns every
 * bad-credential response into "quota exhausted" and would misprescribe the
 * remedy. Absent means unknown, and `probeIsUsable` treats unknown as usable.
 */
export function parseRemaining(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** One probe result as a readable clause, for the report's evidence lines. */
export function describeProbe(result) {
  if (!result) return 'not attempted';
  if (result.networkError) return `did not complete (${result.networkError})`;
  if (result.status === 200 && result.rateLimitRemaining === 0) {
    return 'HTTP 200 but with x-ratelimit-remaining: 0 — the quota endpoint is exempt from the limit it reports, so every other endpoint answers 403';
  }
  const left = result.rateLimitRemaining === null || result.rateLimitRemaining === undefined ? '' : ` (${result.rateLimitRemaining} left)`;
  return `HTTP ${result.status}${left}`;
}

/**
 * The exhausted-quota verdict, shared by the two observations that mean it: a
 * 403 on a real endpoint, and `/rate_limit`'s exempt 200 with 0 remaining.
 */
function rateLimitedVerdict(tok, result, how) {
  return {
    kind: 'rate-limited',
    headline: tok.present
      ? 'the API rate limit for this credential is exhausted'
      : 'the anonymous API rate limit (60 req/h) is exhausted for this egress IP',
    detail: [
      `\`GET /rate_limit\` -> ${describeProbe(result)}.`,
      ...(how ? [`In this state ${how}.`] : []),
      ``,
      ...(tok.present
        ? [`The quota refills on the hour.`]
        : [
            `The anonymous 60 req/h is counted per EGRESS IP, not per container, so in a`,
            `shared-NAT agent container it is routinely already spent by neighbours — being`,
            `"unauthenticated" is not a quota of one's own. It refills on the hour.`,
          ]),
    ],
    fix: tok.present
      ? ['wait for the quota window, or use a credential with a larger quota.']
      : ['export GITHUB_TOKEN=<a real GitHub token> (5,000+ req/h), or wait for the window.'],
  };
}

/**
 * The repo-scoped half of the verdict (#9946) — the stage-2 reading, judged
 * against a stage-1 reading that already said the transport was healthy.
 *
 * Returns a verdict for a refusal, or null when the repo read is fine or is
 * something this classifier declines to name. Kept as its own function for the
 * same reason `rateLimitedVerdict` is: the wording lives next to the only code
 * that knows what it did and did not check.
 *
 * The matching condition carries NO vendor string and NO token-shape test —
 * both were considered and rejected on #9946, and the header says why. What it
 * matches is the structural contradiction the two stages make together: the
 * quota endpoint reports thousands of core requests available, and a core
 * request just got refused. That is unambiguous regardless of who refused it,
 * and it stays true if the intercepting proxy rewrites its message tomorrow.
 *
 * @param {{ present: boolean, shape: string, redacted: string }} tok
 * @param {{ status?: number, rateLimitRemaining?: number|null }} primary  the stage-1 reading
 * @param {{ status?: number, rateLimitRemaining?: number|null, networkError?: string }} repo
 */
function classifyRepoRead(tok, primary, repo) {
  if (!repo || repo.networkError) return null;
  if (repo.status === 200 || repo.status === 301) return null;

  // A genuine quota exhaustion that happened BETWEEN the two stages — rare, but
  // it wears the same 403 and has a completely different remedy, so it must not
  // be reported as a scope refusal.
  if (repo.rateLimitRemaining === 0) return rateLimitedVerdict(tok, repo, 'the repo-scoped read is refused too');

  const quota =
    primary.rateLimitRemaining === null || primary.rateLimitRemaining === undefined
      ? 'quota left'
      : `${primary.rateLimitRemaining} core requests left`;

  if (repo.status === 404) {
    return {
      kind: 'repo-not-visible',
      headline: `\`${OWNER_REPO}\` is not visible to this identity — this container cannot read it`,
      detail: [
        `\`GET /rate_limit\` -> ${describeProbe(primary)}, but \`GET /repos/${OWNER_REPO}\` -> HTTP 404.`,
        ``,
        `GitHub answers 404 rather than 403 for a repository the caller may not know`,
        `exists, so this is one of two things and the reading cannot say which: the`,
        `repo name is wrong, or the credential cannot see it.`,
      ],
      fix: [
        `check PM_SWEEP_REPO (currently \`${OWNER_REPO}\`), then the credential's repo scope.`,
      ],
    };
  }

  // 401/403 ONLY — the fourth container class as measured on 2026-08-19. Any
  // other status is left unnamed on purpose (a 5xx is GitHub or the proxy being
  // briefly unwell, not a scope decision), and the caller keeps its loud generic
  // failure rather than being handed a confident wrong diagnosis.
  if (repo.status !== 401 && repo.status !== 403) return null;

  return {
    kind: 'repo-scope-refused',
    headline:
      'the transport authenticates but repo-scoped reads are refused — this container cannot make one repo-scoped request',
    detail: [
      `\`GET /rate_limit\` -> ${describeProbe(primary)}.`,
      `\`GET /repos/${OWNER_REPO}\` -> HTTP ${repo.status}${
        repo.rateLimitRemaining === null || repo.rateLimitRemaining === undefined
          ? ' with no x-ratelimit-* headers at all'
          : ` (${repo.rateLimitRemaining} left)`
      }.`,
      ``,
      `Those two readings contradict each other: the quota endpoint reports ${quota},`,
      `and a core request was just refused anyway. A quota that is not being spent`,
      `cannot be what is blocking the read, so something between node and GitHub is`,
      `answering for repo-scoped paths — the shape #9946 measured, where the account-`,
      `scoped endpoints reached GitHub (\`server: github.com\`, real request ids) while`,
      `every repo-scoped one was refused by the egress proxy with no GitHub headers.`,
      ``,
      `This is reported instead of a green precisely because the stage-1 reading here`,
      `is INDISTINGUISHABLE from the healthy Routine runner's. Before this stage`,
      `existed the probe said the prerequisite was met and the first repo-scoped`,
      `request then 403'd — the #4690 inversion, inside the mechanism built to`,
      `prevent it.`,
    ],
    fix: [
      'run this from a container whose egress allows repo-scoped reads (CI, or the',
      'Routine seat class); in a proxy-mediated seat, repo-scoped reads stay on the',
      '`mcp__github__*` tools, which take a different path and do work here.',
    ],
  };
}

/**
 * Turn probe OBSERVATIONS into a named prerequisite verdict. Pure — the network
 * lives in `probeTransport` — so `--self-test` can pin every branch against the
 * four container classes actually measured (#7412, #9946).
 *
 * Deliberately narrow, in the same direction as `looksLikeStaleWorkspaceDist`:
 * an unrecognised status comes back as `null` (= "not a failure this classifier
 * can name") and the caller keeps its pre-existing loud generic failure. A wrong
 * confident diagnosis here would send a seat to fix a credential when GitHub was
 * merely down.
 *
 * @param {{ token?: string, authed?: object|null, anon?: object|null, repo?: object|null }} obs
 *   `authed` / `anon` are each `{ status, rateLimitRemaining }` or
 *   `{ networkError }`; `anon` is only gathered when a token was used and failed.
 *   `repo` is the OPTIONAL repo-scoped reading (`GET /repos/{owner}/{repo}`),
 *   gathered only when the account-scoped evidence already reads `reachable`.
 *   Absent, this classifies the account-scoped evidence alone — the behaviour
 *   every caller had before #9946.
 * @returns {{ kind: string, headline: string, detail: string[], fix: string[] } | null}
 */
export function classifyTransportProbe(obs) {
  const token = obs?.token ?? '';
  const tok = describeToken(token);
  const authed = obs?.authed ?? null;
  const anon = obs?.anon ?? null;
  const repo = obs?.repo ?? null;
  const primary = tok.present ? authed : anon;
  if (!primary) return null;
  const anonUsable = probeIsUsable(anon);

  const shapeNote =
    tok.shape === 'unrecognized'
      ? `The value carries no GitHub token prefix (\`ghp_\`/\`gho_\`/\`ghs_\`/\`github_pat_\`) — in`
      : `The value has a GitHub token shape, so it is a credential this account no longer holds —`;
  const shapeNote2 =
    tok.shape === 'unrecognized'
      ? `agent containers this is normally the proxy's own placeholder, not a credential.`
      : `expired, revoked, or scoped to a different repo.`;

  if (primary.networkError) {
    return {
      kind: 'host-unreachable',
      headline: '`api.github.com` is not reachable from node in this container',
      detail: [
        `\`GET /rate_limit\` did not complete: ${primary.networkError}`,
        ``,
        `Node's fetch does not use HTTPS_PROXY, so this says nothing about \`curl\`, \`gh\``,
        `or the \`mcp__github__*\` tools — those may all work here and still not be this`,
        `script's transport.`,
      ],
      fix: [
        'run this from a container with direct egress to api.github.com (CI, or the',
        'Routine seat class); in an MCP-only seat this stays manual — the',
        '`mcp__github__*` tools take a different path and may still work.',
      ],
    };
  }

  // A 200 from `/rate_limit` is NOT sufficient, and finding that out is what the
  // measurement below cost: GitHub exempts `/rate_limit` from the limit it
  // reports, so it keeps answering 200 with `x-ratelimit-remaining: 0` while
  // every other endpoint answers 403. A probe that read only the status would
  // vouch for a sweep that cannot make a single request — the exact
  // "green check that checked nothing" this file exists to refuse (#4690).
  if (primary.status === 200 && primary.rateLimitRemaining === 0) {
    return rateLimitedVerdict(tok, primary, 'every OTHER endpoint answers 403 `API rate limit exceeded`');
  }

  if (primary.status === 200) {
    // Stage 2 (#9946). The account-scoped evidence is healthy — which in the
    // fourth container class is TRUE and still does not mean the sweep can run.
    // Only a repo-scoped reading separates that class from the Routine runner,
    // and the two observations are indistinguishable without it.
    const repoVerdict = repo ? classifyRepoRead(tok, primary, repo) : null;
    if (repoVerdict) return repoVerdict;
    if (repo && !(repo.status === 200 || repo.status === 301)) {
      // Handed a repo reading this classifier cannot name (a 5xx, a transient
      // network error moments after the host answered): stay unclassified
      // rather than either vouching for the transport or blaming a credential.
      // The caller keeps its loud generic failure — the same narrowness the
      // account-scoped branches take.
      return null;
    }
    return {
      kind: 'reachable',
      headline: tok.present
        ? 'api.github.com is reachable and the token authenticates'
        : 'api.github.com is reachable anonymously (no token in the environment)',
      detail: [],
      fix: [],
    };
  }

  if (primary.status === 401 || (primary.status === 403 && anonUsable)) {
    const anonWorks = anonUsable;
    return {
      kind: anonWorks ? 'bad-credential-anon-reachable' : 'bad-credential',
      headline: anonWorks
        ? 'the token in the environment is not a valid GitHub credential — and it is the ONLY thing stopping this container from reading'
        : 'the token in the environment is not a valid GitHub credential',
      detail: [
        `\`GET /rate_limit\` with GITHUB_TOKEN/GH_TOKEN = ${tok.redacted} -> ${describeProbe(primary)}.`,
        ...(anon ? [`The same request with NO token -> ${describeProbe(anon)}.`] : []),
        ``,
        `${shapeNote} ${shapeNote2}`,
        ``,
        ...(anonWorks
          ? [
              `The host IS reachable from node here and anonymous access has quota left, so`,
              `the credential is the only thing in the way.`,
              ``,
              `This script does not drop the token on its own — which token to send is the`,
              `caller's decision, and silently sweeping as a different identity is not a call`,
              `a report-only tool should make (#7412 triage: transport doctrine is the`,
              `maintainer's).`,
            ]
          : [
              `Dropping the token would NOT be enough here: the anonymous path is unusable`,
              `too, so this container needs a real credential rather than a re-run.`,
            ]),
      ],
      fix: anonWorks
        ? [
            'GITHUB_TOKEN= GH_TOKEN= node scripts/pm/check-half-states.mjs',
            '  ↑ anonymous is 60 req/h and that quota is per EGRESS IP, shared with every',
            '    other container behind it. A request-heavy run can exhaust it mid-run,',
            '    which then surfaces as another PREREQUISITE NOT MET, never as a short',
            '    finding list.',
          ]
        : ['export GITHUB_TOKEN=<a real GitHub token> and re-run (see the anonymous reading above).'],
    };
  }

  if (primary.status === 403) {
    if (primary.rateLimitRemaining === 0) {
      return rateLimitedVerdict(tok, primary, '');
    }
    return {
      kind: 'host-unreachable',
      headline: '`api.github.com` answers 403 in this container — the host is refusing, not rate-limiting',
      detail: [
        `\`GET /rate_limit\` -> HTTP 403${tok.present ? ` with GITHUB_TOKEN/GH_TOKEN = ${tok.redacted}` : ' (no token)'}.`,
        ...(anon ? [`The same request with NO token -> ${anon.networkError ? anon.networkError : `HTTP ${anon.status}`}.`] : []),
        ``,
        `403 in both directions with quota left is the egress proxy refusing the host,`,
        `not GitHub refusing the caller — the shape #7412 measured in a PM seat session.`,
        `\`curl\` and the \`mcp__github__*\` tools take a different path and may still work.`,
      ],
      fix: [
        'run this from a container with direct egress to api.github.com (CI, or the',
        'Routine seat class); in an MCP-only seat this stays manual — the',
        '`mcp__github__*` tools take a different path and may still work.',
      ],
    };
  }

  return null;
}

/**
 * The observations, gathered from the live host. `/rate_limit` is the probe
 * because it is the one endpoint that costs no core quota — asking "can I read
 * this board?" must not spend the budget the sweep then needs.
 *
 * The second, token-less probe fires ONLY when a token was sent and failed. That
 * is what separates "the credential is bad" from "the host is unreachable" —
 * two facts with different remedies that the card's original measurement could
 * not tell apart. The healthy path stays at exactly one request.
 */
async function probeRateLimit(token) {
  try {
    const res = await fetch(`${API}/rate_limit`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    return { status: res.status, rateLimitRemaining: parseRemaining(res.headers.get('x-ratelimit-remaining')) };
  } catch (err) {
    return { networkError: err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'fetch failed' };
  }
}

/**
 * The stage-2 reading (#9946): one repo-scoped GET, the cheapest request that
 * exercises the same scope the sweep's every listing needs.
 *
 * `GET /repos/{owner}/{repo}` and not `GET /user`: the measured fourth class
 * answers 200 on `/user` — account-scoped endpoints reach GitHub there — so an
 * "is this a real endpoint" probe would have green-lit it just as `/rate_limit`
 * did. What has to be exercised is the SCOPE, not the realness.
 *
 * Costs one core request. `/repos/{owner}/{repo}` rather than a one-item issues
 * page because it is the smaller body and the same authorization decision.
 */
async function probeRepoRead(token) {
  try {
    const res = await fetch(`${API}/repos/${OWNER_REPO}`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    return { status: res.status, rateLimitRemaining: parseRemaining(res.headers.get('x-ratelimit-remaining')) };
  } catch (err) {
    return { networkError: err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'fetch failed' };
  }
}

/**
 * Whether the stage-1 verdict warrants spending a core request on stage 2.
 *
 * Only a `reachable` does — which is exactly the path that used to return a
 * green without ever having read anything repo-scoped. Every failing class
 * short-circuits here, so none of them costs a request more than it did before.
 *
 * Exported so `--self-test` can pin the sequencing: the guarantee that this
 * script never green-lights on account-scoped evidence alone is a property of
 * the GATHERING, not of the pure classifier (which, handed no repo reading,
 * still classifies exactly as it always did for its other importer).
 */
export function needsRepoProbe(accountVerdict) {
  return accountVerdict?.kind === 'reachable';
}

async function probeTransport() {
  const first = await probeRateLimit(TOKEN);
  const account = !TOKEN
    ? classifyTransportProbe({ token: '', anon: first })
    : first.status === 200
      ? classifyTransportProbe({ token: TOKEN, authed: first })
      : classifyTransportProbe({ token: TOKEN, authed: first, anon: await probeRateLimit('') });

  if (!needsRepoProbe(account)) return account;

  // Re-classified with the repo reading added, rather than patched on top of the
  // stage-1 verdict: one classifier, one place where a verdict is named.
  const repo = await probeRepoRead(TOKEN);
  return TOKEN
    ? classifyTransportProbe({ token: TOKEN, authed: first, repo })
    : classifyTransportProbe({ token: '', anon: first, repo });
}

/**
 * The prerequisite printer. Its load-bearing half is the closing paragraph: the
 * whole point of #4690 is that "could not read the input" must never be legible
 * as "the input is clean", and on a REPORT-ONLY tool that risk is sharper than
 * on a gate — a silent run of this script looks exactly like a healthy board.
 *
 * `swept` keeps that paragraph TRUE when the failure arrives mid-run: the
 * pre-sweep probe fires at 0, where "nothing was listed" is exact, while the
 * in-loop net can fire after some labels were already read. Same invariant as
 * `check-i18n-bundles`'s partial-round wording (#7681/#6033).
 *
 * @param {{ kind: string, headline: string, detail: string[], fix: string[] }} v
 * @param {{ swept?: number }} [options]
 */
function reportPrerequisiteNotMet(v, options = {}) {
  const { swept = 0 } = options;
  const nothing =
    swept === 0
      ? [
          `  Nothing was swept: no issue was listed, no predicate (H1–H16) ran, and the H17`,
          `  trigger-file index gathered nothing, so this result says NOTHING about whether the`,
          `  board carries half-states. It is not a clean board and it is not a dirty one — it`,
          `  is no reading at all.`,
        ]
      : [
          `  Nothing was judged: the transport failed after ${swept} issue(s) had been listed,`,
          `  the rest were never fetched, and no finding line was printed — H2 in particular`,
          `  needs a per-card comment fetch that never happened. An empty finding list here`,
          `  is not a clean board.`,
        ];
  console.error(
    `\ncheck-half-states: PREREQUISITE NOT MET — ${v.headline}\n\n` +
      v.detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${v.fix[0] ?? 'unknown'}\n` +
      v.fix.slice(1).map((l) => `        ${l}\n`).join('') +
      `\n${nothing.join('\n')}\n` +
      `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from the unclassified failure's 2 — but piping this\n` +
      `  reports the PIPE's status, so \`… | tail -4\` reads green either way. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

// ---------------------------------------------------------------------------
// Live sweep
// ---------------------------------------------------------------------------

async function rest(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    // The status rides along so the in-loop net can re-classify rather than
    // re-parse the message — the same reason the CLI prerequisites return the
    // matched sentence instead of a boolean.
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listIssues(label) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await rest(
      `/repos/${OWNER_REPO}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`,
    );
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

async function sweep(options = {}) {
  // Answered once, before any listing — so an unusable transport costs ONE
  // classified verdict instead of a raw HTTP status from whichever label page
  // happened to go first (`pm:dispatched`, in the failure #7412 recorded).
  const pre = await probeTransport();
  if (pre && pre.kind !== 'reachable') reportPrerequisiteNotMet(pre);

  const findings = [];
  const seen = new Map();
  const seenPrs = new Map();
  const seenMerged = new Map();
  const seenUnscoped = new Map();
  // H22's bounded closed-card window (#10688) — the one closed-issue read here.
  const seenClosed = new Map();
  // H16's per-row fetch is the one input that can fail partially, so its
  // tally rides out of the sweep and into the summary line (see `summaryLine`).
  const stats = {
    conflictCandidates: 0,
    conflictProbed: 0,
    // H36's coverage pair (#12286) — open PRs whose changed-file page this
    // sweep owes, and how many pages actually answered. Same per-row failure
    // mode as H16's detail pass, so it owes the same `read X of Y`.
    sharedFileCandidates: 0,
    sharedFileProbed: 0,
    fallbackCandidates: 0,
    fallbackProbed: 0,
    // H9's coverage pair — `pm:on-hold` cards whose verdict the comment
    // channel could change, and how many threads were actually read (#10403).
    restartCandidates: 0,
    restartProbed: 0,
    // H19's coverage pair — distinct `Blocked-by:` targets seen, and how many
    // got a definite open/closed answer.
    blockerTargets: 0,
    blockerResolved: 0,
    // H19's cross-repo reachability pair (#11218) and H32's seat pair (#11706)
    // — initialised here for the reason the commit counts are: a sweep that
    // throws before those passes still renders numbers rather than `undefined`.
    crossRepoProbed: 0,
    crossRepoUnreadable: 0,
    seatCandidates: 0,
    seatMarkersRead: 0,
    // H23's coverage numbers (#10942) — how many commit messages this pass read
    // and how much closing-keyword traffic they carry. Initialised to 0 here
    // rather than left absent so a sweep that throws before the commit pass
    // still renders numbers instead of the string `undefined`.
    commits: 0,
    commitBindings: 0,
    commitBindingMessages: 0,
  };
  // H17's gathering rides out of the sweep the same way, because it has the
  // same per-row failure mode as H16's detail pass and therefore owes the
  // summary line the same `read X of Y`.
  const hold = { entries: [], candidates: 0, probed: 0 };
  try {
    await sweepInto(findings, seen, seenPrs, seenMerged, seenUnscoped, seenClosed, stats, hold);
  } catch (err) {
    err.sweptSoFar = seen.size + seenPrs.size + seenMerged.size + seenUnscoped.size + seenClosed.size;
    throw err;
  }

  findings.sort((a, b) => a[0].number - b[0].number);
  const counts = {
    repo: OWNER_REPO,
    issues: seen.size,
    unscoped: seenUnscoped.size,
    prs: seenPrs.size,
    merged: seenMerged.size,
    closed: seenClosed.size,
    // The hold pair is the one counter that does NOT live on `stats` — it is
    // accumulated on the H17 gathering object — so it is forwarded by hand and
    // everything else comes off the enumerated contract below.
    holdCandidates: hold.candidates,
    holdProbed: hold.probed,
    // ⚠️ Copied from `SWEEP_COUNT_KEYS` rather than listed here, because two of
    // these keys were missing from the hand-written list and rendered the
    // dispatch-liveness clause as `read on 0 of 0` on every live sweep. See the
    // constant for the incident; the point of the loop is that forgetting a key
    // is no longer a thing this assembly can do.
    ...Object.fromEntries(SWEEP_COUNT_KEYS.map((key) => [key, stats[key]])),
  };
  // The oracle is read ONCE per sweep, after gathering: it is a local
  // `git ls-files`, not a request, and every candidate token is checked
  // against the same reading so the index cannot be internally inconsistent.
  const tracked = readTrackedFiles();
  const triggerIndex = {
    rows: h17IndexRows(hold.entries, (path) => (tracked ? tracked.has(path) : false)),
    candidates: hold.candidates,
    probed: hold.probed,
    tracked: tracked ? tracked.size : null,
  };
  console.log(
    options.format === 'markdown'
      ? renderMarkdown(findings, counts, { provenance: options.provenance, triggerIndex })
      : renderPlain(findings, counts, { triggerIndex }),
  );
}

async function listOpenPullRequests() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await rest(`/repos/${OWNER_REPO}/pulls?state=open&per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * How this file states a bounded window's boundary, in ONE place (#11118).
 *
 * Every window here is a page cap, and a page cap is meaningless until it is
 * divided by a rate. The three windows below used to state their boundaries in
 * prose, each derived from a rate measured whenever that item was written — and
 * one of them (H8's) was still quoting `~18 merges/day` from a repo that had
 * since accelerated more than sevenfold. The sentence justifying the cap was
 * describing an ~11-day reach for a window that had become ~1.8 days, and
 * nothing in the file said so, because nothing in the file could: the
 * arithmetic was prose, so no reader and no test could ever disagree with it.
 *
 * These two helpers make the derivation executable instead. The self-test pins
 * them; the docblocks below quote numbers these functions produce.
 *
 * @param {number} rows — the window's size in rows (pages × per_page).
 * @param {number} ratePerDay — the measured production rate of those rows.
 * @returns {number|null} days of coverage, or null when the rate cannot divide.
 */
export function windowCoverageDays(rows, ratePerDay) {
  if (!Number.isFinite(rows) || !Number.isFinite(ratePerDay) || ratePerDay <= 0) return null;
  return rows / ratePerDay;
}

/** How many consecutive patrol runs see a given row before it ages out. */
export function sweepOverlap(coverageDays, cadenceHours = PATROL_CADENCE_HOURS) {
  if (!Number.isFinite(coverageDays) || !Number.isFinite(cadenceHours) || cadenceHours <= 0) {
    return null;
  }
  return (coverageDays * 24) / cadenceHours;
}

/** The scheduled patrol's period — `cron: '37 1,7,13,19 * * *'` in the workflow. */
export const PATROL_CADENCE_HOURS = 6;

/**
 * The default-branch merge rate, MEASURED — the divisor every window below
 * uses, and the number the stale `~18/day` was replaced with.
 *
 * Window pinned as full ISO INSTANTS, deliberately: `git log --since=` is an
 * approxidate that fills the time-of-day from *now*, and two runs twelve
 * minutes apart returned 1,443 and 1,441 messages for what read as one window
 * (#11118's own warning, which this re-derivation obeys rather than repeats).
 *
 *   read     2026-08-23T08:42:15Z, `GET /repos/{repo}/commits`, 3 pages
 *   window   2026-08-21T04:00:19Z … 2026-08-23T08:22:47Z  (2.18 days)
 *   rows     300 commits, 300 of them carrying the `(#N)` squash marker
 *   rate     300 / 2.18 = ~137.5 merges/day
 *
 * `main` is linear (measured on the same corpus at #10942's filing: 1,975
 * reachable = 1,975 first-parent, 0 merge commits), so the commit count and the
 * merge count are one count. The figure agrees with the independent 2026-08-22
 * measurement this card was filed on (1,546 commits in 11.7 days ≈ 132/day),
 * which is what makes it a rate rather than a spike.
 */
export const MEASURED_MERGES_PER_DAY = 137.5;

/**
 * The merged-PR window H8 reads: most recently UPDATED closed PRs, merged ones
 * only, capped at four pages — a quota decision whose consequence is H8's
 * stated boundary (a delivery older than the window is invisible).
 * `sort=updated` so a long-lived PR that merges late is still in the window
 * when it matters.
 *
 * ## The boundary, re-derived (#11118)
 *
 * The cap was two pages, justified by a sentence claiming they "reach well past
 * the longest measured unexecuted-verdict latency" — true at ~18 merges/day,
 * which is where that sentence came from, and false at the measured 137.5.
 * Both readings, taken 2026-08-23T08:42:15Z over the live endpoint:
 *
 *   2 pages = 200 rows -> 197 merged, oldest merge 2026-08-21T14:00:28Z = 1.78d
 *   4 pages = 400 rows -> 397 merged, oldest merge 2026-08-20T09:41:02Z = 2.96d
 *
 * (Derivation and reading agree: `windowCoverageDays(400, 137.5)` = 2.91d. The
 * merged-only filter costs almost nothing — 397 of 400 closed PRs in the window
 * were merged — so rows and merges are interchangeable here in practice.)
 *
 * Four pages is chosen over an honest restatement because this row's damage
 * model is asymmetric in the direction that punishes a short window: H8 reports
 * a card whose delivering PR merged while the card still says `pm:dispatched`,
 * i.e. precisely the paired write NOBODY noticed — which correlates with age.
 * The population most likely to age out is the population the row exists for.
 * The measured H8 specimen (#11036) sat unreported ~22h, so a 1.78-day window
 * left the row about 2x its own worst measured latency; 2.96 days restores the
 * "comfortably past it" the docblock always claimed. Cost: two extra requests
 * per sweep, four sweeps a day, against a 15,000/h core quota.
 *
 * At the 6-hourly cadence that is `sweepOverlap(2.96)` ≈ 11.8 consecutive runs
 * that see a given merge — the window is a detection HORIZON, not a retry
 * budget: past it the finding is not delayed, it is gone (H22 catches the part
 * of that population whose card later closes; nothing catches the rest).
 */
export const MERGED_WINDOW_PAGES = 4;

async function listRecentlyMergedPullRequests() {
  const out = [];
  for (let page = 1; page <= MERGED_WINDOW_PAGES; page++) {
    const batch = await rest(
      `/repos/${OWNER_REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    out.push(...batch.filter((p) => p.merged_at));
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * The bounded closed-card window H22 reads (#10688) — most recently UPDATED
 * closed issues, capped at two pages, the same `sort=updated` convention and
 * the same quota decision as the merged-PR window above.
 *
 * The cap is the item's stated boundary, and here it carries more weight than
 * usual: the label-scoped population of closed carriers is very large (a
 * 2026-08-22 re-measure paged past 500 closed `pm:dispatched` carriers alone
 * and was still going, because the label has been applied since the protocol
 * began and dropped only sporadically). Reporting all of them would drown every
 * other item in one-time historical residue. So this window deliberately
 * reports the RECENT residue — the population where the paired write is still
 * a live duty someone remembers — and the deep tail is a backfill question,
 * not a patrol question. `state=closed` is the ONLY closed-issue read in this
 * file; every other collector stays open-only by construction.
 *
 * ## The boundary, re-derived — and the surprise in it (#11118)
 *
 * "Recent" was never measured here; it was assumed to mean roughly what H8's
 * window meant. It did not, and the divisor is the reason: this window is
 * ordered by `updated`, and a closed card is BUMPED by every later comment,
 * label write and cross-reference, so the rows are consumed by issue ACTIVITY
 * rather than by closures. Read 2026-08-23T08:42:15Z over the live endpoint:
 *
 *   2 pages = 200 rows -> updated 2026-08-22T17:05:44Z … 2026-08-23T08:39:14Z
 *                         = 0.65d (~15.6 HOURS of update-recency)
 *   4 pages = 400 rows -> updated 2026-08-21T15:44:49Z … 2026-08-23T08:39:14Z
 *                         = 1.70d
 *
 * At 6-hourly runs the old cap gave `sweepOverlap(0.65)` ≈ 2.6 consecutive
 * sweeps — and the derived floor is tighter still (200 rows / ~308 updates/day
 * ≈ 1.30d for four pages against the 1.70d measured), because the rate is
 * BURSTY: a triage round that touches a few hundred closed cards can eject a
 * fresh residue card inside one cadence, and it does so exactly when residue is
 * being produced fastest. That correlation is what makes 2.6 sweeps thin rather
 * than merely small.
 *
 * Four pages restores what the anti-drowning argument above was actually
 * choosing — a couple of days of recent residue — rather than the fifteen hours
 * it turned out to be buying. It does NOT reopen the deep tail: the population
 * that argument refuses is the 500+ historical carriers spanning months, and
 * 1.7 days is not in it. Cost: two extra requests per sweep.
 */
export const CLOSED_ISSUE_WINDOW_PAGES = 4;

/**
 * H22's DATED CLOSURE FLOOR — the cutover date at and after which a closed
 * card's `pm:*` residue is judged (objectui#5985).
 *
 * ## The dilemma this dissolves
 *
 * The window above is bounded by UPDATE recency, which is the wrong axis for
 * the one question a sibling install kept running into: "was this card closed
 * under the convention, or before it existed?" Measured in objectui
 * 2026-08-24, while porting this file: 815 closed cards there carry
 * `pm:dispatched`, and ~347 of the 400 issues in the window above carry some
 * `pm:*` residue (~87%, against the 26% this repo measured on its own board).
 * At that density H22 reports the CONVENTION rather than a defect — ~347 rows
 * that exhaust the anchor body budget and trim every other predicate's
 * findings out of the report. That install therefore shipped with the closed
 * reader switched off, and its card recorded the choice as a two-way one:
 * either stripping is the rule (and ~815 cards need a BACKFILL before H22 can
 * be honest) or it is not (and H22 is simply not a predicate that repo wants).
 *
 * The floor is the third option both readings omit. `pm:*` on a card closed
 * before the convention was written is inert history: nothing queries it as a
 * claim of in-flight-ness, because the loop reads state on OPEN cards only
 * (`is:open` is in every one of its inventory queries). Judging only cards
 * closed on/after a cutover date therefore buys the row's whole value — the
 * residue produced from now on, while the paired write is still a live duty
 * someone remembers — at zero backfill and zero historical noise. ⛔ The
 * alternative this file must never grow is a bulk label rewrite of closed
 * cards: 815 mutating writes to make a report quieter is machinery serving the
 * instrument, and no code path here writes a label at all.
 *
 * ## Default: unset, which is exactly today's behaviour
 *
 * An install that wants every card in the window judged sets nothing, and this
 * resolver returns a null floor that the predicate ignores. That keeps this
 * repo's own patrol byte-identical across this change — it measured 26% and
 * treats recent closed residue as a live duty — and makes the floor a
 * per-install adaptation rather than a policy shipped to everyone.
 *
 * ## Malformed is REFUSED, never defaulted
 *
 * A typo'd floor that silently became "no floor" would restore the 87% flood
 * on the one install that set it, four times a day, and the flood reads as a
 * working patrol — the same trap `resolveSweepRepo` refuses by name. So an
 * unparseable value is `valid: false` and the entrypoint exits 2 on it. Only
 * the `YYYY-MM-DD` spelling is accepted: a bare `Date` parse would take
 * "yesterday-ish" strings and timezone-bearing ones whose midnight is not the
 * one the workflow author meant, and the value is written by hand in a
 * workflow file exactly once.
 */
export function resolveClosureFloor(env = {}) {
  const raw = String(env.PM_SWEEP_CLOSED_FLOOR ?? '').trim();
  if (!raw) return { floor: null, source: 'default', valid: true, raw: '' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { floor: null, source: 'PM_SWEEP_CLOSED_FLOOR', valid: false, raw };
  }
  const at = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(at)) return { floor: null, source: 'PM_SWEEP_CLOSED_FLOOR', valid: false, raw };
  // A shape-valid string can still name a date that does not EXIST, and
  // `Date.parse` does not reject all of them: `2026-13-01` is NaN (the month
  // is outside the ISO range) but `2026-02-31` silently ROLLS to 2026-03-03.
  // So the parse is round-tripped rather than trusted. Letting a rolled date
  // through would move the floor days past where its author wrote it and,
  // worse, do it silently — the floor is the one input here whose whole job is
  // to say which cards were judged.
  const floor = new Date(at);
  if (floor.toISOString().slice(0, 10) !== raw) {
    return { floor: null, source: 'PM_SWEEP_CLOSED_FLOOR', valid: false, raw };
  }
  return { floor, source: 'PM_SWEEP_CLOSED_FLOOR', valid: true, raw };
}

const CLOSED_FLOOR = resolveClosureFloor(process.env);

async function listRecentlyClosedIssues() {
  const out = [];
  for (let page = 1; page <= CLOSED_ISSUE_WINDOW_PAGES; page++) {
    const batch = await rest(
      `/repos/${OWNER_REPO}/issues?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * H23's bounded commit window (#10942) — the most recent commits on the
 * repository's DEFAULT BRANCH, capped at three pages, the same "bounded window,
 * stated boundary" discipline as the two windows above.
 *
 * ## Why REST and not `git log`, in a file that already shells out to git
 *
 * `readTrackedFiles` proves a git channel exists here, and a `git log` read
 * would cost no API quota at all — so the choice needs a reason. It is the
 * runner: `.github/workflows/half-state-patrol.yml` checks out with
 * `actions/checkout@v7` and no `fetch-depth`, whose default is **1**. `git log`
 * there would read exactly ONE commit message and report a clean surface, which
 * is #4690 in its purest form — an unread input rendering as a clean one, four
 * times a day, forever. This is not a hypothetical about someone else's
 * container: the checkout this change was authored in arrived shallow at 375
 * commits, and the 11-day corpus in H23's section only became readable after an
 * explicit `git fetch --deepen`. A channel that is dark in the one place the
 * sweep actually runs is not a cheaper channel.
 *
 * ## The page cap, in the units that decide it
 *
 * Measured over the corpus above: 1,546 commits in 11.7 days ≈ 132/day. Three
 * pages ≈ 300 commits ≈ 2.3 days, against a patrol that fires every 6 hours —
 * roughly a 9× overlap, so a message has to survive nine consecutive sweeps to
 * age out unseen.
 *
 * RE-MEASURED 2026-08-23T08:42:15Z and unchanged, which is why this window
 * alone kept its cap while H8's and H22's were widened (#11118): the same three
 * pages read 300 commits spanning 2026-08-21T04:00:19Z … 2026-08-23T08:22:47Z
 * = 2.18 days at ~137.5/day, i.e. `sweepOverlap(2.18)` ≈ 8.7 runs. This item's
 * docblock was the only one that DERIVED its cap from a measured rate instead
 * of quoting a remembered one, and it is the only one that survived contact
 * with a re-measure — the argument for keeping the derivation executable
 * (`windowCoverageDays`, `MEASURED_MERGES_PER_DAY`) rather than in prose.
 *
 * No `sha=` parameter: the endpoint defaults to the repository's own default
 * branch, which keeps this reader repo-agnostic exactly like every other listing
 * here — `PM_SWEEP_REPO` can name a repo whose default branch is not `main`.
 * Ordering is the endpoint's own reverse-chronological walk of that branch and
 * needs no first-parent filter here: `main` is linear (measured — 1,975 commits
 * reachable, 1,975 on the first-parent walk, 0 merge commits), so the commit list
 * and the squash-message list are the same list. A repo that DOES carry merge
 * commits would simply feed this row a few branch-side messages, which are a
 * surface GitHub's parser reads too — wider, never wrong.
 */
export const COMMIT_WINDOW_PAGES = 3;

async function listRecentDefaultBranchCommits() {
  const out = [];
  for (let page = 1; page <= COMMIT_WINDOW_PAGES; page++) {
    const batch = await rest(`/repos/${OWNER_REPO}/commits?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * H35's repo-wide issue-event window — the ONLY reader of event history in this
 * file, and deliberately not a per-card timeline fetch (H35's header carries
 * the reasoning; H15 and H16 decline the per-card shape by name).
 *
 * TIME-bounded with a PAGE cap behind it, rather than pages alone. The stream
 * is strictly newest-first, so the horizon is reached by reading until a row
 * predates it — on a quiet stretch that is two pages, and the cap only binds
 * when the board is busier than the corpus it was derived from. Both bounds are
 * reported: `eventPages` counts what was read and `eventWindowTruncated` says
 * the horizon was NOT reached, because a short window that reads as a clean one
 * is the #4690 direction this file refuses everywhere.
 *
 * PRs ride this endpoint too (a pull request is an issue to it), which is what
 * lets one window see BOTH carriers of a dual-carrier gate.
 */
async function listRecentIssueEvents(stats = {}, nowMs = Date.now()) {
  const horizon = nowMs - H35_EVENT_WINDOW_HOURS * 3_600_000;
  const out = [];
  let reachedHorizon = false;
  let page = 1;
  for (; page <= H35_EVENT_PAGE_CAP; page++) {
    const batch = await rest(`/repos/${OWNER_REPO}/issues/events?per_page=100&page=${page}`);
    out.push(...batch);
    const oldest = Date.parse(batch[batch.length - 1]?.created_at ?? '');
    if (batch.length < 100 || (Number.isFinite(oldest) && oldest <= horizon)) {
      reachedHorizon = true;
      break;
    }
  }
  stats.eventPages = Math.min(page, H35_EVENT_PAGE_CAP);
  stats.eventRows = out.length;
  stats.eventWindowTruncated = !reachedHorizon;
  return out.filter((e) => {
    const at = Date.parse(e?.created_at ?? '');
    return Number.isFinite(at) && at > horizon;
  });
}

/**
 * The unscoped listing H13 needs: the domain-without-pm-state shape is
 * DEFINED by the absence of every label the listings below key on, so no
 * label page can ever return it — the very property that hides it from seat
 * queries hides it from a label-scoped sweep too. Ten pages, the same cap as
 * `listIssues`; an open backlog beyond the cap is invisible to H13 (stated
 * boundary, same convention as H8's merged window — the finding clears when
 * the paired write lands, not when the card ages out).
 */
async function listAllOpenIssues() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await rest(`/repos/${OWNER_REPO}/issues?state=open&per_page=100&page=${page}`);
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

async function sweepInto(findings, seen, seenPrs, seenMerged, seenUnscoped, seenClosed, stats = {}, hold = null) {
  // `pm:awaiting-maintainer` is listed like every other state label (#11196
  // fix 5). H25's exclusivity carriers would be reachable through the label
  // they wrongly coexist with, but a card in the state ALONE would otherwise be
  // swept by nothing at all — no H2 claim check, no H11 parked inventory — and
  // "the patrol's input set is narrower than the states the board produces" is
  // the defect this whole family is about. One label page per sweep, four
  // sweeps a day, against a 15,000/h core quota.
  for (const label of ['pm:dispatched', 'pm:queue', 'pm:blocked', 'pm:seat', 'pm:on-hold', AWAITING_MAINTAINER_LABEL, 'priority:p0']) {
    for (const issue of await listIssues(label)) seen.set(issue.number, issue);
  }

  // At most ONE comment fetch per card, shared by the two items that need the
  // thread: H2 reads it for the claim marker, H17 for trigger clauses. Without
  // the memo a card carrying both `pm:dispatched` (assigned) and `pm:on-hold`
  // — itself an H3-adjacent half-state, so exactly the card most likely to be
  // on the board — would be fetched twice per sweep for no new information.
  //
  // The cache holds the REST ROWS rather than the bodies, because H20 is the
  // one reader here that needs a `created_at` (how old is the claim?) and a
  // second fetch to get one would defeat the memo this cache exists to be.
  // Every other reader takes bodies through `commentsFor`, unchanged.
  const commentCache = new Map();
  const commentRowsFor = async (issue) => {
    if (commentCache.has(issue.number)) return commentCache.get(issue.number);
    const rows = await rest(`/repos/${OWNER_REPO}/issues/${issue.number}/comments?per_page=100`);
    commentCache.set(issue.number, rows);
    return rows;
  };
  const commentsFor = async (issue) => (await commentRowsFor(issue)).map((c) => c.body ?? '');
  let lastHoldError = null;

  // The `Blocked-by:` comment fallback (#8941 / #10061). Same shared cache, so
  // a card that is `pm:blocked` AND assigned AND on hold still costs ONE fetch
  // across H2, H17 and this. `comments` holds what was read; `unreadable` holds
  // the cards whose fetch failed — the two are kept apart on purpose, because
  // "read, and it carries nothing" and "could not be read" are the pair this
  // whole item exists to stop conflating.
  const fallback = { comments: new Map(), unreadable: new Set() };
  let lastFallbackError = null;
  const gatherBlockedByComments = async (issue) => {
    if (fallback.comments.has(issue.number) || fallback.unreadable.has(issue.number)) return;
    stats.fallbackCandidates = (stats.fallbackCandidates ?? 0) + 1;
    try {
      const bodies = await commentsFor(issue);
      stats.fallbackProbed = (stats.fallbackProbed ?? 0) + 1;
      fallback.comments.set(issue.number, bodies);
    } catch (err) {
      lastFallbackError = err;
      fallback.unreadable.add(issue.number);
    }
  };
  /** What H4 gets for a card: `undefined` unconsulted, `null` unreadable, else the bodies. */
  const fallbackFor = (issue) =>
    fallback.unreadable.has(issue.number) ? null : fallback.comments.get(issue.number);

  // The `Restart-when:` comment fallback (#10403) — the same pattern, gated by
  // `needsRestartWhenComments` and riding the same shared comment cache, so an
  // on-hold card H17 fetches below costs no second request here. Its stats
  // pair is separate because it answers for a different candidate set. No
  // total-shortfall rethrow of its own, on H19/H20's grounds rather than the
  // `Blocked-by:` fallback's: nothing goes QUIET on a failure here — every
  // unreadable thread fires its own card's H9 row — and the all-holds-dark
  // case is already fatal via H17's rethrow over the same fetches.
  const restart = { comments: new Map(), unreadable: new Set() };
  const gatherRestartWhenComments = async (issue) => {
    if (restart.comments.has(issue.number) || restart.unreadable.has(issue.number)) return;
    stats.restartCandidates = (stats.restartCandidates ?? 0) + 1;
    try {
      const bodies = await commentsFor(issue);
      stats.restartProbed = (stats.restartProbed ?? 0) + 1;
      restart.comments.set(issue.number, bodies);
    } catch {
      restart.unreadable.add(issue.number);
    }
  };
  /** What H9 gets for a card: `undefined` unconsulted, `null` unreadable, else the bodies. */
  const restartFor = (issue) =>
    restart.unreadable.has(issue.number) ? null : restart.comments.get(issue.number);

  // H32's gathered seat markers (#11706), judged after the label pages finish:
  // the predicate needs the LANE INVENTORY, and that is a count over the
  // `pm:queue`/`pm:dispatched` listings which are only complete once this loop
  // has consumed them. Gathering and judging are therefore split across the
  // loop boundary, the same way H8's merged-PR window is.
  const seatMarkers = new Map();

  for (const issue of seen.values()) {
    const labels = labelNames(issue);
    if (h1DispatchedNoAssignee(issue)) {
      findings.push([issue, 'H1', '`pm:dispatched` with no assignee']);
    }
    if (h3QueueAndDispatched(issue)) {
      findings.push([issue, 'H3', '`pm:queue` and `pm:dispatched` both present']);
    }
    // H24 + H25 — two field/label intersections over cards this loop already
    // holds, so neither costs a request. H24's population is the `pm:queue`
    // listing; H25's carriers are all listed too, either by the awaiting label
    // page below or by the very state label they wrongly coexist with.
    const queuedAndTaken = h24QueuedWithAssignee(issue);
    if (queuedAndTaken) findings.push([issue, 'H24', queuedAndTaken]);
    const doubleState = h25AwaitingMaintainerExclusivity(issue);
    if (doubleState) findings.push([issue, 'H25', doubleState]);
    // H29 + H30 — the same free reads, one label-set and one timestamp. Their
    // populations are covered here BY CONSTRUCTION: every H29 pair contains at
    // least one label this loop lists (the ONE-OF vocabulary is the label pages
    // plus `needs-user-decision`, which can only pair WITH one of them), and
    // H30's population is the `pm:queue` page itself.
    const twoStates = h29PmStateExclusivity(issue);
    if (twoStates) findings.push([issue, 'H29', twoStates]);
    const rotting = h30QueueRotting(issue);
    if (rotting) findings.push([issue, 'H30', rotting]);
    // H4 — judged across BOTH channels. The fetch is gated by
    // `needsBlockedByComments`, so it costs a request only for the body-clean
    // cards whose verdict it can actually change (~2/3 of the blocked
    // population by the 2026-08-19 census); a card whose body already carries
    // the line is answered without touching the network, exactly as before.
    if (needsBlockedByComments(issue)) await gatherBlockedByComments(issue);
    const unblockedByNothing = h4BlockedNoBlockedBy(issue, fallbackFor(issue));
    if (unblockedByNothing) findings.push([issue, 'H4', unblockedByNothing]);
    // …and the LIVENESS read's own gathering, UNGATED (#11747). H19/H26/H28 ask
    // whether what the line names is still RUNNING, and for that a body line is
    // one channel's targets rather than an answer — so a card whose body line is
    // spent and whose live blocker sits in a comment must contribute both. It
    // rides the same cache as the H4 fetch above (a card gathered there is a
    // no-op here), so the union of the two gates still costs at most one request
    // per card; the delta is the gate's complement — the blocked cards that DO
    // carry a body line. Gathered here rather than in the H19 loop below on
    // purpose: the total-shortfall rethrow reads these stats, so every fetch this
    // sweep makes must be counted before that check runs.
    if (needsBlockerLivenessComments(issue)) await gatherBlockedByComments(issue);
    // H9 — judged across BOTH channels since #10403, on the same gated-fetch
    // trade as H4: a hold whose body already carries a fireable line is
    // answered without the network; a body-clean one buys (at most) the one
    // comment fetch H17 is about to make anyway, off the shared cache.
    if (needsRestartWhenComments(issue)) await gatherRestartWhenComments(issue);
    const restartless = h9OnHoldNoRestartWhen(issue, restartFor(issue));
    if (restartless) findings.push([issue, 'H9', restartless]);
    const staleP0 = h10StaleUnclaimedP0(issue);
    if (staleP0) findings.push([issue, 'H10', staleP0]);
    const parked = h11ImportantParked(issue);
    if (parked) findings.push([issue, 'H11', parked]);
    if (labels.includes('pm:seat')) {
      const desync = h5SeatStickerDesync(issue);
      if (desync) findings.push([issue, 'H5', desync]);
      if (h6SeatBodyOversized(issue)) {
        const kb = (Buffer.byteLength(issue.body ?? '', 'utf8') / 1024).toFixed(1);
        findings.push([issue, 'H6', `seat body is ${kb} KB (soft bound ~10 KB) — compact to the six-section current-state template (#7583; edit history is the archive)`]);
      }
      // H32 (#11706) — gathered here, judged after the lane inventory exists.
      // The seat population has never bought a comment fetch (the H2 branch
      // below skips `pm:seat` explicitly), so this is a NEW cost and it is
      // gated hard: HELD seats on a lane this board can count, 6 of 12 at the
      // 2026-08-25 census. An unreadable thread leaves the seat unjudged — the
      // predicate declines rather than accusing — and the summary pair says so.
      if (h32NeedsSeatComments(issue)) {
        stats.seatCandidates = (stats.seatCandidates ?? 0) + 1;
        try {
          const marker = latestSeatMarker(await commentRowsFor(issue));
          stats.seatMarkersRead = (stats.seatMarkersRead ?? 0) + 1;
          seatMarkers.set(issue.number, { issue, marker });
        } catch {
          // Left out of `seatMarkers` entirely: the predicate's `undefined`
          // and `null` both decline, and the coverage pair is what states the
          // gap. No rethrow — a seat this sweep could not read is one seat
          // unexamined, not a report worth discarding.
        }
      }
    } else if ((issue.assignees ?? []).length > 0 && labels.some((l) => l === 'pm:queue' || l === 'pm:dispatched')) {
      // H2 needs the comment thread — fetched only for candidates (exactly the
      // pm-tracked set h2 judges; the on-hold/p0 listings above must not buy
      // comment fetches h2 would discard), and only their first pages: a claim
      // comment is posted at claim time, so on a healthy card it is early in
      // the thread; a >100-comment card with a late claim shows up as a
      // finding the patrol then reads by hand.
      const comments = await commentsFor(issue);
      if (h2AssigneeNoClaimComment(issue, comments)) {
        findings.push([issue, 'H2', 'assignee set but no claim comment on the thread']);
      }
      // H34 (#12090) — the same bodies, asked WHY H2 is firing. Free by
      // construction: it reads the page already in hand, on exactly H2's
      // population, and fires only on cards H2 is already reporting. Judged
      // here rather than in the dispatched loop below so a `pm:queue` claim
      // written with a dash is covered too, and so the two rows land together.
      const nearMiss = h34ClaimShapedNonCanonicalSeparator(issue, comments);
      if (nearMiss) findings.push([issue, 'H34', nearMiss]);
    }

    // H17 — the trigger-file index. Gathering only: the card's own body plus
    // its hold comments, kept for the pure extraction the renderers consume.
    // Fetched for open `pm:on-hold` cards ONLY (`h17NeedsComments`), which is
    // the population the index speaks about, and never for the other label
    // pages — the same candidate-gating trade H2 and H16 make.
    //
    // A failed fetch leaves ONE card out of the index and must not fail the
    // sweep: every other item's findings are already gathered and worth
    // printing, and the summary line's `read X of Y` is what states the gap.
    if (hold && h17NeedsComments(issue)) {
      hold.candidates += 1;
      try {
        const comments = await commentsFor(issue);
        hold.probed += 1;
        hold.entries.push({ issue, texts: [issue.body ?? '', ...comments] });
      } catch (err) {
        lastHoldError = err;
      }
    }
  }

  // …but if NO hold comment could be read at all, the index would render as
  // "no open hold names a trigger file" — which is the 0-for-19 silence with a
  // green face on it. That is the transport, not a clean board (#4690), so it
  // is rethrown for the outer net to re-probe and classify. The predicate is
  // H16's by name because that is where this judgement is documented; the
  // shape is identical and deliberately shared rather than re-derived.
  if (hold && h16DetailPassUnreadable(hold.candidates, hold.probed)) {
    throw lastHoldError;
  }

  // H32 (#11706) — the lane inventory, then the verdicts. Counted off the label
  // pages this sweep already holds, so the whole row costs nothing beyond the
  // gated seat-marker fetches above.
  //
  // "Unclaimed" is `pm:queue` with NO assignee, which is the queue view's own
  // dispatchable population — an assigned `pm:queue` card is H24's
  // contradiction and is deliberately NOT counted as work this seat could take
  // (the claim protocol reads it as taken). Counting it would let one
  // half-state manufacture another.
  const laneInventory = new Map();
  const laneBucket = (lane) => {
    if (!laneInventory.has(lane)) laneInventory.set(lane, { unclaimed: 0, inFlight: 0 });
    return laneInventory.get(lane);
  };
  for (const issue of seen.values()) {
    const labels = labelNames(issue);
    const lanes = labels.filter((l) => /^domain:/u.test(l));
    if (lanes.length === 0) continue;
    const unclaimed = labels.includes('pm:queue') && (issue.assignees ?? []).length === 0;
    const inFlight = labels.includes('pm:dispatched');
    for (const lane of lanes) {
      const bucket = laneBucket(lane);
      if (unclaimed) bucket.unclaimed += 1;
      if (inFlight) bucket.inFlight += 1;
    }
  }
  for (const { issue, marker } of seatMarkers.values()) {
    const { lane } = seatLane(issue);
    const idle = h32SeatIdleOverQueue(issue, marker, laneInventory.get(lane) ?? { unclaimed: 0, inFlight: 0 });
    if (idle) findings.push([issue, 'H32', idle]);
  }

  // H7 + H12 + H21 — the PR side. Listed straight from `/pulls` rather than
  // filtered out of the label pages above: PRs carry no `pm:*` label, so the
  // issue sweep cannot see them (it discards them explicitly). Drafts are
  // INCLUDED for H7 and H21 — a draft is exactly where that is still cheap to
  // fix, and both rows are only fixable while the PR is open, because the
  // damage is done by the merge — and excluded by H12's own predicate (drafts
  // are parked deliberately).
  for (const pr of await listOpenPullRequests()) {
    seenPrs.set(pr.number, pr);
    const contradiction = h7PartOfWithClosingKeyword(pr);
    if (contradiction) findings.push([pr, 'H7', contradiction]);
    const negated = h21NegatedClosingKeyword(pr);
    if (negated) findings.push([pr, 'H21', negated]);
    const orphan = h12OrphanLanding(pr);
    if (orphan) findings.push([pr, 'H12', orphan]);
  }

  // H16 — the only predicate here whose input no listing carries:
  // `mergeable_state` lives on the single-PR endpoint alone. One GET per
  // CANDIDATE (the gathering policy is `h16NeedsDetail`, which answers from
  // the list row already in hand), so the cost is bounded by the stuck
  // population rather than the open one, and only PRs this sweep already
  // listed are ever fetched.
  //
  // A failed detail GET must NOT fail the sweep: every other item's findings
  // are already gathered and are worth printing, and one unreadable PR is an
  // unclassified row like any other unreadable reading here — it drops out of
  // H16 and the summary line's `read X of Y` is what says so.
  //
  // But if NOTHING could be read, that is the transport rather than a clean
  // board (#4690), so the last error is rethrown for the outer net to re-probe
  // and classify. The distinction is the whole posture: "some rows unread" is
  // a bounded gap the report states, while "no row readable" is a sweep whose
  // H16 pass silently examined nothing and would otherwise print as quiet.
  let lastDetailError = null;
  for (const pr of seenPrs.values()) {
    if (!h16NeedsDetail(pr)) continue;
    stats.conflictCandidates = (stats.conflictCandidates ?? 0) + 1;
    let detail;
    try {
      detail = await rest(`/repos/${OWNER_REPO}/pulls/${pr.number}`);
    } catch (err) {
      lastDetailError = err;
      continue;
    }
    stats.conflictProbed = (stats.conflictProbed ?? 0) + 1;
    const stuck = h16StuckMergeConflict(detail);
    if (stuck) findings.push([pr, 'H16', stuck]);
  }
  if (h16DetailPassUnreadable(stats.conflictCandidates, stats.conflictProbed)) {
    throw lastDetailError;
  }

  // H36 (#12286) — the shared-file pass, H16's transport posture over one
  // changed-file page per open PR (the population this sweep already listed;
  // gathering policy at `h36NeedsFiles`). A failed page drops that PR out of
  // the pairing — a MISS, never an invention — and the summary's `read X of Y`
  // says so; all-failed is the transport, not a clean board (#4690).
  let lastFilesError = null;
  const filesByPr = new Map();
  for (const pr of seenPrs.values()) {
    if (!h36NeedsFiles(pr)) continue;
    stats.sharedFileCandidates = (stats.sharedFileCandidates ?? 0) + 1;
    let page;
    try {
      page = await rest(`/repos/${OWNER_REPO}/pulls/${pr.number}/files?per_page=${H36_FILES_PAGE_SIZE}`);
    } catch (err) {
      lastFilesError = err;
      continue;
    }
    stats.sharedFileProbed = (stats.sharedFileProbed ?? 0) + 1;
    filesByPr.set(pr.number, {
      paths: (Array.isArray(page) ? page : []).map((f) => String(f?.filename ?? '')),
      truncated: Array.isArray(page) && page.length >= H36_FILES_PAGE_SIZE,
    });
  }
  if (h36DetailPassUnreadable(stats.sharedFileCandidates, stats.sharedFileProbed)) {
    throw lastFilesError;
  }
  for (const [pr, hold36] of h36SharedFileHolds([...seenPrs.values()], filesByPr)) {
    findings.push([pr, 'H36', hold36]);
  }

  // H8 — one bounded merged-PR listing (window note at the helper), matched
  // against the already-collected open `pm:dispatched` cards; no per-card fetch.
  //
  // The open-PR list is handed in alongside it (#10468). It is already in hand
  // from the H7/H12/H21 pass above, so the half-delivered question costs no
  // request — and without it this row prescribed a destructive label drop
  // against cards whose remaining half was still open.
  for (const pr of await listRecentlyMergedPullRequests()) seenMerged.set(pr.number, pr);
  const mergedWindow = [...seenMerged.values()];
  const openWindow = [...seenPrs.values()];
  for (const issue of seen.values()) {
    const stale = h8MergedPrStillDispatched(issue, mergedWindow, openWindow);
    if (stale) findings.push([issue, 'H8', stale]);
  }

  // H22 — the one closed-issue read in this file (#10688). Kept in its own
  // collection for the same reason H13's unscoped listing is: the open-only
  // default of every other collector stays exactly as it was, and the summary
  // line can say what this pass covered on its own terms.
  for (const issue of await listRecentlyClosedIssues()) {
    seenClosed.set(issue.number, issue);
    const residue = h22ClosedCardPmResidue(issue, CLOSED_FLOOR.floor);
    if (residue) findings.push([issue, 'H22', residue]);
  }
  stats.closedFloor = CLOSED_FLOOR.raw;

  // H23 — the commit-message surface (#10942). The counting is not incidental:
  // this row's measured yield is ~6 in 1,546, so a silent H23 is the normal
  // reading, and the summary line's coverage numbers are the only thing that
  // separates "read and clean" from "no message was read". They are gathered in
  // the same walk as the verdicts so the two can never disagree.
  //
  // The finding row is keyed to the PR the squash marker names, because that is
  // the artifact a reader searches for and it keeps this row shaped like the
  // other PR-scoped rows (H7, H12, H16, H21). The LINK is the commit, which is
  // the evidence. When a subject carries no marker (1 of 1,546 measured) the
  // first contradicted card number stands in, so a row is never dropped for
  // want of a number to sort by.
  for (const commit of await listRecentDefaultBranchCommits()) {
    const message = commit?.commit?.message ?? '';
    stats.commits = (stats.commits ?? 0) + 1;
    const bindings = closingKeywordTargets(message, { markdown: false });
    if (bindings.size > 0) {
      stats.commitBindings = (stats.commitBindings ?? 0) + bindings.size;
      stats.commitBindingMessages = (stats.commitBindingMessages ?? 0) + 1;
    }
    const contradiction = h23CommitMessageContradiction(commit);
    if (!contradiction) continue;
    const pr = commitSubjectPrNumber(message);
    const fallback = [...partOfTargets(message, { markdown: false })].find((n) => bindings.has(n));
    findings.push([
      { number: Number(pr ?? fallback ?? 0), html_url: commit?.html_url ?? '' },
      'H23',
      contradiction,
    ]);
  }

  // H13 — the one item whose population no label page can list (note at
  // `listAllOpenIssues`). Kept out of `seen` so H1–H12 keep their exact
  // inputs and the summary line stays honest about what each pass covered;
  // the overlap with the label listings costs nothing (the predicate is
  // label-gated and pure).
  const unscoped = await listAllOpenIssues();
  for (const issue of unscoped) {
    seenUnscoped.set(issue.number, issue);
    const halfState = h13DomainWithoutPmState(issue);
    if (halfState) findings.push([issue, 'H13', halfState]);
    // H18 — same population: `pm:retriage` can coexist with a label this
    // sweep's label pages never fetch (e.g. `pm:blocking`) or with none at
    // all, so only the unscoped listing is guaranteed to see every carrier.
    const retriageAged = h18RetriageAged(issue);
    if (retriageAged) findings.push([issue, 'H18', retriageAged]);
    // H31 — the contract-review gate's two carriers, compared. This listing
    // rather than the label loop for the same reason H18 is here:
    // `needs:contract-review` is not one of the labels that loop pages, so a
    // gated card carrying no `pm:*` state at all is first visible HERE. The
    // open-PR side is `openWindow`, already assembled above for H8 — no
    // request, and the same `prDeliversCard` relation, so the two rows can
    // never disagree about which PR delivers which card.
    const gateSplit = h31ContractReviewCarrierSplit(issue, openWindow);
    if (gateSplit) findings.push([issue, 'H31', gateSplit]);
  }

  // H35 (#11881) — the EVENT behind the state H31 compares. One repo-wide
  // window, no per-card fetch; the sibling resolver below is `prDeliversCard`
  // over the two PR windows this sweep already holds, so H8, H31 and H35 read
  // ONE delivery relation and can never disagree about which PR delivers which
  // card. An unresolvable sibling returns null and the removal is judged
  // against its own hang instead — never straight to a finding.
  const prWindow = [...mergedWindow, ...openWindow];
  const siblingNumbers = (event) => {
    const number = Number(event?.issue?.number);
    if (!Number.isFinite(number)) return null;
    if (event?.issue?.pull_request) {
      const pr = prWindow.find((p) => Number(p?.number) === number);
      if (!pr) return null;
      const cards = [...seenUnscoped.keys(), ...seen.keys()].filter((n) =>
        prDeliversCard(pr, String(n)),
      );
      return cards.length > 0 ? cards : null;
    }
    const prs = prWindow.filter((p) => prDeliversCard(p, String(number))).map((p) => p.number);
    return prs.length > 0 ? prs : null;
  };
  const eventWindow = await listRecentIssueEvents(stats);
  const gateEvents = gateLabelEvents(eventWindow);
  stats.gateLabelEvents = gateEvents.length;
  const removals = gateEvents.filter((e) => e.event === 'unlabeled');
  stats.gateRemovals = removals.length;
  for (const removal of removals) {
    const verdict = h35RemovalVerdict(removal, gateEvents, { siblingNumbers });
    stats[`gate_${verdict.replace(/-/g, '_')}`] = (stats[`gate_${verdict.replace(/-/g, '_')}`] ?? 0) + 1;
    const row = h35GateRemovalWithoutEvidence(removal, gateEvents, { siblingNumbers });
    if (row) findings.push([removal.issue, 'H35', row]);
  }

  // H14 + H15 — the same unscoped listing, read a second way. It is the right
  // population for BOTH halves and neither label page could substitute: a
  // `pm:blocking` card need carry no other label (so the label pages above can
  // miss the subject), and the `Blocked-by:` lines that judge it are written by
  // cards of any label at all (so they can miss the evidence). No extra fetch:
  // the bodies are already in hand, which is exactly the "derived from the same
  // body reads the sweep already performs" this pair was specified as.
  //
  // …with ONE fetching pass in front of it, and it has to be here rather than
  // in the label loop above: `pm:blocking` is not one of the labels that loop
  // lists, so those cards are first visible in this listing. The gate is the
  // same one H4 used, the cache is the same, and a card already gathered above
  // is a no-op — so the union of the two passes is still at most one request
  // per card.
  for (const issue of unscoped) {
    if (needsBlockedByComments(issue)) await gatherBlockedByComments(issue);
  }
  // Total failure is the transport, not a board where no card parks the line
  // in a comment — the same #4690 judgement H16 and H17 make, and the same
  // predicate, deliberately shared rather than re-derived. A PARTIAL shortfall
  // is a bounded gap: it stays, and it costs H14's stale direction (below)
  // plus a summary-line clause, rather than the sweep.
  if (h16DetailPassUnreadable(stats.fallbackCandidates, stats.fallbackProbed)) {
    throw lastFallbackError;
  }

  const blockingIndex = buildBlockingIndex(unscoped, { comments: fallback.comments });
  const indexComplete = fallback.unreadable.size === 0;
  for (const issue of unscoped) {
    const incoherent = h14BlockingCacheIncoherent(issue, blockingIndex, { indexComplete });
    if (incoherent) findings.push([issue, 'H14', incoherent]);
  }

  // One row, attached to the card it names — so it links, sorts and truncates
  // exactly like every other row and neither renderer needs a special case.
  const oldestBlocking = h15OldestUnclaimedBlocking(unscoped);
  if (oldestBlocking) findings.push([oldestBlocking.issue, 'H15', oldestBlocking.message]);

  // H20 — the dispatched card nobody is working. Two reads, both bounded by
  // the `pm:dispatched` population rather than the board:
  //
  //   • the comment thread, for the claim's branch and its timestamp. On the
  //     shared cache, so an assigned dispatched card — which H2 already
  //     fetched above — costs nothing here. The only new fetches are for
  //     UNASSIGNED dispatched cards, which are H1 findings in their own right
  //     and correspondingly rare.
  //   • ONE ref read per distinct claimed branch, cached, and taken only for
  //     candidates (`h20NeedsRefProbe`): a claim younger than the threshold is
  //     not stuck, so it buys no request and the row says nothing about it.
  //
  // Unreadable probes are NOT fatal, and that is the one place this pass
  // deliberately differs from H16/H17/the comment fallback, which rethrow on a
  // total shortfall. There, "nothing readable" makes the item read as CLEAN,
  // so the sweep has to stop rather than print a green face on a silence.
  // Here it is the opposite: every unreadable ref fires its own card's quieter
  // row, so a pass that read nothing is the loudest possible output rather
  // than the quietest, and killing an otherwise-gathered sweep would trade a
  // whole report for a fact the rows already state. H19 makes the same call.
  const refCache = new Map();
  const resolveBranchRef = async (branch) => {
    const cached = refCache.get(branch);
    if (cached) return cached;
    // `/branches/<branch>` is an EXACT-match lookup and a 404 there is the
    // healthy-negative H20 is built on — not an error. The branch is
    // segment-encoded rather than whole-encoded because the slashes in
    // `claude/issue-<n>-<slug>` are path separators to this endpoint.
    //
    // ⭐ Why this endpoint rather than `/git/ref/heads/<branch>`, which H20
    // asked originally: H27 (#11248) needs the head commit's DATE, and this
    // response already carries it while the ref response carries only a sha —
    // reading it there would cost a second request per branch. Both endpoints
    // resolve the SAME underlying ref, so existence is answered identically
    // and H20's three states are untouched; the extra field rides in on a
    // payload the sweep had already paid for. That is H26's own "FREE" shape,
    // and it keeps the request COUNT of this pass exactly as it was.
    const path = `/repos/${OWNER_REPO}/branches/${branch.split('/').map(encodeURIComponent).join('/')}`;
    let resolved;
    try {
      const row = await rest(path);
      resolved = {
        state: 'exists',
        detail: null,
        // Missing rather than null-coalesced to a date: an absent field must
        // reach the predicate as "unknown" so it declines to judge, never as a
        // timestamp that happens to compare false (#4690).
        headCommittedAt: row?.commit?.commit?.committer?.date ?? null,
      };
    } catch (err) {
      resolved =
        err?.status === 404
          ? { state: 'absent', detail: null, headCommittedAt: null }
          : {
              state: 'unreadable',
              detail: err?.status ? `HTTP ${err.status}` : 'unreadable',
              headCommittedAt: null,
            };
    }
    refCache.set(branch, resolved);
    return resolved;
  };

  for (const issue of seen.values()) {
    if (!labelNames(issue).includes('pm:dispatched')) continue;
    const commentRows = await commentRowsFor(issue);
    // H33 (#11724) — the same thread this loop already holds, asked a
    // different question: not "is the claimed branch alive" but "was the order
    // this card is in flight under written before the ruling that now stands".
    // Judged for EVERY `pm:dispatched` card, ahead of H20's age gate, because
    // the ordering it reads has nothing to do with how old the claim is: a
    // claim posted five minutes ago can already be behind a ruling posted four.
    const blindClaim = h33ClaimPredatesRuling(issue, commentRows);
    if (blindClaim) findings.push([issue, 'H33', blindClaim]);
    const claim = governingClaim(commentRows);
    if (!h20NeedsRefProbe(issue, claim)) continue;
    const states = [];
    for (const branch of claim.branches) states.push({ branch, ...(await resolveBranchRef(branch)) });
    const undispatched = h20DispatchedNoBranchRef(issue, claim, states);
    if (undispatched) findings.push([issue, 'H20', undispatched]);
    // H27 — the same claim, the same ref states, the OTHER question: not "was
    // this ever dispatched" but "is the thing that was dispatched still alive".
    // Its gathering gate (24h) is a strict subset of H20's (60 min), so every
    // card it can speak about has already been probed above and it adds NO
    // request of its own. Delivery is read from the two PR windows this sweep
    // already holds — H8's inputs, through H8's own delivery relation.
    if (!h27NeedsClaimLivenessRead(issue, claim)) continue;
    const deadClaim = h27DeadClaimNoProgress(
      issue,
      claim,
      states,
      claimDelivery(issue.number, openWindow, mergedWindow),
    );
    if (deadClaim) findings.push([issue, 'H27', deadClaim]);
  }
  // Distinct branches, which is the unit the cache and the request count are
  // in — and the word is in the summary sentence for the same reason it is in
  // H19's, so the number cannot be misread as a per-card count.
  stats.dispatchRefTargets = refCache.size;
  stats.dispatchRefRead = [...refCache.values()].filter((r) => r.state !== 'unreadable').length;

  // H37 (#12629) — the family-dispatch join, in two rounds (banner at the
  // predicate). Placed HERE, after the dispatch-liveness loop, because round 1
  // is exactly that loop's leftovers: `commentCache` now holds a thread for
  // every open `pm:dispatched` card and every assigned pm-tracked card, so the
  // fold roster costs no request at all.
  const claimsOf = (rows, number) => {
    const claim = governingClaim(rows);
    return claim && (claim.branches ?? []).length > 0 ? { number, branches: claim.branches } : null;
  };
  const h37Claims = [];
  for (const [number, rows] of commentCache) {
    const entry = claimsOf(rows, number);
    if (entry) h37Claims.push(entry);
  }
  // Round 2 — gated on round 1 having actually SEEN a fold (`h37NeedsMemberRead`),
  // so a board with none costs nothing. `commentRowsFor` memoises, so a candidate
  // already read above is counted as read and costs no second request; the pair
  // therefore describes the POPULATION rather than only the new fetches.
  const foldsSeen = h37FoldBranches(h37Claims).size;
  for (const issue of seen.values()) {
    if (!h37NeedsMemberRead(issue, foldsSeen)) continue;
    stats.memberReadCandidates = (stats.memberReadCandidates ?? 0) + 1;
    let rows;
    try {
      rows = await commentRowsFor(issue);
    } catch {
      // One member unread is one card out of the roster, never a report worth
      // discarding — H32's posture, and the banner says why this pass does not
      // rethrow the way H16's and H36's do. The coverage pair states the gap and
      // the summary names an all-failed pass as the transport it is.
      continue;
    }
    stats.memberReadProbed = (stats.memberReadProbed ?? 0) + 1;
    const entry = claimsOf(rows, issue.number);
    if (entry && !h37Claims.some((c) => c.number === entry.number)) h37Claims.push(entry);
  }
  // The roster is rebuilt over the UNION: a member found in round 2 can complete
  // a fold round 1 saw only one side of, and judging the round-1 roster would
  // discard exactly the card the second read was bought for.
  const h37OpenByNumber = new Map();
  for (const [number, issue] of seenUnscoped) h37OpenByNumber.set(number, issue);
  for (const [number, issue] of seen) h37OpenByNumber.set(number, issue);
  const h37Folds = h37FoldBranches(h37Claims);
  stats.liveFolds = h37Folds.size;
  for (const [card, drift] of h37FamilyMemberDrift(h37Folds, h37OpenByNumber, seenClosed)) {
    findings.push([card, 'H37', drift]);
  }

  // H19 — blocker liveness. Last, because it is the only pass that reads a
  // card this sweep did not list: every other item answers from a listing
  // already in hand, while "is the target still open" is a fact about an
  // issue that, if the answer is the interesting one, is CLOSED and therefore
  // in no open listing by construction.
  //
  // ## The shortcut that makes the cost proportional to the FINDINGS
  //
  // A target already present in an open listing this sweep took is open —
  // positive evidence, free, no request. ABSENCE is not evidence of closure
  // (the listings are capped, and PRs are filtered out of them), so an absent
  // target is FETCHED rather than assumed. The asymmetry is the whole cost
  // story: a healthy block names an open card and costs nothing, so the
  // request count is bounded by the number of expired blocks plus the
  // cross-repo refs — the population the row is about — rather than by the
  // number of blocked cards.
  //
  // One request per DISTINCT target, cached across cards: several cards
  // waiting on one epic is the normal shape, and it costs one read.
  //
  // The map holds the ISSUE, not just its number, because H26 (#11219) asks a
  // second question of the same target — is it parked in a state that can never
  // close? — and the answer is a field the payload already carried. Free by
  // construction: a locally-open target is answered from a listing in hand, and
  // a fetched one arrives with its labels on the same response. Nothing here
  // adds a request; the resolution rows simply stop discarding the labels.
  const openLocalIssues = new Map();
  for (const [number, issue] of seenUnscoped) openLocalIssues.set(number, issue);
  for (const [number, issue] of seen) openLocalIssues.set(number, issue);
  const blockerCache = new Map();

  // The disambiguating second reading (#11218). A target 404 is ambiguous —
  // unreachable repo, or a number that is not there — and `GET /repos/<o>/<n>`
  // separates them, independently of any issue number. One request per distinct
  // SIBLING repo per sweep (2 on this board), taken LAZILY: it is bought only
  // when a cross-repo target actually failed, so a sweep whose cross-repo
  // targets all resolve pays nothing at all.
  //
  // `true` readable · `false` not readable · `null` the probe itself failed for
  // some other reason, which must not be reported as either (#4690) — the row
  // falls back to the undiagnosed wording rather than picking a side.
  const repoReadCache = new Map();
  const probeRepoReadable = async (repo) => {
    if (repoReadCache.has(repo)) return repoReadCache.get(repo);
    let verdict;
    try {
      await rest(`/repos/${repo}`);
      verdict = true;
    } catch (err) {
      verdict = err?.status === 404 || err?.status === 403 || err?.status === 401 ? false : null;
    }
    repoReadCache.set(repo, verdict);
    return verdict;
  };

  const resolveBlockerTarget = async (target) => {
    const cached = blockerCache.get(target.key);
    if (cached) return cached;
    let resolved;
    const localOpen = target.local ? openLocalIssues.get(target.number) : undefined;
    if (localOpen) {
      resolved = { ...target, state: 'open', closedAt: null, detail: null, labels: labelNames(localOpen) };
    } else {
      try {
        const row = await rest(`/repos/${target.repo}/issues/${target.number}`);
        resolved = {
          ...target,
          state: row.state === 'closed' ? 'closed' : 'open',
          closedAt: row.closed_at ?? null,
          detail: null,
          labels: labelNames(row),
        };
      } catch (err) {
        // Per-target, never fatal — and deliberately NOT the rethrow H16/H17
        // and the comment fallback make on a total shortfall. Those passes
        // read only THIS repo with a credential that either works or does
        // not, so "nothing readable" there really is the transport. H19's
        // candidates include refs to sibling repos this credential may quite
        // legitimately not be able to read, so a zero-resolved pass is a
        // possible HEALTHY reading here and must not kill a sweep whose other
        // items are already gathered. The #4690 duty is discharged louder
        // instead: every unresolved target fires its own card's row.
        resolved = {
          ...target,
          state: 'unresolved',
          closedAt: null,
          detail: err?.status ? `HTTP ${err.status}` : 'unreadable',
          // LOCAL targets get no probe: the swept repo's readability is already
          // settled by the pre-sweep transport prerequisite, and a local 404 is
          // unambiguous (the number is not on this board). `undefined` — not
          // `null` — so the renderer can tell "not asked" from "asked, and the
          // asking failed".
          repoReadable: target.local ? undefined : await probeRepoReadable(target.repo),
        };
      }
    }
    blockerCache.set(target.key, resolved);
    return resolved;
  };

  for (const issue of seen.values()) {
    if (!needsBlockerLiveness(issue)) continue;
    const resolutions = [];
    for (const target of blockerTargetsFor(issue, fallbackFor(issue))) {
      resolutions.push(await resolveBlockerTarget(target));
    }
    const expired = h19BlockOutlivedBlocker(issue, resolutions);
    if (expired) findings.push([issue, 'H19', expired]);
    // H26 — the same resolutions, asked the OTHER question: not "has the target
    // closed" but "can it ever". Both rows can fire on one card (a two-target
    // block where one blocker closed and the other is parked indefinitely), and
    // they must: they name different halves of the same wait and prescribe
    // different reads.
    const indefinite = h26BlockOnIndefiniteTarget(issue, resolutions);
    if (indefinite) findings.push([issue, 'H26', indefinite]);
    // H28 — the same resolutions, asked a THIRD question: which CHANNEL each
    // target arrived in. H19 reports that the block is half-expired; this
    // reports that the expired half is the one sitting in the canonical home,
    // which is the write to fix. Both fire on one card, deliberately.
    const staleBody = h28StaleBodyBlockerLine(issue, resolutions, fallbackFor(issue));
    if (staleBody) findings.push([issue, 'H28', staleBody]);
  }
  // Distinct targets, which is the unit the cache and the request count are
  // in — and the word is in the summary sentence so the number cannot be read
  // as a per-card edge count.
  stats.blockerTargets = blockerCache.size;
  stats.blockerResolved = [...blockerCache.values()].filter((r) => r.state !== 'unresolved').length;
  // The cross-repo reachability readings (#11218) — distinct SIBLING repos
  // probed, and how many refused this credential. `false` only: a `null` probe
  // failed for some other reason and is not evidence of a scope gap, so it is
  // counted as probed and not as unreadable.
  stats.crossRepoProbed = repoReadCache.size;
  stats.crossRepoUnreadable = [...repoReadCache.values()].filter((v) => v === false).length;
}

// ---------------------------------------------------------------------------
// Self-test — predicates and the transport classifier; no network.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push([name, actual, expected]);
  const issue = (labels, assignees = [], body = '', title = '') => ({
    labels: labels.map((name) => ({ name })),
    assignees: assignees.map((login) => ({ login })),
    body,
    title,
  });

  // -- Row-text wrappers: every message assertion goes through one -----------
  //
  // Each `hNrow(...)` is `String(hN…(...) ?? '')`. The predicates here are
  // three-valued BY DESIGN — `null` when the card is clean, a string when the
  // row fires — so a bare `predicate(...).includes(needle)` throws
  // `TypeError: Cannot read properties of null (reading 'includes')` the
  // moment a change makes that predicate go clean. That throw happens while
  // evaluating `t()`'s ARGUMENTS, before `t()` runs, so no harness-level
  // catch can convert it into a case: the suite ABORTS at the first such
  // line, every later case never runs, and the output names a TypeError
  // instead of a row. Which line you land on depends on ordering, so the
  // information you lose is arbitrary.
  //
  // The cost is paid exactly during ABLATION — mutate a predicate, read which
  // cases go red — which is the discipline this file's own headers lean on to
  // prove a new row is failable. Through a wrapper, a nulled row instead
  // reports `(got false, want true)` under its own case name and the suite
  // runs to completion. ⚠️ The predicates themselves are UNCHANGED and are
  // still asserted three-valued directly: `typeof pred(...) === 'string'` and
  // `pred(...) === null` sites deliberately do NOT go through a wrapper —
  // wrapping those would make every one of them trivially true.
  const h4row = (...args) => String(h4BlockedNoBlockedBy(...args) ?? '');
  const h7row = (...args) => String(h7PartOfWithClosingKeyword(...args) ?? '');
  const h8row = (...args) => String(h8MergedPrStillDispatched(...args) ?? '');
  const h9row = (...args) => String(h9OnHoldNoRestartWhen(...args) ?? '');
  const h10row = (...args) => String(h10StaleUnclaimedP0(...args) ?? '');
  const h11row = (...args) => String(h11ImportantParked(...args) ?? '');
  const h12row = (...args) => String(h12OrphanLanding(...args) ?? '');
  const h13row = (...args) => String(h13DomainWithoutPmState(...args) ?? '');
  const h14row = (...args) => String(h14BlockingCacheIncoherent(...args) ?? '');
  const h16row = (...args) => String(h16StuckMergeConflict(...args) ?? '');
  const h18row = (...args) => String(h18RetriageAged(...args) ?? '');
  const h19row = (...args) => String(h19BlockOutlivedBlocker(...args) ?? '');
  const h22row = (...args) => String(h22ClosedCardPmResidue(...args) ?? '');
  const h24row = (...args) => String(h24QueuedWithAssignee(...args) ?? '');
  const h25row = (...args) => String(h25AwaitingMaintainerExclusivity(...args) ?? '');
  const h26row = (...args) => String(h26BlockOnIndefiniteTarget(...args) ?? '');
  const h32row = (...args) => String(h32SeatIdleOverQueue(...args) ?? '');
  const h33row = (...args) => String(h33ClaimPredatesRuling(...args) ?? '');
  // H34's wrapper (the pattern this generalizes) stays beside its own block,
  // as do H8's `halvesRow` and H27's `dead27Row` — all three wrap a helper
  // that is itself declared locally, next to the fixtures it closes over.
  // H29/H30/H31 use a different reader, `says()`, declared at those blocks:
  // it returns a DESCRIBING string (`NO MESSAGE (null)`) rather than `''`, so
  // it also distinguishes "row fired without the needle" from "row went
  // silent" on a case whose expectation is `false`. Both shapes run to
  // completion; `says()` is the more informative and the more invasive, and
  // unifying on one of them is a diff of its own, not this one.

  t('H1: dispatched + no assignee -> finding', h1DispatchedNoAssignee(issue(['pm:dispatched'])), true);
  t('H1: dispatched + assignee -> clean', h1DispatchedNoAssignee(issue(['pm:dispatched'], ['os-help'])), false);
  t('H2: assignee + no claim comment -> finding', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['looks good', 'triage: routed']), true);
  t('H2: assignee + claim comment -> clean', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['Claim: PM loop round 3\nSession: session_x']), false);
  t('H2: unassigned card is out of scope', h2AssigneeNoClaimComment(issue(['pm:queue']), []), false);
  // #7488: SKILL.md step 4's claim template IS a blockquote, so the documented
  // shape must read as a claim. Live specimen: #6752's "> Claim: PM loop wave 9".
  t('H2: blockquote claim comment (the documented shape) -> clean', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['> Claim: PM loop wave 9 (seat #6019)\n> Session: `session_x`\n> Branch: `claude/issue-6752-x`']), false);
  t('H2: indented blockquote claim -> clean', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['   > Claimed: PM loop round 3']), false);
  // …and the strictness the relaxation must NOT cost: the line still has to
  // BEGIN with the word, blockquote or not (#7488's explicit width limit).
  t('H2: prose containing the word claim -> still a finding', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['Nobody will claim: this card is ready\nthe seat did not claim it']), true);
  t('H2: blockquoted prose containing claim -> still a finding', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['> the next seat should claim: only after the ruling lands']), true);
  t('H3: both queue labels -> finding', h3QueueAndDispatched(issue(['pm:queue', 'pm:dispatched'])), true);
  t('H3: dispatched alone -> clean', h3QueueAndDispatched(issue(['pm:dispatched'])), false);
  // H4 — the label gate and the BODY channel, unchanged by the two-channel
  // read: a caller that does not consult comments gets the reading it always
  // got, and the sentence it gets claims nothing about a channel nobody read.
  t('H4: blocked without body line -> finding', typeof h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting on upstream')), 'string');
  t('H4: blocked with Blocked-by line -> clean', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'Blocked-by: #123')), null);
  t('H4: unblocked card is out of scope', h4BlockedNoBlockedBy(issue([], [], '')), null);
  t('H4: …and an unconsulted comment channel is not claimed as empty', h4row(issue(['pm:blocked'], [], 'waiting on upstream')).includes('NEITHER channel'), false);
  t('H4: the body-only sentence still names the unlock sweep as the stake', h4row(issue(['pm:blocked'], [], 'waiting on upstream')).includes('unlock sweep greps'), true);

  // H4 — the COMMENT channel (#8941 / #10061). Four shapes, positive and
  // negative, plus the unreadable one that is neither.
  t('H4: body clean but a comment carries the line -> clean', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting on upstream'), ['triage note', 'Blocked-by: #9465']), null);
  t('H4: body line AND a comment line (the union shape) -> clean', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'Blocked-by: #123'), ['Blocked-by: #9465']), null);
  t('H4: neither channel -> finding', typeof h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting on upstream'), ['triage note', 'graded p2']), 'string');
  t('H4: …and the sentence names BOTH channels', h4row(issue(['pm:blocked'], [], 'waiting'), ['nothing here']).includes('NEITHER channel'), true);
  t('H4: …and says a comment discharges the duty too', h4row(issue(['pm:blocked'], [], 'waiting'), ['nothing here']).includes('Either channel discharges'), true);
  t('H4: an empty comment thread is a real reading, not an unconsulted one', h4row(issue(['pm:blocked'], [], 'waiting'), []).includes('NEITHER channel'), true);
  // Unreadable is neither of the two: the row FIRES (a transport failure must
  // not shrink the patrol below its pre-fallback reach) and says why.
  t('H4: an UNREADABLE comment thread still fires', typeof h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting'), null), 'string');
  t('H4: …but never claims the second channel is empty', h4row(issue(['pm:blocked'], [], 'waiting'), null).includes('NEITHER channel'), false);
  t('H4: …and says the thread could not be read', h4row(issue(['pm:blocked'], [], 'waiting'), null).includes('could'), true);
  t('H4: …citing the unreadable-is-not-absent rule', h4row(issue(['pm:blocked'], [], 'waiting'), null).includes('#4690'), true);
  // A comment line clears H4 whatever the ref says: H4's question is "did the
  // author leave the machine anything", which a cross-repo blocker answers.
  t('H4: a cross-repo comment line still discharges the duty', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting'), ['Blocked-by: objectstack-ai/objectui#4356']), null);
  t('H4: a valueless comment line does NOT (nothing follows the key)', typeof h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting'), ['Blocked-by:']), 'string');
  t('H4: a mid-sentence mention in a comment is not a line', typeof h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting'), ['seats park the Blocked-by: #1 line in comments']), 'string');
  t('H4: the label gate outranks the comment channel', h4BlockedNoBlockedBy(issue(['pm:queue'], [], 'waiting'), ['nothing']), null);

  // The real measured comment, byte-for-byte from #9828's triage backfill —
  // the shape the fallback exists to read (a `Blocked-by:` line on its own,
  // wrapped in ordinary prose above and below).
  const liveBackfillComment =
    'Triage backfill (machine-readable index line; the prose "Unblock when: epic #9465 completes" ' +
    'was invisible to the unlock scan\'s grep):\n\nBlocked-by: #9465\n\nNo state change — the epic ' +
    'is still open (4/5 sub-issues done); this line only makes the existing wait scannable.';
  t('H4: the measured #9828 backfill comment clears the card', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'body carries no line'), [liveBackfillComment]), null);

  // The gathering policy — what gets READ AT ALL.
  t('gate: a body-clean pm:blocked card is a candidate', needsBlockedByComments(issue(['pm:blocked'], [], 'no line here')), true);
  t('gate: a body-clean pm:blocking card is a candidate', needsBlockedByComments(issue(['pm:blocking'], [], 'no line here')), true);
  t('gate: a pm:blocked card whose body already carries the line is NOT', needsBlockedByComments(issue(['pm:blocked'], [], 'Blocked-by: #1')), false);
  t('gate: a pm:blocking card whose body already carries the line is NOT', needsBlockedByComments(issue(['pm:blocking'], [], 'Blocked-by: #1')), false);
  t('gate: an ordinary queued card buys no fetch', needsBlockedByComments(issue(['pm:queue'], [], 'no line here')), false);
  t('gate: an on-hold card buys no fetch from THIS item', needsBlockedByComments(issue(['pm:on-hold'], [], 'no line here')), false);
  t('gate: a missing issue does not crash', needsBlockedByComments(undefined), false);

  // The comment-side ref extractor — the index's reader of the same channel.
  t('commentBlockedByTargets: one line across two comments', commentBlockedByTargets(['prose', 'Blocked-by: #7']).map((r) => r.number).join(','), '7');
  t('commentBlockedByTargets: refs from several comments accumulate', commentBlockedByTargets(['Blocked-by: #7', 'Blocked-by: #8']).map((r) => r.number).join(','), '7,8');
  t('commentBlockedByTargets: no comments at all', commentBlockedByTargets(undefined).length, 0);
  t('commentBlockedByTargets: a cross-repo ref keeps its qualifier for filtering', commentBlockedByTargets(['Blocked-by: objectstack-ai/objectui#4356'])[0].repo, 'objectstack-ai/objectui');

  // -- Decorated directive lines (#10102) ------------------------------------
  // The shared value reader first, because it is the only place the CLEANING
  // step is observable: H9 reports a sentence and the index reports refs, so a
  // value that silently kept its trailing backtick would pass both while being
  // wrong. Every decoration gets a positive AND a negative case.
  const dv = (text, key = 'Restart-when') => directiveValues(text, key);
  t('directiveValues: the bare line is unchanged', dv('Restart-when: closed acme/w#9').join('|'), 'closed acme/w#9');
  // #9591, byte-for-byte in shape: the whole line wrapped in inline code.
  t('directiveValues: backtick-wrapped line yields a CLEAN value', dv('`Restart-when: closed acme/w#9`').join('|'), 'closed acme/w#9');
  t('directiveValues: `-` bullet', dv('- Restart-when: closed acme/w#9').join('|'), 'closed acme/w#9');
  t('directiveValues: `*` bullet', dv('* Restart-when: closed acme/w#9').join('|'), 'closed acme/w#9');
  t('directiveValues: indented bullet', dv('    - Restart-when: closed acme/w#9').join('|'), 'closed acme/w#9');
  t('directiveValues: bold around the whole directive', dv('**Restart-when: closed acme/w#9**').join('|'), 'closed acme/w#9');
  t('directiveValues: bold around the key, colon inside', dv('**Restart-when:** closed acme/w#9').join('|'), 'closed acme/w#9');
  t('directiveValues: bold around the key, colon outside', dv('**Restart-when**: closed acme/w#9').join('|'), 'closed acme/w#9');
  t('directiveValues: code around the key only', dv('`Restart-when:` closed acme/w#9').join('|'), 'closed acme/w#9');
  t('directiveValues: bullet AND code together', dv('- `Restart-when: closed acme/w#9`').join('|'), 'closed acme/w#9');
  t('directiveValues: bold AND code nested', dv('**`Restart-when: closed acme/w#9`**').join('|'), 'closed acme/w#9');
  t('directiveValues: a decorated line mid-body is found', dv('Prose.\n> quote\n`Restart-when: closed acme/w#9`\nMore.').join('|'), 'closed acme/w#9');
  t('directiveValues: two decorated lines both count', dv('- Restart-when: manual — x\n`Restart-when: closed acme/w#9`').join('|'), 'manual — x|closed acme/w#9');
  // "Matching" is the whole rule: a value that ends in a backtick on a line
  // that opened BARE keeps it, or the reader starts editing values it was
  // only asked to read.
  t('directiveValues: an UNMATCHED trailing backtick is kept', dv('Restart-when: run `npm view x`').join('|'), 'run `npm view x`');
  t('directiveValues: …and an unmatched trailing bold is kept', dv('Restart-when: closed **acme/w#9**').join('|'), 'closed **acme/w#9**');
  // Negatives — what decoration tolerance must NOT buy.
  t('directiveValues: a backtick mid-line does not start a match', dv('we should add a `Restart-when: closed acme/w#9` line').length, 0);
  t('directiveValues: prose before a bullet does not either', dv('see: - Restart-when: closed acme/w#9').length, 0);
  t('directiveValues: a lowercase key stays invisible, decorated or not', dv('`restart-when: closed acme/w#9`').length, 0);
  t('directiveValues: a bullet needs its space (`-Restart-when:` is a word)', dv('-Restart-when: closed acme/w#9').length, 0);
  t('directiveValues: a decorated valueless line has no value', dv('`Restart-when:`').length, 0);
  t('directiveValues: …nor one padded with a space', dv('`Restart-when: `').length, 0);
  t('directiveValues: …nor a bolded valueless one', dv('**Restart-when:**').length, 0);
  t('directiveValues: the bare valueless line is unchanged', dv('Restart-when:').length, 0);
  t('directiveValues: the key selects (a Blocked-by line is not a Restart-when)', dv('`Blocked-by: #9612`').length, 0);
  t('directiveValues: …and the same reader serves Blocked-by', dv('`Blocked-by: #9612`', 'Blocked-by').join('|'), '#9612');

  // H4 — the decorated line clears the duty, in EITHER channel. #10063 is the
  // measured body specimen: 「`Blocked-by: #9612`」 read as absent, and since
  // the unlock sweep greps the same literal, nothing could ever have returned
  // the card — the silent half of this defect.
  const blocked = (body, comments) => h4BlockedNoBlockedBy(issue(['pm:blocked'], [], body), comments);
  t('H4: the #10063 shape — a backticked BODY line -> clean', blocked('`Blocked-by: #9612`'), null);
  t('H4: a backticked COMMENT line -> clean', blocked('waiting', ['`Blocked-by: #9465`']), null);
  t('H4: a bulleted body line -> clean', blocked('- Blocked-by: #9612'), null);
  t('H4: a `*`-bulleted body line -> clean', blocked('* Blocked-by: #9612'), null);
  t('H4: a bolded body line -> clean', blocked('**Blocked-by:** #9612'), null);
  t('H4: bold around the whole line -> clean', blocked('**Blocked-by: #9612**'), null);
  t('H4: code around the key only -> clean', blocked('`Blocked-by:` #9612'), null);
  t('H4: a bulleted, bolded comment line -> clean', blocked('waiting', ['- **Blocked-by:** #9465']), null);
  // …and the negatives, which are the same list read the other way.
  t('H4: a decorated VALUELESS line does not discharge the duty', typeof blocked('`Blocked-by:`'), 'string');
  t('H4: …nor a bolded valueless one', typeof blocked('**Blocked-by:**'), 'string');
  t('H4: …nor a decorated valueless COMMENT line', typeof blocked('waiting', ['`Blocked-by:`']), 'string');
  t('H4: a decorated lowercase key is still invisible', typeof blocked('`blocked-by: #9612`'), 'string');
  t('H4: a mid-sentence decorated mention is still prose', typeof blocked('seats park the `Blocked-by: #1` line in comments'), 'string');
  // The value-in-code shape already cleared H4 before this change (its first
  // value character is a backtick, and H4 asks only whether SOMETHING follows
  // the key); pinned so the new "not just decoration" clause cannot take it.
  t('H4: a value wrapped in code still discharges the duty', blocked('Blocked-by: `#9612`'), null);

  // The index side of the same lines — H4 asking "is there a line" and the
  // index asking "which card" must agree about what a line IS.
  t('blockedByTargets: the #10063 backticked line names its blocker', blockedByTargets('`Blocked-by: #9612`').map((r) => r.number).join(','), '9612');
  t('blockedByTargets: a bulleted line', blockedByTargets('- Blocked-by: #9823').map((r) => r.number).join(','), '9823');
  t('blockedByTargets: a bolded key (the `**` must not reach the ref walk)', blockedByTargets('**Blocked-by:** #9823').map((r) => r.number).join(','), '9823');
  t('blockedByTargets: bold around the whole line', blockedByTargets('**Blocked-by: #9823**').map((r) => r.number).join(','), '9823');
  // `.map(...).join()` rather than `[0].repo`: an assertion that THROWS when
  // the reader returns nothing aborts the whole self-test, hiding every case
  // after it — which is precisely what a regression in this reader produces.
  t('blockedByTargets: a decorated cross-repo ref keeps its qualifier', blockedByTargets('`Blocked-by: objectstack-ai/objectui#4356`').map((r) => r.repo).join(','), 'objectstack-ai/objectui');
  t('blockedByTargets: a decorated comma run is all blockers', blockedByTargets('- `Blocked-by: #6234, #6245`').map((r) => r.number).join(','), '6234,6245');
  t('blockedByTargets: a mid-sentence decorated mention yields nothing', blockedByTargets('seats park the `Blocked-by: #1` line in comments').length, 0);
  t('blockedByTargets: a decorated lowercase key yields nothing', blockedByTargets('`blocked-by: #9612`').length, 0);
  t('commentBlockedByTargets: a decorated comment line is a real edge', commentBlockedByTargets(['prose', '`Blocked-by: #7`']).map((r) => r.number).join(','), '7');
  t('H5: 🟢 login matching assignee -> clean', h5SeatStickerDesync(issue(['pm:seat'], ['os-zhuang'], '', '[PM seat] domain:devx — 🟢 os-zhuang')), null);
  t('H5: 🟢 login without assignee -> finding', typeof h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] domain:devx — 🟢 os-zhuang')), 'string');
  t('H5: ⏳ vacant with assignee -> finding', typeof h5SeatStickerDesync(issue(['pm:seat'], ['os-help'], '', '[PM seat] domain:cli — ⏳ vacant')), 'string');
  t('H5: ⏳ vacant clean', h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] domain:cli — ⏳ vacant')), null);
  // #9926: the login-extraction fix. Both named shapes from the ruling.
  t(
    'H5: 🟢 login with (session_…) parenthetical, matching assignee -> clean',
    h5SeatStickerDesync(issue(['pm:seat'], ['os-x'], '', '[PM seat] domain:x — 🟢 os-x (session_abc123)')),
    null,
  );
  t(
    'H5: 🟢 login with (session_…) parenthetical, no assignee -> finding',
    typeof h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] domain:x — 🟢 os-x (session_abc123)')),
    'string',
  );
  // Reverse verification against the six titles pinned by the anchor sweep
  // (#9857, run 32229942288) — four measured false positives, then the two
  // true positives, predicted direction first: clean, clean, clean, clean,
  // finding, finding.
  t(
    'H5 reverse-verify: #7623 (os-warren, consistent) -> clean',
    h5SeatStickerDesync(issue(['pm:seat'], ['os-warren'], '', '[PM seat] skills — 🟢 os-warren (session_01AeA3nU1B5Q2pgxqxgUrexd)')),
    null,
  );
  t(
    'H5 reverse-verify: #6017 (os-elon, consistent) -> clean',
    h5SeatStickerDesync(issue(['pm:seat'], ['os-elon'], '', '[PM seat] domain:spec — 🟢 os-elon (session_016D9wdJR14KKCxz1WgdAzcw)')),
    null,
  );
  t(
    'H5 reverse-verify: #6026 (os-zhuang, consistent) -> clean',
    h5SeatStickerDesync(issue(['pm:seat'], ['os-zhuang'], '', '[PM seat] repo:cloud — 🟢 os-zhuang (session_0137TnZzVmkSjXxoSVgPFS6S)')),
    null,
  );
  t(
    'H5 reverse-verify: #9831 (os-warren, consistent) -> clean',
    h5SeatStickerDesync(issue(['pm:seat'], ['os-warren'], '', '[PM seat] repo:objectos — 🟢 os-warren (session_01DXBoKN4MauvPdbMemPMqpr)')),
    null,
  );
  t(
    'H5 reverse-verify: #6367 (no assignee, · title suffix) -> finding',
    typeof h5SeatStickerDesync(
      issue(['pm:seat'], [], '', '[PM seat] domain:engine — 🟢 os-elon (session_019yDEhPBC3tcGkW9bkce1HM) · 在飞 1 · 队列 0'),
    ),
    'string',
  );
  t(
    'H5 reverse-verify: #6024 (no assignee, session id with no login) -> finding',
    typeof h5SeatStickerDesync(
      issue(
        ['pm:seat'],
        [],
        '',
        '[PM seat] domain:cli — 🟢 session_01WeN7F6jQFpcqW2BN56RdPa · 在飞 2 · 队列 1(串行等位) · 决策箱 1 · 正文 2026-08-19 04:1xZ',
      ),
    ),
    'string',
  );
  t('H5: Routine seat needs no assignee', h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] 分诊 — 🟢 Routine')), null);
  t('H5: unparseable title -> finding', typeof h5SeatStickerDesync(issue(['pm:seat'], [], '', 'devx seat registry')), 'string');
  t('H6: seat body over the soft bound -> finding', h6SeatBodyOversized(issue(['pm:seat'], [], 'x'.repeat(10_001), '[PM seat] domain:devx — ⏳ vacant')), true);
  t('H6: seat body at the bound -> clean', h6SeatBodyOversized(issue(['pm:seat'], [], 'x'.repeat(10_000), '[PM seat] domain:devx — ⏳ vacant')), false);
  // Byte length, not code points: multi-byte bodies trip the bound at the same
  // byte size the read-limit failure cares about (3 bytes per CJK char).
  t('H6: multi-byte body measured in bytes', h6SeatBodyOversized(issue(['pm:seat'], [], '账'.repeat(3_400), '[PM seat] domain:devx — ⏳ vacant')), true);
  t('H6: oversized body without pm:seat is out of scope', h6SeatBodyOversized(issue(['pm:queue'], [], 'x'.repeat(20_000), 'big card')), false);

  // -- H7: `Part of` contradicted by a closing keyword (#8293) ---------------
  // Every fixture below is a REAL body from the incident or from the open PRs
  // at the time this landed, so the predicate is pinned against the shapes the
  // protocol actually produces rather than against invented ones.
  const pr = (body) => ({ body });

  // Specimen 1 — PR #8277, the body that closed #8131. Its SECOND sentence, the
  // one written to prevent the auto-close, is what performed it: `close #8131`.
  const pr8277 = pr(
    'Part of #8131\n\n' +
      '⚠️ **Deliberately `Part of` and not `Fixes`.** This closes the card’s §1 only. ' +
      'Its §2 is out of this card’s declared file surface and is the surface of the in-flight #8136. ' +
      'Merging this must not auto-close a card with that half unaddressed; ' +
      'the PM should close #8131 deliberately once #8136 lands.',
  );
  t('H7: the #8277 specimen is a finding', typeof h7PartOfWithClosingKeyword(pr8277), 'string');
  t('H7: …and it names the card it will close', h7row(pr8277).includes('Part of #8131'), true);
  // The measurement that refutes the sidebar hypothesis: the SAME body names
  // #8136 one clause later with no keyword, and #8136 took no closing link.
  // The predicate must reproduce that asymmetry, not blanket-flag both numbers.
  t('H7: …and does NOT implicate #8136 from the same sentence', h7row(pr8277).includes('#8136'), false);

  // Specimen 2 — PR #8261 (`Part of #8103`), the same round's other partial
  // delivery, which stayed open. No keyword anywhere near its number.
  t(
    'H7: the #8261 specimen (Part of, no keyword) is clean',
    h7PartOfWithClosingKeyword(
      pr(
        'Part of #8103 — the **non-destructive half** only. The deletion half stays open ' +
          'and is being decided on #8259, which this PR does not address.',
      ),
    ),
    null,
  );

  // Specimen 3 — open PR #8454. Its only keyword sits in an inline code span,
  // and #8284 carries NO closing link: measured, and the reason the predicate
  // strips code. Flagging this would punish the careful author.
  t(
    'H7: the #8454 specimen (keyword inside backticks) is clean',
    h7PartOfWithClosingKeyword(
      pr(
        'Part of #8284\n\n⚠️ **Deliberately `Part of`, not `Fixes`** — the dispatch asked for ' +
          '`Fixes #8284`, and this PR does not close it: one of the card’s two acceptance pins ' +
          'does not invert. Merging this and closing #8284 would drop the severe half on the floor.',
      ),
    ),
    null,
  );
  // …and the same body proves `closing` is not a closing keyword. GitHub's list
  // is close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved — the
  // gerunds are not on it, and they are everywhere in this prose.
  t(
    'H7: "closing #N" is not a closing keyword',
    h7PartOfWithClosingKeyword(pr('Part of #8284\n\nMerging this and closing #8284 would drop the severe half.')),
    null,
  );
  t(
    'H7: "fixing #N" is not a closing keyword either',
    h7PartOfWithClosingKeyword(pr('Part of #900\n\nfixing #900 needs another round')),
    null,
  );

  // Specimen 4 — open PR #8471: `Part of #8247` AND a keyword bound to #8245.
  // Two different cards, so no contradiction. The binding is per number.
  t(
    'H7: Part of #A with Fixes #B (the #8471 shape) is clean',
    h7PartOfWithClosingKeyword(pr('Part of #8247\n\nFixes #8245 as the actionable half.')),
    null,
  );
  t(
    'H7: Part of #A with Fixes #A on separate lines is a finding',
    typeof h7PartOfWithClosingKeyword(pr('Part of #8247\n\nFixes #8247')),
    'string',
  );

  // The parser ignores negation and modals — that is the whole incident.
  t(
    'H7: a NEGATED closing sentence still counts',
    typeof h7PartOfWithClosingKeyword(pr('Part of #77\n\nThis does not fix #77.')),
    'string',
  );
  t('H7: colon form `Closes: #N`', typeof h7PartOfWithClosingKeyword(pr('Part of #77\n\nCloses: #77')), 'string');
  t('H7: case-insensitive', typeof h7PartOfWithClosingKeyword(pr('part of #77\n\nRESOLVED #77')), 'string');
  // A PR with no `Part of` declaration is out of scope entirely: `Fixes #N` on
  // its own is the normal, correct full-delivery shape.
  t('H7: plain `Fixes #N` with no Part of is out of scope', h7PartOfWithClosingKeyword(pr('Fixes #77')), null);
  t('H7: empty / missing body', h7PartOfWithClosingKeyword(pr(undefined)), null);

  // stripMarkdownCode — the step reading 4 forced.
  t('strip: inline span is blanked', stripMarkdownCode('a `Fixes #1` b').includes('#1'), false);
  t('strip: prose outside spans survives', stripMarkdownCode('a `x` Fixes #1').includes('#1'), true);
  t(
    'strip: fenced block is blanked',
    stripMarkdownCode('Part of #2\n\n```\nFixes #2\n```\n').includes('Fixes #2'),
    false,
  );
  t(
    'strip: tilde fence is blanked',
    stripMarkdownCode('~~~md\nFixes #2\n~~~').includes('Fixes #2'),
    false,
  );
  t(
    'strip: text after a closed fence survives',
    stripMarkdownCode('```\nquoted\n```\nFixes #3').includes('Fixes #3'),
    true,
  );
  // Blanking keeps line structure, so nothing is spliced across a stripped
  // block into a match that was never adjacent in the source.
  t(
    'strip: no splicing across a stripped fence',
    h7PartOfWithClosingKeyword(pr('Part of #4\n\nclose\n```\nx\n```\n#4')),
    null,
  );
  t('H7: a fenced-only keyword is not a finding', h7PartOfWithClosingKeyword(pr('Part of #5\n\n```\nFixes #5\n```')), null);

  // -- H21: a closing keyword inside a sentence that negates it (#10392) -----
  // The positive fixture is the REAL specimen sentence, byte-for-byte from PR
  // #10241's body, and the negative fixtures are real sentences from the same
  // 300-body corpus the stage-1 measurement read — including the two that are
  // the specimen's wording almost exactly and must stay clean.

  // ★ Specimen — PR #10241 (merged 2026-08-20T15:10:06Z). No `Part of`
  // anywhere in the body; #10240 closed `completed` two seconds later.
  const pr10241 = pr(
    '## Out of scope\n\n' +
      'Filed, not fixed: #10240 — the same leak through the **delete** verb. ' +
      '`beforeDelete`→`afterDelete` hands ids over on the context stash, which the ' +
      'measurement above shows is lost on the predicate path.',
  );
  const fired21 = h21NegatedClosingKeyword(pr10241);
  const fired21Row = String(fired21 ?? '');
  t('H21: the #10241 specimen FIRES', typeof fired21, 'string');
  t('H21: …and names the card it will close', fired21Row.includes('`fixed #10240`'), true);
  t('H21: …and quotes the offending sentence back', fired21Row.includes('Filed, not fixed: #10240'), true);
  t('H21: …and says the parser ignores the negation', fired21Row.includes('negations included'), true);
  t('H21: …and offers the safe rewordings', fired21Row.includes('#10240 is not addressed here'), true);
  // H7 is silent on this body — the gap that made the row necessary. If this
  // ever inverts, H21 is redundant rather than merely quiet.
  t('H21: …and H7 is silent on it (the gap this row exists for)', h7PartOfWithClosingKeyword(pr10241), null);

  // The window. `not` and `filed` both fire on the specimen; each marker was
  // measured alone against both corpora.
  t('H21: a bare negated close fires', typeof h21NegatedClosingKeyword(pr('This does not fix #77.')), 'string');
  t('H21: "out of scope" fires', typeof h21NegatedClosingKeyword(pr('Out of scope: closes #77.')), 'string');
  t('H21: "no longer" fires', typeof h21NegatedClosingKeyword(pr('#77 is no longer in scope, so this closes #77 only on paper.')), 'string');

  // ⛔ The rule is the negation window, never keyword presence. 277 of 300
  // measured bodies carry a plain closing keyword and every one is correct.
  t('H21: a plain `Fixes #N` is clean', h21NegatedClosingKeyword(pr('Fixes #10171')), null);
  t(
    'H21: a fourteen-card close list is clean (the #10714 shape)',
    h21NegatedClosingKeyword(pr('Fixes #10581\nFixes #10582\nFixes #10583')),
    null,
  );
  // …and it stays clean even when the body says "not" somewhere ELSE. This is
  // the measured 13-false-positive case a body-scoped window produces.
  t(
    'H21: a negation elsewhere in the body does not reach the keyword',
    h21NegatedClosingKeyword(pr('This does not touch the loader.\n\n### Closing lines\n\nFixes #10581')),
    null,
  );

  // Real corpus near-misses — the specimen's register, no keyword bound to a
  // number. These are the 116-sentence population the row must not report.
  t(
    'H21: "#N is not addressed here" is clean (the advised spelling)',
    h21NegatedClosingKeyword(pr('#10526 is not addressed here — spec-side, another lane.')),
    null,
  );
  t(
    'H21: "#N remains open" is clean',
    h21NegatedClosingKeyword(pr('out of scope for it — #10368 remains open and untouched.')),
    null,
  );
  t(
    'H21: the #10876 near-miss ("filed, not repaired here") is clean',
    h21NegatedClosingKeyword(pr('## Out of scope — filed, not repaired here\n\nThe loader half stays open.')),
    null,
  );
  t(
    'H21: the #10851 near-miss ("filed, not fixed here") is clean',
    h21NegatedClosingKeyword(pr('## The divergence the suite found — filed, not fixed here')),
    null,
  );

  // Disjoint from H7: a number already declared `Part of` is H7's row.
  t(
    'H21: a `Part of #N` body is H7\'s row, not this one',
    h21NegatedClosingKeyword(pr('Part of #77\n\nThis does not fix #77.')),
    null,
  );
  t(
    'H21: …while a DIFFERENT number in the same body is still this row\'s',
    typeof h21NegatedClosingKeyword(pr('Part of #77\n\nFiled, not fixed: #88.')),
    'string',
  );

  // Code stripping — inherited from H7, so a quoted keyword is not a finding.
  t('H21: a keyword in backticks is clean', h21NegatedClosingKeyword(pr('Filed, not `fixed #10240`.')), null);
  t('H21: a fenced keyword is clean', h21NegatedClosingKeyword(pr('not fixed:\n\n```\nFixes #10240\n```')), null);
  t('H21: gerunds are not closing keywords', h21NegatedClosingKeyword(pr('This is not fixing #77.')), null);
  t('H21: empty / missing body', h21NegatedClosingKeyword(pr(undefined)), null);

  // The window itself, pinned directly — it is the whole design. Asserted as
  // the TEXT the marker scan actually sees, not as an offset: the offset is an
  // implementation detail, while "the previous sentence is not in the window"
  // is the property the 13-false-positive measurement turns on.
  const win = (text, idx) => text.slice(sentenceStartOffset(text, idx), idx);
  t('H21 window: a sentence break bounds it', win('No. Fixes #1', 4), '');
  t('H21 window: a blank line bounds it', win('not here\n\nFixes #1', 10), '');
  // The structural boundary lands after the markdown marker, so the window is
  // the heading's / item's own text — and the sentence BEFORE it is excluded.
  t('H21 window: a heading line bounds it', win('not here\n## H\nFixes #1', 14), 'H\n');
  t('H21 window: a list item bounds it', win('not here\n- item\nFixes #1', 16), 'item\n');
  // ⛔ A plain newline is NOT a boundary: commit messages here are hard-wrapped
  // at ~72 columns, so a sentence routinely spans lines on that corpus.
  t('H21 window: a soft-wrapped newline does NOT bound it', sentenceStartOffset('not\nhere', 8), 0);
  t(
    'H21: …so a hard-wrapped negated close still fires',
    typeof h21NegatedClosingKeyword(pr('Filed, not\nfixed: #10240')),
    'string',
  );

  // -- H8: delivering PR merged, card still `pm:dispatched` (#8683) ----------
  // Fixtures reuse H7's extractor pins, so the stripping and per-number-
  // binding measurements carry over rather than being re-proved.
  const dispatched = (n) => ({ ...issue(['pm:dispatched'], ['os-help']), number: n });
  const mergedPr = (number, body, merged_at = '2026-08-13T10:00:00Z') => ({ number, body, merged_at });

  t(
    'H8: merged Part-of PR + still dispatched -> finding',
    typeof h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'Part of #4321 — the non-destructive half only.')]),
    'string',
  );
  t(
    'H8: …and the finding names the delivering PR',
    h8row(dispatched(4321), [mergedPr(4400, 'Part of #4321')]).includes('#4400'),
    true,
  );
  t(
    'H8: …and prescribes the paired write, not just the fact',
    h8row(dispatched(4321), [mergedPr(4400, 'Part of #4321')]).includes('pm:dispatched'),
    true,
  );
  // The closing-keyword arm: an OPEN dispatched card named by a merged PR's
  // closing keyword is a half-state whichever mechanism failed (see header).
  t(
    'H8: merged closing-keyword PR + still-open dispatched card -> finding',
    typeof h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'Fixes #4321')]),
    'string',
  );
  t(
    'H8: card without pm:dispatched is out of scope',
    h8MergedPrStillDispatched({ ...issue(['pm:queue'], ['os-help']), number: 4321 }, [mergedPr(4400, 'Part of #4321')]),
    null,
  );
  // Closed-unmerged is an abandoned attempt, not a delivery: demanding the
  // paired write for work that never landed would be a phantom finding.
  t(
    'H8: closed-unmerged PR is not a delivery',
    h8MergedPrStillDispatched(dispatched(4321), [{ number: 4400, body: 'Part of #4321', merged_at: null }]),
    null,
  );
  // Bound per issue number, exactly like H7.
  t(
    'H8: merged PR delivering a DIFFERENT card -> clean',
    h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'Part of #9999\n\nFixes #8888')]),
    null,
  );
  // Strip reuse: a body QUOTING the spelling in backticks does not deliver —
  // the same careful-author protection H7's reading 4 measured.
  t(
    'H8: reference inside backticks does not deliver',
    h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'the dispatch asked for `Fixes #4321` and `Part of #4321`')]),
    null,
  );
  // A plain prose mention is neither declaration: only the two protocol
  // spellings establish the delivering relation.
  t(
    'H8: plain prose mention does not deliver',
    h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'follow-up to #4321, measurement only')]),
    null,
  );
  t(
    'H8: two merged deliverers -> both named',
    h8row(dispatched(4321), [mergedPr(4400, 'Part of #4321'), mergedPr(4500, 'Fixes #4321')]).includes('#4500'),
    true,
  );
  t('H8: empty merged window -> clean', h8MergedPrStillDispatched(dispatched(4321), []), null);
  t('H8: missing merged window -> clean', h8MergedPrStillDispatched(dispatched(4321), undefined), null);

  // -- H8: the branch-name fallback (#11036) ---------------------------------
  // The card's ⚠️ is the load-bearing clause: this WIDENS the delivery
  // relation, so BOTH directions are pinned — the hit must report, and a
  // re-scoped branch must not.
  const onBranch = (number, body, ref, merged_at = '2026-08-21T14:00:28Z') => ({
    number,
    body,
    merged_at,
    head: { ref },
  });

  // Direction 1 — the measured specimen's shape: merged, body carries NEITHER
  // recognised spelling (`Refs #N` is not one), branch named for the card.
  t(
    'H8 branch: a `Refs #N`-only body delivers via its branch name',
    typeof h8MergedPrStillDispatched(
      dispatched(10757),
      [onBranch(10824, 'Refs #10757', 'claude/issue-10757-dedupe-per-request-queries')],
    ),
    'string',
  );
  t(
    'H8 branch: …and the finding names the delivering PR',
    h8MergedPrStillDispatched(
      dispatched(10757),
      [onBranch(10824, 'Refs #10757', 'claude/issue-10757-dedupe-per-request-queries')],
    ).includes('#10824'),
    true,
  );
  // An empty body is the same population — nothing declared, so the branch is
  // the only evidence there is.
  t(
    'H8 branch: an empty body delivers via its branch name',
    typeof h8MergedPrStillDispatched(dispatched(4321), [onBranch(4400, '', 'claude/issue-4321-x')]),
    'string',
  );

  // Direction 2 — the RE-SCOPED branch, the false-fire this widening could
  // otherwise buy. Branch still named for 4321; body now delivers 9999. The
  // body is the channel an author maintains, so it wins and 4321 stays clean.
  t(
    'H8 branch: a re-scoped branch does NOT deliver the card it is NAMED for',
    h8MergedPrStillDispatched(dispatched(4321), [onBranch(4400, 'Part of #9999', 'claude/issue-4321-x')]),
    null,
  );
  t(
    'H8 branch: …and the card the re-scoped body DOES name still reports',
    typeof h8MergedPrStillDispatched(dispatched(9999), [onBranch(4400, 'Part of #9999', 'claude/issue-4321-x')]),
    'string',
  );
  t(
    'H8 branch: a closing keyword for another card also suppresses the fallback',
    h8MergedPrStillDispatched(dispatched(4321), [onBranch(4400, 'Fixes #9999', 'claude/issue-4321-x')]),
    null,
  );
  // …and the widening does not reach past the merged/unmerged line, nor past
  // the label gate, nor onto a non-protocol branch name.
  t(
    'H8 branch: a closed-UNMERGED PR on the card branch is still not a delivery',
    h8MergedPrStillDispatched(dispatched(4321), [onBranch(4400, '', 'claude/issue-4321-x', null)]),
    null,
  );
  t(
    'H8 branch: a non-protocol branch name delivers nothing',
    h8MergedPrStillDispatched(dispatched(4321), [onBranch(4400, '', 'feat/some-hand-cut-branch')]),
    null,
  );
  t(
    'H8 branch: a branch named for a DIFFERENT card is clean',
    h8MergedPrStillDispatched(dispatched(4321), [onBranch(4400, '', 'claude/issue-9999-x')]),
    null,
  );
  t('H8 branch: a PR row with no head at all does not crash', h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, '')]), null);

  // The extractor itself, and its agreement with the prose-scanning constant —
  // one branch SHAPE, two readers, pinned together so a convention change
  // cannot move only one of them.
  t('H8 branch: the target is the issue number as a string', branchNameTarget('claude/issue-10757-dedupe'), '10757');
  t('H8 branch: surrounding whitespace is tolerated', branchNameTarget('  claude/issue-1-a  '), '1');
  t('H8 branch: a slug with dots and underscores survives', branchNameTarget('claude/issue-1-a.b_c-d'), '1');
  t('H8 branch: a slugless branch is not the protocol shape', branchNameTarget('claude/issue-1'), null);
  t('H8 branch: a trailing path segment is not the protocol shape', branchNameTarget('claude/issue-1-a/b'), null);
  t('H8 branch: a prefixed ref is not the protocol shape', branchNameTarget('refs/heads/claude/issue-1-a'), null);
  t('H8 branch: `main` yields nothing', branchNameTarget('main'), null);
  t('H8 branch: a missing ref yields nothing', branchNameTarget(undefined), null);
  t(
    'H8 branch: the anchored reader agrees with CLAIM_BRANCH_SHAPE on the protocol shape',
    [...'claude/issue-10757-dedupe-per-request-queries'.matchAll(CLAIM_BRANCH_SHAPE)][0][0],
    'claude/issue-10757-dedupe-per-request-queries',
  );

  // -- H8: the open-PR side — a card delivered in HALVES (#10468) ------------
  // The measured specimen: #9834's duration half merged as #10004 while its
  // error-counter half sat OPEN as draft #10226. The old row fired every sweep
  // and prescribed dropping `pm:dispatched` off a card with live work.
  const openHalf = (number, body, draft = false) => ({ number, body, draft, merged_at: null });
  const halves = (openPrs) =>
    h8MergedPrStillDispatched(dispatched(9834), [mergedPr(10004, 'Part of #9834')], openPrs);
  // `halves` is itself three-valued, so it needs the same row-text wrapper as
  // the predicate it closes over — and it must stay a SEPARATE binding rather
  // than `halves` being stringified in place, because the `typeof halves(...)`
  // cases below assert exactly the nullability a `String()` would erase.
  const halvesRow = (...args) => String(halves(...args) ?? '');

  t('H8 open: a half-delivered card still reports', typeof halves([openHalf(10226, 'Part of #9834', true)]), 'string');
  // The whole point of the downgrade: the destructive prescription must not
  // fire on a card whose remaining half is open.
  t(
    'H8 open: …and does NOT prescribe dropping the label',
    halvesRow([openHalf(10226, 'Part of #9834', true)]).includes('Drop `pm:dispatched`'),
    false,
  );
  t(
    'H8 open: …and says the label is CORRECT here',
    halvesRow([openHalf(10226, 'Part of #9834', true)]).includes('must NOT be dropped'),
    true,
  );
  t('H8 open: …and names the open half', halvesRow([openHalf(10226, 'Part of #9834', true)]).includes('#10226'), true);
  t('H8 open: …and the merged half too', halvesRow([openHalf(10226, 'Part of #9834', true)]).includes('#10004'), true);
  t('H8 open: …and counts them, N of M', halvesRow([openHalf(10226, 'Part of #9834', true)]).includes('1 of 2'), true);
  // A draft open half is the specimen's own shape — never filtered out.
  t('H8 open: …and marks the open half as a draft', halvesRow([openHalf(10226, 'Part of #9834', true)]).includes('(draft)'), true);
  t('H8 open: a NON-draft open half counts identically', typeof halves([openHalf(10226, 'Part of #9834', false)]), 'string');

  // …and the row it replaces is unchanged whenever every deliverer HAS merged —
  // the genuine #8683 case, which must keep its prescription.
  t(
    'H8 open: no open deliverer -> the destructive prescription still fires',
    halvesRow([]).includes('Drop `pm:dispatched`'),
    true,
  );
  t('H8 open: a missing open list is the pre-#10468 reading', halvesRow(undefined).includes('Drop `pm:dispatched`'), true);
  t(
    'H8 open: an open PR delivering a DIFFERENT card does not downgrade the row',
    halvesRow([openHalf(10226, 'Part of #9999')]).includes('Drop `pm:dispatched`'),
    true,
  );
  // No merged deliverer at all is still clean — the open side never MANUFACTURES
  // a row, it only softens one the merged side already raised.
  t(
    'H8 open: an open deliverer with no merged half is clean',
    h8MergedPrStillDispatched(dispatched(9834), [], [openHalf(10226, 'Part of #9834')]),
    null,
  );
  // The open side reads delivery through the SAME relation, branch fallback
  // included — a `Refs #N` open half is as live as a `Part of #N` one.
  t(
    'H8 open: the branch-name fallback applies to the open side too',
    halvesRow([{ number: 10226, body: 'Refs #9834', draft: false, merged_at: null, head: { ref: 'claude/issue-9834-error-counter' } }]).includes('must NOT be dropped'),
    true,
  );
  // …and its re-scope guard travels with it.
  t(
    'H8 open: a re-scoped open branch does not soften the row',
    halvesRow([{ number: 10226, body: 'Part of #9999', draft: false, merged_at: null, head: { ref: 'claude/issue-9834-x' } }]).includes('Drop `pm:dispatched`'),
    true,
  );
  // A merged row appearing in the open list is not an outstanding half.
  t(
    'H8 open: a merged row in the open list is not an open half',
    halvesRow([{ number: 10226, body: 'Part of #9834', merged_at: '2026-08-20T00:00:00Z' }]).includes('Drop `pm:dispatched`'),
    true,
  );

  // -- H22: a CLOSED card still carrying a `pm:*` state label (#10688) -------
  const closedCard = (labels, state_reason = 'completed') => ({
    ...issue(labels),
    number: 8531,
    state: 'closed',
    state_reason,
  });

  t('H22: closed + pm:dispatched -> finding', typeof h22ClosedCardPmResidue(closedCard(['pm:dispatched'])), 'string');
  t('H22: …and names the residue label', h22row(closedCard(['pm:dispatched'])).includes('`pm:dispatched`'), true);
  t('H22: …and names the close reason', h22row(closedCard(['pm:dispatched'])).includes('closed `completed`'), true);
  t(
    'H22: …and prescribes only the label strip, no other write',
    h22row(closedCard(['pm:dispatched'])).includes('already closed'),
    true,
  );
  t('H22: a not_planned close is residue too', typeof h22ClosedCardPmResidue(closedCard(['pm:queue'], 'not_planned')), 'string');
  t('H22: a missing state_reason still renders a sentence', typeof h22ClosedCardPmResidue({ ...closedCard(['pm:queue']), state_reason: null }), 'string');
  t(
    'H22: …and never prints the string undefined',
    h22row({ ...closedCard(['pm:queue']), state_reason: null }).includes('undefined'),
    false,
  );
  t('H22: several residue labels are all named', h22row(closedCard(['pm:blocked', 'pm:blocking'])).includes('`pm:blocking`'), true);

  // The gate that keeps this from restating H3: an OPEN card is never this
  // row's, whatever it carries — every other item here already reads it.
  t('H22: an OPEN card carrying pm:dispatched is out of scope', h22ClosedCardPmResidue({ ...issue(['pm:dispatched']), number: 1, state: 'open' }), null);
  t('H22: a card with no state field is out of scope', h22ClosedCardPmResidue(issue(['pm:dispatched'])), null);
  t('H22: a closed card with no pm label is clean', h22ClosedCardPmResidue(closedCard(['domain:cli', 'bug'])), null);
  t('H22: a closed card with no labels at all is clean', h22ClosedCardPmResidue(closedCard([])), null);
  t('H22: a missing issue does not crash', h22ClosedCardPmResidue(undefined), null);

  // The identity stickers, pinned OUT — a closed seat card keeps `pm:seat` as
  // what it IS, not as a claim that work is in flight (see PM_RESIDUE_LABELS).
  t('H22: `pm:seat` on a closed card is identity, not residue', h22ClosedCardPmResidue(closedCard(['pm:seat'])), null);
  t('H22: `pm:epic` likewise', h22ClosedCardPmResidue(closedCard(['pm:epic'])), null);
  t('H22: `pm:retriage` is deliberately out of the measured set', h22ClosedCardPmResidue(closedCard(['pm:retriage'])), null);
  // …but a seat card ALSO carrying a state label is still residue.
  t('H22: `pm:seat` + a state label is residue for the state label', h22row(closedCard(['pm:seat', 'pm:dispatched'])).includes('`pm:dispatched`'), true);
  t('H22: …and does not name the identity sticker', h22row(closedCard(['pm:seat', 'pm:dispatched'])).includes('`pm:seat`'), false);

  // The census's five plus the state ruled in on 2026-08-23, each pinned — the
  // set is the item's scope, so a silent edit to it should break a test rather
  // than quietly change what patrols. `pm:awaiting-maintainer` is the ONE
  // member not drawn from the #10688 census, and deliberately so: it had no
  // live carriers to census when it was created, and admitting it at creation
  // is what keeps the state from accruing the residue this row exists to catch
  // before anyone thinks to measure it (#11196 fix 5).
  t('H22: the residue set is the census five + the newly ruled state', PM_RESIDUE_LABELS.join(','), 'pm:dispatched,pm:queue,pm:blocked,pm:on-hold,pm:blocking,pm:awaiting-maintainer');
  // …and the two similarly-named sets stay APART: H13's carries `finding`, this
  // one carries `pm:blocking`, and unifying them would break both items.
  t('H22: the residue set is NOT H13\'s visibility set', PM_RESIDUE_LABELS.join(',') === PM_STATE_LABELS.join(','), false);
  t('H22: …H13\'s set carries `finding`, which is a fine state to close in', PM_STATE_LABELS.includes('finding'), true);
  t('H22: …and this one does not', PM_RESIDUE_LABELS.includes('finding'), false);
  t('H22: …while `pm:blocking` is residue here and absent from H13\'s', PM_RESIDUE_LABELS.includes('pm:blocking') && !PM_STATE_LABELS.includes('pm:blocking'), true);
  for (const label of PM_RESIDUE_LABELS) {
    t(`H22: \`${label}\` on a closed card is residue`, typeof h22ClosedCardPmResidue(closedCard([label])), 'string');
  }

  // -- H22's DATED CLOSURE FLOOR (objectui#5985) ------------------------------
  //
  // The floor is what lets a sibling install re-enable this row without the
  // backfill its own card thought was the only alternative: judge cards closed
  // on/after a cutover date, leave the historical carriers unjudged, write no
  // labels at all. The cases below pin the three properties that decision rests
  // on — the floor is HONOURED, its absence changes nothing, and a malformed
  // value is refused rather than silently becoming "no floor".
  const FLOOR = new Date(Date.parse('2026-08-28T00:00:00Z'));
  const closedOn = (labels, closed_at) => ({ ...closedCard(labels), closed_at });

  // Honoured, both directions. The old card is the ~815-card backlog in
  // miniature: it carries real residue and is deliberately NOT a finding.
  t('H22 floor: a card closed BEFORE the floor is out of scope', h22ClosedCardPmResidue(closedOn(['pm:dispatched'], '2026-08-01T09:00:00Z'), FLOOR), null);
  t('H22 floor: …however much residue it carries', h22ClosedCardPmResidue(closedOn(['pm:dispatched', 'pm:queue', 'pm:blocked'], '2026-01-01T00:00:00Z'), FLOOR), null);
  t('H22 floor: a card closed AFTER the floor is judged', typeof h22ClosedCardPmResidue(closedOn(['pm:dispatched'], '2026-08-29T09:00:00Z'), FLOOR), 'string');
  t('H22 floor: …and the row still names the residue label', h22row(closedOn(['pm:dispatched'], '2026-08-29T09:00:00Z'), FLOOR).includes('`pm:dispatched`'), true);
  // The boundary is inclusive: the cutover date is the first day the convention
  // applies, so a card closed within it is the convention's own population.
  t('H22 floor: a card closed ON the floor date is judged', typeof h22ClosedCardPmResidue(closedOn(['pm:queue'], '2026-08-28T00:00:00Z'), FLOOR), 'string');
  t('H22 floor: …and later the same day too', typeof h22ClosedCardPmResidue(closedOn(['pm:queue'], '2026-08-28T23:59:59Z'), FLOOR), 'string');
  t('H22 floor: one second before the floor is out', h22ClosedCardPmResidue(closedOn(['pm:queue'], '2026-08-27T23:59:59Z'), FLOOR), null);
  // The floor narrows scope; it never invents findings. A clean recent card is
  // still clean, and an OPEN card is still not this row's.
  t('H22 floor: a clean card after the floor is still clean', h22ClosedCardPmResidue(closedOn(['domain:cli'], '2026-08-29T09:00:00Z'), FLOOR), null);
  t('H22 floor: the closed gate still outranks the floor', h22ClosedCardPmResidue({ ...issue(['pm:dispatched']), state: 'open', closed_at: null }, FLOOR), null);
  // Fail-OPEN on an unreadable closure date: the floor cannot be applied, so
  // the card stays visible rather than being dropped on unread data (#4690).
  t('H22 floor: a card with no closed_at is judged, not dropped', typeof h22ClosedCardPmResidue(closedOn(['pm:dispatched'], null), FLOOR), 'string');
  t('H22 floor: …and an unparseable one likewise', typeof h22ClosedCardPmResidue(closedOn(['pm:dispatched'], 'not-a-date'), FLOOR), 'string');

  // Floor ABSENT — the default, and the property that makes this change a
  // no-op for the install that wants every card in the window judged.
  t('H22 floor: absent floor judges an old closed card exactly as before', typeof h22ClosedCardPmResidue(closedOn(['pm:dispatched'], '2026-01-01T00:00:00Z')), 'string');
  t('H22 floor: …an explicit null is the same as omitting it', typeof h22ClosedCardPmResidue(closedOn(['pm:dispatched'], '2026-01-01T00:00:00Z'), null), 'string');
  t('H22 floor: …and a clean old card is still clean', h22ClosedCardPmResidue(closedOn(['domain:cli'], '2026-01-01T00:00:00Z'), null), null);

  // resolveClosureFloor — the env reading, including the loud refusal.
  t('closure floor: unset means no floor', resolveClosureFloor({}).floor, null);
  t('closure floor: …and that is a VALID reading, not an error', resolveClosureFloor({}).valid, true);
  t('closure floor: …reported as the default source', resolveClosureFloor({}).source, 'default');
  t('closure floor: whitespace is unset too', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: '  ' }).floor, null);
  t('closure floor: a YYYY-MM-DD date resolves to UTC midnight', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: '2026-08-28' }).floor.toISOString(), '2026-08-28T00:00:00.000Z');
  t('closure floor: …and is valid', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: '2026-08-28' }).valid, true);
  t('closure floor: …and names its source', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: '2026-08-28' }).source, 'PM_SWEEP_CLOSED_FLOOR');
  t('closure floor: surrounding whitespace is trimmed, not rejected', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: ' 2026-08-28 ' }).valid, true);
  // Malformed is REFUSED. Each of these would otherwise become "no floor" and
  // restore the flood on the one install that set the variable.
  for (const bad of ['28-08-2026', '2026/08/28', 'yesterday', '2026-08-28T00:00:00Z', '2026-8-28', 'O', '0']) {
    t(`closure floor: \`${bad}\` is refused, not defaulted`, resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: bad }).valid, false);
  }
  // …including a well-SHAPED date that does not exist — the case a bare regex
  // would pass and whose floor would exclude every card, rendering an empty
  // H22 as a clean closed surface.
  t('closure floor: a shape-valid impossible date is refused', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: '2026-02-31' }).valid, false);
  t('closure floor: …and an impossible month likewise', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: '2026-13-01' }).valid, false);
  t('closure floor: a refused value carries no floor to fall back on', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: 'yesterday' }).floor, null);
  t('closure floor: …and is reported as itself for the error message', resolveClosureFloor({ PM_SWEEP_CLOSED_FLOOR: 'yesterday' }).raw, 'yesterday');

  // The summary line's H22 clause — a pass that read nothing must not read the
  // same as a board with no residue (#4690), so the count is always stated.
  t('summary: the H22 clause states what the closed pass read', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, closed: 200 }, 0).includes('H22 read 200 recently-closed issue(s)'), true);
  t('summary: an absent closed count degrades to 0, never to undefined', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0 }, 0).includes('H22 read 0 recently-closed'), true);
  // …and when a floor is in force the line SAYS so: "read 200" with a floor
  // silently applied would overstate what was judged, which is the same
  // unread-reads-as-clean defect the count itself exists to prevent.
  t('summary: a floored pass names the floor date', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, closed: 200, closedFloor: '2026-08-28' }, 0).includes('only cards closed on/after 2026-08-28 are judged'), true);
  t('summary: …and says the earlier closures are not a reading about them', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, closed: 200, closedFloor: '2026-08-28' }, 0).includes('NOT a reading about them'), true);
  t('summary: an unfloored pass adds no floor clause', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, closed: 200 }, 0).includes('are judged'), false);

  // -- H23: the COMMIT-MESSAGE surface (#10942) -------------------------------
  //
  // Every case here drives the REST commit shape the sweep passes in, and the
  // asymmetry cases are run against H7 in the same breath: the claim is not
  // "this predicate fires", it is "these two surfaces answer DIFFERENTLY on one
  // text", and only the paired assertion can say that.
  const commitRow = (message, sha = 'abc123def0') => ({
    sha,
    html_url: `https://github.com/o/r/commit/${sha}`,
    commit: { message },
  });
  /**
   * The shape the squash actually produced in all six measured specimens: a
   * lead commit whose trailer CLOSES the card, and a later commit on the same
   * branch whose trailer says it is only `Part of` it — concatenated by the
   * merge into one message. Reconstructed rather than quoted: the self-test is
   * offline and pure, so it pins the SHAPE the corpus measured, not the bytes.
   */
  const squashOf = (card, pr, keyword = 'Fixes') =>
    commitRow(
      `fix(scope): the lead half (#${pr})\n\n` +
        `* fix(scope): the lead half\n\nProse about the fix.\n\n${keyword} #${card}\n\n` +
        `* test(scope): the second half\n\nMore prose.\n\nPart of #${card}\n\n---------\n\n` +
        `Co-authored-by: Claude <noreply@anthropic.com>\n`,
      `sha${pr}xx`,
    );

  // The six specimens the card measured, by (sha, card, PR). Columns kept apart
  // deliberately, here and in the section docblock: this file must not put a
  // closing keyword next to a live card number in any text a merge could read.
  for (const [sha, card, pr] of [
    ['0c24898c0', '10377', '10389'],
    ['d7283250d', '10219', '10291'],
    ['af2a989be', '9320', '9478'],
    ['3db37957c', '8355', '8419'],
    ['7e06f51ee', '8060', '8167'],
    ['30536e37c', '7828', '8128'],
  ]) {
    t(`H23: the measured specimen shape (${sha}, card ${card}) fires`, typeof h23CommitMessageContradiction(squashOf(card, pr)), 'string');
  }

  // ⛔ THE ASYMMETRY — the card's point 2, pinned in both directions on ONE text.
  // A commit message is not markdown, so a quoted keyword binds here; the same
  // bytes in a PR body do not, and H7 must keep saying so.
  const backticked = 'Part of #77\n\nThe blocking gate wanted `Fixes #77` here.\n';
  t('H23: a backticked keyword in a COMMIT MESSAGE is a binding', typeof h23CommitMessageContradiction(commitRow(backticked)), 'string');
  t('H23: …while the same bytes in a PR BODY are not (H7 stays clean)', h7PartOfWithClosingKeyword({ body: backticked }), null);
  const fencedCommit = 'Part of #77\n\n```\nFixes #77\n```\n';
  t('H23: a FENCED keyword in a commit message is a binding too', typeof h23CommitMessageContradiction(commitRow(fencedCommit)), 'string');
  t('H23: …and the same bytes in a PR body are still not (H7 stays clean)', h7PartOfWithClosingKeyword({ body: fencedCommit }), null);
  // The extractors themselves, at the two surfaces — the option is the whole
  // mechanism, so it is pinned directly and not only through the verdicts.
  t('extractor: a quoted keyword is invisible on the BODY surface (default)', closingKeywordTargets('a `Fixes #1` b').size, 0);
  t('extractor: …and visible on the COMMIT surface', closingKeywordTargets('a `Fixes #1` b', { markdown: false }).size, 1);
  t('extractor: `Part of` in a fence is invisible on the body surface', partOfTargets('```\nPart of #1\n```').size, 0);
  t('extractor: …and visible on the commit surface', partOfTargets('```\nPart of #1\n```', { markdown: false }).size, 1);
  t('extractor: the default is byte-identical to the pre-option reading', closingKeywordTargets('Fixes #1').get('1'), 'Fixes');

  // The REMEDY TEXT. The realistic regression is someone copying H7's tail
  // across, so H7's own sentence is asserted to CARRY the clause this one must
  // never carry — a one-sided assertion would pass against a sentence that lost
  // both.
  const fired23 = String(h23CommitMessageContradiction(squashOf('9320', '9478')) ?? '');
  const fired7 = String(h7PartOfWithClosingKeyword({ body: 'Part of #77\n\nFixes #77' }) ?? '');
  t('H23: the sentence prescribes REWORDING', fired23.includes('REWORD'), true);
  t('H23: …and never the body-surface backtick remedy', fired23.includes('put the keyword in backticks'), false);
  t('H23: …nor any "in backticks" advice at all', fired23.includes('in backticks'), false);
  t('H23: …and says out loud that this surface is not markdown', fired23.includes('NOT markdown'), true);
  t('H7: …while H7 KEEPS that remedy, which is correct for a body', fired7.includes('put the keyword in backticks'), true);
  t('H23: the sentence names the commit sha', fired23.includes('sha9478xx'), true);
  t('H23: …the bound card', fired23.includes('#9320'), true);
  t('H23: …and the PR the squash marker names', fired23.includes('PR #9478'), true);
  t('H23: …and it declines to adjudicate the close', fired23.includes('does NOT adjudicate'), true);

  // Clean directions. H7's per-number binding carries over unchanged: a message
  // that is part of one card and closes another is the normal correct shape.
  t('H23: `Part of #A` + a keyword bound to #B -> clean', h23CommitMessageContradiction(commitRow('Part of #77\n\nFixes #88')), null);
  t('H23: a plain closing trailer with no `Part of` -> clean', h23CommitMessageContradiction(commitRow('fix(x): a fix (#99)\n\nFixes #77')), null);
  t('H23: `Part of` alone -> clean', h23CommitMessageContradiction(commitRow('Part of #77')), null);
  t('H23: gerunds are not closing keywords here either', h23CommitMessageContradiction(commitRow('Part of #77\n\nStill fixing #77.')), null);
  t('H23: empty / missing message', h23CommitMessageContradiction(commitRow(undefined)), null);
  t('H23: a missing commit object', h23CommitMessageContradiction(undefined), null);
  // H21's negation window is deliberately NOT ported to this surface: it flags 0
  // of the 270 measured bindings, so this row is the `Part of` contradiction and
  // nothing else. A future port is a card with its own numbers.
  t('H23: a negated bare close is NOT this row (H21 not ported)', h23CommitMessageContradiction(commitRow('This does not fix #77.')), null);

  // The PR correlation, and the measured property that makes it safe: the `(`
  // of the squash marker stands between any preceding keyword and the number,
  // so no subject's own marker can be read as a card binding (0 of 1,545).
  t('commitSubjectPrNumber: reads the squash marker', commitSubjectPrNumber('fix(x): a subject (#11085)\n\nbody'), '11085');
  t('commitSubjectPrNumber: absent marker -> null', commitSubjectPrNumber('fix(x): a subject\n\nbody'), null);
  t('commitSubjectPrNumber: a marker in the BODY is not the subject\'s', commitSubjectPrNumber('fix(x): a subject\n\nquoted from another commit (#123)'), null);
  t('commitSubjectPrNumber: empty message', commitSubjectPrNumber(''), null);
  t('the squash marker is never bound as a card (the paren stands between)', closingKeywordTargets('fix(x): a subject that fixed (#11085)', { markdown: false }).size, 0);
  t('…including the substring case the corpus is full of', closingKeywordTargets('fix(rest): optional KernelResolver.resolveEnvironment (#11085)', { markdown: false }).size, 0);

  // The summary line's H23 clause — with a yield of ~6 in 1,546 a quiet row is
  // the NORMAL reading, so the coverage numbers are the only thing separating a
  // read surface from an unread one (#4690).
  t('summary: the H23 clause states what the commit pass read', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, commits: 300, commitBindings: 51, commitBindingMessages: 44 }, 0).includes('H23 read 300 squash commit message(s)'), true);
  t('summary: …and the binding totals a promotion decision would need', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, commits: 300, commitBindings: 51, commitBindingMessages: 44 }, 0).includes('51 closing-keyword binding(s) across 44 message(s)'), true);
  t('summary: …and states the window boundary', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0, commits: 300 }, 0).includes('invisible by design'), true);
  t('summary: absent H23 counts degrade to 0, never to undefined', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0 }, 0).includes('H23 read 0 squash commit message(s)'), true);

  // -- H9: `pm:on-hold` without a machine-fireable `Restart-when:` ------------
  const hold = (body) => issue(['pm:on-hold'], [], body);
  t('H9: hold with no Restart-when line -> finding', typeof h9OnHoldNoRestartWhen(hold('parked until the train ships')), 'string');
  t('H9: …and the finding prescribes the close default', h9row(hold('parked')).includes('not planned'), true);
  t('H9: closed-upstream form -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: closed acme/widgets#123')), null);
  t('H9: executable-predicate form -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: npm view create-objectstack dist-tags reports >= 17.0.0')), null);
  t('H9: mid-body line -> clean', h9OnHoldNoRestartWhen(hold('Context first.\nRestart-when: closed acme/widgets#123\nMore prose.')), null);
  // `manual` is a hold trying to opt out of having an exit — it counts as
  // missing, or the one-word spelling defeats the invariant.
  t('H9: manual form -> finding', typeof h9OnHoldNoRestartWhen(hold('Restart-when: manual — first EE customer asking')), 'string');
  t('H9: …and the finding names the manual shape', h9row(hold('Restart-when: manual — reason')).includes('manual'), true);
  t('H9: Manual case-insensitive as a VALUE -> finding', typeof h9OnHoldNoRestartWhen(hold('Restart-when: Manual — reason')), 'string');
  t('H9: manual line + fireable line -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: manual — x\nRestart-when: closed acme/widgets#9')), null);
  // The KEY is byte-stable like `Blocked-by:` — a lowercase key is a line the
  // unlock scan cannot see, so it must flag, not pass.
  t('H9: lowercase key is invisible to the scan -> finding', typeof h9OnHoldNoRestartWhen(hold('restart-when: closed acme/widgets#123')), 'string');
  t('H9: empty-valued line does not count', typeof h9OnHoldNoRestartWhen(hold('Restart-when:')), 'string');
  t('H9: prose mentioning the literal inline does not count', typeof h9OnHoldNoRestartWhen(hold('add a Restart-when: line later')), 'string');
  t('H9: card without pm:on-hold is out of scope', h9OnHoldNoRestartWhen(issue(['pm:queue'], [], 'no line at all')), null);
  t('H9: missing body -> finding', typeof h9OnHoldNoRestartWhen(issue(['pm:on-hold'], [], undefined)), 'string');

  // -- H9 and decorated directive lines (#10102) -----------------------------
  // #9591's shape, byte-for-byte in structure: a legal, machine-fireable hold
  // whose line is wrapped in inline code. The old anchor read it as absent and
  // the old remedy text told the reading seat to close a maintainer-
  // commissioned card.
  const held9591 = '`Restart-when: the v18 major development cycle opens (first v18 changeset-major accepted on main), or a maintainer instruction pulls it forward`';
  t('H9: the #9591 shape — a backticked line is a LEGAL hold', h9OnHoldNoRestartWhen(hold(held9591)), null);
  t('H9: bulleted line -> clean', h9OnHoldNoRestartWhen(hold('- Restart-when: closed acme/widgets#123')), null);
  t('H9: `*`-bulleted line -> clean', h9OnHoldNoRestartWhen(hold('* Restart-when: closed acme/widgets#123')), null);
  t('H9: bolded key -> clean', h9OnHoldNoRestartWhen(hold('**Restart-when:** closed acme/widgets#123')), null);
  t('H9: bold around the whole line -> clean', h9OnHoldNoRestartWhen(hold('**Restart-when: closed acme/widgets#123**')), null);
  t('H9: bullet + code together -> clean', h9OnHoldNoRestartWhen(hold('Context.\n- `Restart-when: closed acme/widgets#123`\nMore prose.')), null);
  // Negatives: decoration must not rescue a line the unlock grep cannot see,
  // and must not turn its own markers into a value.
  t('H9: a decorated lowercase key is still a finding', typeof h9OnHoldNoRestartWhen(hold('`restart-when: closed acme/widgets#123`')), 'string');
  t('H9: a decorated valueless line is still a finding', typeof h9OnHoldNoRestartWhen(hold('`Restart-when:`')), 'string');
  t('H9: …and one padded with a space (the closing marker is not a value)', typeof h9OnHoldNoRestartWhen(hold('`Restart-when: `')), 'string');
  t('H9: a decorated line quoted mid-sentence is still a finding', typeof h9OnHoldNoRestartWhen(hold('someone should add a `Restart-when: closed acme/widgets#1` line')), 'string');
  // The stripped value reaches the `manual` test intact — the decorated manual
  // hold must still fire, or backticks would become the opt-out the bare
  // spelling is denied.
  t('H9: a decorated `manual` hold still fires', typeof h9OnHoldNoRestartWhen(hold('`Restart-when: manual — first EE customer asking`')), 'string');
  t('H9: …and still names the manual shape', h9row(hold('**Restart-when: manual — reason**')).includes('manual'), true);

  // -- H9's remedy text: verify/unwrap first, close last (#10102) ------------
  const h9NoLine = String(h9OnHoldNoRestartWhen(hold('parked until the train ships')) ?? '');
  t('H9: the no-line row names the decorated/unparsed possibility', h9NoLine.includes('cannot parse'), true);
  t('H9: …and tells the seat to read the body before acting', h9NoLine.includes('READ THE BODY BEFORE ACTING'), true);
  t('H9: …and demotes closing to the last resort', h9NoLine.includes('Closing is the LAST resort'), true);
  t('H9: …and says an unwrapped line needs no state change', h9NoLine.includes('no state change is due'), true);
  // The `manual` row is NOT a parse failure — a line was read — so it must not
  // carry the "maybe it is there" hedge, or the one row that really does mean
  // "this hold has no exit" starts reading as uncertain.
  t('H9: the manual row carries no unparsed hedge', h9row(hold('Restart-when: manual — reason')).includes('cannot parse'), false);
  t('H9: …but does still demote closing', h9row(hold('Restart-when: manual — reason')).includes('Closing is the LAST resort'), true);
  // The channel contract, stated in the row itself — two channels since
  // #10403, symmetric with H4/H14. An undocumented difference between two
  // adjacent rules is how the last two half-states on that lane were made,
  // and an undocumented SAMENESS would repeat it in mirror image.
  t('H9: the row states the two-channel contract', h9NoLine.includes('body OR a comment'), true);
  t('H9: …and names the predicates it now matches', h9NoLine.includes('H4/H14'), true);
  t('H9: …and the manual row states it too', h9row(hold('Restart-when: manual — x')).includes('body OR a comment'), true);

  // -- H9's COMMENT channel (#10403) -----------------------------------------
  // The incident fixture: a machine-fireable exit parked in a comment — the
  // shape that fired unnoticed for ~2 days under the body-only read. A
  // comment-channel line is a line.
  t('H9: a comment-channel fireable line -> clean (the 2-day-expired shape)', h9OnHoldNoRestartWhen(hold('parked until upstream ships'), ['triage note', 'Restart-when: closed acme/widgets#123']), null);
  t('H9: a body-channel line still clears with comments read (unchanged)', h9OnHoldNoRestartWhen(hold('Restart-when: closed acme/widgets#123'), ['just prose']), null);
  // Composes with the decoration tolerance: the comment channel goes through
  // the same shared reader, so `stripMatchingDecoration` applies there too.
  t('H9: a DECORATED comment-channel line -> clean', h9OnHoldNoRestartWhen(hold('parked'), ['- `Restart-when: closed acme/widgets#123`']), null);
  t('H9: an executable predicate in a comment -> clean', h9OnHoldNoRestartWhen(hold('parked'), ['Restart-when: npm view create-objectstack dist-tags reports >= 17.0.0']), null);
  // The strictness the widening must not cost, per channel: `manual` opts out
  // in a comment exactly as it does in the body, and a lowercase key is still
  // a line the unlock grep cannot see.
  t('H9: a manual-only comment line is still a finding', typeof h9OnHoldNoRestartWhen(hold('parked'), ['Restart-when: manual — first EE customer asking']), 'string');
  t('H9: a lowercase key in a comment does not rescue', typeof h9OnHoldNoRestartWhen(hold('parked'), ['restart-when: closed acme/widgets#123']), 'string');
  t('H9: a mid-sentence mention in a comment is not a line', typeof h9OnHoldNoRestartWhen(hold('parked'), ['someone should add a `Restart-when: closed acme/w#1` line']), 'string');
  // Both channels read and empty: the sentence says EITHER, so the reader
  // knows both were judged — and an unconsulted channel is never claimed.
  t('H9: neither channel -> the sentence names EITHER channel', h9row(hold('parked'), ['no directive here']).includes('EITHER channel'), true);
  t('H9: an empty comment thread is a real reading', h9row(hold('parked'), []).includes('EITHER channel'), true);
  t('H9: an unconsulted comment channel is not claimed as read', h9row(hold('parked')).includes('EITHER channel'), false);
  t('H9: …and the both-channels hedge tells the seat to read the thread too', h9row(hold('parked'), []).includes('BODY AND THE THREAD'), true);
  // Unreadable is neither read nor absent (#4690): the row fires on the cheap
  // side, says the thread could not be read, and never claims EITHER.
  t('H9: an UNREADABLE comment thread still fires', typeof h9OnHoldNoRestartWhen(hold('parked'), null), 'string');
  t('H9: …but never claims the second channel is empty', h9row(hold('parked'), null).includes('EITHER channel'), false);
  t('H9: …and says the thread could not be read', h9row(hold('parked'), null).includes('could NOT be read'), true);
  t('H9: …citing the unreadable-is-not-absent rule', h9row(hold('parked'), null).includes('#4690'), true);
  t('H9: a fireable BODY line clears even an unreadable thread', h9OnHoldNoRestartWhen(hold('Restart-when: closed acme/widgets#123'), null), null);
  // Manual across channels: a manual body line plus a fireable comment line is
  // the mixed shape a seat actually writes when upgrading a hold in place.
  t('H9: manual body line + fireable comment line -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: manual — x'), ['Restart-when: closed acme/widgets#9']), null);
  t('H9: manual lines in BOTH channels still name the manual shape', h9row(hold('Restart-when: manual — x'), ['Restart-when: manual — y']).includes('manual'), true);

  // The gathering policy — what gets READ AT ALL (mirrors the H4 gate pins).
  t('gate: a body-clean pm:on-hold card is an H9 candidate', needsRestartWhenComments(hold('no line here')), true);
  t('gate: a manual-only body is still a candidate (the body does not answer)', needsRestartWhenComments(hold('Restart-when: manual — x')), true);
  t('gate: a fireable body line buys no fetch', needsRestartWhenComments(hold('Restart-when: closed acme/widgets#123')), false);
  t('gate: a non-hold card buys no fetch from THIS item', needsRestartWhenComments(issue(['pm:blocked'], [], 'no line here')), false);
  t('gate: a missing issue does not crash', needsRestartWhenComments(undefined), false);

  // -- H10: stale unclaimed p0 (routing-gap backstop) -------------------------
  const NOW = Date.parse('2026-08-16T12:00:00Z');
  const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
  const p0 = (assignees, updatedAt, extra = []) => ({
    ...issue(['priority:p0', ...extra], assignees),
    updated_at: updatedAt,
  });
  t('H10: unassigned p0 past the threshold -> finding', typeof h10StaleUnclaimedP0(p0([], hoursAgo(36), ['pm:queue']), NOW), 'string');
  t('H10: …and the finding names the threshold', h10row(p0([], hoursAgo(36)), NOW).includes(`${P0_UNCLAIMED_STALE_HOURS}h`), true);
  t('H10: fresh unassigned p0 -> clean', h10StaleUnclaimedP0(p0([], hoursAgo(1)), NOW), null);
  t('H10: exactly at the threshold -> clean (strictly beyond fires)', h10StaleUnclaimedP0(p0([], hoursAgo(P0_UNCLAIMED_STALE_HOURS)), NOW), null);
  t('H10: assigned p0 is out of scope however old', h10StaleUnclaimedP0(p0(['os-help'], hoursAgo(200)), NOW), null);
  t('H10: non-p0 card is out of scope', h10StaleUnclaimedP0({ ...issue(['pm:queue']), updated_at: hoursAgo(200) }, NOW), null);
  // #4690 in miniature: an unreadable timestamp must not read as fresh.
  t('H10: unparseable updated_at -> finding, not fresh', typeof h10StaleUnclaimedP0(p0([], 'not-a-date'), NOW), 'string');
  t('H10: absent updated_at -> finding, not fresh', typeof h10StaleUnclaimedP0(p0([], undefined), NOW), 'string');
  // The bare conjunction, no state carve-outs: a p0 aging in the decision box
  // is exactly what the brief should show (report-only, tiny population).
  t('H10: p0 aging under needs-user-decision still flags', typeof h10StaleUnclaimedP0(p0([], hoursAgo(48), ['needs-user-decision']), NOW), 'string');

  // -- H11: important-parked inventory (2026-08-16 maintainer concern) --------
  const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
  const parkedCard = (labels, { assignees = [], type, created = daysAgo(10) } = {}) => ({
    ...issue(labels, assignees),
    type,
    created_at: created,
  });
  t('H11: type Bug + on-hold past threshold -> finding', typeof h11ImportantParked(parkedCard(['pm:on-hold'], { type: { name: 'Bug' } }), NOW), 'string');
  t('H11: type as plain string is read too', typeof h11ImportantParked(parkedCard(['pm:on-hold'], { type: 'Bug' }), NOW), 'string');
  t('H11: bug label + blocked -> finding', typeof h11ImportantParked(parkedCard(['bug', 'pm:blocked']), NOW), 'string');
  t('H11: security label + on-hold -> finding', typeof h11ImportantParked(parkedCard(['security', 'pm:on-hold']), NOW), 'string');
  t('H11: priority:p1 + blocked -> finding', typeof h11ImportantParked(parkedCard(['priority:p1', 'pm:blocked']), NOW), 'string');
  t('H11: …and the finding names the parked state', h11row(parkedCard(['bug', 'pm:blocked']), NOW).includes('pm:blocked'), true);
  t('H11: …and the threshold', h11row(parkedCard(['bug', 'pm:blocked']), NOW).includes(`${IMPORTANT_PARKED_STALE_DAYS}d`), true);
  t('H11: fresh park is clean', h11ImportantParked(parkedCard(['bug', 'pm:on-hold'], { created: daysAgo(2) }), NOW), null);
  t('H11: exactly at the threshold is clean (strictly beyond fires)', h11ImportantParked(parkedCard(['bug', 'pm:on-hold'], { created: daysAgo(IMPORTANT_PARKED_STALE_DAYS) }), NOW), null);
  t('H11: important but not parked is out of scope', h11ImportantParked(parkedCard(['bug', 'pm:queue']), NOW), null);
  t('H11: parked but unimportant is out of scope', h11ImportantParked(parkedCard(['pm:on-hold'], { type: { name: 'Task' } }), NOW), null);
  // Distinct from H10: an ASSIGNED old parked p0 is out of H10's scope
  // (assignee set) but squarely in H11's — the cross is the point.
  t('H11: assigned parked p0 still flags (H10 would not)', typeof h11ImportantParked(parkedCard(['priority:p0', 'pm:blocked'], { assignees: ['os-help'] }), NOW), 'string');
  t('H11: …and that same card is H10-clean', h10StaleUnclaimedP0({ ...parkedCard(['priority:p0', 'pm:blocked'], { assignees: ['os-help'] }), updated_at: daysAgo(10) }, NOW), null);
  // #4690 direction, same as H10: unreadable age must not read as fresh.
  t('H11: unreadable created_at -> finding, not fresh', typeof h11ImportantParked(parkedCard(['bug', 'pm:on-hold'], { created: 'not-a-date' }), NOW), 'string');

  // -- H12: orphan landing (queue-steward retirement, 2026-08-16) -------------
  const openPr = ({ draft = false, auto_merge = null, head = { ref: 'claude/issue-1-x' }, updated = hoursAgo(12) } = {}) => ({
    draft,
    auto_merge,
    head,
    updated_at: updated,
    merged_at: null,
  });
  t('H12: ready + unarmed + stale -> finding', typeof h12OrphanLanding(openPr(), NOW), 'string');
  t('H12: …and the finding names the threshold', h12row(openPr(), NOW).includes(`${ORPHAN_LANDING_STALE_HOURS}h`), true);
  t('H12: …and prescribes the landing-window re-read, not just the fact', h12row(openPr(), NOW).includes('landing window'), true);
  t('H12: draft is out of scope however old (parked deliberately)', h12OrphanLanding(openPr({ draft: true, updated: hoursAgo(200) }), NOW), null);
  t('H12: armed auto-merge -> clean (queue machinery holds it)', h12OrphanLanding(openPr({ auto_merge: { merge_method: 'squash' } }), NOW), null);
  t('H12: fresh ready PR -> clean', h12OrphanLanding(openPr({ updated: hoursAgo(1) }), NOW), null);
  t('H12: exactly at the threshold -> clean (strictly beyond fires)', h12OrphanLanding(openPr({ updated: hoursAgo(ORPHAN_LANDING_STALE_HOURS) }), NOW), null);
  t('H12: changeset-release head is the release bot\'s -> out of scope', h12OrphanLanding(openPr({ head: { ref: 'changeset-release/main' }, updated: hoursAgo(200) }), NOW), null);
  t('H12: missing head ref does not crash and still flags', typeof h12OrphanLanding(openPr({ head: undefined, updated: hoursAgo(50) }), NOW), 'string');
  // #4690 in miniature, same as H10/H11: unreadable must not read as fresh.
  t('H12: unreadable updated_at -> finding, not fresh', typeof h12OrphanLanding(openPr({ updated: 'not-a-date' }), NOW), 'string');
  // A row this predicate cannot read is out of scope, not a finding: `draft`
  // must be a real false, so an issue-shaped or partial row never flags.
  t('H12: missing draft field is out of scope', h12OrphanLanding({ auto_merge: null, updated_at: hoursAgo(50) }, NOW), null);
  t('H12: merged row is out of scope', h12OrphanLanding({ ...openPr({ updated: hoursAgo(50) }), merged_at: '2026-08-13T10:00:00Z' }, NOW), null);

  // -- H13: domain:* without any pm-state label, aged (2026-08-19 incident) --
  const domainCard = (labels, updatedAt, extra = {}) => ({
    ...issue(labels),
    updated_at: updatedAt,
    ...extra,
  });
  t('H13: aged domain card with no pm-state -> finding', typeof h13DomainWithoutPmState(domainCard(['domain:engine-core', 'bug', 'regression'], hoursAgo(26)), NOW), 'string');
  t('H13: …and the finding names the threshold', h13row(domainCard(['domain:engine-core'], hoursAgo(26)), NOW).includes(`${DOMAIN_HALF_STATE_STALE_HOURS}h`), true);
  t('H13: …and blames the healing loop, not inventory', h13row(domainCard(['domain:engine-core'], hoursAgo(26)), NOW).includes('healing loop'), true);
  t('H13: pm:queue pairs the domain label -> clean', h13DomainWithoutPmState(domainCard(['domain:engine-core', 'pm:queue'], hoursAgo(26)), NOW), null);
  t('H13: needs-user-decision is a state (the inbox reads it) -> clean', h13DomainWithoutPmState(domainCard(['domain:spec', 'needs-user-decision'], hoursAgo(200)), NOW), null);
  t('H13: finding is a state (the grading round reads it) -> clean', h13DomainWithoutPmState(domainCard(['domain:cli', 'finding'], hoursAgo(200)), NOW), null);
  // `pm:blocking` is a derived priority cache, not a state — a card carrying
  // only it is exactly as invisible to candidate queries, so it still flags.
  t('H13: pm:blocking alone is NOT a state -> still a finding', typeof h13DomainWithoutPmState(domainCard(['domain:services', 'pm:blocking'], hoursAgo(26)), NOW), 'string');
  t('H13: status:parked exemption (its normal shape IS this one)', h13DomainWithoutPmState(domainCard(['domain:services', 'status:parked'], hoursAgo(200)), NOW), null);
  t('H13: tracking exemption', h13DomainWithoutPmState(domainCard(['domain:devx', 'tracking'], hoursAgo(200)), NOW), null);
  t('H13: qa-run exemption', h13DomainWithoutPmState(domainCard(['domain:cli', 'qa-run'], hoursAgo(200)), NOW), null);
  t('H13: no domain label is out of scope however bare', h13DomainWithoutPmState(domainCard(['bug'], hoursAgo(200)), NOW), null);
  t('H13: fresh half-state is intake latency, not a finding', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(1)), NOW), null);
  t('H13: exactly at the threshold -> clean (strictly beyond fires)', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(DOMAIN_HALF_STATE_STALE_HOURS)), NOW), null);
  // #4690 in miniature, same as H10/H11/H12: unreadable must not read as fresh.
  t('H13: unreadable updated_at -> finding, not fresh', typeof h13DomainWithoutPmState(domainCard(['domain:engine-core'], 'not-a-date'), NOW), 'string');
  t('H13: absent updated_at -> finding, not fresh', typeof h13DomainWithoutPmState(domainCard(['domain:engine-core'], undefined), NOW), 'string');
  // The louder line — the measured card carried its trigger in its own body.
  const p0Body = { body: 'P0 checklist-item failure (data-integrity DELETE regression) — priority label is triage’s to set' };
  t('H13: body self-declaring P0 -> louder line', h13row(domainCard(['domain:engine-core'], hoursAgo(26), p0Body), NOW).includes('P0-SUSPECT'), true);
  t('H13: …which prescribes the emergency-triage channel', h13row(domainCard(['domain:engine-core'], hoursAgo(26), p0Body), NOW).includes('emergency-triage'), true);
  t('H13: data-integrity phrasing alone fires the louder line', h13SelfDeclaredP0({ title: '', body: 'a data integrity regression in DELETE' }), true);
  t('H13: the title is scanned too', h13SelfDeclaredP0({ title: 'p0 suspect: rows vanish', body: '' }), true);
  // Strip reuse (H7 reading 4): quoting the token in backticks is not a
  // self-declaration, and `P0` inside a word is not the token.
  t('H13: P0 only inside backticks is not a self-declaration', h13SelfDeclaredP0({ title: '', body: 'the card quotes `P0` in passing' }), false);
  t('H13: P0 inside a word does not fire', h13SelfDeclaredP0({ title: '', body: 'the HTTP0 protocol note' }), false);
  t('H13: a quiet body stays on the base line', h13row(domainCard(['domain:engine-core'], hoursAgo(26), { body: 'ordinary defect' }), NOW).includes('P0-SUSPECT'), false);

  // -- H18: `pm:retriage` aged past one triage cycle (2026-08-19/20 ruling) --
  // Reuses `domainCard` — a generic (labels, updated_at, extra) issue builder,
  // not a domain-specific one despite the name.
  t('H18: retriage past the threshold, coexisting pm:queue -> finding', typeof h18RetriageAged(domainCard(['pm:retriage', 'pm:queue'], hoursAgo(3)), NOW), 'string');
  t('H18: …and the finding names the threshold', h18row(domainCard(['pm:retriage', 'pm:queue'], hoursAgo(3)), NOW).includes(`${RETRIAGE_STALE_HOURS}h`), true);
  t('H18: …and names the coexisting standing label', h18row(domainCard(['pm:retriage', 'pm:queue'], hoursAgo(3)), NOW).includes('`pm:queue`'), true);
  t('H18: multiple coexisting labels are all named', h18row(domainCard(['pm:retriage', 'pm:blocked', 'pm:blocking'], hoursAgo(3)), NOW).includes('`pm:blocked`') && h18row(domainCard(['pm:retriage', 'pm:blocked', 'pm:blocking'], hoursAgo(3)), NOW).includes('`pm:blocking`'), true);
  // Under-threshold: fresh objection is normal intake latency, not a finding.
  t('H18: retriage under the threshold -> clean', h18RetriageAged(domainCard(['pm:retriage', 'pm:queue'], hoursAgo(1)), NOW), null);
  t('H18: exactly at the threshold -> clean (strictly beyond fires)', h18RetriageAged(domainCard(['pm:retriage', 'pm:queue'], hoursAgo(RETRIAGE_STALE_HOURS)), NOW), null);
  // No `pm:retriage` label at all is out of scope, however old.
  t('H18: no pm:retriage label -> out of scope however old', h18RetriageAged(domainCard(['pm:queue'], hoursAgo(200)), NOW), null);
  // The disputed-target variant: `pm:retriage` alone, no coexisting `pm:*`.
  t('H18: retriage ALONE (no coexisting pm:* label) -> finding', typeof h18RetriageAged(domainCard(['pm:retriage'], hoursAgo(3)), NOW), 'string');
  t('H18: …and names the disputed-target note', h18row(domainCard(['pm:retriage'], hoursAgo(3)), NOW).includes('异议对象不明'), true);
  t('H18: …and does not claim a coexisting label it does not have', h18row(domainCard(['pm:retriage'], hoursAgo(3)), NOW).includes('alongside its standing'), false);
  // A non-`pm:*` label (e.g. `domain:*`) never counts as the coexisting label.
  t('H18: a domain: label is not counted as a coexisting pm:* label', h18row(domainCard(['pm:retriage', 'domain:skills'], hoursAgo(3)), NOW).includes('异议对象不明'), true);
  // #4690 in miniature, same as H10–H13: unreadable must not read as fresh.
  t('H18: unreadable updated_at -> finding, not fresh', typeof h18RetriageAged(domainCard(['pm:retriage'], 'not-a-date'), NOW), 'string');
  t('H18: absent updated_at -> finding, not fresh', typeof h18RetriageAged(domainCard(['pm:retriage'], undefined), NOW), 'string');
  // Report-only, ordinary row in both media — never loud (H14–H16's own
  // property, and the card's explicit requirement for this item).
  t('H18: not a loud finding', isLoudFinding(h18RetriageAged(domainCard(['pm:retriage', 'pm:queue'], hoursAgo(3)), NOW)), false);

  // -- H14: `pm:blocking` cache coherence, both directions (2026-08-19) ------
  // The fixtures below are REAL lines from the 2026-08-19 census of this board
  // (234 open cards, 17 `Blocked-by:` body lines), so the parser is pinned
  // against the shapes seats actually write rather than against invented ones.
  const carded = (number, labels, body = '', extra = {}) => ({
    ...issue(labels, [], body),
    number,
    ...extra,
  });
  const numbersOf = (refs) => refs.map((r) => r.number).join(',');

  // The parser. Line-anchored and case-sensitive like H4/H9's readings of the
  // same body channel.
  t('blockedByTargets: the plain live shape', numbersOf(blockedByTargets('Blocked-by: #9823')), '9823');
  t('blockedByTargets: a bare local ref carries no repo', blockedByTargets('Blocked-by: #9823')[0].repo, null);
  t('blockedByTargets: mid-body line is found', numbersOf(blockedByTargets('Context first.\nBlocked-by: #7220\nMore prose.')), '7220');
  // Live line from #9784 — trailing prose after the ref is normal.
  t(
    'blockedByTargets: trailing prose after the ref is ignored',
    numbersOf(blockedByTargets('Blocked-by: #9689 (the relocation it needs is the same edit; doing them in the other order means touching the line twice).')),
    '9689',
  );
  // The reason only the LEADING run is taken: a `#N` inside the trailing prose
  // is context, not a blocker, and indexing it would file a phantom
  // missing-cache row against a third card that did nothing wrong.
  t(
    'blockedByTargets: a ref inside the trailing prose is NOT a blocker',
    numbersOf(blockedByTargets('Blocked-by: #123 (see #456 for the background)')),
    '123',
  );
  t('blockedByTargets: a comma-separated run is all blockers', numbersOf(blockedByTargets('Blocked-by: #6234, #6245')), '6234,6245');
  t('blockedByTargets: the `and` connector is a separator', numbersOf(blockedByTargets('Blocked-by: #1 and #2')), '1,2');
  t('blockedByTargets: two lines on one card both count', numbersOf(blockedByTargets('Blocked-by: #6234\nBlocked-by: #6245')), '6234,6245');
  // Live line from #7917 — the cross-repo shape whose number must never be
  // read as local (see `buildBlockingIndex`).
  t('blockedByTargets: a cross-repo qualifier is captured, not dropped', blockedByTargets('Blocked-by: objectstack-ai/objectui#4356')[0].repo, 'objectstack-ai/objectui');
  t('blockedByTargets: …and its number is still parsed', numbersOf(blockedByTargets('Blocked-by: objectstack-ai/objectui#4356')), '4356');
  // Byte-stable key, same discipline as H4/H9: a spelling the real grep cannot
  // see must not become an index entry here.
  t('blockedByTargets: lowercase key is invisible to the scan', numbersOf(blockedByTargets('blocked-by: #123')), '');
  t('blockedByTargets: mid-sentence mention is not a line', numbersOf(blockedByTargets('seats park the Blocked-by: #123 line in comments instead')), '');
  t('blockedByTargets: an empty-valued line yields nothing', numbersOf(blockedByTargets('Blocked-by:')), '');
  t('blockedByTargets: missing body', numbersOf(blockedByTargets(undefined)), '');
  // The self-reference trap: this sweeper's OWN rendered rows land in an issue
  // body (the anchor the patrol rewrites), and those rows quote the literal.
  // They are bullets, so the key never starts a line — pinned, because the day
  // it does the sweeper starts indexing its own report.
  t(
    'blockedByTargets: a rendered finding row does not parse as a Blocked-by line',
    numbersOf(blockedByTargets('- **H14** [#5](https://example.test/5) — targeted by 1 open card(s)\' `Blocked-by:` body line (#7)')),
    '',
  );
  // Deliberately NOT stripped, unlike H7/H8/H13: this models a machine reader
  // (the unlock scan greps the literal), so a fenced line really does fire the
  // live machinery and must be reported as part of the index it feeds.
  t('blockedByTargets: a fenced line still counts (this reader greps, it does not read prose)', numbersOf(blockedByTargets('```\nBlocked-by: #42\n```')), '42');

  // The index.
  const idx = (issues) => buildBlockingIndex(issues, { repo: 'objectstack-ai/objectstack' });
  t('index: a local ref creates an entry', idx([carded(9849, [], 'Blocked-by: #9823')]).get(9823).join(','), '9849');
  t('index: a cross-repo ref creates NO local entry', idx([carded(7917, [], 'Blocked-by: objectstack-ai/objectui#4356')]).has(4356), false);
  t('index: the bare repo name is still local', idx([carded(10, [], 'Blocked-by: objectstack#5')]).get(5).join(','), '10');
  t('index: the full owner/repo qualifier is local', idx([carded(10, [], 'Blocked-by: objectstack-ai/objectstack#5')]).get(5).join(','), '10');
  t('index: a self-reference is dropped (a card cannot unblock itself)', idx([carded(5, [], 'Blocked-by: #5')]).has(5), false);
  t('index: two dependents on one target', idx([carded(10, [], 'Blocked-by: #5'), carded(11, [], 'Blocked-by: #5')]).get(5).join(','), '10,11');
  t('index: one dependent naming the target twice is listed once', idx([carded(10, [], 'Blocked-by: #5\nBlocked-by: #5')]).get(5).join(','), '10');
  t('index: a card with no line contributes nothing', idx([carded(10, [], 'no dependency here')]).size, 0);
  t('index: an empty listing is an empty index', idx([]).size, 0);
  t('index: a missing listing does not crash', buildBlockingIndex(undefined).size, 0);

  // The comment channel in the index — a UNION with the body, never a priority
  // order (#10061).
  const idxc = (issues, comments) =>
    buildBlockingIndex(issues, { repo: 'objectstack-ai/objectstack', comments: new Map(comments) });
  t('index: a comment-only edge is a real edge', idxc([carded(9828, ['pm:blocked'], 'body has no line')], [[9828, ['Blocked-by: #9465']]]).get(9465).join(','), '9828');
  t('index: body and comment edges UNION rather than override', idxc([carded(10, [], 'Blocked-by: #5')], [[10, ['Blocked-by: #6']]]).get(5).join(',') + '|' + idxc([carded(10, [], 'Blocked-by: #5')], [[10, ['Blocked-by: #6']]]).get(6).join(','), '10|10');
  t('index: the same target in both channels is listed once', idxc([carded(10, [], 'Blocked-by: #5')], [[10, ['Blocked-by: #5']]]).get(5).join(','), '10');
  t('index: two comments naming two targets both land', [...idxc([carded(10, [], '')], [[10, ['Blocked-by: #5', 'Blocked-by: #6']]]).keys()].sort((a, b) => a - b).join(','), '5,6');
  t('index: a cross-repo ref in a COMMENT is dropped like a body one', idxc([carded(7917, [], '')], [[7917, ['Blocked-by: objectstack-ai/objectui#4356']]]).has(4356), false);
  t('index: a self-reference in a COMMENT is dropped too', idxc([carded(5, [], '')], [[5, ['Blocked-by: #5']]]).has(5), false);
  t('index: comments for a card not in the listing contribute nothing', idxc([carded(10, [], '')], [[99, ['Blocked-by: #5']]]).size, 0);
  t('index: an absent comments map leaves the body reading untouched', buildBlockingIndex([carded(10, [], 'Blocked-by: #5')], { repo: 'objectstack-ai/objectstack' }).get(5).join(','), '10');
  t('index: an empty comment list for a card is harmless', idxc([carded(10, [], 'Blocked-by: #5')], [[10, []]]).get(5).join(','), '10');

  // Direction A — the label carried with nothing targeting it.
  t('H14-A: pm:blocking with nothing targeting it -> finding', typeof h14BlockingCacheIncoherent(carded(7276, ['pm:queue', 'pm:blocking']), idx([])), 'string');
  t('H14-A: …and it names the stale-cache reading', h14row(carded(7276, ['pm:blocking']), idx([])).includes('stale derived cache'), true);
  t('H14-A: …and prescribes the derivation pass, never a label from here', h14row(carded(7276, ['pm:blocking']), idx([])).includes('derivation pass'), true);
  t('H14-A: …and says why stale is worse than absent', h14row(carded(7276, ['pm:blocking']), idx([])).includes('with authority'), true);
  // The repo-boundary wording (#10139): STALE reads as "no dependent in this
  // repo", never as exhaustive over the population, and the remedy is
  // conditional on a cross-repo check rather than an outright drop.
  t('H14-A: …names the repo boundary', h14row(carded(7276, ['pm:blocking']), idx([])).includes('no dependent found in this repo'), true);
  t('H14-A: …and says cross-repo dependents are not swept', h14row(carded(7276, ['pm:blocking']), idx([])).includes('cross-repo dependents are not swept'), true);
  t('H14-A: …and the remedy is conditional on verifying cross-repo dependents', h14row(carded(7276, ['pm:blocking']), idx([])).includes('verify cross-repo dependents before'), true);
  // The negative: the old exhaustive phrasing ("the full two-channel index",
  // instructing an unconditional drop) must be gone — it is what would have
  // told a reader to sever the live #7917 / objectui#4356 edge.
  t('H14-A: …and the old exhaustive phrasing is GONE', h14row(carded(7276, ['pm:blocking']), idx([])).includes('full two-channel index'), false);
  // The negative for direction A: the label is EARNED, so nothing to report.
  t(
    'H14-A: pm:blocking with a real dependent -> clean',
    h14BlockingCacheIncoherent(carded(5, ['pm:blocking']), idx([carded(10, [], 'Blocked-by: #5')])),
    null,
  );

  // Direction B — targeted, but the cache never landed.
  const missingIdx = idx([carded(9650, ['pm:queue'], 'Blocked-by: #9832')]);
  t('H14-B: targeted without pm:blocking -> finding', typeof h14BlockingCacheIncoherent(carded(9832, ['bug', 'pm:dispatched', 'domain:cli']), missingIdx), 'string');
  t('H14-B: …and it names the waiting card', h14row(carded(9832, ['pm:dispatched']), missingIdx).includes('#9650'), true);
  t('H14-B: …and calls it an invisible unblocker', h14row(carded(9832, ['pm:dispatched']), missingIdx).includes('selection order cannot see'), true);
  // The negative for direction B: no label and nobody waiting is the ordinary
  // shape of ~230 of this board's ~234 open cards. It must be silent, or the
  // row means nothing.
  t('H14-B: no label and nothing targeting it -> clean', h14BlockingCacheIncoherent(carded(4321, ['pm:queue', 'domain:cli']), idx([])), null);
  // The cross-repo consequence, end to end: #7917's objectui blocker must not
  // manufacture a direction-B row against this repo's #4356.
  t(
    'H14-B: a cross-repo blocker does not flag the local card of that number',
    h14BlockingCacheIncoherent(carded(4356, ['pm:queue']), idx([carded(7917, [], 'Blocked-by: objectstack-ai/objectui#4356')])),
    null,
  );
  // Fan-out cap: named, then counted.
  const manyDeps = idx(Array.from({ length: 7 }, (_, i) => carded(100 + i, [], 'Blocked-by: #5')));
  t('H14-B: a large fan-out names the cap and counts the rest', h14row(carded(5, ['pm:queue']), manyDeps).includes(`+${7 - BLOCKING_DEPENDENT_LIST_CAP} more`), true);
  t('H14-B: …and reports the true total, not the capped one', h14row(carded(5, ['pm:queue']), manyDeps).includes('targeted by 7 open card(s)'), true);
  t('H14: a missing index does not crash and reads as untargeted', h14BlockingCacheIncoherent(carded(5, ['pm:blocking']), undefined) !== null, true);

  // Reverse verification against the LIVE board, 2026-08-19 (234 open cards).
  // Predicted before running: direction A fires on #7276 (the board's only
  // `pm:blocking` card, targeted by nothing), direction B fires on the five
  // targeted-but-unlabeled cards. Both held. Not one coherent pairing existed
  // at that reading — the cache had drifted to 0% agreement with its index.
  const liveBodies = [
    carded(9849, ['pm:queue'], 'Blocked-by: #9823'),
    carded(9784, ['pm:queue'], 'Blocked-by: #9689 (the relocation it needs is the same edit).'),
    carded(9650, ['pm:queue'], 'Blocked-by: #9832'),
    carded(9592, ['pm:queue'], 'Blocked-by: #9255'),
    carded(9482, ['pm:queue'], 'Blocked-by: #9652'),
    carded(9249, ['pm:queue'], 'Blocked-by: #9919'),
    carded(7917, ['pm:queue'], 'Blocked-by: objectstack-ai/objectui#4356'),
    carded(2657, ['pm:blocked'], 'Blocked-by: #6234\nBlocked-by: #6245'),
  ];
  const liveIdx = idx(liveBodies);
  t('H14 reverse-verify: #7276 (the board\'s only pm:blocking card) -> stale finding', typeof h14BlockingCacheIncoherent(carded(7276, ['pm:queue', 'domain:devx', 'pm:blocking']), liveIdx), 'string');
  t('H14 reverse-verify: #9832 (targeted by #9650, unlabeled) -> missing finding naming #9650', h14row(carded(9832, ['bug', 'pm:dispatched', 'domain:cli']), liveIdx).includes('#9650'), true);
  t('H14 reverse-verify: #9919 (targeted by #9249, unlabeled) -> missing finding', typeof h14BlockingCacheIncoherent(carded(9919, ['pm:queue', 'repo:cloud']), liveIdx), 'string');
  // …and the four measured NON-findings from the same reading, which is what
  // makes the six above readable as signal rather than as a predicate that
  // flags everything: a dependent card, a closed target's dependent, the
  // cross-repo number, and an ordinary untouched card.
  t('H14 reverse-verify: #9650 (a waiting card, not an unblocker) -> clean', h14BlockingCacheIncoherent(carded(9650, ['pm:queue']), liveIdx), null);
  t('H14 reverse-verify: local #4356 (the objectui blocker\'s number) -> clean', h14BlockingCacheIncoherent(carded(4356, ['pm:queue']), liveIdx), null);
  t('H14 reverse-verify: #2657 (blocked on two CLOSED cards) -> clean', h14BlockingCacheIncoherent(carded(2657, ['pm:blocked']), liveIdx), null);
  t('H14 reverse-verify: an ordinary open card -> clean', h14BlockingCacheIncoherent(carded(9913, ['pm:queue', 'repo:cloud']), liveIdx), null);

  // -- H14 + the comment channel: the two MEASURED false stales (#10061) -----
  //
  // Both were reported stale on 2026-08-19 by a body-only index while their
  // dependents stated the wait in comments. The comment bodies below are the
  // real ones from those threads, trimmed to the load-bearing lines. These are
  // regression pins: a body-only index makes each of the two "-> stale" rows
  // pass and each of the two "-> clean" rows fail.
  const falseStaleSources = [
    // #9465 (epic, `pm:blocking`): both dependents are body-clean.
    carded(9709, ['pm:blocked'], 'Card body: add the console-injection guard to release.yml.'),
    carded(9828, ['pm:blocked'], 'Card body: cut-rc.yml points a curator at an expired deadline.'),
    // #9968 (decision card, `pm:blocking`): same shape.
    carded(9969, ['pm:blocked'], 'Card body: consumerless vendor `/admin/` surface posture.'),
    carded(9652, ['pm:blocked'], 'Card body: set-role veto tension in the same vendor-admin family.'),
  ];
  const falseStaleComments = new Map([
    [9709, ['First-touch grading (triage seat): promoted out of `finding` -> `pm:blocked`, type Task.\n\nBlocked-by: #9465\n\nPremise re-checked on current values.']],
    [9828, [liveBackfillComment]],
    [9969, ['Triage: graded `pm:blocked` · `domain:services` · type Task, blocked behind the family decision.\n\nBlocked-by: #9968\n']],
    [9652, ['Triage: same family as #9968; the ruling there sets this one.\n\nBlocked-by: #9968\n']],
  ]);
  const bodyOnlyIdx = idx(falseStaleSources);
  const unionIdx = buildBlockingIndex(falseStaleSources, {
    repo: 'objectstack-ai/objectstack',
    comments: falseStaleComments,
  });
  const epic9465 = carded(9465, ['domain:devx', 'pm:epic', 'pm:blocking']);
  const decision9968 = carded(9968, ['pm:decision', 'pm:blocking']);
  // The defect, pinned: this is what the body-only index reported.
  t('H14 false-stale: #9465 reads STALE against a body-only index', h14row(epic9465, bodyOnlyIdx).includes('stale derived cache'), true);
  t('H14 false-stale: #9968 reads STALE against a body-only index', h14row(decision9968, bodyOnlyIdx).includes('stale derived cache'), true);
  // The fix: the same two cards against the two-channel index.
  t('H14 false-stale: #9465 is CLEAN once comment edges are read', h14BlockingCacheIncoherent(epic9465, unionIdx), null);
  t('H14 false-stale: #9968 is CLEAN once comment edges are read', h14BlockingCacheIncoherent(decision9968, unionIdx), null);
  t('H14 false-stale: …because #9709 and #9828 both point at #9465', unionIdx.get(9465).join(','), '9709,9828');
  t('H14 false-stale: …and #9969 and #9652 both point at #9968', unionIdx.get(9968).join(','), '9969,9652');
  // Direction B rides the same union: a comment-only edge is enough to call a
  // card an invisible unblocker.
  t('H14-B: a comment-only edge produces a missing-cache row', h14row(carded(9465, ['domain:devx']), unionIdx).includes('#9709'), true);
  t('H14-B: …and the sentence names the channel pair', h14row(carded(9465, ['domain:devx']), unionIdx).includes('body or comment'), true);
  t('H14-A: …the stale sentence names both channels too', h14row(epic9465, bodyOnlyIdx).includes('body OR comment'), true);

  // -- H14 under an INCOMPLETE index (a gated comment fetch failed) ----------
  //
  // Asymmetric on purpose: stale is a claim about ABSENT evidence and must not
  // be made from an index known to be missing edges (#4690); missing is a
  // claim about evidence in hand, which reading more sources can only add to.
  t('H14-A: stale is SUSPENDED when the index is known incomplete', h14BlockingCacheIncoherent(epic9465, bodyOnlyIdx, { indexComplete: false }), null);
  t('H14-A: …and still fires when the index is complete', typeof h14BlockingCacheIncoherent(epic9465, bodyOnlyIdx, { indexComplete: true }), 'string');
  t('H14-A: …and completeness defaults to true for body-only callers', typeof h14BlockingCacheIncoherent(epic9465, bodyOnlyIdx), 'string');
  t('H14-B: missing SURVIVES an incomplete index', h14row(carded(9465, ['domain:devx']), unionIdx, { indexComplete: false }).includes('#9709'), true);
  t('H14-B: …and an earned label stays clean either way', h14BlockingCacheIncoherent(epic9465, unionIdx, { indexComplete: false }), null);

  // The summary line carries the third `read X of Y` pair, and says out loud
  // when the shortfall cost H14 its stale direction.
  const fbCounts = (fallbackProbed, fallbackCandidates) => ({
    repo: 'objectstack-ai/objectstack', issues: 1, unscoped: 1, prs: 0, merged: 0,
    fallbackProbed, fallbackCandidates,
  });
  t('summary: the fallback pair is reported', summaryLine(fbCounts(24, 26), 3).includes('comment fallback read on 24 of 26 candidate(s)'), true);
  t('summary: a shortfall announces the suspended stale direction', summaryLine(fbCounts(24, 26), 3).includes('stale direction is SUSPENDED'), true);
  t('summary: a complete pass says nothing about suspension', summaryLine(fbCounts(26, 26), 3).includes('SUSPENDED'), false);
  t('summary: absent fallback counts still render a sentence', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0 }, 0).includes('comment fallback read on 0 of 0'), true);

  // -- H15: oldest unclaimed `pm:blocking` (selection-order visibility) -------
  const blockingCard = (number, { assignees = [], created = daysAgo(3) } = {}) => ({
    ...issue(['pm:blocking', 'pm:queue'], assignees),
    number,
    created_at: created,
  });

  t('H15: the oldest unclaimed card is the one reported', h15OldestUnclaimedBlocking([blockingCard(10, { created: daysAgo(2) }), blockingCard(20, { created: daysAgo(9) }), blockingCard(30, { created: daysAgo(5) })], NOW).issue.number, 20);
  t('H15: …and the row states the age in hours', h15OldestUnclaimedBlocking([blockingCard(20, { created: hoursAgo(220) })], NOW).message.includes('open ~220h'), true);
  t('H15: …and names the selection-order rank it exists to police', h15OldestUnclaimedBlocking([blockingCard(20)], NOW).message.includes('second only to'), true);
  t('H15: …and declares the age is the CARD\'s, not the label\'s', h15OldestUnclaimedBlocking([blockingCard(20)], NOW).message.includes("Age is the CARD's"), true);
  t('H15: …and declares itself thresholdless visibility, not an alarm', h15OldestUnclaimedBlocking([blockingCard(20)], NOW).message.includes('no threshold'), true);
  t('H15: the count separates unclaimed from the total', h15OldestUnclaimedBlocking([blockingCard(10), blockingCard(20, { assignees: ['os-help'] }), blockingCard(30, { assignees: ['os-help'] })], NOW).message.includes('1 of 3 open'), true);
  // The two "no row" shapes the card names.
  t('H15: every pm:blocking card assigned -> no row', h15OldestUnclaimedBlocking([blockingCard(10, { assignees: ['os-help'] }), blockingCard(20, { assignees: ['os-warren'] })], NOW), null);
  t('H15: no pm:blocking card at all -> no row', h15OldestUnclaimedBlocking([{ ...issue(['pm:queue']), number: 10, created_at: daysAgo(30) }], NOW), null);
  t('H15: an empty listing -> no row', h15OldestUnclaimedBlocking([], NOW), null);
  t('H15: a missing listing -> no row', h15OldestUnclaimedBlocking(undefined, NOW), null);
  // #4690 direction, restated for an ORDERING rather than a threshold: a
  // timestamp that cannot be read must not quietly drop out of a claim about
  // which card is oldest.
  t('H15: unreadable created_at sorts as maximally old', h15OldestUnclaimedBlocking([blockingCard(10, { created: daysAgo(9) }), blockingCard(20, { created: 'not-a-date' })], NOW).issue.number, 20);
  t('H15: …and the row says so rather than printing a number', h15OldestUnclaimedBlocking([blockingCard(20, { created: 'not-a-date' })], NOW).message.includes('unreadable `created_at`'), true);
  // Built without the fixture helper on purpose: its `created = daysAgo(3)`
  // default fills an `undefined`, so passing one through it tests the default
  // rather than the absent field (measured — this case was green against a
  // 3-day-old card before the fixture was written out longhand).
  t('H15: absent created_at is unreadable too', h15OldestUnclaimedBlocking([{ ...issue(['pm:blocking']), number: 20 }], NOW).message.includes('unreadable `created_at`'), true);
  // Stable output run to run: equal ages break by issue number, so the anchor
  // body does not churn between two equally-old cards.
  t('H15: equal ages break by issue number', h15OldestUnclaimedBlocking([blockingCard(30, { created: daysAgo(4) }), blockingCard(12, { created: daysAgo(4) })], NOW).issue.number, 12);

  // Reverse verification against the LIVE board, 2026-08-19. Predicted before
  // running: NULL — the board's only `pm:blocking` card (#7276) is assigned to
  // `os-project-manager`, which is the card's own "all-assigned -> no row"
  // shape, measured rather than invented. Then the same card with the assignee
  // removed, to prove the null is the board's state and not a dead predicate.
  const live7276 = (assignees) => ({
    ...issue(['pm:queue', 'domain:devx', 'pm:blocking'], assignees),
    number: 7276,
    created_at: '2026-08-10T04:30:43Z',
  });
  t('H15 reverse-verify: the live board (only blocking card assigned) -> no row', h15OldestUnclaimedBlocking([live7276(['os-project-manager'])], Date.parse('2026-08-19T09:00:00Z')), null);
  t('H15 reverse-verify: …the same card unassigned DOES produce the row', h15OldestUnclaimedBlocking([live7276([])], Date.parse('2026-08-19T09:00:00Z')).issue.number, 7276);
  t('H15 reverse-verify: …and its measured age', h15OldestUnclaimedBlocking([live7276([])], Date.parse('2026-08-19T09:00:00Z')).message.includes('open ~220h'), true);

  // -- H19: a block that outlived its blocker (2026-08-20) -------------------
  // The two measured instances are the fixtures, and they are DIFFERENT
  // shapes on purpose: one states its blocker in a COMMENT and the other in a
  // backtick-decorated BODY line. A body-only reader would have caught one of
  // the two, which is why the target list unions both channels.
  const keyOf = (ref) => blockerTargetKey(ref, 'objectstack-ai/objectstack').key;

  // The canonical key — three spellings, one issue, therefore one request.
  t('H19 key: a bare local ref qualifies against the swept repo', keyOf({ repo: null, number: 10126 }), 'objectstack-ai/objectstack#10126');
  t('H19 key: …as does the bare repo name', keyOf({ repo: 'objectstack', number: 10126 }), 'objectstack-ai/objectstack#10126');
  t('H19 key: …and the fully qualified form', keyOf({ repo: 'objectstack-ai/objectstack', number: 10126 }), 'objectstack-ai/objectstack#10126');
  t('H19 key: a local ref is marked local', blockerTargetKey({ repo: null, number: 1 }, 'objectstack-ai/objectstack').local, true);
  // An unqualified SIBLING repo takes the swept repo's owner. The guess can
  // only ever produce an unresolved target, never a false finding.
  t('H19 key: an unqualified sibling repo takes the swept owner', keyOf({ repo: 'objectui', number: 4356 }), 'objectstack-ai/objectui#4356');
  t('H19 key: …and is NOT local', blockerTargetKey({ repo: 'objectui', number: 4356 }, 'objectstack-ai/objectstack').local, false);
  t('H19 key: a foreign owner is preserved verbatim', keyOf({ repo: 'vercel/next.js', number: 7 }), 'vercel/next.js#7');

  // The target list — both channels, deduped, self-references dropped.
  const blockedCard = (number, body = '', labels = ['pm:blocked']) => ({ ...issue(labels, [], body), number });
  const keysOf = (issueObj, comments) =>
    blockerTargetsFor(issueObj, comments, 'objectstack-ai/objectstack').map((t2) => t2.key).join(' ');
  t('H19 targets: the body channel', keysOf(blockedCard(1, 'Blocked-by: #9612')), 'objectstack-ai/objectstack#9612');
  t('H19 targets: the comment channel', keysOf(blockedCard(1, 'no line here'), ['Blocked-by: #10126']), 'objectstack-ai/objectstack#10126');
  t('H19 targets: both channels are UNIONED, never prioritised', keysOf(blockedCard(1, 'Blocked-by: #9612'), ['Blocked-by: #10126']), 'objectstack-ai/objectstack#9612 objectstack-ai/objectstack#10126');
  t('H19 targets: one target stated in both channels is resolved once', keysOf(blockedCard(1, 'Blocked-by: #9612'), ['Blocked-by: #9612']), 'objectstack-ai/objectstack#9612');
  t('H19 targets: a self-reference is dropped', keysOf(blockedCard(500, 'Blocked-by: #500')), '');
  t('H19 targets: …but a same-numbered CROSS-REPO ref is not a self-reference', keysOf(blockedCard(4356, 'Blocked-by: objectui#4356')), 'objectstack-ai/objectui#4356');
  t('H19 targets: an unreadable comment thread contributes nothing', keysOf(blockedCard(1, 'no line'), null), '');
  t('H19 targets: an unconsulted comment thread contributes nothing', keysOf(blockedCard(1, 'no line'), undefined), '');
  t('H19 targets: a card with no line anywhere has no targets (H4\'s row, not this one)', keysOf(blockedCard(1, 'waiting on upstream'), ['triage note']), '');
  // The multi-ref line the index's own parser already handles, seen from here.
  t('H19 targets: a two-ref line yields two targets, in order', keysOf(blockedCard(1, 'Blocked-by: #10126, #9612')), 'objectstack-ai/objectstack#10126 objectstack-ai/objectstack#9612');

  // The gathering gate.
  t('H19 gate: an open pm:blocked card is in scope', needsBlockerLiveness(blockedCard(1, 'Blocked-by: #2')), true);
  t('H19 gate: a Blocked-by line WITHOUT the label is out of scope', needsBlockerLiveness(blockedCard(1, 'Blocked-by: #2', ['pm:queue'])), false);
  t('H19 gate: a pm:blocking card is out of scope (that is H14\'s population)', needsBlockerLiveness(blockedCard(1, '', ['pm:blocking'])), false);
  t('H19 gate: a missing issue does not crash', needsBlockerLiveness(undefined), false);

  // The predicate. Resolutions are what the sweep resolved, so the offline
  // fixtures are the three target states and their combinations.
  const target = (number, state, extra = {}) => ({
    key: `objectstack-ai/objectstack#${number}`,
    repo: 'objectstack-ai/objectstack',
    number,
    local: true,
    state,
    closedAt: null,
    detail: null,
    ...extra,
  });
  const foreign = (repo, number, state, extra = {}) => ({
    key: `${repo}#${number}`,
    repo,
    number,
    local: false,
    state,
    closedAt: null,
    detail: null,
    ...extra,
  });

  // POSITIVE — a closed target fires.
  const expired10112 = h19BlockOutlivedBlocker(blockedCard(10112), [target(10126, 'closed', { closedAt: '2026-08-20T09:03:37Z' })]);
  const expired10112Row = String(expired10112 ?? '');
  t('H19: a CLOSED target fires', typeof expired10112, 'string');
  t('H19: …and names the target', expired10112Row.includes('`#10126`'), true);
  t('H19: …with the close timestamp, so the latency is readable off the row', expired10112Row.includes('closed 2026-08-20T09:03:37Z'), true);
  t('H19: …and says the block outlived its blocker', expired10112Row.includes('outlived its blocker'), true);
  t('H19: …and says nothing else here asks this question', expired10112Row.includes('H4 asks whether the line EXISTS'), true);
  t('H19: …and hands the release to the unlock sweep\'s double-checks', expired10112Row.includes('放行双查'), true);
  t('H19: …naming double-check ① (most recent conversion comment)', expired10112Row.includes('MOST RECENT conversion comment'), true);
  t('H19: …and double-check ② (a newer merged PR refuses release)', expired10112Row.includes('MERGED PR newer than that conversion comment'), true);
  t('H19: …and forbids a label written from this script', expired10112Row.includes('never a label written from this script'), true);
  t('H19: a fully discharged block says every target is closed', expired10112Row.includes('Every target it names is closed'), true);
  t('H19: …and does not claim a partial discharge', expired10112Row.includes('PARTIAL'), false);

  // NEGATIVE — an open target is clean, and silence here is a real reading.
  t('H19: an OPEN target -> clean', h19BlockOutlivedBlocker(blockedCard(1), [target(2, 'open')]), null);
  t('H19: every target open -> clean', h19BlockOutlivedBlocker(blockedCard(1), [target(2, 'open'), foreign('objectstack-ai/objectui', 4356, 'open')]), null);
  t('H19: no targets at all -> no row (H4 owns the missing line)', h19BlockOutlivedBlocker(blockedCard(1), []), null);
  t('H19: absent resolutions -> no row', h19BlockOutlivedBlocker(blockedCard(1), undefined), null);
  t('H19: the label gate outranks a closed target', h19BlockOutlivedBlocker(blockedCard(1, '', ['pm:queue']), [target(2, 'closed')]), null);

  // PARTIAL — one of two closed. Fires, and says it is partial.
  const partial = h19BlockOutlivedBlocker(blockedCard(1), [target(2, 'closed', { closedAt: '2026-08-20T07:58:08Z' }), target(3, 'open')]);
  const partialRow = String(partial ?? '');
  t('H19: one closed of two still fires', typeof partial, 'string');
  t('H19: …and reports the count as 1 of 2', partialRow.includes('1 of 2 `Blocked-by:` target(s)'), true);
  t('H19: …names it a PARTIAL discharge', partialRow.includes('PARTIAL'), true);
  t('H19: …names the target that is still open', partialRow.includes('`#3`'), true);
  t('H19: …and does not decide the card is unblocked', partialRow.includes('it does not decide it'), true);
  t('H19: two closed of two reads as 2 of 2', h19row(blockedCard(1), [target(2, 'closed'), target(3, 'closed')]).includes('2 of 2'), true);

  // UNRESOLVED — never reads as clean, and never reads as closed either.
  const unresolvedOnly = h19BlockOutlivedBlocker(blockedCard(1), [foreign('objectstack-ai/cloud', 88, 'unresolved', { detail: 'HTTP 404' })]);
  const unresolvedOnlyRow = String(unresolvedOnly ?? '');
  t('H19: an UNRESOLVED target fires rather than reading clean', typeof unresolvedOnly, 'string');
  t('H19: …saying the liveness is UNJUDGED', unresolvedOnlyRow.includes('UNJUDGED, not confirmed'), true);
  t('H19: …and never claims the block is expired', unresolvedOnlyRow.includes('outlived its blocker. Nothing else here'), false);
  t('H19: …citing the unreadable-is-not-absent rule', unresolvedOnlyRow.includes('#4690'), true);
  t('H19: …naming the cross-repo target in full owner/repo#N form', unresolvedOnlyRow.includes('`objectstack-ai/cloud#88`'), true);
  t('H19: …with the observed status', unresolvedOnlyRow.includes('HTTP 404'), true);
  t('H19: …and still routes the release through the unlock sweep', unresolvedOnlyRow.includes('放行双查'), true);
  // UNJUDGED must not read at judged-row weight (#11218 half 2). The premise
  // re-verification asked for exactly this check against the live report.
  t('H19: …and says UNJUDGED is not a quiet row', unresolvedOnlyRow.includes('must not be skimmed'), true);
  t('H19: …and equates it with having read nothing at all', unresolvedOnlyRow.includes('exactly as unverified as if nothing had been read'), true);
  // With NO repo probe taken, the wording stays undiagnosed — the pre-#11218
  // posture, preserved rather than silently upgraded.
  t('H19: an unprobed cross-repo target claims no cause', unresolvedOnlyRow.includes('resolves only when its repo answers'), true);
  t('H19: …and asserts nothing about the repo either way', unresolvedOnlyRow.includes('is NOT readable') || unresolvedOnlyRow.includes('IS readable'), false);

  // -- The MEASURED cause (#11218 half 1, the half that can land) ------------
  //
  // A cross-repo 404 is ambiguous; `GET /repos/<owner>/<name>` disambiguates
  // it. The row reports the measurement, never an inference from the issue 404.
  const scopeGap = String(h19BlockOutlivedBlocker(blockedCard(10938), [
    foreign('objectstack-ai/cloud', 944, 'unresolved', { detail: 'HTTP 404', repoReadable: false }),
  ]) ?? '');
  t('H19 cause: an unreadable REPO is named per target', scopeGap.includes("`objectstack-ai/cloud` is NOT readable to this sweep's credential"), true);
  t('H19 cause: …and the observed status is still carried', scopeGap.includes('HTTP 404'), true);
  t('H19 cause: …and it is declared measured, not inferred', scopeGap.includes('measured directly'), true);
  t('H19 cause: …and named a standing ACCEPTED limit, not a defect to chase', scopeGap.includes('standing, ACCEPTED'), true);
  t('H19 cause: …so no re-run is prescribed', scopeGap.includes('no re-run and no re-read of this card will ever resolve'), true);
  t('H19 cause: …and the credential call is routed to routing/security', scopeGap.includes('routing/security'), true);
  t('H19 cause: …and ⛔ the card is not the place to fix it', scopeGap.includes('Do not "fix" it on the card'), true);
  // The OTHER leg of the same probe: repo readable, so the number is not there.
  const missingNumber = String(h19BlockOutlivedBlocker(blockedCard(1), [
    foreign('objectstack-ai/objectui', 999999, 'unresolved', { detail: 'HTTP 404', repoReadable: true }),
  ]) ?? '');
  t('H19 cause: a READABLE repo means the number is not there', missingNumber.includes('IS readable, so that number is not there'), true);
  t('H19 cause: …and that is NOT reported as a scope gap', missingNumber.includes('is NOT readable'), false);
  t('H19 cause: …nor as an accepted cross-repo limit', missingNumber.includes('standing, ACCEPTED'), false);
  // A failed probe (`null`) picks NEITHER side — #4690 at the probe's own level.
  const probeFailed = String(h19BlockOutlivedBlocker(blockedCard(1), [
    foreign('objectstack-ai/cloud', 88, 'unresolved', { detail: 'HTTP 500', repoReadable: null }),
  ]) ?? '');
  t('H19 cause: an unreadable PROBE names no cause at all', probeFailed.includes('IS readable') || probeFailed.includes('is NOT readable'), false);
  t('H19 cause: …but the target and status are still named', probeFailed.includes('`objectstack-ai/cloud#88`') && probeFailed.includes('HTTP 500'), true);
  // Mixed: only the scope-gapped ones are counted in the loud clause.
  const mixedCause = String(h19BlockOutlivedBlocker(blockedCard(1), [
    foreign('objectstack-ai/cloud', 944, 'unresolved', { detail: 'HTTP 404', repoReadable: false }),
    foreign('objectstack-ai/objectui', 4356, 'unresolved', { detail: 'HTTP 404', repoReadable: true }),
  ]) ?? '');
  t('H19 cause: the scope-gap count is the unreadable-repo ones only', mixedCause.includes('1 of them are unjudgeable'), true);
  // A LOCAL target is never probed, and renders exactly as it always did.
  const localUnresolved = String(h19BlockOutlivedBlocker(blockedCard(1), [target(77, 'unresolved', { detail: 'HTTP 404' })]) ?? '');
  t('H19 cause: a LOCAL unresolved target claims no repo reading', localUnresolved.includes('readable'), false);
  t('H19 cause: …and is still named with its status', localUnresolved.includes('`#77` (HTTP 404)'), true);
  // An unresolved target alongside an open one still fires, and says which.
  const mixedUnresolved = h19BlockOutlivedBlocker(blockedCard(1), [target(2, 'open'), foreign('objectstack-ai/objectui', 4356, 'unresolved', { detail: 'HTTP 403' })]);
  const mixedUnresolvedRow = String(mixedUnresolved ?? '');
  t('H19: unresolved + open still fires', typeof mixedUnresolved, 'string');
  t('H19: …and reports the resolved remainder as open', mixedUnresolvedRow.includes("The card's other 1 target(s) did resolve, and are still open."), true);
  // Closed AND unresolved: the closed row leads, the gap is appended.
  const closedAndUnresolved = String(h19BlockOutlivedBlocker(blockedCard(1), [target(2, 'closed'), foreign('objectstack-ai/cloud', 88, 'unresolved', { detail: 'HTTP 404' })]) ?? '');
  t('H19: a closed target leads even when another is unresolved', closedAndUnresolved.includes('outlived its blocker'), true);
  t('H19: …and the unresolved one is still declared unjudged', closedAndUnresolved.includes('unjudged, not open'), true);

  // The render budget: many targets are capped and the row says it counted.
  const manyClosed = String(h19BlockOutlivedBlocker(blockedCard(1), [2, 3, 4, 5, 6, 7, 8].map((n) => target(n, 'closed'))) ?? '');
  t('H19: the target list is capped at the render budget', manyClosed.includes(`+${7 - H19_TARGET_LIST_CAP} more`), true);
  t('H19: …and the count is the full one, not the shown one', manyClosed.includes('7 of 7'), true);

  // Report-only, ordinary row in both media — never loud, like H14–H16/H18.
  t('H19: not a loud finding', isLoudFinding(expired10112), false);

  // -- H19: the two MEASURED instances, byte-for-byte ------------------------
  // Instance ①: the comment-channel card. Its `Blocked-by:` line lives in a
  // triage first-touch comment; the target closed at 09:03:37Z and the card
  // sat blocked ~4.5h after that. This is the fixture that makes the comment
  // channel load-bearing rather than a nicety.
  const liveTriageComment =
    'Triage first-touch: graded **Bug · `domain:cli` · `pm:blocked`**.\n\nBlocked-by: #10126\n\nRationale: ' +
    '#10126 (in flight, `priority:p0`, queue-incident layer ①) is building the gate that flags exactly ' +
    "this site's class — a test resolving a sibling package's dist";
  t('H19 measured ①: the live triage comment yields the target', keysOf(blockedCard(10112, 'body carries no line'), [liveTriageComment]), 'objectstack-ai/objectstack#10126');
  t('H19 measured ①: …a body-only read would have found nothing', keysOf(blockedCard(10112, 'body carries no line')), '');
  t(
    'H19 measured ①: …and the card fires once its target is resolved closed',
    h19row(blockedCard(10112, 'body carries no line'), [target(10126, 'closed', { closedAt: '2026-08-20T09:03:37Z' })]).includes('`#10126` (closed 2026-08-20T09:03:37Z)'),
    true,
  );

  // Instance ②: the body-channel card, whose line is backtick-DECORATED —
  // the shape that was invisible to the reader before the shared decorated-
  // directive reader landed. Byte-for-byte from the live body.
  const liveDecoratedBody =
    'Filed unassigned from #9612 (PR #10058), which implements package-closure narrowing at the runtime ' +
    'publish gate. Recording the half that card\'s fence could not reach.\n\n`Blocked-by: #9612`\n\n' +
    '## What is true after #9612';
  t('H19 measured ②: the decorated body line yields the target', keysOf(blockedCard(10063, liveDecoratedBody)), 'objectstack-ai/objectstack#9612');
  t(
    'H19 measured ②: …and the card fires once its target is resolved closed',
    h19row(blockedCard(10063, liveDecoratedBody), [target(9612, 'closed', { closedAt: '2026-08-20T07:58:08Z' })]).includes('closed 2026-08-20T07:58:08Z'),
    true,
  );
  // The prose around the line names #9612 four more times; only the DIRECTIVE
  // line is a target. Reading the prose would manufacture duplicates and, on
  // other cards, blockers that were only ever context.
  t('H19 measured ②: prose mentions of the same number are not extra targets', blockerTargetsFor(blockedCard(10063, liveDecoratedBody), undefined, 'objectstack-ai/objectstack').length, 1);

  // The summary line's fourth `read X of Y` pair. Unlike the other three a
  // shortfall here suspends nothing — the unresolved targets fire their own
  // rows — so the clause says where to look rather than announcing a silence.
  const btCounts = (blockerResolved, blockerTargets) => ({
    repo: 'objectstack-ai/objectstack', issues: 1, unscoped: 1, prs: 0, merged: 0,
    blockerResolved, blockerTargets,
  });
  t('summary: the H19 coverage pair is reported', summaryLine(btCounts(11, 12), 1).includes('targets resolved on 11 of 12 distinct `Blocked-by:` target(s)'), true);
  t('summary: …and says the unit is DISTINCT targets, not per-card edges', summaryLine(btCounts(11, 12), 1).includes('distinct'), true);
  t('summary: …scoped to the population H19 judges', summaryLine(btCounts(11, 12), 1).includes('named by open `pm:blocked` card(s)'), true);
  // The shortfall clause still points at the rows that carry the gap — but it
  // no longer PROMISES they survive, it says what makes them survive (the
  // unjudged sort band). The bare "never dropped" wording was measurably false
  // on 2026-08-25T02:08Z; see `UNJUDGED_MARKER`.
  t('summary: an H19 shortfall points at the rows that carry it', summaryLine(btCounts(11, 12), 1).includes("unresolved target(s) are named on their own cards' rows"), true);
  t('summary: …and names the mechanism instead of promising the outcome', summaryLine(btCounts(11, 12), 1).includes('sort ABOVE the size trim'), true);
  t('summary: a complete H19 pass adds no shortfall clause', summaryLine(btCounts(12, 12), 1).includes('unresolved target(s) are named'), false);
  t('summary: absent H19 counts degrade to 0, never to undefined', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0 }, 0).includes('resolved on 0 of 0 distinct'), true);
  t('summary: …and the H19 clause never prints the string undefined', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0 }, 0).includes('undefined'), false);
  t('summary: the report-only contract still ends the sentence', summaryLine(btCounts(12, 12), 1).endsWith('not a gate verdict.'), true);

  // -- H20: a `pm:dispatched` card nobody is working (#10312) ----------------
  //
  // The specimen is #8878, 2026-08-20: a well-formed claim comment at ~14:05Z,
  // the dispatch call never made, 74 minutes `pm:dispatched` with nobody on it.
  // `NOW_20` is set 74 minutes past that claim so the measured age is the one
  // the incident actually had, rather than a round number chosen to pass.
  const NOW_20 = Date.parse('2026-08-20T15:19:00Z');
  const minsAgo20 = (m) => new Date(NOW_20 - m * 60_000).toISOString();
  const dispatchedCard = (labels = ['pm:dispatched'], assignees = ['os-help']) => issue(labels, assignees);
  const claimRow = (createdAt, body) => ({ created_at: createdAt, body });
  // The claim template as SKILL.md step 4 tells every seat to write it, and as
  // the measured card carried it — a `Claim:` marker line, a session, and a
  // BACKTICK-DECORATED `Branch:` directive.
  const claimBody8878 = [
    'Claim: `domain:cli` execution seat.',
    'Session: `session_019bmVFqoQPq63zhKrxdYG1r`',
    'Branch: `claude/issue-8878-dispatch-latency`',
    'Worktree: dedicated per-task worktree off main (os-dev standard)',
  ].join('\n');
  const claim8878 = [claimRow(minsAgo20(74), claimBody8878)];

  // The extractor. Decoration is the NORMAL shape, not the exception (#10102).
  t('H20 branch: the decorated `Branch:` directive yields the branch', claimedBranches(claimBody8878).join(','), 'claude/issue-8878-dispatch-latency');
  t('H20 branch: an UNdecorated directive yields the same', claimedBranches('Branch: claude/issue-8878-x').join(','), 'claude/issue-8878-x');
  t('H20 branch: the blockquoted claim template (SKILL.md step 4) is read', claimedBranches('> Branch: `claude/issue-6752-x`').join(','), 'claude/issue-6752-x');
  t('H20 branch: a slug with dots and underscores survives', claimedBranches('Branch: claude/issue-1-a.b_c-d').join(','), 'claude/issue-1-a.b_c-d');
  t('H20 branch: two directives yield two branches, in order', claimedBranches('Branch: `claude/issue-1-a`\nBranch: `claude/issue-2-b`').join(','), 'claude/issue-1-a,claude/issue-2-b');
  t('H20 branch: the same branch named twice is de-duplicated', claimedBranches('Branch: claude/issue-1-a\nBranches: claude/issue-1-a').length, 1);
  // The two under-reporting boundaries, both deliberate: a branch-shaped token
  // in PROSE is not a claim's branch field, and a non-protocol spelling leaves
  // this row nothing it can recognise. Both put the card out of scope rather
  // than into a fabricated probe.
  t('H20 branch: a branch-shaped token in prose is NOT the claim field', claimedBranches('rebased onto claude/issue-9-other yesterday').length, 0);
  t('H20 branch: a non-protocol branch name is out of scope, not a probe', claimedBranches('Branch: `main`').length, 0);
  t('H20 branch: no directive at all yields nothing', claimedBranches('Claim: seat.\nSession: `session_x`').length, 0);
  t('H20 branch: a missing body does not crash', claimedBranches(undefined).length, 0);

  // The governing claim — the MOST RECENT one, H19's double-check ① reasoning.
  const gov = (rows) => governingClaim(rows);
  t('H20 claim: a claim comment naming a branch is found', gov(claim8878).branches.join(','), 'claude/issue-8878-dispatch-latency');
  t('H20 claim: …and carries its timestamp', gov(claim8878).createdAt, minsAgo20(74));
  t('H20 claim: a `Branch:` line in a comment that is NOT a claim is ignored', gov([claimRow(minsAgo20(90), 'Branch: `claude/issue-1-a`')]), null);
  t('H20 claim: a claim comment naming NO branch yields nothing to check', gov([claimRow(minsAgo20(90), 'Claim: seat.\nSession: `session_x`')]), null);
  const reclaimed = [
    claimRow(minsAgo20(600), 'Claim: first seat.\nBranch: `claude/issue-8878-abandoned`'),
    claimRow(minsAgo20(74), claimBody8878),
  ];
  t('H20 claim: a RE-claimed card is judged on the most recent claim', gov(reclaimed).branches.join(','), 'claude/issue-8878-dispatch-latency');
  t('H20 claim: …and on that claim\'s timestamp, not the spent one', gov(reclaimed).createdAt, minsAgo20(74));
  t('H20 claim: recency is read from the timestamp, not thread order', gov([...reclaimed].reverse()).branches.join(','), 'claude/issue-8878-dispatch-latency');
  t('H20 claim: an unreadable timestamp still qualifies the comment', gov([claimRow('not-a-date', claimBody8878)]).branches.length, 1);
  t('H20 claim: …and reports no age rather than a fresh one (#4690)', claimAgeMinutes(gov([claimRow('not-a-date', claimBody8878)]), NOW_20), null);
  t('H20 claim: an empty thread yields nothing', gov([]), null);
  t('H20 claim: a non-array input does not crash', gov(undefined), null);
  t('H20 claim: the measured age is read back as ~74 minutes', Math.round(claimAgeMinutes(gov(claim8878), NOW_20)), 74);

  // The gathering policy — what buys a ref read at all.
  t('H20 gate: a dispatched card with an aged claim is a candidate', h20NeedsRefProbe(dispatchedCard(), gov(claim8878), NOW_20), true);
  t('H20 gate: an UNASSIGNED dispatched card is still a candidate', h20NeedsRefProbe(dispatchedCard(['pm:dispatched'], []), gov(claim8878), NOW_20), true);
  t('H20 gate: a young claim buys no request', h20NeedsRefProbe(dispatchedCard(), gov([claimRow(minsAgo20(10), claimBody8878)]), NOW_20), false);
  t('H20 gate: a card without `pm:dispatched` is out of scope', h20NeedsRefProbe(dispatchedCard(['pm:queue']), gov(claim8878), NOW_20), false);
  t('H20 gate: no claim -> nothing to probe (that shape is H2\'s row)', h20NeedsRefProbe(dispatchedCard(), null, NOW_20), false);
  t('H20 gate: an unreadable claim timestamp is probed, never assumed fresh', h20NeedsRefProbe(dispatchedCard(), gov([claimRow('not-a-date', claimBody8878)]), NOW_20), true);
  t('H20 gate: a missing issue does not crash', h20NeedsRefProbe(undefined, gov(claim8878), NOW_20), false);

  // ★ The measured #8878 shape: a complete claim, and no ref anywhere.
  const refState = (branch, state, detail = null) => ({ branch, state, detail });
  const absentRef = [refState('claude/issue-8878-dispatch-latency', 'absent')];
  const fired20 = h20DispatchedNoBranchRef(dispatchedCard(), gov(claim8878), absentRef, NOW_20);
  const fired20Row = String(fired20 ?? '');
  t('H20: the measured #8878 shape FIRES', typeof fired20, 'string');
  t('H20: …and names the branch that has no ref', fired20Row.includes('`claude/issue-8878-dispatch-latency`'), true);
  t('H20: …and says NO SUCH REMOTE REF EXISTS', fired20Row.includes('NO SUCH REMOTE REF EXISTS'), true);
  t('H20: …with the measured age and the threshold', fired20Row.includes(`~74 min after the claim was posted (threshold ${DISPATCHED_NO_REF_STALE_MINUTES} min)`), true);
  t('H20: …and states the two-acts mechanism', fired20Row.includes('Claiming and dispatching are two acts with a gap between them'), true);
  t('H20: …and that it is invisible from the card itself', fired20Row.includes('invisible from the card'), true);
  t('H20: …and warns the symptom is identical to a DEAD agent', fired20Row.includes('IDENTICAL to a dev agent that died'), true);
  t('H20: …naming the opposite remedies rather than diagnosing one', fired20Row.includes('a dead agent needs a probe, an undispatched claim needs a dispatch'), true);
  t('H20: …and carries the ⛔ keying rule verbatim', fired20Row.includes('keys on NO REF AT ALL, never on "no PR yet"'), true);
  t('H20: …with the reason a PR key would be wrong', fired20Row.includes('legitimately has a ref and no PR for over an hour'), true);
  t('H20: …and routes an already-merged delivery to H8 instead', fired20Row.includes("the missing paired write is H8's"), true);
  t('H20: …and forbids a label written from this script', fired20Row.includes('never a label written from this script'), true);
  t('H20: not a loud finding', isLoudFinding(fired20), false);

  // ★ The regression pin the filing card asked for by name: a dev inside a long
  // build has a ref and NO PR, for longer than the threshold, and must be
  // silent. The guarantee is structural — the predicate is handed a ref state
  // and nothing else, so there is no PR input it could key on. The arity pin
  // is what fails if a later hand adds one.
  t(
    'H20: ref EXISTS and no PR anywhere, 10 hours in -> clean (⛔ never key on "no PR yet")',
    h20DispatchedNoBranchRef(dispatchedCard(), gov([claimRow(minsAgo20(600), claimBody8878)]), [refState('claude/issue-8878-dispatch-latency', 'exists')], NOW_20),
    null,
  );
  t('H20: …and the predicate takes NO pull-request input at all', h20DispatchedNoBranchRef.length, 3);

  // ★ A young claim is not stuck. The dev may be seconds from its first push.
  t(
    'H20: a young claim with no ref yet -> clean',
    h20DispatchedNoBranchRef(dispatchedCard(), gov([claimRow(minsAgo20(10), claimBody8878)]), absentRef, NOW_20),
    null,
  );
  t(
    'H20: exactly at the threshold -> still clean',
    h20DispatchedNoBranchRef(dispatchedCard(), gov([claimRow(minsAgo20(DISPATCHED_NO_REF_STALE_MINUTES), claimBody8878)]), absentRef, NOW_20),
    null,
  );
  t(
    'H20: one minute past the threshold -> fires',
    typeof h20DispatchedNoBranchRef(dispatchedCard(), gov([claimRow(minsAgo20(DISPATCHED_NO_REF_STALE_MINUTES + 1), claimBody8878)]), absentRef, NOW_20),
    'string',
  );

  // ★ Three ref states, never two (#4690). An unreadable probe gets the QUIETER
  // row: it must not read as healthy, and it must not claim the finding it did
  // not measure.
  const unread20 = h20DispatchedNoBranchRef(
    dispatchedCard(),
    gov(claim8878),
    [refState('claude/issue-8878-dispatch-latency', 'unreadable', 'HTTP 500')],
    NOW_20,
  );
  const unread20Row = String(unread20 ?? '');
  t('H20 unreadable: does NOT read as healthy', unread20 === null, false);
  t('H20 unreadable: fires its own row', typeof unread20, 'string');
  t('H20 unreadable: …which says the dispatch is UNJUDGED', unread20Row.includes('UNJUDGED, not confirmed'), true);
  t('H20 unreadable: …and reports the observed status', unread20Row.includes('HTTP 500'), true);
  t('H20 unreadable: …and does NOT assert the finding it did not measure', unread20Row.includes('NO SUCH REMOTE REF EXISTS'), false);
  t('H20 unreadable: …citing the unread-is-not-absent rule', unread20Row.includes('#4690'), true);
  t('H20 unreadable: …and refuses to guess WHY', unread20Row.includes('the cause is not guessed at'), true);
  t('H20 unreadable: not a loud finding either', isLoudFinding(unread20), false);

  // Mixed readings. "No ref at all" is a claim about EVERY branch the card
  // names, so one unread probe is enough to withhold it — and one existing ref
  // is enough to call the card healthy.
  const mixedUnread20 = String(h20DispatchedNoBranchRef(
    dispatchedCard(),
    gov([claimRow(minsAgo20(74), 'Claim: seat.\nBranch: `claude/issue-1-a`\nBranch: `claude/issue-1-b`')]),
    [refState('claude/issue-1-a', 'absent'), refState('claude/issue-1-b', 'unreadable', 'HTTP 502')],
    NOW_20,
  ) ?? '');
  t('H20 mixed: absent + unreadable takes the quieter row', mixedUnread20.includes('UNJUDGED, not confirmed'), true);
  t('H20 mixed: …and still names the branch that resolved absent', mixedUnread20.includes('`claude/issue-1-a`'), true);
  t('H20 mixed: …explaining why one unread probe withholds the finding', mixedUnread20.includes('one unread probe is enough to withhold it'), true);
  t(
    'H20 mixed: one branch that DOES exist reads the card as worked',
    h20DispatchedNoBranchRef(
      dispatchedCard(),
      gov([claimRow(minsAgo20(74), 'Claim: seat.\nBranch: `claude/issue-1-a`\nBranch: `claude/issue-1-b`')]),
      [refState('claude/issue-1-a', 'absent'), refState('claude/issue-1-b', 'exists')],
      NOW_20,
    ),
    null,
  );

  // The remaining gates and the caller contract.
  t('H20: the label gate outranks a missing ref', h20DispatchedNoBranchRef(dispatchedCard(['pm:queue']), gov(claim8878), absentRef, NOW_20), null);
  t('H20: no claim -> no row (a missing claim is H2\'s row, not this one)', h20DispatchedNoBranchRef(dispatchedCard(), null, absentRef, NOW_20), null);
  t('H20: an unprobed card yields no row (caller contract, as H19)', h20DispatchedNoBranchRef(dispatchedCard(), gov(claim8878), [], NOW_20), null);
  t('H20: absent ref states -> no row', h20DispatchedNoBranchRef(dispatchedCard(), gov(claim8878), undefined, NOW_20), null);
  t('H20: a missing issue does not crash', h20DispatchedNoBranchRef(undefined, gov(claim8878), absentRef, NOW_20), null);
  const unstamped20 = h20DispatchedNoBranchRef(dispatchedCard(), gov([claimRow('not-a-date', claimBody8878)]), absentRef, NOW_20);
  const unstamped20Row = String(unstamped20 ?? '');
  t('H20: an unreadable claim timestamp fires rather than reading fresh', typeof unstamped20, 'string');
  t('H20: …and says so in place of an age', unstamped20Row.includes('an unreadable claim timestamp (which must not read as fresh)'), true);
  const many20 = Array.from({ length: 7 }, (_, i) => refState(`claude/issue-1-b${i}`, 'absent'));
  const capped20 = String(h20DispatchedNoBranchRef(
    dispatchedCard(),
    gov([claimRow(minsAgo20(74), `Claim: seat.\n${many20.map((r) => `Branch: \`${r.branch}\``).join('\n')}`)]),
    many20,
    NOW_20,
  ) ?? '');
  t('H20: the branch list is capped at the render budget', capped20.includes(`+${7 - H20_BRANCH_LIST_CAP} more`), true);

  // The summary line's fifth `read X of Y` pair — H19's shape, and owed for the
  // same reason: a pass that read no ref at all must not read like a board on
  // which every dispatch is live.
  const refCounts = (dispatchRefRead, dispatchRefTargets) => ({
    repo: 'objectstack-ai/objectstack', issues: 1, unscoped: 1, prs: 0, merged: 0,
    dispatchRefRead, dispatchRefTargets,
  });
  t('summary: the H20 coverage pair is reported', summaryLine(refCounts(4, 5), 1).includes('remote branch read on 4 of 5 distinct claimed branch(es)'), true);
  t('summary: …scoped to the population H20 judges', summaryLine(refCounts(4, 5), 1).includes('named by open `pm:dispatched` card(s)'), true);
  t('summary: …and names the threshold that bounded it', summaryLine(refCounts(4, 5), 1).includes(`past the ${DISPATCHED_NO_REF_STALE_MINUTES}-minute threshold`), true);
  t('summary: an H20 shortfall points at the rows that carry it', summaryLine(refCounts(4, 5), 1).includes('each unread branch is named on its own card\'s row, never dropped'), true);
  t('summary: a complete H20 pass adds no shortfall clause', summaryLine(refCounts(5, 5), 1).includes('each unread branch'), false);
  t('summary: absent H20 counts degrade to 0, never to undefined', summaryLine({ repo: 'r', issues: 1, unscoped: 1, prs: 0, merged: 0 }, 0).includes('remote branch read on 0 of 0 distinct'), true);
  // The pair is H27's coverage number too, and a reader seeing a quiet H27
  // needs to know that — one read serves both rows.
  t('summary: the pair is declared as serving BOTH rows', summaryLine(refCounts(5, 5), 1).includes('Dispatch liveness (H20 + H27)'), true);
  t('summary: …naming H27\'s threshold', summaryLine(refCounts(5, 5), 1).includes(`H27's ${DEAD_CLAIM_STALE_HOURS}h population is a subset`), true);
  t('summary: …and that it costs no request of its own', summaryLine(refCounts(5, 5), 1).includes('costs no request of its own'), true);

  t('summary: the report-only contract still ends the sentence after H20', summaryLine(refCounts(5, 5), 1).endsWith('not a gate verdict.'), true);

  // -- H27: the claim is PERFECT and the claimant is dead (#11248) ------------
  //
  // The specimen is the 2026-08-23 capacity kill: three agents dispatched at
  // ~05:46Z, all three killed at ~05:50Z on one shared-account weekly limit.
  // `NOW_27` is set past the protocol's own 24h stale line so the age the row
  // reports is a real one rather than a round number chosen to pass.
  const CLAIM_27 = '2026-08-23T05:46:00Z';
  const NOW_27 = Date.parse('2026-08-24T08:00:00Z'); // ~26h after the claim
  const claim27Body = [
    'Claim: `domain:devx` execution seat.',
    'Session: `session_0124Qg8rLvpXnQDwCmpKUmaJ`',
    'Branch: `claude/issue-5442-metadata-form`',
  ].join('\n');
  const claim27 = (createdAt = CLAIM_27) => governingClaim([claimRow(createdAt, claim27Body)]);
  const BR_27 = 'claude/issue-5442-metadata-form';
  // A branch that exists and has NOT moved since the claim: its head is the
  // base commit it was cut from, which predates the claim. That is the shape
  // the os-dev empty-branch push probe leaves behind.
  const frozen = (headCommittedAt = '2026-08-23T05:10:00Z') => [
    { branch: BR_27, state: 'exists', detail: null, headCommittedAt },
  ];
  const noDelivery = { open: 0, merged: 0 };
  const dead27 = (over = {}) =>
    h27DeadClaimNoProgress(
      // `in` rather than `??` throughout: a test that passes an explicit
      // `undefined` must reach the predicate, not be replaced by the default it
      // is trying to displace (measured — the missing-issue case was green
      // against a healthy card before this was written out longhand).
      'issue' in over ? over.issue : dispatchedCard(),
      'claim' in over ? over.claim : claim27(),
      'refs' in over ? over.refs : frozen(),
      'delivery' in over ? over.delivery : noDelivery,
      NOW_27,
    );
  // Same reason as H8's `halvesRow`: `dead27` is three-valued, and the
  // `typeof dead27()` / `dead27(…) === null` cases below assert precisely the
  // nullability that stringifying `dead27` itself would erase.
  const dead27Row = (...args) => String(dead27(...args) ?? '');

  // ★ The finding itself, and the facts the sentence must carry.
  t('H27: a frozen branch + no PR past 24h -> finding', typeof dead27(), 'string');
  t('H27: …and names the branch', dead27Row().includes(`\`${BR_27}\``), true);
  t('H27: …and says the branch has not moved since the claim', dead27Row().includes('NOT MOVED SINCE IT WAS CLAIMED'), true);
  t('H27: …and reports the age against the protocol threshold', dead27Row().includes(`threshold ${DEAD_CLAIM_STALE_HOURS}h`), true);
  t('H27: …calling that threshold the protocol\'s own line, not a heuristic', dead27Row().includes("protocol's own stale-claim line"), true);
  t('H27: …and states the measured ~26h age', dead27Row().includes('~26h after the claim was posted'), true);
  t('H27: …and names the lane-block consequence, not just the silence', dead27Row().includes('mutual-exclusion read'), true);
  t('H27: …and explains WHY H20 cannot see it', dead27Row().includes('pushing the empty branch the first action'), true);
  t('H27: …and rules out the pre-window merged delivery first', dead27Row().includes(`${MERGED_WINDOW_PAGES} pages`), true);
  t('H27: not a loud finding', isLoudFinding(dead27()), false);

  // ★ Report-only, and specifically NOT a reclaim — the protocol protects a
  // claim whose branch carries commits, so this row must never read as
  // authority to drop an assignee.
  t('H27: the remedy is the recovery inspection', dead27Row().includes('post-kill recovery'), true);
  t('H27: …naming all three recovery states', dead27Row().includes('on the remote / on the container disk only / gone'), true);
  t('H27: …and the UNVERIFIED hand-off', dead27Row().includes('flagged UNVERIFIED'), true);
  t('H27: …quoting the protocol rule that forbids reclaiming this card', dead27Row().includes('有带提交活分支的认领永不回收'), true);
  t('H27: …and never a label written from this script', dead27Row().includes('Never a label written from this script'), true);

  // ★ Disjoint from H20 BY CONSTRUCTION, in both directions, on one fixture.
  const absent27 = [{ branch: BR_27, state: 'absent', detail: null, headCommittedAt: null }];
  t('H27: no ref at all is H20\'s row, not this one', dead27({ refs: absent27 }), null);
  t('H27: …and H20 does fire on it', typeof h20DispatchedNoBranchRef(dispatchedCard(), claim27(), absent27, NOW_27), 'string');
  t('H27: an existing ref is clean for H20', h20DispatchedNoBranchRef(dispatchedCard(), claim27(), frozen(), NOW_27), null);
  t('H27: …while H27 fires on exactly that card', typeof dead27(), 'string');
  t('H27: an UNREADABLE probe is H20\'s quieter row, not this one', dead27({ refs: [{ branch: BR_27, state: 'unreadable', detail: 'HTTP 500', headCommittedAt: null }] }), null);

  // ★ The branch-activity term. A dev that pushed after claiming is ALIVE for
  // this row — and the under-report it implies is deliberate (see the docblock).
  t('H27: a branch that moved AFTER the claim -> clean', dead27({ refs: frozen('2026-08-23T05:49:00Z') }), null);
  t('H27: a branch whose head predates the claim -> finding', typeof dead27({ refs: frozen('2026-08-22T09:00:00Z') }), 'string');
  t('H27: one moved branch among frozen ones clears the card', dead27({ refs: [...frozen(), { branch: 'claude/issue-5442-b', state: 'exists', headCommittedAt: '2026-08-23T09:00:00Z' }] }), null);
  t('H27: activity is measured against the CLAIM, not the threshold', dead27({ refs: frozen('2026-08-23T05:47:00Z') }), null);
  // Three-valued, never two (#4690): an unreadable comparison is not a "no".
  t('H27: an unreadable head timestamp does NOT read as healthy', dead27({ refs: frozen(null) }) === null, false);
  t('H27: …and fires the quieter UNJUDGED row instead', dead27Row({ refs: frozen(null) }).includes('UNJUDGED, not confirmed healthy'), true);
  t('H27: …which does not assert the finding it did not measure', dead27Row({ refs: frozen(null) }).includes('NOT MOVED SINCE IT WAS CLAIMED'), false);
  t('H27: …citing the unread-is-not-absent rule', dead27Row({ refs: frozen(null) }).includes('#4690'), true);
  t('H27: an absent head field reads as unknown, not as an old date', dead27Row({ refs: [{ branch: BR_27, state: 'exists' }] }).includes('UNJUDGED'), true);
  t('H27: branchMovedSinceClaim is three-valued', [branchMovedSinceClaim(frozen()[0], claim27()), branchMovedSinceClaim(frozen('2026-08-23T09:00:00Z')[0], claim27()), branchMovedSinceClaim(frozen(null)[0], claim27())].join(','), 'false,true,');

  // ★ The delivery term, through H8's own relation so the two cannot drift.
  t('H27: an OPEN PR delivering the card -> clean', dead27({ delivery: { open: 1, merged: 0 } }), null);
  t('H27: a MERGED delivery is H8\'s row, not this one', dead27({ delivery: { open: 0, merged: 1 } }), null);
  t('H27: claimDelivery reads the body relation', claimDelivery(5442, [{ number: 9, body: 'Part of #5442' }], []).open, 1);
  t('H27: …and the branch-name fallback', claimDelivery(5442, [{ number: 9, body: '', head: { ref: 'claude/issue-5442-x' } }], []).open, 1);
  t('H27: …counting merged deliveries separately', claimDelivery(5442, [], [{ number: 9, body: 'Fixes #5442', merged_at: '2026-08-23T10:00:00Z' }]).merged, 1);
  t('H27: …and ignoring an unmerged closed PR in the merged window', claimDelivery(5442, [], [{ number: 9, body: 'Fixes #5442', merged_at: null }]).merged, 0);
  t('H27: …and a PR for some OTHER card', claimDelivery(5442, [{ number: 9, body: 'Part of #9999' }], []).open, 0);
  t('H27: a card delivered in halves is not a death', dead27({ delivery: claimDelivery(5442, [{ number: 9, body: 'Part of #5442' }], []) }), null);

  // ★ Unlike H20, this predicate DOES take pull-request input — that is the
  // deliberate difference between the two rows, pinned so it cannot be lost.
  t('H27: the predicate takes a delivery input', h27DeadClaimNoProgress.length, 4);
  t('H20: …and still takes none', h20DispatchedNoBranchRef.length, 3);

  // The gathering gate, and that it is a strict subset of H20's.
  t('H27 gate: a claim past 24h is read', h27NeedsClaimLivenessRead(dispatchedCard(), claim27(), NOW_27), true);
  t('H27 gate: a claim inside 24h buys nothing', h27NeedsClaimLivenessRead(dispatchedCard(), claim27('2026-08-24T04:00:00Z'), NOW_27), false);
  t('H27 gate: an unreadable claim timestamp is read, never assumed fresh', h27NeedsClaimLivenessRead(dispatchedCard(), claim27('not-a-date'), NOW_27), true);
  t('H27 gate: a card without `pm:dispatched` is out of scope', h27NeedsClaimLivenessRead(dispatchedCard(['pm:queue']), claim27(), NOW_27), false);
  t('H27 gate: no claim -> nothing to read (that shape is H2\'s row)', h27NeedsClaimLivenessRead(dispatchedCard(), null, NOW_27), false);
  t('H27 gate: a missing issue does not crash', h27NeedsClaimLivenessRead(undefined, claim27(), NOW_27), false);
  // The subset property is what makes H27 cost ZERO extra requests: every card
  // it can speak about was already probed for H20.
  t('H27 gate: every H27 candidate is already an H20 candidate', h27NeedsClaimLivenessRead(dispatchedCard(), claim27(), NOW_27) && h20NeedsRefProbe(dispatchedCard(), claim27(), NOW_27), true);
  t('H27 gate: …and the threshold is strictly wider than H20\'s', DEAD_CLAIM_STALE_HOURS * 60 > DISPATCHED_NO_REF_STALE_MINUTES, true);

  // The remaining gates and the caller contract, H20's shapes on H27's inputs.
  t('H27: the label gate outranks everything', dead27({ issue: dispatchedCard(['pm:queue']) }), null);
  t('H27: no claim -> no row', dead27({ claim: null }), null);
  t('H27: an unprobed card yields no row (caller contract, as H19/H20)', dead27({ refs: [] }), null);
  t('H27: absent ref states -> no row', dead27({ refs: undefined }), null);
  t('H27: a missing issue does not crash', dead27({ issue: undefined }), null);
  t('H27: a young claim -> no row even with a frozen branch', dead27({ claim: claim27('2026-08-24T04:00:00Z') }), null);
  t('H27: exactly AT the threshold is not past it', dead27({ claim: claim27(new Date(NOW_27 - DEAD_CLAIM_STALE_HOURS * 3_600_000).toISOString()) }), null);
  const unstamped27 = dead27({ claim: claim27('not-a-date') });
  const unstamped27Row = String(unstamped27 ?? '');
  t('H27: an unreadable claim timestamp does not read as fresh', unstamped27 === null, false);
  t('H27: …and yields the UNJUDGED row (the comparison is impossible)', unstamped27Row.includes('UNJUDGED'), true);
  const many27 = Array.from({ length: 7 }, (_, i) => ({ branch: `claude/issue-1-b${i}`, state: 'exists', headCommittedAt: '2026-08-22T09:00:00Z' }));
  t('H27: the branch list is capped at the render budget', dead27Row({ refs: many27 }).includes(`+${7 - H20_BRANCH_LIST_CAP} more`), true);

  // -- H16: open non-draft PR stuck in a merge conflict (2026-08-19 incident) --
  // The single-PR payload shape, since `mergeable_state` is absent from the
  // listing rows this sweep otherwise runs on.
  const conflictPr = ({
    draft = false,
    mergeable_state = 'dirty',
    auto_merge = null,
    updated = hoursAgo(4),
    body = '',
    head = { ref: 'claude/issue-1-x' },
    merged_at = null,
  } = {}) => ({ draft, mergeable_state, auto_merge, head, body, updated_at: updated, merged_at });

  t('H16: dirty beyond the threshold -> finding', typeof h16StuckMergeConflict(conflictPr(), NOW), 'string');
  t('H16: …and the finding names the threshold', h16row(conflictPr(), NOW).includes(`${MERGE_CONFLICT_STALE_HOURS}h`), true);
  t('H16: …and names the platform state it read', h16row(conflictPr(), NOW).includes('mergeable_state: dirty'), true);
  t('H16: …and prescribes the merge-and-resolve remedy', h16row(conflictPr(), NOW).includes('merges `main` into the branch'), true);
  // The proxy must be DECLARED in the row, not silently substituted: a reader
  // shown "~4h" has to know it is silence on the PR, not the conflict's age.
  t('H16: …and declares the age is the PR\'s updated_at, not the conflict\'s', h16row(conflictPr(), NOW).includes("Age is the PR's `updated_at`, not the conflict's"), true);
  t('H16: dirty within the threshold -> clean (a fresh push is mid-resolution)', h16StuckMergeConflict(conflictPr({ updated: hoursAgo(1) }), NOW), null);
  t('H16: exactly at the threshold -> clean (strictly beyond fires)', h16StuckMergeConflict(conflictPr({ updated: hoursAgo(MERGE_CONFLICT_STALE_HOURS) }), NOW), null);
  t('H16: draft is out of scope however old (parked deliberately)', h16StuckMergeConflict(conflictPr({ draft: true, updated: hoursAgo(200) }), NOW), null);
  t('H16: a clean PR is silent', h16StuckMergeConflict(conflictPr({ mergeable_state: 'clean', updated: hoursAgo(200) }), NOW), null);
  // GitHub computes mergeability asynchronously: `unknown` is the platform
  // saying "ask again later", so it is SKIPPED rather than vouched for or
  // guessed — the one place H16 departs from the #4690 direction, on purpose.
  t('H16: unknown is skipped, never reported', h16StuckMergeConflict(conflictPr({ mergeable_state: 'unknown', updated: hoursAgo(200) }), NOW), null);
  t('H16: a null mergeable_state is skipped too', h16StuckMergeConflict(conflictPr({ mergeable_state: null, updated: hoursAgo(200) }), NOW), null);
  // The wiring hazard this pins: a LIST row carries no `mergeable_state` at
  // all, and feeding one here must skip rather than throw or flag. The summary
  // line's `read X of Y` is what would expose that mistake in the live sweep.
  t('H16: a listing row (no mergeable_state key) is skipped', h16StuckMergeConflict({ draft: false, merged_at: null, updated_at: hoursAgo(200) }, NOW), null);
  // Every other non-dirty verdict is someone else's business: `behind` is the
  // queue's to rebuild and `blocked` is a required check or a review, both of
  // which DO produce a signal a patrol can already see.
  t('H16: behind is not a conflict', h16StuckMergeConflict(conflictPr({ mergeable_state: 'behind', updated: hoursAgo(200) }), NOW), null);
  t('H16: blocked is not a conflict', h16StuckMergeConflict(conflictPr({ mergeable_state: 'blocked', updated: hoursAgo(200) }), NOW), null);
  t('H16: missing draft field is out of scope', h16StuckMergeConflict({ mergeable_state: 'dirty', updated_at: hoursAgo(50) }, NOW), null);
  t('H16: merged row is out of scope', h16StuckMergeConflict(conflictPr({ merged_at: '2026-08-15T10:00:00Z', updated: hoursAgo(50) }), NOW), null);
  // #4690 direction, same as H10/H11/H12/H13: unreadable must not read as fresh.
  t('H16: unreadable updated_at -> finding, not fresh', typeof h16StuckMergeConflict(conflictPr({ updated: 'not-a-date' }), NOW), 'string');
  t('H16: absent updated_at -> finding, not fresh', typeof h16StuckMergeConflict(conflictPr({ updated: undefined }), NOW), 'string');

  // THE incident property: armed auto-merge must not quiet this row. H12 reads
  // `auto_merge` as finding-reducing and is right to; here the arming is what
  // made every proxy signal read healthy while the PR went nowhere.
  t('H16: armed auto-merge does NOT suppress the row', typeof h16StuckMergeConflict(conflictPr({ auto_merge: { merge_method: 'squash' } }), NOW), 'string');
  t('H16: …and the row says auto-merge does not resolve conflicts', h16row(conflictPr({ auto_merge: { merge_method: 'squash' } }), NOW).includes('does NOT resolve conflicts'), true);
  // The contrast that makes the divergence deliberate rather than an oversight:
  // one PR row, two predicates, opposite readings of the same armed field.
  t('H16: …while H12 stays clean on that same armed PR (the divergence is by design)', h12OrphanLanding(conflictPr({ auto_merge: { merge_method: 'squash' }, updated: hoursAgo(50) }), NOW), null);

  // The held-card clause — the row names the delivery, not only the branch.
  t('H16: a `Fixes #N` body names the card it is holding', h16row(conflictPr({ body: 'Fixes #9763\n\nsome prose' }), NOW).includes('holding card #9763'), true);
  t('H16: `Part of #N` counts as held too (H8\'s reading of delivery)', h16row(conflictPr({ body: 'Part of #9652' }), NOW).includes('holding card #9652'), true);
  t('H16: two cards are pluralised and listed in order', h16row(conflictPr({ body: 'Fixes #9961\nFixes #9936' }), NOW).includes('holding cards #9936, #9961'), true);
  t('H16: a body with no card carries no holding clause', h16row(conflictPr({ body: 'no card here' }), NOW).includes('holding'), false);
  // #8293 reading 4 carries over: a body QUOTING the spelling names nothing.
  t('H16: a backticked `Fixes #N` is not a held card', h16HeldCards('the dispatch asked for `Fixes #8284`').length, 0);
  t('H16: h16HeldCards de-duplicates and sorts', h16HeldCards('Fixes #30\nPart of #12\nFixes #30').join(','), '12,30');
  t('H16: h16HeldCards on an absent body does not crash', h16HeldCards(undefined).length, 0);

  // -- H16 gathering policy: `h16NeedsDetail` --------------------------------
  // Pinned for the reason `needsRepoProbe` is: a policy deciding what gets READ
  // AT ALL is where a silent hole would live. THE property is that it can never
  // be narrower than the predicate — anything H16 could flag must be fetched.
  t('H16 gate: an aged non-draft PR is a candidate', h16NeedsDetail(conflictPr({ updated: hoursAgo(4) }), NOW), true);
  t('H16 gate: a fresh PR is not worth a request', h16NeedsDetail(conflictPr({ updated: hoursAgo(1) }), NOW), false);
  t('H16 gate: exactly at the threshold is not a candidate (matches the predicate)', h16NeedsDetail(conflictPr({ updated: hoursAgo(MERGE_CONFLICT_STALE_HOURS) }), NOW), false);
  t('H16 gate: a draft is never fetched', h16NeedsDetail(conflictPr({ draft: true, updated: hoursAgo(200) }), NOW), false);
  t('H16 gate: a merged row is never fetched', h16NeedsDetail(conflictPr({ merged_at: '2026-08-15T10:00:00Z', updated: hoursAgo(200) }), NOW), false);
  t('H16 gate: missing draft field is never fetched', h16NeedsDetail({ updated_at: hoursAgo(200), merged_at: null }, NOW), false);
  // The unreadable timestamp MUST be fetched: the predicate promises to surface
  // it, so a gate that skipped it would drop the row it promises.
  t('H16 gate: an unreadable updated_at IS a candidate (the predicate flags it)', h16NeedsDetail(conflictPr({ updated: 'not-a-date' }), NOW), true);
  t('H16 gate: an absent updated_at IS a candidate', h16NeedsDetail(conflictPr({ updated: undefined }), NOW), true);
  t('H16 gate: an absent row is not a candidate', h16NeedsDetail(undefined, NOW), false);
  // The Version Packages PR is NOT excluded here, unlike in H12: it is
  // regenerated from `main` on every push, so a dirty one is a real finding
  // about the release bot rather than a by-design false positive.
  t('H16 gate: a changeset-release head is still a candidate (unlike H12)', h16NeedsDetail(conflictPr({ head: { ref: 'changeset-release/main' }, updated: hoursAgo(200) }), NOW), true);
  t('H16: …and a dirty Version Packages PR really does flag', typeof h16StuckMergeConflict(conflictPr({ head: { ref: 'changeset-release/main' }, updated: hoursAgo(200) }), NOW), 'string');
  // The never-narrower invariant, asserted over the whole fixture table rather
  // than case by case: for every row the predicate flags, the gate must fetch.
  const h16Rows = [
    conflictPr(),
    conflictPr({ updated: 'not-a-date' }),
    conflictPr({ updated: undefined }),
    conflictPr({ auto_merge: { merge_method: 'squash' } }),
    conflictPr({ head: { ref: 'changeset-release/main' }, updated: hoursAgo(200) }),
    conflictPr({ body: 'Fixes #1' }),
    conflictPr({ updated: hoursAgo(1) }),
    conflictPr({ draft: true }),
    conflictPr({ mergeable_state: 'clean' }),
    conflictPr({ merged_at: '2026-08-15T10:00:00Z' }),
  ];
  t(
    'H16 gate: never narrower than the predicate (every flagged row is fetched)',
    h16Rows.every((row) => h16StuckMergeConflict(row, NOW) === null || h16NeedsDetail(row, NOW)),
    true,
  );

  // -- H16 detail-pass failure posture (#4690 at row granularity) ------------
  // A partial read is a bounded gap the summary line states; a total one is a
  // transport failure wearing a quiet H16 section, and must surface as such.
  t('H16 pass: some candidates unread is a bounded gap, not a transport failure', h16DetailPassUnreadable(5, 3), false);
  t('H16 pass: exactly one read out of many is still a real reading', h16DetailPassUnreadable(9, 1), false);
  t('H16 pass: NO candidate readable is a transport failure', h16DetailPassUnreadable(4, 0), true);
  // The healthiest possible board — nothing stale enough to be worth a request
  // — must not fail the sweep.
  t('H16 pass: zero candidates is a clean reading, never a failure', h16DetailPassUnreadable(0, 0), false);
  t('H16 pass: absent counters degrade to a clean reading', h16DetailPassUnreadable(undefined, undefined), false);

  // -- H16 incident fixture: PR #9826, the measured specimen -----------------
  // The devx incident this item exists for: a conflict that hung ~4h while
  // auto-merge was armed, and not one of H1–H15 could express the state.
  //
  // ⚠️ The `dirty` reading is the INCIDENT's, recorded on the card — not a
  // live reading. Measured again here on 2026-08-19 while implementing H16,
  // that PR answered `mergeable_state: "blocked"`: the conflict had since been
  // resolved. Pinned as a historical shape deliberately, and said so here so
  // nobody "verifies" this fixture against a live PR that no longer carries
  // it. Body `Fixes #9763` is from the same live read.
  const pr9826 = conflictPr({
    body: 'Fixes #9763. Sub-issue of #9747 (the meta-card), in its **fails toward FALSE GREEN** half.',
    auto_merge: { merge_method: 'squash' },
    updated: hoursAgo(4),
    head: { ref: 'claude/issue-9763-literal-collector-spellings' },
  });
  t('H16 incident: the #9826 shape is a finding', typeof h16StuckMergeConflict(pr9826, NOW), 'string');
  t('H16 incident: …fires despite auto-merge being armed', h16row(pr9826, NOW).includes('MERGE CONFLICT'), true);
  t('H16 incident: …and names the card it was holding', h16row(pr9826, NOW).includes('holding card #9763'), true);
  t('H16 incident: …at its measured ~4h age', h16row(pr9826, NOW).includes('untouched for ~4h'), true);
  t('H16 incident: …and the sweep would have spent a request on it', h16NeedsDetail(pr9826, NOW), true);
  // The counterfactual that makes the fixture mean something: at the moment
  // the conflict appeared, the same PR was silent — the threshold is what
  // separates "being worked" from "stuck", and 4h is well past it.
  t('H16 incident: …while one hour in, the same PR was correctly silent', h16StuckMergeConflict({ ...pr9826, updated_at: hoursAgo(1) }, NOW), null);

  // -- H17: the on-hold trigger-file index (#10034) --------------------------
  // Every fixture below is a VERBATIM excerpt from a real hold comment or card
  // body, read on 2026-08-19 while measuring the census that produced
  // `H17_TRIGGER_ANCHOR_TERMS`. Invented shapes would prove nothing here: the
  // whole question this item had to answer first was whether hold comments
  // have a greppable shape at all, and the answer is a fact about these nine
  // cards, not about a format anyone designed.
  //
  // The tracked-file oracle is a fixture set, so the extraction is pinned
  // without a checkout — and the DROP behaviour is pinned with it, because
  // "what this refuses to emit" is the property that makes the index safe to
  // render unreviewed.
  const TRACKED = new Set([
    '.github/workflows/lint.yml',
    'packages/rest/src/rest-server.ts',
    'packages/spec/src/data/field.zod.ts',
    'content/docs/ui/setup-app.mdx',
    'content/docs/automation/hook-bodies.mdx',
    'content/docs/kernel/index.mdx',
    'scripts/check-durability-degradation-log-level.mjs',
    'packages/lint/src/data-model-rules.ts',
    'packages/lint/src/validate-security-posture.test.ts',
    'scripts/check-where-matcher-conformance.mjs',
    'scripts/where-matcher-conformance.baseline.json',
    'scripts/check-type-check-coverage.mjs',
    'packages/spec/src/contracts/data-driver.ts',
  ]);
  const tracked = (p) => TRACKED.has(p);
  const files = (text) => h17TriggerFiles([text], tracked).join('|');

  // Shape A — anchor and path on ONE line, prose form. #8331's hold comment.
  const c8331 =
    'Named restart conditions: ① #8330 merged AND the next queued card that already touches ' +
    '`.github/workflows/lint.yml` — devx seat: name this card in that dispatch brief as a declared ' +
    'rider (comment-or-removal, dev decides against the card\'s trade-off analysis); ② the gate\'s ' +
    'filters and the workflow step\'s filters are ever observed to diverge.';
  t('H17 #8331: `restart condition` anchor + inline path -> the path', files(c8331), '.github/workflows/lint.yml');

  // Shape B — a bolded `Restart condition (trigger files):` label. #8883.
  const c8883 =
    '- **Restart condition (trigger files):** after PR #8887 (the #8850 extraction) is MERGED, the ' +
    'next dispatched card whose surface includes `packages/rest/src/rest-server.ts` metadata-endpoints ' +
    'region carries item 1 (the JSDoc header) as a declared rider.';
  t('H17 #8883: `trigger files` anchor -> the path', files(c8883), 'packages/rest/src/rest-server.ts');

  // Shape C — an `opportunistic:` numbered item, with a backticked IDENTIFIER
  // on the same line. `Field` is not a tracked file and must be dropped: this
  // is the decoy that proves the oracle is doing work rather than decorating.
  const c8656 =
    '3. **opportunistic:** any PR already editing the `Field` builder object in ' +
    '`packages/spec/src/data/field.zod.ts` — closing the gap there is a cheap declared rider.';
  t('H17 #8656: `opportunistic` anchor -> only the tracked path', files(c8656), 'packages/spec/src/data/field.zod.ts');
  t('H17 #8656: …and the backticked identifier `Field` is dropped, not guessed at', files(c8656).includes('Field'), false);

  // Shape D — anchor sentence, then an IMMEDIATE bullet list. #8984.
  const c8984 =
    '**Restart condition (named trigger files)**: the next PR touching any of\n' +
    '- `content/docs/ui/setup-app.mdx`\n' +
    '- `content/docs/automation/hook-bodies.mdx`\n' +
    '- `content/docs/kernel/index.mdx`\n' +
    '\n' +
    'carries the relabel as a **declared rider**.';
  t(
    'H17 #8984: anchor + immediate bullet list -> all three paths',
    files(c8984),
    'content/docs/automation/hook-bodies.mdx|content/docs/kernel/index.mdx|content/docs/ui/setup-app.mdx',
  );
  t('H17 #8984: …and the prose after the blank line is not rejoined', files(c8984).includes('rider'), false);

  // Shape E — an explicit `Trigger file:` label inside a numbered item. #8897.
  const c8897 =
    '1. **Trigger file: `scripts/check-durability-degradation-log-level.mjs`** — any card or PR ' +
    'editing this file (including the #8901 design work) must decide options 1/2/3 in the same change.\n' +
    '2. Any seam reporting through an injected receiver goes red with a "silent" message.';
  t('H17 #8897: `Trigger file:` label -> the path', files(c8897), 'scripts/check-durability-degradation-log-level.mjs');

  // Shape F — two paths on one anchor line, in a card BODY rather than a
  // comment. #9139, which carries zero comments: the body channel is not
  // optional, and reading only comments would have missed this card entirely.
  const b9139 =
    '- **Trigger files** (opportunistic-restart clause): `packages/lint/src/data-model-rules.ts` and ' +
    '`packages/lint/src/validate-security-posture.test.ts` — any dispatch whose file surface ' +
    'intersects them must name this card.';
  t(
    'H17 #9139: two paths on one anchor line (from the card BODY) -> both',
    files(b9139),
    'packages/lint/src/data-model-rules.ts|packages/lint/src/validate-security-posture.test.ts',
  );

  // Shape G — anchor, BLANK LINE, then the list; and a third bullet that is
  // prose naming a backticked fixture CONSTANT. #8662, the second decoy.
  const c8662 =
    '**Opportunistic trigger files** (per the hold discipline — a restart condition nobody can see is ' +
    'not a condition). Name this card in the dispatch order of any card whose file surface intersects:\n' +
    '\n' +
    '- `scripts/check-where-matcher-conformance.mjs`\n' +
    '- `scripts/where-matcher-conformance.baseline.json`\n' +
    '- the `FIXTURE_CAPTURED_NEGATED` self-test fixture\n';
  t(
    'H17 #8662: anchor, blank line, then the list -> both tracked paths',
    files(c8662),
    'scripts/check-where-matcher-conformance.mjs|scripts/where-matcher-conformance.baseline.json',
  );
  t('H17 #8662: …and the backticked constant is dropped', files(c8662).includes('FIXTURE'), false);

  // The NEGATIVE half of the census — the two sampled holds with no trigger
  // clause. Their exits are `Restart-when: closed …#N`, which H9 already
  // judges; H17 must contribute no row for them, or the index would tell a
  // dispatching seat to intersect against files nobody nominated.
  const c9276 =
    'Restart-when: closed objectstack-ai/objectstack#5499\n\n' +
    '(Earlier restart is legitimate only if the freeze ruling is narrowed on #5499 to exclude ' +
    'storage-contract normalization — that is a maintainer note to record there, not a seat call.)';
  t('H17 #9276: a `Restart-when: closed` hold names no trigger file', files(c9276), '');
  t(
    'H17 #9707: a card-closure hold names no trigger file either',
    files('**Card status:** `pm:on-hold`, restart-when **objectui#5266 lands** — at which point the residual should be re-measured.'),
    '',
  );

  // ⛔ `rider` is not an anchor term, and this is the specimen that decided it:
  // #8331's RELEASE comment is post-mortem prose about a hold that is no
  // longer held, and it contains a tracked path. Admitting `rider` would have
  // rendered a dead trigger as a live one.
  const release8331 =
    'Hold released → `pm:queue` (triage seat, rider-clause audit): the armed rider fired three times ' +
    'without being carried — PRs #9869, #9990 and #10005 all touched `.github/workflows/lint.yml` ' +
    'after the rider armed (verified on origin/main; `refreshBuiltClosure()` confirmed at ' +
    '`scripts/check-type-check-coverage.mjs:1679`).';
  t('H17: a release/audit comment saying "rider" is NOT an anchor', files(release8331), '');
  // …and the same line's `path:line` citation form must fail validation even
  // when something else on the line does anchor it.
  t(
    'H17: a `path:line` citation is not a tracked file and is dropped',
    files(`**Trigger file:** see \`scripts/check-type-check-coverage.mjs:1679\``),
    '',
  );

  // Fenced blocks are citations, not triggers — #8656's evidence block lists
  // real `packages/spec/**` paths that nominate nothing.
  //
  // ⚠️ The fixture QUOTES ANOTHER CARD'S CLAUSE inside the fence, and that
  // detail is load-bearing. Written first with only #8656's verbatim
  // `path:line` citations, this case passed with fence-stripping ENTIRELY
  // REMOVED: the `:234` suffix makes that token fail the tracked-file check on
  // its own, so the test was measuring the ORACLE while vouching for a fence
  // parser it never exercised. A bare path in a fence does not exercise it
  // either — nothing unbackticked is ever harvested from prose. The shape that
  // actually needs the strip is the one these threads are full of: a comment
  // quoting a PRIOR comment wholesale, anchor term and backticks included.
  // Without the strip, the quoting card inherits a trigger file it never
  // nominated, and the index sends a seat to intersect on the wrong card.
  const fenced =
    '**Restart condition**: unchanged. For reference, #8656 reads:\n\n' +
    '```\n' +
    '3. **opportunistic:** any PR already editing the `Field` builder object in `packages/spec/src/data/field.zod.ts` — a cheap declared rider.\n' +
    '```\n';
  t('H17: a clause quoted inside a fenced block is not harvested', files(fenced), '');
  t(
    'H17: …but stripMarkdownCode({inline:false}) still keeps inline spans',
    stripMarkdownCode('a `packages/rest/src/rest-server.ts` b', { inline: false }).includes('rest-server'),
    true,
  );
  t(
    'H17: …and the default (inline:true) is unchanged for every existing caller',
    stripMarkdownCode('a `Fixes #1` b').includes('#1'),
    false,
  );

  // The canonical `Restart-touch:` channel — zero live matches today by
  // design, so these are the only cases that exercise it.
  t('H17 Restart-touch: a bare path on the canonical line is read', files('Restart-touch: packages/rest/src/rest-server.ts'), 'packages/rest/src/rest-server.ts');
  t('H17 Restart-touch: a backticked value is read too', files('Restart-touch: `.github/workflows/lint.yml`'), '.github/workflows/lint.yml');
  t('H17 Restart-touch: a bulleted canonical line is read', files('- Restart-touch: packages/spec/src/data/field.zod.ts'), 'packages/spec/src/data/field.zod.ts');
  t('H17 Restart-touch: an UNTRACKED value is dropped, never emitted', files('Restart-touch: packages/gone/removed.ts'), '');
  // Case-sensitive like `Blocked-by:` and `Restart-when:`: a lowercase variant
  // is a line the machinery cannot see, and must not be quietly accepted.
  t('H17 Restart-touch: the lowercase spelling is NOT the channel', files('restart-touch: packages/rest/src/rest-server.ts'), '');

  // Continuation bounds.
  t(
    'H17 continuation: prose immediately after the anchor stops the scan',
    files('**Trigger files**: as follows.\nThis paragraph mentions `packages/rest/src/rest-server.ts` in passing.'),
    '',
  );
  t(
    'H17 continuation: two blank lines before a list stop the scan',
    files('**Trigger files**:\n\n\n- `packages/rest/src/rest-server.ts`'),
    '',
  );
  const longList = `**Trigger files**:\n${Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n')}\n- \`packages/rest/src/rest-server.ts\``;
  t('H17 continuation: the scan stops at H17_LIST_SCAN_LIMIT', files(longList), '');
  t('H17_LIST_SCAN_LIMIT is the documented parsing bound', H17_LIST_SCAN_LIMIT, 12);

  // Multi-text merge: body + comments are one card's evidence, deduped and
  // sorted. A path named in both the body and a comment is ONE row entry.
  t(
    'H17: body and comments merge, dedupe and sort into one list',
    h17TriggerFiles([b9139, c8331, '**Trigger files**: `.github/workflows/lint.yml`'], tracked).join('|'),
    '.github/workflows/lint.yml|packages/lint/src/data-model-rules.ts|packages/lint/src/validate-security-posture.test.ts',
  );

  // The gathering policy — the same "must never be narrower than the thing it
  // feeds" property `h16NeedsDetail` is pinned for.
  t('H17 gating: an open pm:on-hold card is a candidate', h17NeedsComments(issue(['pm:on-hold'])), true);
  t('H17 gating: a queued card is not', h17NeedsComments(issue(['pm:queue', 'domain:devx'])), false);
  t('H17 gating: a dispatched card is not', h17NeedsComments(issue(['pm:dispatched'])), false);
  t('H17 gating: a hold carrying other labels is still a candidate', h17NeedsComments(issue(['bug', 'pm:on-hold', 'domain:engine'])), true);

  // Row assembly: cards with no validated path are omitted entirely (the
  // majority shape — most of the 79 open holds name no file), and rows sort by
  // number so the anchor body diffs cleanly run to run.
  const card = (number, texts) => ({ issue: { number, html_url: `https://example.test/${number}` }, texts });
  const rows17 = h17IndexRows(
    [card(9139, [b9139]), card(9276, [c9276]), card(8331, [c8331])],
    tracked,
  );
  t('H17 rows: a hold naming nothing is omitted, not rendered empty', rows17.length, 2);
  t('H17 rows: …and rows ascend by card number', rows17.map((r) => r.issue.number).join(','), '8331,9139');
  t('H17 rows: …carrying the validated files', rows17[1].files.join('|'), 'packages/lint/src/data-model-rules.ts|packages/lint/src/validate-security-posture.test.ts');

  // -- report rendering, both media (#9844) ---------------------------------
  // The standing caller writes the markdown into a pinned issue body, so the
  // properties pinned here are the ones a broken body would cost: the plain
  // output must not have moved, the loud rows must outrank truncation, the
  // trim must announce itself, and a mistyped --format must be loud.
  const finding = (number, code, msg) => [{ number, html_url: `https://example.test/${number}` }, code, msg];
  const counts = { repo: 'o/r', issues: 3, unscoped: 4, prs: 5, merged: 6, conflictCandidates: 2, conflictProbed: 2 };
  const quietRow = finding(200, 'H2', 'assignee set but no claim comment on the thread');
  const loudRow = finding(900, 'H13', `${P0_SUSPECT_MARKER} the card self-declares P0. base sentence.`);

  // The plain renderer is the pre-#9844 output, unchanged: two lines per
  // finding (code/number/message, then the URL indented), summary last.
  t(
    'plain: a finding renders as the pre-existing two-line shape',
    renderPlain([quietRow], counts).split('\n').slice(0, 2).join('|'),
    '  H2 #200 assignee set but no claim comment on the thread|     https://example.test/200',
  );
  t('plain: the summary sentence ends the report', renderPlain([quietRow], counts).endsWith('not a gate verdict.'), true);
  // renderPlain does NOT reorder: the live sweep hands it findings already
  // sorted by issue number, and a terminal has no fold for a priority sort to
  // buy anything at. Pinned in the direction that would actually regress —
  // someone "helpfully" giving the plain path the markdown sort — by feeding
  // it loud-first input and requiring the loud row to stay where it was put.
  t('plain: preserves the caller\'s order, applying no priority sort', renderPlain([loudRow, quietRow], counts).indexOf('#900') < renderPlain([loudRow, quietRow], counts).indexOf('#200'), true);
  // H19 rides both media as an ordinary row — no renderer special case, which
  // is the property that lets a new item land without touching either.
  const h19Row = finding(10112, 'H19', '`pm:blocked` while 1 of 1 `Blocked-by:` target(s) is CLOSED (`#10126`)');
  t(
    'plain: an H19 row renders in the same two-line shape as every other item',
    renderPlain([h19Row], counts).split('\n').slice(0, 2).join('|'),
    '  H19 #10112 `pm:blocked` while 1 of 1 `Blocked-by:` target(s) is CLOSED (`#10126`)|     https://example.test/10112',
  );
  t('markdown: an H19 row links the card it names', renderMarkdown([h19Row], counts).includes('- **H19** [#10112](https://example.test/10112)'), true);
  t('markdown: …and is NOT sorted above the loud band', renderMarkdown([h19Row, loudRow], counts).indexOf('#900') < renderMarkdown([h19Row, loudRow], counts).indexOf('#10112'), true);
  t('plain: …and the markdown renderer on the same input DOES sort loud first', renderMarkdown([quietRow, loudRow], counts).indexOf('#900') < renderMarkdown([quietRow, loudRow], counts).indexOf('#200'), true);
  t('summaryLine: names what was READ, not only what was found', summaryLine(counts, 0).includes('swept 3 open pm-/p0-labeled issue(s)'), true);
  t('summaryLine: the unscoped-pass clause names H18 alongside H13-H15', summaryLine(counts, 0).includes('unscoped pass (H13–H15, H18)'), true);
  // H16's pair is the row-granular half of the same #4690 property: a detail
  // pass that read NOTHING must not be indistinguishable from a board with no
  // conflicts, so the sentence carries `read X of Y` rather than only findings.
  t('summaryLine: reports the H16 detail reads, not only the H16 findings', summaryLine(counts, 0).includes('merge state read on 2 of 2 H16 candidate(s)'), true);
  t('summaryLine: …and a partial read says so', summaryLine({ ...counts, conflictProbed: 1 }, 0).includes('read on 1 of 2'), true);
  // Counts assembled without the pair still render a sentence, never `undefined`.
  t('summaryLine: absent H16 counts degrade to 0, never to undefined', summaryLine({ repo: 'o/r', issues: 1, unscoped: 1, prs: 1, merged: 1 }, 0).includes('read on 0 of 0'), true);
  t('summaryLine: …and never prints the string undefined', summaryLine({ repo: 'o/r', issues: 1, unscoped: 1, prs: 1, merged: 1 }, 0).includes('undefined'), false);

  // -- The H19 coverage clause, and the promise it used to make falsely -------
  const btCounts2 = (blockerResolved, blockerTargets, extra = {}) => ({ ...counts, blockerResolved, blockerTargets, ...extra });
  t('summary: a complete H19 pass adds no shortfall clause', summaryLine(btCounts2(12, 12), 1).includes('unresolved target(s) are named'), false);
  t('summary: an H19 shortfall counts the unresolved targets', summaryLine(btCounts2(25, 28), 1).includes('the 3 unresolved target(s) are named on their own cards\' rows'), true);
  t('summary: …and promises the TRIM cannot drop them, which is the fixable half', summaryLine(btCounts2(25, 28), 1).includes('sort ABOVE the size trim'), true);
  t('summary: …and cites the sweep on which the old promise was false', summaryLine(btCounts2(25, 28), 1).includes('2026-08-25T02:08Z'), true);
  t('summary: …and no longer makes the bare "never dropped" claim for H19', summaryLine(btCounts2(25, 28), 1).includes('each unresolved target is named on its own card\'s row, never dropped'), false);

  // -- The cross-repo reachability pair (#11218) ------------------------------
  const xCounts = (crossRepoProbed, crossRepoUnreadable) => btCounts2(25, 28, { crossRepoProbed, crossRepoUnreadable });
  t('summary: cross-repo probes are reported', summaryLine(xCounts(2, 1), 1).includes('measured directly on 2 sibling repo(s)'), true);
  t('summary: …naming how many refused', summaryLine(xCounts(2, 1), 1).includes('1 do(es) not answer this credential'), true);
  t('summary: …and that a re-run will not help', summaryLine(xCounts(2, 1), 1).includes('no re-run'), true);
  t('summary: no probes taken -> no cross-repo clause at all', summaryLine(xCounts(0, 0), 1).includes('sibling repo(s)'), false);
  t('summary: absent cross-repo counts degrade to 0, never to undefined', summaryLine(counts, 0).includes('undefined'), false);

  // -- H32's seat coverage pair (#11706) -------------------------------------
  const seatCounts = (seatMarkersRead, seatCandidates) => ({ ...counts, seatMarkersRead, seatCandidates });
  t('summary: the H32 seat pair is reported', summaryLine(seatCounts(6, 6), 1).includes('marker thread read on 6 of 6 HELD seat post(s)'), true);
  t('summary: …scoped to lanes countable on this board', summaryLine(seatCounts(6, 6), 1).includes('countable on THIS board'), true);
  t('summary: …and says a sibling-lane seat is out of scope', summaryLine(seatCounts(6, 6), 1).includes("a seat held for a sibling repo's lane is out of scope"), true);
  t('summary: …and that an unread thread declines rather than accuses', summaryLine(seatCounts(2, 6), 1).includes('decline to judge that seat rather than accuse it'), true);
  t('summary: absent H32 counts degrade to 0, never to undefined', summaryLine(counts, 0).includes('marker thread read on 0 of 0'), true);

  // -- The dispatch-liveness pair was COMPUTED and never forwarded -----------
  //
  // A wiring regression, not a wording one: `sweep()` assembled `counts`
  // without `dispatchRefTargets`/`dispatchRefRead`, so this clause rendered
  // `0 of 0` on every live sweep — including 2026-08-25T02:08Z, which said
  // `read on 0 of 0` while publishing two H20 findings that a non-empty ref
  // cache is the only way to produce. Pinned as the CONTRACT the assembly owes,
  // so a future edit that drops the keys again fails here rather than in the
  // anchor body six hours later.
  t('summary: the H20/H27 pair is a real reading, not a constant 0 of 0', summaryLine(refCounts(4, 5), 1).includes('read on 0 of 0 distinct claimed'), false);
  t('summary: SWEEP_COUNT_KEYS names every count the summary consumes', SWEEP_COUNT_KEYS.includes('dispatchRefTargets') && SWEEP_COUNT_KEYS.includes('dispatchRefRead'), true);
  t('summary: …including the pairs added since', SWEEP_COUNT_KEYS.includes('crossRepoProbed') && SWEEP_COUNT_KEYS.includes('seatCandidates'), true);

  // The loudness contract between H13 and the renderer — one constant, two
  // readers. If the prefix ever drifts, this pair fails rather than the alarm
  // going quietly unsorted.
  t('loudness: H13\'s P0 line is recognised by the renderer', isLoudFinding(h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26), p0Body), NOW)), true);
  t('loudness: H13\'s base line is not', isLoudFinding(h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26)), NOW)), false);

  // Fold discipline: loud first, issue-number order within each band.
  const mixed = renderMarkdown([quietRow, loudRow, finding(100, 'H1', '`pm:dispatched` with no assignee')], counts);
  t('markdown: loud rows sort above quiet ones', mixed.indexOf('#900') < mixed.indexOf('#100'), true);
  t('markdown: quiet rows keep issue-number order', mixed.indexOf('#100') < mixed.indexOf('#200'), true);
  t('markdown: the alarm line counts the loud rows', mixed.includes('**1 P0-SUSPECT row(s) in this sweep**'), true);
  t('markdown: no alarm line when nothing is loud', renderMarkdown([quietRow], counts).includes('P0-SUSPECT row(s) in this sweep'), false);
  t('markdown: rows are links, not bare numbers', mixed.includes('[#200](https://example.test/200)'), true);
  t('markdown: the literal marker leads the body (no angle brackets to sanitize)', mixed.startsWith('os-half-state-sweep'), true);
  t('markdown: the body carries no HTML-comment marker the sanitizer could eat', mixed.includes('<!--'), false);

  // H14/H15 rows are ordinary rows in BOTH media — the property the card asked
  // for, and the reason H15 attaches its one summary row to the card it names
  // instead of inventing a rowless shape neither renderer knows how to place.
  const h14Row = finding(7276, 'H14', h14BlockingCacheIncoherent(carded(7276, ['pm:blocking']), idx([])));
  const h15Row = finding(7276, 'H15', h15OldestUnclaimedBlocking([blockingCard(7276)], NOW).message);
  t('plain: an H14 row renders in the standard two-line shape', renderPlain([h14Row], counts).startsWith('  H14 #7276 `pm:blocking` carried while'), true);
  t('plain: …and carries the card URL on the second line', renderPlain([h14Row], counts).includes('\n     https://example.test/7276'), true);
  t('plain: an H15 row renders the same way', renderPlain([h15Row], counts).startsWith('  H15 #7276 oldest UNCLAIMED'), true);
  t('markdown: an H14 row renders as a link row like every other', renderMarkdown([h14Row], counts).includes('- **H14** [#7276](https://example.test/7276) — '), true);
  t('markdown: an H15 row renders as a link row like every other', renderMarkdown([h15Row], counts).includes('- **H15** [#7276](https://example.test/7276) — '), true);
  // Neither is loud: the P0-SUSPECT band is H13's self-declared-emergency
  // class, and a coherence or visibility row must never outrank it at the fold.
  t('loudness: an H14 row is not loud', isLoudFinding(h14Row[2]), false);
  t('loudness: an H15 row is not loud', isLoudFinding(h15Row[2]), false);

  // H16 is an ordinary row in BOTH media too — report-only and NOT loud, as
  // the card requires: the P0-SUSPECT band stays H13's self-declared-emergency
  // class, which must keep outranking a conflict row at the fold.
  const h16Row = finding(9826, 'H16', h16StuckMergeConflict(pr9826, NOW));
  t('plain: an H16 row renders in the standard two-line shape', renderPlain([h16Row], counts).startsWith('  H16 #9826 open, non-draft and in MERGE CONFLICT'), true);
  t('plain: …and carries the PR URL on the second line', renderPlain([h16Row], counts).includes('\n     https://example.test/9826'), true);
  t('markdown: an H16 row renders as a link row like every other', renderMarkdown([h16Row], counts).includes('- **H16** [#9826](https://example.test/9826) — '), true);
  t('loudness: an H16 row is not loud', isLoudFinding(h16Row[2]), false);
  t('markdown: a loud H13 row still sorts above an H16 row', renderMarkdown([h16Row, loudRow], counts).indexOf('#900') < renderMarkdown([h16Row, loudRow], counts).indexOf('#9826'), true);
  t('markdown: a loud H13 row still sorts above an H14 row', renderMarkdown([h14Row, loudRow], counts).indexOf('#900') < renderMarkdown([h14Row, loudRow], counts).indexOf('#7276'), true);

  // H18 is an ordinary row in BOTH media too — report-only and NOT loud, the
  // same property H14–H16 pin and the card's explicit requirement here.
  const h18Msg = h18RetriageAged({ ...issue(['pm:retriage', 'pm:queue']), updated_at: hoursAgo(3) }, NOW);
  const h18Row = finding(6001, 'H18', h18Msg);
  t('plain: an H18 row renders in the standard two-line shape', renderPlain([h18Row], counts).startsWith('  H18 #6001 `pm:retriage` carried alongside'), true);
  t('plain: …and carries the card URL on the second line', renderPlain([h18Row], counts).includes('\n     https://example.test/6001'), true);
  t('markdown: an H18 row renders as a link row like every other', renderMarkdown([h18Row], counts).includes('- **H18** [#6001](https://example.test/6001) — '), true);
  t('loudness: an H18 row is not loud', isLoudFinding(h18Row[2]), false);
  t('markdown: a loud H13 row still sorts above an H18 row', renderMarkdown([h18Row, loudRow], counts).indexOf('#900') < renderMarkdown([h18Row, loudRow], counts).indexOf('#6001'), true);

  // A clean board says it was READ. The #4690 direction, restated in the one
  // surface where "no rows" could otherwise be mistaken for "no sweep".
  const clean = renderMarkdown([], counts);
  t('markdown: an empty sweep states the board was read', clean.includes('the board was READ and is clean'), true);
  t('markdown: …and disclaims the could-not-run reading', clean.includes('could not RUN'), true);
  t('markdown: an empty sweep still carries the summary counts', clean.includes('0 half-state(s) found'), true);

  // Truncation. 400 rows of ~120 chars overrun the budget; the trim must fire,
  // announce itself, keep the body under the cap, and never reach a loud row.
  const many = [loudRow, ...Array.from({ length: 400 }, (_, i) => finding(1000 + i, 'H2', 'assignee set but no claim comment on the thread — '.repeat(6)))];
  const trimmed = renderMarkdown(many, counts);
  t('markdown: an oversized report stays under GitHub\'s body cap', trimmed.length <= ISSUE_BODY_LIMIT, true);
  t('markdown: …and under the renderer\'s own budget', trimmed.length <= MARKDOWN_BODY_BUDGET, true);
  t('markdown: the trim announces itself in the body', trimmed.includes('further row(s) omitted'), true);
  t('markdown: truncation can never reach a loud row', trimmed.includes('#900'), true);

  // -- The UNJUDGED band and the trim (#11218) -------------------------------
  //
  // The regression this pins is MEASURED, not hypothetical. On the
  // 2026-08-25T02:08Z sweep the summary said "each unresolved target is named
  // on its own card's row, never dropped" while 199 rows were trimmed and NOT
  // ONE rendered row carried an unresolved target. The header promised exactly
  // what the trim had just eaten.
  const unjudgedRow = finding(
    9999,
    'H19',
    h19BlockOutlivedBlocker(blockedCard(9999), [foreign('objectstack-ai/cloud', 944, 'unresolved', { detail: 'HTTP 404', repoReadable: false })]),
  );
  t('markdown: an UNJUDGED row is recognised as such', isUnjudgedFinding(unjudgedRow[2]), true);
  t('markdown: …a judged H19 row is NOT', isUnjudgedFinding(h19BlockOutlivedBlocker(blockedCard(1), [target(2, 'closed')])), false);
  t('markdown: …and an ordinary row is NOT', isUnjudgedFinding('`pm:dispatched` with no assignee'), false);
  t('markdown: the explicit marker is recognised too', isUnjudgedFinding(`${UNJUDGED_MARKER} something could not be read`), true);
  const withUnjudged = renderMarkdown([...many, unjudgedRow], counts);
  t('markdown: the trim can never reach an UNJUDGED row', withUnjudged.includes('#9999'), true);
  t('markdown: …even though that row sorts LAST by card number', many.every(([i]) => i.number < 9999), true);
  t('markdown: …and the trim still fired', withUnjudged.includes('further row(s) omitted'), true);
  t('markdown: …and the body is still under budget', withUnjudged.length <= MARKDOWN_BODY_BUDGET, true);
  t('markdown: an UNJUDGED row is banner-announced', withUnjudged.includes('UNJUDGED row(s) in this sweep'), true);
  t('markdown: …and the banner says a later sweep will not fix it', withUnjudged.includes('nothing in a later sweep will resolve them'), true);
  t('markdown: no banner when nothing is unjudged', renderMarkdown([quietRow], counts).includes('UNJUDGED row(s) in this sweep'), false);
  // A loud P0 row still outranks an unjudged one: the emergency channel is the
  // more urgent of the two, and both survive the trim regardless.
  t('markdown: a loud row still sorts above an UNJUDGED one', renderMarkdown([unjudgedRow, loudRow], counts).indexOf('#900') < renderMarkdown([unjudgedRow, loudRow], counts).indexOf('#9999'), true);
  t('markdown: an UNJUDGED row sorts above an ordinary one', renderMarkdown([quietRow, unjudgedRow], counts).indexOf('#9999') < renderMarkdown([quietRow, unjudgedRow], counts).indexOf('#200'), true);
  // The plain renderer keeps the caller's order, as it always has.
  t('plain: applies no unjudged sort either', renderPlain([quietRow, unjudgedRow], counts).indexOf('#200') < renderPlain([quietRow, unjudgedRow], counts).indexOf('#9999'), true);

  // Provenance is caller-supplied text interpolated into one italic line: a
  // newline in it would break the header apart, so it is flattened, not trusted.
  t('provenance: newlines are collapsed to one line', normalizeProvenance('run 7\nsha abc'), 'run 7 sha abc');
  t('provenance: length-capped', normalizeProvenance('x'.repeat(500)).length, 300);
  t('provenance: absent leaves the swept line alone', renderMarkdown([], counts).includes('_Swept ') && !renderMarkdown([], counts).includes(' · undefined'), true);
  t('provenance: present is stamped after the timestamp', renderMarkdown([], counts, { provenance: 'run 7' }).includes(' · run 7_'), true);
  t('markdown: the sweep timestamp is the patrol heartbeat', renderMarkdown([], counts, { sweptAt: new Date('2026-08-19T06:00:00Z') }).includes('_Swept 2026-08-19T06:00:00.000Z'), true);

  // -- H17 section rendering, both media (#10034) ---------------------------
  // The section has three states and two of them read identically if you are
  // careless, so each is pinned by the sentence that distinguishes it.
  const idxRows = [
    { issue: { number: 8331, html_url: 'https://example.test/8331' }, files: ['.github/workflows/lint.yml'] },
    { issue: { number: 9139, html_url: 'https://example.test/9139' }, files: ['packages/lint/src/data-model-rules.ts', 'packages/lint/src/validate-security-posture.test.ts'] },
  ];
  const triggerIdx = { rows: idxRows, candidates: 79, probed: 79, tracked: 6360 };
  // Absent index -> byte-identical to the report this script always printed.
  t('H17 render: no index supplied renders no section at all', renderTriggerIndex(undefined).length, 0);
  t('H17 render: …so a two-argument renderPlain is unchanged', renderPlain([quietRow], counts).endsWith('not a gate verdict.'), true);
  // Present index, plain medium.
  const plainIdx = renderPlain([quietRow], counts, { triggerIndex: triggerIdx });
  t('H17 plain: the section is titled and present', plainIdx.includes('On-hold trigger-file index (H17)'), true);
  t('H17 plain: a row lists card and files', plainIdx.includes('  #9139 packages/lint/src/data-model-rules.ts, packages/lint/src/validate-security-posture.test.ts'), true);
  t('H17 plain: …with the card URL on its own line', plainIdx.includes('\n     https://example.test/9139'), true);
  // The placement constraint the terminal medium imposes: the summary sentence
  // stays LAST, and the index sits above it rather than after it.
  t('H17 plain: the summary sentence is still the last line', plainIdx.endsWith('not a gate verdict.'), true);
  t('H17 plain: …and the index sits above it', plainIdx.indexOf('On-hold trigger-file index') < plainIdx.indexOf('check-half-states: swept'), true);
  // Markdown medium.
  const mdIdx = renderMarkdown([quietRow], counts, { triggerIndex: triggerIdx });
  t('H17 markdown: the section renders as a heading', mdIdx.includes('### On-hold trigger-file index (H17)'), true);
  t('H17 markdown: a row is a link plus backticked paths', mdIdx.includes('- [#8331](https://example.test/8331) — `.github/workflows/lint.yml`'), true);
  t('H17 markdown: the section sits BELOW the findings', mdIdx.indexOf('### Findings') < mdIdx.indexOf('### On-hold trigger-file index'), true);
  t('H17 markdown: the intro states the measured failure it exists to end', mdIdx.includes('0-for-19'), true);
  t('H17 markdown: …and says it is report-only, not a finding', mdIdx.includes('a card here is a hold in good standing, never a finding'), true);
  t('H17 markdown: …and declares that it under-reports rather than invents', mdIdx.includes('under-reports and never invents'), true);
  // A clean board still gets the index: an empty FINDINGS list is exactly the
  // run on which a dispatching seat has nothing else to read.
  t('H17 markdown: a findings-clean sweep still renders the index', renderMarkdown([], counts, { triggerIndex: triggerIdx }).includes('### On-hold trigger-file index'), true);
  // Read-and-empty vs oracle-unreadable — the #4690 pair.
  const emptyIdx = renderMarkdown([], counts, { triggerIndex: { rows: [], candidates: 79, probed: 79, tracked: 6360 } });
  t('H17 empty: says the holds were READ', emptyIdx.includes('this is a clean reading, not an unread one'), true);
  t('H17 empty: …and does not claim an oracle failure', emptyIdx.includes('EMPTY BY FAILURE'), false);
  const noOracle = renderMarkdown([], counts, { triggerIndex: { rows: idxRows, candidates: 79, probed: 79, tracked: null } });
  t('H17 no-oracle: says the index is empty BY FAILURE', noOracle.includes('EMPTY BY FAILURE, not by finding'), true);
  t('H17 no-oracle: …and renders no row, so nothing unvalidated leaks out', noOracle.includes('#8331'), false);
  // The partial-read gap is stated, never implied.
  t('H17 partial: a partial hold read says so', renderMarkdown([], counts, { triggerIndex: { rows: [], candidates: 79, probed: 12, tracked: 10 } }).includes('read on 12 of 79'), true);
  // Budget: the index is RESERVED, so a board noisy enough to truncate the
  // findings list still carries the index — the property that keeps the
  // 0-for-19 silence from coming back through the renderer.
  const manyRows = Array.from({ length: 400 }, (_, i) => finding(1000 + i, 'H1', 'x'.repeat(400)));
  const crowded = renderMarkdown(manyRows, counts, { triggerIndex: triggerIdx });
  t('H17 budget: a truncated findings list still announces its trim', crowded.includes('further row(s) omitted'), true);
  t('H17 budget: …and the index survives the trim', crowded.includes('### On-hold trigger-file index'), true);
  // The budget, not the hard cap: reserving the index is what keeps the body
  // under MARKDOWN_BODY_BUDGET. Asserting only ISSUE_BODY_LIMIT would pass
  // even with the reservation removed (the index is ~1.5 KB and the two
  // numbers are 5.5 KB apart), i.e. it would pin nothing.
  t('H17 budget: …and the whole body stays inside the render budget', crowded.length <= MARKDOWN_BODY_BUDGET, true);
  t('H17 budget: …which the hard cap also bounds', crowded.length <= ISSUE_BODY_LIMIT, true);
  // The index's own overflow announces itself rather than truncating silently.
  const overflow = renderTriggerIndex(
    { rows: Array.from({ length: H17_INDEX_ROW_CAP + 3 }, (_, i) => ({ issue: { number: i, html_url: 'u' }, files: ['f'] })), candidates: 1, probed: 1, tracked: 1 },
    { markdown: true },
  ).join('\n');
  t('H17 budget: an over-cap index announces the omission', overflow.includes('3 further card(s) omitted'), true);
  t('H17 budget: …and renders exactly the cap', overflow.split('\n').filter((l) => /^- \[?#?\d/.test(l)).length, H17_INDEX_ROW_CAP);
  // The summary line's H17 half, mirroring the H16 `read X of Y` discipline.
  t('summaryLine: reports the H17 hold-comment reads', summaryLine({ ...counts, holdCandidates: 79, holdProbed: 79 }, 0).includes('Hold comments read on 79 of 79 H17 candidate(s)'), true);
  t('summaryLine: …and a partial hold read says so', summaryLine({ ...counts, holdCandidates: 79, holdProbed: 12 }, 0).includes('read on 12 of 79'), true);
  t('summaryLine: absent H17 counts degrade to 0, never to undefined', summaryLine(counts, 0).includes('Hold comments read on 0 of 0'), true);
  // The summary line's H9 half (#10403), same `read X of Y` discipline.
  t('summaryLine: reports the H9 restart-comment reads', summaryLine({ ...counts, restartCandidates: 7, restartProbed: 7 }, 0).includes('`Restart-when:` hold comments read on 7 of 7 H9 candidate(s)'), true);
  t('summaryLine: …and a partial restart read says so', summaryLine({ ...counts, restartCandidates: 7, restartProbed: 2 }, 0).includes("read on 2 of 7 H9 candidate(s) — each unread thread fires its own card's H9 row"), true);
  t('summaryLine: absent H9 counts degrade to 0, never to undefined', summaryLine(counts, 0).includes('`Restart-when:` hold comments read on 0 of 0'), true);

  // Usage. A mistyped --format must be a loud non-zero exit, never a silent
  // fallback that lands terminal lines in an issue body looking like a report.
  t('options: default format is plain', parseOutputOptions([]).format, 'plain');
  t('options: --format=markdown is accepted', parseOutputOptions(['--format=markdown']).format, 'markdown');
  t('options: an unknown format is a usage error', typeof parseOutputOptions(['--format=html']).error, 'string');
  t('options: …and does NOT silently fall back', parseOutputOptions(['--format=html']).error.includes('expected one of: plain, markdown'), true);
  t('options: --provenance is normalized on the way in', parseOutputOptions(['--provenance=a\n b']).provenance, 'a b');
  t('options: unrelated flags are ignored', parseOutputOptions(['--probe']).format, 'plain');

  // -- transport prerequisite (#7412) ---------------------------------------
  // The three container classes are REAL measurements, not invented fixtures;
  // each names where it was taken, so a future transport change can be checked
  // against the environments that actually exist rather than against a guess.
  const kind = (o) => classifyTransportProbe(o)?.kind;

  // Class 1 — PM seat session, #7412 as filed: the host refuses in both
  // directions with quota left. Must NOT be reported as a credential problem:
  // a real token would not have helped, and sending a seat to find one wastes
  // the round.
  t(
    '#7412 class 1 (PM seat): 403 both ways -> host-unreachable',
    kind({ token: 'prox_placeholder', authed: { status: 403, rateLimitRemaining: 59 }, anon: { status: 403, rateLimitRemaining: 59 } }),
    'host-unreachable',
  );
  // #10156: the shared classifier is imported by ci-failure.mjs (#9966), a
  // caller that runs no "sweep" and reads no "board" — so `host-unreachable`'s
  // fix text must not name either, in EITHER branch that returns this kind
  // (network error, and the 403-in-both-directions case pinned just above).
  t(
    "…and host-unreachable's fix (403-both-ways branch) names neither the sweep nor the board read",
    /the sweep|the board read/.test(
      classifyTransportProbe({ token: 'prox_placeholder', authed: { status: 403, rateLimitRemaining: 59 }, anon: { status: 403, rateLimitRemaining: 59 } }).fix.join(' '),
    ),
    false,
  );
  t(
    "…and host-unreachable's fix (network-error branch) names neither the sweep nor the board read",
    /the sweep|the board read/.test(classifyTransportProbe({ token: '', anon: { networkError: 'ENOTFOUND' } }).fix.join(' ')),
    false,
  );
  // Class 2 — triage Routine container: reachable with a real credential.
  t(
    '#7412 class 2 (Routine): authed 200 -> reachable',
    kind({ token: 'ghp_' + 'x'.repeat(36), authed: { status: 200, rateLimitRemaining: 14_999 } }),
    'reachable',
  );
  // Class 3a — a token GitHub rejects while anonymous still has quota. The
  // distinguishing case the card could not name: the ONLY fault is the
  // credential, and the remedy is a re-run, not a hunt for a token.
  t(
    'token 401 but anon has quota -> bad-credential-anon-reachable',
    kind({ token: 'prox_abcdefghi', authed: { status: 401, rateLimitRemaining: null }, anon: { status: 200, rateLimitRemaining: 59 } }),
    'bad-credential-anon-reachable',
  );
  t(
    'that verdict prescribes the token-less re-run, not a new credential',
    classifyTransportProbe({ token: 'prox_abcdefghi', authed: { status: 401 }, anon: { status: 200, rateLimitRemaining: 59 } }).fix[0].includes('GITHUB_TOKEN= GH_TOKEN='),
    true,
  );
  // Class 3b — the SAME container as actually measured on 2026-08-11: the token
  // 401s AND the shared-IP anonymous quota is spent. Dropping the token does not
  // help, so the verdict must not prescribe it — the first draft did, and the
  // prescribed command then failed with 403 on its first page.
  const class3 = classifyTransportProbe({
    token: 'prox_abcdefghi',
    authed: { status: 401, rateLimitRemaining: null },
    anon: { status: 200, rateLimitRemaining: 0 },
  });
  t('#7412 class 3 (cloud dev, measured): 401 + exhausted anon -> bad-credential', class3?.kind, 'bad-credential');
  t('…and it does NOT prescribe the token-less re-run', class3.fix.join(' ').includes('GITHUB_TOKEN= GH_TOKEN='), false);
  t('…and it names a real credential as the remedy', class3.fix[0].includes('a real GitHub token'), true);
  // #10443: bad-credential and bad-credential-anon-reachable are shared with
  // ci-failure.mjs (#9966), same as repo-scope-refused/host-unreachable/
  // repo-not-visible above — a caller that runs no "sweep" and reads no
  // "board". Cover both branches (anon-reachable and not).
  {
    const anonReachable = classifyTransportProbe({
      token: 'prox_abcdefghi',
      authed: { status: 401, rateLimitRemaining: null },
      anon: { status: 200, rateLimitRemaining: 59 },
    });
    t(
      "…and none of bad-credential-anon-reachable's prose names the sweep or the board read",
      /the sweep|the board read/.test([anonReachable.headline, ...anonReachable.detail, ...anonReachable.fix].join(' ')),
      false,
    );
    t(
      '…and its headline instead speaks caller-neutrally about the container',
      anonReachable.headline.includes('stopping this container from reading'),
      true,
    );
  }
  t(
    "…and none of bad-credential's (anon-unusable) prose names the sweep or the board read",
    /the sweep|the board read/.test([class3.headline, ...class3.detail, ...class3.fix].join(' ')),
    false,
  );

  // Class 4 — proxy-mediated cloud session, measured 2026-08-19 (#9946). The
  // account-scoped reading is not merely 200: it is GENUINELY GitHub's, with a
  // real request id and a real 15000-limit quota, and `GET /user` returns the
  // real login. It is byte-for-byte indistinguishable from class 2 above. Only
  // the repo-scoped read separates them, and it is refused with no
  // `x-ratelimit-*` headers at all — hence `rateLimitRemaining: null`.
  const class4 = {
    token: 'prox_abcdefghi',
    authed: { status: 200, rateLimitRemaining: 14_979 },
    repo: { status: 403, rateLimitRemaining: null },
  };
  t('#9946 class 4 (proxy-mediated, measured): repo-scoped 403 -> repo-scope-refused', kind(class4), 'repo-scope-refused');
  // The defect itself, pinned as its own case: the SAME container, classified
  // without the stage-2 reading, is the false green this item exists to end.
  // Dropping stage 2 must make this case go green again — which is what makes
  // the fixture above a real regression pin rather than a restatement.
  t(
    '…and WITHOUT the repo reading the very same observations read as reachable (the defect)',
    kind({ token: class4.token, authed: class4.authed }),
    'reachable',
  );
  // It must not be legible as a credential fault: the credential is fine here
  // (the proxy substitutes a working one), and sending a seat to hunt for a
  // token is the wasted round #7412 already paid for once.
  t('…and it is NOT reported as a bad credential', classifyTransportProbe(class4).kind.includes('credential'), false);
  t(
    '…and its evidence names the contradiction between the two stages',
    classifyTransportProbe(class4).detail.join(' ').includes('contradict'),
    true,
  );
  // #10156: repo-scope-refused is shared with ci-failure.mjs (#9966), a caller
  // that runs no "sweep" and reads no "board" — its headline/detail/fix must
  // describe what the CONTAINER cannot do, not what a caller-specific "sweep"
  // or "board read" cannot do.
  t(
    "…and none of its prose (headline, detail, fix) names the sweep or the board read",
    /the sweep|the board read/.test(
      [classifyTransportProbe(class4).headline, ...classifyTransportProbe(class4).detail, ...classifyTransportProbe(class4).fix].join(' '),
    ),
    false,
  );
  t(
    '…and its headline instead speaks caller-neutrally about the container',
    classifyTransportProbe(class4).headline.includes('this container cannot make one repo-scoped request'),
    true,
  );
  // Direction B, refused on the card: no vendor string is matched. The fixture
  // carries a status and a header count and NOTHING else — no response body is
  // observed at all — so a body-matching classifier could not have fired here.
  t(
    'the fourth class is matched with no response body in evidence at all',
    Object.keys(class4.repo).join(','),
    'status,rateLimitRemaining',
  );
  // Direction C, refused on the card: token SHAPE never gates. In this very
  // class the `prox…` placeholder IS swapped for a working credential, so shape
  // would have mispredicted it — and a real `ghp_` token behind the same proxy
  // must classify identically.
  t(
    'a github-shaped token behind the same proxy classifies identically',
    kind({ ...class4, token: 'ghp_' + 'x'.repeat(36) }),
    'repo-scope-refused',
  );
  t(
    'anonymous behind the same proxy classifies identically',
    kind({ token: '', anon: class4.authed, repo: class4.repo }),
    'repo-scope-refused',
  );
  // Class 2 extended (never rewritten — the one-observation case above still
  // stands): the real Routine container passes BOTH stages, and must stay green
  // now that a second stage exists.
  t(
    '#7412 class 2 (Routine) passes stage 2 as well -> still reachable',
    kind({ token: 'ghp_' + 'x'.repeat(36), authed: { status: 200, rateLimitRemaining: 14_999 }, repo: { status: 200, rateLimitRemaining: 14_998 } }),
    'reachable',
  );
  // A repo the identity cannot see. GitHub answers 404 rather than 403 for a
  // repository the caller may not know exists, so the verdict must name both
  // possible causes instead of picking one.
  t('repo-scoped 404 -> repo-not-visible', kind({ ...class4, repo: { status: 404, rateLimitRemaining: 4999 } }), 'repo-not-visible');
  t(
    '…and it sends the reader to PM_SWEEP_REPO first',
    classifyTransportProbe({ ...class4, repo: { status: 404, rateLimitRemaining: 4999 } }).fix[0].includes('PM_SWEEP_REPO'),
    true,
  );
  // #10443: repo-not-visible is shared with ci-failure.mjs (#9966) exactly like
  // repo-scope-refused above — a caller that runs no "sweep" and reads no
  // "board", so its headline/detail/fix must describe what the CONTAINER
  // cannot do, never what a caller-specific "sweep" would have found.
  {
    const notVisible404 = classifyTransportProbe({ ...class4, repo: { status: 404, rateLimitRemaining: 4999 } });
    t(
      "…and none of repo-not-visible's prose (headline, detail, fix) names the sweep or the board read",
      /the sweep|the board read/.test([notVisible404.headline, ...notVisible404.detail, ...notVisible404.fix].join(' ')),
      false,
    );
    t(
      '…and its headline instead speaks caller-neutrally about the container',
      notVisible404.headline.includes('this container cannot read it'),
      true,
    );
  }
  // A quota genuinely spent between the two stages wears the same 403 and has a
  // completely different remedy — it must not be reported as a scope refusal.
  t('repo-scoped 403 with remaining 0 is the quota, not a scope refusal', kind({ ...class4, repo: { status: 403, rateLimitRemaining: 0 } }), 'rate-limited');
  // Narrowness, in the same direction as the account-scoped branches: a stage-2
  // reading this classifier cannot name must not vouch for the transport EITHER.
  // Both of these used to be impossible to express; neither may silently pass.
  t('repo-scoped 5xx stays unclassified, and does NOT read as reachable', kind({ ...class4, repo: { status: 502 } }), undefined);
  t('a transient network error on stage 2 stays unclassified too', kind({ ...class4, repo: { networkError: 'ECONNRESET' } }), undefined);
  // Sequencing (`probeTransport`'s policy, pinned because the pure classifier
  // cannot enforce it): stage 2 fires on exactly the path that used to green,
  // and on no other — so no FAILING class costs a request more than before.
  t('needsRepoProbe: a reachable stage-1 spends the core request', needsRepoProbe({ kind: 'reachable' }), true);
  t('needsRepoProbe: host-unreachable does not', needsRepoProbe({ kind: 'host-unreachable' }), false);
  t('needsRepoProbe: bad-credential does not', needsRepoProbe({ kind: 'bad-credential' }), false);
  t('needsRepoProbe: rate-limited does not', needsRepoProbe({ kind: 'rate-limited' }), false);
  t('needsRepoProbe: an unclassified stage-1 does not', needsRepoProbe(null), false);
  // Exit-code contract: every stage-2 refusal routes to PREREQUISITE NOT MET
  // (exit 3), because the caller keys on `kind !== 'reachable'` and nothing else.
  t('the fourth class routes to PREREQUISITE NOT MET, not to a sweep', kind(class4) !== 'reachable', true);
  // The trap itself: `/rate_limit` is exempt from the limit it reports, so a
  // 200 with 0 remaining is an EXHAUSTED quota, never a green transport. A
  // status-only reading here green-lights a sweep that cannot run (#4690).
  t(
    '/rate_limit 200 with remaining 0 is rate-limited, NOT reachable',
    kind({ token: '', anon: { status: 200, rateLimitRemaining: 0 } }),
    'rate-limited',
  );
  t('probeIsUsable: 200 with quota left', probeIsUsable({ status: 200, rateLimitRemaining: 5 }), true);
  t('probeIsUsable: 200 with 0 left is NOT usable', probeIsUsable({ status: 200, rateLimitRemaining: 0 }), false);
  t('probeIsUsable: absent header is not evidence of exhaustion', probeIsUsable({ status: 200, rateLimitRemaining: null }), true);
  t('probeIsUsable: network error', probeIsUsable({ networkError: 'ECONNREFUSED' }), false);
  // `Number(null)` is 0, so the naive header read turns every 401 (which carries
  // no rate-limit headers) into a phantom exhausted quota and misprescribes the
  // remedy. Absent must mean unknown.
  t('parseRemaining: absent header is null, not 0', parseRemaining(null), null);
  t('parseRemaining: empty header is null, not 0', parseRemaining(''), null);
  t('parseRemaining: a real 0 survives', parseRemaining('0'), 0);
  t('parseRemaining: a real count survives', parseRemaining('4999'), 4999);
  t('parseRemaining: garbage is unknown, not 0', parseRemaining('n/a'), null);
  t('probeIsUsable: nothing observed', probeIsUsable(null), false);
  t(
    'describeProbe names the exemption in the evidence line',
    describeProbe({ status: 200, rateLimitRemaining: 0 }).includes('exempt from the limit it reports'),
    true,
  );
  // No token at all, host fine — the shape the old docblock assumed universal.
  t('no token + 200 -> reachable', kind({ token: '', anon: { status: 200, rateLimitRemaining: 60 } }), 'reachable');
  // A bad credential where anonymous ALSO fails must not promise that dropping
  // the token is enough.
  t(
    '401 with anon also refused -> bad-credential (not the anon-reachable remedy)',
    kind({ token: 'ghp_stale', authed: { status: 401 }, anon: { status: 403, rateLimitRemaining: 0 } }),
    'bad-credential',
  );
  // 403 WITH remaining:0 is the quota, not the proxy — different remedy.
  t('403 + remaining 0 -> rate-limited', kind({ token: '', anon: { status: 403, rateLimitRemaining: 0 } }), 'rate-limited');
  t(
    'exhausted anonymous quota prescribes a credential',
    classifyTransportProbe({ token: '', anon: { status: 403, rateLimitRemaining: 0 } }).fix[0].includes('GITHUB_TOKEN'),
    true,
  );
  t('network error -> host-unreachable', kind({ token: '', anon: { networkError: 'ENOTFOUND' } }), 'host-unreachable');
  // The narrowness that keeps a wrong confident diagnosis out: anything this
  // classifier cannot name stays unclassified, and the caller keeps its loud
  // generic failure (exit 2) rather than blaming a credential for a GitHub
  // outage or a typo'd PM_SWEEP_REPO.
  t('502 is not a prerequisite failure', classifyTransportProbe({ token: '', anon: { status: 502 } }), null);
  t('404 is not a prerequisite failure', classifyTransportProbe({ token: 'ghp_x', authed: { status: 404 } }), null);
  t('no observation at all -> unclassified', classifyTransportProbe({ token: '' }), null);
  // Token shape enriches the wording and never gates the request: an unknown
  // future prefix must still be SENT, so GitHub gets to be the judge.
  t('describeToken: classic prefix recognised', describeToken('ghp_abc').shape, 'github-prefix');
  t('describeToken: fine-grained prefix recognised', describeToken('github_pat_abc').shape, 'github-prefix');
  t('describeToken: legacy 40-hex recognised', describeToken('a'.repeat(40)).shape, 'legacy-40-hex');
  t('describeToken: proxy placeholder is unrecognized', describeToken('prox_abcdefghi').shape, 'unrecognized');
  t('describeToken: absent', describeToken('').present, false);
  // Redaction: prefix + length only. The #7412 report form, and never the token.
  t('describeToken: redacts to prefix + length', describeToken('ghp_secretsecret').redacted, 'ghp_… (len 16)');
  t(
    'a rendered verdict never contains the token body',
    JSON.stringify(classifyTransportProbe({ token: 'prox_SECRETVALUE', authed: { status: 401 }, anon: { status: 200 } })).includes('SECRETVALUE'),
    false,
  );

  // -- H24: `pm:queue` + a non-empty assignee (#11196 fix 1) ------------------
  // The two-field intersection, both directions, plus the three adjacent rows
  // that decline the shape (which is why it had no reader for 17 cards).
  const queued = (labels, assignees = [], extra = {}) => ({
    number: 10638,
    state: 'open',
    labels: labels.map((name) => ({ name })),
    assignees: assignees.map((login) => ({ login })),
    body: '',
    title: '',
    ...extra,
  });
  t('H24: queued + assignee -> finding', typeof h24QueuedWithAssignee(queued(['pm:queue'], ['os-elon'])), 'string');
  t('H24: queued + no assignee -> clean', h24QueuedWithAssignee(queued(['pm:queue'], [])), null);
  t('H24: assigned but not queued is out of scope (H1/H2 own it)', h24QueuedWithAssignee(queued(['pm:dispatched'], ['os-elon'])), null);
  t('H24: neither -> clean', h24QueuedWithAssignee(queued(['domain:skills'], [])), null);
  t('H24: a missing issue does not crash', h24QueuedWithAssignee(undefined), null);
  t('H24: …and the row names the login so residue and ownership are separable', h24row(queued(['pm:queue'], ['yinlianghui'])).includes('`yinlianghui`'), true);
  t('H24: every assignee is named, not just the first', h24row(queued(['pm:queue'], ['os-elon', 'qq9340100'])).includes('`qq9340100`'), true);
  t('H24: assignees given as plain logins are read too', typeof h24QueuedWithAssignee({ ...queued(['pm:queue']), assignees: ['os-elon'] }), 'string');
  // The ruling's ORDER, pinned: the rule fires on a human assignment too, and
  // the sentence carries the asymmetric remedy rather than an exemption.
  t('H24: a human assignment still fires (exemption is a later explicit marker)', typeof h24QueuedWithAssignee(queued(['pm:queue'], ['yinlianghui'])), 'string');
  t('H24: …and the row refuses the human-clearing write', h24row(queued(['pm:queue'], ['yinlianghui'])).includes('never be cleared by an agent'), true);
  t('H24: …and names the paired write it is owed', h24row(queued(['pm:queue'], ['os-elon'])).includes('同笔摘 assignee'), true);
  t('H24: …and names both contradicting readers', h24row(queued(['pm:queue'], ['os-elon'])).includes('dispatchable NOW'), true);
  // The closed gate, in mirror image to H22's open gate: one card, one row.
  t('H24: a CLOSED queued+assigned card is H22 residue, not this row', h24QueuedWithAssignee(queued(['pm:queue'], ['os-elon'], { state: 'closed' })), null);
  t('H24: …and H22 does fire on that same card', typeof h22ClosedCardPmResidue(queued(['pm:queue'], ['os-elon'], { state: 'closed', state_reason: 'completed' })), 'string');
  // An absent `state` is JUDGED — an unknown field must never act as a silent
  // exemption (#4690 direction).
  t('H24: an absent state field is judged, not exempted', typeof h24QueuedWithAssignee({ ...queued(['pm:queue'], ['os-elon']), state: undefined }), 'string');
  // The adjacent rows stay silent on the measured shape — the reason it needed
  // a row of its own rather than a widening.
  t('H24 adjacency: H1 is silent (the card HAS an assignee)', h1DispatchedNoAssignee(queued(['pm:queue'], ['os-elon'])), false);
  t('H24 adjacency: H3 is silent (only ONE label is present)', h3QueueAndDispatched(queued(['pm:queue'], ['os-elon'])), false);
  t('H24 adjacency: H2 is silent when the claim comment is complete', h2AssigneeNoClaimComment(queued(['pm:queue'], ['os-elon']), ['Claim: PM loop round 1\nSession: session_x']), false);

  // -- The paired-write remedy texts (#11196 fix 2) ---------------------------
  // H8's landing re-label and H19's unlock scan are the two rollback paths that
  // never named the assignee drop; both sentences name it now, and the
  // half-delivered branch must NOT (there the label and the claim are CORRECT).
  const pairedMerged = [{ number: 900, merged_at: '2026-08-22T10:00:00Z', body: 'Fixes #10638', head: { ref: 'x' } }];
  const pairedOpenHalf = [{ number: 901, merged_at: null, draft: true, body: 'Part of #10638', head: { ref: 'y' } }];
  t('H8: the full-delivery remedy names 同笔摘 assignee', h8row(queued(['pm:dispatched'], ['os-elon']), pairedMerged, []).includes('同笔摘 assignee'), true);
  t('H8: …and points at H24 as the state it prevents', h8row(queued(['pm:dispatched'], ['os-elon']), pairedMerged, []).includes('H24'), true);
  t('H8: …and keeps the human-assignment refusal', h8row(queued(['pm:dispatched'], ['os-elon']), pairedMerged, []).includes('never cleared by an agent'), true);
  t('H8: the HALF-delivered branch prescribes no assignee drop', h8row(queued(['pm:dispatched'], ['os-elon']), pairedMerged, pairedOpenHalf).includes('同笔摘 assignee'), false);
  t('H8: …and still says the label is correct there', h8row(queued(['pm:dispatched'], ['os-elon']), pairedMerged, pairedOpenHalf).includes('must NOT be dropped'), true);
  t('H19: the release text names 同笔摘 assignee', h19row(queued(['pm:blocked']), [{ key: 'objectstack-ai/objectstack#2', number: 2, local: true, state: 'closed' }]).includes('同笔摘 assignee'), true);
  t('H19: …on the unresolved branch too (one release contract, one sentence)', h19row(queued(['pm:blocked']), [{ key: 'objectstack-ai/cloud#2', number: 2, local: false, state: 'unresolved', detail: 'HTTP 404' }]).includes('同笔摘 assignee'), true);

  // -- H25 + the `pm:awaiting-maintainer` vocabulary (#11196 fix 5) -----------
  t('the ruled spelling is pm:-prefixed', AWAITING_MAINTAINER_LABEL, 'pm:awaiting-maintainer');
  t('H25: awaiting + pm:queue -> finding', typeof h25AwaitingMaintainerExclusivity(queued([AWAITING_MAINTAINER_LABEL, 'pm:queue'])), 'string');
  t('H25: …and the row names the coexisting label', h25row(queued([AWAITING_MAINTAINER_LABEL, 'pm:queue'])).includes('`pm:queue`'), true);
  t('H25: …and the specific lie, not a tidiness complaint', h25row(queued([AWAITING_MAINTAINER_LABEL, 'pm:on-hold'])).includes('Restart-when'), true);
  t('H25: awaiting ALONE -> clean', h25AwaitingMaintainerExclusivity(queued([AWAITING_MAINTAINER_LABEL])), null);
  t('H25: awaiting + a non-state label -> clean', h25AwaitingMaintainerExclusivity(queued([AWAITING_MAINTAINER_LABEL, 'domain:skills', 'priority:p0', 'pm:blocking'])), null);
  t('H25: no awaiting label -> out of scope however many states', h25AwaitingMaintainerExclusivity(queued(['pm:queue', 'pm:dispatched'])), null);
  t('H25: a CLOSED card is H22 residue, not a live exclusivity breach', h25AwaitingMaintainerExclusivity(queued([AWAITING_MAINTAINER_LABEL, 'pm:queue'], [], { state: 'closed' })), null);
  t('H25: a missing issue does not crash', h25AwaitingMaintainerExclusivity(undefined), null);
  t('H25: several conflicts are ALL named', h25row(queued([AWAITING_MAINTAINER_LABEL, 'pm:queue', 'needs-user-decision'])).includes('`needs-user-decision`'), true);
  for (const conflicting of AWAITING_MAINTAINER_EXCLUSIVE_LABELS) {
    t(`H25: awaiting + \`${conflicting}\` -> finding`, typeof h25AwaitingMaintainerExclusivity(queued([AWAITING_MAINTAINER_LABEL, conflicting])), 'string');
  }
  // The four readers the new state joins — each pinned in BOTH directions, so
  // the vocabulary cannot be half-added (the defect class this family is about).
  t('vocabulary: H13 treats awaiting as a real state -> clean', h13DomainWithoutPmState(domainCard(['domain:skills', AWAITING_MAINTAINER_LABEL], hoursAgo(200)), NOW), null);
  t('vocabulary: …while the same card without it is still H13', typeof h13DomainWithoutPmState(domainCard(['domain:skills'], hoursAgo(200)), NOW), 'string');
  t('vocabulary: H22 counts awaiting as residue on a closed card', h22row(closedCard([AWAITING_MAINTAINER_LABEL])).includes(`\`${AWAITING_MAINTAINER_LABEL}\``), true);
  t('vocabulary: …and an open card carrying it is not H22 residue', h22ClosedCardPmResidue(queued([AWAITING_MAINTAINER_LABEL])), null);
  t('vocabulary: H11 sees awaiting as a PARKED state', typeof h11ImportantParked(parkedCard(['bug', AWAITING_MAINTAINER_LABEL]), NOW), 'string');
  t('vocabulary: …and names it as the parked state', h11row(parkedCard(['bug', AWAITING_MAINTAINER_LABEL]), NOW).includes(`\`${AWAITING_MAINTAINER_LABEL}\``), true);
  t('vocabulary: …with the exit this state actually has (no Restart-when re-check)', h11row(parkedCard(['bug', AWAITING_MAINTAINER_LABEL]), NOW).includes('Restart-when'), false);
  t('vocabulary: …and it says the state has no machine exit', h11row(parkedCard(['bug', AWAITING_MAINTAINER_LABEL]), NOW).includes('NO machine exit'), true);
  t('vocabulary: H11 keeps the mechanical remedy for a BLOCKED card', h11row(parkedCard(['bug', 'pm:blocked']), NOW).includes('Restart-when'), true);
  t('vocabulary: a fresh awaiting park is still clean', h11ImportantParked(parkedCard(['bug', AWAITING_MAINTAINER_LABEL], { created: daysAgo(2) }), NOW), null);
  t('vocabulary: an UNimportant awaiting card is not inventory', h11ImportantParked(parkedCard([AWAITING_MAINTAINER_LABEL]), NOW), null);

  // -- H29 / H30 / H31: the half-state rule families of #11179 ---------------
  //
  // ⚠️ ASSERTION SHAPE. Every message assertion below goes through a helper
  // that checks `typeof` FIRST and returns a describing STRING when the
  // predicate has gone null. The neighbouring blocks assert
  // `predicate(...).includes(...)` directly, which turns a regression that
  // makes a row go silent into a `TypeError` crash at the first assertion
  // instead of a named failing case — recorded as an observation on the
  // sibling PR that landed H28, and honoured here for the new blocks rather
  // than by restructuring the existing ones (that restructuring is a diff of
  // its own, and this card must merge cleanly onto that PR).
  const says = (msg, needle) =>
    typeof msg === 'string' ? msg.includes(needle) : `NO MESSAGE (${msg === null ? 'null' : typeof msg})`;

  // -- H29: the pm state labels are ONE-OF, generally -------------------------
  const h29 = (labels, extra = {}) => h29PmStateExclusivity(queued(labels, [], extra));
  // The vocabulary itself, pinned in both halves so it cannot be half-extended.
  t('H29: the ONE-OF vocabulary is the awaiting state plus everything it excludes', PM_EXCLUSIVE_STATE_LABELS.length, 6);
  t('H29: …and needs-user-decision is one of the states, not a side label', PM_EXCLUSIVE_STATE_LABELS.includes('needs-user-decision'), true);
  t('H29: every state in the vocabulary has a claim clause', PM_EXCLUSIVE_STATE_LABELS.every((l) => typeof PM_STATE_CLAIM[l] === 'string' && PM_STATE_CLAIM[l].length > 0), true);
  t('H29: …and the claim map declares nothing the vocabulary does not carry', Object.keys(PM_STATE_CLAIM).every((l) => PM_EXCLUSIVE_STATE_LABELS.includes(l)), true);
  // The three `pm:*` sets are three different questions. Pinned pairwise so a
  // later reader cannot unify them on the strength of the similar names —
  // exactly the guard H22 already keeps against H13's set.
  t('H29: the exclusivity set is NOT H13\'s visibility set', PM_EXCLUSIVE_STATE_LABELS.join(',') === PM_STATE_LABELS.join(','), false);
  t('H29: …H13\'s carries `finding`, which is a card KIND, not a position', PM_STATE_LABELS.includes('finding') && !PM_EXCLUSIVE_STATE_LABELS.includes('finding'), true);
  t('H29: …and the identity stickers legally coexist with a state', PM_EXCLUSIVE_STATE_LABELS.includes('pm:seat') || PM_EXCLUSIVE_STATE_LABELS.includes('pm:epic'), false);
  t('H29: the exclusivity set is NOT H22\'s residue set', PM_EXCLUSIVE_STATE_LABELS.join(',') === PM_RESIDUE_LABELS.join(','), false);
  t('H29: …pm:blocking is an annotation ON a state, so it is not exclusive', PM_RESIDUE_LABELS.includes('pm:blocking') && !PM_EXCLUSIVE_STATE_LABELS.includes('pm:blocking'), true);
  t('H29: …while needs-user-decision is a position, so it IS exclusive', PM_EXCLUSIVE_STATE_LABELS.includes('needs-user-decision') && !PM_RESIDUE_LABELS.includes('needs-user-decision'), true);
  // The two pairs this card was filed on.
  t('H29: pm:queue + needs-user-decision -> finding', typeof h29(['pm:queue', 'needs-user-decision']), 'string');
  t('H29: …and it names BOTH claims, not just the labels', says(h29(['pm:queue', 'needs-user-decision']), 'a maintainer RULING is owed'), true);
  t('H29: …and quotes the queue definition the pair contradicts', says(h29(['pm:queue', 'needs-user-decision']), '无可问之事'), true);
  t('H29: pm:queue + pm:blocked -> finding', typeof h29(['pm:queue', 'pm:blocked']), 'string');
  t('H29: …and names the transition defect, not a tidiness complaint', says(h29(['pm:queue', 'pm:blocked']), 'ADD instead of a REPLACE'), true);
  t('H29: …and prescribes ONE write', says(h29(['pm:queue', 'pm:blocked']), 'in a single write'), true);
  t('H29: report-only — never a label from this script', says(h29(['pm:queue', 'pm:blocked']), 'never a label written from this script'), true);
  t('H29: not a loud finding', isLoudFinding(h29(['pm:queue', 'pm:blocked'])), false);
  // The live-board specimen, 2026-08-24: a THIRD pair, in a third direction.
  t('H29 live: #11534 (needs-user-decision + pm:blocked) -> finding', typeof h29(['documentation', 'needs-user-decision', 'domain:devx', 'pm:blocked']), 'string');
  t('H29 live: …and names both live states', says(h29(['documentation', 'needs-user-decision', 'domain:devx', 'pm:blocked']), '`pm:blocked`') === true && says(h29(['documentation', 'needs-user-decision', 'domain:devx', 'pm:blocked']), '`needs-user-decision`') === true, true);
  // Clean shapes.
  t('H29: one state alone -> clean', h29(['pm:queue']), null);
  t('H29: no state at all -> clean', h29(['domain:skills', 'bug']), null);
  t('H29: non-state pm:* labels are not states', h29(['pm:queue', 'pm:blocking', 'pm:retriage', 'priority:p0', 'domain:spec']), null);
  t('H29: a CLOSED card is H22 residue, not a live exclusivity breach', h29(['pm:queue', 'pm:blocked'], { state: 'closed' }), null);
  t('H29: a missing issue does not crash', h29PmStateExclusivity(undefined), null);
  t('H29: an absent state field is judged, not exempted', typeof h29(['pm:queue', 'pm:blocked'], { state: undefined }), 'string');
  // The two exclusions, each pinned in BOTH directions: silent here, and the
  // owning row does fire on the same card. One breach, one row.
  t('H29: pm:queue + pm:dispatched is H3\'s pair, not this row', h29(['pm:queue', 'pm:dispatched']), null);
  t('H29: …and H3 does fire on it', h3QueueAndDispatched(queued(['pm:queue', 'pm:dispatched'])), true);
  t('H29: any pair containing the awaiting state is H25\'s', h29([AWAITING_MAINTAINER_LABEL, 'pm:blocked']), null);
  t('H29: …and H25 does fire on it', typeof h25AwaitingMaintainerExclusivity(queued([AWAITING_MAINTAINER_LABEL, 'pm:blocked'])), 'string');
  for (const other of AWAITING_MAINTAINER_EXCLUSIVE_LABELS) {
    t(`H29: awaiting + \`${other}\` stays H25's row`, h29([AWAITING_MAINTAINER_LABEL, other]), null);
  }
  // …and an excluded pair does not silence the pairs no one else owns.
  const three29 = h29(['pm:queue', 'pm:dispatched', 'pm:blocked']);
  t('H29: three states -> the two pairs H3 does not own are still reported', typeof three29, 'string');
  t('H29: …naming queue + blocked', says(three29, '`pm:queue` (dispatchable NOW, with nothing left to ask) + `pm:blocked`'), true);
  t('H29: …and dispatched + blocked', says(three29, '`pm:dispatched` (an agent is working it under a live claim) + `pm:blocked`'), true);
  const awaitingPlusTwo = h29([AWAITING_MAINTAINER_LABEL, 'pm:queue', 'pm:blocked']);
  t('H29: awaiting alongside two others still reports the pair H25 cannot', typeof awaitingPlusTwo, 'string');
  t('H29: …and does not re-report the awaiting pairs', says(awaitingPlusTwo, AWAITING_MAINTAINER_LABEL), false);

  // -- H30: a `pm:queue` card rotting unclaimed --------------------------------
  const queueCard = (labels, updatedAt, extra = {}) => ({
    number: 10534,
    state: 'open',
    labels: labels.map((name) => ({ name })),
    assignees: [],
    body: '',
    title: '',
    updated_at: updatedAt,
    ...extra,
  });
  const h30 = (labels, updatedAt, extra = {}) => h30QueueRotting(queueCard(labels, updatedAt, extra), NOW);
  t('H30: queued and idle past the horizon -> finding', typeof h30(['pm:queue'], daysAgo(5)), 'string');
  t('H30: …and the row states the threshold it used', says(h30(['pm:queue'], daysAgo(5)), `threshold ${QUEUE_ROT_STALE_DAYS}d`), true);
  t('H30: …and the measured age', says(h30(['pm:queue'], daysAgo(5)), '~5d'), true);
  t('H30: …and asks for ONE explicit transition rather than a grade', says(h30(['pm:queue'], daysAgo(5)), 'ONE explicit transition'), true);
  t('H30: …naming the decision route the queue definition implies', says(h30(['pm:queue'], daysAgo(5)), '无可问之事'), true);
  t('H30: …and quotes the measured failure shape', says(h30(['pm:queue'], daysAgo(5)), '判断做了'), true);
  t('H30: report-only — never a label from this script', says(h30(['pm:queue'], daysAgo(5)), 'never a label written from this script'), true);
  t('H30: not a loud finding', isLoudFinding(h30(['pm:queue'], daysAgo(5))), false);
  // The horizon's edges.
  t('H30: under the horizon -> clean', h30(['pm:queue'], daysAgo(2)), null);
  t('H30: exactly at the horizon -> clean (strictly beyond fires)', h30(['pm:queue'], daysAgo(QUEUE_ROT_STALE_DAYS)), null);
  t('H30: just past it -> finding', typeof h30(['pm:queue'], daysAgo(QUEUE_ROT_STALE_DAYS + 0.5)), 'string');
  // #4690 direction: an unreadable stamp flags, never reads as fresh.
  t('H30: unreadable updated_at -> finding, not fresh', typeof h30(['pm:queue'], 'not-a-date'), 'string');
  t('H30: absent updated_at -> finding, not fresh', typeof h30(['pm:queue'], undefined), 'string');
  t('H30: …and the row says the stamp is what it could not read', says(h30(['pm:queue'], undefined), 'unreadable `updated_at`'), true);
  // Out of scope.
  t('H30: not queued -> out of scope however old', h30(['pm:blocked'], daysAgo(200)), null);
  t('H30: a CLOSED queued card is H22 residue', h30(['pm:queue'], daysAgo(200), { state: 'closed' }), null);
  t('H30: a missing issue does not crash', h30QueueRotting(undefined, NOW), null);
  // The live distribution the horizon was cut from (2026-08-24 board read):
  // the three oldest fire, the ordinary queue depth stays quiet.
  const NOW_11179 = Date.parse('2026-08-24T22:40:00Z');
  const live30 = (n, updatedAt) => h30QueueRotting({ ...queueCard(['pm:queue'], updatedAt), number: n }, NOW_11179);
  t('H30 live: #9997, idle since 08-19 -> finding', typeof live30(9997, '2026-08-19T15:24:06Z'), 'string');
  t('H30 live: #7251, idle since 08-19 -> finding', typeof live30(7251, '2026-08-19T20:35:45Z'), 'string');
  t('H30 live: #10735, idle ~3.4d -> finding', typeof live30(10735, '2026-08-21T13:10:51Z'), 'string');
  t('H30 live: #11150, idle ~1.9d -> clean (queue depth is not rot)', live30(11150, '2026-08-23T00:52:13Z'), null);
  t('H30 live: #11852, worked today -> clean', live30(11852, '2026-08-24T22:19:56Z'), null);
  // Adjacency: the aged rows next door decline this shape, which is why it
  // needed a row rather than a widening.
  t('H30 adjacency: H24 is silent (the card has no assignee)', h24QueuedWithAssignee(queueCard(['pm:queue'], daysAgo(5))), null);
  t('H30 adjacency: H18 is silent (no pm:retriage)', h18RetriageAged(queueCard(['pm:queue'], daysAgo(5)), NOW), null);
  t('H30 adjacency: H11 is silent (pm:queue is not a PARKED state)', h11ImportantParked({ ...queueCard(['bug', 'pm:queue'], daysAgo(5)), created_at: daysAgo(30) }, NOW), null);

  // -- H31: the contract-review gate's two carriers ---------------------------
  const gateCard = (labels, extra = {}) => ({
    number: 11427,
    state: 'open',
    labels: labels.map((name) => ({ name })),
    assignees: [],
    body: '',
    title: '',
    ...extra,
  });
  const gatePr = (number, labels, extra = {}) => ({
    number,
    merged_at: null,
    draft: true,
    body: 'Fixes #11427',
    head: { ref: `claude/issue-11427-x` },
    labels: labels.map((name) => ({ name })),
    ...extra,
  });
  const bare = gatePr(11844, ['documentation', 'size/l', 'tests']);
  const gated = gatePr(11844, ['documentation', 'size/l', CONTRACT_REVIEW_LABEL]);
  t('H31: gated card + a bare delivering PR -> finding', typeof h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL, 'pm:dispatched']), [bare]), 'string');
  t('H31: …and it names the PR that is missing the carrier', says(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [bare]), '#11844 (draft)'), true);
  t('H31: …and names both failure routes (hang never reached / PASS stopped half way)', says(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [bare]), 'already passed'), true);
  t('H31: bare card + a gated delivering PR -> finding', typeof h31ContractReviewCarrierSplit(gateCard(['pm:dispatched']), [gated]), 'string');
  t('H31: …and calls that the more dangerous half', says(h31ContractReviewCarrierSplit(gateCard([]), [gated]), 'more dangerous half'), true);
  t('H31: …because a stripped gate reads as a green light', says(h31ContractReviewCarrierSplit(gateCard([]), [gated]), '闸门被剥不是红灯是放行'), true);
  t('H31: both directions carry the read-back contract', says(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [bare]), 'READ-BACK'), true);
  t('H31: report-only — never a label from this script', says(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [bare]), 'never a label written from this script'), true);
  t('H31: …naming the rule that forbids it', says(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [bare]), '自查放行'), true);
  t('H31: not a loud finding', isLoudFinding(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [bare])), false);
  // Agreement, both ways, is clean.
  t('H31: both carriers gated -> clean', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [gated]), null);
  t('H31: neither carrier gated -> clean', h31ContractReviewCarrierSplit(gateCard(['pm:dispatched']), [bare]), null);
  t('H31: one gated + one bare delivering PR still fires and names the bare one', says(h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [gated, gatePr(11845, [])]), '#11845'), true);
  // The protocol's own intermediate state, NOT a finding: card-side first.
  t('H31: gated card with NO delivering open PR -> clean (card-side-first is legal)', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL, 'pm:blocked']), []), null);
  t('H31: …and a PR that delivers some OTHER card does not start the comparison', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [{ ...bare, body: 'Fixes #9999', head: { ref: 'claude/issue-9999-x' } }]), null);
  // A merged carrier is a closed-out stroke, not a live half-write.
  t('H31: a MERGED delivering PR is out of scope', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [{ ...bare, merged_at: '2026-08-24T01:00:00Z' }]), null);
  // #4690, in the direction that matters here: an unreadable carrier must not
  // be read as a bare one, or a read failure manufactures a gate finding.
  t('H31: a PR row whose labels could not be read is not judged as bare', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [{ ...bare, labels: undefined }]), null);
  t('H31: …and one readable bare PR alongside it still fires', typeof h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [{ ...bare, labels: undefined }, gatePr(11845, [])]), 'string');
  // The delivery relation is H8's, shared rather than re-derived.
  t('H31: the branch-name fallback delivers a body-silent PR', typeof h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), [{ ...bare, body: '' }]), 'string');
  t('H31: …and H8 reads the same PR as delivering the same card', prDeliversCard({ ...bare, body: '' }, '11427'), true);
  t('H31: a CLOSED card is out of scope', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL], { state: 'closed' }), [bare]), null);
  t('H31: a missing issue does not crash', h31ContractReviewCarrierSplit(undefined, [bare]), null);
  t('H31: an absent PR listing does not crash', h31ContractReviewCarrierSplit(gateCard([CONTRACT_REVIEW_LABEL]), undefined), null);
  // The live specimen, 2026-08-24, byte-shaped: card #11427 gated, its
  // delivering draft PR #11844 carrying every label EXCEPT the gate.
  const live11427 = gateCard(['bug', 'pm:dispatched', 'domain:services', CONTRACT_REVIEW_LABEL]);
  const live11844 = {
    number: 11844,
    merged_at: null,
    draft: true,
    body: 'Fixes #11427\n\nhydrate a tombstoned sys_file that still has a live holder',
    head: { ref: 'claude/issue-11427-file-hydration-tombstone' },
    labels: ['documentation', 'size/l', 'dependencies', 'tests', 'tooling'].map((name) => ({ name })),
  };
  t('H31 live: #11427 gated while its delivering PR #11844 is not -> finding', typeof h31ContractReviewCarrierSplit(live11427, [live11844]), 'string');
  t('H31 live: …and the row names the PR', says(h31ContractReviewCarrierSplit(live11427, [live11844]), '#11844 (draft)'), true);
  // …and #10025, the other live carrier: gated, `pm:blocked`, no open PR at
  // all — the shape this row deliberately does NOT report.
  t('H31 live: #10025 (gated, no PR carrier yet) -> clean', h31ContractReviewCarrierSplit({ ...gateCard(['domain:services', 'pm:blocked', CONTRACT_REVIEW_LABEL]), number: 10025 }, [live11844]), null);

  // -- The window arithmetic (#11118) ----------------------------------------
  // The derivation is executable so that a cap and the sentence justifying it
  // cannot drift apart again: H8's docblock quoted `~18 merges/day` while the
  // repo ran at ~132, which turned a claimed ~11-day reach into ~1.8 days with
  // nothing able to notice.
  t('windows: coverage is rows / rate', windowCoverageDays(400, 100), 4);
  t('windows: H8 four pages against the measured rate', Number(windowCoverageDays(MERGED_WINDOW_PAGES * 100, MEASURED_MERGES_PER_DAY).toFixed(2)), 2.91);
  t('windows: …which is what the live reading measured (2.96d), within a rounding', windowCoverageDays(MERGED_WINDOW_PAGES * 100, MEASURED_MERGES_PER_DAY) > 2.5, true);
  t('windows: the OLD two-page cap was under two days, not the ~11 its prose claimed', Number(windowCoverageDays(200, MEASURED_MERGES_PER_DAY).toFixed(2)), 1.45);
  t('windows: …and the stale ~18/day figure is what produced the ~11-day claim', Number(windowCoverageDays(200, 18).toFixed(1)), 11.1);
  t('windows: H23 keeps three pages', COMMIT_WINDOW_PAGES, 3);
  t('windows: …and its re-measured coverage still clears two days', windowCoverageDays(COMMIT_WINDOW_PAGES * 100, MEASURED_MERGES_PER_DAY) > 2, true);
  t('windows: H22 widened to four pages', CLOSED_ISSUE_WINDOW_PAGES, 4);
  t('windows: H8 widened to four pages', MERGED_WINDOW_PAGES, 4);
  // The cadence side: a window is a detection HORIZON, and the overlap says how
  // many runs see a row before it is gone for good.
  t('windows: the patrol cadence is the workflow\'s', PATROL_CADENCE_HOURS, 6);
  t('windows: overlap is coverage over cadence', sweepOverlap(1, 6), 4);
  t('windows: H8\'s new window is seen by ~12 runs', Math.round(sweepOverlap(windowCoverageDays(400, MEASURED_MERGES_PER_DAY))), 12);
  t('windows: H22\'s OLD 0.65d reading was ~2.6 runs (the thin one)', Number(sweepOverlap(0.65).toFixed(1)), 2.6);
  t('windows: H22\'s measured new reading is ~6.8 runs', Number(sweepOverlap(1.7).toFixed(1)), 6.8);
  // Degenerate inputs answer "cannot divide" rather than Infinity or NaN — a
  // number no reading produced must never be renderable as a boundary.
  t('windows: a zero rate cannot divide', windowCoverageDays(200, 0), null);
  t('windows: a negative rate cannot divide', windowCoverageDays(200, -5), null);
  t('windows: a missing rate cannot divide', windowCoverageDays(200, undefined), null);
  t('windows: a missing row count cannot divide', windowCoverageDays(undefined, 137.5), null);
  t('windows: a zero cadence has no overlap', sweepOverlap(2, 0), null);
  t('windows: an unusable coverage has no overlap', sweepOverlap(null), null);

  // -- H26: a block whose target can never close, + the stale chain (#11219) --
  // The measured cards, by name, and both directions of every leg.
  const waiting = (number = 1119) => ({
    number,
    state: 'open',
    labels: [{ name: 'pm:blocked' }],
    assignees: [],
    body: 'Blocked-by: #987',
    title: '',
  });
  const tgt = (number, labels, extra = {}) => ({
    key: `objectstack-ai/cloud#${number}`,
    number,
    local: true,
    state: 'open',
    labels,
    ...extra,
  });
  t('H26: target parked in pm:on-hold -> finding', typeof h26BlockOnIndefiniteTarget(waiting(), [tgt(987, ['pm:on-hold'])]), 'string');
  t('H26: …and the row says the block has no releasing mechanism', h26row(waiting(), [tgt(987, ['pm:on-hold'])]).includes('NO MECHANISM THAT WILL EVER RELEASE IT'), true);
  t('H26: …and names the target and its state', h26row(waiting(), [tgt(987, ['pm:on-hold'])]).includes('`#987` (`pm:on-hold`)'), true);
  t('H26: target parked in needs-user-decision -> finding', typeof h26BlockOnIndefiniteTarget(waiting(75), [tgt(68, ['needs-user-decision'])]), 'string');
  t('H26: a target carrying BOTH indefinite states names both', h26row(waiting(), [tgt(987, ['pm:on-hold', 'needs-user-decision'])]).includes('`pm:on-hold` + `needs-user-decision`'), true);
  // The clean directions — an ordinary open target is not this row's business.
  t('H26: an ordinary open target -> clean', h26BlockOnIndefiniteTarget(waiting(), [tgt(987, ['pm:queue', 'domain:devx'])]), null);
  t('H26: an unlabelled open target -> clean', h26BlockOnIndefiniteTarget(waiting(), [tgt(987, [])]), null);
  t('H26: no targets at all -> no row (H4 owns the missing line)', h26BlockOnIndefiniteTarget(waiting(), []), null);
  t('H26: absent resolutions -> no row', h26BlockOnIndefiniteTarget(waiting(), undefined), null);
  t('H26: the label gate outranks an indefinite target', h26BlockOnIndefiniteTarget({ ...waiting(), labels: [{ name: 'pm:queue' }] }, [tgt(987, ['pm:on-hold'])]), null);
  // A CLOSED target is H19's row, never this one: it closed, so the unlock CAN
  // fire — the two items must not double-report one target.
  t('H26: a CLOSED target is H19\'s row, not this one', h26BlockOnIndefiniteTarget(waiting(), [{ ...tgt(987, ['pm:on-hold']), state: 'closed' }]), null);
  t('H26: …and H19 does fire on it', typeof h19BlockOutlivedBlocker(waiting(), [{ ...tgt(987, ['pm:on-hold']), state: 'closed' }]), 'string');
  // An unresolved target is silent HERE and loud in H19 — one gap, one row.
  t('H26: an unresolved target is silent (H19 owns the unjudged sentence)', h26BlockOnIndefiniteTarget(waiting(), [{ ...tgt(987, null), state: 'unresolved', detail: 'HTTP 404' }]), null);
  t('H26: …and a labels-less open row cannot be judged either', h26BlockOnIndefiniteTarget(waiting(), [{ ...tgt(987, undefined) }]), null);
  t('H26: …while H19 states that gap', h19row(waiting(), [{ ...tgt(987, null), state: 'unresolved', detail: 'HTTP 404' }]).includes('UNJUDGED'), true);
  // The chain leg.
  t('H26: a target that is itself pm:blocked -> the transitive row', typeof h26BlockOnIndefiniteTarget(waiting(1395), [tgt(10101, ['pm:blocked'])]), 'string');
  t('H26: …and it says to look one level further', h26row(waiting(1395), [tgt(10101, ['pm:blocked'])]).includes('TRANSITIVE'), true);
  t('H26: …and does not claim the block can never release', h26row(waiting(1395), [tgt(10101, ['pm:blocked'])]).includes('NO MECHANISM'), false);
  // Both legs at once, on two different targets, in one row.
  const bothLegs = String(h26BlockOnIndefiniteTarget(waiting(), [tgt(987, ['pm:on-hold']), tgt(10101, ['pm:blocked'])]) ?? '');
  t('H26: both legs report together', bothLegs.includes('NO MECHANISM THAT WILL EVER RELEASE IT') && bothLegs.includes('TRANSITIVE'), true);
  // A target that is BOTH parked and blocked is named ONCE, under the reading
  // that ends the wait forever rather than the one that merely lengthens it.
  const bothOnOne = String(h26BlockOnIndefiniteTarget(waiting(), [tgt(987, ['pm:on-hold', 'pm:blocked'])]) ?? '');
  t('H26: a parked AND blocked target is named once, as indefinite', bothOnOne.includes('NO MECHANISM THAT WILL EVER RELEASE IT'), true);
  t('H26: …and not a second time as a chain', bothOnOne.includes('TRANSITIVE'), false);
  // A partially indefinite block still reports: one live blocker does not make
  // the indefinite one fireable.
  t('H26: one indefinite target among open ones still fires', typeof h26BlockOnIndefiniteTarget(waiting(), [tgt(900, ['pm:queue']), tgt(987, ['pm:on-hold'])]), 'string');
  // The render cap, shared with H19 so one card cannot flood the anchor body.
  const manyIndefinite = String(h26BlockOnIndefiniteTarget(waiting(), [1, 2, 3, 4, 5, 6, 7].map((n) => tgt(n, ['pm:on-hold']))) ?? '');
  t('H26: the target list is capped like H19\'s', manyIndefinite.includes(`+${7 - H19_TARGET_LIST_CAP} more`), true);
  t('H26: …and still counts the full set', manyIndefinite.includes('on 7 target(s)'), true);
  // Cross-repo targets are addressed by full key, as in H19's rows.
  t('H26: a cross-repo target is named owner/repo#N', h26row(waiting(), [{ ...tgt(68, ['needs-user-decision']), local: false, key: 'objectstack-ai/objectos#68' }]).includes('`objectstack-ai/objectos#68`'), true);
  // Both rows can fire on ONE card — different halves of one wait.
  const expiredAndIndefinite = [{ ...tgt(900, ['pm:queue']), state: 'closed' }, tgt(987, ['pm:on-hold'])];
  t('H26 + H19: a partially expired, partially indefinite block fires both', Boolean(h19BlockOutlivedBlocker(waiting(), expiredAndIndefinite)) && Boolean(h26BlockOnIndefiniteTarget(waiting(), expiredAndIndefinite)), true);

  // -- The UNGATED liveness read + H28: the stale body line (#11747) ----------
  //
  // The fixture is the measured card's RECORDED BYTE SHAPE, not a sketch: body
  // `Blocked-by: #9255` (closed 2026-08-19) plus the re-park's comment, which
  // states the new blocker in the backticked-key spelling the census recorded
  // (`Blocked-by:` #11501, open and dispatched). Both legs of the reverse
  // verification run over these same bytes.
  const REPARK_BODY = 'Blocked-by: #9255\n\nSome further prose about the card.';
  const REPARK_COMMENT =
    'PM re-park 2026-08-24: #9255 discharged, but the real prerequisite is carded.\n' +
    '`Blocked-by:` #11501';
  const reparked = { ...issue(['pm:blocked'], [], REPARK_BODY), number: 9592, state: 'open' };
  const reparkKeys = (comments) =>
    blockerTargetsFor(reparked, comments, 'objectstack-ai/objectstack').map((t2) => t2.key).join(' ');

  // The GATE — the whole defect in two lines. H4's gate skips this card because
  // its body carries a line; the liveness gate must NOT, or the live blocker is
  // invisible to the only item that asks whether the wait is still running.
  t('H28 gate: H4\'s gate skips a blocked card that HAS a body line', needsBlockedByComments(reparked), false);
  t('H28 gate: …while the liveness gate reads it anyway', needsBlockerLivenessComments(reparked), true);
  t('H28 gate: the liveness gate is the label alone, body-clean or not', needsBlockerLivenessComments(blockedCard(1, 'no line here')), true);
  t('H28 gate: a card without the label buys no liveness fetch', needsBlockerLivenessComments(blockedCard(1, 'Blocked-by: #2', ['pm:queue'])), false);
  t('H28 gate: a pm:blocking card is out of scope here too', needsBlockerLivenessComments(blockedCard(1, '', ['pm:blocking'])), false);
  t('H28 gate: a missing issue does not crash', needsBlockerLivenessComments(undefined), false);

  // REVERSE VERIFICATION, both legs, over the recorded bytes.
  // OLD behaviour = what the gate produced: the comment channel never reached
  // the liveness read, so the card resolved ONE target and it was closed.
  const asSwept = reparkKeys(undefined);
  t('H28 repro (OLD, gated): only the stale body target is resolved', asSwept, 'objectstack-ai/objectstack#9255');
  const falseCandidate = String(h19BlockOutlivedBlocker(reparked, [target(9255, 'closed', { closedAt: '2026-08-19T11:28:26Z' })]) ?? '');
  t('H28 repro (OLD, gated): H19 publishes 1 of 1 CLOSED', falseCandidate.includes('1 of 1 `Blocked-by:` target(s)'), true);
  t('H28 repro (OLD, gated): …as a FULL discharge — the false unlock candidate', falseCandidate.includes('Every target it names is closed'), true);
  t('H28 repro (OLD, gated): …and never says PARTIAL', falseCandidate.includes('PARTIAL'), false);
  // NEW behaviour = ungated: both channels, so the live blocker is resolved too.
  const ungated = [target(9255, 'closed', { closedAt: '2026-08-19T11:28:26Z' }), target(11501, 'open')];
  t('H28 repro (NEW, ungated): both channels are unioned', reparkKeys([REPARK_COMMENT]), 'objectstack-ai/objectstack#9255 objectstack-ai/objectstack#11501');
  const partialNow = String(h19BlockOutlivedBlocker(reparked, ungated) ?? '');
  t('H28 repro (NEW, ungated): H19 reads 1 of 2', partialNow.includes('1 of 2 `Blocked-by:` target(s)'), true);
  t('H28 repro (NEW, ungated): …and calls it a PARTIAL discharge', partialNow.includes('PARTIAL'), true);
  t('H28 repro (NEW, ungated): …naming the live blocker as still open', partialNow.includes('`#11501`'), true);
  t('H28 repro (NEW, ungated): …and no longer claims every target closed', partialNow.includes('Every target it names is closed'), false);

  // The PAIRED row — what ungating alone does not say.
  const stale9592 = h28StaleBodyBlockerLine(reparked, ungated, [REPARK_COMMENT], 'objectstack-ai/objectstack');
  const stale9592Row = String(stale9592 ?? '');
  t('H28: the re-park shape fires', typeof stale9592, 'string');
  t('H28: …naming the spent BODY target', stale9592Row.includes('`#9255` (closed 2026-08-19T11:28:26Z)'), true);
  t('H28: …and the live COMMENT target', stale9592Row.includes('`#11501`'), true);
  t('H28: …calling the body line STALE', stale9592Row.includes('the body line is ') && stale9592Row.includes('STALE'), true);
  t('H28: …and asking for the migration to the canonical home', stale9592Row.includes('rewrite the body line to name the live blocker'), true);
  t('H28: …naming the re-park as the write that produced it', stale9592Row.includes('RE-PARK'), true);
  t('H28: …and recording the false unlock candidate the gate used to publish', stale9592Row.includes('FALSE unlock candidate'), true);
  t('H28: report-only, never a body written from this script', stale9592Row.includes('never a body or a label written from this script'), true);
  // H19 and H28 fire TOGETHER on this card — different halves of one wait.
  t('H28 + H19: both rows fire on the re-parked card', Boolean(partialNow) && Boolean(stale9592), true);

  // NEGATIVES — each half of the conjunction alone is a different state.
  t('H28: a closed body target with NO live comment target is H19\'s row alone', h28StaleBodyBlockerLine(reparked, [target(9255, 'closed')], ['no line in this comment'], 'objectstack-ai/objectstack'), null);
  t('H28: …and H19 does fire on it', typeof h19BlockOutlivedBlocker(reparked, [target(9255, 'closed')]), 'string');
  t('H28: an OPEN body target beside an open comment target -> no row', h28StaleBodyBlockerLine(reparked, [target(9255, 'open'), target(11501, 'open')], [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  // A target named in BOTH channels is already in the canonical home: there is
  // nothing to migrate, so the closed-body half alone must not fire.
  const bothChannels = { ...issue(['pm:blocked'], [], 'Blocked-by: #9255'), number: 9592 };
  t('H28: a target stated in both channels is not a migration candidate', h28StaleBodyBlockerLine(bothChannels, [target(9255, 'closed'), target(11501, 'open')], ['Blocked-by: #9255'], 'objectstack-ai/objectstack'), null);
  // Unresolved targets are H19's unjudged sentence, never a migration order.
  t('H28: an UNRESOLVED comment target is silent (a migration built on a guess)', h28StaleBodyBlockerLine(reparked, [target(9255, 'closed'), { ...target(11501, 'unresolved'), detail: 'HTTP 404' }], [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  t('H28: an UNRESOLVED body target is silent too', h28StaleBodyBlockerLine(reparked, [{ ...target(9255, 'unresolved'), detail: 'HTTP 404' }, target(11501, 'open')], [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  // The channel inputs the sweep can hand it, and the label gate.
  t('H28: an unconsulted comment thread -> no row', h28StaleBodyBlockerLine(reparked, ungated, undefined, 'objectstack-ai/objectstack'), null);
  t('H28: an unreadable comment thread -> no row (H4 owns that sentence)', h28StaleBodyBlockerLine(reparked, ungated, null, 'objectstack-ai/objectstack'), null);
  t('H28: a body with no line at all -> no row (the comment IS the only home)', h28StaleBodyBlockerLine({ ...reparked, body: 'no line here' }, [target(11501, 'open')], [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  t('H28: no resolutions -> no row', h28StaleBodyBlockerLine(reparked, [], [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  t('H28: absent resolutions -> no row', h28StaleBodyBlockerLine(reparked, undefined, [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  t('H28: the label gate outranks the shape', h28StaleBodyBlockerLine({ ...reparked, labels: [{ name: 'pm:queue' }] }, ungated, [REPARK_COMMENT], 'objectstack-ai/objectstack'), null);
  // The channel split reads the SAME spellings the union does — a split that
  // recognised fewer would report migrations for targets nothing resolved.
  t('H28 split: the plain body spelling', [...blockerChannelKeys('Blocked-by: #9255', reparked, 'objectstack-ai/objectstack')].join(' '), 'objectstack-ai/objectstack#9255');
  t('H28 split: the backticked-key comment spelling', [...blockerChannelKeys('`Blocked-by:` #11501', reparked, 'objectstack-ai/objectstack')].join(' '), 'objectstack-ai/objectstack#11501');
  t('H28 split: a cross-repo ref keeps its full key', [...blockerChannelKeys('Blocked-by: objectui#4356', reparked, 'objectstack-ai/objectstack')].join(' '), 'objectstack-ai/objectui#4356');
  t('H28 split: a self-reference is dropped, as in the union', [...blockerChannelKeys('Blocked-by: #9592', reparked, 'objectstack-ai/objectstack')].join(' '), '');
  t('H28 split: a mid-sentence prose mention is NOT a directive', [...blockerChannelKeys('the stated **Blocked-by: #9255** is discharged', reparked, 'objectstack-ai/objectstack')].join(' '), '');
  t('H28 split: no text at all is an empty set', blockerChannelKeys(undefined, reparked, 'objectstack-ai/objectstack').size, 0);
  // Multiple stale/live targets are counted and capped like every other row.
  const manyStale = String(h28StaleBodyBlockerLine(
    { ...issue(['pm:blocked'], [], 'Blocked-by: #1\nBlocked-by: #2'), number: 9592 },
    [target(1, 'closed'), target(2, 'closed'), target(11501, 'open')],
    [REPARK_COMMENT],
    'objectstack-ai/objectstack',
  ) ?? '');
  t('H28: two stale body targets are counted', manyStale.includes('names 2 CLOSED'), true);
  t('H28: …and the live one is still named', manyStale.includes('`#11501`'), true);

  // -- H32 — a HELD seat idle over a non-empty lane queue (#11706) ------------
  //
  // Driven with the REAL seat-title shapes from the 2026-08-25 census (all 12
  // open seat posts), because every gate in this row is a read of that title
  // and invented spellings would prove nothing about the population it runs on.
  const NOW32 = Date.parse('2026-08-25T08:00:00Z');
  const minsAgo = (m) => new Date(NOW32 - m * 60_000).toISOString();
  const seat = (title, comments = 0) => ({
    ...issue(['pm:seat'], [], '', title),
    number: 6017,
    comments,
  });
  const HELD = '[PM seat] domain:spec — 🟢 session_01NDGG54XF5gbTLdQzCtnaVV · R6 dispatch wave (batch:5)';
  const marker = (body, m) => ({ body, createdAt: minsAgo(m) });
  const busy = { unclaimed: 15, inFlight: 7 };
  const idleLane = { unclaimed: 15, inFlight: 0 };

  // The `@ <repo>` specimens below DERIVE both board names rather than spelling
  // them, because `seatLane` judges an at-repo suffix against the LIVE resolved
  // sweep repo — `SWEEP_REPO`, not a constant. A row that hard-codes `objectui`
  // as the sibling and `objectstack` as the own board therefore asserts THIS
  // BOARD instead of the property, and inverts wholesale wherever the file is
  // installed next: run verbatim in objectui on 2026-08-28 the suite failed
  // exactly the four rows those two names feed, which is the one thing a file
  // adopted BY COPY (see `resolveSweepRepo`) may not do. `OWN_BOARD` is the
  // resolved repo's name half — the same half the predicate compares, derived
  // here rather than shared, so a predicate that switched to the OWNER half
  // still goes red. `SIBLING_BOARD` is a real neighbouring board picked so the
  // two can never coincide, which is what stops the FOREIGN rows going
  // vacuously green on a board that happens to be named after the specimen.
  const OWN_BOARD = SWEEP_REPO.repo.split('/')[1];
  const SIBLING_BOARD = OWN_BOARD === 'objectui' ? 'objectstack' : 'objectui';
  const ownLaneSeat = (status = '🟢 os-x') => seat(`[PM seat] domain:devx @ ${OWN_BOARD} — ${status}`);
  const siblingLaneSeat = (status = '🟢 os-x') => seat(`[PM seat] domain:devx @ ${SIBLING_BOARD} — ${status}`);

  // The lane parse, across the three measured title shapes.
  t('H32 lane: a plain domain lane is own-board', seatLane(seat(HELD)).lane, 'domain:spec');
  t('H32 lane: …and not foreign', seatLane(seat(HELD)).foreign, false);
  t('H32 lane: an `@ sibling` suffix is FOREIGN', seatLane(siblingLaneSeat()).foreign, true);
  t('H32 lane: an `@ own-repo` suffix is NOT foreign', seatLane(ownLaneSeat()).foreign, false);
  t('H32 lane: …and keeps the bare lane label', seatLane(ownLaneSeat()).lane, 'domain:devx');
  t('H32 lane: a repo-scoped seat has no countable lane', seatLane(seat('[PM seat] repo:cloud — 🟢 os-x')).lane, null);
  t('H32 lane: …and is foreign', seatLane(seat('[PM seat] repo:cloud — 🟢 os-x')).foreign, true);
  t('H32 lane: a lane-less seat (skills) is foreign', seatLane(seat('[PM seat] skills — 🟢 os-zhuang (session_x)')).foreign, true);
  t('H32 lane: the triage seat is foreign', seatLane(seat('[PM seat] triage (objectstack-wide) — 🟢 Routine')).foreign, true);
  t('H32 lane: an unparseable title is foreign, never guessed', seatLane(seat('not a seat title')).foreign, true);

  // The held/vacant gate — an unheld seat is a ROUTING gap, never 怠工.
  t('H32 held: 🟢 with a holder', seatIsHeld(seat(HELD)), true);
  t('H32 held: ⏳ vacant is NOT held', seatIsHeld(siblingLaneSeat('⏳ vacant')), false);
  t('H32 held: 🔴 收班 vacant is NOT held', seatIsHeld(seat('[PM seat] domain:spec — 🔴 收班 vacant · 上一班 os-warren')), false);
  t('H32 held: ⏸️ paused is NOT held', seatIsHeld(seat('[PM seat] domain:spec — ⏸️ paused')), false);
  t('H32 held: a Routine seat is excluded (no claim cadence of its own)', seatIsHeld(seat('[PM seat] triage (objectstack-wide) — 🟢 Routine')), false);

  // The board halves — both required.
  t('H32: held + idle lane + stale marker -> finding', typeof h32SeatIdleOverQueue(seat(HELD), marker('Round-start marker — R6.', 600), idleLane, NOW32), 'string');
  t('H32: …and it names the lane', h32row(seat(HELD), marker('Round-start marker — R6.', 600), idleLane, NOW32).includes('`domain:spec`'), true);
  t('H32: …and the unclaimed count', h32row(seat(HELD), marker('Round-start marker — R6.', 600), idleLane, NOW32).includes('15 unclaimed'), true);
  t('H32: work IN FLIGHT is a working seat -> clean', h32SeatIdleOverQueue(seat(HELD), marker('Round-start marker — R6.', 600), busy, NOW32), null);
  t('H32: an EMPTY queue is a finished lane -> clean', h32SeatIdleOverQueue(seat(HELD), marker('Round-start marker — R6.', 600), { unclaimed: 0, inFlight: 0 }, NOW32), null);
  t('H32: a vacant seat is out of scope however deep the queue', h32SeatIdleOverQueue(seat('[PM seat] domain:spec — ⏳ vacant'), marker('收班', 6000), idleLane, NOW32), null);
  t('H32: a FOREIGN lane is out of scope (its inventory is unreadable here)', h32SeatIdleOverQueue(siblingLaneSeat(), marker('Round-start marker', 600), idleLane, NOW32), null);
  t('H32: a non-seat card is out of scope', h32SeatIdleOverQueue({ ...issue(['pm:queue']), title: HELD }, marker('x', 600), idleLane, NOW32), null);

  // The threshold, at both edges of SEAT_IDLE_STALE_MINUTES.
  t('H32: a marker inside the horizon -> clean', h32SeatIdleOverQueue(seat(HELD), marker('Round-start marker — R6.', SEAT_IDLE_STALE_MINUTES - 1), idleLane, NOW32), null);
  t('H32: exactly at the horizon -> clean (strictly past it fires)', h32SeatIdleOverQueue(seat(HELD), marker('Round-start marker — R6.', SEAT_IDLE_STALE_MINUTES), idleLane, NOW32), null);
  t('H32: one minute past -> finding', typeof h32SeatIdleOverQueue(seat(HELD), marker('Round-start marker — R6.', SEAT_IDLE_STALE_MINUTES + 1), idleLane, NOW32), 'string');
  // The measured cross-shift interval that must NOT fire: domain:engine's
  // 收班 23:10 -> 开轮 01:47 pair, the shape the 480-min horizon was set above.
  t('H32: a 收班/开轮 turnaround inside the horizon is clean', h32SeatIdleOverQueue(seat(HELD), marker('**开轮 / ROUND-OPEN marker** — domain:engine seat', 157), idleLane, NOW32), null);

  // The wait exemption — structural, unbounded by time (grading's ruling).
  for (const [name, body] of [
    ['等 CI', '开轮 R7 — 在飞 0,等 CI 收敛后再派'],
    ['等裁决', 'Round brief — 队列非空但全部等裁决'],
    ['等人工步骤', '收班简报 — 剩余卡等人工步骤(手动 release)'],
    ['awaiting', 'Round-open marker — every queued card is awaiting-maintainer'],
    ['a named Blocked-by', 'Round brief — the whole queue is Blocked-by: #123'],
    ['决策箱', '收班 — 队列 12,其中 12 在决策箱'],
  ]) {
    t(`H32 exempt: a marker naming ${name} silences the row`, h32SeatIdleOverQueue(seat(HELD), marker(body, 6000), idleLane, NOW32), null);
  }
  t('H32 exempt: …and the exemption is UNBOUNDED by time', h32SeatIdleOverQueue(seat(HELD), marker('等裁决', 60_000), idleLane, NOW32), null);
  t('H32: a marker with no wait declared is NOT exempt', typeof h32SeatIdleOverQueue(seat(HELD), marker('Round brief — 10 PR landed.', 6000), idleLane, NOW32), 'string');
  t('H32 exempt: seatDeclaresWait is case-folded', seatDeclaresWait('Everything is AWAITING the maintainer'), true);
  t('H32 exempt: …and plain prose declares nothing', seatDeclaresWait('Round 2 result — os-warren'), false);

  // The unread/unconsulted thread DECLINES — the one asymmetry against H4.
  t('H32: an unconsulted thread declines to judge', h32SeatIdleOverQueue(seat(HELD), undefined, idleLane, NOW32), null);
  t('H32: an UNREADABLE thread declines too (never a blind accusation)', h32SeatIdleOverQueue(seat(HELD), null, idleLane, NOW32), null);
  t('H32: a seat with NO marker at all declines', h32SeatIdleOverQueue(seat(HELD), latestSeatMarker([]), idleLane, NOW32), null);
  // An unreadable STAMP still fires — that is the #4690 direction, and it
  // differs from an unreadable THREAD because the wait exemption was still read.
  t('H32: an unreadable marker stamp must not read as fresh', typeof h32SeatIdleOverQueue(seat(HELD), { body: 'Round-start marker', createdAt: 'not-a-date' }, idleLane, NOW32), 'string');
  t('H32: …and the row says so rather than printing a number', h32row(seat(HELD), { body: 'Round-start marker', createdAt: 'not-a-date' }, idleLane, NOW32).includes('unreadable marker timestamp'), true);

  // latestSeatMarker — recency, with governingClaim's thread-order fallback.
  t('H32 marker: the NEWEST comment wins', latestSeatMarker([{ body: 'old', created_at: minsAgo(600) }, { body: 'new', created_at: minsAgo(10) }]).body, 'new');
  t('H32 marker: …regardless of thread order', latestSeatMarker([{ body: 'new', created_at: minsAgo(10) }, { body: 'old', created_at: minsAgo(600) }]).body, 'new');
  t('H32 marker: an unparseable stamp falls back to thread order', latestSeatMarker([{ body: 'first', created_at: 'nope' }, { body: 'last', created_at: 'nope' }]).body, 'last');
  t('H32 marker: an empty thread is null', latestSeatMarker([]), null);
  t('H32 marker: a non-array is null', latestSeatMarker(undefined), null);
  t('H32 age: an unreadable stamp is null, not 0', seatMarkerAgeMinutes({ createdAt: 'nope' }, NOW32), null);

  // The gathering gate buys a fetch only for seats the row can speak about.
  t('H32 gate: a held own-board seat is a candidate', h32NeedsSeatComments(seat(HELD)), true);
  t('H32 gate: a foreign-lane seat buys no fetch', h32NeedsSeatComments(siblingLaneSeat()), false);
  t('H32 gate: a vacant seat buys no fetch', h32NeedsSeatComments(seat('[PM seat] domain:spec — ⏳ vacant')), false);
  t('H32 gate: a non-seat card buys no fetch', h32NeedsSeatComments(issue(['pm:queue'])), false);

  // Adjacency: H32 must not restate what H30/H24 already say about the cards.
  t('H32 adjacency: H30 speaks about the CARD, H32 about the SEAT', h30QueueRotting(seat(HELD), NOW32), null);

  // -- H33 — a claim written before the ruling that now stands (#11724) -------
  const dispatched33 = (n = 4964) => ({ ...issue(['pm:dispatched'], ['os-zhuang']), number: n });
  const row33 = (createdAt, body) => ({ created_at: createdAt, body });
  const CLAIM_AT = '2026-08-20T10:00:00Z';
  const RULING_AT = '2026-08-21T09:00:00Z';
  const claimRow33 = row33(CLAIM_AT, 'Claim: skills seat `session_x`.\nBranch: `claude/issue-4964-x`');
  const rulingRow33 = row33(RULING_AT, 'Triage: lands in packages/rest — dispatch scope = option 1 as a sweep.');

  t('H33: a claim predating a ruling -> finding', typeof h33ClaimPredatesRuling(dispatched33(), [claimRow33, rulingRow33]), 'string');
  t('H33: …and it names both stamps', h33row(dispatched33(), [claimRow33, rulingRow33]).includes(RULING_AT), true);
  t('H33: a ruling BEFORE the claim -> clean (the order could carry it)', h33ClaimPredatesRuling(dispatched33(), [row33('2026-08-19T09:00:00Z', 'Triage: routed'), claimRow33]), null);
  t('H33: no ruling on the thread at all -> clean (the ordinary card)', h33ClaimPredatesRuling(dispatched33(), [claimRow33, row33(RULING_AT, 'ACCEPT — PR #12066 reviewed')]), null);
  t('H33: no claim at all -> clean', h33ClaimPredatesRuling(dispatched33(), [rulingRow33]), null);
  t('H33: the label gate outranks the shape', h33ClaimPredatesRuling({ ...issue(['pm:queue']) }, [claimRow33, rulingRow33]), null);
  t('H33: an unconsulted thread -> clean', h33ClaimPredatesRuling(dispatched33(), undefined), null);
  t('H33: an unreadable thread -> clean', h33ClaimPredatesRuling(dispatched33(), null), null);
  // The LATEST claim is what counts — a re-claim after the ruling clears it.
  t('H33: a re-claim AFTER the ruling clears the row', h33ClaimPredatesRuling(dispatched33(), [claimRow33, rulingRow33, row33('2026-08-22T08:00:00Z', 'Claim: PM loop round R7')]), null);
  // Both stamps must be readable — an ordering built on an unreadable stamp
  // would be fabricated, which is worse than a missing row.
  t('H33: an unreadable CLAIM stamp declines', h33ClaimPredatesRuling(dispatched33(), [row33('nope', 'Claim: PM loop round R6'), rulingRow33]), null);
  t('H33: an unreadable RULING stamp declines', h33ClaimPredatesRuling(dispatched33(), [claimRow33, row33('nope', 'Triage: routed')]), null);
  // Multiple rulings are counted, and the NEWEST is the one named.
  const twoRulings = String(h33ClaimPredatesRuling(dispatched33(), [claimRow33, rulingRow33, row33('2026-08-22T09:00:00Z', 'Maintainer ruling — option 1 stands')]) ?? '');
  t('H33: two later rulings are counted', twoRulings.includes('2 triage-ruling comment(s)'), true);
  t('H33: …and the NEWEST is the one quoted', twoRulings.includes('2026-08-22T09:00:00Z'), true);

  // The ruling anchors, driven with the measured openings (2026-08-25 census).
  for (const [name, line] of [
    ['Triage:', 'Triage: lands in packages/rest/src/rest-server.ts; domain:cli.'],
    ['Triage routing:', 'Triage routing: domain:skills + finding — pm-dispatch process defect'],
    ['Triage (first-touch grading):', 'Triage (first-touch grading): graduated finding → pm:blocked'],
    ['Triage (Routine seat…)', 'Triage (Routine seat, hourly round): routed → finding + domain:skills'],
    ['Concentrated triage batch:', 'Concentrated triage batch: finding → pm:queue + domain:engine, Task, M'],
    ['Concentrated triage round:', 'Concentrated triage round: finding → pm:queue + domain:engine stands'],
    ['Skills-lane self-triage', 'Skills-lane self-triage (run-to-empty fire): finding → pm:queue'],
    ['Grading (…)', 'Grading (skills seat, session `session_x`, 2026-08-23 concentrated round): promoted'],
    ['Maintainer ruling —', 'Maintainer ruling — option 1: every failure payload carries the advisory lists'],
  ]) {
    t(`H33 anchor: ${name} is a ruling`, isTriageRulingComment(line), true);
  }
  // Decoration is expected — seats bold and blockquote these openings.
  t('H33 anchor: a BOLDED ruling opening still reads', isTriageRulingComment('**Triage: routed → pm:queue**'), true);
  t('H33 anchor: a BLOCKQUOTED one too', isTriageRulingComment('> Triage routing: domain:skills'), true);
  t('H33 anchor: a heading-marked one too', isTriageRulingComment('## Grading (skills seat)'), true);
  t('H33 anchor: leading blank lines are skipped', isTriageRulingComment('\n\n   Triage: routed'), true);
  // …and the strictness the tolerance must NOT cost. Both specimens are real
  // comments from the same census that MENTION a ruling without being one.
  t('H33 anchor: prose mentioning the triage comment is NOT a ruling', isTriageRulingComment('Serial-constraint addendum to the R6 claim above: the triage comment says'), false);
  t('H33 anchor: a correction referencing a ruling is NOT one', isTriageRulingComment("⚠️ Section 3's REST-fallback claim needs qualifying before it lands"), false);
  t('H33 anchor: a dev report is NOT a ruling', isTriageRulingComment('os-dev-report'), false);
  t('H33 anchor: an ACCEPT is NOT a ruling', isTriageRulingComment('ACCEPT — PR #12066 · reviewed against GitHub'), false);
  t('H33 anchor: a claim is NOT a ruling', isTriageRulingComment('Claim: PM loop round R6'), false);
  t('H33 anchor: empty text is not a ruling', isTriageRulingComment(''), false);

  // latestClaimComment — deliberately NOT branch-gated, unlike governingClaim.
  const branchless = row33('2026-08-21T10:00:00Z', 'Claim: PM loop round R6');
  t('H33 claim: a BRANCHLESS claim still counts here', latestClaimComment([branchless]).createdAt, '2026-08-21T10:00:00Z');
  t('H33 claim: …while governingClaim correctly ignores it', governingClaim([branchless]), null);
  t('H33 claim: the newest claim wins', latestClaimComment([claimRow33, branchless]).createdAt, '2026-08-21T10:00:00Z');
  t('H33 claim: a thread with no claim is null', latestClaimComment([rulingRow33]), null);
  t('H33 claim: a non-array is null', latestClaimComment(null), null);
  // ⚠️ A KNOWN, MEASURED blind spot, pinned here so it is visible in the suite
  // rather than discovered again from a silent row. `CLAIM_COMMENT_MARKER`
  // requires the canonical colon, and some live `pm:dispatched` cards carry a
  // claim written with an EM DASH (「Claim — skills seat `session_…`」), which
  // the marker cannot see. ⛔ Those are MALFORMED claims, not a dialect: the
  // 2026-08-11 maintainer ruling makes `Claim:` the single machine criterion
  // and closes the widening (⛔ 不放宽谓词). H33 therefore inherits the
  // blindness rather than defining a second, wider notion of "claim" than
  // H2/H20/H27 use — a file that disagrees with itself about what a claim IS
  // would be the worse defect. The consequence is UNDER-reporting, this file's
  // standing direction for an unrecognised spelling (H17/H20), never a
  // fabricated row. Where the malformed claim becomes VISIBLE is H34 (#12090),
  // whose cases sit below.
  t('H33 claim: an EM-DASH claim is invisible to the shared marker (malformed, by ruling)', latestClaimComment([row33(CLAIM_AT, 'Claim — skills seat `session_x`.')]), null);
  t('H33: …so a card claimed that way under-reports rather than fabricating', h33ClaimPredatesRuling(dispatched33(), [row33(CLAIM_AT, 'Claim — skills seat `session_x`.'), rulingRow33]), null);

  // -- H34 — a claim-shaped comment with a non-canonical separator (#12090) ---
  // The acceptance pair for this row is the FOUR-WAY split below: the marker's
  // verdict and H34's verdict are asserted on the same specimen every time, so
  // no case can go green by quietly redefining what a claim is.
  const tracked34 = (labels = ['pm:dispatched']) => issue(labels, ['os-zhuang']);
  // ⚠️ `?? ''` rather than a bare `.includes` on the predicate's return. A row
  // that goes NULL under a mutation must report a NAMED failing case, not throw
  // and abort the suite before the remaining 200 cases run — measured while
  // reverse-verifying this row: widening the marker turned a red suite into a
  // TypeError whose message named neither the row nor the mutation.
  const h34row = (...args) => String(h34ClaimShapedNonCanonicalSeparator(...args) ?? '');
  const DASH_CLAIM = 'Claim — skills seat `session_01RM`. Folded dispatch, patrol-predicates pack.';
  const COLON_CLAIM = 'Claim: skills seat `session_01RM`.\nBranch: `claude/issue-12090-x`';
  const PROSE_CONTROL = 'the next seat should claim: only after the ruling lands';
  const FULLWIDTH_CLAIM = 'Claim：skills seat `session_01RM`, round R36.';

  // 1. dash claim -> the near-miss row fires AND the marker stays false.
  t('H34: an EM-DASH claim fires the near-miss row', typeof h34ClaimShapedNonCanonicalSeparator(tracked34(), [DASH_CLAIM]), 'string');
  t('H34: …and CLAIM_COMMENT_MARKER is still false on it (⛔ 不放宽谓词)', CLAIM_COMMENT_MARKER.test(DASH_CLAIM), false);
  t('H34: …and the row NAMES the separator by codepoint', h34row(tracked34(), [DASH_CLAIM]).includes('EM DASH (U+2014)'), true);
  t('H34: …and points the remedy at the canonical spelling', h34row(tracked34(), [DASH_CLAIM]).includes('begins with the literal `Claim:`'), true);
  t('H34: …and says the predicate is NOT widened', h34row(tracked34(), [DASH_CLAIM]).includes('NOT widened'), true);
  // …and H2 still reports the card, correctly, as claimless.
  t('H34: H2 still fires on the same card, and that row is CORRECT', h2AssigneeNoClaimComment(tracked34(), [DASH_CLAIM]), true);

  // 2. colon claim -> the marker is true and the near-miss row is silent.
  t('H34: a COLON claim leaves the near-miss row silent', h34ClaimShapedNonCanonicalSeparator(tracked34(), [COLON_CLAIM]), null);
  t('H34: …because the marker reads it', CLAIM_COMMENT_MARKER.test(COLON_CLAIM), true);
  t('H34: …and H2 is clean', h2AssigneeNoClaimComment(tracked34(), [COLON_CLAIM]), false);

  // 3. the #7488 prose control -> NEITHER reader sees a claim.
  t('H34: the prose control fires neither reader (H34)', h34ClaimShapedNonCanonicalSeparator(tracked34(), [PROSE_CONTROL]), null);
  t('H34: …nor the marker', CLAIM_COMMENT_MARKER.test(PROSE_CONTROL), false);

  // 4. fullwidth colon -> a near miss, which is what the collapsed `[::]` class
  // makes honest: U+FF1A never matched the marker and now says so out loud.
  t('H34: a FULLWIDTH-COLON claim fires the near-miss row', typeof h34ClaimShapedNonCanonicalSeparator(tracked34(), [FULLWIDTH_CLAIM]), 'string');
  t('H34: …named as such', h34row(tracked34(), [FULLWIDTH_CLAIM]).includes('FULLWIDTH COLON (U+FF1A)'), true);
  t('H34: …and the marker has never matched it (behaviour unchanged by #12090)', CLAIM_COMMENT_MARKER.test(FULLWIDTH_CLAIM), false);

  // The remaining separators, each pinned by name.
  t('H34: an EN DASH is a near miss', nearMissClaimSeparators('Claim – skills seat, session 019x').join(','), 'EN DASH (U+2013)');
  t('H34: a HYPHEN-MINUS is a near miss', nearMissClaimSeparators('Claim - skills seat, session 019x').join(','), 'HYPHEN-MINUS (U+002D)');
  t('H34: `Claimed —` is one too', nearMissClaimSeparators('Claimed — by the skills seat, session 019x').join(','), 'EM DASH (U+2014)');
  t('H34: a BLOCKQUOTED near miss reads (the template is a blockquote)', nearMissClaimSeparators('> Claim — skills seat, session 019x').join(','), 'EM DASH (U+2014)');

  // ⚠️ The `[ \t]*` decision, pinned TWICE and deliberately: once on the
  // exported regex (where the character class is what answers) and once on the
  // reader (where the per-line split answers). A single case would let the
  // regex be relaxed to `\s*` with the suite still green — measured: the
  // reader-level case alone survives that mutation untouched.
  t('H34: the exported marker does not span lines (the class, not the split)', CLAIM_NEAR_MISS_MARKER.test('Claim\n- skills seat, session 019x'), false);
  t('H34: a markdown bullet on the NEXT line is not a separator', nearMissClaimSeparators('Claim\n- skills seat, session 019x').length, 0);
  t('H34: …the same shape with a colon claim is unaffected', CLAIM_COMMENT_MARKER.test('Claim\n- skills seat'), false);

  // The conservative content half: a claim-shaped opening with none of the
  // protocol's own content is NOT evidence that a claim was attempted.
  t('H34: a contentless claim-shaped line is silent', nearMissClaimSeparators('Claim - see above').length, 0);
  t('H34: …but a `Branch:` line elsewhere in the comment is content', nearMissClaimSeparators('Claim - see above\nBranch: `claude/issue-12090-x`').join(','), 'HYPHEN-MINUS (U+002D)');

  // Suppression: a thread that ALSO carries a readable claim is machine-visible,
  // so the row has no remedy to offer and stays quiet.
  t('H34: a thread carrying BOTH spellings is silent', h34ClaimShapedNonCanonicalSeparator(tracked34(), [DASH_CLAIM, COLON_CLAIM]), null);
  // Gates, mirroring H2's exactly — same population, same declines.
  t('H34: `pm:queue` is in scope too', typeof h34ClaimShapedNonCanonicalSeparator(tracked34(['pm:queue']), [DASH_CLAIM]), 'string');
  t('H34: an untracked card is out of scope', h34ClaimShapedNonCanonicalSeparator(issue(['domain:skills'], ['os-zhuang']), [DASH_CLAIM]), null);
  t('H34: an UNASSIGNED card is out of scope (H1 owns that card)', h34ClaimShapedNonCanonicalSeparator(issue(['pm:dispatched']), [DASH_CLAIM]), null);
  t('H34: an unconsulted thread declines', h34ClaimShapedNonCanonicalSeparator(tracked34(), undefined), null);
  t('H34: an unreadable thread declines', h34ClaimShapedNonCanonicalSeparator(tracked34(), null), null);
  t('H34: an empty thread is clean', h34ClaimShapedNonCanonicalSeparator(tracked34(), []), null);
  t('H34: a null body among the comments does not throw', h34ClaimShapedNonCanonicalSeparator(tracked34(), [null, DASH_CLAIM]) !== null, true);
  // Two malformed comments, two separators, counted and de-duplicated.
  const twoNearMiss = h34row(tracked34(), [DASH_CLAIM, 'Claim – other seat, session 019y']);
  t('H34: multiple malformed comments are counted', twoNearMiss.includes('2 comment(s)'), true);
  t('H34: …and both separators named', twoNearMiss.includes('EM DASH (U+2014) + EN DASH (U+2013)'), true);
  t('H34: a separator is named once, not per comment', h34row(tracked34(), [DASH_CLAIM, DASH_CLAIM]).includes('EM DASH (U+2014) + EM DASH'), false);
  // No `g` flag on the shared marker — the state bug the colon marker's header
  // names, asserted here because this regex is exported and reused per line.
  t('H34: the near-miss marker carries no `g` flag', CLAIM_NEAR_MISS_MARKER.global, false);
  t('H34: …so repeated reads of one line agree', nearMissClaimSeparators(DASH_CLAIM).join() === nearMissClaimSeparators(DASH_CLAIM).join(), true);

  // -- H35 — a gate label removed with no matching review-chain evidence -----
  // -- (#11881). Fixtures are event rows in the repo-wide stream's shape.
  const gateEvent = (over, { n, pr = false, actor = 'os-seat', at, labels = [] }) => ({
    event: over,
    label: { name: CONTRACT_REVIEW_LABEL },
    actor: { login: actor },
    created_at: at,
    issue: {
      number: n,
      state: 'open',
      labels: labels.map((name) => ({ name })),
      pull_request: pr ? { url: 'x' } : undefined,
      html_url: `https://example.invalid/${n}`,
    },
  });
  // The delivery relation, stubbed: card 900 <-> PR 901.
  const sib900 = (e) => (e.issue.pull_request ? [900] : [901]);
  const o900 = { siblingNumbers: sib900 };
  const h35row = (...args) => String(h35GateRemovalWithoutEvidence(...args) ?? '');

  // The healthy shape: hung across both carriers, cleared across both.
  const dualHang = [
    gateEvent('labeled', { n: 900, at: '2026-08-26T10:00:00Z' }),
    gateEvent('labeled', { n: 901, pr: true, at: '2026-08-26T10:00:02Z' }),
  ];
  const dualClear = [
    gateEvent('unlabeled', { n: 900, at: '2026-08-26T12:00:00Z' }),
    gateEvent('unlabeled', { n: 901, pr: true, at: '2026-08-26T12:00:03Z' }),
  ];
  const healthy = [...dualHang, ...dualClear];
  t('H35: a dual-carrier clear is the review-chain evidence -> silent', h35RemovalVerdict(dualClear[0], healthy, o900), 'paired');
  t('H35: …and emits no row', h35GateRemovalWithoutEvidence(dualClear[0], healthy, o900), null);
  t('H35: …on the PR carrier too', h35RemovalVerdict(dualClear[1], healthy, o900), 'paired');

  // ⭐ THE FINDING: hung in a dual stroke, cleared on ONE carrier only.
  const halfWrite = [...dualHang, dualClear[0]];
  t('H35: hung dual + cleared lone -> half-write', h35RemovalVerdict(dualClear[0], halfWrite, o900), 'half-write');
  t('H35: …and the row fires', typeof h35GateRemovalWithoutEvidence(dualClear[0], halfWrite, o900), 'string');
  t('H35: …naming the carrier it was removed from', h35row(dualClear[0], halfWrite, o900).includes('REMOVED from this CARD'), true);
  t('H35: …and the actor', h35row(dualClear[0], halfWrite, o900).includes('`os-seat`'), true);
  t('H35: …and the failure direction is toward release', h35row(dualClear[0], halfWrite, o900).includes('闸门被剥不是红灯是放行'), true);
  t('H35: …and the remedy is a READ, not a re-hang', h35row(dualClear[0], halfWrite, o900).includes('Remedy is a READ, not a write'), true);
  t('H35: …and it states the report-only posture', h35row(dualClear[0], halfWrite, o900).includes('never a label written from this script'), true);
  // The half-write class is NOT narrowed to open carriers — a gate cleared half
  // way on a PR that then merged is the bypass that already happened.
  const closedCarrier = { ...dualClear[0], issue: { ...dualClear[0].issue, state: 'closed' } };
  t('H35: a half-write on a CLOSED carrier still reports', typeof h35GateRemovalWithoutEvidence(closedCarrier, [...dualHang, closedCarrier], o900), 'string');

  // The single-carrier gate — the measured majority shape, and NOT a finding.
  const loneHang = gateEvent('labeled', { n: 900, at: '2026-08-26T10:00:00Z' });
  const loneClear = gateEvent('unlabeled', { n: 900, at: '2026-08-26T12:00:00Z' });
  const singleCarrier = [loneHang, loneClear];
  t('H35: hung lone + cleared lone -> unjudgeable, never a violation', h35RemovalVerdict(loneClear, singleCarrier, o900), 'unjudgeable');
  t('H35: …and the row says UNJUDGED rather than clean', h35row(loneClear, singleCarrier, o900).includes('UNJUDGED, not clean'), true);
  t('H35: …and names both producer-side repairs', h35row(loneClear, singleCarrier, o900).includes('PR 一存在即挂'), true);
  t('H35: …and refuses to parse the prose verdict', h35row(loneClear, singleCarrier, o900).includes('declines to parse it'), true);
  // …but only while the carrier is live: the narrowing that keeps this class at
  // ~0.22 rows/run instead of ~8.5 (header's measured figures).
  const closedLone = { ...loneClear, issue: { ...loneClear.issue, state: 'closed' } };
  t('H35: an unjudgeable clear on a CLOSED carrier emits no row', h35GateRemovalWithoutEvidence(closedLone, [loneHang, closedLone], o900), null);
  t('H35: …though it still classifies as unjudgeable', h35RemovalVerdict(closedLone, [loneHang, closedLone], o900), 'unjudgeable');

  // Re-hung: the read-back worked. Reporting it would call the control a defect.
  const rehung = gateEvent('unlabeled', { n: 900, at: '2026-08-26T12:00:00Z', labels: [CONTRACT_REVIEW_LABEL] });
  t('H35: a removal whose label is BACK -> rehung, silent', h35RemovalVerdict(rehung, [...dualHang, rehung], o900), 'rehung');
  t('H35: …and emits no row', h35GateRemovalWithoutEvidence(rehung, [...dualHang, rehung], o900), null);

  // Three input states, never two (#4690): no hang in the window = decline.
  t('H35: a removal with no hang in the window -> undated, not a finding', h35RemovalVerdict(dualClear[0], [dualClear[0]], o900), 'undated');
  t('H35: …and emits no row', h35GateRemovalWithoutEvidence(dualClear[0], [dualClear[0]], o900), null);
  // An unresolvable sibling must not manufacture a finding: it degrades to the
  // hang comparison, which for a lone hang is `unjudgeable`.
  t('H35: an unresolvable sibling degrades, never accuses', h35RemovalVerdict(loneClear, singleCarrier, { siblingNumbers: () => null }), 'unjudgeable');

  // Scope: only `unlabeled`, only gate-semantic labels.
  t('H35: a `labeled` row is not applicable', h35RemovalVerdict(dualHang[0], healthy, o900), 'not-applicable');
  const otherLabel = { ...loneClear, label: { name: 'size/l' } };
  t('H35: a non-gate label is not applicable', h35RemovalVerdict(otherLabel, [otherLabel], o900), 'not-applicable');
  t('H35: `needs-user-decision` is deliberately NOT in the family', isGateSemanticLabel('needs-user-decision'), false);
  t('H35: the gate label IS', isGateSemanticLabel(CONTRACT_REVIEW_LABEL), true);
  t('H35: the family and H31 share ONE constant', GATE_SEMANTIC_LABELS.includes(CONTRACT_REVIEW_LABEL), true);

  // ⚠️ THE VACUITY GUARD. H35's half-write class measured ZERO over the 3.41-day
  // derivation corpus — a true reading of a board where the dual-carrier
  // discipline holds, and indistinguishable from a predicate that CANNOT fire.
  // These two cases are the difference, and they must be read as a pair: the
  // classifier reaches `half-write` on a constructed input, and a mutation that
  // makes the row go permanently silent turns them red HERE rather than passing
  // as a quiet board. ⛔ Do not delete either one to make an ablation quieter.
  t('H35 vacuity guard: the half-write class is REACHABLE', h35RemovalVerdict(dualClear[0], halfWrite, o900) === 'half-write', true);
  t('H35 vacuity guard: …and produces a non-empty row', h35row(dualClear[0], halfWrite, o900).length > 0, true);
  // The stroke window is a threshold read out of an EMPTY region of the measured
  // distribution (101s .. 275s), so these two pin both of its sides.
  const slowPair = [
    ...dualHang,
    dualClear[0],
    gateEvent('unlabeled', { n: 901, pr: true, at: '2026-08-26T12:01:30Z' }),
  ];
  t('H35: a 90s dual clear is still ONE stroke (inside the 120s window)', h35RemovalVerdict(dualClear[0], slowPair, o900), 'paired');
  const hoursApart = [
    ...dualHang,
    dualClear[0],
    gateEvent('unlabeled', { n: 901, pr: true, at: '2026-08-26T15:00:00Z' }),
  ];
  t('H35: a clear hours later is NOT the same stroke', h35RemovalVerdict(dualClear[0], hoursApart, o900), 'half-write');
  // 「同笔」 is one actor's stroke — a different login is not the same write.
  const otherActor = [
    ...dualHang,
    dualClear[0],
    gateEvent('unlabeled', { n: 901, pr: true, actor: 'os-other', at: '2026-08-26T12:00:03Z' }),
  ];
  t('H35: a different actor is not 同笔', h35RemovalVerdict(dualClear[0], otherActor, o900), 'half-write');

  // The window derivation, executable rather than prose (H8's `windowCoverageDays` shape).
  t('H35: the horizon is TWO patrol cycles', H35_EVENT_WINDOW_HOURS / PATROL_CADENCE_HOURS, 2);
  t('H35: 12h at the measured rate needs 24 pages', eventWindowPages(), 24);
  t('H35: …and the cap leaves headroom above that', H35_EVENT_PAGE_CAP > eventWindowPages(), true);
  t('H35: a zero rate cannot divide, and says so', eventWindowPages(12, 0), null);
  t('H35: the stroke window sits inside the measured empty region', H35_SAME_STROKE_SECONDS > 101 && H35_SAME_STROKE_SECONDS < 275, true);
  // The window filter is a TIME horizon; the page cap is only its backstop.
  t('H35: gateLabelEvents keeps both verbs', gateLabelEvents(healthy).length, 4);
  t('H35: …and drops non-gate labels', gateLabelEvents([...healthy, otherLabel]).length, 4);
  t('H35: …and drops non-label events', gateLabelEvents([...healthy, { event: 'closed' }]).length, 4);

  // The summary line carries the residue, so a quiet section cannot read as
  // "the gate is watched" when most removals are structurally unwatchable.
  const gateCounts = { gateRemovals: 7, eventPages: 24, gate_unjudgeable: 5, gate_undated: 1 };
  t('H35 summary: the removal count is reported', summaryLine(gateCounts, 1).includes('7 removal(s) of a gate-semantic label'), true);
  t('H35 summary: …with the pages read', summaryLine(gateCounts, 1).includes('24 page(s) of the repo-wide issue-event stream'), true);
  t('H35 summary: …and states it made no per-card fetch', summaryLine(gateCounts, 1).includes('no per-card timeline fetch'), true);
  t('H35 summary: …and carries the unjudgeable residue', summaryLine(gateCounts, 1).includes('5 of them are UNJUDGEABLE'), true);
  t('H35 summary: …and the undated count', summaryLine(gateCounts, 1).includes('1 more had no hang inside the window'), true);
  t('H35 summary: a truncated window is announced, never silent', summaryLine({ ...gateCounts, eventWindowTruncated: true }, 0).includes('TRUNCATED'), true);
  t('H35 summary: …and says a quiet section is a SHORT READ', summaryLine({ ...gateCounts, eventWindowTruncated: true }, 0).includes('short read, not a clean board'), true);
  t('H35 summary: an untruncated window makes no such claim', summaryLine(gateCounts, 1).includes('TRUNCATED'), false);
  // Absent counts degrade to 0, never to `undefined` — H32's pair does the same.
  t('H35 summary: absent counts degrade to 0', summaryLine({}, 0).includes('0 removal(s) of a gate-semantic label'), true);

  // -- H36 — cross-lane same-file holds (report-only patrol input, #12286) ---
  const h36pr = (number, opts = {}) => ({
    number,
    created_at: opts.created_at ?? '2026-08-25T10:00:00Z',
    draft: opts.draft ?? true,
    auto_merge: opts.auto_merge ?? null,
    merged_at: opts.merged_at ?? null,
    head: { ref: opts.ref ?? `claude/issue-${number}-x` },
    html_url: `https://example.test/${number}`,
  });
  const h36files = (entries, truncated = []) =>
    new Map(
      Object.entries(entries).map(([n, paths]) => [
        Number(n),
        { paths, truncated: truncated.includes(Number(n)) },
      ]),
    );
  const h36rows = (...args) => h36SharedFileHolds(...args);
  // The wrapper discipline the row-text wrappers at the top explain: a nulled
  // first row must report as red CASES, never abort the suite in argument
  // evaluation. The count assertions stay on `h36rows` directly.
  const h36row1 = (...args) => String(h36SharedFileHolds(...args)[0]?.[1] ?? '');
  const h36key1 = (...args) => h36SharedFileHolds(...args)[0]?.[0]?.number ?? null;
  const readyEarly = h36pr(100, { draft: false });
  const draftLate = h36pr(200, { created_at: '2026-08-25T11:00:00Z' });
  const sharedAuto = h36files({
    100: ['packages/runtime/src/domains/automation.ts'],
    200: ['packages/runtime/src/domains/automation.ts', 'docs/x.md'],
  });
  // ⭐ THE FINDING — the incident's own shape: an accepted side and any other
  // open PR holding one source file.
  t('H36: ready + draft sharing a source file -> one row', h36rows([readyEarly, draftLate], sharedAuto).length, 1);
  t('H36: …keyed to the accepted side', h36key1([readyEarly, draftLate], sharedAuto), 100);
  t('H36: …naming the other side', h36row1([readyEarly, draftLate], sharedAuto).includes('#200'), true);
  t('H36: …and the shared path', h36row1([readyEarly, draftLate], sharedAuto).includes('automation.ts'), true);
  t('H36: …and states the non-verdict posture', h36row1([readyEarly, draftLate], sharedAuto).includes('NOT a verdict'), true);
  t('H36: …and the remedy is the local probe', h36row1([readyEarly, draftLate], sharedAuto).includes('merge-tree'), true);
  // The gate on the row: some side must be DONE.
  t('H36: two unarmed drafts -> silent (the dispatch-time walk owns that case)', h36rows([h36pr(100), draftLate], sharedAuto).length, 0);
  t('H36: an ARMED draft is at risk, finding-increasing like H16', h36rows([h36pr(100, { auto_merge: { merge_method: 'squash' } }), draftLate], sharedAuto).length, 1);
  t('H36: both accepted -> keyed to the earlier-created side', h36key1([h36pr(100, { draft: false }), h36pr(200, { draft: false, created_at: '2026-08-25T11:00:00Z' })], sharedAuto), 100);
  // The noise floor: closed, two spellings, pinned against per-incident growth.
  t('H36: lockfile-only overlap is the noise floor -> silent', h36rows([readyEarly, draftLate], h36files({ 100: ['pnpm-lock.yaml'], 200: ['pnpm-lock.yaml'] })).length, 0);
  t('H36: .changeset/ overlap is the noise floor -> silent', h36rows([readyEarly, draftLate], h36files({ 100: ['.changeset/a.md'], 200: ['.changeset/a.md'] })).length, 0);
  t('H36: the noise floor is CLOSED at two spellings — growing it needs its own card', H36_SHARED_PATH_NOISE.length + H36_SHARED_PREFIX_NOISE.length, 2);
  t('H36: a source path is NOT noise', h36NoisePath('packages/runtime/src/domains/automation.ts'), false);
  // Candidate policy: never narrower than the predicate's population.
  t('H36: changeset-release PRs are not candidates', h36NeedsFiles(h36pr(300, { ref: 'changeset-release/main' })), false);
  t('H36: a merged row is not a candidate', h36NeedsFiles(h36pr(300, { merged_at: '2026-08-25T12:00:00Z' })), false);
  t('H36: a draft IS a candidate (the pair\'s other side can be one)', h36NeedsFiles(draftLate), true);
  // An unread side cannot pair — a miss, never an invention.
  t('H36: an unread side cannot pair', h36rows([readyEarly, draftLate], h36files({ 100: ['x.ts'] })).length, 0);
  // Truncation: pairs on what was seen, and says the list was short.
  const truncPair = h36files(
    { 100: ['packages/runtime/src/domains/automation.ts'], 200: ['packages/runtime/src/domains/automation.ts'] },
    [200],
  );
  t('H36: a truncated list still pairs on what was seen', h36rows([readyEarly, draftLate], truncPair).length, 1);
  t('H36: …and the row says so, in the only-hides-more direction', h36row1([readyEarly, draftLate], truncPair).includes('TRUNCATED'), true);
  t('H36: an untruncated pair makes no such claim', h36row1([readyEarly, draftLate], sharedAuto).includes('TRUNCATED'), false);
  // The transport judgement — H16's shape, asserted on this pass's own pair.
  t('H36: an all-failed files pass is the transport, not a clean board', h36DetailPassUnreadable(3, 0), true);
  t('H36: zero candidates is a clean reading', h36DetailPassUnreadable(0, 0), false);
  t('H36: a partial read is a bounded gap, not a failure', h36DetailPassUnreadable(3, 1), false);
  // The coverage pair reaches the summary line, and degrades to 0.
  t('H36 summary: the pair is reported', summaryLine({ sharedFileProbed: 17, sharedFileCandidates: 19 }, 0).includes('changed-file page read on 17 of 19 open PR(s)'), true);
  t('H36 summary: …and states the miss-only direction', summaryLine({}, 0).includes('MISS a hold, never invent one'), true);
  t('H36: both count keys ride the enumerated contract', SWEEP_COUNT_KEYS.includes('sharedFileCandidates') && SWEEP_COUNT_KEYS.includes('sharedFileProbed'), true);
  // The markdown medium renders an H36 row like every other finding row.
  t('markdown: an H36 row links the PR it names', renderMarkdown([[{ number: 100, html_url: 'https://example.test/100' }, 'H36', 'shares a file']], { repo: 'r', issues: 0, unscoped: 0, prs: 2, merged: 0 }).includes('- **H36** [#100](https://example.test/100)'), true);

  // -- H37 — family-dispatch member drift (report-only patrol input, #12629) --
  //
  // The fixtures are the two MEASURED instances the filing card carries: a
  // 3-card fold whose third member kept `pm:queue` while the fold ran, and the
  // mirror — a member left `pm:dispatched` WITH its assignee after the head had
  // released. Fold #11678 is the shape the live claim census records
  // (「folded into the 11678 family dispatch」).
  const FOLD_37 = 'claude/issue-11678-family-fold';
  const h37card = (number, labels, assignees = ['os-litant']) => ({
    number,
    html_url: `https://example.test/${number}`,
    labels: labels.map((name) => ({ name })),
    assignees: assignees.map((login) => ({ login })),
  });
  const h37claim = (number, ...branches) => ({ number, branches });
  const h37map = (...cards) => new Map(cards.map((c) => [c.number, c]));
  const h37rows = (...args) => h37FamilyMemberDrift(...args);
  // The wrapper discipline: a nulled row must report as a red CASE, never abort
  // the suite while evaluating `t()`'s arguments.
  const h37row1 = (...args) => String(h37FamilyMemberDrift(...args)[0]?.[1] ?? '');
  const h37key1 = (...args) => h37FamilyMemberDrift(...args)[0]?.[0]?.number ?? null;
  const foldClaims37 = [h37claim(11678, FOLD_37), h37claim(11679, FOLD_37), h37claim(11680, FOLD_37)];
  const folds37 = h37FoldBranches(foldClaims37);
  const headLive37 = h37card(11678, ['domain:skills', 'pm:dispatched']);

  // The roster: what makes a branch a FOLD, and the one exclusion that is the
  // whole noise floor.
  t('H37 roster: two cards claiming one branch is a fold', folds37.size, 1);
  t('H37 roster: …keyed to the shared branch', [...folds37.keys()][0], FOLD_37);
  t('H37 roster: …whose head is the card the branch is named for', folds37.get(FOLD_37).head, 11678);
  t('H37 roster: …and every claimant is on it, sorted', folds37.get(FOLD_37).claimants.join(','), '11678,11679,11680');
  // ⛔ THE NOISE FLOOR — and it is the ordinary case: every solo dispatch on
  // this board claims its own branch, so without this the row fires on all of them.
  t('H37 roster: a claim naming its OWN branch is not a fold', h37FoldBranches([h37claim(11678, FOLD_37)]).size, 0);
  t('H37 roster: …not even several of them', h37FoldBranches([h37claim(11678, FOLD_37), h37claim(9000, 'claude/issue-9000-solo')]).size, 0);
  t('H37 roster: a lone FOREIGN claimant is already a fold (the head may be silent)', h37FoldBranches([h37claim(9999, 'claude/issue-8888-x')]).size, 1);
  t('H37 roster: a branch with no readable card number is not a roster key', h37FoldBranches([h37claim(1, 'main'), h37claim(2, 'main')]).size, 0);
  t('H37 roster: a duplicate claimant is counted once', h37FoldBranches([h37claim(11679, FOLD_37, FOLD_37)]).get(FOLD_37).claimants.length, 1);
  t('H37 roster: no claims at all -> no folds', h37FoldBranches([]).size, 0);
  t('H37 roster: a missing claim list does not crash', h37FoldBranches(undefined).size, 0);

  // The head state — four-valued, because `unknown` must never read as released.
  t('H37 head: dispatched and open -> in flight', h37HeadState(11678, h37map(headLive37), new Map()), 'in-flight');
  t('H37 head: open without the label -> released, and separably so', h37HeadState(11678, h37map(h37card(11678, ['pm:queue'])), new Map()), 'open-undispatched');
  t('H37 head: closed -> released', h37HeadState(11678, new Map(), h37map(h37card(11678, []))), 'closed');
  t('H37 head: listed nowhere -> unknown, never released (#4690)', h37HeadState(11678, new Map(), new Map()), 'unknown');

  // The classifier, asserted directly — H35's idiom, so the fold is pinned
  // independently of any sentence it produces.
  t('H37 verdict: fold in flight + member undispatched -> the missed write', h37MemberVerdict('in-flight', false), 'undispatched-member');
  t('H37 verdict: fold in flight + member dispatched -> clean', h37MemberVerdict('in-flight', true), 'clean');
  t('H37 verdict: head CLOSED + member dispatched -> residue', h37MemberVerdict('closed', true), 'dispatched-residue');
  t('H37 verdict: head open-undispatched + member dispatched -> residue', h37MemberVerdict('open-undispatched', true), 'dispatched-residue');
  t('H37 verdict: nothing dispatched anywhere -> clean (an abandoned fold is H30\'s)', h37MemberVerdict('open-undispatched', false), 'clean');
  t('H37 verdict: an unresolvable head declines rather than accusing', h37MemberVerdict('unknown', true), 'unresolvable-head');

  // ⭐ THE FINDING, direction 1 — the filing seat's own error: the fold ran and
  // one member kept `pm:queue`, with no assignee, looking clean to every
  // per-card predicate here.
  const stranded37 = h37card(11680, ['domain:skills', 'pm:queue'], []);
  const liveFold37 = [folds37, h37map(headLive37, h37card(11679, ['pm:dispatched']), stranded37), new Map()];
  t('H37: a fold in flight with one member on `pm:queue` -> one row', h37rows(...liveFold37).length, 1);
  t('H37: …keyed to the stranded member, not the head', h37key1(...liveFold37), 11680);
  t('H37: …naming the shared branch', h37row1(...liveFold37).includes(FOLD_37), true);
  t('H37: …and the chain head', h37row1(...liveFold37).includes('#11678'), true);
  t('H37: …stating the non-verdict posture', h37row1(...liveFold37).includes('NOT a verdict'), true);
  t('H37: …and naming the alternative reading a reader might find', h37row1(...liveFold37).includes('cross-lane hand-off'), true);
  t('H37: …with the remedy as ONE write', h37row1(...liveFold37).includes('ONE write'), true);

  // ⭐ THE FINDING, direction 2 — the MIRROR measured on this card's own round
  // (#12200): the head released, the member kept `pm:dispatched` + assignee.
  const residue37 = [
    h37FoldBranches([h37claim(11679, FOLD_37)]),
    h37map(h37card(11679, ['pm:dispatched'])),
    h37map(h37card(11678, [])),
  ];
  t('H37 mirror: head closed + member still dispatched -> one row', h37rows(...residue37).length, 1);
  t('H37 mirror: …keyed to the member carrying the residue', h37key1(...residue37), 11679);
  t('H37 mirror: …and it says the head CLOSED', h37row1(...residue37).includes('CLOSED'), true);
  t('H37 mirror: …naming it as the same write failing the other way', h37row1(...residue37).includes('MIRROR direction'), true);
  const released37 = [
    h37FoldBranches([h37claim(11679, FOLD_37)]),
    h37map(h37card(11679, ['pm:dispatched']), h37card(11678, ['pm:queue'])),
    new Map(),
  ];
  t('H37 mirror: an open head that dropped the label reads as released too', h37rows(...released37).length, 2);

  // ⭐ THE FINDING, direction 3 — the HEAD's own half missed, visible from the
  // members' claims and from nothing on the head's card.
  const headMissed37 = h37rows(...released37).find(([card]) => card.number === 11678);
  t('H37 head half: the undispatched head gets its own row', headMissed37 === undefined, false);
  t('H37 head half: …and it says the members are the only witnesses', String(headMissed37?.[1] ?? '').includes('visible ONLY from'), true);
  t('H37 head half: …counting the dispatched claimants', String(headMissed37?.[1] ?? '').includes('#11679'), true);

  // Silence, in both directions — the halves that must NOT fire.
  t('H37 silent: a fold whose members are all dispatched', h37rows(folds37, h37map(headLive37, h37card(11679, ['pm:dispatched']), h37card(11680, ['pm:dispatched'])), new Map()).length, 0);
  t('H37 silent: a fold with nothing dispatched at all (abandoned, or not yet launched)', h37rows(folds37, h37map(h37card(11678, ['pm:queue']), h37card(11679, ['pm:queue']), h37card(11680, ['pm:queue'])), new Map()).length, 0);
  t('H37 silent: an unresolvable head judges nothing', h37rows(folds37, h37map(h37card(11679, ['pm:queue']), h37card(11680, ['pm:queue'])), new Map()).length, 0);
  t('H37 silent: a claimant this sweep never listed is skipped, not judged', h37rows(folds37, h37map(headLive37), new Map()).length, 0);
  t('H37 silent: no folds -> no rows', h37rows(new Map(), h37map(headLive37), new Map()).length, 0);
  t('H37 silent: a missing roster does not crash', h37rows(undefined, h37map(headLive37), new Map()).length, 0);

  // The gathering policy: never wider than the fold population it is bought for.
  t('H37 gate: a `pm:queue` card is read once a fold is live', h37NeedsMemberRead(h37card(9, ['pm:queue']), 1), true);
  t('H37 gate: …and costs NOTHING on a board with no fold', h37NeedsMemberRead(h37card(9, ['pm:queue']), 0), false);
  t('H37 gate: a dispatched card buys nothing (its thread is already read)', h37NeedsMemberRead(h37card(9, ['pm:dispatched']), 1), false);
  t('H37 gate: a card in neither state is out of scope', h37NeedsMemberRead(h37card(9, ['pm:blocked']), 1), false);
  t('H37 gate: a missing issue does not crash', h37NeedsMemberRead(undefined, 1), false);
  t('H37 gate: an absent fold count is not a fold', h37NeedsMemberRead(h37card(9, ['pm:queue']), undefined), false);

  // The transport judgement — H16's shape, on this pass's own pair.
  t('H37: an all-failed member pass is the transport, not a fold whose writes landed', h37MemberPassUnreadable(40, 0), true);
  t('H37: zero candidates is a clean reading (no fold was live)', h37MemberPassUnreadable(0, 0), false);
  t('H37: a partial read is a bounded gap, not a failure', h37MemberPassUnreadable(40, 12), false);

  // The render budget, H19/H20's cap and note.
  const wide37 = h37FoldBranches([1, 2, 3, 4, 5, 6, 7].map((n) => h37claim(11670 + n, FOLD_37)));
  t('H37: a wide fold names the cap and counts the rest', h37row1(wide37, h37map(h37card(11678, ['pm:dispatched']), h37card(11671, ['pm:queue'])), new Map()).includes(`+${7 - H37_MEMBER_LIST_CAP} more`), true);

  // The coverage pair reaches the summary line, and degrades to 0.
  t('H37 summary: the pair is reported', summaryLine({ liveFolds: 2, memberReadProbed: 38, memberReadCandidates: 40 }, 0).includes('member comment page read on 38 of 40'), true);
  t('H37 summary: …and the fold count with it', summaryLine({ liveFolds: 2 }, 0).includes('2 live shared branch(es)'), true);
  t('H37 summary: …stating the miss-only direction', summaryLine({}, 0).includes('never invent one'), true);
  t('H37 summary: an all-failed pass is named as the transport', summaryLine({ liveFolds: 1, memberReadCandidates: 40, memberReadProbed: 0 }, 0).includes('NO member page was readable'), true);
  t('H37 summary: …and 0 of 0 makes no such claim', summaryLine({}, 0).includes('NO member page was readable'), false);
  t('H37: all three count keys ride the enumerated contract', ['liveFolds', 'memberReadCandidates', 'memberReadProbed'].every((k) => SWEEP_COUNT_KEYS.includes(k)), true);
  // The markdown medium renders an H37 row like every other finding row.
  t('markdown: an H37 row links the card it names', renderMarkdown([[{ number: 11680, html_url: 'https://example.test/11680' }, 'H37', 'member pointer without the label']], { repo: 'r', issues: 1, unscoped: 0, prs: 0, merged: 0 }).includes('- **H37** [#11680](https://example.test/11680)'), true);

  // -- The `[::]` collapse (#12090): behaviour-preserving, asserted as such ---
  // The class held U+003A TWICE, never the fullwidth U+FF1A its shape implied.
  // These cases pin that the collapse changed nothing a reader could observe.
  t('claim marker: the canonical colon still matches', CLAIM_COMMENT_MARKER.test('Claim: PM loop round R6'), true);
  t('claim marker: `Claimed:` still matches', CLAIM_COMMENT_MARKER.test('Claimed: PM loop round R6'), true);
  t('claim marker: a blockquoted claim still matches', CLAIM_COMMENT_MARKER.test('> Claim: PM loop round R6'), true);
  t('claim marker: whitespace before the colon is still tolerated', CLAIM_COMMENT_MARKER.test('Claim : PM loop round R6'), true);
  t('claim marker: the FULLWIDTH colon does not match, and never did', CLAIM_COMMENT_MARKER.test('Claim：PM loop round R6'), false);
  t('branch line: the canonical colon still reads', claimedBranches('Branch: `claude/issue-12090-x`').join(','), 'claude/issue-12090-x');
  t('branch line: `Branches:` still reads', claimedBranches('Branches: `claude/issue-12090-x`').join(','), 'claude/issue-12090-x');
  t('branch line: a FULLWIDTH colon does not read, and never did', claimedBranches('Branch：`claude/issue-12090-x`').length, 0);

  // -- resolveSweepRepo: the parameterisation that makes a verbatim sibling
  // -- install correct rather than a green report about the wrong board (#11217)
  t('sweep repo: PM_SWEEP_REPO wins when set', resolveSweepRepo({ PM_SWEEP_REPO: 'objectstack-ai/cloud', GITHUB_REPOSITORY: 'objectstack-ai/objectui' }).repo, 'objectstack-ai/cloud');
  t('sweep repo: …and says where the answer came from', resolveSweepRepo({ PM_SWEEP_REPO: 'objectstack-ai/cloud' }).source, 'PM_SWEEP_REPO');
  // The line that makes a copied file sweep the repo it was copied INTO.
  t('sweep repo: a runner with no override sweeps its OWN repo', resolveSweepRepo({ GITHUB_REPOSITORY: 'objectstack-ai/objectui' }).repo, 'objectstack-ai/objectui');
  t('sweep repo: …reported as such', resolveSweepRepo({ GITHUB_REPOSITORY: 'objectstack-ai/objectui' }).source, 'GITHUB_REPOSITORY');
  t('sweep repo: a bare terminal falls back to the default', resolveSweepRepo({}).repo, DEFAULT_SWEEP_REPO);
  t('sweep repo: …and names the fallback as the source', resolveSweepRepo({}).source, 'default');
  // The objectstack leg, pinned in the exact shape its runner provides: same
  // string as the hardcoded default this replaced, so every request path is
  // byte-identical and the behaviour is unchanged by construction.
  t('sweep repo: the objectstack runner resolves to the pre-change constant', resolveSweepRepo({ PM_SWEEP_REPO: 'objectstack-ai/objectstack', GITHUB_REPOSITORY: 'objectstack-ai/objectstack' }).repo, DEFAULT_SWEEP_REPO);
  t('sweep repo: …and with only GITHUB_REPOSITORY set, identically', resolveSweepRepo({ GITHUB_REPOSITORY: 'objectstack-ai/objectstack' }).repo, DEFAULT_SWEEP_REPO);
  t('sweep repo: …and that reading is valid', resolveSweepRepo({ GITHUB_REPOSITORY: 'objectstack-ai/objectstack' }).valid, true);
  // Empty/whitespace is UNSET, not a value: Actions expressions expand to ''
  // for an unset variable, and treating '' as a repo would sweep nothing while
  // reporting a completed run.
  t('sweep repo: an empty override is unset, not a repo', resolveSweepRepo({ PM_SWEEP_REPO: '', GITHUB_REPOSITORY: 'objectstack-ai/cloud' }).repo, 'objectstack-ai/cloud');
  t('sweep repo: whitespace is unset too', resolveSweepRepo({ PM_SWEEP_REPO: '   ' }).repo, DEFAULT_SWEEP_REPO);
  t('sweep repo: surrounding whitespace is trimmed, not rejected', resolveSweepRepo({ PM_SWEEP_REPO: ' objectstack-ai/cloud ' }).repo, 'objectstack-ai/cloud');
  // A malformed value is REFUSED (the CLI exits 2 on it) and never silently
  // replaced by the default — substituting a different board is the disease.
  t('sweep repo: a bare name is invalid', resolveSweepRepo({ PM_SWEEP_REPO: 'objectui' }).valid, false);
  t('sweep repo: …and is reported as itself, not as the default', resolveSweepRepo({ PM_SWEEP_REPO: 'objectui' }).repo, 'objectui');
  t('sweep repo: a URL is invalid', resolveSweepRepo({ PM_SWEEP_REPO: 'https://github.com/objectstack-ai/objectui' }).valid, false);
  t('sweep repo: a three-segment path is invalid', resolveSweepRepo({ PM_SWEEP_REPO: 'a/b/c' }).valid, false);
  t('sweep repo: a trailing slash is invalid', resolveSweepRepo({ PM_SWEEP_REPO: 'objectstack-ai/' }).valid, false);
  t('sweep repo: dots, dashes and underscores are legal repo characters', resolveSweepRepo({ PM_SWEEP_REPO: 'my-org/some_repo.js' }).valid, true);
  t('sweep repo: no env at all is the same as an empty one', resolveSweepRepo().repo, DEFAULT_SWEEP_REPO);
  // The sweep target rides into the rendered report, so a reader of a sibling
  // repo's anchor can see WHICH board was read (and a wrong one is legible).
  t('sweep repo: the rendered summary names the swept repo', summaryLine({ repo: 'objectstack-ai/objectui', issues: 3, unscoped: 4, prs: 1, merged: 2 }, 0).includes('objectstack-ai/objectui'), true);

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failed) {
    console.error(`✗ check-half-states self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-half-states self-test: ${cases.length} cases pass.`);
}

const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  // A malformed sweep target is bad usage (exit 2), refused BEFORE any request
  // — including the probe's, whose second stage is a repo-scoped read of this
  // very string. Silently falling back to the default would sweep a board
  // nobody asked for and render a green report about it (#11217). The
  // self-test path is exempt: it makes no request and must stay runnable in
  // any container, whatever the environment carries.
  if (!process.argv.includes('--self-test') && !SWEEP_REPO.valid) {
    console.error(
      `check-half-states: ${SWEEP_REPO.source}=${JSON.stringify(SWEEP_REPO.repo)} is not an ` +
        '`owner/name` repository. Refusing to fall back to a different board — a report about ' +
        'the wrong repo reads exactly like a report about this one.',
    );
    process.exit(2);
  }
  // A malformed closure floor is the same class and gets the same answer. It
  // must not degrade to "no floor": the install that sets one is the install
  // whose closed surface is ~87% residue, so a silent default would flood the
  // anchor body four times a day and the flood renders as a working patrol.
  if (!process.argv.includes('--self-test') && !CLOSED_FLOOR.valid) {
    console.error(
      `check-half-states: ${CLOSED_FLOOR.source}=${JSON.stringify(CLOSED_FLOOR.raw)} is not a ` +
        '`YYYY-MM-DD` date. Refusing to fall back to an unfloored closed pass — on the install ' +
        'that needs a floor, no floor is a report about the convention rather than about defects.',
    );
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else if (process.argv.includes('--probe')) {
    // "Can live mode run HERE?" answered on its own, so a seat can find out
    // without a sweep and without reading a raw HTTP status off a label page.
    probeTransport().then((v) => {
      if (!v) {
        console.error('check-half-states: transport probe returned an unclassified result — run the sweep to see the raw failure.');
        process.exit(2);
      }
      if (v.kind !== 'reachable') reportPrerequisiteNotMet(v);
      console.log(`✓ check-half-states: transport prerequisite met — ${v.headline}.`);
    });
  } else {
    const options = parseOutputOptions(process.argv.slice(2));
    if (options.error) {
      // Bad usage is one of the three non-zero exits the header names. It must
      // never degrade to the default format: the caller that passes --format is
      // a workflow writing the result into a pinned issue body, and a silent
      // fallback would land plain terminal lines there and look like a report.
      console.error(`check-half-states: ${options.error}`);
      process.exit(2);
    }
    sweep(options).catch((err) => {
      // The in-loop net. The pre-sweep probe answers the common case, but the
      // transport can also fail mid-run (a quota exhausted by this very sweep,
      // a credential revoked between pages), and those must report as the
      // prerequisite they are rather than as an unexplained HTTP number. The
      // probe is re-run rather than inferred from the status alone: a fresh
      // reading is what distinguishes a real transport failure from a transient
      // 5xx on one page, and it comes back `reachable` in the latter — which
      // correctly falls through to the generic failure below.
      const classify = err.status ? probeTransport() : Promise.resolve(null);
      return classify.then((v) => {
        if (v && v.kind !== 'reachable') reportPrerequisiteNotMet(v, { swept: err.sweptSoFar ?? 0 });
        // A sweep that could not run must not read as a clean board (#4690).
        console.error(`check-half-states: sweep failed to run — ${err.message}`);
        process.exit(2);
      });
    });
  }
}
