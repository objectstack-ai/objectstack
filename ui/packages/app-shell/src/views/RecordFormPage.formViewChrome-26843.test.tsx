/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26843 — the full-page record form hands the form
 * view's `buttons`, `layout` and `defaults` to the form, instead of setting its
 * own `showSubmit: true`, submit label and `layout: 'vertical'` over them.
 *
 * The form is a stand-in that records the schema the page hands it. CONTROL:
 * an object whose form view authors none of the keys keeps the page's own
 * labels, both buttons and the vertical layout.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RecordFormPage } from './RecordFormPage';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

const { seen } = vi.hoisted(() => ({ seen: [] as Array<Record<string, any>> }));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: Record<string, any> }) => {
    seen.push(schema);
    return <output data-testid="form" />;
  },
}));

const FIELDS = { subject: { type: 'text' }, status: { type: 'text' }, account: { type: 'text' } };

const OBJECTS = [
  {
    name: 'crm_case',
    label: 'Case',
    editMode: 'page',
    fields: FIELDS,
    form: {
      type: 'simple',
      layout: 'horizontal',
      buttons: { submit: { label: 'File case' }, cancel: { show: false } },
      defaults: { status: 'new', account: 'acct-default' },
      sections: [{ name: 'main', fields: ['subject', 'status', 'account'] }],
    },
  },
  {
    name: 'crm_note',
    label: 'Note',
    editMode: 'page',
    fields: FIELDS,
    form: { type: 'simple', sections: [{ name: 'main', fields: ['subject'] }] },
  },
];

vi.mock('../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: OBJECTS, loading: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

afterEach(() => {
  cleanup();
  seen.length = 0;
});

function formSchema(path: string, mode: 'create' | 'edit'): Record<string, any> {
  const route = mode === 'create' ? '/apps/:appName/:objectName/new' : '/apps/:appName/:objectName/record/:recordId/edit';
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<RecordFormPage mode={mode} />} />
      </Routes>
    </MemoryRouter>,
  );
  return seen[seen.length - 1];
}

describe('RecordFormPage renders the form view\'s buttons, layout and defaults (#26843)', () => {
  it('the authored submit label and hidden cancel reach the form', () => {
    const schema = formSchema('/apps/demo/crm_case/new', 'create');
    expect(schema).toMatchObject({ showSubmit: true, submitText: 'File case', showCancel: false });
  });

  it('the authored horizontal layout reaches the form', () => {
    expect(formSchema('/apps/demo/crm_case/new', 'create').layout).toBe('horizontal');
  });

  it('defaults seed a create, and a URL prefill still wins per field', () => {
    expect(formSchema('/apps/demo/crm_case/new', 'create').initialValues)
      .toStrictEqual({ status: 'new', account: 'acct-default' });
    cleanup();
    expect(formSchema('/apps/demo/crm_case/new?account=acct-parent', 'create').initialValues)
      .toStrictEqual({ status: 'new', account: 'acct-parent' });
  });

  it('an edit keeps the buttons and layout and reads no defaults', () => {
    const schema = formSchema('/apps/demo/crm_case/record/c1/edit', 'edit');
    expect(schema).toMatchObject({ submitText: 'File case', showCancel: false, layout: 'horizontal' });
    expect(schema.initialValues).toBeUndefined();
  });

  it('CONTROL: a form view authoring none of them keeps the page\'s own chrome', () => {
    const schema = formSchema('/apps/demo/crm_note/new', 'create');
    expect(schema).toMatchObject({ showSubmit: true, showCancel: true, layout: 'vertical' });
    expect(schema.submitText).toBeTruthy();
    expect(schema.submitText).not.toBe('File case');
    expect(schema.initialValues).toBeUndefined();
  });
});
