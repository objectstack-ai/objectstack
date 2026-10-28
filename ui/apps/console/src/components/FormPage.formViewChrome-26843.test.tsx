// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#26843 — the form page renders the form view's
 * `buttons` and `defaults`, which it never read.
 *
 *   - `buttons.submit` / `buttons.cancel`: an authored `label` replaces the
 *     page's own, an authored `show: false` removes the button. The public
 *     route still draws no Cancel at all.
 *   - `defaults`: a create opens with them, over the object's own field
 *     defaults and under a `?prefill_` param; an edit never reads them.
 *
 * CONTROL: a form view authoring neither keeps the page's own `Submit` /
 * `Cancel` and opens blank.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage, readFormButton, readPrefill } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OBJECT_SCHEMA = {
  name: 'showcase_inquiry',
  fields: {
    title: { type: 'text', label: 'Title' },
    channel: { type: 'text', label: 'Channel', defaultValue: 'phone' },
  },
};

function viewBody(form: Record<string, unknown>) {
  return {
    name: 'showcase_inquiry.intake',
    object: 'showcase_inquiry',
    viewKind: 'form',
    label: 'Intake',
    config: { type: 'simple', sections: [{ fields: ['title', 'channel'] }], ...form },
  };
}

function stubFetch(form: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = String(url);
    const body = path.includes('/meta/view/')
      ? viewBody(form)
      : path.includes('/meta/object/')
        ? OBJECT_SCHEMA
        : path.includes('/forms/intake')
          ? { slug: 'intake', object: 'showcase_inquiry', form: viewBody(form).config, objectSchema: OBJECT_SCHEMA }
          : path.includes('/data/showcase_inquiry/r1')
            ? { record: { id: 'r1', title: 'Stored', channel: 'email' } }
            : null;
    if (!body) throw new Error(`unstubbed fetch: ${path}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

function renderAt(url: string) {
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const input = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormPage renders the form view\'s buttons (#26843)', () => {
  it('internal: the authored submit label shows, and a hidden cancel is gone', async () => {
    vi.stubGlobal('fetch', stubFetch({ buttons: { submit: { label: 'File inquiry' }, cancel: { show: false } } }));
    renderAt('/forms/showcase_inquiry.intake');
    expect(await screen.findByRole('button', { name: 'File inquiry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('internal: an authored cancel label shows; a hidden submit is gone', async () => {
    vi.stubGlobal('fetch', stubFetch({ buttons: { submit: { show: false }, cancel: { label: 'Back' } } }));
    const { container } = renderAt('/forms/showcase_inquiry.intake');
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('public: the authored submit label shows, and there is still no Cancel', async () => {
    vi.stubGlobal('fetch', stubFetch({ buttons: { submit: { label: 'Send' }, cancel: { label: 'Back' } } }));
    renderAt('/f/intake');
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('CONTROL: no `buttons` — the page\'s own Submit and Cancel', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderAt('/forms/showcase_inquiry.intake');
    expect(await screen.findByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

describe('FormPage seeds a create with the form view\'s defaults (#26843)', () => {
  it('a create opens with them, over the object\'s own field default', async () => {
    vi.stubGlobal('fetch', stubFetch({ defaults: { title: 'Website lead', channel: 'web' } }));
    renderAt('/forms/showcase_inquiry.intake');
    await waitFor(() => expect(input('title')?.value).toBe('Website lead'));
    expect(input('channel')?.value).toBe('web');
  });

  it('a `prefill_` param still wins per field', async () => {
    vi.stubGlobal('fetch', stubFetch({ defaults: { title: 'Website lead', channel: 'web' } }));
    renderAt('/forms/showcase_inquiry.intake?prefill_channel=chat');
    await waitFor(() => expect(input('channel')?.value).toBe('chat'));
    expect(input('title')?.value).toBe('Website lead');
  });

  it('an edit reads the stored record, never the defaults', async () => {
    vi.stubGlobal('fetch', stubFetch({ defaults: { title: 'Website lead', channel: 'web' } }));
    renderAt('/forms/showcase_inquiry.intake?recordId=r1');
    await waitFor(() => expect(input('title')?.value).toBe('Stored'));
    expect(input('channel')?.value).toBe('email');
  });

  it('CONTROL: no defaults — the object\'s own field default, else blank', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderAt('/forms/showcase_inquiry.intake');
    await waitFor(() => expect(input('channel')?.value).toBe('phone'));
    expect(input('title')?.value).toBe('');
  });
});

describe('the two helpers, directly', () => {
  it('readFormButton: shown unless `show: false`; a per-locale label resolves', () => {
    expect(readFormButton(undefined, 'en')).toStrictEqual({ show: true, label: '' });
    expect(readFormButton({ show: false }, 'en').show).toBe(false);
    expect(readFormButton({ label: { en: 'Send', 'zh-CN': '发送' } }, 'zh-CN').label).toBe('发送');
  });

  it('readPrefill: defaults only for a field the form draws, and never on an edit', () => {
    const fields = [{ name: 'title' }, { name: 'channel', defaultValue: 'phone' }] as any;
    const search = new URLSearchParams();
    expect(readPrefill(fields, search, null, { title: 'T', unknown_field: 'x' })).toStrictEqual({ title: 'T', channel: 'phone' });
    expect(readPrefill(fields, search, { title: 'Stored' }, { title: 'T' })).toStrictEqual({ title: 'Stored', channel: 'phone' });
  });
});
