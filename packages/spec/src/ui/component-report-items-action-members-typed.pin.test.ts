// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464, the S-final stage] The last three members the close-out held as
 * forks, typed in the shapes the maintainer ruled on the decision card #21704:
 *
 * - `object-metric` `drillDown.report` — fork 1, letter B (record
 *   5978663135): this package's `ReportSchema`, by reference, now that a
 *   joined report refuses a block that binds no dataset.
 * - `object-timeline` `items` — fork 4, letter B (record 5979239990): both of
 *   objectui#6356's arms closed, a feed entry's `content` opaque, a row
 *   refinement pairing each entry with the arm `variant` selects, a gantt
 *   bar's dates a string or a number.
 * - the members of `action:group` / `action:menu` — fork 5, letter A (record
 *   5979239990): the measured read set, `action:button`'s keys by `type`, with
 *   the rows' prescriptions; `outcomeMessages`, a member `className` and
 *   `properties.params` refused, `outcomeMessages` undeclared on all four
 *   action blocks.
 *
 * ## The defect this file closes
 *
 * Each member is read with a fixed shape (measured at the `.objectui-sha` pin
 * `2e818d0b51ec`, unchanged at objectui `main` `2abec3a96`; the read points are
 * in the schemas' docblocks), and the rows declared them `z.unknown()` /
 * open records. So a drill report with no `dataset` or a bare report name, a
 * gantt row on a feed timeline (or a feed entry with no `title`), and an
 * action member keyed `actionType`, `endpoint` or a misspelling all passed the
 * component-props gate, and the drawer listed the records instead, the rail
 * drew an empty, unlabelled entry, or the container ran the member without
 * the key.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE DECLARED SHAPES PARSE: every shape a measured writer authors
 *   parses — the timeline entries and the action members byte-identical (no
 *   default, no transform on the values written), the drill report to exactly
 *   what `ReportSchema` answers (its defaults materialize). A refusal pin with
 *   no lit control passes just as well when the door refuses everything.
 * - §2 THE REFUSALS: an off-shape value of each member is refused with the
 *   code AND the path, so a refusal for the wrong reason reds; the refused
 *   action keys carry their prescriptions.
 * - §3 ONE VOCABULARY: the drill report IS `ReportSchema`; a timeline entry
 *   declares exactly objectui's two arms; a container member declares exactly
 *   `action:button`'s keys by `type` — less the two keys no container
 *   forwards, plus the `tags` the containers draw — and no action block or
 *   member declares `outcomeMessages`.
 * - §4 ADMITTED IMPLIES DRAWN: every report the member admits is one the drill
 *   drawer draws (`isDatasetBoundReport`, restated from objectui below), over
 *   every report shape this file writes; the remaining difference runs one way
 *   only, and is pinned as such.
 * - §5 THE REGISTRATION: the ADR-0087 D3 entries step 18 carries.
 *
 * The enumeration pin (`component-props-unknown-members.pin.test.ts`) holds the
 * other half: the three fork lines left its ledger, so a member reverted to
 * `z.unknown()` reds there, and its §6 pins that no member is staged.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import {
  ActionButtonPropsSchema,
  ActionGroupPropsSchema,
  ActionIconPropsSchema,
  ActionMenuPropsSchema,
  ComponentPropsMap,
  ObjectMetricPropsSchema,
  ObjectTimelinePropsSchema,
} from './component.zod';
import { ReportSchema } from './report.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

type Row = 'object-metric' | 'object-timeline' | 'action:group' | 'action:menu';
const BASE: Record<Row, Record<string, unknown>> = {
  'object-metric': { objectName: 'deal' },
  'object-timeline': { objectName: 'event' },
  'action:group': {},
  'action:menu': {},
};
const parse = (row: Row, props: Record<string, unknown>) =>
  ComponentPropsMap[row].safeParse({ ...BASE[row], ...props });

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}
const firstMessage = (result: z.ZodSafeParseResult<unknown>): string =>
  (result.success ? '' : result.error.issues[0]!.message);

/** The element schema of an optional array member, or the member itself, unwrapped. */
function inner(member: unknown): { shape?: Record<string, unknown>; _zod: { def: unknown } } {
  let s = member as { unwrap?: () => unknown; element?: unknown };
  while (typeof s.unwrap === 'function') s = s.unwrap() as typeof s;
  if (s.element) s = s.element as typeof s;
  while (typeof s.unwrap === 'function') s = s.unwrap() as typeof s;
  return s as ReturnType<typeof inner>;
}
const keysOf = (member: unknown): string[] => Object.keys(inner(member).shape ?? {}).sort();

/** The drawn report drill, as objectui's member pin mounts it (`objectMetricDrillDownMembers-8071.test.tsx:281`). */
const SUMMARY_REPORT = { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] };
/** A matrix drill with its own scope filter (objectui `drill-down-config-mirror-7352.test.ts:108`). */
const MATRIX_REPORT = {
  name: 'pipeline', label: 'Pipeline', type: 'matrix', dataset: 'opportunity_ds',
  rows: ['stage'], columns: ['owner'], values: ['amount_sum'], runtimeFilter: { region: 'emea' },
};
/** A joined drill, every block bound — the shape of the showcase's `TaskOverviewReport`. */
const JOINED_REPORT = {
  name: 'task_overview', label: 'Task overview', type: 'joined',
  blocks: [
    { name: 'by_status', type: 'summary', dataset: 'task_ds', rows: ['status'], values: ['task_count'] },
    { name: 'by_owner', type: 'summary', dataset: 'task_ds', rows: ['owner'], values: ['task_count'] },
  ],
};
/** A tabular drill with no `type` (`tabular` is `ReportSchema`'s default). */
const TABULAR_REPORT = { name: 'won_deals', label: 'Won deals', dataset: 'deals_ds', values: ['amount_sum'] };

// ───────────────────────────────────────────────────────────────────────────
// §1 the declared shapes parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each member accepts every shape a measured writer authors', () => {
  describe('object-metric drillDown.report — to exactly what ReportSchema answers', () => {
    for (const [label, report] of [
      ['a summary report (objectui\'s drawn drill)', SUMMARY_REPORT],
      ['a matrix report with its own runtime filter', MATRIX_REPORT],
      ['a joined report, every block bound', JOINED_REPORT],
      ['a tabular report with no `type`', TABULAR_REPORT],
    ] as const) {
      it(`parses ${label}`, () => {
        const r = parse('object-metric', { drillDown: { enabled: true, report } });
        expect(issues(r)).toEqual([]);
        expect(r.success && (r.data as { drillDown?: unknown }).drillDown)
          .toStrictEqual({ enabled: true, report: ReportSchema.parse(report) });
      });
    }
  });

  const BYTE_IDENTICAL: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>]> = [
    // This package's navigation test (`component-element-navigation-17987.test.ts:213`).
    ['a feed entry', 'object-timeline', { variant: 'vertical', items: [{ title: 'Kickoff', time: '2026-01-15' }] }],
    // objectui `plugin-timeline/src/ObjectTimeline.absentDateAxisRefusal-7459.test.tsx:216`, on the default variant.
    ['feed entries with descriptions, on the default variant', 'object-timeline', {
      items: [
        { time: '2024-01-15', title: 'Project Started', description: 'Kickoff' },
        { time: '2024-02-01', title: 'First Milestone', description: 'Design done' },
      ],
    }],
    // objectui `ObjectTimeline.fetchGate-7895.test.tsx:189`.
    ['a date-time feed entry', 'object-timeline', { items: [{ title: 'Ship it', time: '2026-01-01T09:00:00Z' }] }],
    ['a horizontal feed entry with every member', 'object-timeline', {
      variant: 'horizontal',
      items: [{
        time: '2026-02-01', title: 'Release', description: 'v2', variant: 'success', icon: '🚀', className: 'font-bold',
        content: [{ type: 'element:text', properties: { content: 'Shipped' } }],
      }],
    }],
    // objectui `plugin-timeline/src/__tests__/timeline-object-bound-gantt-refusal.test.tsx:219`.
    ['gantt rows', 'object-timeline', {
      variant: 'gantt',
      items: [
        {
          label: 'Backend Development',
          items: [
            { title: 'API Design', startDate: '2024-01-01', endDate: '2024-01-31', variant: 'success' },
            { title: 'Implementation', startDate: '2024-02-01', endDate: '2024-03-31', variant: 'info' },
          ],
        },
        { label: 'Frontend Development', items: [{ title: 'UI Design', startDate: '2024-01-15', endDate: '2024-02-15' }] },
      ],
    }],
    ['a gantt bar in epoch milliseconds', 'object-timeline', {
      variant: 'gantt', items: [{ label: 'R', items: [{ title: 'T', startDate: 1704067200000, endDate: 1706659200000 }] }],
    }],
    // objectui `timeline-gantt-empty-items.test.tsx:107` and an empty row.
    ['no gantt rows', 'object-timeline', { variant: 'gantt', items: [] }],
    ['a gantt row with no bars yet', 'object-timeline', { variant: 'gantt', items: [{ label: 'Later' }] }],
    // objectui `components/src/__tests__/action-group.test.tsx:33`, `action-bodyShape-forward.test.tsx:120`.
    ['members placed by location', 'action:group', {
      actions: [
        { name: 'here', label: 'Here', type: 'script', locations: ['list_toolbar'] },
        { name: 'elsewhere', label: 'Elsewhere', type: 'script', locations: ['record_header'] },
      ],
    }],
    ['an api member with a body shape', 'action:group', {
      actions: [{ type: 'api', name: 'update_organization', label: 'Save organization', target: '/api/v1/auth/organization/update', bodyShape: { wrap: 'data' } }],
    }],
    // objectui `action-group-menu-inputs-11168.test.tsx:249`, `:273` — the member's own gates, variant and size.
    ['members gated, styled and sized', 'action:group', {
      size: 'sm',
      actions: [
        { name: 'shown', label: 'SHOWN', type: 'run' },
        { name: 'hidden', label: 'HIDDEN', type: 'run', visible: false },
        { name: 'greyed', label: 'GREYED', type: 'run', disabled: true },
        { name: 'loud', label: 'LOUD', type: 'run', variant: 'destructive', size: 'lg' },
        { name: 'alpha', label: 'ALPHA', type: 'run', variant: 'default', size: 'md' },
        { name: 'promoted', label: 'PROMOTED', type: 'run', variant: 'primary', size: 'icon' },
      ],
    }],
    // objectui `components/src/__tests__/action-bodyExtra-forward.test.tsx:116`.
    ['an api menu item with a request body', 'action:menu', {
      actions: [{ type: 'api', name: 'close_order', label: 'Close order', target: '/api/v1/order/close', bodyExtra: { status: 'closed' } }],
    }],
    // objectui `action-group-menu-inputs-11168.test.tsx:368`; this package's row test (`component-action-element-rows-20371.test.ts:161`).
    ['a destructive menu item below a separator', 'action:menu', {
      actions: [
        { name: 'archive', label: 'Archive', type: 'script' },
        { name: 'nameonly', type: 'run', tags: ['separator-before'], variant: 'destructive' },
      ],
    }],
    // objectui `types/src/__tests__/held-public-block-arms-10872.test.ts:188` / `:189`.
    ['a member acting on another object', 'action:menu', { actions: [{ name: 'log', objectName: 'task' }] }],
    ['a member with every forwarded scalar', 'action:menu', {
      actions: [{
        name: 'close_case', label: 'Close', icon: 'check', type: 'api', description: 'Close this case',
        target: '/api/close', openIn: 'self', method: 'POST', confirmText: 'Close it?', successMessage: 'Closed',
        errorMessage: 'Could not close', refreshAfter: true, locations: ['record_header'], objectName: 'case',
        params: [{ name: 'reason', label: 'Reason', type: 'text' }],
      }],
    }],
    ['no members', 'action:group', { actions: [] }],
  ];
  for (const [label, row, props] of BYTE_IDENTICAL) {
    it(`${row}: ${label} parses byte-identical`, () => {
      const r = parse(row, props);
      expect(issues(r)).toEqual([]);
      for (const key of Object.keys(props)) {
        expect(r.success && (r.data as Record<string, unknown>)[key]).toStrictEqual(props[key]);
      }
    });
  }

  it('a member\'s bare CEL `visible` normalizes to the canonical envelope, as on the rows', () => {
    const r = parse('action:group', { actions: [{ name: 'a', visible: "record.status == 'open'" }] });
    expect(issues(r)).toEqual([]);
    expect(r.success && (r.data as { actions: Array<{ visible?: unknown }> }).actions[0]!.visible)
      .toEqual({ dialect: 'cel', source: "record.status == 'open'" });
  });

  it('an absent member stays absent on every row', () => {
    for (const [row, path] of [
      ['object-metric', ['drillDown', 'report']],
      ['object-timeline', ['items']],
      ['action:group', ['actions']],
      ['action:menu', ['actions']],
    ] as const) {
      const props = path.length === 2 ? { drillDown: {} } : {};
      const r = parse(row, props);
      expect(issues(r), row).toEqual([]);
      const owner = path.length === 2 ? (r.success && (r.data as { drillDown: object }).drillDown) : (r.success && r.data);
      expect(owner, row).not.toHaveProperty(path[path.length - 1]!);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 an off-shape value is refused with the code and the path', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>, found: ReadonlyArray<{ code: string; path: string }>]> = [
    // The drill report.
    ['a bare report name', 'object-metric', { drillDown: { report: 'pipeline' } }, [{ code: 'invalid_type', path: 'drillDown.report' }]],
    ['a report with no dataset', 'object-metric', { drillDown: { report: { name: 'pipeline', label: 'Pipeline', values: ['amount_sum'] } } },
      [{ code: 'custom', path: 'drillDown.report.dataset' }]],
    ['a joined report with an unbound block', 'object-metric', {
      drillDown: { report: { ...JOINED_REPORT, blocks: [JOINED_REPORT.blocks[0], { name: 'notes', type: 'tabular' }] } },
    }, [{ code: 'custom', path: 'drillDown.report.blocks.1.dataset' }]],
    // objectui `objectMetricDrillDownMembers-8071.test.tsx:305` — its two probes the drawer does not draw.
    ['the retired `objectName` report', 'object-metric', { drillDown: { report: { name: 'pipeline', label: 'Pipeline', objectName: 'deal', columns: [] } } },
      [{ code: 'unrecognized_keys', path: 'drillDown.report' }]],
    ['a value that is no report', 'object-metric', { drillDown: { report: { name: 'note', label: 'Note', note: 'not a report' } } },
      [{ code: 'unrecognized_keys', path: 'drillDown.report' }]],
    // The timeline entries.
    ['a number for items', 'object-timeline', { items: 42 }, [{ code: 'invalid_type', path: 'items' }]],
    ['a bare string entry', 'object-timeline', { items: ['Kickoff'] }, [{ code: 'invalid_type', path: 'items.0' }]],
    ['a null entry', 'object-timeline', { items: [null] }, [{ code: 'invalid_type', path: 'items.0' }]],
    ['a feed entry with no title', 'object-timeline', { items: [{ time: '2026-01-15' }] }, [{ code: 'custom', path: 'items.0.title' }]],
    ['a gantt row on a feed timeline', 'object-timeline', { items: [{ label: 'R', items: [] }] }, [
      { code: 'custom', path: 'items.0.title' },
      { code: 'custom', path: 'items.0.label' },
      { code: 'custom', path: 'items.0.items' },
    ]],
    ['a feed entry on a gantt timeline', 'object-timeline', { variant: 'gantt', items: [{ title: 'Kickoff', time: '2026-01-15' }] }, [
      { code: 'custom', path: 'items.0.label' },
      { code: 'custom', path: 'items.0.time' },
      { code: 'custom', path: 'items.0.title' },
    ]],
    ['a marker colour on a gantt row', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', variant: 'info' }] },
      [{ code: 'custom', path: 'items.0.variant' }]],
    ['a marker colour outside the five', 'object-timeline', { items: [{ title: 'A', variant: 'todo' }] },
      [{ code: 'invalid_value', path: 'items.0.variant' }]],
    ['a record-composed `color`', 'object-timeline', { items: [{ title: 'A', color: 'red' }] }, [{ code: 'unrecognized_keys', path: 'items.0' }]],
    ['a feed entry dated `startDate`', 'object-timeline', { items: [{ title: 'A', startDate: '2026-01-15' }] },
      [{ code: 'unrecognized_keys', path: 'items.0' }]],
    ['a non-array set of bars', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: { title: 'T' } }] },
      [{ code: 'invalid_type', path: 'items.0.items' }]],
    ['a null bar', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: [null] }] },
      [{ code: 'invalid_type', path: 'items.0.items.0' }]],
    // objectui `timeline-gantt-date-spelling-6907.test.tsx:338`, `timeline-gantt-date-type-rule-6781.test.tsx:419`,
    // `timeline-gantt-null-date-6770.test.tsx:220` — its render-time date diagnostic's probes.
    ['an array bar date', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: [{ startDate: '2024-01-01', endDate: ['2024-01-01'] }] }] },
      [{ code: 'invalid_union', path: 'items.0.items.0.endDate' }]],
    ['a boolean bar date', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: [{ startDate: '2024-01-01', endDate: false }] }] },
      [{ code: 'invalid_union', path: 'items.0.items.0.endDate' }]],
    ['a null bar date', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: [{ startDate: '2024-01-01', endDate: null }] }] },
      [{ code: 'invalid_union', path: 'items.0.items.0.endDate' }]],
    ['an infinite bar date', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: [{ startDate: Number.POSITIVE_INFINITY }] }] },
      [{ code: 'invalid_union', path: 'items.0.items.0.startDate' }]],
    ['a bar `color`', 'object-timeline', { variant: 'gantt', items: [{ label: 'R', items: [{ title: 'T', color: 'red' }] }] },
      [{ code: 'unrecognized_keys', path: 'items.0.items.0' }]],
    // The container members.
    ['a node-style `actionType` on a member', 'action:group', { actions: [{ name: 'a', actionType: 'url' }] },
      [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    ['a member `endpoint`', 'action:group', { actions: [{ name: 'a', type: 'api', endpoint: '/api/a' }] },
      [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    // objectui `action-outcomeMessages-forward-11344.test.tsx:147` — the forward probe.
    ['a member `outcomeMessages`', 'action:group', { actions: [{ name: 'a', type: 'script', outcomeMessages: { archived: 'Archived' } }] },
      [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    // objectui `action-group-menu-inputs-11168.test.tsx:249` — the member pin's `className`.
    ['a member `className`', 'action:group', { actions: [{ name: 'a', className: 'member-class' }] },
      [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    // objectui `action-container-member-params-10290.test.tsx:182` — the static-values probe.
    ['a member `properties.params`', 'action:menu', { actions: [{ name: 'edit', type: 'navigate_edit', properties: { params: { recordId: 'r1' } } }] },
      [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    ['a member `enabled`', 'action:menu', { actions: [{ name: 'a', enabled: false }] }, [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    // objectui `action-overflow-autotrigger.test.tsx:298` — the host's transport flag.
    ['a member `autoTrigger`', 'action:menu', { actions: [{ name: 'a', type: 'api', autoTrigger: true }] },
      [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    ['an `action:menu` item `size`', 'action:menu', { actions: [{ name: 'a', size: 'sm' }] }, [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    ['an `undoable` member', 'action:group', { actions: [{ name: 'a', undoable: true }] }, [{ code: 'unrecognized_keys', path: 'actions.0' }]],
    ['a member size outside the primitive\'s', 'action:group', { actions: [{ name: 'a', size: 'xl' }] }, [{ code: 'invalid_value', path: 'actions.0.size' }]],
    ['a tag no container draws', 'action:menu', { actions: [{ name: 'a', tags: ['separator-after'] }] }, [{ code: 'invalid_value', path: 'actions.0.tags.0' }]],
    ['a non-string executor', 'action:menu', { actions: [{ name: 'a', type: 5 }] }, [{ code: 'invalid_type', path: 'actions.0.type' }]],
  ];
  for (const [label, row, props, found] of REFUSED) {
    it(`${row}: refuses ${label}`, () => {
      const r = parse(row, props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual(found);
    });
  }

  it('the pairing names the arm the row\'s `variant` selects, and the default', () => {
    expect(firstMessage(parse('object-timeline', { items: [{ time: '2026-01-15' }] })))
      .toMatch(/`title` is required on a feed entry: `variant: 'vertical'` \(the default\) draws feed entries/);
    expect(firstMessage(parse('object-timeline', { variant: 'gantt', items: [{ title: 'A' }] })))
      .toMatch(/`label` is required on a gantt row: `variant: 'gantt'` draws gantt rows `\{ label, items \}`/);
  });

  it('each refused member key carries what to write instead', () => {
    const message = (row: Row, member: Record<string, unknown>) => firstMessage(parse(row, { actions: [member] }));
    expect(message('action:group', { name: 'a', actionType: 'url' })).toMatch(/`type`/);
    expect(message('action:group', { name: 'a', endpoint: '/x' })).toMatch(/`target`/);
    expect(message('action:menu', { name: 'a', outcomeMessages: {} })).toMatch(/Write the success toast as `successMessage`/);
    expect(message('action:group', { name: 'a', className: 'x' })).toMatch(/Style it with its `variant`/);
    expect(message('action:menu', { name: 'a', properties: {} })).toMatch(/write `bodyExtra`/);
    expect(message('action:menu', { name: 'a', enabled: true })).toMatch(/write `disabled` instead/);
    expect(message('action:menu', { name: 'a', autoTrigger: true })).toMatch(/run the action on every page load/);
    // The group never reads `autoTrigger`, and its prescription says so.
    expect(message('action:group', { name: 'a', autoTrigger: true })).toMatch(/does not read it at all/);
    expect(message('action:menu', { name: 'a', size: 'sm' })).toMatch(/reads no `size`/);
    // CONTROL: a member key with no prescription gets none of these.
    expect(message('action:group', { name: 'a', bogus: 1 })).not.toMatch(/successMessage|bodyExtra|`variant`/);
  });

  it('a record-composed timeline key is told what an authored entry writes', () => {
    expect(firstMessage(parse('object-timeline', { items: [{ title: 'A', color: 'red' }] }))).toMatch(/is `variant`/);
    expect(firstMessage(parse('object-timeline', { items: [{ title: 'A', startDate: 'x' }] }))).toMatch(/a feed entry's date is `time`/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one vocabulary
// ───────────────────────────────────────────────────────────────────────────

describe('§3 each shape is the declaration the ruling names', () => {
  it('the drill report IS ReportSchema — the same def, not a copy', () => {
    const report = inner(ObjectMetricPropsSchema.shape.drillDown).shape!.report;
    expect(inner(report)._zod.def).toBe(inner(ReportSchema)._zod.def);
  });

  it('a timeline entry declares exactly objectui\'s two arms, and a bar its four keys', () => {
    const item = ObjectTimelinePropsSchema.shape.items;
    // `TimelineFeedItem`'s seven and `TimelineGanttItem`'s two.
    expect(keysOf(item)).toEqual(['className', 'content', 'description', 'icon', 'items', 'label', 'time', 'title', 'variant']);
    expect(keysOf(inner(item).shape!.items)).toEqual(['endDate', 'startDate', 'title', 'variant']);
  });

  it('a container member declares `action:button`\'s keys by `type` — less the two no container forwards, plus `tags`', () => {
    const button = Object.keys(ActionButtonPropsSchema.shape)
      .map((key) => (key === 'actionType' ? 'type' : key))
      .filter((key) => key !== 'undoable' && key !== 'recordIdField');
    const group = [...button, 'tags'].sort();
    expect(keysOf(ActionGroupPropsSchema.shape.actions)).toEqual(group);
    // An `action:menu` item reads no `size` — the one difference between the two.
    expect(keysOf(ActionMenuPropsSchema.shape.actions)).toEqual(group.filter((key) => key !== 'size'));
  });

  it('no action block and no container member declares `outcomeMessages` — one decision, all four alike', () => {
    for (const [label, keys] of [
      ['action:button', Object.keys(ActionButtonPropsSchema.shape)],
      ['action:icon', Object.keys(ActionIconPropsSchema.shape)],
      ['action:group', Object.keys(ActionGroupPropsSchema.shape)],
      ['action:menu', Object.keys(ActionMenuPropsSchema.shape)],
      ['an action:group member', keysOf(ActionGroupPropsSchema.shape.actions)],
      ['an action:menu member', keysOf(ActionMenuPropsSchema.shape.actions)],
    ] as const) {
      expect(keys, label).not.toContain('outcomeMessages');
    }
  });

  it('a member\'s `visible` / `disabled` take the rows\' own condition — the same accept set', () => {
    const member = inner(ActionGroupPropsSchema.shape.actions).shape!;
    for (const key of ['visible', 'disabled'] as const) {
      const row = ActionButtonPropsSchema.shape[key];
      for (const value of [true, false, "record.status == 'open'", { dialect: 'cel', source: 'x == 1' }, '', 5, { dialect: 'cel' }]) {
        const a = (member[key] as z.ZodType).safeParse(value);
        const b = row.safeParse(value);
        expect(a.success, `${key} ${JSON.stringify(value)}`).toBe(b.success);
        if (a.success && b.success) expect(a.data).toStrictEqual(b.data);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 admitted implies drawn
// ───────────────────────────────────────────────────────────────────────────

/**
 * objectui `plugin-dashboard/src/DrillDownDrawer.tsx:92-99` at the
 * `.objectui-sha` pin `2e818d0b51ec`, restated: the drawer draws a drill report
 * as a report exactly when it holds, and lists the records otherwise. The
 * drawer reads the value as written — a page component's `properties` is
 * never parsed on the way.
 */
function isDatasetBoundReport(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r = report as { dataset?: unknown; type?: unknown; blocks?: unknown };
  if (typeof r.dataset === 'string' && r.dataset.length > 0) return true;
  return r.type === 'joined'
    && Array.isArray(r.blocks)
    && r.blocks.some((b) => typeof (b as { dataset?: unknown } | null)?.dataset === 'string');
}

describe('§4 every report the member admits is one the drill drawer draws', () => {
  const block = (name: string, dataset?: string) => ({ name, type: 'summary', ...(dataset ? { dataset } : {}), rows: ['stage'], values: ['amount_sum'] });
  const CANDIDATES: ReadonlyArray<readonly [label: string, report: unknown]> = [
    ['a summary report', SUMMARY_REPORT],
    ['a matrix report', MATRIX_REPORT],
    ['a joined report, every block bound', JOINED_REPORT],
    ['a tabular report with no `type`', TABULAR_REPORT],
    ['a joined report, one block of two unbound', { name: 'two', label: 'Two', type: 'joined', blocks: [block('a', 'ds'), block('b')] }],
    ['a joined report, no block bound', { name: 'none', label: 'None', type: 'joined', blocks: [block('a'), block('b')] }],
    ['a joined report with no blocks', { name: 'empty', label: 'Empty', type: 'joined', blocks: [] }],
    ['a joined report with a container dataset', { name: 'cont', label: 'Cont', type: 'joined', dataset: 'ds', blocks: [block('a', 'ds')] }],
    ['a report with no name or label', { dataset: 'deals_ds', values: ['amount_sum'] }],
    ['a summary report with no values', { name: 'nv', label: 'No values', type: 'summary', dataset: 'deals_ds', rows: ['stage'] }],
    ['a report with no dataset', { name: 'nd', label: 'No dataset', values: ['amount_sum'] }],
    ['the retired `objectName` report', { name: 'pipeline', label: 'Pipeline', objectName: 'deal', columns: [] }],
    ['a bare report name', 'pipeline'],
    ['a `{ name }` reference', { name: 'pipeline' }],
  ];

  it('admitted ⇒ drawn, over every candidate', () => {
    const admittedNotDrawn = CANDIDATES
      .filter(([, report]) => parse('object-metric', { drillDown: { report } }).success && !isDatasetBoundReport(report))
      .map(([label]) => label);
    expect(admittedNotDrawn).toEqual([]);
  });

  it('LIT CONTROL: the member admits the four writer shapes, so the implication above is not vacuous', () => {
    const admitted = CANDIDATES.filter(([, report]) => parse('object-metric', { drillDown: { report } }).success).map(([label]) => label);
    expect(admitted).toEqual([
      'a summary report',
      'a matrix report',
      'a joined report, every block bound',
      'a tabular report with no `type`',
    ]);
  });

  it('the remaining difference runs one way: the drawer also draws incomplete reports the member refuses', () => {
    const drawnNotAdmitted = CANDIDATES
      .filter(([, report]) => isDatasetBoundReport(report) && !parse('object-metric', { drillDown: { report } }).success)
      .map(([label]) => label);
    expect(drawnNotAdmitted).toEqual([
      'a joined report, one block of two unbound',
      'a joined report with a container dataset',
      'a report with no name or label',
      'a summary report with no values',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §5 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§5 each narrowing is registered as the ADR-0087 D3 entry step 18 carries', () => {
  const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
  it.each([
    'ui-object-metric-drill-down-report-typed',
    'ui-object-timeline-items-typed',
    'ui-action-group-menu-members-typed',
  ])('%s', (id) => {
    expect(ids).toContain(id);
  });
});
