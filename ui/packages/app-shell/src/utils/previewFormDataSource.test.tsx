/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record form's data source under draft preview (objectstack#34807).
 *
 *   - In preview, `getObjectSchema` answers the published document plus each
 *     field only the draft overlay declares, marked draft-only; the
 *     adapter's sortability projection survives the copy, and the proxy's
 *     writes leave a draft-only name out of the record.
 *   - The real `ModalForm` (the console's global New/Edit modal) draws such a
 *     field DISABLED, and Save leaves it out of the create, its declared
 *     default included.
 *   - CONTROL: outside preview the hook returns the adapter itself, so the form
 *     reads the published document through one adapter read (objectui#13044)
 *     and never draws the draft field.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '@object-ui/plugin-form';
import { MetadataNotFoundError } from '@object-ui/data-objectstack';
import { PreviewModeProvider } from '../preview/PreviewModeContext';
import { attachObjectSortability, readObjectSortability } from '@object-ui/core';
import {
  DRAFT_ONLY_FIELD_KEY,
  createPreviewFormDataSource,
  usePreviewFormDataSource,
  withDraftOnlyFields,
} from './previewFormDataSource';

registerAllFields();

const { GET_ITEM } = vi.hoisted(() => ({ GET_ITEM: { fn: null as null | ((type: string, name: string) => Promise<unknown>) } }));

vi.mock('../providers/MetadataProvider', async (importOriginal) => {
  const getItem = (type: string, name: string) => GET_ITEM.fn!(type, name);
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useMetadata: () => ({ objects: [], loading: false, getItem }),
  };
});

const PUBLISHED = {
  name: 'tracker_task',
  fields: { title: { type: 'text', label: 'Title' } },
};
const OVERLAY = {
  name: 'tracker_task',
  fields: {
    title: { type: 'text', label: 'Task title' },
    priority: { type: 'text', label: 'Priority', defaultValue: 'high' },
  },
};
// A draft that adds a REQUIRED field with no default, and a conditional one.
const REQUIRED_OVERLAY = {
  name: 'tracker_task',
  fields: {
    title: { type: 'text', label: 'Task title' },
    due_note: { type: 'text', label: 'Due note', required: true },
    owner_note: { type: 'text', label: 'Owner note', requiredWhen: 'true' },
  },
};

const makeAdapter = () => ({
  getObjectSchema: vi.fn(async (_objectName: string): Promise<unknown> => structuredClone(PUBLISHED)),
  create: vi.fn(async (_object: string, _data: Record<string, unknown>) => ({ id: 'r1' })),
  update: vi.fn(async (_object: string, _id: string, _data: Record<string, unknown>, _opts?: { ifMatch?: string }) => ({ id: 'r1' })),
  findOne: vi.fn(async (_object: string, _id: string) => ({ id: 'r1' })),
});

afterEach(() => {
  cleanup();
  GET_ITEM.fn = null;
});

type Doc = { name?: string; fields: Record<string, Record<string, unknown>> };

describe('withDraftOnlyFields (objectstack#34807)', () => {
  it('adds the draft-only field marked, keeps published definitions, and touches neither input', () => {
    const overlay = structuredClone(OVERLAY);
    const published = structuredClone(PUBLISHED);
    const out = withDraftOnlyFields(published, overlay) as Doc;
    expect(out.fields.priority).toEqual({
      type: 'text', label: 'Priority', defaultValue: 'high', [DRAFT_ONLY_FIELD_KEY]: true,
    });
    expect(out.fields.title).toEqual({ type: 'text', label: 'Title' });
    expect(overlay).toEqual(OVERLAY);
    expect(published).toEqual(PUBLISHED);
  });

  it('a draft-only field drops required and requiredWhen; a published field keeps its own', () => {
    const published = { name: 'tracker_task', fields: { title: { type: 'text', required: true } } };
    const out = withDraftOnlyFields(published, structuredClone(REQUIRED_OVERLAY)) as Doc;
    expect(out.fields.due_note).toEqual({ type: 'text', label: 'Due note', [DRAFT_ONLY_FIELD_KEY]: true });
    expect(out.fields.owner_note).toEqual({ type: 'text', label: 'Owner note', [DRAFT_ONLY_FIELD_KEY]: true });
    expect(out.fields.title).toEqual({ type: 'text', required: true });
  });

  it('the copy keeps the published sortability projection', () => {
    const published = attachObjectSortability(structuredClone(PUBLISHED), { fields: { title: { sortable: false } } });
    const out = withDraftOnlyFields(published, structuredClone(OVERLAY));
    expect(readObjectSortability(out)).toEqual({ fields: { title: { sortable: false } } });
  });

  it('with no published document every overlay field is draft-only', () => {
    const out = withDraftOnlyFields(null, structuredClone(OVERLAY)) as Doc;
    expect(out.fields.title[DRAFT_ONLY_FIELD_KEY]).toBe(true);
    expect(out.fields.title.label).toBe('Task title');
    expect(out.fields.priority[DRAFT_ONLY_FIELD_KEY]).toBe(true);
  });

  it('with no overlay document the published one is returned as is', () => {
    const published = structuredClone(PUBLISHED);
    expect(withDraftOnlyFields(published, null)).toBe(published);
  });
});

describe('createPreviewFormDataSource (objectstack#34807)', () => {
  it('answers the published document plus the draft-only field', async () => {
    const adapter = makeAdapter();
    const ds = createPreviewFormDataSource(adapter, async () => structuredClone(OVERLAY));
    const schema = (await ds.getObjectSchema('tracker_task')) as Doc;
    expect(schema.fields.priority[DRAFT_ONLY_FIELD_KEY]).toBe(true);
    expect(schema.fields.priority.label).toBe('Priority');
    expect(schema.fields.title.label).toBe('Title');
  });

  it('a draft-only object (published read absent) answers the overlay with every field draft-only', async () => {
    const adapter = makeAdapter();
    adapter.getObjectSchema.mockRejectedValueOnce(new MetadataNotFoundError('tracker_task'));
    const ds = createPreviewFormDataSource(adapter, async () => structuredClone(OVERLAY));
    const schema = (await ds.getObjectSchema('tracker_task')) as Doc;
    expect(schema.fields.title[DRAFT_ONLY_FIELD_KEY]).toBe(true);
    expect(schema.fields.priority[DRAFT_ONLY_FIELD_KEY]).toBe(true);
  });

  it('a published read that fails for another reason fails the read', async () => {
    const adapter = makeAdapter();
    const failure = new Error('connection refused');
    adapter.getObjectSchema.mockRejectedValueOnce(failure);
    const ds = createPreviewFormDataSource(adapter, async () => structuredClone(OVERLAY));
    await expect(ds.getObjectSchema('tracker_task')).rejects.toBe(failure);
  });

  it('create and update leave the draft-only names the schema read named out of the record', async () => {
    const adapter = makeAdapter();
    const ds = createPreviewFormDataSource(adapter, async () => structuredClone(OVERLAY));
    await ds.getObjectSchema('tracker_task');
    await ds.create('tracker_task', { title: 'a', priority: 'high' });
    await ds.update('tracker_task', 'r1', { title: 'b', priority: 'low' }, { ifMatch: 'v1' });
    expect(adapter.create).toHaveBeenCalledWith('tracker_task', { title: 'a' });
    expect(adapter.update).toHaveBeenCalledWith('tracker_task', 'r1', { title: 'b' }, { ifMatch: 'v1' });
  });

  it('no overlay document: the adapter answer is returned as is', async () => {
    const adapter = makeAdapter();
    const ds = createPreviewFormDataSource(adapter, async () => null);
    expect(await ds.getObjectSchema('tracker_task')).toEqual(PUBLISHED);
  });

  it('every other member is the adapter own, bound to it, with a stable identity', async () => {
    class Adapter {
      #writes = 0;
      async getObjectSchema() { return PUBLISHED; }
      async create(_object: string, data: Record<string, unknown>) { this.#writes += 1; return { id: `r${this.#writes}`, ...data }; }
    }
    const adapter = new Adapter();
    const ds = createPreviewFormDataSource(adapter, async () => null);
    expect(ds.create).toBe(ds.create);
    expect(await ds.create('tracker_task', { title: 'a' })).toEqual({ id: 'r1', title: 'a' });
    expect(ds).toBeInstanceOf(Adapter);
  });
});

describe('usePreviewFormDataSource (objectstack#34807)', () => {
  const wrap = (preview: boolean) => ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
      <PreviewModeProvider force={preview}>{children}</PreviewModeProvider>
    </MemoryRouter>
  );

  it('CONTROL: outside preview it is the adapter itself', () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => usePreviewFormDataSource(adapter), { wrapper: wrap(false) });
    expect(result.current).toBe(adapter);
  });

  it('in preview it reads the object document through the metadata provider', async () => {
    const adapter = makeAdapter();
    const getItem = vi.fn(async (_type: string, _name: string): Promise<unknown> => structuredClone(OVERLAY));
    GET_ITEM.fn = getItem;
    const { result } = renderHook(() => usePreviewFormDataSource(adapter), { wrapper: wrap(true) });
    expect(result.current).not.toBe(adapter);
    await result.current!.getObjectSchema('tracker_task');
    expect(getItem).toHaveBeenCalledWith('object', 'tracker_task');
  });
});

describe('the global New modal under draft preview (objectstack#34807)', () => {
  function Modal({ adapter, fields }: { adapter: ReturnType<typeof makeAdapter>; fields: string[] }) {
    const ds = usePreviewFormDataSource(adapter);
    return (
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'tracker_task',
          mode: 'create',
          open: true,
          title: 'New task',
          fields,
        } as never}
        dataSource={ds as never}
      />
    );
  }
  const renderModal = (preview: boolean, adapter: ReturnType<typeof makeAdapter>, fields = ['title', 'priority']) =>
    render(
      <MemoryRouter>
        <PreviewModeProvider force={preview}>
          <Modal adapter={adapter} fields={fields} />
        </PreviewModeProvider>
      </MemoryRouter>,
    );

  it('draws the draft-only field disabled, and Save leaves it out of the create', async () => {
    const adapter = makeAdapter();
    GET_ITEM.fn = async () => structuredClone(OVERLAY);
    renderModal(true, adapter);
    await waitFor(() => expect(screen.getByText('Priority')).toBeInTheDocument());
    expect(document.body.querySelector('input[name="priority"]')).toBeDisabled();
    expect(document.body.querySelector('input[name="title"]')).not.toBeDisabled();

    fireEvent.change(document.body.querySelector('input[name="title"]') as HTMLInputElement, { target: { value: 'Ship it' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    const [object, payload] = adapter.create.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(object).toBe('tracker_task');
    expect(payload).toMatchObject({ title: 'Ship it' });
    expect(payload).not.toHaveProperty('priority');
  });

  it('a REQUIRED draft-only field is drawn disabled and does not block Save; the create leaves it out', async () => {
    const adapter = makeAdapter();
    GET_ITEM.fn = async () => structuredClone(REQUIRED_OVERLAY);
    renderModal(true, adapter, ['title', 'due_note', 'owner_note']);
    await waitFor(() => expect(screen.getByText('Due note')).toBeInTheDocument());
    expect(document.body.querySelector('input[name="due_note"]')).toBeDisabled();
    expect(document.body.querySelector('input[name="owner_note"]')).toBeDisabled();

    fireEvent.change(document.body.querySelector('input[name="title"]') as HTMLInputElement, { target: { value: 'Ship it' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    const [, payload] = adapter.create.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload).toMatchObject({ title: 'Ship it' });
    expect(payload).not.toHaveProperty('due_note');
    expect(payload).not.toHaveProperty('owner_note');
  });

  it('CONTROL: outside preview a required published field left empty still blocks Save', async () => {
    const adapter = makeAdapter();
    adapter.getObjectSchema.mockImplementation(async () => ({
      name: 'tracker_task',
      fields: { title: { type: 'text', label: 'Title' }, code: { type: 'text', label: 'Code', required: true } },
    }));
    GET_ITEM.fn = async () => structuredClone(OVERLAY);
    renderModal(false, adapter, ['title', 'code']);
    await waitFor(() => expect(screen.getByText('Code')).toBeInTheDocument());
    expect(document.body.querySelector('input[name="code"]')).not.toBeDisabled();
    fireEvent.change(document.body.querySelector('input[name="title"]') as HTMLInputElement, { target: { value: 'Ship it' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(document.body.querySelector('input[name="code"]')).toHaveAttribute('aria-invalid', 'true'));
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it('CONTROL: outside preview the published document is read once and the draft field is absent', async () => {
    const adapter = makeAdapter();
    const getItem = vi.fn(async (_type: string, _name: string): Promise<unknown> => structuredClone(OVERLAY));
    GET_ITEM.fn = getItem;
    renderModal(false, adapter);
    await waitFor(() => expect(screen.getByText('Title')).toBeInTheDocument());
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('tracker_task');
    expect(getItem).not.toHaveBeenCalled();
  });
});
