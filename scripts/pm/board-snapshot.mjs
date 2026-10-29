#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * board-snapshot — a scheduled, read-only backup of the board (#17390).
 *
 *   node scripts/pm/board-snapshot.mjs --out=archive/board     # snapshot (incremental)
 *   node scripts/pm/board-snapshot.mjs --out=archive/board --full
 *   node scripts/pm/board-snapshot.mjs --out=archive/board --restore=17297
 *   node scripts/pm/board-snapshot.mjs --self-test             # offline, no network, no token
 *
 * ## Why this exists, measured rather than supposed
 *
 * Three fleet accounts were suspended in two months. #17374 F3 measured what a
 * suspension destroys: every issue, pull request and comment the account
 * authored — while every branch and commit survives, because those belong to
 * the repository and not to a user. The board IS the fleet's state by rule
 * (pm-dispatch SKILL.md, 全体座位的不变量: 「GitHub 之外永不维护任何跟踪状态」),
 * so one suspension erases state that nothing else holds. Six cards — #17297
 * (a p1 security decision), #17128, #17150, #17276, #17313, #17318 — are gone.
 *
 * ## The one-board rule this obeys, and how it obeys it
 *
 * An ARCHIVE IS NOT A TRACKER. Nothing reads this snapshot for state: no seat,
 * no patrol, no gate, no query. The board stays the single source of truth and
 * every reading of it still goes to GitHub. What this tool produces is a
 * write-once backup that answers exactly one question, after a loss: what did
 * the record say? That is why:
 *
 *   - it has NO write path to GitHub at all — no POST, no PATCH, no DELETE, in
 *     any mode. `--restore` PRINTS a payload; a seat posts it, or nobody does;
 *   - the archive lives on an orphan branch (`board-archive`) of this same
 *     repository — no second repo, no second credential, and it is a branch, so
 *     it survives the suspension that destroys the records;
 *   - the manifest records what the run READ, never what any seat should do.
 *
 * ## Layout — one file per number, so a diff reads like a board
 *
 *   <out>/issues/<n>.json      the issue or pull request record (stable key order)
 *   <out>/comments/<n>.jsonl   its comment thread, one JSON object per line, id-ordered
 *   <out>/reviews/<n>.jsonl    pull requests only: reviews and review comments,
 *                              each line discriminated by its `record` field
 *   <out>/manifest.json        the run stamp, the `since` used, counts by state,
 *                              the board's own `open_issues_count` read in the
 *                              same run, the request count, and the resume cursor
 *   <out>/gone.json            hand-written: numbers known to be destroyed or
 *                              transferred, so the count check below can stay a
 *                              real alarm instead of a permanent red
 *
 * Every record is built key by key in a fixed order and every list is sorted, so
 * two runs over an unchanged board produce byte-identical files and the branch's
 * history is a diff of what actually changed on the board.
 *
 * ## Open first — the walk order, and why it is not a preference
 *
 * The first walk is the one that matters and it used to be the wrong way round.
 * Measured on the first scheduled run of this tool: the listing ascends by
 * update time from the beginning of the board, so 800 requests bought 137 closed
 * issues and 268 closed pull requests from February — and ZERO open cards, with
 * days of runs still to go. The records a suspension destroys are the OPEN
 * board: that is the whole reason this file exists (#17374 F3), and it was the
 * half being archived last.
 *
 * So a first walk runs in two phases, and `walk_phase` in the manifest names
 * which one a reader is looking at:
 *
 *   open         `state=open`, issues AND pull requests (the `/issues` listing
 *                carries both), walked to a short page. Nothing else starts
 *                until this finishes — a run that runs out of budget inside the
 *                open set resumes INSIDE it.
 *   history      `state=all` from the stored history cursor: the closed record,
 *                which has no other reader anywhere. Only reachable once the
 *                open set is complete. A DELTA walk runs FIRST inside this
 *                phase (below) and the backfill takes what it leaves.
 *   incremental  the steady state, once the whole board has been walked once:
 *                one `since` walk from the delta's high-water mark. In this
 *                phase the phase walk IS the delta, with the whole budget.
 *
 * An archive written before this order existed carries no `walk` block; its
 * cursor is a HISTORY cursor, so it is kept rather than discarded and the open
 * set is walked first from there. ⛔ The open and history walks are never
 * interleaved: the point is that after one run of the open phase the open board
 * is on disk.
 *
 * ## Delta first — the live board is re-read EVERY run, not after the backfill
 *
 * Measured on the 2026-09-13T14:22Z scheduled run (#18045). The open set had
 * been complete since 2026-09-10T15:39Z, the history cursor had reached
 * 2026-08-03, and every run since had spent all 800 requests walking February
 * forward at `stopped_by: budget`. The highest number in the archive was 17460:
 * #18010, #18020, #18025 — and the twelve cards an account suspension destroyed
 * that same morning — were in no snapshot at all, because the phase order only
 * reaches `incremental` once the history is COMPLETE, which was weeks away at
 * that pace. This file exists to answer one question after a loss, and on the
 * day of a loss it answered nothing.
 *
 * So the order INSIDE a run is delta, then backfill. The delta is a `state=all`
 * walk from the archive's own high-water mark over the live board, archiving
 * every row it sees, open or closed, issue or pull request. It runs on every run
 * once the open set is complete, ahead of the history backfill and ⛔ never
 * after it: a backfill always spends whatever it is given, so a delta placed
 * behind one is a delta that never runs.
 *
 * **The split of the budget, and why 300 of 800.** The delta walks under a SLICE
 * of the run budget (`DELTA_REQUEST_SLICE`); the backfill gets the remainder:
 *
 *   - a quiet six-hour window moves a few dozen numbers, so a steady-state delta
 *     costs one listing page plus a comment read per changed number — nowhere
 *     near the slice, and the backfill keeps very nearly the whole 800;
 *   - a CATCH-UP delta (this fix landing on a three-day gap, or any run after an
 *     outage) archives on the order of 250 numbers inside 300 requests, so a
 *     multi-day gap closes in a day of scheduled runs rather than in the weeks
 *     the backfill needs to reach the same rows;
 *   - and 500 requests still reach the backfill in the worst case, so a busy
 *     board slows the closed history to five eighths of its pace instead of
 *     stopping it. ⛔ An unbounded delta is not an option here: a board that
 *     moves faster than one run can read would starve the backfill forever.
 *
 * A spent SLICE is not a run stop. The delta records its cursor, the backfill
 * continues with the remaining budget, and the next run resumes the delta where
 * it stopped. Only the run budget and a rate-limit refusal stop a run, exactly
 * as before.
 *
 * **Where the delta starts**, in order: its own stored cursor — the exact
 * high-water mark, and `since` is inclusive, so the boundary row is re-read and
 * re-written identically; or, for an archive written before this walk existed,
 * the instant the open set was last enumerated IN FULL
 * (`walk.open_set.completed_at`) minus a skew. That instant is the last moment
 * this archive is known to have matched the live board. Anchoring on the
 * previous run's `generated_at` instead would declare a window the tool never
 * walked — on the manifest above, three days of board activity would have been
 * skipped by the very walk added to stop skipping it. The skew
 * (`DELTA_SKEW_MS`) covers one run's own duration: a row updated after a walk
 * read past it but before that run stamped its manifest sits in exactly that
 * window.
 *
 * **What the delta buys the count check.** A delta that reaches a short page has
 * archived every row that moved since the open set was enumerated, so the census
 * on disk IS the live open board and the count check is a reading again. In the
 * history phase it had been permanently `pending`, and on a multi-week backfill
 * that is a count check that never runs.
 *
 * ## Incremental, and the two things that makes exact
 *
 * A run reads `since` from the previous manifest (`next_since`, or the phase
 * cursor when the previous run stopped early) and asks the listing endpoint for
 * everything updated at or after it. The first run has no manifest, so it walks
 * the open set and then the whole history. Once a delta has run, `next_since` is
 * the DELTA's high-water mark rather than the backfill's, so the handover from
 * the history phase to the steady state carries no gap: the cursor the steady
 * state starts from is the one the live board was last read to.
 *
 * **The page walk never trusts `Link: rel="next"`.** The REST channel table
 * records the measurement: cursor-following stopped at 102 rows where the page
 * walk found 287 and 448, and the enumerations that were wrong looked exactly
 * like the ones that were right. So this walks `&page=N` until a SHORT page
 * (fewer rows than `per_page`) ends it, and nothing else ends it.
 *
 * **The walk re-anchors on a VALUE, never on an offset.** Ascending by
 * `updated_at`, an item that is updated mid-walk moves to the end of the
 * ordering and shifts every row behind it one slot forward — so the row that
 * was about to be the first of page k+1 lands at the last slot of page k, which
 * this run has already read past. Blind `page += 1` skips it PERMANENTLY: its
 * own `updated_at` never moved, so no later `since` window contains it either.
 * `nextWalkStep()` therefore sets `since` to the last row's `updated_at` and
 * returns to page 1 whenever that value advances, and increments the page only
 * when a whole page shares one timestamp (which is the only case an offset is
 * needed for). `since` is inclusive, so the boundary rows are re-read and
 * re-written identically — an over-read, which is the safe direction.
 *
 * ## Rate discipline — stop with a cursor, never retry in a loop
 *
 * The workflow's `GITHUB_TOKEN` is budgeted at 1,000 requests/hour PER
 * REPOSITORY. A first full snapshot of this board (~600 open issues and several
 * thousand closed ones, each with a comment thread) does not fit one run and
 * must not try: `--max-requests` stops the run cleanly, writes the manifest with
 * a `resume` cursor and exits 0, and the next scheduled run continues from that
 * cursor. Four runs a day walk the backlog in a few days without ever exceeding
 * the budget.
 *
 * A real rate-limit signal from GitHub (403/429 with the remaining count at
 * zero) is different and is NOT a planned pause: the run stops, writes the same
 * resume cursor, prints the reset time and exits `EXIT_RATE_LIMITED`. ⛔ It
 * never sleeps and never retries the request — a loop against a zero budget is
 * how one repository's automation starves every other caller of that budget.
 *
 * ## A blank page is not a reading — measured 2026-10-22
 *
 * Since 2026-10-21 the issues listing of this board answers `200 []` to more
 * than half of the requests made to it: 39 of 68 probes on 2026-10-22, each
 * with its own `x-github-request-id` and its own count against the rate limit,
 * so no cache was involved; `cache-control: no-cache`, a cache-busting query,
 * `direction`, `sort`, `per_page`, `state` and a `since` made no difference,
 * and objectui and hotcrm answered the same way. `/repos/{repo}`, the pulls
 * listing and the per-number comment pages never did (#24351). This tool read
 * a blank first page as the short page, declared the open set complete at ZERO
 * records, and the count check reported a SHORTFALL of the whole board — the
 * PR leg's 12 requests were exactly a blank open listing followed by the
 * history walk.
 *
 * So a listing page that answers EMPTY is not believed on sight. It is asked
 * again — the same URL, the same page size, no sleep, each ask a request of
 * the budget — up to `BLANK_PAGE_ASKS` times, and a blank that survives the
 * bound is acted on by WHERE the walk is (`blankPageStep`):
 *
 *   past an anchor      (`since` set, or an offset page) it is believed. The
 *                       cursor does not advance on a blank page, so a blank
 *                       that was false costs one run and nothing permanent:
 *                       the next run re-reads from the same inclusive cursor.
 *   from the beginning  (no `since`, page 1) it is believed only if the board
 *                       itself reports no open item — `open_issues_count` of
 *                       `/repos/{repo}`, read once as the witness when the
 *                       first page is blank. A board that reports open items
 *                       cannot answer a blank first page, so the walk STOPS
 *                       with its cursor (`stopped_by: blank-listing`): nothing
 *                       is marked complete, the count check stays `pending`,
 *                       and the run exits 0 as a planned stop. The next run
 *                       asks again. Once the open set is complete, a streak
 *                       of such runs is what the freshness row turns red; an
 *                       archive still in its open phase reads `building` and
 *                       never ages (§ Stale is not green) — the PR leg's
 *                       fresh dry-run archive, not `main`'s, which has been
 *                       incremental since 2026-09-10. Believing the blank
 *                       would end a phase at zero records — the measured
 *                       failure.
 *
 * ⛔ This is not the retry the section above forbids: it re-asks a `200` that
 * carried no rows, never a refusal; it is bounded by the constant and by the
 * budget; and it never sleeps. `run.blank_pages_reasked` counts the re-asks
 * and the summary prints the count when it is not zero. The per-number reads
 * (comments, reviews) are not re-asked: an empty page is their ordinary
 * answer, and they were not seen to blank.
 *
 * ## A listing that lags, and a card that moved — measured 2026-10-29 (#27726)
 *
 * Every scheduled run from 2026-10-26T15:11Z on failed its count check with a
 * SURPLUS of 1 to 3 (11 of 11 since 10-27). Read against the API on 2026-10-29,
 * the archive held exactly three open issues the board does not:
 *
 *   #25896  transferred to objectstack-ai/hotcrm#2307 (`GET` answers 301). The
 *           listing never returns a transferred number, so nothing re-read it.
 *   #26084  closed 2026-10-27T02:32:52Z, inside the 02:33Z run. That run's
 *           listing served the PRE-close row (updated 01:52) while it served
 *           rows updated at 02:33:14 and 02:33:18 fresh, and 02:33:18 became
 *           the cursor — so the close, 26 seconds older, was outside every
 *           later `since` window and the record stayed open for good.
 *   #26638  closed 2026-10-28T02:25:16Z and last touched 02:26:13, missed the
 *           same way by the 02:26Z run, whose cursor was 02:26:16.
 *
 * The same lag had left four closed pull requests archived open (#20052,
 * #20072, #20074, #22635) — outside the count check, which counts issues, so
 * nothing had said so. The listing is not consistent within one read: a row
 * can be served stale while a row updated AFTER it is served fresh, and a
 * cursor taken from the newest row then skips the stale one permanently. Two
 * fixes, one per consequence:
 *
 *   the cursor settles   a live walk's cursor (the delta's, or the incremental
 *                        walk's) is stored no later than `LISTING_SETTLE_MS`
 *                        before the instant its last listing page was read
 *                        (`settledCursor`), so the next run re-reads the
 *                        trailing window the listing may not have caught up
 *                        on. `since` is inclusive, so this is an over-read —
 *                        the safe direction — and on a quiet board the cursor
 *                        is already older than that and does not move.
 *   every verdict is     no census verdict is reported until the open listing
 *   reconciled first     has been compared with the archive's open records
 *                        number by number (`reconcileCandidates`) and every
 *                        number the two disagree on has been read ON ITS OWN,
 *                        redirects not followed (`numberReadVerdict`): a live
 *                        record is archived again; a 301 to a named issue in
 *                        ANOTHER repository is written onto the archived
 *                        record as `transferred_to`, and the census counts it
 *                        apart from the open set; a 404 or 410 is left exactly
 *                        as archived. When anything was written the board's
 *                        arithmetic is read again, so both sides of the check
 *                        reported name one instant after the repair. An
 *                        AGREEING census is reconciled too: errors of opposite
 *                        sign cancel in the counts (the 10-29T02:24Z manifest
 *                        read SURPLUS 1 with three records stuck) and never in
 *                        the records.
 *
 * ⛔ Neither is a tolerance. Nothing is subtracted on the strength of a
 * timestamp or a margin: every number that moves the verdict was READ in this
 * run and its answer is on disk. An issue whose own read answers 404/410 and
 * that no ledger answers for keeps the run red whatever the counts say
 * (`withDestroyedIssues`, verdict `destroyed` when they agree), and the summary
 * names it with its `--restore`. A reconcile cut short by its budget reports
 * the verdict from BEFORE it — the census and the board read that name one
 * instant — and never the repaired census against the earlier board read. A
 * gone-ledger number is subtracted only while the census counts it open. A
 * transfer is recognised only from GitHub's own redirect to an issue in
 * another repository, and the record stays in the archive with where it went.
 *
 * ## The count check, and why a mismatch is red rather than a warning
 *
 * `rest-channel.md`: an enumeration without a count check is not a reading. So
 * every run censuses the archive on disk and compares the open-issue count with
 * the board's own `open_issues_count` minus the open pull requests, both read in
 * the same run.
 *
 *   SHORTFALL (the archive holds fewer)  the enumeration missed cards. This is
 *                                        the failure the rule exists for.
 *   SURPLUS   (the archive holds more)   the board no longer carries records
 *                                        this archive does — the destruction
 *                                        signature this tool was built for.
 *                                        `--restore` prints them back; a number
 *                                        deliberately left destroyed goes in
 *                                        `gone.json`, which is the ONLY way to
 *                                        quiet it. A transfer is recorded by
 *                                        the reconcile above and never reaches
 *                                        this line.
 *
 * Every census is reconciled before its verdict is reported (§ A listing that
 * lags); the verdict is the census AFTER that repair, and a destroyed issue the
 * reconcile read keeps it red (`destroyed`) even when the counts agree.
 *
 * Both are non-zero exits. `pending` is the third answer and not a pass — what
 * keeps "could not check" apart from "checked and clean" (#4690) — and the
 * predicate for it is the OPEN SET, because the arithmetic above needs nothing
 * else: the check is a reading exactly when THIS run enumerated the open board
 * (the run that finishes the open phase, or any run whose walk completed), and
 * `pending` with a stated reason otherwise. A run in the history phase reports
 * `pending` even though the open set is complete, and the reason says why: that
 * enumeration is from an earlier run, so every card closed or opened since then
 * is still archived in its old state and a verdict would be an alarm about the
 * clock rather than about the board.
 *
 * ## Stale is not green — the freshness row
 *
 * `pending` keeps "could not check" apart from "checked and clean", and until
 * this row existed that distinction went no further than the manifest: the exit
 * code is built from the count check's `ok`, and `pending` leaves that `null`,
 * so a run that archived days-old state exited 0 and the workflow step that
 * reads the exit code never fired. Measured on this repository's own archive —
 * the 21 manifests `board-archive` has ever carried: NINETEEN consecutive runs
 * reported `pending`, 2026-09-10T20:23Z through 2026-09-14T20:24Z, and every
 * scheduled run over that window is `success` in the Actions history. Among
 * them 2026-09-14T02:37Z, whose delta cursor was 2026-09-12T00:40Z — two days
 * behind the live board, on the morning an account suspension destroyed cards
 * the archive did not hold (#18137). A backup that is behind is the one case
 * this file exists to prevent, and it was the case reporting success.
 *
 * So a run answers one more question: is this archive still level with the
 * live board?
 *
 *   building  the open board has never been enumerated in full. There is no
 *             reading to age yet, the open-set line already says so, and a
 *             first snapshot is not a stale one. Every `pull_request` run of
 *             the workflow is here too — it walks into a temp dir with no
 *             manifest under a `--limit`, and it stays green.
 *   fresh     this run reached a count-check VERDICT, so the census on disk and
 *             the board's own count named one instant — or it did not, and the
 *             streak of runs that did not is still inside the window below.
 *   stale     no run has reached a verdict for longer than that window. The run
 *             exits `EXIT_STALE`, the workflow step reads the code, the row
 *             goes red.
 *
 * **The anchor is the streak's START, never the delta cursor** — measured, and
 * the literal reading is a false-alarm generator. `walk.delta.cursor` is the
 * `updated_at` of the newest row the delta archived, not the instant the board
 * was last read: an empty page is a short page, `nextWalkStep` ends the walk
 * returning the cursor it was given, and so on a quiet board the delta
 * completes every run, the archive is exactly level, and that cursor sits as
 * far in the past as the last card anyone touched. Ageing it reds a board for
 * being quiet — driven in `--self-test`, not argued. What ages honestly is
 * `freshness.pending_since`: the stamp of the first run of the current streak
 * of runs that could not confirm the archive against the board.
 *
 * **And a stamp rather than a counter, for a reason the manifest already
 * states.** A count of consecutive runs moves on every run, and
 * `materialManifest` exists because a value that moves every run commits a
 * manifest-only diff on every scheduled run and buries the real ones. A streak
 * start is written once when the streak opens, carried forward byte-identical
 * for as long as it lasts, and cleared when a verdict returns: two manifest
 * writes per incident, and idempotence survives intact.
 *
 * **Why a day.** `STALE_AFTER_MS` is measured from the first UNCONFIRMED run,
 * and that run is itself one schedule interval after the last confirmed one, so
 * the red lands a day plus one interval after the archive was last known level
 * — on the four-a-day cron, the 30 hours the card asked for. The calibration is
 * from those same 21 manifests: the one legitimate catch-up in this archive's
 * history — a bounded delta slice closing a three-day gap after #18045 — ran
 * from 2026-09-13T20:23Z to 2026-09-15T02:34Z, 30 h 04 m, and every run inside
 * it held an archive that did not have the newest cards. So this window never
 * reds a single stalled run, never reds a day-long gap, reds the tail of a
 * worst-case catch-up, and reds every run of the four-day streak the card was
 * filed on.
 *
 * ⛔ What this row does NOT do is prescribe the remedy. More runs, a larger
 * budget and a wider delta slice are the maintainer's decisions and are named
 * nowhere in the verdict; what the summary prints is what CLEARS it — the first
 * run whose delta catches up and whose count check reports a verdict again.
 * ⛔ Nor does it hold the archive back: the workflow commits and mirrors what
 * the run read BEFORE the step that reads this exit code, because a stale
 * archive is still better than none.
 *
 * ⚠️ It reds a RUN, so it cannot red the ABSENCE of runs — a schedule that
 * stopped firing is still read off the Actions history, below.
 *
 * ## Heartbeat
 *
 * ⚠️ Unlike the half-state patrol, this run does NOT refresh a timestamp when
 * nothing changed — idempotence is the card's requirement and a per-run no-op
 * commit would bury the real diffs. The liveness signal is therefore the Actions
 * run history and each run's job summary, NOT the archive. A reader asking "is
 * the backup alive?" reads the workflow, never the branch.
 *
 * ## Adopting this in a sibling repo
 *
 * Copy FIVE files, unchanged — this one, `.github/workflows/fleet-patrols.yml` (its `board-snapshot` job),
 * `scripts/ci/board-snapshot-r2-upload.sh` (the workflow's R2 step runs it),
 * `scripts/pm/check-half-states.mjs` (the proxy re-exec plan and the repo
 * resolver are imported from it, so a copy without it installs an archiver that
 * cannot start) and `scripts/invoked-as.mjs` (imported by both). A repo that has
 * already adopted the half-state patrol has the last two. ⛔ Do not shorten this
 * list from memory: the imports below decide it, not this comment.
 *
 * There is no configuration. The board archived is `github.repository`, passed
 * explicitly by the workflow — and this script REFUSES the default repository
 * its resolver would otherwise fall back to, because a copy that quietly
 * archived the repo it was copied FROM would produce a complete, well-formed,
 * green archive of the wrong board.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, labelNames, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_COUNT_MISMATCH = 2;
// 3 is EXIT_PREREQUISITE_NOT_MET, imported so the register is one register.
export const EXIT_RATE_LIMITED = 4;
/**
 * The archive is behind the live board and no run has confirmed it against the
 * board for longer than `STALE_AFTER_MS` (§ Stale is not green). Its own code,
 * distinct from the count check's 2: that one says the archive and the board
 * DISAGREE about a count both sides were read for, this one says no such
 * reading has happened at all for a day.
 */
export const EXIT_STALE = 5;

/**
 * The re-exec guard, per script rather than shared with its neighbours: two
 * scripts sharing one guard name means the first one's re-exec silently
 * disarms the second's when they run in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_BOARD_SNAPSHOT_PROXY_REARMED';

/** The archive format. Bump it when a record's shape changes; the manifest carries it. */
export const ARCHIVE_SCHEMA = 1;

/** Rows per listing page. GitHub's ceiling, and the short-page test's threshold. */
export const PER_PAGE = 100;

/**
 * The per-run request budget. The workflow token's limit is 1,000/hour per
 * repository and this run is not the only caller of it (the half-state patrol
 * and the closed-card sweep share the same budget), so the default leaves room.
 *
 * ⛔ Raising this is not a tuning decision. A run that exceeds the budget does
 * not fail alone: it takes every other automated caller in the repository down
 * with it for the rest of the hour.
 */
export const DEFAULT_MAX_REQUESTS = 800;

/**
 * The delta walk's slice of that budget; the history backfill gets the rest.
 *
 * The reasoning is in the header (§ Delta first): a quiet window never comes
 * near 300, a catch-up window buys ~250 numbers a run out of it, and the 500
 * left over keep the backfill moving at five eighths of its pace instead of
 * stopping. ⛔ The delta is never unbounded — a board moving faster than one
 * run can read would otherwise starve the backfill for good — and ⛔ raising
 * this is not a tuning decision either: it comes out of the same 800.
 */
export const DELTA_REQUEST_SLICE = 300;

/**
 * How far behind the last full enumeration the delta starts when it has no
 * cursor of its own yet.
 *
 * A run stamps `generated_at` when it FINISHES, so a row updated after the walk
 * read past it but before that stamp is inside the previous window and outside
 * the next one. The skew is that window, and it is two runs' worth of the
 * workflow's own 15-minute job timeout. The cost is re-reading the handful of
 * rows that moved in half an hour; `since` is inclusive, so an over-read writes
 * identical bytes and is the safe direction.
 */
export const DELTA_SKEW_MS = 30 * 60 * 1000;

/**
 * How far behind the instant of its last listing page a live walk's stored
 * cursor sits (§ A listing that lags).
 *
 * The measured lag is a lower bound, not a size: #26084's close was 26 s older
 * than a row the same listing served fresh. Fifteen minutes is that bound many
 * times over and still a job's own timeout. The cost is re-reading whatever
 * moved in the last fifteen minutes before each run — on this board a few
 * dozen numbers at the busiest, against runs that spend ~500 of their 800 —
 * and the re-read writes identical bytes unless the row really did change.
 * ⛔ Not a tolerance: it changes what the NEXT run reads, never what this run's
 * count check counts.
 */
export const LISTING_SETTLE_MS = 15 * 60 * 1000;

/**
 * The most numbers one reconcile reads on their own. A partial open listing
 * (a page that blanked past the first) would name every archived open record
 * after it; each costs one read plus its comments, so the reconcile is bounded
 * and names what it left for the next run instead of spending the budget.
 */
export const RECONCILE_MAX_NUMBERS = 50;

/**
 * Requests the reconcile leaves unspent for the second board read: one for
 * `/repos/{repo}` and the open-pull pages, with room for a board that grows a
 * page of open pull requests.
 */
export const BOARD_READ_RESERVE = 5;

/** Where a run writes when `--out` is not given. */
export const DEFAULT_OUT_DIR = 'board';

/**
 * How long this archive may go without confirming itself against the live board
 * before a run reports `stale` and exits non-zero.
 *
 * Measured from `freshness.pending_since` — the first run of the current streak
 * of runs that reached no count-check verdict — which is itself one schedule
 * interval after the last run that did, so the red lands a day plus one
 * interval after the archive was last known level. The readings behind the
 * number are in the header (§ Stale is not green).
 *
 * ⛔ This is neither the cadence nor the budget: both are the maintainer's and
 * neither appears in this file. Widening this window does not make a stale
 * archive fresher — it only makes the run stop saying so.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The three answers the freshness row gives, in the order they age. */
export const FRESHNESS_VERDICTS = Object.freeze(['building', 'fresh', 'stale']);

export const MANIFEST_NAME = 'manifest.json';
export const GONE_LEDGER_NAME = 'gone.json';

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/** One JSON document, pretty-printed and newline-terminated. Key order is the caller's. */
export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** JSONL: one record per line, in the order given, newline-terminated. */
export function stableJsonl(records) {
  if (!records?.length) return '';
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

/**
 * An actor, reduced to what survives the account being destroyed: the login is
 * the only handle a rebuilt record can name, and it is exactly what GitHub stops
 * answering for once the account is gone.
 */
export function actorRecord(user) {
  if (!user) return null;
  return { login: user.login ?? null, id: user.id ?? null, type: user.type ?? null };
}

/**
 * The archived shape of one issue or pull request.
 *
 * ⚠️ `closed_by` is DECLARED ABSENT rather than silently missing: the listing
 * endpoint does not carry it (only `GET /issues/{n}` does), and buying it would
 * cost one extra request per archived number — which is the whole budget, spent
 * on a field no restore needs. The key is present and `null` so a reader can
 * tell "not carried by this archive" from "nobody closed it".
 */
export function issueRecord(raw) {
  const isPull = Boolean(raw.pull_request);
  return {
    number: raw.number,
    kind: isPull ? 'pull_request' : 'issue',
    title: raw.title ?? null,
    state: raw.state ?? null,
    state_reason: raw.state_reason ?? null,
    draft: isPull ? Boolean(raw.draft) : null,
    author: actorRecord(raw.user),
    labels: labelNames(raw).filter(Boolean).slice().sort(),
    assignees: (raw.assignees ?? []).map((a) => a?.login).filter(Boolean).slice().sort(),
    milestone: raw.milestone ? { number: raw.milestone.number ?? null, title: raw.milestone.title ?? null, state: raw.milestone.state ?? null } : null,
    type: raw.type?.name ?? null,
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    closed_at: raw.closed_at ?? null,
    closed_by: actorRecord(raw.closed_by),
    merged_at: isPull ? (raw.pull_request?.merged_at ?? null) : null,
    comments: raw.comments ?? 0,
    locked: Boolean(raw.locked),
    html_url: raw.html_url ?? null,
    body: raw.body ?? null,
  };
}

/** The archived shape of one issue comment. */
export function commentRecord(raw) {
  return {
    id: raw.id,
    author: actorRecord(raw.user),
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    html_url: raw.html_url ?? null,
    body: raw.body ?? null,
  };
}

/**
 * The archived shape of one review or review comment. The `record` field is the
 * discriminator: both families share one file per number, and a reader must
 * never have to infer which one a line is from the keys it happens to carry.
 */
export function reviewRecord(raw, kind) {
  return {
    record: kind,
    id: raw.id,
    author: actorRecord(raw.user),
    state: raw.state ?? null,
    path: raw.path ?? null,
    created_at: raw.created_at ?? raw.submitted_at ?? null,
    updated_at: raw.updated_at ?? null,
    html_url: raw.html_url ?? null,
    body: raw.body ?? null,
  };
}

/** Records sorted by id, so a re-fetch in a different order is not a diff. */
export function byId(records) {
  return records.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** The archive paths one number owns. */
export function issuePath(outDir, number) {
  return join(outDir, 'issues', `${number}.json`);
}
export function commentsPath(outDir, number) {
  return join(outDir, 'comments', `${number}.jsonl`);
}
export function reviewsPath(outDir, number) {
  return join(outDir, 'reviews', `${number}.jsonl`);
}

/**
 * One page of the board, oldest update first.
 *
 * `state` is the phase, and one endpoint serves both: the `/issues` listing
 * carries pull requests too, so `state=open` is the whole open board in one
 * walk. `state=all` is what the history phase needs — a closed card is exactly
 * what a suspension destroys, and every census, patrol and mutex query on the
 * live board forces `state:open`, so the closed half has no other reader at all.
 */
export function listingPath(repo, { since = null, page = 1, perPage = PER_PAGE, state = 'all' } = {}) {
  const query = [
    `state=${state}`,
    'sort=updated',
    'direction=asc',
    ...(since ? [`since=${encodeURIComponent(since)}`] : []),
    `per_page=${perPage}`,
    `page=${page}`,
  ].join('&');
  return `/repos/${repo}/issues?${query}`;
}

/** One page of the open pull requests — the right-hand side of the count check. */
export function openPullsPath(repo, { page = 1, perPage = PER_PAGE } = {}) {
  return `/repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}`;
}

/**
 * Where the walk goes after a page. The completeness rule and the anti-skip
 * rule, in one place, offline, so `--self-test` can hold both.
 *
 * `done` is decided by the SHORT PAGE and by nothing else — never by a `Link`
 * header, never by "the rows look old enough".
 */
export function nextWalkStep({ batchLength, lastUpdatedAt, since, page, perPage = PER_PAGE }) {
  if (batchLength < perPage) {
    return { done: true, since: lastUpdatedAt ?? since, page, reanchored: false };
  }
  if (lastUpdatedAt && lastUpdatedAt !== since) {
    // Re-anchor on the VALUE. Page 1 again, so a row that shifted forward while
    // this run was reading cannot fall through the gap an offset would leave.
    return { done: false, since: lastUpdatedAt, page: 1, reanchored: true };
  }
  // A whole page sharing one timestamp: the offset is the only way past it.
  return { done: false, since, page: page + 1, reanchored: false };
}

/** How many times one listing page is asked before a blank answer is acted on. */
export const BLANK_PAGE_ASKS = 6;

/**
 * What the walk does with a listing page that answered EMPTY (§ A blank page
 * is not a reading). `asks` counts the asks of THIS page so far, blank every
 * time; `boardOpenItems` is the board's own `open_issues_count` (issues and
 * pull requests), or null when it was not read.
 *
 *   ask-again  below the bound: the same page once more.
 *   believe    at the bound, where a blank CAN be the board's answer — past an
 *              anchor, where the cursor stays put and the next run re-reads.
 *   stop       at the bound, from the BEGINNING of a board that reports open
 *              items (or whose count is unknown): believing it would end a
 *              phase at zero records.
 */
export function blankPageStep({ asks, since, page, boardOpenItems, bound = BLANK_PAGE_ASKS }) {
  if (asks < bound) return { action: 'ask-again' };
  const fromTheBeginning = since === null && page === 1;
  if (fromTheBeginning && boardOpenItems !== 0) return { action: 'stop' };
  return { action: 'believe' };
}

export const WALK_PHASES = Object.freeze(['open', 'history', 'incremental']);

/**
 * The walk this run performs: which phase, from which cursor, and the reason —
 * printed, so a run that silently became full (or silently stayed incremental,
 * or silently skipped the open set) cannot be mistaken for another one.
 *
 * The plan also carries forward what earlier runs finished, because those two
 * cursors are independent: an open-phase stop resumes the OPEN cursor and the
 * history cursor waits untouched; a history-phase stop resumes the history
 * cursor and the open set stays complete.
 *
 * ⚠️ A manifest with no `walk` block was written before the open phase existed.
 * Its cursor is a HISTORY cursor by construction — the only walk that version
 * had was `state=all` — so it is preserved and the open set is walked first.
 * `next_since` is the legacy "a walk finished here" marker: that version wrote
 * it only when a walk completed, and a completed `state=all` walk did archive
 * the open records, so such an archive is already past both phases.
 */
export function selectWalkPlan(manifest, { full = false, override = null } = {}) {
  const walk = manifest?.walk ?? null;
  const legacyDone = Boolean(manifest) && !walk && Boolean(manifest.next_since || manifest.run?.walk_complete);
  const state = {
    openSetComplete: walk ? Boolean(walk.open_set?.complete) : legacyDone,
    openCursor: walk?.open_set?.cursor ?? null,
    openCompletedAt: walk?.open_set?.completed_at ?? null,
    historyComplete: walk ? Boolean(walk.history?.complete) : legacyDone,
    historyCursor: walk ? (walk.history?.cursor ?? null) : (manifest && !walk && !legacyDone ? (manifest.resume?.since ?? null) : null),
  };

  if (override) return { ...state, phase: 'incremental', since: override, reason: `--since=${override} given on the command line` };
  if (full) {
    return {
      openSetComplete: false,
      openCursor: null,
      openCompletedAt: null,
      historyComplete: false,
      historyCursor: null,
      phase: 'open',
      since: null,
      reason: '--full: the whole board again, open records first, ignoring the previous manifest',
    };
  }
  if (!manifest) return { ...state, phase: 'open', since: null, reason: 'no previous manifest — the first run is full, and it starts with the open board' };
  if (!state.openSetComplete) {
    return {
      ...state,
      phase: 'open',
      since: state.openCursor,
      reason: state.openCursor
        ? `resuming the open set at ${state.openCursor} — the closed history does not start until it is complete`
        : state.historyCursor
          ? `the previous archive walked the closed history only — the open board is read first, and its cursor (${state.historyCursor}) is kept`
          : 'the open set is not complete — it is walked before the closed history',
    };
  }
  if (!state.historyComplete) {
    return {
      ...state,
      phase: 'history',
      since: state.historyCursor,
      reason: state.historyCursor
        ? `the open set is complete — the closed history resumes at ${state.historyCursor}`
        : 'the open set is complete — the closed history starts at the beginning of the board',
    };
  }
  if (manifest.resume?.since) return { ...state, phase: 'incremental', since: manifest.resume.since, reason: `resuming the previous run at ${manifest.resume.since}` };
  if (manifest.next_since) return { ...state, phase: 'incremental', since: manifest.next_since, reason: `incremental from the previous run's next_since (${manifest.next_since})` };
  return { ...state, phase: 'incremental', since: null, reason: 'the previous manifest carries no cursor — falling back to a full read' };
}

/**
 * An ISO stamp moved back by `skewMs`, or the stamp itself when it is not one.
 *
 * ⛔ An unparseable stamp is returned unchanged rather than turned into a
 * cursor built from `NaN`: `since=Invalid Date` would be dropped by the listing
 * endpoint and the delta would silently become a full walk of the whole board.
 */
export function skewedSince(stamp, skewMs = DELTA_SKEW_MS) {
  const at = Date.parse(stamp ?? '');
  if (!Number.isFinite(at)) return stamp ?? null;
  return new Date(at - skewMs).toISOString();
}

/**
 * The delta walk this run performs before anything else, or why it performs
 * none. Pure, so `--self-test` holds the rule the card was filed for.
 *
 * The delta exists because the phase order alone leaves the live board unread
 * for as long as the backfill lasts (§ Delta first). So it runs whenever the
 * open set is complete and the backfill is not, and it declines in exactly the
 * cases where something else is already reading the live board this run:
 *
 *   no manifest      the first run enumerates the open board itself
 *   open incomplete  the open walk IS the live read, and it runs first
 *   history complete the incremental phase walk IS the delta, with all 800
 *   --full           the whole board again; a delta would re-read its own rows
 *   --since=X        that walk IS the delta, at the cursor the operator named
 */
export function selectDeltaPlan(manifest, { full = false, override = null, skewMs = DELTA_SKEW_MS, slice = DELTA_REQUEST_SLICE } = {}) {
  const off = (reason) => ({ run: false, since: null, slice, reason });
  if (!manifest) return off('no previous manifest — the first run enumerates the open board itself, which is the freshest read there is');
  if (full) return off('--full re-reads the whole board from the beginning, so a delta ahead of it would read the same rows twice');
  if (override) return off(`--since=${override} was given on the command line — that walk IS the delta`);

  const walk = manifest.walk ?? null;
  const legacyDone = !walk && Boolean(manifest.next_since || manifest.run?.walk_complete);
  const openSetComplete = walk ? Boolean(walk.open_set?.complete) : legacyDone;
  if (!openSetComplete) return off('the open set is not complete — the open walk reads the live board itself, and nothing starts before it');
  const historyComplete = walk ? Boolean(walk.history?.complete) : legacyDone;
  if (historyComplete) return off('the whole board has been walked once — the incremental phase walk IS the delta, and it gets the entire budget');

  const cursor = walk?.delta?.cursor ?? null;
  if (cursor) return { run: true, since: cursor, slice, reason: `the delta resumes at its own cursor (${cursor}) — the archive's high-water mark over the live board` };

  const enumerated = walk?.open_set?.completed_at ?? null;
  if (enumerated) {
    const since = skewedSince(enumerated, skewMs);
    return { run: true, since, slice, reason: `no delta cursor yet — the live board was last enumerated in full at ${enumerated}, so the delta starts there minus the skew (${since})` };
  }
  if (manifest.next_since) return { run: true, since: manifest.next_since, slice, reason: `no delta cursor yet — a completed walk left its high-water mark at ${manifest.next_since}` };
  const stamp = manifest.generated_at ?? null;
  if (stamp) {
    const since = skewedSince(stamp, skewMs);
    return { run: true, since, slice, reason: `no cursor names when the board was last read — the previous run's stamp minus the skew (${since}) is the closest anchor this archive has` };
  }
  return { run: true, since: null, slice, reason: 'the previous manifest carries neither a cursor nor a stamp — the delta reads from the beginning, bounded by its slice' };
}

/**
 * The request count a bounded walk stops at: its slice, or the run budget when
 * that is nearer. Pure, because it is the arithmetic the budget split rests on
 * and the alternative is reading it off a live run.
 */
export function sliceCeiling({ spent, max, slice }) {
  return Math.min(max, spent + slice);
}

/** The walks that read the LIVE board, whose cursor becomes the next run's `since`. */
export const LIVE_WALKS = Object.freeze(['delta', 'incremental']);

/**
 * The cursor a live walk stores: its high-water mark, or `settleMs` before the
 * instant its last listing page was read when that is earlier (§ A listing
 * that lags). A cursor already older than that is returned unchanged, which is
 * what keeps a quiet board's manifest byte-identical run over run.
 *
 * ⛔ An unparseable stamp on either side returns the cursor unchanged rather
 * than a cursor built from `NaN` — the same rule as `skewedSince`.
 */
export function settledCursor(cursor, readAt, settleMs = LISTING_SETTLE_MS) {
  const at = Date.parse(cursor ?? '');
  const read = Date.parse(readAt ?? '');
  if (!Number.isFinite(at) || !Number.isFinite(read)) return cursor ?? null;
  const settled = read - settleMs;
  return at > settled ? new Date(settled).toISOString() : cursor;
}

/**
 * The numbers a reconcile reads on its own: every open record of the archive
 * the open listing does not carry, and every number the listing carries that
 * the archive does not hold open. Numbers in the gone ledger are neither — the
 * maintainer has already answered for them. Ascending, so the oldest stuck
 * record is read first, and bounded by `max` with the remainder counted.
 */
export function reconcileCandidates({ archivedOpen, listedOpen, gone = [], max = RECONCILE_MAX_NUMBERS }) {
  const ledger = new Set(gone ?? []);
  const listed = new Set(listedOpen ?? []);
  const archived = new Set(archivedOpen ?? []);
  const all = [
    ...[...archived].filter((n) => !listed.has(n)),
    ...[...listed].filter((n) => !archived.has(n)),
  ].filter((n) => !ledger.has(n)).sort((a, b) => a - b);
  return { numbers: all.slice(0, max), left: Math.max(0, all.length - max) };
}

/**
 * What one number's own read says, from the status and `Location` of a read
 * that does not follow redirects.
 *
 *   live         200 naming this number in this repository: the record as the
 *                board holds it now — archive it again.
 *   transferred  a redirect to `/repos/{other}/issues/{n}` in ANOTHER repository.
 *   destroyed    404 or 410: the destruction signature; nothing is written.
 *   unreadable   anything else — including a redirect within this repository
 *                (a rename), which is not a transfer and is not acted on.
 */
export function numberReadVerdict({ repo, number, status, location = null, body = null }) {
  if (status === 200 && body) {
    // A 200 that is not THIS number in THIS repository is a followed redirect
    // or a confused answer, and archiving it would write another card's record
    // under this number's file.
    const here = !body.repository_url || String(body.repository_url).toLowerCase().endsWith(`/repos/${String(repo).toLowerCase()}`);
    return body.number === number && here ? { verdict: 'live', raw: body } : { verdict: 'unreadable', status };
  }
  if ([301, 302, 307, 308].includes(status)) {
    const moved = /\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/?$/.exec(String(location ?? ''));
    if (moved && moved[1].toLowerCase() !== String(repo).toLowerCase()) return { verdict: 'transferred', to: `${moved[1]}#${moved[2]}` };
    return { verdict: 'unreadable', status };
  }
  if (status === 404 || status === 410) return { verdict: 'destroyed', status };
  return { verdict: 'unreadable', status };
}

/**
 * Why this run's census is not a reading about the board, or `null` when it is.
 *
 * The arithmetic needs the OPEN set and nothing else, so the predicate is about
 * the open set and nothing else: a run that enumerated the open board just now
 * has a reading even though the closed history is still resuming, and a run that
 * inherited a complete open set from an EARLIER run does not — cards close and
 * open while a multi-day history walk runs, and the archive still holds their
 * old state, so a verdict there would report the clock as a board defect.
 *
 * A DELTA that reached a short page this run is the third way to have a reading,
 * and it is the one that makes the check run at all in the history phase: every
 * row that moved since the open set was enumerated has just been re-archived in
 * its current state, so the census on disk and the board's own count name the
 * same instant again. Without it the verdict is `pending` for as long as the
 * backfill lasts, which on this board was weeks.
 */
export function countCheckPendingReason({
  phase,
  openSetComplete = false,
  openSetCompletedHere = false,
  deltaCompletedHere = false,
  walkCompletedHere = false,
  boardCountRead = false,
}) {
  if (!boardCountRead) return "the board's own count was not read this run, so there is nothing to compare the census with";
  if (walkCompletedHere || openSetCompletedHere) return null;
  if (!openSetComplete) return 'the open set is still being walked — a census of a partial open set says nothing about the board in either direction';
  if (deltaCompletedHere) return null;
  if (phase === 'history') {
    return 'the open set is complete but was enumerated in an earlier run and this run\'s delta did not catch up with the live board, and the closed history is still walking — cards closed or opened since then are archived in their old state';
  }
  return 'the walk stopped before it finished, so the archive is behind the board by an unknown amount';
}

/**
 * The count check. `expected` is the board's own arithmetic; `archived` is a
 * census of files on disk. `pending` is a third answer and not a pass: pass the
 * reason from `countCheckPendingReason` and the manifest carries it, so a reader
 * gets "why not" rather than a bare verdict.
 */
export function countCheck({ openIssuesCount, openPullRequests, archivedOpenIssues, gone = [], pending = null }) {
  const expected = Number(openIssuesCount ?? 0) - Number(openPullRequests ?? 0);
  const goneOpen = new Set(gone ?? []);
  const archived = Number(archivedOpenIssues ?? 0);
  const shortfall = Math.max(0, expected - archived);
  const surplus = Math.max(0, archived - expected - goneOpen.size);
  if (pending) {
    return { verdict: 'pending', reason: pending, expected, archived, shortfall: null, surplus: null, gone_ledger: goneOpen.size, ok: null };
  }
  const ok = shortfall === 0 && surplus === 0;
  return { verdict: ok ? 'ok' : shortfall > 0 ? 'shortfall' : 'surplus', reason: null, expected, archived, shortfall, surplus, gone_ledger: goneOpen.size, ok };
}

/**
 * A count check that the reconcile's own reads contradict. An issue whose read
 * answered 404/410 and that the gone ledger does not answer for is a destroyed
 * record whatever the arithmetic says: a card opened in the same window
 * cancels it in the counts and never in the records. So it keeps the run red
 * — `destroyed` when the arithmetic agreed, the arithmetic's own verdict when
 * it did not — and the numbers travel with the verdict. `pending` stays
 * pending: there was no reading to contradict.
 */
export function withDestroyedIssues(check, numbers = []) {
  if (!numbers.length || check.verdict === 'pending') return check;
  return { ...check, verdict: check.ok ? 'destroyed' : check.verdict, destroyed: [...numbers].sort((a, b) => a - b), ok: false };
}

/** A duration in whole hours, for a line a human reads. */
function inHours(ms) {
  return `${Math.round(ms / 3_600_000)} h`;
}

/** Milliseconds between two ISO stamps, or `null` when either is not one. */
function elapsedBetween(from, to) {
  const a = Date.parse(from ?? '');
  const b = Date.parse(to ?? '');
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

/**
 * Is this archive still level with the live board, and for how long has it not
 * been? The row that keeps a stale archive from reporting success.
 *
 * The predicate is the count check's own verdict rather than a second reading
 * of the walk: `pending` is exactly "this run could not confirm the census
 * against the board", in every phase and for every reason, and any other
 * verdict means the two sides named one instant this run. So a streak of
 * `pending` IS the archive going unconfirmed, and its length is what ages.
 *
 * ⛔ Not the delta cursor, which is the `updated_at` of the newest row the
 * delta archived and not the instant the board was last read — on a quiet board
 * it sits days in the past while the archive is exactly level (§ Stale is not
 * green). ⛔ And not a counter of runs: a value that moves every run commits a
 * manifest-only diff on every scheduled run. The streak's START stamp is
 * written once, carried byte-identical while the streak lasts, and cleared when
 * a verdict returns.
 */
export function freshnessCheck({
  openSetComplete = false,
  countCheckVerdict = null,
  generatedAt = null,
  previousPendingSince = null,
  staleAfterMs = STALE_AFTER_MS,
}) {
  if (!openSetComplete) {
    return {
      verdict: 'building',
      pending_since: null,
      reason: 'the open board has never been enumerated in full — this archive is still being built, which the open-set line above is where to read',
    };
  }
  if (countCheckVerdict !== 'pending') return { verdict: 'fresh', pending_since: null, reason: null };
  // An unreadable stored stamp restarts the streak here rather than being
  // turned into an age built from `NaN`: a clock that cannot be read must not
  // decide a verdict in either direction.
  const carried = Number.isFinite(Date.parse(previousPendingSince ?? '')) ? previousPendingSince : null;
  const since = carried ?? generatedAt ?? null;
  const elapsed = elapsedBetween(since, generatedAt);
  if (elapsed !== null && elapsed > staleAfterMs) {
    return {
      verdict: 'stale',
      pending_since: since,
      reason: `no run has reached a count-check verdict since ${since}, longer than the ${inHours(staleAfterMs)} this archive accepts — it is behind the live board by an unknown amount`,
    };
  }
  return {
    verdict: 'fresh',
    pending_since: since,
    reason: `no count-check verdict since ${since}, still inside the ${inHours(staleAfterMs)} this archive accepts`,
  };
}

/**
 * The manifest, minus every field that moves on every run whether or not
 * anything changed. Comparing THIS is what makes "no change ⇒ no write" real:
 * a run stamp is a fact about the run, not about the board.
 *
 * ⚠️ `board.read_at` is one of those stamps and is stripped for the same reason
 * the top-level ones are. It is nested, so it survived the first spelling of
 * this function — and a steady-state run, whose whole job is to write nothing,
 * would move it and commit a manifest-only diff on every scheduled run, burying
 * the real ones exactly the way the header promises this tool never will.
 */
export function materialManifest(manifest) {
  if (!manifest) return null;
  const { generated_at: _stamp, requests: _requests, run: _run, board, ...rest } = manifest;
  if (board === undefined) return rest;
  const { read_at: _readAt, ...boardWithoutStamp } = board ?? {};
  return { ...rest, board: boardWithoutStamp };
}

/** Did anything about the BOARD change between these two manifests? */
export function manifestChanged(previous, next) {
  if (!previous) return true;
  return stableJson(materialManifest(previous)) !== stableJson(materialManifest(next));
}

/** The manifest this run would write, built key by key so the file is diff-stable. */
export function buildManifest({
  repo,
  generatedAt,
  walkPhase,
  walk,
  since,
  sinceReason,
  nextSince,
  resume,
  counts,
  board,
  check,
  freshness = null,
  requests,
  run,
}) {
  return {
    schema: ARCHIVE_SCHEMA,
    repo,
    generated_at: generatedAt,
    walk_phase: walkPhase,
    walk,
    since: since ?? null,
    since_reason: sinceReason,
    next_since: nextSince ?? null,
    resume: resume ?? null,
    counts,
    board,
    count_check: check,
    freshness,
    requests,
    run,
  };
}

// ---------------------------------------------------------------------------
// The archive on disk — read, census, write. No network in this section.
// ---------------------------------------------------------------------------

/** A JSON file, or `null` when it is absent or unreadable. Absence is a normal answer here. */
export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The numbers a seat has declared destroyed or moved, so the surplus alarm can stay one. */
export function readGoneLedger(outDir) {
  const raw = readJsonFile(join(outDir, GONE_LEDGER_NAME));
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.numbers) ? raw.numbers : [];
  return rows.map((r) => Number(typeof r === 'object' ? r?.number : r)).filter((n) => Number.isInteger(n));
}

/**
 * A census of the archive as it stands on disk — counts by state and by kind.
 *
 * Read from the FILES, never accumulated across runs: an accumulated counter
 * drifts from what is actually stored, and the count check would then be
 * comparing the board with a number this tool made up. `openNumbers`, when
 * given a Set, is filled with the open records' numbers for the reconcile.
 */
export function censusArchive(outDir, { openNumbers = null } = {}) {
  const counts = { issues_open: 0, issues_closed: 0, issues_transferred: 0, pulls_open: 0, pulls_closed: 0, records: 0 };
  let names = [];
  try {
    names = readdirSync(join(outDir, 'issues'));
  } catch {
    return counts;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = readJsonFile(join(outDir, 'issues', name));
    if (!record) continue;
    counts.records += 1;
    const pull = record.kind === 'pull_request';
    const open = record.state === 'open';
    // A transferred record is kept — it is what the card said — but it is no
    // longer this board's to count (§ A listing that lags).
    if (record.transferred_to) {
      counts.issues_transferred += 1;
      continue;
    }
    if (open) openNumbers?.add(record.number);
    if (pull && open) counts.pulls_open += 1;
    else if (pull) counts.pulls_closed += 1;
    else if (open) counts.issues_open += 1;
    else counts.issues_closed += 1;
  }
  return counts;
}

/**
 * Write `text` at `path` only if the bytes differ. Returns whether it wrote.
 *
 * The rename is what makes a run interruptible without corrupting the archive:
 * a run killed by the job timeout leaves either the old file or the new one,
 * never half of either.
 */
export function writeIfChanged(path, text, { dryRun = false } = {}) {
  let existing = null;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === text) return false;
  if (dryRun) return true;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return true;
}

/**
 * Apply a whole run's writes. `files` is a Map of path to contents; the return
 * value is the paths that actually moved, so "nothing changed" is a measured
 * fact and not an assumption the caller makes about its own inputs.
 */
export function applyWrites(files, { dryRun = false } = {}) {
  const written = [];
  for (const [path, text] of files) {
    if (writeIfChanged(path, text, { dryRun })) written.push(path);
  }
  return written.sort();
}

// ---------------------------------------------------------------------------
// --restore — prints, never posts
// ---------------------------------------------------------------------------

/**
 * The sentence a rebuilt record must carry (#17374 F3.4): a record that does not
 * say it is a rebuild is a forgery of the original, and the number it names is
 * the destroyed one rather than its own.
 */
export function provenanceSentence(runStamp) {
  return `rebuilt from the board snapshot at ${runStamp}; the original was destroyed with its author's account`;
}

/**
 * The recreate payload for one destroyed card: a provenance header, the original
 * body, the labels to re-apply, and the comment thread as a second block.
 *
 * ⛔ It carries no attribution footer. The comment channel appends its own, and
 * a footer shipped inside a body that a seat then posts is how a record ends up
 * with two.
 */
export function restorePayload({ issue, comments = [], runStamp, repo }) {
  const opened = issue.author?.login ? `@${issue.author.login}` : 'an account that no longer resolves';
  const closed = issue.closed_at ? `, ${issue.state}${issue.state_reason ? ` (${issue.state_reason})` : ''} at ${issue.closed_at}` : `, ${issue.state}`;
  const header = [
    `> **Rebuilt record — not the original.** Originally ${repo}#${issue.number}, opened by ${opened}`,
    `> at ${issue.created_at}, last updated ${issue.updated_at}${closed}.`,
    `> ${provenanceSentence(runStamp)}.`,
    '> The number above is the destroyed card; this card carries a new one.',
  ].join('\n');

  const labels = issue.labels?.length ? issue.labels.map((l) => `\`${l}\``).join(', ') : '(none)';
  const blocks = [
    header,
    '',
    issue.body?.trim() ? issue.body : '_(the archived body was empty)_',
    '',
    '---',
    '',
    `**Labels to re-apply:** ${labels}`,
    `**Assignees on the original:** ${issue.assignees?.length ? issue.assignees.map((a) => `@${a}`).join(', ') : '(none)'}`,
  ];

  const thread = [
    '',
    '---',
    '',
    `**Comment thread — ${comments.length} comment(s).** Post each as its own comment, not as part of the body.`,
    '',
  ];
  for (const [index, comment] of comments.entries()) {
    const who = comment.author?.login ? `@${comment.author.login}` : 'an account that no longer resolves';
    thread.push(`### Comment ${index + 1} — ${who} at ${comment.created_at}`, '', comment.body?.trim() ? comment.body : '_(empty)_', '');
  }

  return `${[...blocks, ...thread].join('\n').replace(/\n+$/, '')}\n`;
}

/** Read one number back out of the archive. Reads the directory and nothing else. */
export function readArchivedCard(outDir, number) {
  const issue = readJsonFile(issuePath(outDir, number));
  if (!issue) return { ok: false, error: `no archived record for #${number} at ${issuePath(outDir, number)}` };
  let comments = [];
  try {
    comments = readFileSync(commentsPath(outDir, number), 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    comments = [];
  }
  return { ok: true, issue, comments };
}

// ---------------------------------------------------------------------------
// Live layer — the only section that touches the network, and it only READS.
// ---------------------------------------------------------------------------

/** A rate-limit stop. Carried as a type so the run can tell it from a transport failure. */
export class RateLimited extends Error {
  constructor(message, { resetAt = null, path = null } = {}) {
    super(message);
    this.name = 'RateLimited';
    this.resetAt = resetAt;
    this.path = path;
  }
}

/**
 * Is this refusal the budget, rather than a permission problem? GitHub answers
 * both 403 and 429 for a spent budget, and the discriminator is the remaining
 * count — a 403 with budget left is about the token, and retrying it is as
 * useless as retrying the other one is harmful.
 */
export function rateLimitStop({ status, remaining, retryAfter, reset }) {
  if (status !== 403 && status !== 429) return null;
  const spent = String(remaining ?? '') === '0';
  if (!spent && !retryAfter) return null;
  const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : retryAfter ? `${retryAfter}s from now` : 'unknown';
  return { resetAt };
}

/** The request counter every fetch in this run passes through. */
const requestCount = { value: 0 };

/**
 * The one read helper. `reply: true` is the reconcile's per-number read: the
 * redirect is NOT followed — a transfer is read off its own `Location`, never
 * off whatever the destination answers to this token — and a redirect, a 404
 * or 410, or a 5xx comes back as `{ status, location, body: null }` instead of
 * a throw: one number the board cannot answer is that number's verdict
 * (`unreadable`), never the run's.
 * A rate-limit refusal throws in both modes.
 */
async function rest(path, { reply = false } = {}) {
  requestCount.value += 1;
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(reply ? { redirect: 'manual' } : {}),
  });
  if (reply && ([301, 302, 307, 308, 404, 410].includes(res.status) || res.status >= 500)) {
    return { status: res.status, location: res.headers.get('location'), body: null };
  }
  if (!res.ok) {
    const stop = rateLimitStop({
      status: res.status,
      remaining: res.headers.get('x-ratelimit-remaining'),
      retryAfter: res.headers.get('retry-after'),
      reset: res.headers.get('x-ratelimit-reset'),
    });
    if (stop) throw new RateLimited(`GET ${path} refused for the rate limit; it resets at ${stop.resetAt}`, { resetAt: stop.resetAt, path });
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return reply ? { status: res.status, location: null, body } : body;
}

/** Every page of one paginated read, walked to a short page. Never a `Link` header. */
async function readAllPages(makePath, { budget }) {
  const rows = [];
  for (let page = 1; ; page++) {
    budget.spend();
    const batch = await rest(makePath(page));
    const list = Array.isArray(batch) ? batch : [];
    rows.push(...list);
    if (list.length < PER_PAGE) return rows;
  }
}

/** The run's request budget. `spend()` throws the planned stop, which is not an error. */
class BudgetExhausted extends Error {}

/**
 * A SLICE of the run's budget is spent. ⛔ Not a run stop and not a failure:
 * it is the boundary between the delta walk and the backfill, and the whole
 * point is that the run continues past it with the requests it did not spend.
 * Carried as its own type so the two can never be confused at the catch.
 */
class SliceExhausted extends Error {}

function makeBudget(max) {
  const runOut = () => new BudgetExhausted(`the per-run budget of ${max} requests is spent`);
  return {
    max,
    get spent() {
      return requestCount.value;
    },
    spend() {
      if (requestCount.value >= max) throw runOut();
    },
    /**
     * This budget minus `requests` held back at its end — the reconcile's, so
     * the second board read it may need still fits after it.
     */
    reserve(requests) {
      const ceiling = Math.max(requestCount.value, max - requests);
      return {
        max: ceiling,
        get spent() {
          return requestCount.value;
        },
        spend() {
          if (requestCount.value >= ceiling) throw new BudgetExhausted(`the reconcile's share of the ${max}-request budget is spent (${requests} held back for the board read)`);
        },
      };
    },
    /**
     * A tighter budget inside this one, for a walk that must not spend the whole
     * run. The ceiling is taken when the slice is opened, so a delta that starts
     * after the open phase gets its slice of what is LEFT rather than a second
     * allowance on top of it.
     */
    slice(requests) {
      const ceiling = sliceCeiling({ spent: requestCount.value, max, slice: requests });
      return {
        max: ceiling,
        get spent() {
          return requestCount.value;
        },
        spend() {
          if (requestCount.value >= max) throw runOut();
          if (requestCount.value >= ceiling) throw new SliceExhausted(`the delta's slice of ${requests} request(s) is spent; the backfill continues with the rest`);
        },
      };
    },
  };
}

/**
 * Everything one number owes the archive this run, as files. Comment and review
 * reads are skipped when the record says there is nothing to read — the listing
 * carries the comment count, and on this board most numbers spend zero requests
 * beyond the page they arrived on.
 */
async function collectNumber(repo, raw, outDir, { budget }) {
  const record = issueRecord(raw);
  const files = new Map();
  files.set(issuePath(outDir, record.number), stableJson(record));

  if (record.comments > 0) {
    const rows = await readAllPages((page) => `/repos/${repo}/issues/${record.number}/comments?per_page=${PER_PAGE}&page=${page}`, { budget });
    files.set(commentsPath(outDir, record.number), stableJsonl(byId(rows.map(commentRecord))));
  }

  if (record.kind === 'pull_request') {
    const reviews = await readAllPages((page) => `/repos/${repo}/pulls/${record.number}/reviews?per_page=${PER_PAGE}&page=${page}`, { budget });
    const reviewComments = await readAllPages((page) => `/repos/${repo}/pulls/${record.number}/comments?per_page=${PER_PAGE}&page=${page}`, { budget });
    const rows = [...byId(reviews.map((r) => reviewRecord(r, 'review'))), ...byId(reviewComments.map((r) => reviewRecord(r, 'review_comment')))];
    if (rows.length) files.set(reviewsPath(outDir, record.number), stableJsonl(rows));
  }

  return { record, files };
}

/**
 * The board's own arithmetic — the right-hand side of the count check, read as
 * one act so the two sides of the comparison name one instant.
 */
async function readBoardArithmetic(repo, budget) {
  budget.spend();
  const meta = await rest(`/repos/${repo}`);
  const openPulls = await readAllPages((page) => openPullsPath(repo, { page }), { budget });
  return { open_issues_count: meta?.open_issues_count ?? null, open_pull_requests: openPulls.length, read_at: new Date().toISOString() };
}

/** One page of the open board for the reconcile: creation order, which an update mid-walk does not reshuffle. */
export function openSetPath(repo, { page = 1, perPage = PER_PAGE } = {}) {
  return `/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=${perPage}&page=${page}`;
}

/**
 * A disagreeing census, reconciled before it is reported (§ A listing that
 * lags). Returns the files the repair writes and what each number answered;
 * a spent budget ends it early with the reason (the caller then reports the
 * verdict from before it), and a rate-limit refusal propagates to the run
 * like every other read.
 *
 * ⛔ A blank FIRST page of the open listing ends it with nothing read: an
 * empty listing of a board with open items is not a reading (§ A blank page),
 * and believing it would name every archived open record as a candidate.
 */
async function reconcileOpenSet(repo, outDir, { budget, gone }) {
  const files = new Map();
  const outcome = { listed: null, candidates: 0, left: 0, reread: [], transferred: [], destroyed: [], unreadable: [], blank_pages_reasked: 0, reason: null };
  try {
    const listed = new Set();
    for (let page = 1, asks = 0; ;) {
      budget.spend();
      const batch = await rest(openSetPath(repo, { page }));
      const rows = Array.isArray(batch) ? batch : [];
      if (rows.length === 0 && ++asks < BLANK_PAGE_ASKS) {
        outcome.blank_pages_reasked += 1;
        continue;
      }
      if (rows.length === 0 && page === 1) {
        outcome.reason = `the open listing answered EMPTY ${asks} times from the beginning, so it named nothing to compare`;
        return { files, outcome };
      }
      for (const raw of rows) listed.add(raw.number);
      if (rows.length < PER_PAGE) break;
      page += 1;
      asks = 0;
    }
    outcome.listed = listed.size;
    const archivedOpen = new Set();
    censusArchive(outDir, { openNumbers: archivedOpen });
    const { numbers, left } = reconcileCandidates({ archivedOpen, listedOpen: listed, gone });
    outcome.candidates = numbers.length + left;
    outcome.left = left;
    for (const number of numbers) {
      budget.spend();
      const read = numberReadVerdict({ repo, number, ...(await rest(`/repos/${repo}/issues/${number}`, { reply: true })) });
      if (read.verdict === 'live') {
        const collected = await collectNumber(repo, read.raw, outDir, { budget });
        for (const [path, text] of collected.files) files.set(path, text);
        outcome.reread.push({ number, state: collected.record.state });
      } else if (read.verdict === 'transferred') {
        const archived = readJsonFile(issuePath(outDir, number));
        if (archived) files.set(issuePath(outDir, number), stableJson({ ...archived, transferred_to: read.to }));
        outcome.transferred.push({ number, to: read.to });
      } else if (read.verdict === 'destroyed') {
        outcome.destroyed.push({ number, kind: readJsonFile(issuePath(outDir, number))?.kind ?? 'issue' });
      } else {
        outcome.unreadable.push({ number, status: read.status });
      }
    }
  } catch (err) {
    if (!(err instanceof BudgetExhausted)) throw err;
    outcome.reason = `${err.message} — the rest is left for the next run`;
  }
  return { files, outcome };
}

/**
 * The snapshot run.
 *
 * Every early exit — budget, rate limit — leaves the same two things behind: the
 * files already collected, and the phase cursor the next run continues from.
 * ⛔ There is no path here that retries a refused request.
 *
 * The phases run in one order and never interleave: the open board first, then
 * the closed history, then (once the whole board has been walked once) a single
 * incremental `since` walk. A run that stops inside a phase resumes inside it.
 *
 * Inside the history phase the order is DELTA, then backfill: the live board is
 * re-read before one request is spent on February. ⛔ Never the other way round
 * — a backfill always spends everything it is given, so a delta behind one is a
 * delta that never runs, which is exactly the state #18045 measured.
 */
async function snapshot(repo, options) {
  const outDir = options.out;
  const previous = readJsonFile(join(outDir, MANIFEST_NAME));
  const plan = selectWalkPlan(previous, { full: options.full, override: options.since });
  const deltaPlan = selectDeltaPlan(previous, { full: options.full, override: options.since });
  const budget = makeBudget(options.maxRequests);

  const files = new Map();
  const seen = new Set();
  // One cursor per walk, kept apart on purpose: a stop inside the open set must
  // not move the history cursor, finishing the open set must not lose it, and
  // the delta's high-water mark over the LIVE board is a third fact that neither
  // of the other two answers — conflating it with the history cursor is what
  // left the live board unread for as long as the backfill lasted.
  const cursors = {
    open: plan.openCursor,
    delta: deltaPlan.since,
    history: plan.historyCursor,
    incremental: plan.phase === 'incremental' ? plan.since : null,
  };
  let phase = plan.phase;
  let openSetComplete = plan.openSetComplete;
  let openSetCompletedHere = false;
  let openCompletedAt = plan.openCompletedAt;
  let historyComplete = plan.historyComplete;
  let deltaRan = false;
  let deltaCompletedHere = false;
  let deltaRequests = 0;
  let stopped = null;
  // WHICH walk was running when a stop landed, so the resume cursor named in the
  // manifest is that walk's own. The walk_phase alone cannot answer it any more:
  // a run stopped inside the delta is in the history phase and must not resume
  // the history walk at a delta cursor.
  let stoppedIn = null;
  let walkComplete = false;
  let blankPagesReasked = 0;
  let board = { open_issues_count: null, open_pull_requests: null, read_at: null };
  // The instant each walk's last listing page came back — what a live walk's
  // stored cursor settles against (§ A listing that lags).
  const listingReadAt = {};

  /**
   * One phase's page walk. Returns whether the phase FINISHED (a short page, and
   * nothing else); the planned stops leave through the same throws the single
   * walk used, and the cursor they resume from is already in `cursors`.
   */
  async function walk(key, state, walkBudget = budget) {
    let since = cursors[key];
    let page = 1;
    let blankAsks = 0;
    let witness;
    for (;;) {
      walkBudget.spend();
      const batch = await rest(listingPath(repo, { since, page, state }));
      listingReadAt[key] = new Date().toISOString();
      const rows = Array.isArray(batch) ? batch : [];
      if (rows.length === 0) {
        // § A blank page is not a reading. The witness — the board's own open
        // count — is read once per walk, and only when a first page is blank.
        blankAsks += 1;
        if (since === null && page === 1 && witness === undefined) {
          walkBudget.spend();
          witness = (await rest(`/repos/${repo}`))?.open_issues_count ?? null;
        }
        const verdict = blankPageStep({ asks: blankAsks, since, page, boardOpenItems: witness ?? null });
        if (verdict.action === 'ask-again') {
          blankPagesReasked += 1;
          continue;
        }
        if (verdict.action === 'stop') {
          stopped = { kind: 'blank-listing', reason: `the ${key} listing answered EMPTY ${blankAsks} times from the beginning while the board reports ${witness ?? 'an unknown number of'} open item(s)` };
          return false;
        }
      } else {
        blankAsks = 0;
      }
      for (const raw of rows) {
        if (seen.has(raw.number)) continue;
        if (options.limit && seen.size >= options.limit) {
          stopped = { kind: 'limit', reason: `--limit=${options.limit} reached` };
          return false;
        }
        const collected = await collectNumber(repo, raw, outDir, { budget: walkBudget });
        for (const [path, text] of collected.files) files.set(path, text);
        seen.add(raw.number);
        cursors[key] = collected.record.updated_at ?? cursors[key];
      }
      const step = nextWalkStep({ batchLength: rows.length, lastUpdatedAt: rows.at(-1)?.updated_at ?? null, since, page });
      if (step.done) {
        cursors[key] = step.since ?? cursors[key];
        return true;
      }
      since = step.since;
      page = step.page;
    }
  }

  try {
    if (phase === 'open') {
      stoppedIn = 'open';
      if (await walk('open', 'open')) {
        openSetComplete = true;
        openSetCompletedHere = true;
        openCompletedAt = new Date().toISOString();
        cursors.open = null;
        // Read the board's arithmetic HERE, while the open set it describes has
        // just been enumerated. This is the tightest instant the count check can
        // name, and it is bought before the history walk spends what is left.
        board = await readBoardArithmetic(repo, budget);
        phase = 'history';
      }
    }

    // THE DELTA, and it goes first. `selectDeltaPlan` has already declined the
    // cases where something else reads the live board this run, so reaching
    // here means nothing else will.
    if (deltaPlan.run && !stopped) {
      stoppedIn = 'delta';
      deltaRan = true;
      const spentBefore = requestCount.value;
      try {
        deltaCompletedHere = await walk('delta', 'all', budget.slice(deltaPlan.slice));
      } catch (err) {
        if (!(err instanceof SliceExhausted)) throw err;
        // A spent slice is the boundary between two walks, not a stop: the
        // archive is behind the live board by a cursor it just wrote down, and
        // the backfill runs on with what the delta did not spend.
        deltaCompletedHere = false;
      }
      deltaRequests = requestCount.value - spentBefore;
      // The board's own arithmetic, bought right after the delta and BEFORE the
      // backfill. The delta has just levelled the archive with the live board,
      // which is the tightest instant the check can name; and a backfill spends
      // whatever it is given, so a census left until after it is a census that
      // never happens — which is how `count_check` became permanently pending.
      if (!stopped && board.read_at === null) board = await readBoardArithmetic(repo, budget);
    }

    if (phase === 'history' && !stopped) {
      stoppedIn = 'history';
      if (await walk('history', 'all')) {
        historyComplete = true;
        walkComplete = true;
      }
    } else if (phase === 'incremental' && !stopped) {
      stoppedIn = 'incremental';
      if (await walk('incremental', 'all')) walkComplete = true;
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) stopped = { kind: 'budget', reason: err.message };
    else if (err instanceof RateLimited) stopped = { kind: 'rate-limit', reason: err.message, resetAt: err.resetAt };
    else throw err;
  }

  // A live walk's cursor settles behind the listing it was read from, so the
  // next run re-reads the window this listing may not have caught up on —
  // stopped or finished alike, since a stopped walk's cursor is also the next
  // run's start.
  for (const key of LIVE_WALKS) {
    if (listingReadAt[key]) cursors[key] = settledCursor(cursors[key], listingReadAt[key]);
  }

  // The board's own arithmetic, read in THIS run so the two sides of the count
  // check describe one instant. Skipped when the run stopped without having
  // enumerated the open set: spending the last requests on a census of an
  // archive that is knowingly partial buys a reading nobody can use.
  if (!stopped && board.read_at === null) {
    try {
      board = await readBoardArithmetic(repo, budget);
    } catch (err) {
      if (err instanceof BudgetExhausted) stopped = { kind: 'budget', reason: err.message };
      else if (err instanceof RateLimited) stopped = { kind: 'rate-limit', reason: err.message, resetAt: err.resetAt };
      else throw err;
    }
  }

  // Write the records BEFORE the manifest: a run that dies between the two
  // leaves an archive richer than its manifest claims, which the next run
  // repairs. The other order loses records and reports success.
  const written = applyWrites(files, { dryRun: options.dryRun });

  const gone = readGoneLedger(outDir);
  const takeCensus = () => {
    const open = new Set();
    const census = censusArchive(outDir, { openNumbers: open });
    return {
      counts: census,
      check: countCheck({
        openIssuesCount: board.open_issues_count,
        openPullRequests: board.open_pull_requests,
        archivedOpenIssues: census.issues_open,
        // Only a ledgered number the census COUNTED is subtracted: one archived
        // closed, or recorded as transferred, is not in `issues_open`, and
        // subtracting it anyway would absorb a real surplus of the same size.
        gone: gone.filter((n) => open.has(n)),
        pending: countCheckPendingReason({
          phase,
          openSetComplete,
          openSetCompletedHere,
          deltaCompletedHere,
          walkCompletedHere: walkComplete,
          boardCountRead: board.open_issues_count !== null,
        }),
      }),
    };
  };
  let { counts, check } = takeCensus();

  // Every census that reached a verdict is reconciled before it is reported
  // (§ A listing that lags) — an agreeing one too, because two errors of
  // opposite sign cancel in the arithmetic and never in the records. The
  // numbers the open listing and the archive disagree on are read on their
  // own and the answers written. When anything was written, the board's
  // arithmetic is read AGAIN so both sides name one instant after the repair,
  // and the census is retaken; that second verdict is the one reported.
  //
  // A reconcile cut short — by its budget, or before the second board read —
  // reports the FIRST verdict: the census before any repair against the board
  // read before it, the one pair that names one instant. ⛔ Never the repaired
  // census against the first board read: a repaired close can cancel a
  // destroyed card's surplus there. Either way, an issue whose own read
  // answered 404/410 and that no ledger answers for keeps the verdict red.
  let reconcile = null;
  if (!stopped && check.verdict !== 'pending') {
    const firstCheck = check;
    const first = { verdict: check.verdict, expected: check.expected, archived: check.archived, shortfall: check.shortfall, surplus: check.surplus };
    let repaired = null;
    try {
      repaired = await reconcileOpenSet(repo, outDir, { budget: budget.reserve(BOARD_READ_RESERVE), gone });
    } catch (err) {
      if (!(err instanceof RateLimited)) throw err;
      stopped = { kind: 'rate-limit', reason: err.message, resetAt: err.resetAt };
    }
    if (repaired) {
      for (const path of applyWrites(repaired.files, { dryRun: options.dryRun })) if (!written.includes(path)) written.push(path);
      written.sort();
      reconcile = { first, ...repaired.outcome, wrote: repaired.files.size, cut_short: Boolean(repaired.outcome.reason) };
      if (!reconcile.cut_short && repaired.files.size > 0) {
        try {
          board = await readBoardArithmetic(repo, budget);
          ({ counts, check } = takeCensus());
        } catch (err) {
          if (err instanceof BudgetExhausted) reconcile = { ...reconcile, cut_short: true, reason: `the second board read: ${err.message}` };
          else if (err instanceof RateLimited) stopped = { kind: 'rate-limit', reason: err.message, resetAt: err.resetAt };
          else throw err;
        }
      }
      if (reconcile.cut_short) {
        counts = censusArchive(outDir);
        check = { ...firstCheck, reason: `the reconcile was cut short (${reconcile.reason}), so this is the census before it against the board read before it` };
      }
      check = withDestroyedIssues(check, reconcile.destroyed.filter((d) => d.kind === 'issue').map((d) => d.number));
    }
  }

  /**
   * The delta's own cursor and completeness, beside the history cursor and
   * never merged into it.
   *
   * In the INCREMENTAL phase the phase walk is the delta — same endpoint, same
   * `state=all`, same ascent — so its outcome is recorded here rather than left
   * blank, and the block means one thing in every phase: how far the archive has
   * read the live board. ⛔ The counters of how much this run SPENT belong in
   * `run`, which `materialManifest` strips: a number that moves every run would
   * commit a manifest-only diff on every scheduled run and bury the real ones.
   */
  const deltaBlock = deltaRan
    ? { complete: deltaCompletedHere, cursor: cursors.delta, since: deltaPlan.since, slice: deltaPlan.slice }
    : phase === 'incremental'
      ? { complete: walkComplete, cursor: cursors.incremental, since: plan.since ?? null, slice: deltaPlan.slice }
      : {
          complete: Boolean(previous?.walk?.delta?.complete),
          cursor: previous?.walk?.delta?.cursor ?? null,
          since: previous?.walk?.delta?.since ?? null,
          slice: deltaPlan.slice,
        };

  const resumeWalk = stoppedIn ?? phase;
  // One stamp for this run, read once: the freshness row ages the streak
  // against the very instant the manifest records, so two `new Date()` calls
  // would have the row and the manifest disagree about when this run finished.
  const generatedAt = new Date().toISOString();

  // Is the archive this run just wrote still level with the live board? The
  // count check answers "did this run confirm it"; this answers "and if not,
  // for how long". The streak start is carried from the previous manifest, so a
  // first run under an archive written before this row existed opens its own.
  const freshness = freshnessCheck({
    openSetComplete,
    countCheckVerdict: check.verdict,
    generatedAt,
    previousPendingSince: previous?.freshness?.pending_since ?? null,
  });

  const manifest = buildManifest({
    repo,
    generatedAt,
    walkPhase: phase,
    walk: {
      open_set: { complete: openSetComplete, completed_at: openCompletedAt, cursor: cursors.open },
      delta: deltaBlock,
      history: { complete: historyComplete, cursor: cursors.history },
    },
    since: plan.since,
    sinceReason: plan.reason,
    // The archive's high-water mark over the LIVE board, which is what the
    // steady state must start from. Once a delta has run that is the delta's
    // cursor and not the backfill's: the backfill's cursor is somewhere in
    // February and handing it over would replay months as an `increment`.
    nextSince: deltaRan
      ? (cursors.delta ?? previous?.next_since ?? null)
      : walkComplete
        ? (phase === 'incremental' ? cursors.incremental : cursors.history)
        : (previous?.next_since ?? null),
    resume: stopped ? { since: cursors[resumeWalk] ?? null, phase: resumeWalk, stopped_by: stopped.kind, reason: stopped.reason, ...(stopped.resetAt ? { resets_at: stopped.resetAt } : {}) } : null,
    counts,
    board,
    check,
    freshness,
    requests: requestCount.value,
    run: {
      numbers_read: seen.size,
      files_written: written.length,
      walk_complete: walkComplete,
      open_set_completed_here: openSetCompletedHere,
      delta_ran: deltaRan,
      delta_completed_here: deltaCompletedHere,
      delta_requests: deltaRequests,
      blank_pages_reasked: blankPagesReasked,
      reconcile,
    },
  });

  const manifestPath = join(outDir, MANIFEST_NAME);
  const manifestMoved = manifestChanged(previous, manifest) || written.length > 0;
  if (manifestMoved) writeIfChanged(manifestPath, stableJson(manifest), { dryRun: options.dryRun });

  return { manifest, written, manifestMoved, stopped, plan, deltaPlan, walkComplete, reconcile };
}

/** What each phase is doing, in the words a reader of the run summary needs. */
const PHASE_LEGEND = Object.freeze({
  open: 'the open board first: the records a suspension destroys',
  history: 'the delta first, then the closed history with what the delta leaves',
  incremental: 'the steady state: one `since` walk over everything that moved',
});

/** Why a run performed no delta walk, in the words the phase makes true. */
const NO_DELTA_LEGEND = Object.freeze({
  open: 'not run — the open walk IS this run\'s read of the live board',
  history: 'not run',
  incremental: 'not run separately — the incremental walk above IS the delta, with the whole budget',
});

/** What the run tells a reader, and the exit code that goes with it. */
export function renderRun(result, options) {
  const m = result.manifest;
  const openSet = m.walk?.open_set ?? { complete: false, completed_at: null, cursor: null };
  const openLine = openSet.complete
    ? `complete${openSet.completed_at ? ` (enumerated ${openSet.completed_at})` : ''}${m.run.open_set_completed_here ? ' — BY THIS RUN' : ''}`
    : `INCOMPLETE — the open board is still being walked${openSet.cursor ? `, resuming at ${openSet.cursor}` : ''}`;
  const delta = m.walk?.delta ?? { complete: false, cursor: null, since: null, slice: null };
  const deltaLine = m.run.delta_ran
    ? `${delta.complete ? 'CAUGHT UP with the live board' : `BEHIND the live board — the next run resumes at ${delta.cursor ?? 'its stored cursor'}`}`
      + ` — from ${delta.since ?? '(the beginning)'}, ${m.run.delta_requests} request(s) of its ${delta.slice}-request slice`
      + `${result.deltaPlan?.reason ? `\n               ${result.deltaPlan.reason}` : ''}`
    : `${NO_DELTA_LEGEND[m.walk_phase] ?? 'not run'}${result.deltaPlan?.reason && m.walk_phase !== 'incremental' ? ` — ${result.deltaPlan.reason}` : ''}`;
  const lines = [
    `board-snapshot — ${m.repo} into ${options.out}${options.dryRun ? ' (DRY RUN — nothing was written)' : ''}`,
    `  phase        ${m.walk_phase} — ${PHASE_LEGEND[m.walk_phase] ?? 'an unknown phase'}`,
    `  open set     ${openLine}`,
    `  delta        ${deltaLine}`,
    `  since        ${m.since ?? '(from the beginning)'} — ${m.since_reason}`,
    `  read         ${m.run.numbers_read} number(s) in ${m.requests} request(s); walk ${m.run.walk_complete ? 'complete' : 'INCOMPLETE'}${m.run.blank_pages_reasked ? `; ${m.run.blank_pages_reasked} blank page(s) asked again` : ''}`,
    `  written      ${result.written.length} file(s)${result.manifestMoved ? ' + manifest' : ''}`,
    `  archive      ${m.counts.records} record(s): ${m.counts.issues_open} open / ${m.counts.issues_closed} closed issue(s)${m.counts.issues_transferred ? ` / ${m.counts.issues_transferred} transferred` : ''}, ${m.counts.pulls_open} open / ${m.counts.pulls_closed} closed pull request(s)`,
  ];

  if (!result.written.length && !result.manifestMoved) {
    lines.push('  idempotent   nothing changed on the board since the last run, so nothing was written.');
  }

  const rec = m.run.reconcile ?? null;
  if (rec) {
    const first = rec.first.verdict === 'ok'
      ? `the first census agreed (archived ${rec.first.archived}, board ${rec.first.expected})`
      : `the first census disagreed (${rec.first.verdict === 'surplus' ? `SURPLUS of ${rec.first.surplus}` : `SHORTFALL of ${rec.first.shortfall}`}: archived ${rec.first.archived}, board ${rec.first.expected})`;
    const numbers = (rows, show) => (rows.length ? rows.map(show).join(', ') : 'none');
    const compared = rec.listed !== null && rec.listed !== undefined;
    lines.push(
      `  reconcile    ${first}; the open listing was compared with the archive's open records before the verdict below:`,
      !compared
        ? `               nothing was compared — ${rec.reason}.`
        : rec.candidates === 0
          ? `               the open listing carried ${rec.listed} number(s), and every one agrees with the archive.`
          : `               the open listing carried ${rec.listed} number(s); ${rec.candidates} disagreed with the archive and were read on their own${rec.left ? ` (${rec.left} left for the next run)` : ''}.`,
    );
    if (compared && rec.candidates > 0) {
      lines.push(
        `               archived again: ${numbers(rec.reread, (r) => `#${r.number} ${r.state}`)}`,
        `               transferred:    ${numbers(rec.transferred, (r) => `#${r.number} → ${r.to}`)}`,
        `               destroyed:      ${numbers(rec.destroyed, (d) => `#${d.number} ${d.kind === 'pull_request' ? 'pull request' : 'issue'} (404/410 — --restore=${d.number})`)}`,
        ...(rec.unreadable.length ? [`               unreadable:     ${numbers(rec.unreadable, (r) => `#${r.number} (HTTP ${r.status})`)}`] : []),
      );
    }
    if (rec.cut_short && compared) {
      lines.push(`               CUT SHORT — ${rec.reason}. What was read is written, but the count check below is the census from BEFORE the reconcile against the board read before it: the one pair that names one instant.`);
    } else if (rec.wrote > 0) {
      lines.push('               The board\'s arithmetic was then read again; the count check below is that second reading.');
    }
  }

  const check = m.count_check;
  if (check.verdict === 'pending') {
    const board = m.board.open_issues_count === null ? 'the board\'s own count was not read this run' : `the board reports ${check.expected}`;
    lines.push(
      `  count check  PENDING — archived ${check.archived} open issue(s); ${board}.`,
      `               Why not a verdict: ${check.reason ?? 'the snapshot is incomplete.'}`,
    );
  } else if (check.verdict === 'destroyed') {
    lines.push(
      `  count check  DESTROYED — the counts agree (${check.archived} archived, board says ${check.expected}), but ${check.destroyed.map((n) => `#${n}`).join(', ')} answered 404/410 on its own read and no ledger answers for it.`,
      '               Counts can cancel; a record cannot. This is the destruction signature this tool exists for, so the run is red.',
      `               Print one back with --restore=N. A number deliberately left destroyed belongs in ${GONE_LEDGER_NAME}.`,
    );
  } else if (check.ok) {
    lines.push(`  count check  ok — ${check.archived} open issue(s) archived, board says ${check.expected} (open_issues_count ${m.board.open_issues_count} minus ${m.board.open_pull_requests} open pull request(s)).`);
  } else if (check.verdict === 'shortfall') {
    lines.push(
      `  count check  SHORTFALL of ${check.shortfall} — the archive holds ${check.archived} open issue(s) where the board reports ${check.expected}.`,
      '               The enumeration missed cards. This is not a warning: an enumeration without a count check is not a reading,',
      '               and one that fails its count check is a reading that says it is wrong.',
      ...(check.destroyed?.length ? [`               And ${check.destroyed.map((n) => `#${n}`).join(', ')} answered 404/410 on its own read, with no ledger answering for it.`] : []),
    );
  } else {
    lines.push(
      `  count check  SURPLUS of ${check.surplus} — the archive holds ${check.archived} open issue(s) where the board reports only ${check.expected}.`,
      '               Records this archive carries are no longer on the board: destroyed with an account, or deleted. A transfer is recorded by the reconcile and is not one of them.',
      `               Print one back with --restore=N. A number deliberately left destroyed belongs in ${GONE_LEDGER_NAME}, which is the only way to quiet this.`,
      ...(check.destroyed?.length ? [`               Read on their own this run, ${check.destroyed.map((n) => `#${n}`).join(', ')} answered 404/410.`] : []),
    );
  }

  if (result.stopped?.kind === 'rate-limit') {
    lines.push(
      `  STOPPED      rate limit: ${result.stopped.reason}`,
      `               Nothing was retried. The next run resumes the ${m.resume.phase} walk at ${m.resume.since}.`,
    );
  } else if (result.stopped?.kind === 'blank-listing') {
    lines.push(
      `  STOPPED      ${result.stopped.reason} — a blank page is not a reading.`,
      '               Nothing was believed and nothing was marked complete; the count check stays pending. The next run asks again,',
      `               ${m.resume.since ? `resuming the ${m.resume.phase} walk at ${m.resume.since}` : `from the beginning of the ${m.resume.phase} walk`}.`,
    );
  } else if (result.stopped) {
    lines.push(
      `  paused       ${result.stopped.reason} — this is a planned stop, not a failure.`,
      `               The next run resumes the ${m.resume.phase} walk at ${m.resume.since}.`,
    );
  }

  // LAST, because it is the run's verdict about the archive rather than about
  // the walk — and because everything above is what a reader needs to have read
  // before it. A stale row is the one line that decides the exit code on a run
  // whose walk did nothing wrong at all.
  const fresh = m.freshness ?? { verdict: 'fresh', pending_since: null, reason: null };
  const unconfirmedFor = fresh.pending_since ? elapsedBetween(fresh.pending_since, m.generated_at) : null;
  const ago = unconfirmedFor === null ? 'an unreadable stamp' : `${inHours(unconfirmedFor)} ago`;
  if (fresh.verdict === 'stale') {
    lines.push(
      `  freshness    STALE — no run has reached a count-check verdict since ${fresh.pending_since} (${ago}); the window is ${inHours(STALE_AFTER_MS)}.`,
      '               This archive is behind the live board by an unknown amount, so the run is RED rather than green: a backup that is',
      '               behind while reporting success is the one state this row exists to end. Whatever this run DID read is committed',
      '               before the step that reads this exit code — a stale archive is better than none.',
      '               It clears on the first run whose delta catches up with the live board and whose count check reports a verdict again.',
    );
  } else if (fresh.verdict === 'building') {
    lines.push('  freshness    building — the open board has never been enumerated in full, so there is no reading to age yet.');
  } else if (fresh.pending_since) {
    lines.push(`  freshness    behind — no count-check verdict since ${fresh.pending_since} (${ago}), still inside the ${inHours(STALE_AFTER_MS)} window.`);
  } else {
    lines.push('  freshness    fresh — this run confirmed the archive against the live board.');
  }

  const exitCode = result.stopped?.kind === 'rate-limit'
    ? EXIT_RATE_LIMITED
    : check.ok === false
      ? EXIT_COUNT_MISMATCH
      : fresh.verdict === 'stale'
        ? EXIT_STALE
        : EXIT_OK;
  return { text: lines.join('\n'), exitCode };
}

/**
 * `--verify-counts`: the count check against a LIVE enumeration instead of the
 * archive, in the same arithmetic and through the same page walk.
 *
 * It exists because the archive's own count check is only a reading once the
 * first full snapshot has finished — days of scheduled runs, on a board this
 * size — and until then nothing would have exercised the rule the whole
 * enumeration rests on. This answers it in a dozen requests, on any day.
 */
async function verifyCounts(repo, options) {
  const budget = makeBudget(options.maxRequests);
  const numbers = new Set();
  let since = null;
  let page = 1;
  for (;;) {
    budget.spend();
    const batch = await rest(listingPath(repo, { since, page, state: 'open' }));
    const rows = Array.isArray(batch) ? batch : [];
    for (const raw of rows) if (!raw.pull_request) numbers.add(raw.number);
    const step = nextWalkStep({ batchLength: rows.length, lastUpdatedAt: rows.at(-1)?.updated_at ?? null, since, page });
    if (step.done) break;
    since = step.since;
    page = step.page;
  }
  budget.spend();
  const meta = await rest(`/repos/${repo}`);
  const openPulls = await readAllPages((p) => openPullsPath(repo, { page: p }), { budget });
  const check = countCheck({
    openIssuesCount: meta?.open_issues_count ?? null,
    openPullRequests: openPulls.length,
    archivedOpenIssues: numbers.size,
  });
  const lines = [
    `board-snapshot --verify-counts — ${repo}`,
    `  enumerated   ${numbers.size} open issue(s) by walking pages to a short page (no Link header was read)`,
    `  board says   open_issues_count ${meta?.open_issues_count} minus ${openPulls.length} open pull request(s) = ${check.expected}`,
    `  requests     ${requestCount.value}`,
    check.ok
      ? '  count check  ok — the enumeration is a reading.'
      : `  count check  ${check.verdict.toUpperCase()} — shortfall ${check.shortfall}, surplus ${check.surplus}. The enumeration is NOT a reading.`,
  ];
  return { text: lines.join('\n'), exitCode: check.ok ? EXIT_OK : EXIT_COUNT_MISMATCH, check };
}

function reportPrerequisiteNotMet(err) {
  console.error(
    `\nboard-snapshot: PREREQUISITE NOT MET — ${err.message}\n\n` +
      "  Fix:  run this where node's fetch reaches api.github.com with a token that can read issues\n" +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      '        itself with that flag when HTTPS_PROXY is set).\n\n' +
      '  NOTHING WAS ARCHIVED. This is not an empty board and not a complete snapshot — it is no\n' +
      '  reading at all, and the previous archive is untouched.\n' +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}. Capture it BEFORE any pipe:\n` +
      '  `node scripts/pm/board-snapshot.mjs --out=board > /tmp/b.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--full', '--dry-run', '--verify-counts', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['out', 'since', 'max-requests', 'limit', 'restore']);

export function readOption(argv, name, fallback = null) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit !== undefined) return hit.slice(name.length + 3);
  // `--name VALUE` is accepted for every option too: the card spells the restore
  // recipe `--restore <n>`, and a tool that answered a usage error to the
  // spelling its own card documents would be read as broken rather than strict.
  const at = argv.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < argv.length && !argv[at + 1].startsWith('-')) return argv[at + 1];
  return fallback;
}

/**
 * Parse, and REFUSE anything unrecognised.
 *
 * A typo must never make this decision quietly: `--dry-runn` that parses as
 * "no flags given" is a live run, and `--limitt=20` is a full-board pull with a
 * user token — the one thing the dispatch of this card forbids by name.
 */
export function parseOptions(argv) {
  const consumed = new Set();
  for (const [index, arg] of argv.entries()) {
    if (consumed.has(index)) continue;
    if (!arg.startsWith('-')) return { ok: false, error: `unexpected argument ${JSON.stringify(arg)} — every input to this tool is a flag.` };
    const name = arg.startsWith('--') && arg.includes('=') ? arg.slice(2, arg.indexOf('=')) : null;
    if (name === null && KNOWN_OPTIONS.includes(arg.slice(2))) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('-')) return { ok: false, error: `${arg} takes a value: write ${arg}=VALUE or ${arg} VALUE.` };
      consumed.add(index + 1);
      continue;
    }
    if (name === null && !KNOWN_FLAGS.includes(arg)) return { ok: false, error: `unknown flag ${arg}. Known: ${[...KNOWN_FLAGS, ...KNOWN_OPTIONS.map((o) => `--${o}=…`)].join(' ')}` };
    if (name !== null && !KNOWN_OPTIONS.includes(name)) return { ok: false, error: `unknown option --${name}=…. Known: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}` };
  }

  const maxRaw = readOption(argv, 'max-requests', String(DEFAULT_MAX_REQUESTS));
  const maxRequests = Number(maxRaw);
  if (!Number.isInteger(maxRequests) || maxRequests < 1) return { ok: false, error: `--max-requests=${maxRaw} is not a positive integer.` };

  const limitRaw = readOption(argv, 'limit', null);
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limitRaw !== null && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: `--limit=${limitRaw} is not a positive integer.` };

  const restoreRaw = readOption(argv, 'restore', null);
  const restore = restoreRaw === null ? null : Number(restoreRaw);
  if (restoreRaw !== null && (!Number.isInteger(restore) || restore < 1)) return { ok: false, error: `--restore=${restoreRaw} is not an issue number.` };

  return {
    ok: true,
    options: {
      out: readOption(argv, 'out', DEFAULT_OUT_DIR),
      since: readOption(argv, 'since', null),
      full: argv.includes('--full'),
      dryRun: argv.includes('--dry-run'),
      verifyCounts: argv.includes('--verify-counts'),
      maxRequests,
      limit,
      restore,
    },
  };
}

const USAGE = [
  'board-snapshot — back the board up to an orphan branch, so an account suspension destroys no record.',
  '',
  '  node scripts/pm/board-snapshot.mjs [--out=DIR] [--full] [--since=ISO] [--limit=N]',
  '                                     [--max-requests=N] [--dry-run]',
  '  node scripts/pm/board-snapshot.mjs --out=DIR --restore=N     # print a recreate payload; posts nothing',
  '  node scripts/pm/board-snapshot.mjs --verify-counts           # the count check, live, no archive',
  '  node scripts/pm/board-snapshot.mjs --self-test               # offline, no network, no token',
  '',
  `  Default --out is ${DEFAULT_OUT_DIR}/ and the default budget is ${DEFAULT_MAX_REQUESTS} requests per run.`,
  '  The first walk archives the OPEN board before the closed history; `walk_phase` in the',
  '  manifest says which phase a run is in, and a run that stops inside a phase resumes in it.',
  '  The board is PM_SWEEP_REPO or GITHUB_REPOSITORY; this tool refuses to guess one.',
  '  It reads GitHub and writes files. It has no write path to GitHub in any mode.',
].join('\n');

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`board-snapshot: ${parsed.error}`);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  // --restore reads the archive directory and nothing else: no token, no
  // network, no repo. It works from a bare checkout of the archive branch,
  // which is the situation it is for.
  if (options.restore !== null) {
    const card = readArchivedCard(options.out, options.restore);
    if (!card.ok) {
      console.error(`board-snapshot: ${card.error}`);
      return EXIT_USAGE;
    }
    const manifest = readJsonFile(join(options.out, MANIFEST_NAME));
    console.log(restorePayload({
      issue: card.issue,
      comments: card.comments,
      runStamp: manifest?.generated_at ?? 'an unstamped archive',
      repo: manifest?.repo ?? 'this repository',
    }));
    return EXIT_OK;
  }

  const repoRes = resolveSweepRepo(process.env);
  if (!repoRes.valid || repoRes.source === 'default') {
    console.error(
      `board-snapshot: the board to archive is ${repoRes.source === 'default' ? 'not set' : `${repoRes.source}=${JSON.stringify(repoRes.repo)}, which is not owner/name`}.\n` +
        '  Set PM_SWEEP_REPO (the workflow passes github.repository). ⛔ This tool refuses the resolver\'s\n' +
        '  default: a copy of it archiving the repo it was copied FROM produces a complete, well-formed,\n' +
        '  green archive of the wrong board.',
    );
    return EXIT_USAGE;
  }

  if (!TOKEN) {
    console.error(
      'board-snapshot: no token. Set GITHUB_TOKEN (the workflow supplies its own) or GH_TOKEN.\n' +
        '  ⛔ Refusing to run unauthenticated: the anonymous budget is 60 requests/hour, so an\n' +
        '  unauthenticated run would write a truncated archive and report it as a snapshot.',
    );
    return EXIT_PREREQUISITE_NOT_MET;
  }

  try {
    const rendered = options.verifyCounts ? await verifyCounts(repoRes.repo, options) : renderRun(await snapshot(repoRes.repo, options), options);
    console.log(rendered.text);
    return rendered.exitCode;
  } catch (err) {
    if (err instanceof RateLimited) {
      console.error(`board-snapshot: ${err.message}. Nothing was retried.`);
      return EXIT_RATE_LIMITED;
    }
    return reportPrerequisiteNotMet(err);
  }
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

// ---------------------------------------------------------------------------
// Self-test — offline, no network, no token, and the only instrument watching
// the rules a clean tree cannot exercise: the walk ORDER (open board first, and
// a run that stops inside the open set resumes inside it), the walk's re-anchor,
// the resume cursors, the count check's three verdicts and the predicate that
// decides between them, the restore header, and the two structural properties
// (no write path to GitHub, no retry loop) that this tool's whole standing rests
// on.
//
// Every section opens with `battery(...)`; the floor below requires the OPENED
// set to equal the DECLARED set with each battery at or above its own count, so
// a section that stops running names itself instead of going quiet. The counts
// are a FLOOR, never an equality — adding cases is ordinary work.
// ---------------------------------------------------------------------------

/**
 * A board this file makes up, served through the same paths the live layer asks
 * for. Ordering, paging, the `since` window and the `state` filter are modelled
 * because those are what the walk is steering by — a stub that ignored them
 * would agree with any walk order at all.
 */
/** A non-200 answer from the fake board: the status and, for a redirect, its `Location`. */
class FakeReply {
  constructor(status, location = null) {
    this.status = status;
    this.location = location;
  }
}

/**
 * The lag measured 2026-10-29 (#26084) is `lagging`: number → the row as it
 * stood BEFORE its last update, served by the first `lagListings` listing GETs
 * in place of the current row while every other row is served current. `moved`
 * is number → `owner/name#n` (the per-number read answers 301 there, and the
 * destination answers its own card, so a read that FOLLOWS the redirect gets
 * another repository's record — exactly what production fetch would do);
 * `destroyed` numbers answer 404 and `failing` numbers 502. A per-number read
 * serves the current row.
 */
function fakeBoard({ rows, openPulls = [], blankListings = 0, lagging = new Map(), lagListings = 0, moved = new Map(), destroyed = new Set(), failing = new Set() }) {
  const calls = [];
  // The blank reply measured 2026-10-22, reproduced: the first N listing GETs
  // answer `[]` whatever the board holds. The witness and the pulls do not.
  let blanksLeft = blankListings;
  let lagLeft = lagListings;
  const serve = (path) => {
    if (path === '/repos/o/r') return { open_issues_count: rows.filter((r) => r.state === 'open').length };
    const url = new URL(`https://board${path}`);
    const q = url.searchParams;
    const page = Number(q.get('page') ?? 1);
    const perPage = Number(q.get('per_page') ?? PER_PAGE);
    if (url.pathname === '/repos/o/r/pulls') return page === 1 ? openPulls : [];
    const thread = /^\/repos\/o\/r\/issues\/(\d+)\/comments$/.exec(url.pathname);
    if (thread) return page === 1 ? (rows.find((r) => r.number === Number(thread[1]))?.thread ?? []) : [];
    if (/^\/repos\/o\/r\/pulls\/\d+\/(reviews|comments)$/.test(url.pathname)) return [];
    const elsewhere = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(url.pathname);
    if (elsewhere && elsewhere[1] !== 'o/r') {
      const n = Number(elsewhere[2]);
      return { number: n, title: 'the card in its new repository', state: 'open', user: null, labels: [], assignees: [], created_at: '2026-10-25T10:55:18Z', updated_at: '2026-10-27T08:10:16Z', comments: 0, repository_url: `${API}/repos/${elsewhere[1]}`, html_url: `https://github.com/${elsewhere[1]}/issues/${n}`, body: 'not this board\'s' };
    }
    const one = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(url.pathname);
    if (one) {
      const number = Number(one[1]);
      if (failing.has(number)) return new FakeReply(502);
      if (moved.has(number)) {
        const [to, n] = moved.get(number).split('#');
        return new FakeReply(301, `${API}/repos/${to}/issues/${n}`);
      }
      return destroyed.has(number) ? new FakeReply(404) : (rows.find((r) => r.number === number) ?? new FakeReply(404));
    }
    if (url.pathname !== '/repos/o/r/issues') return [];
    if (blanksLeft > 0) {
      blanksLeft -= 1;
      return [];
    }
    const lagged = lagLeft > 0;
    if (lagged) lagLeft -= 1;
    const sinceAt = q.get('since') ? Date.parse(q.get('since')) : null;
    const matching = rows
      .map((r) => (lagged && lagging.has(r.number) ? lagging.get(r.number) : r))
      .filter((r) => (q.get('state') === 'open' ? r.state === 'open' : true))
      .filter((r) => sinceAt === null || Date.parse(r.updated_at) >= sinceAt)
      .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.number - b.number);
    return matching.slice((page - 1) * perPage, page * perPage);
  };
  return { calls, serve };
}

/**
 * `snapshot()` driven end to end, offline.
 *
 * The walk ORDER and the budget SPLIT exist nowhere but inside `snapshot()`, so
 * they are pinned by RUNNING it: a source-text pin goes green the moment
 * someone reorders two statements and keeps the words around them.
 *
 * ⛔ No network and no token. The one read helper's `fetch` is replaced for the
 * duration and restored in a `finally`, so a throwing case cannot leave the
 * stub installed. The request counter is module-global, so it is zeroed on the
 * way in and restored on the way out — a run that inherited a spent counter
 * would report every budget as exhausted before its first request.
 */
async function driveSnapshot({ dir, board, options = {} }) {
  const realFetch = globalThis.fetch;
  const outerCount = requestCount.value;
  requestCount.value = 0;
  globalThis.fetch = (url, init = {}) => {
    let path = String(url).slice(API.length);
    board.calls.push(path);
    let body = board.serve(path);
    // Production fetch FOLLOWS a redirect unless told `manual`, so the stub
    // does too — a read that dropped `redirect: 'manual'` must be seen to
    // archive the destination's card, not pass by accident.
    for (let hops = 0; body instanceof FakeReply && body.location && init.redirect !== 'manual' && hops < 5; hops++) {
      path = String(body.location).slice(API.length);
      body = board.serve(path);
    }
    if (body instanceof FakeReply) {
      return Promise.resolve({ ok: false, status: body.status, headers: { get: (name) => (name === 'location' ? body.location : null) }, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(body) });
  };
  try {
    return await snapshot('o/r', { out: dir, full: false, since: null, dryRun: false, limit: null, maxRequests: DEFAULT_MAX_REQUESTS, ...options });
  } finally {
    globalThis.fetch = realFetch;
    requestCount.value = outerCount;
  }
}

/** The manifest `board-archive` actually carried at tip b7c5f578, the run #18045 measured. */
function measuredHistoryManifest(over = {}) {
  return {
    schema: ARCHIVE_SCHEMA,
    repo: 'o/r',
    generated_at: '2026-09-13T14:22:09.391Z',
    walk_phase: 'history',
    walk: {
      open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
      history: { complete: false, cursor: '2026-08-03T11:51:21Z' },
      ...over.walk,
    },
    since: '2026-07-31T12:14:43Z',
    since_reason: 'the open set is complete — the closed history resumes at 2026-07-31T12:14:43Z',
    next_since: null,
    resume: { since: '2026-08-03T11:51:21Z', phase: 'history', stopped_by: 'budget', reason: 'the per-run budget of 800 requests is spent' },
    counts: { issues_open: 0, issues_closed: 0, pulls_open: 0, pulls_closed: 0, records: 0 },
    board: { open_issues_count: null, open_pull_requests: null, read_at: null },
    count_check: { verdict: 'pending', reason: "the board's own count was not read this run, so there is nothing to compare the census with", expected: 0, archived: 0, shortfall: null, surplus: null, gone_ledger: 0, ok: null },
    requests: 800,
    run: { numbers_read: 400, files_written: 762, walk_complete: false, open_set_completed_here: false },
  };
}

const SELF_TEST_BATTERIES = Object.freeze({
  'the re-exec guard: the name this tool sets, and the patrol name that must not silence it': 11,
  'the record shapes: fixed key order, declared absence': 9,
  'the page walk: only a short page ends it': 10,
  'the walk plan: the open board first, then the closed history, then incremental': 15,
  'the delta plan: which runs re-read the live board, and from where': 15,
  'idempotence: no change means no write': 9,
  'the census and the count check': 17,
  'the restore payload: a rebuilt record says it is one': 9,
  'the refusals: a typo must never make this decision': 11,
  'the rate-limit stop, and the two properties that are structural': 8,
  'the delta walk, driven: the archive catches up with the live board': 19,
  'the freshness row: a stale archive is never a green run': 18,
  'the blank page: asked again, then believed or stopped by where the walk is': 13,
  'the lagging listing and the moved card: a disagreement is reconciled before it is reported': 31,
});
const SELF_TEST_BATTERY_FLOOR = 14;
const UNATTRIBUTED_BATTERY = '(unattributed)';

let selfTestReachedVerdict = false;

export async function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const cases = [];
  const t = (name, ok, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: Boolean(ok), detail });
  };

  const RAW = (over = {}) => ({
    number: 17297,
    title: 'a p1 security decision card',
    state: 'open',
    state_reason: null,
    user: { login: 'os-litant', id: 7, type: 'User' },
    labels: [{ name: 'priority:p1' }, { name: 'domain:skills' }],
    assignees: [{ login: 'zeta' }, { login: 'alpha' }],
    milestone: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    closed_at: null,
    comments: 2,
    locked: false,
    html_url: 'https://github.com/o/r/issues/17297',
    body: 'the body that a suspension destroys',
    ...over,
  });
  const RAW_COMMENT = (over = {}) => ({
    id: 5617561348,
    user: { login: 'os-litant', id: 7, type: 'User' },
    created_at: '2026-09-02T10:56:32Z',
    updated_at: '2026-09-02T10:56:32Z',
    html_url: 'https://github.com/o/r/issues/17297#issuecomment-5617561348',
    body: 'Claim: PM loop round 1',
    ...over,
  });

  // -- the record shapes -----------------------------------------------------
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

  battery('the record shapes: fixed key order, declared absence');
  const record = issueRecord(RAW());
  t('the key order is the one this file writes, not the order GitHub answered in',
    Object.keys(record).join(',') === 'number,kind,title,state,state_reason,draft,author,labels,assignees,milestone,type,created_at,updated_at,closed_at,closed_by,merged_at,comments,locked,html_url,body',
    Object.keys(record).join(','));
  t('labels are sorted, so a re-fetch in another order is not a diff', record.labels.join() === 'domain:skills,priority:p1');
  t('assignees are sorted for the same reason', record.assignees.join() === 'alpha,zeta');
  t('`closed_by` is PRESENT and null — declared absent, not silently missing', 'closed_by' in record && record.closed_by === null);
  t('an issue reads kind=issue and its `draft` is null, not false', record.kind === 'issue' && record.draft === null);
  const pull = issueRecord(RAW({ number: 17326, pull_request: { merged_at: '2026-09-10T07:45:30Z' }, draft: false }));
  t('a pull request reads kind=pull_request and carries merged_at off the listing, at no extra request',
    pull.kind === 'pull_request' && pull.merged_at === '2026-09-10T07:45:30Z' && pull.draft === false);
  t('two runs over the same answer produce identical bytes', stableJson(issueRecord(RAW())) === stableJson(issueRecord(RAW())));
  t('a JSON file ends in exactly one newline', stableJson({ a: 1 }).endsWith('}\n') && !stableJson({ a: 1 }).endsWith('\n\n'));
  t('an empty thread is an empty file, never a line of nothing', stableJsonl([]) === '' && stableJsonl([commentRecord(RAW_COMMENT())]).split('\n').filter(Boolean).length === 1);

  // -- the page walk ---------------------------------------------------------
  battery('the page walk: only a short page ends it');
  const full = nextWalkStep({ batchLength: 100, lastUpdatedAt: '2026-09-03T00:00:00Z', since: '2026-09-01T00:00:00Z', page: 1 });
  t('a FULL page must fetch the next — the completeness rule, and nothing else ends the walk', full.done === false);
  t('…and it re-anchors on the VALUE, back to page 1, so a row that shifted forward cannot fall through the gap',
    full.since === '2026-09-03T00:00:00Z' && full.page === 1 && full.reanchored === true);
  const tied = nextWalkStep({ batchLength: 100, lastUpdatedAt: '2026-09-01T00:00:00Z', since: '2026-09-01T00:00:00Z', page: 4 });
  t('a full page whose rows all share the cursor advances the PAGE — the one case an offset is for',
    tied.done === false && tied.page === 5 && tied.since === '2026-09-01T00:00:00Z');
  t('a short page ends the walk', nextWalkStep({ batchLength: 3, lastUpdatedAt: '2026-09-04T00:00:00Z', since: null, page: 9 }).done === true);
  t('an empty page ends the walk', nextWalkStep({ batchLength: 0, lastUpdatedAt: null, since: 'x', page: 2 }).done === true);
  const path = listingPath('o/r', { since: '2026-09-01T00:00:00Z', page: 3 });
  t('the listing asks for state=all — the closed half is exactly what a suspension destroys', path.includes('state=all'));
  t('…ordered by updated ascending, 100 a page, by page number', path.includes('sort=updated') && path.includes('direction=asc') && path.includes('per_page=100') && path.includes('page=3'));
  t('a full read carries no `since` at all', !listingPath('o/r', {}).includes('since='));
  const openPath = listingPath('o/r', { state: 'open' });
  t('THE open phase asks for state=open — one listing, and it carries pull requests as well as issues',
    openPath.includes('state=open') && !openPath.includes('state=all') && openPath.includes('/issues?'));
  t('…and the history phase asks the same endpoint for state=all, so one walk implementation serves both',
    listingPath('o/r', { state: 'all' }) === listingPath('o/r', {}));

  // -- the walk plan ---------------------------------------------------------
  battery('the walk plan: the open board first, then the closed history, then incremental');
  t('no manifest: the first run is full', selectWalkPlan(null).since === null);
  t('…and says so, so a full run and an incremental one are never confused', /first run is full/.test(selectWalkPlan(null).reason));
  t('a previous manifest hands over its next_since', selectWalkPlan({ next_since: '2026-09-05T00:00:00Z' }).since === '2026-09-05T00:00:00Z');
  t('a resume cursor WINS over next_since — an interrupted run is continued, not skipped past',
    selectWalkPlan({ next_since: '2026-09-09T00:00:00Z', resume: { since: '2026-09-05T00:00:00Z' } }).since === '2026-09-05T00:00:00Z');
  t('--full ignores the manifest', selectWalkPlan({ next_since: '2026-09-05T00:00:00Z' }, { full: true }).since === null);
  t('--since overrides everything, including a resume cursor',
    selectWalkPlan({ resume: { since: '2026-09-05T00:00:00Z' } }, { override: '2026-01-01T00:00:00Z' }).since === '2026-01-01T00:00:00Z');
  t('every selection carries a printable reason', ['reason'].every((k) => typeof selectWalkPlan(null)[k] === 'string' && selectWalkPlan(null)[k].length > 0));
  t('THE ORDER: a fresh archive plans the OPEN phase — the records a suspension destroys are read before the closed history',
    selectWalkPlan(null).phase === 'open' && selectWalkPlan(null).openSetComplete === false);
  const midOpen = { walk: { open_set: { complete: false, completed_at: null, cursor: '2026-09-07T00:00:00Z' }, history: { complete: false, cursor: '2026-02-01T14:43:39Z' } } };
  t('THE CASE: a run that ran out of budget inside the open set resumes INSIDE it — the history does not start early',
    selectWalkPlan(midOpen).phase === 'open' && selectWalkPlan(midOpen).since === '2026-09-07T00:00:00Z');
  t('…and the history cursor waits untouched while that happens, so finishing the open set costs the history nothing',
    selectWalkPlan(midOpen).historyCursor === '2026-02-01T14:43:39Z');
  const openDone = { walk: { open_set: { complete: true, completed_at: '2026-09-10T15:00:00Z', cursor: null }, history: { complete: false, cursor: '2026-02-01T14:43:39Z' } } };
  t('an open set that is complete hands over to the history phase, from the history cursor',
    selectWalkPlan(openDone).phase === 'history' && selectWalkPlan(openDone).since === '2026-02-01T14:43:39Z');
  const legacy = { next_since: null, resume: { since: '2026-02-01T14:43:39Z' }, run: { walk_complete: false } };
  t('THE MIGRATION: an archive written before this order existed walks the open board first, and its cursor is KEPT rather than thrown away',
    selectWalkPlan(legacy).phase === 'open' && selectWalkPlan(legacy).historyCursor === '2026-02-01T14:43:39Z');
  t('…while one whose old walk had COMPLETED is already past both phases and stays incremental',
    selectWalkPlan({ next_since: '2026-09-09T00:00:00Z', run: { walk_complete: true } }).phase === 'incremental');
  t('--full restarts at the open set, not at the history', selectWalkPlan(openDone, { full: true }).phase === 'open');
  t('every plan names one of the three declared phases', WALK_PHASES.includes(selectWalkPlan(openDone).phase) && WALK_PHASES.length === 3);
  const phased = buildManifest({
    repo: 'o/r',
    generatedAt: 's',
    walkPhase: 'history',
    walk: { open_set: { complete: true, completed_at: '2026-09-10T15:00:00Z', cursor: null }, history: { complete: false, cursor: '2026-02-01T14:43:39Z' } },
    since: null,
    sinceReason: 'r',
    nextSince: null,
    resume: { since: '2026-02-01T14:43:39Z', phase: 'history', stopped_by: 'budget', reason: 'spent' },
    counts: {},
    board: {},
    check: {},
    requests: 800,
    run: { numbers_read: 1, files_written: 1, walk_complete: false, open_set_completed_here: false },
  });
  t('the manifest says WHICH phase and whether the open set is complete, so "open set complete, history resuming" is not "still in the open set"',
    phased.walk_phase === 'history' && phased.walk.open_set.complete === true && phased.resume.phase === 'history' && phased.resume.stopped_by === 'budget');

  // -- the delta plan --------------------------------------------------------
  battery('the delta plan: which runs re-read the live board, and from where');
  const measured = measuredHistoryManifest();
  const deltaHere = selectDeltaPlan(measured);
  t('THE CASE #18045 NAMES: a manifest parked in the history phase plans a DELTA — the live board is re-read THIS run, not once the backfill finishes',
    deltaHere.run === true);
  t('…anchored on the instant the open set was last enumerated IN FULL, minus the skew — ⛔ never on the previous run stamp, which would skip every day between the two',
    deltaHere.since === skewedSince('2026-09-10T15:39:49.484Z') && Date.parse(deltaHere.since) < Date.parse(measured.generated_at));
  const withCursor = measuredHistoryManifest({
    walk: {
      open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
      delta: { complete: true, cursor: '2026-09-13T18:00:00Z', since: '2026-09-13T14:50:00Z', slice: DELTA_REQUEST_SLICE },
      history: { complete: false, cursor: '2026-08-03T11:51:21Z' },
    },
  });
  t('once the delta has a cursor of its own it resumes there exactly — `since` is inclusive, so the boundary row is re-read rather than skipped',
    selectDeltaPlan(withCursor).since === '2026-09-13T18:00:00Z');
  t('no delta while the open set is still being walked — that walk IS this run\'s read of the live board', selectDeltaPlan(midOpen).run === false);
  t('no manifest, no delta: the first run enumerates the open board itself', selectDeltaPlan(null).run === false);
  t('--full plans no delta — the whole board is being read again from the beginning', selectDeltaPlan(measured, { full: true }).run === false);
  t('--since plans no delta — the walk the operator named IS the delta', selectDeltaPlan(measured, { override: '2026-01-01T00:00:00Z' }).run === false);
  t('a board already walked once plans no SEPARATE delta — the incremental phase walk is it, with the entire budget',
    selectDeltaPlan({ walk: { open_set: { complete: true }, history: { complete: true, cursor: 'c' } } }).run === false);
  t('every delta plan carries a printable reason, whether it runs or not',
    [deltaHere, selectDeltaPlan(null), selectDeltaPlan(midOpen), selectDeltaPlan(measured, { full: true })].every((p) => typeof p.reason === 'string' && p.reason.length > 0));
  t('the skew moves a stamp BACK, and the result is still an ISO stamp the listing endpoint accepts',
    Date.parse(skewedSince('2026-09-10T15:39:49.484Z')) === Date.parse('2026-09-10T15:39:49.484Z') - DELTA_SKEW_MS
    && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(skewedSince('2026-09-10T15:39:49.484Z')));
  t('⛔ an unparseable stamp comes back unchanged, never a cursor built from NaN — the endpoint drops such a `since` and the delta would silently become a full walk',
    skewedSince('not a date') === 'not a date' && skewedSince(null) === null);
  t('THE SPLIT is declared, positive, and leaves the backfill the larger half — a delta that could take the whole budget would starve the history for good',
    Number.isInteger(DELTA_REQUEST_SLICE) && DELTA_REQUEST_SLICE > 0 && DELTA_REQUEST_SLICE < DEFAULT_MAX_REQUESTS - DELTA_REQUEST_SLICE);
  t('…and the plan carries the slice it was run under, so the manifest records that rather than whatever this file declares today',
    deltaHere.slice === DELTA_REQUEST_SLICE);
  t('a slice never reaches past the run budget — the delta cannot buy requests the run does not have',
    sliceCeiling({ spent: 700, max: 800, slice: 300 }) === 800 && sliceCeiling({ spent: 0, max: 800, slice: 300 }) === 300);
  t('…and it is taken from what is LEFT, so a delta after the open phase gets a slice of the remainder and not a second allowance',
    sliceCeiling({ spent: 120, max: 800, slice: 300 }) === 420);
  t('the delta asks for state=all — a closed card is exactly what a suspension destroys, and an open-only delta would archive none of them',
    listingPath('o/r', { since: deltaHere.since }).includes('state=all'));

  // -- idempotence -----------------------------------------------------------
  battery('idempotence: no change means no write');
  const dir = mkdtempSync(join(tmpdir(), 'board-snapshot-'));
  try {
    const files = new Map([
      [issuePath(dir, 17297), stableJson(issueRecord(RAW()))],
      [commentsPath(dir, 17297), stableJsonl([commentRecord(RAW_COMMENT())])],
    ]);
    t('the first run writes every file', applyWrites(files).length === 2);
    t('THE CASE: an unchanged re-run writes nothing at all', applyWrites(files).length === 0);
    const changed = new Map(files);
    changed.set(issuePath(dir, 17297), stableJson(issueRecord(RAW({ state: 'closed', state_reason: 'completed' }))));
    t('a changed record writes exactly its own file', applyWrites(changed).join() === issuePath(dir, 17297));
    const dryDir = mkdtempSync(join(tmpdir(), 'board-snapshot-dry-'));
    const dryFiles = new Map([[issuePath(dryDir, 1), stableJson({ number: 1 })]]);
    t('--dry-run reports the path it would write', applyWrites(dryFiles, { dryRun: true }).length === 1);
    t('…and leaves the disk untouched', readJsonFile(issuePath(dryDir, 1)) === null);
    rmSync(dryDir, { recursive: true, force: true });
    const base = { schema: 1, counts: { issues_open: 3 }, generated_at: 'A', requests: 5, run: { numbers_read: 1 } };
    t('a manifest differing only in its run stamp is NOT a change — a stamp is a fact about the run',
      manifestChanged(base, { ...base, generated_at: 'B', requests: 9, run: { numbers_read: 4 } }) === false);
    t('a manifest whose counts moved IS a change', manifestChanged(base, { ...base, counts: { issues_open: 4 } }) === true);
    t('no previous manifest is always a change', manifestChanged(null, base) === true);
    const withBoard = { ...base, board: { open_issues_count: 598, open_pull_requests: 20, read_at: '2026-09-10T02:07:00Z' } };
    t('THE steady state: a manifest differing only in WHEN the board count was read is NOT a change — a nested stamp would commit a no-op every run',
      manifestChanged(withBoard, { ...withBoard, board: { ...withBoard.board, read_at: '2026-09-10T08:07:00Z' } }) === false
      && manifestChanged(withBoard, { ...withBoard, board: { ...withBoard.board, open_issues_count: 599 } }) === true);

    // -- the census and the count check --------------------------------------
    battery('the census and the count check');
    const censusDir = mkdtempSync(join(tmpdir(), 'board-snapshot-census-'));
    applyWrites(new Map([
      [issuePath(censusDir, 1), stableJson(issueRecord(RAW({ number: 1, state: 'open' })))],
      [issuePath(censusDir, 2), stableJson(issueRecord(RAW({ number: 2, state: 'closed' })))],
      [issuePath(censusDir, 3), stableJson(issueRecord(RAW({ number: 3, state: 'open', pull_request: { merged_at: null } })))],
      [issuePath(censusDir, 4), stableJson(issueRecord(RAW({ number: 4, state: 'closed', pull_request: { merged_at: 'x' } })))],
    ]));
    const census = censusArchive(censusDir);
    t('the census counts by state AND kind, read off the files rather than accumulated',
      census.issues_open === 1 && census.issues_closed === 1 && census.pulls_open === 1 && census.pulls_closed === 1 && census.records === 4);
    t('a census of a directory that does not exist is zero, not a throw', censusArchive(join(censusDir, 'nope')).records === 0);
    t('the ledger of gone numbers is empty when the file is absent', readGoneLedger(censusDir).length === 0);
    writeIfChanged(join(censusDir, GONE_LEDGER_NAME), stableJson([{ number: 9, note: 'transferred' }, 10]));
    t('…and reads both a bare number and a row carrying a note', readGoneLedger(censusDir).join() === '9,10');
    rmSync(censusDir, { recursive: true, force: true });
    t('the count check passes when the archive equals open_issues_count minus the open pull requests',
      countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 600 }).ok === true);
    const short = countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 590 });
    t('a SHORTFALL is the enumeration missing cards, and it is not ok', short.verdict === 'shortfall' && short.shortfall === 10 && short.ok === false);
    const surplus = countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 606 });
    t('a SURPLUS is the destruction signature this tool exists for, and it is not ok', surplus.verdict === 'surplus' && surplus.surplus === 6 && surplus.ok === false);
    t('…and the gone ledger is the only thing that quiets it',
      countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 606, gone: [1, 2, 3, 4, 5, 6] }).ok === true);
    const stillOpen = countCheckPendingReason({ phase: 'open', openSetComplete: false, boardCountRead: true });
    const pending = countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 12, pending: stillOpen });
    t('a resuming snapshot reads PENDING — a census of a partial archive is no reading about the board', pending.verdict === 'pending');
    t('…and pending is not a pass: `ok` is null, so "could not check" never renders as "checked and clean"', pending.ok === null);
    t('…and it carries the reason, so the manifest answers "why not" instead of leaving a reader to infer it',
      typeof pending.reason === 'string' && /open set is still being walked/.test(pending.reason));
    t('THE CASE the open phase buys: the run that FINISHES the open set has a reading, even though the closed history is still resuming',
      countCheckPendingReason({ phase: 'history', openSetComplete: true, openSetCompletedHere: true, walkCompletedHere: false, boardCountRead: true }) === null);
    t('…but a LATER history run does not: that enumeration is from an earlier run, and the reason says exactly that',
      /enumerated in an earlier run/.test(countCheckPendingReason({ phase: 'history', openSetComplete: true, openSetCompletedHere: false, boardCountRead: true })));
    t('a completed walk is a reading in any phase — the steady state, unchanged by the open phase existing',
      countCheckPendingReason({ phase: 'incremental', openSetComplete: true, walkCompletedHere: true, boardCountRead: true }) === null);
    t('an incremental walk that stopped early is pending, and says the archive is behind the board',
      /behind the board/.test(countCheckPendingReason({ phase: 'incremental', openSetComplete: true, walkCompletedHere: false, boardCountRead: true })));
    t('no board count this run: pending, and the reason names the side that is missing',
      /own count was not read this run/.test(countCheckPendingReason({ phase: 'incremental', openSetComplete: true, walkCompletedHere: true, boardCountRead: false })));
    t('THE CASE THE DELTA BUYS: a run whose delta caught up with the live board HAS a reading, in the very phase where the verdict had been permanently pending',
      countCheckPendingReason({ phase: 'history', openSetComplete: true, openSetCompletedHere: false, deltaCompletedHere: true, walkCompletedHere: false, boardCountRead: true }) === null);
    t('…and a delta still BEHIND the live board leaves it pending, with the reason naming the delta rather than only the clock',
      /delta did not catch up/.test(countCheckPendingReason({ phase: 'history', openSetComplete: true, deltaCompletedHere: false, boardCountRead: true })));
    t('a verdict carries `reason: null`, so the key set is the same in every branch and the manifest diff stays stable',
      'reason' in countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 600 })
      && countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 600 }).reason === null);

    // -- the restore payload -------------------------------------------------
    battery('the restore payload: a rebuilt record says it is one');
    const archived = issueRecord(RAW());
    const thread = [commentRecord(RAW_COMMENT()), commentRecord(RAW_COMMENT({ id: 2, body: 'ACCEPT' }))];
    const payload = restorePayload({ issue: archived, comments: thread, runStamp: '2026-09-10T13:37:00Z', repo: 'o/r' });
    t('THE rule: the payload carries the provenance sentence verbatim', payload.includes(provenanceSentence('2026-09-10T13:37:00Z')));
    t('it names the ORIGINAL number, and says the rebuilt card carries a new one', payload.includes('o/r#17297') && /new one/.test(payload));
    t('it names the author whose account the loss travelled through', payload.includes('@os-litant'));
    t('it carries both timestamps', payload.includes('2026-09-01T00:00:00Z') && payload.includes('2026-09-02T00:00:00Z'));
    t('it lists the labels to re-apply', payload.includes('`domain:skills`') && payload.includes('`priority:p1`'));
    t('the thread is a SECOND block, one heading per comment', payload.includes('Comment 1 — @os-litant') && payload.includes('Comment 2 —') && payload.includes('2 comment(s)'));
    t('⛔ it carries no attribution footer — the channel appends its own, and two is what that costs', !payload.includes('Generated by ['));
    t('an author whose account is gone renders without inventing a handle',
      restorePayload({ issue: { ...archived, author: null }, comments: [], runStamp: 's', repo: 'o/r' }).includes('an account that no longer resolves'));
    const restoreDir = mkdtempSync(join(tmpdir(), 'board-snapshot-restore-'));
    applyWrites(new Map([[issuePath(restoreDir, 17297), stableJson(archived)], [commentsPath(restoreDir, 17297), stableJsonl(thread)]]));
    const readBack = readArchivedCard(restoreDir, 17297);
    t('--restore reads the archive DIRECTORY and nothing else, thread included',
      readBack.ok && readBack.issue.body === archived.body && readBack.comments.length === 2);
    rmSync(restoreDir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // -- the refusals ----------------------------------------------------------
  battery('the refusals: a typo must never make this decision');
  t('a good command line parses', parseOptions(['--out=archive/board', '--limit=20']).ok === true);
  t('an unknown flag is refused', parseOptions(['--archive-everything']).ok === false);
  t('an unknown option is refused', parseOptions(['--outt=board']).ok === false);
  t('a positional argument is refused', parseOptions(['17297']).ok === false);
  t('THE typo: `--dry-runn` is refused rather than parsed as a LIVE run', parseOptions(['--dry-runn']).ok === false);
  t('--limit=0 is refused', parseOptions(['--limit=0']).ok === false);
  t('--restore=abc is refused', parseOptions(['--restore=abc']).ok === false);
  t('--max-requests=-1 is refused', parseOptions(['--max-requests=-1']).ok === false);
  t('the budget defaults to the value this file declares, never to unlimited', parseOptions([]).options.maxRequests === DEFAULT_MAX_REQUESTS);
  const spaced = parseOptions(['--out', 'archive/board', '--restore', '17297']);
  t('the spelling the card documents parses: `--restore <n>` with a space', spaced.ok === true && spaced.options.restore === 17297 && spaced.options.out === 'archive/board');
  t('…and an option left without a value is refused rather than swallowing the next flag',
    parseOptions(['--restore', '--dry-run']).ok === false);

  // -- the rate-limit stop, and the structural properties ---------------------
  battery('the rate-limit stop, and the two properties that are structural');
  t('403 with the budget spent is a rate-limit stop', rateLimitStop({ status: 403, remaining: '0', reset: '1789000000' }) !== null);
  t('429 with a retry-after is a rate-limit stop', rateLimitStop({ status: 429, retryAfter: '60' }) !== null);
  t('403 with budget REMAINING is about the token, not the budget — and retrying it is useless',
    rateLimitStop({ status: 403, remaining: '4800' }) === null);
  t('a 404 is not a rate-limit stop', rateLimitStop({ status: 404, remaining: '0' }) === null);
  t('the reset instant is rendered as an ISO stamp a reader can act on',
    /^\d{4}-\d{2}-\d{2}T/.test(rateLimitStop({ status: 403, remaining: '0', reset: '1789000000' }).resetAt));
  const source = readFileSync(SELF_PATH, 'utf8');
  // Built from parts on purpose: a literal would match itself and pin nothing.
  t('⛔ STRUCTURAL: this file contains no retry loop — the stop writes a cursor and returns',
    !new RegExp(['set', 'Timeout'].join('')).test(source) && !source.includes(['await ', 'sleep('].join('')));
  t('⛔ STRUCTURAL: this file has no write path to GitHub in any mode — the one-board rule, mechanically',
    !/method:\s*'(?:POST|PATCH|PUT|DELETE)'/.test(source) && !/\bmethod:\s*(?:method|options\.method)\b/.test(source));
  t('…and its only fetch is the one read helper', (source.match(/await fetch\(/g) ?? []).length === 1);

  // -- the delta walk, driven ------------------------------------------------
  battery('the delta walk, driven: the archive catches up with the live board');
  const liveDir = mkdtempSync(join(tmpdir(), 'board-snapshot-delta-'));
  const busyDir = mkdtempSync(join(tmpdir(), 'board-snapshot-split-'));
  const stopDir = mkdtempSync(join(tmpdir(), 'board-snapshot-resume-'));
  const idemDir = mkdtempSync(join(tmpdir(), 'board-snapshot-idem-'));
  const quietDir = mkdtempSync(join(tmpdir(), 'board-snapshot-quiet-'));
  const staleDir = mkdtempSync(join(tmpdir(), 'board-snapshot-stale-'));
  const blankDir = mkdtempSync(join(tmpdir(), 'board-snapshot-blank-'));
  const blankStopDir = mkdtempSync(join(tmpdir(), 'board-snapshot-blank-stop-'));
  const plainDir = mkdtempSync(join(tmpdir(), 'board-snapshot-plain-'));
  const lagDir = mkdtempSync(join(tmpdir(), 'board-snapshot-lag-'));
  const settleDir = mkdtempSync(join(tmpdir(), 'board-snapshot-settle-'));
  const destroyedDir = mkdtempSync(join(tmpdir(), 'board-snapshot-destroyed-'));
  const cancelDir = mkdtempSync(join(tmpdir(), 'board-snapshot-cancel-'));
  const cutDir = mkdtempSync(join(tmpdir(), 'board-snapshot-cut-'));
  const ledgerDir = mkdtempSync(join(tmpdir(), 'board-snapshot-ledger-'));
  try {
    // THE REGRESSION, driven from the manifest board-archive actually carried.
    //
    // ⚠️ The BACKLOG below is what makes this a pin rather than a decoration. On
    // a four-row board the backfill reaches today inside one page, so the row
    // lands on disk whether or not a delta ran and the case passes over the very
    // defect it names — measured, by ablating the delta step against a small
    // board and watching this case stay green. The real archive has thousands of
    // numbers between the history cursor and today, and 800 requests a run do
    // not cross them; 900 closed rows with a comment thread each reproduce that
    // pressure, so the backfill CANNOT reach 2026-09-13 in this run.
    const movedIssue = RAW({ number: 18045, state: 'open', comments: 0, created_at: '2026-09-13T14:59:12Z', updated_at: '2026-09-13T14:50:00Z' });
    const movedClosed = RAW({ number: 17999, state: 'closed', state_reason: 'completed', comments: 0, updated_at: '2026-09-12T09:00:00Z', closed_at: '2026-09-12T09:00:00Z' });
    const movedPull = RAW({ number: 18043, state: 'open', comments: 0, updated_at: '2026-09-13T10:00:00Z', pull_request: { merged_at: null }, draft: true });
    const oldClosed = RAW({ number: 900, state: 'closed', comments: 0, updated_at: '2026-08-03T12:00:00Z', closed_at: '2026-08-03T12:00:00Z' });
    const backlog = Array.from({ length: 900 }, (_, i) => RAW({
      number: 1000 + i,
      state: 'closed',
      comments: 1,
      updated_at: new Date(Date.parse('2026-08-03T12:00:00Z') + i * 60000).toISOString(),
      closed_at: new Date(Date.parse('2026-08-03T12:00:00Z') + i * 60000).toISOString(),
      thread: [RAW_COMMENT({ id: 700000 + i })],
    }));
    const liveRows = [movedIssue, movedClosed, movedPull, ...backlog];
    writeIfChanged(join(liveDir, MANIFEST_NAME), stableJson(measuredHistoryManifest()));
    const live = fakeBoard({ rows: liveRows, openPulls: [movedPull] });
    t('the row is ABSENT before the run — the state #18045 measured, reproduced on disk', readArchivedCard(liveDir, 18045).ok === false);
    const first = await driveSnapshot({ dir: liveDir, board: live });
    t('THE REGRESSION: a row updated after the previous manifest stamp is archived on the VERY NEXT run, out of a budget the backfill would otherwise have spent whole',
      readArchivedCard(liveDir, 18045).ok === true && readArchivedCard(liveDir, 18045).issue?.updated_at === '2026-09-13T14:50:00Z');
    t('…and so is a CLOSED row that moved, and a pull request — the delta archives every row it sees, not the open issues alone',
      readArchivedCard(liveDir, 17999).issue?.state === 'closed' && readArchivedCard(liveDir, 18043).issue?.kind === 'pull_request');
    t('…and the backfill demonstrably could NOT have done it: it ran out of budget inside the backlog, hundreds of rows short of that day',
      first.stopped?.kind === 'budget' && first.manifest.resume?.phase === 'history' && Date.parse(first.manifest.walk.history.cursor) < Date.parse('2026-08-05T00:00:00Z'));
    const listings = live.calls.filter((c) => c.startsWith('/repos/o/r/issues?'));
    t('THE ORDER: the FIRST listing of the run is the delta, and the history listing comes after it — ⛔ a backfill placed first spends everything and the delta never runs',
      listings[0].includes(encodeURIComponent(skewedSince('2026-09-10T15:39:49.484Z')))
      && listings.findIndex((c) => c.includes(encodeURIComponent('2026-08-03T11:51:21Z'))) > 0);
    t('the backfill still ran in the same run: its cursor moved and the oldest row it was walking toward is on disk',
      first.manifest.walk.history.cursor !== '2026-08-03T11:51:21Z' && readArchivedCard(liveDir, 1000).ok === true);
    t('the open set is untouched by any of it — complete, no cursor, and not re-enumerated',
      first.manifest.walk.open_set.complete === true && first.manifest.walk.open_set.cursor === null && first.manifest.run.open_set_completed_here === false);
    t('the manifest carries the delta cursor and its completeness BESIDE the history cursor, never merged into it',
      first.manifest.walk.delta.complete === true && first.manifest.walk.delta.cursor === '2026-09-13T14:50:00Z' && first.manifest.walk.history.cursor !== first.manifest.walk.delta.cursor);
    t('`next_since` is the DELTA high-water mark — handing the backfill August cursor over instead would replay weeks as an increment',
      first.manifest.next_since === '2026-09-13T14:50:00Z');
    t('THE COUNT CHECK returns: the board own count is bought right after the delta, so a run that stops inside the backfill still reports a verdict instead of `pending`',
      first.manifest.board.read_at !== null && first.manifest.board.open_issues_count === 2 && first.manifest.count_check.verdict === 'ok' && first.manifest.run.walk_complete === false);

    // THE SPLIT, driven: a delta with more to read than its slice.
    writeIfChanged(join(busyDir, MANIFEST_NAME), stableJson(measuredHistoryManifest()));
    const busyRows = Array.from({ length: DELTA_REQUEST_SLICE + 60 }, (_, i) => RAW({
      number: 20000 + i,
      state: 'open',
      comments: 1,
      updated_at: new Date(Date.parse('2026-09-11T00:00:00Z') + i * 60000).toISOString(),
      thread: [RAW_COMMENT({ id: 900000 + i })],
    }));
    const busy = fakeBoard({ rows: [...busyRows, oldClosed] });
    const split = await driveSnapshot({ dir: busyDir, board: busy });
    t('THE SPLIT: a delta with more to read than its slice stops AT the slice, to the request',
      split.manifest.run.delta_requests === DELTA_REQUEST_SLICE && split.manifest.walk.delta.complete === false);
    t('…and a spent slice is NOT a run stop — the run carries on and spends past it', split.stopped === null && split.manifest.requests > DELTA_REQUEST_SLICE);
    t('…so the backfill is slowed and never starved: its listing is still issued, and the closed row it was walking toward is archived in the same run',
      busy.calls.some((c) => c.startsWith('/repos/o/r/issues?') && c.includes(encodeURIComponent('2026-08-03T11:51:21Z'))) && readArchivedCard(busyDir, 900).ok === true);
    t('…and with the backfill still incomplete the next run resumes the delta at that cursor, rather than walking the window again from the start',
      Date.parse(split.manifest.walk.delta.cursor) > Date.parse('2026-09-11T00:00:00Z')
      && selectDeltaPlan({ ...split.manifest, walk: { ...split.manifest.walk, history: { complete: false, cursor: '2026-08-03T11:51:21Z' } } }).since === split.manifest.walk.delta.cursor);

    // RESUME, unchanged for an interrupted HISTORY walk.
    writeIfChanged(join(stopDir, MANIFEST_NAME), stableJson(measuredHistoryManifest({
      walk: {
        open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
        delta: { complete: true, cursor: '2026-09-13T14:50:00Z', since: '2026-09-10T15:09:49.484Z', slice: DELTA_REQUEST_SLICE },
        history: { complete: false, cursor: '2026-08-03T11:51:21Z' },
      },
    })));
    const historyRows = Array.from({ length: 5 }, (_, i) => RAW({
      number: 800 + i,
      state: 'closed',
      comments: 1,
      updated_at: `2026-08-03T1${2 + i}:00:00Z`,
      closed_at: `2026-08-03T1${2 + i}:00:00Z`,
      thread: [RAW_COMMENT({ id: 800000 + i })],
    }));
    const stop = await driveSnapshot({ dir: stopDir, board: fakeBoard({ rows: [...historyRows, movedIssue] }), options: { maxRequests: 6 } });
    t('RESUME UNCHANGED: a history walk that runs out of budget still stops with its OWN cursor, named as the history walk and not as the phase',
      stop.manifest.resume?.phase === 'history' && stop.manifest.resume?.stopped_by === 'budget' && stop.manifest.resume?.since === stop.manifest.walk.history.cursor);
    t('…and `selectWalkPlan` reads that manifest back as a history resume from that cursor — the semantics the delta does not touch',
      selectWalkPlan(stop.manifest).phase === 'history' && selectWalkPlan(stop.manifest).since === stop.manifest.walk.history.cursor);
    t('…while the delta cursor survives the stop untouched, so the next run re-reads the live board before the backfill again',
      stop.manifest.walk.delta.cursor === '2026-09-13T14:50:00Z' && selectDeltaPlan(stop.manifest).run === true);

    // IDEMPOTENCE, end to end, with the delta in the path. A board small enough
    // for one run to finish, so the third run has nothing left to discover.
    writeIfChanged(join(idemDir, MANIFEST_NAME), stableJson(measuredHistoryManifest()));
    const idemRows = [movedIssue, movedClosed, movedPull, oldClosed];
    for (const _ of [1, 2]) await driveSnapshot({ dir: idemDir, board: fakeBoard({ rows: idemRows, openPulls: [movedPull] }) });
    const third = await driveSnapshot({ dir: idemDir, board: fakeBoard({ rows: idemRows, openPulls: [movedPull] }) });
    t('IDEMPOTENCE survives the delta: a run over a board that has not moved writes nothing at all, manifest included',
      third.written.length === 0 && third.manifestMoved === false && third.manifest.walk_phase === 'incremental');
    t('…and the freshness row does not break it: a confirmed run carries no streak stamp, so the block is byte-identical run over run',
      third.manifest.freshness.pending_since === null && stableJson(third.manifest.freshness) === stableJson({ verdict: 'fresh', pending_since: null, reason: null }));

    // -- the freshness row ---------------------------------------------------
    battery('the freshness row: a stale archive is never a green run');
    const CARD_RUN = '2026-09-14T02:37:36.943Z';
    const STREAK_OPENED = '2026-09-10T20:23:11.768Z';
    const building = freshnessCheck({ openSetComplete: false, countCheckVerdict: 'pending', generatedAt: CARD_RUN });
    t('an open board never enumerated in full reads BUILDING, not stale — a first snapshot is not a backup that fell behind, and the workflow\'s pull_request run lives here',
      building.verdict === 'building' && building.pending_since === null);
    t('a run that reached a VERDICT clears the streak, whatever that verdict says about the counts — the row asks whether the archive was CONFIRMED, not whether it agreed',
      ['ok', 'shortfall', 'surplus'].every((v) => {
        const f = freshnessCheck({ openSetComplete: true, countCheckVerdict: v, generatedAt: CARD_RUN, previousPendingSince: STREAK_OPENED });
        return f.verdict === 'fresh' && f.pending_since === null && f.reason === null;
      }));
    const opened = freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: CARD_RUN });
    t('the FIRST run that cannot confirm opens the streak at its own stamp and is NOT stale — one unconfirmed run is a run, not an outage',
      opened.verdict === 'fresh' && opened.pending_since === CARD_RUN);
    t('…and later runs carry that stamp forward BYTE-IDENTICAL rather than restamping it: the streak start is what ages, and a counter that moved every run would commit a manifest-only diff on every scheduled run',
      stableJson(freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: '2026-09-14T08:37:22.617Z', previousPendingSince: CARD_RUN }))
      === stableJson(freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: '2026-09-14T14:28:17.784Z', previousPendingSince: CARD_RUN })));
    const boundary = Date.parse(CARD_RUN) + STALE_AFTER_MS;
    t('THE BOUNDARY: exactly the window is not yet stale…',
      freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: new Date(boundary).toISOString(), previousPendingSince: CARD_RUN }).verdict === 'fresh');
    t('…and one millisecond past it is',
      freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: new Date(boundary + 1).toISOString(), previousPendingSince: CARD_RUN }).verdict === 'stale');
    t('an unreadable stored stamp restarts the streak here instead of deciding a verdict from a clock nobody can read',
      freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: CARD_RUN, previousPendingSince: 'not a date' }).pending_since === CARD_RUN);
    t('the window is a day, measured from the first UNCONFIRMED run — itself one interval after the last confirmed one, so the red lands a day plus an interval after the archive was last known level',
      STALE_AFTER_MS === 24 * 60 * 60 * 1000);
    t('every verdict this row returns is declared, and there are three',
      FRESHNESS_VERDICTS.length === 3 && ['building', 'fresh', 'stale'].every((v) => FRESHNESS_VERDICTS.includes(v)));
    t('the exit register is still ONE register: six codes, all distinct, and the stale one is none of the others',
      new Set([EXIT_OK, EXIT_USAGE, EXIT_COUNT_MISMATCH, EXIT_PREREQUISITE_NOT_MET, EXIT_RATE_LIMITED, EXIT_STALE]).size === 6 && EXIT_STALE === 5);

    // THE CARD REPLAYED, from the manifest `board-archive` carried at 2621e5a45.
    const cardManifest = (over = {}) => buildManifest({
      repo: 'o/r',
      generatedAt: CARD_RUN,
      walkPhase: 'history',
      walk: {
        open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
        delta: { complete: false, cursor: '2026-09-12T00:40:33Z', since: '2026-09-11T02:47:09Z', slice: DELTA_REQUEST_SLICE },
        history: { complete: false, cursor: '2026-08-06T13:26:08Z' },
      },
      since: '2026-08-06T13:26:08Z',
      sinceReason: 'the open set is complete — the closed history resumes at 2026-08-06T13:26:08Z',
      nextSince: '2026-09-12T00:40:33Z',
      resume: { since: '2026-08-06T13:26:08Z', phase: 'history', stopped_by: 'budget', reason: 'the per-run budget of 800 requests is spent' },
      counts: { issues_open: 485, issues_closed: 2000, pulls_open: 30, pulls_closed: 3799, records: 6314 },
      board: { open_issues_count: 512, open_pull_requests: 0, read_at: CARD_RUN },
      check: countCheck({
        openIssuesCount: 512,
        openPullRequests: 0,
        archivedOpenIssues: 485,
        pending: countCheckPendingReason({ phase: 'history', openSetComplete: true, deltaCompletedHere: false, boardCountRead: true }),
      }),
      freshness: freshnessCheck({ openSetComplete: true, countCheckVerdict: 'pending', generatedAt: CARD_RUN, previousPendingSince: STREAK_OPENED }),
      requests: 800,
      run: { numbers_read: 400, files_written: 762, walk_complete: false, open_set_completed_here: false, delta_ran: true, delta_completed_here: false, delta_requests: 300 },
      ...over,
    });
    const cardRendered = renderRun(
      { manifest: cardManifest(), written: ['x'], manifestMoved: true, stopped: { kind: 'budget', reason: 'the per-run budget of 800 requests is spent' }, plan: {}, deltaPlan: {}, walkComplete: false },
      { out: 'archive/board', dryRun: false },
    );
    t('THE CARD #18137 REPLAYED: the manifest of 2026-09-14T02:37Z — delta cursor two days behind, count check pending — is STALE, and the run that exited 0 exits EXIT_STALE',
      cardManifest().freshness.verdict === 'stale' && cardRendered.exitCode === EXIT_STALE);
    const cardTail = cardRendered.text.slice(cardRendered.text.indexOf('  freshness'));
    t('…and the row names the streak and what CLEARS it, and ⛔ prescribes neither cadence nor budget nor slice — those are the maintainer\'s',
      /STALE/.test(cardTail) && cardTail.includes(STREAK_OPENED) && /catches up/.test(cardTail) && !/cadence|budget|slice|more runs/i.test(cardTail));
    t('…while the ARCHIVE is untouched by the verdict: this run wrote its records, and the workflow commits them before the step that reads the exit code',
      cardRendered.text.includes('written      1 file(s)'));

    // THE CORRECTED READING REPLAYED: the run whose delta caught up.
    const caughtUp = cardManifest({
      generatedAt: '2026-09-15T02:34:24.005Z',
      walk: {
        open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
        delta: { complete: true, cursor: '2026-09-15T02:30:25Z', since: '2026-09-14T04:46:18Z', slice: DELTA_REQUEST_SLICE },
        history: { complete: false, cursor: '2026-08-09T00:00:00Z' },
      },
      check: countCheck({ openIssuesCount: 519, openPullRequests: 0, archivedOpenIssues: 536 }),
      freshness: freshnessCheck({ openSetComplete: true, countCheckVerdict: 'surplus', generatedAt: '2026-09-15T02:34:24.005Z', previousPendingSince: STREAK_OPENED }),
    });
    t('THE CORRECTED READING REPLAYED: the run whose delta caught up reaches a verdict, so the streak is cleared and this row is NOT what reddens it',
      caughtUp.freshness.verdict === 'fresh' && caughtUp.freshness.pending_since === null
      && renderRun({ manifest: caughtUp, written: [], manifestMoved: true, stopped: null, plan: {}, deltaPlan: {}, walkComplete: false }, { out: 'archive/board', dryRun: false }).exitCode === EXIT_COUNT_MISMATCH);

    // THE QUIET BOARD, driven: the false alarm ageing the delta cursor would raise.
    const longAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    writeIfChanged(join(quietDir, MANIFEST_NAME), stableJson({
      ...measuredHistoryManifest(),
      walk: {
        open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
        delta: { complete: true, cursor: longAgo, since: longAgo, slice: DELTA_REQUEST_SLICE },
        history: { complete: true, cursor: longAgo },
      },
      next_since: longAgo,
      resume: null,
    }));
    const quiet = await driveSnapshot({ dir: quietDir, board: fakeBoard({ rows: [RAW({ number: 42, state: 'open', comments: 0, created_at: longAgo, updated_at: longAgo })] }) });
    t('THE QUIET BOARD, driven: nothing has moved for five days, so the walk completes, the census IS the board — and the delta cursor is five days old because it is the newest row\'s stamp, not the instant the board was read',
      quiet.manifest.count_check.verdict === 'ok'
      && quiet.manifest.walk.delta.cursor === longAgo
      && elapsedBetween(quiet.manifest.walk.delta.cursor, quiet.manifest.generated_at) > STALE_AFTER_MS);
    t('…and this row calls it FRESH and the run green — ageing that cursor is the false alarm this anchor exists to avoid',
      quiet.manifest.freshness.verdict === 'fresh'
      && renderRun(quiet, { out: quietDir, dryRun: false }).exitCode === EXIT_OK);

    // A STALE RUN, driven end to end: the records still land.
    writeIfChanged(join(staleDir, MANIFEST_NAME), stableJson({
      ...measuredHistoryManifest(),
      freshness: { verdict: 'fresh', pending_since: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), reason: 'carried from the run that opened the streak' },
    }));
    // Three rows inside the delta's window, each with a thread, against a run
    // budget of three requests: the delta stops on the budget before the board's
    // own count is bought, which is the shape every `pending` run in this
    // archive's history had.
    const unreadRows = Array.from({ length: 3 }, (_, i) => RAW({
      number: 18100 + i,
      state: 'open',
      comments: 1,
      updated_at: `2026-09-13T1${i}:00:00Z`,
      thread: [RAW_COMMENT({ id: 950000 + i })],
    }));
    const staleRun = await driveSnapshot({ dir: staleDir, board: fakeBoard({ rows: unreadRows }), options: { maxRequests: 3 } });
    const staleRendered = renderRun(staleRun, { out: staleDir, dryRun: false });
    t('A STALE RUN, DRIVEN: a run that could not confirm the archive, under a streak three days old, reports stale — and it still ARCHIVED what it read',
      staleRun.manifest.count_check.verdict === 'pending' && staleRun.manifest.freshness.verdict === 'stale' && staleRun.written.length > 0);
    t('…and THAT is what turns the run red: EXIT_STALE where the same run exited 0 before this row existed',
      staleRendered.exitCode === EXIT_STALE && /freshness    STALE/.test(staleRendered.text));
    t('…while the streak stamp it carries forward is the one the previous manifest opened, never this run\'s',
      staleRun.manifest.freshness.pending_since === readJsonFile(join(staleDir, MANIFEST_NAME)).freshness.pending_since
      && Date.parse(staleRun.manifest.freshness.pending_since) < Date.parse(staleRun.manifest.generated_at) - STALE_AFTER_MS);

    // -- the blank page ------------------------------------------------------
    battery('the blank page: asked again, then believed or stopped by where the walk is');
    const B = BLANK_PAGE_ASKS;
    t('below the bound a blank page is asked again — from the beginning of a board that reports open items', blankPageStep({ asks: 1, since: null, page: 1, boardOpenItems: 118 }).action === 'ask-again');
    t('…and past an anchor alike', blankPageStep({ asks: B - 1, since: '2026-10-21T00:00:00Z', page: 1, boardOpenItems: null }).action === 'ask-again');
    t('at the bound, past an anchor, it is believed — the cursor stays put and the next run re-reads from it', blankPageStep({ asks: B, since: '2026-10-21T00:00:00Z', page: 1, boardOpenItems: 118 }).action === 'believe');
    t('…and on an offset page alike', blankPageStep({ asks: B, since: null, page: 3, boardOpenItems: 118 }).action === 'believe');
    t('at the bound, from the BEGINNING of a board that reports open items, the walk STOPS — believing it would end a phase at zero records', blankPageStep({ asks: B, since: null, page: 1, boardOpenItems: 118 }).action === 'stop');
    t('…and so does a board whose count is unknown: a blank is believed only where it can be true', blankPageStep({ asks: B, since: null, page: 1, boardOpenItems: null }).action === 'stop');
    t('…while a board that reports no open item can answer a blank first page, and is believed', blankPageStep({ asks: B, since: null, page: 1, boardOpenItems: 0 }).action === 'believe');
    const smallOpen = Array.from({ length: 3 }, (_, i) => RAW({ number: 30000 + i, state: 'open', comments: 0, updated_at: `2026-10-2${i}T08:00:00Z` }));
    const smallRows = [...smallOpen, oldClosed];
    const blankOnce = fakeBoard({ rows: smallRows, blankListings: 1 });
    const healed = await driveSnapshot({ dir: blankDir, board: blankOnce });
    t('THE MEASURED FAILURE, HEALED: a first listing that answers [] no longer ends the open phase at zero — the second ask sees the rows, the open set completes with every one of them and the count check reads OK',
      healed.manifest.walk.open_set.complete === true && healed.manifest.counts.issues_open === smallOpen.length && healed.manifest.count_check.verdict === 'ok' && healed.manifest.run.blank_pages_reasked === 1);
    t('…the witness was read between the two asks, and the second ask is the SAME request: same URL, same page size',
      blankOnce.calls[1] === '/repos/o/r' && blankOnce.calls[2] === blankOnce.calls[0] && blankOnce.calls[0].includes(`per_page=${PER_PAGE}`));
    const blankAlways = fakeBoard({ rows: smallRows, blankListings: 99 });
    const halted = await driveSnapshot({ dir: blankStopDir, board: blankAlways });
    t('a listing that stays blank from the beginning STOPS the open walk: nothing is marked complete and the count check stays pending',
      halted.stopped?.kind === 'blank-listing' && halted.manifest.walk.open_set.complete === false && halted.manifest.count_check.verdict === 'pending' && halted.manifest.resume?.stopped_by === 'blank-listing' && halted.manifest.resume?.phase === 'open');
    t('…bounded to the request: exactly BLANK_PAGE_ASKS listings and one witness read, never a loop',
      blankAlways.calls.filter((c) => c.startsWith('/repos/o/r/issues?')).length === B && halted.manifest.requests === B + 1);
    const haltedRendered = renderRun(halted, { out: blankStopDir, dryRun: true });
    t('…and the run says so and exits 0 — a planned stop the next run resumes, which the freshness row turns red if it becomes a streak',
      haltedRendered.exitCode === EXIT_OK && /STOPPED      the open listing answered EMPTY/.test(haltedRendered.text) && /a blank page is not a reading/.test(haltedRendered.text));
    const plain = fakeBoard({ rows: smallRows });
    const unpaid = await driveSnapshot({ dir: plainDir, board: plain });
    const quietBlank = fakeBoard({ rows: smallRows, blankListings: 99 });
    const believed = await driveSnapshot({ dir: plainDir, board: quietBlank });
    t('a board that answers rows pays nothing, and past an anchor a blank that survives the bound is believed: the incremental walk completes with its cursor UNMOVED, so the next run re-reads from it',
      unpaid.manifest.run.blank_pages_reasked === 0 && !/asked again/.test(renderRun(unpaid, { out: plainDir, dryRun: true }).text)
      && believed.stopped === null && believed.manifest.walk_phase === 'incremental' && believed.manifest.run.walk_complete === true
      && believed.manifest.run.blank_pages_reasked === B - 1 && believed.manifest.next_since === unpaid.manifest.next_since);

    // -- the lagging listing and the moved card (#27726) ----------------------
    battery('the lagging listing and the moved card: a disagreement is reconciled before it is reported');
    const NOW = Date.now();
    const ago = (ms) => new Date(NOW - ms).toISOString();
    const MIN = 60_000;
    t('a cursor inside the settle window is held back to the listing read minus the window',
      settledCursor(ago(MIN), ago(0)) === new Date(NOW - LISTING_SETTLE_MS).toISOString());
    t('…while a cursor already older than that is returned unchanged — a quiet board\'s manifest does not move',
      settledCursor('2026-09-13T14:50:00Z', ago(0)) === '2026-09-13T14:50:00Z');
    t('…and no cursor, or an unreadable stamp, is never turned into one built from NaN',
      settledCursor(null, ago(0)) === null && settledCursor('not a stamp', ago(0)) === 'not a stamp' && settledCursor(ago(MIN), 'nope') === ago(MIN));
    const cands = reconcileCandidates({ archivedOpen: [26084, 25896, 103, 11286], listedOpen: [103, 27741], gone: [11286] });
    t('the candidates are both directions of the disagreement, ascending, and never a gone-ledger number',
      stableJson(cands) === stableJson({ numbers: [25896, 26084, 27741], left: 0 }));
    t('…bounded, with the remainder counted rather than spent',
      stableJson(reconcileCandidates({ archivedOpen: [1, 2, 3, 4], listedOpen: [], max: 3 })) === stableJson({ numbers: [1, 2, 3], left: 1 }));
    t('a per-number read of 200 is the live record',
      numberReadVerdict({ repo: 'o/r', number: 7, status: 200, body: { number: 7, repository_url: 'https://api.github.com/repos/o/r' } }).verdict === 'live');
    t('…but a 200 naming ANOTHER number or ANOTHER repository (a followed redirect) is unreadable, never archived under this number',
      numberReadVerdict({ repo: 'o/r', number: 7, status: 200, body: { number: 2307 } }).verdict === 'unreadable'
      && numberReadVerdict({ repo: 'o/r', number: 7, status: 200, body: { number: 7, repository_url: 'https://api.github.com/repos/o/hotcrm' } }).verdict === 'unreadable');
    t('a 301 to an issue in ANOTHER repository is a transfer, named by where it went (the #25896 reply)',
      stableJson(numberReadVerdict({ repo: 'objectstack-ai/objectstack', status: 301, location: 'https://api.github.com/repos/objectstack-ai/hotcrm/issues/2307' }))
        === stableJson({ verdict: 'transferred', to: 'objectstack-ai/hotcrm#2307' }));
    t('…a redirect within THIS repository (a rename) is not a transfer and is not acted on',
      numberReadVerdict({ repo: 'O/R', status: 301, location: 'https://api.github.com/repos/o/r/issues/7' }).verdict === 'unreadable'
      && numberReadVerdict({ repo: 'o/r', status: 301, location: null }).verdict === 'unreadable');
    t('…404 and 410 are the destruction signature, and anything else is unreadable',
      numberReadVerdict({ repo: 'o/r', status: 404 }).verdict === 'destroyed' && numberReadVerdict({ repo: 'o/r', status: 410 }).verdict === 'destroyed'
      && numberReadVerdict({ repo: 'o/r', status: 502 }).verdict === 'unreadable');
    t('the reconcile reads the open board in creation order, which an update mid-read does not reshuffle',
      openSetPath('o/r', { page: 2 }) === '/repos/o/r/issues?state=open&sort=created&direction=asc&per_page=100&page=2');

    const SEEDED = ago(6 * 60 * MIN);
    const seedArchive = (dir, records, gone = null) => {
      writeIfChanged(join(dir, MANIFEST_NAME), stableJson({
        schema: ARCHIVE_SCHEMA,
        repo: 'o/r',
        generated_at: SEEDED,
        walk_phase: 'incremental',
        walk: {
          open_set: { complete: true, completed_at: '2026-09-10T15:39:49.484Z', cursor: null },
          delta: { complete: true, cursor: SEEDED, since: SEEDED, slice: DELTA_REQUEST_SLICE },
          history: { complete: true, cursor: '2026-09-23T20:24:00Z' },
        },
        since: SEEDED,
        since_reason: 'seeded',
        next_since: SEEDED,
        resume: null,
      }));
      for (const raw of records) writeIfChanged(issuePath(dir, raw.number), stableJson(issueRecord(raw)));
      if (gone) writeIfChanged(join(dir, GONE_LEDGER_NAME), stableJson(gone.map((number) => ({ number, note: 'accepted as gone' }))));
    };
    const card = (number, over = {}) => RAW({ number, comments: 0, html_url: `https://github.com/o/r/issues/${number}`, created_at: ago(3 * 24 * 60 * MIN), updated_at: ago(2 * 24 * 60 * MIN), ...over });

    // TODAY'S RED, reproduced: a close the listing served stale (#26084) and a
    // card transferred out (#25896), on an archive that was level before them.
    seedArchive(lagDir, [card(101), card(103)]);
    const closedLate = card(104, { state: 'closed', state_reason: 'completed', updated_at: ago(2 * MIN), closed_at: ago(2 * MIN) });
    const lagBoard = () => fakeBoard({
      rows: [card(103), closedLate, card(105, { updated_at: ago(MIN) })],
      lagging: new Map([[104, card(104, { updated_at: ago(3 * 60 * MIN) })]]),
      lagListings: 1,
      moved: new Map([[101, 'o/hotcrm#2307']]),
    });
    const lagRun = lagBoard();
    const repaired = await driveSnapshot({ dir: lagDir, board: lagRun });
    t('TODAY\'S RED, REPRODUCED: the walk archives the stale open row and the census first disagrees with the board by a SURPLUS of 2',
      repaired.reconcile?.first.verdict === 'surplus' && repaired.reconcile.first.surplus === 2 && repaired.reconcile.first.archived === 4 && repaired.reconcile.first.expected === 2);
    t('…and is RECONCILED, not reported: the close is archived again from its own read, the transfer is recorded, and the check reads OK',
      repaired.manifest.count_check.verdict === 'ok' && readArchivedCard(lagDir, 104).issue.state === 'closed'
      && stableJson(repaired.reconcile?.reread) === stableJson([{ number: 104, state: 'closed' }])
      && stableJson(repaired.reconcile?.transferred) === stableJson([{ number: 101, to: 'o/hotcrm#2307' }]));
    t('…the transferred record STAYS in the archive, whole, with where it went — counted apart from the open set',
      readArchivedCard(lagDir, 101).issue.transferred_to === 'o/hotcrm#2307' && readArchivedCard(lagDir, 101).issue.body === 'the body that a suspension destroys'
      && repaired.manifest.counts.issues_transferred === 1 && repaired.manifest.counts.issues_open === 2);
    t('…read WITHOUT following the redirect: the destination\'s card (o/hotcrm#2307) is never archived under this board',
      readArchivedCard(lagDir, 2307).ok === false && !lagRun.calls.includes('/repos/o/hotcrm/issues/2307'));
    t('…the board\'s arithmetic is read AGAIN after the repair, so the two sides of the reported check name one instant',
      lagRun.calls.filter((c) => c === '/repos/o/r').length === 2
      && lagRun.calls.lastIndexOf('/repos/o/r') > lagRun.calls.indexOf('/repos/o/r/issues/104'));
    const repairedText = renderRun(repaired, { out: lagDir, dryRun: false });
    t('…and the run is GREEN and says what it reconciled, with the first census beside the verdict',
      repairedText.exitCode === EXIT_OK && /reconcile    the first census disagreed \(SURPLUS of 2/.test(repairedText.text)
      && /#101 → o\/hotcrm#2307/.test(repairedText.text) && /#104 closed/.test(repairedText.text) && /count check  ok/.test(repairedText.text));
    t('…while the cursor it stores is SETTLED: no later than the window before its last listing read, though the newest row is a minute old',
      Date.parse(repaired.manifest.next_since) <= Date.now() - LISTING_SETTLE_MS && Date.parse(repaired.manifest.next_since) < Date.parse(ago(MIN)));
    const after = lagBoard();
    const steady = await driveSnapshot({ dir: lagDir, board: after });
    t('the next run is green with nothing to reconcile, and the transferred number is never read again',
      steady.manifest.count_check.verdict === 'ok' && steady.reconcile?.candidates === 0 && steady.manifest.run.reconcile?.wrote === 0
      && !after.calls.some((c) => /^\/repos\/o\/r\/issues\/\d+$/.test(c)) && steady.manifest.counts.issues_transferred === 1);

    // THE SETTLE WINDOW, alone: a lagged update that moves no count, so no
    // reconcile runs — only the next run's window can catch it.
    seedArchive(settleDir, [card(201, { labels: [{ name: 'a' }] })]);
    const relabelled = card(201, { labels: [{ name: 'b' }], updated_at: ago(2 * MIN) });
    const settleRows = [relabelled, card(202, { updated_at: ago(MIN) })];
    const settleLag = new Map([[201, card(201, { labels: [{ name: 'a' }] })]]);
    const lagged = await driveSnapshot({ dir: settleDir, board: fakeBoard({ rows: settleRows, lagging: settleLag, lagListings: 99 }) });
    t('a lagged relabel is missed by the run whose listing served it stale, which agrees with the board and reconciles nothing',
      lagged.manifest.count_check.verdict === 'ok' && lagged.reconcile?.candidates === 0 && stableJson(readArchivedCard(settleDir, 201).issue.labels) === stableJson(['a']));
    await driveSnapshot({ dir: settleDir, board: fakeBoard({ rows: settleRows }) });
    t('…and CAUGHT by the next run, whose settled window starts before it — a cursor taken from the newest row (a minute old) would have skipped it for good',
      stableJson(readArchivedCard(settleDir, 201).issue.labels) === stableJson(['b']));

    // THE REAL ALARM SURVIVES: a destroyed number is read, named and left red.
    seedArchive(destroyedDir, [card(301), card(302), card(303)], [302]);
    const goneBoard = fakeBoard({ rows: [card(303)], destroyed: new Set([301, 302]) });
    const destroyedRun = await driveSnapshot({ dir: destroyedDir, board: goneBoard });
    const destroyedText = renderRun(destroyedRun, { out: destroyedDir, dryRun: false });
    t('⛔ NOT A TOLERANCE: a number the board answers 404 for stays archived as it was, the check stays a SURPLUS and the run exits 2, naming its --restore',
      destroyedRun.manifest.count_check.verdict === 'surplus' && destroyedRun.manifest.count_check.surplus === 1 && destroyedText.exitCode === EXIT_COUNT_MISMATCH
      && stableJson(destroyedRun.reconcile?.destroyed) === stableJson([{ number: 301, kind: 'issue' }]) && /#301 issue \(404\/410 — --restore=301\)/.test(destroyedText.text)
      && stableJson(destroyedRun.manifest.count_check.destroyed) === stableJson([301])
      && readArchivedCard(destroyedDir, 301).issue.state === 'open' && readArchivedCard(destroyedDir, 301).issue.transferred_to === undefined);
    t('…and a number the maintainer already answered for in the gone ledger is never read',
      !goneBoard.calls.includes('/repos/o/r/issues/302') && goneBoard.calls.includes('/repos/o/r/issues/301'));
    const blankBoard = fakeBoard({ rows: [card(303)], destroyed: new Set([301, 302]), blankListings: 99 });
    const blankRun = await driveSnapshot({ dir: destroyedDir, board: blankBoard });
    t('a reconcile whose open listing stays blank from the beginning compares nothing, reads no number, and the disagreement is reported as it stands',
      blankRun.manifest.count_check.verdict === 'surplus' && blankRun.reconcile?.listed === null && /answered EMPTY/.test(blankRun.reconcile?.reason)
      && !blankBoard.calls.some((c) => /^\/repos\/o\/r\/issues\/\d+$/.test(c)) && /nothing was compared/.test(renderRun(blankRun, { out: destroyedDir, dryRun: false }).text));

    // CANCELLING ERRORS: a destroyed issue and a card the archive never saw
    // agree in the counts. The reconcile runs on an AGREEING census too, and
    // the destroyed record keeps the run red whatever the arithmetic says.
    seedArchive(cancelDir, [card(401), card(403)]);
    const cancelBoard = fakeBoard({
      rows: [card(403), card(404, { created_at: ago(MIN), updated_at: ago(MIN) })],
      lagging: new Map([[404, card(404, { state: 'closed', updated_at: ago(3 * 24 * 60 * MIN) })]]),
      lagListings: 99,
      destroyed: new Set([401]),
    });
    const cancelled = await driveSnapshot({ dir: cancelDir, board: cancelBoard });
    const cancelledText = renderRun(cancelled, { out: cancelDir, dryRun: false });
    t('⛔ CANCELLING ERRORS: a census whose counts AGREE is still reconciled, and a destroyed issue found there makes the verdict DESTROYED, exit 2',
      cancelled.reconcile?.first.verdict === 'ok' && cancelled.manifest.count_check.verdict === 'destroyed' && cancelled.manifest.count_check.ok === false
      && stableJson(cancelled.manifest.count_check.destroyed) === stableJson([401]) && cancelledText.exitCode === EXIT_COUNT_MISMATCH
      && /count check  DESTROYED — the counts agree/.test(cancelledText.text) && /the first census agreed/.test(cancelledText.text));
    t('…while a destroyed PULL REQUEST is named and leaves the issue verdict alone — the count check counts issues',
      withDestroyedIssues({ verdict: 'ok', ok: true }, []).verdict === 'ok'
      && withDestroyedIssues({ verdict: 'pending', ok: null }, [401]).verdict === 'pending'
      && withDestroyedIssues({ verdict: 'surplus', ok: false }, [401]).verdict === 'surplus');

    // CUT SHORT: a reconcile whose budget runs out after a repair reports the
    // census from BEFORE it against the board read before it — and keeps
    // what it read.
    seedArchive(cutDir, [card(501), card(502)]);
    const cutBoard = fakeBoard({
      rows: [card(501, { state: 'closed', updated_at: ago(2 * MIN), closed_at: ago(2 * MIN) }), card(503, { updated_at: ago(MIN) })],
      lagging: new Map([[501, card(501, { updated_at: ago(3 * 60 * MIN) })]]),
      lagListings: 1,
      destroyed: new Set([502]),
    });
    // walk 1 + board 2 + open listing 1 + #501's read 1 = 5 under a ceiling of
    // max − BOARD_READ_RESERVE, so #502's read is the one refused.
    const cut = await driveSnapshot({ dir: cutDir, board: cutBoard, options: { maxRequests: 5 + BOARD_READ_RESERVE } });
    const cutText = renderRun(cut, { out: cutDir, dryRun: false });
    t('CUT SHORT: the verdict is the FIRST census against the FIRST board read — never the repaired census against the first board',
      cut.reconcile?.cut_short === true && cut.manifest.count_check.verdict === cut.reconcile.first.verdict
      && cut.manifest.count_check.archived === cut.reconcile.first.archived && cut.manifest.count_check.verdict === 'surplus' && cutText.exitCode === EXIT_COUNT_MISMATCH);
    t('…and what it DID read is kept: the repaired close is on disk and named, the summary says CUT SHORT, not "nothing was compared"',
      readArchivedCard(cutDir, 501).issue.state === 'closed' && stableJson(cut.reconcile.reread) === stableJson([{ number: 501, state: 'closed' }])
      && /CUT SHORT — /.test(cutText.text) && /archived again: #501 closed/.test(cutText.text) && !/nothing was compared/.test(cutText.text)
      && !cutBoard.calls.includes('/repos/o/r/issues/502'));
    t('…and the reserve held: the reconcile stopped with the board read still affordable', cut.manifest.requests <= 5 + BOARD_READ_RESERVE);

    // THE LEDGER COUNTS WHAT THE CENSUS COUNTED: a ledgered number recorded
    // as transferred is not subtracted again, so it cannot absorb a real
    // surplus — here an issue whose own read fails (502), which is that
    // number's verdict and never the run's.
    seedArchive(ledgerDir, [card(602), card(603)], [601]);
    writeIfChanged(issuePath(ledgerDir, 601), stableJson({ ...issueRecord(card(601)), transferred_to: 'o/cloud#9' }));
    const ledgerBoard = fakeBoard({ rows: [card(603)], failing: new Set([602]) });
    const ledgered = await driveSnapshot({ dir: ledgerDir, board: ledgerBoard });
    t('a gone-ledger number already recorded as transferred is NOT subtracted twice — the surplus it would have absorbed stays red',
      ledgered.manifest.count_check.verdict === 'surplus' && ledgered.manifest.count_check.surplus === 1 && ledgered.manifest.count_check.gone_ledger === 0
      && renderRun(ledgered, { out: ledgerDir, dryRun: false }).exitCode === EXIT_COUNT_MISMATCH);
    t('…and a 5xx on one number is that number\'s verdict: named unreadable, the record untouched, the run still renders',
      stableJson(ledgered.reconcile?.unreadable) === stableJson([{ number: 602, status: 502 }]) && readArchivedCard(ledgerDir, 602).issue.state === 'open'
      && /unreadable:     #602 \(HTTP 502\)/.test(renderRun(ledgered, { out: ledgerDir, dryRun: false }).text));
  } finally {
    for (const d of [liveDir, busyDir, stopDir, idemDir, quietDir, staleDir, blankDir, blankStopDir, plainDir, lagDir, settleDir, destroyedDir, cancelDir, cutDir, ledgerDir]) rmSync(d, { recursive: true, force: true });
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) problems.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(count === 0
      ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
      : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`);
  }
  for (const message of problems) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x board-snapshot self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`OK board-snapshot self-test: ${cases.length} cases pass across ${declared.length} batteries (open-first walk order, the delta-first run order and its budget split driven end to end, walk re-anchor, the three walk cursors, idempotence, the count-check verdicts and their predicate, the freshness row that keeps a stale archive from reporting success, the restore header, and the two structural properties).`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    // `selfTest()` is async because the driven battery runs the real walk against
    // an injected fetch. ⛔ The verdict guard stays on THIS side of the await: a
    // `process.exit(promise)` would coerce to 0 and report a self-test that never
    // ran as one that passed, and so would a rejection nobody caught.
    selfTest().then(
      (code) => {
        if (!selfTestReachedVerdict) {
          console.error(
            '\nx board-snapshot self-test: selfTest() returned without reaching its verdict, so no success\n' +
              'line was printed. Exiting 0 here would report a self-test that never finished as a self-test\n' +
              'that passed.\n',
          );
          process.exit(1);
        }
        process.exit(code);
      },
      (err) => {
        console.error(`\nx board-snapshot self-test: it THREW before reaching its verdict — ${err?.stack ?? err}\n`);
        process.exit(1);
      },
    );
  } else {
    // ⛔ --restore is not re-exec'd: it reads the archive directory and makes no
    // request at all, so routing its transport would spawn a child to prove a
    // route nothing in that mode uses. The absence of the re-exec line is part
    // of what "prints, never posts, reads nothing but the directory" looks like.
    const restoring = process.argv.some((a) => a === '--restore' || a.startsWith('--restore='));
    const rearmed = restoring ? null : rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
