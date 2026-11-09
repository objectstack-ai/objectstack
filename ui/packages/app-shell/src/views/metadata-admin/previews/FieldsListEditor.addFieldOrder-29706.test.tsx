// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29706 — the column picker ("Add field") listed the platform's
 * injected columns before the builder's own fields.
 *
 * The served object puts the columns `applySystemFields` injects ahead of the
 * author's field map: the audit four and `owner_id` (`system: true`, shown),
 * plus the hidden bookkeeping ones the list-view inspector already drops. The
 * picker kept that order, so a builder scrolled past 创建时间 / 创建人 / 所有人
 * to reach the fields they made. It now lists the builder's fields first and
 * the system ones after, each in served order.
 *
 * The catalog below is that served order, measured on `@objectstack/objectql`'s
 * `applySystemFields` for an object declaring `title` and `priority`, with the
 * hidden system columns already dropped as `ObjectListViewInspector` drops them.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ObjectFieldInfo } from './useObjectFields';

// `useObjectFields` short-circuits the fetch when handed a catalog, but still
// constructs the shared metadata client — stub it so no test reaches the
// network (as FieldsListEditor.fieldLabels-12693.test.tsx does).
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { FieldsListEditor } from './FieldsListEditor';

afterEach(cleanup);

const SERVED: ObjectFieldInfo[] = [
  { name: 'created_at', label: 'Created At', type: 'datetime', hidden: false, system: true },
  { name: 'created_by', label: 'Created By', type: 'lookup', hidden: false, system: true },
  { name: 'updated_at', label: 'Updated At', type: 'datetime', hidden: false, system: true },
  { name: 'updated_by', label: 'Updated By', type: 'lookup', hidden: false, system: true },
  { name: 'owner_id', label: 'Owner', type: 'lookup', hidden: false, system: true },
  { name: 'title', label: 'Title', type: 'text', hidden: false },
  { name: 'priority', label: 'Priority', type: 'select', hidden: false },
];

/** The picker's rows, top to bottom, by field name. */
function pickerOrder(catalog: ObjectFieldInfo[]): string[] {
  render(
    <FieldsListEditor
      variantKey="config"
      schema={{ type: 'grid', columns: [] }}
      columns={[]}
      allStrings
      objectName="repairs_repair_ticket"
      objectFieldsOverride={catalog}
      selectedIndex={null}
      onPatch={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Add field/ }));
  const list = screen.getByPlaceholderText(/Search fields/).closest('[role="dialog"]') as HTMLElement;
  return within(list)
    .getAllByRole('button')
    .map((b) => b.querySelector('code')?.textContent ?? '')
    .filter(Boolean);
}

describe('the column picker lists the builder’s own fields first (objectstack#29706)', () => {
  it('served system-first: the builder’s fields lead, the system columns follow, each in served order', () => {
    expect(pickerOrder(SERVED)).toEqual([
      'title',
      'priority',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
      'owner_id',
    ]);
  });

  it('CONTROL — a catalog with no system column keeps its served order', () => {
    const own = SERVED.filter((f) => f.system !== true);
    expect(pickerOrder([...own].reverse())).toEqual(['priority', 'title']);
  });
});
