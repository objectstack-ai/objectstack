/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One predicate over a `lookup` / `user` field, one verdict — on every surface
 * (objectui#3501).
 *
 * The grid expands every relational COLUMN (`buildExpandFields`), which is a
 * DISPLAY decision: it replaces the stored foreign key with the whole related
 * record. Predicate authors do not participate in it, so before this the same
 * `record.owner == os.user.id` was **true** on a surface that had not expanded
 * `owner` and **false** on one that had — the same record, the same user, the
 * same predicate, opposite answers, and no error either way.
 *
 * These cases pin the two grid surfaces to the server's reading (`record.owner`
 * is the id) with the record delivered EXPANDED, which is the shape they
 * actually receive.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { BulkActionBar } from '../components/BulkActionBar';
import { RowActionMenu } from '../components/RowActionMenu';
import { partitionBulkRows } from '../bulkEligibility';

/** The object's own field types — the authority on which fields are relations. */
const FIELDS = {
  title: { type: 'text' },
  owner: { type: 'user' },
  account: { type: 'lookup', reference: 'showcase_account' },
};

/** A row as the grid receives it: `owner` expanded by the display projection. */
const EXPANDED_ROW = {
  id: 'r1',
  title: 'SEO migration plan',
  owner: { id: 'U1', name: 'Ada Lovelace' },
  account: { id: 'A1', name: 'Acme' },
};

/** The same record on a surface that did not expand it. */
const PLAIN_ROW = { id: 'r1', title: 'SEO migration plan', owner: 'U1', account: 'A1' };

const MINE = 'record.owner == os.user.id';
const SCOPE = { os: { user: { id: 'U1' } } };

describe('lookup predicates — row kebab', () => {
  const def = { name: 'reassign', label: 'Reassign', variant: 'primary' as const, visible: MINE };
  const shown = () => !!screen.queryByTestId('row-action-inline-reassign');

  const renderRow = (row: Record<string, unknown>, objectFields?: unknown) =>
    render(
      <PredicateScopeProvider scope={SCOPE}>
        <RowActionMenu row={row} rowActionDefs={[def] as any} objectFields={objectFields} />
      </PredicateScopeProvider>,
    );

  it('offers the action on the caller’s own record when the relation is expanded', () => {
    renderRow(EXPANDED_ROW, FIELDS);
    expect(shown()).toBe(true);
  });

  it('reaches the SAME verdict on an unexpanded row', () => {
    renderRow(PLAIN_ROW, FIELDS);
    expect(shown()).toBe(true);
  });

  it('still hides it on someone else’s record', () => {
    renderRow({ ...EXPANDED_ROW, owner: { id: 'U2', name: 'Grace' } }, FIELDS);
    expect(shown()).toBe(false);
  });

  it('hides it cleanly when the relation is EMPTY', () => {
    renderRow({ ...EXPANDED_ROW, owner: null }, FIELDS);
    expect(shown()).toBe(false);
  });
});

describe('lookup predicates — selection bar', () => {
  const def = { name: 'reassign', label: 'Reassign', operation: 'custom' as const, visible: MINE };
  const shown = () => !!screen.queryByTestId('bulk-action-reassign');

  const renderBar = (rows: Record<string, unknown>[], objectFields?: unknown) =>
    render(
      <PredicateScopeProvider scope={SCOPE}>
        <BulkActionBar
          selectedRows={rows}
          actions={[]}
          actionDefs={[def] as any}
          objectFields={objectFields}
          onActionDef={() => {}}
        />
      </PredicateScopeProvider>,
    );

  it('offers the action over an expanded selection', () => {
    renderBar([EXPANDED_ROW], FIELDS);
    expect(shown()).toBe(true);
  });

  it('reaches the SAME verdict as the row kebab did', () => {
    renderBar([PLAIN_ROW], FIELDS);
    expect(shown()).toBe(true);
  });

  it('hides it when no selected record belongs to the caller', () => {
    renderBar([{ ...EXPANDED_ROW, owner: { id: 'U2' } }], FIELDS);
    expect(shown()).toBe(false);
  });

  it('counts the non-matching records as skipped rather than acting on them', () => {
    const { eligible, skipped } = partitionBulkRows(
      { name: 'reassign', visible: MINE },
      [EXPANDED_ROW, { ...EXPANDED_ROW, id: 'r2', owner: { id: 'U2' } }],
      { scope: SCOPE, fields: FIELDS },
    );

    expect(eligible.map(r => r.id)).toEqual(['r1']);
    expect(skipped).toBe(1);
  });
});
