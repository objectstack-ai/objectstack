#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PM half-state sweeper (#7341 item 2) — REPORT-ONLY enumeration of the
 * label/assignee invariants the dispatch protocol calls "过夜半状态".
 *
 *   node scripts/pm/check-half-states.mjs               # sweep the live repo
 *   node scripts/pm/check-half-states.mjs --probe       # can live mode run HERE? (no sweep)
 *   node scripts/pm/check-half-states.mjs --self-test   # verify the predicates offline
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
 *       `pm:dispatched` — the merge happened and its paired write (drop
 *       `pm:dispatched`, re-grade the remainder) never did (#8683). The
 *       delivering relation is read from merged PR bodies with H7's own
 *       code-stripped extractors: `Part of #N` or a closing keyword bound to
 *       `#N`. The measured shape is the `Part of` one — a partial delivery
 *       merges, GitHub correctly leaves the card open, and the human half of
 *       the close-out never lands; a theme-seat pre-work audit found five
 *       cards in that state at once. The closing-keyword arm is kept because
 *       an OPEN dispatched card named by a merged PR's closing keyword is a
 *       half-state no matter which mechanism failed (auto-close raced, card
 *       reopened without re-grade, keyword edited in after merge) — the sweep
 *       does not need to know which. Live mode feeds H8 a bounded window of
 *       recently merged PRs (see `listRecentlyMergedPullRequests`), so it is
 *       a patrol accelerator, never an exhaustive audit: a delivery that has
 *       aged out of the window is invisible here, and the finding clears when
 *       the paired write lands, not when the PR ages out.
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
// Pure over the shapes the sweep already consumes: the REST issue (labels +
// number) plus a list of PRs from the same `/pulls` surface H7 reads (`number`,
// `body`, plus `merged_at`, which every `/pulls` row carries). No new API
// layer: the delivering relation is read from the PR BODY with the SAME
// code-stripped extractors H7 pins, so everything measured about GitHub's
// reference parsing (#8293 readings 1–5) covers this predicate too.
// ---------------------------------------------------------------------------

/**
 * H8 — null when clean, else the finding sentence.
 *
 * A PR "delivers" card N when its body declares `Part of #N` or binds a
 * closing keyword to `#N` (both read through `stripMarkdownCode`, so a body
 * QUOTING either spelling in backticks does not deliver — the same
 * careful-author protection H7 needs). Only a PR with `merged_at` set counts:
 * a closed-unmerged PR is an abandoned attempt, not a delivery, and flagging
 * it would demand a paired write for work that never landed.
 *
 * The issue must still carry `pm:dispatched`; the sweep only lists OPEN
 * issues, so the closed case never reaches this predicate. Bound per issue
 * number exactly like H7 — a merged PR delivering card A says nothing about
 * card B.
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
          `  Nothing was swept: no issue was listed and no predicate (H1–H6) ran, so this`,
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

async function sweep() {
  // Answered once, before any listing — so an unusable transport costs ONE
  // classified verdict instead of a raw HTTP status from whichever label page
  // happened to go first (`pm:dispatched`, in the failure #7412 recorded).
  const pre = await probeTransport();
  if (pre && pre.kind !== 'reachable') reportPrerequisiteNotMet(pre);

  const findings = [];
  const seen = new Map();
  const seenPrs = new Map();
  const seenMerged = new Map();
  try {
    await sweepInto(findings, seen, seenPrs, seenMerged);
  } catch (err) {
    err.sweptSoFar = seen.size + seenPrs.size + seenMerged.size;
    throw err;
  }

  findings.sort((a, b) => a[0].number - b[0].number);
  for (const [issue, code, msg] of findings) {
    console.log(`  ${code} #${issue.number} ${msg}\n     ${issue.html_url}`);
  }
  console.log(
    `check-half-states: swept ${seen.size} open pm-labeled issue(s), ${seenPrs.size} open PR(s) ` +
      `and ${seenMerged.size} recently-merged PR(s) in ${OWNER_REPO} — ${findings.length} half-state(s) found. ` +
      `Report-only: findings are patrol input, not a gate verdict.`,
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
 * The merged-PR window H8 reads: the most recently UPDATED closed PRs, merged
 * ones only, capped at two pages (≤200 closed rows). The cap is a quota
 * decision, and its consequence is H8's stated boundary — a delivery older
 * than the window is invisible to the sweep. At this repo's measured pace
 * (~18 merges to main per working day) two pages reach back well past the
 * longest measured unexecuted-verdict latency (9 days), and a finding stays
 * visible every round until the paired write lands, because the card's
 * `pm:dispatched` is what clears it, not the PR's age. `sort=updated` rather
 * than creation order so a long-lived PR that merges late is still in the
 * window when it matters.
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

async function sweepInto(findings, seen, seenPrs, seenMerged) {
  for (const label of ['pm:dispatched', 'pm:queue', 'pm:blocked', 'pm:seat']) {
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
    if (labels.includes('pm:seat')) {
      const desync = h5SeatStickerDesync(issue);
      if (desync) findings.push([issue, 'H5', desync]);
      if (h6SeatBodyOversized(issue)) {
        const kb = (Buffer.byteLength(issue.body ?? '', 'utf8') / 1024).toFixed(1);
        findings.push([issue, 'H6', `seat body is ${kb} KB (soft bound ~10 KB) — compact to the six-section current-state template (#7583; edit history is the archive)`]);
      }
    } else if ((issue.assignees ?? []).length > 0 && labels.some((l) => l.startsWith('pm:'))) {
      // H2 needs the comment thread — fetched only for candidates, and only
      // their first pages: a claim comment is posted at claim time, so on a
      // healthy card it is early in the thread; a >100-comment card with a
      // late claim shows up as a finding the patrol then reads by hand.
      const comments = await rest(`/repos/${OWNER_REPO}/issues/${issue.number}/comments?per_page=100`);
      if (h2AssigneeNoClaimComment(issue, comments.map((c) => c.body))) {
        findings.push([issue, 'H2', 'assignee set but no claim comment on the thread']);
      }
    }
  }

  // H7 — the PR side. Listed straight from `/pulls` rather than filtered out of
  // the label pages above: PRs carry no `pm:*` label, so the issue sweep cannot
  // see them (it discards them explicitly). Drafts are INCLUDED — a draft is
  // exactly where this is still cheap to fix.
  for (const pr of await listOpenPullRequests()) {
    seenPrs.set(pr.number, pr);
    const contradiction = h7PartOfWithClosingKeyword(pr);
    if (contradiction) findings.push([pr, 'H7', contradiction]);
  }

  // H8 — the merged-PR side. One bounded listing (see the helper's window
  // note), matched against the still-open `pm:dispatched` cards the label
  // pages already collected — no per-card fetch, so the quota cost is the
  // two listing pages regardless of board size.
  for (const pr of await listRecentlyMergedPullRequests()) seenMerged.set(pr.number, pr);
  const mergedWindow = [...seenMerged.values()];
  for (const issue of seen.values()) {
    const stale = h8MergedPrStillDispatched(issue, mergedWindow);
    if (stale) findings.push([issue, 'H8', stale]);
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
  // The measured shape: a `Part of` PR merges, GitHub correctly leaves the
  // card open, and the paired write (drop `pm:dispatched`, re-grade the
  // remainder) never lands — a theme-seat pre-work audit found five cards in
  // that state at once. Fixtures reuse H7's extractor pins, so the stripping
  // and per-number-binding measurements carry over rather than being re-proved.
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
    sweep().catch((err) => {
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
