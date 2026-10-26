// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8408 — the public form `/f/:slug` renders its authored `title` and
 * `description`, not the object API name.
 *
 * ## What this reproduces, in the DOM
 *
 * The card was found taking release screenshots of a real app on this Console
 * (`objectstack-ai/ats`, ats#59): a member of the public opening the one
 * anonymous Console surface was greeted by a database table name.
 * `GET /api/v1/forms/apply` served the authored copy intact —
 * `{"object":"ats_inquiry","form":{"title":"Apply","description":"…"}}` — and
 * the page rendered `ats_inquiry` as its `<h1>` and nothing at all where the
 * description belongs. The fixture below IS that payload.
 *
 * Two independent reads were broken, and each leg here is written against the
 * one that a half-fix leaves standing:
 *
 *   1. `loadPublicForm`'s chain was `payload.label ?? payload.form?.label ??
 *      payload.object`. Every arm missed but the last: this endpoint sends no
 *      envelope `label`, and `form.label` is a key `@objectstack/spec`'s
 *      `FormViewSchema` REJECTS (`unrecognized_keys`) — a form config says
 *      `title`. So the one real, typed, populated key naming the form was the
 *      only one never read.
 *   2. The subtitle slot read `form.label` under `form.label !== loaded.label`,
 *      which is DEAD on this route in BOTH directions (no `payload.label` =>
 *      `loaded.label` IS `form.label` => inequality false; `payload.label`
 *      present => `form.label` undefined). `description` had exactly one
 *      occurrence in the whole 2 000-line file, inside a prose comment.
 *
 * ## ⭐ Which leg discriminates, said out loud
 *
 * `HEADING_IS_THE_AUTHORED_TITLE` alone does NOT close this card: a fix that
 * adds a `title` arm to the chain and leaves the dead subtitle predicate
 * standing satisfies it completely, and the author's sentence stays on the
 * floor. `DESCRIPTION_REACHES_THE_DOM` is the leg that fails under that
 * half-fix — it is the one that judges the predicate REPLACEMENT the card
 * asked for rather than a second condition stacked beside it.
 *
 * Conversely `DESCRIPTION_REACHES_THE_DOM` alone is satisfied by a renderer
 * that prints the description and still titles the page `ats_inquiry`. The two
 * legs are independent defects and neither subsumes the other, so both are
 * asserted against concrete authored strings, never against "something
 * non-empty".
 *
 * `API_NAME_IS_NOWHERE_IN_THE_HEADER` is the third: it fails a fix that adds
 * the title while leaving the API name rendered somewhere beside it, which no
 * presence assertion can see.
 *
 * ## ⛔ What this file does NOT pin, on purpose
 *
 * i18n. The section heading is still rendered raw on this route and this card
 * does not change that — it is the second seam, tracked separately, and
 * asserting a translated string HERE would assert it on a harness rather than
 * on the route (`useSafeFieldLabel` degrades to identity functions instead of
 * throwing, so such an assertion can pass without measuring anything). The
 * legs below are all server-supplied strings, which is exactly what this route
 * renders today and after this card.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixture — the card's own payload ─────────────────────────────────────

/** The authored title, verbatim from the served `/api/v1/forms/apply` body. */
const TITLE = 'Apply';
/** The authored description, verbatim from the same body. */
const DESCRIPTION = 'Tell the employer who you are. They will be in touch through the platform.';
/** The object API name — what the public page rendered as its `<h1>` before this card. */
const API_NAME = 'ats_inquiry';

const INQUIRY_SCHEMA = {
  name: API_NAME,
  label: 'Inquiry',
  fields: {
    full_name: { type: 'text', label: 'Full Name', required: true },
    email: { type: 'text', label: 'Email', required: true },
  },
};

/** The form config as authored — `title`/`description`, and NO `label`. */
const APPLY_FORM = {
  type: 'simple',
  columns: 1,
  title: TITLE,
  description: DESCRIPTION,
  sections: [{ name: 'apply', label: 'Your application', fields: ['full_name', 'email'] }],
};

interface Route_ { method?: string; match: string; body?: unknown }

function stubFetch(routes: Route_[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find(
      (r) => (r.method ?? 'GET').toUpperCase() === method && String(url).includes(r.match),
    );
    if (!route) throw new Error(`unstubbed fetch: ${method} ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    } as unknown as Response;
  });
}

/**
 * Render the PUBLIC route over a served payload.
 *
 * The payload is passed whole rather than assembled from parts: which keys the
 * resolver DOES and does NOT send is the entire subject of this card, so a
 * helper that always filled in a `label` would have hidden the defect the same
 * way the code did.
 */
function renderPublic(payload: Record<string, unknown>) {
  vi.stubGlobal('fetch', stubFetch([{ match: '/forms/apply', body: payload }]));
  return render(
    <MemoryRouter initialEntries={['/f/apply']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The payload the real resolver serves: no envelope `label`, no `form.label`. */
const SERVED = {
  slug: 'apply',
  object: API_NAME,
  form: APPLY_FORM,
  objectSchema: INQUIRY_SCHEMA,
};

/**
 * Harness-kill leg. Fires in BOTH directions — a form that never loaded and a
 * form drawn twice — so neither can be read as a content result. Its message is
 * unlike every content assertion in this file on purpose: a harness death must
 * never be counted as a defect detection when the ablation legs are classified.
 */
async function liveHeader(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByLabelText(/Full Name/)).toBeInTheDocument());
  const headers = document.body.querySelectorAll('header');
  if (headers.length !== 1) {
    throw new Error(`HARNESS DEAD 8408: expected exactly 1 header, found ${headers.length}`);
  }
  const h1s = headers[0].querySelectorAll('h1');
  if (h1s.length !== 1) {
    throw new Error(`HARNESS DEAD 8408: expected exactly 1 h1, found ${h1s.length}`);
  }
  return headers[0] as HTMLElement;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#8408 — public form heading and description', () => {
  it('HEADING_IS_THE_AUTHORED_TITLE — the h1 is "Apply", not the object API name', async () => {
    renderPublic(SERVED);
    const header = await liveHeader();

    expect(header.querySelector('h1')?.textContent).toBe(TITLE);
    expect(header.querySelector('h1')?.textContent).not.toBe(API_NAME);
  });

  it('DESCRIPTION_REACHES_THE_DOM — the authored sentence renders under the heading', async () => {
    renderPublic(SERVED);
    const header = await liveHeader();

    // Read out of the HEADER, not the document: "the string exists somewhere on
    // the page" would also be satisfied by a title attribute or an aria label,
    // and the card is about the subtitle SLOT beneath the heading.
    const subtitle = header.querySelector('h1 ~ p');
    expect(subtitle?.textContent).toBe(DESCRIPTION);
  });

  it('API_NAME_IS_NOWHERE_IN_THE_HEADER — the table name is not rendered beside the title', async () => {
    renderPublic(SERVED);
    const header = await liveHeader();

    expect(header.textContent).toContain(TITLE);
    expect(header.textContent).not.toContain(API_NAME);
  });

  it('ENVELOPE_LABEL_STILL_WINS — an identity label, when one is sent, keeps its precedence', async () => {
    // The card changed the fallback ORDER, not which value wins where one
    // already did. This leg is the fence on that: a fix that hoisted
    // `form.title` above `payload.label` would silently retitle every surface
    // that does send an envelope label.
    renderPublic({ ...SERVED, label: 'Careers — application' });
    const header = await liveHeader();

    expect(header.querySelector('h1')?.textContent).toBe('Careers — application');
    // …and the subtitle is driven by `description`, so it renders on this
    // branch too. Under the pre-fix predicate (`form.label !== loaded.label`)
    // it could not: `form.label` is undefined here.
    expect(header.querySelector('h1 ~ p')?.textContent).toBe(DESCRIPTION);
  });

  it('NO_TITLE_TAKES_THE_OBJECT_LABEL — a form with neither title nor label is headed by the object\'s label (objectui#12110 item 7)', async () => {
    // This leg used to pin the API name here, as the no-widening control of
    // objectui#8408. The HotCRM browser pass (finding A-09) measured that
    // fallback as the defect it is — an anonymous visitor greeted by the
    // database table name — and objectui#12110 rules the object's label in
    // ahead of it. The served payload carries that label on `objectSchema`.
    const { title, description, ...untitled } = APPLY_FORM;
    void title;
    void description;
    renderPublic({ ...SERVED, form: untitled });
    const header = await liveHeader();

    expect(header.querySelector('h1')?.textContent).toBe(INQUIRY_SCHEMA.label);
    expect(header.textContent).not.toContain(API_NAME);
    expect(header.querySelector('h1 ~ p')).toBeNull();
  });

  it('NO_LABEL_ANYWHERE_FALLS_BACK — with no object label either, the API name is the last resort', async () => {
    // The no-widening control, moved one arm down: when every arm before it
    // legitimately misses, the chain still ends where it always ended.
    const { title, description, ...untitled } = APPLY_FORM;
    void title;
    void description;
    const { label, ...unlabelledSchema } = INQUIRY_SCHEMA;
    void label;
    renderPublic({ ...SERVED, form: untitled, objectSchema: unlabelledSchema });
    const header = await liveHeader();

    expect(header.querySelector('h1')?.textContent).toBe(API_NAME);
  });
});
