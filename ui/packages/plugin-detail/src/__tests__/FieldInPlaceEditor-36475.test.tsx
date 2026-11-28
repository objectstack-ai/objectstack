/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36475 — on the record page's field face a click on an editable
 * value edits that field alone: only it becomes an editor, no save bar is
 * drawn, Enter or a click elsewhere saves it in one write carrying that field
 * only, and Esc discards it. A pick saves at once, a check flips and saves, a
 * refused save stays open with the server's reason under the field. The
 * header's Edit (the whole-record session) is unchanged.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DetailViewSection } from '@object-ui/types';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@object-ui/components';
import { InlineEditProvider, RecordContextProvider, useInlineEdit } from '@object-ui/react';
import { DetailSection } from '../DetailSection';
import { InlineEditSaveBar } from '../InlineEditSaveBar';
import { DefaultRecordPageContext, DetailsColumnCapContext } from '../defaultRecordPage';
import { createEmptyFieldTally, RecordFieldListContext } from '../recordFieldList';

const OBJECT = 'account';
const objectSchema = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Name' },
    note: { type: 'textarea', label: 'Note' },
    phone: { type: 'text', label: 'Phone' },
    industry: {
      type: 'select',
      label: 'Industry',
      options: [
        { value: 'retail', label: 'Retail' },
        { value: 'tech', label: 'Technology' },
      ],
    },
    vip: { type: 'boolean', label: 'VIP' },
    renewal: { type: 'date', label: 'Renewal' },
  },
};

const section = {
  title: 'Overview',
  fields: [
    { name: 'name', label: 'Name' },
    { name: 'note', label: 'Note' },
    { name: 'phone', label: 'Phone' },
    { name: 'industry', label: 'Industry' },
    { name: 'vip', label: 'VIP' },
    { name: 'renewal', label: 'Renewal' },
  ],
} as unknown as DetailViewSection;

const record = {
  id: 'r1',
  name: 'Acme',
  note: 'Pays on time',
  phone: '555-0100',
  industry: 'retail',
  vip: false,
  renewal: '2026-11-20',
  updated_at: '2026-11-22T00:00:00.000Z',
};

function HeaderEdit() {
  const inline = useInlineEdit();
  return (
    <button type="button" onClick={() => inline?.enter()}>
      Header edit
    </button>
  );
}

/** The section as `DetailView` draws it: the shared session's flag and draft go in. */
function Section(props: { onEnter: (name: string) => void; dataSource: unknown }) {
  const inline = useInlineEdit();
  return (
    <DetailSection
      section={section}
      data={{ ...record, ...(inline?.draft ?? {}) }}
      objectSchema={objectSchema}
      objectName={OBJECT}
      isEditing={inline?.editing ?? false}
      onFieldChange={inline?.setField}
      onEnterInlineEdit={props.onEnter}
      dataSource={props.dataSource}
    />
  );
}

function setup(update: (...args: any[]) => Promise<unknown> = async () => ({})) {
  const dataSource = { update: vi.fn(update) };
  const reread = vi.fn(async () => {});
  const onEnter = vi.fn();
  const view = render(
    <RecordContextProvider
      objectName={OBJECT}
      recordId="r1"
      data={record}
      objectSchema={objectSchema as any}
      dataSource={dataSource as any}
      reread={reread}
    >
      <InlineEditProvider canEdit>
        <DefaultRecordPageContext.Provider value>
          <DetailsColumnCapContext.Provider value={1}>
            <RecordFieldListContext.Provider
              value={{ showEmpty: true, toggleShowEmpty: vi.fn(), emptyFields: createEmptyFieldTally() }}
            >
              <HeaderEdit />
              <Section onEnter={onEnter} dataSource={dataSource} />
              <div data-testid="elsewhere">elsewhere</div>
            </RecordFieldListContext.Provider>
          </DetailsColumnCapContext.Provider>
        </DefaultRecordPageContext.Provider>
        <InlineEditSaveBar dataSource={dataSource} objectName={OBJECT} recordId="r1" data={record} />
      </InlineEditProvider>
    </RecordContextProvider>,
  );
  return { ...view, dataSource, reread, onEnter };
}

const editorOf = (name: string) => document.querySelector(`[data-field-in-place-editor="${name}"]`) as HTMLElement | null;
const editors = () => document.querySelectorAll('[data-field-in-place-editor]');
const saveBar = () => screen.queryByRole('region');
const clickElsewhere = () => {
  const target = screen.getByTestId('elsewhere');
  fireEvent.pointerDown(target);
  fireEvent.mouseDown(target);
  fireEvent.click(target);
};

afterEach(cleanup);

describe('a click on a value edits that field alone (objectstack#36475)', () => {
  it('only the clicked field becomes an editor; the others stay values and no save bar is drawn', async () => {
    const { onEnter } = setup();
    fireEvent.click(screen.getByText('555-0100'));
    await waitFor(() => expect(editorOf('phone')).not.toBeNull());
    expect(editors()).toHaveLength(1);
    expect(onEnter).not.toHaveBeenCalled();
    expect(saveBar()).toBeNull();
    // The other values are still drawn as values.
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Pays on time')).toBeTruthy();
  });

  it('a click elsewhere saves: one write, carrying that field only, then the record is read again', async () => {
    const { dataSource, reread } = setup();
    fireEvent.click(screen.getByText('555-0100'));
    await waitFor(() => expect(editorOf('phone')).not.toBeNull());
    const input = editorOf('phone')!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '555-0199' } });
    clickElsewhere();
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update).toHaveBeenCalledWith(OBJECT, 'r1', { phone: '555-0199' }, { ifMatch: record.updated_at });
    await waitFor(() => expect(editorOf('phone')).toBeNull());
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('Enter saves a one-line value', async () => {
    const { dataSource } = setup();
    fireEvent.click(screen.getByText('555-0100'));
    await waitFor(() => expect(editorOf('phone')).not.toBeNull());
    const input = editorOf('phone')!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '555-0142' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update.mock.calls[0][2]).toEqual({ phone: '555-0142' });
  });

  it('Esc discards: no write, and the value is drawn again', async () => {
    const { dataSource } = setup();
    fireEvent.click(screen.getByText('555-0100'));
    await waitFor(() => expect(editorOf('phone')).not.toBeNull());
    const input = editorOf('phone')!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '555-0000' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(editorOf('phone')).toBeNull());
    clickElsewhere();
    expect(dataSource.update).not.toHaveBeenCalled();
  });

  it('an unchanged value writes nothing when the user moves on', async () => {
    const { dataSource } = setup();
    fireEvent.click(screen.getByText('555-0100'));
    await waitFor(() => expect(editorOf('phone')).not.toBeNull());
    clickElsewhere();
    await waitFor(() => expect(editorOf('phone')).toBeNull());
    expect(dataSource.update).not.toHaveBeenCalled();
  });

  it('in a multi-line text Enter is a new line and Ctrl+Enter saves', async () => {
    const { dataSource } = setup();
    fireEvent.click(screen.getByText('Pays on time'));
    await waitFor(() => expect(editorOf('note')).not.toBeNull());
    const area = editorOf('note')!.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Pays on time\nNet 30' } });
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(dataSource.update).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update.mock.calls[0][2]).toEqual({ note: 'Pays on time\nNet 30' });
  });

  it('a single select opens its options at once and a pick saves it', async () => {
    const { dataSource } = setup();
    fireEvent.click(screen.getByText('Retail'));
    const option = await screen.findByTestId('in-cell-option-tech');
    fireEvent.click(option);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update.mock.calls[0][2]).toEqual({ industry: 'tech' });
  });

  it('a date opens its calendar at once and a pick saves it', async () => {
    const { dataSource } = setup();
    const row = screen.getByText('Renewal', { exact: true }).closest('[data-detail-field-row]') as HTMLElement;
    fireEvent.click(row.querySelector('[title="Click to edit"]') as HTMLElement);
    const nextWeek = await screen.findByTestId('date-picker-next-week', {}, { timeout: 5000 });
    fireEvent.click(nextWeek);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(Object.keys(dataSource.update.mock.calls[0][2])).toEqual(['renewal']);
  });

  it('a check flips and saves on the click, with no editor drawn', async () => {
    const { dataSource } = setup();
    const row = screen.getByText('VIP', { exact: true }).closest('[data-detail-field-row]') as HTMLElement;
    fireEvent.click(row.querySelector('[title="Click to edit"]') as HTMLElement);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(dataSource.update.mock.calls[0][2]).toEqual({ vip: true });
    expect(editorOf('vip')).toBeNull();
  });

  it('a refused save stays open, keeps the typed value and says why under the field', async () => {
    const refusal = Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', message: 'Name is required' }],
    });
    const { dataSource, reread } = setup(async () => {
      throw refusal;
    });
    fireEvent.click(screen.getByText('Acme'));
    await waitFor(() => expect(editorOf('name')).not.toBeNull());
    const input = editorOf('name')!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    clickElsewhere();
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    const hint = await waitFor(() => {
      const el = editorOf('name')?.querySelector('[data-inline-field-hint="name"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(hint.getAttribute('role')).toBe('alert');
    expect(hint.textContent).toBe('Name is required');
    expect((editorOf('name')!.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(reread).not.toHaveBeenCalled();
    expect(saveBar()).toBeNull();
  });

  it('control: the header’s Edit still turns every field into an input under one save bar', async () => {
    const { dataSource } = setup();
    fireEvent.click(screen.getByText('Header edit'));
    await waitFor(() => expect(saveBar()).not.toBeNull());
    expect(editors()).toHaveLength(0);
    // Every editable field is an input at once; nothing has been written.
    expect(document.querySelectorAll('input, textarea, [role="combobox"]').length).toBeGreaterThanOrEqual(4);
    expect(dataSource.update).not.toHaveBeenCalled();
  });

  it('control: without a record context to write to, the click enters the whole-record session as before', () => {
    const onEnter = vi.fn();
    render(
      <DefaultRecordPageContext.Provider value>
        <DetailsColumnCapContext.Provider value={1}>
          <DetailSection section={section} data={record} objectSchema={objectSchema} objectName={OBJECT} onEnterInlineEdit={onEnter} />
        </DetailsColumnCapContext.Provider>
      </DefaultRecordPageContext.Provider>,
    );
    fireEvent.click(screen.getByText('555-0100'));
    expect(onEnter).toHaveBeenCalledWith('phone');
    expect(editors()).toHaveLength(0);
  });
});

describe('Esc in an editor inside an overlay cancels the edit, not the overlay (objectstack#36475)', () => {
  it('the surrounding dialog stays open', async () => {
    const onOpenChange = vi.fn();
    const dataSource = { update: vi.fn(async () => ({})) };
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Preview</DialogTitle>
          <DialogDescription>Record preview</DialogDescription>
          <RecordContextProvider objectName={OBJECT} recordId="r1" data={record} objectSchema={objectSchema as any} dataSource={dataSource as any}>
            <InlineEditProvider canEdit>
              <DefaultRecordPageContext.Provider value>
                <DetailsColumnCapContext.Provider value={1}>
                  <DetailSection section={section} data={record} objectSchema={objectSchema} objectName={OBJECT} onEnterInlineEdit={vi.fn()} />
                </DetailsColumnCapContext.Provider>
              </DefaultRecordPageContext.Provider>
            </InlineEditProvider>
          </RecordContextProvider>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByText('555-0100'));
    await waitFor(() => expect(editorOf('phone')).not.toBeNull());
    const input = editorOf('phone')!.querySelector('input') as HTMLInputElement;
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    await waitFor(() => expect(editorOf('phone')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dataSource.update).not.toHaveBeenCalled();
  });
});
