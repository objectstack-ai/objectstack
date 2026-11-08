/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28104 — the New page opens on an AI chat draft carried in the
 * router state ("Open the full form" on a record-write card).
 *
 * The form is a stand-in that records the schema the page hands it and the
 * fields the page names through `SuggestedFieldsContext` (the form renderer's
 * own test pins how a named field is drawn). Pinned:
 *
 *   1. the draft's values seed the create, typed, over the form view's
 *      defaults, and every one of them is named as AI-suggested;
 *   2. a query-string prefill wins per field, and a field it fills is not
 *      named as AI-suggested;
 *   3. the page says once, above the form, that the draft is unsaved;
 *   4. the draft reaches the page through a real `navigate(to, { state })`
 *      from another route, with nothing in the URL;
 *   5. CONTROL: no draft, or an edit, names nothing and shows no notice.
 *
 * Direction, written before the run: with the page not reading
 * `location.state`, cells 1–4 RED; 5 GREEN both ways.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { SuggestedFieldsContext } from '@object-ui/components';
import { RecordFormPage } from './RecordFormPage';
import { recordWriteFormTarget } from '../utils/recordFormAiDraft';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

const { seen } = vi.hoisted(() => ({
  seen: [] as Array<{ schema: Record<string, any>; suggested: ReadonlySet<string> | undefined }>,
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: Record<string, any> }) => {
    seen.push({ schema, suggested: React.useContext(SuggestedFieldsContext) });
    return <output data-testid="form" />;
  },
}));

const OBJECTS = [
  {
    name: 'crm_lead',
    label: 'Lead',
    editMode: 'page',
    fields: { name: { type: 'text' }, phone: { type: 'text' }, status: { type: 'text' }, account: { type: 'lookup' } },
    form: { type: 'simple', defaults: { status: 'new' }, sections: [{ name: 'main', fields: ['name', 'phone', 'status', 'account'] }] },
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

const WRITE = {
  operation: 'create' as const,
  objectName: 'crm_lead',
  fields: [
    { name: 'name', value: '张伟' },
    { name: 'phone', value: '13900001111' },
    { name: 'account', value: 'acc_draft' },
    { name: 'status', value: 'contacted' },
  ],
};
const DRAFT_STATE = recordWriteFormTarget(WRITE, 'crm').state;

function openPage(entry: string | { pathname: string; search?: string; state?: unknown }, mode: 'create' | 'edit' = 'create') {
  const route = mode === 'create' ? '/apps/:appName/:objectName/new' : '/apps/:appName/:objectName/record/:recordId/edit';
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={route} element={<RecordFormPage mode={mode} />} />
      </Routes>
    </MemoryRouter>,
  );
  return seen[seen.length - 1];
}

describe('RecordFormPage opens on an AI chat draft from router state (objectstack#28104)', () => {
  it('the draft seeds the create over the form defaults, and every drafted field is named', () => {
    const last = openPage({ pathname: '/apps/crm/crm_lead/new', state: DRAFT_STATE });
    expect(last.schema.initialValues).toStrictEqual({
      status: 'contacted',
      name: '张伟',
      phone: '13900001111',
      account: 'acc_draft',
    });
    expect([...(last.suggested ?? [])].sort()).toStrictEqual(['account', 'name', 'phone', 'status']);
  });

  it('a query-string prefill wins per field and is not named as AI-suggested', () => {
    const last = openPage({ pathname: '/apps/crm/crm_lead/new', search: '?account=acc_parent', state: DRAFT_STATE });
    expect(last.schema.initialValues.account).toBe('acc_parent');
    expect(last.schema.initialValues.name).toBe('张伟');
    expect(last.suggested?.has('account')).toBe(false);
    expect(last.suggested?.has('name')).toBe(true);
  });

  it('says once, above the form, that the drafted record is not saved yet', () => {
    openPage({ pathname: '/apps/crm/crm_lead/new', state: DRAFT_STATE });
    expect(screen.getAllByTestId('record-form-ai-draft-notice')).toHaveLength(1);
  });

  it('the draft arrives through navigate(to, { state }) with nothing in the URL', () => {
    const where: { path?: string } = {};
    function Chat() {
      const navigate = useNavigate();
      const target = recordWriteFormTarget(WRITE, 'crm');
      return <button onClick={() => navigate(target.to, { state: target.state })}>open</button>;
    }
    function Spy() {
      const loc = useLocation();
      where.path = `${loc.pathname}${loc.search}${loc.hash}`;
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/ai/chat']}>
        <Spy />
        <Routes>
          <Route path="/ai/chat" element={<Chat />} />
          <Route path="/apps/:appName/:objectName/new" element={<RecordFormPage mode="create" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(where.path).toBe('/apps/crm/crm_lead/new');
    expect(seen[seen.length - 1].schema.initialValues.phone).toBe('13900001111');
  });

  it('CONTROL: no draft names nothing and shows no notice', () => {
    const last = openPage('/apps/crm/crm_lead/new?name=typed');
    expect(last.suggested).toBeUndefined();
    expect(last.schema.initialValues).toStrictEqual({ status: 'new', name: 'typed' });
    expect(screen.queryByTestId('record-form-ai-draft-notice')).toBeNull();
  });

  it('CONTROL: an edit reads no draft', () => {
    const last = openPage({ pathname: '/apps/crm/crm_lead/record/l1/edit', state: DRAFT_STATE }, 'edit');
    expect(last.suggested).toBeUndefined();
    expect(last.schema.initialValues).toBeUndefined();
    expect(screen.queryByTestId('record-form-ai-draft-notice')).toBeNull();
  });
});
