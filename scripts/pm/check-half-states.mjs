#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PM half-state sweeper (#7341 item 2) — REPORT-ONLY enumeration of the
 * label/assignee invariants the dispatch protocol calls "过夜半状态".
 *
 *   node scripts/pm/check-half-states.mjs               # sweep the live repo
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
 *
 * The body half of H5 (the 「当前 PM」 paragraph) is NOT machine-checked here:
 * seat-sticker bodies are prose with no pinned grammar, and a fuzzy parser
 * would report phantom desyncs — the #4690 shape in mirror image. The
 * title/assignee pair is the mechanical half; the sweep prints the sticker
 * URL so the patrol reads the body itself.
 *
 * Auth: uses GITHUB_TOKEN / GH_TOKEN when present (unauthenticated works at
 * 60 req/h — enough for a small board, not for comment-fetching sweeps).
 * REST only, never GraphQL (Operational notes 3: the loop's hot path stays on
 * the core quota).
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
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
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
  const findings = [];
  const seen = new Map();
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

  findings.sort((a, b) => a[0].number - b[0].number);
  for (const [issue, code, msg] of findings) {
    console.log(`  ${code} #${issue.number} ${msg}\n     ${issue.html_url}`);
  }
  console.log(
    `check-half-states: swept ${seen.size} open pm-labeled issue(s) in ${OWNER_REPO} — ` +
      `${findings.length} half-state(s) found. Report-only: findings are patrol input, not a gate verdict.`,
  );
}

// ---------------------------------------------------------------------------
// Self-test — predicates only; no network.
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
  } else {
    sweep().catch((err) => {
      // A sweep that could not run must not read as a clean board (#4690).
      console.error(`check-half-states: sweep failed to run — ${err.message}`);
      process.exit(2);
    });
  }
}
