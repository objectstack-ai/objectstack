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
 *   H4  `pm:blocked` without a `Blocked-by:` body line — the machine half of
 *       the label is the body line; without it the unlock sweep can never
 *       return the card (state model, label discipline).
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
 *       merged PR is a half-state, whichever mechanism failed). Live mode
 *       feeds H8 a bounded window of recently merged PRs, so it is a patrol
 *       accelerator, never an exhaustive audit: a delivery older than the
 *       window is invisible, and the finding clears when the paired write
 *       lands, not when the PR ages out.
 *   H9  `pm:on-hold` without a machine-fireable `Restart-when:` body line —
 *       the state model (post 2026-08-16 ruling) makes the hold state legal
 *       ONLY with a machine-readable exit: `Restart-when: closed <owner/repo>#N`
 *       (fired by the same unlock scan as `Blocked-by:`, same single body
 *       channel) or a one-line executable predicate. A hold nothing can fire
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

const OWNER_REPO = process.env.PM_SWEEP_REPO ?? 'objectstack-ai/objectstack';
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Predicates — pure functions over the REST issue shape, so the self-test can
// drive them with fixtures and the live sweep stays a thin fetch loop.
// ---------------------------------------------------------------------------

export function labelNames(issue) {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

export function h1DispatchedNoAssignee(issue) {
  const labels = labelNames(issue);
  return labels.includes('pm:dispatched') && (issue.assignees ?? []).length === 0;
}

export function h2AssigneeNoClaimComment(issue, commentBodies) {
  const labels = labelNames(issue);
  const pmTracked = labels.some((l) => l === 'pm:queue' || l === 'pm:dispatched');
  if (!pmTracked || (issue.assignees ?? []).length === 0) return false;
  return !commentBodies.some((b) => /^\s*>?\s*Claim(?:ed)?\s*[::]/mi.test(b ?? ''));
}

export function h3QueueAndDispatched(issue) {
  const labels = labelNames(issue);
  return labels.includes('pm:queue') && labels.includes('pm:dispatched');
}

export function h4BlockedNoBlockedBy(issue) {
  const labels = labelNames(issue);
  if (!labels.includes('pm:blocked')) return false;
  return !/^\s*Blocked-by:\s*\S/m.test(issue.body ?? '');
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

/** The `#N` a body declares itself only PART of. */
export function partOfTargets(body) {
  return new Set([...stripMarkdownCode(body).matchAll(partOfRe())].map((m) => m[1]));
}

/** `#N` -> the closing keyword bound to it (first occurrence wins, for the message). */
export function closingKeywordTargets(body) {
  const found = new Map();
  for (const m of stripMarkdownCode(body).matchAll(closingKeywordRe())) {
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
 * H8 — null when clean, else the finding sentence.
 *
 * A PR "delivers" card N when its body declares `Part of #N` or binds a
 * closing keyword to `#N`, read through `stripMarkdownCode` (a body QUOTING
 * either spelling in backticks does not deliver). Only `merged_at`-set PRs
 * count — closed-unmerged is an abandoned attempt, not a delivery. Bound per
 * issue number exactly like H7.
 */
export function h8MergedPrStillDispatched(issue, mergedPrs) {
  if (!labelNames(issue).includes('pm:dispatched')) return null;
  const n = String(issue.number);
  const delivering = [];
  for (const pr of mergedPrs ?? []) {
    if (!pr?.merged_at) continue;
    const body = pr.body ?? '';
    if (partOfTargets(body).has(n) || closingKeywordTargets(body).has(n)) {
      delivering.push(pr);
    }
  }
  if (delivering.length === 0) return null;
  const list = delivering
    .map((p) => `#${p.number} (merged ${String(p.merged_at).slice(0, 10)})`)
    .join(', ');
  return (
    `delivering PR ${list} is MERGED but the card still carries \`pm:dispatched\` — ` +
    `the merge's paired write never landed. Drop \`pm:dispatched\` and re-grade the ` +
    `remainder (re-queue, close, or block the un-delivered half) in the same stroke.`
  );
}

// ---------------------------------------------------------------------------
// H9 — `pm:on-hold` without a machine-fireable `Restart-when:` body line.
//
// Same shape as H4 (label's machine half is a body line), same single body
// channel: the unlock scan greps issue bodies only, so a condition parked in a
// comment does not exist to the machinery — which is exactly the population
// this detector exists to surface.
// ---------------------------------------------------------------------------

/**
 * H9 — null when clean, else the finding sentence.
 *
 * Legal iff SOME `Restart-when:` line carries a value that is not `manual…`.
 * The spelling is case-sensitive and byte-stable like `Blocked-by:` (H4): the
 * scan that fires these lines greps the literal, so a lowercase variant is a
 * line the machinery cannot see and must be flagged, not tolerated.
 */
export function h9OnHoldNoRestartWhen(issue) {
  if (!labelNames(issue).includes('pm:on-hold')) return null;
  const values = [...(issue.body ?? '').matchAll(/^\s*Restart-when:[ \t]*(\S.*)$/gm)].map((m) =>
    m[1].trim(),
  );
  if (values.some((v) => !/^manual\b/i.test(v))) return null;
  const shape =
    values.length === 0
      ? 'no `Restart-when:` body line'
      : 'its only `Restart-when:` is `manual`, which no mechanism can fire';
  return (
    `\`pm:on-hold\` with ${shape} — the hold state is legal only with a machine-fireable exit ` +
    `(\`Restart-when: closed <owner/repo>#N\`, or a one-line executable predicate). Add the line, ` +
    `or apply the protocol's default: a card no mechanism can revive is closed \`not planned\` ` +
    `with reason + provenance in the closing comment (type:Bug holds re-route instead — see the ` +
    `state model's Bug branch).`
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
  const parked = labels.includes('pm:blocked') || labels.includes('pm:on-hold');
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
  const state = labels.includes('pm:blocked') ? 'pm:blocked' : 'pm:on-hold';
  const age =
    ageDays === null
      ? 'an unreadable `created_at` (which must not read as fresh)'
      : `open ~${Math.round(ageDays)}d`;
  return (
    `important card parked: ${signals.join(' + ')} sitting in \`${state}\`, ${age} ` +
    `(threshold ${IMPORTANT_PARKED_STALE_DAYS}d) — the important-parked inventory exists so a bug ` +
    `or security card cannot age out of sight inside a parked state. Re-check the card's ` +
    `\`Blocked-by:\` / \`Restart-when:\` liveness in the triage round.`
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
 * 1. **Code is NOT stripped**, unlike H7/H8/H13. Those predicates read PROSE
 *    and must protect the careful author who quotes a spelling in backticks.
 *    This one models a MACHINE READER: the state model calls the line
 *    「机器可 grep 的反向索引」, and the unlock scan that consumes it greps the
 *    literal — so a fenced `Blocked-by:` line really does fire the live
 *    machinery, whatever the author meant. Stripping here would report
 *    coherence against an index nothing uses; H4 (the same line's other
 *    reader) does not strip either.
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
  // `[ \t]*`, not `\s*`: `\s` matches newlines, so with the /g/m extractor a
  // run of blank lines could let one match begin a line early. H4's presence
  // test cannot tell the difference; an extractor can.
  for (const line of String(body ?? '').matchAll(/^[ \t]*Blocked-by:[ \t]*(\S.*)$/gm)) {
    let rest = line[1];
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
 * @param {{ repo?: string }} [options] — `owner/repo`, defaulting to the swept one.
 */
export function buildBlockingIndex(issues, options = {}) {
  const ownerRepo = options.repo ?? OWNER_REPO;
  const bareRepo = ownerRepo.split('/').pop();
  const index = new Map();
  for (const issue of issues ?? []) {
    for (const { repo, number } of blockedByTargets(issue.body)) {
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
 * @param {object} issue — an OPEN issue.
 * @param {Map<number, number[]>} index — from `buildBlockingIndex`.
 */
export function h14BlockingCacheIncoherent(issue, index) {
  const carries = labelNames(issue).includes('pm:blocking');
  const dependents = index?.get?.(issue.number) ?? [];
  if (carries && dependents.length === 0) {
    return (
      '`pm:blocking` carried while NO open card\'s `Blocked-by:` body line targets it — a stale ' +
      'derived cache. The label is not a state a seat sets: the triage sweep derives it from the ' +
      '`Blocked-by:` reverse index, and the lane selection order ranks it second only to ' +
      '`priority:p0`. So a stale one is worse than an absent one — it boosts a card nothing depends ' +
      'on, with authority. Report-only: the remedy is the triage sweep\'s derivation pass dropping ' +
      'the label (or the missing `Blocked-by:` line landing on the card that really is waiting), ' +
      'never a label written from this script.'
    );
  }
  if (!carries && dependents.length > 0) {
    const shown = dependents.slice(0, BLOCKING_DEPENDENT_LIST_CAP);
    const named = shown.map((n) => `#${n}`).join(', ');
    const more = dependents.length > shown.length ? ` +${dependents.length - shown.length} more` : '';
    return (
      `targeted by ${dependents.length} open card(s)' \`Blocked-by:\` body line (${named}${more}) but ` +
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
 *   merged: number, conflictProbed?: number, conflictCandidates?: number }} counts
 * @param {number} findingCount
 */
export function summaryLine(counts, findingCount) {
  const probed = counts.conflictProbed ?? 0;
  const candidates = counts.conflictCandidates ?? 0;
  const held = counts.holdProbed ?? 0;
  const holdCandidates = counts.holdCandidates ?? 0;
  return (
    `check-half-states: swept ${counts.issues} open pm-/p0-labeled issue(s), ${counts.unscoped} open ` +
    `issue(s) in the unscoped pass (H13–H15), ${counts.prs} open PR(s) ` +
    `(merge state read on ${probed} of ${candidates} H16 candidate(s)) ` +
    `and ${counts.merged} recently-merged PR(s) in ${counts.repo} — ${findingCount} half-state(s) found. ` +
    `Hold comments read on ${held} of ${holdCandidates} H17 candidate(s). ` +
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
  const rows = [...findings].sort(
    (a, b) => Number(isLoudFinding(b[2])) - Number(isLoudFinding(a[2])) || a[0].number - b[0].number,
  );
  const loudCount = rows.filter(([, , msg]) => isLoudFinding(msg)).length;

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
      headline: `\`${OWNER_REPO}\` is not visible to this identity — the sweep would list nothing`,
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
      'the transport authenticates but repo-scoped reads are refused — the sweep cannot list one page',
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
      `existed the probe said the prerequisite was met and the sweep then 403'd on its`,
      `first page — the #4690 inversion, inside the mechanism built to prevent it.`,
    ],
    fix: [
      'run the sweep from a container whose egress allows repo-scoped reads (CI, or',
      'the Routine seat class); in a proxy-mediated seat the board read stays on the',
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
        'run the sweep from a container with direct egress to api.github.com (CI, or',
        'the Routine seat class); in an MCP-only seat the board read stays manual.',
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
        ? 'the token in the environment is not a valid GitHub credential — and it is the ONLY thing stopping the sweep'
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
            '    other container behind it. This sweep spends one request per label page plus',
            '    one per assigned pm-tracked card, so it can exhaust mid-run — which surfaces',
            '    as another PREREQUISITE NOT MET, never as a short finding list.',
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
        'run the sweep from a container with direct egress to api.github.com (CI, or',
        'the Routine seat class); in an MCP-only seat the board read stays manual.',
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
  // H16's per-row fetch is the one input that can fail partially, so its
  // tally rides out of the sweep and into the summary line (see `summaryLine`).
  const stats = { conflictCandidates: 0, conflictProbed: 0 };
  // H17's gathering rides out of the sweep the same way, because it has the
  // same per-row failure mode as H16's detail pass and therefore owes the
  // summary line the same `read X of Y`.
  const hold = { entries: [], candidates: 0, probed: 0 };
  try {
    await sweepInto(findings, seen, seenPrs, seenMerged, seenUnscoped, stats, hold);
  } catch (err) {
    err.sweptSoFar = seen.size + seenPrs.size + seenMerged.size + seenUnscoped.size;
    throw err;
  }

  findings.sort((a, b) => a[0].number - b[0].number);
  const counts = {
    repo: OWNER_REPO,
    issues: seen.size,
    unscoped: seenUnscoped.size,
    prs: seenPrs.size,
    merged: seenMerged.size,
    conflictCandidates: stats.conflictCandidates,
    conflictProbed: stats.conflictProbed,
    holdCandidates: hold.candidates,
    holdProbed: hold.probed,
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
 * The merged-PR window H8 reads: most recently UPDATED closed PRs, merged
 * ones only, capped at two pages — a quota decision whose consequence is
 * H8's stated boundary (a delivery older than the window is invisible). At
 * ~18 merges/day two pages reach well past the longest measured
 * unexecuted-verdict latency; `sort=updated` so a long-lived PR that merges
 * late is still in the window when it matters.
 */
async function listRecentlyMergedPullRequests() {
  const out = [];
  for (let page = 1; page <= 2; page++) {
    const batch = await rest(
      `/repos/${OWNER_REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    out.push(...batch.filter((p) => p.merged_at));
    if (batch.length < 100) break;
  }
  return out;
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

async function sweepInto(findings, seen, seenPrs, seenMerged, seenUnscoped, stats = {}, hold = null) {
  for (const label of ['pm:dispatched', 'pm:queue', 'pm:blocked', 'pm:seat', 'pm:on-hold', 'priority:p0']) {
    for (const issue of await listIssues(label)) seen.set(issue.number, issue);
  }

  // At most ONE comment fetch per card, shared by the two items that need the
  // thread: H2 reads it for the claim marker, H17 for trigger clauses. Without
  // the memo a card carrying both `pm:dispatched` (assigned) and `pm:on-hold`
  // — itself an H3-adjacent half-state, so exactly the card most likely to be
  // on the board — would be fetched twice per sweep for no new information.
  const commentCache = new Map();
  const commentsFor = async (issue) => {
    if (commentCache.has(issue.number)) return commentCache.get(issue.number);
    const rows = await rest(`/repos/${OWNER_REPO}/issues/${issue.number}/comments?per_page=100`);
    const bodies = rows.map((c) => c.body ?? '');
    commentCache.set(issue.number, bodies);
    return bodies;
  };
  let lastHoldError = null;

  for (const issue of seen.values()) {
    const labels = labelNames(issue);
    if (h1DispatchedNoAssignee(issue)) {
      findings.push([issue, 'H1', '`pm:dispatched` with no assignee']);
    }
    if (h3QueueAndDispatched(issue)) {
      findings.push([issue, 'H3', '`pm:queue` and `pm:dispatched` both present']);
    }
    if (h4BlockedNoBlockedBy(issue)) {
      findings.push([issue, 'H4', '`pm:blocked` without a `Blocked-by:` body line']);
    }
    const restartless = h9OnHoldNoRestartWhen(issue);
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

  // H7 + H12 — the PR side. Listed straight from `/pulls` rather than filtered
  // out of the label pages above: PRs carry no `pm:*` label, so the issue sweep
  // cannot see them (it discards them explicitly). Drafts are INCLUDED for H7 —
  // a draft is exactly where that is still cheap to fix — and excluded by
  // H12's own predicate (drafts are parked deliberately).
  for (const pr of await listOpenPullRequests()) {
    seenPrs.set(pr.number, pr);
    const contradiction = h7PartOfWithClosingKeyword(pr);
    if (contradiction) findings.push([pr, 'H7', contradiction]);
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

  // H8 — one bounded merged-PR listing (window note at the helper), matched
  // against the already-collected open `pm:dispatched` cards; no per-card fetch.
  for (const pr of await listRecentlyMergedPullRequests()) seenMerged.set(pr.number, pr);
  const mergedWindow = [...seenMerged.values()];
  for (const issue of seen.values()) {
    const stale = h8MergedPrStillDispatched(issue, mergedWindow);
    if (stale) findings.push([issue, 'H8', stale]);
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
  }

  // H14 + H15 — the same unscoped listing, read a second way. It is the right
  // population for BOTH halves and neither label page could substitute: a
  // `pm:blocking` card need carry no other label (so the label pages above can
  // miss the subject), and the `Blocked-by:` lines that judge it are written by
  // cards of any label at all (so they can miss the evidence). No extra fetch:
  // the bodies are already in hand, which is exactly the "derived from the same
  // body reads the sweep already performs" this pair was specified as.
  const blockingIndex = buildBlockingIndex(unscoped);
  for (const issue of unscoped) {
    const incoherent = h14BlockingCacheIncoherent(issue, blockingIndex);
    if (incoherent) findings.push([issue, 'H14', incoherent]);
  }

  // One row, attached to the card it names — so it links, sorts and truncates
  // exactly like every other row and neither renderer needs a special case.
  const oldestBlocking = h15OldestUnclaimedBlocking(unscoped);
  if (oldestBlocking) findings.push([oldestBlocking.issue, 'H15', oldestBlocking.message]);
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
  t('H4: blocked without body line -> finding', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting on upstream')), true);
  t('H4: blocked with Blocked-by line -> clean', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'Blocked-by: #123')), false);
  t('H4: unblocked card is out of scope', h4BlockedNoBlockedBy(issue([], [], '')), false);
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
  t('H7: …and it names the card it will close', h7PartOfWithClosingKeyword(pr8277).includes('Part of #8131'), true);
  // The measurement that refutes the sidebar hypothesis: the SAME body names
  // #8136 one clause later with no keyword, and #8136 took no closing link.
  // The predicate must reproduce that asymmetry, not blanket-flag both numbers.
  t('H7: …and does NOT implicate #8136 from the same sentence', h7PartOfWithClosingKeyword(pr8277).includes('#8136'), false);

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
    h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'Part of #4321')]).includes('#4400'),
    true,
  );
  t(
    'H8: …and prescribes the paired write, not just the fact',
    h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'Part of #4321')]).includes('pm:dispatched'),
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
    h8MergedPrStillDispatched(dispatched(4321), [mergedPr(4400, 'Part of #4321'), mergedPr(4500, 'Fixes #4321')]).includes('#4500'),
    true,
  );
  t('H8: empty merged window -> clean', h8MergedPrStillDispatched(dispatched(4321), []), null);
  t('H8: missing merged window -> clean', h8MergedPrStillDispatched(dispatched(4321), undefined), null);

  // -- H9: `pm:on-hold` without a machine-fireable `Restart-when:` ------------
  const hold = (body) => issue(['pm:on-hold'], [], body);
  t('H9: hold with no Restart-when line -> finding', typeof h9OnHoldNoRestartWhen(hold('parked until the train ships')), 'string');
  t('H9: …and the finding prescribes the close default', h9OnHoldNoRestartWhen(hold('parked')).includes('not planned'), true);
  t('H9: closed-upstream form -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: closed acme/widgets#123')), null);
  t('H9: executable-predicate form -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: npm view create-objectstack dist-tags reports >= 17.0.0')), null);
  t('H9: mid-body line -> clean', h9OnHoldNoRestartWhen(hold('Context first.\nRestart-when: closed acme/widgets#123\nMore prose.')), null);
  // `manual` is a hold trying to opt out of having an exit — it counts as
  // missing, or the one-word spelling defeats the invariant.
  t('H9: manual form -> finding', typeof h9OnHoldNoRestartWhen(hold('Restart-when: manual — first EE customer asking')), 'string');
  t('H9: …and the finding names the manual shape', h9OnHoldNoRestartWhen(hold('Restart-when: manual — reason')).includes('manual'), true);
  t('H9: Manual case-insensitive as a VALUE -> finding', typeof h9OnHoldNoRestartWhen(hold('Restart-when: Manual — reason')), 'string');
  t('H9: manual line + fireable line -> clean', h9OnHoldNoRestartWhen(hold('Restart-when: manual — x\nRestart-when: closed acme/widgets#9')), null);
  // The KEY is byte-stable like `Blocked-by:` — a lowercase key is a line the
  // unlock scan cannot see, so it must flag, not pass.
  t('H9: lowercase key is invisible to the scan -> finding', typeof h9OnHoldNoRestartWhen(hold('restart-when: closed acme/widgets#123')), 'string');
  t('H9: empty-valued line does not count', typeof h9OnHoldNoRestartWhen(hold('Restart-when:')), 'string');
  t('H9: prose mentioning the literal inline does not count', typeof h9OnHoldNoRestartWhen(hold('add a Restart-when: line later')), 'string');
  t('H9: card without pm:on-hold is out of scope', h9OnHoldNoRestartWhen(issue(['pm:queue'], [], 'no line at all')), null);
  t('H9: missing body -> finding', typeof h9OnHoldNoRestartWhen(issue(['pm:on-hold'], [], undefined)), 'string');

  // -- H10: stale unclaimed p0 (routing-gap backstop) -------------------------
  const NOW = Date.parse('2026-08-16T12:00:00Z');
  const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
  const p0 = (assignees, updatedAt, extra = []) => ({
    ...issue(['priority:p0', ...extra], assignees),
    updated_at: updatedAt,
  });
  t('H10: unassigned p0 past the threshold -> finding', typeof h10StaleUnclaimedP0(p0([], hoursAgo(36), ['pm:queue']), NOW), 'string');
  t('H10: …and the finding names the threshold', h10StaleUnclaimedP0(p0([], hoursAgo(36)), NOW).includes(`${P0_UNCLAIMED_STALE_HOURS}h`), true);
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
  t('H11: …and the finding names the parked state', h11ImportantParked(parkedCard(['bug', 'pm:blocked']), NOW).includes('pm:blocked'), true);
  t('H11: …and the threshold', h11ImportantParked(parkedCard(['bug', 'pm:blocked']), NOW).includes(`${IMPORTANT_PARKED_STALE_DAYS}d`), true);
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
  t('H12: …and the finding names the threshold', h12OrphanLanding(openPr(), NOW).includes(`${ORPHAN_LANDING_STALE_HOURS}h`), true);
  t('H12: …and prescribes the landing-window re-read, not just the fact', h12OrphanLanding(openPr(), NOW).includes('landing window'), true);
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
  t('H13: …and the finding names the threshold', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26)), NOW).includes(`${DOMAIN_HALF_STATE_STALE_HOURS}h`), true);
  t('H13: …and blames the healing loop, not inventory', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26)), NOW).includes('healing loop'), true);
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
  t('H13: body self-declaring P0 -> louder line', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26), p0Body), NOW).includes('P0-SUSPECT'), true);
  t('H13: …which prescribes the emergency-triage channel', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26), p0Body), NOW).includes('emergency-triage'), true);
  t('H13: data-integrity phrasing alone fires the louder line', h13SelfDeclaredP0({ title: '', body: 'a data integrity regression in DELETE' }), true);
  t('H13: the title is scanned too', h13SelfDeclaredP0({ title: 'p0 suspect: rows vanish', body: '' }), true);
  // Strip reuse (H7 reading 4): quoting the token in backticks is not a
  // self-declaration, and `P0` inside a word is not the token.
  t('H13: P0 only inside backticks is not a self-declaration', h13SelfDeclaredP0({ title: '', body: 'the card quotes `P0` in passing' }), false);
  t('H13: P0 inside a word does not fire', h13SelfDeclaredP0({ title: '', body: 'the HTTP0 protocol note' }), false);
  t('H13: a quiet body stays on the base line', h13DomainWithoutPmState(domainCard(['domain:engine-core'], hoursAgo(26), { body: 'ordinary defect' }), NOW).includes('P0-SUSPECT'), false);

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

  // Direction A — the label carried with nothing targeting it.
  t('H14-A: pm:blocking with nothing targeting it -> finding', typeof h14BlockingCacheIncoherent(carded(7276, ['pm:queue', 'pm:blocking']), idx([])), 'string');
  t('H14-A: …and it names the stale-cache reading', h14BlockingCacheIncoherent(carded(7276, ['pm:blocking']), idx([])).includes('stale derived cache'), true);
  t('H14-A: …and prescribes the derivation pass, never a label from here', h14BlockingCacheIncoherent(carded(7276, ['pm:blocking']), idx([])).includes('derivation pass'), true);
  t('H14-A: …and says why stale is worse than absent', h14BlockingCacheIncoherent(carded(7276, ['pm:blocking']), idx([])).includes('with authority'), true);
  // The negative for direction A: the label is EARNED, so nothing to report.
  t(
    'H14-A: pm:blocking with a real dependent -> clean',
    h14BlockingCacheIncoherent(carded(5, ['pm:blocking']), idx([carded(10, [], 'Blocked-by: #5')])),
    null,
  );

  // Direction B — targeted, but the cache never landed.
  const missingIdx = idx([carded(9650, ['pm:queue'], 'Blocked-by: #9832')]);
  t('H14-B: targeted without pm:blocking -> finding', typeof h14BlockingCacheIncoherent(carded(9832, ['bug', 'pm:dispatched', 'domain:cli']), missingIdx), 'string');
  t('H14-B: …and it names the waiting card', h14BlockingCacheIncoherent(carded(9832, ['pm:dispatched']), missingIdx).includes('#9650'), true);
  t('H14-B: …and calls it an invisible unblocker', h14BlockingCacheIncoherent(carded(9832, ['pm:dispatched']), missingIdx).includes('selection order cannot see'), true);
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
  t('H14-B: a large fan-out names the cap and counts the rest', h14BlockingCacheIncoherent(carded(5, ['pm:queue']), manyDeps).includes(`+${7 - BLOCKING_DEPENDENT_LIST_CAP} more`), true);
  t('H14-B: …and reports the true total, not the capped one', h14BlockingCacheIncoherent(carded(5, ['pm:queue']), manyDeps).includes('targeted by 7 open card(s)'), true);
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
  t('H14 reverse-verify: #9832 (targeted by #9650, unlabeled) -> missing finding naming #9650', h14BlockingCacheIncoherent(carded(9832, ['bug', 'pm:dispatched', 'domain:cli']), liveIdx).includes('#9650'), true);
  t('H14 reverse-verify: #9919 (targeted by #9249, unlabeled) -> missing finding', typeof h14BlockingCacheIncoherent(carded(9919, ['pm:queue', 'repo:cloud']), liveIdx), 'string');
  // …and the four measured NON-findings from the same reading, which is what
  // makes the six above readable as signal rather than as a predicate that
  // flags everything: a dependent card, a closed target's dependent, the
  // cross-repo number, and an ordinary untouched card.
  t('H14 reverse-verify: #9650 (a waiting card, not an unblocker) -> clean', h14BlockingCacheIncoherent(carded(9650, ['pm:queue']), liveIdx), null);
  t('H14 reverse-verify: local #4356 (the objectui blocker\'s number) -> clean', h14BlockingCacheIncoherent(carded(4356, ['pm:queue']), liveIdx), null);
  t('H14 reverse-verify: #2657 (blocked on two CLOSED cards) -> clean', h14BlockingCacheIncoherent(carded(2657, ['pm:blocked']), liveIdx), null);
  t('H14 reverse-verify: an ordinary open card -> clean', h14BlockingCacheIncoherent(carded(9913, ['pm:queue', 'repo:cloud']), liveIdx), null);

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
  t('H16: …and the finding names the threshold', h16StuckMergeConflict(conflictPr(), NOW).includes(`${MERGE_CONFLICT_STALE_HOURS}h`), true);
  t('H16: …and names the platform state it read', h16StuckMergeConflict(conflictPr(), NOW).includes('mergeable_state: dirty'), true);
  t('H16: …and prescribes the merge-and-resolve remedy', h16StuckMergeConflict(conflictPr(), NOW).includes('merges `main` into the branch'), true);
  // The proxy must be DECLARED in the row, not silently substituted: a reader
  // shown "~4h" has to know it is silence on the PR, not the conflict's age.
  t('H16: …and declares the age is the PR\'s updated_at, not the conflict\'s', h16StuckMergeConflict(conflictPr(), NOW).includes("Age is the PR's `updated_at`, not the conflict's"), true);
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
  t('H16: …and the row says auto-merge does not resolve conflicts', h16StuckMergeConflict(conflictPr({ auto_merge: { merge_method: 'squash' } }), NOW).includes('does NOT resolve conflicts'), true);
  // The contrast that makes the divergence deliberate rather than an oversight:
  // one PR row, two predicates, opposite readings of the same armed field.
  t('H16: …while H12 stays clean on that same armed PR (the divergence is by design)', h12OrphanLanding(conflictPr({ auto_merge: { merge_method: 'squash' }, updated: hoursAgo(50) }), NOW), null);

  // The held-card clause — the row names the delivery, not only the branch.
  t('H16: a `Fixes #N` body names the card it is holding', h16StuckMergeConflict(conflictPr({ body: 'Fixes #9763\n\nsome prose' }), NOW).includes('holding card #9763'), true);
  t('H16: `Part of #N` counts as held too (H8\'s reading of delivery)', h16StuckMergeConflict(conflictPr({ body: 'Part of #9652' }), NOW).includes('holding card #9652'), true);
  t('H16: two cards are pluralised and listed in order', h16StuckMergeConflict(conflictPr({ body: 'Fixes #9961\nFixes #9936' }), NOW).includes('holding cards #9936, #9961'), true);
  t('H16: a body with no card carries no holding clause', h16StuckMergeConflict(conflictPr({ body: 'no card here' }), NOW).includes('holding'), false);
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
  t('H16 incident: …fires despite auto-merge being armed', h16StuckMergeConflict(pr9826, NOW).includes('MERGE CONFLICT'), true);
  t('H16 incident: …and names the card it was holding', h16StuckMergeConflict(pr9826, NOW).includes('holding card #9763'), true);
  t('H16 incident: …at its measured ~4h age', h16StuckMergeConflict(pr9826, NOW).includes('untouched for ~4h'), true);
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
  const fenced =
    '**Restart condition**: as below.\n\n' +
    '```\n' +
    'packages/spec/src/contracts/data-driver.ts:234   // `Field.time` value is physically stored\n' +
    '```\n';
  t('H17: paths quoted inside a fenced block are not harvested', files(fenced), '');
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
  t('plain: …and the markdown renderer on the same input DOES sort loud first', renderMarkdown([quietRow, loudRow], counts).indexOf('#900') < renderMarkdown([quietRow, loudRow], counts).indexOf('#200'), true);
  t('summaryLine: names what was READ, not only what was found', summaryLine(counts, 0).includes('swept 3 open pm-/p0-labeled issue(s)'), true);
  // H16's pair is the row-granular half of the same #4690 property: a detail
  // pass that read NOTHING must not be indistinguishable from a board with no
  // conflicts, so the sentence carries `read X of Y` rather than only findings.
  t('summaryLine: reports the H16 detail reads, not only the H16 findings', summaryLine(counts, 0).includes('merge state read on 2 of 2 H16 candidate(s)'), true);
  t('summaryLine: …and a partial read says so', summaryLine({ ...counts, conflictProbed: 1 }, 0).includes('read on 1 of 2'), true);
  // Counts assembled without the pair still render a sentence, never `undefined`.
  t('summaryLine: absent H16 counts degrade to 0, never to undefined', summaryLine({ repo: 'o/r', issues: 1, unscoped: 1, prs: 1, merged: 1 }, 0).includes('read on 0 of 0'), true);
  t('summaryLine: …and never prints the string undefined', summaryLine({ repo: 'o/r', issues: 1, unscoped: 1, prs: 1, merged: 1 }, 0).includes('undefined'), false);

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

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
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
