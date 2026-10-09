#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * label-write — the four-step label/assignee write, as ONE spelling (#18085).
 *
 *   node scripts/pm/label-write.mjs --repo owner/name --issue N --add pm:dispatched --remove pm:queue
 *   node scripts/pm/label-write.mjs --issue N --assign os-project-manager
 *   node scripts/pm/label-write.mjs --issue N --add skip-changeset --dry-run
 *   node scripts/pm/label-write.mjs --issue N --release --recheck-comment ID --comment-file release.md --resume-from BRANCH@SHA
 *   node scripts/pm/label-write.mjs --self-test          # offline, no network at all
 *
 * ## Why this file exists
 *
 * `.claude/skills/pm-dispatch/SKILL.md` requires every label write to be four
 * steps — 取现集 → 只增删目标 → 写合并集 → 回读 diff 对 union(现集, 增删) — and
 * `references/rest-channel.md` named the channels. Its fallback for a seat whose
 * REST channel is shut named exactly one tool: MCP `issue_write`. Lock 1 added
 * that tool to `permissions.deny` in `.claude/settings.json`, so the documented
 * recovery path terminated in a denial and the four steps had no single spelling
 * at all — every seat retyped them, and the retyping is where a step gets
 * dropped.
 *
 * So the steps are a program, not a paragraph. Every invocation performs all
 * four and prints each with the UTC stamp the step was taken at.
 *
 * ## The channel order, and why the fallback is LAST
 *
 * Three verbs touch a label set and only one is destructive:
 *
 *   POST   /issues/{n}/labels          adds the named labels, touches nothing else
 *   DELETE /issues/{n}/labels/{name}   removes ONE label, BY NAME
 *   PATCH  /issues/{n}  {labels:[…]}   replaces the whole set — DESTRUCTIVE
 *
 * The first two are what this tool spends by default: neither can strip a label
 * a concurrent seat wrote between step ① and step ③, because neither names a
 * label it was not asked to touch. The third is a read-modify-write across a
 * network round trip and destroys anything that lands inside it — the measured
 * loss on PR #10698 is one second wide, and `scripts/check-whole-set-label-write.mjs`
 * bans its `PUT` sibling outright over this whole subtree.
 *
 * ⛔ This file therefore never issues `PUT /issues/{n}/labels`, in any spelling.
 * The `PATCH /issues/{n}` fallback is a DIFFERENT endpoint carrying the SAME
 * hazard, and it is reached only when the platform has refused the additive
 * verbs outright — a seat with no additive channel and a stale label is worse
 * off than one that spent a narrow race. Three things make it survivable, and
 * all three are the reason it is allowed at all:
 *
 *   1. it is tried ONCE, only after a refusal, never as a first choice;
 *   2. it echoes the CURRENT assignees back into the body. `issue_write`'s
 *      measured hazards (`references/platform-readings.md`) are whole-set
 *      replacement AND the clearing of every field the write did not pass, so
 *      a body carrying `labels` alone silently un-assigns the card. The echo is
 *      what makes a label write a label write;
 *   3. step ④ reads the card back and diffs it against the target, which is the
 *      only detection a whole-set write has. A label in the target the read-back
 *      lacks was stripped underneath: it is re-added ONCE and REPORTED.
 *
 * ## ⚠️ What this tool CANNOT measure, and therefore does not claim
 *
 * The refusal that motivated this card was not GitHub's and not the egress
 * proxy's: a seat's own harness permission classifier refused a `curl -X DELETE`
 * command before any request was made. That classifier judges the COMMAND a
 * session is about to run. Whether it refuses `node scripts/pm/label-write.mjs`
 * the way it refused a raw `curl` is a property of the calling session, is not
 * observable from inside this process, and is ⛔ NOT asserted anywhere in this
 * file or its output. A seat that is refused at that layer never reaches step ①,
 * gets no exit code from here at all, and is in the exit-5 position by another
 * route: it hands the write to a seat that has a channel.
 *
 * ## The transport — `OS_FLEET_TRANSPORT` direct | dispatch | auto
 *
 * A cloud seat container cannot write as the fleet directly (its proxy
 * replaces the Authorization header), so step ③ has two transports and ONE
 * shape: `direct` issues the additive verbs above with the token this process
 * holds; `dispatch` packs the SAME verbs — the adds, the directed removes and
 * the assignee change of this one write — into ONE `repository_dispatch` and
 * `scripts/pm/fleet-write/dispatch.mjs` waits for the relay run that executes
 * them as `objectstack-fleet[bot]`. Steps ①, ② and ④ are the same on both:
 * reads are unaffected, and the read-back is what closes the write either
 * way. `auto` (the default) picks `dispatch` in a cloud seat container and
 * `direct` elsewhere, and prints which. The whole-set `PATCH` fallback below
 * belongs to `direct` alone: the relay only has additive verbs. ⛔ Once a
 * dispatch is ACCEPTED, its run is the only answer: no run in the start
 * window, or none completed, is exit 6 under `auto` exactly as under
 * `dispatch` — never a direct write after it. The relay may merely be queued,
 * and the direct write would book the stroke against the seat's personal
 * account instead of the fleet's and may land it twice
 * (`fleet-write/dispatch.mjs`'s no-run conformance pins every sender to this).
 *
 * ## `--release` — reclaiming a SILENT claim, in ONE relay stroke, RELAY-ONLY
 *
 * A claim with no PR, no commit and no word on the card used to sit for days,
 * because the lifecycle text said a silent seat "may be" recycled and named no
 * actor, no clock and no write. The protocol now has both halves, and this is
 * the write half (the text half is `RECLAIM_TEXT_PATH`, whose constant this
 * file's self-test pins equal to `RECLAIM_AFTER_HOURS`):
 *
 *   knock    triage posts the owned-24h re-check on the card — a comment whose
 *            first line, after any markdown heading marks, is
 *            `RECHECK_COMMENT_KEY`. ⛔ This tool never writes the knock and
 *            never releases without one: `--recheck-comment ID` names it.
 *   clock    the knock's `created_at` against the SERVER's clock — the `Date`
 *            header of the very response that returned the knock. ⛔ Never
 *            `Date.now()`: a container's clock is nobody's reading. Younger
 *            than `RECLAIM_AFTER_HOURS` ⇒ REFUSED, saying how long remains.
 *   silence  the knock must still be the newest comment on the card. Anything
 *            said after it — by the holder or anyone — is read by a seat, not
 *            by this tool: it refuses, and triage re-knocks if that was no
 *            answer. A pushed branch with an OPEN pull request is produce too,
 *            so `--resume-from BRANCH@SHA` is checked against the branch's tip
 *            AND against the open pulls on that head before anything is sent.
 *   stroke   ONE `repository_dispatch`, in this order: the `Release:` comment
 *            (the operator's provenance prose, with `Resume-from: BRANCH@SHA`
 *            and the clock reading appended by this tool), `pm:queue` on,
 *            `pm:dispatched` off, every assignee off. The holder's seat post
 *            is not an action here and cannot become one — every action
 *            names the card.
 *   read-back the card's labels and assignees against the ② target, and the
 *            release comment located on the board by its stored bytes
 *            (post-stamped's `pickRelayComment`). A board that disagrees is
 *            exit 4 and is NOT repaired: a re-add under the relay is a second
 *            write.
 *
 * ⛔ RELAY-ONLY. A release lands as `objectstack-fleet[bot]` through the relay
 * or it does not land: a route that resolves to `direct` — a developer's
 * machine, `OS_FLEET_TRANSPORT=direct`, a relay the board has switched off —
 * is a PREREQUISITE refusal (exit 3) with zero writes, and an accepted
 * dispatch with no run is UNCONFIRMED (exit 6) exactly as above, never a
 * direct write after it. The seat whose silence is being reclaimed may be the
 * fleet's own account; a release booked under a personal login is the
 * half-state this mode exists to end, not a fallback.
 *
 * Why this file and not `close-cards.mjs`: a release IS a label/assignee
 * transition — `pm:dispatched` → `pm:queue`, assignee cleared — with a
 * provenance comment in front of it, so its arithmetic (`computeLabelTarget`,
 * `computeAssigneeTarget`, `relayActions`, `readBackVerdict`) is already this
 * file's, and the comment half is borrowed from post-stamped exactly the way
 * close-cards borrows it. close-cards' plan file, skip matrix and resume are
 * built to act on UNOWNED `pm:queue` cards and to CLOSE them; a release acts
 * on an OWNED `pm:dispatched` card and leaves it open — the inverse of every
 * skip row there. `--release` therefore owns its own plan: `--add`,
 * `--remove`, `--assign`, `--unassign`, `--clear-assignees` and
 * `--allow-two-states` are refused beside it.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  the write landed AND the read-back matched the target.
 *   2  usage.
 *   3  PREREQUISITE NOT MET — no token, no route, or the credential is rate-limit
 *      exhausted. NOT MEASURED: nothing was written and nothing is claimed. A 403
 *      whose `x-ratelimit-remaining` is 0 lands here rather than in the fallback
 *      ON PURPOSE — rate-limit refusal binds the IDENTITY, so switching channels
 *      to keep writing is the same act as retrying, and every seat shares this one.
 *   4  the write was accepted and the READ-BACK DISAGREES with the target. The
 *      diff is printed. This is the one exit that means the board is now in a
 *      state nobody asked for.
 *   5  every channel refused. A seat in this position has no label channel: hand
 *      the write to a seat that has one by filing a card in the target lane.
 *      ⛔ Never MCP `issue_write` — lock 1 denies it, and it was the whole-set
 *      replace this tool exists to avoid in the first place.
 *   6  UNCONFIRMED — the dispatch was accepted and its run did not appear, or
 *      did not complete, within the ceiling. The run URL is printed. Go READ
 *      the card; ⛔ never re-run blind: a second dispatch is a second write.
 *
 *   Under `--release`, 2 is also every REFUSAL before the write — a knock too
 *   young (the remaining time is printed), a knock that is not the newest
 *   comment, a card that is not an owned `pm:dispatched` card, a branch whose
 *   tip is not the sha named or that has an open pull — and 3 is also a route
 *   that is not the relay. ⛔ ZERO writes on every one of them.
 *
 *   `node scripts/pm/label-write.mjs … > /tmp/lw.log 2>&1; EXIT=$?; tail -40 /tmp/lw.log`
 *
 * ## The vocabularies are IMPORTED, never restated
 *
 * `PM_EXCLUSIVE_STATE_LABELS` (the ONE-OF states), `PM_STATE_CLAIM` (what each
 * one claims on its own) and `PM_RESIDUE_LABELS` (what claims work is in flight)
 * come from `check-half-states.mjs`, so the write side and the read-side patrol
 * cannot come to disagree about what a state is. A target carrying two states is
 * REFUSED — H29's finding written one layer earlier, at the act that would
 * create the pair — and `--allow-two-states` is the declared exception, which
 * still prints what it let through.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_UNCONFIRMED, exitForResult, packRequest, resolveRoute, sendFleetWrite, unconfirmedText } from './fleet-write/dispatch.mjs';
import { refusalText as relayRefusalText } from './fleet-write/validate.mjs';
import { isProxyRefusal, isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from './write-pace.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  PM_EXCLUSIVE_STATE_LABELS,
  PM_RESIDUE_LABELS,
  PM_STATE_CLAIM,
  PROXY_FLAG,
  RELEASE_COMMENT_MARKER,
  markerMatches,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';
// The comment half of a release, borrowed exactly as close-cards borrows it:
// the one `comment` op, the stamp render, and the board-side read-back of the
// stored bytes. ⛔ None of these is touched at module scope — post-stamped
// reaches this file through `fleet-write/dispatch.mjs`, so a module-scope use
// here would read a binding that has not been initialised yet when
// post-stamped is the entrypoint.
import { PLATFORM_COMMENT_FOOTER, pickRelayComment, readBackVerdict as commentReadBackVerdict, relayAction, renderBody } from './post-stamped.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = new URL('../../', import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const PROXY_REARM_GUARD = 'OS_LABEL_WRITE_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_READ_BACK_MISMATCH = 4;
export const EXIT_PLATFORM_REFUSAL = 5;

/**
 * Re-exported so a caller reads ONE name rather than remembering that 3 is
 * shared with the sweeper. `check-half-states.mjs` owns the value.
 */
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;

// ---------------------------------------------------------------------------
// The pure core — every rule this tool has, as functions a self-test can drive
// with fixtures. The live path below is a thin fetch loop around them, so the
// arithmetic that decides what gets written is testable offline and the network
// leg has no judgement of its own.
// ---------------------------------------------------------------------------

/** Order-preserving de-duplication. A label named twice is one label. */
export function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const v of values ?? []) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** A repeatable comma list (`--add a,b --add c`), trimmed, de-duplicated, empties dropped. */
export function parseList(raw) {
  const parts = [];
  for (const chunk of Array.isArray(raw) ? raw : [raw]) {
    for (const piece of String(chunk ?? '').split(',')) {
      const value = piece.trim();
      if (value) parts.push(value);
    }
  }
  return dedupe(parts);
}

/**
 * Step ② for labels: target = (current ∪ add) − remove, plus the plan that
 * reaches it with the two NON-destructive verbs.
 *
 * The two `noop*` buckets are the idempotence this tool promises. Re-adding a
 * label the card already carries issues no call and is a success; removing one
 * it no longer carries issues no call and is a success. Neither is an error to
 * report — a seat that re-runs a write because it could not read the first run's
 * exit code must get the same answer, or the retry becomes its own hazard.
 */
export function computeLabelTarget({ current = [], add = [], remove = [] } = {}) {
  const cur = dedupe(current);
  const adds = dedupe(add);
  const removes = dedupe(remove);
  const removeSet = new Set(removes);
  const currentSet = new Set(cur);

  const target = [...cur.filter((l) => !removeSet.has(l)), ...adds.filter((l) => !currentSet.has(l) && !removeSet.has(l))];

  return {
    target,
    addCalls: adds.filter((l) => !currentSet.has(l)),
    removeCalls: removes.filter((l) => currentSet.has(l)),
    noopAdds: adds.filter((l) => currentSet.has(l)),
    noopRemoves: removes.filter((l) => !currentSet.has(l)),
  };
}

/** Step ② for assignees. Same shape, same idempotence, and `clearAll` wins over both lists. */
export function computeAssigneeTarget({ current = [], assign = [], unassign = [], clearAll = false } = {}) {
  const cur = dedupe(current);
  if (clearAll) {
    return { target: [], addCalls: [], removeCalls: cur, noopAdds: [], noopRemoves: [] };
  }
  const adds = dedupe(assign);
  const removes = dedupe(unassign);
  const removeSet = new Set(removes);
  const currentSet = new Set(cur);

  return {
    target: [...cur.filter((l) => !removeSet.has(l)), ...adds.filter((l) => !currentSet.has(l) && !removeSet.has(l))],
    addCalls: adds.filter((l) => !currentSet.has(l)),
    removeCalls: removes.filter((l) => currentSet.has(l)),
    noopAdds: adds.filter((l) => currentSet.has(l)),
    noopRemoves: removes.filter((l) => !currentSet.has(l)),
  };
}

/**
 * H29's finding, asked of a TARGET rather than of a board: would this write
 * leave two ONE-OF state claims standing? Returns the sentence, or null.
 *
 * Reported at the act that would create the pair rather than by a patrol hours
 * later, because the measured origin of every pair is the same: a TRANSITION
 * written as an ADD instead of a REPLACE. That is exactly what `--add` without
 * the matching `--remove` spells here, so this is the one place the mistake is
 * still one keystroke from correct.
 */
export function refuseTwoStates(target = []) {
  const present = PM_EXCLUSIVE_STATE_LABELS.filter((l) => (target ?? []).includes(l));
  if (present.length < 2) return null;
  const named = present.map((l) => `\`${l}\` (${PM_STATE_CLAIM[l]})`).join(' + ');
  return (
    `the target carries ${present.length} pm STATE labels — ${named} — and the state labels are ONE-OF: ` +
    'each is a claim about where the card IS, so two of them leave the queue view, the lane view, the unlock ' +
    'scan and the decision inbox to pick which one they believe. A transition is a REPLACE: name the state ' +
    'being left in `--remove` in this same write. Pass `--allow-two-states` only if two claims really are true ' +
    'here, and say so on the card.'
  );
}

/**
 * A closed card whose target still claims work is in flight. Report-only: the
 * write is not blocked, because a seat re-labelling a closed card usually knows
 * why, and the standing `sweep-closed-cards.mjs --write` caller clears residue
 * on its own schedule with no seat channel involved.
 */
export function residueNote({ state, target = [] } = {}) {
  if (state !== 'closed') return null;
  const present = PM_RESIDUE_LABELS.filter((l) => (target ?? []).includes(l));
  if (present.length === 0) return null;
  return (
    `the card is CLOSED and the target still carries ${present.map((l) => `\`${l}\``).join(', ')} — residue that ` +
    'claims work is in flight. Not blocked, and not this tool\'s to decide: the half-state patrol\'s closed-card ' +
    'sweep clears it on its own schedule. Named here so the write is deliberate rather than accidental.'
  );
}

/**
 * Step ④'s verdict, in three buckets that mean three different things.
 *
 *   `missing`         — in the target, absent from the read-back. STRIPPED
 *                       UNDERNEATH by a concurrent whole-set writer (or the
 *                       write silently did not take). Re-add once, and REPORT.
 *   `survivedRemoval` — asked to be removed, still there. The directed DELETE
 *                       did not take; re-issuing it is not a repair, so this is
 *                       a mismatch.
 *   `concurrentAdds`  — present, never in the target, never asked to be removed.
 *                       ⛔ NOT a mismatch: an additive write by another seat is
 *                       precisely what additive-first exists to preserve. It is
 *                       printed because a seat should know the board moved.
 */
export function readBackVerdict({ target = [], removeCalls = [], readBack = [] } = {}) {
  const back = new Set(readBack);
  const targetSet = new Set(target);
  const removed = new Set(removeCalls);
  return {
    missing: target.filter((l) => !back.has(l)),
    survivedRemoval: removeCalls.filter((l) => back.has(l)),
    concurrentAdds: readBack.filter((l) => !targetSet.has(l) && !removed.has(l)),
  };
}

/** Is this verdict clean enough to exit 0? `concurrentAdds` deliberately does not count. */
export function verdictIsClean(verdict) {
  return (verdict?.missing?.length ?? 0) === 0 && (verdict?.survivedRemoval?.length ?? 0) === 0;
}

/**
 * The PATCH fallback body. `assignees` is ALWAYS present, even when no assignee
 * change was asked for — that is the echo, and it is the difference between a
 * label write and a label write that silently un-assigns the card.
 */
export function patchFallbackBody({ labelTarget = [], assigneeTarget = [] } = {}) {
  return { labels: [...labelTarget], assignees: [...assigneeTarget] };
}

/**
 * Step ③ as ONE relay stroke: the same additive verbs the direct plan issues,
 * in the same order, as the relay's actions. Pure. An empty plan packs to no
 * actions — and no dispatch leaves for it.
 */
export function relayActions({ issue, labels, assignees } = {}) {
  const out = [];
  if (labels?.addCalls?.length) out.push({ op: 'labels_add', issue, labels: [...labels.addCalls] });
  if (labels?.removeCalls?.length) out.push({ op: 'labels_remove', issue, labels: [...labels.removeCalls] });
  if (assignees?.addCalls?.length) out.push({ op: 'assign', issue, assignees: [...assignees.addCalls] });
  if (assignees?.removeCalls?.length) out.push({ op: 'unassign', issue, assignees: [...assignees.removeCalls] });
  return out;
}

/**
 * What an HTTP answer MEANS for the op that asked. Pure, because this is the
 * decision that routes between "try the fallback", "stop, nothing is measured"
 * and "that was a success spelled as a 404".
 *
 * Four answers a status alone cannot give:
 *
 *   - a `404` on a DELETE of ONE NAMED LABEL is the label already being gone.
 *     Idempotent success. On any other op a 404 is the egress refusing a path,
 *     because step ① already proved the card exists;
 *   - a `403`/`429` with `x-ratelimit-remaining: 0` is EXHAUSTION, not a shut
 *     channel. It must NOT reach the fallback: rate-limit refusal binds the
 *     identity, every seat on this board shares that identity, and continuing
 *     the same write through another channel is the same act as retrying;
 *   - `401`/`407` is the ROUTE or the credential — nothing about this card;
 *   - a thrown fetch (status 0) is the route too;
 *   - a 403 whose BODY is the egress proxy's ("not permitted through this
 *     proxy", a `documentation_url` that is not GitHub's) is the ROUTE as well
 *     — the request never reached the platform — so it is `prerequisite`,
 *     ⛔ never `ratelimit`: a proxy refusal carries no rate header, and an
 *     absent header is NOT a zero. Measured once as a zero, it wrote a
 *     30-minute STOP MARKER for the fleet's token key against a channel that
 *     was never spoken to.
 */
export function classifyHttp({ status, op, rateRemaining, body } = {}) {
  if (status === 200 || status === 201 || status === 204) return 'ok';
  if (status === 404 && op === 'label-delete') return 'idempotent';
  if (isProxyRefusal(body)) return 'prerequisite';
  // `x-ratelimit-remaining` must be PRESENT and zero; `Number(null)` is 0, which is how an absent header once read as exhaustion.
  const remaining = rateRemaining === null || rateRemaining === undefined || String(rateRemaining).trim() === '' ? null : Number(rateRemaining);
  if (status === 429) return 'ratelimit';
  if (status === 403 && remaining === 0) return 'ratelimit';
  if (status === 401 || status === 407 || status === 0) return 'prerequisite';
  if (status === 403 || status === 404 || status === 405) return 'refusal';
  return 'error';
}

/** A UTC stamp read by the act that prints it — never one carried from an earlier step. */
export function stampNow(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const render = (values) => (values.length ? values.map((v) => `\`${v}\``).join(', ') : 'none');

// ---------------------------------------------------------------------------
// `--release` — the pure core of the silent-claim reclaim (header: `--release`).
// Every rule that decides whether a release happens is a function here, so the
// self-test drives the two fixture cards the protocol names — a knock older
// than the clock, and one younger — with zero network.
// ---------------------------------------------------------------------------

/**
 * The reclaim clock, in hours after an UNANSWERED knock. The protocol text
 * spells the same name and value (`RECLAIM_TEXT_PATH`), and the self-test
 * pins the two equal, so neither can move without the other.
 */
export const RECLAIM_AFTER_HOURS = 12;
export const RECLAIM_TEXT_PATH = '.claude/skills/pm-dispatch/references/triage-duties.md';

/**
 * The knock's first-line key — the owned-24h re-check as triage already
 * spells it on the board, read after any markdown heading marks. ONE
 * spelling: the protocol text names this one, and this tool recognises no
 * second.
 */
export const RECHECK_COMMENT_KEY = 'Owned-24h re-check:';

/** The transition a release writes. Both names are the imported ONE-OF vocabulary's; the self-test pins that. */
export const RELEASE_FROM = 'pm:dispatched';
export const RELEASE_TO = 'pm:queue';

/** The line this tool appends to the release comment, and the spelling of "no branch was ever pushed". */
export const RESUME_FROM_KEY = 'Resume-from:';
export const RESUME_FROM_NONE = 'none';
const RESUME_FROM_SHAPE = /^([^\s@]+)@([0-9a-fA-F]{7,40})$/;
/** Pages of 100 comments the silence read may walk before it refuses to judge an unexhausted thread. */
export const RELEASE_COMMENT_PAGE_CAP = 30;

/** The first line of a body with its markdown heading marks and surrounding whitespace removed. Pure. */
export function firstLineKeyText(body) {
  const first = String(body ?? '').split(/\r?\n/)[0] ?? '';
  return first.replace(/^\s*#+\s*/, '').trim();
}

/** Is this comment the knock — its first line, after heading marks, the re-check key? Pure. */
export function isRecheckComment(body) {
  return firstLineKeyText(body).startsWith(RECHECK_COMMENT_KEY);
}

/** `BRANCH@SHA` or `none`, parsed; `{ ok: false, error }` otherwise. Pure. */
export function parseResumeFrom(raw) {
  const value = String(raw ?? '').trim();
  if (value === RESUME_FROM_NONE) return { ok: true, none: true, branch: null, sha: null, line: `${RESUME_FROM_KEY} ${RESUME_FROM_NONE}` };
  const m = RESUME_FROM_SHAPE.exec(value);
  if (!m) {
    return {
      ok: false,
      error: `--resume-from must be \`BRANCH@SHA\` (7–40 hex) or \`${RESUME_FROM_NONE}\` when no branch was ever pushed, got \`${value || '(empty)'}\``,
    };
  }
  return { ok: true, none: false, branch: m[1], sha: m[2].toLowerCase(), line: `${RESUME_FROM_KEY} ${m[1]}@${m[2].toLowerCase()}` };
}

/** `13h 0m` — minutes, never seconds: the clock is hours and a reader schedules the next knock from it. */
export function formatHoursMinutes(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The clock verdict: the knock's `created_at` against the SERVER's now, both
 * instants handed in — this function never reads a clock of its own. Pure.
 */
export function recheckAge({ createdAt, serverNow, hours = RECLAIM_AFTER_HOURS } = {}) {
  const created = Date.parse(createdAt);
  const now = Date.parse(serverNow);
  if (!Number.isFinite(created) || !Number.isFinite(now)) return { ok: false, error: `unreadable instant — knock \`${createdAt}\`, server \`${serverNow}\`` };
  const requiredMs = hours * 3_600_000;
  const ageMs = now - created;
  return { ok: true, ageMs, requiredMs, remainingMs: Math.max(0, requiredMs - ageMs), eligible: ageMs >= requiredMs };
}

/** The comments on the card that came AFTER the knock — anything here means the card was not silent. Pure. */
export function commentsAfter(comments, knock) {
  const at = Date.parse(knock?.created_at);
  // The same second is possible on a busy card: there the platform's id order is the order.
  return (Array.isArray(comments) ? comments : []).filter((c) => {
    if (c?.id === knock?.id) return false;
    const created = Date.parse(c?.created_at);
    return created > at || (created === at && Number(c?.id) > Number(knock?.id));
  });
}

/**
 * Why the operator's release text cannot be sent, or null. Judged by the
 * reader that OWNS the `Release:` line (`check-half-states`' marker, through
 * `markerMatches`), on the FIRST line alone — the state model's line-start key.
 * The `Resume-from:` line is this tool's to write, so a text carrying one is
 * refused rather than doubled. Pure.
 */
export function releaseTextRefusal(text) {
  const raw = String(text ?? '');
  if (raw.trim().length === 0) return 'the release comment is empty';
  const first = raw.split(/\r?\n/)[0];
  if (!markerMatches(RELEASE_COMMENT_MARKER, first)) {
    return `the release comment's FIRST line must be the \`Release:\` line (session / reason / destination) — the state model's line-start key — got \`${first.slice(0, 80)}\``;
  }
  if (raw.split(/\r?\n/).some((line) => /^\s*>?\s*\**\s*Resume-from\s*:/i.test(line))) {
    return `the release comment already carries a \`${RESUME_FROM_KEY}\` line; that line is written by this tool from --resume-from, so remove it from the file`;
  }
  return null;
}

/**
 * The release comment as sent: the operator's text, then the resume line and
 * the clock reading this tool measured, rendered through post-stamped's stamp
 * contract (`{{NOW}}` substituted, its refusals applied). Pure given the
 * instants.
 */
export function composeReleaseBody({ text, resume, knock, serverNow, age, nowMs } = {}) {
  // Both instants are READINGS taken off the board by this act, so they are
  // declared as `{{WAS:…}}` — the stamp contract's spelling for a quoted
  // clock — at seconds grain, beside whatever `{{NOW}}` the operator stamped.
  const seconds = (instant) => `${new Date(Date.parse(instant)).toISOString().slice(0, 19)}Z`;
  const provenance =
    `Released by \`label-write.mjs --release\`: re-check ${knock.id} ({{WAS:${seconds(knock.created_at)}}}) unanswered for ` +
    `${formatHoursMinutes(age.ageMs)} on the server clock {{WAS:${seconds(serverNow)}}}, at or past \`RECLAIM_AFTER_HOURS = ${RECLAIM_AFTER_HOURS}\`.`;
  const raw = `${String(text).replace(/\s+$/, '')}\n\n${resume.line}\n${provenance}`;
  return renderBody(raw, nowMs);
}

/**
 * The ONE stroke: the comment first, then the same additive verbs the direct
 * plan would issue. Every action names the card — a seat post is not here and
 * cannot be. Pure.
 */
export function releaseActions({ issue, body, labels, assignees } = {}) {
  return [relayAction({ mode: 'comment', number: issue }, body), ...relayActions({ issue, labels, assignees })];
}

// ---------------------------------------------------------------------------
// Transport — one shape for every call, so `classifyHttp` sees the same fields
// whatever went wrong. ⛔ Nothing here throws on an HTTP status: a refusal is
// an observation this tool routes on, not an exception it unwinds through.
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}) {
  // ⏱ The throttle (#19572), on the write verbs only. `paceWrite` reserves
  // this write's slot and sleeps the minimum gap; a spent budget or a live stop
  // marker refuses here and the request is never made.
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token: TOKEN, kind: `label-write ${method}` });
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    if (paced) releaseWriteLease(); // ⏱ rule ④: no response will come, so the fleet's turn ends here
    return { status: 0, rateRemaining: null, json: null, detail: e?.message ?? 'fetch threw', call: `${method} ${path}` };
  }
  const rateRemaining = res.headers.get('x-ratelimit-remaining');
  let json = null;
  if (res.status !== 204) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  // ⏱ …and the other half: a back-off signal in this answer writes the stop
  // marker every later write by this token is refused against. `classifyHttp`'s
  // own verdict is handed over rather than re-derived there.
  if (paced) {
    noteResponse({
      token: TOKEN,
      status: res.status,
      headers: res.headers,
      body: json,
      verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining) }),
    });
  }
  return {
    status: res.status,
    rateRemaining: rateRemaining === null ? null : Number(rateRemaining),
    json,
    detail: typeof json?.message === 'string' ? json.message : '',
    call: `${method} ${path}`,
    // The SERVER's clock, as this answer carried it — the only clock `--release` reads an age from.
    date: res.headers.get('date'),
  };
}

const enc = (s) => encodeURIComponent(s);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseOptions(argv) {
  const opts = {
    repo: null,
    issue: null,
    add: [],
    remove: [],
    assign: [],
    unassign: [],
    clearAssignees: false,
    allowTwoStates: false,
    dryRun: false,
    json: false,
    release: false,
    recheckComment: null,
    commentFile: null,
    resumeFrom: null,
  };
  const collect = { '--add': 'add', '--remove': 'remove', '--assign': 'assign', '--unassign': 'unassign' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const value = () => (inline === null ? argv[++i] : inline);

    if (flag === '--repo') opts.repo = value();
    else if (flag === '--issue') opts.issue = value();
    else if (collect[flag]) opts[collect[flag]].push(value() ?? '');
    else if (flag === '--clear-assignees') opts.clearAssignees = true;
    else if (flag === '--allow-two-states') opts.allowTwoStates = true;
    else if (flag === '--dry-run') opts.dryRun = true;
    else if (flag === '--json') opts.json = true;
    else if (flag === '--release') opts.release = true;
    else if (flag === '--recheck-comment') opts.recheckComment = value();
    else if (flag === '--comment-file') opts.commentFile = value();
    else if (flag === '--resume-from') opts.resumeFrom = value();
    else return { ok: false, error: `unrecognised option \`${flag}\`` };
  }

  opts.add = parseList(opts.add);
  opts.remove = parseList(opts.remove);
  opts.assign = parseList(opts.assign);
  opts.unassign = parseList(opts.unassign);

  if (opts.issue === null || opts.issue === undefined) return { ok: false, error: '--issue N is required' };
  const issue = Number(opts.issue);
  if (!Number.isInteger(issue) || issue <= 0) return { ok: false, error: `--issue must be a positive integer, got \`${opts.issue}\`` };
  opts.issue = issue;

  if (!opts.repo) opts.repo = resolveSweepRepo(process.env).repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { ok: false, error: `--repo must be owner/name, got \`${opts.repo}\`` };

  // ── `--release` owns its plan: the transition is fixed, so no label or assignee flag may ride beside it ──
  const releaseOnly = ['--recheck-comment', '--comment-file', '--resume-from'].filter((f, k) => [opts.recheckComment, opts.commentFile, opts.resumeFrom][k] !== null);
  if (!opts.release && releaseOnly.length) return { ok: false, error: `${releaseOnly.join(', ')} belong to --release and mean nothing without it` };
  if (opts.release) {
    if (opts.add.length || opts.remove.length || opts.assign.length || opts.unassign.length || opts.clearAssignees || opts.allowTwoStates) {
      return { ok: false, error: `--release writes exactly \`${RELEASE_FROM}\` → \`${RELEASE_TO}\` and clears every assignee; --add/--remove/--assign/--unassign/--clear-assignees/--allow-two-states are refused beside it` };
    }
    const knock = Number(opts.recheckComment);
    if (opts.recheckComment === null || !Number.isInteger(knock) || knock <= 0) {
      return { ok: false, error: `--release needs --recheck-comment ID, the owned-24h re-check comment's id — ⛔ no release without the knock, got \`${opts.recheckComment ?? '(absent)'}\`` };
    }
    opts.recheckComment = knock;
    if (!opts.commentFile) return { ok: false, error: '--release needs --comment-file PATH, the `Release:` comment with its three provenance items' };
    const resume = parseResumeFrom(opts.resumeFrom);
    if (opts.resumeFrom === null) return { ok: false, error: `--release needs --resume-from BRANCH@SHA (the claim's branch at its last pushed sha) or \`${RESUME_FROM_NONE}\`` };
    if (!resume.ok) return { ok: false, error: resume.error };
    opts.resume = resume;
    return { ok: true, options: opts };
  }

  const bothLabels = opts.add.filter((l) => opts.remove.includes(l));
  if (bothLabels.length) return { ok: false, error: `${render(bothLabels)} is in both --add and --remove; a write cannot mean both` };
  const bothUsers = opts.assign.filter((l) => opts.unassign.includes(l));
  if (bothUsers.length) return { ok: false, error: `${render(bothUsers)} is in both --assign and --unassign` };
  if (opts.clearAssignees && (opts.assign.length || opts.unassign.length)) {
    return { ok: false, error: '--clear-assignees cannot be combined with --assign/--unassign' };
  }
  if (!opts.add.length && !opts.remove.length && !opts.assign.length && !opts.unassign.length && !opts.clearAssignees) {
    return { ok: false, error: 'nothing to write — pass at least one of --add / --remove / --assign / --unassign / --clear-assignees' };
  }

  return { ok: true, options: opts };
}

const USAGE = [
  'label-write — the four-step label/assignee write (取现集 → 只增删目标 → 写合并集 → 回读 diff), as ONE spelling.',
  '',
  '  node scripts/pm/label-write.mjs --issue N [--repo OWNER/NAME] [--add a,b] [--remove c,d]',
  '                                  [--assign login] [--unassign login | --clear-assignees]',
  '                                  [--allow-two-states] [--dry-run] [--json]',
  '  node scripts/pm/label-write.mjs --issue N --release --recheck-comment ID --comment-file PATH',
  `                                  --resume-from BRANCH@SHA|${RESUME_FROM_NONE} [--repo OWNER/NAME] [--dry-run] [--json]`,
  '  node scripts/pm/label-write.mjs --self-test',
  '',
  `  --release reclaims a SILENT claim: ${RELEASE_FROM} → ${RELEASE_TO}, every assignee cleared, behind the \`Release:\``,
  `  comment in PATH — in ONE relay stroke, RELAY-ONLY. It refuses unless the owned-24h re-check ID (first line`,
  `  \`${RECHECK_COMMENT_KEY}\`) is on this card, is its NEWEST comment, and is at least RECLAIM_AFTER_HOURS=${RECLAIM_AFTER_HOURS} h old on`,
  '  the SERVER clock; a younger knock prints how long remains. BRANCH@SHA is checked against the branch tip and',
  `  against open pulls on that head, and is written as \`${RESUME_FROM_KEY} BRANCH@SHA\` for the next claimant.`,
  '',
  '  Additive `POST .../labels` and directed `DELETE .../labels/{name}` first — neither can strip a',
  '  label a concurrent seat wrote. A platform refusal falls back ONCE to `PATCH .../issues/{n}` with',
  '  the full target set AND the current assignees echoed, then reads back either way.',
  '  ⛔ Never `PUT .../labels` and ⛔ never MCP `issue_write` (lock 1 denies it).',
  '',
  '  OS_FLEET_TRANSPORT=direct|dispatch|auto (default auto): dispatch packs step ③ into ONE repository_dispatch the',
  '  fleet-write relay executes as objectstack-fleet[bot]; auto takes it in a cloud seat container (the seat\'s session is',
  "  read from the container's CLAUDE_CODE_REMOTE_SESSION_ID; OS_FLEET_SESSION overrides it — a local checkout, a test)",
  '  and direct elsewhere. Steps ①, ② and ④ are the same either way.',
  '',
  '  Exits: 0 landed+read-back · 2 usage · 3 prerequisite (no token/route, or rate-limit exhausted)',
  '         4 read-back disagrees with the target · 5 every channel refused · 6 dispatched but UNCONFIRMED.',
].join('\n');

// ---------------------------------------------------------------------------
// The four steps. `call` is injected so `--self-test` drives every branch —
// including the ones a live board cannot be made to produce on demand (a label
// stripped underneath, a channel that refuses one verb and accepts another).
// ---------------------------------------------------------------------------

const labelNamesOf = (raw) => (Array.isArray(raw) ? raw : []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const loginsOf = (raw) => (Array.isArray(raw) ? raw : []).map((a) => (typeof a === 'string' ? a : a?.login)).filter(Boolean);

export async function runLabelWrite(options, deps = {}) {
  const call = deps.call ?? rest;
  const send = deps.send ?? sendFleetWrite;
  const route = deps.route ?? (await resolveRoute(process.env));
  const clock = deps.now ?? (() => new Date());
  const emit = deps.log ?? ((line) => console.log(line));
  const lines = [];
  const stamp = () => stampNow(clock());
  const record = (line) => {
    lines.push(line);
    emit(line);
  };

  const { repo, issue } = options;
  const base = `/repos/${repo}/issues/${issue}`;
  const httpCalls = [];
  const result = (exit, extra = {}) => ({ exit, repo, issue, lines, httpCalls, ...extra });

  const doCall = async (op, path, init) => {
    const r = await call(path, init);
    const verdict = classifyHttp({ status: r.status, op, rateRemaining: r.rateRemaining });
    httpCalls.push({ op, call: r.call, status: r.status, verdict, detail: r.detail ?? '' });
    return { ...r, verdict };
  };

  // ── ① 取现集 ──────────────────────────────────────────────────────────────
  const read = await doCall('card-read', base, {});
  if (read.verdict !== 'ok') {
    record(`[${stamp()}] ① read — COULD NOT READ: ${read.call} -> HTTP ${read.status}${read.detail ? ` (${read.detail})` : ''}`);
    if (read.verdict === 'ratelimit' || read.verdict === 'prerequisite') {
      record(reportPrerequisite(read));
      return result(EXIT_PREREQUISITE, { stoppedAt: 1 });
    }
    record(
      `[${stamp()}] ⛔ NOTHING WAS WRITTEN. A ${read.status} on the card READ means this seat has no channel to ` +
        `${repo} at all (or the card number is wrong — the body above says which). ${HANDOFF}`,
    );
    return result(EXIT_PLATFORM_REFUSAL, { stoppedAt: 1 });
  }

  const currentLabels = labelNamesOf(read.json?.labels);
  const currentAssignees = loginsOf(read.json?.assignees);
  const state = read.json?.state ?? null;
  record(
    `[${stamp()}] ① 取现集 — ${repo}#${issue} (${state}) carries ${currentLabels.length} label(s): ${render(currentLabels)}` +
      ` · ${currentAssignees.length} assignee(s): ${render(currentAssignees)}`,
  );

  // ── ② 只增删目标 ──────────────────────────────────────────────────────────
  const labels = computeLabelTarget({ current: currentLabels, add: options.add, remove: options.remove });
  const assignees = computeAssigneeTarget({
    current: currentAssignees,
    assign: options.assign,
    unassign: options.unassign,
    clearAll: options.clearAssignees,
  });
  record(
    `[${stamp()}] ② 目标 labels — ${labels.target.length}: ${render(labels.target)}` +
      ` · POST ${render(labels.addCalls)} · DELETE ${render(labels.removeCalls)}` +
      ` · already present, no call ${render(labels.noopAdds)} · already absent, no call ${render(labels.noopRemoves)}`,
  );
  record(
    `[${stamp()}] ② 目标 assignees — ${assignees.target.length}: ${render(assignees.target)}` +
      ` · add ${render(assignees.addCalls)} · remove ${render(assignees.removeCalls)}`,
  );

  const residue = residueNote({ state, target: labels.target });
  if (residue) record(`[${stamp()}] ② note — ${residue}`);

  const twoStates = refuseTwoStates(labels.target);
  if (twoStates && !options.allowTwoStates) {
    record(`[${stamp()}] ② REFUSED — ${twoStates}`);
    record(`[${stamp()}] ⛔ NOTHING WAS WRITTEN.`);
    return result(EXIT_USAGE, { stoppedAt: 2, refusal: twoStates });
  }
  if (twoStates) record(`[${stamp()}] ② --allow-two-states — letting it through, declared: ${twoStates}`);

  const fallbackBody = patchFallbackBody({ labelTarget: labels.target, assigneeTarget: assignees.target });

  // ── the transport, said out loud before anything leaves ───────────────────
  if (route.error) {
    record(`[${stamp()}] ③ PREREQUISITE NOT MET — ${route.error}`);
    record(`[${stamp()}] ⛔ NOTHING WAS WRITTEN.`);
    return result(EXIT_PREREQUISITE, { stoppedAt: 3, labels, assignees, transport: route.transport });
  }
  record(`[${stamp()}] ③ transport ${route.transport} — ${route.reason}`);

  if (options.dryRun) {
    record(`[${stamp()}] ③ DRY RUN — no request made. The one fallback body, if every additive verb is refused: ${JSON.stringify(fallbackBody)}`);
    record(`[${stamp()}] ④ read-back SKIPPED — ⛔ a dry run proves the PLAN and never the board.`);
    return result(EXIT_OK, { dryRun: true, labels, assignees, fallbackBody });
  }

  // ── ③ 写合并集 — additive POST and directed DELETE first ──────────────────
  const plan = [];
  if (labels.addCalls.length) plan.push(['label-add', `${base}/labels`, { method: 'POST', body: { labels: labels.addCalls } }]);
  for (const name of labels.removeCalls) plan.push(['label-delete', `${base}/labels/${enc(name)}`, { method: 'DELETE' }]);
  if (assignees.addCalls.length) plan.push(['assignee-add', `${base}/assignees`, { method: 'POST', body: { assignees: assignees.addCalls } }]);
  if (assignees.removeCalls.length) plan.push(['assignee-remove', `${base}/assignees`, { method: 'DELETE', body: { assignees: assignees.removeCalls } }]);

  if (plan.length === 0) {
    record(`[${stamp()}] ③ 写 — 0 calls: the target already equals the current set. An idempotent no-op is a success, not a skip.`);
  }

  // ── ③ via the relay: the SAME verbs, packed into one dispatch ─────────────
  let stopReason = null;
  let relay = null;
  if (route.transport === 'dispatch' && plan.length > 0) {
    const actions = relayActions({ issue, labels, assignees });
    const packed = packRequest({ repo, session: route.session, actions });
    if (!packed.ok) {
      record(relayRefusalText(packed.errors));
      record(`[${stamp()}] ⛔ NOTHING WAS WRITTEN.`);
      return result(EXIT_USAGE, { stoppedAt: 3, labels, assignees, transport: route.transport });
    }
    record(`[${stamp()}] ③ 写 (relay) — ONE dispatch, request ${packed.payload.request_id}: ${actions.map((a) => a.op).join(' · ')}`);
    const sent = await send(packed.payload, { token: TOKEN, log: (line) => record(`      ${line}`) });
    httpCalls.push({ op: 'relay', call: `dispatch ${packed.payload.request_id}`, status: sent.status, verdict: sent.state, detail: sent.run?.url ?? sent.detail ?? '' });
    if (sent.ok) {
      relay = sent;
    } else if (sent.state === 'no-run' || sent.state === 'timeout') {
      // ⛔ Under EVERY transport request, `auto` included: the dispatch was accepted and may still run, so a direct
      // write here would be the same stroke booked against the seat's personal account — and possibly a second one.
      record(unconfirmedText(sent, 'label-write'));
      return result(EXIT_UNCONFIRMED, { stoppedAt: 3, labels, assignees, transport: route.transport, relay: sent });
    } else {
      record(`[${stamp()}] ③ relay ${sent.state === 'refused' ? 'REFUSED the dispatch' : 'run FAILED'} — ${sent.detail}${sent.run?.url ? ` ${sent.run.url}` : ''}. ⛔ Not retried and not fallen back: go READ the run and the card.`);
      return result(exitForResult(sent), { stoppedAt: 3, labels, assignees, transport: route.transport, relay: sent });
    }
  }

  // ── ③ direct: the additive verbs, one call each ───────────────────────────
  if (relay === null) {
    for (const [op, path, init] of plan) {
      const r = await doCall(op, path, init);
      record(`[${stamp()}] ③ 写 — ${r.call} -> HTTP ${r.status} (${r.verdict})${r.detail ? ` — ${r.detail}` : ''}`);
      if (r.verdict === 'ok') continue;
      if (r.verdict === 'idempotent') {
        record(`[${stamp()}] ③ …404 on a directed DELETE is the label already being gone. Idempotent success, ⛔ not a refusal.`);
        continue;
      }
      stopReason = r;
      break;
    }
  }

  if (stopReason?.verdict === 'ratelimit') {
    record(
      `[${stamp()}] ③ RATE-LIMIT EXHAUSTED (x-ratelimit-remaining 0). ⛔ NOT falling back: a rate-limit refusal binds ` +
        'the IDENTITY, every seat on this board shares it, and continuing the same write through another channel is ' +
        'the same act as retrying. Stop, let the window reset, and re-run this exact command.',
    );
    record(`[${stamp()}] ⛔ The board may be PARTIALLY written — the calls above say which landed. Re-running is safe: every step is idempotent.`);
    return result(EXIT_PREREQUISITE, { stoppedAt: 3, labels, assignees });
  }
  if (stopReason?.verdict === 'prerequisite') {
    record(reportPrerequisite(stopReason));
    return result(EXIT_PREREQUISITE, { stoppedAt: 3, labels, assignees });
  }

  let fallbackUsed = false;
  if (stopReason?.verdict === 'refusal') {
    fallbackUsed = true;
    record(
      `[${stamp()}] ③ fallback — the additive verb was REFUSED, so ONE whole-set \`PATCH ${base}\` with the full target ` +
        `AND the current assignees echoed back: ${JSON.stringify(fallbackBody)}`,
    );
    record(
      `[${stamp()}] ③ …the echo is not decoration: a whole-set card write CLEARS every field it does not pass, so a ` +
        'body carrying `labels` alone silently un-assigns the card. Step ④ below is the only detection this verb has.',
    );
    const patched = await doCall('card-patch', base, { method: 'PATCH', body: fallbackBody });
    record(`[${stamp()}] ③ fallback — ${patched.call} -> HTTP ${patched.status} (${patched.verdict})${patched.detail ? ` — ${patched.detail}` : ''}`);
    if (patched.verdict === 'ratelimit' || patched.verdict === 'prerequisite') {
      record(reportPrerequisite(patched));
      return result(EXIT_PREREQUISITE, { stoppedAt: 3, labels, assignees, fallbackUsed });
    }
    if (patched.verdict !== 'ok') {
      record(`[${stamp()}] ③ REFUSED ON EVERY CHANNEL — additive POST/DELETE and the whole-set PATCH both. ${HANDOFF}`);
      return result(EXIT_PLATFORM_REFUSAL, { stoppedAt: 3, labels, assignees, fallbackUsed });
    }
  } else if (stopReason) {
    record(
      `[${stamp()}] ③ stopped on an API error (HTTP ${stopReason.status}) — ⛔ not a channel refusal, so no fallback. ` +
        'Step ④ below reports what actually landed.',
    );
  }

  // ── ④ 回读 diff 对 union(现集, 增删) ───────────────────────────────────────
  const back = await doCall('card-read', base, {});
  if (back.verdict !== 'ok') {
    record(
      `[${stamp()}] ④ read-back — COULD NOT READ (${back.call} -> HTTP ${back.status}). ⛔ NOT MEASURED: the write above ` +
        'may or may not have landed, and a write nobody read back is exactly what the four steps exist to forbid. ' +
        'Re-run this command when the route is back — every step is idempotent.',
    );
    return result(EXIT_PREREQUISITE, { stoppedAt: 4, labels, assignees, fallbackUsed });
  }

  let backLabels = labelNamesOf(back.json?.labels);
  const backAssignees = loginsOf(back.json?.assignees);
  record(`[${stamp()}] ④ 回读 — ${backLabels.length} label(s): ${render(backLabels)} · ${backAssignees.length} assignee(s): ${render(backAssignees)}`);

  let verdict = readBackVerdict({ target: labels.target, removeCalls: labels.removeCalls, readBack: backLabels });
  let reAdded = [];
  if (verdict.missing.length) {
    reAdded = [...verdict.missing];
    record(
      `[${stamp()}] ④ STRIPPED UNDERNEATH — ${render(verdict.missing)} is in the target and missing from the read-back. ` +
        'A concurrent whole-set writer erased it inside this round trip (the measured window on PR #10698 was one second). ' +
        'Re-adding ONCE and REPORTING it — ⛔ this is a finding, not a retry loop.',
    );
    const again = await doCall('label-add', `${base}/labels`, { method: 'POST', body: { labels: verdict.missing } });
    record(`[${stamp()}] ④ re-add — ${again.call} -> HTTP ${again.status} (${again.verdict})`);
    const second = await doCall('card-read', base, {});
    if (second.verdict === 'ok') {
      backLabels = labelNamesOf(second.json?.labels);
      verdict = readBackVerdict({ target: labels.target, removeCalls: labels.removeCalls, readBack: backLabels });
      record(`[${stamp()}] ④ 回读 (2) — ${backLabels.length} label(s): ${render(backLabels)}`);
    } else {
      record(`[${stamp()}] ④ second read-back COULD NOT READ (HTTP ${second.status}) — the re-add is UNVERIFIED.`);
      return result(EXIT_READ_BACK_MISMATCH, { stoppedAt: 4, labels, assignees, fallbackUsed, reAdded, verdict });
    }
  }

  const assigneeVerdict = readBackVerdict({ target: assignees.target, removeCalls: assignees.removeCalls, readBack: backAssignees });
  if (verdict.concurrentAdds.length) {
    record(
      `[${stamp()}] ④ note — ${render(verdict.concurrentAdds)} is on the card and was never in this write's target. ` +
        '⛔ NOT a mismatch: preserving another seat\'s additive write is the entire reason POST/DELETE come first.',
    );
  }

  if (!verdictIsClean(verdict) || !verdictIsClean(assigneeVerdict)) {
    record(
      `[${stamp()}] ④ MISMATCH — labels missing ${render(verdict.missing)} · labels that survived removal ` +
        `${render(verdict.survivedRemoval)} · assignees missing ${render(assigneeVerdict.missing)} · assignees that ` +
        `survived removal ${render(assigneeVerdict.survivedRemoval)}. The board is in a state nobody asked for; ` +
        'fix it deliberately, ⛔ do not re-run this blind.',
    );
    return result(EXIT_READ_BACK_MISMATCH, { stoppedAt: 4, labels, assignees, fallbackUsed, reAdded, verdict, assigneeVerdict });
  }

  record(
    `[${stamp()}] ④ MATCHES the target — labels ${render(backLabels)} · assignees ${render(backAssignees)}` +
      `${fallbackUsed ? ' (via the whole-set PATCH fallback)' : ''}${relay ? ` (via the relay run ${relay.run?.url ?? relay.run?.id ?? ''})` : ''}${reAdded.length ? ` (after re-adding ${render(reAdded)})` : ''}.`,
  );
  return result(EXIT_OK, { labels, assignees, fallbackUsed, reAdded, verdict, assigneeVerdict, backLabels, backAssignees, transport: route.transport, relay });
}

/**
 * `--release`, end to end (header: `--release`). `deps` is how the self-test
 * drives every branch: `call` (the shape `rest` answers, `date` included),
 * `send`, `route`, `now` — THIS process's clock, read for stamps and for the
 * dispatch instant only, ⛔ never for the age — `readText` and `log`.
 */
export async function runRelease(options, deps = {}) {
  const call = deps.call ?? rest;
  const send = deps.send ?? sendFleetWrite;
  const route = deps.route ?? (await resolveRoute(process.env));
  const clock = deps.now ?? (() => new Date());
  const readText = deps.readText ?? ((p) => readFileSync(p, 'utf8'));
  const emit = deps.log ?? ((line) => console.log(line));
  const lines = [];
  const stamp = () => stampNow(clock());
  const record = (line) => {
    lines.push(line);
    emit(line);
  };

  const { repo, issue, recheckComment, resume } = options;
  const owner = repo.split('/')[0];
  const base = `/repos/${repo}/issues/${issue}`;
  const httpCalls = [];
  const result = (exit, extra = {}) => ({ exit, repo, issue, mode: 'release', lines, httpCalls, ...extra });
  const nothing = () => `[${stamp()}] ⛔ NOTHING WAS WRITTEN.`;
  const refuse = (why, extra = {}) => {
    record(`[${stamp()}] REFUSED — ${why}`);
    record(nothing());
    return result(EXIT_USAGE, { stoppedAt: 1, refusal: why, ...extra });
  };
  const doCall = async (op, path, init) => {
    const r = await call(path, init);
    const verdict = classifyHttp({ status: r.status, op, rateRemaining: r.rateRemaining, body: r.json });
    httpCalls.push({ op, call: r.call, status: r.status, verdict, detail: r.detail ?? '' });
    return { ...r, verdict };
  };
  const couldNotRead = (r, what) => {
    record(`[${stamp()}] ① read — COULD NOT READ ${what}: ${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
    if (r.verdict === 'ratelimit' || r.verdict === 'prerequisite') {
      record(reportPrerequisite(r));
      return result(EXIT_PREREQUISITE, { stoppedAt: 1 });
    }
    record(`[${stamp()}] ⛔ NOTHING WAS WRITTEN. A ${r.status} on a READ means this seat has no channel to ${repo} at all (or an id is wrong — the body above says which). ${HANDOFF}`);
    return result(EXIT_PLATFORM_REFUSAL, { stoppedAt: 1 });
  };

  // ── ① the card: open, owned, dispatched ───────────────────────────────────
  const read = await doCall('card-read', base, {});
  if (read.verdict !== 'ok') return couldNotRead(read, 'the card');
  const card = read.json ?? {};
  const currentLabels = labelNamesOf(card.labels);
  const currentAssignees = loginsOf(card.assignees);
  record(
    `[${stamp()}] ① 取现集 — ${repo}#${issue} (${card.state ?? '?'}) carries ${currentLabels.length} label(s): ${render(currentLabels)}` +
      ` · ${currentAssignees.length} assignee(s): ${render(currentAssignees)}`,
  );
  if (card.state !== 'open') return refuse(`${repo}#${issue} is \`${card.state ?? 'not open'}\` — a release moves an OPEN card out of a claim`);
  if (!currentLabels.includes(RELEASE_FROM)) return refuse(`${repo}#${issue} does not carry \`${RELEASE_FROM}\` — there is no claim state to release`);
  if (currentAssignees.length === 0) {
    return refuse(`${repo}#${issue} has no assignee — nobody holds it; a bare \`${RELEASE_FROM}\` is the half-state patrol's row, not a silent claim`);
  }

  // ── ① the knock, read with the SERVER's clock ─────────────────────────────
  const knockRead = await doCall('comment-read', `/repos/${repo}/issues/comments/${recheckComment}`, {});
  if (knockRead.status === 404) return refuse(`comment ${recheckComment} is not on ${repo} — --recheck-comment must name the owned-24h re-check on this card`);
  if (knockRead.verdict !== 'ok') return couldNotRead(knockRead, `the re-check comment ${recheckComment}`);
  const knock = knockRead.json ?? {};
  const issueUrl = String(knock.issue_url ?? '');
  if (!issueUrl.endsWith(`/issues/${issue}`)) return refuse(`comment ${recheckComment} belongs to \`${issueUrl || '(no issue_url)'}\`, not to ${repo}#${issue}`);
  if (!isRecheckComment(knock.body)) {
    return refuse(
      `comment ${recheckComment}'s first line is not \`${RECHECK_COMMENT_KEY}\` (it reads \`${firstLineKeyText(knock.body).slice(0, 60)}\`) — ` +
        '⛔ no release without the knock: a silent seat gets its one re-check first',
    );
  }
  const serverNowMs = Date.parse(knockRead.date ?? '');
  if (!Number.isFinite(serverNowMs)) {
    record(
      `[${stamp()}] ① PREREQUISITE NOT MET — the answer carrying the knock has no readable \`Date\` header (\`${knockRead.date ?? '(absent)'}\`); ` +
        "the age is measured on the SERVER's clock, ⛔ never this process's. NOT MEASURED.",
    );
    record(nothing());
    return result(EXIT_PREREQUISITE, { stoppedAt: 1, refusal: 'no-server-clock' });
  }
  const serverNow = new Date(serverNowMs).toISOString();
  const age = recheckAge({ createdAt: knock.created_at, serverNow });
  if (!age.ok) return refuse(age.error);
  record(
    `[${stamp()}] ① knock ${recheckComment} — \`${RECHECK_COMMENT_KEY}\` posted ${knock.created_at} · server clock ${serverNow} · ` +
      `age ${formatHoursMinutes(age.ageMs)} against RECLAIM_AFTER_HOURS = ${RECLAIM_AFTER_HOURS}`,
  );
  if (!age.eligible) {
    record(
      `[${stamp()}] REFUSED — the knock is too young: ${formatHoursMinutes(age.remainingMs)} remain before ${repo}#${issue} may be released ` +
        `(RECLAIM_AFTER_HOURS = ${RECLAIM_AFTER_HOURS}, on the server clock). Come back then.`,
    );
    record(nothing());
    return result(EXIT_USAGE, { stoppedAt: 1, refusal: 'too-young', remainingMs: age.remainingMs, age });
  }

  // ── ① silence: the knock is still the newest comment ──────────────────────
  const since = encodeURIComponent(knock.created_at);
  const tail = [];
  for (let page = 1; ; page++) {
    if (page > RELEASE_COMMENT_PAGE_CAP) {
      return refuse(`the comments since the knock are still full pages at the ${RELEASE_COMMENT_PAGE_CAP}-page cap — a thread nobody finished reading cannot be called silent`);
    }
    const r = await doCall('comments-list', `${base}/comments?since=${since}&per_page=100&page=${page}`, {});
    if (r.verdict !== 'ok') return couldNotRead(r, 'the comments since the knock');
    const rows = Array.isArray(r.json) ? r.json : [];
    tail.push(...rows);
    if (rows.length < 100) break;
  }
  const later = commentsAfter(tail, knock);
  if (later.length) {
    return refuse(
      `${later.length} comment(s) came after the knock (${later.map((c) => `${c.id} at ${c.created_at}`).join(', ')}) — the card is not silent. ` +
        'A seat reads them; if none is an answer, re-knock and come back after RECLAIM_AFTER_HOURS.',
    );
  }
  record(`[${stamp()}] ① silence — the knock is the newest comment on the card (${tail.length} comment(s) read since it, none later)`);

  // ── ① the branch the next claimant inherits ───────────────────────────────
  if (!resume.none) {
    const branch = await doCall('branch-read', `/repos/${repo}/branches/${enc(resume.branch)}`, {});
    if (branch.status === 404) {
      return refuse(`branch \`${resume.branch}\` is not on ${repo} — name the pushed branch, or \`--resume-from ${RESUME_FROM_NONE}\` when none was ever pushed`);
    }
    if (branch.verdict !== 'ok') return couldNotRead(branch, `branch ${resume.branch}`);
    const tip = String(branch.json?.commit?.sha ?? '').toLowerCase();
    if (!tip.startsWith(resume.sha)) {
      return refuse(`branch \`${resume.branch}\` is at \`${tip.slice(0, 12) || '(unreadable)'}\`, not at \`${resume.sha}\` — the resume line must name the tip the next claimant really inherits`);
    }
    const pulls = await doCall('pulls-list', `/repos/${repo}/pulls?state=open&head=${enc(`${owner}:${resume.branch}`)}&per_page=10`, {});
    if (pulls.verdict !== 'ok') return couldNotRead(pulls, `the open pulls on ${resume.branch}`);
    const open = Array.isArray(pulls.json) ? pulls.json : [];
    if (open.length) {
      return refuse(`branch \`${resume.branch}\` has ${open.length} OPEN pull request(s) (${open.map((p) => `#${p.number}`).join(', ')}) — the seat produced; a release is for silence, not for a PR in review`);
    }
    record(`[${stamp()}] ① resume — \`${resume.branch}\` is at \`${tip.slice(0, 12)}\` (matches ${resume.sha}) · 0 open pulls on that head`);
  } else {
    record(`[${stamp()}] ① resume — declared \`${RESUME_FROM_NONE}\`: no branch to inherit, the next claimant starts from main`);
  }

  // ── ② the target, and the comment ─────────────────────────────────────────
  const labels = computeLabelTarget({ current: currentLabels, add: [RELEASE_TO], remove: [RELEASE_FROM] });
  const assignees = computeAssigneeTarget({ current: currentAssignees, clearAll: true });
  record(`[${stamp()}] ② 目标 labels — ${labels.target.length}: ${render(labels.target)} · on ${render(labels.addCalls)} · off ${render(labels.removeCalls)}`);
  record(`[${stamp()}] ② 目标 assignees — none · off ${render(assignees.removeCalls)}`);
  const twoStates = refuseTwoStates(labels.target);
  if (twoStates) return refuse(`${twoStates} A release never takes --allow-two-states: fix the board first.`, { stoppedAt: 2 });

  let text;
  try {
    text = readText(options.commentFile);
  } catch (e) {
    return refuse(`cannot read --comment-file ${options.commentFile}: ${e?.message ?? e}`, { stoppedAt: 2 });
  }
  const why = releaseTextRefusal(text);
  if (why) return refuse(why, { stoppedAt: 2 });
  const rendered = composeReleaseBody({ text, resume, knock: { id: knock.id, created_at: knock.created_at }, serverNow, age, nowMs: clock().getTime() });
  if (!rendered.ok) {
    record(`[${stamp()}] REFUSED — ${rendered.error}`);
    record(nothing());
    return result(EXIT_USAGE, { stoppedAt: 2, refusal: rendered.kind });
  }
  const body = rendered.body;

  // ── ③ RELAY-ONLY: one dispatch, or nothing ────────────────────────────────
  if (route.error) {
    record(`[${stamp()}] ③ PREREQUISITE NOT MET — ${route.error}`);
    record(nothing());
    return result(EXIT_PREREQUISITE, { stoppedAt: 3, transport: route.transport });
  }
  if (route.transport !== 'dispatch') {
    record(
      `[${stamp()}] ③ PREREQUISITE NOT MET — a release is RELAY-ONLY: it lands as objectstack-fleet[bot] through ONE repository_dispatch or not at all, ` +
        `and this route resolved to \`${route.transport}\` (${route.reason}). ⛔ Never a direct write: a release booked under a personal login is the ` +
        'half-state this mode exists to end. Run it from a cloud seat container, or with OS_FLEET_TRANSPORT=dispatch against a live relay.',
    );
    record(nothing());
    return result(EXIT_PREREQUISITE, { stoppedAt: 3, transport: route.transport, refusal: 'relay-only' });
  }
  record(`[${stamp()}] ③ transport ${route.transport} — ${route.reason}`);
  const actions = releaseActions({ issue, body, labels, assignees });
  const packed = packRequest({ repo, session: route.session, actions, now: () => clock().getTime() });
  if (!packed.ok) {
    record(relayRefusalText(packed.errors));
    record(nothing());
    return result(EXIT_USAGE, { stoppedAt: 3, transport: route.transport });
  }
  record(`[${stamp()}] ③ 写 (relay) — ONE dispatch, request ${packed.payload.request_id}: ${actions.map((a) => a.op).join(' → ')}`);
  if (options.dryRun) {
    record(`[${stamp()}] ③ DRY RUN — nothing sent. Payload: ${JSON.stringify(packed.payload)}`);
    record(`[${stamp()}] ④ read-back SKIPPED — ⛔ a dry run proves the PLAN and never the board.`);
    return result(EXIT_OK, { dryRun: true, labels, assignees, payload: packed.payload, transport: route.transport });
  }
  const sentAt = clock().getTime();
  const sent = await send(packed.payload, { token: TOKEN, log: (line) => record(`      ${line}`) });
  httpCalls.push({ op: 'relay', call: `dispatch ${packed.payload.request_id}`, status: sent.status, verdict: sent.state, detail: sent.run?.url ?? sent.detail ?? '' });
  if (sent.state === 'no-run' || sent.state === 'timeout') {
    // ⛔ Under EVERY transport request: the stroke's first action is the Release: comment, so a replay of a
    // dispatch that may still run is a second release comment — and a direct one would be the personal login.
    record(unconfirmedText(sent, 'label-write --release'));
    return result(EXIT_UNCONFIRMED, { stoppedAt: 3, labels, assignees, transport: route.transport, relay: sent });
  }
  if (!sent.ok) {
    record(
      `[${stamp()}] ③ relay ${sent.state === 'refused' ? 'REFUSED the dispatch' : 'run FAILED'} — ${sent.detail}${sent.run?.url ? ` ${sent.run.url}` : ''}. ` +
        '⛔ Not retried and not fallen back: go READ the run and the card — the executor stops at its first failing action, so a failed run may have left the comment with no transition behind it.',
    );
    return result(exitForResult(sent), { stoppedAt: 3, labels, assignees, transport: route.transport, relay: sent });
  }

  // ── ④ 回读 — the board, never the run's word ──────────────────────────────
  const dispatchedAt = Number.isFinite(sent.dispatchedAt) ? sent.dispatchedAt : sentAt;
  const runRef = sent.run?.url ?? sent.run?.id ?? '';
  const back = await doCall('card-read', base, {});
  const sinceIso = encodeURIComponent(new Date(dispatchedAt - 60_000).toISOString());
  const tailRead = back.verdict === 'ok' ? await doCall('comments-list', `${base}/comments?since=${sinceIso}&per_page=100`, {}) : null;
  if (back.verdict !== 'ok' || tailRead.verdict !== 'ok') {
    const what = back.verdict !== 'ok' ? `${back.call} -> HTTP ${back.status}` : `${tailRead.call} -> HTTP ${tailRead.status}`;
    record(
      `[${stamp()}] ④ read-back — COULD NOT READ (${what}). The relay run ${runRef} completed with success, and ⛔ that is NOT a read-back: ` +
        'the release is NOT MEASURED. Go READ the card; ⛔ do not re-run blind.',
    );
    return result(EXIT_PREREQUISITE, { stoppedAt: 4, labels, assignees, relay: sent });
  }
  const backLabels = labelNamesOf(back.json?.labels);
  const backAssignees = loginsOf(back.json?.assignees);
  const hit = pickRelayComment(Array.isArray(tailRead.json) ? tailRead.json : [], body, dispatchedAt);
  const labelVerdict = readBackVerdict({ target: labels.target, removeCalls: labels.removeCalls, readBack: backLabels });
  const assigneeVerdict = readBackVerdict({ target: assignees.target, removeCalls: assignees.removeCalls, readBack: backAssignees });
  record(
    `[${stamp()}] ④ 回读 — ${backLabels.length} label(s): ${render(backLabels)} · ${backAssignees.length} assignee(s): ${render(backAssignees)} · ` +
      `release comment ${hit ? hit.id : 'NOT FOUND storing the body this run sent'}`,
  );
  if (labelVerdict.concurrentAdds.length) {
    record(`[${stamp()}] ④ note — ${render(labelVerdict.concurrentAdds)} is on the card and was never in this write's target. ⛔ NOT a mismatch: another seat's additive write.`);
  }
  if (!hit || !verdictIsClean(labelVerdict) || !verdictIsClean(assigneeVerdict)) {
    record(
      `[${stamp()}] ④ MISMATCH — comment ${hit ? 'landed' : 'MISSING'} · labels missing ${render(labelVerdict.missing)} · labels that survived removal ` +
        `${render(labelVerdict.survivedRemoval)} · assignees that survived removal ${render(assigneeVerdict.survivedRemoval)}. The relay run ${runRef} ` +
        'reported success and the board does not show the release whole. ⛔ Not repaired here — under the relay a re-add is a second write. Go READ the card and fix it deliberately.',
    );
    return result(EXIT_READ_BACK_MISMATCH, { stoppedAt: 4, labels, assignees, relay: sent, comment: hit?.id ?? null, labelVerdict, assigneeVerdict });
  }
  const said = commentReadBackVerdict({
    stamp: rendered.stamp,
    writtenAt: hit.created_at,
    sent: body,
    stored: hit.body,
    substituted: rendered.substituted,
    quoted: rendered.quoted,
    verbatim: rendered.verbatim,
    verbatimTokens: rendered.verbatimTokens,
  });
  for (const l of said.lines ?? []) record(`    ${String(l).trim()}`);
  record(`[${stamp()}] ④ MATCHES — released: labels ${render(backLabels)} · assignees none · comment ${hit.id} (via the relay run ${runRef}) · ${resume.line}`);
  return result(EXIT_OK, { labels, assignees, relay: sent, comment: hit.id, resume: resume.line, backLabels, backAssignees, transport: route.transport });
}

const HANDOFF =
  'A seat with no mutate channel does NOT invent one: hand the write to a seat that has one by filing a card in ' +
  'the target lane that names this card, this exact command and what it should produce. ⛔ Never MCP `issue_write` ' +
  '— lock 1 denies it in `.claude/settings.json`, and it was the whole-set replace this tool exists to avoid.';

function reportPrerequisite(r) {
  return (
    `PREREQUISITE NOT MET — ${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}.\n` +
    `  Fix:  run this where node's fetch reaches api.github.com with a token that can write issues (a GitHub\n` +
    `        Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs itself with that\n` +
    '        flag when HTTPS_PROXY is set).\n' +
    `  ⛔ NOT MEASURED. Exit ${EXIT_PREREQUISITE} is distinct from ${EXIT_PLATFORM_REFUSAL}'s "the platform refused\n` +
    '  every channel" and from 0. Capture it BEFORE any pipe.'
  );
}

// ---------------------------------------------------------------------------
// Self-test — offline, with a FAKE BOARD rather than a model of one.
//
// The fake implements the three verbs' real semantics, including the one that
// matters: `card-patch` REPLACES `labels` and `assignees` wholesale. A fake that
// merged instead would pass every assertion below while the echo this tool
// exists for went untested.
// ---------------------------------------------------------------------------

/** Which op a (method, path) pair is — the same routing the live path uses. */
export function classifyOp(method, path) {
  if (/\/issues\/comments\/\d+$/.test(path)) return 'comment-read';
  if (/\/issues\/\d+\/comments(\?|$)/.test(path)) return 'comments-list';
  if (/\/branches\//.test(path)) return 'branch-read';
  if (/\/pulls(\?|$)/.test(path)) return 'pulls-list';
  if (/\/labels\/[^/]+$/.test(path) && method === 'DELETE') return 'label-delete';
  if (/\/labels$/.test(path)) return 'label-add';
  if (/\/assignees$/.test(path)) return method === 'DELETE' ? 'assignee-remove' : 'assignee-add';
  if (method === 'PATCH') return 'card-patch';
  return 'card-read';
}

/**
 * A board with the three verbs' real semantics.
 *
 * `hooks` maps an op to a queue of canned responses (shift per call, then the
 * real behaviour resumes) — that is how a refusal, an exhausted quota and a
 * dead route get exercised without a network. `before` runs on every call and
 * is where a CONCURRENT seat's write is injected, which is the only way to
 * produce "stripped underneath" deterministically.
 *
 * For `--release` the board also carries the card's `comments` (paged for
 * real, honouring `since`), its `branches` (name → tip sha), its open `pulls`
 * (head ref) and a `serverNow` instant that every answer's `Date` header
 * reports — the clock the release reads an age from, which is deliberately
 * not this process's.
 */
export function fakeBoard(initial = {}) {
  const board = {
    number: initial.number ?? 7,
    state: initial.state ?? 'open',
    labels: [...(initial.labels ?? [])],
    assignees: [...(initial.assignees ?? [])],
    comments: [...(initial.comments ?? [])],
    branches: { ...(initial.branches ?? {}) },
    pulls: [...(initial.pulls ?? [])],
    serverNow: initial.serverNow ?? null,
  };
  const calls = [];
  const bodies = [];
  const hooks = new Map(Object.entries(initial.hooks ?? {}).map(([k, v]) => [k, [...v]]));
  const before = initial.before ?? (() => {});

  const call = async (path, init = {}) => {
    const method = init.method ?? 'GET';
    const op = classifyOp(method, path);
    calls.push({ op, method, path });
    if (init.body) bodies.push({ op, body: init.body });
    before(op, board, calls.length);

    const wrap = (status, json = null, rateRemaining = 5000) => ({
      status,
      json,
      rateRemaining,
      detail: typeof json?.message === 'string' ? json.message : '',
      call: `${method} ${path}`,
      date: board.serverNow === null ? null : new Date(board.serverNow).toUTCString(),
    });

    const queued = hooks.get(op);
    if (queued?.length) {
      const h = queued.shift();
      return wrap(h.status, h.json ?? { message: 'canned' }, h.rateRemaining ?? 5000);
    }

    if (op === 'comment-read') {
      const id = Number(path.slice(path.lastIndexOf('/') + 1));
      const c = board.comments.find((x) => x.id === id);
      if (!c) return wrap(404, { message: 'Not Found' });
      return wrap(200, { ...c, issue_url: `https://api.github.com/repos/o/r/issues/${c.issue ?? board.number}` });
    }
    if (op === 'comments-list') {
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
      const size = Number(query.get('per_page') ?? 100);
      const page = Number(query.get('page') ?? 1);
      const since = query.get('since') ? Date.parse(query.get('since')) : Number.NEGATIVE_INFINITY;
      const all = board.comments.filter((c) => Date.parse(c.updated_at ?? c.created_at) >= since);
      return wrap(200, all.slice((page - 1) * size, page * size));
    }
    if (op === 'branch-read') {
      const name = decodeURIComponent(path.slice(path.indexOf('/branches/') + '/branches/'.length));
      if (!(name in board.branches)) return wrap(404, { message: 'Branch not found' });
      return wrap(200, { name, commit: { sha: board.branches[name] } });
    }
    if (op === 'pulls-list') {
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
      const head = String(query.get('head') ?? '').split(':').slice(1).join(':');
      return wrap(200, board.pulls.filter((p) => p.head?.ref === head && (p.state ?? 'open') === (query.get('state') ?? 'open')));
    }

    if (op === 'card-read') {
      return wrap(200, {
        state: board.state,
        labels: board.labels.map((name) => ({ name })),
        assignees: board.assignees.map((login) => ({ login })),
      });
    }
    if (op === 'label-add') {
      board.labels = dedupe([...board.labels, ...(init.body?.labels ?? [])]);
      return wrap(200, board.labels.map((name) => ({ name })));
    }
    if (op === 'label-delete') {
      const name = decodeURIComponent(path.split('/labels/')[1]);
      if (!board.labels.includes(name)) return wrap(404, { message: 'Label does not exist' });
      board.labels = board.labels.filter((l) => l !== name);
      return wrap(200, board.labels.map((n) => ({ name: n })));
    }
    if (op === 'assignee-add') {
      board.assignees = dedupe([...board.assignees, ...(init.body?.assignees ?? [])]);
      return wrap(201, { assignees: board.assignees.map((login) => ({ login })) });
    }
    if (op === 'assignee-remove') {
      const drop = new Set(init.body?.assignees ?? []);
      board.assignees = board.assignees.filter((a) => !drop.has(a));
      return wrap(200, { assignees: board.assignees.map((login) => ({ login })) });
    }
    // card-patch — the DESTRUCTIVE one, modelled destructively on purpose.
    board.labels = dedupe(init.body?.labels ?? []);
    board.assignees = dedupe(init.body?.assignees ?? []);
    return wrap(200, {
      state: board.state,
      labels: board.labels.map((name) => ({ name })),
      assignees: board.assignees.map((login) => ({ login })),
    });
  };

  return { board, calls, bodies, call };
}

/** Drive the whole tool offline: parse, plan, write and read back against a fake board. */
const DIRECT_ROUTE = Object.freeze({ requested: 'direct', transport: 'direct', reason: 'self-test: direct', error: null, session: null });

/**
 * A fake relay: for `success` it applies the actions to THE SAME fake board
 * the run reads back from, the way the executor would on the real one, then
 * answers a completed run; the other outcomes answer the shapes
 * `sendFleetWrite` returns without touching the board.
 */
function fakeRelay(board, outcome = 'success', sent = []) {
  const RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed', conclusion: 'success' };
  let nextCommentId = 9000;
  return async (payload) => {
    sent.push(payload);
    const dispatchedAt = board.serverNow ?? Date.now();
    const base = { requestId: payload.request_id, startMs: 1, ceilingMs: 2, status: 204, verdict: 'ok', detail: '', dispatchedAt };
    if (outcome === 'no-run') return { ...base, state: 'no-run', ok: false, run: null, detail: 'no run appeared' };
    if (outcome === 'timeout') return { ...base, state: 'timeout', ok: false, run: { ...RUN, status: 'in_progress', conclusion: null } };
    if (outcome === 'failure') return { ...base, state: 'failure', ok: false, run: { ...RUN, conclusion: 'failure' }, detail: 'conclusion failure' };
    if (outcome === 'refused') return { ...base, state: 'refused', ok: false, status: 404, verdict: 'refusal', run: null, detail: 'Not Found' };
    // `lie`: the run says success and applies nothing — the read-back must catch it.
    for (const a of outcome === 'lie' ? [] : payload.actions) {
      if (a.op === 'comment') {
        const at = new Date(dispatchedAt).toISOString();
        board.comments.push({ id: ++nextCommentId, body: `${a.body}${PLATFORM_COMMENT_FOOTER}`, created_at: at, updated_at: at });
      }
      if (a.op === 'labels_add') board.labels = dedupe([...board.labels, ...a.labels]);
      if (a.op === 'labels_remove') board.labels = board.labels.filter((l) => !a.labels.includes(l));
      if (a.op === 'assign') board.assignees = dedupe([...board.assignees, ...a.assignees]);
      if (a.op === 'unassign') board.assignees = board.assignees.filter((u) => !a.assignees.includes(u));
    }
    return { ...base, state: 'success', ok: true, run: RUN, detail: 'conclusion success' };
  };
}

async function driveOffline(argv, boardInit = {}, extra = {}) {
  const fake = fakeBoard(boardInit);
  const parsed = parseOptions(argv);
  if (!parsed.ok) return { parsed, exit: EXIT_USAGE, fake, out: [] };
  const out = [];
  const sent = [];
  const send = extra.send ?? (extra.relay ? fakeRelay(fake.board, extra.relay, sent) : undefined);
  const res = await runLabelWrite(parsed.options, { call: fake.call, log: (l) => out.push(l), route: extra.route ?? DIRECT_ROUTE, send });
  return { parsed, exit: res.exit, res, fake, out, sent, text: out.join('\n') };
}

// ── the two fixture cards the protocol names, and the drive for `--release` ──
const KNOCK_AT = '2026-10-06T16:28:44Z';
const CLAIM_AT = '2026-10-05T16:25:00Z';
const hoursAfterKnock = (h) => Date.parse(KNOCK_AT) + h * 3_600_000;
const RELEASE_BRANCH = 'claude/issue-7-silent';
const RELEASE_TIP = 'abcdef1234567890abcdef1234567890abcdef12';
const RELEASE_FILE = '/tmp/self-test/release.md';
const RELEASE_TEXT =
  'Release: session `session_01TRIAGE000000000000000000` · reason: a silent claim — the owned-24h re-check 200 has had no answer · destination `pm:queue`\n\n' +
  'Provenance, three items: the triage duties text (the reclaim clock); verbatim 「敲门后 `RECLAIM_AFTER_HOURS = 12` 小时无答复 ⇒ 一笔中继释放」; said in `triage-duties.md`. Stamped {{NOW}}.';
/** A silent card: claimed, knocked ~24 h later, nothing since. `serverNow` is what the fixture varies. */
const silentCard = (serverNowHoursAfterKnock, extra = {}) => ({
  number: 7,
  labels: ['pm:dispatched', 'domain:skills', 'priority:p1', 'tooling'],
  assignees: ['os-tesla'],
  comments: [
    { id: 100, body: 'Claim: PM loop round 1\nSession: `session_01HOLDER00000000000000000`\nBranch: `claude/issue-7-silent`', created_at: CLAIM_AT, updated_at: CLAIM_AT },
    { id: 200, body: '## Owned-24h re-check: the claim is over 24 h old, the branch has had no commit for about 24 h, and no PR is open\n\nTriage seat · one line, please.', created_at: KNOCK_AT, updated_at: KNOCK_AT },
  ],
  branches: { [RELEASE_BRANCH]: RELEASE_TIP },
  pulls: [],
  serverNow: hoursAfterKnock(serverNowHoursAfterKnock),
  ...extra,
});
const RELEASE_ARGV = ['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--release', '--recheck-comment', '200', '--comment-file', RELEASE_FILE, '--resume-from', `${RELEASE_BRANCH}@abcdef1234`];

async function driveRelease(argv, boardInit, extra = {}) {
  const fake = fakeBoard(boardInit);
  const parsed = parseOptions(argv);
  if (!parsed.ok) return { parsed, exit: EXIT_USAGE, fake, out: [], sent: [], text: '' };
  const out = [];
  const sent = [];
  const send = extra.send ?? fakeRelay(fake.board, extra.relay ?? 'success', sent);
  const files = { [RELEASE_FILE]: RELEASE_TEXT, ...(extra.files ?? {}) };
  const res = await runRelease(parsed.options, {
    call: fake.call,
    log: (l) => out.push(l),
    route: extra.route ?? { requested: 'auto', transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: 'session_01ABCDEFGHJKMNPQRSTVWXYZ' },
    send,
    // THIS process's clock — deliberately far from the server's, so a release that read it would be caught.
    now: extra.now ?? (() => new Date(Date.UTC(2030, 0, 1))),
    readText: (p) => {
      if (p in files) return files[p];
      throw new Error(`ENOENT: no such file, open '${p}'`);
    },
  });
  const direct = fake.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
  return { parsed, exit: res.exit, res, fake, out, sent, direct, text: out.join('\n') };
}

/**
 * The no-run conformance probe — `fleet-write/dispatch.mjs`'s header names the
 * contract and its self-test drives it: ONE stroke (an add) through this tool's
 * real write path against the offline fake board, on the route and the sender
 * the conformance hands in. Answers the exit, every request that left this
 * process directly (`METHOD /path`), and what the tool printed.
 */
export async function relayMissProbe({ route, send }) {
  const run = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route, send });
  return { exit: run.exit, calls: run.fake.calls.map((c) => `${c.method} ${c.path}`), text: run.text };
}

// The battery ledger this self-test's floor is evaluated against. A battery
// that stops registering cases is the bug; a pinned TOTAL would hide it the
// moment a sibling battery grows (#13489, the shape post-stamped.mjs carries).
const SELF_TEST_BATTERIES = Object.freeze({
  'the re-exec guard: the name this tool sets, and the patrol name that must not silence it': 11,
  'the arithmetic: union, difference, and the two idempotent no-ops': 12,
  'the ONE-OF refusal, and the one declared exception': 6,
  'the read-back verdict: three buckets, three different meanings': 7,
  'the classifier: a 404 that is success, and a 403 that must not fall back': 12,
  'the four steps, end to end against a fake board': 10,
  'the fallback: one PATCH, and the assignee echo that makes it survivable': 7,
  'the remaining exits: refusal, mismatch, the ONE-OF block and the dry run': 5,
  'the CLI: what a typo must never be allowed to mean': 8,
  'the relay transport: ONE dispatch carrying the whole stroke, the same read-back, and an accepted dispatch with no run UNCONFIRMED under auto too — never a direct write': 14,
  'the release: a silent claim reclaimed in ONE relay stroke — Release: comment → pm:queue on → pm:dispatched off → unassign — on the knock\'s SERVER-clock age, RELAY-ONLY, never a direct write': 30,
});
const SELF_TEST_BATTERY_FLOOR = 11;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };

  // ── the arithmetic ────────────────────────────────────────────────────────
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

  battery('the arithmetic: union, difference, and the two idempotent no-ops');
  const a1 = computeLabelTarget({ current: ['x', 'pm:queue'], add: ['pm:dispatched'], remove: ['pm:queue'] });
  t('target = (current ∪ add) − remove', a1.target, ['x', 'pm:dispatched']);
  t('…one POST carries every add', a1.addCalls, ['pm:dispatched']);
  t('…one directed DELETE per removal actually present', a1.removeCalls, ['pm:queue']);
  const a2 = computeLabelTarget({ current: ['domain:skills'], add: ['domain:skills'] });
  t('re-adding a label the card already carries issues NO call', a2.addCalls, []);
  t('…is reported as an idempotent no-op, not dropped silently', a2.noopAdds, ['domain:skills']);
  t('…and leaves the target equal to the current set', a2.target, ['domain:skills']);
  const a3 = computeLabelTarget({ current: ['a'], remove: ['gone'] });
  t('removing a label the card no longer carries issues NO call', a3.removeCalls, []);
  t('…and is reported as an idempotent no-op', a3.noopRemoves, ['gone']);
  t('a label named twice is one label', computeLabelTarget({ current: ['a', 'a'], add: ['b', 'b'] }).target, ['a', 'b']);
  const as1 = computeAssigneeTarget({ current: ['pm'], assign: ['dev'], unassign: ['pm'] });
  t('assignees take the same arithmetic', as1.target, ['dev']);
  t('--clear-assignees empties the target', computeAssigneeTarget({ current: ['a', 'b'], clearAll: true }).target, []);
  t('…and removes every one of them by name', computeAssigneeTarget({ current: ['a', 'b'], clearAll: true }).removeCalls, ['a', 'b']);

  // ── the ONE-OF refusal ────────────────────────────────────────────────────
  battery('the ONE-OF refusal, and the one declared exception');
  t('one state label is a position, not a contradiction', refuseTwoStates(['pm:dispatched', 'domain:skills']), null);
  const two = refuseTwoStates(['pm:queue', 'pm:dispatched']);
  t('two ONE-OF states are REFUSED', typeof two === 'string' && two.length > 0);
  t('…and the refusal names what each one claims, not just that two are present', two.includes(PM_STATE_CLAIM['pm:queue']) && two.includes(PM_STATE_CLAIM['pm:dispatched']));
  t('…needs-user-decision is one of the states, not a side label', typeof refuseTwoStates(['needs-user-decision', 'pm:blocked']) === 'string');
  t('the vocabulary is IMPORTED, never restated here', PM_EXCLUSIVE_STATE_LABELS.length, 6);
  t('a closed card carrying in-flight residue is NOTED, never blocked', typeof residueNote({ state: 'closed', target: ['pm:dispatched'] }), 'string');

  // ── the read-back verdict ────────────────────────────────────────────────
  battery('the read-back verdict: three buckets, three different meanings');
  const v1 = readBackVerdict({ target: ['a', 'b'], removeCalls: ['c'], readBack: ['a', 'b'] });
  t('a read-back equal to the target is clean', verdictIsClean(v1));
  const v2 = readBackVerdict({ target: ['a', 'b'], removeCalls: [], readBack: ['a'] });
  t('a target label absent from the read-back was STRIPPED UNDERNEATH', v2.missing, ['b']);
  t('…and that is a mismatch', verdictIsClean(v2), false);
  const v3 = readBackVerdict({ target: ['a'], removeCalls: ['c'], readBack: ['a', 'c'] });
  t('a label asked to be removed that is still there is a mismatch', v3.survivedRemoval, ['c']);
  const v4 = readBackVerdict({ target: ['a'], removeCalls: [], readBack: ['a', 'size/l'] });
  t("another seat's additive label is REPORTED", v4.concurrentAdds, ['size/l']);
  t('…and is ⛔ NOT a mismatch — preserving it is why POST/DELETE come first', verdictIsClean(v4));
  t('the three buckets are disjoint', [v3.missing, v3.survivedRemoval, v3.concurrentAdds], [[], ['c'], []]);

  // ── the classifier ───────────────────────────────────────────────────────
  battery('the classifier: a 404 that is success, and a 403 that must not fall back');
  t('200/201/204 are success', [classifyHttp({ status: 200 }), classifyHttp({ status: 201 }), classifyHttp({ status: 204 })], ['ok', 'ok', 'ok']);
  t('a 404 on a DIRECTED DELETE is the label already being gone', classifyHttp({ status: 404, op: 'label-delete' }), 'idempotent');
  t('…the same 404 on any other op is a refused path', classifyHttp({ status: 404, op: 'label-add' }), 'refusal');
  t('403 and 405 are platform refusals', [classifyHttp({ status: 403, op: 'label-add', rateRemaining: 4000 }), classifyHttp({ status: 405, op: 'label-add' })], ['refusal', 'refusal']);
  t('a 403 with the quota EXHAUSTED is rate-limit, ⛔ not a shut channel', classifyHttp({ status: 403, op: 'label-add', rateRemaining: 0 }), 'ratelimit');
  t('…and so is a 429', classifyHttp({ status: 429, op: 'label-add', rateRemaining: 0 }), 'ratelimit');
  t('401/407 are the credential or the route', [classifyHttp({ status: 401 }), classifyHttp({ status: 407 })], ['prerequisite', 'prerequisite']);
  t('a thrown fetch (status 0) is the route', classifyHttp({ status: 0 }), 'prerequisite');
  t('a 422 is an API error, neither a refusal nor a success', classifyHttp({ status: 422, op: 'label-add' }), 'error');
  const PROXY_403 = { message: 'Access to this GitHub API path is not permitted through this proxy.', documentation_url: 'https://docs.anthropic.com/en/docs/claude-code/github-actions' };
  t("⭐ a 403 whose body is the egress PROXY's (measured shape) is the ROUTE — prerequisite — ⛔ never a rate limit, whatever the header says", [classifyHttp({ status: 403, op: 'label-add', body: PROXY_403 }), classifyHttp({ status: 403, op: 'label-add', rateRemaining: null, body: PROXY_403 })], ['prerequisite', 'prerequisite']);
  t('⛔ a 403 with NO rate header is a refusal, not exhaustion: an absent header is not a zero', [classifyHttp({ status: 403, op: 'label-add' }), classifyHttp({ status: 403, op: 'label-add', rateRemaining: null }), classifyHttp({ status: 403, op: 'label-add', rateRemaining: '' })], ['refusal', 'refusal', 'refusal']);
  t('…while a 429 is a rate limit with or without the header, and a 403 with the header at 0 still is', [classifyHttp({ status: 429 }), classifyHttp({ status: 403, rateRemaining: '0' })], ['ratelimit', 'ratelimit']);

  // ── the four steps, end to end ───────────────────────────────────────────
  battery('the four steps, end to end against a fake board');
  const clean = await driveOffline(
    ['--repo', 'o/r', '--issue', '7', '--add', 'pm:dispatched', '--remove', 'pm:queue'],
    { labels: ['pm:queue', 'domain:skills'], assignees: ['pm'] },
  );
  t('a transition written as a REPLACE lands and reads back', clean.exit, EXIT_OK);
  t('…through the two non-destructive verbs only', clean.fake.calls.map((c) => c.op), ['card-read', 'label-add', 'label-delete', 'card-read']);
  t('…leaving the board at the target', clean.fake.board.labels, ['domain:skills', 'pm:dispatched']);
  t('…and the assignees untouched', clean.fake.board.assignees, ['pm']);

  const noop = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'domain:skills'], { labels: ['domain:skills'] });
  t('an idempotent no-op makes ZERO write calls', noop.fake.calls.map((c) => c.op), ['card-read', 'card-read']);
  t('…and is a success, not a skip', noop.exit, EXIT_OK);

  // The label is there at step ① and gone by step ③ — the race the directed
  // DELETE is supposed to survive. It cannot be produced any other way.
  const raced = await driveOffline(['--repo', 'o/r', '--issue', '7', '--remove', 'pm:queue'], {
    labels: ['pm:queue'],
    before: (op, board) => {
      if (op === 'label-delete') board.labels = board.labels.filter((l) => l !== 'pm:queue');
    },
  });
  t('a DELETE of a label the card no longer carries reads as SUCCESS', raced.exit, EXIT_OK);
  t('…named as idempotent in the transcript, ⛔ never as a refusal', raced.text.includes('Idempotent success'));

  const stripped = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'skip-changeset'], {
    labels: ['size/l'],
    before: (op, board, n) => {
      // A size labeler's whole-set write, one call after ours — PR #10698's shape.
      if (op === 'card-read' && n === 3) board.labels = ['size/l'];
    },
  });
  t('a label stripped underneath is re-added ONCE and the run still passes', stripped.exit, EXIT_OK);
  t('…and the strip is REPORTED, never silently repaired', stripped.text.includes('STRIPPED UNDERNEATH'));

  // ── the fallback ─────────────────────────────────────────────────────────
  battery('the fallback: one PATCH, and the assignee echo that makes it survivable');
  const fell = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'pm:dispatched'], {
    labels: ['domain:skills'],
    assignees: ['os-project-manager'],
    hooks: { 'label-add': [{ status: 403, json: { message: 'Resource not accessible' } }] },
  });
  t('a refused additive verb falls back to the whole-set PATCH and lands', fell.exit, EXIT_OK);
  t('…exactly ONCE', fell.fake.calls.filter((c) => c.op === 'card-patch').length, 1);
  const patchBody = fell.fake.bodies.find((b) => b.op === 'card-patch')?.body;
  t('…carrying the FULL target label set', patchBody?.labels, ['domain:skills', 'pm:dispatched']);
  t('…and ECHOING the current assignees, which a labels-only body would clear', patchBody?.assignees, ['os-project-manager']);
  t('…so the assignee survives the destructive verb', fell.fake.board.assignees, ['os-project-manager']);
  t('the echo is in the pure body builder, so it cannot be forgotten at a call site', patchFallbackBody({ labelTarget: ['a'], assigneeTarget: ['b'] }), { labels: ['a'], assignees: ['b'] });

  const exhausted = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'x'], {
    labels: [],
    hooks: { 'label-add': [{ status: 403, rateRemaining: 0, json: { message: 'API rate limit exceeded' } }] },
  });
  t('a RATE-LIMIT refusal ⛔ never reaches the fallback', [exhausted.exit, exhausted.fake.calls.some((c) => c.op === 'card-patch')], [EXIT_PREREQUISITE, false]);

  // ── the remaining exits ──────────────────────────────────────────────────
  battery('the remaining exits: refusal, mismatch, the ONE-OF block and the dry run');
  const refusedEverywhere = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'x'], {
    hooks: { 'label-add': [{ status: 403 }], 'card-patch': [{ status: 403 }] },
  });
  t('every channel refused is exit 5, with the hand-off named', [refusedEverywhere.exit, refusedEverywhere.text.includes('Never MCP `issue_write`')], [EXIT_PLATFORM_REFUSAL, true]);

  const mismatch = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'x'], {
    labels: [],
    // The label never survives: stripped before the first read-back AND before the second.
    before: (op, board) => {
      if (op === 'card-read') board.labels = board.labels.filter((l) => l !== 'x');
    },
  });
  t('a read-back that still disagrees after the one re-add is exit 4', mismatch.exit, EXIT_READ_BACK_MISMATCH);

  const twoStateRun = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'pm:dispatched'], { labels: ['pm:queue'] });
  t('a write that would leave two ONE-OF states is refused BEFORE any write', [twoStateRun.exit, twoStateRun.fake.calls.map((c) => c.op)], [EXIT_USAGE, ['card-read']]);
  const allowed = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'pm:dispatched', '--allow-two-states'], { labels: ['pm:queue'] });
  t('…and --allow-two-states is the declared exception, which still says what it let through', [allowed.exit, allowed.text.includes('--allow-two-states')], [EXIT_OK, true]);

  const dry = await driveOffline(['--repo', 'o/r', '--issue', '7', '--add', 'x', '--dry-run'], { labels: [] });
  t('a dry run writes nothing and says the board was never read back', [dry.exit, dry.fake.calls.map((c) => c.op), dry.text.includes('never the board')], [EXIT_OK, ['card-read'], true]);

  // ── the CLI ──────────────────────────────────────────────────────────────
  battery('the CLI: what a typo must never be allowed to mean');
  t('a missing --issue is usage', parseOptions(['--add', 'x']).ok, false);
  t('a non-numeric --issue is usage, ⛔ never card 0', parseOptions(['--issue', 'eighteen', '--add', 'x']).ok, false);
  t('an unrecognised flag is usage, ⛔ never ignored', parseOptions(['--issue', '7', '--add', 'x', '--forse']).ok, false);
  t('a write with nothing to write is usage', parseOptions(['--issue', '7']).ok, false);
  t('one label in both --add and --remove is usage', parseOptions(['--issue', '7', '--add', 'x', '--remove', 'x']).ok, false);
  t('--clear-assignees with --assign is usage', parseOptions(['--issue', '7', '--clear-assignees', '--assign', 'me']).ok, false);
  t('--add is repeatable AND comma-separated', parseOptions(['--issue', '7', '--add', 'a,b', '--add=c']).options.add, ['a', 'b', 'c']);
  t('--repo defaults to this board, never to a sibling', parseOptions(['--issue', '7', '--add', 'x']).options.repo, resolveSweepRepo(process.env).repo);

  // ── the relay transport ──────────────────────────────────────────────────
  battery('the relay transport: ONE dispatch carrying the whole stroke, the same read-back, and an accepted dispatch with no run UNCONFIRMED under auto too — never a direct write');
  {
    const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
    const dispatchRoute = (requested = 'dispatch') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SESSION });
    t('the stroke packs the SAME verbs in the SAME order as the direct plan', relayActions({ issue: 7, labels: computeLabelTarget({ current: ['pm:queue'], add: ['pm:dispatched'], remove: ['pm:queue'] }), assignees: computeAssigneeTarget({ current: [], assign: ['dev'] }) }), [
      { op: 'labels_add', issue: 7, labels: ['pm:dispatched'] },
      { op: 'labels_remove', issue: 7, labels: ['pm:queue'] },
      { op: 'assign', issue: 7, assignees: ['dev'] },
    ]);
    const init = { labels: ['pm:queue', 'domain:skills'], assignees: ['pm'] };
    const viaRelay = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'pm:dispatched', '--remove', 'pm:queue', '--assign', 'dev'], init, { route: dispatchRoute(), relay: 'success' });
    t('under dispatch the write lands through the relay and reads back at the target, exit 0', [viaRelay.exit, viaRelay.text.includes('via the relay run'), viaRelay.fake.board.labels, viaRelay.fake.board.assignees], [EXIT_OK, true, ['domain:skills', 'pm:dispatched'], ['pm', 'dev']]);
    t('…and the ONLY calls this process made were the two reads — no additive verb left directly', viaRelay.fake.calls.map((c) => c.op), ['card-read', 'card-read']);
    t('the payload carries the session, the target repo and the three actions of this ONE write', [viaRelay.sent.length, viaRelay.sent[0].session, viaRelay.sent[0].repo, viaRelay.sent[0].actions.map((a) => a.op)], [1, SESSION, 'objectstack-ai/objectstack', ['labels_add', 'labels_remove', 'assign']]);
    const noop = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'domain:skills'], { labels: ['domain:skills'] }, { route: dispatchRoute(), send: async () => { throw new Error('a no-op must not dispatch'); } });
    t('an idempotent no-op dispatches NOTHING under the relay either', [noop.exit, noop.fake.calls.map((c) => c.op)], [EXIT_OK, ['card-read', 'card-read']]);
    const timedOut = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route: dispatchRoute(), relay: 'timeout' });
    t('a run that did not complete within the ceiling is exit 6 UNCONFIRMED with the run url, no read-back, no retry', [timedOut.exit, timedOut.text.includes('UNCONFIRMED') && timedOut.text.includes('https://github.test/run/42'), timedOut.fake.calls.length], [EXIT_UNCONFIRMED, true, 1]);
    const noRunExplicit = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route: dispatchRoute('dispatch'), relay: 'no-run' });
    t('under an EXPLICIT dispatch, no run is exit 6 — no fall-back', [noRunExplicit.exit, noRunExplicit.fake.calls.map((c) => c.op)], [EXIT_UNCONFIRMED, ['card-read']]);
    const noRunAuto = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route: dispatchRoute('auto'), relay: 'no-run' });
    t('⛔ under AUTO, an accepted dispatch with no run is exit 6 UNCONFIRMED too — ONE dispatch, and ZERO direct calls after it: the pre-read alone, no POST, no DELETE, no read-back', [noRunAuto.exit, noRunAuto.sent.length, noRunAuto.fake.calls.map((c) => `${c.method} ${c.path}`)], [EXIT_UNCONFIRMED, 1, ['GET /repos/objectstack-ai/objectstack/issues/7']]);
    t('…the answer an EXPLICIT dispatch gives, in the shared UNCONFIRMED sentence (go READ, never re-run blind)', [noRunAuto.exit === noRunExplicit.exit, noRunAuto.res.relay ? noRunAuto.text.includes(unconfirmedText(noRunAuto.res.relay, 'label-write')) : false], [true, true]);
    const failedRun = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route: dispatchRoute('auto'), relay: 'failure' });
    t('⛔ a run that FAILED is never fallen back from, even under auto: exit 5, no direct write', [failedRun.exit, failedRun.fake.calls.map((c) => c.op)], [EXIT_PLATFORM_REFUSAL, ['card-read']]);
    const refusedDispatch = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route: dispatchRoute('auto'), relay: 'refused' });
    t('a refused dispatch (404) is exit 5 — the platform refused, nothing ran', refusedDispatch.exit, EXIT_PLATFORM_REFUSAL);
    const badRoute = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x'], { labels: [] }, { route: { requested: 'dispatch', transport: 'dispatch', reason: '', error: 'OS_FLEET_SESSION is absent', session: null } });
    t('a route with an error (no session in dispatch mode) is exit 3 before any write', [badRoute.exit, badRoute.fake.calls.map((c) => c.op)], [EXIT_PREREQUISITE, ['card-read']]);
    t('the transport is printed on every run, direct included', clean.text.includes('③ transport direct'));
    const dryRelay = await driveOffline(['--repo', 'objectstack-ai/objectstack', '--issue', '7', '--add', 'x', '--dry-run'], { labels: [] }, { route: dispatchRoute(), send: async () => { throw new Error('a dry run must not dispatch'); } });
    t('a dry run under dispatch names the transport and sends nothing', [dryRelay.exit, dryRelay.text.includes('③ transport dispatch')], [EXIT_OK, true]);
  }

  // ── the release ──────────────────────────────────────────────────────────
  battery("the release: a silent claim reclaimed in ONE relay stroke — Release: comment → pm:queue on → pm:dispatched off → unassign — on the knock's SERVER-clock age, RELAY-ONLY, never a direct write");
  {
    const dispatchRoute = (requested = 'auto') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: 'session_01ABCDEFGHJKMNPQRSTVWXYZ' });
    // The text half: the constant's NAME and VALUE are spelled in the protocol text this tool implements.
    const protocol = readFileSync(new URL(RECLAIM_TEXT_PATH, REPO_ROOT), 'utf8');
    t(`the protocol text (${RECLAIM_TEXT_PATH}) spells \`RECLAIM_AFTER_HOURS = ${RECLAIM_AFTER_HOURS}\` — the clock has ONE value in two places, pinned equal`, protocol.includes(`\`RECLAIM_AFTER_HOURS = ${RECLAIM_AFTER_HOURS}\``));
    t('…and names the knock by the same first-line key this tool recognises', protocol.includes(`\`${RECHECK_COMMENT_KEY}\``));
    t('the transition is spelled from the imported ONE-OF vocabulary, both ends', [PM_EXCLUSIVE_STATE_LABELS.includes(RELEASE_FROM), PM_EXCLUSIVE_STATE_LABELS.includes(RELEASE_TO)], [true, true]);

    // The pure core.
    t('the knock is recognised by its first line after heading marks', [isRecheckComment('## Owned-24h re-check: over 24 h'), isRecheckComment('Owned-24h re-check: x'), isRecheckComment('> ## Owned-24h re-check: x')], [true, true, false]);
    t('…and nothing else is: a claim, a release, a knock buried on line two', [isRecheckComment('Claim: x'), isRecheckComment('Release: x'), isRecheckComment('Triage\nOwned-24h re-check: x')], [false, false, false]);
    const age = recheckAge({ createdAt: KNOCK_AT, serverNow: new Date(hoursAfterKnock(5)).toISOString() });
    t('the age is server-now minus the knock, and the remainder is what the clock still owes', [age.eligible, formatHoursMinutes(age.remainingMs)], [false, '7h 0m']);
    t('…at the clock it is eligible with nothing remaining', (() => { const a = recheckAge({ createdAt: KNOCK_AT, serverNow: new Date(hoursAfterKnock(RECLAIM_AFTER_HOURS)).toISOString() }); return [a.eligible, a.remainingMs]; })(), [true, 0]);
    t('--resume-from parses BRANCH@SHA (sha lower-cased) and the declared `none`', [parseResumeFrom('claude/issue-7-x@ABCDEF1').line, parseResumeFrom('none').line, parseResumeFrom('nonsense').ok, parseResumeFrom('x@123').ok], ['Resume-from: claude/issue-7-x@abcdef1', 'Resume-from: none', false, false]);
    t('the stroke is comment FIRST, then the same additive verbs, every action naming the card', releaseActions({ issue: 7, body: 'Release: x', labels: computeLabelTarget({ current: ['pm:dispatched', 'tooling'], add: ['pm:queue'], remove: ['pm:dispatched'] }), assignees: computeAssigneeTarget({ current: ['os-tesla'], clearAll: true }) }), [
      { op: 'comment', issue: 7, body: 'Release: x' },
      { op: 'labels_add', issue: 7, labels: ['pm:queue'] },
      { op: 'labels_remove', issue: 7, labels: ['pm:dispatched'] },
      { op: 'unassign', issue: 7, assignees: ['os-tesla'] },
    ]);
    t('the release text is judged by the owning `Release:` reader on its FIRST line, and may not pre-write the resume line', [releaseTextRefusal(RELEASE_TEXT), typeof releaseTextRefusal('Released: x'), typeof releaseTextRefusal('note\nRelease: x'), typeof releaseTextRefusal('Release: x\nResume-from: a@b'), typeof releaseTextRefusal('')], [null, 'string', 'string', 'string', 'string']);

    // The fixture card the protocol names, younger than the clock.
    const young = await driveRelease(RELEASE_ARGV, silentCard(5));
    t('⭐ a knock YOUNGER than RECLAIM_AFTER_HOURS is REFUSED, saying how long remains', [young.exit, young.text.includes('too young'), young.text.includes('7h 0m remain')], [EXIT_USAGE, true, true]);
    t('…with ZERO writes: no dispatch, no direct call', [young.sent.length, young.direct], [0, []]);
    t('…and the age was read off the SERVER clock, not this process\'s (whose clock sits in 2030)', young.res.remainingMs, 7 * 3_600_000);
    const localSaysOld = await driveRelease(RELEASE_ARGV, silentCard(5), { now: () => new Date(hoursAfterKnock(100)) });
    t('⛔ a local clock that says the knock is old changes nothing — the server said young', [localSaysOld.exit, localSaysOld.sent.length], [EXIT_USAGE, 0]);

    // The fixture card the protocol names, older than the clock.
    const old = await driveRelease(RELEASE_ARGV, silentCard(13));
    t('⭐ a knock OLDER than RECLAIM_AFTER_HOURS is released and reads back `pm:queue` with no assignee', [old.exit, old.fake.board.labels, old.fake.board.assignees], [EXIT_OK, ['domain:skills', 'priority:p1', 'tooling', 'pm:queue'], []]);
    t('…in ONE dispatch carrying comment → labels_add → labels_remove → unassign, every action on the card', [old.sent.length, old.sent[0].actions.map((a) => a.op), old.sent[0].actions.every((a) => a.issue === 7)], [1, ['comment', 'labels_add', 'labels_remove', 'unassign'], true]);
    t('…and this process made ZERO direct writes — reads only', old.direct, []);
    const landed = old.fake.board.comments.at(-1);
    t('…the Release: comment landed with the resume line and the measured clock appended', [landed.body.startsWith('Release: session'), landed.body.includes(`\nResume-from: ${RELEASE_BRANCH}@abcdef1234\n`), landed.body.includes('unanswered for 13h 0m'), landed.body.includes(`RECLAIM_AFTER_HOURS = ${RECLAIM_AFTER_HOURS}`)], [true, true, true, true]);
    t('…{{NOW}} in the operator text was stamped, and the read-back found the comment by its stored bytes', [landed.body.includes('{{NOW}}'), old.res.comment, old.text.includes('④ MATCHES — released')], [false, landed.id, true]);
    const none = await driveRelease([...RELEASE_ARGV.slice(0, -1), 'none'], silentCard(13));
    t('`--resume-from none` releases without a branch or pull read, writing `Resume-from: none`', [none.exit, none.fake.calls.some((c) => c.op === 'branch-read' || c.op === 'pulls-list'), none.fake.board.comments.at(-1).body.includes('\nResume-from: none\n')], [EXIT_OK, false, true]);

    // RELAY-ONLY — the pin the card names: a release never falls back to a direct write.
    const direct = await driveRelease(RELEASE_ARGV, silentCard(13), { route: DIRECT_ROUTE, send: async () => { throw new Error('direct must not dispatch'); } });
    t('⛔ a route that resolves to DIRECT is a PREREQUISITE refusal with ZERO writes — a release is RELAY-ONLY', [direct.exit, direct.res.refusal, direct.sent.length, direct.direct, direct.text.includes('RELAY-ONLY')], [EXIT_PREREQUISITE, 'relay-only', 0, [], true]);
    const noRun = await driveRelease(RELEASE_ARGV, silentCard(13), { relay: 'no-run' });
    t('⛔ an accepted dispatch with no run is exit 6 UNCONFIRMED under auto — ONE dispatch, ZERO direct writes, no read-back', [noRun.exit, noRun.sent.length, noRun.direct, noRun.fake.calls.filter((c) => c.op === 'card-read').length, noRun.text.includes(unconfirmedText(noRun.res.relay, 'label-write --release'))], [EXIT_UNCONFIRMED, 1, [], 1, true]);
    const timedOut = await driveRelease(RELEASE_ARGV, silentCard(13), { relay: 'timeout' });
    t('…and a run that never completes is the same answer', [timedOut.exit, timedOut.direct], [EXIT_UNCONFIRMED, []]);
    const failed = await driveRelease(RELEASE_ARGV, silentCard(13), { relay: 'failure' });
    t('⛔ a run that FAILED is exit 5, never fallen back from', [failed.exit, failed.direct], [EXIT_PLATFORM_REFUSAL, []]);
    const lied = await driveRelease(RELEASE_ARGV, silentCard(13), { relay: 'lie' });
    t('a run that says success and applied nothing is caught by the read-back: exit 4, not repaired', [lied.exit, lied.fake.board.labels.includes('pm:dispatched'), lied.direct], [EXIT_READ_BACK_MISMATCH, true, []]);

    // Every refusal before the write — zero writes on each.
    const refusals = [
      ['a knock on ANOTHER card', silentCard(13, { comments: [...silentCard(13).comments.slice(0, 1), { ...silentCard(13).comments[1], issue: 8 }] }), RELEASE_ARGV, 'not to objectstack-ai/objectstack#7'],
      ['a comment that is not the knock', silentCard(13, { comments: [silentCard(13).comments[0], { ...silentCard(13).comments[1], body: 'Triage grade: p1.' }] }), RELEASE_ARGV, 'no release without the knock'],
      ['a knock that is NOT the newest comment — someone spoke after it', silentCard(13, { comments: [...silentCard(13).comments, { id: 300, body: 'the PR is coming tomorrow', created_at: new Date(hoursAfterKnock(2)).toISOString(), updated_at: new Date(hoursAfterKnock(2)).toISOString() }] }), RELEASE_ARGV, 'not silent'],
      ['a card without `pm:dispatched`', silentCard(13, { labels: ['pm:queue', 'tooling'] }), RELEASE_ARGV, 'no claim state to release'],
      ['a card with no assignee', silentCard(13, { assignees: [] }), RELEASE_ARGV, 'nobody holds it'],
      ['a closed card', silentCard(13, { state: 'closed' }), RELEASE_ARGV, 'moves an OPEN card'],
      ['a branch tip that is not the sha named', silentCard(13, { branches: { [RELEASE_BRANCH]: '0000000000000000000000000000000000000000' } }), RELEASE_ARGV, 'not at `abcdef1234`'],
      ['a branch the board does not have', silentCard(13, { branches: {} }), RELEASE_ARGV, 'is not on objectstack-ai/objectstack'],
      ['a branch with an OPEN pull — the seat produced', silentCard(13, { pulls: [{ number: 77, state: 'open', head: { ref: RELEASE_BRANCH } }] }), RELEASE_ARGV, 'the seat produced'],
      ['a knock id the board does not have', silentCard(13), [...RELEASE_ARGV.slice(0, 6), '999', ...RELEASE_ARGV.slice(7)], 'must name the owned-24h re-check'],
    ];
    for (const [name, board, argv, phrase] of refusals) {
      const run = await driveRelease(argv, board);
      t(`REFUSED before any write: ${name}`, [run.exit, run.sent.length, run.direct, run.text.includes(phrase)], [EXIT_USAGE, 0, [], true], phrase);
    }
    const badText = await driveRelease(RELEASE_ARGV, silentCard(13), { files: { [RELEASE_FILE]: 'Released the claim.\nResume-from: x@y' } });
    t('REFUSED before any write: a comment file whose first line is not `Release:`', [badText.exit, badText.sent.length, badText.text.includes('FIRST line must be the `Release:` line')], [EXIT_USAGE, 0, true]);
    const preResume = await driveRelease(RELEASE_ARGV, silentCard(13), { files: { [RELEASE_FILE]: 'Release: x\nResume-from: a@b' } });
    t('REFUSED before any write: a comment file that pre-writes the resume line this tool owns', [preResume.exit, preResume.sent.length, preResume.text.includes('already carries a `Resume-from:` line')], [EXIT_USAGE, 0, true]);
    const noFile = await driveRelease([...RELEASE_ARGV.slice(0, 8), '/tmp/self-test/missing.md', ...RELEASE_ARGV.slice(9)], silentCard(13));
    t('REFUSED before any write: a comment file that cannot be read', [noFile.exit, noFile.sent.length], [EXIT_USAGE, 0]);
    const noClock = await driveRelease(RELEASE_ARGV, silentCard(13, { serverNow: null }));
    t('⛔ an answer with no `Date` header is PREREQUISITE NOT MET — the age is never taken from this process\'s clock', [noClock.exit, noClock.res.refusal, noClock.sent.length], [EXIT_PREREQUISITE, 'no-server-clock', 0]);
    const dry = await driveRelease([...RELEASE_ARGV, '--dry-run'], silentCard(13), { send: async () => { throw new Error('a dry run must not dispatch'); } });
    t('a dry run reads everything, packs the stroke, sends nothing and says the board was never read back', [dry.exit, dry.res.dryRun, dry.text.includes('never the board'), dry.fake.board.labels.includes('pm:dispatched')], [EXIT_OK, true, true, true]);
    t('the CLI refuses --release beside a label or assignee flag, and the release flags without --release', [parseOptions([...RELEASE_ARGV, '--add', 'x']).ok, parseOptions(['--issue', '7', '--recheck-comment', '200']).ok, parseOptions(RELEASE_ARGV).ok], [false, false, true]);
    t('…and refuses --release without the knock, the file or the resume line', [parseOptions(RELEASE_ARGV.filter((a, i) => !(i >= 5 && i <= 6))).ok, parseOptions(RELEASE_ARGV.filter((a, i) => !(i >= 7 && i <= 8))).ok, parseOptions(RELEASE_ARGV.slice(0, -2)).ok], [false, false, false]);
  }

  // ── the floor, BEFORE the verdict ────────────────────────────────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR} — a section that stopped being declared is a section nothing floors.`);
  }
  for (const [name, count] of batteryCases) {
    if (name in SELF_TEST_BATTERIES) continue;
    floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floor.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const message of floor) cases.push({ name: message, ok: false, detail: '' });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ label-write self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ label-write self-test: ${cases.length} cases pass across ${declared.length} batteries — the union/difference ` +
      'arithmetic, the ONE-OF refusal, the idempotent DELETE, the stripped-underneath re-add-and-report, the mismatch ' +
      'exit, the rate-limit non-fallback, the assignee echo on the whole-set PATCH, and the silent-claim release: the two ' +
      'fixture cards (a knock older and younger than RECLAIM_AFTER_HOURS on the SERVER clock), ONE relay stroke, RELAY-ONLY — never a direct write.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Route node's `fetch` through the session proxy before the first request
 * (#13544). It has to be a re-exec: the flag is read at process START, so an
 * assignment after this point leaves every request on the bypassed route — and
 * a bypassed route answers 401 authenticated, which reads exactly like a
 * credential problem and is not one.
 */
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

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (argv.includes('--self-test')) return selfTest();

  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`label-write: ${parsed.error}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }

  if (!TOKEN) {
    console.error(
      'label-write: PREREQUISITE NOT MET — no GITHUB_TOKEN / GH_TOKEN in the environment.\n' +
        '  ⛔ NOT MEASURED: nothing was read and nothing was written.',
    );
    return EXIT_PREREQUISITE;
  }

  const relayed = rearmThroughProxy(argv);
  if (relayed !== null) return relayed;

  const result = parsed.options.release ? await runRelease(parsed.options, {}) : await runLabelWrite(parsed.options, {});
  if (parsed.options.json) {
    console.log(
      JSON.stringify(
        {
          repo: result.repo,
          issue: result.issue,
          mode: result.mode ?? 'labels',
          exit: result.exit,
          labels: result.labels?.target ?? null,
          assignees: result.assignees?.target ?? null,
          fallbackUsed: Boolean(result.fallbackUsed),
          reAdded: result.reAdded ?? [],
          transport: result.transport ?? null,
          relay: result.relay ? { state: result.relay.state, run: result.relay.run ?? null, request_id: result.relay.requestId ?? null } : null,
          ...(result.mode === 'release' ? { refusal: result.refusal ?? null, remainingMs: result.remainingMs ?? null, comment: result.comment ?? null, resume: result.resume ?? null } : {}),
          httpCalls: result.httpCalls,
        },
        null,
        2,
      ),
    );
  }
  return result.exit;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ label-write self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
