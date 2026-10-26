// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4190 — where a declared `submitBehavior: { kind: 'redirect' }`
 * actually puts the submitter, rendered.
 *
 * The ruling this implements is objectstack#7496 (2026-08-11), landed in
 * `@objectstack/spec` by objectstack#7657 and live on this repo's 17.0.0 GA pin:
 * the url is a RELATIVE in-app path, interpolated from declared record fields
 * as `{{record.field}}`, URL-escaped when the redirect is built. The value-level
 * consequences are pinned in `submitRedirect.test.ts` against the spec's own
 * schema; this file pins the two things only a rendered page can show — WHICH
 * navigation mechanism runs, and what the submitter sees when the destination is
 * out of contract.
 *
 * ## Reverse verification — predicted first, then measured
 *
 * 1. **Restoring the browser-level navigation** on the authored string: 7 of the
 *    8 tests here go RED — all five navigation cases (the router's location never
 *    moves, so the destination route never renders) and both refusals. The one
 *    that stays green is `documents what the browser-level form would have
 *    resolved to`, which asserts a fact about URL resolution rather than about
 *    this component. The whole of `submitRedirect.test.ts` also stays green: that
 *    mutation kills the CALL SITE, leaving the module correct and unused, which
 *    is precisely why the mechanism has to be pinned here.
 *    (jsdom does not actually navigate either — which is how the old line's mount
 *    bug stayed invisible to every test. The assertion had to be "the shell
 *    moved", never "a full-page navigation was attempted".)
 * 2. **Deleting the refusal** and following the authored value: exactly the two
 *    refusal tests go RED, the six in-contract cases stay green. A narrow,
 *    non-overlapping change detector.
 * 3. **Deleting the escape** in the helper: `escapes a server-side value into one
 *    path segment` and `interpolates from the submitted values …` go RED here,
 *    alongside eight in the unit file. See that file's docblock for why the
 *    schema oracle alone does not catch every unescaped value.
 *
 * ## Why the basename is on the harness rather than in one test
 *
 * A bare `/` mount is where this bug hides: prefixed and unprefixed spellings
 * coincide there, which is what kept objectui#4181's sibling defect invisible.
 * Every render below is mounted under `/_console` so that a regression to a
 * mount-blind navigation cannot pass by coincidence.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The console mount the framework CLI configures for an embedded deployment. */
const MOUNT = '/_console';

function viewEnvelope(submitBehavior: unknown) {
  return {
    name: 'showcase_task.edit',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Log Time',
    config: {
      type: 'simple',
      sections: [{ label: 'Task', fields: ['title'] }],
      submitBehavior,
    },
  };
}

const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
};

/** `CreateDataResponse = { object, id, record }`, as `packages/rest` serves it. */
const CREATE_RESPONSE = {
  object: 'showcase_task',
  id: 'task-42',
  record: { id: 'task-42', title: 'Write the report', slug: 'write-the-report' },
};

function publicPayload(submitBehavior: unknown) {
  return {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: { type: 'simple', sections: [{ fields: ['title'] }], submitBehavior },
    objectSchema: {
      name: 'showcase_inquiry',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  };
}

let submits: Array<{ url: string; body: unknown }> = [];

function stubFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') {
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

/** Where the ROUTER settles — basename-stripped, which is the in-shell path. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/**
 * Mount the internal form under the console mount, with two plausible redirect
 * destinations declared as real routes so "went there" is an assertion about the
 * shell and not about a spy.
 */
function renderInternal() {
  return render(
    <MemoryRouter basename={MOUNT} initialEntries={[`${MOUNT}/forms/showcase_task.edit`]}>
      <LocationProbe />
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
        <Route path="/thanks" element={<div data-testid="thanks-page">thanks page</div>} />
        <Route path="/t/:slug" element={<div data-testid="slug-page">slug page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPublic() {
  return render(
    <MemoryRouter basename={MOUNT} initialEntries={[`${MOUNT}/f/contact-us`]}>
      <LocationProbe />
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
        <Route path="/thanks" element={<div data-testid="thanks-page">thanks page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  submits = [];
  vi.mocked(toast.error).mockClear();
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

describe('a ruled relative url is an in-shell route', () => {
  it('lands inside the shell, on the route the path names', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope({ kind: 'redirect', url: '/thanks' }),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': CREATE_RESPONSE,
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.type(screen.getByLabelText(/Title/), 'Write the report');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    // The shell moved: the destination route is mounted and the router's own
    // location is the authored path. A full-page navigation cannot produce
    // either — it leaves this router untouched (and, under the mount, resolves
    // against the origin root, which is the defect the card filed).
    expect(await screen.findByTestId('thanks-page')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/thanks');
    // And the write really happened before any of that.
    expect(submits).toHaveLength(1);
    expect(submits[0].url).toContain('/data/showcase_task');
  });

  /**
   * Why the mechanism is load-bearing, in the idiom `consoleBase.test.ts`
   * already uses: resolve the authored path the way a full-page navigation
   * would, against the document base the framework CLI injects for a mounted
   * console. It answers the ORIGIN ROOT, outside the mount — so consuming a
   * ruled in-app path that way drops the submitter out of the SPA no matter
   * what the path says. The router applies the basename instead, which is what
   * the test above observes.
   */
  it('documents what the browser-level form would have resolved to', () => {
    const baseEl = document.createElement('base');
    baseEl.setAttribute('href', `${MOUNT}/`);
    document.head.appendChild(baseEl);
    try {
      expect(new URL('/thanks', document.baseURI).pathname).toBe('/thanks');
      expect(new URL('/thanks', document.baseURI).pathname).not.toBe(`${MOUNT}/thanks`);
    } finally {
      baseEl.remove();
    }
  });

  it('substitutes the id of the record the submit just wrote', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope({ kind: 'redirect', url: '/thanks?ref={{record.id}}' }),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': CREATE_RESPONSE,
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByTestId('thanks-page')).toBeInTheDocument();
    // `task-42` came off the create response, read by the same one rule the
    // `created-record` arm uses — not from the values the user typed.
    expect(screen.getByTestId('location').textContent).toBe('/thanks?ref=task-42');
  });

  it('escapes a server-side value into one path segment', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope({ kind: 'redirect', url: '/t/{{record.slug}}' }),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': {
          ...CREATE_RESPONSE,
          record: { ...CREATE_RESPONSE.record, slug: 'a/b c' },
        },
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByTestId('slug-page')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/t/a%2Fb%20c');
  });

  it('interpolates from the submitted values on the anonymous path', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/forms/contact-us/submit': { ok: true },
        '/forms/contact-us': publicPayload({
          kind: 'redirect',
          url: '/thanks?t={{record.title}}',
        }),
      }),
    );
    renderPublic();

    await screen.findByLabelText(/Title/);
    await userEvent.type(screen.getByLabelText(/Title/), 'Hello there');
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    // The public submit answers no record, so the scope is what was submitted —
    // still "the record just submitted", which is the whole scope the ruling
    // gives a post-submit redirect.
    expect(await screen.findByTestId('thanks-page')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/thanks?t=Hello%20there');
  });

  it('keeps the declared delay: the confirmation shows first', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope({ kind: 'redirect', url: '/thanks', delayMs: 60 }),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': CREATE_RESPONSE,
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    // Still on the form route, showing the interstitial the delay exists for.
    expect(await screen.findByText('Redirecting…')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/forms/showcase_task.edit');
    // …and it arrives once the delay elapses.
    expect(await screen.findByTestId('thanks-page')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/thanks');
  });
});

describe('an out-of-contract destination is refused, not followed', () => {
  it('refuses an absolute destination and says so on screen', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope({ kind: 'redirect', url: 'https://example.com/thanks' }),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task': CREATE_RESPONSE,
      }),
    );
    renderInternal();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    // The refusal is the spec's own prescription, on screen — not a toast that
    // scrolls away, and emphatically not silence.
    const refusal = await screen.findByText(/accepts a RELATIVE path only/);
    expect(refusal).toBeInTheDocument();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringContaining('RELATIVE path only'),
    );

    // The write succeeded, so the submitter is told that too. Refusing the
    // destination must not read as "your submission failed".
    expect(screen.getByText('Your submission has been received successfully.')).toBeInTheDocument();
    expect(submits).toHaveLength(1);

    // Nothing was navigated to, and no interstitial promises otherwise.
    expect(screen.getByTestId('location').textContent).toBe('/forms/showcase_task.edit');
    expect(screen.queryByText('Redirecting…')).not.toBeInTheDocument();
  });

  it('refuses a protocol-relative destination — the leading slash is not enough', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/forms/contact-us/submit': { ok: true },
        '/forms/contact-us': publicPayload({ kind: 'redirect', url: '//example.com/thanks' }),
      }),
    );
    renderPublic();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByText(/protocol-relative/)).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/f/contact-us');
    expect(screen.queryByTestId('thanks-page')).not.toBeInTheDocument();
  });
});
