#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * first-touch-sweep — triage's five-disjunction sweep, as ONE command that runs the disjunctions exactly.
 *
 *   node scripts/pm/first-touch-sweep.mjs [--repo=OWNER/NAME] [--since=ISO] [--json]
 *   node scripts/pm/first-touch-sweep.mjs --self-test        # offline, no network at all
 *
 * ## Why this file exists
 *
 * `.claude/skills/pm-dispatch/references/triage-duties.md` defines the first-touch sweep as five disjunctions
 * (`TRIAGE_RULE_PATH`, quoted below and pinned by the self-test) and requires every enumeration to compare what it
 * returned with the platform's total. Typed by hand each fire, the sweep drifted: ① ran as "no labels at all" (so a
 * `finding` card with no `domain:*` never matched), ③ was skipped, and the results were cut at twelve. Open cards
 * with a `domain:*` and no state then waited hours for anyone to see them. A program cannot narrow a disjunction by
 * habit, so the sweep is this file.
 *
 * ## What it reads — REST only, every page
 *
 *   1. every OPEN issue of the board: `GET /repos/{repo}/issues?state=open&per_page=100&page=N`, page after page
 *      until a short page, pull requests dropped (the endpoint lists both). GraphQL is never used: sessions are
 *      refused it.
 *   2. the platform's own count: `GET /search/issues?q=repo:{repo} is:issue is:open`'s `total_count`. The walk's
 *      count must EQUAL it and the search must not say `incomplete_results`; anything else is `sweep INCOMPLETE`
 *      (exit 4) naming both numbers — ⛔ never a clean verdict on a partial walk. A walk that reaches its page
 *      ceiling with a full last page is INCOMPLETE too.
 *   3. for ⑤ only, each candidate's label events (`GET /repos/{repo}/issues/{n}/events`, every page); a card whose
 *      events cannot be read is UNJUDGED, which makes the run INCOMPLETE.
 *
 * ## The five disjunctions — the rule text's, nothing narrower
 *
 * Excluded from every disjunction first: `tracking`, `status:parked`, every `pm:seat` post, `qa-run` records.
 *
 *   ① bare — no `pm:*` label, no `needs-user-decision`, no `domain:*` (other labels, `finding` among them, do not
 *      make a card "touched": ① is NOT "no labels");
 *   ② `pm:queue` with no `domain:*` — on a multi-lane board only (`MULTI_LANE_REPOS`);
 *   ③ a `domain:*` with no pm state (`PM_EXCLUSIVE_STATE_LABELS`, `needs-user-decision` included);
 *   ④ `pm:queue` + `domain:*` with no `priority:*`;
 *   ⑤ created inside the window (`--since`) and carrying `pm:queue` or a `priority:*` that was applied in the same
 *      minute the card was created — first-touch as untriaged, ⛔ never judged by who applied it.
 *
 * ②③④ take only cards whose `updated_at` is older than `SETTLE_MS` (~2 min): a card being labelled right now is
 * mid-write, not owed. ⑤ needs a window; without `--since` it is NOT RUN, the verdict is PARTIAL and the exit 4 —
 * ⛔ never clean, never 0.
 *
 * Report-only: ⛔ this file writes nothing. Each hit is a card triage owes a first touch this fire; the order of the
 * touches (newest first when the sweep clears, oldest first when it does not) is triage's, not this file's.
 *
 * ## The area backstop — a sixth row, daily, and NOT part of the verdict
 *
 * Every public card carries exactly one `area:*`, set at filing or at triage's first touch. The backstop is the
 * daily read that catches the card neither reached (`AREA_BACKSTOP_PHRASE`, pinned like the disjunctions): every
 * open card of the same walk that carries no `area:*`, with the sweep's own exclusions plus `security` — a security
 * card owes no area. It rides the walk already paid for, so it costs no request. ⛔ It is a DAILY duty, not a
 * first-touch debt: it is printed after the five rows and never enters the `owed` set, the verdict or the exit code,
 * so a board that is mid-backfill does not turn every fire's sweep into FOUND.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  the walk is complete and all five ran; the lines say what each disjunction found (zero or more)
 *   2  usage
 *   3  PREREQUISITE NOT MET — a read refused or unanswered
 *   4  not a whole sweep: INCOMPLETE — the walk's count is not the platform's, a page ceiling was hit, or a ⑤ card
 *      went unread — or PARTIAL — no `--since`, so ⑤ did not run
 *
 * ## Self-test
 *
 * `--self-test` drives the classifier, the walk, the count comparison and ⑤'s event read against fixtures, with the
 * floor and the handshake AGENTS.md § "Writing a `--self-test`" requires (copied, never imported).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { DECISION_INBOX_LABEL, EXIT_PREREQUISITE_NOT_MET, PM_EXCLUSIVE_STATE_LABELS, PROXY_FLAG, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = new URL('../../', import.meta.url);
const API = 'https://api.github.com';
const PROXY_REARM_GUARD = 'OS_FIRST_TOUCH_SWEEP_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_INCOMPLETE = 4;

/** Where the five disjunctions are written, and the phrases this file is built from (the self-test pins each). */
export const TRIAGE_RULE_PATH = '.claude/skills/pm-dispatch/references/triage-duties.md';
export const TRIAGE_RULE_PHRASES = Object.freeze([
  '①全裸(无 `pm:*`/`needs-user-decision`/`domain:*`)',
  '② `pm:queue` 无 `domain:*`(仅多车道仓)',
  '③ `domain:*` 无 pm-state',
  '④ `pm:queue`+`domain:*` 无 `priority:*`',
  '②③④ 只取 `updated_at` 早于 ~2min',
  '排除 `tracking`、`status:parked`、全部 `pm:seat` 贴、`qa-run` 记录',
  '析取 ⑤:窗内新建且 `pm:queue`/`priority:*` 与建卡同分钟',
  '不等 ⇒ 报 `sweep INCOMPLETE`',
]);

/** The daily backstop's sentence in the same rule file (the self-test pins it), and the labels that owe no area. */
export const AREA_BACKSTOP_PHRASE = '日对账 fire 扫无 `area:*` 的公开卡';
export const AREA_BACKSTOP_LIST_CAP = 30;

/** The multi-lane boards (`cross-repo-coordination.md`: 「多车道仓 `objectstack`」); ② runs on these alone. */
export const MULTI_LANE_REPOS = Object.freeze(['objectstack-ai/objectstack']);
export const MULTI_LANE_RULE_PATH = '.claude/skills/pm-dispatch/references/cross-repo-coordination.md';
export const MULTI_LANE_RULE = '多车道仓 `objectstack`';

export const EXCLUDED_LABELS = Object.freeze(['tracking', 'status:parked', 'pm:seat', 'qa-run']);
export const SETTLE_MS = 2 * 60 * 1000;
export const PAGE_SIZE = 100;
export const PAGE_CEILING = 60;
export const EVENT_PAGE_CEILING = 10;

export const DISJUNCTIONS = Object.freeze({
  1: 'bare — no pm:*, no needs-user-decision, no domain:*',
  2: 'pm:queue with no domain:* (multi-lane board)',
  3: 'domain:* with no pm state',
  4: 'pm:queue + domain:* with no priority:*',
  5: 'created in the window with pm:queue / priority:* applied in the creation minute',
});

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

const lower = (s) => String(s).toLowerCase();
export const labelsOf = (issue) => (Array.isArray(issue?.labels) ? issue.labels : []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean).map(lower);

/**
 * Which of ①–④ one OPEN issue answers (⑤ needs its events and is `fifthCandidate` + `sameMinuteLabelled`). Pure.
 * Labels compare case-insensitively, as GitHub matches them. Returns the disjunction numbers, ascending.
 */
export function classify(issue, { repo, nowMs }) {
  const labels = labelsOf(issue);
  if (labels.some((l) => EXCLUDED_LABELS.includes(l))) return [];
  const has = (l) => labels.includes(lower(l));
  const anyPm = labels.some((l) => l.startsWith('pm:'));
  const domain = labels.some((l) => l.startsWith('domain:'));
  const priority = labels.some((l) => l.startsWith('priority:'));
  const state = PM_EXCLUSIVE_STATE_LABELS.some(has);
  const settled = Date.parse(issue?.updated_at ?? '') < nowMs - SETTLE_MS;
  const hits = [];
  if (!anyPm && !has(DECISION_INBOX_LABEL) && !domain) hits.push(1);
  if (settled && MULTI_LANE_REPOS.includes(lower(repo)) && has('pm:queue') && !domain) hits.push(2);
  if (settled && domain && !state) hits.push(3);
  if (settled && has('pm:queue') && domain && !priority) hits.push(4);
  return hits;
}

/**
 * The area backstop: an open card that carries no `area:*`. The sweep's exclusions apply, and a `security` card owes
 * none — it is graded in the private channel and carries no area by rule. Pure.
 */
export function lacksArea(issue) {
  const labels = labelsOf(issue);
  if (labels.some((l) => EXCLUDED_LABELS.includes(l) || l === 'security')) return false;
  return !labels.some((l) => l.startsWith('area:'));
}

/** ⑤'s first half: created at or after the window's start, not excluded, carrying `pm:queue` or a `priority:*`. Pure. */
export function fifthCandidate(issue, { sinceMs }) {
  if (!Number.isFinite(sinceMs)) return false;
  const labels = labelsOf(issue);
  if (labels.some((l) => EXCLUDED_LABELS.includes(l))) return false;
  if (!(Date.parse(issue?.created_at ?? '') >= sinceMs)) return false;
  return labels.includes('pm:queue') || labels.some((l) => l.startsWith('priority:'));
}

/** ⑤'s second half: a `labeled` event of `pm:queue` or a `priority:*` in the minute the card was created. Pure. */
export function sameMinuteLabelled(issue, events) {
  const minute = String(issue?.created_at ?? '').slice(0, 16);
  if (minute.length < 16) return false;
  return (Array.isArray(events) ? events : []).some((e) => {
    if (e?.event !== 'labeled') return false;
    const name = lower(e?.label?.name ?? '');
    return (name === 'pm:queue' || name.startsWith('priority:')) && String(e?.created_at ?? '').slice(0, 16) === minute;
  });
}

/** The verdict line, from the counts. Pure. */
export function verdictLine({ complete, why = [], hits, fifthRun }) {
  if (!complete) return `sweep INCOMPLETE — ${why.join('; ')}. ⛔ Not a clean sweep: re-run when the reads answer.`;
  const n = hits.size;
  if (!fifthRun) return `sweep PARTIAL — ⑤ NOT RUN: no --since window; ①–④ found ${n} card(s) owed a first touch. ⛔ Not a clean sweep: re-run with --since=ISO.`;
  return n === 0 ? 'sweep CLEAN — no card owed a first touch' : `sweep FOUND ${n} card(s) owed a first touch`;
}

/** The exit a patrol reads: 0 only for a complete walk on which all five ran. Pure. */
export function sweepExit({ complete, fifthRun }) {
  return complete && fifthRun ? EXIT_OK : EXIT_INCOMPLETE;
}

// ---------------------------------------------------------------------------
// The walk — `get` is injected so the self-test drives every branch
// ---------------------------------------------------------------------------

/**
 * The sweep. `get(path)` answers `{ status, json }`. Returns the report object; never throws on a platform answer.
 */
export async function sweep({ repo, nowMs, sinceMs = NaN, get }) {
  const why = [];
  const issues = [];
  let pages = 0;
  let exhausted = false;
  for (let page = 1; page <= PAGE_CEILING; page++) {
    const r = await get(`/repos/${repo}/issues?state=open&per_page=${PAGE_SIZE}&page=${page}`);
    pages += 1;
    if (r.status !== 200 || !Array.isArray(r.json)) return { prerequisite: `GET /repos/${repo}/issues page ${page} answered HTTP ${r.status}` };
    for (const row of r.json) if (!row?.pull_request) issues.push(row);
    if (r.json.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) why.push(`the walk hit its ceiling of ${PAGE_CEILING} pages with a full last page`);

  const q = encodeURIComponent(`repo:${repo} is:issue is:open`);
  const total = await get(`/search/issues?q=${q}&per_page=1`);
  if (total.status !== 200 || typeof total.json?.total_count !== 'number') return { prerequisite: `GET /search/issues answered HTTP ${total.status}` };
  const totalCount = total.json.total_count;
  if (total.json.incomplete_results === true) why.push('the search answered incomplete_results');
  if (totalCount !== issues.length) why.push(`the walk returned ${issues.length} open issue(s) and the platform counts ${totalCount}`);

  const found = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const issue of issues) for (const d of classify(issue, { repo, nowMs })) found[d].push(issue);

  const fifthRun = Number.isFinite(sinceMs);
  const unjudged = [];
  if (fifthRun) {
    for (const issue of issues.filter((i) => fifthCandidate(i, { sinceMs }))) {
      const events = [];
      let read = true;
      let done = false;
      for (let page = 1; page <= EVENT_PAGE_CEILING; page++) {
        const r = await get(`/repos/${repo}/issues/${issue.number}/events?per_page=${PAGE_SIZE}&page=${page}`);
        if (r.status !== 200 || !Array.isArray(r.json)) {
          read = false;
          break;
        }
        events.push(...r.json);
        if (r.json.length < PAGE_SIZE) {
          done = true;
          break;
        }
      }
      if (!read || !done) unjudged.push(issue.number);
      else if (sameMinuteLabelled(issue, events)) found[5].push(issue);
    }
    if (unjudged.length) why.push(`⑤ could not read the label events of ${unjudged.map((n) => `#${n}`).join(', ')}`);
  }

  const hits = new Set(Object.values(found).flat().map((i) => i.number));
  const noArea = issues.filter(lacksArea);
  return { repo, nowMs, sinceMs, pages, enumerated: issues.length, totalCount, complete: why.length === 0, why, found, fifthRun, hits, unjudged, noArea };
}

export function renderText(r) {
  const at = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
  const lines = [`first-touch-sweep — ${r.repo} · now ${at(r.nowMs)} · window ${r.fifthRun ? `since ${at(r.sinceMs)}` : 'none (⑤ not run)'}`];
  lines.push(`enumerated ${r.enumerated} open issue(s) over ${r.pages} page(s) · the platform counts ${r.totalCount}`);
  const marks = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
  for (const d of [1, 2, 3, 4, 5]) {
    if (d === 5 && !r.fifthRun) {
      lines.push(`${marks[d]} ${DISJUNCTIONS[d]}: NOT RUN — pass --since=ISO (the window anchor)`);
      continue;
    }
    if (d === 2 && !MULTI_LANE_REPOS.includes(lower(r.repo))) {
      lines.push(`${marks[d]} ${DISJUNCTIONS[d]}: not asked — ${r.repo} is not a multi-lane board`);
      continue;
    }
    const cards = [...r.found[d]].sort((a, b) => a.number - b.number);
    lines.push(`${marks[d]} ${DISJUNCTIONS[d]}: ${cards.length}`);
    for (const c of cards) lines.push(`    #${c.number} · updated ${String(c.updated_at ?? '').slice(0, 16)}Z · ${String(c.title ?? '').slice(0, 100)}`);
  }
  const bare = (r.noArea ?? []).map((i) => i.number).sort((a, b) => a - b);
  const listed = bare.length > AREA_BACKSTOP_LIST_CAP ? `the first ${AREA_BACKSTOP_LIST_CAP} of them (--json lists all)` : 'all of them';
  lines.push(`area backstop (daily, not part of the verdict) — open cards with no area:*: ${bare.length}${bare.length ? ` · ${listed}: ${bare.slice(0, AREA_BACKSTOP_LIST_CAP).map((n) => `#${n}`).join(' ')}` : ''}`);
  lines.push(verdictLine(r));
  return lines.join('\n');
}

export function renderJson(r) {
  const ids = (d) => r.found[d].map((i) => i.number).sort((a, b) => a - b);
  return {
    repo: r.repo,
    complete: r.complete,
    incomplete_reasons: r.why,
    enumerated: r.enumerated,
    total_count: r.totalCount,
    fifth_run: r.fifthRun,
    disjunctions: { 1: ids(1), 2: ids(2), 3: ids(3), 4: ids(4), 5: ids(5) },
    owed: [...r.hits].sort((a, b) => a - b),
    no_area: (r.noArea ?? []).map((i) => i.number).sort((a, b) => a - b),
    verdict: verdictLine(r),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--json', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['repo', 'since', 'now']);

export function parseOptions(argv, { env = {}, nowMs = Date.now() } = {}) {
  const opts = { json: false, help: false, repo: null, sinceMs: NaN, nowMs };
  for (const arg of argv ?? []) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      const m = /^--([a-z]+)=(.*)$/.exec(arg);
      if (!m || !KNOWN_OPTIONS.includes(m[1])) return { ok: false, error: `\`${arg}\` is not an argument this tool takes. Flags: ${KNOWN_FLAGS.join(' ')}; options: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}.` };
      if (m[1] === 'repo') opts.repo = m[2];
      if (m[1] === 'since' || m[1] === 'now') {
        const ms = Date.parse(m[2]);
        if (!Number.isFinite(ms)) return { ok: false, error: `--${m[1]} must be an ISO time, got \`${m[2]}\`` };
        opts[m[1] === 'since' ? 'sinceMs' : 'nowMs'] = ms;
      }
    }
  }
  if (!opts.repo) opts.repo = resolveSweepRepo(env).repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { ok: false, error: `--repo must be owner/name, got \`${opts.repo}\`` };
  if (Number.isFinite(opts.sinceMs) && opts.sinceMs > opts.nowMs) return { ok: false, error: '--since is later than now' };
  return { ok: true, options: opts };
}

const USAGE = [
  'first-touch-sweep — triage\'s five disjunctions, run exactly, every page, the count checked against the platform.',
  '',
  '  node scripts/pm/first-touch-sweep.mjs [--repo=OWNER/NAME] [--since=ISO] [--now=ISO] [--json]',
  '  node scripts/pm/first-touch-sweep.mjs --self-test',
  '',
  '  --since is the window anchor (the seat post\'s last round record); without it ⑤ is NOT RUN: PARTIAL, exit 4.',
  '  Exits: 0 complete, all five run · 2 usage · 3 prerequisite (a read refused) · 4 INCOMPLETE or PARTIAL. Report-only.',
].join('\n');

function liveGet(token) {
  return async (path) => {
    try {
      const res = await fetch(`${API}${path}`, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (e) {
      return { status: 0, json: null, detail: e?.message ?? 'fetch threw' };
    }
  };
}

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const parsed = parseOptions(argv, { env, nowMs: deps.nowMs ?? Date.now() });
  if (!parsed.ok) {
    console.error(`first-touch-sweep: ${parsed.error}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const o = parsed.options;
  if (o.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  const get = deps.get ?? liveGet(env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '');
  const r = await sweep({ repo: o.repo, nowMs: o.nowMs, sinceMs: o.sinceMs, get });
  if (r.prerequisite) {
    console.error(`first-touch-sweep: PREREQUISITE NOT MET — ${r.prerequisite}. ⛔ No verdict: nothing was swept.`);
    return EXIT_PREREQUISITE;
  }
  console.log(o.json ? JSON.stringify(renderJson(r), null, 2) : renderText(r));
  return sweepExit(r);
}

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({ env: process.env, execArgv: process.execArgv, flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG), guard: PROXY_REARM_GUARD });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], { stdio: 'inherit', env: { ...process.env, [PROXY_REARM_GUARD]: '1' } });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

// ---------------------------------------------------------------------------
// Self-test — floor (battery names pinned) + handshake, copied from the landed shape
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the rule text: every phrase this file is built from is in the file that writes it': 3,
  'the classifier: ①–④ exactly as written — ① is not "no labels", ③ is asked, exclusions first, ②③④ settle': 16,
  'the fifth: created in the window, pm:queue or priority:* applied in the creation minute, never by actor': 7,
  'the walk: every page, pull requests dropped, the count checked — INCOMPLETE on any gap, never clean': 10,
  'the CLI: what a typo must never mean, and the exits a patrol reads': 9,
  'the area backstop: an open card with no area:* is listed daily, and never moves the first-touch verdict': 9,
});
const SELF_TEST_BATTERY_FLOOR = 6;
const UNATTRIBUTED_BATTERY = '(unattributed)';
const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const REPO = 'objectstack-ai/objectstack';
  const NOW = Date.parse('2026-11-14T22:00:00Z');
  const OLD = '2026-11-14T18:00:00Z';
  const FRESH = '2026-11-14T21:59:30Z';
  const card = (number, labels, extra = {}) => ({ number, title: `card ${number}`, labels: labels.map((name) => ({ name })), created_at: OLD, updated_at: OLD, ...extra });
  const c = (labels, extra) => classify(card(1, labels, extra), { repo: REPO, nowMs: NOW });

  battery('the rule text: every phrase this file is built from is in the file that writes it');
  {
    const rule = readFileSync(new URL(TRIAGE_RULE_PATH, REPO_ROOT), 'utf8');
    const missing = TRIAGE_RULE_PHRASES.filter((p) => !rule.includes(p));
    t('every disjunction phrase is a substring of triage-duties.md (a reworded rule reds here)', missing, []);
    t('…and the rule names this script, so the patrol reaches it', rule.includes('scripts/pm/first-touch-sweep.mjs'));
    t('the multi-lane board list is the rule\'s own', readFileSync(new URL(MULTI_LANE_RULE_PATH, REPO_ROOT), 'utf8').includes(MULTI_LANE_RULE));
  }

  battery('the classifier: ①–④ exactly as written — ① is not "no labels", ③ is asked, exclusions first, ②③④ settle');
  t('① a card with no labels', c([]), [1]);
  t('⭐ ① a `finding` card with no domain is bare too — ① is NOT "no labels"', c(['finding', 'enhancement']), [1]);
  t('① any pm:* label is a touch', c(['pm:retriage']), []);
  t('① needs-user-decision is a touch', c(['needs-user-decision']), []);
  t('① a domain:* is a touch', c(['domain:skills', 'pm:queue', 'priority:p2']), []);
  t('② pm:queue with no domain on the multi-lane board', c(['pm:queue', 'priority:p2']), [2]);
  t('…not asked on a single-lane board', classify(card(1, ['pm:queue', 'priority:p2']), { repo: 'objectstack-ai/hotcrm', nowMs: NOW }), []);
  t('⭐ ③ a domain with no state — the stateless strip this card was filed for', c(['domain:skills', 'priority:p1']), [3]);
  t('③ needs-user-decision IS a state', c(['domain:skills', 'needs-user-decision']), []);
  t('③ pm:awaiting-maintainer IS a state', c(['domain:skills', 'pm:awaiting-maintainer']), []);
  t('④ queued, routed, ungraded', c(['domain:spec', 'pm:queue']), [4]);
  t('a routed, graded, queued card is owed nothing', c(['domain:spec', 'pm:queue', 'priority:p3']), []);
  t('②③④ wait ~2 min after the last update: a card mid-write is not owed', [c(['domain:skills'], { updated_at: FRESH }), c(['pm:queue'], { updated_at: FRESH })], [[], []]);
  t('…while ① is asked at once', c([], { updated_at: FRESH }), [1]);
  t('exclusions come first: tracking, status:parked, pm:seat, qa-run', ['tracking', 'status:parked', 'pm:seat', 'qa-run'].map((x) => c([x]).length), [0, 0, 0, 0]);
  t('labels compare case-insensitively', c(['Domain:Skills', 'PM:Queue']), [4]);

  battery('the fifth: created in the window, pm:queue or priority:* applied in the creation minute, never by actor');
  {
    const SINCE = Date.parse('2026-11-14T20:00:00Z');
    const born = card(9, ['pm:queue', 'domain:ui', 'priority:p2'], { created_at: '2026-11-14T21:10:07Z' });
    t('a card created in the window carrying pm:queue is a candidate', fifthCandidate(born, { sinceMs: SINCE }));
    t('…one created before the window is not', fifthCandidate({ ...born, created_at: '2026-11-14T19:00:00Z' }, { sinceMs: SINCE }), false);
    t('…no window, no candidate', fifthCandidate(born, { sinceMs: NaN }), false);
    t('…an excluded card is not', fifthCandidate(card(9, ['pm:queue', 'pm:seat'], { created_at: born.created_at }), { sinceMs: SINCE }), false);
    t('⭐ pm:queue applied in the creation minute is ⑤, whoever applied it', sameMinuteLabelled(born, [{ event: 'labeled', label: { name: 'pm:queue' }, created_at: '2026-11-14T21:10:59Z', actor: { login: 'objectstack-fleet[bot]' } }]));
    t('…a priority applied a minute later is a touch, not ⑤', sameMinuteLabelled(born, [{ event: 'labeled', label: { name: 'priority:p2' }, created_at: '2026-11-14T21:11:00Z' }]), false);
    t('…another label in the minute is not ⑤', sameMinuteLabelled(born, [{ event: 'labeled', label: { name: 'domain:ui' }, created_at: '2026-11-14T21:10:08Z' }]), false);
  }

  battery('the walk: every page, pull requests dropped, the count checked — INCOMPLETE on any gap, never clean');
  {
    const page = (n, from) => Array.from({ length: n }, (_, k) => card(from + k, ['domain:server', 'pm:queue', 'priority:p2']));
    const board = (pages, total, extra = {}) => {
      const seen = [];
      const get = async (path) => {
        seen.push(path);
        if (path in extra) return extra[path];
        const m = /\/issues\?state=open&per_page=100&page=(\d+)$/.exec(path);
        if (m) return { status: 200, json: pages[Number(m[1]) - 1] ?? [] };
        if (path.startsWith('/search/issues')) return { status: 200, json: { total_count: total, incomplete_results: false } };
        return { status: 404, json: { message: 'Not Found' } };
      };
      return { get, seen };
    };
    const two = [page(100, 1), [...page(30, 101), { number: 999, pull_request: {}, labels: [] }, card(500, ['domain:skills'])]];
    const ok = board(two, 131);
    const r = await sweep({ repo: REPO, nowMs: NOW, get: ok.get });
    t('every page is read until a short one', r.pages, 2);
    t('pull requests are dropped from the count', r.enumerated, 131);
    t('a count equal to the platform\'s is complete', r.complete);
    t('⭐ ③ found the stateless card on page two — no cut at twelve', r.found[3].map((i) => i.number), [500]);
    t('⭐ …and with no window the verdict is PARTIAL, never FOUND or CLEAN, ⑤ NOT RUN named', verdictLine(r), 'sweep PARTIAL — ⑤ NOT RUN: no --since window; ①–④ found 1 card(s) owed a first touch. ⛔ Not a clean sweep: re-run with --since=ISO.');
    const short = await sweep({ repo: REPO, nowMs: NOW, get: board(two, 140).get });
    t('⭐ a walk short of the platform\'s count is INCOMPLETE, naming both numbers', [short.complete, short.why[0]], [false, 'the walk returned 131 open issue(s) and the platform counts 140']);
    t('…and its verdict is never clean', verdictLine(short).startsWith('sweep INCOMPLETE'));
    const flagged = await sweep({ repo: REPO, nowMs: NOW, get: board(two, 131, { [`/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue is:open`)}&per_page=1`]: { status: 200, json: { total_count: 131, incomplete_results: true } } }).get });
    t('a search that says incomplete_results is INCOMPLETE', flagged.complete, false);
    const refused = await sweep({ repo: REPO, nowMs: NOW, get: async () => ({ status: 403, json: { message: 'nope' } }) });
    t('a refused page is a prerequisite, never a verdict', typeof refused.prerequisite, 'string');
    const SINCE = Date.parse('2026-11-14T20:00:00Z');
    const born = card(77, ['pm:queue', 'domain:ui', 'priority:p2'], { created_at: '2026-11-14T21:10:07Z' });
    const fifth = board([[born]], 1, { [`/repos/${REPO}/issues/77/events?per_page=100&page=1`]: { status: 500, json: null } });
    const unread = await sweep({ repo: REPO, nowMs: NOW, sinceMs: SINCE, get: fifth.get });
    t('⭐ a ⑤ card whose events cannot be read is UNJUDGED and the run INCOMPLETE', [unread.complete, unread.unjudged], [false, [77]]);
  }

  battery('the area backstop: an open card with no area:* is listed daily, and never moves the first-touch verdict');
  {
    t('the backstop sentence is a substring of triage-duties.md (a reworded rule reds here)', readFileSync(new URL(TRIAGE_RULE_PATH, REPO_ROOT), 'utf8').includes(AREA_BACKSTOP_PHRASE));
    t('a routed, graded, queued card with no area:* is listed', lacksArea(card(1, ['domain:spec', 'pm:queue', 'priority:p2'])));
    t('…and the same card carrying one is not', lacksArea(card(1, ['domain:spec', 'pm:queue', 'priority:p2', 'area:data'])), false);
    t('the label compares case-insensitively', lacksArea(card(1, ['Area:UX'])), false);
    t('⛔ a security card owes no area', lacksArea(card(1, ['security', 'pm:queue'])), false);
    t('the sweep\'s exclusions apply here too: tracking, status:parked, pm:seat, qa-run', ['tracking', 'status:parked', 'pm:seat', 'qa-run'].map((x) => lacksArea(card(1, [x]))), [false, false, false, false]);
    const rows = [card(41, ['domain:spec', 'pm:queue', 'priority:p2', 'area:build']), card(42, ['domain:spec', 'pm:queue', 'priority:p2']), card(43, ['security', 'domain:server', 'pm:queue', 'priority:p1'])];
    const get = async (p) => (p.startsWith('/search') ? { status: 200, json: { total_count: 3, incomplete_results: false } } : { status: 200, json: p.endsWith('page=1') ? rows : [] });
    const r = await sweep({ repo: REPO, nowMs: NOW, sinceMs: Date.parse('2026-11-14T20:00:00Z'), get });
    t('the walk lists exactly the card with no area', [r.noArea.map((i) => i.number), renderJson(r).no_area], [[42], [42]]);
    t('⭐ …and it is NOT a first-touch debt: nothing is owed and the verdict is CLEAN', [[...r.hits], verdictLine(r), sweepExit(r)], [[], 'sweep CLEAN — no card owed a first touch', EXIT_OK]);
    t('the text names the count and the card, after the five rows and before the verdict', renderText(r).split('\n').slice(-2)[0], 'area backstop (daily, not part of the verdict) — open cards with no area:*: 1 · all of them: #42');
  }

  battery('the CLI: what a typo must never mean, and the exits a patrol reads');
  {
    t('an unknown flag is refused', parseOptions(['--sinse=2026-11-14T00:00:00Z']).ok, false);
    t('a bad time is refused', parseOptions(['--since=yesterday']).ok, false);
    t('a window in the future is refused', parseOptions(['--since=2030-01-01T00:00:00Z'], { nowMs: NOW }).ok, false);
    t('the repo defaults to the sweep board', parseOptions([], { env: {} }).options.repo, 'objectstack-ai/objectstack');
    const quiet = (fn) => async (...a) => {
      const [l, e] = [console.log, console.error];
      console.log = () => {};
      console.error = () => {};
      try {
        return await fn(...a);
      } finally {
        console.log = l;
        console.error = e;
      }
    };
    const emptyBoard = async (p) => (p.startsWith('/search') ? { status: 200, json: { total_count: 0 } } : { status: 200, json: [] });
    const clean = await quiet(main)(['--repo=objectstack-ai/objectstack', '--since=2026-11-14T20:00:00Z'], { env: {}, nowMs: NOW, get: emptyBoard });
    t('an empty complete board, all five run, exits 0', clean, EXIT_OK);
    const partial = await quiet(main)(['--repo=objectstack-ai/objectstack'], { env: {}, nowMs: NOW, get: emptyBoard });
    t('⭐ the same board with no --since (⑤ NOT RUN) exits 4, never 0', partial, EXIT_INCOMPLETE);
    t('…and its verdict is PARTIAL, never CLEAN', verdictLine({ complete: true, hits: new Set(), fifthRun: false }).startsWith('sweep PARTIAL'));
    const gap = await quiet(main)([], { env: {}, nowMs: NOW, get: async (p) => (p.startsWith('/search') ? { status: 200, json: { total_count: 3 } } : { status: 200, json: [] }) });
    t('⭐ a count gap exits 4 (INCOMPLETE)', gap, EXIT_INCOMPLETE);
    const down = await quiet(main)([], { env: {}, nowMs: NOW, get: async () => ({ status: 0, json: null }) });
    t('an unanswered read exits 3', down, EXIT_PREREQUISITE);
  }

  const failed = cases.filter((x) => !x.ok);
  for (const f of failed) console.error(`  ✗ ${f.name} — ${f.detail}`);
  const floor = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [name, count] of batteryCases) if (!(name in SELF_TEST_BATTERIES)) floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES`);
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) floor.push(count === 0 ? `self-test battery "${name}" DID NOT RUN` : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}`);
  }
  for (const f of floor) console.error(`  ✗ ${f}`);
  if (failed.length || floor.length) {
    console.error(`✗ first-touch-sweep self-test: ${failed.length} of ${cases.length} case(s) failed${floor.length ? `, ${floor.length} floor breach(es)` : ''}.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`✓ first-touch-sweep self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest().then((code) => {
      if (!selfTestReachedVerdict) {
        console.error('\n✗ first-touch-sweep self-test: selfTest() returned without reaching its verdict, so no success line was\nprinted. Exiting 0 here would report a self-test that never finished as one that passed.\n');
        process.exit(1);
      }
      process.exit(code);
    });
  } else {
    const rearmed = rearmThroughProxy(argv);
    if (rearmed !== null) process.exit(rearmed);
    main(argv).then((code) => process.exit(code));
  }
}
