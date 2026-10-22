// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#24916 — an approval flow's label and each approval step's label
// join the flow bucket.
//
// The approvals door names a request's flow and its current step in the
// READER's locale (`plugin-approvals` `reader-locale-labels.ts`), from
// `flows.<flow>.label` and `flows.<flow>.approvals.<node_id>.label`. The walker
// asked for the flow label only on a flow with a `screen` node, and for no
// approval step at all, so `os lint` and `os i18n check` never listed an
// approval flow as untranslated: HotCRM's six approval flows rendered English
// in zh-CN / ja-JP / es-ES under a green coverage run. These pins are the CLI
// half: the walker scaffolds both keys, the coverage gate demands them, and a
// flow no reader names (no screen, no approval) still owes no label.
//
// The ledger mock is `i18n-flow-screen-coverage.test.ts`'s, for its reason:
// these pins measure the bucket itself, whatever the shipped ledger says next.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

/** An approval-only flow: record-triggered, two approval steps, no screen. */
const expenseApproval = {
  name: 'expense_approval',
  label: 'Expense Approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'On Expense Created', config: { objectName: 'expense', triggerType: 'record-after-insert' } },
    { id: 'manager_review', type: 'approval', label: 'Manager Review', config: { approvers: [{ type: 'org_membership_level', value: 'owner' }] } },
    { id: 'finance_review', type: 'approval', label: 'Finance Review', config: { approvers: [{ type: 'org_membership_level', value: 'owner' }] } },
    { id: 'approved', type: 'end', label: 'Approved' },
  ],
  edges: [],
};

/** A screen flow, the shape the bucket already covered. */
const quickNote = {
  name: 'quick_note',
  label: 'Quick Note',
  type: 'screen',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'ask', type: 'screen', label: 'Ask', config: { title: 'Write a note', fields: [{ name: 'note', label: 'Note' }] } },
    { id: 'done', type: 'end', label: 'Done' },
  ],
  edges: [],
};

/** A scheduled flow with no screen and no approval: no reader names it. */
const nightlyDigest = {
  name: 'nightly_digest',
  label: 'Nightly Digest',
  type: 'schedule',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'mail', type: 'send_email', label: 'Mail' },
  ],
  edges: [],
};

const flowKeys = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'flows').map((e) => e.path.join('.'));

describe('what the walker harvests from an approval flow (#24916)', () => {
  it('emits the flow label and each approval step label, seeded with the authored text', () => {
    const entries = collectExpectedEntries({ flows: [expenseApproval] }).filter((e) => e.path[0] === 'flows');

    expect(entries.map((e) => e.path.join('.'))).toEqual([
      'flows.expense_approval.label',
      'flows.expense_approval.approvals.manager_review.label',
      'flows.expense_approval.approvals.finance_review.label',
    ]);
    expect(entries[0]).toMatchObject({ sourceValue: 'Expense Approval', inline: 'Expense Approval', source: 'flow', flowName: 'expense_approval' });
    expect(entries[1]).toMatchObject({ sourceValue: 'Manager Review', inline: 'Manager Review', source: 'flow', flowName: 'expense_approval' });
  });

  it('skips an approval node with no id: the request could not name it', () => {
    const flow = { ...expenseApproval, nodes: [{ type: 'approval', label: 'Anonymous Review' }] };
    expect(flowKeys({ flows: [flow] })).toEqual(['flows.expense_approval.label']);
  });

  it('still emits no label for a flow with neither a screen nor an approval node', () => {
    expect(flowKeys({ flows: [nightlyDigest] })).toEqual([]);
  });
});

describe('the coverage gate demands the approval flow and its steps (#24916)', () => {
  const tree = (flows?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    flows: [expenseApproval, quickNote, nightlyDigest],
    translations: [{ 'zh-CN': { ...(flows ? { flows } : {}) } }],
  });
  const zhFlowIssues = (config: any) =>
    computeI18nCoverage(config).issues.filter((i) => i.locale === 'zh-CN' && i.source === 'flow');

  it('lists the untranslated approval flow label and step labels in the flow bucket', () => {
    const keys = zhFlowIssues(tree()).map((i) => i.key).filter((k) => k.startsWith('flows.expense_approval.'));
    expect(keys).toEqual([
      'flows.expense_approval.label',
      'flows.expense_approval.approvals.manager_review.label',
      'flows.expense_approval.approvals.finance_review.label',
    ]);
  });

  it('keeps the step labels listed while only the flow label is translated', () => {
    const keys = zhFlowIssues(tree({ expense_approval: { label: '报销审批' } }))
      .map((i) => i.key)
      .filter((k) => k.startsWith('flows.expense_approval.'));
    expect(keys).toEqual([
      'flows.expense_approval.approvals.manager_review.label',
      'flows.expense_approval.approvals.finance_review.label',
    ]);
  });

  it('goes quiet for the approval flow once its label and every step are translated', () => {
    const keys = zhFlowIssues(tree({
      expense_approval: {
        label: '报销审批',
        approvals: { manager_review: { label: '经理审核' }, finance_review: { label: '财务审核' } },
      },
    })).map((i) => i.key);
    expect(keys.filter((k) => k.startsWith('flows.expense_approval.'))).toEqual([]);
  });

  it('keeps the screen flow\'s demand exactly as it was, and asks nothing of the scheduled flow', () => {
    const keys = zhFlowIssues(tree()).map((i) => i.key);
    expect(keys.filter((k) => k.startsWith('flows.quick_note.'))).toEqual([
      'flows.quick_note.label',
      'flows.quick_note.screens.ask.title',
      'flows.quick_note.screens.ask.fields.note.label',
    ]);
    expect(keys.filter((k) => k.startsWith('flows.nightly_digest.'))).toEqual([]);
  });

  it('accepts the translated pack the way the translation contract declares it', () => {
    // The key the gate asks for is one the face declares: the translation that
    // silences it parses with no unrecognized key.
    const parsed = TranslationDataSchema.safeParse({
      flows: { expense_approval: { label: '报销审批', approvals: { manager_review: { label: '经理审核' } } } },
    });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});

describe('the skeleton `os i18n extract` writes for an approval flow (#24916)', () => {
  const result = extractTranslations({ flows: [expenseApproval] }, { locales: ['en', 'zh-CN'] });

  it('writes the authored labels into the default locale and empty slots into the others', () => {
    expect((result.bundles.en as any).flows.expense_approval).toEqual({
      label: 'Expense Approval',
      approvals: { manager_review: { label: 'Manager Review' }, finance_review: { label: 'Finance Review' } },
    });
    expect((result.bundles['zh-CN'] as any).flows.expense_approval).toEqual({
      label: '',
      approvals: { manager_review: { label: '' }, finance_review: { label: '' } },
    });
  });

  it('parses through the schema it is written for, in every locale', () => {
    for (const [locale, bundle] of Object.entries(result.bundles)) {
      const parsed = TranslationDataSchema.safeParse(bundle);
      expect(parsed.success ? [] : parsed.error.issues, `skeleton for ${locale}`).toEqual([]);
    }
  });
});
