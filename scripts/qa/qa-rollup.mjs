#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * qa-rollup — area x latest-verdict x staleness matrix over the `qa-run` records.
 *
 *   node scripts/qa/qa-rollup.mjs                  # print the matrix (reads GitHub)
 *   node scripts/qa/qa-rollup.mjs --target <ref>   # compare staleness against <ref>
 *   node scripts/qa/qa-rollup.mjs --json           # same data, machine-readable
 *   node scripts/qa/qa-rollup.mjs --self-test      # exercise the parser offline
 *
 * ## What this answers
 *
 * "What is the latest verdict for every checklist selector, and is it stale?"
 * Today that question costs a human 23 issue-reads. This prints it as one table.
 *
 * ## It is a generated VIEW, not a tracker
 *
 * No state is written anywhere — no cache, no checked-in snapshot, no last-run
 * file. The `qa-run` issues stay the only source of truth; this script reads
 * them, computes, prints, and exits. Run it again and you get today's answer,
 * not a remembered one. (Board rule, #9486.)
 *
 * ## Why the TITLE is the input and the BODY is not
 *
 * Measured over the whole live corpus on 2026-08-18 (23 records, open+closed):
 *
 *   - 23/23 titles parse. The counts field is uniform enough to tokenize
 *     mechanically, and it is the record author's OWN item-level summary.
 *   - The bodies are not one shape and never were. 9 of 23 records (the
 *     2026-08-11 `92f26f75` wave) contain NO markdown table at all — they are
 *     prose with `## PASS - 4 items` headings. The other 14 carry 26 DISTINCT
 *     table header shapes.
 *   - Worse than heterogeneous: most of those tables are CLAUSE-level, not
 *     item-level (`clause | verdict | oracle evidence` appears 38 times,
 *     `# | clause | verdict | oracle evidence` 22 more). They use the word
 *     "verdict" for a different unit. A parser that greps for verdict cells
 *     counts CLAUSES and reports them as ITEMS — a confidently wrong matrix,
 *     which is worse than no matrix.
 *
 * So this reads the field that is actually a contract and does NOT pretend to
 * have read the bodies. The output says so, every run, so that no reader can
 * mistake this view for a body-derived one.
 *
 * ## The title convention has drifted, and the drift is REPORTED, not hidden
 *
 * Three different conventions are in play:
 *
 *   documented (.claude/skills/checklist-test/SKILL.md):
 *     QA run | <selector> | <judged>/<total> | <sha8> | <date>          (5 fields, no counts)
 *   as described in the #9486 card:
 *     QA run | <selector> | <judged>/<total> | <sha8> | <date> | <counts>  (6 fields)
 *   as ACTUALLY written by 23/23 records:
 *     QA run | <selector[(judged/total)]> | <sha8> | <date> | <counts>   (5 fields)
 *
 * Zero records follow either documented form. The judged/total is folded into a
 * parenthetical on the selector, in five distinct phrasings, and is absent
 * entirely on one record. This parser accepts the shape the records actually
 * have; anything it cannot parse is PRINTED, never dropped. A roll-up that
 * silently omits records is the "derived list read as authoritative" defect
 * this repo has paid for repeatedly (#9294, #9331, #9503, #9590).
 *
 * ## Staleness is THREE-valued, because a shallow clone cannot always tell
 *
 * `git merge-base --is-ancestor` needs the sha present locally with enough
 * history behind it. CI containers here clone shallow (measured: boundary
 * `713ccbc95`, 2026-08-16). The `92f26f75` wave predates that boundary, so
 * `--is-ancestor` answers *false* for commits that almost certainly ARE
 * ancestors. Reading that false as "not behind -> fresh" would render the NINE
 * STALEST RECORDS IN THE CORPUS AS FRESH — the failure inverted, silently.
 *
 * So freshness is `current` | `stale` | `unknown`, never a two-way boolean, and
 * `unknown` carries its reason (`shallow` / `unreachable` / `diverged`).
 * "Could not tell" renders as `?`, and `?` is never counted as fresh.
 *
 * ## Rate limit
 *
 * REST core only: one `GET /issues?labels=qa-run&state=all&per_page=100` per
 * 100 records (measured: 1 call for the whole corpus), against a 15000/hr core
 * quota. Deliberately NOT the search API (30/min) and NOT GraphQL, whose quota
 * was measurably under pressure in this repo (2699/5000 remaining) when this
 * was written. Comments are never paginated — the bodies are not parsed at all.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** The verdict vocabulary, in report order. */
export const VERDICTS = ['PASS', 'PARTIAL', 'FAIL', 'BLOCKED', 'NOT-RUN'];

const TITLE_PREFIX = 'QA run';
const SEP = '·'; // MIDDLE DOT, the field separator the records use

/**
 * Parse one `qa-run` issue title.
 *
 * Pure: every input is an argument, so `--self-test` exercises the real code
 * path rather than a re-implementation.
 *
 * @param {string} title raw issue title
 * @returns {{ok: true, selector: string, selectorKind: string, judged: number|null,
 *            total: number|null, note: string|null, sha: string, date: string,
 *            counts: Record<string, number>, unrecognized: string[]}
 *          | {ok: false, reason: string}}
 */
export function parseRunTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') {
    return { ok: false, reason: 'empty title' };
  }
  const fields = title.split(SEP).map((f) => f.trim());
  if (fields[0] !== TITLE_PREFIX) {
    return { ok: false, reason: `first field is ${JSON.stringify(fields[0])}, expected ${JSON.stringify(TITLE_PREFIX)}` };
  }
  if (fields.length !== 5) {
    return { ok: false, reason: `${fields.length} ${SEP}-separated fields, expected 5` };
  }
  const [, selectorField, shaField, dateField, countsField] = fields;

  // selector, with the judged/total folded into an optional parenthetical
  const parenMatch = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(selectorField);
  const selector = (parenMatch ? parenMatch[1] : selectorField).trim();
  const paren = parenMatch ? parenMatch[2].trim() : null;
  if (selector === '') return { ok: false, reason: 'empty selector' };

  let judged = null;
  let total = null;
  let note = null;
  if (paren !== null) {
    let m;
    if ((m = /^(\d+)\s*\/\s*(\d+)/.exec(paren))) {
      judged = Number(m[1]);
      total = Number(m[2]);
    } else if ((m = /^(\d+)\s+of\s+(\d+)/i.exec(paren))) {
      judged = Number(m[1]);
      total = Number(m[2]);
    } else if ((m = /^(\d+)\s+items?\b/i.exec(paren))) {
      total = Number(m[1]);
    } else {
      note = paren;
    }
  }

  if (!/^[0-9a-f]{7,40}$/i.test(shaField)) {
    return { ok: false, reason: `sha field ${JSON.stringify(shaField)} is not a hex sha` };
  }
  if (!isCalendarDate(dateField)) {
    return { ok: false, reason: `date field ${JSON.stringify(dateField)} is not a real YYYY-MM-DD date` };
  }

  // counts: tokenize `<n> <WORD>` pairs. This spans both spellings the corpus
  // uses -- `/`-separated segments and a trailing `(11 not-run)` parenthetical
  // -- and both NOT-RUN casings.
  const counts = {};
  const unrecognized = [];
  for (const m of countsField.matchAll(/(\d+)\s*([A-Za-z][A-Za-z-]*)/g)) {
    const word = m[2].toUpperCase();
    if (VERDICTS.includes(word)) {
      counts[word] = (counts[word] ?? 0) + Number(m[1]);
    } else {
      unrecognized.push(`${m[1]} ${m[2]}`);
    }
  }
  if (Object.keys(counts).length === 0) {
    return { ok: false, reason: `counts field ${JSON.stringify(countsField)} yielded no known verdict` };
  }

  return {
    ok: true,
    selector,
    selectorKind: classifySelector(selector),
    judged,
    total,
    note,
    sha: shaField.toLowerCase(),
    date: dateField,
    counts,
    unrecognized,
  };
}

/**
 * What KIND of thing a selector names. The corpus mixes areas with
 * cross-cutting selectors, and rolling a tier up as if it were an area would
 * double-count items that belong to both.
 *
 * @param {string} selector
 * @returns {'area'|'tier'|'priority'|'other'}
 */
export function classifySelector(selector) {
  if (/^tier\d*[a-z]*:/i.test(selector)) return 'tier';
  if (/^priority:/i.test(selector)) return 'priority';
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(selector)) return 'area';
  return 'other';
}

/**
 * A real calendar date, not merely a `\d{4}-\d{2}-\d{2}`-shaped string.
 * The date is the primary key for "latest wins", so an impossible date must be
 * reported as unparseable rather than silently ordering the roll-up.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function isCalendarDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Classify a record's subject sha against the comparison target.
 *
 * THREE-valued on purpose. See the header: in a shallow clone `isAncestor`
 * answers false for genuinely-old commits, so a boolean here would render the
 * stalest records as fresh. Every `unknown` carries the reason it is unknown.
 *
 * Pure: the git facts arrive as a plain object, so `--self-test` can drive
 * every branch including the ones a given container cannot reproduce.
 *
 * @param {{sha: string, date: string}} record
 * @param {{sha: string|null, ref: string}} target
 * @param {{resolved: boolean, isAncestor: boolean|null, behind: number|null,
 *          commitDate: string|null}} git facts about `record.sha`
 * @param {{shallow: boolean, boundaryDate: string|null}} repo
 * @returns {{state: 'current'|'stale'|'unknown', reason: string|null, behind: number|null}}
 */
export function classifyFreshness(record, target, git, repo) {
  if (target.sha && record.sha.length > 0 && target.sha.startsWith(record.sha)) {
    return { state: 'current', reason: null, behind: 0 };
  }
  if (!git.resolved) {
    return { state: 'unknown', reason: 'unreachable', behind: null };
  }
  if (git.isAncestor === true) {
    return { state: 'stale', reason: null, behind: git.behind };
  }
  // Not an ancestor. In a shallow clone that is not evidence of anything if the
  // commit predates the graft boundary -- the history simply is not there.
  const predatesBoundary =
    repo.shallow && repo.boundaryDate && git.commitDate && git.commitDate < repo.boundaryDate;
  if (predatesBoundary) {
    return { state: 'unknown', reason: 'shallow', behind: null };
  }
  return { state: 'unknown', reason: 'diverged', behind: null };
}

/**
 * Latest-per-selector wins: a superseded record never shadows its replacement.
 * Ordering key is (date, issue number) -- the number breaks same-day ties in
 * filing order, which is the order the records were written.
 *
 * Pure.
 *
 * @param {Array<{number: number, parsed: object}>} records parsed, ok-only
 * @returns {{latest: object[], superseded: object[]}}
 */
export function rollUp(records) {
  const bySelector = new Map();
  for (const rec of records) {
    const key = rec.parsed.selector;
    const prior = bySelector.get(key);
    if (!prior || isNewer(rec, prior)) {
      bySelector.set(key, rec);
    }
  }
  const latestSet = new Set([...bySelector.values()].map((r) => r.number));
  const latest = [...bySelector.values()].sort(
    (a, b) =>
      a.parsed.selectorKind.localeCompare(b.parsed.selectorKind) ||
      a.parsed.selector.localeCompare(b.parsed.selector),
  );
  const superseded = records
    .filter((r) => !latestSet.has(r.number))
    .sort((a, b) => b.number - a.number);
  return { latest, superseded };
}

function isNewer(a, b) {
  if (a.parsed.date !== b.parsed.date) return a.parsed.date > b.parsed.date;
  return a.number > b.number;
}

/**
 * The canonical area vocabulary, read from the checklist itself so that an area
 * added there shows up here as a gap rather than silently not existing.
 *
 * @param {string} root repository root (or a fixture root in --self-test)
 * @returns {Array<{area: string, items: number}>}
 */
export function readAreas(root) {
  const dir = join(root, 'docs', 'qa', 'platform-checklist', 'areas');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      out.push({
        area: parsed.area ?? file.replace(/\.json$/, ''),
        items: Array.isArray(parsed.items) ? parsed.items.length : 0,
      });
    } catch {
      out.push({ area: file.replace(/\.json$/, ''), items: 0 });
    }
  }
  return out;
}

/**
 * The "judged" cell: how many items this record actually judged, over how many
 * the selector covers.
 *
 * The denominator has two possible provenances and they are NOT interchangeable:
 * the record's own declared total, or -- when the record declares none and the
 * selector names a checklist area -- the area's item count read from
 * `docs/qa/platform-checklist/areas/`. The second is marked with `*` because it
 * is the checklist's number, not the record's claim, and the difference is
 * load-bearing: several records titled "(FULL area)" judged far fewer items than
 * their area holds, which is invisible if the two denominators render alike.
 *
 * Pure.
 *
 * @param {{judged: number|null, total: number|null, note: string|null, counts: Record<string, number>}} parsed
 * @param {number|null} areaItems item count for the selector's area, or null
 * @returns {string}
 */
export function judgedCell(parsed, areaItems) {
  const sum = Object.values(parsed.counts).reduce((a, b) => a + b, 0);
  if (parsed.judged != null && parsed.total != null) return `${parsed.judged}/${parsed.total}`;
  if (parsed.total != null) return `${sum}/${parsed.total}`;
  if (areaItems != null && areaItems > 0) return `${sum}/${areaItems}*`;
  return parsed.note ? `${sum} (${parsed.note})` : `${sum}/?`;
}

const FRESHNESS_CELL = {
  current: 'current',
  stale: 'STALE',
  unknown: '?',
};

/**
 * Render the whole view as markdown, ready to paste as a wave-anchor comment.
 *
 * Pure: takes the computed model, returns a string.
 *
 * @param {object} model
 * @returns {string}
 */
export function renderMarkdown(model) {
  const L = [];
  const { computedOn, rows, superseded, unparseable, areaGaps, openRecords, corpus } = model;

  L.push('## QA roll-up — latest verdict per selector, with staleness');
  L.push('');
  L.push('_A generated view. No state is written anywhere; the `qa-run` issues remain the only');
  L.push('source of truth. Re-run to refresh._');
  L.push('');

  // Provenance -- a reader must be able to tell WHICH tree produced this.
  L.push('**computedOn**');
  L.push('');
  L.push(`- target: \`${computedOn.targetRef}\` = \`${computedOn.targetSha ?? 'unresolved'}\``);
  L.push(`- repository: ${computedOn.shallow ? `shallow clone (graft boundary \`${computedOn.boundary ?? '?'}\`, ${computedOn.boundaryDate ?? '?'})` : 'full clone'}`);
  L.push(`- corpus: ${corpus.total} \`qa-run\` records (${corpus.open} open, ${corpus.closed} closed), ${corpus.parsed} parsed, ${corpus.unparseable} unparseable`);
  L.push(`- source: issue TITLES only — bodies are not parsed (see caveat below)`);
  L.push(`- API: ${computedOn.apiCalls} REST call(s), core quota`);
  L.push(`- generated: ${computedOn.generatedAt}`);
  L.push('');

  L.push(`| selector | kind | latest | date | subject | fresh? | ${VERDICTS.join(' | ')} | judged |`);
  L.push(`|---|---|---|---|---|---|${VERDICTS.map(() => '--:').join('|')}|---|`);
  for (const r of rows) {
    const cells = VERDICTS.map((v) => (v in r.counts ? String(r.counts[v]) : '—'));
    const fresh =
      r.freshness.state === 'stale'
        ? `STALE${r.freshness.behind != null ? ` (${r.freshness.behind} behind)` : ''}`
        : r.freshness.state === 'unknown'
          ? `? ${r.freshness.reason}`
          : FRESHNESS_CELL.current;
    L.push(
      `| \`${r.selector}\` | ${r.selectorKind} | #${r.number} | ${r.date} | \`${r.sha}\` | ${fresh} | ${cells.join(' | ')} | ${r.judgedCell} |`,
    );
  }
  L.push('');
  L.push('`—` = the record did not declare that bucket (which is NOT the same as declaring zero).');
  L.push('`?` = could not be computed, never "fresh" — see reason.');
  L.push('`*` on a denominator = item count from the checklist area, not a number the record declared.');
  L.push('');

  if (unparseable.length > 0) {
    L.push(`### Not parsed — ${unparseable.length} record(s)`);
    L.push('');
    L.push('Listed because a roll-up that silently drops records reads as authoritative and is not.');
    L.push('');
    L.push('| record | title | why |');
    L.push('|---|---|---|');
    for (const u of unparseable) {
      L.push(`| #${u.number} | ${escapeCell(u.title)} | ${escapeCell(u.reason)} |`);
    }
    L.push('');
  } else {
    L.push('### Not parsed — none');
    L.push('');
    L.push('Every record in the corpus parsed.');
    L.push('');
  }

  if (areaGaps.length > 0) {
    L.push(`### Checklist areas with no run record — ${areaGaps.length}`);
    L.push('');
    L.push('These areas exist in `docs/qa/platform-checklist/areas/` but no `qa-run` record');
    L.push('names them as its selector. Absence of a verdict, not a verdict of NOT-RUN.');
    L.push('');
    L.push('| area | items |');
    L.push('|---|--:|');
    for (const g of areaGaps) L.push(`| \`${g.area}\` | ${g.items} |`);
    L.push('');
  }

  L.push(`### Close-out debt — ${openRecords.length} open record(s)`);
  L.push('');
  if (openRecords.length === 0) {
    L.push('Every `qa-run` record is closed.');
  } else {
    for (const o of openRecords) L.push(`- #${o.number} — \`${o.selector ?? '?'}\` (${o.date ?? '?'})`);
  }
  L.push('');

  if (superseded.length > 0) {
    L.push(`### Superseded — ${superseded.length} record(s)`);
    L.push('');
    L.push('Shown so the roll-up is auditable: each was replaced by a later run of the same selector.');
    L.push('');
    for (const s of superseded) {
      L.push(`- #${s.number} \`${s.selector}\` (${s.date}) — superseded by #${s.supersededBy}`);
    }
    L.push('');
  }

  L.push('### Caveat — what this did NOT read');
  L.push('');
  L.push('The per-item verdict tables inside the record bodies are **not** parsed. Measured over');
  L.push('this corpus, they are not one shape: some records carry no table at all, the rest carry');
  L.push('many distinct header shapes, and most of those tables are clause-level rather than');
  L.push('item-level — they use the word "verdict" for a different unit. Counting them as items');
  L.push('would produce a confidently wrong matrix. The numbers above are each record\'s own');
  L.push('title-line summary, which is the only uniform machine-readable field the corpus has.');

  return L.join('\n');
}

function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|');
}

/* ------------------------------------------------------------------ *
 * I/O shell. Everything above is pure and self-tested; everything
 * below talks to git and to GitHub, and writes nothing anywhere.
 * ------------------------------------------------------------------ */

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Facts about the repository itself, needed to tell "not behind" from "cannot tell". */
export function readRepoFacts(root) {
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']) === 'true';
  let boundary = null;
  let boundaryDate = null;
  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  if (shallow && commonDir) {
    const shallowFile = join(root, commonDir, 'shallow');
    const direct = commonDir.startsWith('/') ? join(commonDir, 'shallow') : shallowFile;
    try {
      const lines = readFileSync(direct, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        boundary = lines[0].slice(0, 9);
        boundaryDate = git(root, ['log', '-1', '--format=%ad', '--date=short', lines[0]]);
      }
    } catch {
      /* boundary unknown; classifyFreshness degrades to `diverged`, still not `fresh` */
    }
  }
  return { shallow, boundary, boundaryDate };
}

/** Facts about ONE record sha, relative to the target. */
export function readShaFacts(root, sha, targetSha) {
  const type = git(root, ['cat-file', '-t', `${sha}^{commit}`]);
  if (type !== 'commit') {
    return { resolved: false, isAncestor: null, behind: null, commitDate: null };
  }
  const commitDate = git(root, ['log', '-1', '--format=%ad', '--date=short', sha]);
  let isAncestor = null;
  if (targetSha) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, targetSha], {
        cwd: root,
        stdio: 'ignore',
      });
      isAncestor = true;
    } catch {
      isAncestor = false;
    }
  }
  let behind = null;
  if (isAncestor === true && targetSha) {
    const n = git(root, ['rev-list', '--count', `${sha}..${targetSha}`]);
    behind = n == null ? null : Number(n);
  }
  return { resolved: true, isAncestor, behind, commitDate };
}

/**
 * Fetch every `qa-run` record. REST core quota, paginated by Link header.
 * Returns the raw issues plus the call count, so the view can report its cost.
 */
async function fetchRunRecords(repo, token) {
  const out = [];
  let calls = 0;
  let url = `https://api.github.com/repos/${repo}/issues?labels=qa-run&state=all&per_page=100`;
  while (url) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'objectstack-qa-rollup' };
    if (isUsableToken(token)) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    calls += 1;
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}\n${authHint(res.status, token)}`);
    }
    const page = await res.json();
    for (const issue of page) {
      if (issue.pull_request) continue; // a PR is not a run record
      out.push(issue);
    }
    const link = res.headers.get('link') ?? '';
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return { issues: out, calls };
}

/**
 * Whether a token value is worth sending as a Bearer credential.
 *
 * Some environments export a PLACEHOLDER in `GH_TOKEN` and inject the real
 * credential at an egress proxy. Forwarding the placeholder is worse than
 * sending nothing: it overrides the injected credential and the request comes
 * back 401, which reads as "you have no access to this repo" when access is
 * in fact fine. Measured in this repo's agent container, where `GH_TOKEN` is
 * literally the string `proxy-injected`.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isUsableToken(token) {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (t === '') return false;
  if (/^(proxy-injected|placeholder|none|null|undefined|x+)$/i.test(t)) return false;
  return true;
}

/**
 * Turn an auth failure into the two remedies that actually apply, rather than
 * a bare status code.
 *
 * @param {number} status
 * @param {string} token
 * @returns {string}
 */
export function authHint(status, token) {
  if (status !== 401 && status !== 403 && status !== 404) return '';
  const lines = [];
  if (!isUsableToken(token)) {
    lines.push('  - no usable GH_TOKEN/GITHUB_TOKEN was sent (the value looked like a placeholder).');
    if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
      lines.push('  - HTTPS_PROXY is set but Node is not routing through it, so a proxy that injects');
      lines.push('    credentials never saw this request. Retry with NODE_USE_ENV_PROXY=1.');
    }
  } else {
    lines.push('  - the supplied token was rejected; check that it can read this repository.');
  }
  return lines.join('\n');
}

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return git(here, ['rev-parse', '--show-toplevel']) ?? join(here, '..', '..');
}

async function main(argv) {
  const targetRef = valueOf(argv, '--target') ?? 'origin/main';
  const repo = valueOf(argv, '--repo') ?? 'objectstack-ai/objectstack';
  const asJson = argv.includes('--json');
  const root = repoRoot();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  const { issues, calls } = await fetchRunRecords(repo, token);
  const targetSha = git(root, ['rev-parse', targetRef]);
  const repoFacts = readRepoFacts(root);

  const parsedOk = [];
  const unparseable = [];
  for (const issue of issues) {
    const parsed = parseRunTitle(issue.title);
    if (parsed.ok) parsedOk.push({ number: issue.number, state: issue.state, parsed });
    else unparseable.push({ number: issue.number, title: issue.title, reason: parsed.reason });
  }

  const { latest, superseded } = rollUp(parsedOk);
  const latestBySelector = new Map(latest.map((r) => [r.parsed.selector, r.number]));

  const areas = readAreas(root);
  const areaItems = new Map(areas.map((a) => [a.area, a.items]));

  const rows = latest.map((r) => {
    const shaFacts = readShaFacts(root, r.parsed.sha, targetSha);
    const freshness = classifyFreshness(r.parsed, { sha: targetSha, ref: targetRef }, shaFacts, repoFacts);
    return {
      number: r.number,
      selector: r.parsed.selector,
      selectorKind: r.parsed.selectorKind,
      date: r.parsed.date,
      sha: r.parsed.sha,
      counts: r.parsed.counts,
      judgedCell: judgedCell(r.parsed, areaItems.get(r.parsed.selector) ?? null),
      freshness,
    };
  });

  const seenAreas = new Set(parsedOk.map((r) => r.parsed.selector));
  const areaGaps = areas.filter((a) => !seenAreas.has(a.area));

  const openRecords = issues
    .filter((i) => i.state === 'open')
    .map((i) => {
      const p = parseRunTitle(i.title);
      return { number: i.number, selector: p.ok ? p.selector : null, date: p.ok ? p.date : null };
    })
    .sort((a, b) => b.number - a.number);

  const model = {
    computedOn: {
      targetRef,
      targetSha: targetSha ? targetSha.slice(0, 9) : null,
      shallow: repoFacts.shallow,
      boundary: repoFacts.boundary,
      boundaryDate: repoFacts.boundaryDate,
      apiCalls: calls,
      generatedAt: new Date().toISOString(),
    },
    corpus: {
      total: issues.length,
      open: issues.filter((i) => i.state === 'open').length,
      closed: issues.filter((i) => i.state === 'closed').length,
      parsed: parsedOk.length,
      unparseable: unparseable.length,
    },
    rows,
    superseded: superseded.map((s) => ({
      number: s.number,
      selector: s.parsed.selector,
      date: s.parsed.date,
      supersededBy: latestBySelector.get(s.parsed.selector),
    })),
    unparseable,
    areaGaps,
    openRecords,
  };

  process.stdout.write(asJson ? `${JSON.stringify(model, null, 2)}\n` : `${renderMarkdown(model)}\n`);
}

function valueOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/* ------------------------------------------------------------------ *
 * --self-test: exercises the pure core against fixtures taken from the
 * REAL corpus as measured on 2026-08-18. No network, no git needed.
 * ------------------------------------------------------------------ */

/**
 * Every distinct title shape the live corpus actually contains. If a future
 * record introduces a sixth phrasing, this list is where it gets pinned.
 */
export const FIXTURE_TITLES = [
  // <judged>/<total> in the parenthetical
  'QA run · tier2c:browser-2 (18/18) · e4e5c6e3 · 2026-08-18 · 10 PASS / 4 PARTIAL / 4 FAIL',
  // "<n> items" -- a total with no judged
  'QA run · tier1:automated-pins (77 items) · e4e5c6e3 · 2026-08-17 · 35 PASS / 39 PARTIAL / 0 FAIL',
  // "FULL area" -- a note, no numbers
  'QA run · studio-authoring (FULL area) · e4e5c6e3 · 2026-08-17 · 0 PASS / 1 PARTIAL / 0 FAIL (11 not-run)',
  // "<a>/<b> items consulted"
  'QA run · integration-system (6/14 items consulted) · e4e5c6e3 · 2026-08-17 · 2 PASS / 4 PARTIAL / 0 FAIL / 8 NOT-RUN',
  // "<a> of <b> items"
  'QA run · automation (5 of 10 items) · e4e5c6e3 · 2026-08-17 · 1 PASS / 3 PARTIAL / 1 BLOCKED',
  // no parenthetical at all
  'QA run · priority:P0 · e4e5c6e3 · 2026-08-17 · 7 PASS / 7 PARTIAL / 2 FAIL / 2 BLOCKED',
  // no PARTIAL bucket declared
  'QA run · ai (FULL area) · 92f26f75 · 2026-08-11 · 4 PASS / 3 FAIL',
];

function assert(cond, msg, failures) {
  if (!cond) failures.push(msg);
  return cond ? 1 : 0;
}

async function selfTest() {
  const failures = [];
  let checked = 0;

  // --- every real shape parses -------------------------------------------
  for (const title of FIXTURE_TITLES) {
    const p = parseRunTitle(title);
    checked += assert(p.ok, `fixture must parse: ${title}\n    -> ${p.ok ? '' : p.reason}`, failures);
  }

  const byIndex = FIXTURE_TITLES.map(parseRunTitle);

  // judged/total extraction, per phrasing
  checked += assert(byIndex[0].judged === 18 && byIndex[0].total === 18, '"(18/18)" -> 18/18', failures);
  checked += assert(byIndex[1].judged === null && byIndex[1].total === 77, '"(77 items)" -> total only', failures);
  checked += assert(
    byIndex[2].judged === null && byIndex[2].total === null && byIndex[2].note === 'FULL area',
    '"(FULL area)" -> note, no numbers',
    failures,
  );
  checked += assert(byIndex[3].judged === 6 && byIndex[3].total === 14, '"(6/14 items consulted)" -> 6/14', failures);
  checked += assert(byIndex[4].judged === 5 && byIndex[4].total === 10, '"(5 of 10 items)" -> 5/10', failures);
  checked += assert(
    byIndex[5].judged === null && byIndex[5].total === null && byIndex[5].note === null,
    'no parenthetical -> no judged/total and no note',
    failures,
  );
  checked += assert(byIndex[5].selector === 'priority:P0', 'bare selector survives intact', failures);

  // the parenthetical must not leak into the selector
  checked += assert(byIndex[0].selector === 'tier2c:browser-2', 'selector excludes the parenthetical', failures);

  // --- counts, both NOT-RUN spellings ------------------------------------
  checked += assert(byIndex[2].counts['NOT-RUN'] === 11, 'trailing "(11 not-run)" counts as NOT-RUN', failures);
  checked += assert(byIndex[3].counts['NOT-RUN'] === 8, 'segment "8 NOT-RUN" counts as NOT-RUN', failures);
  checked += assert(byIndex[4].counts.BLOCKED === 1, 'BLOCKED parsed', failures);

  // an UNDECLARED bucket must be absent, not zero -- the render shows it as
  // "—", and conflating the two would invent a fact the record never stated.
  checked += assert(!('PARTIAL' in byIndex[6].counts), 'undeclared PARTIAL stays absent, not 0', failures);
  checked += assert(!('NOT-RUN' in byIndex[0].counts), 'undeclared NOT-RUN stays absent, not 0', failures);
  checked += assert(byIndex[0].counts.FAIL === 4, 'declared 4 FAIL parsed', failures);
  checked += assert(byIndex[1].counts.FAIL === 0, 'declared 0 FAIL is present AND zero', failures);

  // --- selector kinds -----------------------------------------------------
  checked += assert(classifySelector('tier2c:browser-2') === 'tier', 'tier selector classified', failures);
  checked += assert(classifySelector('priority:P0') === 'priority', 'priority selector classified', failures);
  checked += assert(classifySelector('studio-authoring') === 'area', 'area selector classified', failures);

  // --- malformed titles are REPORTED, never silently dropped --------------
  const bad = [
    ['', 'empty'],
    ['Some other issue title', 'not a run record'],
    ['QA run · thing · deadbeef · 2026-13-99 · 1 PASS', 'bad date'],
    ['QA run · thing · nothexsha · 2026-08-18 · 1 PASS', 'bad sha'],
    ['QA run · thing · deadbeef · 2026-08-18 · nothing numeric', 'no verdict counts'],
  ];
  for (const [title, why] of bad) {
    const p = parseRunTitle(title);
    checked += assert(p.ok === false && typeof p.reason === 'string' && p.reason.length > 0, `must reject (${why}) with a reason: ${JSON.stringify(title)}`, failures);
  }

  // The convention as DOCUMENTED (6 fields, standalone judged/total) is not
  // what any record writes. It must be rejected loudly rather than mis-parsed
  // into the wrong fields -- that drift is a finding, not something to absorb.
  const documented = 'QA run · records-forms · 12/33 · e4e5c6e3 · 2026-08-17 · 2 PASS / 10 PARTIAL / 1 FAIL';
  const docParsed = parseRunTitle(documented);
  checked += assert(
    docParsed.ok === false && /6 .*fields, expected 5/.test(docParsed.reason),
    'the 6-field documented convention is rejected with a field-count reason',
    failures,
  );

  // --- the judged cell, and the provenance of its denominator -------------
  checked += assert(judgedCell(byIndex[0], null) === '18/18', 'declared judged/total wins', failures);
  checked += assert(judgedCell(byIndex[1], null) === '74/77', 'declared total + summed counts', failures);
  // "(FULL area)" declares no total. When the selector is a known area, the
  // checklist's item count supplies the denominator -- marked `*`, because it
  // is not the record's claim. This is what makes a record titled "FULL area"
  // that judged 13 of 33 items legible instead of reassuring.
  checked += assert(judgedCell(byIndex[2], 12) === '12/12*', 'area item count supplies a starred denominator', failures);
  checked += assert(
    judgedCell({ judged: null, total: null, note: 'FULL area', counts: { PASS: 2, PARTIAL: 10, FAIL: 1 } }, 33) === '13/33*',
    'a "FULL area" record that judged 13 of 33 renders as 13/33*, not as complete',
    failures,
  );
  checked += assert(judgedCell(byIndex[2], null) === '12 (FULL area)', 'unknown area -> note preserved', failures);
  checked += assert(judgedCell(byIndex[5], null) === '18/?', 'no total and no note -> sum over unknown', failures);

  // --- freshness is three-valued -----------------------------------------
  const repoShallow = { shallow: true, boundaryDate: '2026-08-16' };
  const repoFull = { shallow: false, boundaryDate: null };
  const target = { sha: 'e4e5c6e3aaaaaaaa', ref: 'origin/main' };

  const current = classifyFreshness(
    { sha: 'e4e5c6e3', date: '2026-08-17' },
    target,
    { resolved: true, isAncestor: true, behind: 0, commitDate: '2026-08-17' },
    repoShallow,
  );
  checked += assert(current.state === 'current', 'sha equal to target -> current', failures);

  const stale = classifyFreshness(
    { sha: 'abcdef12', date: '2026-08-17' },
    target,
    { resolved: true, isAncestor: true, behind: 122, commitDate: '2026-08-17' },
    repoShallow,
  );
  checked += assert(stale.state === 'stale' && stale.behind === 122, 'ancestor behind target -> stale with distance', failures);

  // THE regression this script exists to prevent: a pre-boundary commit in a
  // shallow clone answers `isAncestor === false`, and that must NOT read as
  // fresh. Nine of the twenty-three live records are exactly this shape.
  const shallowUnknown = classifyFreshness(
    { sha: '92f26f75', date: '2026-08-11' },
    target,
    { resolved: true, isAncestor: false, behind: null, commitDate: '2026-08-11' },
    repoShallow,
  );
  checked += assert(shallowUnknown.state === 'unknown', 'pre-boundary + shallow -> unknown, NOT fresh', failures);
  checked += assert(shallowUnknown.reason === 'shallow', 'pre-boundary unknown names `shallow` as the reason', failures);
  checked += assert(shallowUnknown.state !== 'current', 'pre-boundary must never classify as current', failures);

  // the same facts in a FULL clone mean something different: genuinely diverged
  const diverged = classifyFreshness(
    { sha: '92f26f75', date: '2026-08-11' },
    target,
    { resolved: true, isAncestor: false, behind: null, commitDate: '2026-08-11' },
    repoFull,
  );
  checked += assert(diverged.state === 'unknown' && diverged.reason === 'diverged', 'full clone + not ancestor -> unknown/diverged', failures);

  const unreachable = classifyFreshness(
    { sha: 'ffffffff', date: '2026-08-01' },
    target,
    { resolved: false, isAncestor: null, behind: null, commitDate: null },
    repoShallow,
  );
  checked += assert(unreachable.state === 'unknown' && unreachable.reason === 'unreachable', 'unresolvable sha -> unknown/unreachable', failures);

  // no combination of inputs may yield a two-way boolean
  checked += assert(
    ['current', 'stale', 'unknown'].includes(unreachable.state),
    'freshness state stays in its vocabulary',
    failures,
  );

  // --- latest-per-selector wins ------------------------------------------
  const recs = [
    { number: 7695, parsed: { selector: 'studio-authoring', selectorKind: 'area', date: '2026-08-11' } },
    { number: 9353, parsed: { selector: 'studio-authoring', selectorKind: 'area', date: '2026-08-17' } },
    { number: 9330, parsed: { selector: 'access-security', selectorKind: 'area', date: '2026-08-17' } },
  ];
  const rolled = rollUp(recs);
  checked += assert(rolled.latest.length === 2, 'two selectors -> two latest rows', failures);
  checked += assert(
    rolled.latest.find((r) => r.parsed.selector === 'studio-authoring').number === 9353,
    'the newer studio-authoring record wins',
    failures,
  );
  checked += assert(
    rolled.superseded.length === 1 && rolled.superseded[0].number === 7695,
    'the older record is reported as superseded, not dropped',
    failures,
  );

  // same-day tie breaks by issue number (filing order)
  const sameDay = rollUp([
    { number: 100, parsed: { selector: 'x', selectorKind: 'area', date: '2026-08-17' } },
    { number: 101, parsed: { selector: 'x', selectorKind: 'area', date: '2026-08-17' } },
  ]);
  checked += assert(sameDay.latest[0].number === 101, 'same-day tie -> higher issue number wins', failures);

  // --- the render must never hide a record --------------------------------
  const md = renderMarkdown({
    computedOn: {
      targetRef: 'origin/main',
      targetSha: 'b057e53f4',
      shallow: true,
      boundary: '713ccbc95',
      boundaryDate: '2026-08-16',
      apiCalls: 1,
      generatedAt: '2026-08-18T00:00:00.000Z',
    },
    corpus: { total: 2, open: 0, closed: 2, parsed: 1, unparseable: 1 },
    rows: [
      {
        number: 9353,
        selector: 'studio-authoring',
        selectorKind: 'area',
        date: '2026-08-17',
        sha: 'e4e5c6e3',
        counts: { PASS: 0, PARTIAL: 1, FAIL: 0, 'NOT-RUN': 11 },
        judgedCell: '12 (FULL area)',
        freshness: { state: 'unknown', reason: 'shallow', behind: null },
      },
    ],
    superseded: [],
    unparseable: [{ number: 4242, title: 'QA run · broken', reason: '2 fields, expected 5' }],
    areaGaps: [{ area: 'dashboards', items: 10 }],
    openRecords: [],
  });
  checked += assert(md.includes('#4242'), 'unparseable record appears in the rendered view', failures);
  checked += assert(md.includes('2 fields, expected 5'), 'unparseable reason appears in the rendered view', failures);
  checked += assert(md.includes('dashboards'), 'area with no record appears as a gap', failures);
  checked += assert(md.includes('? shallow'), 'unknown freshness renders as ? with its reason', failures);
  checked += assert(!/\bcurrent\b.*studio-authoring/.test(md), 'an unknown row is not rendered as current', failures);
  checked += assert(md.includes('computedOn'), 'provenance block is present', failures);
  checked += assert(md.includes('not a number the record declared'), 'the starred-denominator legend is present', failures);
  checked += assert(md.includes('713ccbc95'), 'provenance names the shallow boundary', failures);
  checked += assert(md.includes('No state is written'), 'the view states that it writes nothing', failures);
  checked += assert(md.includes('bodies are not parsed'), 'the view states it did not read the bodies', failures);
  // an undeclared bucket renders as the em dash, not as 0
  checked += assert(/\|\s*—\s*\|/.test(md), 'undeclared bucket renders as — rather than 0', failures);

  if (failures.length > 0) {
    console.error(`✗ qa-rollup --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`✓ qa-rollup --self-test: ${checked} assertions over ${FIXTURE_TITLES.length} real-corpus title shapes`);
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (process.argv[1] && process.argv[1].endsWith('qa-rollup.mjs')) {
  await main(process.argv.slice(2));
}
