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
 * ## Why in-process, over a real chain run
 *
 * The inputs are not fabricated: the stack below is replayed through the real
 * `applyMetaMigrations` and parsed by the real `ObjectStackDefinitionSchema`,
 * exactly as the command does, and `printMigrationReport` is the function the
 * command's text face calls with them. Spawning the CLI would add a process
 * and a config load and pin nothing more about the order.
 */

import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ObjectStackDefinitionSchema,
  applyMetaMigrations,
  formatZodIssue,
  normalizeStackInput,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
  type MigrationChainResult,
} from '@objectstack/spec';
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

/** Replay the chain the way the command does, print the report, return its lines. */
function run(stack: Record<string, unknown>, fromMajor: number, toMajor: number): Run {
  const normalized = normalizeStackInput(stack, { convert: false });
  const result = applyMetaMigrations(normalized, fromMajor, toMajor);
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
