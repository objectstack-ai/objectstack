#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * topic-board — build the two datasets of the topic-and-area board (#36740).
 *
 *   node scripts/pm/topic-board.mjs --repo=objectstack --out=DIR   # writes DIR/epics.json, DIR/areas.json
 *   node scripts/pm/topic-board.mjs --repo=cloud --out=DIR         # writes DIR/epics_cloud.json, DIR/areas_cloud.json
 *   node scripts/pm/topic-board.mjs --self-test                    # offline, no network, no token
 *
 * ## Why this lives in the repo
 *
 * The board — one page, two tabs (objectstack, cloud), every open topic as a
 * collapsible tree under its `area:*`, then each area's cards that sit in no
 * topic — was built by a script that existed only in one triage session's
 * scratchpad. A scratchpad dies with its session, so a new triage seat (maybe
 * on another account) could not rebuild the board. This file is that script,
 * ported from the reference `build.py` attached to the card; the page template
 * and the 3-hourly runbook sit next to it in `topic-board/`.
 *
 * ## Read-only, and polite
 *
 * GitHub READS only, through `gh-pages.mjs` (`gh api`, the read path every
 * `scripts/pm` reader shares). No write of any kind: the only files touched are
 * the two JSON files under `--out`, and only after every read succeeded, so a
 * failed read leaves the previous files as they were (exit 3), ⛔ never a
 * partial board written as if whole.
 *
 * The footprint is the reference's, or smaller — fleet accounts have been
 * suspended before:
 *   - ONE paginated list of open issues (`/issues?state=open`, pull requests
 *     dropped client-side);
 *   - ONE paginated sub-issues read per topic;
 *   - ONE sub-issues read per sub-issue that has sub-issues of its own. The
 *     reference read every sub-issue's sub-issues unconditionally; this reads
 *     only those whose `sub_issues_summary.total` is above zero (or absent),
 *     which gives the same members with fewer requests.
 * No comment pagination and no search loops.
 *
 * ## What counts as a topic
 *
 * An OPEN card is a topic when any of these holds, unless it carries one of
 * `TOPIC_EXCLUDED` (`pm:seat`, `pm:mailbox`, `qa-run`, `eval-run`,
 * `status:parked`):
 *   - it is labelled `pm:epic`;
 *   - its title matches `TOPIC_TITLE` (`[Epic …]`, `[专题 …]`, `专题：`);
 *   - it is labelled `tracking` and has open sub-issues.
 *
 * A topic's MEMBERS are its sub-issues (any state), their sub-issues, and the
 * open cards whose body (first 2000 characters) names the topic as parent in
 * prose (`UNLINKED_PREFIX`: 承父单 / Part of epic / Under epic / Part of / 父单 /
 * epic, then `#N`) — those are the "unlinked" count.
 *
 * ## The tree
 *
 * A topic's parent is the topic that holds it as a DIRECT sub-issue; failing
 * that, a topic that holds it as a member. With several candidates the
 * smallest (fewest members, then lowest number) wins. A parent link that would
 * close a cycle is dropped. A parent's numbers roll up its descendant topics'
 * cards; topic cards themselves are never counted as members.
 *
 * ## The area table
 *
 * Open cards that are in NO topic, by `area:*` (a card with two areas counts in
 * each), skipping `AREA_EXCLUDED`. A card with no `area:*` lands in the row
 * `UNSET_AREA` 「（未定 area）」. Every area of the repo's list (`AREAS`) gets a
 * row, zero or not, in list order; an area outside the list follows, then
 * 「（未定 area）」. `topic` is 0 by construction (topic cards are left out; the
 * field is kept for the page's shape) and `topic_skipped` counts the cards left
 * out for being in a topic.
 *
 * The reference's `lanes` output is retired and not ported.
 *
 * ## Exit codes
 *
 *   0   done (or the self-test passed).
 *   1   the self-test failed.
 *   2   usage.
 *   3   a GitHub read failed; nothing was written.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';
import { ghApi, readAllPages } from './gh-pages.mjs';

export const EXIT_OK = 0;
export const EXIT_SELF_TEST = 1;
export const EXIT_USAGE = 2;
export const EXIT_READ = 3;

export const OWNER = 'objectstack-ai';

/** The areas of each repo, in board order: NORTH-STAR.md 「Product areas」 and cloud `docs/strategy/core-functions.md`. */
export const AREAS = Object.freeze({
  objectstack: Object.freeze(['ai', 'build', 'data', 'workflow', 'ux', 'package', 'fleet', 'cloud']),
  cloud: Object.freeze(['control', 'environment', 'marketplace', 'ai', 'enterprise', 'security', 'ops', 'ux', 'fleet']),
});

/** The output file suffix of each repo: the page's dataset names are `epics`/`areas` and `epics_cloud`/`areas_cloud`. */
export const SUFFIX = Object.freeze({ objectstack: '', cloud: '_cloud' });

export const TOPIC_TITLE = /^(\[(Epic|专题)[^\]]*\]|专题[:：])/;
export const TOPIC_EXCLUDED = Object.freeze(['pm:seat', 'pm:mailbox', 'qa-run', 'eval-run', 'status:parked']);
export const AREA_EXCLUDED = Object.freeze([...TOPIC_EXCLUDED, 'tracking', 'pm:epic']);
export const UNSET_AREA = '（未定 area）';
const UNLINKED_PREFIX = '(承父单|Part of epic|Under epic|Part of|父单|epic)';
const BODY_SCAN_CHARS = 2000;

/** First match in THIS order wins (not label order), so a card has exactly one state. */
export const STATES = Object.freeze([
  ['needs-user-decision', '待裁决'],
  ['pm:awaiting-maintainer', '待裁决'],
  ['pm:dispatched', '在做'],
  ['pm:awaiting-merge', '待合并'],
  ['pm:queue', '队列'],
  ['pm:blocked', '阻塞'],
  ['pm:on-hold', '搁置'],
  ['pm:retriage', '队列'],
  ['pm:triage', '队列'],
]);
const NO_STATE = '无状态';
const PRIORITIES = Object.freeze(['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3']);

const labelsOf = (i) => (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
const hasAny = (labels, set) => labels.some((l) => set.includes(l));
const stateOf = (labels) => STATES.find(([k]) => labels.includes(k))?.[1] ?? NO_STATE;
const priorityOf = (labels) => PRIORITIES.find((p) => labels.includes(p))?.slice(-2) ?? null;
const areasOf = (labels) => labels.filter((l) => l.startsWith('area:')).map((l) => l.slice(5));
const hasOpenSubs = (i) => (i.sub_issues_summary?.total ?? 0) > (i.sub_issues_summary?.completed ?? 0);
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

/** Is this open issue a topic? */
export function isTopic(issue) {
  const L = labelsOf(issue);
  if (hasAny(L, TOPIC_EXCLUDED)) return false;
  return L.includes('pm:epic') || TOPIC_TITLE.test(issue.title || '') || (L.includes('tracking') && hasOpenSubs(issue));
}

/** Does a sub-issue have sub-issues worth one read? Absent summary ⇒ read (never miss a member to save a request). */
export function mayHaveSubs(issue) {
  const s = issue.sub_issues_summary;
  return s == null || (s.total ?? 0) > 0;
}

function unlinkedPattern(repo, n) {
  // `(?![\p{L}\p{N}_])` is the reference's Unicode `\b` after a number: `#200` never matches `#2000` or `#200号`.
  return new RegExp(`${UNLINKED_PREFIX}\\s*(?:${OWNER}/${repo})?#${n}(?![\\p{L}\\p{N}_])`, 'iu');
}

/**
 * The pure core. `issues` = open issues (pull requests already dropped);
 * `subsOf(n)` = the sub-issues read of card n (an array). Returns
 * `{ epics, areas }` rows exactly as the page reads them.
 */
export function buildBoard({ repo, issues, subsOf, now = new Date() }) {
  const byNo = new Map(issues.map((i) => [i.number, i]));
  const topics = issues.filter(isTopic).map((i) => i.number).sort((a, b) => a - b);
  const info = new Map();
  const childOf = new Map(); // open card number -> topics it belongs to

  for (const n of topics) {
    const subs = subsOf(n);
    const linked = new Map(subs.map((s) => [s.number, s]));
    for (const s of subs) {
      if (!mayHaveSubs(s)) continue;
      for (const g of subsOf(s.number)) if (!linked.has(g.number)) linked.set(g.number, g);
    }
    const pat = unlinkedPattern(repo, n);
    const unlinked = new Map(
      issues
        .filter((j) => !linked.has(j.number) && j.number !== n && pat.test([...(j.body || '')].slice(0, BODY_SCAN_CHARS).join('')))
        .map((j) => [j.number, j]),
    );
    info.set(n, { direct: new Set(subs.map((s) => s.number)), linked, unlinked });
    for (const s of [...[...linked.values()].filter((x) => x.state === 'open'), ...unlinked.values()]) {
      if (!childOf.has(s.number)) childOf.set(s.number, new Set());
      childOf.get(s.number).add(n);
    }
  }

  // Tree: direct holder first, else any containing topic; the smallest wins; no cycles.
  const size = (n) => info.get(n).linked.size + info.get(n).unlinked.size;
  const parent = new Map();
  for (const m of info.keys()) {
    const c1 = [...info.keys()].filter((n) => n !== m && info.get(n).direct.has(m));
    const c2 = [...info.keys()].filter((n) => n !== m && (info.get(n).linked.has(m) || info.get(n).unlinked.has(m)));
    const cs = c1.length ? c1 : c2;
    if (cs.length) parent.set(m, cs.reduce((a, b) => (size(b) < size(a) || (size(b) === size(a) && b < a) ? b : a)));
  }
  for (const m of [...parent.keys()]) {
    let x = parent.get(m);
    for (let hops = 0; parent.has(x) && hops < 50; hops++) {
      if (parent.get(x) === m) { parent.delete(m); break; }
      x = parent.get(x);
    }
  }
  const kids = new Map();
  for (const [m, p] of parent) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(m); }
  const cardsOf = (n, seen = new Set()) => {
    if (seen.has(n)) return new Map();
    seen.add(n);
    const d = new Map([...info.get(n).linked, ...info.get(n).unlinked]);
    for (const k of kids.get(n) || []) for (const [no, c] of cardsOf(k, seen)) d.set(no, c);
    for (const no of [...d.keys()]) if (info.has(no)) d.delete(no);
    return d;
  };
  const depthOf = (n) => { let d = 0; while (parent.has(n) && d < 20) { n = parent.get(n); d++; } return d; };

  const epics = [];
  for (const n of topics) {
    const i = byNo.get(n);
    const d = cardsOf(n);
    const allOpen = [...d.values()].filter((s) => s.state === 'open');
    const total = d.size;
    const pr = new Map();
    const ar = new Map();
    const st = new Map();
    for (const s of allOpen) {
      const L = labelsOf(s);
      bump(pr, priorityOf(L));
      for (const a of areasOf(L)) bump(ar, a);
      bump(st, stateOf(L));
    }
    const L = labelsOf(i);
    const state = L.includes('pm:on-hold') || (i.title || '').includes('暂停') ? '暂停'
      : total === 0 ? '未拆卡'
        : allOpen.length === 0 ? '子卡已清空'
          : '进行中';
    const own = areasOf(L);
    const g = (m, k) => m.get(k) || 0;
    epics.push({
      epic: n,
      area: own[0] ?? null,
      parent: parent.get(n) ?? null,
      depth: depthOf(n),
      kids: (kids.get(n) || []).length,
      title: i.title,
      state,
      total,
      closed: total - allOpen.length,
      open: allOpen.length,
      unlinked: [...info.get(n).unlinked.keys()].filter((k) => !info.has(k)).length,
      p1: g(pr, 'p1') + g(pr, 'p0'),
      p2: g(pr, 'p2'),
      p3: g(pr, 'p3'),
      doing: g(st, '在做'),
      queue: g(st, '队列'),
      blocked: g(st, '阻塞'),
      hold: g(st, '搁置'),
      decide: g(st, '待裁决'),
      merge: g(st, '待合并'),
      none: g(st, NO_STATE),
      // most common first; ties keep first-seen order (a stable sort over insertion order)
      areas: [...ar].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a, c]) => `${a} ${c}`).join(' · '),
      updated: String(i.updated_at || '').slice(0, 10),
    });
  }

  // Area table: open cards in no topic.
  const list = AREAS[repo];
  const counts = new Map(list.map((a) => [a, new Map()]));
  let topicSkipped = 0;
  for (const i of issues) {
    const L = labelsOf(i);
    if (hasAny(L, AREA_EXCLUDED)) continue;
    if (childOf.has(i.number)) { topicSkipped++; continue; }
    const p = priorityOf(L);
    const s = stateOf(L);
    const al = areasOf(L);
    for (const a of al.length ? al : [UNSET_AREA]) {
      if (!counts.has(a)) counts.set(a, new Map());
      const r = counts.get(a);
      bump(r, s); bump(r, 'open');
      if (p === 'p0' || p === 'p1') bump(r, 'p1');
      else if (p) bump(r, p);
    }
  }
  const rank = (a) => (a === UNSET_AREA ? 2 : list.includes(a) ? 0 : 1);
  const asof = `${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)} UTC`;
  const areas = [...counts.keys()]
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? list.indexOf(a) - list.indexOf(b) : (counts.get(b).get('open') || 0) - (counts.get(a).get('open') || 0) || (a < b ? -1 : a > b ? 1 : 0)))
    .map((a) => {
      const c = counts.get(a);
      const g = (k) => c.get(k) || 0;
      return {
        area: a, open: g('open'), p1: g('p1'), p2: g('p2'), p3: g('p3'), topic: 0, nontopic: g('open'),
        doing: g('在做'), queue: g('队列'), blocked: g('阻塞'), hold: g('搁置'), decide: g('待裁决'), none: g(NO_STATE),
        asof, topic_skipped: topicSkipped,
      };
    });
  return { epics, areas };
}

/**
 * Every read the board needs, through `get` (default: `gh api`). Returns
 * `{ ok: true, issues, subs, requests }` or `{ ok: false, error, requests }`.
 * Sub-issue reads are memoised: a card under two topics is read once.
 */
export function readBoard(repo, { get = ghApi } = {}) {
  let requests = 0;
  const counted = (p) => { requests++; return get(p); };
  const R = `repos/${OWNER}/${repo}`;
  const all = readAllPages(`${R}/issues?state=open`, { get: counted });
  if (!all.ok) return { ok: false, error: all.error, requests };
  const issues = all.value.filter((i) => !('pull_request' in i));
  const subs = new Map();
  let failure = null;
  const subsOf = (n) => {
    if (failure) return [];
    if (!subs.has(n)) {
      const r = readAllPages(`${R}/issues/${n}/sub_issues`, { get: counted });
      if (!r.ok) { failure = r.error; return []; }
      subs.set(n, r.value);
    }
    return subs.get(n);
  };
  // Walk the same reads `buildBoard` will make, so a failure surfaces before anything is built or written.
  for (const t of issues.filter(isTopic)) for (const s of subsOf(t.number)) if (mayHaveSubs(s)) subsOf(s.number);
  if (failure) return { ok: false, error: failure, requests };
  return { ok: true, issues, subs, requests };
}

/** One row per line, so two builds diff by row. */
export const toJson = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;

export function parseArgs(argv) {
  const o = { repo: 'objectstack', out: null, selfTest: false };
  for (const a of argv) {
    if (a === '--self-test') o.selfTest = true;
    else if (a.startsWith('--repo=')) o.repo = a.slice(7);
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else return { error: `unknown argument: ${a}` };
  }
  if (o.selfTest) return o;
  if (!Object.hasOwn(AREAS, o.repo)) return { error: `--repo must be one of: ${Object.keys(AREAS).join(', ')}` };
  if (!o.out) return { error: '--out=DIR is required' };
  return o;
}

function run(o) {
  const read = readBoard(o.repo);
  if (!read.ok) {
    console.error(`topic-board: a GitHub read failed after ${read.requests} request(s); nothing written.\n  ${read.error}`);
    return EXIT_READ;
  }
  const { epics, areas } = buildBoard({ repo: o.repo, issues: read.issues, subsOf: (n) => read.subs.get(n) || [] });
  const suf = SUFFIX[o.repo];
  mkdirSync(o.out, { recursive: true });
  const ef = join(o.out, `epics${suf}.json`);
  const af = join(o.out, `areas${suf}.json`);
  writeFileSync(ef, toJson(epics));
  writeFileSync(af, toJson(areas));
  for (const r of epics) console.log(`${'  '.repeat(r.depth)}#${r.epic} ${r.state} open ${r.open}/${r.total} p1 ${r.p1} unlinked ${r.unlinked} · ${r.title.slice(0, 50)}`);
  for (const r of areas) console.log(`AREA ${r.area}: open ${r.open} p1 ${r.p1} doing ${r.doing} queue ${r.queue} none ${r.none}`);
  console.log(`topic-board: ${o.repo} · ${read.issues.length} open issues · ${epics.length} topics · ${areas.length} area rows · ${read.requests} GET request(s)\n  wrote ${ef}\n  wrote ${af}`);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// --self-test: offline, on a small fixture.

const lab = (...names) => names.map((name) => ({ name }));
const card = (number, title, labels = [], extra = {}) => ({ number, title, labels: lab(...labels), state: 'open', body: '', updated_at: '2026-11-23T00:00:00Z', ...extra });

export function selfTest() {
  let failed = 0;
  const t = (name, ok, detail = '') => { if (!ok) { failed++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); } else console.log(`  ✓ ${name}`); };
  const eq = (name, got, want) => t(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

  // Topic detection.
  eq('pm:epic is a topic', isTopic(card(1, 'x', ['pm:epic'])), true);
  eq('[Epic] title is a topic', isTopic(card(1, '[Epic] x')), true);
  eq('[专题 …] title is a topic', isTopic(card(1, '[专题 AI] x')), true);
  eq('专题： title is a topic', isTopic(card(1, '专题：x')), true);
  eq('tracking with open subs is a topic', isTopic(card(1, 'x', ['tracking'], { sub_issues_summary: { total: 2, completed: 1 } })), true);
  eq('tracking with every sub closed is not', isTopic(card(1, 'x', ['tracking'], { sub_issues_summary: { total: 2, completed: 2 } })), false);
  eq('pm:seat excludes a [Epic] title', isTopic(card(1, '[Epic] seat', ['pm:seat'])), false);
  eq('a title that only mentions an epic is not', isTopic(card(1, 'fix the [Epic] page')), false);

  // Fixture: 100 (big, holds 200 directly and 300 as a grandchild), 200 (under 100), 300 (tracking, under 200 directly),
  // 400 (alone, holds nothing), cycle 500 <-> 600.
  const issues = [
    card(100, '[Epic] big', ['pm:epic', 'area:ai']),
    card(200, '[专题] middle', ['pm:epic', 'area:ai']),
    card(300, 'tracking card', ['tracking', 'area:data'], { sub_issues_summary: { total: 1, completed: 0 } }),
    card(400, '专题：empty, 暂停', ['pm:epic']),
    card(500, '[Epic] loop a', ['pm:epic']),
    card(600, '[Epic] loop b', ['pm:epic']),
    card(11, 'a', ['area:ai', 'priority:p0', 'pm:dispatched']),
    card(12, 'b', ['area:ai', 'priority:p2', 'pm:queue']),
    card(21, 'c', ['area:data', 'priority:p1', 'needs-user-decision', 'pm:queue']),
    card(31, 'd', ['area:data', 'priority:p3']),
    card(41, 'prose child', ['area:ux'], { body: 'Part of epic #200 — not linked' }),
    card(42, 'prose names #2000 only', ['area:ux'], { body: 'Part of #2000' }),
    card(43, 'prose names #200号 only', ['area:ux'], { body: '父单 #200号' }),
    card(51, 'no area, no state', []),
    card(52, 'two areas', ['area:ux', 'area:build', 'priority:p1', 'pm:blocked']),
    card(53, 'seat post', ['pm:seat', 'area:fleet']),
  ];
  const closedSub = { ...card(13, 'closed'), state: 'closed' };
  const SUBS = {
    100: [card(200, '[专题] middle', ['pm:epic'], { sub_issues_summary: { total: 3, completed: 0 } }), card(11, 'a', ['area:ai', 'priority:p0', 'pm:dispatched'], { sub_issues_summary: { total: 0, completed: 0 } })],
    200: [card(300, 'tracking card', ['tracking'], { sub_issues_summary: { total: 1, completed: 0 } }), card(12, 'b', ['area:ai', 'priority:p2', 'pm:queue'], { sub_issues_summary: { total: 0, completed: 0 } }), { ...closedSub, sub_issues_summary: { total: 0, completed: 0 } }],
    300: [card(21, 'c', ['area:data', 'priority:p1', 'needs-user-decision', 'pm:queue'])],
    400: [],
    500: [card(600, '[Epic] loop b', ['pm:epic'], { sub_issues_summary: { total: 0, completed: 0 } })],
    600: [card(500, '[Epic] loop a', ['pm:epic'], { sub_issues_summary: { total: 0, completed: 0 } })],
    21: [],
  };
  const { epics, areas } = buildBoard({ repo: 'objectstack', issues, subsOf: (n) => SUBS[n] || [], now: new Date('2026-11-23T15:00:00Z') });
  const E = Object.fromEntries(epics.map((r) => [r.epic, r]));
  eq('topic set', epics.map((r) => r.epic), [100, 200, 300, 400, 500, 600]);

  // Parent choice.
  eq('200 under 100 (direct holder)', E[200].parent, 100);
  eq('300 under 200: the direct holder wins over 100, which also contains it', E[300].parent, 200);
  eq('depth follows the chain', [E[100].depth, E[200].depth, E[300].depth], [0, 1, 2]);
  eq('kids counted', [E[100].kids, E[200].kids, E[300].kids], [1, 1, 0]);
  eq('a cycle keeps exactly one parent link', [E[500].parent, E[600].parent].filter((p) => p != null).length, 1);
  eq('a lone topic has no parent', E[400].parent, null);

  // Rollup: 300 holds 21; 200 holds 300's 21 + 12 + closed 13 + unlinked 41; 100 holds 11 + all of 200's.
  eq('leaf topic counts', [E[300].total, E[300].open, E[300].p1, E[300].decide], [1, 1, 1, 1]);
  eq('middle topic rolls up its child and its unlinked card', [E[200].total, E[200].open, E[200].closed, E[200].unlinked], [4, 3, 1, 1]);
  eq('top topic rolls up the whole tree', [E[100].total, E[100].open, E[100].p1, E[100].p2, E[100].doing], [5, 4, 2, 1, 1]);
  eq('topic cards are never members', E[100].total, 5);
  eq('area mix, most common first', E[100].areas, 'ai 2 · data 1 · ux 1');
  eq('states', [E[100].state, E[400].state], ['进行中', '暂停']);
  eq('own area', [E[100].area, E[400].area], ['ai', null]);
  eq('#2000 and #200号 in prose do not match #200', E[200].unlinked, 1);

  // Area table: 11, 12, 21, 41 sit in topics and are left out; 31, 42, 51, 52 count; 53 (pm:seat) and topic cards skip.
  const A = Object.fromEntries(areas.map((r) => [r.area, r]));
  eq('area rows: every listed area in order, then 未定', areas.map((r) => r.area), ['ai', 'build', 'data', 'workflow', 'ux', 'package', 'fleet', 'cloud', UNSET_AREA]);
  eq('topic cards left out of the area table', [A.ai.open, A.data.open], [0, 1]);
  eq('topic_skipped counts them', A.ai.topic_skipped, 4);
  eq('a card in two areas counts in each', [A.ux.open, A.build.open, A.ux.p1, A.ux.blocked], [3, 1, 1, 1]);
  eq('the （未定 area） row holds the area-less card, stateless', [A[UNSET_AREA].open, A[UNSET_AREA].none], [1, 1]);
  eq('a pm:seat card is skipped', A.fleet.open, 0);
  eq('asof stamp', A.ai.asof, '2026-11-23 15:00 UTC');

  // Read path: pacing and failure.
  const pages = {
    'repos/objectstack-ai/cloud/issues?state=open&per_page=100&page=1': [
      card(1, '[Epic] one', ['pm:epic']), card(2, 'child', ['area:ops']), { number: 3, title: 'a PR', labels: [], pull_request: {} },
    ],
    'repos/objectstack-ai/cloud/issues/1/sub_issues?per_page=100&page=1': [card(2, 'child', ['area:ops'], { sub_issues_summary: { total: 0, completed: 0 } }), card(4, 'grand', [], { sub_issues_summary: { total: 1, completed: 0 } })],
    'repos/objectstack-ai/cloud/issues/4/sub_issues?per_page=100&page=1': [],
  };
  const seen = [];
  const get = (p) => { seen.push(p); return Object.hasOwn(pages, p) ? { ok: true, value: pages[p] } : { ok: false, error: `404 ${p}` }; };
  const read = readBoard('cloud', { get });
  eq('read: pull requests dropped', read.ok && read.issues.map((i) => i.number), [1, 2]);
  eq('read: one list + one sub-issues read per topic + one per sub-issue that has subs', read.requests, 3);
  eq('read: a sub-issue without subs is not read', seen.some((p) => p.includes('/issues/2/sub_issues')), false);
  const bad = readBoard('cloud', { get: (p) => (p.includes('/issues/1/sub_issues') ? { ok: false, error: 'HTTP 502' } : get(p)) });
  eq('read: a failed sub-issues read fails the whole read', [bad.ok, bad.error], [false, 'HTTP 502']);

  // Arguments and output shape.
  eq('args: default repo needs --out', parseArgs([]).error, '--out=DIR is required');
  eq('args: unknown repo refused', Boolean(parseArgs(['--repo=hotcrm', '--out=x']).error), true);
  eq('args: cloud', parseArgs(['--repo=cloud', '--out=d']), { repo: 'cloud', out: 'd', selfTest: false });
  eq('json: one row per line, parses back', JSON.parse(toJson(areas)).length, areas.length);

  if (failed) { console.error(`topic-board self-test: ${failed} FAILED`); return EXIT_SELF_TEST; }
  console.log('topic-board self-test: all passed');
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) { console.error(`topic-board: ${o.error}\n  usage: node scripts/pm/topic-board.mjs --repo=objectstack|cloud --out=DIR | --self-test`); process.exit(EXIT_USAGE); }
  process.exit(o.selfTest ? selfTest() : run(o));
}
