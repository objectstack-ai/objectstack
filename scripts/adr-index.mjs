#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// adr-index — `docs/adr/README.md`, the index of this repository's decision
// records, GENERATED from the records themselves (#26076, maintainer ruling A,
// 门禁不加).
//
//   node scripts/adr-index.mjs               # (re)write docs/adr/README.md from the records
//   node scripts/adr-index.mjs --check       # exit 1 when the committed index is stale or a record is unreadable
//   node scripts/adr-index.mjs --report      # REPORT-ONLY (the lint ADR step's call): `::warning::` lines, exit 0 always
//   node scripts/adr-index.mjs --json        # the parsed registry, machine-readable, on stdout
//   node scripts/adr-index.mjs --self-test   # verify the generator itself
//
// ## The failure this exists for
//
// 143 decision records and no list of them. AGENTS.md Prime Directive 13 sends
// every author to "grep the ADRs for the surface you are touching", and a
// registry with no index is grepped by filename guesswork — a decision nobody
// can find is a decision that will be reversed. Four numbers are carried by more
// than one file (0006 by three versions of one decision; 0010, 0019 and 0057 by
// two unrelated decisions each) and nothing listed them side by side. The
// records spelled their status line four ways (`**Status**:`, `- **Status:**`,
// `## Status`, `- **状态**:`), so "is this ADR still in force?" was a question
// two greps answered differently — the decision card measured 104 Accepted by
// one instrument and 98 by another, over the same files.
//
// ## What it does, and what it deliberately does not
//
//   - The index is NEVER hand-written. The record's `**Status**:` line is the
//     single fact and this script projects it; a hand edit to README.md is
//     overwritten by the next run, by design. Regenerate with `pnpm adr:index`.
//   - ONE status-line spelling: a line that STARTS `**Status**:` — bold key,
//     colon outside the bold, nothing before it. A record without one is listed
//     as UNPARSED and reported, never guessed from a heading or a bullet: a
//     guess is a second spelling with extra steps, and the one-instrument
//     property is the whole point.
//   - The status KEYWORD is read off the value (`STATUS_KEYWORDS` below:
//     `Accepted`, `Proposed`, `Superseded` …); the rest of the line is free
//     prose and stays so. `check-adr-anchors.mjs`'s header says why the status
//     line is not that gate's business, and this script agrees: it REPORTS a
//     keyword it does not know, it does not refuse the record.
//   - Shared numbers are listed side by side and NEVER renumbered or moved
//     (Prime Directive 13): the three colliding pairs under the stem-qualified
//     id `check-adr-anchors.mjs` resolves to one record
//     (`ADR-0057-system-data-lifecycle-and-retention`), the 0006 versions as one
//     row group. Each such record's header names its sibling(s) too.
//   - `ui/docs/adr/` — objectui's own sequence, imported with the cutover — is
//     indexed under the `ui-` prefix with its files untouched (#26080, ruling A).
//     Its numbers overlap this registry's and mean something else, so an index
//     row says `ui-0057`, never `ADR-0057`, and a citation of one keeps the
//     `ObjectUI ADR-NNNN` spelling the anchor checker recognises as another
//     registry's.
//   - REPORT-ONLY in CI. The lint ADR step calls `--report`, which prints
//     `::warning::` annotations for a stale index or an unreadable record and
//     exits 0 whatever it finds; `--check` is the gate's spelling, kept for the
//     day a maintainer names one (pm-dispatch ④: 新增门禁默认否, and the ruling
//     said so explicitly).
//   - `docs/adr/PRIORITIZATION.md`, the retired review that used to sit in the
//     registry, left when this index arrived; the one rule it still carried —
//     status hygiene on landing an implementation — lives in `CONVENTIONS`
//     below, where every reader of the index meets it.
//
// ## Self-test shape
//
// Battery names and floors, a module-level verdict flag, and a dispatch that
// refuses a self-test that returned without its verdict — copied, not
// imported, from `scripts/check-agent-model-declared.mjs` (AGENTS.md, "Writing
// a --self-test"). `--report` runs the same batteries first and turns a red
// one into a warning rather than a red step: a broken generator must not red
// the lane the maintainer kept advisory, and must not go quiet either.

import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

export const ADR_DIR = 'docs/adr';
export const UI_ADR_DIR = 'ui/docs/adr';
export const INDEX_PATH = 'docs/adr/README.md';
const SELF_PATH = 'scripts/adr-index.mjs';

/** `0057-system-data-lifecycle-and-retention.md`, `0006-project-environment-split.v4.md` — same grammar as check-adr-anchors.mjs. */
export const ADR_FILENAME = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.v(\d+))?\.md$/;
/** Markdown in a registry directory that is not a record: this index itself. */
export const NON_RECORD_FILES = new Set(['README.md']);
/** THE status-line spelling. Anything else is not a status line. */
export const STATUS_LINE = /^\*\*Status\*\*:[ \t]*(.*)$/;
/** The keyword vocabulary, multi-word entries first so `Partially implemented` is not read as nothing. */
export const STATUS_KEYWORDS = Object.freeze([
  'Partially implemented',
  'Accepted',
  'Proposed',
  'Draft',
  'Superseded',
  'Withdrawn',
  'Deferred',
  'Implemented',
  'Revised',
  'Amended',
]);
/** The keyword column of a record whose status line is missing or whose value names no keyword. */
export const UNPARSED = 'Unparsed';
/** A record's header: the lines read for `**Key**:` fields (date, supersedes, superseded by). */
const HEADER_WINDOW = 40;
/** How far into a status value a keyword may sit — `The DECISION is Accepted …` counts, a keyword in sentence three does not. */
const KEYWORD_WINDOW = 80;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const TOMBSTONE_SLUG_PREFIX = 'withdrawn-';

// ── The self-test's own battery roster and floor ───────────────────────────
const SELF_TEST_BATTERIES = Object.freeze({
  'record parsing: filename, title, status, date (#26076)': 11,
  'the one status-line spelling: every other spelling is Unparsed, never guessed': 5,
  'supersession references are extracted, not invented': 8,
  'shared numbers and versions group side by side, registries never merge': 5,
  'rendering is deterministic and lists both registries': 7,
  'drift verdicts: --check reds, --report never does': 4,
  'Live tree: every record parses and the registry is not empty': 6,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(no battery open)';
let selfTestReachedVerdict = false;

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * `**Key**: value` / `**Key:** value` / `- **Key**: value` header fields of one record.
 * @param {string[]} lines
 * @returns {{ key: string, value: string }[]}
 */
export function headerFields(lines) {
  const out = [];
  for (const line of lines) {
    const m = /^(?:-[ \t]*)?\*\*([^*]+?)(?:\*\*[ \t]*[:：]|[:：]\*\*)[ \t]*(.*)$/.exec(line);
    if (m) out.push({ key: m[1].trim(), value: m[2].trim() });
  }
  return out;
}

/**
 * The status keyword of a status value: the vocabulary entry that appears
 * EARLIEST in the (markdown-stripped) value, within the keyword window; ties go
 * to the longer entry. `Unparsed` when none does — reported, never guessed.
 * @param {string} value
 */
export function statusKeywordOf(value) {
  const plain = value.replace(/[*_`>]/g, ' ').replace(/\s+/g, ' ').trim();
  let best = null;
  for (const keyword of STATUS_KEYWORDS) {
    const index = plain.indexOf(keyword);
    if (index < 0 || index > KEYWORD_WINDOW) continue;
    if (best === null || index < best.index || (index === best.index && keyword.length > best.keyword.length)) {
      best = { keyword, index };
    }
  }
  return best ? best.keyword : UNPARSED;
}

/**
 * The decision references a free-prose value names: `ADR-0063`, `ADR-0006 v4`,
 * `cloud ADR-0025`, `ObjectUI ADR-0001`, a `./0063-two-kernel….md` link or a
 * bare `0006-project-environment-split.v4.md` filename, a bare `v2`. Nothing is
 * invented: a value with none of these yields `[]`, and the renderer shows a
 * snippet of the prose instead.
 * @param {string} value
 * @returns {string[]}
 */
export function refsIn(value) {
  const refs = [];
  const push = (r) => {
    if (!refs.includes(r)) refs.push(r);
  };
  const re =
    /\b(cloud|objectui|object-ui)[ \t]+ADR-(\d{4})\b|\bADR-(\d{4})(?:-[a-z0-9]+)*(?:\.v(\d+))?(?:[ \t]+v(\d+)\b)?|(?:\.\/|\b)(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*(?:\.v(\d+))?\.md\b|\bv(\d)\b(?!\.\d)/gi;
  for (const m of value.matchAll(re)) {
    if (m[1]) push(`${m[1].toLowerCase() === 'cloud' ? 'cloud' : 'ObjectUI'} ADR-${m[2]}`);
    else if (m[3]) push(`ADR-${m[3]}${m[4] || m[5] ? ` v${m[4] ?? m[5]}` : ''}`);
    else if (m[6]) push(`ADR-${m[6]}${m[7] ? ` v${m[7]}` : ''}`);
    else if (m[8]) push(`v${m[8]}`);
  }
  return dropBareVersions(refs);
}

/** A bare `vN` already named by an `ADR-NNNN vN` in the same list is one reference, not two. */
function dropBareVersions(refs) {
  return refs.filter((r) => !/^v\d$/.test(r) || !refs.some((o) => o.endsWith(` ${r}`)));
}

/** Markdown → plain text, for a table cell: links to their text, emphasis and quotes dropped, whitespace collapsed. */
export function plainText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A table cell: pipes escaped, long values cut with an ellipsis. */
export function cell(text, max = 72) {
  const t = plainText(text).replace(/\|/g, '\\|');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Parse one record. Pure over the filename and the text so the self-test drives
 * it with fixtures.
 * @param {string} name  the filename, e.g. `0057-system-data-lifecycle-and-retention.md`
 * @param {string} text
 * @returns {null | {
 *   file: string, number: string, slug: string, stem: string, version: string|null, tombstone: boolean,
 *   title: string, statusValue: string|null, keyword: string, date: string|null,
 *   supersedes: string[], supersedesText: string, supersededBy: string[], supersededByText: string,
 * }}  null when the filename is not a record's
 */
export function parseRecord(name, text) {
  const m = ADR_FILENAME.exec(name);
  if (!m) return null;
  const [, number, slug, version] = m;
  const lines = text.split('\n');
  const titleLine = lines.find((l) => /^#[ \t]+\S/.test(l)) ?? '';
  const title =
    titleLine
      .replace(/^#[ \t]+/, '')
      .replace(/^ADR-\d{4}[ \t]*[:：—–-][ \t]*/, '')
      .trim() || `(untitled) ${name}`;
  let statusValue = null;
  for (const line of lines) {
    const s = STATUS_LINE.exec(line);
    if (s) {
      statusValue = s[1].trim();
      break;
    }
  }
  const keyword = statusValue === null ? UNPARSED : statusKeywordOf(statusValue);
  const header = lines.slice(0, HEADER_WINDOW);
  const fields = headerFields(header);
  const dateField = fields.find((f) => /^(date|日期)$/i.test(f.key));
  const date = (dateField && ISO_DATE.exec(dateField.value)?.[0]) ?? (statusValue && ISO_DATE.exec(statusValue)?.[0]) ?? null;

  const supersedesFields = fields.filter((f) => /supersedes/i.test(f.key) && !/superseded by/i.test(f.key));
  const supersedes = uniq(supersedesFields.flatMap((f) => refsIn(f.value)));
  const supersedesText = supersedesFields.map((f) => f.value).join(' · ');

  const supersededByFields = fields.filter((f) => /superseded by/i.test(f.key));
  const afterSuperseded = (s) => s.replace(/^[\s\S]*?superseded(?:[ \t]+in[ \t]+part)?(?:[^a-z0-9]{0,40}?)\bby\b/i, '').slice(0, 160);
  const supersededBy = uniq([
    ...supersededByFields.flatMap((f) => refsIn(f.value)),
    ...(statusValue && /\bsuperseded\b/i.test(statusValue) ? refsIn(afterSuperseded(statusValue)) : []),
    ...header.filter((l) => /^>[ \t]*\*\*[^\n]*\bsuperseded\b/i.test(l)).flatMap((l) => refsIn(afterSuperseded(l))),
  ]);
  const supersededByText = supersededByFields.map((f) => f.value).join(' · ');

  return {
    file: name,
    number,
    slug,
    stem: `${number}-${slug}`,
    version: version ?? null,
    tombstone: slug.startsWith(TOMBSTONE_SLUG_PREFIX),
    title,
    statusValue,
    keyword,
    date,
    supersedes,
    supersedesText,
    supersededBy,
    supersededByText,
  };
}

function uniq(list) {
  return dropBareVersions([...new Set(list)]);
}

/** Sort: by number, then the unversioned file, then versions numerically. */
export function byNumberThenVersion(a, b) {
  if (a.number !== b.number) return a.number < b.number ? -1 : 1;
  if (a.stem !== b.stem) return a.stem < b.stem ? -1 : 1;
  return (a.version === null ? -1 : Number(a.version)) - (b.version === null ? -1 : Number(b.version));
}

/**
 * Read a registry directory. Filenames that parse as records are parsed; the
 * index itself is skipped; anything else is returned as `foreign` so the
 * report can name it.
 * @param {string} root
 * @param {string} dir
 * @returns {{ records: ReturnType<typeof parseRecord>[], foreign: string[] }}
 */
export function readRegistry(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return { records: [], foreign: [] };
  const records = [];
  const foreign = [];
  for (const name of readdirSync(abs).sort()) {
    if (!name.endsWith('.md') || NON_RECORD_FILES.has(name)) continue;
    const rec = parseRecord(name, readFileSync(join(abs, name), 'utf8'));
    if (rec) records.push(rec);
    else foreign.push(name);
  }
  records.sort(byNumberThenVersion);
  return { records, foreign };
}

/**
 * The numbers more than one file carries, each with its kind: `versions` when
 * every file repeats ONE stem (0006), `collision` when two stems share it
 * (0010, 0019, 0057). Pure over parsed records.
 * @param {ReturnType<typeof parseRecord>[]} records
 * @returns {{ number: string, kind: 'versions' | 'collision', records: ReturnType<typeof parseRecord>[] }[]}
 */
export function sharedNumbers(records) {
  const byNumber = new Map();
  for (const r of records) {
    if (!byNumber.has(r.number)) byNumber.set(r.number, []);
    byNumber.get(r.number).push(r);
  }
  const out = [];
  for (const [number, group] of [...byNumber].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (group.length < 2) continue;
    const stems = new Set(group.map((r) => r.stem));
    out.push({ number, kind: stems.size === 1 ? 'versions' : 'collision', records: [...group].sort(byNumberThenVersion) });
  }
  return out;
}

// ── Rendering ──────────────────────────────────────────────────────────────

/** The fixed text at the top of the index: the rules a reader of the registry needs, the status-hygiene rule among them. */
export const CONVENTIONS = `## Conventions

- **One registry per repository, numbers never reassigned, files never moved** (AGENTS.md Prime Directive 13). A reversed decision is a new ADR or an amended status line, never a quiet changeset. Before changing behaviour in territory an ADR governs, grep this index for the surface.
- **The status line is the single fact.** Every record carries, right under its title, one line that starts \`**Status**: \` followed by a keyword — ${STATUS_KEYWORDS.map((k) => `\`${k}\``).join(', ')} — and any free prose after it (dates, implementation notes, amendments). This index is generated from that line by \`scripts/adr-index.mjs\`; a record whose line is missing or names no keyword is listed as **${UNPARSED}** and reported, never guessed.
- **Status hygiene.** A PR that lands an ADR's implementation flips that ADR's \`**Status**:\` line to \`Accepted — implemented\` with one line of evidence (key file + test), in the same PR. (The rule the retired \`PRIORITIZATION.md\` review carried; it lives here now.)
- **Shared numbers are cited by stem.** Where two unrelated records carry one number, a bare \`ADR-NNNN\` is one of two; the unambiguous id is the record's filename stem prefixed \`ADR-\` (\`ADR-0057-system-data-lifecycle-and-retention\`), which \`scripts/check-adr-anchors.mjs\` resolves to that one record. Versions of one decision share a stem and add \`.vN\`; cite a version as \`ADR-0006 v4\` in prose or \`ADR-0006-project-environment-split.v4\` where a checker reads it.
- **The ObjectUI registry (\`ui/docs/adr/\`) keeps its own sequence**, imported with the ui merge. Its numbers overlap this registry's and mean something else; this index lists them under the \`ui-\` prefix, and a citation of one is spelled \`ObjectUI ADR-NNNN\`, which the anchor checker recognises as another registry's.
- **Decisions that draw the open/closed or commercial boundary live in \`objectstack-ai/cloud\`** and are cited from here as \`cloud ADR-NNNN\`, never as a bare number.

`;

const BANNER = (rootDir) =>
  `> **Generated** by \`node scripts/adr-index.mjs\` from the records in \`${rootDir}/\` — do not edit by hand; change a record's \`**Status**:\` line and regenerate (\`pnpm adr:index\`). The lint ADR step reports a stale index as a warning and never fails on it.\n\n`;

function numberCell(r, { shared, relDir, prefix }) {
  const link = `${relDir}/${r.file}`;
  if (prefix) return `[${prefix}${r.number}](${link})`;
  if (shared?.kind === 'collision') return `[ADR-${r.stem}](${link})`;
  if (r.version !== null) return `[ADR-${r.number} v${r.version}](${link})`;
  return `[ADR-${r.number}](${link})`;
}

function statusCell(r) {
  if (r.statusValue === null) return `**${UNPARSED}** — no \`**Status**:\` line`;
  if (r.keyword === UNPARSED) return `**${UNPARSED}** — ${cell(r.statusValue, 60)}`;
  const plain = plainText(r.statusValue);
  const at = plain.indexOf(r.keyword);
  const detail = (at >= 0 ? plain.slice(0, at) + plain.slice(at + r.keyword.length) : plain)
    .replace(/^[\s—–:;,.-]+/, '')
    .replace(/^\(([^()]*)\)/, '$1')
    .replace(/^[\s—–:;,.-]+/, '')
    .trim();
  return detail ? `${r.keyword} — ${cell(detail, 64)}` : r.keyword;
}

function refsCell(refs, text) {
  if (refs.length) return refs.join(', ');
  const plain = plainText(text);
  if (!plain || /^(—|–|-|none|nothing|n\/a)(?![a-z0-9])/i.test(plain)) return '—';
  return `*${cell(plain, 40)}*`;
}

function recordRow(r, opts) {
  return `| ${numberCell(r, opts)} | ${cell(r.title, 110)} | ${statusCell(r)} | ${r.date ?? '—'} | ${refsCell(
    r.supersedes,
    r.supersedesText,
  )} | ${refsCell(r.supersededBy, r.supersededByText)} |`;
}

const TABLE_HEAD = '| Number | Title | Status | Date | Supersedes | Superseded by |\n|---|---|---|---|---|---|\n';

function summaryTable(records) {
  const counts = new Map();
  for (const r of records) counts.set(r.keyword, (counts.get(r.keyword) ?? 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return (
    '| Status | Records |\n|---|---|\n' +
    rows.map(([k, n]) => `| ${k === UNPARSED ? `**${k}**` : k} | ${n} |`).join('\n') +
    `\n| **Total** | **${records.length}** |\n`
  );
}

/**
 * The whole index, as text. Pure over the two parsed registries — the same
 * input renders the same bytes, which is what `--check` compares.
 * @param {{ root: ReturnType<typeof parseRecord>[], ui: ReturnType<typeof parseRecord>[] }} registries
 */
export function renderIndex({ root, ui }) {
  const rootSorted = [...root].sort(byNumberThenVersion);
  const uiSorted = [...ui].sort(byNumberThenVersion);
  const shared = sharedNumbers(rootSorted);
  const sharedOf = new Map(shared.flatMap((s) => s.records.map((r) => [r.file, s])));
  let out = '# Architecture Decision Records — index\n\n';
  out += BANNER(ADR_DIR);
  out += CONVENTIONS;

  out += '## Summary\n\n';
  out += `${rootSorted.length} records under \`${ADR_DIR}/\` (${uniq(rootSorted.map((r) => r.number)).length} numbers), ${uiSorted.length} under \`${UI_ADR_DIR}/\` (listed separately below).\n\n`;
  out += summaryTable(rootSorted) + '\n';

  out += '## Shared numbers\n\n';
  if (shared.length === 0) out += 'None — every number names one file.\n\n';
  else {
    out +=
      'Listed side by side, never renumbered (Prime Directive 13). A **collision** is two unrelated decisions under one number — cite each by its stem-qualified id; **versions** are one decision revised under its own number.\n\n';
    for (const s of shared) {
      const kind = s.kind === 'collision' ? `${s.records.length} unrelated decisions — a collision` : `one decision, ${s.records.length} versions`;
      out += `### ADR-${s.number} — ${kind}\n\n`;
      out += '| Cite as | File | Title | Status | Date |\n|---|---|---|---|---|\n';
      for (const r of s.records) {
        const citeAs = s.kind === 'collision' ? `\`ADR-${r.stem}\`` : r.version === null ? `\`ADR-${r.number}\`` : `\`ADR-${r.number} v${r.version}\` / \`ADR-${r.stem}.v${r.version}\``;
        out += `| ${citeAs} | [${r.file}](./${r.file}) | ${cell(r.title, 90)} | ${statusCell(r)} | ${r.date ?? '—'} |\n`;
      }
      out += '\n';
    }
  }

  out += `## Records — \`${ADR_DIR}/\`\n\n`;
  out += TABLE_HEAD;
  for (const r of rootSorted) out += recordRow(r, { shared: sharedOf.get(r.file), relDir: '.', prefix: '' }) + '\n';
  out += '\n';

  out += `## ObjectUI registry — \`${UI_ADR_DIR}/\` (\`ui-\` prefix)\n\n`;
  out +=
    `objectui's own decision sequence, imported with the ui merge and kept in place (#26080). Numbers overlap the registry above and name different decisions; cite one as \`ObjectUI ADR-NNNN\`.\n\n`;
  if (uiSorted.length === 0) out += 'No records.\n';
  else {
    out += TABLE_HEAD;
    for (const r of uiSorted) out += recordRow(r, { shared: null, relDir: `../../${UI_ADR_DIR}`, prefix: 'ui-' }) + '\n';
  }
  return out;
}

// ── Verdicts ───────────────────────────────────────────────────────────────

/**
 * What a run has to say about the tree: the records that did not parse, the
 * files in a registry that are not records, and whether the committed index
 * equals the rendering. Pure, so the self-test can drive it.
 * @param {{ root: { records: any[], foreign: string[] }, ui: { records: any[], foreign: string[] } }} registries
 * @param {string | null} committed  the index file's current text, or null when absent
 * @returns {{ expected: string, stale: boolean, problems: string[] }}
 */
export function verdict(registries, committed) {
  const expected = renderIndex({ root: registries.root.records, ui: registries.ui.records });
  const problems = [];
  for (const [dir, reg] of [
    [ADR_DIR, registries.root],
    [UI_ADR_DIR, registries.ui],
  ]) {
    for (const r of reg.records) {
      if (r.statusValue === null) problems.push(`${dir}/${r.file}: no \`**Status**:\` line — listed as ${UNPARSED}`);
      else if (r.keyword === UNPARSED) {
        problems.push(`${dir}/${r.file}: status value names no keyword (${STATUS_KEYWORDS.join(' | ')}) — listed as ${UNPARSED}: "${r.statusValue.slice(0, 60)}"`);
      }
    }
    for (const f of reg.foreign) problems.push(`${dir}/${f}: not a record filename (\`NNNN-kebab-slug.md\`) and not the index — left out of the index`);
  }
  if (registries.root.records.length === 0) problems.push(`${ADR_DIR}/: no records found — run from the repository root`);
  return { expected, stale: committed !== expected, problems };
}

function readRegistries(root) {
  return { root: readRegistry(root, ADR_DIR), ui: readRegistry(root, UI_ADR_DIR) };
}

function readCommitted(root) {
  const p = join(root, INDEX_PATH);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// ── Modes ──────────────────────────────────────────────────────────────────

function modeWrite(root) {
  const v = verdict(readRegistries(root), readCommitted(root));
  writeFileSync(join(root, INDEX_PATH), v.expected);
  for (const p of v.problems) console.log(`adr-index: note — ${p}`);
  console.log(`adr-index: ${v.stale ? 'wrote' : 'unchanged'} ${INDEX_PATH} (${v.expected.split('\n').length} lines).`);
  return 0;
}

function modeCheck(root) {
  const v = verdict(readRegistries(root), readCommitted(root));
  for (const p of v.problems) console.error(`adr-index: ✗ ${p}`);
  if (v.stale) {
    console.error(`adr-index: ✗ ${INDEX_PATH} is stale — run \`node ${SELF_PATH}\` (pnpm adr:index) and commit the result.`);
  }
  if (v.stale || v.problems.length) return 1;
  console.log(`adr-index: OK — ${INDEX_PATH} is current and every record parsed.`);
  return 0;
}

function modeReport(root) {
  // Report-only by construction: every finding below is a warning annotation,
  // and the exit code is 0 whatever was found (#26076, ruling A: 门禁不加).
  const lines = [];
  const warn = (file, message) => {
    console.log(`::warning file=${file}::adr-index: ${message}`);
    lines.push(`- \`${file}\`: ${message}`);
  };
  const st = runSelfTest();
  if (st.failures.length) {
    warn(SELF_PATH, `self-test FAILED (${st.failures.length} of ${st.checked}) — the index generator is broken; fix it before trusting the index: ${st.failures[0].slice(0, 200)}`);
  }
  let v;
  try {
    v = verdict(readRegistries(root), readCommitted(root));
  } catch (e) {
    warn(SELF_PATH, `could not read the registries — ${e && e.message ? e.message : e}`);
    v = null;
  }
  if (v) {
    for (const p of v.problems) warn(p.split(':')[0], p.slice(p.indexOf(':') + 2));
    if (v.stale) warn(INDEX_PATH, `stale — a record changed and the index did not; run \`pnpm adr:index\` and commit (report-only, not a gate: #26076)`);
  }
  const ok = lines.length === 0;
  console.log(
    ok
      ? `adr-index --report: OK — ${INDEX_PATH} is current, every record parsed, self-test ${st.checked} assertions green. Report-only: this line never reds the step.`
      : `adr-index --report: ${lines.length} warning(s) above. Report-only: exit 0 by design (#26076, 门禁不加); \`node ${SELF_PATH} --check\` is the gate's spelling if one is ever named.`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### ADR index (report-only)\n\n${ok ? `✓ \`${INDEX_PATH}\` current, every record parsed.` : lines.join('\n')}\n\n`,
      );
    } catch {
      /* the summary is a courtesy, never a verdict */
    }
  }
  return 0;
}

function modeJson(root) {
  const reg = readRegistries(root);
  const strip = (r) => ({
    file: r.file,
    number: r.number,
    stem: r.stem,
    version: r.version,
    tombstone: r.tombstone,
    title: r.title,
    status: { keyword: r.keyword, value: r.statusValue, date: r.date },
    supersedes: r.supersedes,
    supersededBy: r.supersededBy,
  });
  console.log(
    JSON.stringify(
      {
        root: reg.root.records.map(strip),
        ui: reg.ui.records.map(strip),
        shared: sharedNumbers(reg.root.records).map((s) => ({ number: s.number, kind: s.kind, files: s.records.map((r) => r.file) })),
        foreign: { [ADR_DIR]: reg.root.foreign, [UI_ADR_DIR]: reg.ui.foreign },
      },
      null,
      2,
    ),
  );
  return 0;
}

// ── Self-test ──────────────────────────────────────────────────────────────

/**
 * Every assertion is NAMED and attributed to the battery most recently opened;
 * the floor below requires the opened set to equal the declared set with each
 * battery at or above its pinned count. Returns rather than exits so `--report`
 * can run it and warn (never red) on a failure.
 * @returns {{ failures: string[], checked: number }}
 */
export function runSelfTest() {
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const failures = [];
  let checked = 0;
  const assert = (name, cond, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    checked++;
    if (!cond) failures.push(`${name} — ${detail}`);
  };
  const rec = (name, text) => parseRecord(name, text);
  const canonical = (status, extra = '') => `# ADR-0042: Answer everything\n\n**Status**: ${status}\n${extra}\n---\n\n## Context\n`;

  try {
    battery('record parsing: filename, title, status, date (#26076)');
    {
      assert('filename-grammar-parses-a-record', rec('0042-answer.md', '# x')?.number === '0042' && rec('0042-answer.md', '# x')?.stem === '0042-answer', JSON.stringify(rec('0042-answer.md', '# x')));
      assert('filename-grammar-parses-a-version', rec('0042-answer.v3.md', '# x')?.version === '3' && rec('0042-answer.v3.md', '# x')?.stem === '0042-answer', JSON.stringify(rec('0042-answer.v3.md', '# x')));
      assert('filename-grammar-refuses-a-non-record', rec('README.md', '# x') === null && rec('notes.md', '# x') === null, 'README.md / notes.md must not parse as records');
      assert('tombstone-is-recognised-by-slug', rec('0001-withdrawn-thing.md', '# x')?.tombstone === true && rec('0042-answer.md', '# x')?.tombstone === false, 'the withdrawn- slug prefix marks a tombstone');
      const r = rec('0042-answer.md', canonical('Accepted — implemented (2026-07-15)', '**Date**: 2026-06-01\n'));
      assert('title-drops-the-id-prefix', r.title === 'Answer everything', `got ${JSON.stringify(r.title)}`);
      assert('title-em-dash-prefix-is-dropped-too', rec('0042-answer.md', '# ADR-0042 — `record` Form\n').title === '`record` Form', JSON.stringify(rec('0042-answer.md', '# ADR-0042 — `record` Form\n').title));
      assert('status-value-is-read-off-the-line', r.statusValue === 'Accepted — implemented (2026-07-15)', JSON.stringify(r.statusValue));
      assert('keyword-is-the-earliest-vocabulary-entry', r.keyword === 'Accepted' && statusKeywordOf('The DECISION is Accepted — it is cloud ADR-0024') === 'Accepted' && statusKeywordOf('Partially implemented (revised)') === 'Partially implemented' && statusKeywordOf('Proposed — partially implemented') === 'Proposed', 'earliest entry wins, multi-word entries are whole');
      assert('date-prefers-the-date-line', r.date === '2026-06-01', JSON.stringify(r.date));
      assert('date-falls-back-to-the-status-line', rec('0042-answer.md', canonical('Proposed (2026-06-22)')).date === '2026-06-22', 'the first ISO date in the status value');
      assert('date-is-null-when-nothing-states-one', rec('0042-answer.md', canonical('Proposed')).date === null, 'no date is invented');
    }

    battery('the one status-line spelling: every other spelling is Unparsed, never guessed');
    {
      const other = (line) => rec('0042-answer.md', `# ADR-0042: x\n\n${line}\n`);
      assert('dash-bold-is-not-a-status-line', other('- **Status**: Accepted').statusValue === null && other('- **Status**: Accepted').keyword === UNPARSED, 'bullet spelling');
      assert('colon-inside-bold-is-not-a-status-line', other('**Status:** Accepted').statusValue === null, 'colon-inside spelling');
      assert('heading-is-not-a-status-line', other('## Status\n\nAccepted.').statusValue === null, 'heading spelling');
      assert('chinese-key-is-not-a-status-line', other('- **状态**: Accepted').statusValue === null, 'the Chinese key');
      assert('unknown-keyword-is-unparsed-not-guessed', other('**Status**: Frozen solid').statusValue === 'Frozen solid' && other('**Status**: Frozen solid').keyword === UNPARSED, 'a value naming no keyword is reported as Unparsed');
    }

    battery('supersession references are extracted, not invented');
    {
      assert('supersedes-line-yields-ids', JSON.stringify(rec('0042-answer.md', canonical('Accepted', '**Supersedes**: [ADR-0040](./0040-old.md) and ADR-0012, plus v2\n')).supersedes) === JSON.stringify(['ADR-0040', 'ADR-0012', 'v2']), JSON.stringify(rec('0042-answer.md', canonical('Accepted', '**Supersedes**: [ADR-0040](./0040-old.md) and ADR-0012, plus v2\n')).supersedes));
      assert('superseded-by-is-read-from-the-status-line', JSON.stringify(rec('0042-answer.md', canonical('Superseded by [ADR-0063](./0063-new.md) — original: Proposed')).supersededBy) === JSON.stringify(['ADR-0063']), JSON.stringify(rec('0042-answer.md', canonical('Superseded by [ADR-0063](./0063-new.md) — original: Proposed')).supersededBy));
      assert('superseded-by-a-version-file-is-read', JSON.stringify(rec('0042-answer.md', canonical('Superseded by v4 (`0042-answer.v4.md`) — 2026-05-20')).supersededBy) === JSON.stringify(['ADR-0042 v4']), JSON.stringify(rec('0042-answer.md', canonical('Superseded by v4 (`0042-answer.v4.md`) — 2026-05-20')).supersededBy));
      assert('a-product-version-is-not-a-record-version', refsIn('The v3.4/v4.0 "per-organization database" tenant model').length === 0, JSON.stringify(refsIn('The v3.4/v4.0 "per-organization database" tenant model')));
      assert('cross-repo-refs-keep-their-registry', JSON.stringify(refsIn('superseded in part by cloud ADR-0025 and ObjectUI ADR-0001')) === JSON.stringify(['cloud ADR-0025', 'ObjectUI ADR-0001']), JSON.stringify(refsIn('superseded in part by cloud ADR-0025 and ObjectUI ADR-0001')));
      assert('blockquote-supersession-is-read', JSON.stringify(rec('0042-answer.md', canonical('Accepted', '\n> **🔶 Cloud-owned — superseded in part by cloud ADR-0025 (2026-06-25).** The runtime moved.\n')).supersededBy) === JSON.stringify(['cloud ADR-0025']), 'the header blockquote spelling five records use');
      assert('nothing-yields-no-refs', refsIn('nothing').length === 0 && refsIn('—').length === 0, 'no id is invented from a negative');
      assert('prose-without-ids-yields-no-refs', refsIn('the hand-written namespace-prefix rule').length === 0, 'no id is invented from prose');
    }

    battery('shared numbers and versions group side by side, registries never merge');
    {
      const R = [
        rec('0006-split.md', canonical('Superseded by v4')),
        rec('0006-split.v2.md', canonical('Superseded by v4')),
        rec('0006-split.v4.md', canonical('Accepted')),
        rec('0010-alpha.md', canonical('Proposed')),
        rec('0010-beta.md', canonical('Draft')),
        rec('0011-solo.md', canonical('Accepted')),
      ];
      const s = sharedNumbers(R);
      assert('versions-of-one-stem-group-as-versions', s.find((x) => x.number === '0006')?.kind === 'versions' && s.find((x) => x.number === '0006')?.records.length === 3, JSON.stringify(s));
      assert('two-stems-under-one-number-group-as-collision', s.find((x) => x.number === '0010')?.kind === 'collision', JSON.stringify(s));
      assert('a-number-with-one-file-is-not-shared', !s.some((x) => x.number === '0011') && s.length === 2, JSON.stringify(s));
      assert('shared-groups-are-sorted-by-number-then-version', s[0].number === '0006' && s[0].records.map((r) => r.version).join(',') === ',2,4', JSON.stringify(s[0].records.map((r) => r.file)));
      const text = renderIndex({ root: [rec('0001-root.md', canonical('Accepted'))], ui: [rec('0001-ui.md', canonical('Accepted'))] });
      assert('ui-records-never-join-a-root-number-group', !text.includes('## Shared numbers\n\nListed') && text.includes('[ui-0001](../../ui/docs/adr/0001-ui.md)'), 'the two registries are indexed apart');
    }

    battery('rendering is deterministic and lists both registries');
    {
      const root = [
        rec('0010-alpha.md', canonical('Proposed')),
        rec('0010-beta.md', canonical('Draft (2026-05-24)')),
        rec('0011-pipe.md', '# ADR-0011: A | B\n\n**Status**: Accepted\n'),
        rec('0012-silent.md', '# ADR-0012: Silent\n\nno status here\n'),
      ];
      const ui = [rec('0053-nav.md', canonical('Accepted (2026-06-18)'))];
      const a = renderIndex({ root, ui });
      const b = renderIndex({ root: [...root].reverse(), ui });
      assert('same-records-render-the-same-bytes', a === b, 'input order must not change the index');
      assert('collision-rows-carry-the-stem-qualified-id', a.includes('[ADR-0010-alpha](./0010-alpha.md)') && a.includes('[ADR-0010-beta](./0010-beta.md)') && a.includes('`ADR-0010-alpha`'), 'the unambiguous id is what the reader copies');
      assert('ui-rows-carry-the-ui-prefix-and-no-adr-id', a.includes('[ui-0053](../../ui/docs/adr/0053-nav.md)') && !/\[ADR-0053\]/.test(a), 'a ui row must not read as a root citation');
      assert('unparsed-record-is-listed-and-marked', a.includes('[ADR-0012](./0012-silent.md)') && a.includes(`**${UNPARSED}** — no`), 'a record without the line is still findable');
      assert('pipe-in-a-title-is-escaped', a.includes('A \\| B'), 'a table cell must not break the table');
      assert('conventions-carry-the-status-hygiene-rule', a.includes('Accepted — implemented') && a.includes('one line of evidence') && a.includes('Prime Directive 13'), 'the rule PRIORITIZATION.md carried lives in the index');
      assert('summary-counts-by-keyword', a.includes('| Proposed | 1 |') && a.includes('| Draft | 1 |') && a.includes(`| **${UNPARSED}** | 1 |`) && a.includes('| **Total** | **4** |'), a.slice(a.indexOf('## Summary'), a.indexOf('## Shared')));
    }

    battery('drift verdicts: --check reds, --report never does');
    {
      const reg = { root: { records: [rec('0001-a.md', canonical('Accepted'))], foreign: [] }, ui: { records: [], foreign: [] } };
      const v1 = verdict(reg, null);
      assert('missing-index-is-stale', v1.stale === true && v1.problems.length === 0, JSON.stringify({ stale: v1.stale, problems: v1.problems }));
      const v2 = verdict(reg, v1.expected);
      assert('matching-index-is-current', v2.stale === false, 'byte-equal index is current');
      const v3 = verdict({ root: { records: [rec('0001-a.md', '# x\n')], foreign: ['notes.md'] }, ui: { records: [], foreign: [] } }, null);
      assert('problems-name-the-unparsed-record-and-the-foreign-file', v3.problems.some((p) => p.includes('0001-a.md') && p.includes(UNPARSED)) && v3.problems.some((p) => p.includes('notes.md')), JSON.stringify(v3.problems));
      assert('report-mode-is-exit-zero-by-construction', /return 0;\s*}\s*function modeJson/.test(readFileSync(join(process.cwd(), SELF_PATH), 'utf8')) && !/process\.exit\(1\)[^\n]*report/.test(readFileSync(join(process.cwd(), SELF_PATH), 'utf8')), 'modeReport must end in `return 0` and never exit 1');
    }

    battery('Live tree: every record parses and the registry is not empty');
    {
      const live = readRegistries(process.cwd());
      assert('live-root-registry-is-populated', live.root.records.length >= 100, `got ${live.root.records.length} records under ${ADR_DIR}/`);
      assert('live-root-registry-has-no-foreign-files', live.root.foreign.length === 0, `non-record markdown under ${ADR_DIR}/: ${live.root.foreign.join(', ')}`);
      const unparsed = live.root.records.filter((r) => r.keyword === UNPARSED);
      assert('live-every-root-record-carries-the-one-status-spelling', unparsed.length === 0, `Unparsed: ${unparsed.map((r) => r.file).join(', ')}`);
      assert('live-shared-numbers-are-listed', sharedNumbers(live.root.records).length >= 1, 'the registry carries shared numbers today');
      assert('live-ui-registry-parses', live.ui.records.length >= 1 && live.ui.records.every((r) => r.keyword !== UNPARSED), `ui: ${live.ui.records.length} records, unparsed ${live.ui.records.filter((r) => r.keyword === UNPARSED).map((r) => r.file).join(', ')}`);
      assert('live-index-renders', renderIndex({ root: live.root.records, ui: live.ui.records }).length > 10_000, 'the live rendering is not trivially small');
    }
  } catch (e) {
    failures.push(`self-test threw before finishing — ${e && e.stack ? e.stack : e}`);
  }

  // ── The floor: every declared battery RAN, and ran its cases ────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  return { failures, checked };
}

function selfTest() {
  const { failures, checked } = runSelfTest();
  if (failures.length) {
    console.error(`✗ adr-index --self-test — ${failures.length} failure(s) of ${checked} assertion(s)\n`);
    for (const f of failures) console.error('  • ' + f + '\n');
    process.exit(1);
  }
  console.log(`✓ adr-index --self-test: ${checked} assertions over the real parseRecord() / renderIndex() / verdict() paths.`);
  selfTestReachedVerdict = true;
  process.exit(0);
}

function main(argv) {
  const root = process.cwd();
  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ adr-index self-test: selfTest() returned without reaching its verdict, so no success line was printed.\n');
      process.exit(1);
    }
    return;
  }
  if (argv.includes('--report')) process.exit(modeReport(root));
  if (argv.includes('--check')) process.exit(modeCheck(root));
  if (argv.includes('--json')) process.exit(modeJson(root));
  if (argv.some((a) => a.startsWith('-'))) {
    console.error(`adr-index: unknown option ${argv.find((a) => a.startsWith('-'))} — see the header of ${SELF_PATH}.`);
    process.exit(2);
  }
  process.exit(modeWrite(root));
}

if (isEntrypoint(import.meta.url)) main(process.argv.slice(2));
