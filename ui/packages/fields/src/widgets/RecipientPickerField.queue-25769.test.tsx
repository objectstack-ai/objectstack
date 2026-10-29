/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `queue` sharing-rule recipient (objectstack ADR-0142 D7) is picked from
 * BOTH of a queue's sources: the queues a package declares (the console
 * metadata store's `queue` items) and the organization's own `sys_queue` rows
 * (the data source). One machine name is stored either way.
 *
 * Pinned here: the render condition (both readers, or the text input), the two
 * requests, the merge (declared first, by name), and the committed value.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { RecipientPickerField } from './RecipientPickerField';
import { mergeQueueCandidates, queueCandidateLabel } from './queueCandidates';

const DECLARED = [{ name: 'support_intake', label: 'Support Intake' }];
const AUTHORED = [
  { id: 'q_1', name: 'shanghai_desk', label: 'Shanghai Desk' },
  // A row taking a declared queue's name: the server refuses this write, and
  // if one is read anyway the declared queue wins, as the server resolves it.
  { id: 'q_2', name: 'support_intake', label: 'Shadowing Row' },
];

function metadataStore(items: unknown[]): MetadataContextValue & { ensureType: ReturnType<typeof vi.fn> } {
  return {
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: vi.fn().mockResolvedValue(items),
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

function dataSourceWith(rows: unknown[]) {
  return { find: vi.fn().mockResolvedValue({ data: rows }) } as any;
}

function renderQueuePicker(store: MetadataContextValue | null, ds: any, value = '', onChange = vi.fn()) {
  const picker = (
    <RecipientPickerField
      value={value}
      onChange={onChange}
      field={{ name: 'recipient_id' } as any}
      dataSource={ds}
      dependentValues={{ recipient_type: 'queue' }}
    />
  );
  return render(store ? <MetadataCtx.Provider value={store}>{picker}</MetadataCtx.Provider> : picker);
}

describe('mergeQueueCandidates — one list from two sources (ADR-0142 D1)', () => {
  it('merges declared items and organization rows by name, declared first, ordered by name', () => {
    expect(mergeQueueCandidates(DECLARED, { data: AUTHORED })).toEqual([
      { name: 'shanghai_desk', label: 'Shanghai Desk', source: 'organization' },
      { name: 'support_intake', label: 'Support Intake', source: 'declared' },
    ]);
  });

  it('reads every result shape a data source returns and skips nameless rows', () => {
    const rows = [{ name: 'a_desk' }, { label: 'no name' }, null];
    expect(mergeQueueCandidates([], rows).map((c) => c.name)).toEqual(['a_desk']);
    expect(mergeQueueCandidates([], { records: rows }).map((c) => c.name)).toEqual(['a_desk']);
    expect(mergeQueueCandidates(undefined, undefined)).toEqual([]);
  });

  it('labels a queue with its machine name beside a differing label', () => {
    expect(queueCandidateLabel({ name: 'support_intake', label: 'Support Intake', source: 'declared' }))
      .toBe('Support Intake (support_intake)');
    expect(queueCandidateLabel({ name: 'a_desk', label: 'a_desk', source: 'organization' })).toBe('a_desk');
  });
});

describe('RecipientPickerField — a queue recipient lists both sources (ADR-0142 D7)', () => {
  it('asks the registry for `queue` items and the data API for `sys_queue` rows', async () => {
    const store = metadataStore(DECLARED);
    const ds = dataSourceWith(AUTHORED);
    renderQueuePicker(store, ds);

    await waitFor(() => expect(store.ensureType).toHaveBeenCalledWith('queue'));
    expect(ds.find).toHaveBeenCalledWith('sys_queue', { $top: 500, $orderby: { name: 'asc' } });
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Support Intake')).toBeInTheDocument();
    expect(screen.getByText('Shanghai Desk')).toBeInTheDocument();
    // The shadowing row never displaces the declared queue of the same name.
    expect(screen.queryByText('Shadowing Row')).not.toBeInTheDocument();
  });

  it('stores the chosen queue by its machine name, whichever source it came from', async () => {
    const store = metadataStore(DECLARED);
    const onChange = vi.fn();
    renderQueuePicker(store, dataSourceWith(AUTHORED), '', onChange);

    await waitFor(() => expect(store.ensureType).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Shanghai Desk'));
    expect(onChange).toHaveBeenCalledWith('shanghai_desk');
  });

  it('still offers the other source when one read fails', async () => {
    const store = metadataStore(DECLARED);
    const ds = { find: vi.fn().mockRejectedValue(new Error('403')) } as any;
    renderQueuePicker(store, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Support Intake')).toBeInTheDocument();
  });

  it('degrades to the text input when either reader is missing — half a list is not offered', () => {
    const ds = dataSourceWith(AUTHORED);
    renderQueuePicker(null, ds, 'support_intake');
    expect(screen.getByDisplayValue('support_intake')).toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });
});
