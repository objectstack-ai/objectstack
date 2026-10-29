/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object settings panel authors `relatedLists` (objectstack#27069) as an
 * ordered list over the object's INBOUND relationships, and the record page's
 * own derivation (`deriveRelatedLists`) is the judge of what the order does.
 *
 * The real panel, inside a host that feeds every patch back into the draft and
 * a metadata store that serves the child objects:
 *  - a drag (or up / down) writes an order that changes the record page's
 *    derived order, read through `deriveRelatedLists` itself;
 *  - a name that matches no inbound relationship never enters a written value;
 *  - every unlisted relationship trails, greyed and not draggable, in the
 *    derived order, and is what the add picker offers;
 *  - removing the last entry removes the key; nothing is written before the
 *    object list has answered.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { t } from '../metadata-admin/i18n';
import { deriveRelatedLists } from '../../utils/deriveRelatedLists';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

type Row = Record<string, unknown>;

const lead: Row = { name: 'lead', label: 'Lead', fields: { name: { type: 'text', label: 'Name' } } };
const note: Row = { name: 'note', label: 'Note', fields: { lead: { type: 'master_detail', reference: 'lead', label: 'Lead' } } };
const task: Row = {
  name: 'task',
  label: 'Task',
  fields: {
    lead_id: { type: 'lookup', reference: 'lead', label: 'Lead' },
    // An audit FK is never a related list, so never an inbound relationship.
    owner_id: { type: 'lookup', reference: 'lead', label: 'Owner' },
  },
};
const event: Row = {
  name: 'event',
  label: 'Event',
  fields: {
    who_id: { type: 'lookup', reference: 'lead', label: 'Who' },
    related_to: { type: 'lookup', reference: 'lead', label: 'Related To' },
  },
};
const campaignMember: Row = {
  name: 'campaign_member',
  label: 'Campaign Member',
  fields: { lead_id: { type: 'lookup', reference: 'lead', label: 'Lead', relatedList: false } },
};
const REGISTRY = [lead, note, task, event, campaignMember];

function store(status: 'ready' | 'loading' = 'ready'): MetadataContextValue {
  return {
    apps: [],
    objects: REGISTRY,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => status,
  };
}

function Host({ initial, writes, status }: { initial: Row; writes: Row[]; status?: 'ready' | 'loading' }) {
  const [draft, setDraft] = React.useState<Row>(initial);
  const value = React.useMemo(() => store(status), [status]);
  return (
    <MetadataCtx.Provider value={value}>
      <ObjectSettingsPanel
        name="lead"
        draft={draft}
        onPatch={(patch: Row) => setDraft((d) => {
          const next = { ...d, ...patch };
          writes.push(next);
          return next;
        })}
        locale="en-US"
      />
    </MetadataCtx.Provider>
  );
}

const rowOrder = () =>
  screen.getAllByTestId(/^related-lists-row-/).map((el) => el.getAttribute('data-testid')!.replace('related-lists-row-', ''));
const tailOrder = () =>
  within(screen.getByTestId('related-lists-tail'))
    .getAllByRole('listitem')
    .map((el) => el.getAttribute('data-testid')!.replace('related-lists-tail-row-', ''));
/** The record page's order for `relatedLists`, through the record page's own derivation. */
const pageOrder = (relatedLists: unknown) =>
  deriveRelatedLists({ ...lead, relatedLists: relatedLists as string[] | undefined }, REGISTRY)
    .map((r) => `${r.childObject}.${r.referenceField}`);
const lastLists = (writes: Row[]) => writes.at(-1)!.relatedLists;

describe('ObjectSettingsPanel — relatedLists is an ordered list of the inbound relationships', () => {
  it('a drag writes an order that changes the record page\'s derived order', () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...lead, relatedLists: ['task', 'event.related_to'] }} writes={writes} />);
    expect(rowOrder()).toEqual(['task', 'event.related_to']);
    const before = pageOrder(['task', 'event.related_to']);
    expect(before.slice(0, 2)).toEqual(['task.lead_id', 'event.related_to']);

    const from = screen.getByTestId('related-lists-row-event.related_to');
    const to = screen.getByTestId('related-lists-row-task');
    expect(from).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(from);
    fireEvent.dragOver(to);
    fireEvent.drop(to);

    expect(lastLists(writes)).toEqual(['event.related_to', 'task']);
    expect(rowOrder()).toEqual(['event.related_to', 'task']);
    const after = pageOrder(lastLists(writes));
    expect(after).not.toEqual(before);
    // The listed relationships lead, in the written order; the rest keep the derived order.
    expect(after).toEqual(['event.related_to', 'task.lead_id', 'note.lead', 'event.who_id']);

    // The keyboard path writes the same kind of order.
    fireEvent.click(within(screen.getByTestId('related-lists-row-task')).getByRole('button', { name: 'Move up' }));
    expect(lastLists(writes)).toEqual(['task', 'event.related_to']);
    expect(pageOrder(lastLists(writes))).toEqual(before);
  });

  it('a name that matches no inbound relationship never enters a written value', () => {
    const writes: Row[] = [];
    render(
      <Host initial={{ ...lead, relatedLists: ['nope', 'task', 'event.nope', 'note'] }} writes={writes} />,
    );
    // Stored, it keeps a row and is named as what it is.
    expect(rowOrder()).toEqual(['nope', 'task', 'event.nope', 'note']);
    const unmatched = screen.getByTestId('related-lists-unmatched');
    expect(unmatched).toHaveTextContent('“nope”');
    expect(unmatched).toHaveTextContent('“event.nope”');

    // A move writes only the entries that name an inbound relationship.
    fireEvent.click(within(screen.getByTestId('related-lists-row-note')).getByRole('button', { name: 'Move up' }));
    expect(lastLists(writes)).toEqual(['task', 'note']);
    expect(screen.queryByTestId('related-lists-unmatched')).toBeNull();
  });

  it('every unlisted relationship trails, greyed and not draggable, in the derived order', async () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...lead, relatedLists: ['event.related_to'] }} writes={writes} />);
    // The derived order, without the listed one; the hidden FK is listed (an
    // entry may name it) and marked; the audit FK is not a relationship.
    expect(tailOrder()).toEqual(['note.lead', 'task.lead_id', 'event.who_id', 'campaign_member.lead_id']);
    for (const row of within(screen.getByTestId('related-lists-tail')).getAllByRole('listitem')) {
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).not.toHaveAttribute('draggable');
    }
    expect(screen.getByTestId('related-lists-tail-row-campaign_member.lead_id')).toHaveTextContent(
      t('engine.studio.settings.relatedListsHidden', 'en-US'),
    );
    // The record page agrees: the listed one leads, the rest trail in the derived order.
    expect(pageOrder(['event.related_to'])).toEqual(['event.related_to', 'note.lead', 'task.lead_id', 'event.who_id']);

    // The add picker offers exactly the tail, spelled as entries.
    fireEvent.keyDown(screen.getByTestId('related-lists-add-select'), { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      t('engine.studio.settings.relatedListsAdd', 'en-US'),
      'Note (note)',
      'Task (task)',
      'Event · Who (event.who_id)',
      'Campaign Member (campaign_member)',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Task (task)' }));
    expect(lastLists(writes)).toEqual(['event.related_to', 'task']);
    expect(tailOrder()).toEqual(['note.lead', 'event.who_id', 'campaign_member.lead_id']);
  });

  it('removing the last entry removes the key', () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...lead, relatedLists: ['note'] }} writes={writes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(writes.at(-1)).toHaveProperty('relatedLists', undefined);
    expect(screen.queryAllByTestId(/^related-lists-row-/)).toHaveLength(0);
    expect(screen.getByText(t('engine.studio.settings.relatedListsUndeclared', 'en-US'))).toBeInTheDocument();
  });

  it('writes nothing before the object list has answered', () => {
    const writes: Row[] = [];
    render(<Host initial={{ ...lead, relatedLists: ['event.related_to', 'task'] }} writes={writes} status="loading" />);
    expect(screen.getByTestId('related-lists-loading')).toBeInTheDocument();
    // The stored rows are shown, but offer no move, removal or drag.
    expect(rowOrder()).toEqual(['event.related_to', 'task']);
    expect(screen.getByTestId('related-lists-row-task')).toHaveAttribute('draggable', 'false');
    expect(within(screen.getByTestId('related-lists-editor')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('related-lists-unmatched')).toBeNull();
    expect(writes).toHaveLength(0);
  });
});
