// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `summary` (`src/runner/summary.ts`): many run records read back as one
 * author-model × ask-model table per card and mode. Fixture records in the
 * shape `runRecord` writes, written to a temp directory and read as files —
 * no model, no network — plus one record the runner itself wrote
 * (`runCrm`, the gallery exporter's fixture run of the real crm card).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/bin.js';
import { main, withSuppliedTemplate } from '../../src/runner/cli.js';
import type { CardRun } from '../../src/runner/orchestrate.js';
import { readSummaryRecords, renderSummary, SUMMARY_USAGE, summaryMain, summaryTables, suppliedTemplateOf, type SummaryTable } from '../../src/runner/summary.js';
import { runCrm } from '../export/fixture.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'scenario-summary-'));

interface ModeOpts {
  mode?: 'scratch' | 'template' | 'ask';
  /** The served author model; `null`: the record predates `Build · author`. */
  author?: string | null;
  authorAsked?: string;
  authorEffort?: string;
  /** The served ask model; `null`: the record predates `Run · model`. */
  ask?: string | null;
  askAsked?: string;
  askEffort?: string;
  build?: [number, number];
  buildNotMeasured?: string;
  qa?: [number, number];
  leaks?: number;
  ops?: [number, number];
  turns?: number;
  /** USD over the ask turns; `null`: no turn reported one. */
  usd?: number | null;
  ms?: number;
  /** Leave `askSpend` out: a record from before #33740 carried it. */
  noSpend?: boolean;
  repeats?: Array<[number, number]>;
  iterate?: { build: [number, number]; qa: [number, number]; ops: [number, number] };
  skipped?: string;
}

function modeScorecard(o: ModeOpts = {}) {
  const mode = o.mode ?? 'scratch';
  const ask = o.ask === undefined ? 'claude-haiku-5-5' : o.ask;
  const turns = o.turns ?? 14;
  const half = (qa: [number, number], ops: [number, number]) => ({
    seed: { inserted: 8, total: 8, refused: 0 },
    ask: { passed: qa[0], total: qa[1], leaks: o.leaks ?? 0, notMeasured: 0 },
    operations: { passed: ops[0], total: ops[1], notMeasured: 0 },
    ...(ask !== null
      ? { models: { served: { [ask]: turns }, requested: o.askAsked ? [o.askAsked] : [], mismatched: 0, requestedEfforts: o.askEffort ? [o.askEffort] : [] } }
      : {}),
  });
  const author = o.author === undefined ? 'claude-opus-5-5' : o.author;
  const build = (b: [number, number]) => ({
    passed: o.buildNotMeasured ? 0 : b[0],
    total: o.buildNotMeasured ? 0 : b[1],
    degraded: false,
    failedCommands: [],
    ...(o.buildNotMeasured ? { notMeasuredReason: o.buildNotMeasured } : {}),
    ...(author !== null ? { author: { resultSubtype: 'success', model: author, ...(o.authorAsked ? { requestedModel: o.authorAsked } : {}), ...(o.authorEffort ? { requestedEffort: o.authorEffort } : {}) } } : {}),
  });
  const first = { ...(mode === 'scratch' ? { build: build(o.build ?? [22, 22]) } : {}), ...half(o.qa ?? [8, 9], o.ops ?? [3, 5]), ...(o.repeats ? { repeats: o.repeats.map(([p, t], i) => ({ question: `q${i}`, persona: null, passed: p, total: t, notMeasured: 0, leaks: 0 })) } : {}) };
  const usd = o.usd === undefined ? 0.31 : o.usd;
  return {
    mode,
    ...(o.skipped ? { skipped: o.skipped } : {}),
    first,
    ...(o.iterate ? { iterate: { build: build(o.iterate.build), ...half(o.iterate.qa, o.iterate.ops) } } : {}),
    ...(o.noSpend || ask === null
      ? {}
      : { askSpend: { [ask]: { cost: { turns, reported: usd === null ? 0 : turns, ...(usd !== null ? { usd } : {}) }, time: { turns, timed: turns, ms: o.ms ?? 60_000 } } } }),
    tags: [],
    findings: [],
  };
}

interface RecordOpts {
  card?: string;
  modes?: ModeOpts[];
  promptChoice?: { lang?: 'zh' | 'en'; prompt?: 'short' | 'detailed' };
  packages?: unknown;
  askRepeats?: number;
  driver?: string;
  template?: { file: string; sha256: string };
  /** `ModeRun.template.source` of each template or ask mode. */
  source?: string;
  /** The card file's sha256 the record stamps (`card`); absent: a record from before the stamp. */
  cardSha256?: string;
}

function record(o: RecordOpts = {}) {
  const card = o.card ?? 'crm_account_with_contacts';
  const modes = (o.modes ?? [{}]).map(modeScorecard);
  return {
    run: `2026-11-16-scenario-${card}`,
    date: '2026-11-16',
    scope: `scenario card ${card}`,
    app: card,
    env: {
      framework: 'abc1234',
      ...(o.packages !== null ? { packages: o.packages ?? { source: 'published', versions: ['18.5.0'] } } : {}),
      driver: { driver: o.driver ?? 'claude-code-cli', apiBilled: false },
    },
    runner: 'scenario-runner',
    evidenceDir: '/tmp/x',
    results: [],
    scorecard: {
      card,
      counts: { questions: 8, questionTurns: 9, operations: 5, personas: 2 },
      ...(o.askRepeats ? { askRepeats: o.askRepeats } : {}),
      ...(o.promptChoice ? { promptChoice: o.promptChoice } : {}),
      modes,
    },
    cardRun: {
      card,
      modes: modes.map((m) => ({ mode: m.mode, findings: [], ...(m.mode !== 'scratch' ? { template: { source: o.source ?? 'supplied template', install: { ok: true, status: 200 }, installModesSupplied: true } } : {}) })),
    },
    ...(o.template ? { template: o.template } : {}),
    ...(o.cardSha256 ? { card: { id: card, sha256: o.cardSha256 } } : {}),
  };
}

function writeAll(dir: string, records: Record<string, unknown>): string[] {
  return Object.entries(records).map(([name, r]) => {
    const file = join(dir, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, typeof r === 'string' ? r : JSON.stringify(r, null, 2));
    return file;
  });
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (l: string) => err.push(l) } };
}

/** The cell of `half` in the column `col` under the row `row` of a rendered table. */
function cellOf(md: string, row: string, half: string, col: string): string {
  const lines = md.split('\n');
  const header = lines.find((l) => l.startsWith('| Author model |') || l.startsWith('| Supplied build |'))!;
  const cols = header.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
  const start = lines.findIndex((l) => l.startsWith(`| ${row} | Runs |`));
  if (start < 0) throw new Error(`no row ${row} in\n${md}`);
  for (let i = start; i < lines.length && (i === start || lines[i]!.startsWith('|  |')); i++) {
    const cells = lines[i]!.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
    if (cells[1] === half) return cells[cols.indexOf(col)]!;
  }
  throw new Error(`no half ${half} under ${row}`);
}

const render = (tables: SummaryTable[]) => renderSummary(tables, { records: [], skipped: [] });

describe('summary — the author × ask matrix', () => {
  it('a 2×2 matrix: rows the served author model, columns the served ask model, and a cell sums the runs it holds', () => {
    const dir = tmp();
    writeAll(dir, {
      'opus-haiku.json': record({ modes: [{ author: 'claude-opus-5-5', authorAsked: 'opus', ask: 'claude-haiku-5-5', askAsked: 'haiku', build: [22, 22], qa: [8, 9], leaks: 1, ops: [3, 5], usd: 0.31, ms: 60_000 }] }),
      'opus-haiku-rep2.json': record({ modes: [{ author: 'claude-opus-5-5', authorAsked: 'opus', ask: 'claude-haiku-5-5', askAsked: 'haiku', build: [20, 22], qa: [9, 9], ops: [4, 5], usd: 0.29, ms: 90_000 }] }),
      'opus-sonnet.json': record({ modes: [{ author: 'claude-opus-5-5', authorAsked: 'opus', ask: 'claude-sonnet-5-5', askAsked: 'sonnet', qa: [9, 9], ops: [5, 5], usd: 0.8 }] }),
      'haiku-haiku.json': record({ modes: [{ author: 'claude-haiku-5-5', authorAsked: 'haiku', ask: 'claude-haiku-5-5', askAsked: 'haiku', build: [21, 22], qa: [7, 9], ops: [2, 5] }] }),
      'haiku-sonnet.json': record({ modes: [{ author: 'claude-haiku-5-5', authorAsked: 'haiku', ask: 'claude-sonnet-5-5', askAsked: 'sonnet', qa: [8, 9], ops: [3, 5] }] }),
    });
    const c = capture();
    expect(summaryMain([dir], c.io)).toBe(0);
    const md = c.out.join('\n');
    const tables = summaryTables(readSummaryRecords([dir]).records);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows.map((r) => r.label)).toEqual(['claude-haiku-5-5 (asked for haiku)', 'claude-opus-5-5 (asked for opus)']);
    expect(tables[0]!.cols.map((r) => r.label)).toEqual(['claude-haiku-5-5 (asked for haiku)', 'claude-sonnet-5-5 (asked for sonnet)']);
    expect(md).toContain('## `crm_account_with_contacts` · scratch');
    expect(md).toContain('prompts: language default (en, else zh) · build prompt detailed · packages: published 18.5.0 · each question turn asked once · driver: claude-code-cli');

    const opus = 'claude-opus-5-5 (asked for opus)';
    const haiku = 'claude-haiku-5-5 (asked for haiku)';
    const sonnet = 'claude-sonnet-5-5 (asked for sonnet)';
    // Two runs in one cell: counts summed, the cost and time summed because both runs stated them.
    expect(cellOf(md, opus, 'Runs', haiku)).toBe('2');
    expect(cellOf(md, opus, 'Build', haiku)).toBe('42/44');
    expect(cellOf(md, opus, 'Run-问数', haiku)).toBe('17/18 ⚠ 1 leaking');
    expect(cellOf(md, opus, 'Run-operations', haiku)).toBe('7/10');
    expect(cellOf(md, opus, 'Ask cost', haiku)).toBe('claude-haiku-5-5: $0.60 over 28 ask turns');
    expect(cellOf(md, opus, 'Ask time', haiku)).toBe('claude-haiku-5-5: 2m 30s over 28 ask turns');
    expect(cellOf(md, opus, 'Run-问数', sonnet)).toBe('9/9');
    expect(cellOf(md, opus, 'Run-operations', sonnet)).toBe('5/5');
    expect(cellOf(md, haiku, 'Build', haiku)).toBe('21/22');
    expect(cellOf(md, haiku, 'Run-问数', sonnet)).toBe('8/9');
    // No run iterated: no Iterate rows.
    expect(md).not.toContain('Iterate ·');
  });

  it('the effort a turn asked for joins the served model in the label, so two efforts are two rows or columns', () => {
    const tables = summaryTables(
      readSummaryRecords(
        writeAll(tmp(), {
          'low.json': record({ modes: [{ authorEffort: 'low', askEffort: 'medium' }] }),
          'high.json': record({ modes: [{ authorEffort: 'high', askEffort: 'medium' }] }),
        }),
      ).records,
    );
    expect(tables[0]!.rows.map((r) => r.label)).toEqual(['claude-opus-5-5 · effort high', 'claude-opus-5-5 · effort low']);
    expect(tables[0]!.cols.map((r) => r.label)).toEqual(['claude-haiku-5-5 · effort medium']);
  });

  it('a turn served another model than it asked for is marked, never relabelled', () => {
    const md = render(summaryTables(readSummaryRecords(writeAll(tmp(), { 'a.json': record() })).records));
    expect(md).toContain('| claude-opus-5-5 | Runs | 1 |');
    const mismatch = record();
    (mismatch.scorecard.modes[0]!.first as { models: { requested: string[]; mismatched: number } }).models.requested = ['sonnet'];
    (mismatch.scorecard.modes[0]!.first as { models: { requested: string[]; mismatched: number } }).models.mismatched = 14;
    const tables = summaryTables(readSummaryRecords(writeAll(tmp(), { 'm.json': mismatch })).records);
    expect(tables[0]!.cols.map((c) => c.label)).toEqual(['claude-haiku-5-5 ⚠ asked for sonnet']);
  });

  it('Iterate rows appear when a run iterated; a run without one says so in the cell, never a zero', () => {
    const md = render(
      summaryTables(
        readSummaryRecords(
          writeAll(tmp(), {
            'a.json': record({ modes: [{ iterate: { build: [28, 28], qa: [8, 9], ops: [3, 5] } }] }),
            'b.json': record({ modes: [{}] }),
          }),
        ).records,
      ),
    );
    expect(cellOf(md, 'claude-opus-5-5', 'Iterate · Build', 'claude-haiku-5-5')).toBe('28/28 (1 of 2 runs had none)');
    expect(cellOf(md, 'claude-opus-5-5', 'Iterate · Run-问数', 'claude-haiku-5-5')).toBe('8/9 (1 of 2 runs had none)');
  });

  it('a build that was not measured is counted apart, never as 0 of N', () => {
    const md = render(
      summaryTables(
        readSummaryRecords(writeAll(tmp(), { 'a.json': record({ modes: [{ build: [20, 22] }] }), 'b.json': record({ modes: [{ buildNotMeasured: 'author timed out after 60 min' }] }) })).records,
      ),
    );
    expect(cellOf(md, 'claude-opus-5-5', 'Build', 'claude-haiku-5-5')).toBe('20/22 · 1 not measured');
  });

  it('with --ask-repeats, the k/N spread of the question turns over every run of the cell', () => {
    const md = render(
      summaryTables(
        readSummaryRecords(
          writeAll(tmp(), {
            'a.json': record({ askRepeats: 3, modes: [{ qa: [23, 27], repeats: [[3, 3], [3, 3], [2, 3], [0, 3]] }] }),
            'b.json': record({ askRepeats: 3, modes: [{ qa: [26, 27], repeats: [[3, 3], [2, 3]] }] }),
          }),
        ).records,
      ),
    );
    expect(md).toContain('each question turn asked 3 times');
    expect(cellOf(md, 'claude-opus-5-5', 'Run-问数', 'claude-haiku-5-5')).toBe('49/54');
    expect(cellOf(md, 'claude-opus-5-5', 'Run-问数 · k/N per turn', 'claude-haiku-5-5')).toBe('3/3 ×3 · 2/3 ×2 · 0/3 ×1');
  });

  it('a cost is summed only when every run of the cell stated one', () => {
    const md = render(
      summaryTables(readSummaryRecords(writeAll(tmp(), { 'a.json': record({ modes: [{ usd: 0.31 }] }), 'b.json': record({ modes: [{ usd: null }] }) })).records),
    );
    expect(cellOf(md, 'claude-opus-5-5', 'Ask cost', 'claude-haiku-5-5')).toBe('claude-haiku-5-5: not reported (14 of 28 ask turns reported a cost)');
  });
});

describe('summary — ⛔ never summed silently: runs a table does not tell apart are refused', () => {
  it('mixed prompt choices in one card and mode refuse that table, naming the difference and the files on each side; the other tables print', () => {
    const dir = tmp();
    const [en, zh] = writeAll(dir, {
      'en.json': record(),
      'zh.json': record({ promptChoice: { lang: 'zh', prompt: 'short' } }),
      'other-card.json': record({ card: 'invoice_with_line_items' }),
    });
    const c = capture();
    expect(summaryMain([dir], c.io)).toBe(1);
    const md = c.out.join('\n');
    expect(md).toContain('## `crm_account_with_contacts` · scratch\n\nRefused:');
    expect(md).toContain(
      `- the runs differ in prompt choice: \`prompts: language default (en, else zh) · build prompt detailed\` (\`${en}\`) vs \`prompts: language zh · build prompt short\` (\`${zh}\`)`,
    );
    // The refused table shows no cell.
    expect(md.split('## `invoice_with_line_items`')[0]).not.toContain('| Runs |');
    expect(md).toContain('## `invoice_with_line_items` · scratch\n\nprompts:');
  });

  it('`--prompt detailed` is the default prompt, so it sums with a run that gave no flag', () => {
    const tables = summaryTables(readSummaryRecords(writeAll(tmp(), { 'a.json': record(), 'b.json': record({ promptChoice: { prompt: 'detailed' } }) })).records);
    expect(tables[0]!.refused).toBeUndefined();
    expect(tables[0]!.entries).toHaveLength(2);
  });

  it('package source, ask repeats and driver refuse a table as prompt choice does, one line each', () => {
    const tables = summaryTables(
      readSummaryRecords(
        writeAll(tmp(), {
          'a.json': record(),
          'b.json': record({ packages: { source: 'workspace', commit: 'abc1234', uncommitted: false }, askRepeats: 3, driver: 'recorded' }),
        }),
      ).records,
    );
    expect(tables[0]!.refused!.map((r) => r.slice(0, r.indexOf(':')))).toEqual(['the runs differ in package source', 'the runs differ in ask repeats', 'the runs differ in driver']);
  });

  it('cards and modes are kept apart as tables of their own, never refused', () => {
    const tables = summaryTables(
      readSummaryRecords(
        writeAll(tmp(), {
          'a.json': record({ modes: [{}, { mode: 'ask' }] }),
          'b.json': record({ card: 'invoice_with_line_items' }),
        }),
      ).records,
    );
    expect(tables.map((t) => `${t.card} · ${t.mode} · ${t.refused ? 'refused' : 'shown'}`)).toEqual([
      'crm_account_with_contacts · scratch · shown',
      'crm_account_with_contacts · ask · shown',
      'invoice_with_line_items · scratch · shown',
    ]);
  });
});

describe('summary — the card file a run graded (`card`, its sha256) is a dimension: a changed card is never summed with the old one', () => {
  const before = createHash('sha256').update('card before').digest('hex');
  const after = createHash('sha256').update('card after').digest('hex');

  it('two hashes refuse the table, naming each hash and the records that hold it', () => {
    const dir = tmp();
    const [a1, a2, b] = writeAll(dir, {
      'a1.json': record({ cardSha256: before }),
      'a2.json': record({ cardSha256: before }),
      'b.json': record({ cardSha256: after }),
    });
    const c = capture();
    expect(summaryMain([dir], c.io)).toBe(1);
    const md = c.out.join('\n');
    expect(md).toContain('## `crm_account_with_contacts` · scratch\n\nRefused:');
    expect(md).toContain(
      `- the runs differ in card: \`card: crm_account_with_contacts (sha256 ${before.slice(0, 12)})\` (\`${a1}\`, \`${a2}\`) vs \`card: crm_account_with_contacts (sha256 ${after.slice(0, 12)})\` (\`${b}\`)`,
    );
  });

  it('a stamped record and one from before the stamp are refused too: nothing says they graded one card', () => {
    const tables = summaryTables(readSummaryRecords(writeAll(tmp(), { 'old.json': record(), 'new.json': record({ cardSha256: after }) })).records);
    expect(tables[0]!.refused).toEqual([
      expect.stringMatching(new RegExp(`^the runs differ in card: \`card: not recorded\` \\(\`.*old\\.json\`\\) vs \`card: crm_account_with_contacts \\(sha256 ${after.slice(0, 12)}\\)\` \\(\`.*new\\.json\`\\)$`)),
    ]);
  });

  it('one hash sums, and the dimensions line names it; unstamped records keep their line as before', () => {
    const dir = tmp();
    writeAll(dir, { 'a.json': record({ cardSha256: before }), 'b.json': record({ cardSha256: before }) });
    const c = capture();
    expect(summaryMain([dir], c.io)).toBe(0);
    expect(c.out.join('\n')).toContain(` · card: crm_account_with_contacts (sha256 ${before.slice(0, 12)})\n`);
    const old = capture();
    const dir2 = tmp();
    writeAll(dir2, { 'a.json': record(), 'b.json': record() });
    expect(summaryMain([dir2], old.io)).toBe(0);
    expect(old.out.join('\n')).not.toContain('card:');
  });
});

describe('summary — a supplied build is the row of a template or ask mode', () => {
  const tpl = { file: 'opus-low-rep1-crm.json', sha256: 'a'.repeat(64) };
  const other = { file: 'haiku-medium-rep1-crm.json', sha256: 'b'.repeat(64) };

  it('runs on one template file (by its sha256) share a row; another file is another row', () => {
    const tables = summaryTables(
      readSummaryRecords(
        writeAll(tmp(), {
          'h.json': record({ template: tpl, modes: [{ mode: 'ask', ask: 'claude-haiku-5-5' }] }),
          's.json': record({ template: tpl, modes: [{ mode: 'ask', ask: 'claude-sonnet-5-5' }] }),
          'o.json': record({ template: other, modes: [{ mode: 'ask', ask: 'claude-haiku-5-5' }] }),
        }),
      ).records,
    );
    expect(tables[0]!.rows.map((r) => r.label)).toEqual([`supplied template \`haiku-medium-rep1-crm.json\` (sha256 bbbbbbbbbbbb)`, `supplied template \`opus-low-rep1-crm.json\` (sha256 aaaaaaaaaaaa)`]);
    expect(tables[0]!.cols.map((r) => r.label)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    const md = render(tables);
    expect(cellOf(md, 'supplied template `opus-low-rep1-crm.json` (sha256 aaaaaaaaaaaa)', 'Build', 'claude-sonnet-5-5')).toBe('supplied');
  });

  it('a record that names no template file is a row of its own: two such runs are never summed', () => {
    const dir = tmp();
    writeAll(dir, { 'x.json': record({ modes: [{ mode: 'ask' }] }), 'y.json': record({ modes: [{ mode: 'ask' }] }) });
    const tables = summaryTables(readSummaryRecords([dir]).records);
    expect(tables[0]!.rows.map((r) => r.label)).toEqual(['supplied template, file not recorded (record `x.json`)', 'supplied template, file not recorded (record `y.json`)']);
  });

  it("an ask mode on this run's scratch build takes that build's author; a template mode names its iterate's author too", () => {
    const tables = summaryTables(
      readSummaryRecords(
        writeAll(tmp(), {
          'a.json': record({ source: 'this run’s from-scratch build', modes: [{ author: 'claude-opus-5-5' }, { mode: 'ask' }] }),
          't.json': record({ template: tpl, modes: [{ mode: 'template', author: 'claude-sonnet-5-5', iterate: { build: [30, 30], qa: [9, 9], ops: [5, 5] } }] }),
        }),
      ).records,
    );
    expect(tables.find((t) => t.mode === 'ask')!.rows.map((r) => r.label)).toEqual(['this run’s from-scratch build, by claude-opus-5-5']);
    expect(tables.find((t) => t.mode === 'template')!.rows.map((r) => r.label)).toEqual(['supplied template `opus-low-rep1-crm.json` (sha256 aaaaaaaaaaaa) · iterate by claude-sonnet-5-5']);
  });

  it('`run` writes the template it installed into the record, and nothing when no mode installed one', () => {
    const dir = tmp();
    const [file] = writeAll(dir, { 'opus-low-rep1-crm.json': '{"objects":[]}' });
    const supplied = suppliedTemplateOf(file!);
    // The file's name, never its directory, and the sha256 of its bytes.
    expect(supplied).toEqual({ file: 'opus-low-rep1-crm.json', sha256: createHash('sha256').update('{"objects":[]}').digest('hex') });
    const installed = { modes: [{ mode: 'ask', template: { source: 'supplied template' } }] } as unknown as CardRun;
    const scratchOnly = { modes: [{ mode: 'scratch' }] } as unknown as CardRun;
    const fromScratch = { modes: [{ mode: 'ask', template: { source: 'this run’s from-scratch build' } }] } as unknown as CardRun;
    expect(withSuppliedTemplate({ run: 'r' }, installed, supplied)).toEqual({ run: 'r', template: supplied });
    expect(withSuppliedTemplate({ run: 'r' }, scratchOnly, supplied)).toEqual({ run: 'r' });
    expect(withSuppliedTemplate({ run: 'r' }, fromScratch, supplied)).toEqual({ run: 'r' });
    expect(withSuppliedTemplate({ run: 'r' }, installed, undefined)).toEqual({ run: 'r' });
  });
});

describe('summary — an older record reads `not recorded`, never a crash or a zero', () => {
  it('a record from before the served models, ask cost and time were kept', () => {
    const dir = tmp();
    writeAll(dir, { 'old.json': record({ packages: null, modes: [{ author: null, ask: null }] }) });
    const c = capture();
    expect(summaryMain([dir], c.io)).toBe(0);
    const md = c.out.join('\n');
    expect(md).toContain('packages: not recorded');
    const tables = summaryTables(readSummaryRecords([dir]).records);
    expect(tables[0]!.rows.map((r) => r.label)).toEqual(['author model not recorded']);
    expect(tables[0]!.cols.map((r) => r.label)).toEqual(['ask model not recorded']);
    expect(cellOf(md, 'author model not recorded', 'Build', 'ask model not recorded')).toBe('22/22');
    expect(cellOf(md, 'author model not recorded', 'Ask cost', 'ask model not recorded')).toBe('not recorded');
    expect(cellOf(md, 'author model not recorded', 'Ask time', 'ask model not recorded')).toBe('not recorded');
  });

  it('an older record beside a newer one in one cell: the cost is not summed over the rest', () => {
    const md = render(summaryTables(readSummaryRecords(writeAll(tmp(), { 'old.json': record({ modes: [{ noSpend: true }] }), 'new.json': record() })).records));
    expect(cellOf(md, 'claude-opus-5-5', 'Ask cost', 'claude-haiku-5-5')).toBe('not recorded on 1 of 2 runs');
    expect(cellOf(md, 'claude-opus-5-5', 'Run-问数', 'claude-haiku-5-5')).toBe('16/18');
  });

  it('a skipped mode is listed under its table and counts in no cell', () => {
    const md = render(summaryTables(readSummaryRecords(writeAll(tmp(), { 'a.json': record(), 'b.json': record({ modes: [{ skipped: 'the build did not pass' }] }) })).records));
    expect(cellOf(md, 'claude-opus-5-5', 'Runs', 'claude-haiku-5-5')).toBe('1');
    expect(md).toMatch(/- skipped run `.*b\.json`: the build did not pass/);
  });
});

describe('summary — reading files, filters and the command', () => {
  it('reads a directory at every depth, skips JSON that is not a run record, and reads a file named twice once', () => {
    const dir = tmp();
    const [a] = writeAll(dir, {
      'haiku/rep1/a.json': record(),
      'haiku/rep1/crm.rec.json': { version: 1, turns: {} },
      'notes.json': 'not json',
    });
    const read = readSummaryRecords([dir, a!]);
    expect(read.records.map((r) => r.file)).toEqual([a]);
    expect(read.skipped.map((s) => s.reason)).toEqual(['not a scenario-runner record (no `runner: "scenario-runner"`)', expect.stringMatching(/^not JSON/)]);
    expect(read.errors).toEqual([]);
  });

  it('a file named on the command line that is not a run record, or a path that does not exist, fails the command', () => {
    const dir = tmp();
    const [rec, bad] = writeAll(dir, { 'a.json': record(), 'b.json': { version: 1 } });
    const c = capture();
    expect(summaryMain([rec!, bad!, join(dir, 'missing.json')], c.io)).toBe(1);
    expect(c.err).toEqual([`${bad}: not a run record: not a scenario-runner record (no \`runner: "scenario-runner"\`)`, `${join(dir, 'missing.json')}: no such file or directory`]);
    expect(c.out.join('\n')).toContain('| Runs | 1 |');
  });

  it('--card and --mode narrow the tables; a filter that leaves none fails', () => {
    const dir = tmp();
    writeAll(dir, { 'a.json': record({ modes: [{}, { mode: 'ask' }] }), 'b.json': record({ card: 'invoice_with_line_items' }) });
    const c = capture();
    expect(summaryMain(['--card', 'crm_account_with_contacts', '--mode', 'ask', dir], c.io)).toBe(0);
    const md = c.out.join('\n');
    expect(md.match(/^## /gm)).toHaveLength(1);
    expect(md).toContain('## `crm_account_with_contacts` · ask');
    const none = capture();
    expect(summaryMain(['--card', 'nope', dir], none.io)).toBe(1);
    expect(none.err).toEqual(['no run matches the --card / --mode filter']);
  });

  it('usage errors exit 2 with the usage; help prints it', () => {
    for (const argv of [[], ['--mode', 'nightly', 'x'], ['--bogus', 'x'], ['--card']]) {
      const c = capture();
      expect(summaryMain(argv, c.io)).toBe(2);
      expect(c.err[1]).toBe(SUMMARY_USAGE);
    }
    const h = capture();
    expect(summaryMain(['--help'], h.io)).toBe(0);
    expect(h.out).toEqual([SUMMARY_USAGE]);
  });

  it('`objectstack-scenarios summary` and `run-scenarios summary` reach the same command', async () => {
    const dir = tmp();
    writeAll(dir, { 'a.json': record() });
    const c = capture();
    expect(await runCli(['summary', dir], c.io)).toBe(0);
    expect(c.out.join('\n')).toContain('# Scenario run summary');
    const missing = capture();
    expect(await runCli(['summary', join(dir, 'missing')], missing.io)).toBe(1);
    // `run-scenarios summary` dispatches before the run flags are parsed: no "unknown flag".
    await expect(main(['summary', '--help'])).resolves.toBe(0);
  });
});

describe('summary — a record the runner wrote', () => {
  it('reads the fixture run of the real crm card (scratch + ask on its own build) as the runner wrote it', async () => {
    const fx = await runCrm({ modes: ['scratch', 'ask'] });
    const dir = tmp();
    writeAll(dir, { 'crm.json': fx.record });
    const c = capture();
    expect(summaryMain([dir], c.io)).toBe(0);
    const md = c.out.join('\n');
    const tables = summaryTables(readSummaryRecords([dir]).records);
    expect(tables.map((t) => t.mode)).toEqual(['scratch', 'ask']);
    const scratch = (fx.record.scorecard as { modes: Array<{ first: { ask: { passed: number; total: number } } }> }).modes[0]!.first.ask;
    expect(md).toContain(`| Run-问数 | ${scratch.passed}/${scratch.total} |`);
    expect(tables[1]!.rows[0]!.label).toMatch(/^this run’s from-scratch build, by /);
  });
});
