// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29187 — an internal form whose write the caller
 * holds no grant for is refused up front, not at Submit.
 *
 * A member with read but no create right opened a form link, typed the whole
 * record, and only on Submit learned they may not create (#29019 made that
 * refusal read well; the typing was still lost). The page now asks the
 * affordance map's form row against the console's `/auth/me/permissions`
 * answer as soon as the form has loaded: a create form the create grant, an
 * edit form (`?recordId=`) the update grant. Refused, it draws the submit-time
 * refusal's own sentence and NO field, so there is nothing to type and lose.
 *
 * What is real: `FormPage`, the real `MePermissionsProvider` fed the served
 * payload shape (`initialPermissions`), the affordance resolver and the i18n
 * pack. The network is a stubbed `fetch` answering the view, object and
 * record reads; a POST would be counted, and none is ever made here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OBJECT = 'qar8_fsb';
const REFUSAL = "You don't have permission to save this record.";

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
};

let posts = 0;

function answer(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Refused',
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

beforeEach(() => {
  posts = 0;
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const view = {
    name: `${OBJECT}.form`,
    object: OBJECT,
    viewKind: 'form',
    label: 'Feedback',
    config: { type: 'simple', sections: [{ fields: ['name', 'email'] }] },
  };
  const publicPayload = {
    slug: 'feedback',
    object: OBJECT,
    label: 'Feedback',
    form: { type: 'simple', sections: [{ fields: ['name', 'email'] }] },
    objectSchema: { name: OBJECT, fields: FIELDS },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method && init.method !== 'GET') {
        posts += 1;
        return answer(403, { error: 'denied', code: 'PERMISSION_DENIED' });
      }
      if (u.includes('/meta/view/')) return answer(200, view);
      if (u.includes('/meta/object/')) return answer(200, { name: OBJECT, label: 'Feedback', fields: FIELDS });
      if (u.includes(`/data/${OBJECT}/r1`)) {
        return answer(200, { object: OBJECT, id: 'r1', record: { id: 'r1', name: 'Ada', email: 'ada@example.com' } });
      }
      if (u.includes('/forms/feedback')) return answer(200, publicPayload);
      throw new Error(`unstubbed fetch: ${u}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The served `/auth/me/permissions` answer, granting `grants` on the form's object. */
function permissions(grants: Record<string, boolean>): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u_member',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    permissionSets: ['member'],
    systemPermissions: [],
    objects: { [OBJECT]: { allowRead: true, ...grants } },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
}

/** An internal route, mounted under the permissions answer the console holds over it. */
function renderInternal(url: string, grants: Record<string, boolean>) {
  return render(
    <MePermissionsProvider initialPermissions={permissions(grants)}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/forms/:name" element={<FormPage mode="internal" />} />
          <Route path="/apps/:appName/forms/:name" element={<FormPage mode="internal" />} />
        </Routes>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

/** Refused: the sentence, and not one field of the form. */
async function expectRefusedUpFront() {
  const banner = await screen.findByTestId('form-write-refused');
  expect(banner).toHaveTextContent(REFUSAL);
  expect(banner).toHaveAttribute('role', 'alert');
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
  expect(posts).toBe(0);
}

/** Offered: the form, unchanged. */
async function expectFormOffered() {
  expect(await screen.findByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Submit/ })).toBeInTheDocument();
  expect(screen.queryByTestId('form-write-refused')).not.toBeInTheDocument();
}

describe('internal form: a write the caller holds no grant for is refused before a field is drawn (#29187)', () => {
  it('a create form without the create grant: the refusal, no fields, on /forms/NAME', async () => {
    renderInternal(`/forms/${OBJECT}.form`, {});
    await expectRefusedUpFront();
  });

  it('the same form on /apps/APP/forms/NAME reads the same: refused', async () => {
    renderInternal(`/apps/crm/forms/${OBJECT}.form`, {});
    await expectRefusedUpFront();
  });

  it('a create form with the create grant: the form, unchanged', async () => {
    renderInternal(`/forms/${OBJECT}.form`, { allowCreate: true });
    await expectFormOffered();
  });

  it('a create form asks the CREATE grant: the update grant alone does not open it', async () => {
    renderInternal(`/forms/${OBJECT}.form`, { allowEdit: true });
    await expectRefusedUpFront();
  });

  it('an edit form without the update grant: refused, even with the create grant', async () => {
    renderInternal(`/forms/${OBJECT}.form?recordId=r1`, { allowCreate: true });
    await expectRefusedUpFront();
  });

  it('an edit form with the update grant: the form, prefilled from the record', async () => {
    renderInternal(`/forms/${OBJECT}.form?recordId=r1`, { allowEdit: true });
    await expectFormOffered();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Ada'));
  });
});

describe('/f/SLUG is unchanged (#29187)', () => {
  it('the anonymous form draws its fields even under an answer that grants no create', async () => {
    render(
      <MePermissionsProvider initialPermissions={permissions({})}>
        <MemoryRouter initialEntries={['/f/feedback']}>
          <Routes>
            <Route path="/f/:slug" element={<FormPage mode="public" />} />
          </Routes>
        </MemoryRouter>
      </MePermissionsProvider>,
    );
    await expectFormOffered();
  });

  it('and with no permissions answer above it at all, as App.tsx mounts it', async () => {
    render(
      <MemoryRouter initialEntries={['/f/feedback']}>
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>,
    );
    await expectFormOffered();
  });
});
