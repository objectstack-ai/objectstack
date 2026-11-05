// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#30334 — a write the object's external datasource
 * does not admit says the table is read-only, not that the user lacks
 * permission.
 *
 * The ADR-0015 write gate refuses an insert on an object bound to an external
 * datasource unless `datasource.external.allowWrites` AND
 * `object.external.writable` are both true, answering `403
 * EXTERNAL_WRITE_FORBIDDEN`. Read as any other 403, the banner said "you don't
 * have permission", which sends an administrator through permission sets for a
 * grant that cannot exist. The fixture is the envelope the data route answers
 * for that refusal.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FIELDS = {
  name: { type: 'text', label: 'Name' },
};

/** The gate's refusal of a `POST /data/:object` on a read-only external object. */
const EXTERNAL_WRITE_FORBIDDEN = {
  status: 403,
  body: {
    error:
      "Write 'insert' blocked on object 'spare_parts': datasource 'parts_db' is external (schemaMode=external). " +
      'Requires datasource.external.allowWrites=true (got false) AND object.external.writable=true (got false).',
    code: 'EXTERNAL_WRITE_FORBIDDEN',
  },
};

let posts = 0;

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

function stubInternal(refusal: { status: number; body: unknown }) {
  const view = {
    name: 'spare_parts.form',
    object: 'spare_parts',
    viewKind: 'form',
    label: 'Spare part',
    config: { type: 'simple', sections: [{ fields: ['name'] }] },
  };
  const object = { name: 'spare_parts', label: 'Spare part', fields: FIELDS };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return answer(false, refusal.status, refusal.body);
      }
      if (String(url).includes('/meta/view/')) return answer(true, 200, view);
      if (String(url).includes('/meta/object/')) return answer(true, 200, object);
      throw new Error(`unstubbed fetch: ${url}`);
    }),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/spare_parts.form']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(submitName: RegExp | string = /Submit/) {
  await userEvent.type(await screen.findByLabelText('Name'), 'Bolt');
  await userEvent.click(screen.getByRole('button', { name: submitName }));
}

async function bannerText(): Promise<string> {
  await waitFor(() => expect(document.querySelector('[id^="form-error:"]')).not.toBeNull());
  return document.querySelector('[id^="form-error:"]')?.textContent ?? '';
}

function toastText(): string {
  expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  return String(vi.mocked(toast.error).mock.calls[0][0]);
}

beforeEach(() => {
  posts = 0;
  vi.mocked(toast.error).mockClear();
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#30334 — a refused write on a read-only external object', () => {
  it('says the table is read-only, in the banner and the toast alike', async () => {
    stubInternal(EXTERNAL_WRITE_FORBIDDEN);
    await fillAndSubmit();

    const banner = await bannerText();
    expect(posts).toBe(1);
    expect(banner).toBe(
      'This table is read-only. Its records come from an external data source that does not accept changes.',
    );
    expect(banner).not.toBe("You don't have permission to save this record.");
    expect(toastText()).toBe(banner);
    // The gate's diagnostic (flags, machine names) is not the reader's sentence.
    expect(banner).not.toContain('allowWrites');
    expect(banner).not.toContain('spare_parts');
  });

  it('zh: reads in the reader\'s language, not as the permission line', async () => {
    createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
    stubInternal(EXTERNAL_WRITE_FORBIDDEN);
    await fillAndSubmit('提交');

    const banner = await bannerText();
    expect(banner).toBe('这张表是只读的：它的记录来自外部数据源，不接受修改。');
    expect(banner).not.toBe('您没有权限保存这条记录。');
    expect(toastText()).toBe(banner);
  });

  it('any other 403 still reads the permission line', async () => {
    stubInternal({ status: 403, body: { error: 'Denied', code: 'PERMISSION_DENIED' } });
    await fillAndSubmit();

    expect(await bannerText()).toBe("You don't have permission to save this record.");
  });
});
