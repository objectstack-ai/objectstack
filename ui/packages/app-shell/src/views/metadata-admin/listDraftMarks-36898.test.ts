// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36898 — which listed row a `_drafts` ledger row marks, and
 * whether the mark is the AI's: the rule the item pages' AI line uses
 * (`isAgentDraftSurface`), over the draft's `draftChanges`.
 */

import { describe, it, expect } from 'vitest';
import type { DraftChange } from '@object-ui/data-objectstack';
import { draftEntryOf, draftMarkKindOf } from './listDraftMarks';
import type { PendingDraftEntry } from '../../preview/usePendingDrafts';

const change = (by: DraftChange['by']): DraftChange =>
  ({ path: ['label'], by, actor: 'u1', at: '2026-11-24T10:00:00Z' }) as DraftChange;

describe('AI or a person (objectstack#36898)', () => {
  it('a draft with any copilot or MCP entry is the AI\'s', () => {
    expect(draftMarkKindOf([change('studio'), change('copilot')])).toBe('ai');
    expect(draftMarkKindOf([change('mcp')])).toBe('ai');
  });

  it('a person\'s draft, or one with no recorded provenance, carries the plain mark', () => {
    expect(draftMarkKindOf([change('studio'), change('api')])).toBe('human');
    expect(draftMarkKindOf(null)).toBe('human');
    expect(draftMarkKindOf([])).toBe('human');
  });
});

describe('which row a ledger row marks (objectstack#36898)', () => {
  const entry = (over: Partial<PendingDraftEntry>): PendingDraftEntry => ({
    type: 'dashboard',
    name: 'sales_board',
    packageId: 'com.acme.crm',
    ...over,
  });

  it('the same type and name in the same package', () => {
    const e = entry({});
    expect(draftEntryOf([e], 'dashboard', { name: 'sales_board', packageId: 'com.acme.crm' })).toBe(e);
  });

  it('a stored plural type spelling folds to the list\'s type', () => {
    const e = entry({ type: 'dashboards' });
    expect(draftEntryOf([e], 'dashboard', { name: 'sales_board' })).toBe(e);
  });

  it('a draft in the `.custom` pair marks the code-shipped base item it customizes', () => {
    const e = entry({ packageId: 'com.acme.crm.custom' });
    expect(draftEntryOf([e], 'dashboard', { name: 'sales_board', packageId: 'com.acme.crm' })).toBe(e);
  });

  it('marks nothing for another name, type, package or bundle member (control)', () => {
    expect(draftEntryOf([entry({})], 'dashboard', { name: 'ops_board' })).toBeNull();
    expect(draftEntryOf([entry({})], 'report', { name: 'sales_board' })).toBeNull();
    expect(draftEntryOf([entry({})], 'dashboard', { name: 'sales_board', packageId: 'com.other.app' })).toBeNull();
    expect(
      draftEntryOf([entry({ type: 'email_template', member: 'zh-CN' })], 'email_template', { name: 'sales_board', member: 'en-US' }),
    ).toBeNull();
  });
});
