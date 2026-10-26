// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4292 — the CONSUMER half: a form refuses an id that says it belongs
 * to another object.
 *
 * `?recordId=` names an id and nothing else, so #4278's read/write pair
 * resolves it against the FormView's own target object. Where primary keys are
 * per-table integers — which several drivers produce — `GET /data/showcase_task/42`
 * answers for the user who was looking at Account 42: the form prefills Task
 * 42's values and its submit PATCHes Task 42, with no error anywhere and the
 * record the user was actually on left untouched. The server cannot flag it
 * either, because it echoes the path's object back (`getData` returns
 * `object: request.object`), so the response is perfectly self-consistent —
 * which is why #4278's payload-mismatch guard cannot see this shape at all.
 *
 * PM ruling pinned here (issue #4292, on the claim comment): an id must never
 * travel without its object identity, and a mismatch fails closed at BOTH ends.
 * For this end: when `recordObject` is present AND differs from the FormView's
 * target object, the existing fail-closed error state (no load, no write); when
 * absent, current behaviour unchanged.
 *
 * ## Why BOTH halves, when the producer already refuses to forward
 *
 * `ActionRunner.executeForm` no longer emits a cross-object id at all, so in a
 * healthy console this guard never fires. It is not therefore redundant: URLs
 * arrive bookmarked, hand-written, pasted from chat, or from a producer that
 * predates the fix, and a shared identity means the console cannot tell those
 * apart. Defence in depth is the ruling's "both ends" — the producer stops
 * emitting the bad URL, the consumer stops honouring one.
 *
 * ## Reverse verification — predicted directions
 *
 * Reverting the CONSUMER half alone (`FormPage.tsx` back to origin/main) turns
 * RED only the forged-URL cases in the first block — the producer half cannot
 * defend a URL it never produced:
 *
 *   - "a mismatching recordObject ⇒ error state"   → prefills the WRONG record
 *   - "…issues no /data/ request at all"           → one GET to the wrong object
 *   - "…and no write can follow"                   → the form is submittable
 *
 * Reverting the PRODUCER half alone leaves every case here GREEN — this file
 * tests URLs directly, so it never asks the runner anything. The producer's own
 * pins live in `packages/core/…/ActionRunner.formObjectIdentity.test.ts`, and
 * `FormPage.test.ts` pins the two ends against each other end to end.
 *
 * GREEN BOTH SIDES (controls — #4292 must move neither):
 *
 *   - "recordObject agreeing with the view ⇒ #4278's edit path, unchanged";
 *   - "recordId with NO recordObject ⇒ #4278's behaviour, unchanged";
 *   - "the PUBLIC path ignores recordObject as it ignores recordId".
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** `showcase_task.edit` — the FormView the mis-scoped action targets. */
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

/**
 * The collision the card is about: id `42` exists in BOTH objects, and the
 * server answers this read without complaint — `object` echoes the path, so
 * nothing in the payload betrays that the user meant Account 42.
 */
const GET_RESPONSE = {
  object: 'showcase_task',
  id: '42',
  record: { id: '42', title: 'Write the report', hours: '3' },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

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

const recordPath = (objectName: string, recordId: string) =>
  `/apps/ai.objectstack.showcase/${objectName}/record/${recordId}`;

function renderInternal(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit${query}`]}>
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
    { match: '/data/showcase_task/42', body: GET_RESPONSE },
    {
      method: 'PATCH',
      match: '/data/showcase_task/42',
      body: { object: 'showcase_task', id: '42', record: {} },
    },
    ...extra,
  ]);
}

beforeEach(() => {
  // The submit button reads the i18n catalogue (objectui#11071) through the
  // provider `main.tsx` mounts above this route. The app's own factory
  // registers its instance as react-i18next's global, which is how this
  // unwrapped route reaches the `en` pack; the harness restores the global
  // after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a recordObject naming another object FAILS CLOSED (#4292)', () => {
  /**
   * The same two assertions #4278 established: an error panel IS shown, and no
   * editable form is left behind it. A create form here would re-arm the
   * original harm — the user fills it in and inserts a duplicate.
   */
  async function expectRefusal(pattern: RegExp) {
    const panel = await screen.findByText(pattern);
    expect(panel).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Title/)).not.toBeInTheDocument();
  }

  it('a mismatching recordObject ⇒ error state, not the other object\'s record', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42&recordObject=showcase_account');

    // RED before the fix: the guard does not exist, the read is issued under
    // the VIEW's object, id 42 resolves to Task 42, and the form prefills
    // "Write the report" — a record the user never opened.
    await expectRefusal(/This form edits showcase_task.*belongs to showcase_account/s);
  });

  it('issues no /data/ request at all — the refusal precedes the read', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42&recordObject=showcase_account');

    await screen.findByText(/Refusing to open it/);
    // The view metadata IS fetched — the object it declares is what the claim
    // is compared against, so it cannot be known any earlier. Everything after
    // that point is skipped, including the object schema.
    expect(calls.filter((c) => c.url.includes('/data/'))).toHaveLength(0);
    expect(calls.map((c) => c.url).filter((u) => u.includes('/meta/view/'))).toHaveLength(1);
  });

  it('and no write can follow, since there is no form to submit', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42&recordObject=showcase_account');

    await screen.findByText(/Refusing to open it/);
    expect(calls.filter((c) => c.method === 'POST' || c.method === 'PATCH')).toHaveLength(0);
  });

  it('refuses on case difference too — object names are not case-folded', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42&recordObject=Showcase_Task');

    await expectRefusal(/belongs to Showcase_Task/);
  });
});

/**
 * CONTROLS — #4278's paths, byte for byte. Each of these is a URL a healthy
 * console produces today, and #4292 must be invisible on all of them.
 */
describe('control: a recordObject that AGREES changes nothing (#4278 main path)', () => {
  it('loads, prefills and PATCHes exactly as without the param', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42&recordObject=showcase_task');

    expect(await screen.findByLabelText(/Title/)).toHaveValue('Write the report');
    expect(screen.getByLabelText(/Hours/)).toHaveValue('3');
    const read = calls.find((c) => c.method === 'GET' && c.url.includes('/data/'));
    expect(read?.url).toContain('/data/showcase_task/42');

    await userEvent.clear(screen.getByLabelText(/Title/));
    await userEvent.type(screen.getByLabelText(/Title/), 'Write the report v2');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const write = calls.find((c) => c.method === 'PATCH')!;
    expect(write.url).toContain('/data/showcase_task/42');
    expect(write.body).toMatchObject({ title: 'Write the report v2' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('control: recordId with NO recordObject keeps #4278 behaviour', () => {
  it('still loads and prefills — an old link is not refused', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42');

    expect(await screen.findByLabelText(/Title/)).toHaveValue('Write the report');
    expect(calls.some((c) => c.url.includes('/data/showcase_task/42'))).toBe(true);
  });

  it('an empty recordObject asserts nothing and is treated as absent', async () => {
    vi.stubGlobal('fetch', editRoutes());
    renderInternal('?recordId=42&recordObject=');

    expect(await screen.findByLabelText(/Title/)).toHaveValue('Write the report');
  });

  /**
   * #4278's payload-mismatch guard still fires on its own condition, and its
   * wording stays distinct — a failure must name WHICH check refused: the
   * link's claim (#4292) or what the server served (#4278).
   */
  it('leaves the payload-mismatch guard in place for what the SERVER serves', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/meta/view/', body: VIEW_ENVELOPE },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
        {
          match: '/data/showcase_task/42',
          body: { object: 'showcase_account', id: '42', record: { title: 'Acme' } },
        },
      ]),
    );
    renderInternal('?recordId=42&recordObject=showcase_task');

    // The link agreed with the view, so #4292 passed it through; the SERVER
    // then contradicted both, and #4278's guard caught it.
    expect(await screen.findByText(/belongs to showcase_account, but this form edits/))
      .toBeInTheDocument();
  });
});

describe('control: the PUBLIC /f/:slug path ignores recordObject too', () => {
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

  it('renders the create form and reads no record, whatever the URL claims', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        { match: '/forms/contact-us', body: PUBLIC_PAYLOAD },
        { method: 'POST', match: '/forms/contact-us/submit', body: { ok: true } },
      ]),
    );
    render(
      <MemoryRouter
        initialEntries={['/f/contact-us?recordId=42&recordObject=showcase_account']}
      >
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>,
    );

    // Neither param is read on the anonymous surface: no refusal, no read.
    expect(await screen.findByLabelText(/Title/)).toHaveValue('');
    expect(calls.filter((c) => c.url.includes('/data/'))).toHaveLength(0);
    expect(screen.queryByText(/Refusing to open it/)).not.toBeInTheDocument();
  });
});
