#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * label-write — the four-step label/assignee write, as ONE spelling (#18085).
 *
 *   node scripts/pm/label-write.mjs --repo owner/name --issue N --add pm:dispatched --remove pm:queue
 *   node scripts/pm/label-write.mjs --issue N --assign os-project-manager
 *   node scripts/pm/label-write.mjs --issue N --add skip-changeset --dry-run
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
import {
  EXIT_PREREQUISITE_NOT_MET,
  PM_EXCLUSIVE_STATE_LABELS,
  PM_RESIDUE_LABELS,
  PM_STATE_CLAIM,
  PROXY_FLAG,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
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
 *   - a thrown fetch (status 0) is the route too.
 */
export function classifyHttp({ status, op, rateRemaining } = {}) {
  if (status === 200 || status === 201 || status === 204) return 'ok';
  if (status === 404 && op === 'label-delete') return 'idempotent';
  if ((status === 403 || status === 429) && Number(rateRemaining) === 0) return 'ratelimit';
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
// Transport — one shape for every call, so `classifyHttp` sees the same fields
// whatever went wrong. ⛔ Nothing here throws on an HTTP status: a refusal is
// an observation this tool routes on, not an exception it unwinds through.
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}) {
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
  return {
    status: res.status,
    rateRemaining: rateRemaining === null ? null : Number(rateRemaining),
    json,
    detail: typeof json?.message === 'string' ? json.message : '',
    call: `${method} ${path}`,
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
  '  node scripts/pm/label-write.mjs --self-test',
  '',
  '  Additive `POST .../labels` and directed `DELETE .../labels/{name}` first — neither can strip a',
  '  label a concurrent seat wrote. A platform refusal falls back ONCE to `PATCH .../issues/{n}` with',
  '  the full target set AND the current assignees echoed, then reads back either way.',
  '  ⛔ Never `PUT .../labels` and ⛔ never MCP `issue_write` (lock 1 denies it).',
  '',
  '  Exits: 0 landed+read-back · 2 usage · 3 prerequisite (no token/route, or rate-limit exhausted)',
  '         4 read-back disagrees with the target · 5 every channel refused.',
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

  let stopReason = null;
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
      `${fallbackUsed ? ' (via the whole-set PATCH fallback)' : ''}${reAdded.length ? ` (after re-adding ${render(reAdded)})` : ''}.`,
  );
  return result(EXIT_OK, { labels, assignees, fallbackUsed, reAdded, verdict, assigneeVerdict, backLabels, backAssignees });
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
 */
export function fakeBoard(initial = {}) {
  const board = {
    state: initial.state ?? 'open',
    labels: [...(initial.labels ?? [])],
    assignees: [...(initial.assignees ?? [])],
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
    });

    const queued = hooks.get(op);
    if (queued?.length) {
      const h = queued.shift();
      return wrap(h.status, h.json ?? { message: 'canned' }, h.rateRemaining ?? 5000);
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
async function driveOffline(argv, boardInit = {}) {
  const fake = fakeBoard(boardInit);
  const parsed = parseOptions(argv);
  if (!parsed.ok) return { parsed, exit: EXIT_USAGE, fake, out: [] };
  const out = [];
  const res = await runLabelWrite(parsed.options, { call: fake.call, log: (l) => out.push(l) });
  return { parsed, exit: res.exit, res, fake, out, text: out.join('\n') };
}

// The battery ledger this self-test's floor is evaluated against. A battery
// that stops registering cases is the bug; a pinned TOTAL would hide it the
// moment a sibling battery grows (#13489, the shape post-stamped.mjs carries).
const SELF_TEST_BATTERIES = Object.freeze({
  'the re-exec guard: the name this tool sets, and the patrol name that must not silence it': 11,
  'the arithmetic: union, difference, and the two idempotent no-ops': 12,
  'the ONE-OF refusal, and the one declared exception': 6,
  'the read-back verdict: three buckets, three different meanings': 7,
  'the classifier: a 404 that is success, and a 403 that must not fall back': 9,
  'the four steps, end to end against a fake board': 10,
  'the fallback: one PATCH, and the assignee echo that makes it survivable': 7,
  'the remaining exits: refusal, mismatch, the ONE-OF block and the dry run': 5,
  'the CLI: what a typo must never be allowed to mean': 8,
});
const SELF_TEST_BATTERY_FLOOR = 9;
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
      'exit, the rate-limit non-fallback, and the assignee echo on the whole-set PATCH.',
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

  const result = await runLabelWrite(parsed.options, {});
  if (parsed.options.json) {
    console.log(
      JSON.stringify(
        {
          repo: result.repo,
          issue: result.issue,
          exit: result.exit,
          labels: result.labels?.target ?? null,
          assignees: result.assignees?.target ?? null,
          fallbackUsed: Boolean(result.fallbackUsed),
          reAdded: result.reAdded ?? [],
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
