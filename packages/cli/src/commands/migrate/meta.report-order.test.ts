// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` — the human report leads with what blocks the stack.
 *
 * The chain hands the printer every semantic entry of every hop it crosses,
 * whatever the stack holds, so the semantic group is the whole catalogue of
 * each major crossed — hundreds of notices. The report therefore prints three
 * groups in the order an upgrader acts on them, each under one header line that
 * counts it:
 *
 *  ① the verdict, and every schema refusal left after the chain;
 *  ② the applied mechanical edits;
 *  ③ the semantic notices.
 *
 * ## Two kinds of pin, kept apart on purpose
 *
 * - ORDER: ① is the first thing the report prints, then ②, then ③. These are
 *   the pins that go red when the verdict is moved back behind the catalogue.
 * - SET: every applied edit and every semantic notice is printed exactly once,
 *   byte-identical to what the chain produced and in chain order, and every
 *   refusal the parse produced is listed. ADR-0087 D3 is "never silence": the
 *   groups may move, a notice may never be dropped, merged or reworded. These
 *   pins do not read positions across groups, so a reorder alone cannot turn
 *   them red — and a dropped notice cannot hide behind a correct order.
 *
 * ## The pairing pins (PAIR)
 *
 * Where a semantic entry declares in `conversionIds` that it judges a
 * conversion's applied edits, ② prints that entry's headline beside those
 * edits, marked review: once under each run of the conversion's edits, counting
 * them. It is a copy, never a move: ③ still prints the entry, and ③'s lines and
 * count stay the chain's. Declared links only, never prose: the pins enumerate
 * the links off the registry and replay each linked conversion's own fixture,
 * so a link the spec lane authors later is covered on the day it lands.
 *
 * ## Why in-process, over a real chain run
 *
 * The inputs are not fabricated: the stack below is replayed through the real
 * `applyMetaMigrations` and parsed by the real `ObjectStackDefinitionSchema`,
 * exactly as the command does, and `printMigrationReport` is the function the
 * command's text face calls with them. Spawning the CLI would add a process
 * and a config load and pin nothing more about the order. One pin adds a link
 * to a real result, and says so: the spec allows a link to a conversion an
 * EARLIER step replays, and none is authored yet.
 */

import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_CONVERSIONS, ObjectStackDefinitionSchema, formatZodIssue, normalizeStackInput } from '@objectstack/spec';
import {
  applyMetaMigrations,
  MIGRATIONS_BY_MAJOR,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
  type MigrationChainResult,
  type MigrationTodo,
} from '@objectstack/spec/migrations';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { printMigrationReport, type MigrationReport } from './meta.js';

/** Where the chain ends by default — derived, so the file survives the next major. */
const TERMINUS = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);

/**
 * A stack with all three groups populated: two refusals no conversion repairs
 * (an unknown field type, a `scale` on a currency field), and retired spellings
 * the chain rewrites (`dashboard.refreshInterval`, `action.aria`).
 */
const FINDINGS_STACK = {
  manifest: { id: 'com.example.report-order', name: 'Report Order', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'ro_deal',
    label: 'Deal',
    fields: {
      title: { type: 'text', label: 'Title' },
      stage: { type: 'dropdown', label: 'Stage' },
      amount: { type: 'currency', label: 'Amount', scale: 2 },
    },
  }],
  actions: [{
    name: 'ro_close',
    label: 'Close',
    type: 'script',
    target: 'closeHandler',
    aria: { ariaLabel: 'Close the deal' },
  }],
  dashboards: [
    { name: 'kpi_a', label: 'KPI A', widgets: [], refreshInterval: 300 },
    { name: 'kpi_b', label: 'KPI B', widgets: [], refreshInterval: 60 },
  ],
};

/** The same app, already canonical: the verdict leads here too. */
const CANONICAL_STACK = {
  manifest: { id: 'com.example.report-order-canon', name: 'Report Order Canon', version: '1.0.0', type: 'app' },
  objects: [{ name: 'ro_thing', label: 'Thing', fields: { title: { type: 'text', label: 'Title' } } }],
};

interface Run {
  report: MigrationReport;
  result: MigrationChainResult;
  lines: string[];
}

let printed: string[] = [];

beforeEach(() => {
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Replay the chain the way the command does, print the report, return its lines.
 * `amend` edits the chain's result before it is printed — one pin uses it, to
 * add a link no registry entry declares yet.
 */
function run(
  stack: Record<string, unknown>,
  fromMajor: number,
  toMajor: number,
  amend: (result: MigrationChainResult) => MigrationChainResult = (r) => r,
): Run {
  const normalized = normalizeStackInput(stack, { convert: false });
  const result = amend(applyMetaMigrations(normalized, fromMajor, toMajor));
  const parsed = ObjectStackDefinitionSchema.safeParse(result.stack);
  const report: MigrationReport = {
    result,
    normalized,
    schemaValid: parsed.success,
    refusals: parsed.success ? [] : parsed.error.issues,
    dataMigrations: [],
    step: false,
    elapsed: '1ms',
  };
  printMigrationReport(report);
  // One console.log call may carry embedded newlines (a multi-paragraph
  // `reason`), so the lines are the terminal's, not the calls'.
  const lines = stripVTControlCharacters(printed.join('\n')).split('\n');
  return { report, result, lines };
}

const VERDICT_RE = /^ {2}[✓⚠] (?:Migrated stack|Stack does not)/;
const APPLIED_HEADER_RE = /^ {2}Applied (\d+) mechanical change\(s\):$/;
const SEMANTIC_HEADER_RE = /^ {2}(\d+) manual change\(s\) require your judgment:$/;

function indexOf(lines: string[], re: RegExp): number {
  return lines.findIndex((l) => re.test(l));
}

/** The lines an applied edit prints — written from the chain's data, not from the printer. */
function appliedLines(result: MigrationChainResult): string[] {
  return result.applied.map((a) => `    • ${a.path}: ${a.from} → ${a.to} (${a.conversionId})`);
}

/** The lines a semantic notice prints — every field, split the way a terminal splits it. */
function noticeLines(result: MigrationChainResult): string[] {
  return result.todos.flatMap((t) =>
    [
      `    ⚠ [protocol ${t.toMajor}] ${t.surface} → ${t.replacement}`,
      `        why:    ${t.reason}`,
      `        verify: ${t.acceptanceCriteria}`,
    ].join('\n').split('\n'),
  );
}

/** The lines the refusal group prints — one `formatZodIssue` render per refusal. */
function refusalLines(report: MigrationReport): string[] {
  return report.refusals.flatMap((r) => formatZodIssue(r).split('\n').map((l) => `  ${l}`));
}

/** The lines strictly between two indices that are not blank. */
function between(lines: string[], from: number, to: number): string[] {
  return lines.slice(from + 1, to).filter((l) => l.trim() !== '');
}

describe('the report leads with the verdict and the refusals (ORDER)', () => {
  it('prints ① the verdict and refusals, then ② the applied edits, then ③ the notices', () => {
    const { report, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    // Anti-vacuity: all three groups have members, so no index below can be
    // satisfied by a group that is simply absent.
    expect(report.schemaValid).toBe(false);
    expect(report.refusals.length).toBeGreaterThan(0);
    expect(report.result.applied.length).toBeGreaterThan(0);
    expect(report.result.todos.length).toBeGreaterThan(0);

    const verdict = indexOf(lines, VERDICT_RE);
    const applied = indexOf(lines, APPLIED_HEADER_RE);
    const semantic = indexOf(lines, SEMANTIC_HEADER_RE);
    expect(verdict, 'the verdict is the first line the report prints').toBe(0);
    expect(applied).toBeGreaterThan(verdict);
    expect(semantic).toBeGreaterThan(applied);
    // The refusals sit under the verdict and nowhere else: nothing but them
    // between the verdict line and the applied-edit header.
    expect(between(lines, verdict, applied)).toEqual(refusalLines(report));
  });

  it('leads with the verdict on a schema-valid stack too', () => {
    const { report, lines } = run(CANONICAL_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    expect(report.schemaValid).toBe(true);
    expect(report.result.todos.length).toBeGreaterThan(0);
    expect(lines[0]).toBe('  ✓ Migrated stack is schema-valid (1ms)');
    expect(indexOf(lines, SEMANTIC_HEADER_RE)).toBeGreaterThan(0);
  });

  it('leads with the verdict on a range that holds no step, above the range answer', () => {
    const { report, lines } = run(FINDINGS_STACK, TERMINUS, TERMINUS);
    expect(report.result.hops).toHaveLength(0);
    expect(report.schemaValid).toBe(false);
    const verdict = indexOf(lines, VERDICT_RE);
    const rangeAnswer = indexOf(lines, /No migration step exists for protocol/);
    expect(verdict).toBe(0);
    expect(lines[verdict]).toContain('this run replayed no conversion');
    expect(rangeAnswer).toBeGreaterThan(verdict);
  });
});

describe('each group opens with one header line that counts it', () => {
  it('counts the refusals, the applied edits and the notices', () => {
    const { report, result, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const n = report.refusals.length;
    expect(lines.filter((l) => VERDICT_RE.test(l))).toEqual([
      `  ⚠ Migrated stack does not yet pass schema validation — ${n} refusal${n === 1 ? '' : 's'} `
        + 'left after the chain. Resolve them, then run `os validate`:',
    ]);
    expect(lines.filter((l) => APPLIED_HEADER_RE.test(l))).toEqual([
      `  Applied ${result.applied.length} mechanical change(s):`,
    ]);
    expect(lines.filter((l) => SEMANTIC_HEADER_RE.test(l))).toEqual([
      `  ${result.todos.length} manual change(s) require your judgment:`,
    ]);
  });
});

describe('no notice, edit or refusal is dropped, merged or reworded (SET)', () => {
  it('prints every applied edit exactly once, in chain order', () => {
    const { result, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const expected = appliedLines(result);
    expect(lines.filter((l) => l.startsWith('    • '))).toEqual(expected);
  });

  it('prints every semantic notice of every hop crossed, byte-identical and in chain order', () => {
    const { result, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const expected = noticeLines(result);
    // Anti-vacuity: more than one hop's catalogue, and at least one notice
    // whose prose spans several terminal lines.
    expect(new Set(result.todos.map((t) => t.toMajor)).size).toBeGreaterThan(1);
    expect(expected.length).toBeGreaterThan(result.todos.length * 3);
    const header = indexOf(lines, SEMANTIC_HEADER_RE);
    const printedNotices = lines.slice(header + 1, header + 1 + expected.length);
    expect(printedNotices).toEqual(expected);
    // …and not a second time anywhere else.
    const firstNotice = expected[0]!;
    expect(lines.filter((l) => l === firstNotice)).toHaveLength(
      expected.filter((l) => l === firstNotice).length,
    );
  });

  it('lists every refusal the parse of the migrated stack produced', () => {
    const { report, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const expected = refusalLines(report);
    for (const line of expected) expect(lines, `refusal missing: ${line}`).toContain(line);
    expect(lines.filter((l) => l.startsWith('    ✗ '))).toEqual(expected.filter((l) => l.startsWith('    ✗ ')));
  });

  it('prints nothing but the groups: every non-blank line is a header, an item or a refusal', () => {
    const { report, result, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const accounted = [
      ...lines.filter((l) => VERDICT_RE.test(l) || APPLIED_HEADER_RE.test(l) || SEMANTIC_HEADER_RE.test(l)),
      ...refusalLines(report),
      ...appliedLines(result),
      ...noticeLines(result),
    ].filter((l) => l.trim() !== ''); // a multi-paragraph `reason` carries blank lines of its own
    expect(lines.filter((l) => l.trim() !== '').sort()).toEqual(accounted.sort());
  });
});

/**
 * Two flows, each with an edge-branched decision carrying two conditioned
 * out-edges and no `mode` — the shape `flow-decision-mode-inclusive-explicit`
 * rewrites, twice — and a dashboard `refreshInterval`, whose conversion no
 * semantic entry names.
 */
const decisionFlow = (name: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'verdict', type: 'decision', label: 'Verdict?' },
    { id: 'refuse', type: 'end', label: 'Refuse' },
    { id: 'convert', type: 'end', label: 'Convert' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'verdict' },
    { id: 'e2', source: 'verdict', target: 'refuse', condition: "lead.status != 'confirmed'" },
    { id: 'e3', source: 'verdict', target: 'convert', condition: "lead.status == 'confirmed'" },
  ],
});
const DECISION_STACK = {
  manifest: { id: 'com.example.report-pairing', name: 'Report Pairing', version: '1.0.0', type: 'app' },
  objects: [{ name: 'rp_lead', label: 'Lead', fields: { status: { type: 'text', label: 'Status' } } }],
  flows: [decisionFlow('rp_lead_verdict'), decisionFlow('rp_lead_recheck')],
  dashboards: [{ name: 'rp_kpi', label: 'KPI', widgets: [], refreshInterval: 300 }],
};

/** One `time` default with a `Z` — a single edit by `time-default-utc-suffix-dropped`. */
const TIME_STACK = {
  manifest: { id: 'com.example.report-pairing-time', name: 'Report Pairing Time', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'rp_shift',
    label: 'Shift',
    fields: { starts_at: { type: 'time', label: 'Starts at', defaultValue: '09:00Z' } },
  }],
};

const DECISION_CONVERSION = 'flow-decision-mode-inclusive-explicit';
const DECISION_JUDGE = 'flow-decision-edge-branching-first-match';
const TIME_CONVERSION = 'time-default-utc-suffix-dropped';
const TIME_JUDGE = 'time-default-zone-refused';

const REVIEW_RE = /^ {6}↳ review /;

/** The review line a judge prints under `edits` edits — written from the entry's data, not from the printer. */
function reviewLine(judge: MigrationTodo, edits: number): string {
  const subject = edits === 1 ? 'the edit above' : `the ${edits} edits above`;
  return `      ↳ review ${subject} against the manual change [protocol ${judge.toMajor}] ${judge.surface} → ${judge.replacement}`;
}

/** Every link the registry declares: a semantic entry, and a conversion id it names. */
function declaredLinks(): Array<{ toMajor: number; entry: string; conversionId: string }> {
  return MIGRATION_MAJORS.flatMap((m) =>
    MIGRATIONS_BY_MAJOR[m]!.semantic.flatMap((s) =>
      (s.conversionIds ?? []).map((conversionId) => ({ toMajor: m, entry: s.id, conversionId })),
    ),
  );
}

function todoOf(result: MigrationChainResult, id: string): MigrationTodo {
  const todo = result.todos.find((t) => t.id === id);
  expect(todo, `the chain reports the semantic entry ${id}`).toBeDefined();
  return todo!;
}

/** The index of the last line of the first run of edits by `conversionId`, and the run's length. */
function runOf(lines: string[], conversionId: string): { last: number; length: number } {
  const isEdit = (l: string | undefined) => l !== undefined && l.startsWith('    • ') && l.endsWith(` (${conversionId})`);
  const first = lines.findIndex((l) => isEdit(l));
  expect(first, `an applied edit by ${conversionId} is printed`).toBeGreaterThan(-1);
  let last = first;
  while (isEdit(lines[last + 1])) last += 1;
  return { last, length: last - first + 1 };
}

/** The review lines printed directly under line `i`. */
function reviewsUnder(lines: string[], i: number): string[] {
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && REVIEW_RE.test(lines[j]!); j += 1) out.push(lines[j]!);
  return out;
}

describe('an applied edit a semantic entry judges prints that entry beside it, marked review (PAIR)', () => {
  it('prints the judge once under the run of edits it judges, counting them', () => {
    const { result, lines } = run(DECISION_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const edits = result.applied.filter((a) => a.conversionId === DECISION_CONVERSION);
    expect(edits, 'anti-vacuity: both decisions were rewritten').toHaveLength(2);
    const { last, length } = runOf(lines, DECISION_CONVERSION);
    expect(length).toBe(2);
    expect(reviewsUnder(lines, last)).toEqual([reviewLine(todoOf(result, DECISION_JUDGE), 2)]);
    // Beside the edit, i.e. inside ②: after its header, before ③'s.
    expect(last).toBeGreaterThan(indexOf(lines, APPLIED_HEADER_RE));
    expect(last + 1).toBeLessThan(indexOf(lines, SEMANTIC_HEADER_RE));
  });

  it('says "the edit above" under a run of one', () => {
    const { result, lines } = run(TIME_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const { last, length } = runOf(lines, TIME_CONVERSION);
    expect(length).toBe(1);
    expect(reviewsUnder(lines, last)).toEqual([reviewLine(todoOf(result, TIME_JUDGE), 1)]);
  });

  it('prints an edit no entry judges exactly as before, with no review line under it', () => {
    const { result, lines } = run(DECISION_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const linked = new Set(result.todos.flatMap((t) => t.conversionIds ?? []));
    const unjudged = result.applied.filter((a) => !linked.has(a.conversionId));
    expect(unjudged.length, 'anti-vacuity: the dashboard edit has no judge').toBeGreaterThan(0);
    for (const a of unjudged) {
      const i = lines.indexOf(`    • ${a.path}: ${a.from} → ${a.to} (${a.conversionId})`);
      expect(i, `unjudged edit printed: ${a.path}`).toBeGreaterThan(-1);
      expect(reviewsUnder(lines, i), `no review line under ${a.path}`).toEqual([]);
    }
    // ②'s own lines are the chain's, byte-identical and in order, review lines aside.
    expect(lines.filter((l) => l.startsWith('    • '))).toEqual(appliedLines(result));
    expect(lines.filter((l) => APPLIED_HEADER_RE.test(l))).toEqual([
      `  Applied ${result.applied.length} mechanical change(s):`,
    ]);
  });

  it('prints no review line at all where no applied conversion is linked', () => {
    const { result, lines } = run(FINDINGS_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const linked = new Set(result.todos.flatMap((t) => t.conversionIds ?? []));
    expect(linked.size, 'anti-vacuity: the chain does carry links').toBeGreaterThan(0);
    expect(result.applied.some((a) => linked.has(a.conversionId))).toBe(false);
    expect(lines.filter((l) => REVIEW_RE.test(l))).toEqual([]);
  });

  it('keeps every semantic entry in ③ — the judge included — with the chain\'s count and bytes', () => {
    const { result, lines } = run(DECISION_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    const header = indexOf(lines, SEMANTIC_HEADER_RE);
    expect(lines[header]).toBe(`  ${result.todos.length} manual change(s) require your judgment:`);
    const expected = noticeLines(result);
    expect(lines.slice(header + 1, header + 1 + expected.length)).toEqual(expected);
    const entries = lines.slice(header + 1).filter((l) => /^ {4}⚠ \[protocol \d+\] /.test(l));
    expect(entries).toHaveLength(result.todos.length);
    const judge = todoOf(result, DECISION_JUDGE);
    expect(entries).toContain(`    ⚠ [protocol ${judge.toMajor}] ${judge.surface} → ${judge.replacement}`);
  });

  it('prints nothing but the groups and the review lines the declared links call for', () => {
    const { report, result, lines } = run(DECISION_STACK, MIGRATION_SUPPORT_FLOOR, TERMINUS);
    // Written without the printer's run logic: a real chain replays one
    // conversion at a time, so a conversion's edits are one run and its count
    // is the run's length.
    const runs = new Map<string, number>();
    for (const [i, a] of result.applied.entries()) {
      if (i > 0 && result.applied[i - 1]!.conversionId !== a.conversionId) {
        expect(runs.has(a.conversionId), `${a.conversionId} edits are contiguous`).toBe(false);
      }
      runs.set(a.conversionId, (runs.get(a.conversionId) ?? 0) + 1);
    }
    const reviews = result.todos.flatMap((t) =>
      (t.conversionIds ?? []).filter((id) => runs.has(id)).map((id) => reviewLine(t, runs.get(id)!)),
    );
    expect(reviews.length, 'anti-vacuity: the stack exercises a link').toBeGreaterThan(0);
    const accounted = [
      ...lines.filter((l) => VERDICT_RE.test(l) || APPLIED_HEADER_RE.test(l) || SEMANTIC_HEADER_RE.test(l)),
      ...refusalLines(report),
      ...appliedLines(result),
      ...reviews,
      ...noticeLines(result),
    ].filter((l) => l.trim() !== '');
    expect(lines.filter((l) => l.trim() !== '').sort()).toEqual(accounted.sort());
  });

  it('pairs every link the registry declares, replayed over the linked conversion\'s own fixture', () => {
    const links = declaredLinks();
    // Anti-vacuity, and the two links authored when the printer learned to pair.
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ entry: DECISION_JUDGE, conversionId: DECISION_CONVERSION }),
      expect.objectContaining({ entry: TIME_JUDGE, conversionId: TIME_CONVERSION }),
    ]));
    for (const link of links) {
      const conversion = ALL_CONVERSIONS.find((c) => c.id === link.conversionId);
      expect(conversion, `${link.entry} names a registered conversion`).toBeDefined();
      printed = [];
      const { result, lines } = run(
        conversion!.fixture.before as Record<string, unknown>,
        MIGRATION_SUPPORT_FLOOR,
        TERMINUS,
      );
      const { last, length } = runOf(lines, link.conversionId);
      expect(
        reviewsUnder(lines, last),
        `${link.entry} is printed beside the ${link.conversionId} edits`,
      ).toContain(reviewLine(todoOf(result, link.entry), length));
    }
  });

  it('pairs across hops: a link to a conversion an earlier step replays', () => {
    // No authored link crosses a hop yet, though `SemanticMigration.conversionIds`
    // allows one, so this pin adds it: a protocol-18 entry made to judge a
    // protocol-17 conversion. Everything else is the chain's own result.
    const earlier = 'action-execute-to-target';
    const conversion = ALL_CONVERSIONS.find((c) => c.id === earlier)!;
    const judgeId = DECISION_JUDGE;
    const { result, lines } = run(
      conversion.fixture.before as Record<string, unknown>,
      MIGRATION_SUPPORT_FLOOR,
      TERMINUS,
      (r) => ({ ...r, todos: r.todos.map((t) => (t.id === judgeId ? { ...t, conversionIds: [earlier] } : t)) }),
    );
    const judge = todoOf(result, judgeId);
    const edit = result.applied.find((a) => a.conversionId === earlier);
    expect(edit?.toMajor, 'anti-vacuity: the edit comes from an earlier hop').toBeLessThan(judge.toMajor);
    const { last, length } = runOf(lines, earlier);
    expect(reviewsUnder(lines, last)).toEqual([reviewLine(judge, length)]);
  });
});
