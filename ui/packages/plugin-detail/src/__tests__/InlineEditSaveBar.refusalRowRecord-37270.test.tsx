/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#37270 — the record page's inline Save dialog: the row a refusal
 * names carries the record the draft would leave (the record with the draft
 * merged in, the merge the collector judges its rows on), so an option
 * `visibleWhen` on that row reads the draft, as the collected rows' do.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { InlineEditProvider, RecordContextProvider, useInlineEdit } from '@object-ui/react';

type RefusalField = (name: string) => { name: string; record?: Record<string, unknown> } | null;
const seen = vi.hoisted(() => ({ refusalField: null as null | ((name: string) => unknown) }));

vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/fields')>();
  const Dialog = (props: React.ComponentProps<typeof actual.RequiredFieldsDialog>) => {
    seen.refusalField = props.refusalField ?? null;
    return React.createElement(actual.RequiredFieldsDialog, props);
  };
  return { ...actual, RequiredFieldsDialog: Dialog };
});

import { registerAllFields } from '@object-ui/fields';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

registerAllFields();
afterEach(() => { cleanup(); seen.refusalField = null; });

const OBJECT_SCHEMA = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] },
    win_reason: { type: 'text', label: 'Win Reason', requiredWhen: 'record.stage == "won"' },
    // No `requiredWhen`: only a refusal names it.
    channel: {
      type: 'radio',
      label: 'Channel',
      options: [{ value: 'won_option', label: 'Won option', visibleWhen: 'record.stage == "won"' }],
    },
  },
};
const DATA = { id: 'd1', name: 'Acme deal', stage: 'new', win_reason: null, channel: null, updated_at: 'v1' };

function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('stage')}>edit-enter</button>
      <button onClick={() => inline.setField('stage', 'won')}>edit-stage-won</button>
    </>
  );
}

describe('#37270 the inline Save dialog hands a refusal-named row the drafted record', () => {
  it('the refusal row carries the record with the draft merged in', async () => {
    const update = vi.fn().mockResolvedValue({});
    render(
      <RecordContextProvider objectName="deal" recordId="d1" data={DATA} objectSchema={OBJECT_SCHEMA} dataSource={{ update } as never}>
        <InlineEditProvider canEdit>
          <Harness />
          <InlineEditSaveBar dataSource={{ update }} objectName="deal" recordId="d1" data={DATA} refresh={vi.fn()} />
        </InlineEditProvider>
      </RecordContextProvider>,
    );
    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-stage-won'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByTestId('required-fields-dialog');
    expect(update).not.toHaveBeenCalled();
    const row = (seen.refusalField as RefusalField | null)?.('channel');
    expect(row?.name).toBe('channel');
    expect(row?.record).toEqual({ ...DATA, stage: 'won' });
  });
});
