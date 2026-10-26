// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4278 — `/forms/:name?recordId=` is an EDIT, rendered.
 *
 * `ActionRunner.executeForm` forwards the record an action was fired from
 * (`packages/core/src/actions/ActionRunner.ts`: `recordId != null ?
 * `${base}?recordId=${encodeURIComponent(String(recordId))}` : base`). Before
 * this card the route consumed only `prefill_` params, so an "edit this
 * record" action rendered EMPTY inputs and its submit was an unconditional
 * `POST /api/v1/data/:object` — an insert. Clicking **Log Time** on a showcase
 * Task created a second Task and left the first untouched.
 *
 * PM rulings pinned here (issue #4278, quoted on the claim comment):
 *   1. this route implements the read side — load, prefill, `PATCH`;
 *   2. fail closed on a bad `recordId` — 403/404 or an object mismatch renders
 *      the error state, NEVER a silent degrade to create mode;
 *   3. `prefill_` params override the loaded record per field.
 *
 * ## Reverse verification — predicted directions, with the fix reverted
 *
 * Reverting `FormPage.tsx` to its post-#4279 state (the param unread, submit
 * an unconditional POST) turns these RED, and each fails in a distinct way
 * that names the defect:
 *
 *   - "renders the record's stored values"        → inputs are empty
 *   - "PATCHes the record instead of inserting"   → one POST to `/data/:object`
 *   - "lands back on the record it updated"       → id read off the response
 *   - "a 404 … renders the error state"           → renders an empty CREATE form
 *   - "a 403 … renders the error state"           → same
 *   - "an object mismatch … refuses"              → prefills from the wrong object
 *   - "a blank ?recordId= refuses"                → silently creates
 *   - "prefill_ overrides the record per field"   → no record values at all
 *
 * GREEN BOTH SIDES, on purpose — these are controls, not change-detectors:
 *
 *   - "no recordId ⇒ the create path is unchanged" (the whole point of a
 *     control: this card must not move create mode a byte);
 *   - "the PUBLIC path ignores ?recordId= entirely", both its read and its
 *     write. `/f/:slug` is anonymous and visitor-controlled; if #4278 ever
 *     leaks onto it, that is a data-exposure bug, not a cosmetic one — so it
 *     is pinned here even though nothing in this change can turn it red today.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The FormView metadata `/meta/view/:name` serves — `showcase_task.edit`. */
const VIEW_ENVELOPE = {
  name: 'showcase_task.edit',
  object: 'showcase_task',
  viewKind: 'form',
  label: 'Log Time',
  config: {
    type: 'simple',
    sections: [{ label: 'Task', fields: ['title', 'hours'] }],
  },
};

const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    hours: { type: 'text', label: 'Hours', defaultValue: '0' },
  },
};

/** `GetDataResponse = { object, id, record }` — the spec-declared read shape. */
const GET_RESPONSE = {
  object: 'showcase_task',
  id: 'task-42',
  record: { id: 'task-42', title: 'Write the report', hours: '3' },
};

/** `UpdateDataResponse` — measured to carry the same `{object,id,record}`. */
const PATCH_RESPONSE = {
  object: 'showcase_task',
  id: 'task-42',
  record: { id: 'task-42', title: 'Write the report v2', hours: '5' },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

/**
 * A fetch stub that answers per (method, url-substring) so a GET and a PATCH
 * on the SAME path can be told apart — which is the whole point here.
 * `status`-bearing entries answer not-ok, for the fail-closed cases.
 */
function stubFetch(routes: Array<{
  method?: string;
  match: string;
  body?: unknown;
  status?: number;
  statusText?: string;
}>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes.find(
      (r) => (r.method ?? 'GET').toUpperCase() === method && String(url).includes(r.match),
    );
    if (!route) throw new Error(`unstubbed fetch: ${method} ${url}`);
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: route.statusText ?? 'OK',
      json: async () => route.body,
      text: async () => (route.body === undefined ? '' : JSON.stringify(route.body)),
    } as unknown as Response;
  });
}

/** Records where the router settles, so "navigated" is an assertion. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const recordPath = (objectName: string, recordId: string) =>
  `/apps/ai.objectstack.showcase/${objectName}/record/${recordId}`;

function renderInternal(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit${query}`]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/forms/:name"
          element={<FormPage mode="internal" recordPath={recordPath} />}
        />
        <Route
          path="/apps/:appName/:objectName/record/:recordId"
          element={<div data-testid="record-page">record page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** The happy-path route table: metadata + object schema + the record read. */
function editRoutes(extra: Parameters<typeof stubFetch>[0] = []) {
  return stubFetch([
    { match: '/meta/view/', body: VIEW_ENVELOPE },
    { match: '/meta/object/', body: OBJECT_SCHEMA },
    { match: '/data/showcase_task/task-42', body: GET_RESPONSE },
    { method: 'PATCH', match: '/data/showcase_task/task-42', body: PATCH_RESPONSE },
    ...extra,
  ]);
}

beforeEach(() => {
  calls = [];
  // FormPage's feedback chrome reads the i18n catalogue (objectui#11039)
  // through the provider `main.tsx` mounts above this route. The app's own
  // factory registers its instance as react-i18next's global, which is how
  // this unwrapped route reaches the `en` pack; the harness restores the
  // global after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('?recordId= makes the internal form an EDIT (ruling point 1)', () => {
  it("renders the record's stored values instead of empty inputs", async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=task-42');

    // RED before the fix: both inputs render empty.
    expect(await screen.findByLabelText(/Title/)).toHaveValue('Write the report');
    expect(screen.getByLabelText(/Hours/)).toHaveValue('3');

    // And the record really was read from the declared endpoint.
    const read = calls.find((c) => c.method === 'GET' && c.url.includes('/data/showcase_task/'));
    expect(read?.url).toContain('/data/showcase_task/task-42');
  });

  it('PATCHes the record instead of inserting a duplicate', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=task-42');

    const title = await screen.findByLabelText(/Title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Write the report v2');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const write = calls.find((c) => c.method === 'PATCH')!;
    // The measured convention: PATCH /api/v1/data/:object/:id, bare field body.
    expect(write.url).toContain('/data/showcase_task/task-42');
    expect(write.body).toMatchObject({ title: 'Write the report v2' });

    // RED before the fix, and this is the defect itself: a POST to the
    // collection endpoint is an INSERT — the duplicate record #4278 is about.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('lands back on the record it updated', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=task-42');

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/apps/ai.objectstack.showcase/showcase_task/record/task-42',
      ),
    );
    expect(await screen.findByTestId('record-page')).toBeInTheDocument();
  });

  /**
   * The destination is the id from the URL — the row we PATCHed — not one read
   * back out of the response. Pinned with a response that names a DIFFERENT
   * id: a server answering that way is a bug, and following it would send the
   * user to a record they did not edit.
   */
  it('uses the URL id as the destination, not the update response body', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        { match: '/data/showcase_task/task-42', body: GET_RESPONSE },
        {
          method: 'PATCH',
          match: '/data/showcase_task/task-42',
          body: { object: 'showcase_task', id: 'task-999', record: {} },
        },
      ]),
    );
    renderInternal('?recordId=task-42');

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/apps/ai.objectstack.showcase/showcase_task/record/task-42',
      ),
    );
  });
});

describe('a recordId this route cannot honour FAILS CLOSED (ruling point 2)', () => {
  /**
   * Every case in here asserts the same two things, and the second is the one
   * that matters: an error panel IS shown, and no editable form is left behind
   * it. A create form here would be #4278's harm re-armed — the user fills it
   * in and inserts a duplicate.
   */
  async function expectRefusal(pattern: RegExp) {
    const panel = await screen.findByText(pattern);
    expect(panel).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Title/)).not.toBeInTheDocument();
  }

  it('404 (no such record) ⇒ error state, not an empty create form', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        { match: '/data/showcase_task/', status: 404, statusText: 'Not Found' },
      ]),
    );
    renderInternal('?recordId=task-404');
    await expectRefusal(/Could not open record "task-404".*404/s);
  });

  /**
   * This is also the LIVE shape of "the record belongs to another object": the
   * read is issued under the FORM's object, so an id from a different object
   * is simply not found there. (`packages/metadata-protocol`'s `getData`
   * throws `recordNotFoundError`, which REST maps to 404.)
   */
  it('403 (no permission) ⇒ error state, not an empty create form', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        { match: '/data/showcase_task/', status: 403, statusText: 'Forbidden' },
      ]),
    );
    renderInternal('?recordId=task-42');
    await expectRefusal(/Could not open record "task-42".*403/s);
  });

  it("an object mismatch in the payload ⇒ refuses to open the form", async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        {
          match: '/data/showcase_task/',
          body: { object: 'showcase_account', id: 'task-42', record: { title: 'Acme' } },
        },
      ]),
    );
    renderInternal('?recordId=task-42');
    await expectRefusal(/belongs to showcase_account/);
  });

  it('a present-but-blank ?recordId= refuses instead of creating', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=');
    await expectRefusal(/no record id was supplied/);
    // Nothing was even asked for — a refusal short-circuits the loaders.
    expect(calls).toHaveLength(0);
  });

  it('never issues a write after refusing', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        { match: '/data/showcase_task/', status: 404, statusText: 'Not Found' },
      ]),
    );
    renderInternal('?recordId=task-404');
    await screen.findByText(/Could not open record/);
    expect(calls.filter((c) => c.method === 'POST' || c.method === 'PATCH')).toHaveLength(0);
  });
});

describe('prefill_ params override the loaded record, per field (ruling point 3)', () => {
  it('takes the param for the field it names and the record for the rest', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=task-42&prefill_hours=8');

    // The param wins for `hours` — a producer forwarding both is expressing
    // intent: edit THIS record, with THIS field pre-changed.
    expect(await screen.findByLabelText(/Hours/)).toHaveValue('8');
    // …and every field it does not name keeps the stored value.
    expect(screen.getByLabelText(/Title/)).toHaveValue('Write the report');
  });

  it('sends the merged values on the PATCH', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=task-42&prefill_hours=8');

    await screen.findByLabelText(/Hours/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({
      title: 'Write the report',
      hours: '8',
    });
  });
});

/**
 * CONTROLS — green before and after this change, and that is the point.
 * #4278 must move the create path by nothing at all.
 */
describe('control: no recordId ⇒ the create path is unchanged', () => {
  it('renders empty inputs (bar schema defaults) and POSTs to the collection', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        {
          method: 'POST',
          match: '/data/showcase_task',
          body: { object: 'showcase_task', id: 'task-new', record: {} },
        },
      ]),
    );
    renderInternal();

    expect(await screen.findByLabelText(/Title/)).toHaveValue('');
    // The schema default still applies in create mode.
    expect(screen.getByLabelText(/Hours/)).toHaveValue('0');
    // No record read was issued at all.
    expect(calls.filter((c) => c.url.includes('/data/'))).toHaveLength(0);

    await userEvent.type(screen.getByLabelText(/Title/), 'A new task');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const write = calls.find((c) => c.method === 'POST')!;
    expect(write.url).toMatch(/\/data\/showcase_task$/);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    // #4109's default still lands on the CREATED record, read off the response.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/apps/ai.objectstack.showcase/showcase_task/record/task-new',
      ),
    );
  });
});

describe('control: the PUBLIC /f/:slug path is untouched by #4278', () => {
  const PUBLIC_PAYLOAD = {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: { type: 'simple', sections: [{ fields: ['title'] }] },
    objectSchema: {
      name: 'showcase_inquiry',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  };

  function renderPublic(query = '') {
    return render(
      <MemoryRouter initialEntries={[`/f/contact-us${query}`]}>
        <LocationProbe />
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  /**
   * An anonymous visitor controls the URL. If `?recordId=` were honoured here
   * it would turn a public form into an arbitrary-record READER (prefilled
   * with someone else's data) and WRITER (a PATCH). Neither may ever happen.
   */
  it('reads no record and still POSTs to the public submit endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/forms/contact-us', body: PUBLIC_PAYLOAD },
        { method: 'POST', match: '/forms/contact-us/submit', body: { ok: true } },
      ]),
    );
    renderPublic('?recordId=task-42');

    expect(await screen.findByLabelText(/Title/)).toHaveValue('');
    // No data-API read whatsoever — the anonymous surface never touches /data.
    expect(calls.filter((c) => c.url.includes('/data/'))).toHaveLength(0);

    await userEvent.type(screen.getByLabelText(/Title/), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.url).toContain('/forms/contact-us/submit');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    // The anonymous confirmation, unchanged.
    expect(await screen.findByText('Your submission has been received successfully.')).toBeInTheDocument();
  });
});
