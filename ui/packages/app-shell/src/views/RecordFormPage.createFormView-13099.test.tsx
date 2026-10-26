/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13099 — the full-page create route uses the object's `create` form
 * view when it declares one; the full-page edit route keeps the default form
 * view.
 *
 * The page (`editMode: 'page'`) makes the same selection as the New/Edit modal
 * (`selectRecordFormView`). Its object comes from served view rows run through
 * the real `mergeViewsIntoObjects`, so the `create` form view sits under the
 * name it is served by, `OBJECT.create` (the `showcase_contact` shape). The
 * form itself is a stand-in that prints the section names and layout family
 * the page hands it.
 *
 * CONTROL: an object with no `create` form view creates with its default form.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { mergeViewsIntoObjects } from '../providers/MetadataProvider';
import { RecordFormPage } from './RecordFormPage';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

// Stand-in for the real form: prints what the page selected.
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: { formType?: string; sections?: Array<{ name?: string }> } }) => (
    <output data-testid="form">
      {`${schema.formType}:${(schema.sections ?? []).map((s) => s.name).join(',')}`}
    </output>
  ),
}));

const row = (object: string, key: string, config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: `${object}.${key}`,
  object,
  viewKind: 'form' as const,
  config,
  scope: 'package',
  ...extra,
});

const { OBJECTS } = vi.hoisted(() => ({ OBJECTS: [] as unknown[] }));

vi.mock('../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: OBJECTS, loading: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

OBJECTS.push(
  ...mergeViewsIntoObjects(
    [
      { name: 'showcase_contact', label: 'Contact', editMode: 'page', fields: { first_name: { type: 'text' }, notes: { type: 'text' } } },
      { name: 'crm_lead', label: 'Lead', editMode: 'page', fields: { first_name: { type: 'text' } } },
    ],
    [
      row('showcase_contact', 'create', { type: 'simple', sections: [{ name: 'quick', fields: ['first_name'] }] }, { order: 1 }),
      row('showcase_contact', 'form', { type: 'tabbed', sections: [{ name: 'identity', fields: ['first_name'] }, { name: 'notes', fields: ['notes'] }] }, { order: 2, isDefault: true }),
      row('crm_lead', 'web_to_lead', { type: 'simple', sections: [{ name: 'contact_us', fields: ['first_name'] }] }, { order: 1 }),
      row('crm_lead', 'form', { type: 'simple', sections: [{ name: 'lead_information', fields: ['first_name'] }] }, { order: 2, isDefault: true }),
    ],
  ),
);

afterEach(cleanup);

function formText(mode: 'create' | 'edit', objectName: string): string {
  const path = mode === 'create' ? `/apps/demo/${objectName}/new` : `/apps/demo/${objectName}/record/r1/edit`;
  const route = mode === 'create' ? '/apps/:appName/:objectName/new' : '/apps/:appName/:objectName/record/:recordId/edit';
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<RecordFormPage mode={mode} />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('form').textContent ?? '';
}

describe('RecordFormPage selects the create form view for a create (objectui#13099)', () => {
  it('a page-mode create renders the declared `create` form view', () => {
    expect(formText('create', 'showcase_contact')).toBe('simple:quick');
  });

  it('a page-mode edit of the same object keeps the default form view, unchanged', () => {
    expect(formText('edit', 'showcase_contact')).toBe('tabbed:identity,notes');
  });

  it('CONTROL: no `create` form view — a page-mode create uses the default form, never a named one', () => {
    expect(formText('create', 'crm_lead')).toBe('simple:lead_information');
  });
});
