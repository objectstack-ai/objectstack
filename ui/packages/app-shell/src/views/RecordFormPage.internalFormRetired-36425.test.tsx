/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#36425 — the full-page record form no longer loads
 * the object's internal form view: no layout family (tabbed / wizard), no
 * sections, subforms, `buttons`, `layout` or `defaults` from it. The page lays
 * the record out by the object's field groups (ObjectForm's own fallback), a
 * create leaves out a `showOnCreate: false` field, and an edit lists it. The
 * child collections are the field groups' (`groupSubforms`).
 *
 * The form is a stand-in that records the schema the page hands it. CONTROL:
 * an object with no form view gets the same schema.
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

const FIELDS = {
  subject: { type: 'text' },
  status: { type: 'text' },
  account: { type: 'text' },
  internal_note: { type: 'text', showOnCreate: false },
};
const GROUP_SUBFORMS = [{ childObject: 'crm_case_line', relationshipField: 'case' }];

const OBJECTS = [
  {
    name: 'crm_case',
    label: 'Case',
    editMode: 'page',
    fields: FIELDS,
    groupSubforms: GROUP_SUBFORMS,
    form: {
      type: 'wizard',
      layout: 'horizontal',
      buttons: { submit: { label: 'File case' }, cancel: { show: false } },
      defaults: { status: 'new', account: 'acct-default' },
      sections: [{ name: 'main', fields: ['subject', 'status', 'account'] }],
      subforms: [{ childObject: 'form_only_child', relationshipField: 'case' }],
    },
    formViews: { 'crm_case.create': { type: 'tabbed', sections: [{ name: 'c', fields: ['subject'] }] } },
  },
  {
    name: 'crm_note',
    label: 'Note',
    editMode: 'page',
    fields: FIELDS,
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

const FORM_STEERS = ['sections', 'defaultTab', 'tabPosition', 'allowSkip', 'showStepIndicator'];

describe('RecordFormPage reads no internal form view (#36425)', () => {
  it('a create: a simple form with no form sections, and the page\'s own chrome', () => {
    const schema = formSchema('/apps/demo/crm_case/new', 'create');
    expect(schema.formType).toBe('simple');
    for (const key of FORM_STEERS) expect(schema[key], key).toBeUndefined();
    expect(schema).toMatchObject({ showSubmit: true, showCancel: true, layout: 'vertical' });
    expect(schema.submitText).not.toBe('File case');
    expect(schema.initialValues).toBeUndefined();
  });

  it('a create leaves out a showOnCreate: false field; an edit lists it', () => {
    expect(formSchema('/apps/demo/crm_case/new', 'create').fields).toEqual(['subject', 'status', 'account']);
    cleanup();
    expect(formSchema('/apps/demo/crm_case/record/c1/edit', 'edit').fields)
      .toEqual(['subject', 'status', 'account', 'internal_note']);
  });

  it('a URL prefill still seeds the create, with no form view defaults under it', () => {
    expect(formSchema('/apps/demo/crm_case/new?account=acct-parent', 'create').initialValues)
      .toStrictEqual({ account: 'acct-parent' });
  });

  it('the child collections are the field groups\', never the form view\'s', () => {
    expect(formSchema('/apps/demo/crm_case/new', 'create').subforms).toBe(GROUP_SUBFORMS);
    cleanup();
    expect(formSchema('/apps/demo/crm_case/record/c1/edit', 'edit').subforms).toBe(GROUP_SUBFORMS);
  });

  it('CONTROL: an object with no form view gets the same schema', () => {
    const authored = formSchema('/apps/demo/crm_case/new', 'create');
    cleanup();
    const plain = formSchema('/apps/demo/crm_note/new', 'create');
    expect(plain.formType).toBe(authored.formType);
    expect(plain.fields).toEqual(authored.fields);
    expect(plain.layout).toBe(authored.layout);
    expect(plain.submitText).toBe(authored.submitText);
  });
});
