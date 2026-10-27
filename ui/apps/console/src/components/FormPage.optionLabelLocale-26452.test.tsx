// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26452 — the standalone internal form route (`/forms/:name`)
 * renders select option labels in the session's language, by the SAME path
 * the in-app overlay form (`?form=ID`) takes.
 *
 * ## How the overlay gets translated options
 *
 * The overlay is `ModalForm` → `ObjectForm`, whose field builder
 * (`fromObjectSchema` in `@object-ui/plugin-form`) hands `field.options` to
 * the widget untouched. The translation happened one step earlier, on the
 * server: the object schema is read over the host's authenticated fetch
 * (`createAuthenticatedFetch`, published to the renderers as
 * `SchemaRendererContext.apiFetch`), which stamps `Accept-Language` with the
 * session's UI language (`<html lang>`), and the server localizes the schema —
 * option labels included — in that language.
 *
 * ## The defect
 *
 * `FormPage` read `/meta/object` with a bare `fetch`, so the request carried
 * whatever language the BROWSER sends, never the one the user chose. A zh-CN
 * user on an en-US browser got field labels in Chinese (those resolve
 * client-side through the bundle) over English options.
 *
 * ## What this file holds
 *
 * The host fetch below is the REAL `createAuthenticatedFetch` the console
 * mounts, and the stubbed server localizes by the `Accept-Language` it
 * receives — the documented behaviour of the live one, where a zh-CN browser
 * already got Chinese options on this route. The user's choice (`zh-CN`) is
 * set on `<html lang>`, as the i18n provider does; the "browser" sends no
 * header at all, which the server answers in English.
 *
 * Red before the fix: the route ignored the host fetch, so no request carried
 * `zh-CN` and every combobox read English.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { SchemaRendererProvider } from '@object-ui/react';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const VIEW_ENVELOPE = {
  name: 'showcase_task.form',
  object: 'showcase_task',
  viewKind: 'form',
  label: 'Task',
  config: {
    type: 'simple',
    sections: [{ label: 'Task', fields: ['title', 'status', 'priority'] }],
  },
};

/** Authored (English) option labels, as `objectstack.config.ts` declares them. */
const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];
const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

/**
 * The zh-CN bundle's option labels. `urgent` is deliberately absent: an option
 * with no translation keeps its authored text.
 */
const ZH_OPTIONS: Record<string, Record<string, string>> = {
  status: { backlog: '待规划', in_review: '评审中', done: '已完成' },
  priority: { high: '高' },
};

/** The server's `/meta/object` answer, localized by the request's language. */
function objectSchemaFor(acceptLanguage: string | null) {
  const zh = acceptLanguage?.toLowerCase().startsWith('zh') ?? false;
  const localize = (field: string, options: Array<{ value: string; label: string }>) =>
    options.map((o) => ({ ...o, label: (zh && ZH_OPTIONS[field]?.[o.value]) || o.label }));
  return {
    name: 'showcase_task',
    label: zh ? '任务' : 'Task',
    fields: {
      title: { type: 'text', label: zh ? '标题' : 'Title' },
      status: { type: 'select', label: zh ? '状态' : 'Status', options: localize('status', STATUS_OPTIONS) },
      priority: { type: 'select', label: zh ? '优先级' : 'Priority', options: localize('priority', PRIORITY_OPTIONS) },
    },
  };
}

let seenLanguages: Array<string | null> = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The server. A request with no `Accept-Language` stands for the en-US browser. */
function stubServer(record: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/meta/view/')) return json(VIEW_ENVELOPE);
    if (url.includes('/meta/object/')) {
      const lang = new Headers(init?.headers).get('Accept-Language');
      seenLanguages.push(lang);
      return json(objectSchemaFor(lang));
    }
    if (url.includes('/data/showcase_task/task-7')) {
      return json({ object: 'showcase_task', id: 'task-7', record: { id: 'task-7', ...record } });
    }
    throw new Error(`unstubbed fetch: ${url}`);
  });
}

/** `/forms/:name` as the console mounts it: inside the shell's renderer provider. */
function renderStandaloneRoute() {
  return render(
    <SchemaRendererProvider dataSource={null} apiFetch={createAuthenticatedFetch({ sameOriginOnly: true })}>
      <MemoryRouter
        initialEntries={['/forms/showcase_task.form?recordId=task-7&recordObject=showcase_task']}
      >
        <Routes>
          <Route path="/forms/:name" element={<FormPage mode="internal" />} />
        </Routes>
      </MemoryRouter>
    </SchemaRendererProvider>,
  );
}

let previousLang = '';

beforeEach(() => {
  seenLanguages = [];
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  // The user's chosen language, where the i18n provider publishes it.
  previousLang = document.documentElement.lang;
  document.documentElement.lang = 'zh-CN';
});

afterEach(() => {
  document.documentElement.lang = previousLang;
  vi.unstubAllGlobals();
});

describe('objectstack#26452 — /forms/:name option labels follow the chosen language', () => {
  it('reads the object schema in the session language and renders translated option labels', async () => {
    vi.stubGlobal('fetch', stubServer({ title: 'Ship it', status: 'in_review', priority: 'high' }));
    renderStandaloneRoute();

    const status = await screen.findByRole('combobox', { name: /状态|Status/ });
    await waitFor(() => expect(status.textContent).toContain('评审中'));
    expect(screen.getByRole('combobox', { name: /优先级|Priority/ }).textContent).toContain('高');
    expect(status.textContent).not.toContain('In Review');
    // The schema read went out in the user's language, not the browser's.
    expect(seenLanguages).toEqual(['zh-CN']);
  });

  it('an option the bundle does not translate keeps its authored label', async () => {
    vi.stubGlobal('fetch', stubServer({ title: 'Ship it', status: 'done', priority: 'urgent' }));
    renderStandaloneRoute();

    const status = await screen.findByRole('combobox', { name: /状态|Status/ });
    await waitFor(() => expect(status.textContent).toContain('已完成'));
    expect(screen.getByRole('combobox', { name: /优先级|Priority/ }).textContent).toContain('Urgent');
  });
});
