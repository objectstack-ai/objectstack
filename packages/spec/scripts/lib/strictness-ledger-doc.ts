// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The strictness ledger's **numbers/prose split** (#5107).
 *
 * ## Why this module exists
 *
 * `docs/audits/2026-07-unknown-key-strictness-ledger.md` was the hottest
 * merge-conflict file in the repo during the #4001 campaign, and every conflict
 * landed in the same place: its NUMBERS. Per-file counts, section headers,
 * authorable subtotals. The prose — `Class` verdicts, evidence, exemption
 * rationales — merged cleanly all day.
 *
 * The numbers merged badly in the worst possible way. Two batches each delete
 * their own rows and decrement the header by their own delta; git merges the ROWS
 * cleanly (they do not overlap) and the subtotal line, which conflicts with
 * nothing, **merges clean and wrong**. Neither side made a mistake — each number
 * was right against the branch that computed it. Seven such cases in a single day
 * (2026-08-03/04): the `ui/` subtotal alone was written as 119, 110 and 100 by
 * three batches whose merge is 91, a number no branch ever wrote down.
 *
 * So the numbers stop being written by hand. They are a pure function of the AST
 * (plus, for the bucket split, the hand-written `Class` column), which means the
 * correct resolution of every one of those conflicts was always the same three
 * words: **recompute from the merged tree**. That is exactly what the
 * `merge=os-regen` driver (#4675) already automates for `packages/spec`'s
 * generated artifacts, so the counts move into an artifact it owns.
 *
 * ## What stays hand-written, and why it must
 *
 * The `Class` verdict is a *judgement about who writes this schema's input*. No
 * AST can produce it — the reverse pin cannot tell "finished, the rest is wire by
 * decision" from "nobody got to it", and only that column can. The evidence and
 * the findings log are load-bearing prose. They stay in the ledger, and this
 * module never writes to that file.
 *
 * ## The one place the two meet
 *
 * The authorable subtotal is arithmetic (generated) over a judgement
 * (hand-written), so the judgement has to be *machine-readable* — hence the
 * `Class` cell grammar below. It is deliberately strict: an unrecognised verdict
 * is a hard failure rather than a silent zero, and a `mixed`/`split` row that
 * resolves must state its own split rather than leaving the generator to guess.
 * A tolerant parser here would put the campaign's numbers back exactly where
 * #5107 took them from — quietly wrong, in a green file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { analyzeSites, listSchemaFiles, type Posture } from './strictness-ledger';

/* ------------------------------------------------------------------ verdicts */

/**
 * The `Class` vocabulary the ledger uses. Every one of these was introduced by a
 * measurement that needed it, and three of them (`no door` / `no gate` /
 * `covered`) imply MUTUALLY EXCLUSIVE follow-ups off the SAME measurement —
 * retiring a `no gate` shape deletes something authors use, and retiring a
 * `covered` one deletes a key its consumers still gate. So the parser rejects
 * anything outside this set rather than bucketing it as "other".
 *
 * ## Why the list grows instead of rounding to the nearest word (#5249)
 *
 * `covered` is the third verdict added because the existing vocabulary returned
 * the WRONG ACTION rather than merely an imprecise label, and that is the only
 * bar a new word has to clear. Twice now the two-axis read (carrier / parse) has
 * produced one answer for two situations whose right next steps are opposite:
 *
 *   - 批 15 added `no gate` — parse absent, but the carrier is LIVE, so the fix
 *     is to wire the parse, not to retire the vocabulary;
 *   - #5249 adds `covered` — carrier absent AND parse absent (mechanically `no
 *     door`), but the vocabulary is fully guarded at every consumer, so the
 *     follow-up is NOTHING. `no door` would have pointed the next agent at
 *     ADR-0049 retirement of a key nine live nav branches share.
 *
 * The cell is read by future agents, so a verdict that names the wrong action is
 * the classification-layer mirror of a lenient consumer: the error does not stop
 * at the cell, it is amplified by whoever acts on it.
 */
export const VERDICTS = [
  'authorable',
  'verify',
  'mixed',
  'split',
  'wire',
  'open',
  'no door',
  'no gate',
  'covered',
] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The buckets the subtotals report. */
export const BUCKETS = [
  'authorable',
  'unresolved',
  'wire/open',
  'no door',
  'no gate',
  'covered',
  'unclassified',
] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * Verdict → bucket, for the verdicts that name exactly one class.
 *
 * `verify` counts as **authorable** — a readiness flag on an authorable site, not
 * a third class, and the ledger's published subtotal (`view` 6 + `app` 1 = 7)
 * counted it that way from the start. The mapping is unchanged at #5249; what
 * changed is that its one instance (`ui/app.zod.ts`'s `BaseNavItemSchema`, held
 * pending the finding-16 `.extend()` check) has since been checked and moved to
 * `covered`. `verify` keeps both its meaning and its bucket for the next site
 * that needs holding.
 *
 * `covered` gets its **own** bucket rather than sharing `no door`'s. Both are
 * carrier-absent + parse-absent, so an arithmetic merge would be defensible — but
 * the subtotal is a worklist readout, and the two rows prescribe opposite work
 * (`no door` → ADR-0049 retirement; `covered` → none). Folding them would restore
 * exactly the ambiguity the verdict was added to remove, one layer up.
 *
 * `mixed` / `split` name no single class and are resolved separately: with an
 * explicit breakdown when the per-schema read has been done, or as `unresolved`
 * while the row still carries `(p)`.
 */
const BUCKET_OF: Partial<Record<Verdict, Bucket>> = {
  authorable: 'authorable',
  verify: 'authorable',
  wire: 'wire/open',
  open: 'wire/open',
  'no door': 'no door',
  'no gate': 'no gate',
  covered: 'covered',
};

export interface ParsedClass {
  verdict: Verdict;
  /** The `(p)` flag — a provisional call made from exports/JSDoc, not a full read. */
  provisional: boolean;
  /** Explicit per-class split (`· 6 authorable`), or `null` when the row states none. */
  breakdown: ReadonlyArray<{ n: number; verdict: Verdict }> | null;
}

/**
 * Parse a `Class` cell.
 *
 * Grammar (markdown emphasis, strikethrough and backticks are stripped first, so
 * `**no door**` and `no door` are the same cell):
 *
 *     <verdict> [(p)] [· <n> <verdict>[, <n> <verdict>]…]
 *
 * Returns `null` for a cell that does not parse — the caller reports it as a
 * ledger defect naming the vocabulary, which is more useful than a guess.
 */
export function parseClassCell(raw: string): ParsedClass | null {
  const text = raw
    .replace(/~~/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const [head, tail] = splitOnce(text, '·');
  const m = /^(.+?)(\s*\(p\))?$/.exec(head.trim());
  if (!m) return null;
  const verdict = m[1].trim().toLowerCase();
  if (!isVerdict(verdict)) return null;

  let breakdown: Array<{ n: number; verdict: Verdict }> | null = null;
  if (tail !== null) {
    breakdown = [];
    for (const part of tail.split(',')) {
      const b = /^\s*(\d+)\s+(.+?)\s*$/.exec(part);
      if (!b) return null;
      const v = b[2].toLowerCase();
      if (!isVerdict(v)) return null;
      breakdown.push({ n: Number(b[1]), verdict: v });
    }
    if (!breakdown.length) return null;
  }

  return { verdict, provisional: Boolean(m[2]), breakdown };
}

function isVerdict(s: string): s is Verdict {
  return (VERDICTS as readonly string[]).includes(s);
}

function splitOnce(s: string, sep: string): [string, string | null] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, null] : [s.slice(0, i), s.slice(i + sep.length)];
}

/**
 * Attribute a row's strip sites to buckets, or explain why it cannot be done.
 *
 * The three ways a row resolves, in the order the ledger actually uses them:
 *   - a single-class verdict → the whole row lands in that bucket;
 *   - `mixed`/`split` **with** a breakdown → exactly as declared, and the
 *     breakdown must sum to the row's strip count (a declaration that does not
 *     add up is a defect, not a rounding);
 *   - `mixed`/`split` still marked `(p)` → `unresolved`, which is the honest
 *     answer and is what `data/`'s "~33 needing a per-schema verdict" is made of.
 *
 * A resolved `mixed`/`split` with no breakdown is refused. That is the case where
 * a guess would be invisible: the row looks finished, and whatever the generator
 * assumed would appear as a confident subtotal.
 */
export function bucketize(
  parsed: ParsedClass,
  strip: number,
): { buckets: Record<Bucket, number> } | { error: string } {
  const buckets = emptyBuckets();

  if (parsed.breakdown) {
    const sum = parsed.breakdown.reduce((a, b) => a + b.n, 0);
    if (sum !== strip) {
      return {
        error:
          `its Class breakdown sums to ${sum} but the file has ${strip} strip site(s).\n` +
          `    → the breakdown must account for every strip site in the row, and nothing else.`,
      };
    }
    for (const b of parsed.breakdown) {
      const bucket = BUCKET_OF[b.verdict];
      if (!bucket) {
        return {
          error:
            `its Class breakdown uses \`${b.verdict}\`, which names no single class.\n` +
            `    → break it down into the classes it mixes instead.`,
        };
      }
      buckets[bucket] += b.n;
    }
    return { buckets };
  }

  const bucket = BUCKET_OF[parsed.verdict];
  if (bucket) {
    buckets[bucket] += strip;
    return { buckets };
  }

  // `mixed` / `split` with no breakdown.
  if (parsed.provisional) {
    buckets.unresolved += strip;
    return { buckets };
  }
  return {
    error:
      `is \`${parsed.verdict}\` with no split declared, and no longer carries \`(p)\`.\n` +
      `    → state the split in the Class cell (e.g. \`${parsed.verdict} · 6 authorable, 2 wire\`),\n` +
      `      or put \`(p)\` back if the per-schema read has not been done. The subtotal is\n` +
      `      generated from this cell, so an undeclared split would be published as a guess.`,
  };
}

export function emptyBuckets(): Record<Bucket, number> {
  return {
    authorable: 0,
    unresolved: 0,
    'wire/open': 0,
    'no door': 0,
    'no gate': 0,
    covered: 0,
    unclassified: 0,
  };
}

/* -------------------------------------------------------------- ledger parse */

export interface TriageRow {
  dir: string;
  files: string[];
  classCell: string;
  /** 1-based line in the ledger. */
  line: number;
}

export interface StripRow {
  dir: string;
  file: string;
  classCell: string;
  line: number;
}

export interface ParsedLedger {
  /** Triaged directories, in the order the ledger sections them. */
  triagedDirs: string[];
  triage: TriageRow[];
  /** Directories carrying a remaining-strip section, in ledger order. */
  stripDirs: string[];
  strip: StripRow[];
}

const TRIAGE_HEADER = /^### `([a-z-]+)\/` — file-level triage\s*$/;
const STRIP_HEADER = /^#### `([a-z-]+)\/` — remaining strip sites\s*$/;

/**
 * Read the hand-written ledger into rows.
 *
 * The section headers carry no numbers any more, which is the point: they were
 * the "merged clean and wrong" surface, and as a side effect their anchors are
 * now stable instead of changing on every batch.
 */
export function parseLedger(md: string): ParsedLedger {
  const lines = md.split('\n');
  const out: ParsedLedger = { triagedDirs: [], triage: [], stripDirs: [], strip: [] };
  let mode: 'triage' | 'strip' | null = null;
  let dir: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#{1,6} /.test(line)) {
      // Any heading closes the current section; only the two shapes below open one.
      mode = null;
      dir = null;
      const t = TRIAGE_HEADER.exec(line);
      if (t) {
        mode = 'triage';
        dir = t[1];
        if (!out.triagedDirs.includes(dir)) out.triagedDirs.push(dir);
        continue;
      }
      const s = STRIP_HEADER.exec(line);
      if (s) {
        mode = 'strip';
        dir = s[1];
        if (!out.stripDirs.includes(dir)) out.stripDirs.push(dir);
      }
      continue;
    }

    if (!mode || !dir || !line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;

    if (mode === 'triage') {
      const files = [...cells[0].matchAll(/`([^`]+\.zod\.ts)`/g)].map((m) => m[1]);
      if (!files.length) continue;
      out.triage.push({ dir, files, classCell: cells[1], line: i + 1 });
    } else {
      const file = /^`([^`]+\.zod\.ts)`$/.exec(cells[0])?.[1];
      if (!file) continue;
      out.strip.push({ dir, file, classCell: cells[1], line: i + 1 });
    }
  }
  return out;
}

/* --------------------------------------------------------------- counts model */

export interface FileCount {
  file: string;
  sites: number;
  strip: number;
}

export interface TriagedDirCounts {
  dir: string;
  files: FileCount[];
  sites: number;
  strip: number;
  posture: Record<Posture, number>;
  /** Files with at least one strip site, in path order. */
  openFiles: FileCount[];
  buckets: Record<Bucket, number>;
}

export interface CountsModel {
  triaged: TriagedDirCounts[];
  other: { dir: string; sites: number }[];
  global: {
    sites: number;
    strip: number;
    openFiles: number;
    dirs: number;
    posture: Record<Posture, number>;
    buckets: Record<Bucket, number>;
  };
}

/** Per-file AST reading for one directory, recursively, in path order. */
function measureDir(srcDir: string, dir: string): { files: FileCount[]; posture: Record<Posture, number> } {
  const dirPath = path.join(srcDir, dir);
  const posture: Record<Posture, number> = { strict: 0, passthrough: 0, catchall: 0, strip: 0 };
  const files: FileCount[] = [];
  for (const rel of listSchemaFiles(dirPath)) {
    const sites = analyzeSites(path.join(dirPath, rel), rel);
    for (const s of sites) posture[s.posture]++;
    const strip = sites.filter((s) => s.posture === 'strip').length;
    if (sites.length) files.push({ file: rel, sites: sites.length, strip });
  }
  return { files, posture };
}

/**
 * Every number the ledger publishes, computed from the AST — plus the bucket
 * split, which is the one place a hand-written verdict is an input.
 *
 * Rows with a `Class` cell that cannot be resolved are reported in `problems` and
 * their sites land in the `unclassified` bucket. The artifact is still written:
 * refusing would break the post-merge regeneration the whole scheme rests on, and
 * a visible `unclassified` count plus a red `check:strictness-ledger` is a louder
 * signal than a generator that will not run.
 */
export function buildCounts(
  srcDir: string,
  ledger: ParsedLedger,
  existsDir: (dir: string) => boolean,
  allDirs: string[],
): { model: CountsModel; problems: string[] } {
  const problems: string[] = [];
  const byFile = new Map<string, StripRow>();
  for (const row of ledger.strip) byFile.set(`${row.dir}/${row.file}`, row);

  const triaged: TriagedDirCounts[] = [];
  for (const dir of ledger.triagedDirs) {
    if (!existsDir(dir)) {
      problems.push(`the ledger triages \`${dir}/\`, which does not exist under packages/spec/src.`);
      continue;
    }
    const { files, posture } = measureDir(srcDir, dir);
    const openFiles = files.filter((f) => f.strip > 0);
    const buckets = emptyBuckets();

    for (const f of openFiles) {
      const row = byFile.get(`${dir}/${f.file}`);
      if (!row) {
        // The coverage half of the gate reports this properly; here it only has
        // to not become a silent zero.
        buckets.unclassified += f.strip;
        continue;
      }
      const parsed = parseClassCell(row.classCell);
      if (!parsed) {
        problems.push(
          `ledger:${row.line} — \`${dir}/${f.file}\`'s Class cell "${row.classCell}" is not a verdict.\n` +
            `    → use one of: ${VERDICTS.join(', ')} (optionally \` (p)\`, optionally \` · N <verdict>\`).`,
        );
        buckets.unclassified += f.strip;
        continue;
      }
      const res = bucketize(parsed, f.strip);
      if ('error' in res) {
        problems.push(`ledger:${row.line} — \`${dir}/${f.file}\` ${res.error}`);
        buckets.unclassified += f.strip;
        continue;
      }
      for (const b of BUCKETS) buckets[b] += res.buckets[b];
    }

    triaged.push({
      dir,
      files,
      sites: files.reduce((a, f) => a + f.sites, 0),
      strip: files.reduce((a, f) => a + f.strip, 0),
      posture,
      openFiles,
      buckets,
    });
  }

  const other = allDirs
    .filter((d) => !ledger.triagedDirs.includes(d))
    .map((dir) => ({ dir, sites: measureDir(srcDir, dir).files.reduce((a, f) => a + f.sites, 0) }))
    .filter((d) => d.sites > 0);

  const globalPosture: Record<Posture, number> = { strict: 0, passthrough: 0, catchall: 0, strip: 0 };
  const globalBuckets = emptyBuckets();
  for (const t of triaged) {
    for (const p of Object.keys(globalPosture) as Posture[]) globalPosture[p] += t.posture[p];
    for (const b of BUCKETS) globalBuckets[b] += t.buckets[b];
  }

  return {
    model: {
      triaged,
      other,
      global: {
        sites: triaged.reduce((a, t) => a + t.sites, 0),
        strip: triaged.reduce((a, t) => a + t.strip, 0),
        openFiles: triaged.reduce((a, t) => a + t.openFiles.length, 0),
        dirs: triaged.length,
        posture: globalPosture,
        buckets: globalBuckets,
      },
    },
    problems,
  };
}

/* ------------------------------------------------------------------ rendering */

/** Where the generated artifact lives, relative to the repo root. */
export const COUNTS_PATH = 'docs/audits/2026-07-unknown-key-strictness-ledger.counts.md';

/** The ledger it belongs to, relative to the repo root. */
export const LEDGER_PATH = 'docs/audits/2026-07-unknown-key-strictness-ledger.md';

/** The command that rewrites the artifact. */
export const GEN_COMMAND = 'pnpm --filter @objectstack/spec gen:strictness-ledger';

const BUCKET_LABEL: Record<Bucket, string> = {
  authorable: 'authorable — the ruling\'s forced scope',
  unresolved: 'unresolved — needs a per-schema verdict',
  'wire/open': 'wire / open — out of forced scope',
  'no door': 'no door — no carrier, ADR-0049 territory',
  'no gate': 'no gate — carrier live, no parse',
  covered: 'covered — no carrier, no parse, guarded at every consumer',
  unclassified: '⚠️ unclassified — no ledger row',
};

/**
 * Render the artifact. Pure function of the model, so `check:strictness-ledger`
 * proves freshness by rendering and comparing bytes — there is no second parser
 * to disagree with this writer.
 */
export function renderCounts(model: CountsModel): string {
  const L: string[] = [];
  const g = model.global;

  L.push('<!-- GENERATED — DO NOT EDIT BY HAND. -->');
  L.push(`<!-- Regenerate: ${GEN_COMMAND} -->`);
  L.push('');
  L.push('# Unknown-key strictness ledger — the counts (generated)');
  L.push('');
  L.push('Every number the #4001 strictness ledger publishes, computed from the AST');
  L.push(`(\`packages/spec/scripts/lib/strictness-ledger.ts\`). The verdicts, the evidence and`);
  L.push(`the exemption rationales live in [the ledger itself](./${path.basename(LEDGER_PATH)}) and`);
  L.push('are hand-written; **this file has no prose to preserve** and is regenerated whole.');
  L.push('');
  L.push('Split out at #5107. These numbers were the ledger\'s entire merge-conflict surface:');
  L.push('two batches each decrement a header by their own delta, git merges the rows cleanly,');
  L.push('and the subtotal — which conflicts with nothing — merges clean and wrong. Seven cases');
  L.push('in one day. The correct resolution was always "recompute from the merged tree", so the');
  L.push('path carries `merge=os-regen` (#4675) and the recomputation is now mandatory rather');
  L.push('than remembered. **Never hand-patch a number here** — fix the code or the verdict and');
  L.push('regenerate.');
  L.push('');

  L.push('## Global');
  L.push('');
  L.push('| Measure | Value |');
  L.push('|---|---|');
  L.push(`| Triaged directories | ${g.dirs} |`);
  L.push(`| Object sites in them | ${g.sites} |`);
  L.push(`| Still-open (strip) sites | ${g.strip} |`);
  L.push(`| Files carrying at least one | ${g.openFiles} |`);
  L.push('');
  L.push('Remaining strip sites by class:');
  L.push('');
  L.push('| Bucket | Sites |');
  L.push('|---|---|');
  for (const b of BUCKETS) {
    if (!g.buckets[b] && b === 'unclassified') continue;
    L.push(`| ${BUCKET_LABEL[b]} | ${g.buckets[b]} |`);
  }
  L.push('');

  L.push('## Posture, per triaged directory');
  L.push('');
  L.push('The `strict` column is the one the campaign schedules against; it counts both the');
  L.push('`strictObject(` helper and the older `z.object(…).strict()` spelling, and — since');
  L.push('#5072 — no longer counts a `strictObject(…).passthrough()` chain as closed.');
  L.push('');
  L.push('| Dir | Sites | strict | passthrough | catchall | strip |');
  L.push('|---|---|---|---|---|---|');
  for (const t of model.triaged) {
    L.push(
      `| \`${t.dir}/\` | ${t.sites} | ${t.posture.strict} | ${t.posture.passthrough} | ` +
        `${t.posture.catchall} | ${t.posture.strip} |`,
    );
  }
  L.push(
    `| **total** | **${g.sites}** | **${g.posture.strict}** | **${g.posture.passthrough}** | ` +
      `**${g.posture.catchall}** | **${g.posture.strip}** |`,
  );
  L.push('');

  L.push('## File-level triage — site counts');
  L.push('');
  L.push('Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /');
  L.push('`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to');
  L.push('classify and is not listed (it becomes reportable the day it grows its first site).');
  L.push('');
  for (const t of model.triaged) {
    // Headers carry no numbers, so their anchors are stable across every batch —
    // the ledger links into this file, and a link that breaks whenever a count
    // moves is a link that will be wrong exactly when someone follows it.
    L.push(`### \`${t.dir}/\` — sites`);
    L.push('');
    L.push('| File | Sites |');
    L.push('|---|---|');
    for (const f of t.files) L.push(`| \`${f.file}\` | ${f.sites} |`);
    L.push(`| **total** | **${t.sites}** |`);
    L.push('');
  }

  L.push('## Remaining strip sites — the batch-planning map');
  L.push('');
  L.push('Per file, how many of its sites still silently discard unknown keys. The `Class`');
  L.push('column that decides the bucket split is hand-written in the ledger; the arithmetic');
  L.push('over it is here.');
  L.push('');
  for (const t of model.triaged) {
    L.push(`### \`${t.dir}/\` — open`);
    L.push('');
    L.push(`**${t.strip} strip of ${t.sites}**, in ${t.openFiles.length} file(s).`);
    L.push('');
    if (!t.openFiles.length) {
      L.push('This directory is closed.');
      L.push('');
      continue;
    }
    L.push('| File | Strip | Sites |');
    L.push('|---|---|---|');
    for (const f of t.openFiles) L.push(`| \`${f.file}\` | ${f.strip} | ${f.sites} |`);
    L.push(`| **total** | **${t.strip}** | **${t.sites}** |`);
    L.push('');
    L.push('| Bucket | Sites |');
    L.push('|---|---|');
    for (const b of BUCKETS) {
      if (!t.buckets[b] && b === 'unclassified') continue;
      L.push(`| ${BUCKET_LABEL[b]} | ${t.buckets[b]} |`);
    }
    L.push('');
  }

  L.push('## Other directories (untriaged)');
  L.push('');
  L.push('Site totals only — these directories are classified coarsely in the ledger, per');
  L.push('directory rather than per file.');
  L.push('');
  L.push('| Dir | Sites |');
  L.push('|---|---|');
  for (const o of model.other) L.push(`| \`${o.dir}/\` | ${o.sites} |`);
  L.push('');

  return `${L.join('\n')}`;
}

/* ------------------------------------------------------------------ plumbing */

export interface LoadedLedger {
  /** Absolute path of the hand-written ledger. */
  ledgerPath: string;
  /** Absolute path of the generated counts artifact. */
  countsPath: string;
  ledgerText: string;
  parsed: ParsedLedger;
  model: CountsModel;
  /** Ledger defects found while computing the model (bad `Class` cells). */
  problems: string[];
  /** The artifact as it SHOULD be on disk right now. */
  rendered: string;
}

/**
 * One loader for both `gen:` and `check:`.
 *
 * They must not compute the model two ways — the freshness gate works by
 * rendering and byte-comparing, so a second implementation would be a second
 * answer, and the failure mode of two answers is a gate that goes green on a
 * wrong file. This repo has that scar in four separate instruments already.
 */
export function loadLedger(repoRoot: string, specSrc: string): LoadedLedger {
  const ledgerPath = path.join(repoRoot, LEDGER_PATH);
  const countsPath = path.join(repoRoot, COUNTS_PATH);
  const ledgerText = fs.readFileSync(ledgerPath, 'utf-8');
  const parsed = parseLedger(ledgerText);

  const allDirs = fs
    .readdirSync(specSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const { model, problems } = buildCounts(
    specSrc,
    parsed,
    (dir) => fs.existsSync(path.join(specSrc, dir)),
    allDirs,
  );

  return { ledgerPath, countsPath, ledgerText, parsed, model, problems, rendered: renderCounts(model) };
}
