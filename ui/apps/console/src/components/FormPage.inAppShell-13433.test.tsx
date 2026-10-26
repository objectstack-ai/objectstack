// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13433 — a `type: 'form'` action fired inside an app opened its form
 * outside the app: on the app-less `/forms/:name`, headed by the raw qualified
 * view name (`showcase_task.form`), with Submit as the only button.
 *
 * Pinned here, on the console half of the fix (the navigator half — which
 * route a form hop takes — is pinned in app-shell, beside
 * `hostInConsolePath`'s two callers):
 *
 *   - the app route table serves `/apps/:appName/forms/:name` with the same
 *     internal `FormPage`, and a submit there lands on the record in the SAME
 *     app the URL names;
 *   - a form view that names itself nowhere is headed by its object's label;
 *     an authored view label or form `title` still wins;
 *   - the internal form has a Cancel: back to the page the user came from
 *     when there is one, else the edited record, else the route's fallback;
 *   - the public `/f/:slug` form has none (controls: an anonymous visitor has
 *     no console to return to).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { FormPage } from './FormPage';
import { appRoutes } from '../AppContent';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** A container's default form: no view label, no form `title` — what Log Time opens. */
const UNLABELLED_VIEW = {
  name: 'showcase_task.form',
  object: 'showcase_task',
  viewKind: 'form',
  config: {
    type: 'simple',
    sections: [{ name: 'task', label: 'Task details', fields: ['title'] }],
  },
};

const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
};

const GET_RESPONSE = {
  object: 'showcase_task',
  id: 'task-42',
  record: { id: 'task-42', title: 'Write the report' },
};

const POST_RESPONSE = {
  object: 'showcase_task',
  id: 'task-77',
  record: { id: 'task-77', title: 'New task' },
};

function stubFetch(view: unknown = UNLABELLED_VIEW) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    let body: unknown;
    if (u.includes('/meta/view/')) body = view;
    else if (u.includes('/meta/object/')) body = OBJECT_SCHEMA;
    else if (method === 'GET' && u.includes('/data/showcase_task/task-42')) body = GET_RESPONSE;
    else if (method === 'POST' && u.includes('/data/showcase_task')) body = POST_RESPONSE;
    else throw new Error(`unstubbed fetch: ${method} ${u}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const where = () => screen.getByTestId('location').textContent;

const recordPath = (objectName: string, recordId: string) =>
  `/apps/com.example.showcase/${objectName}/record/${recordId}`;

/** The internal form on the app-less route, optionally with a page behind it. */
function renderInternal({ url, behind }: { url: string; behind?: string }) {
  const entries = behind ? [behind, url] : [url];
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <LocationProbe />
      <Routes>
        <Route
          path="/forms/:name"
          element={<FormPage mode="internal" recordPath={recordPath} cancelPath="/home" />}
        />
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the heading of an internal form (objectui#13433)', () => {
  it('a form view that names itself nowhere is headed by its object, not its raw name', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInternal({ url: '/forms/showcase_task.form' });

    // RED before the fix: the heading read `showcase_task.form`.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Task$/);
    expect(screen.queryByText('showcase_task.form')).toBeNull();
  });

  it('an authored form `title` heads the form', async () => {
    vi.stubGlobal('fetch', stubFetch({ ...UNLABELLED_VIEW, config: { ...UNLABELLED_VIEW.config, title: 'Log time' } }));
    renderInternal({ url: '/forms/showcase_task.form' });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Log time$/);
  });

  it('control: the view’s own label still wins', async () => {
    vi.stubGlobal('fetch', stubFetch({ ...UNLABELLED_VIEW, label: 'Quick edit', config: { ...UNLABELLED_VIEW.config, title: 'Log time' } }));
    renderInternal({ url: '/forms/showcase_task.form' });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Quick edit$/);
  });
});

describe('Cancel on an internal form (objectui#13433)', () => {
  it('goes back to the page the form was opened from', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInternal({
      behind: '/apps/com.example.showcase/showcase_task/record/task-42?tab=details',
      url: '/forms/showcase_task.form?recordId=task-42&recordObject=showcase_task',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(where()).toBe('/apps/com.example.showcase/showcase_task/record/task-42?tab=details'));
  });

  it('opened cold on an edit, lands on the record it edits', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInternal({ url: '/forms/showcase_task.form?recordId=task-42&recordObject=showcase_task' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(where()).toBe('/apps/com.example.showcase/showcase_task/record/task-42'));
  });

  it('opened cold on a create, lands on the route’s fallback', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInternal({ url: '/forms/showcase_task.form' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(where()).toBe('/home'));
  });

  it('writes nothing', async () => {
    const fetchSpy = stubFetch();
    vi.stubGlobal('fetch', fetchSpy);
    renderInternal({ url: '/forms/showcase_task.form?recordId=task-42&recordObject=showcase_task' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeInTheDocument());
    const writes = fetchSpy.mock.calls.filter(([, init]) => (init?.method ?? 'GET').toUpperCase() !== 'GET');
    expect(writes).toEqual([]);
  });

  it('control: the public form renders no Cancel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ object: 'showcase_task', form: UNLABELLED_VIEW.config, objectSchema: OBJECT_SCHEMA }),
        text: async () => '',
      }) as unknown as Response),
    );
    renderInternal({ url: '/f/contact-us' });

    expect(await screen.findByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('the in-app form route, /apps/:appName/forms/:name (objectui#13433)', () => {
  const METADATA = {
    apps: [
      { name: 'showcase', _packageId: 'com.example.showcase' },
      { name: 'crm', _packageId: 'com.acme.crm' },
    ],
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;

  /** The app route table as `AppContent` mounts it, under `/apps/:appName/*`. */
  function renderInApp(url: string) {
    return render(
      <MetadataCtx.Provider value={METADATA}>
        <MemoryRouter initialEntries={[url]}>
          <LocationProbe />
          <Routes>
            <Route
              path="/apps/:appName/*"
              element={
                <Routes>
                  {appRoutes}
                  <Route path=":objectName/record/:recordId" element={<div data-testid="record-page" />} />
                  <Route path="*" element={<div data-testid="app-not-found" />} />
                </Routes>
              }
            />
          </Routes>
        </MemoryRouter>
      </MetadataCtx.Provider>,
    );
  }

  it('renders the internal form inside the app the URL names', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInApp('/apps/com.example.showcase/forms/showcase_task.form?recordId=task-42&recordObject=showcase_task');

    // RED without the route: the app table's catch-all answers instead.
    expect(await screen.findByLabelText(/Title/)).toHaveValue('Write the report');
    expect(screen.queryByTestId('app-not-found')).toBeNull();
  });

  it('a submit lands on the written record in the same app — the second app, not the first', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInApp('/apps/com.acme.crm/forms/showcase_task.form');

    await userEvent.type(await screen.findByLabelText(/Title/), 'New task');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(where()).toBe('/apps/com.acme.crm/showcase_task/record/task-77'));
  });

  it('opened cold on a create, Cancel lands on the app’s home', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderInApp('/apps/com.acme.crm/forms/showcase_task.form');

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(where()).toBe('/apps/com.acme.crm'));
  });
});
