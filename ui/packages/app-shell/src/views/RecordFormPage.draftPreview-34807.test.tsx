/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34807 — under `?preview=draft` the full-page New record form
 * draws a field that exists only in the draft.
 *
 * The page's field names come from the metadata provider, which reads the
 * draft overlay in preview; the real `ObjectForm` draws only a name its object
 * definition declares, and that definition comes from the data source the page
 * hands it. In preview that source answers the published document plus the
 * draft-only field, so the field is drawn, and Save leaves it out of the
 * create: what the viewer typed into it and its declared default alike.
 *
 * CONTROL: outside preview the page hands the form the adapter itself — one
 * published read (objectui#13044), no overlay read, no draft field.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { registerAllFields } from '@object-ui/fields';
import { PreviewModeProvider } from '../preview/PreviewModeContext';
import { RecordFormPage } from './RecordFormPage';

registerAllFields();

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

const PUBLISHED = {
  name: 'tracker_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
};
const OVERLAY = {
  name: 'tracker_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    priority: { type: 'text', label: 'Priority', defaultValue: 'high' },
  },
};

const { ENV } = vi.hoisted(() => ({
  ENV: {
    adapter: null as null | Record<string, ReturnType<typeof vi.fn>>,
    getItem: null as null | ReturnType<typeof vi.fn>,
    objects: [] as unknown[],
  },
}));

vi.mock('../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: ENV.objects, loading: false, getItem: ENV.getItem }),
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => ENV.adapter,
}));

function setUp(objects: unknown[]) {
  ENV.objects = objects;
  ENV.getItem = vi.fn(async () => structuredClone(OVERLAY));
  ENV.adapter = {
    getObjectSchema: vi.fn(async () => structuredClone(PUBLISHED)),
    create: vi.fn(async () => ({ id: 'r1', title: 'Ship it' })),
    update: vi.fn(async () => ({ id: 'r1' })),
    findOne: vi.fn(async () => ({ id: 'r1' })),
  };
  return { adapter: ENV.adapter, getItem: ENV.getItem };
}

afterEach(cleanup);

function renderNew(preview: boolean) {
  render(
    <MemoryRouter initialEntries={['/apps/tracker/tracker_task/new']}>
      <PreviewModeProvider force={preview}>
        <Routes>
          <Route path="/apps/:appName/:objectName/new" element={<RecordFormPage mode="create" />} />
        </Routes>
      </PreviewModeProvider>
    </MemoryRouter>,
  );
}

describe('RecordFormPage under draft preview (objectstack#34807)', () => {
  it('draws the draft-only field with its draft label, and Save leaves it out of the create', async () => {
    const { adapter, getItem } = setUp([OVERLAY]);
    renderNew(true);
    await waitFor(() => expect(screen.getByText('Priority')).toBeInTheDocument());
    expect(getItem).toHaveBeenCalledWith('object', 'tracker_task');
    fireEvent.change(document.body.querySelector('input[name="priority"]') as HTMLInputElement, { target: { value: 'urgent' } });

    fireEvent.change(document.body.querySelector('input[name="title"]') as HTMLInputElement, { target: { value: 'Ship it' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    const [object, payload] = adapter.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(object).toBe('tracker_task');
    expect(payload).toMatchObject({ title: 'Ship it' });
    expect(payload).not.toHaveProperty('priority');
  });

  it('CONTROL: outside preview the form reads the published document once and draws no draft field', async () => {
    const { adapter, getItem } = setUp([PUBLISHED]);
    renderNew(false);
    await waitFor(() => expect(screen.getByText('Title')).toBeInTheDocument());
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('tracker_task');
    expect(getItem).not.toHaveBeenCalled();
  });
});
