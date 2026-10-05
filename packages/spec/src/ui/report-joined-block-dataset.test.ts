// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21702] Every block of a `joined` report binds a `dataset`.
 *
 * `ReportSchema`'s refinement comment and `content/docs/ui/reports.mdx` both
 * said a joined report's blocks are "each block dataset-bound", while the joined
 * arm only required `blocks` to be non-empty and `JoinedReportBlockSchema.dataset`
 * is optional — so a block with no `dataset` parsed, passed `objectstack
 * validate` and every save door, and drew nothing (the joined renderer queries
 * nothing for it; a report whose blocks all lack one falls through to the pre-9.0
 * presentation bridge). The joined arm now refuses each such block at
 * `blocks[i].dataset`, naming the block, with the prescription "bind the block to
 * a dataset".
 *
 * Every refusal asserts the envelope a schema door owes — the issue `code` and
 * its `path` — plus the message's first sentence and its prescription.
 * The preservation pins hold the two real joined reports measured at the
 * census: the showcase `TaskOverviewReport` (mirrored below, as the reports
 * guide mirrors it) and a fixture shaped like hotcrm's `customer_churn_signals`
 * (hotcrm `4054ec26`, `src/sales/reports/churn.report.ts`). Both bind every
 * block and parse exactly as before.
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { reportForm } from './report.form';
import { JoinedReportBlockSchema, ReportSchema, defineReport } from './report.zod';

const ENTRY_ID = 'ui-report-joined-block-dataset-required';

/** The refusal's first sentence for a block named `name`. */
const FIRST_SENTENCE = (name: string) =>
  `a \`joined\` report draws each block from that block's own \`dataset\`, and block \`${name}\` binds none, `
  + 'so nothing queries it and it draws no rows.';
const PRESCRIPTION = 'Bind the block to a dataset:';

interface IssueSig { code: string; path: string; message: string }

const issuesOf = (r: { success: boolean; error?: { issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }> } }): IssueSig[] =>
  (r.error?.issues ?? []).map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));

/** The triage probe's report: two blocks, each only a name and a label. */
const PROBE = {
  name: 'probe_joined',
  label: 'Probe',
  type: 'joined',
  blocks: [
    { name: 'first_block', label: 'First' },
    { name: 'second_block', label: 'Second' },
  ],
} as const;

const BOUND = { name: 'open_block', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'] } as const;

describe('a joined report refuses a block that binds no dataset', () => {
  it('the probe report is refused once per block, at blocks.N.dataset, naming each block', () => {
    const issues = issuesOf(ReportSchema.safeParse(PROBE));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', 'blocks.0.dataset'],
      ['custom', 'blocks.1.dataset'],
    ]);
    expect(issues[0]!.message.startsWith(FIRST_SENTENCE('first_block')), issues[0]!.message).toBe(true);
    expect(issues[1]!.message.startsWith(FIRST_SENTENCE('second_block')), issues[1]!.message).toBe(true);
    for (const issue of issues) expect(issue.message).toContain(PRESCRIPTION);
  });

  it('a bound block beside an unbound one: only the unbound block is refused, at its own index', () => {
    const issues = issuesOf(ReportSchema.safeParse({ ...PROBE, blocks: [BOUND, { name: 'done_block', label: 'Done' }] }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', 'blocks.1.dataset']]);
    expect(issues[0]!.message.startsWith(FIRST_SENTENCE('done_block'))).toBe(true);
  });

  it('a block whose name is empty is named by its position, and both issues are reported', () => {
    const issues = issuesOf(ReportSchema.safeParse({ ...PROBE, blocks: [BOUND, { name: '' }] }));
    const datasetIssue = issues.find((i) => i.path === 'blocks.1.dataset');
    expect(datasetIssue?.code).toBe('custom');
    expect(datasetIssue!.message).toContain('and `blocks[1]` binds none');
    expect(issues.some((i) => i.path === 'blocks.1.name'), 'the empty name keeps its own issue').toBe(true);
  });

  it('it joins the other joined-arm refusals rather than replacing them', () => {
    const issues = issuesOf(ReportSchema.safeParse({ ...PROBE, blocks: [{ name: 'first_block' }], dataset: 'tasks' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', 'blocks.0.dataset'],
      ['custom', 'dataset'],
    ]);
  });

  it('taking the advice parses — the same blocks, each bound to a dataset', () => {
    const r = ReportSchema.safeParse({
      ...PROBE,
      blocks: PROBE.blocks.map((b) => ({ ...b, dataset: 'tasks', values: ['task_count'] })),
    });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  it('CONTROL: a block on a NON-joined report is not judged by this arm — `blocks` is read on a joined report only', () => {
    const r = ReportSchema.safeParse({
      name: 'hours', label: 'Hours', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'],
      blocks: [{ name: 'first_block' }],
    });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  it('CONTROL: the block shape alone still parses a block with no dataset — the requirement lives on the joined arm', () => {
    const r = JoinedReportBlockSchema.safeParse({ name: 'first_block', label: 'First' });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

describe('every door that parses a report refuses it', () => {
  const stackWith = (reports: unknown[]) => ({
    manifest: { id: 'com.example.reports', name: 'reports', version: '1.0.0', type: 'app', namespace: 'rjb' },
    reports,
  });
  const boundProbe = { ...PROBE, name: 'bound_probe', blocks: [BOUND] };

  it('defineReport throws the refusal', () => {
    expect(() => defineReport(PROBE as never)).toThrow(FIRST_SENTENCE('first_block'));
  });

  it('the registered `report` type schema — what the metadata save door validates against — refuses it', () => {
    const saveDoor = getMetadataTypeSchema('report');
    expect(saveDoor, 'the `report` metadata type must resolve a schema').toBeDefined();
    const issues = issuesOf(saveDoor!.safeParse(PROBE) as never);
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', 'blocks.0.dataset'],
      ['custom', 'blocks.1.dataset'],
    ]);
    // CONTROL: the same door accepts the bound report.
    expect(saveDoor!.safeParse(boundProbe).success).toBe(true);
  });

  it('ObjectStackDefinitionSchema — the stack parse `objectstack validate` runs — refuses it at reports.N.blocks.M.dataset', () => {
    const refused = ObjectStackDefinitionSchema.safeParse(stackWith([boundProbe, PROBE]));
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'))).toEqual([
      'reports.1.blocks.0.dataset',
      'reports.1.blocks.1.dataset',
    ]);
    // CONTROL: the same parse accepts the bound report alone.
    expect(ObjectStackDefinitionSchema.safeParse(stackWith([boundProbe])).success).toBe(true);
  });

  it('defineStack wraps the refusal in its ADR-0112 envelope', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith([PROBE]) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the unbound joined report').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'reports.0.blocks.0.dataset', code: 'custom' },
      { path: 'reports.0.blocks.1.dataset', code: 'custom' },
    ]);
    // CONTROL: the bound report is accepted at the same door.
    expect(() => defineStack(stackWith([boundProbe]) as never)).not.toThrow();
  });
});

describe('the joined reports measured at the census parse unchanged', () => {
  /** `examples/app-showcase/src/ui/reports/index.ts` `TaskOverviewReport`, byte for byte. */
  const TASK_OVERVIEW = {
    name: 'showcase_task_overview',
    label: 'Task Overview (Joined)',
    description: 'Multiple task sub-reports stacked into one joined view.',
    type: 'joined',
    drilldown: true,
    blocks: [
      {
        name: 'open_block',
        label: 'Open Tasks',
        type: 'summary',
        dataset: 'showcase_task_metrics',
        rows: ['status'],
        values: ['est_hours'],
        runtimeFilter: { done: false },
      },
      {
        name: 'done_block',
        label: 'Completed Tasks',
        type: 'summary',
        dataset: 'showcase_task_metrics',
        rows: ['status'],
        values: ['task_count'],
        runtimeFilter: { done: true },
      },
    ],
  } as const;

  /** Shaped like hotcrm `customer_churn_signals`: four summary blocks over two datasets, no container scope. */
  const CHURN_SIGNALS = {
    name: 'customer_churn_signals',
    label: 'Customer Churn Signals',
    description: 'Three-panel early-warning view: at-risk customers, silent high-value accounts, and recently-lost opportunities.',
    type: 'joined',
    blocks: [
      {
        name: 'csm_flagged_accounts',
        label: 'CSM-Flagged Accounts',
        description: 'Accounts a CSM has hand-flagged as at-risk or churning, grouped by type.',
        type: 'summary',
        dataset: 'account_metrics', rows: ['type'], values: ['account_count'],
        runtimeFilter: { is_active: true, health_score: { $in: ['at_risk', 'churning'] } },
      },
      {
        name: 'at_risk_accounts',
        label: 'At-Risk Accounts',
        type: 'summary',
        dataset: 'account_metrics', rows: ['industry'], values: ['account_count'],
        runtimeFilter: { is_active: true, last_activity_date: { $lt: '{60_days_ago}' } },
      },
      {
        name: 'silent_high_value',
        label: 'Silent High-Value Accounts',
        type: 'summary',
        dataset: 'account_metrics', rows: ['type'], values: ['account_count'],
        runtimeFilter: { is_active: true, tier: { $in: ['strategic', 'enterprise'] }, last_activity_date: { $lt: '{90_days_ago}' } },
      },
      {
        name: 'recently_closed_lost',
        label: 'Recently Lost Opportunities',
        type: 'summary',
        dataset: 'opportunity_metrics', rows: ['owner'], values: ['total_amount', 'opp_count'],
        runtimeFilter: { stage: 'closed_lost', close_date: { $gte: '{30_days_ago}' } },
      },
    ],
  } as const;

  it('the showcase TaskOverviewReport parses, and the parse is the input itself', () => {
    const r = ReportSchema.safeParse(TASK_OVERVIEW);
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(r.data).toEqual(TASK_OVERVIEW);
  });

  it('the hotcrm-shaped customer_churn_signals parses, gaining only the `drilldown` default', () => {
    const r = ReportSchema.safeParse(CHURN_SIGNALS);
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect(r.data).toEqual({ ...CHURN_SIGNALS, drilldown: true });
  });
});

describe('the report form offers a block\'s `dataset` as the dataset picker, marked required (#21714)', () => {
  it('the "Joined blocks" repeater\'s `dataset` row declares `widget: \'ref:dataset\'` and `required: true`', () => {
    // Studio's report inspector renders this row spec: the widget hint picks
    // the cell's control, and `required` draws the column's marker and the
    // cell's `aria-required`. Without both, a new block is a free-text cell the
    // refusal above rejects on save.
    const blocks = (reportForm.sections as any[])
      .flatMap((s) => s.fields ?? [])
      .find((f: any) => f?.field === 'blocks');
    expect(blocks?.type).toBe('repeater');
    const row = (blocks.fields as any[]).find((f) => f?.field === 'dataset');
    expect(row?.widget).toBe('ref:dataset');
    expect(row?.required).toBe(true);
  });
});

describe('the ADR-0087 ledger', () => {
  it('registers one D3 entry at protocol 18, with no D2 conversion, prescribing the binding', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries, 'the narrowing needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.conversionIds ?? []).toEqual([]);
    expect(entry!.replacement).toContain(PRESCRIPTION);
    expect(entry!.acceptanceCriteria).toContain('blocks.N.dataset');
  });

  it('step 18\'s rationale names the entry', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toContain(`Its D3 record is the semantic entry \`${ENTRY_ID}\`.`);
  });

  it('registers no tombstone: `dataset` stays declared on the block', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => /JoinedReportBlock:dataset$/.test(k))).toEqual([]);
    // CONTROL: the flattened table is the real one — it carries a known step-18 tombstone.
    expect(all).toContain('api/RestApiEndpoint:timeout');
  });
});
