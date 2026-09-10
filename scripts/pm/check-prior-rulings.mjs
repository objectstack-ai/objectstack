#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-prior-rulings — the MECHANICAL half of the governing-text step: given a
 * decision card, list the ADR decisions that already rule on its terms (#17009).
 *
 *   node scripts/pm/check-prior-rulings.mjs --card 16934
 *   node scripts/pm/check-prior-rulings.mjs --card 16934 --terms single,posture,tenant
 *   node scripts/pm/check-prior-rulings.mjs --terms single,posture,tenant
 *   node scripts/pm/check-prior-rulings.mjs --card 16934 --json
 *   node scripts/pm/check-prior-rulings.mjs --self-test
 *
 * The board the card is read from is `PM_SWEEP_REPO`, resolved the way
 * `check-half-states.mjs` resolves it. ⛔ There is no `--repo` flag, for the
 * reason that file gives and one more of this file's own: the CORPUS is always
 * THIS checkout (`docs/adr/**`, `AGENTS.md`, `packages/spec/src/**` are
 * objectstack paths), so a flag naming a different board would read a card from
 * one repo and answer it out of another repo's rulings, with nothing in the
 * output saying so.
 *
 * ## Why this file exists at all
 *
 * `references/lanes/director.md:45` already prescribes the search, in as many
 * words: 「呈报前逐卡逐仓重跑 `git grep -n -iE 'TERMS' origin/main -- AGENTS.md
 * docs/adr packages/spec/src`」. Until this file that step was a human reading,
 * and it failed twice in four days at the two points where it applies — once at
 * FILING (#16934's `Governing text:` line named ADR-0105, ADR-0021 D-C, two code
 * symbols and a maintainer ruling, and did not name ADR-0131, whose D8 answers
 * the card's question verbatim) and once at PRESENTATION (the presenting seat
 * re-ran the card's own `re-check` commands and one targeted grep, not the
 * charter's). #15929 is the same class, and its remedy was text — which is
 * exactly the remedy this file exists because it was tried.
 *
 * The class has a shape worth stating: a card's own `re-check` commands are
 * authored by the filer to re-verify the filer's PREMISES, so they confirm the
 * code still looks as described and say nothing about whether the QUESTION is
 * still open. A premise pass is not a prior-ruling pass, and no amount of care
 * inside one converts it into the other.
 *
 * ## What it decides: nothing
 *
 * Report-only, and structurally so — this file has no write path to GitHub in
 * any mode, no label, no title, no comment. It ranks candidates and prints
 * them; WHICH candidate governs is the seat's reading and the maintainer's
 * ruling. Exit 0 is "the read completed", 0 candidates or 400 alike.
 *
 * ## Exit codes (the `check-half-states.mjs` convention, deliberately identical)
 *
 *   0  the read completed — 0 or 400 candidates alike (report-only, see above).
 *   1  `--self-test` failed.
 *   3  PREREQUISITE NOT MET — a classified failure to read the card or the
 *      corpus. Nothing was searched, and the report prints `unresolved`
 *      instead of the `none` that would read as "searched, found nothing".
 *   2  the run could not complete for a reason this file cannot classify.
 *
 * 3 vs `none` is the whole point of the split. `none` is a finding; `unresolved`
 * is the absence of one, and a seat pasting `none` into a card because a token
 * was missing would record a search that never ran.
 *
 * ## Measured on `7aae0050`, and the measurements that SHAPED the design
 *
 * **The corpus.** 139 ADR files → 463 decision units (399 headings + 64
 * bullets); `AGENTS.md` 1074 lines; `packages/spec/src/**` 1381 TypeScript
 * files, 16.8 MB, carrying 11,380 docblocks. Whole-corpus read: ~600 ms via one
 * `git cat-file --batch` per corpus. So RUNTIME never needed bounding — the
 * thing that needed bounding was OUTPUT, and only for one corpus:
 *
 *     corpus                      units    hit by #16934's 13 title terms
 *     docs/adr/** decisions         463    166  → nameable, ranked, top-N
 *     AGENTS.md lines              1074     32  → nameable, ranked, top-N
 *     packages/spec/src docblocks 11,380  1967  → COUNT only
 *
 * 1,967 named docblocks is not a reading a seat can act on, so that corpus is
 * reported as a count with its top-N named and the rest counted. ⛔ The count is
 * never suppressed: a corpus that was searched and is merely too broad to name
 * must still say how broad, or "not named" and "not searched" render alike.
 *
 * **Term derivation, and the population it has to work on.** Of the 27 open
 * `needs-user-decision` cards on the live board, FOUR carry a governing-text
 * carrier at all — one inline (`**Governing text:**`), three as a `## Governing
 * text` section — and 23 carry none. A derivation resting on that line would
 * therefore produce an empty term set on 85% of the real population and print
 * `0 hits; none`, which is the very false-green this card was filed against. So
 * the TITLE is the primary and always-present source, the governing-text
 * carrier is additive in both its measured shapes, and an absent carrier is
 * announced (`governing-text: absent`) rather than passed over.
 *
 * **Matching is word-boundary, not substring.** The charter's `git grep -iE`
 * is substring, and substring lets `data` match `metadata`/`database`: over the
 * decision corpus that term alone hits 110 units instead of 38. Measured on the
 * #16934 term set, word-boundary cut the candidate set 215 → 166 AND moved the
 * card's own omitted ruling UP the ranking, rank 3 → rank 2. Less noise and a
 * better answer are not a trade here, so there is nothing to trade off.
 *
 * **The fixture ranks.** #16934's terms surface ADR-0131 D8 at rank 2 of 166
 * from the title alone, and rank 1 of 275 with its governing-text line folded
 * in. Both are inside any usable `--top`.
 *
 * ## The two decision shapes, and why the bullet one needs a separator rule
 *
 * A HEADING is structural on its own: `### D8 — One predicate, computed once`,
 * but also `### D7 (durable) — …`, `### D3 wave 1 — …`, `### D1/D2 carry the
 * identical error`, `#### D9.1 — …`, and the Chinese ones that separate with
 * `：` rather than a dash. Requiring a dash after the number drops 26 of 399
 * real headings, so the rule is just "a level-3 or level-4 heading whose title
 * starts with a D-number".
 *
 * A BULLET is not structural — `- **D3 is the only structural cost.**` and
 * `- **D4's conflict-freedom argument does not survive co-ownership
 * unexamined.**` are prose ABOUT a decision, not the decision. So the bullet
 * rule requires the D-number to be followed by a separator (the closing `**`, a
 * dash, or a parenthetical qualifier then one of those), which admits all 64
 * real decision bullets and rejects exactly those 3 prose ones.
 *
 * ## Status classification, and why the raw line is always printed
 *
 * `**Status**:` is written eight different ways in the corpus (`Accepted`,
 * `Accepted (2026-07-30)`, `**Status:** accepted`, `Accepted — implemented`,
 * `Superseded by v4 …`, `Revised (…) — supersedes the original`, `Proposed —
 * partially implemented`, `The DECISION is Accepted — it is …`). The classifier
 * reads them in retirement-first order (superseded/withdrawn beat accepted beats
 * revised beats proposed) and everything it cannot place lands in `unknown` —
 * loudly, and counted. ⛔ `unknown` is never folded into `proposed`: a decision
 * this file mis-files as unaccepted is a decision it hides, which is the failure
 * it exists to prevent. The raw status text is printed beside every candidate so
 * the classification is checkable without opening the ADR.
 *
 * Only `accepted` decisions are named in the paste line, because 〈升级与决策〉③
 * (⛔ 不推翻既有维护者裁决) binds on accepted rulings; the rest are printed in the
 * body, flagged, so a `proposed` near-miss is visible rather than silently
 * dropped.
 */

import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
// ⛔ Not copied. The board resolver and the proxy-rearm plan are ONE source in
// `check-half-states.mjs` — the same import `check-widening-tells.mjs` takes —
// so this reader and the patrol cannot come to disagree about which board is
// being read or whether this container's fetch reaches it.
import { DEFAULT_SWEEP_REPO, resolveSweepRepo, proxyRearmPlan, PROXY_FLAG, PROXY_REARM_GUARD } from './check-half-states.mjs';

export const EXIT_OK = 0;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_UNCLASSIFIED = 2;
export const EXIT_PREREQUISITE_NOT_MET = 3;

export const DEFAULT_REV = 'origin/main';
export const DEFAULT_TOP = 10;
export const MIN_TERM_LENGTH = 4;
/** How many terms the pasted line spells out before it starts counting. */
export const MAX_PASTE_TERMS = 12;

/** This file, resolved for the proxy re-exec below. */
const SELF_PATH = fileURLToPath(import.meta.url);

/**
 * This file's OWN re-exec guard. It is deliberately not the patrol's: sharing
 * one variable would let a re-exec of that script suppress the re-exec of this
 * one, and the symptom would be a silent 401 on a container where the proxy
 * supplies the credential — which is exactly the bypass this exists to close.
 */
export const OWN_PROXY_REARM_GUARD = 'OS_PRIOR_RULINGS_PROXY_REARMED';

/**
 * Route this process's `fetch` through `HTTPS_PROXY` before asking it anything.
 *
 * MEASURED in the seat's container: `GITHUB_TOKEN` and `GH_TOKEN` both hold the
 * literal `proxy-injected` — the proxy supplies the real credential — and node's
 * `fetch` does not read `HTTPS_PROXY`, so an unrouted request sends that
 * placeholder and gets a 401. `curl` on the same container gets a 200. The
 * failure is therefore a ROUTE, and a reader that reported it as a credential
 * problem would send a seat hunting for a secret that does not exist.
 *
 * The PLAN is imported, never restated; only the guard variable is this file's.
 */
function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    // Map this file's guard onto the name the shared plan reads, so the logic
    // stays single-sourced while the guards stay independent.
    env: { ...process.env, [PROXY_REARM_GUARD]: process.env[OWN_PROXY_REARM_GUARD] },
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container — the verdict says which.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [OWN_PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(
    `⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); ` +
      'continuing in-process — every request will bypass the proxy.',
  );
  return null;
}

/**
 * The corpora, declared once so the report, the JSON and `dispatch-gates.mjs`
 * cannot come to disagree about what was searched.
 *
 * `named` is whether a hit in this corpus can be reported as an identified
 * thing. It is a property of the corpus's STRUCTURE, not of its size: ADR
 * decisions have a `D<n>` identity, `AGENTS.md` lines have a line number under
 * a heading, and a docblock has neither once you leave the file it sits in.
 */
export const CORPORA = Object.freeze([
  Object.freeze({ id: 'adr', path: 'docs/adr', what: 'ADR decisions (`### D<n>` headings and `- **D<n>** —` bullets, each with its first paragraph)', named: true }),
  Object.freeze({ id: 'agents', path: 'AGENTS.md', what: 'AGENTS.md lines', named: true }),
  Object.freeze({ id: 'spec', path: 'packages/spec/src', what: 'packages/spec/src docblocks', named: false }),
]);

/**
 * Stopwords — dropped from a derived term set, never from an explicit `--terms`.
 *
 * The list is deliberately about ENGLISH FUNCTION WORDS and the card-writing
 * vocabulary that every card shares (`decision`, `finding`, `platform`), not
 * about the domain. A domain word that turns out to be too broad is the seat's
 * problem to fix with `--terms`, and it can see the term set to know to.
 * ⛔ Never grow this list with a word that carries meaning on some cards — a
 * silently-dropped term is a silently-missed ruling.
 */
export const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'always', 'another', 'because', 'been', 'before',
  'being', 'both', 'card', 'cards', 'case', 'cases', 'cannot', 'could', 'decision', 'decisions',
  'does', 'done', 'down', 'each', 'either', 'else', 'even', 'ever', 'every', 'finding', 'findings',
  'from', 'further', 'have', 'having', 'here', 'however', 'into', 'issue', 'issues', 'just',
  'keep', 'kept', 'like', 'made', 'make', 'many', 'more', 'most', 'much', 'must', 'need', 'needs',
  'never', 'none', 'once', 'only', 'onto', 'other', 'others', 'over', 'platform', 'proposal',
  'proposed', 'rather', 'really', 'same', 'shall', 'should', 'since', 'some', 'still', 'such',
  'take', 'taken', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing',
  'things', 'this', 'those', 'through', 'thus', 'under', 'until', 'upon', 'used', 'uses', 'using',
  'very', 'want', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'within',
  'without', 'would', 'your',
]);

// ---------------------------------------------------------------------------
// Term derivation
// ---------------------------------------------------------------------------

/**
 * A term is admissible when it is long enough to discriminate and is not a
 * function word. The length floor is measured, not aesthetic: at 3 characters
 * the derived set picks up `sql`, `org`, `api`, `all`, each of which matches a
 * majority of the corpus and flattens the ranking that does the actual work.
 */
export function admissibleTerm(word) {
  if (typeof word !== 'string') return false;
  const lo = word.toLowerCase();
  if (lo.length < MIN_TERM_LENGTH) return false;
  if (STOPWORDS.has(lo)) return false;
  if (/^[0-9]+$/.test(lo)) return false;
  // A bare date or an issue-number-shaped token is provenance, not a subject.
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(lo)) return false;
  return true;
}

/**
 * Derive terms from one piece of card text.
 *
 * Backticked code spans are read FIRST and split on non-identifier characters,
 * because a card's identifiers are its sharpest terms and its prose is its
 * blurriest — `computeTenantLayer0Verdict` names one thing, `platform` names
 * everything. Splitting a span keeps both the whole identifier and its parts
 * (`DriverOptions.tenantId` yields the dotted form and `DriverOptions` and
 * `tenantId`), so a corpus that spells it either way is reached.
 */
export function deriveTerms(text, source, into = new Map()) {
  if (typeof text !== 'string' || text === '') return into;
  const add = (word) => {
    // A term is ONE token. Leading/trailing punctuation is trimmed (a route
    // written `/data` searches for `data`), and anything still carrying a space
    // or a separator is a phrase, not a term — measured on #16934, whose
    // governing line put whole clauses inside backticks and, unguarded, turned
    // 「, boot log 「tenancy posture 'single' — layer 0 is inert」) ·」 into a
    // "term" that can never match and cannot be pasted into a card either.
    const token = String(word).trim().replace(/^[^A-Za-z0-9_]+/, '').replace(/[^A-Za-z0-9_]+$/, '');
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(token)) return;
    if (!admissibleTerm(token)) return;
    const lo = token.toLowerCase();
    if (!into.has(lo)) into.set(lo, source);
  };
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    add(m[1]);
    for (const part of m[1].split(/[^A-Za-z0-9_.-]+/)) {
      add(part);
      // A dotted identifier also yields its segments.
      if (part.includes('.')) for (const seg of part.split('.')) add(seg);
    }
  }
  for (const word of text.replace(/`[^`]*`/g, ' ').split(/[^A-Za-z0-9_-]+/)) add(word);
  return into;
}

/**
 * The governing-text carrier, in the two shapes the live board actually uses.
 *
 * Measured over the 27 open `needs-user-decision` cards: one inline
 * (`**Governing text:** …`, and #16934 spells the label inside backticks), three
 * as a `## Governing text` section, 23 with no carrier at all. The label is read
 * through surrounding markdown emphasis because the carrier is free prose that
 * no schema pins — that is reading ONE carrier written loosely, not aliasing two
 * contracts, and the shape found is reported so the reading stays checkable.
 *
 * Returns `null` when there is no carrier — which the caller must announce.
 */
export function extractGoverningText(body) {
  if (typeof body !== 'string' || body === '') return null;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^#{1,6}\s+[`*_]*\s*Governing\s+text\b/i);
    if (heading) {
      const out = [];
      for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]); j++) out.push(lines[j]);
      const text = out.join('\n').trim();
      if (text) return { shape: 'section', text };
      continue;
    }
    const inline = lines[i].match(/^[\s>*_`-]*Governing\s+text[`*_]*\s*[:：]\s*(.*)$/i);
    if (inline && inline[1].trim()) {
      // The inline carrier can wrap onto continuation lines; take them until a
      // blank line, the way the cards that use it are actually written.
      const out = [inline[1]];
      for (let j = i + 1; j < lines.length && lines[j].trim() !== '' && !/^#{1,6}\s/.test(lines[j]); j++) out.push(lines[j]);
      return { shape: 'inline', text: out.join('\n').trim() };
    }
  }
  return null;
}

/**
 * The full term set for a card, with each term's provenance.
 *
 * `--terms` REPLACES the derivation rather than extending it: a seat passing
 * terms has read the card and is narrowing on purpose, and quietly folding a
 * derived set back in would hand back the noise they just removed.
 */
export function buildTermSet({ title, body, override }) {
  if (Array.isArray(override) && override.length > 0) {
    const map = new Map();
    for (const raw of override) {
      const t = String(raw).trim().toLowerCase();
      if (t) map.set(t, 'override');
    }
    return { terms: [...map.keys()], sources: map, governing: null, governingAbsent: false };
  }
  const map = new Map();
  deriveTerms(title ?? '', 'title', map);
  const governing = extractGoverningText(body ?? '');
  if (governing) deriveTerms(governing.text, 'governing', map);
  return { terms: [...map.keys()], sources: map, governing, governingAbsent: !governing };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word-boundary, case-insensitive. JavaScript's `\b` is wrong here — it treats
 * `-` and `.` as boundaries, so `driver-sql` would match inside `driver-sqlite`
 * and `tenantId` inside `x.tenantId.y` in ways the charter's grep does not.
 * The class spelled out is "identifier character", which is what a term is.
 */
export function termMatcher(term) {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(term)}($|[^A-Za-z0-9_])`, 'i');
  return (text) => re.test(text);
}

export function matchTerms(text, terms) {
  const lower = typeof text === 'string' ? text : '';
  return terms.filter((t) => termMatcher(t)(lower));
}

// ---------------------------------------------------------------------------
// ADR corpus: parsing decision units
// ---------------------------------------------------------------------------

/**
 * Two shapes, measured on the tree; see the header for why the bullet one
 * carries a separator requirement and the heading one does not.
 */
export const ADR_HEADING_RE = /^(#{3,4})\s+(D\d+(?:\.\d+)?(?:\/D\d+)*)\b\s*(?:[—–:：-]\s*)?(.*)$/;
export const ADR_BULLET_RE = /^-\s+\*\*(D\d+(?:\/D\d+)*)\s*(?:\([^)]*\))?\s*(?:\*\*\s*)?(?:[—–-]\s*)?(.*)$/;

/** Does a bullet line carry a decision, or prose about one? */
export function isDecisionBullet(line) {
  if (!/^-\s+\*\*D\d+/.test(line)) return false;
  return /^-\s+\*\*D\d+(?:\/D\d+)*\s*(?:\([^)]*\))?\s*(?:\*\*|[—–-])/.test(line);
}

/** The `**Status**:` / `**Status:**` line of an ADR, raw. */
export function extractStatusLine(text) {
  const m = String(text ?? '').match(/^\s*\*\*Status\*?\*?:?\*?\*?\s*:?\s*(.+)$/mi);
  return m ? m[1].trim() : null;
}

export const STATUS_WORDS = Object.freeze(['superseded', 'withdrawn', 'rejected', 'accepted', 'revised', 'proposed']);

/**
 * POSITIONAL-FIRST, and `unknown` is its own bucket.
 *
 * ⚠️ The obvious rule — retirement-first precedence, scanning the whole line —
 * is WRONG, and the live corpus proves it. ADR-0076's status opens `Accepted —
 * D1/D2/D4/D5/D6/D8/D9 implemented; D10/D12 partially landed…` and mentions a
 * supersession of one sub-part much later; ADR-0105's opens `Accepted
 * (2026-07-27…) — Phase 0/1 implemented. Amended…` and says `withdrawn` of a
 * withdrawn proposal further along. Under precedence-scanning both ADRs
 * classify as retired and their accepted decisions vanish from the paste line
 * — the reader silently hiding a standing ruling, which is the exact failure it
 * exists to prevent.
 *
 * Every measured shape STATES its verdict first (`Accepted (…)`, `Superseded by
 * v4 …`, `Revised (…) — supersedes the original`, `Proposed — partially
 * implemented`, `The DECISION is Accepted — it is …`), so the FIRST status word
 * in the line is the verdict and everything after it is commentary. Reading
 * position instead of precedence also makes `supersedes`≠`superseded` moot.
 */
export function classifyStatus(statusLine) {
  if (!statusLine) return 'unknown';
  const s = String(statusLine).toLowerCase();
  let best = null;
  for (const word of STATUS_WORDS) {
    const m = s.match(new RegExp(`(^|[^a-z])${word}([^a-z]|$)`));
    if (!m) continue;
    if (best === null || m.index < best.index) best = { index: m.index, word };
  }
  return best ? best.word : 'unknown';
}

/** `docs/adr/0131-total-…md` → `ADR-0131`. */
export function adrIdOf(path) {
  const m = String(path).match(/(?:^|\/)(\d{4})-/);
  return m ? `ADR-${m[1]}` : null;
}

/**
 * Parse one ADR file into decision units. A unit is a heading (or decision
 * bullet) plus its first paragraph — the scope the card asked for, and the
 * scope that keeps a term hit attributable to a DECISION rather than to an ADR.
 */
export function parseAdrUnits(path, text) {
  const lines = String(text ?? '').split('\n');
  const statusLine = extractStatusLine(text);
  const status = classifyStatus(statusLine);
  const adr = adrIdOf(path);
  const units = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let id = null;
    let heading = '';
    let body = [];

    const h = line.match(ADR_HEADING_RE);
    if (h) {
      id = h[2];
      heading = h[3].trim();
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      while (j < lines.length && lines[j].trim() !== '' && !/^#{1,6}\s/.test(lines[j])) {
        body.push(lines[j]);
        j++;
      }
    } else if (isDecisionBullet(line)) {
      const b = line.match(ADR_BULLET_RE);
      id = b[1];
      heading = b[2].trim();
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j])) body.push(lines[j]);
        else break;
      }
    } else {
      continue;
    }

    units.push({
      corpus: 'adr',
      adr,
      id,
      heading: heading.replace(/\*\*/g, '').trim(),
      file: path,
      line: i + 1,
      status,
      statusLine,
      text: `${heading}\n${body.join('\n')}`,
    });
  }
  return units;
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
}

/**
 * Read many blobs in ONE child process. Reading 1,381 spec files as 1,381
 * `git show` spawns is the difference between ~600 ms and half a minute, and a
 * check nobody waits for is a check nobody runs.
 */
export function readBlobsAtRev(rev, paths) {
  if (paths.length === 0) return [];
  const input = paths.map((p) => `${rev}:${p}`).join('\n') + '\n';
  const out = execFileSync('git', ['cat-file', '--batch'], {
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  const files = [];
  let off = 0;
  let i = 0;
  while (off < out.length && i < paths.length) {
    const nl = out.indexOf(10, off);
    if (nl < 0) break;
    const header = out.toString('utf8', off, nl);
    const size = Number.parseInt(header.split(' ')[2], 10);
    if (!Number.isFinite(size)) {
      // `<oid> missing` — a path that is not in the tree. Skip its record; the
      // caller's own count check is what notices a corpus that went absent.
      off = nl + 1;
      i++;
      continue;
    }
    files.push({ path: paths[i], text: out.toString('utf8', nl + 1, nl + 1 + size) });
    off = nl + 1 + size + 1;
    i++;
  }
  return files;
}

export function listAtRev(rev, path) {
  const out = git(['ls-tree', '-r', '--name-only', rev, '--', path]).trim();
  return out === '' ? [] : out.split('\n');
}

/** Read the ADR corpus from a plain directory — the `--self-test` fixture path. */
export function readDirAdrCorpus(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    files.push({ path: `docs/adr/${name}`, text: readFileSync(join(dir, name), 'utf8') });
  }
  return files;
}

/** Extract `/** … *\/` docblocks with their starting line numbers. */
export function extractDocblocks(path, text) {
  const out = [];
  const src = String(text ?? '');
  for (const m of src.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    out.push({ path, line: src.slice(0, m.index).split('\n').length, text: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Rank by DISTINCT-TERM COVERAGE, descending. A unit matching five of the
 * card's terms is more likely to be about the card than one matching a single
 * broad term forty times, and counting occurrences instead would rank a long
 * ADR above a short decision for being long.
 */
export function rankUnits(units, terms) {
  return units
    .map((u) => ({ unit: u, matched: matchTerms(u.text, terms) }))
    .filter((r) => r.matched.length > 0)
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length ||
        String(a.unit.adr ?? a.unit.file).localeCompare(String(b.unit.adr ?? b.unit.file)) ||
        String(a.unit.id ?? a.unit.line).localeCompare(String(b.unit.id ?? b.unit.line)),
    );
}

export function tierHistogram(ranked) {
  const hist = {};
  for (const r of ranked) hist[r.matched.length] = (hist[r.matched.length] ?? 0) + 1;
  return hist;
}

/**
 * The line a seat pastes into the four-facet block. Pinned here so the block's
 * shape has exactly one author; `references/decision-analysis.md` states the
 * same shape for a human and this function is what produces it.
 *
 * `<n>` counts ADR DECISION CANDIDATES, not raw grep lines: the line records a
 * prior-ruling reading, and "2,214 matching lines" is not one.
 */
export function formatPasteLine({ terms, candidateCount, accepted, unresolved = false }) {
  if (unresolved) return 'Prior rulings read: unresolved';
  const named = accepted.length > 0 ? accepted.join(', ') : 'none';
  // The term list is BOUNDED. Measured on #16934: title plus governing text
  // derives 42 admissible terms, and a 42-term line is not a reading anybody
  // can act on — the card carries a record, the report above it carries the
  // evidence. Terms are listed in derivation order, so the card's own TITLE
  // terms (its question) come first, and the remainder is COUNTED rather than
  // dropped: a truncation that hides its own size is a lie about the search.
  const head = terms.slice(0, MAX_PASTE_TERMS);
  const rest = terms.length - head.length;
  const shown = rest > 0 ? `${head.join(',')} (+${rest} more)` : head.join(',');
  return `Prior rulings read: ${shown} → ${candidateCount} hits; ${named}`;
}

/** The whole search, pure over already-loaded corpora. */
export function search({ terms, adrUnits, agentsLines, docblocks, top = DEFAULT_TOP }) {
  const adr = rankUnits(adrUnits, terms);
  const agents = rankUnits(agentsLines, terms);
  const spec = rankUnits(docblocks, terms);
  const shown = adr.slice(0, top);
  const accepted = [];
  for (const r of shown) {
    if (r.unit.status !== 'accepted') continue;
    const name = `${r.unit.adr} ${r.unit.id}`;
    if (!accepted.includes(name)) accepted.push(name);
  }
  return {
    terms,
    counts: {
      adr: { scanned: adrUnits.length, hit: adr.length },
      agents: { scanned: agentsLines.length, hit: agents.length },
      spec: { scanned: docblocks.length, hit: spec.length },
    },
    tiers: tierHistogram(adr),
    adr,
    agents,
    spec,
    shown,
    accepted,
    pasteLine: formatPasteLine({ terms, candidateCount: adr.length, accepted }),
  };
}

// ---------------------------------------------------------------------------
// Card read — ONE request, no retry loop
// ---------------------------------------------------------------------------

/**
 * Classify a card read into the exit register. ⛔ No retry loop, on any status:
 * the fleet runs on ONE shared identity, and a reader that retries a 403 spends
 * somebody else's quota to learn the same thing twice.
 */
export function classifyCardRead({ status, networkError, hasToken }) {
  if (!hasToken) return { kind: 'no-token', headline: 'no GITHUB_TOKEN / GH_TOKEN in the environment' };
  if (networkError) return { kind: 'network', headline: `the request did not complete (${networkError})` };
  if (status === 200) return { kind: 'ok', headline: 'the card was read' };
  if (status === 401) return { kind: 'unauthorized', headline: 'the token was rejected (401)' };
  if (status === 403) return { kind: 'forbidden', headline: 'the read was refused (403) — quota, or the token cannot see this board' };
  if (status === 429) return { kind: 'rate-limited', headline: 'the read was rate-limited (429)' };
  if (status === 404) return { kind: 'not-found', headline: 'no such card on this board (404) — check PM_SWEEP_REPO' };
  return { kind: 'unclassified-status', headline: `the read answered ${status}` };
}

async function readCard(number, repo, env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
  if (!token) return { verdict: classifyCardRead({ hasToken: false }) };
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'objectstack-check-prior-rulings',
      },
    });
  } catch (err) {
    return { verdict: classifyCardRead({ hasToken: true, networkError: err?.message ?? 'unknown' }) };
  }
  const verdict = classifyCardRead({ hasToken: true, status: res.status });
  if (verdict.kind !== 'ok') return { verdict };
  const json = await res.json();
  return { verdict, card: { number: json.number, title: json.title ?? '', body: json.body ?? '', state: json.state } };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function truncate(s, n) {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

export function renderReport(result, meta) {
  const L = [];
  L.push(`check-prior-rulings: corpus read at ${meta.rev} (${meta.tip})`);
  if (meta.card) L.push(`  card: ${meta.repo}#${meta.card.number} — ${truncate(meta.card.title, 100)}`);
  L.push('');
  L.push(`  terms (${result.terms.length}):`);
  for (const t of result.terms) L.push(`    ${t}  [${meta.sources.get(t) ?? 'derived'}]`);
  if (meta.governing) L.push(`  governing-text: present (${meta.governing.shape} form)`);
  else if (meta.governingAbsent) {
    L.push('  governing-text: absent — terms come from the TITLE alone.');
    L.push('    (Measured on the live board: 23 of 27 open decision cards carry no such carrier,');
    L.push('     so this is the ordinary case, not a defect. Narrow with --terms if the title is broad.)');
  }
  L.push('');
  for (const c of CORPORA) {
    const k = result.counts[c.id];
    L.push(`  ${c.path}: ${k.hit} hit of ${k.scanned} ${c.named ? 'searched' : 'searched (not named — see below)'}`);
  }
  L.push('');
  L.push(`  ADR decision candidates: ${result.adr.length}; distinct-term tiers ${JSON.stringify(result.tiers)}`);
  if (result.adr.length === 0) {
    L.push('    (none — no ADR decision mentions these terms)');
  } else {
    L.push(`    showing the top ${result.shown.length}${result.adr.length > result.shown.length ? ` of ${result.adr.length} (raise with --top)` : ''}:`);
    for (const r of result.shown) {
      const u = r.unit;
      const flag = u.status === 'accepted' ? '' : `  ⚠️ status: ${u.status}`;
      L.push(`      ${u.adr} ${u.id} — ${truncate(u.heading, 78)}`);
      L.push(`        ${u.file}:${u.line}   terms: ${r.matched.join(',')}${flag}`);
      L.push(`        status: ${truncate(u.statusLine ?? '(no Status line)', 96)}`);
    }
  }
  if (result.agents.length > 0) {
    L.push('');
    L.push(`  AGENTS.md: ${result.agents.length} line(s) mention these terms; top ${Math.min(5, result.agents.length)}:`);
    for (const r of result.agents.slice(0, 5)) {
      L.push(`      AGENTS.md:${r.unit.line}   terms: ${r.matched.join(',')}`);
      L.push(`        ${truncate(r.unit.text, 96)}`);
    }
  }
  if (result.spec.length > 0) {
    L.push('');
    L.push(`  packages/spec/src docblocks: ${result.spec.length} mention these terms — NOT named (a docblock`);
    L.push('    carries no decision identity, and this count runs to four figures on a broad term set).');
    L.push(`    top ${Math.min(3, result.spec.length)} by term coverage, as a pointer only:`);
    for (const r of result.spec.slice(0, 3)) {
      L.push(`      ${r.unit.file}:${r.unit.line}   terms: ${r.matched.join(',')}`);
    }
  }
  L.push('');
  L.push('  Paste into the four-facet block (edit the named set if you read further):');
  L.push('');
  L.push(`    ${result.pasteLine}`);
  L.push('');
  if (result.accepted.length > 0) {
    L.push('  ⚠️ An ACCEPTED ADR decision is named above. Under SKILL.md 〈升级与决策〉③');
    L.push('     (⛔ 不推翻既有维护者裁决) a card whose question that decision already answers is');
    L.push('     EXECUTION, not a decision: it leaves the box for `pm:blocked` behind the ADR\'s');
    L.push('     gate, or `pm:queue`. Read the decision before presenting the card.');
    L.push('');
  }
  L.push('  Report-only: this file writes nothing and decides nothing.');
  return L.join('\n');
}

export function reportPrerequisiteNotMet(verdict, extra = []) {
  const L = [
    '',
    `check-prior-rulings: PREREQUISITE NOT MET — ${verdict.headline}.`,
    '',
    '  Nothing was searched. The paste line is:',
    '',
    `    ${formatPasteLine({ unresolved: true, terms: [], candidateCount: 0, accepted: [] })}`,
    '',
    '  ⛔ Do NOT paste `none` — `none` says the search ran and found nothing, and this',
    '     run did not search. ⛔ Do not retry a 403 or a 429: the fleet shares one identity,',
    '     so a retry spends somebody else\'s quota to learn the same thing again.',
    ...extra,
    '',
    `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from the unclassified failure's ${EXIT_UNCLASSIFIED} — capture it BEFORE any pipe.)`,
    '',
  ];
  console.error(L.join('\n'));
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { card: null, terms: null, rev: DEFAULT_REV, top: DEFAULT_TOP, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') continue;
    if (a === '--json') { opts.json = true; continue; }
    const take = () => argv[++i];
    if (a === '--card') {
      const v = take();
      if (!/^[0-9]+$/.test(String(v ?? ''))) return { error: `--card wants an issue number, got ${JSON.stringify(v)}` };
      opts.card = Number.parseInt(v, 10);
      continue;
    }
    if (a === '--terms') {
      const v = take();
      if (!v || String(v).trim() === '') return { error: '--terms wants a comma-separated list' };
      opts.terms = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (opts.terms.length === 0) return { error: '--terms wants at least one term' };
      continue;
    }
    if (a === '--rev') {
      const v = take();
      if (!v) return { error: '--rev wants a revision' };
      opts.rev = String(v);
      continue;
    }
    if (a === '--top') {
      const v = take();
      if (!/^[0-9]+$/.test(String(v ?? '')) || Number.parseInt(v, 10) < 1) return { error: `--top wants a positive integer, got ${JSON.stringify(v)}` };
      opts.top = Number.parseInt(v, 10);
      continue;
    }
    return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  if (opts.card === null && opts.terms === null) {
    return { error: 'nothing to search for — pass --card <n>, or --terms a,b,c' };
  }
  return { opts };
}

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

async function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`check-prior-rulings: ${parsed.error}`);
    return EXIT_UNCLASSIFIED;
  }
  const { opts } = parsed;
  const sweep = resolveSweepRepo(process.env);
  if (opts.card !== null && !sweep.valid) {
    console.error(
      `check-prior-rulings: ${sweep.source}=${JSON.stringify(sweep.repo)} is not an \`owner/name\` ` +
        'repository. Refusing to fall back to a different board — a card read from the wrong repo ' +
        'reads exactly like one read from this one.',
    );
    return EXIT_UNCLASSIFIED;
  }

  // The corpus is read FIRST and its tip printed, because the seat's checkout can
  // be behind: an answer computed from a stale `origin/main` is wrong in exactly
  // the direction that matters here — it cannot see the ruling that just landed.
  let tip;
  try {
    tip = git(['rev-parse', '--short', opts.rev]).trim();
  } catch (err) {
    return reportPrerequisiteNotMet(
      { kind: 'no-rev', headline: `\`${opts.rev}\` does not resolve in this checkout (${err?.message ?? 'unknown'})` },
      ['  Run `git fetch origin main`, or name another revision with --rev.'],
    );
  }

  let card = null;
  if (opts.card !== null && opts.terms === null) {
    // Transport before questions about it: a card read taken on the BYPASSED
    // route answers about the wrong route. Re-exec first, then ask. Placed
    // after argument validation so a bad-usage run never pays for a child, and
    // after the corpus tip read so a `--rev` typo is not diagnosed twice.
    const rearmed = rearmThroughProxy(argv);
    if (rearmed !== null) return rearmed;
    const read = await readCard(opts.card, sweep.repo, process.env);
    if (read.verdict.kind !== 'ok') {
      return reportPrerequisiteNotMet(read.verdict, [
        `  Board: ${sweep.repo} (${sweep.source}); card: ${opts.card}.`,
        '  You can still search by hand: --terms a,b,c needs no card and no token.',
      ]);
    }
    card = read.card;
  } else if (opts.card !== null) {
    card = { number: opts.card, title: '', body: '', state: null };
  }

  const built = buildTermSet({ title: card?.title ?? '', body: card?.body ?? '', override: opts.terms });
  if (built.terms.length === 0) {
    return reportPrerequisiteNotMet(
      { kind: 'no-terms', headline: 'the card yielded no admissible search term' },
      ['  Every word was shorter than the length floor or a stopword. Pass --terms explicitly.'],
    );
  }

  const adrFiles = readBlobsAtRev(opts.rev, listAtRev(opts.rev, CORPORA[0].path).filter((f) => f.endsWith('.md')));
  const adrUnits = adrFiles.flatMap((f) => parseAdrUnits(f.path, f.text));
  if (adrUnits.length === 0) {
    // A corpus that reads as empty is a broken read, never a clean board.
    return reportPrerequisiteNotMet(
      { kind: 'empty-corpus', headline: `\`${CORPORA[0].path}\` parsed to zero decision units at ${opts.rev}` },
      ['  Either the path moved or the decision shapes drifted; the reader must be corrected, not trusted.'],
    );
  }
  const agentsText = readBlobsAtRev(opts.rev, [CORPORA[1].path])[0]?.text ?? '';
  const agentsLines = agentsText
    .split('\n')
    .map((text, i) => ({ corpus: 'agents', file: CORPORA[1].path, line: i + 1, text }))
    .filter((l) => l.text.trim() !== '');
  const specFiles = readBlobsAtRev(opts.rev, listAtRev(opts.rev, CORPORA[2].path).filter((f) => /\.(ts|tsx|mts|cts)$/.test(f)));
  const docblocks = specFiles.flatMap((f) =>
    extractDocblocks(f.path, f.text).map((d) => ({ corpus: 'spec', file: d.path, line: d.line, text: d.text })),
  );

  const result = search({ terms: built.terms, adrUnits, agentsLines, docblocks, top: opts.top });
  const meta = { rev: opts.rev, tip, repo: sweep.repo, card, sources: built.sources, governing: built.governing, governingAbsent: built.governingAbsent };

  if (opts.json) {
    console.log(JSON.stringify({
      rev: opts.rev,
      tip,
      repo: sweep.repo,
      card: card ? { number: card.number, title: card.title } : null,
      terms: built.terms.map((t) => ({ term: t, source: built.sources.get(t) })),
      governingText: built.governing ? { shape: built.governing.shape } : null,
      counts: result.counts,
      tiers: result.tiers,
      candidates: result.shown.map((r) => ({
        adr: r.unit.adr, decision: r.unit.id, heading: r.unit.heading,
        file: r.unit.file, line: r.unit.line, status: r.unit.status, statusLine: r.unit.statusLine,
        matched: r.matched,
      })),
      accepted: result.accepted,
      pasteLine: result.pasteLine,
    }, null, 2));
  } else {
    console.log(renderReport(result, meta));
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const SELF_TEST_VERDICT = 'check-prior-rulings-self-test-reached-its-verdict';

/**
 * The fixture corpus. ⛔ NOT the live tree: a self-test that reads `docs/adr/**`
 * passes or fails on what somebody merged this morning, and a fixture that
 * drifts with the corpus is not a fixture. The ONE live-tree assertion is the
 * existence pin below, which is a pin ON the live tree by design — its whole
 * job is to red when the real heading shape drifts away from this reader.
 */
function writeFixtureCorpus(dir) {
  // The case the card was filed on, cut down to the shape the reader parses.
  writeFileSync(join(dir, '0131-total-organization-ownership.md'), [
    '# ADR-0131: Organization ownership is total',
    '',
    '**Status**: Accepted (2026-09-04) — accepted by the merge that landed it on `main`.',
    '',
    '### D8 — One predicate, computed once',
    '',
    'The engine computes the tenant read scope from posture and context — `organization_id = :tenant`',
    'under `isolated`, `IN accessible_org_ids` under `group`, nothing under `single` — and threads the',
    '**same** value to Layer 0 and to every driver. No layer has a NULL arm.',
    '',
    '### D9 — A missing stamp is a refused write',
    '',
    'Unrelated paragraph about stamps and writes.',
    '',
  ].join('\n'));
  // The older bullet shape, plus the two prose bullets the separator rule must reject.
  writeFileSync(join(dir, '0093-tenancy-mode.md'), [
    '# ADR-0093: Tenancy mode',
    '',
    '**Status:** Accepted',
    '',
    '- **D4** — A **`tenancy` kernel service** becomes the single source of truth:',
    '  `{ mode, isolationActive, defaultOrgId() }`. plugin-auth registers the baseline.',
    '- **D3 (P0, ships regardless)** — stop stripping *authored* RLS policies on the',
    '  posture ladder.',
    '- **D3 is the only structural cost.** Write side: reference-row maintenance prose.',
    "- **D4's conflict-freedom argument does not survive co-ownership unexamined.** Prose.",
    '',
  ].join('\n'));
  // A superseded ADR whose decision matches — must be found but NOT named.
  writeFileSync(join(dir, '0006-project-environment-split.md'), [
    '# ADR-0006: Project/environment split',
    '',
    '**Status**: Superseded by v4 (`0006-project-environment-split.v4.md`) — 2026-05-20',
    '',
    '### D1 — A posture is carried per environment',
    '',
    'Every environment declares its own posture and tenant wall.',
    '',
  ].join('\n'));
  // Noise: a metadata ADR that substring-matching would drag in on `data`.
  writeFileSync(join(dir, '0028-metadata-naming.md'), [
    '# ADR-0028: Metadata naming',
    '',
    '**Status**: Accepted (2026-07-30)',
    '',
    '### D4 — Apps are sandboxed',
    '',
    'Metadata in a database is namespaced per app; no cross-app references.',
    '',
  ].join('\n'));
}

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push({ name, actual, expected, ok: Object.is(actual, expected) });

  // ---- term derivation ---------------------------------------------------
  // #16934's title, VERBATIM. ⛔ Not paraphrased and not trimmed: a fixture cut
  // down to the terms that make it pass is a fixture that proves the trimming.
  const t16934 = '[Decision] Under `single` posture, which tenant wall is the platform\'s? '
    + 'driver-sql\'s posture-independent `tenantId` auto-scope answers a platform admin 0/0/0/0 '
    + 'on `/data` while the engine path, analytics and the memory driver answer 12/30/40/14';
  const d1 = deriveTerms(t16934, 'title');
  t('a backticked identifier becomes a term', d1.has('tenantid'), true);
  t('a hyphenated prose token survives whole', d1.has('driver-sql'), true);
  t('the length floor drops a 3-letter word', deriveTerms('the sql api org all', 'title').size, 0);
  t('a stopword is dropped even at length', d1.has('platform'), false);
  t('a bare number is not a term', deriveTerms('answers 12/30/40/14', 'title').has('12'), false);
  t('a bare date is not a term', deriveTerms('maintainer ruling 2026-09-08', 'title').has('2026-09-08'), false);
  t('a dotted identifier also yields its segments', deriveTerms('`DriverOptions.tenantId`', 'title').has('driveroptions'), true);
  t('…and keeps the dotted form too', deriveTerms('`DriverOptions.tenantId`', 'title').has('driveroptions.tenantid'), true);
  // Measured on #16934's governing line, which backticks whole CLAUSES. An
  // unguarded whole-span add turned each into a "term" that can never match and
  // cannot be pasted into a card either.
  const clause = deriveTerms('`, boot log 「tenancy posture \'single\' — layer 0 is inert」) ·`', 'governing');
  t('a backticked CLAUSE does not become a term', [...clause.keys()].some((k) => /[\s·「」]/.test(k)), false);
  t('…but its words still do', clause.has('tenancy') && clause.has('posture') && clause.has('inert'), true);
  t('a route keeps no leading slash', deriveTerms('`/data`', 'title').has('/data'), false);
  t('…and yields the bare segment', deriveTerms('`/data`', 'title').has('data'), true);
  t('a trailing paren is trimmed off a term', deriveTerms('`getReadScope` threading) ·', 'governing').has('threading'), true);
  t('…leaving no punctuated variant behind', [...deriveTerms('`getReadScope` threading) ·', 'governing').keys()].some((k) => /[)·]/.test(k)), false);

  // ---- governing-text carrier, both measured shapes -----------------------
  const inlineCard = 'Intro paragraph.\n\n`Governing text:` ADR-0105 (tenancy postures) · ADR-0021 D-C\nsecond line of the same carrier.\n\nNext paragraph.';
  const gInline = extractGoverningText(inlineCard);
  t('the inline carrier is found through backticks', gInline?.shape, 'inline');
  t('…and its continuation line is taken', /second line/.test(gInline?.text ?? ''), true);
  t('…and the following paragraph is not', /Next paragraph/.test(gInline?.text ?? ''), false);
  const boldCard = 'x\n\n**Governing text:** `AGENTS.md` Prime Directive 12\n\ny';
  t('the bold inline carrier is found', extractGoverningText(boldCard)?.shape, 'inline');
  const sectionCard = '# Card\n\n## Governing text\n\n- ADR-0087 §D2 vs §D3.\n- more\n\n## Options\n\nA / B';
  const gSection = extractGoverningText(sectionCard);
  t('the section carrier is found', gSection?.shape, 'section');
  t('…and stops at the next heading', /Options/.test(gSection?.text ?? ''), false);
  t('a card with no carrier answers null', extractGoverningText('# Card\n\nJust a question.'), null);
  // ⛔ The absent case is 23 of 27 on the live board — it must be reportable,
  // not merely survivable.
  const bare = buildTermSet({ title: 'Under `single` posture, which tenant wall?', body: 'No carrier here.', override: null });
  t('an absent carrier is flagged, not swallowed', bare.governingAbsent, true);
  t('…and the title still yields terms', bare.terms.includes('single'), true);
  t('--terms replaces the derivation rather than extending it', buildTermSet({ title: 'posture tenant', body: '', override: ['single'] }).terms.join(','), 'single');
  t('…and an overridden term keeps its provenance', buildTermSet({ title: '', body: '', override: ['single'] }).sources.get('single'), 'override');
  t('an override is exempt from the length floor', buildTermSet({ title: '', body: '', override: ['sql'] }).terms.join(','), 'sql');

  // ---- matching ----------------------------------------------------------
  t('word-boundary: `data` does not match inside `metadata`', termMatcher('data')('Metadata in a database'), false);
  t('…but does match the bare word', termMatcher('data')('the data plane'), true);
  t('word-boundary treats a hyphen as a boundary character, not an identifier one', termMatcher('driver-sql')('the driver-sqlite adapter'), false);
  t('…and matches the exact hyphenated term', termMatcher('driver-sql')('the driver-sql adapter'), true);
  t('matching is case-insensitive', termMatcher('tenantid')('DriverOptions.tenantId is set'), true);
  t('a regex metacharacter in a term is a literal', termMatcher('a.b')('axb'), false);

  // ---- decision-shape parsing -------------------------------------------
  t('a decision bullet is recognised', isDecisionBullet('- **D4** — A `tenancy` kernel service'), true);
  t('…with a parenthetical qualifier too', isDecisionBullet('- **D3 (P0, ships regardless)** — stop stripping'), true);
  t('…and with the dash inside the bold', isDecisionBullet('- **D1 — implemented, with OQ2 unexecuted.** Body'), true);
  t('…and a slash-joined group', isDecisionBullet('- **D4/D5/D6/D8 — ratifications, all still true.** Body'), true);
  t('prose ABOUT a decision is not a decision bullet', isDecisionBullet('- **D3 is the only structural cost.** Write side'), false);
  t('…nor is a possessive', isDecisionBullet("- **D4's conflict-freedom argument does not survive.** It is"), false);
  t('a level-3 heading needs no dash', ADR_HEADING_RE.test('### D3 is untouched, and the pairing is why'), true);
  t('a level-4 sub-decision parses', ADR_HEADING_RE.test('#### D9.1 — a third contributor kind'), true);
  t('a Chinese heading separated by a full-width colon parses', ADR_HEADING_RE.test('### D2 盖章策略：按对象声明'), true);
  t('a level-2 heading is not a decision heading', ADR_HEADING_RE.test('## Decision'), false);

  // ---- status classification --------------------------------------------
  t('accepted', classifyStatus('Accepted (2026-09-04) — accepted by the merge'), 'accepted');
  t('accepted, colon inside the bold', extractStatusLine('**Status:** Accepted'), 'Accepted');
  t('a status that OPENS superseded is superseded', classifyStatus('Superseded by v4 — was Accepted 2026-05-20'), 'superseded');
  t('`supersedes` is not `superseded`', classifyStatus('Revised (2026-06-13) — supersedes the original'), 'revised');
  // ⚠️ The two live shapes that break precedence-scanning. Both are ACCEPTED
  // ADRs whose long status lines mention a retirement of some sub-part later
  // on; classifying either as retired hides a standing ruling from the paste
  // line, which is the one failure this reader may not have.
  t(
    'an accepted ADR that mentions a supersession later stays accepted',
    classifyStatus('Accepted — D1/D2/D4/D5/D6/D8/D9 implemented; D10/D12 partially landed; **D11 implemented on the ladder**, and the v2 draft it superseded is gone'),
    'accepted',
  );
  t(
    'an accepted ADR that mentions a withdrawal later stays accepted',
    classifyStatus('Accepted (2026-07-27; proposed 2026-07-25) — Phase 0/1 implemented. Amended 2026-07-27: the group-template proposal is withdrawn'),
    'accepted',
  );
  t('proposed', classifyStatus('Proposed (2026-06-25)'), 'proposed');
  t('a status naming acceptance in a sentence still reads accepted', classifyStatus('The DECISION is Accepted — it is cloud ADR-0024'), 'accepted');
  // ⛔ The one classification this file may not get wrong in the lenient direction.
  t('an unreadable status is `unknown`, never `proposed`', classifyStatus('Under discussion, see the thread'), 'unknown');
  t('a missing status line is `unknown`', classifyStatus(null), 'unknown');
  t('the ADR id comes from the filename', adrIdOf('docs/adr/0131-total-organization-ownership.md'), 'ADR-0131');

  // ---- the fixture corpus, end to end ------------------------------------
  const dir = mkdtempSync(join(tmpdir(), 'check-prior-rulings-'));
  let fixtureVerdict = 'not-run';
  try {
    writeFixtureCorpus(dir);
    const units = readDirAdrCorpus(dir).flatMap((f) => parseAdrUnits(f.path, f.text));
    t('the fixture corpus parses the two shapes', units.length, 6);
    t('…rejecting both prose bullets', units.filter((u) => u.corpus === 'adr' && /structural cost|conflict-freedom/.test(u.heading)).length, 0);

    // THE fixture: #16934's real terms must surface the ruling its card omitted.
    const terms = [...buildTermSet({ title: t16934, body: '', override: null }).terms];
    const found = search({ terms, adrUnits: units, agentsLines: [], docblocks: [], top: 10 });
    t('the omitted ruling is surfaced', found.shown.some((r) => r.unit.adr === 'ADR-0131' && r.unit.id === 'D8'), true);
    t('…at rank 1 on the fixture', `${found.shown[0].unit.adr} ${found.shown[0].unit.id}`, 'ADR-0131 D8');
    t('…and is named in the paste line', found.pasteLine.includes('ADR-0131 D8'), true);
    t('…because it is ACCEPTED', found.shown.find((r) => r.unit.id === 'D8').unit.status, 'accepted');
    // A superseded decision matching the same terms is found but NOT named:
    // naming it would send a seat to a ruling that no longer stands.
    t('a superseded decision is a candidate…', found.adr.some((r) => r.unit.adr === 'ADR-0006'), true);
    t('…but is never named in the paste line', found.pasteLine.includes('ADR-0006'), false);
    // The noise control: `metadata`/`database` must not be dragged in by `data`.
    t('the substring-noise ADR is not a candidate', found.adr.some((r) => r.unit.adr === 'ADR-0028'), false);

    // NEGATIVE case — terms that hit nothing must say `none`, not a false hit.
    const nil = search({ terms: ['websocket', 'graphql', 'kubernetes'], adrUnits: units, agentsLines: [], docblocks: [], top: 10 });
    t('a term set that hits nothing finds no candidate', nil.adr.length, 0);
    t('…and its paste line says `none`', nil.pasteLine, 'Prior rulings read: websocket,graphql,kubernetes → 0 hits; none');
    t('…and `none` is NOT `unresolved`', nil.pasteLine.includes('unresolved'), false);
    t('an unresolved read is spelled differently from `none`', formatPasteLine({ unresolved: true, terms: [], candidateCount: 0, accepted: [] }), 'Prior rulings read: unresolved');

    // STOPWORD / noise case — a card written entirely in card-vocabulary
    // derives nothing, and that must refuse rather than search for junk.
    const noisy = buildTermSet({ title: '[Decision] This decision is about what the platform should do under these cases', body: '', override: null });
    t('an all-stopword title derives no term', noisy.terms.length, 0);

    // The paste line's shape, pinned exactly as `decision-analysis.md` states it.
    t('the paste line is pinned', formatPasteLine({ terms: ['single', 'posture'], candidateCount: 4, accepted: ['ADR-0131 D8'] }), 'Prior rulings read: single,posture → 4 hits; ADR-0131 D8');
    t('the paste line is extractable by a literal grep', /^Prior rulings read: /.test(found.pasteLine), true);
    // A long term set is BOUNDED and says how much it bounded. Measured: the
    // real #16934 run derives 42 terms, and the unbounded line was unusable.
    const long = Array.from({ length: 20 }, (_, i) => `term${i}`);
    const bounded = formatPasteLine({ terms: long, candidateCount: 7, accepted: [] });
    t('a long term list is truncated', bounded.includes('term12'), false);
    t('…and counts what it truncated', bounded.includes('(+8 more)'), true);
    t('…and still parses as the pinned shape', /^Prior rulings read: .+ → 7 hits; none$/.test(bounded), true);
    t('a term list at the cap is not annotated', formatPasteLine({ terms: long.slice(0, MAX_PASTE_TERMS), candidateCount: 1, accepted: [] }).includes('more)'), false);

    // Corpus counting: a corpus that is searched reports how much, always.
    const counted = search({ terms: ['posture'], adrUnits: units, agentsLines: [{ corpus: 'agents', file: 'AGENTS.md', line: 1, text: 'posture is named here' }], docblocks: [{ corpus: 'spec', file: 'packages/spec/src/a.ts', line: 2, text: '/** posture */' }], top: 10 });
    t('every corpus reports a scanned count', `${counted.counts.adr.scanned}/${counted.counts.agents.scanned}/${counted.counts.spec.scanned}`, '6/1/1');
    t('…and a hit count', `${counted.counts.agents.hit}/${counted.counts.spec.hit}`, '1/1');
    fixtureVerdict = 'ran';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  t('the fixture corpus leg ran', fixtureVerdict, 'ran');

  // ---- exit register -----------------------------------------------------
  t('a completed read exits 0', EXIT_OK, 0);
  t('a classified prerequisite failure exits 3', EXIT_PREREQUISITE_NOT_MET, 3);
  t('an unclassified failure exits 2', EXIT_UNCLASSIFIED, 2);
  t('no token is a prerequisite failure, not an empty search', classifyCardRead({ hasToken: false }).kind, 'no-token');
  t('a 403 classifies', classifyCardRead({ hasToken: true, status: 403 }).kind, 'forbidden');
  t('a 429 classifies', classifyCardRead({ hasToken: true, status: 429 }).kind, 'rate-limited');
  t('a 404 sends the reader to PM_SWEEP_REPO', classifyCardRead({ hasToken: true, status: 404 }).headline.includes('PM_SWEEP_REPO'), true);
  t('a network failure classifies', classifyCardRead({ hasToken: true, networkError: 'ECONNREFUSED' }).kind, 'network');
  t('a 200 is the only ok', classifyCardRead({ hasToken: true, status: 200 }).kind, 'ok');
  t('bad usage is refused before any request', parseArgs(['--card', 'abc']).error !== undefined, true);
  t('a run with neither a card nor terms is refused', parseArgs([]).error !== undefined, true);
  t('--terms alone is a legal run (no card, no token)', parseArgs(['--terms', 'a,b']).opts.terms.join(','), 'a,b');
  t('an unknown flag is refused rather than ignored', parseArgs(['--repo', 'o/n']).error !== undefined, true);
  // The imported board resolver, pinned at the contract this file relies on —
  // not re-tested, but held, so a change there cannot silently move this reader
  // onto another board.
  t('the default board is objectstack', resolveSweepRepo({}).repo, DEFAULT_SWEEP_REPO);
  t('PM_SWEEP_REPO overrides it', resolveSweepRepo({ PM_SWEEP_REPO: 'objectstack-ai/objectui' }).repo, 'objectstack-ai/objectui');
  t('a malformed board is refused', resolveSweepRepo({ PM_SWEEP_REPO: 'not-a-repo' }).valid, false);

  // ---- the proxy route ---------------------------------------------------
  // Measured in the seat's container: both token variables hold the literal
  // `proxy-injected`, so an unrouted fetch 401s while `curl` gets 200. The plan
  // is imported; what this file owns is the guard, and the guard must be its
  // own or a re-exec of the patrol suppresses this reader's.
  t('this file\'s re-exec guard is not the patrol\'s', OWN_PROXY_REARM_GUARD === PROXY_REARM_GUARD, false);
  t('a proxied environment plans a re-exec', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://127.0.0.1:1' }, flagSupported: true }).rearm, true);
  t('…and having re-armed once, does not loop', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://127.0.0.1:1', [PROXY_REARM_GUARD]: '1' }, flagSupported: true }).rearm, false);
  t('an unproxied environment plans nothing', proxyRearmPlan({ env: {}, flagSupported: true }).rearm, false);

  // ---- structural: this file has no write path ---------------------------
  // The report-only property, held mechanically rather than promised. A `POST`
  // to the API from here would make it a tool that mutates the board, and the
  // whole ruling that admitted it is that it decides nothing.
  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  const codeOnly = ownSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  t('no write method reaches the API from this file', /method:\s*['"](POST|PATCH|PUT|DELETE)['"]/i.test(codeOnly), false);
  t('no retry loop over a spent quota', /(while|for)\s*\([^)]*(retry|attempt|429|403)/i.test(codeOnly), false);

  // ---- the ONE live-tree pin --------------------------------------------
  // Everything above is offline. This leg is deliberately not: its job is to go
  // RED when the real corpus drifts away from the shapes this reader parses, so
  // that a heading-format change is caught here rather than by a silently
  // shrinking candidate set months later.
  let live = 'skipped';
  try {
    const head = execFileSync('git', ['ls-tree', '--name-only', DEFAULT_REV, '--', 'docs/adr/'], { encoding: 'utf8' }).trim();
    if (head !== '') {
      const path = head.split('\n').find((p) => /\/0131-/.test(p));
      if (path) {
        const text = execFileSync('git', ['show', `${DEFAULT_REV}:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const units = parseAdrUnits(path, text);
        const d8 = units.find((u) => u.id === 'D8');
        live = d8 && /(^|[^a-z])single([^a-z]|$)/i.test(d8.text) && classifyStatus(d8.statusLine) === 'accepted' ? 'pinned' : 'drifted';
      }
    }
  } catch {
    live = 'skipped';
  }
  // `skipped` is honest (a shallow clone or a detached CI checkout has no
  // `origin/main`), `drifted` is a failure. ⛔ They are not merged: a pin that
  // reports "could not check" as "checked and clean" is the shape this whole
  // file exists against.
  t('the live-tree D8 pin holds (or is honestly skipped)', live !== 'drifted', true);
  console.log(`  · live-tree existence pin: ${live}${live === 'skipped' ? ' (no origin/main in this checkout)' : ''}`);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name} (got ${JSON.stringify(c.actual)}, want ${JSON.stringify(c.expected)})`);
  if (failed.length) {
    console.error(`✗ check-prior-rulings self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return { code: EXIT_SELF_TEST_FAILED, verdict: SELF_TEST_VERDICT };
  }
  console.log(
    `✓ check-prior-rulings self-test: ${cases.length} cases pass (term derivation with its length floor, ` +
      'stopwords and code-span splitting; the governing-text carrier in both measured shapes plus the ' +
      'absent case that is 23 of 27 on the live board; the backticked-CLAUSE and leading-slash term ' +
      'guards; word-boundary matching with its substring-noise controls; the two decision shapes with ' +
      'the three prose bullets the separator rule rejects; POSITIONAL-first status classification with ' +
      'the two live accepted-ADR shapes precedence-scanning would have hidden, and `unknown` kept out ' +
      'of `proposed`; the #16934 fixture surfacing ADR-0131 D8 at rank 1 with a superseded near-miss ' +
      'found-but-unnamed; the NEGATIVE case reading `none` and the unresolved read reading differently; ' +
      'the all-stopword refusal; the pinned paste line with its counted truncation; the exit register; ' +
      'the imported board resolver and proxy plan with this file\'s own re-exec guard; the structural ' +
      'no-write-path and no-retry-loop assertions; and the one live-tree D8 existence pin).',
  );
  return { code: EXIT_OK, verdict: SELF_TEST_VERDICT };
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const r = selfTest();
    if (r.verdict !== SELF_TEST_VERDICT) {
      console.error('\n✗ check-prior-rulings self-test: selfTest() returned without reaching its verdict,\nso no success line was printed. Exiting 0 here would report a self-test that never finished as one.\n');
      process.exit(EXIT_SELF_TEST_FAILED);
    }
    process.exit(r.code);
  } else {
    run(process.argv.slice(2))
      .then((code) => process.exit(code))
      .catch((err) => {
        // ⛔ A run that could not complete must never read as a clean board.
        console.error(`check-prior-rulings: the run failed for an unclassified reason — ${err?.message ?? err}`);
        process.exit(EXIT_UNCLASSIFIED);
      });
  }
}
