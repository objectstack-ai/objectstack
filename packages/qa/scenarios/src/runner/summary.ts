// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack-scenarios summary <record|dir>…` — many run records, one table
 * per card and mode: rows are the author model, columns the ask model, and
 * each cell sums the runs that share both.
 *
 * The runner writes one record per card per run (`runRecord`, `scorecard.ts`)
 * and nothing else reads several of them together; this reads them back, as
 * files only. Deterministic and offline: no model, no network, no scoring of
 * its own — every figure is the one the record's scorecard states (the cost
 * ruling on cloud#3600 rules out a model judge here as anywhere).
 *
 * What a table shows, so a cell always means one thing:
 *
 *   - One table per card and mode (`scratch`, `template`, `ask`, `door`). Its runs
 *     must share the prompt choice, the package source, the ask repeats, the
 *     driver, the ask client's skills, the door arm (`door.ts`: one arm per
 *     table, so an arm's runs are summed and two arms never are), the card file they graded (its
 *     sha256, `CardStamp`) and the schema masking of the apps they booted
 *     (`env.schemaMasking`, `schema-masking.ts`: a masking-off round asks
 *     another question of a withheld field than a default one)
 *     ({@link TABLE_DIMENSIONS}); when they do not, the table is
 *     refused with a line naming each difference and the files on each side,
 *     never summed. The other tables still print. A record from before the
 *     card stamp reads `card: not recorded`, so it is never summed with a
 *     stamped one: nothing says it graded the same card.
 *   - Rows: the model the build's authoring turn was SERVED (the record's
 *     `Build · author`), with the model it asked for beside it when that is
 *     another name, and the effort it asked for (a door mode's too: it
 *     authors its build). A template or ask mode
 *     authored no first build: its row is the build it was supplied — the
 *     template file the record names (`template`, {@link SuppliedTemplate}),
 *     or, for `this run’s from-scratch build`, that run's scratch author. A
 *     record that names no template file gets a row of its own: two such
 *     runs are never summed, since nothing says they ran on one build.
 *   - Columns: the models the question and operation turns were served
 *     (`Run · model`), the asked-for name and effort beside them likewise.
 *   - Cells: the first build and Run half — Build, Run-问数 (with the k/N
 *     spread when the run asked each turn more than once), Run-operations,
 *     the asks per kind when a run's turns carry one (`Run · kinds`) —
 *     and, when any run of the table iterated, the Iterate halves; then ask
 *     cost and ask time, the scorecard's per-mode rows (every persona turn of
 *     the mode, the iterate's included). Counts are summed; a cost or time is
 *     summed only when every run of the cell states one, else the cell says
 *     how many did not.
 *   - A field a record predates reads `not recorded`, never a zero or a crash.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { askSkillsText, type AskSkillsInfo } from './ask-skills.js';
import { doorArmText, type DoorArm } from './door.js';
import { schemaMaskingText } from './schema-masking.js';
import { packagesLine, type PackageSource } from './packages.js';
import { promptChoiceText, type PromptChoice } from './prompts.js';
import { askCostText, askTimeText, cardStampText, kindCell, MODEL_NOT_REPORTED, type AskSpend, type CardStamp, type HalfScores, type KindTally, type ModelSpend, type QuestionRepeats, type Tally } from './scorecard.js';

// ── The supplied template, as `run` records it ──────────────────────────────

/**
 * The verified build a run was given with `--template F`, as the runner writes
 * it at the record's top level (`template`) when a template or ask mode
 * installed it: the file's name (never its path, which is local) and the
 * sha256 of its bytes, so runs on one build can be told from runs on another.
 */
export interface SuppliedTemplate {
  file: string;
  sha256: string;
}

/** `ModeRun.template.source` of a mode that installed the `--template` file (`runCard`, `orchestrate.ts`). */
export const SUPPLIED_TEMPLATE_SOURCE = 'supplied template';

/** {@link SuppliedTemplate} of the template file at `path`, read as `run` reads it. */
export function suppliedTemplateOf(path: string, bytes: Buffer | string = readFileSync(path)): SuppliedTemplate {
  return { file: basename(path), sha256: createHash('sha256').update(bytes).digest('hex') };
}

// ── Reading the records ─────────────────────────────────────────────────────

/** One run record file, read. Every field the summary reads is optional here: a record from before it existed reads `not recorded`. */
export interface SummaryRecord {
  file: string;
  /** The card (`app`, else `scorecard.card`). */
  card: string;
  record: LooseRecord;
}

interface LooseModeScorecard {
  mode: 'scratch' | 'template' | 'ask' | 'door';
  skipped?: string;
  first?: HalfScores;
  iterate?: HalfScores;
  askSpend?: AskSpend;
}

interface LooseRecord {
  app?: string;
  env?: { packages?: PackageSource; driver?: { driver?: string; replayOf?: { driver?: string }; askSkills?: AskSkillsInfo; door?: DoorArm }; schemaMasking?: string };
  template?: SuppliedTemplate;
  /** The card file the run graded (`runRecord`); absent on a record written before the runner stamped it. */
  card?: CardStamp;
  scorecard: { card?: string; askRepeats?: number; promptChoice?: PromptChoice; modes: LooseModeScorecard[] };
  cardRun?: { modes?: Array<{ mode?: string; template?: { source?: string } }> };
}

export interface ReadSummaryResult {
  records: SummaryRecord[];
  /** JSON files met inside a directory that are not run records (recordings, other runs): not an error. */
  skipped: Array<{ file: string; reason: string }>;
  /** A file named on the command line that is not a readable run record, or a path that does not exist: the command fails. */
  errors: string[];
}

const MODES = ['scratch', 'template', 'ask', 'door'] as const;

/** Why `raw` is not a run record the summary can read, or `undefined` when it is one. */
function notARecord(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'not a JSON object';
  const r = raw as { runner?: unknown; scorecard?: unknown };
  if (r.runner !== 'scenario-runner') return 'not a scenario-runner record (no `runner: "scenario-runner"`)';
  const sc = r.scorecard as { modes?: unknown } | undefined;
  if (typeof sc !== 'object' || sc === null || !Array.isArray(sc.modes)) return 'a scenario-runner record without a `scorecard.modes` list';
  for (const m of sc.modes as unknown[]) {
    if (typeof m !== 'object' || m === null || !(MODES as readonly unknown[]).includes((m as { mode?: unknown }).mode)) return 'a scorecard mode that is not scratch, template, ask or door';
  }
  return undefined;
}

/** Every `*.json` under `dir`, at any depth, in name order. */
function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Read run records from files and directories. A directory is read at every
 * depth, and a JSON file in it that is not a run record (a recording, a
 * platform-checklist run) is skipped and listed; a file named directly that
 * is not one is an error. A file reached twice is read once.
 */
export function readSummaryRecords(paths: readonly string[]): ReadSummaryResult {
  const records: SummaryRecord[] = [];
  const skipped: ReadSummaryResult['skipped'] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const read = (file: string, named: boolean) => {
    const abs = resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      const reason = `not JSON (${e instanceof Error ? e.message : String(e)})`;
      if (named) errors.push(`${file}: ${reason}`);
      else skipped.push({ file, reason });
      return;
    }
    const why = notARecord(raw);
    if (why !== undefined) {
      if (named) errors.push(`${file}: not a run record: ${why}`);
      else skipped.push({ file, reason: why });
      return;
    }
    const record = raw as LooseRecord;
    records.push({ file, card: record.app ?? record.scorecard.card ?? '(card not recorded)', record });
  };
  for (const p of paths) {
    let isDir: boolean;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      errors.push(`${p}: no such file or directory`);
      continue;
    }
    if (isDir) for (const f of jsonFilesUnder(p)) read(f, false);
    else read(p, true);
  }
  return { records, skipped, errors };
}

// ── Grouping: tables, rows, columns ─────────────────────────────────────────

/** The dimensions a table does not show, which every run of one table must share. */
export const TABLE_DIMENSIONS = ['prompt choice', 'package source', 'ask repeats', 'driver', 'ask skills', 'door arm', 'card', 'schema masking'] as const;
export type TableDimension = (typeof TABLE_DIMENSIONS)[number];

/** One mode of one record: the unit a cell sums. */
interface ModeEntry {
  file: string;
  card: string;
  mode: LooseModeScorecard['mode'];
  sc: LooseModeScorecard;
  dims: Record<TableDimension, string>;
  row: Axis;
  col: Axis;
}

interface Axis {
  key: string;
  label: string;
}

const driverText = (r: LooseRecord): string => {
  const d = r.env?.driver;
  if (!d?.driver) return 'driver not recorded';
  return d.replayOf?.driver ? `${d.driver} (a replay of ${d.replayOf.driver})` : d.driver;
};

function dimensionsOf(r: LooseRecord): Record<TableDimension, string> {
  const repeats = r.scorecard.askRepeats ?? 1;
  return {
    'prompt choice': `prompts: ${promptChoiceText(r.scorecard.promptChoice ?? {})}`,
    'package source': r.env?.packages ? packagesLine(r.env.packages) : 'packages: not recorded',
    'ask repeats': repeats > 1 ? `each question turn asked ${repeats} times` : 'each question turn asked once',
    driver: `driver: ${driverText(r)}`,
    'ask skills': r.env?.driver?.askSkills ? `ask skills: ${askSkillsText(r.env.driver.askSkills)}` : NO_ASK_SKILLS,
    'door arm': r.env?.driver?.door ? `door arm: ${doorArmText(r.env.driver.door)}` : NO_DOOR_ARM,
    card: r.card ? cardStampText(r.card) : NO_CARD_STAMP,
    'schema masking': schemaMaskingText(r.env?.schemaMasking),
  };
}

/**
 * The `schema masking` value of a record whose apps were booted masked (no
 * `--schema-masking off`, and every record made before it): a table of such
 * runs prints its dimensions line as before.
 */
const MASKED = schemaMaskingText(undefined);

/**
 * The `card` value of a record written before the runner stamped the card
 * file's hash: such runs still sum with each other, and their table's
 * dimensions line prints as before; a stamped run never sums with one.
 */
const NO_CARD_STAMP = 'card: not recorded';

/**
 * The `ask skills` value of a record whose question and operation turns were
 * given no skills (`--ask-skills` absent, and every record made before it):
 * a table of such runs prints its dimensions line as before.
 */
const NO_ASK_SKILLS = 'ask skills: none';

/**
 * The `door arm` value of a record whose driver was given no door skill and no
 * door rule (every record made before door mode, and a door run in the bare
 * arm): a table of such runs prints its dimensions line without it. Two arms
 * never sum into one cell.
 */
const NO_DOOR_ARM = `door arm: ${doorArmText(undefined)}`;

/** `· effort high`; `· effort low / high`; nothing when none was asked for. */
const effortSuffix = (efforts: readonly string[]): string => (efforts.length ? ` · effort ${[...efforts].sort().join(' / ')}` : '');

/** The author axis of a build: its served model, keyed with the effort it asked for. */
function authorAxis(b: HalfScores['build'] | undefined): Axis {
  const a = b?.author;
  if (!a) return { key: 'author:not-recorded', label: 'author model not recorded' };
  const served = a.model ?? MODEL_NOT_REPORTED;
  const effort = a.requestedEffort ? [a.requestedEffort] : [];
  return { key: `author:${served}${effortSuffix(effort)}`, label: servedLabel(served === MODEL_NOT_REPORTED ? [] : [served], a.requestedModel ? [a.requestedModel] : [], a.modelMismatch ? 1 : 0) + effortSuffix(effort) };
}

/**
 * `claude-haiku-5-5 (asked for haiku)`; `claude-opus-5-5 ⚠ asked for sonnet`
 * when a turn was served another model; `model not reported (asked for haiku)`;
 * the served name alone when nothing was asked for or the names agree.
 */
function servedLabel(served: readonly string[], requested: readonly string[], mismatched: number): string {
  const name = served.length ? [...served].sort().join(' + ') : 'model not reported';
  const asked = [...new Set(requested)].sort().filter((r) => !(served.length === 1 && served[0] === r));
  if (!asked.length) return name;
  return mismatched ? `${name} ⚠ asked for ${asked.join(' / ')}` : `${name} (asked for ${asked.join(' / ')})`;
}

/** The ask axis of a mode: the models its persona turns were served, first Run and iterate Run, and the effort they asked for. */
function askAxis(sc: LooseModeScorecard): Axis {
  const tallies = [sc.first?.models, sc.iterate?.models].filter((t) => t !== undefined);
  if (tallies.length === 0) return { key: 'ask:not-recorded', label: 'ask model not recorded' };
  const served = [...new Set(tallies.flatMap((t) => Object.keys(t.served).filter((m) => m !== MODEL_NOT_REPORTED)))].sort();
  const requested = tallies.flatMap((t) => t.requested ?? []);
  const efforts = [...new Set(tallies.flatMap((t) => t.requestedEfforts ?? []))];
  const mismatched = tallies.reduce((n, t) => n + (t.mismatched ?? 0), 0);
  return { key: `ask:${served.join('+') || MODEL_NOT_REPORTED}${effortSuffix(efforts)}`, label: servedLabel(served, requested, mismatched) + effortSuffix(efforts) };
}

/** What a template or ask mode's first half ran on: the build it was supplied, never one it authored. */
function suppliedAxis(entry: SummaryRecord, mode: 'template' | 'ask', sc: LooseModeScorecard): Axis {
  const source = entry.record.cardRun?.modes?.find((m) => m.mode === mode)?.template?.source;
  let base: Axis;
  if (source !== undefined && source.startsWith('this run')) {
    const author = authorAxis(entry.record.scorecard.modes.find((m) => m.mode === 'scratch')?.first?.build);
    base = { key: `scratch-build:${author.key}`, label: `this run’s from-scratch build, by ${author.label}` };
  } else if (source === SUPPLIED_TEMPLATE_SOURCE && entry.record.template?.sha256) {
    const t = entry.record.template;
    base = { key: `template:${t.sha256}`, label: `supplied template \`${t.file}\` (sha256 ${t.sha256.slice(0, 12)})` };
  } else {
    // Nothing says this run's build is any other run's: a row of its own.
    const what = source === undefined ? 'supplied build not recorded' : `${source}, file not recorded`;
    base = { key: `record:${resolve(entry.file)}`, label: `${what} (record \`${basename(entry.file)}\`)` };
  }
  if (mode === 'ask') return base;
  // Template mode authors its iterate on the supplied build: the row names that author too.
  const it = authorAxis(sc.iterate?.build);
  return { key: `${base.key} · iterate ${it.key}`, label: `${base.label} · iterate by ${it.label}` };
}

function entriesOf(r: SummaryRecord): ModeEntry[] {
  const dims = dimensionsOf(r.record);
  return r.record.scorecard.modes.map((sc) => ({
    file: r.file,
    card: r.card,
    mode: sc.mode,
    sc,
    dims,
    row: sc.mode === 'scratch' || sc.mode === 'door' ? authorAxis(sc.first?.build) : suppliedAxis(r, sc.mode, sc),
    col: askAxis(sc),
  }));
}

// ── Summing a cell ──────────────────────────────────────────────────────────

type CountTally = Tally & { notMeasured?: number; platformNotMeasured?: number; leaks?: number };

/** Sum the tallies the runs state; `missing` counts the runs that state none. */
function sumTallies(tallies: ReadonlyArray<CountTally | undefined>): { sum?: Required<CountTally>; missing: number } {
  const present = tallies.filter((t): t is CountTally => t !== undefined);
  if (!present.length) return { missing: tallies.length };
  const add = (k: keyof CountTally) => present.reduce((n, t) => n + (t[k] ?? 0), 0);
  return { sum: { passed: add('passed'), total: add('total'), notMeasured: add('notMeasured'), platformNotMeasured: add('platformNotMeasured'), leaks: add('leaks') }, missing: tallies.length - present.length };
}

/** `of 2 runs, 1 had none`: a count over fewer runs than the cell holds says so. */
const missingText = (missing: number, runs: number): string => (missing ? ` (${missing} of ${runs} runs had none)` : '');

function countCell(tallies: ReadonlyArray<CountTally | undefined>): string {
  const { sum, missing } = sumTallies(tallies);
  if (!sum) return '—';
  return (
    `${sum.passed}/${sum.total}` +
    (sum.notMeasured ? ` · ${sum.notMeasured} not measured` : '') +
    (sum.platformNotMeasured ? ` · ${sum.platformNotMeasured} platform half not measured` : '') +
    (sum.leaks ? ` ⚠ ${sum.leaks} leaking` : '') +
    missingText(missing, tallies.length)
  );
}

/** The runs' asks kind by kind, summed ({@link kindCell}); a run that states no kinds is counted apart, never as 0 asked. */
function kindsCell(kinds: ReadonlyArray<KindTally | undefined>): string {
  const present = kinds.filter((k): k is KindTally => k !== undefined);
  if (!present.length) return '—';
  const sum: KindTally = { byKind: {} };
  for (const k of present) {
    for (const [kind, t] of Object.entries(k.byKind) as Array<[keyof KindTally['byKind'], NonNullable<KindTally['byKind'][keyof KindTally['byKind']]>]>) {
      const s = (sum.byKind[kind] ??= { passed: 0, total: 0, notMeasured: 0 });
      s.passed += t.passed;
      s.total += t.total;
      s.notMeasured += t.notMeasured;
    }
    if (k.unkinded) sum.unkinded = (sum.unkinded ?? 0) + k.unkinded;
  }
  return kindCell(sum) + missingText(kinds.length - present.length, kinds.length);
}

function buildCell(builds: ReadonlyArray<HalfScores['build'] | undefined>): string {
  // A build whose authoring turn did not finish is not measured: counted apart, never as 0 of N.
  const notMeasured = builds.filter((b) => b?.notMeasuredReason !== undefined).length;
  const measured = builds.filter((b): b is NonNullable<typeof b> => b !== undefined && b.notMeasuredReason === undefined);
  const absent = builds.filter((b) => b === undefined).length;
  if (!measured.length && !notMeasured) return '—';
  const parts = [measured.length ? countCell(measured) : undefined, notMeasured ? `${notMeasured} not measured` : undefined];
  return parts.filter(Boolean).join(' · ') + missingText(absent, builds.length);
}

/** `3/3 ×7 · 2/3 ×1`: how many question turns passed k of their N asks, over every run of the cell; `—` when none asked more than once. */
function repeatSpreadCell(spreads: ReadonlyArray<readonly QuestionRepeats[] | undefined>): string {
  const counts = new Map<string, { passed: number; total: number; n: number }>();
  for (const s of spreads) for (const t of s ?? []) {
    const k = `${t.passed}/${t.total}`;
    counts.set(k, { passed: t.passed, total: t.total, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  if (!counts.size) return '—';
  return [...counts.values()]
    .sort((a, b) => b.total - a.total || b.passed - a.passed)
    .map((c) => `${c.passed}/${c.total} ×${c.n}`)
    .join(' · ');
}

const sumUsd = (xs: readonly number[]): number => Math.round(xs.reduce((a, x) => a + x, 0) * 1e6) / 1e6;

/** Several runs' {@link AskSpend}, summed per served model: a figure stays only when every run's figure for that model was stated. */
export function mergeAskSpend(spends: readonly AskSpend[]): AskSpend {
  const byModel = new Map<string, ModelSpend[]>();
  for (const s of spends) for (const [model, m] of Object.entries(s)) byModel.set(model, [...(byModel.get(model) ?? []), m]);
  return Object.fromEntries(
    [...byModel].map(([model, ms]) => {
      const usd = ms.map((m) => m.cost.usd);
      const time = ms.map((m) => m.time.ms);
      return [
        model,
        {
          cost: { turns: ms.reduce((n, m) => n + m.cost.turns, 0), reported: ms.reduce((n, m) => n + m.cost.reported, 0), ...(usd.every((u) => u !== undefined) ? { usd: sumUsd(usd as number[]) } : {}) },
          time: { turns: ms.reduce((n, m) => n + m.time.turns, 0), timed: ms.reduce((n, m) => n + m.time.timed, 0), ...(time.every((t) => t !== undefined) ? { ms: (time as number[]).reduce((a, x) => a + x, 0) } : {}) },
        },
      ];
    }),
  );
}

function spendCell(entries: readonly ModeEntry[], text: (s: AskSpend | undefined) => string): string {
  const spends = entries.map((e) => e.sc.askSpend);
  const missing = spends.filter((s) => s === undefined).length;
  // A run that predates the figure is never read as zero: no sum over the rest.
  if (missing === spends.length) return text(undefined);
  if (missing) return `not recorded on ${missing} of ${spends.length} runs`;
  return text(mergeAskSpend(spends as AskSpend[]));
}

// ── The tables ──────────────────────────────────────────────────────────────

export interface SummaryTable {
  card: string;
  mode: ModeEntry['mode'];
  /** The shared value of each {@link TABLE_DIMENSIONS}; absent on a refused table. */
  dims?: Record<TableDimension, string>;
  /** Why the table is not shown: one line per dimension its runs differ in. Absent ⇒ shown. */
  refused?: string[];
  rows: Axis[];
  cols: Axis[];
  entries: ModeEntry[];
  /** Runs of the mode that were skipped (`skipped` on the scorecard): not in any cell. */
  skipped: Array<{ file: string; reason: string }>;
}

export interface SummaryOptions {
  /** Only these cards (`--card`). */
  cards?: readonly string[];
  /** Only these modes (`--mode`). */
  modes?: ReadonlyArray<ModeEntry['mode']>;
}

const byLabel = (a: Axis, b: Axis) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

/** Group the records' modes into one table per card and mode, refusing a table whose runs differ in a dimension it does not show. */
export function summaryTables(records: readonly SummaryRecord[], opts: SummaryOptions = {}): SummaryTable[] {
  const groups = new Map<string, ModeEntry[]>();
  for (const r of records) {
    if (opts.cards && !opts.cards.includes(r.card)) continue;
    for (const e of entriesOf(r)) {
      if (opts.modes && !opts.modes.includes(e.mode)) continue;
      const key = JSON.stringify([e.card, MODES.indexOf(e.mode)]);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
  }
  return [...groups.keys()].sort().map((key) => {
    const all = groups.get(key)!;
    const skipped = all.filter((e) => e.sc.skipped !== undefined).map((e) => ({ file: e.file, reason: e.sc.skipped! }));
    const entries = all.filter((e) => e.sc.skipped === undefined);
    const { card, mode } = all[0]!;
    const refused = TABLE_DIMENSIONS.flatMap((d) => {
      const values = new Map<string, string[]>();
      for (const e of entries) values.set(e.dims[d], [...(values.get(e.dims[d]) ?? []), e.file]);
      if (values.size < 2) return [];
      return [`the runs differ in ${d}: ${[...values].map(([v, files]) => `\`${v}\` (${files.map((f) => `\`${f}\``).join(', ')})`).join(' vs ')}`];
    });
    const uniq = (axes: Axis[]) => [...new Map(axes.map((a) => [a.key, a])).values()].sort(byLabel);
    const table: SummaryTable = { card, mode, rows: uniq(entries.map((e) => e.row)), cols: uniq(entries.map((e) => e.col)), entries, skipped };
    if (refused.length) table.refused = refused;
    else if (entries.length) table.dims = entries[0]!.dims;
    return table;
  });
}

const esc = (s: string): string => s.replace(/\|/g, '\\|');

/** The halves a table's cells show, in the scorecard's order; the Iterate rows only when a run of the table iterated. */
function halfRows(t: SummaryTable): Array<[string, (es: readonly ModeEntry[]) => string]> {
  const supplied = t.mode === 'template' || t.mode === 'ask';
  const rows: Array<[string, (es: readonly ModeEntry[]) => string]> = [
    ['Runs', (es) => String(es.length)],
    ['Build', (es) => (supplied ? 'supplied' : buildCell(es.map((e) => e.sc.first?.build)))],
    ['Run-问数', (es) => countCell(es.map((e) => e.sc.first?.ask))],
  ];
  if (t.entries.some((e) => e.sc.first?.repeats)) rows.push(['Run-问数 · k/N per turn', (es) => repeatSpreadCell(es.map((e) => e.sc.first?.repeats))]);
  rows.push(['Run-operations', (es) => countCell(es.map((e) => e.sc.first?.operations))]);
  if (t.entries.some((e) => e.sc.first?.kinds)) rows.push(['Run · kinds', (es) => kindsCell(es.map((e) => e.sc.first?.kinds))]);
  if (t.entries.some((e) => e.sc.iterate !== undefined)) {
    rows.push(
      ['Iterate · Build', (es) => buildCell(es.map((e) => e.sc.iterate?.build))],
      ['Iterate · Run-问数', (es) => countCell(es.map((e) => e.sc.iterate?.ask))],
      ['Iterate · Run-operations', (es) => countCell(es.map((e) => e.sc.iterate?.operations))],
    );
    if (t.entries.some((e) => e.sc.iterate?.kinds)) rows.push(['Iterate · Run · kinds', (es) => kindsCell(es.map((e) => e.sc.iterate?.kinds))]);
  }
  rows.push(['Ask cost', (es) => spendCell(es, askCostText)], ['Ask time', (es) => spendCell(es, askTimeText)]);
  return rows;
}

/** One table as markdown: its heading, its shared dimensions, and the author × ask matrix — or the refusal. */
export function renderSummaryTable(t: SummaryTable): string {
  const lines = [`## \`${t.card}\` · ${t.mode}`, ''];
  if (t.refused) {
    lines.push(`Refused: these runs are not summed, since a cell would mix them. Summarize each side apart.`, '', ...t.refused.map((r) => `- ${r}`));
  } else if (!t.entries.length) {
    lines.push('No run of this mode ran: every one was skipped.');
  } else {
    const dims = t.dims!;
    lines.push(`${TABLE_DIMENSIONS.filter((d) => !(d === 'ask skills' && dims[d] === NO_ASK_SKILLS) && !(d === 'door arm' && dims[d] === NO_DOOR_ARM) && !(d === 'card' && dims[d] === NO_CARD_STAMP) && !(d === 'schema masking' && dims[d] === MASKED)).map((d) => dims[d]).join(' · ')}`, '');
    lines.push(`| ${t.mode === 'scratch' || t.mode === 'door' ? 'Author model' : 'Supplied build'} | Half | ${t.cols.map((c) => esc(c.label)).join(' | ')} |`);
    lines.push(`|:---|:---|${t.cols.map(() => ':---').join('|')}|`);
    const halves = halfRows(t);
    for (const row of t.rows) {
      halves.forEach(([half, cellOf], i) => {
        const cells = t.cols.map((c) => {
          const es = t.entries.filter((e) => e.row.key === row.key && e.col.key === c.key);
          return es.length ? cellOf(es) : '—';
        });
        lines.push(`| ${i === 0 ? esc(row.label) : ''} | ${half} | ${cells.map(esc).join(' | ')} |`);
      });
    }
  }
  for (const s of t.skipped) lines.push('', `- skipped run \`${s.file}\`: ${s.reason}`);
  return lines.join('\n');
}

/** The whole summary as markdown: a heading, how many runs it read, what a cell counts, and every table. */
export function renderSummary(tables: readonly SummaryTable[], read: Pick<ReadSummaryResult, 'records' | 'skipped'>): string {
  const runs = tables.reduce((n, t) => n + t.entries.length, 0);
  return [
    '# Scenario run summary',
    '',
    `${read.records.length} run record${read.records.length === 1 ? '' : 's'} read, ${runs} run${runs === 1 ? '' : 's'} of a mode in ${tables.length} table${tables.length === 1 ? '' : 's'}` +
      (read.skipped.length ? `; ${read.skipped.length} other JSON file${read.skipped.length === 1 ? '' : 's'} skipped` : '') +
      '.',
    '',
    'Rows: the model the build’s authoring turn was served (a template or ask mode: the build it was supplied). Columns: the models the question and operation turns were served. ' +
      'A name in parentheses is the one the run asked for. One table per card and mode; its runs share the line under its heading. ' +
      'A cell sums the runs of its row and column: the first build and Run half (Iterate rows as the scorecard counts them), then ask cost and time over every persona turn of the mode. ' +
      '`not recorded`: the record predates the field.',
    ...tables.flatMap((t) => ['', renderSummaryTable(t)]),
  ].join('\n');
}

// ── The command ─────────────────────────────────────────────────────────────

export const SUMMARY_USAGE = `Usage: objectstack-scenarios summary [--card ID[,ID]] [--mode M[,M]] <record.json|dir>…

Reads run records (a directory at every depth) and prints one markdown table
per card and mode: rows the author model, columns the ask model, each cell the
runs that share both. Reads files only: no model, no network.

  --card ID[,ID]   only these cards
  --mode M[,M]     only these modes (scratch, template, ask)

Exit 0 when every table printed; 1 when a table was refused (its runs differ
in prompt choice, package source, ask repeats or driver), a named file is not
a run record, or nothing was read; 2 on a usage error.`;

export interface SummaryArgs {
  paths: string[];
  cards?: string[];
  modes?: Array<ModeEntry['mode']>;
}

export function parseSummaryArgs(argv: readonly string[]): SummaryArgs {
  const a: SummaryArgs = { paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v === '') throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--card') a.cards = val().split(',');
    else if (flag === '--mode') {
      const modes = val().split(',');
      for (const m of modes) if (!(MODES as readonly string[]).includes(m)) throw new Error(`unknown mode \`${m}\` (${MODES.join(', ')})`);
      a.modes = modes as SummaryArgs['modes'];
    } else if (flag.startsWith('-')) throw new Error(`unknown flag \`${flag}\``);
    else a.paths.push(flag);
  }
  if (!a.paths.length) throw new Error('name at least one run record or directory of them');
  return a;
}

export interface SummaryIo {
  out: (text: string) => void;
  err: (line: string) => void;
}

const consoleIo: SummaryIo = { out: (t) => console.log(t), err: (l) => console.error(l) };

/** `summary [flags] <record|dir>…`; answers the process exit code. */
export function summaryMain(argv: readonly string[], io: SummaryIo = consoleIo): number {
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    io.out(SUMMARY_USAGE);
    return 0;
  }
  let args: SummaryArgs;
  try {
    args = parseSummaryArgs(argv);
  } catch (e) {
    io.err(`summary: ${e instanceof Error ? e.message : String(e)}`);
    io.err(SUMMARY_USAGE);
    return 2;
  }
  const read = readSummaryRecords(args.paths);
  for (const s of read.skipped) io.err(`skipped ${s.file}: ${s.reason}`);
  for (const e of read.errors) io.err(e);
  const tables = summaryTables(read.records, { ...(args.cards ? { cards: args.cards } : {}), ...(args.modes ? { modes: args.modes } : {}) });
  if (!tables.length) {
    io.err(read.records.length ? 'no run matches the --card / --mode filter' : 'no run record read');
    return 1;
  }
  io.out(renderSummary(tables, read));
  return read.errors.length || tables.some((t) => t.refused) ? 1 : 0;
}
