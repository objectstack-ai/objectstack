// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Ruling 7076440876 (objectstack#35979, option A) — every step a docs flow
// embed draws joins the flow bucket.
//
// The docs viewer's `type: flow` embed (`element:metadata_viewer`) lists a
// flow's steps by label for a manual's reader, at `detail: business` by
// default: every top-level node whose type `isFlowTechnicalNodeType` does not
// fold away, and, in a decision's branch list, the step each branch leads to,
// a folded one included. A screen's and an approval's label were keyed already; a start,
// decision, notify or end step had no key, so a zh-CN manual named them in
// English under a green coverage run. These pins are the CLI half: the walker
// scaffolds `flows.<flow>.nodes.<node_id>.label` for exactly the named steps
// that have no other key, and the coverage gate demands it.
//
// The ledger mock is `i18n-flow-screen-coverage.test.ts`'s, for its reason:
// these pins measure the bucket itself, whatever the shipped ledger says next.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries } from '../src/utils/i18n-bundle-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { FLOW_TECHNICAL_NODE_TYPES } from '@objectstack/spec/automation';
import { TranslationDataSchema } from '@objectstack/spec/system';

/**
 * HotCRM's measured `opportunity_approval` shape, trimmed: a start, a
 * decision, two approvals, notifies, a technical record write and an end —
 * plus a screen and a loop whose nested notify the embed does not draw.
 */
const opportunityApproval = {
  name: 'opportunity_approval',
  label: 'Large Deal Approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_opportunity', triggerType: 'record-after-update' } },
    { id: 'manager_review', type: 'approval', label: 'Sales Manager Review', config: { approvers: [{ type: 'manager' }] } },
    { id: 'high_value', type: 'decision', label: 'High Value (> $500K)?' },
    { id: 'director_signoff', type: 'approval', label: 'Sales Director Sign-off', config: { approvers: [{ type: 'manager' }] } },
    { id: 'notify_owner', type: 'notify', label: 'Notify Owner' },
    { id: 'mark_approved', type: 'update_record', label: 'Mark Approved', config: { objectName: 'crm_opportunity', fields: {} } },
    { id: 'confirm', type: 'screen', label: 'Confirm', config: { fields: [{ name: 'ok', label: 'OK' }] } },
    {
      id: 'each_line',
      type: 'loop',
      label: 'Each Line',
      config: { collection: '{lines}', body: { nodes: [{ id: 'tell_rep', type: 'notify', label: 'Tell Rep' }] } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [],
};

const nodeKeys = (config: any) =>
  collectExpectedEntries(config)
    .filter((e) => e.path[0] === 'flows' && e.path[2] === 'nodes')
    .map((e) => e.path.join('.'));

describe('what the walker harvests for the steps a docs flow embed draws (ruling 7076440876)', () => {
  it('emits one label per drawn step with no other key, seeded with the authored text', () => {
    const entries = collectExpectedEntries({ flows: [opportunityApproval] }).filter(
      (e) => e.path[0] === 'flows' && e.path[2] === 'nodes',
    );
    expect(entries.map((e) => e.path.join('.'))).toEqual([
      'flows.opportunity_approval.nodes.start.label',
      'flows.opportunity_approval.nodes.high_value.label',
      'flows.opportunity_approval.nodes.notify_owner.label',
      'flows.opportunity_approval.nodes.each_line.label',
      'flows.opportunity_approval.nodes.end.label',
    ]);
    expect(entries[1]).toMatchObject({
      sourceValue: 'High Value (> $500K)?',
      inline: 'High Value (> $500K)?',
      source: 'flow',
      flowName: 'opportunity_approval',
    });
  });

  it('asks nothing for a technical step no branch names, whichever type the shared table folds away', () => {
    const flow = {
      name: 'plumbing',
      label: 'Plumbing',
      nodes: FLOW_TECHNICAL_NODE_TYPES.map((type) => ({ id: `n_${type}`, type, label: type })),
      edges: [],
    };
    expect(nodeKeys({ flows: [flow] })).toEqual([]);
  });

  it("asks for a folded technical step where a drawn decision's branch list names it, once, and for no other", () => {
    // Shaped on app-todo's `task.flow.ts`: `check_recurring` branches to the `compute_next_due_date` script.
    const flow = {
      name: 'recurring',
      label: 'Recurring',
      nodes: [
        { id: 'check', type: 'decision', label: 'Recurring?' },
        { id: 'compute', type: 'script', label: 'Compute Next Due Date' },
        { id: 'save', type: 'update_record', label: 'Save' },
        {
          id: 'gate',
          type: 'decision',
          label: 'Gate',
          config: { conditions: [{ label: 'Yes', expression: 'vars.ok' }] },
        },
        { id: 'call', type: 'http', label: 'Call Out' },
        { id: 'stray', type: 'assignment', label: 'Stray' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        // A decision with no `config.conditions` lists every out-edge.
        { id: 'e1', source: 'check', target: 'compute', condition: 'vars.recurring == true', label: 'Yes' },
        { id: 'e2', source: 'check', target: 'end', label: 'No' },
        // The same folded step named by a second branch is asked once.
        { id: 'e3', source: 'gate', target: 'compute', label: 'Yes' },
        // A default branch of a `conditions` decision is listed.
        { id: 'e4', source: 'gate', target: 'call', isDefault: true },
        // A labelled edge no condition claims is never a branch, so it names nothing.
        { id: 'e5', source: 'gate', target: 'stray', label: 'Maybe' },
        // A folded step that only a non-decision leads to is not named.
        { id: 'e6', source: 'compute', target: 'save' },
      ],
    };
    expect(nodeKeys({ flows: [flow] })).toEqual([
      'flows.recurring.nodes.check.label',
      'flows.recurring.nodes.gate.label',
      'flows.recurring.nodes.end.label',
      'flows.recurring.nodes.compute.label',
      'flows.recurring.nodes.call.label',
    ]);
    expect(
      collectExpectedEntries({ flows: [flow] }).find((e) => e.path.join('.') === 'flows.recurring.nodes.compute.label'),
    ).toMatchObject({ sourceValue: 'Compute Next Due Date', source: 'flow' });
  });

  it('asks for a titled screen\'s label exactly where its heading holds a hole, which the embed then draws it by', () => {
    const flow = {
      name: 'welcome',
      label: 'Welcome',
      nodes: [
        { id: 'confirm', type: 'screen', label: 'Confirm' },
        { id: 'plain', type: 'screen', label: 'Plain step', config: { title: 'Welcome aboard' } },
        { id: 'greet', type: 'screen', label: 'Greeting step', config: { title: 'Hello {{ vars.name }}' } },
        {
          id: 'each',
          type: 'loop',
          label: 'Each',
          config: {
            collection: '{rows}',
            body: { nodes: [{ id: 'inner', type: 'screen', label: 'Inner', config: { title: 'Row {{ row.name }}' } }] },
          },
        },
      ],
      edges: [],
    };
    // An untitled screen is named by `screens.<id>.title`, a plain heading by that same key,
    // and a nested screen is not drawn by the embed: only `greet` is asked.
    expect(nodeKeys({ flows: [flow] })).toEqual(['flows.welcome.nodes.greet.label', 'flows.welcome.nodes.each.label']);
    expect(
      collectExpectedEntries({ flows: [flow] }).find((e) => e.path.join('.') === 'flows.welcome.nodes.greet.label'),
    ).toMatchObject({ sourceValue: 'Greeting step', inline: 'Greeting step', source: 'flow' });
  });

  it('skips a step with no id: nothing could address it', () => {
    const flow = { ...opportunityApproval, nodes: [{ type: 'decision', label: 'Anonymous' }] };
    expect(nodeKeys({ flows: [flow] })).toEqual([]);
  });

  it('every harvested key parses under the translation schema and is kept', () => {
    const nodes = Object.fromEntries(
      nodeKeys({ flows: [opportunityApproval] }).map((key) => [key.split('.')[3], { label: '译文' }]),
    );
    const parsed = TranslationDataSchema.parse({ flows: { opportunity_approval: { nodes } } });
    expect(Object.keys(parsed.flows?.opportunity_approval?.nodes ?? {})).toEqual(Object.keys(nodes));
  });
});

describe('the coverage gate demands the drawn steps (ruling 7076440876)', () => {
  const tree = (flows?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    flows: [opportunityApproval],
    translations: [{ 'zh-CN': { ...(flows ? { flows } : {}) } }],
  });
  const zhNodeIssues = (config: any) =>
    computeI18nCoverage(config)
      .issues.filter((i) => i.locale === 'zh-CN' && i.source === 'flow')
      .map((i) => i.key)
      .filter((k) => k.startsWith('flows.opportunity_approval.nodes.'));

  it('lists every untranslated drawn step in the flow bucket', () => {
    expect(zhNodeIssues(tree())).toEqual([
      'flows.opportunity_approval.nodes.start.label',
      'flows.opportunity_approval.nodes.high_value.label',
      'flows.opportunity_approval.nodes.notify_owner.label',
      'flows.opportunity_approval.nodes.each_line.label',
      'flows.opportunity_approval.nodes.end.label',
    ]);
  });

  it('goes quiet once every drawn step is translated', () => {
    expect(
      zhNodeIssues(
        tree({
          opportunity_approval: {
            nodes: {
              start: { label: '开始' },
              high_value: { label: '大额（> 50 万美元）？' },
              notify_owner: { label: '通知负责人' },
              each_line: { label: '逐行' },
              end: { label: '结束' },
            },
          },
        }),
      ),
    ).toEqual([]);
  });
});
