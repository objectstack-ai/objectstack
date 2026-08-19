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
 * is not a fact about this script's environment. Three container classes have
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
 *
 * That last class also produced the trap worth naming: `/rate_limit` is EXEMPT
 * from the limit it reports. With the quota spent it still answers 200 (carrying
 * `x-ratelimit-remaining: 0`) while every other endpoint answers 403 — so a
 * probe that reads only the status code cheerfully green-lights a sweep that
 * cannot make one request. The first draft of the probe below did exactly that.
 * `probeIsUsable` is that lesson, and the self-test pins it.
 *
 * So the script PROBES (`GET /rate_limit`, which costs no core quota) before it
 * sweeps. A failed probe prints a classified PREREQUISITE NOT MET report naming
 * which of the two requirements is unmet and the one command that satisfies it —
 * never a sweep result. `--probe` runs that check alone, which is what a seat
 * should use to answer "can live mode run in THIS container?".
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
    const holder = status.replace('🟢', '').trim();
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
 */
export function stripMarkdownCode(body) {
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
    out.push(line.replace(/`+[^`\n]*`+/g, ' '));
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
 * @param {{ repo: string, issues: number, unscoped: number, prs: number, merged: number }} counts
 * @param {number} findingCount
 */
export function summaryLine(counts, findingCount) {
  return (
    `check-half-states: swept ${counts.issues} open pm-/p0-labeled issue(s), ${counts.unscoped} open ` +
    `issue(s) in H13's unscoped pass, ${counts.prs} open PR(s) ` +
    `and ${counts.merged} recently-merged PR(s) in ${counts.repo} — ${findingCount} half-state(s) found. ` +
    `Report-only: findings are patrol input, not a gate verdict.`
  );
}

/**
 * The terminal report — byte-identical to what this script printed before the
 * format switch existed. Findings arrive already sorted by issue number and
 * that order is kept: a terminal has no fold, so there is nothing for a
 * priority sort to buy here, and changing it would churn every seat's habit.
 */
export function renderPlain(findings, counts) {
  const lines = findings.map(
    ([issue, code, msg]) => `  ${code} #${issue.number} ${msg}\n     ${issue.html_url}`,
  );
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

  if (rows.length === 0) {
    head.push(
      '✅ No half-states found in this sweep. This line means the board was READ and is clean — a sweep' +
        ' that could not RUN replaces this whole body with a prerequisite/failure report instead, so a' +
        ' green anchor is never the sound of a broken sweeper.',
    );
    return head.join('\n');
  }

  head.push('### Findings', '', '');
  const body = head.join('\n');
  const rendered = [];
  let used = body.length;
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
  return `${body}${rendered.join('\n')}`;
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
 * Turn probe OBSERVATIONS into a named prerequisite verdict. Pure — the network
 * lives in `probeTransport` — so `--self-test` can pin every branch against the
 * three container classes actually measured in #7412.
 *
 * Deliberately narrow, in the same direction as `looksLikeStaleWorkspaceDist`:
 * an unrecognised status comes back as `null` (= "not a failure this classifier
 * can name") and the caller keeps its pre-existing loud generic failure. A wrong
 * confident diagnosis here would send a seat to fix a credential when GitHub was
 * merely down.
 *
 * @param {{ token?: string, authed?: object|null, anon?: object|null }} obs
 *   `authed` / `anon` are each `{ status, rateLimitRemaining }` or
 *   `{ networkError }`; `anon` is only gathered when a token was used and failed.
 * @returns {{ kind: string, headline: string, detail: string[], fix: string[] } | null}
 */
export function classifyTransportProbe(obs) {
  const token = obs?.token ?? '';
  const tok = describeToken(token);
  const authed = obs?.authed ?? null;
  const anon = obs?.anon ?? null;
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

async function probeTransport() {
  const first = await probeRateLimit(TOKEN);
  if (!TOKEN) return classifyTransportProbe({ token: '', anon: first });
  if (first.status === 200) return classifyTransportProbe({ token: TOKEN, authed: first });
  return classifyTransportProbe({ token: TOKEN, authed: first, anon: await probeRateLimit('') });
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
          `  Nothing was swept: no issue was listed and no predicate (H1–H13) ran, so this`,
          `  result says NOTHING about whether the board carries half-states. It is not a`,
          `  clean board and it is not a dirty one — it is no reading at all.`,
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
  try {
    await sweepInto(findings, seen, seenPrs, seenMerged, seenUnscoped);
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
  };
  console.log(
    options.format === 'markdown'
      ? renderMarkdown(findings, counts, { provenance: options.provenance })
      : renderPlain(findings, counts),
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

async function sweepInto(findings, seen, seenPrs, seenMerged, seenUnscoped) {
  for (const label of ['pm:dispatched', 'pm:queue', 'pm:blocked', 'pm:seat', 'pm:on-hold', 'priority:p0']) {
    for (const issue of await listIssues(label)) seen.set(issue.number, issue);
  }

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
      const comments = await rest(`/repos/${OWNER_REPO}/issues/${issue.number}/comments?per_page=100`);
      if (h2AssigneeNoClaimComment(issue, comments.map((c) => c.body))) {
        findings.push([issue, 'H2', 'assignee set but no claim comment on the thread']);
      }
    }
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
  for (const issue of await listAllOpenIssues()) {
    seenUnscoped.set(issue.number, issue);
    const halfState = h13DomainWithoutPmState(issue);
    if (halfState) findings.push([issue, 'H13', halfState]);
  }
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

  // -- report rendering, both media (#9844) ---------------------------------
  // The standing caller writes the markdown into a pinned issue body, so the
  // properties pinned here are the ones a broken body would cost: the plain
  // output must not have moved, the loud rows must outrank truncation, the
  // trim must announce itself, and a mistyped --format must be loud.
  const finding = (number, code, msg) => [{ number, html_url: `https://example.test/${number}` }, code, msg];
  const counts = { repo: 'o/r', issues: 3, unscoped: 4, prs: 5, merged: 6 };
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
