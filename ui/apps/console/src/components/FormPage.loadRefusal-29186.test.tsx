// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29186 — a refused record read on an edit form says
 * a sentence in the reader's language, never the response body.
 *
 * `/forms/:name?recordId=ID` reads the record before it draws the form. When
 * that read was refused, the banner said
 * `Could not open record "ID" of OBJECT for editing (403): {"error":…}` — the
 * record id, the object's machine name, the status and the server's JSON.
 *
 * The load now reads its refusal through the same `WriteRefusal` the submit
 * uses, and the banner draws one fixed localized line per outcome: a denial is
 * "you don't have access", a `404` is "doesn't exist, or you don't have access"
 * (row-level security answers a hidden row with the same `404`, so the line
 * never tells the two apart), and anything else is the generic line.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const VIEW = {
  name: 'showcase_task.edit',
  object: 'showcase_task',
  viewKind: 'form',
  label: 'Log Time',
  config: { type: 'simple', sections: [{ fields: ['title', 'hours'] }] },
};

const OBJECT = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    hours: { type: 'text', label: 'Hours' },
  },
};

const RECORD_ID = 'rec_7Hq2Kx9';

/**
 * A `GET /data/:object/:id` on an object the caller has no read right on, as
 * a showcase member measured it on `showcase_contact`.
 */
const PERMISSION_DENIED = {
  status: 403,
  body: {
    error: 'You do not have permission to perform this action. Contact your administrator if you need access.',
    code: 'PERMISSION_DENIED',
    object: 'showcase_task',
  },
};

let writes = 0;

/** One answer of the stubbed server; a string body goes out as it is. */
function answer(ok: boolean, status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Refused',
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

/** The internal edit route, its record read answered with `refusal`. */
function openEdit(refusal: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') {
        writes += 1;
        return answer(true, 200, {});
      }
      if (String(url).includes('/meta/view/')) return answer(true, 200, VIEW);
      if (String(url).includes('/meta/object/')) return answer(true, 200, OBJECT);
      if (String(url).includes(`/data/showcase_task/${RECORD_ID}`)) {
        return answer(false, refusal.status, refusal.body);
      }
      throw new Error(`unstubbed fetch: ${method} ${url}`);
    }),
  );
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit?recordId=${RECORD_ID}`]}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The banner reads exactly `line`, the page says nothing of the response, and
 * no editable form is left behind it.
 */
async function expectLoadBanner(line: string, status: number) {
  const banner = await screen.findByText(line);
  expect(banner.textContent).toBe(line);
  const page = document.body.textContent ?? '';
  expect(page).not.toContain('{');
  expect(page).not.toContain(String(status));
  expect(page).not.toContain(RECORD_ID);
  expect(page).not.toContain('showcase_task');
  expect(screen.queryByLabelText(/Title/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
  expect(writes).toBe(0);
}

beforeEach(() => {
  writes = 0;
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a refused edit-form record read draws a localized line (#29186)', () => {
  it('a 403 PERMISSION_DENIED read says "you don\'t have access", not the body', async () => {
    openEdit(PERMISSION_DENIED);
    await expectLoadBanner("You don't have access to this record.", 403);
  });

  it('says the denial in the reader\'s language', async () => {
    createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
    openEdit(PERMISSION_DENIED);
    await expectLoadBanner('您没有权限查看这条记录。', 403);
  });

  it('a 404 says "doesn\'t exist, or you don\'t have access"', async () => {
    // The body a showcase member measured for an inquiry the private OWD hides
    // from them — the same shape a missing id answers.
    openEdit({
      status: 404,
      body: {
        error: `Record ${RECORD_ID} not found in showcase_task`,
        code: 'RECORD_NOT_FOUND',
        object: 'showcase_task',
      },
    });
    await expectLoadBanner("This record doesn't exist, or you don't have access to it.", 404);
  });

  it('a 404 whose text names an access rule still reads as not-found-or-hidden', async () => {
    // Row-level security answers a hidden row with 404; whatever its text
    // says, the line must not tell "hidden" from "missing".
    openEdit({
      status: 404,
      body: { error: 'Access denied by row-level security policy', code: 'RECORD_NOT_FOUND' },
    });
    await expectLoadBanner("This record doesn't exist, or you don't have access to it.", 404);
  });

  it('a 500 says the generic line, not the driver text', async () => {
    openEdit({
      status: 500,
      body: { error: 'SQLITE_BUSY: database is locked', code: 'INTERNAL_ERROR' },
    });
    await expectLoadBanner('Could not open this record. Please try again.', 500);
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
  });

  it('a proxy\'s markup page says the generic line', async () => {
    openEdit({ status: 502, body: '<html><body><h1>502 Bad Gateway</h1></body></html>' });
    await expectLoadBanner('Could not open this record. Please try again.', 502);
  });
});
