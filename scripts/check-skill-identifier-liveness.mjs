#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// check-skill-identifier-liveness — a TWO-LEGGED liveness gate over the
// published `skills/**` catalog (#13678).
//
//   node scripts/check-skill-identifier-liveness.mjs
//   node scripts/check-skill-identifier-liveness.mjs --list       # every site it can see
//   node scripts/check-skill-identifier-liveness.mjs --suggest    # unregistered Leg 2 candidates
//   node scripts/check-skill-identifier-liveness.mjs --update     # see AUTHORITY below
//   node scripts/check-skill-identifier-liveness.mjs --self-test  # verify the checker's own rules
//
// ## The defect class, and why it has TWO directions
//
// The published catalog is loaded whole into customer agent context windows. A
// false line in it is not a typo: it is a wrong instruction executed by an AI
// author in every customer project until someone reads it. Two measurement
// flights over that corpus found the falsehoods arrive in two OPPOSITE shapes,
// and a gate carrying only one of them is blind to the larger half.
//
//   LEG 1 — THE PHANTOM ROW. A surface table cites an identifier that no longer
//   exists or never did. Measured: 3 of the 6 falsehoods in one skill were this
//   class — two retired schedule keys, five notification template fields removed
//   under ADR-0049, and two template keys with ZERO hits anywhere in the
//   implementation tree. Every one was detectable by a single grep of the cited
//   name. No semantics needed.
//
//   LEG 2 — THE MISSING ROW. A doc enumeration presented as exhaustive stopped
//   growing when the schema did. Measured on a later flight: 15 of its 20 false
//   landing sites were this class — a live schema member with NO doc row. A
//   10-member enum documented with 9 rows; a 20-member one with 19.
//
// The two are inverses over the same corpus: Leg 1 asks "does everything the
// docs NAME exist?", Leg 2 asks "does everything that EXISTS get named?". One
// gate, two legs, one corpus walk.
//
// ## What this gate is NOT
//
// It catches EXISTENCE, never semantics. A `defaultValue` row that greps fine
// and describes the wrong evaluation model is invisible here and always will be.
// This complements the behavioural sweep; it does not replace it. Stating the
// limit matters, because a green run here is otherwise easy to read as "the
// catalog is factually correct", which it does not say.
//
// ── LEG 1: the predicate, and every place it deliberately declines ──────────
//
// A CITATION is a markdown table row, outside a fenced block, whose FIRST cell
// is exactly one backticked token of identifier shape (dotted segments, with
// optional `[]` for `bands[].key`), optionally followed by a short parenthetical
// annotation. It is LIVE when every dotted segment appears as a word token in
// the IMPLEMENTATION INDEX. Zero hits on any segment is a red naming the file,
// the line, the identifier and the segment that failed.
//
// Three refusals in the extractor, each one measured rather than assumed:
//
//   THE TRAILING ANNOTATION. `\`none\` (default)` is a citation of `none`. A
//   first cut required the cell to be EXACTLY a backticked token, so every row
//   annotated this way silently left the population — and on the Leg 2 side the
//   same omission manufactured two false reds by making complete tables read as
//   4-of-5 and 3-of-4. The parenthetical is stripped, not used to reject.
//
//   THE NEGATIVE COLUMN. A migration table's left column cites the DEAD spelling
//   BY DESIGN — `| Legacy | CEL |`, `| Old | New |`, `| Don't | Do |`. Reddening
//   those is the gate running exactly backwards: the whole value of the row is
//   that the thing it names is gone. Columns whose HEADER names the pre-migration
//   or negative side are structurally out of the population. Structurally, and
//   not by ledger entry, for the reason the sibling lexical gate states about its
//   own legitimate usages: a file that never enters the ledger cannot have its
//   budget silently spent by a later edit, while a baselined row carries one
//   forever.
//
//   THE FENCE. Code fences are skipped here. This is the opposite choice from
//   `check-corpus-claim-drift`, deliberately: that gate exists BECAUSE its defect
//   lived in a comment inside a fence. This one reads TABLE ROWS, and a pipe
//   character inside a fenced example is not a table row at all.
//
// ### The index, and the one exclusion that makes a green run mean anything
//
// The implementation index is built from `packages/**` source only — never from
// `skills/**`, and never from `content/docs/**`. This is the load-bearing line
// in the whole leg. An index that included the teaching corpus would find every
// citation in the corpus that cites it, so EVERY row would be live, the finding
// set would be empty on any tree, and the gate would be a green light wired to
// nothing. `dist/` is skipped for the mirror-image reason: a stale build output
// can keep a retired identifier alive for as long as nobody cleans it, which
// makes the verdict a function of the developer's working directory. Both
// exclusions are asserted in `--self-test` rather than left to this paragraph.
//
// ### What the ledger holds, and why each kind is not a content bug
//
// Five rows survive the predicate today and NONE of them is a phantom. They are
// three distinct structural classes, and naming the class is the point of the
// `kind` field — a ledger of bare file/identifier pairs teaches the next author
// nothing about why the row is there:
//
//   sibling-repo       the identifier is live, in `../objectui`. `dayStart` and
//                      `showMidnight` are implemented in that repo's gantt
//                      plugin. This repo ships backend only and does not track
//                      objectui's build output (`packages/console/dist` is
//                      gitignored), so no index this gate can build will ever
//                      reach them. The published SDUI manifest does not carry
//                      them either — checked, not assumed.
//   skill-owned-config keys of a config file the CUSTOMER writes, consumed by
//                      the skill's own prose. There is no repo implementation to
//                      grep because the skill IS the implementation.
//
// ⛔ These are EXEMPTIONS, not debt, and the distinction drives `--update`: see
// AUTHORITY below.
//
// ── LEG 2: why it is REGISTERED, and the measurements that forced that ───────
//
// The scope note asks for a "presented as exhaustive" predicate that is
// CONSERVATIVE. Three candidate predicates were built and measured on the real
// corpus before this shape was chosen. All three numbers are reproducible with
// `--suggest`.
//
//   (a) AUTO-BINDING BY MEMBER-SET OVERLAP. Bind a doc table to any schema enum
//       it is a subset of; red on a strict subset. 17 bindings, 9 candidate reds.
//       SIX of the nine were artefacts — two from the trailing-annotation bug
//       above, one from an enumeration split across several tables in one file,
//       and three from prose that names its own partiality. Of the three that
//       survived every fix, TWO are one enum whose members mix two concepts
//       (`AggregationMetricType` carries six aggregation functions plus three
//       "custom SQL expression returning X" value types), so a table titled
//       "Basic Aggregation Functions" listing exactly the six is CORRECT and this
//       predicate calls it false. Final precision: 1 true positive in 3. A gate
//       that is wrong two times in three cannot fail CI.
//
//   (b) KEYWORD EXHAUSTIVENESS MARKERS. Check only tables whose lead prose says
//       "all" / "every" / "complete" / "the N types". 20 of 155 tables match, 18
//       after vetoing "e.g."-style hedges — and inspection of those 18 shows the
//       marker usually belongs to a NEIGHBOURING sentence, not to the table.
//       The top-ranked hit is "Three action types dispatch headlessly", which
//       matches on both "every" and a numeral and is a deliberate 3-of-6 SUBSET.
//       The claim detector is unreliable before the member comparison even runs.
//
//   (c) SELF-DECLARED SYMBOL. Check a table only when its own lead names a
//       schema symbol in backticks. Precision looks excellent and recall is 1
//       table in 155 — and that one is hedged. With zero edits to `skills/**`
//       permitted on this card, nothing can raise it.
//
// So Leg 2 ships TABLE-DRIVEN, on the same reading as the lexical anti-drift
// ratchet next door: a BINDING is a human assertion that one named section of
// one file is exhaustive over one named schema symbol. Precision is 100% by
// construction because a person made the claim; recall is what is registered,
// and it grows by a reviewable one-line edit. The heuristic is not thrown away —
// it ships as `--suggest`, a NON-FAILING discovery mode that lists unregistered
// candidates, so the registry has a feeder and the measurement above stays
// reproducible instead of living only in this comment.
//
// ### Two structural safety rules on a binding
//
//   THE ANCHOR MUST BE UNIQUE. A heading that appears twice in a file cannot
//   scope a section, and silently taking the first is how a binding starts
//   measuring a different table than the one its author read. Ambiguous anchor
//   is a hard failure, not a first-match.
//
//   THE SYMBOL MUST RESOLVE. A binding naming a symbol that no longer exists is
//   STALE and fails naming itself. This is the positive-control assertion at
//   corpus scale: without it, deleting the enum turns the binding green, which is
//   the exact inversion of what the row is for.
//
// ### The scope of "documented", and why it is the SECTION
//
// A member counts as documented when it appears inside any backticked span in
// the bound section — as the whole span or as a token within one, so
// `\`type: 'home' | 'list'\`` documents `home`. Section, not file: an
// exhaustiveness claim is scoped to what a reader sees under that heading, and a
// file-wide pool credits a member mentioned 800 lines away in an unrelated
// paragraph. Measured, the difference is real — the same enum reads 7-of-9
// against its own section and 8-of-9 against its whole file.
//
// ── AUTHORITY: the two ledgers move in OPPOSITE ways, deliberately ──────────
//
// `--update` does different things to the two legs because the two ledgers hold
// different kinds of fact, and collapsing them would make one of them lie.
//
//   LEG 1 EXEMPTIONS — PRUNE-ONLY. `kind` and `note` are human judgements about
//   WHY an identifier is unreachable from this repo. Nothing in the tree encodes
//   them, so they cannot be regenerated from it; an `--update` that rewrote this
//   list would invent classifications it has no way to know. So `--update` only
//   DELETES entries the scan no longer reaches. Adding one is a hand edit that
//   must carry a kind and a note, which makes it visible in review — and it
//   WEAKENS the gate, so the offer is marked `⛔ MAINTAINER-ONLY`. Shrink-only by
//   construction rather than by policy: there is no code path that grows it.
//
//   LEG 2 GAPS — REWRITTEN FROM THE TREE, shrink-only in spirit. A gap is a
//   MEASURED COUNT of members a registered-exhaustive section does not document.
//   It is debt, it is fully derivable, and it must shrink as the sweep programme
//   lands. `--update` moves it whichever way the tree moved; only policy tells
//   those apart, so the NEW-gap and GROWN-gap messages mark that path
//   `⛔ MAINTAINER-ONLY` while the author's own remedy — document the member —
//   is offered first and unmarked.
//
// A gap entry that SHRANK fails and asks for `--update`. That is the ratchet
// working: an improvement that does not move the ledger leaves budget behind for
// a later edit to spend silently.
//
// ## Roots
//
// `skills` — the published catalog, and only it. `.claude/**` is a different
// surface with a different ratchet and is deliberately out of range. Unlike the
// two prose gates over this corpus, `references/` is NOT skipped: under
// `content/docs` that directory is generated from spec (so a finding there names
// the wrong file), but under `skills/**` those files are hand-authored published
// content — one of the registered Leg 2 bindings lives in one. The self-test
// pins that difference so a later "align the SKIP_DIRS" edit cannot quietly
// remove a fifth of the corpus.

import {
  readdirSync, readFileSync, writeFileSync, statSync, existsSync,
} from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

const ROOTS = ['skills'];
const IMPL_ROOTS = ['packages'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo']);
const EXTENSIONS = new Set(['.md']);
const IMPL_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const LEDGER_PATH = 'scripts/skill-identifier-liveness-ledger.json';

/**
 * The half of ROOTS that `scripts/pm/dispatch-gates.mjs` cannot see, written in
 * the subtree spelling that tool compares in. Provenance ONLY: nothing in this
 * gate reads this list, and the scan behaves exactly as it did without it.
 *
 * That tool builds a dispatch's gate list by scanning each gate's source for the
 * path literals it operates on, and "looks like a path" there means "carries a
 * separator". `skills` has none, so without this declaration a skills-only card
 * would never be told this gate reads its files. `check-role-word.mjs` paid one
 * repair round for exactly that and carries the identical declaration;
 * `check-corpus-claim-drift.mjs` carries it for the identical reason.
 *
 * Spelled as a LITERAL array, never computed from ROOTS: the extractor reads
 * SOURCE TEXT, so a `.map()` over ROOTS would contribute nothing while every
 * runtime assertion about the value stayed green. `check-watch-hint-literal`
 * enforces that; the self-test pins the coupling in both directions.
 */
const ROOT_DIR_WATCH_HINTS = ['skills/**'];

/** Kept identical to the other gates' token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * Column headers that mark the PRE-MIGRATION or NEGATIVE side of a table. A
 * citation under one of these is expected to be dead, so the leg declines the
 * whole column. Compared case-insensitively against the trimmed header cell,
 * with backticks and emphasis stripped.
 */
const NEGATIVE_HEADERS = new Set([
  'legacy', 'old', 'before', 'deprecated', 'removed', 'retired', 'was',
  'wrong', 'avoid', "don't", 'dont', 'never', 'bad', 'anti-pattern', 'v1',
]);

/**
 * THE LEG 2 TABLE. One row per section whose exhaustiveness over a schema symbol
 * is asserted by a person.
 *
 * Every field is read by the engine and by the diagnostics, so a new row gets a
 * correct message for free. Fields:
 *
 *   id       stable ledger key. Never renamed without an `--update`.
 *   file     repo-relative path inside a ROOT.
 *   heading  the EXACT heading line, including its `#` prefix. Must be unique in
 *            the file — an ambiguous anchor is a hard failure, never a
 *            first-match.
 *   symbol   the schema symbol whose members the section must document.
 *   source   where the symbol is declared. Checked, so a moved declaration is a
 *            named failure rather than a silent unbinding.
 *   why      what makes this section exhaustive, for the reviewer of the next
 *            edit that reddens it.
 *
 * ⛔ A row is an ASSERTION THAT A SECTION IS EXHAUSTIVE. Adding one that is not
 * manufactures a false red for every legitimate future subset. The nine here
 * were each verified complete (or measured incomplete and ledgered) at landing;
 * `--suggest` lists candidates, it does not bless them.
 */
const BINDINGS = [
  {
    id: 'api-methods',
    file: 'skills/objectstack-api/SKILL.md',
    heading: '## API Methods (Operations)',
    symbol: 'ApiMethod',
    source: 'packages/spec/src/data/object.zod.ts',
    why: 'The section is the catalog of operations an object exposes; a method absent here is unreachable to an AI author.',
  },
  {
    id: 'access-scope-depth',
    file: 'skills/objectstack-data/SKILL.md',
    heading: '### Access depth (scope-depth) — the ERP "see my unit / my unit and below" axis',
    symbol: 'ObjectAccessScopeSchema',
    source: 'packages/spec/src/security/permission.zod.ts',
    why: 'A permission axis documented short is a security surface an author cannot reach; the section enumerates the axis.',
  },
  {
    id: 'hook-lifecycle-events-reference',
    file: 'skills/objectstack-data/references/data-hooks.md',
    heading: '### Hook Lifecycle Events',
    symbol: 'HookEvent',
    source: 'packages/spec/src/data/hook.zod.ts',
    why: 'The reference table of lifecycle events. A missing event is a hook an author never learns exists.',
  },
  {
    id: 'hook-lifecycle-events-rule',
    file: 'skills/objectstack-data/rules/hooks.md',
    heading: '### 8 Lifecycle Events',
    symbol: 'HookEvent',
    source: 'packages/spec/src/data/hook.zod.ts',
    why: 'The heading states the count, so the section claims exhaustiveness in its own words — and the count goes stale silently when the enum grows.',
  },
  {
    id: 'lifecycle-classes',
    file: 'skills/objectstack-data/rules/lifecycle.md',
    heading: '## Lifecycle Classes',
    symbol: 'LifecycleClassSchema',
    source: 'packages/spec/src/data/object.zod.ts',
    why: 'The rule file exists to enumerate the classes; a partial list here is the whole file being wrong.',
  },
  {
    id: 'seed-modes',
    file: 'skills/objectstack-platform/SKILL.md',
    heading: '## Seed Data',
    symbol: 'SeedMode',
    source: 'packages/spec/src/data/seed.zod.ts',
    why: 'The mode table is the only place an author learns what `mode` accepts.',
  },
  {
    id: 'report-types',
    file: 'skills/objectstack-ui/SKILL.md',
    heading: '## Report Types',
    symbol: 'ReportType',
    source: 'packages/spec/src/ui/report.zod.ts',
    why: 'A report type with no row is a type nothing in the catalog can teach.',
  },
  {
    id: 'action-types',
    file: 'skills/objectstack-ui/SKILL.md',
    heading: '### Action Types',
    symbol: 'ActionType',
    source: 'packages/spec/src/ui/action.zod.ts',
    why: 'The complete action-type table. A different skill documents a deliberate 3-of-6 subset of the same enum, which is exactly why the binding names THIS section and not that one.',
  },
  {
    id: 'navigation-item-types',
    file: 'skills/objectstack-ui/SKILL.md',
    heading: '### Navigation Item Types',
    symbol: 'NavItemVariant',
    source: 'packages/spec/src/ui/app.zod.ts',
    why: 'The nav-item catalog, and the one binding that landed with a MEASURED gap rather than complete — see the gap ledger. Registered anyway: an unregistered gap is invisible, and the ledger is what makes it shrink.',
  },
];

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const list = argv.includes('--list');
const suggest = argv.includes('--suggest');

// ── Corpus ──────────────────────────────────────────────────────────────────

function walk(dir, out, extensions) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out, extensions);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.');
      if (dot > 0 && extensions.has(e.name.slice(dot))) out.push(full);
    }
  }
  return out;
}

function missingRoots(roots, root = REPO_ROOT, exists = existsSync) {
  return roots.filter((r) => !exists(join(root, r)));
}

function missingRootsMessage(missing) {
  return `[unreachable-root] configured root(s) not found: ${missing.join(', ')}. `
    + 'Refused before scanning: a verdict over the roots that DID resolve is a verdict '
    + 'about a population nobody configured. Fix the path or delete the root.';
}

// ── The implementation index ────────────────────────────────────────────────

const WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Word tokens of the implementation tree.
 *
 * @param {string[]} files absolute paths
 * @returns {Set<string>}
 */
export function buildIndex(files, read = readFileSync) {
  const words = new Set();
  for (const f of files) {
    let text;
    try { text = read(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(WORD)) words.add(m[0]);
  }
  return words;
}

/**
 * The index must never be able to see the teaching corpus. A path under any
 * ROOT reaching the index would make every citation self-satisfying.
 *
 * @param {string} rel repo-relative, POSIX or platform separators
 */
export function isTeachingCorpus(rel) {
  const posix = rel.split(sep).join('/');
  return ROOTS.some((r) => posix === r || posix.startsWith(`${r}/`))
    || posix === 'content/docs' || posix.startsWith('content/docs/');
}

// ── LEG 1: citations ────────────────────────────────────────────────────────

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[\])?(?:\.[A-Za-z_$][A-Za-z0-9_$]*(?:\[\])?)*$/;
const SEPARATOR_ROW = /^\s*\|[\s|:-]+\|?\s*$/;
const TABLE_ROW = /^\s*\|/;
const FENCE = /^\s*(?:```|~~~)/;

/** `\`none\` (default)` -> `none`; `\`x\`` -> `x`; anything else -> null. */
export function citationOf(cell) {
  const m = /^`([^`]+)`(?:\s*\([^)]{0,48}\))?$/.exec(cell.trim());
  if (!m) return null;
  const id = m[1].trim();
  return IDENTIFIER.test(id) ? id : null;
}

/** Header text stripped to its comparable core. */
export function normalizeHeader(cell) {
  return cell.replace(/[`*_]/g, '').trim().toLowerCase();
}

export function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Every dotted segment, with `[]` removed. */
export function segmentsOf(identifier) {
  return identifier.split('.').map((s) => s.replace(/\[\]/g, '')).filter(Boolean);
}

/**
 * Extract Leg 1 citations from one markdown file.
 *
 * @param {string} text
 * @param {string} rel repo-relative path, for the record
 * @returns {Array<{file: string, line: number, identifier: string}>}
 */
export function extractCitations(text, rel) {
  const lines = text.split('\n');
  const out = [];
  let fence = false;
  let header = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) { fence = !fence; header = null; continue; }
    if (fence) continue;
    if (!TABLE_ROW.test(line)) { header = null; continue; }
    if (SEPARATOR_ROW.test(line)) continue;
    if (header === null) { header = splitRow(line).map(normalizeHeader); continue; }
    if (NEGATIVE_HEADERS.has(header[0] || '')) continue;
    const identifier = citationOf(splitRow(line)[0] || '');
    if (identifier) out.push({ file: rel, line: i + 1, identifier });
  }
  return out;
}

/** @returns {string[]} segments of `identifier` absent from `index` */
export function deadSegments(identifier, index) {
  return segmentsOf(identifier).filter((s) => !index.has(s));
}

// ── LEG 2: schema symbols and bound sections ────────────────────────────────

const STRIP_COMMENTS = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Members of a `z.enum([...])` or a named string-literal union in one source
 * file. Comments are stripped FIRST — an enum whose members carry trailing
 * `//` notes (several do) otherwise parses the prose as members.
 *
 * @returns {Map<string, string[]>}
 */
export function extractSymbols(text) {
  const t = STRIP_COMMENTS(text);
  const found = new Map();
  const add = (name, members) => {
    const uniq = [...new Set(members)];
    if (uniq.length && !found.has(name)) found.set(name, uniq);
  };
  for (const m of t.matchAll(
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*z\.enum\(\s*\[([^\]]*)\]\s*(?:as const\s*)?\)/g,
  )) add(m[1], [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
  for (const m of t.matchAll(
    /type\s+([A-Za-z_$][\w$]*)\s*=\s*((?:\s*\|?\s*'[^']+')(?:\s*\|\s*'[^']+')+)\s*;/g,
  )) add(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  return found;
}

/**
 * The lines under `heading`, up to the next heading of the same or higher level.
 *
 * @returns {{lines: string[], start: number} | {error: 'absent' | 'ambiguous', count: number}}
 */
export function sectionOf(text, heading) {
  const lines = text.split('\n');
  const want = heading.trim();
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) if (lines[i].trim() === want) hits.push(i);
  if (hits.length === 0) return { error: 'absent', count: 0 };
  if (hits.length > 1) return { error: 'ambiguous', count: hits.length };
  const start = hits[0];
  const level = (/^(#{1,6})\s/.exec(want) || [, '######'])[1].length;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j += 1) {
    const m = /^(#{1,6})\s/.exec(lines[j]);
    if (m && m[1].length <= level) { end = j; break; }
  }
  return { lines: lines.slice(start, end), start: start + 1 };
}

/**
 * Everything a section documents: each backticked span whole, plus every
 * identifier-ish token inside one. The token pass is what lets
 * `\`type: 'home' | 'list'\`` document `home` — without it a member spelled only
 * inside a compound span reads as missing, which is a false red.
 */
export function documentedPool(sectionLines) {
  const pool = new Set();
  for (const m of sectionLines.join('\n').matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    pool.add(span);
    for (const t of span.matchAll(/[A-Za-z_$][A-Za-z0-9_$.-]*/g)) pool.add(t[0]);
  }
  return pool;
}

/** @returns {string[]} members of `symbol` the section does not document */
export function undocumentedMembers(members, pool) {
  return members.filter((v) => !pool.has(v));
}

// ── Ledger ──────────────────────────────────────────────────────────────────

const EMPTY_LEDGER = { leg1Exemptions: [], leg2Gaps: {} };

export function loadLedger(path = join(REPO_ROOT, LEDGER_PATH), read = readFileSync, exists = existsSync) {
  if (!exists(path)) return structuredClone(EMPTY_LEDGER);
  const parsed = JSON.parse(read(path, 'utf8'));
  return {
    leg1Exemptions: parsed.leg1Exemptions || [],
    leg2Gaps: parsed.leg2Gaps || {},
  };
}

export function exemptionKey(file, identifier) { return `${file}::${identifier}`; }

export function exemptionIndex(exemptions) {
  return new Map(exemptions.map((e) => [exemptionKey(e.file, e.identifier), e]));
}

// ── Messages ────────────────────────────────────────────────────────────────

export function phantomMessage(site, dead) {
  return `[leg1-phantom] ${site.file}:${site.line} cites \`${site.identifier}\` and `
    + `${dead.length === 1 ? `the segment \`${dead[0]}\` has` : `the segments ${dead.map((d) => `\`${d}\``).join(', ')} have`} `
    + `ZERO hits in ${IMPL_ROOTS.join(', ')}. A published skill row naming something the platform does not `
    + 'implement is an instruction an AI author will follow in every customer project. '
    + 'REMEDY: correct or delete the row — that is the author\'s own path and the right one in '
    + `almost every case. If the identifier is genuinely live somewhere this repo cannot index `
    + `(a sibling repo, or a config the skill itself owns), add it to ${LEDGER_PATH} with a `
    + `\`kind\` and a \`note\`. That ledger is shrink-only — \`--update\` prunes it and there is no `
    + `code path that grows it — so an entry weakens a ratchet: ${RATCHET_AUTHORITY_MARKER}, `
    + 'not a co-equal second option.';
}

export function staleExemptionMessage(entries) {
  return `[stale-exemption] ${entries.length} ledger entr${entries.length === 1 ? 'y is' : 'ies are'} `
    + `no longer reached by the scan: ${entries.map((e) => `${e.file}::${e.identifier}`).join(', ')}. `
    + 'The row was fixed or removed (good news) — run with --update to prune the ledger and commit it. '
    + 'An exemption nobody needs is budget a later edit can spend silently.';
}

export function unknownSymbolMessage(binding) {
  return `[stale-binding] ${binding.id} binds ${binding.file} to \`${binding.symbol}\`, `
    + `declared at ${binding.source} — and the symbol is NOT THERE. This is the binding's `
    + 'positive control: without this failure, deleting the schema would turn the row green, '
    + 'which is the exact inversion of what it is for. Re-point `source`/`symbol`, or delete the row.';
}

export function anchorMessage(binding, err) {
  if (err.error === 'ambiguous') {
    return `[stale-binding] ${binding.id}: the heading ${JSON.stringify(binding.heading)} appears `
      + `${err.count} times in ${binding.file}, so it cannot scope a section. Taking the first `
      + 'silently measures a different table than the one the row\'s author read. Make the anchor unique.';
  }
  return `[stale-binding] ${binding.id}: the heading ${JSON.stringify(binding.heading)} is not in `
    + `${binding.file}. A renamed heading unbinds the assertion, so it fails here rather than `
    + 'quietly checking nothing. Re-point `heading`, or delete the row.';
}

export function missingRowMessage(binding, missing, allowed) {
  const grew = allowed !== undefined;
  return `[leg2-missing-row] ${binding.file} — ${binding.heading} is registered exhaustive over `
    + `\`${binding.symbol}\` (${binding.source}) and does not document `
    + `${missing.map((m) => `\`${m}\``).join(', ')}`
    + (grew ? ` — the recorded gap ${allowed.length} grew to ${missing.length}.` : '.')
    + ' A live member with no row is a capability no AI author reading this catalog can reach. '
    + `Why this section is held exhaustive: ${binding.why} `
    + 'REMEDY: document the member — the author\'s own path. If it genuinely must stay '
    + `undocumented for now, record the gap in ${LEDGER_PATH} by running `
    + '`node scripts/check-skill-identifier-liveness.mjs --update`. That gap ledger is shrink-only, '
    + `so an entry weakens a ratchet: ${RATCHET_AUTHORITY_MARKER}, not a co-equal second option. `
    + 'The gated thing is that ACT, not the flag — `--update` takes whichever direction the tree '
    + 'moved, and only policy tells a ratchet-down from a weakening apart.';
}

export function shrunkGapMessage(binding, missing, allowed) {
  return `[leg2-improved] ${binding.file} — ${binding.heading}: the recorded gap for `
    + `\`${binding.symbol}\` was ${allowed.length} (${allowed.join(', ')}) and is now `
    + `${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}. Run with --update to `
    + 'ratchet the ledger down and commit it. An improvement that does not move the ledger leaves '
    + 'budget behind for a later edit to spend silently.';
}

export function duplicateIdMessage(ids) {
  return `[table-defect] duplicate binding id(s): ${ids.join(', ')}. Ids are ledger keys; `
    + 'two rows sharing one key make the gap ledger ambiguous.';
}

// ── Engine ──────────────────────────────────────────────────────────────────

/**
 * Both legs over one corpus walk. Every input is a parameter so `--self-test`
 * can drive synthetic corpora, synthetic tables and a synthetic index through
 * the SAME functions the production run uses. A table only one row ever reached
 * would be a hard-coded check wearing a table's clothes.
 *
 * @param {{corpus: Array<{file: string, text: string}>, index: Set<string>,
 *          bindings: object[], sources: Map<string, string>, ledger: object}} input
 */
export function run({ corpus, index, bindings, sources, ledger }) {
  const errors = [];
  const citations = [];
  const exempt = exemptionIndex(ledger.leg1Exemptions);
  const reached = new Set();

  // LEG 1
  for (const { file, text } of corpus) {
    for (const site of extractCitations(text, file)) {
      citations.push(site);
      const dead = deadSegments(site.identifier, index);
      if (!dead.length) continue;
      const key = exemptionKey(site.file, site.identifier);
      if (exempt.has(key)) { reached.add(key); continue; }
      errors.push(phantomMessage(site, dead));
    }
  }
  const stale = ledger.leg1Exemptions.filter((e) => !reached.has(exemptionKey(e.file, e.identifier)));

  // LEG 2
  const dupes = [];
  const seenIds = new Set();
  for (const b of bindings) {
    if (seenIds.has(b.id)) dupes.push(b.id);
    seenIds.add(b.id);
  }
  if (dupes.length) errors.push(duplicateIdMessage([...new Set(dupes)]));

  const byFile = new Map(corpus.map((c) => [c.file, c.text]));
  const gaps = {};
  const improved = [];
  for (const b of bindings) {
    const src = sources.get(b.source);
    if (src === undefined) { errors.push(unknownSymbolMessage(b)); continue; }
    const members = extractSymbols(src).get(b.symbol);
    if (!members) { errors.push(unknownSymbolMessage(b)); continue; }
    const text = byFile.get(b.file);
    if (text === undefined) { errors.push(anchorMessage(b, { error: 'absent' })); continue; }
    const section = sectionOf(text, b.heading);
    if (section.error) { errors.push(anchorMessage(b, section)); continue; }
    const missing = undocumentedMembers(members, documentedPool(section.lines));
    const allowed = ledger.leg2Gaps[b.id];
    if (missing.length) gaps[b.id] = missing;
    if (allowed === undefined) {
      if (missing.length) errors.push(missingRowMessage(b, missing));
    } else if (missing.length > allowed.length) {
      errors.push(missingRowMessage(b, missing, allowed));
    } else if (missing.length < allowed.length) {
      improved.push(shrunkGapMessage(b, missing, allowed));
    }
  }
  return { errors, stale, improved, citations, gaps };
}

// ── Suggest: the non-failing feeder for the Leg 2 table ─────────────────────

/**
 * The heuristic measured in the header, run for REPORTING only. It binds a doc
 * table to any schema symbol it is a subset of. Its precision on this corpus was
 * 1 in 3, which is why it cannot fail anything — but it is how a human finds the
 * next binding worth registering.
 */
export function suggestions({ corpus, sources, bindings }) {
  const symbols = [];
  for (const [file, text] of sources) {
    for (const [name, members] of extractSymbols(text)) {
      if (members.length >= 3) symbols.push({ name, members, file });
    }
  }
  const registered = new Set(bindings.map((b) => `${b.file}::${b.symbol}`));
  const out = [];
  for (const { file, text } of corpus) {
    const lines = text.split('\n');
    let fence = false; let cur = null;
    const flush = () => {
      if (cur && cur.vals.length >= 3) {
        const R = [...new Set(cur.vals)];
        for (const s of symbols) {
          const S = new Set(s.members);
          if (!R.every((v) => S.has(v)) || R.length / S.size < 0.5) continue;
          if (registered.has(`${file}::${s.name}`)) continue;
          const section = sectionOf(text, cur.heading);
          const missing = section.error ? s.members.filter((v) => !R.includes(v))
            : undocumentedMembers(s.members, documentedPool(section.lines));
          out.push({ file, line: cur.start, heading: cur.heading, symbol: s.name,
            source: s.file, have: s.members.length - missing.length, want: s.members.length, missing });
        }
      }
      cur = null;
    };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (FENCE.test(line)) { fence = !fence; flush(); continue; }
      if (fence) continue;
      if (!TABLE_ROW.test(line)) { flush(); continue; }
      if (SEPARATOR_ROW.test(line)) continue;
      if (!cur) {
        let heading = '';
        for (let j = i - 1; j >= 0 && j > i - 60; j -= 1) {
          if (/^#{1,6}\s/.test(lines[j])) { heading = lines[j].trim(); break; }
        }
        cur = { start: i + 1, heading, vals: [] };
        continue;
      }
      const id = citationOf(splitRow(line)[0] || '');
      if (id) cur.vals.push(id);
    }
    flush();
  }
  return out;
}

// ── Production wiring ───────────────────────────────────────────────────────

function readCorpus() {
  const files = [];
  for (const r of ROOTS) walk(join(REPO_ROOT, r), files, EXTENSIONS);
  return files.sort().map((f) => ({
    file: relative(REPO_ROOT, f).split(sep).join('/'),
    text: readFileSync(f, 'utf8'),
  }));
}

function readIndexFiles() {
  const files = [];
  for (const r of IMPL_ROOTS) walk(join(REPO_ROOT, r), files, IMPL_EXTENSIONS);
  return files.filter((f) => !isTeachingCorpus(relative(REPO_ROOT, f)));
}

function readSources(bindings) {
  const sources = new Map();
  for (const b of bindings) {
    if (sources.has(b.source)) continue;
    const abs = join(REPO_ROOT, b.source);
    if (existsSync(abs)) sources.set(b.source, readFileSync(abs, 'utf8'));
  }
  return sources;
}

function main() {
  const absent = missingRoots([...ROOTS, ...IMPL_ROOTS]);
  if (absent.length) { console.error(missingRootsMessage(absent)); process.exit(1); }

  const corpus = readCorpus();
  const indexFiles = readIndexFiles();
  const index = buildIndex(indexFiles);
  const sources = readSources(BINDINGS);
  const ledger = loadLedger();
  const result = run({ corpus, index, bindings: BINDINGS, sources, ledger });

  if (suggest) {
    const s = suggestions({ corpus, sources: allSpecSources(), bindings: BINDINGS });
    console.log(`check-skill-identifier-liveness --suggest: ${s.length} unregistered candidate binding(s).`);
    console.log('⚠️ ADVISORY ONLY. Measured precision on this corpus: 1 true positive in 3. '
      + 'A candidate is a lead for a human to verify, never a row to paste.\n');
    for (const c of s) {
      console.log(`  ${c.file}:${c.line}  ${c.heading || '(no heading)'}`);
      console.log(`     ~ \`${c.symbol}\` (${c.source})  ${c.have}/${c.want}`
        + (c.missing.length ? `  undocumented: ${c.missing.join(', ')}` : '  COMPLETE'));
    }
    process.exit(0);
  }

  if (list) {
    console.log(`check-skill-identifier-liveness --list`);
    console.log(`\nLEG 1 — ${result.citations.length} citation(s) over ${corpus.length} file(s), `
      + `index: ${index.size} word tokens from ${indexFiles.length} file(s) under ${IMPL_ROOTS.join(', ')}.`);
    for (const c of result.citations) {
      const dead = deadSegments(c.identifier, index);
      if (dead.length) {
        const e = exemptionIndex(ledger.leg1Exemptions).get(exemptionKey(c.file, c.identifier));
        console.log(`  ${dead.length ? 'DEAD ' : '     '}${c.file}:${c.line} \`${c.identifier}\``
          + (e ? `  [exempt: ${e.kind}]` : '  ** UNEXEMPTED **'));
      }
    }
    console.log(`\nLEG 2 — ${BINDINGS.length} registered binding(s).`);
    for (const b of BINDINGS) {
      const g = result.gaps[b.id];
      console.log(`  ${b.id}: ${b.file} — ${b.heading} ~ \`${b.symbol}\``
        + (g ? `  GAP ${g.length}: ${g.join(', ')}` : '  complete'));
    }
    process.exit(0);
  }

  if (update) {
    const kept = ledger.leg1Exemptions.filter((e) => !result.stale
      .some((s) => s.file === e.file && s.identifier === e.identifier));
    const next = { leg1Exemptions: kept, leg2Gaps: result.gaps };
    writeFileSync(join(REPO_ROOT, LEDGER_PATH), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`${LEDGER_PATH} updated: ${kept.length} exemption(s) `
      + `(${result.stale.length} pruned; --update NEVER adds one — see AUTHORITY in the header), `
      + `${Object.keys(result.gaps).length} Leg 2 gap entr(ies).`);
    process.exit(0);
  }

  const errors = [...result.errors];
  if (result.stale.length) errors.push(staleExemptionMessage(result.stale));
  errors.push(...result.improved);

  if (errors.length) {
    console.error(`\ncheck-skill-identifier-liveness: ${errors.length} finding(s).\n`);
    for (const e of errors) console.error(`  ${e}\n`);
    process.exit(1);
  }
  console.log(`check-skill-identifier-liveness OK — Leg 1: ${result.citations.length} citation(s) `
    + `over ${corpus.length} published file(s) checked against ${index.size} implementation word tokens `
    + `(${ledger.leg1Exemptions.length} ledgered exemption(s)); `
    + `Leg 2: ${BINDINGS.length} registered exhaustive section(s), `
    + `${Object.keys(ledger.leg2Gaps).length} ledgered gap(s).`);
}

/** Every spec source, for `--suggest` only. The gate itself reads bound files. */
function allSpecSources() {
  const files = [];
  walk(join(REPO_ROOT, 'packages', 'spec', 'src'), files, new Set(['.ts']));
  const out = new Map();
  for (const f of files) {
    if (/\.test\.ts$/.test(f)) continue;
    out.set(relative(REPO_ROOT, f).split(sep).join('/'), readFileSync(f, 'utf8'));
  }
  return out;
}

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * Why this exists at all, in the words of the wiring gate that requires it: a
 * gate whose defect class is its MATCHING RULE cannot detect its own regression
 * on a clean tree. Green means the finding set is empty, weakening the rule can
 * only SHRINK that set, and the empty set is the fixed point of shrinking. Every
 * assertion below supplies an adversarial input the real corpus does not contain.
 *
 * The synthetic BINDINGS and corpora are the genericity proof: `run()` takes the
 * table, the corpus, the index and the ledger as parameters, so the rows shipped
 * above exercise the same code path a synthetic row does. A table only the nine
 * production rows ever reached would be nine hard-coded checks wearing a table's
 * clothes.
 */
function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };
  const eq = (label, a, b) => expect(`${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
    JSON.stringify(a) === JSON.stringify(b));

  // ── extractor ────────────────────────────────────────────────────────────
  eq('citationOf: bare backticked identifier', citationOf('`foo`'), 'foo');
  eq('citationOf: trailing parenthetical is STRIPPED, not rejected',
    citationOf('`none` (default)'), 'none');
  eq('citationOf: dotted path', citationOf('`etl.schedule`'), 'etl.schedule');
  eq('citationOf: indexed path', citationOf('`bands[].key`'), 'bands[].key');
  eq('citationOf: prose is not a citation', citationOf('Some description'), null);
  eq('citationOf: multi-token cell is not a citation', citationOf('`a`, `b`'), null);
  eq('citationOf: a type expression is not an identifier',
    citationOf("`'simple' \\| 'tabbed'`"), null);
  eq('citationOf: placeholder syntax is not an identifier', citationOf('`<task>`'), null);
  eq('segmentsOf strips the index', segmentsOf('bands[].key'), ['bands', 'key']);

  const fenced = [
    '| `live` | x |', '|:---|:---|', '| `alsoLive` | y |',
    '```ts', '| `insideFence` | z |', '```',
  ].join('\n');
  const fencedIds = extractCitations(fenced, 'f.md').map((c) => c.identifier);
  expect('fenced table rows are OUT of the population', !fencedIds.includes('insideFence'));
  expect('unfenced rows are IN', fencedIds.includes('alsoLive'));

  const legacy = ['| Legacy | CEL |', '|:---|:---|', '| `bare_field` | `record.bare_field` |'].join('\n');
  eq('a negative-header column is structurally out of the population',
    extractCitations(legacy, 'f.md'), []);
  const positive = ['| Key | Meaning |', '|:---|:---|', '| `bare_field` | x |'].join('\n');
  eq('the SAME identifier under an ordinary header IS in the population',
    extractCitations(positive, 'f.md').map((c) => c.identifier), ['bare_field']);
  expect('normalizeHeader strips backticks and emphasis',
    normalizeHeader('**`Legacy`**') === 'legacy');
  expect('every NEGATIVE_HEADERS entry is already normalized',
    [...NEGATIVE_HEADERS].every((h) => normalizeHeader(h) === h));

  // ── the index exclusions, which are what make a green run mean anything ──
  expect('the teaching corpus can never enter the index', isTeachingCorpus('skills/a/SKILL.md'));
  expect('content/docs can never enter the index', isTeachingCorpus('content/docs/x.mdx'));
  expect('implementation source DOES enter the index', !isTeachingCorpus('packages/spec/src/a.ts'));
  expect('a path merely CONTAINING a root name is not the root',
    !isTeachingCorpus('packages/skills-helper/src/a.ts'));
  expect('build output is skipped (a stale dist must not keep a retired name alive)',
    SKIP_DIRS.has('dist'));
  expect('node_modules is skipped', SKIP_DIRS.has('node_modules'));
  expect('`references` is NOT skipped — under skills/** those files are hand-authored '
    + 'published content, unlike content/docs/references which is generated',
    !SKIP_DIRS.has('references'));
  expect('IMPL_ROOTS never names a teaching root',
    IMPL_ROOTS.every((r) => !ROOTS.includes(r)));

  eq('buildIndex tokenizes identifiers',
    [...buildIndex(['x'], () => 'const fooBar = 1; obj.baz;')].sort(),
    ['baz', 'const', 'fooBar', 'obj'].sort());
  eq('deadSegments: a live name has none', deadSegments('foo', new Set(['foo'])), []);
  eq('deadSegments: names the segment that failed',
    deadSegments('etl.schedule', new Set(['etl'])), ['schedule']);

  // ── LEG 1 end to end, incl. the positive control ─────────────────────────
  const corpus1 = [{
    file: 'skills/s/SKILL.md',
    text: ['| Key | Meaning |', '|:---|:---|', '| `liveKey` | ok |', '| `phantomKey` | bad |'].join('\n'),
  }];
  const idx1 = new Set(['liveKey']);
  const noLedger = { leg1Exemptions: [], leg2Gaps: {} };
  const r1 = run({ corpus: corpus1, index: idx1, bindings: [], sources: new Map(), ledger: noLedger });
  eq('LEG 1 positive control: a seeded phantom is exactly one finding', r1.errors.length, 1);
  expect('LEG 1 the finding names the identifier', r1.errors[0].includes('phantomKey'));
  expect('LEG 1 the finding does NOT name the live row', !r1.errors[0].includes('liveKey'));

  const r1e = run({
    corpus: corpus1, index: idx1, bindings: [], sources: new Map(),
    ledger: { leg1Exemptions: [{ file: 'skills/s/SKILL.md', identifier: 'phantomKey', kind: 'sibling-repo', note: 'x' }], leg2Gaps: {} },
  });
  eq('LEG 1 an exemption silences exactly its own row', r1e.errors.length, 0);
  eq('LEG 1 a reached exemption is not stale', r1e.stale.length, 0);

  const r1s = run({
    corpus: corpus1, index: new Set(['liveKey', 'phantomKey']), bindings: [], sources: new Map(),
    ledger: { leg1Exemptions: [{ file: 'skills/s/SKILL.md', identifier: 'phantomKey', kind: 'sibling-repo', note: 'x' }], leg2Gaps: {} },
  });
  eq('LEG 1 an exemption whose row went live is STALE', r1s.stale.length, 1);
  expect('the stale message asks for --update', staleExemptionMessage(r1s.stale).includes('--update'));

  // ── LEG 2: symbols, sections, and the two structural safety rules ────────
  const specText = [
    "export const Colour = z.enum(['red', 'green', 'blue']);",
    "const Legacy = z.enum(['a', // 'notAMember'",
    "  'b', 'c']);",
    "type Mode = 'x' | 'y' | 'z';",
  ].join('\n');
  const syms = extractSymbols(specText);
  eq('extractSymbols reads a z.enum', syms.get('Colour'), ['red', 'green', 'blue']);
  eq('extractSymbols strips comments BEFORE parsing members', syms.get('Legacy'), ['a', 'b', 'c']);
  eq('extractSymbols reads a string-literal union', syms.get('Mode'), ['x', 'y', 'z']);

  // `blue` sits in a DIFFERENT section of the same file on purpose: it is both
  // the positive control's missing member and the proof that the scope is the
  // SECTION, not the file. A file-wide pool would credit it and read green.
  const doc = [
    '# Title', 'intro `red`', '## Colours', '| v | n |', '|:--|:--|',
    '| `red` | r |', '| `green` | g |', '### Sub', 'still in section: `sentinelInSub`',
    '## Other', 'far away: `blue`',
  ].join('\n');
  const sec = sectionOf(doc, '## Colours');
  expect('sectionOf runs to the next same-or-higher heading', !sec.error);
  expect('a deeper subheading stays INSIDE the section',
    sec.lines.join('\n').includes('sentinelInSub'));
  expect('the next same-level heading ENDS the section',
    !sec.lines.join('\n').includes('blue'));
  eq('sectionOf reports an absent anchor', sectionOf(doc, '## Nope').error, 'absent');
  eq('sectionOf REFUSES an ambiguous anchor rather than taking the first',
    sectionOf(`${doc}\n## Colours\n`, '## Colours').error, 'ambiguous');

  const pool = documentedPool(["| `type: 'home' \\| 'list'` | x |"]);
  expect('a member spelled inside a compound span still counts as documented',
    pool.has('home') && pool.has('list'));
  eq('undocumentedMembers names what is absent',
    undocumentedMembers(['red', 'green', 'blue'], documentedPool(['`red` `green`'])), ['blue']);

  const synthBinding = {
    id: 'synthetic', file: 'skills/s/SKILL.md', heading: '## Colours',
    symbol: 'Colour', source: 'spec.ts', why: 'synthetic row proving the table is a table',
  };
  const corpus2 = [{ file: 'skills/s/SKILL.md', text: doc }];
  const sources2 = new Map([['spec.ts', specText]]);
  // Leg 1 runs over the SAME walk, so the synthetic index must keep this doc's
  // own citations live; otherwise these Leg 2 assertions count Leg 1 findings.
  const idxDoc = new Set(['red', 'green', 'blue']);
  const r2 = run({ corpus: corpus2, index: idxDoc, bindings: [synthBinding], sources: sources2, ledger: noLedger });
  eq('LEG 2 positive control: a missing member is exactly one finding', r2.errors.length, 1);
  expect('LEG 2 the finding names the undocumented member', r2.errors[0].includes('blue'));
  expect('LEG 2 the finding names the section', r2.errors[0].includes('## Colours'));

  const complete = doc.replace('| `green` | g |', '| `green` | g |\n| `blue` | b |');
  const r2ok = run({
    corpus: [{ file: 'skills/s/SKILL.md', text: complete }], index: idxDoc,
    bindings: [synthBinding], sources: sources2, ledger: noLedger,
  });
  eq('LEG 2 a complete section is green', r2ok.errors.length, 0);

  const r2g = run({
    corpus: corpus2, index: idxDoc, bindings: [synthBinding], sources: sources2,
    ledger: { leg1Exemptions: [], leg2Gaps: { synthetic: ['blue'] } },
  });
  eq('LEG 2 a ledgered gap is green', r2g.errors.length, 0);

  const r2grew = run({
    corpus: [{ file: 'skills/s/SKILL.md', text: doc.replace('| `green` | g |', '') }],
    index: idxDoc, bindings: [synthBinding], sources: sources2,
    ledger: { leg1Exemptions: [], leg2Gaps: { synthetic: ['blue'] } },
  });
  eq('LEG 2 a GROWN gap is a finding', r2grew.errors.length, 1);
  const r2shrunk = run({
    corpus: [{ file: 'skills/s/SKILL.md', text: complete }], index: idxDoc,
    bindings: [synthBinding], sources: sources2,
    ledger: { leg1Exemptions: [], leg2Gaps: { synthetic: ['blue'] } },
  });
  eq('LEG 2 a SHRUNK gap fails asking for --update (the ratchet)', r2shrunk.improved.length, 1);
  expect('the improvement message asks for --update', r2shrunk.improved[0].includes('--update'));

  const r2sym = run({
    corpus: corpus2, index: idxDoc,
    bindings: [{ ...synthBinding, symbol: 'Gone' }], sources: sources2, ledger: noLedger,
  });
  eq('LEG 2 a binding whose SYMBOL vanished is stale, not green', r2sym.errors.length, 1);
  expect('the stale-binding message names the positive-control reasoning',
    r2sym.errors[0].includes('positive control'));
  const r2src = run({
    corpus: corpus2, index: idxDoc,
    bindings: [{ ...synthBinding, source: 'moved.ts' }], sources: sources2, ledger: noLedger,
  });
  eq('LEG 2 a binding whose SOURCE moved is stale, not green', r2src.errors.length, 1);
  const r2anchor = run({
    corpus: corpus2, index: idxDoc,
    bindings: [{ ...synthBinding, heading: '## Renamed' }], sources: sources2, ledger: noLedger,
  });
  eq('LEG 2 a renamed heading is stale, not green', r2anchor.errors.length, 1);
  const r2dupe = run({
    corpus: corpus2, index: idxDoc, bindings: [synthBinding, { ...synthBinding }],
    sources: sources2, ledger: noLedger,
  });
  expect('duplicate binding ids are refused', r2dupe.errors.some((e) => e.includes('duplicate binding id')));

  // ── both legs in ONE walk ────────────────────────────────────────────────
  const both = run({
    corpus: [{ file: 'skills/s/SKILL.md', text: `${doc}\n| K | M |\n|:--|:--|\n| \`ghost\` | x |` }],
    index: idxDoc, bindings: [synthBinding], sources: sources2, ledger: noLedger,
  });
  expect('one corpus walk carries both legs',
    both.errors.some((e) => e.startsWith('[leg1-phantom]'))
    && both.errors.some((e) => e.startsWith('[leg2-missing-row]')));

  // ── #8435: whose remedy is the expanding one ─────────────────────────────
  expect('#8435 — the phantom message marks the ledger path ' + RATCHET_AUTHORITY_MARKER,
    phantomMessage({ file: 'f', line: 1, identifier: 'x' }, ['x']).includes(RATCHET_AUTHORITY_MARKER));
  expect('#8435 — the missing-row message marks the ledger path ' + RATCHET_AUTHORITY_MARKER,
    missingRowMessage(BINDINGS[0], ['m']).includes(RATCHET_AUTHORITY_MARKER));
  expect('the author\'s own remedy is offered FIRST, unmarked',
    phantomMessage({ file: 'f', line: 1, identifier: 'x' }, ['x']).indexOf('REMEDY: correct or delete')
    < phantomMessage({ file: 'f', line: 1, identifier: 'x' }, ['x']).indexOf(RATCHET_AUTHORITY_MARKER));

  // ── the ledgers move in opposite directions, and the source says so ──────
  expect('--update is documented as PRUNE-ONLY for Leg 1 exemptions',
    /--update\s+NEVER adds one/.test(selfSource()));
  expect('the header states the asymmetry between the two ledgers',
    selfSource().includes('PRUNE-ONLY') && selfSource().includes('REWRITTEN FROM THE TREE'));

  // ── dispatch-gates coupling, both ways ───────────────────────────────────
  eq('every separator-less ROOT is declared for dispatch-gates',
    ROOTS.filter((r) => !r.includes('/')).map((r) => `${r}/**`).sort(),
    [...ROOT_DIR_WATCH_HINTS].sort());
  expect('nothing declared as a hint is itself a ROOT',
    ROOT_DIR_WATCH_HINTS.every((h) => !ROOTS.includes(h)));
  // Assert the SPELLING without writing a second declaration site. Spelling the
  // whole `const <name> = [...]` here as a regex literal creates one:
  // `check-watch-hint-literal` counts declaration sites by scanning source text
  // with comments masked, and two sites make the real one unjudgeable — measured,
  // it reported "2 declaration sites, this gate cannot judge a declaration it
  // cannot locate". The name is therefore never written next to `=` outside the
  // declaration itself.
  const hintDecl = selfSource().split('\n').filter((l) => /^const ROOT_DIR_WATCH/.test(l));
  eq('the watch-hint declaration appears exactly once in the source', hintDecl.length, 1);
  expect('it is a LITERAL array, never computed from ROOTS (a computed one '
    + 'contributes nothing to the dispatch extractor while every runtime assertion stays green)',
    hintDecl[0].includes("'skills/**'") && !hintDecl[0].includes('map('));

  // ── the shipped table is well-formed ─────────────────────────────────────
  eq('shipped binding ids are unique',
    BINDINGS.length, new Set(BINDINGS.map((b) => b.id)).size);
  expect('every shipped binding carries a `why` a reviewer can act on',
    BINDINGS.every((b) => typeof b.why === 'string' && b.why.length > 30));
  expect('every shipped binding names a heading with a markdown prefix',
    BINDINGS.every((b) => /^#{1,6}\s/.test(b.heading)));
  expect('every shipped binding names a file under a ROOT',
    BINDINGS.every((b) => ROOTS.some((r) => b.file.startsWith(`${r}/`))));
  expect('every shipped binding names a spec source',
    BINDINGS.every((b) => b.source.startsWith('packages/')));

  // ── --suggest is advisory and must never be able to fail anything ───────
  const sug = suggestions({ corpus: corpus2, sources: sources2, bindings: [] });
  expect('--suggest returns candidates without raising findings', Array.isArray(sug));
  expect('--suggest skips what is already registered',
    suggestions({ corpus: corpus2, sources: sources2, bindings: [synthBinding] })
      .every((c) => c.symbol !== 'Colour'));

  // ── refusal before scanning ──────────────────────────────────────────────
  eq('a configured root that does not resolve is refused, not skipped',
    missingRoots(['skills', 'nope'], REPO_ROOT, (p) => !String(p).endsWith('nope')), ['nope']);
  expect('the refusal explains why a partial population is not a verdict',
    missingRootsMessage(['nope']).includes('nobody configured'));

  if (failures.length) {
    console.error(`\ncheck-skill-identifier-liveness --self-test: ${failures.length} failure(s).\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('check-skill-identifier-liveness --self-test OK');
}

let SELF_SOURCE = null;
function selfSource() {
  if (SELF_SOURCE === null) {
    SELF_SOURCE = readFileSync(join(HERE, 'check-skill-identifier-liveness.mjs'), 'utf8');
  }
  return SELF_SOURCE;
}

if (isEntrypoint(import.meta.url)) {
  if (argv.includes('--self-test')) selfTest();
  else main();
}
