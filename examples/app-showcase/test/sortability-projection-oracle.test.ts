// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10235] The measured oracle, pinned against the SHIPPED corpus: the
 * `showcase_project.budget_remaining` refusal cell (#9313/#10234's harness —
 * the third of the 3 column-sort PUTs over shipped displayed columns that
 * answer `422 sort-field-unsortable`) must come out UNSORTABLE in the served
 * sortability projection, so the downstream grid (objectui leg) can make the
 * click unofferable. The CRM twin pins the other two cells.
 */

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';
import { resolveObjectSortability } from '@objectstack/spec/api';

const readColumns = (view: any): string[] =>
  (view?.columns ?? []).map((c: any) => (typeof c === 'string' ? c : c?.field)).filter(Boolean);

describe('#10235 sortability oracle — showcase_project.budget_remaining', () => {
  const project = (stack.objects ?? []).find((o: any) => o.name === 'showcase_project');
  const aggregate: any = (stack.views ?? []).find(
    (v: any) => (v as any)?.list?.data?.object === 'showcase_project',
  );

  it('premise: the formula column is DISPLAYED in the measured view', () => {
    expect(aggregate).toBeDefined();
    expect(readColumns(aggregate.list)).toContain('budget_remaining');
    expect((project as any)?.fields?.budget_remaining?.type).toBe('formula');
  });

  it('the served projection marks the cell unsortable', () => {
    const { fields } = resolveObjectSortability(project);
    expect(fields.budget_remaining).toEqual({ sortable: false, reason: 'virtual-type' });
  });

  it('anti-vacuity: the persisted budget column beside it stays sortable', () => {
    const { fields } = resolveObjectSortability(project);
    expect(fields.budget).toEqual({ sortable: true });
    expect(fields.spent).toEqual({ sortable: true });
  });
});
