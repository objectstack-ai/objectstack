// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4109 — what happens after a successful submit, rendered.
 *
 * Maintainer ruling (2026-08-10, objectstack#7245, quoted verbatim on the
 * card): "**the `type: 'form'` contract means in-shell, and an internal submit
 * lands on the record.** … Internal-mode submit defaults to
 * redirect-to-created-record; `thank-you` stays the default for the public
 * `/f/:slug` path only." Point 3 adds that a form MAY declare its own
 * behaviour — so the corpus never has to opt out of a wrong default, and an
 * explicit declaration must keep winning in both modes.
 *
 * ## Reverse verification — which of these go red without the fix
 *
 * Restoring the old line (`loaded?.form?.submitBehavior ?? { kind: 'thank-you' }`
 * for both modes) turns the FIRST test red and only that one: the internal
 * submit stops navigating and renders the anonymous confirmation instead.
 * That is the whole behavioural change, so one change-detector is the honest
 * count.
 *
 * The other four are GUARDS, green before and after by design, and they are
 * here on purpose: the precedence tests are what stop a future "make the
 * default smarter" edit from swallowing a declared behaviour, and the public
 * test is what stops the new internal default from leaking onto the anonymous
 * path. A pin that only ever goes red with its own change would not cover
 * either risk.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The FormView metadata `/meta/view/:name` serves for the internal path. */
function viewEnvelope(submitBehavior?: unknown) {
  return {
    name: 'showcase_task.edit',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Log Time',
    config: {
      type: 'simple',
      sections: [{ label: 'Task', fields: ['title'] }],
      ...(submitBehavior ? { submitBehavior } : {}),
    },
  };
}

const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
};

/** The public `/forms/:slug` resolver payload. */
function publicPayload(submitBehavior?: unknown) {
  return {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: {
      type: 'simple',
      sections: [{ fields: ['title'] }],
      ...(submitBehavior ? { submitBehavior } : {}),
    },
    objectSchema: { name: 'showcase_inquiry', fields: { title: { type: 'text', label: 'Title' } } },
  };
}

/**
 * The create response, in the shape the spec declares and `packages/rest`
 * actually serves: `CreateDataResponse = { object, id, record }`, bare.
 */
const CREATE_RESPONSE = {
  object: 'showcase_task',
  id: 'task-42',
  record: { id: 'task-42', title: 'Write the report' },
};

let submits: Array<{ url: string; body: unknown }> = [];

function stubFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      submits.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    }
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => routes[key],
      text: async () => JSON.stringify(routes[key]),
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

function renderInternal() {
  return render(
    <MemoryRouter initialEntries={['/forms/showcase_task.edit']}>
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

function renderPublic() {
  return render(
    <MemoryRouter initialEntries={['/f/contact-us']}>
      <LocationProbe />
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  submits = [];
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

describe('internal submit — default behaviour (ruling point 2)', () => {
  it('lands on the record it just created when the form declares nothing', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope(),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': CREATE_RESPONSE,
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.type(screen.getByLabelText(/Title/), 'Write the report');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    // The create really was posted, and the id came off the response.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/apps/ai.objectstack.showcase/showcase_task/record/task-42',
      ),
    );
    expect(await screen.findByTestId('record-page')).toBeInTheDocument();
    expect(submits).toHaveLength(1);
    expect(submits[0].url).toContain('/data/showcase_task');

    // And emphatically NOT the anonymous confirmation.
    expect(screen.queryByText('Your submission has been received successfully.')).not.toBeInTheDocument();
  });

  /**
   * A create that succeeds but answers without the spec-declared `id` leaves
   * nothing to navigate to. Confirming beats navigating to `record/undefined`
   * — the record WAS created, so silence would be the worse answer.
   */
  it('confirms instead of navigating when the response names no id', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope(),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': { object: 'showcase_task', record: { title: 'x' } },
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByText('Your submission has been received successfully.')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/forms/showcase_task.edit');
  });
});

describe('an explicitly declared submitBehavior still wins (ruling point 3)', () => {
  it('internal: a declared thank-you is shown instead of the record redirect', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope({ kind: 'thank-you', title: 'Logged', message: 'Time saved.' }),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': CREATE_RESPONSE,
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByText('Logged')).toBeInTheDocument();
    expect(screen.getByText('Time saved.')).toBeInTheDocument();
    // Still on the form route — the declared behaviour suppressed the redirect.
    expect(screen.getByTestId('location').textContent).toBe('/forms/showcase_task.edit');
  });

  it('public: a declared `continue` resets the form instead of confirming', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/forms/contact-us/submit': { ok: true },
        '/forms/contact-us': publicPayload({ kind: 'continue' }),
      }),
    );
    renderPublic();

    await screen.findByLabelText(/Title/);
    await userEvent.type(screen.getByLabelText(/Title/), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(submits).toHaveLength(1));
    // `continue` keeps the form up with cleared values; no confirmation panel.
    expect(screen.queryByText('Your submission has been received successfully.')).not.toBeInTheDocument();
    expect(await screen.findByLabelText(/Title/)).toHaveValue('');
  });
});

describe('public submit — default behaviour is unchanged', () => {
  it('still shows the anonymous thank-you confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/forms/contact-us/submit': { ok: true },
        '/forms/contact-us': publicPayload(),
      }),
    );
    renderPublic();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByText('Your submission has been received successfully.')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/f/contact-us');
  });
});
