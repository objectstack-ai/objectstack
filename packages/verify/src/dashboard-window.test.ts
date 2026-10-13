// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The dashboard date-window family — what it reads from the metadata, what it
// proves on a real stack, and the controls that keep its green honest:
//
//   • two NEGATIVE controls, each an app whose own plugin keeps the window
//     from reaching storage — an aggregate middleware on the engine's
//     published seam (`registerMiddleware`), no engine change: one drops the
//     window from the query (a floor that matches every row), one makes a
//     windowed query match nothing (a window that zeroes the widget). Both are
//     found, and the first is named inert;
//   • the ATTRIBUTION control: an app hook that rewrites the window's field on
//     write makes the probe not run, never contradicted — the family judges a
//     window only over rows that read back as written.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';
import { DATE_RANGE_PRESETS } from '@objectstack/spec/data';

import { bootStack, type VerifyStack } from './harness.js';
import {
  deriveDashboardWindowCases,
  runDashboardWindowProofs,
  formatDashboardWindowReport,
  type DashboardWindowReport,
} from './dashboard-window.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;
const RUN_TIMEOUT = 240_000;

const ticket = {
  name: 'wnd_ticket',
  label: 'Ticket',
  fields: {
    subject: { type: 'text', label: 'Subject', required: true },
    status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
    priority: { type: 'select', label: 'Priority', options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
    is_closed: { type: 'boolean', label: 'Closed' },
    effort: { type: 'number', label: 'Effort' },
    opened_at: { type: 'datetime', label: 'Opened at' },
    due_on: { type: 'date', label: 'Due on' },
    assignee: { type: 'lookup', label: 'Assignee', reference: 'wnd_agent' },
  },
};

const source = {
  manifest: { id: 'com.example.dashboard-window', namespace: 'wnd', version: '0.0.1', type: 'app', name: 'Dashboard Window Fixture' },
  objects: [
    { name: 'wnd_agent', label: 'Agent', fields: { name: { type: 'text', label: 'Name', required: true } } },
    ticket,
  ],
  datasets: [
    {
      name: 'ticket_metrics',
      label: 'Ticket metrics',
      object: 'wnd_ticket',
      dimensions: [
        { name: 'status', label: 'Status', field: 'status', type: 'string' },
        { name: 'priority', label: 'Priority', field: 'priority', type: 'string' },
      ],
      measures: [
        { name: 'ticket_count', label: 'Tickets', aggregate: 'count' },
        { name: 'closed_count', label: 'Closed', aggregate: 'count', filter: { is_closed: true } },
        { name: 'assigned_count', label: 'Assigned', aggregate: 'count', field: 'assignee' },
        { name: 'avg_effort', label: 'Effort', aggregate: 'avg', field: 'effort' },
        { name: 'closed_rate', label: 'Closed rate', derived: { op: 'ratio', of: ['closed_count', 'ticket_count'] } },
      ],
    },
    {
      name: 'user_metrics',
      label: 'User metrics',
      object: 'sys_user',
      dimensions: [],
      measures: [{ name: 'user_count', label: 'Users', aggregate: 'count' }],
    },
  ],
  dashboards: [
    {
      name: 'wnd_desk',
      label: 'Desk',
      dateRange: { field: 'opened_at', defaultRange: 'last_30_days' },
      widgets: [
        { id: 'open_tickets', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filter: { status: 'open' } },
        { id: 'by_status', type: 'bar', dataset: 'ticket_metrics', dimensions: ['status'], values: ['ticket_count'] },
        { id: 'due_window', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filterBindings: { dateRange: 'due_on' } },
        { id: 'mine', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filter: { owner_id: '{current_user_id}' } },
        { id: 'closed_tickets', type: 'metric', dataset: 'ticket_metrics', values: ['closed_count'] },
        { id: 'with_assignee', type: 'metric', dataset: 'ticket_metrics', values: ['assigned_count'] },
        { id: 'high_or_low', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filter: { priority: { $in: ['high', 'low'] } } },
        { id: 'mixed', type: 'table', dataset: 'ticket_metrics', dimensions: ['priority'], values: ['ticket_count', 'avg_effort'] },
        // Outside the population, each with its reason.
        { id: 'trend', type: 'line', dataset: 'ticket_metrics', values: ['ticket_count'], filterBindings: { dateRange: false } },
        { id: 'effort', type: 'metric', dataset: 'ticket_metrics', values: ['avg_effort'] },
        { id: 'rate', type: 'metric', dataset: 'ticket_metrics', values: ['closed_rate'] },
        { id: 'recent', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filter: { opened_at: { $gte: '{30_days_ago}' } } },
        { id: 'either', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filter: { $or: [{ status: 'open' }, { is_closed: true }] } },
        { id: 'by_subject', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filterBindings: { dateRange: 'subject' } },
        { id: 'ghost', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'], filterBindings: { dateRange: 'closed_on' } },
        { id: 'users', type: 'metric', dataset: 'user_metrics', values: ['user_count'] },
      ],
    },
    {
      // No `field`: the window lands on the filter's own default, `created_at`.
      name: 'wnd_overview',
      label: 'Overview',
      dateRange: { defaultRange: 'this_month' },
      widgets: [{ id: 'all_tickets', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'] }],
    },
    { name: 'wnd_plain', label: 'Plain', widgets: [{ id: 'plain', type: 'metric', dataset: 'ticket_metrics', values: ['ticket_count'] }] },
  ],
};

const PROVEN = ['open_tickets', 'by_status', 'due_window', 'mine', 'closed_tickets', 'with_assignee', 'high_or_low', 'mixed', 'all_tickets'];

const widgetOf = (report: DashboardWindowReport, widget: string) => {
  const r = report.results.find((x) => x.widget === widget);
  if (!r) throw new Error(`no result for ${widget}`);
  return r;
};

describe('deriveDashboardWindowCases — what the family reads from the metadata', () => {
  it("reads the binding through the spec's parse and names every widget it cannot compare", () => {
    const cases = new Map(deriveDashboardWindowCases(source).map((c) => [`${c.dashboard}/${c.widget}`, c]));
    // The plain dashboard declares no window, so none of its widgets is a case.
    expect([...cases.keys()].filter((k) => k.startsWith('wnd_plain/'))).toEqual([]);
    expect(cases.get('wnd_desk/open_tickets')).toMatchObject({ object: 'wnd_ticket', field: 'opened_at', binding: 'default', filter: { status: 'open' } });
    expect(cases.get('wnd_desk/due_window')).toMatchObject({ field: 'due_on', binding: 'explicit' });
    // An unauthored `field` is the filter's own default.
    expect(cases.get('wnd_overview/all_tickets')).toMatchObject({ field: 'created_at', binding: 'default' });
    expect(cases.get('wnd_desk/trend')).toMatchObject({ unbound: true });
    expect(cases.get('wnd_desk/with_assignee')!.measures).toEqual([{ measure: 'assigned_count', countField: 'assignee' }]);
    expect(cases.get('wnd_desk/closed_tickets')!.measures).toEqual([{ measure: 'closed_count', filter: { is_closed: true } }]);
    expect(cases.get('wnd_desk/mixed')!.measures.map((m) => m.excluded?.kind ?? 'probed')).toEqual(['probed', 'not-a-count']);
    expect(cases.get('wnd_desk/effort')!.excluded).toMatchObject({ kind: 'no-count-measure' });
    expect(cases.get('wnd_desk/rate')!.excluded!.reason).toMatch(/"closed_rate" is derived \(ratio of closed_count, ticket_count\)/);
    expect(cases.get('wnd_desk/users')!.excluded).toMatchObject({ kind: 'object-undeclared' });
  });

  it('names a dataset the app does not declare, and a dashboard that does not parse', () => {
    const config = {
      ...source,
      dashboards: [
        { name: 'wnd_lost', label: 'Lost', dateRange: { field: 'opened_at' }, widgets: [{ id: 'lost', type: 'metric', dataset: 'nope_metrics', values: ['n'] }] },
        { name: 'wnd_bad', label: 'Bad', dateRange: { field: 'opened_at', defaultRange: 'last_60_days' }, widgets: [] },
      ],
    };
    const cases = deriveDashboardWindowCases(config);
    expect(cases.find((c) => c.widget === 'lost')!.excluded).toMatchObject({ kind: 'dataset-undeclared' });
    expect(cases.find((c) => c.dashboard === 'wnd_bad')!.excluded!.reason).toMatch(/^the dashboard does not parse under the spec's DashboardSchema \(dateRange\.defaultRange/);
  });
});

describe('runDashboardWindowProofs — the fixture app', () => {
  let stack: VerifyStack;
  let report: DashboardWindowReport;
  const app = defineStack(source as never) as unknown as typeof source;

  beforeAll(async () => {
    stack = await bootStack(app as never);
    report = await runDashboardWindowProofs(stack, await stack.signIn(), app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it("hands each preset the spec's macro window and resolves it with the platform's resolver", () => {
    expect(report.door).toBe('rest');
    expect(report.timezone).toBe('UTC');
    expect(report.presets.map((p) => p.preset)).toEqual([...DATE_RANGE_PRESETS]);
    const byPreset = new Map(report.presets.map((p) => [p.preset, p]));
    expect(byPreset.get('last_7_days')!.condition).toEqual({ $gte: '{7_days_ago}' });
    expect(byPreset.get('this_month')!.condition).toEqual({ $gte: '{month_start}', $lte: '{month_end}' });
    for (const p of report.presets) expect(p.resolved.$gte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('proves every bound count widget under every preset, on a datetime and a date field', () => {
    for (const widget of PROVEN) {
      const r = widgetOf(report, widget);
      expect(r.status, `${widget}\n${formatDashboardWindowReport(report)}`).toBe('proven');
      for (const m of r.measures.filter((x) => x.status === 'probed')) {
        expect(m.presets.map((p) => p.outcome)).toEqual(DATE_RANGE_PRESETS.map(() => 'held'));
        // The control leg held: with no window the widget counted every fixture row.
        expect(m.unwindowed!.answered).toBe(m.days!.length);
        expect(m.inert).toBe(false);
        expect(m.narrowing).toEqual([]);
        // Each preset selects some fixture rows, and leaves the day before its first out.
        for (const p of m.presets) {
          expect(p.expected).toBeGreaterThan(0);
          expect(p.expected).toBeLessThan(m.days!.length);
        }
      }
    }
    expect(widgetOf(report, 'open_tickets').fieldType).toBe('datetime');
    expect(widgetOf(report, 'due_window').fieldType).toBe('date');
    expect(widgetOf(report, 'all_tickets').fieldType).toBe('datetime');
  });

  it('names every widget outside the population, with its reason', () => {
    expect(widgetOf(report, 'trend').status).toBe('unbound');
    const excluded = (w: string) => [widgetOf(report, w).status, widgetOf(report, w).excludedKind];
    expect(excluded('effort')).toEqual(['excluded', 'no-count-measure']);
    expect(excluded('rate')).toEqual(['excluded', 'no-count-measure']);
    expect(excluded('recent')).toEqual(['excluded', 'filter-unmodelled']);
    expect(widgetOf(report, 'recent').reason).toMatch(/a condition on opened_at, the field the window lands on/);
    expect(excluded('either')).toEqual(['excluded', 'filter-unmodelled']);
    expect(widgetOf(report, 'either').reason).toMatch(/the operator \$or/);
    expect(excluded('by_subject')).toEqual(['excluded', 'field-type']);
    expect(excluded('ghost')).toEqual(['excluded', 'field-missing']);
    expect(excluded('users')).toEqual(['excluded', 'object-undeclared']);
    // The non-count measure beside a probed one is counted, not probed.
    expect(widgetOf(report, 'mixed').measures.map((m) => `${m.measure} ${m.status}`)).toEqual(['ticket_count probed', 'avg_effort excluded']);
  });

  it('counts every dashboard, widget, measure and window', () => {
    expect(report.summary).toEqual({
      dashboards: { declared: 3, windowed: 2, notWindowed: 1, excluded: 0 },
      widgets: { total: 17, unbound: 1, excluded: 7, probed: 9, proven: 9, contradicted: 0, failed: 0, inconclusive: 0 },
      excludedBy: { 'no-count-measure': 2, 'filter-unmodelled': 2, 'field-type': 1, 'field-missing': 1, 'object-undeclared': 1 },
      measures: { probed: 9, excluded: 1, excludedBy: { 'not-a-count': 1 } },
      probes: 9 * DATE_RANGE_PRESETS.length,
      held: 9 * DATE_RANGE_PRESETS.length,
      blank: 0,
      contradictions: 0,
      faults: 0,
      notRun: 0,
      inert: 0,
      narrowing: 0,
      hardFailures: 0,
    });
  });
});

// ── The controls ────────────────────────────────────────────────────────────

const controlSource = {
  manifest: { id: 'com.example.dashboard-window-controls', namespace: 'wnc', version: '0.0.1', type: 'app', name: 'Dashboard Window Controls' },
  objects: [
    {
      name: 'wnc_case',
      label: 'Case',
      fields: {
        subject: { type: 'text', label: 'Subject', required: true },
        opened_at: { type: 'datetime', label: 'Opened at' },
        logged_at: { type: 'datetime', label: 'Logged at' },
        audited_at: { type: 'datetime', label: 'Audited at', internal: true },
      },
    },
  ],
  datasets: [{ name: 'case_metrics', label: 'Cases', object: 'wnc_case', dimensions: [], measures: [{ name: 'case_count', label: 'Cases', aggregate: 'count' }] }],
  dashboards: [
    {
      name: 'wnc_board',
      label: 'Board',
      dateRange: { field: 'opened_at', defaultRange: 'last_90_days' },
      widgets: [
        { id: 'cases', type: 'metric', dataset: 'case_metrics', values: ['case_count'] },
        { id: 'logged', type: 'metric', dataset: 'case_metrics', values: ['case_count'], filterBindings: { dateRange: 'logged_at' } },
        { id: 'audited', type: 'metric', dataset: 'case_metrics', values: ['case_count'], filterBindings: { dateRange: 'audited_at' } },
      ],
    },
  ],
  hooks: [
    {
      // An app hook stamping `logged_at` itself on every insert.
      name: 'wnc_stamp_logged',
      object: 'wnc_case',
      events: ['beforeInsert'],
      handler: async (ctx: { input: Record<string, unknown> }) => {
        ctx.input.logged_at = '2020-01-01T00:00:00.000Z';
      },
    },
  ],
};

/** `filter` with every condition on `field` removed, at any depth of `$and`. */
function without(filter: unknown, field: string): unknown {
  if (Array.isArray(filter)) return filter.map((f) => without(f, field));
  if (!filter || typeof filter !== 'object') return filter;
  return Object.fromEntries(Object.entries(filter as Record<string, unknown>).filter(([k]) => k !== field).map(([k, v]) => [k, without(v, field)]));
}
const mentions = (filter: unknown, field: string): boolean => JSON.stringify(filter ?? {}).includes(`"${field}"`);

/**
 * The app's own plugin, as `os serve` and `bootStack` compose it: an aggregate
 * middleware on `wnc_case` (the engine's published seam, `registerMiddleware`,
 * read by `ctx.operation === 'aggregate'` and `ctx.ast.where`) that does what
 * a broken storage path would — `drop` removes the window's condition from the
 * query (every row passes the window), `zero` makes a windowed query match no
 * row (the window zeroes the widget).
 */
const windowBreaker = (mode: 'drop' | 'zero') => ({
  name: `com.example.wnc.window-${mode}`,
  version: '1.0.0',
  init: async () => {},
  start: async (ctx: { getService: (name: string) => any }) => {
    ctx.getService('objectql').registerMiddleware(async (op: { operation: string; ast?: { where?: unknown } }, next: () => Promise<void>) => {
      if (op.operation === 'aggregate' && op.ast && mentions(op.ast.where, 'opened_at')) {
        op.ast.where = mode === 'drop' ? without(op.ast.where, 'opened_at') : { $and: [op.ast.where, { subject: '__no_row__' }] };
      }
      await next();
    }, { object: 'wnc_case' });
  },
});

describe.each(['drop', 'zero'] as const)("NEGATIVE CONTROL — an app plugin that keeps the window from storage (%s)", (mode) => {
  let stack: VerifyStack;
  let report: DashboardWindowReport;
  const app = defineStack({ ...controlSource, plugins: [windowBreaker(mode)] } as never) as unknown as typeof controlSource;

  beforeAll(async () => {
    stack = await bootStack(app as never);
    report = await runDashboardWindowProofs(stack, await stack.signIn(), app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('is found, under every preset', () => {
    const r = widgetOf(report, 'cases');
    expect(r.status, formatDashboardWindowReport(report)).toBe('contradicted');
    const m = r.measures[0]!;
    // The control leg holds: with no window the bridge counts every fixture row.
    expect(m.unwindowed!.answered).toBe(m.days!.length);
    if (mode === 'drop') {
      expect(m.presets.map((p) => p.outcome)).toEqual(DATE_RANGE_PRESETS.map(() => 'contradicted'));
      expect(m.presets.every((p) => p.answered === m.days!.length)).toBe(true);
      expect(m.presets[0]!.detail).toMatch(/^the window counted \d+ fixture row\(s\), and it selects \d+ \(wider\)$/);
      expect(m.inert).toBe(true);
    } else {
      expect(m.presets.map((p) => p.outcome)).toEqual(DATE_RANGE_PRESETS.map(() => 'blank'));
      expect(m.inert).toBe(false);
    }
    expect(report.summary.hardFailures).toBe(1);
    expect(formatDashboardWindowReport(report)).toContain('✗ wnc_board/cases (wnc_case.opened_at, datetime)  CONTRADICTED');
  });

  it("ATTRIBUTION CONTROL — a hook rewriting the window's field makes the probe not run, never contradicted", () => {
    const r = widgetOf(report, 'logged');
    expect(r.status).toBe('inconclusive');
    expect(r.reason).toMatch(/reads back logged_at = "2020-01-01T00:00:00\.000Z", not \d{4}-\d{2}-\d{2}T12:00:00\.000Z: something rewrote it on write/);
    expect(r.measures[0]!.presets.every((p) => p.outcome === 'not-run')).toBe(true);
    // A column the read does not return (`internal: true`) is not called rewritten: it is unconfirmed.
    const audited = widgetOf(report, 'audited');
    expect(audited.status).toBe('inconclusive');
    expect(audited.reason).toMatch(/reads back no audited_at \(the read does not return that field\), so what was written there cannot be confirmed$/);
    expect(report.summary.widgets).toMatchObject({ contradicted: 1, inconclusive: 2, proven: 0 });
  });
});
