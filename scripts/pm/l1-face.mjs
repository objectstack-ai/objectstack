#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * l1-face — the MECHANICAL face of `references/l1-review-checklist.md` for one PR at its current head.
 *
 *   node scripts/pm/l1-face.mjs --pr 35576
 *   node scripts/pm/l1-face.mjs --pr 35576 --repo objectstack-ai/objectstack --json
 *   node scripts/pm/l1-face.mjs --pr 7 --fixture pr.json      # offline: the fixture answers every read
 *   node scripts/pm/l1-face.mjs --self-test                   # offline, no network at all
 *
 * ## Why this file exists
 *
 * The L1 checklist asks every seat to re-read the same mechanical facts by hand on every dev report: the PR's shape,
 * the card relation its first line declares, whether a closing keyword sits next to another OPEN card, the release
 * path, a changeset per published package, the declaration lines, the two floor checks at the head, every other check,
 * whether the dogfood battery is owed, and the `+0/-0` NUL suspects. This file is that reading, one line per item with
 * its verdict — `ok`, `flag` or `not measured` — and the evidence. ⛔ It writes nothing, and it is a READER, not a
 * gate: no exit code here is a merge condition.
 *
 * ## What it reads — REST through `gh api`, every page
 *
 *   1. `pr-state.mjs`'s own reading (`readPrState`, never re-spelled): the PR row, the head's check-runs judged with
 *      `check-expected-skips.mjs`' roster, and its one state line; this file taps the row and the check-run rows off
 *      that same walk, so the head every item is judged at is the head pr-state read;
 *   2. `/pulls/N/files`, every page, its length checked against the row's `changed_files`;
 *   3. `/issues/N` for the card the first line names and for every other number a closing keyword binds — the ONE
 *      shared parser (`check-half-states.mjs`, registered in `check-closing-keyword-parity.mjs`), ⛔ no fourth;
 *   4. `/contents/…/package.json?ref=HEAD` walking up from each changed path to its nearest manifest, memoised per
 *      directory (`private: true` is unpublished; anything else ships), and each `.changeset/*.md` in the diff, read
 *      with `check-changeset-no-major.mjs`' `entriesIn` (⛔ no fifth copy of the entry regex);
 *   5. `/git/blobs/SHA` for every `+0/-0` file: NUL bytes and lines, the blob's own answer.
 *
 * The `Clause-②:` and `Metadata-protocol:` lines are read by `clause2-line.mjs`, and the dogfood markers by
 * `label-write.mjs`' `landDogfoodMarkers` — the readers the gates use.
 *
 * ## What it does NOT read — named in the footer of every run
 *
 * `UNREAD_ITEMS`: every checklist item that is the reviewer's judgement, so an absent face never reads as clean.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  every item read, none flagged
 *   1  `--self-test` failed
 *   2  usage
 *   3  the PR row could not be read
 *   4  INCOMPLETE — an item was not measured (named on its line); flags, if any, are printed too
 *   5  FLAGGED — every item read, at least one flagged
 *
 * ## Self-test
 *
 * `--self-test` drives every item and the CLI against offline fixtures, with the floor and the handshake AGENTS.md §
 * "Writing a `--self-test`" requires (copied, never imported), and pins the checklist phrases each item encodes.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { entriesIn } from '../check-changeset-no-major.mjs';
import { REQUIRED_CONTEXTS } from '../check-required-contexts.mjs';
import { closingKeywordTargets, DECISION_INBOX_LABEL, DEFAULT_SWEEP_REPO, h7PartOfWithClosingKeyword, partOfDeclarationTargets, partOfTargets, refsTargets, SEAT_SIGNATURE_LINE, stripMarkdownCode } from './check-half-states.mjs';
import { readClause2Line, readMetadataProtocolLine } from './clause2-line.mjs';
import { ghApi, readAllPages } from './gh-pages.mjs';
import { landDogfoodMarkers } from './label-write.mjs';
import { fixtureReaders, gitLsRemote, readPrState } from './pr-state.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);

export const EXIT_OK = 0;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_PR_UNREADABLE = 3;
export const EXIT_INCOMPLETE = 4;
export const EXIT_FLAGGED = 5;

export const OK = 'ok';
export const FLAG = 'flag';
export const NOT_MEASURED = 'not measured';

export const CHECKLIST_PATH = '.claude/skills/pm-dispatch/references/l1-review-checklist.md';
/** The two jobs the checklist names as the required FLOOR a reviewer confirms by hand (its line, pinned below). */
export const FLOOR_CHECKS = Object.freeze(['Lint & Repo Gates', 'TypeScript Type Check']);
export const SKIP_CHANGESET_LABEL = 'skip-changeset';
export const RELEASES_PREFIX = 'content/docs/releases/';
/** Reads the package walk may spend before it stops and the item reads `not measured`. */
export const CONTENTS_READ_CAP = 150;
/** `+0/-0` blobs read per run; past it the rest are `not measured`. */
export const BLOB_READ_CAP = 25;
/** Extensions whose `+0/-0` is a binary file by kind, never a NUL suspect. */
export const BINARY_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'zip', 'gz', 'tgz', 'wasm', 'mp3', 'mp4', 'webm', 'wav', 'sqlite', 'db', 'jar']);

/** Where the rules live, and the phrases this file is built from — the self-test pins each one present. */
export const RULE_FILES = Object.freeze({
  [CHECKLIST_PATH]: [
    'PR 存在、是 draft、目标 `main`,正文首行引用卡片',
    '`Fixes #<n>` 仅当合并应当关卡',
    '⛔ 关键词永不挨另一张 open 卡编号',
    '无 `content/docs/releases/` 改动、用户可见改动有 changeset',
    '`Skills-docs:` 行在且属实;`follow-up owed` 立卡改 `#N`',
    '本仓库走 `skip-changeset` 标签,⛔ 不走空 changeset',
    '每个被触及的包,`private: false` 即已发布 ⇒ 读 `package.json` 核 changeset 在不在',
    '亲核 Lint & Repo Gates 与 TypeScript Type Check 皆 `success`',
    '入队另要求全 check 绿',
    '门禁读数钉当前 head',
    '`!` 或 `(narrowing)`:入队前核 `dogfood_battery`',
    '`+0/-0` 先疑 NUL,以 blob 定论',
    '要求源侧写转义序列',
    '`l1-face.mjs --pr N`',
    'dev 挂 `skip-changeset` 遭分类器拒 ⇒ 席位转维护者定夺',
    '把发送或写挪到应答之后的 PR',
  ],
  '.claude/agents/os-dev.md': ['⛔ 永不 `Fixes` 一张还在决策箱的卡', '种类非 `none` 或带 `(narrowing)` ⇒ 按 diff 加写 `Skills-docs:` 行'],
});

/** The checklist items this face does not read — the reviewer's judgement — printed under every run. */
export const UNREAD_ITEMS = Object.freeze([
  'whether `Fixes` is right — does merging deliver the whole card, or only the implementable half (then `Part of`)',
  'the body read by eye past the parser: negations, bookkeeping sentences and quotes re-arm a close; a qualified OWNER/NAME#N is not read here',
  'a `Part of` card keeps `pm:dispatched` until removed by hand (landing rule B), recorded at ACCEPT',
  'files outside the card or past its `Scope-review:` line',
  'whether the `Skills-docs:` value is true',
  "whether a published package's touched files ship (`files[]`), and published defects this round made false or touched",
  'who hung `skip-changeset`: a dev label the classifier refused goes to the maintainer through the seat, never hung by the seat itself; both premises in the comment, the refused command in `deviations`',
  'a PR that moves a send or a write after the response: grep `packages/qa/dogfood/test` for a case that reads the side effect right after the response, made a bounded wait in the same PR',
  'adjacent in-place fixes (the four conditions), one-shot codegen in the diff, move/split growth past a pure move',
  'test evidence: real commands and output, positive controls, `.d.ts` byte-identity readings, git-answerable API reads',
  "gate readings in the report pinned to this head, and the report's `dogfood_battery` against it",
  'assertions and benefit (the envelope `code`/`status`, sweep direction and build order), premise, stop conditions and deletions',
  "`mergeable_state`, the queue and reviews — read with `pr-state.mjs` (its line is printed above)",
]);

// ---------------------------------------------------------------------------
// Pure readers over the body and the rows
// ---------------------------------------------------------------------------

/** A harness or seat attribution line the body opens with (the seat signature included) — skipped before the first line is read. */
export function isAttributionLine(line) {
  const s = line.trim();
  return s === '' || /^<!--\s*claude-projects-attribution:.*-->$/.test(s) || /^_Requested by .+_$/.test(s) || SEAT_SIGNATURE_LINE.test(s);
}

/** The body's first line after the harness attribution lines, or `null`. */
export function firstContentLine(body) {
  for (const line of String(body ?? '').split(/\r?\n/)) if (!isAttributionLine(line)) return line.trim();
  return null;
}

/** The card the first line declares, by the shared parser: `{ card, relation }` or `null`. */
export function firstLineCard(line) {
  if (!line) return null;
  const closing = closingKeywordTargets(line);
  if (closing.size) {
    const [n, word] = [...closing][0];
    return { card: Number(n), relation: word };
  }
  const partOf = partOfDeclarationTargets(line);
  if (partOf.size) return { card: Number([...partOf][0]), relation: 'Part of' };
  const refs = refsTargets(line);
  if (refs.size) return { card: Number([...refs.keys()][0]), relation: 'Refs' };
  return null;
}

/** The line-start `Skills-docs:` value outside fenced blocks (the shared fence rule, `stripMarkdownCode`), or `null` — an empty value is no line. */
export function readSkillsDocsLine(body) {
  for (const line of stripMarkdownCode(body, { inline: false }).split(/\r?\n/)) {
    const m = /^Skills-docs:[ \t]*(.*)$/.exec(line);
    if (m) return m[1].trim() || null;
  }
  return null;
}

const labelNames = (row) => (row?.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const short = (sha) => String(sha ?? '').slice(0, 10);
const ext = (path) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
const decode = (v) => (v && v.encoding === 'base64' && typeof v.content === 'string' ? Buffer.from(v.content, 'base64') : null);
const is404 = (error) => /\b404\b/.test(String(error));
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

/** The directories from a path's own up to the root (`''`), deepest first. */
export function dirsUp(path) {
  const parts = String(path).split('/').slice(0, -1);
  const out = [];
  for (let k = parts.length; k >= 0; k--) out.push(parts.slice(0, k).join('/'));
  return out;
}

/** The diff paths the checklist owes a sentence-by-sentence read (changeset/CHANGELOG, `content/docs/**`, `apps/docs/**`). */
export function owedSentenceReads(files) {
  return files.map((f) => f.filename).filter((p) => /^\.changeset\/.+\.md$/.test(p) || /(^|\/)CHANGELOG\.md$/.test(p) || p.startsWith('content/docs/') || p.startsWith('apps/docs/'));
}

// ---------------------------------------------------------------------------
// The face
// ---------------------------------------------------------------------------

/**
 * Read one PR's mechanical L1 face. `get` answers `{ ok, value | error }` (`ghApi`'s shape); `lsRemote`, `sleep`
 * and `roster` go to `readPrState` unchanged.
 */
export function readFace({ repo, number, get = ghApi, lsRemote = gitLsRemote, sleep, roster = null }) {
  const tap = { pr: null, runs: [] };
  const prPath = `/repos/${repo}/pulls/${number}`;
  const tapped = (path) => {
    const r = get(path);
    const bare = path.split('?')[0];
    if (r.ok && bare === prPath) tap.pr = r.value;
    if (r.ok && /\/commits\/[0-9a-f]+\/check-runs$/.test(bare) && Array.isArray(r.value?.check_runs)) tap.runs.push(...r.value.check_runs);
    return r;
  };
  // mergeable_state is pr-state's reading, not this face's: no re-reads, no waits.
  const state = readPrState({ repo, number, get: tapped, lsRemote, sleep, rereads: 0, roster });
  if (!tap.pr) return { number, unreadable: state.json.error ?? 'the PR row did not answer', items: [], exit: EXIT_PR_UNREADABLE };
  const pr = tap.pr;
  const head = pr.head?.sha ?? null;
  const body = pr.body ?? '';
  const labels = labelNames(pr);
  const items = [];
  const item = (id, verdict, evidence) => items.push({ id, verdict, evidence });

  // -- PR shape ------------------------------------------------------------------------------------------------------
  {
    const bad = [];
    if (pr.merged_at) bad.push(`MERGED ${pr.merged_at}`);
    else if (pr.state !== 'open') bad.push('CLOSED unmerged');
    else if (!pr.draft) bad.push('ready, not draft (L1 reads a draft; a ready flip is the seat\'s)');
    if ((pr.base?.ref ?? null) !== 'main') bad.push(`base \`${pr.base?.ref ?? '?'}\`, not \`main\``);
    item('shape', bad.length ? FLAG : OK, bad.length ? bad.join(' · ') : 'open · draft · base `main`');
  }

  // -- the card relation ---------------------------------------------------------------------------------------------
  const first = firstContentLine(body);
  const declared = firstLineCard(first);
  if (!declared) item('first-line', FLAG, `the first line after the attribution lines names no card: ${JSON.stringify(first ?? '')}`);
  else item('first-line', OK, `\`${declared.relation} #${declared.card}\` — ${JSON.stringify(first)}`);

  const closing = closingKeywordTargets(body);
  const issueCache = new Map();
  const readIssue = (n) => {
    if (!issueCache.has(n)) issueCache.set(n, get(`/repos/${repo}/issues/${n}`));
    return issueCache.get(n);
  };
  if (declared) {
    const card = String(declared.card);
    const h7 = h7PartOfWithClosingKeyword({ body });
    const c = readIssue(declared.card);
    if (h7) item('relation', FLAG, h7);
    else if (!c.ok) item('relation', NOT_MEASURED, `card #${card} did not read (${c.error})`);
    else {
      const inbox = labelNames(c.value).includes(DECISION_INBOX_LABEL);
      const st = `#${card} ${c.value.state}${labelNames(c.value).length ? ` [${labelNames(c.value).join(', ')}]` : ''}`;
      if (closing.has(card) && inbox) item('relation', FLAG, `\`${closing.get(card)} #${card}\` on a card still in the decision inbox (\`${DECISION_INBOX_LABEL}\`): merging closes it silently — ${st}`);
      else if (closing.has(card)) item('relation', OK, `\`${closing.get(card)} #${card}\` — merging closes the card (${st}); whether it delivers the whole card is the reviewer's`);
      else item('relation', OK, `${partOfTargets(body).has(card) ? '`Part of`' : `\`${declared.relation}\``} — no closing keyword bound to #${card} (${st})`);
    }
  } else item('relation', NOT_MEASURED, 'no card on the first line, so the relation to it is unread');

  {
    const others = [...closing].filter(([n]) => !declared || n !== String(declared.card));
    const open = [];
    const unread = [];
    const quiet = [];
    for (const [n, word] of others) {
      const r = readIssue(Number(n));
      if (!r.ok) {
        if (is404(r.error)) quiet.push(`\`${word} #${n}\` (no such issue)`);
        else unread.push(`#${n} (${r.error})`);
      } else if (r.value.pull_request) quiet.push(`\`${word} #${n}\` (a PR)`);
      else if (r.value.state === 'open') open.push(`\`${word} #${n}\``);
      else quiet.push(`\`${word} #${n}\` (closed)`);
    }
    if (open.length) item('keywords-other-cards', FLAG, `a closing keyword binds another OPEN card — merging closes it: ${open.join(', ')}${quiet.length ? ` · also ${quiet.join(', ')}` : ''}`);
    else if (unread.length) item('keywords-other-cards', NOT_MEASURED, `bound card(s) did not read: ${unread.join(', ')}`);
    else item('keywords-other-cards', OK, others.length ? `no other OPEN card bound: ${quiet.join(', ')}` : 'no closing keyword binds any other card');
  }

  // -- the diff --------------------------------------------------------------------------------------------------------
  const listed = readAllPages(`/repos/${repo}/pulls/${number}/files`, { get });
  let files = null;
  let filesGap = null;
  if (!listed.ok) filesGap = `the file listing did not read (${listed.error})`;
  else if (typeof pr.changed_files === 'number' && listed.value.length !== pr.changed_files) filesGap = `the file listing returned ${listed.value.length} and the row counts ${pr.changed_files} changed files`;
  else files = listed.value;

  if (!files) {
    for (const id of ['releases-path', 'changeset', 'empty-changeset', 'nul-suspects']) item(id, NOT_MEASURED, filesGap);
  } else {
    const rel = files.filter((f) => f.filename.startsWith(RELEASES_PREFIX) || String(f.previous_filename ?? '').startsWith(RELEASES_PREFIX)).map((f) => f.filename);
    item('releases-path', rel.length ? FLAG : OK, rel.length ? `the diff touches \`${RELEASES_PREFIX}\`: ${rel.join(', ')}` : `no \`${RELEASES_PREFIX}\` path in ${files.length} file(s)`);
    changesetItems({ repo, head, files, labels, get, item });
    nulItem({ repo, files, get, item });
  }

  // -- declarations ----------------------------------------------------------------------------------------------------
  const c2 = readClause2Line(body);
  const mp = readMetadataProtocolLine(body);
  const say = (key, r) => (r === null ? `no \`${key}:\` line` : r.kind === 'declared' ? `\`${key}: ${r.value}${r.arm ? ` (${r.arm})` : ''}\`` : `\`${key}:\` ${r.kind}${r.reason ? ` (${r.reason})` : ''}: ${r.line}`);
  const bothRead = c2?.kind === 'declared' && mp?.kind === 'declared';
  item('declarations', bothRead ? OK : FLAG, `${say('Clause-②', c2)} · ${say('Metadata-protocol', mp)}`);
  if (!bothRead) item('skills-docs', NOT_MEASURED, 'the declaration lines did not both read, so whether a `Skills-docs:` line is owed is unread');
  else {
    const owed = mp.value !== 'none' || c2.arm === 'narrowing';
    const sd = readSkillsDocsLine(body);
    if (!owed) item('skills-docs', OK, `not owed (kind \`${mp.value}\`, no \`(narrowing)\` arm)${sd === null ? '' : ` · present anyway: ${sd}`}`);
    else if (sd === null) item('skills-docs', FLAG, `owed (kind \`${mp.value}\`${c2.arm === 'narrowing' ? ', `(narrowing)` arm' : ''}) and absent — REWORK`);
    else if (/follow-up owed/i.test(sd)) item('skills-docs', FLAG, `\`Skills-docs: ${sd}\` — the owed card is filed and the line rewritten to \`#N\` before ACCEPT`);
    else item('skills-docs', OK, `\`Skills-docs: ${sd}\` — its truth is the reviewer's`);
  }

  // -- gate evidence at the head -----------------------------------------------------------------------------------------
  const checks = state.json.checks;
  if (!checks) item('floor-checks', NOT_MEASURED, `the head's check-runs did not read — ${state.gaps.join('; ') || 'no reading'}`);
  else {
    const parts = [];
    let verdict = OK;
    for (const name of FLOOR_CHECKS) {
      const runs = tap.runs.filter((r) => r.name === name);
      const done = runs.filter((r) => r.status === 'completed');
      if (runs.length === 0) {
        parts.push(`${name}: absent at ${short(head)}`);
        verdict = checks.pending.length ? (verdict === FLAG ? FLAG : NOT_MEASURED) : FLAG;
      } else if (done.length < runs.length) {
        parts.push(`${name}: ${runs.find((r) => r.status !== 'completed').status}`);
        if (verdict !== FLAG) verdict = NOT_MEASURED;
      } else if (done.every((r) => r.conclusion === 'success')) parts.push(`${name}: success`);
      else {
        parts.push(`${name}: ${done.map((r) => r.conclusion).join(',')}`);
        verdict = FLAG;
      }
    }
    item('floor-checks', verdict, `at ${short(head)} — ${parts.join(' · ')}`);
  }
  if (!checks) item('all-checks', NOT_MEASURED, 'the head\'s check-runs did not read');
  else if (checks.kind === 'empty') item('all-checks', NOT_MEASURED, `no check-run on ${short(head)} yet`);
  else {
    const failed = checks.other.filter((o) => o.conclusion !== 'neutral');
    const text = `${checks.success} success · ${checks.expected_skips} expected-skip name(s) · ${checks.unexpected_skips.length} unexpected skip${checks.unexpected_skips.length ? ` (${checks.unexpected_skips.join(', ')})` : ''} · ${failed.length} failed${failed.length ? ` (${failed.map((f) => `${f.name}=${f.conclusion}`).join(', ')})` : ''} · ${checks.pending.length} pending${checks.pending.length ? ` (${checks.pending.join(', ')})` : ''}`;
    item('all-checks', failed.length || checks.unexpected_skips.length ? FLAG : checks.pending.length ? NOT_MEASURED : OK, `at ${short(head)} (pr-state) — ${text}`);
  }
  {
    const m = landDogfoodMarkers({ title: pr.title, body });
    if (m.unreadable) item('dogfood', NOT_MEASURED, m.unreadable);
    else if (m.markers.length) item('dogfood', FLAG, `owed — ${m.markers.join(' and ')}: the full battery on ${short(head)}, recorded under \`dogfood_battery\` (flagged, not judged)`);
    else item('dogfood', OK, 'not owed (no `!` before the title\'s colon, no `(narrowing)` arm)');
  }

  const owed = files ? owedSentenceReads(files) : null;
  const exit = items.some((i) => i.verdict === NOT_MEASURED) ? EXIT_INCOMPLETE : items.some((i) => i.verdict === FLAG) ? EXIT_FLAGGED : EXIT_OK;
  return { number, repo, head, title: pr.title ?? '', stateLine: state.line, items, owed, exit };
}

/** The published-package changeset item and the empty-changeset item. */
function changesetItems({ repo, head, files, labels, get, item }) {
  const memo = new Map();
  let reads = 0;
  const manifestAt = (dir) => {
    if (memo.has(dir)) return memo.get(dir);
    if (reads >= CONTENTS_READ_CAP) return { ok: false, error: `the package walk stopped at its cap of ${CONTENTS_READ_CAP} reads` };
    reads++;
    const r = get(`/repos/${repo}/contents/${encodePath(dir ? `${dir}/package.json` : 'package.json')}?ref=${head}`);
    let out;
    if (!r.ok) out = is404(r.error) ? { ok: true, manifest: null } : { ok: false, error: r.error };
    else {
      try {
        out = { ok: true, manifest: JSON.parse(decode(r.value)?.toString('utf8') ?? 'null') };
      } catch (e) {
        out = { ok: false, error: `${dir || '.'}/package.json did not parse (${e.message})` };
      }
    }
    memo.set(dir, out);
    return out;
  };
  // Every manifest between a path and the root is read, not only the nearest: a private manifest nested inside a
  // published package (a scaffold template its build ships in the parent's `dist`) does not make the path
  // unpublished. The nearest manifest that is not `private: true` owns the path; with none, the nearest one is
  // listed as unpublished.
  const owners = new Map();
  let walkGap = null;
  for (const f of files) {
    for (const path of [f.filename, f.previous_filename].filter(Boolean)) {
      const chain = [];
      for (const dir of dirsUp(path)) {
        const m = manifestAt(dir);
        if (!m.ok) {
          walkGap ??= m.error;
          break;
        }
        if (m.manifest) chain.push({ dir, manifest: m.manifest });
      }
      const owner = chain.find((c) => c.manifest.private !== true) ?? chain[0];
      if (walkGap || !owner) continue;
      if (!owners.has(owner.dir)) owners.set(owner.dir, { dir: owner.dir || '.', name: owner.manifest.name ?? `(unnamed ${owner.dir || '.'})`, published: owner.manifest.private !== true, files: 0, through: new Set() });
      const o = owners.get(owner.dir);
      o.files++;
      if (chain[0] !== owner) o.through.add(chain[0].manifest.name ?? chain[0].dir);
    }
  }
  const sets = files.filter((f) => /^\.changeset\/[^/]+\.md$/.test(f.filename) && !/\/README\.md$/i.test(f.filename) && f.status !== 'removed');
  const declared = new Set();
  const empty = [];
  let setGap = null;
  for (const f of sets) {
    const r = get(`/repos/${repo}/contents/${encodePath(f.filename)}?ref=${head}`);
    const text = r.ok ? decode(r.value)?.toString('utf8') : null;
    if (text === null || text === undefined) {
      setGap ??= `${f.filename} did not read (${r.ok ? 'no base64 content' : r.error})`;
      continue;
    }
    const entries = entriesIn(text);
    if (entries.length === 0) empty.push(f.filename);
    for (const e of entries) declared.add(e.pkg);
  }
  const skip = labels.includes(SKIP_CHANGESET_LABEL);
  const published = [...owners.values()].filter((o) => o.published);
  const missing = published.filter((o) => !declared.has(o.name));
  const who = (list) => list.map((o) => `${o.name} (${o.dir}, ${o.files} file(s)${o.through.size ? `, through private ${[...o.through].join(', ')}` : ''})`).join(', ');
  if (walkGap || setGap) item('changeset', NOT_MEASURED, walkGap ?? setGap);
  else if (published.length === 0) item('changeset', OK, `no published package touched${owners.size ? ` (unpublished: ${[...owners.values()].map((o) => o.name).join(', ')})` : ''}${skip ? ` · \`${SKIP_CHANGESET_LABEL}\`` : ''}`);
  else if (missing.length === 0) item('changeset', OK, `every published package touched has a changeset entry: ${who(published)}`);
  else if (skip) item('changeset', FLAG, `\`${SKIP_CHANGESET_LABEL}\` carries ${who(missing)} — flagged, not judged: whether those files ship (\`files[]\`) and the tests/docs-only premise are the reviewer's`);
  else item('changeset', FLAG, `published package(s) touched with no changeset entry and no \`${SKIP_CHANGESET_LABEL}\`: ${who(missing)}`);
  if (setGap) item('empty-changeset', NOT_MEASURED, setGap);
  else item('empty-changeset', empty.length ? FLAG : OK, empty.length ? `empty changeset(s) — this repo takes the \`${SKIP_CHANGESET_LABEL}\` label, never an empty changeset: ${empty.join(', ')}` : `${sets.length} changeset(s) in the diff, none empty`);
}

/** `+0/-0` files: the blob decides — NUL bytes and lines, the equivalent of `git show HEAD:PATH | wc -l`. */
function nulItem({ repo, files, get, item }) {
  // A rename is read too: one whose content also changed and now holds NUL is `+0/-0` exactly as a pure rename is.
  const suspects = files.filter((f) => f.additions === 0 && f.deletions === 0 && ['added', 'modified', 'changed', 'copied', 'renamed'].includes(f.status));
  if (suspects.length === 0) return item('nul-suspects', OK, 'no `+0/-0` file');
  const flags = [];
  const fine = [];
  const unread = [];
  suspects.forEach((f, k) => {
    if (BINARY_EXTENSIONS.includes(ext(f.filename))) return fine.push(`${f.filename} (binary by kind)`);
    if (k >= BLOB_READ_CAP) return unread.push(`${f.filename} (past the cap of ${BLOB_READ_CAP})`);
    const r = get(`/repos/${repo}/git/blobs/${f.sha}`);
    const bytes = r.ok ? decode(r.value) : null;
    if (!bytes) return unread.push(`${f.filename} (${r.ok ? 'no base64 content' : r.error})`);
    let nul = 0;
    let lines = 0;
    for (const b of bytes) {
      if (b === 0) nul++;
      else if (b === 10) lines++;
    }
    const where = `${f.filename} (blob ${short(f.sha)}: ${nul} NUL byte(s), ${lines} line(s) — \`git show HEAD:${f.filename} | wc -l\`)`;
    (nul ? flags : fine).push(nul ? where : `${f.filename} (blob ${short(f.sha)}: no NUL, ${bytes.length ? `${lines} line(s)` : 'empty'})`);
  });
  if (flags.length) item('nul-suspects', FLAG, `NUL in the blob — the source writes the escape sequence: ${flags.join('; ')}${fine.length ? ` · clear: ${fine.join('; ')}` : ''}`);
  else if (unread.length) item('nul-suspects', NOT_MEASURED, `blob(s) unread: ${unread.join('; ')}`);
  else item('nul-suspects', OK, `${suspects.length} \`+0/-0\` file(s), none with NUL: ${fine.join('; ')}`);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderFace(f, { now = new Date().toISOString() } = {}) {
  if (f.exit === EXIT_PR_UNREADABLE) return [`l1-face — PR #${f.number} · CAN'T READ — the PR row did not answer (${f.unreadable})`, "l1-face CAN'T READ — nothing judged."].join('\n');
  const L = [];
  L.push(`l1-face — PR #${f.number} · ${f.repo} · head ${short(f.head)} · read ${now} · read-only, nothing written`);
  L.push(`  title: ${f.title}`);
  L.push(`  pr-state: ${f.stateLine}`);
  for (const i of f.items) L.push(`  ${i.verdict.padEnd(12)} ${i.id.padEnd(21)} ${i.evidence}`);
  L.push(f.owed === null ? 'Owed sentence-by-sentence reads: unread (the file listing did not read).' : `Owed sentence-by-sentence reads (changeset/CHANGELOG, content/docs, apps/docs): ${f.owed.length ? f.owed.join(', ') : 'none in the diff'}`);
  L.push('Not read by this face — the reviewer\'s own judgement:');
  for (const u of UNREAD_ITEMS) L.push(`  · ${u}`);
  const of = (v) => f.items.filter((i) => i.verdict === v).map((i) => i.id);
  if (f.exit === EXIT_OK) L.push(`l1-face CLEAN — ${f.items.length} item(s) read, none flagged; the items above the footer are still the reviewer's.`);
  else if (f.exit === EXIT_FLAGGED) L.push(`l1-face FLAGGED — ${of(FLAG).length} item(s) flagged: ${of(FLAG).join(', ')}.`);
  else L.push(`l1-face INCOMPLETE — not measured: ${of(NOT_MEASURED).join(', ')}${of(FLAG).length ? ` · flagged: ${of(FLAG).join(', ')}` : ''} — ⛔ not a clean face: re-run when the reads answer.`);
  return L.join('\n');
}

export function faceJson(f, { now = new Date().toISOString() } = {}) {
  if (f.exit === EXIT_PR_UNREADABLE) return { pr: f.number, error: f.unreadable, exit: f.exit };
  return { pr: f.number, repo: f.repo, head: f.head, read_at: now, title: f.title, pr_state: f.stateLine, items: f.items, owed_sentence_reads: f.owed, unread_items: UNREAD_ITEMS, exit: f.exit };
}

// ---------------------------------------------------------------------------
// Fixture — pr-state's readers, plus the files, cards, contents and blobs this face reads
// ---------------------------------------------------------------------------

/**
 * pr-state's fixture shape (`fixtureReaders`), plus `files: {N: [row]}`, `issues: {N: row}`, `contents: {path: text}`
 * and `blobs: {sha: text}`. Absent → 404; `null` → 502. `asked` records every path read.
 */
export function faceReaders(fx, repo) {
  const base = fixtureReaders(fx, repo);
  const asked = [];
  const b64 = (text) => ({ encoding: 'base64', content: Buffer.from(String(text), 'utf8').toString('base64') });
  const answer = (table, key, wrap) => {
    if (!table || !(key in table)) return { ok: false, error: 'HTTP 404' };
    if (table[key] === null) return { ok: false, error: 'HTTP 502' };
    return { ok: true, value: wrap(table[key]) };
  };
  const get = (path) => {
    asked.push(path);
    const [bare, q = ''] = path.split('?');
    const page = Number(new URLSearchParams(q).get('page') ?? 1);
    let m;
    if ((m = new RegExp(`^/repos/${repo}/pulls/(\\d+)/files$`).exec(bare))) return answer(fx.files, m[1], (rows) => rows.slice((page - 1) * 100, page * 100));
    if ((m = new RegExp(`^/repos/${repo}/issues/(\\d+)$`).exec(bare))) return answer(fx.issues, m[1], (row) => row);
    if ((m = new RegExp(`^/repos/${repo}/contents/(.+)$`).exec(bare))) return answer(fx.contents, decodeURIComponent(m[1]), b64);
    if ((m = new RegExp(`^/repos/${repo}/git/blobs/([0-9a-f]+)$`).exec(bare))) return answer(fx.blobs, m[1], b64);
    return base.get(path);
  };
  return { ...base, get, asked };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'l1-face — the mechanical face of l1-review-checklist.md for one PR at its current head (read-only).',
  '',
  '  node scripts/pm/l1-face.mjs --pr N [--repo OWNER/NAME] [--json] [--fixture FILE]',
  '  node scripts/pm/l1-face.mjs --self-test',
  '',
  '  Exits: 0 clean · 2 usage · 3 the PR row unreadable · 4 INCOMPLETE (an item not measured) · 5 FLAGGED.',
].join('\n');

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_SWEEP_REPO, pr: null, json: false, fixture: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z-]+)=(.*)$/.exec(a);
    const flag = eq ? eq[1] : a;
    const take = () => (eq ? eq[2] : argv[++i]);
    if (flag === '--json' && !eq) opts.json = true;
    else if ((flag === '--help' || flag === '-h') && !eq) opts.help = true;
    else if (flag === '--pr') {
      const v = String(take() ?? '').replace(/^#/, '');
      if (!/^[1-9][0-9]*$/.test(v)) return { error: `--pr must be one PR number, got \`${v}\`` };
      if (opts.pr !== null) return { error: '--pr is given once: the face reads one PR' };
      opts.pr = Number(v);
    } else if (flag === '--repo') {
      opts.repo = String(take() ?? '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { error: `--repo must be OWNER/NAME, got \`${opts.repo}\`` };
    } else if (flag === '--fixture') {
      opts.fixture = take();
      if (!opts.fixture) return { error: '--fixture needs a file' };
    } else return { error: `\`${a}\` is not an argument this tool takes` };
  }
  if (!opts.help && opts.pr === null) return { error: '--pr N is required' };
  return { opts };
}

export function main(argv, deps = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`l1-face: ${parsed.error}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const o = parsed.opts;
  if (o.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  let readers = deps.readers ?? {};
  if (o.fixture) {
    try {
      readers = faceReaders(JSON.parse(readFileSync(o.fixture, 'utf8')), o.repo);
    } catch (e) {
      console.error(`l1-face: --fixture \`${o.fixture}\` could not be read as JSON (${e.message})`);
      return EXIT_USAGE;
    }
  }
  const { get, lsRemote, sleep, roster } = readers;
  const face = readFace({ repo: o.repo, number: o.pr, ...(get && { get }), ...(lsRemote && { lsRemote }), ...(sleep && { sleep }), ...(roster && { roster }) });
  const now = deps.now ?? new Date().toISOString();
  console.log(o.json ? JSON.stringify(faceJson(face, { now }), null, 2) : renderFace(face, { now }));
  return face.exit;
}

// ---------------------------------------------------------------------------
// Self-test — floor (battery names pinned) + handshake, copied from the landed shape
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the rule text: every phrase this file is built from is in the file that writes it': 3,
  'PR shape and the card relation: the first line, the shared parser, other open cards': 12,
  'scope and changeset: the release path, published packages, empty changesets': 10,
  'declarations: Clause-②, Metadata-protocol and the Skills-docs line they owe': 6,
  'gate evidence at the head: the floor checks, every other check via pr-state, dogfood owed': 7,
  '+0/-0: the blob decides': 5,
  'the face and the CLI: the unread footer, exits and usage': 8,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(unattributed)';
const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

const quiet = (fn) => (...args) => {
  const log = console.log;
  const err = console.error;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: fn(...args), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
};

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const REPO = 'objectstack-ai/objectstack';
  const sha = (c) => c.repeat(40);
  const HEAD = sha('c');
  const MAIN = sha('a');
  const ATTR = '<!-- claude-projects-attribution: {"github_login":"os-sales"} -->';
  const REQ = '_Requested by **Sales** · [project thread](https://claude.ai/code/project/x?thread=y)_';
  const bodyOf = (...lines) => [ATTR, REQ, ...lines].join('\n');
  const BODY = bodyOf('Part of #500', 'Clause-②: no', 'Metadata-protocol: none', '', 'What changes.');
  const run = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion: status === 'completed' ? conclusion : null, check_suite: { id: 1 } });
  const file = (filename, over = {}) => ({ filename, status: 'modified', additions: 3, deletions: 1, sha: sha('b'), ...over });
  const row = (over = {}) => ({ number: 7, state: 'open', draft: true, merged_at: null, mergeable_state: 'clean', head: { sha: HEAD }, base: { ref: 'main' }, auto_merge: null, title: 'feat(pm): x', body: BODY, labels: [{ name: SKIP_CHANGESET_LABEL }], changed_files: 2, ...over });
  const fixture = (over = {}) => ({
    prs: { 7: row(over.row) },
    reviews: { 7: [] },
    timeline: { 7: [] },
    check_runs: { [HEAD]: [run('Lint & Repo Gates'), run('TypeScript Type Check'), run('Test Core')] },
    status: { [HEAD]: { state: 'pending', total_count: 0 } },
    ls_remote: [{ sha: MAIN, ref: 'refs/heads/main' }],
    roster: [{ name: 'Build Docs', reason: 'docs filter' }],
    files: { 7: [file('scripts/pm/x.mjs', { status: 'added', deletions: 0 }), file('.claude/skills/a.md')] },
    issues: { 500: { number: 500, state: 'open', labels: [{ name: 'pm:dispatched' }] } },
    contents: { 'package.json': JSON.stringify({ name: 'root', private: true }) },
    blobs: {},
    ...over,
    ...(over.row ? { prs: { 7: row(over.row) } } : {}),
  });
  const read = (fx) => readFace({ repo: REPO, number: 7, ...faceReaders(fx, REPO) });
  const at = (face, id) => face.items.find((i) => i.id === id) ?? { verdict: 'MISSING', evidence: '' };
  const v = (face, id) => at(face, id).verdict;

  battery('the rule text: every phrase this file is built from is in the file that writes it');
  {
    const missing = Object.entries(RULE_FILES).flatMap(([p, phrases]) => phrases.filter((ph) => !readFileSync(join(REPO_ROOT, p), 'utf8').includes(ph)).map((ph) => `${p}: ${ph}`));
    t('⭐ l1-review-checklist.md and os-dev.md still say what this file encodes, the pointer included', missing, []);
    t('the two floor checks are names the required-context registry carries', FLOOR_CHECKS.every((n) => REQUIRED_CONTEXTS.some((c) => c.context === n)), true);
    const clean = read(fixture());
    t('⭐ a clean draft PR reads CLEAN, exit 0, one line per mechanical item', [clean.exit, clean.items.map((i) => i.id)], [EXIT_OK, ['shape', 'first-line', 'relation', 'keywords-other-cards', 'releases-path', 'changeset', 'empty-changeset', 'nul-suspects', 'declarations', 'skills-docs', 'floor-checks', 'all-checks', 'dogfood']]);
  }

  battery('PR shape and the card relation: the first line, the shared parser, other open cards');
  {
    t('⭐ the harness attribution lines are skipped before the first line is read', firstContentLine(BODY), 'Part of #500');
    t('a body with no attribution reads its own first line', firstContentLine('\nFixes #9\nmore'), 'Fixes #9');
    t('⭐ a seat signature first line (a relay-stamped body) is skipped too', firstContentLine('repo:objectstack#5 · os-bill · session_01Utp6Ca1jJvsA1dHsPwMiQb\nPart of #9'), 'Part of #9');
    t('a `_Requested by …_` line without the project-thread link is an attribution line too', firstContentLine(`${ATTR}\n_Requested by **Y**_\n\nPart of #9`), 'Part of #9');
    t('the first line names the card through the shared parser — closing keyword, Part of, Refs', [firstLineCard('Fixes #9'), firstLineCard('Part of #8'), firstLineCard('Refs #7 (item 2)'), firstLineCard('see the card')], [{ card: 9, relation: 'Fixes' }, { card: 8, relation: 'Part of' }, { card: 7, relation: 'Refs' }, null]);
    t('⭐ a ready PR, a merged one and a non-main base each flag the shape', [v(read(fixture({ row: { draft: false } })), 'shape'), v(read(fixture({ row: { state: 'closed', merged_at: '2026-11-19T00:00:00Z' } })), 'shape'), at(read(fixture({ row: { base: { ref: 'next' } } })), 'shape').evidence], [FLAG, FLAG, 'base `next`, not `main`']);
    t('a first line naming no card flags', v(read(fixture({ row: { body: bodyOf('Implements the thing.', 'Part of #500') } })), 'first-line'), FLAG);
    const h7 = read(fixture({ row: { body: bodyOf('Part of #500', 'This fixes #500 halfway.') } }));
    t('⭐ `Part of #N` with a closing keyword on the same N is H7 — flagged with its sentence', [v(h7, 'relation'), at(h7, 'relation').evidence.includes('merging this closes #500')], [FLAG, true]);
    const inbox = read(fixture({ row: { body: bodyOf('Fixes #500') }, issues: { 500: { number: 500, state: 'open', labels: [{ name: DECISION_INBOX_LABEL }] } } }));
    t('⭐ `Fixes` on a card still in the decision inbox flags', [v(inbox, 'relation'), at(inbox, 'relation').evidence.includes(DECISION_INBOX_LABEL)], [FLAG, true]);
    t('an unreadable card is not measured, never ok', v(read(fixture({ issues: { 500: null } })), 'relation'), NOT_MEASURED);
    const other = read(fixture({ row: { body: bodyOf('Part of #500', 'Closes #600 and resolves #601 and fixes #602'), }, issues: { 500: { number: 500, state: 'open', labels: [] }, 600: { number: 600, state: 'open', labels: [] }, 601: { number: 601, state: 'closed', labels: [] }, 602: { number: 602, state: 'open', pull_request: {}, labels: [] } } }));
    t('⭐ a closing keyword next to another OPEN card flags it; a closed card and a PR are named, not flagged', [v(other, 'keywords-other-cards'), at(other, 'keywords-other-cards').evidence], [FLAG, 'a closing keyword binds another OPEN card — merging closes it: `Closes #600` · also `resolves #601` (closed), `fixes #602` (a PR)']);
    t('a keyword inside a code span binds nothing (the shared parser strips code)', v(read(fixture({ row: { body: bodyOf('Part of #500', 'the guard reads `Fixes #600`') }, issues: { 500: { number: 500, state: 'open', labels: [] } } })), 'keywords-other-cards'), OK);
  }

  battery('scope and changeset: the release path, published packages, empty changesets');
  {
    const pkg = (name, priv) => JSON.stringify({ name, ...(priv === undefined ? {} : { private: priv }) });
    const rel = read(fixture({ files: { 7: [file('content/docs/releases/v9.mdx'), file('scripts/pm/x.mjs')] } }));
    t('⭐ a `content/docs/releases/` path flags', [v(rel, 'releases-path'), at(rel, 'releases-path').evidence.includes('content/docs/releases/v9.mdx')], [FLAG, true]);
    const touched = (files, over = {}) => read(fixture({ files: { 7: files }, row: { changed_files: files.length, labels: [], ...over.row }, contents: { 'package.json': pkg('root', true), 'packages/core/package.json': pkg('@objectstack/core'), 'packages/qa/package.json': pkg('@objectstack/qa', true), ...over.contents } }));
    const noSet = touched([file('packages/core/src/a/b.ts'), file('packages/qa/x.ts')]);
    t('⭐ a published package (no `private`) touched with no changeset entry and no label flags; the private one does not count', [v(noSet, 'changeset'), at(noSet, 'changeset').evidence], [FLAG, 'published package(s) touched with no changeset entry and no `skip-changeset`: @objectstack/core (packages/core, 1 file(s))']);
    const withSet = touched([file('packages/core/src/a.ts'), file('.changeset/35237-x.md', { status: 'added' })], { contents: { '.changeset/35237-x.md': '---\n"@objectstack/core": patch\n---\n\nFix.\n' } });
    t('a changeset entry for the package clears it', v(withSet, 'changeset'), OK);
    const labelled = touched([file('packages/core/test/a.test.ts')], { row: { labels: [{ name: SKIP_CHANGESET_LABEL }] } });
    t('⭐ `skip-changeset` carrying a published package with no entry flags — flagged, not judged: the `files[]` reading is the reviewer\'s', [v(labelled, 'changeset'), at(labelled, 'changeset').evidence.includes('`files[]`')], [FLAG, true]);
    const nest = { 'packages/create/package.json': pkg('create-objectstack'), 'packages/create/src/templates/blank/package.json': pkg('objectstack-blank', true) };
    const scaffold = touched([file('packages/create/src/templates/blank/src/a.ts')], { contents: nest });
    t('⭐ a private manifest nested inside a published package does not hide it: the published one owns the path, named through the private one', [v(scaffold, 'changeset'), at(scaffold, 'changeset').evidence], [FLAG, 'published package(s) touched with no changeset entry and no `skip-changeset`: create-objectstack (packages/create, 1 file(s), through private objectstack-blank)']);
    const scaffoldSet = touched([file('packages/create/src/templates/blank/src/a.ts'), file('.changeset/x.md', { status: 'added' })], { contents: { ...nest, '.changeset/x.md': '---\n"create-objectstack": patch\n---\n\nScaffold.\n' } });
    t('…and a changeset entry naming the published package clears it; naming only the nested private one does not', [v(scaffoldSet, 'changeset'), v(touched([file('packages/create/src/templates/blank/src/a.ts'), file('.changeset/x.md', { status: 'added' })], { contents: { ...nest, '.changeset/x.md': '---\n"objectstack-blank": patch\n---\n\nx\n' } }), 'changeset')], [OK, FLAG]);
    const empty = touched([file('.changeset/x.md', { status: 'added' })], { contents: { '.changeset/x.md': '---\n---\n\nNothing.\n' } });
    t('⭐ an empty changeset flags — this repo takes the label', v(empty, 'empty-changeset'), FLAG);
    const memoAsked = faceReaders(fixture({ files: { 7: [file('scripts/pm/a.mjs'), file('scripts/pm/b.mjs')] } }), REPO);
    readFace({ repo: REPO, number: 7, ...memoAsked });
    t('the package walk is memoised per directory and reads at the head', memoAsked.asked.filter((p) => p.includes('/contents/')), [`/repos/${REPO}/contents/scripts/pm/package.json?ref=${HEAD}`, `/repos/${REPO}/contents/scripts/package.json?ref=${HEAD}`, `/repos/${REPO}/contents/package.json?ref=${HEAD}`]);
    t('⭐ a file listing shorter than `changed_files` leaves every diff item not measured', ['releases-path', 'changeset', 'empty-changeset', 'nul-suspects'].map((id) => v(read(fixture({ row: { changed_files: 5 } })), id)), [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]);
    t('an unreadable manifest is not measured, never an unpublished package', v(touched([file('packages/core/a.ts')], { contents: { 'packages/core/package.json': null } }), 'changeset'), NOT_MEASURED);
  }

  battery('declarations: Clause-②, Metadata-protocol and the Skills-docs line they owe');
  {
    t('⭐ a missing `Metadata-protocol:` line flags and leaves Skills-docs not measured', [v(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: no') } })), 'declarations'), v(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: no') } })), 'skills-docs')], [FLAG, NOT_MEASURED]);
    t('⭐ a kind other than none with no `Skills-docs:` line flags', v(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: yes', 'Metadata-protocol: added') } })), 'skills-docs'), FLAG);
    t('a `(narrowing)` arm owes the line too, and `follow-up owed` flags until rewritten to #N', v(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: yes (narrowing)', 'Metadata-protocol: narrowed', 'Skills-docs: follow-up owed — skills/a/SKILL.md') } })), 'skills-docs'), FLAG);
    t('a present value is ok and its truth left to the reviewer', at(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: yes', 'Metadata-protocol: added', 'Skills-docs: follow-up #9') } })), 'skills-docs').evidence, '`Skills-docs: follow-up #9` — its truth is the reviewer\'s');
    t('a `Skills-docs:` line inside a fence is not the line', readSkillsDocsLine('```\nSkills-docs: none — x\n```'), null);
    t('⭐ an empty `Skills-docs:` value is no line: owed and absent flags', [readSkillsDocsLine('Skills-docs:   '), v(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: yes', 'Metadata-protocol: added', 'Skills-docs:') } })), 'skills-docs')], [null, FLAG]);
  }

  battery('gate evidence at the head: the floor checks, every other check via pr-state, dogfood owed');
  {
    const runs = (...r) => ({ check_runs: { [HEAD]: r } });
    t('⭐ a failed floor check flags', v(read(fixture(runs(run('Lint & Repo Gates', 'failure'), run('TypeScript Type Check')))), 'floor-checks'), FLAG);
    t('⭐ a floor check still running is not measured, never ok', v(read(fixture(runs(run('Lint & Repo Gates', null, 'in_progress'), run('TypeScript Type Check')))), 'floor-checks'), NOT_MEASURED);
    t('a floor check absent while nothing is pending flags', v(read(fixture(runs(run('TypeScript Type Check'), run('Test Core')))), 'floor-checks'), FLAG);
    const skip = read(fixture(runs(run('Lint & Repo Gates'), run('TypeScript Type Check'), run('Build Docs', 'skipped'), run('Lint UI', 'skipped'))));
    t('⭐ every other check is pr-state\'s judgement: an expected skip passes, an unexpected one flags', [v(skip, 'all-checks'), at(skip, 'all-checks').evidence.includes('1 unexpected skip (Lint UI)')], [FLAG, true]);
    t('a pending check leaves all-checks not measured', v(read(fixture(runs(run('Lint & Repo Gates'), run('TypeScript Type Check'), run('Test Core', null, 'queued')))), 'all-checks'), NOT_MEASURED);
    t('⭐ `!` before the title\'s colon owes the dogfood battery — flagged, not judged', [v(read(fixture({ row: { title: 'feat(pm)!: x' } })), 'dogfood'), v(read(fixture({ row: { body: bodyOf('Part of #500', 'Clause-②: yes (narrowing)', 'Metadata-protocol: narrowed', 'Skills-docs: none — internal') } })), 'dogfood')], [FLAG, FLAG]);
    t('unreadable check-runs leave both check items not measured', [v(read(fixture({ check_runs: { [HEAD]: null } })), 'floor-checks'), v(read(fixture({ check_runs: { [HEAD]: null } })), 'all-checks')], [NOT_MEASURED, NOT_MEASURED]);
  }

  battery('+0/-0: the blob decides');
  {
    const zero = (filename, over = {}) => file(filename, { additions: 0, deletions: 0, sha: sha('d'), ...over });
    const nul = read(fixture({ files: { 7: [zero('scripts/x.mjs'), file('a.md')] }, blobs: { [sha('d')]: 'const s = "\u0000";\nmore\n' } }));
    t('⭐ a `+0/-0` text file whose blob holds NUL flags, with its line count and the git show reading', [v(nul, 'nul-suspects'), at(nul, 'nul-suspects').evidence.includes('1 NUL byte(s), 2 line(s) — `git show HEAD:scripts/x.mjs | wc -l`')], [FLAG, true]);
    const renamed = (blob) => read(fixture({ files: { 7: [zero('docs/a.png'), zero('b.ts', { status: 'renamed', previous_filename: 'a.ts' })] }, blobs: { [sha('d')]: blob } }));
    t('a binary-by-kind file is not a suspect, and a `+0/-0` rename is read by its blob and cleared when it holds no NUL', [v(renamed('x\n'), 'nul-suspects'), at(renamed('x\n'), 'nul-suspects').evidence.includes('b.ts (blob')], [OK, true]);
    t('⭐ a `+0/-0` rename whose blob holds NUL flags, never set aside', v(renamed('a\u0000b\n'), 'nul-suspects'), FLAG);
    t('a `+0/-0` blob with no NUL is cleared by the blob', at(read(fixture({ files: { 7: [zero('x.json'), file('a.md')] }, blobs: { [sha('d')]: '' } })), 'nul-suspects').evidence.includes('no NUL, empty'), true);
    t('an unreadable blob is not measured', v(read(fixture({ files: { 7: [zero('x.json'), file('a.md')] }, blobs: { [sha('d')]: null } })), 'nul-suspects'), NOT_MEASURED);
  }

  battery('the face and the CLI: the unread footer, exits and usage');
  {
    t('--pr is required, once, and a list is refused', [Boolean(parseArgs([]).error), Boolean(parseArgs(['--pr', '7,8']).error), Boolean(parseArgs(['--pr', '7', '--pr', '8']).error), parseArgs(['--pr', '#7']).opts.pr], [true, true, true, 7]);
    t('an unknown flag is refused, never ignored', Boolean(parseArgs(['--pr', '7', '--write']).error), true);
    const ok = quiet(main)(['--pr', '7'], { readers: faceReaders(fixture(), REPO), now: 'NOW' });
    t('⭐ every run names every judgement item it does not read, and a clean run exits 0', [ok.code, UNREAD_ITEMS.every((u) => ok.out.includes(u)), ok.out.includes('l1-face CLEAN')], [EXIT_OK, true, true]);
    const flagged = quiet(main)(['--pr', '7'], { readers: faceReaders(fixture({ row: { draft: false } }), REPO), now: 'NOW' });
    t('⭐ a flag with every item read is exit 5 and names the item', [flagged.code, flagged.out.includes('l1-face FLAGGED — 1 item(s) flagged: shape.')], [EXIT_FLAGGED, true]);
    const inc = quiet(main)(['--pr', '7'], { readers: faceReaders(fixture({ issues: {}, row: { draft: false } }), REPO), now: 'NOW' });
    t('⭐ a not-measured item is exit 4 over a flag, and never prints CLEAN', [inc.code, inc.out.includes('l1-face CLEAN'), inc.out.includes('not measured: relation · flagged: shape')], [EXIT_INCOMPLETE, false, true]);
    const gone = quiet(main)(['--pr', '8'], { readers: faceReaders(fixture(), REPO), now: 'NOW' });
    t('an unreadable PR row is exit 3 and says CAN\'T READ', [gone.code, gone.out.includes("CAN'T READ")], [EXIT_PR_UNREADABLE, true]);
    t('--json carries the items, the unread footer and the exit', (() => { const j = JSON.parse(quiet(main)(['--pr', '7', '--json'], { readers: faceReaders(fixture(), REPO), now: 'NOW' }).out); return [j.exit, j.items.length, j.unread_items.length === UNREAD_ITEMS.length, j.owed_sentence_reads]; })(), [EXIT_OK, 13, true, []]);
    const dir = mkdtempSync(join(tmpdir(), 'l1-face-'));
    try {
      const fx = join(dir, 'fx.json');
      writeFileSync(fx, JSON.stringify(fixture({ row: { title: 'fix(x)!: y' } })));
      const env = { ...process.env, PATH: '/nonexistent' };
      const cli = spawnSync(process.execPath, [SELF_PATH, '--pr', '7', '--fixture', fx], { encoding: 'utf8', env });
      const usage = spawnSync(process.execPath, [SELF_PATH, '--pr', 'x'], { encoding: 'utf8', env });
      t('⭐ the CLI runs a fixture offline (no gh on PATH) and exits 5 on a `!` title; a bad --pr is exit 2', [cli.status, cli.stdout.includes('flag         dogfood'), usage.status], [EXIT_FLAGGED, true, EXIT_USAGE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    console.error(`✗ l1-face self-test: ${failed.length} of ${cases.length} case(s) failed${floor.length ? `, ${floor.length} floor breach(es)` : ''}.`);
    selfTestReachedVerdict = true;
    return EXIT_SELF_TEST_FAILED;
  }
  console.log(`✓ l1-face self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network.`);
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ l1-face self-test: selfTest() returned without reaching its verdict, so no success line was\nprinted. Exiting 0 here would report a self-test that never finished as one that passed.\n');
      process.exit(1);
    }
    process.exit(code);
  } else {
    process.exit(main(argv));
  }
}
