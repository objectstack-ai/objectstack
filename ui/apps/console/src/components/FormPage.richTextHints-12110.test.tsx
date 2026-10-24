// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12110, item 7's second half (ruled B, comment 6115662567): a
 * rich-text field draws no editor hint line on the anonymous public form, and
 * none on an internal console form either.
 *
 * ## What this reproduces
 *
 * The HotCRM browser pass (findings A-09 / B-08) opened a public `/f/:slug`
 * form as an anonymous visitor and found two lines of editor chrome above
 * every rich-text field: "Format: markdown" and "Rich text editor (basic)".
 * `RichTextField` drew them in its shared editing surface, on every page. The
 * ruling removes them from the widget on every surface rather than teaching
 * the widget which page it is on: a widget cannot tell the public page from an
 * internal one, and a per-surface switch on the widget contract was the option
 * not taken. So this file renders the SAME rich-text fields through both
 * routes `FormPage` serves and asks each the same question.
 *
 * ## The legs
 *
 * - `NO_HINT_LINE` — on each route, for all three registry keys this widget
 *   serves (`markdown`, `html`, `richtext`), neither line is drawn anywhere on
 *   the page.
 * - `AUTHORED_GUIDANCE_STAYS` — the control the ruling names ("the field's own
 *   help text and placeholder stay where authored guidance lives"): the
 *   authored `placeholder` reaches the editor and the authored help text
 *   renders under the row. A change that took the guidance channel away along
 *   with the chrome fails here, not in the leg above.
 *
 * Both legs first wait for every rich-text editor to be on screen by its label
 * (`liveEditors`), so an absence is read off rendered editors: a page that
 * never loaded cannot pass as "no hint line".
 *
 * The widget sits behind `React.lazy` (`getLazyFieldWidget`), but its module
 * is loaded at import time: `FormPage` imports the `@object-ui/fields` barrel,
 * which re-exports `./widgets/RichTextField.js` statically, so the lazy factory
 * resolves from the module cache instead of racing the bounded `waitFor`
 * window (AGENTS.md, the flaky-test discipline).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixture ───────────────────────────────────────────────────────────────

/** One field per registry key `RichTextField` serves. */
const OBJECT_SCHEMA = {
  name: 'hc_case',
  label: 'Case',
  fields: {
    details: { type: 'markdown', label: 'Details' },
    notes: { type: 'html', label: 'Notes' },
    body: { type: 'richtext', label: 'Body' },
  },
};

/** The rows' labels, in section order — how each editor is found on screen. */
const EDITOR_LABELS = ['Details', 'Notes', 'Body'];

/** Authored guidance on the first row: the channel the ruling keeps. */
const PLACEHOLDER = 'What happened, and when?';
const HELP_TEXT = 'Steps to reproduce help us answer faster.';

/** The form view's one section, as both routes serve it. */
const SECTION_FIELDS = [
  { field: 'details', placeholder: PLACEHOLDER, helpText: HELP_TEXT },
  'notes',
  'body',
];

/**
 * The lines the editing surface drew before this card: the format label for
 * each syntax (`markdown`; `html` for both `html` and `richtext`) and the
 * basic-editor line, which was the same for all three.
 */
const HINT_LINES = ['Format: markdown', 'Format: html', 'Rich text editor (basic)'];

type Surface = 'public' | 'internal';

function stubFetch(routes: Array<{ match: string; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const route = routes.find((r) => String(url).includes(r.match));
    if (!route) throw new Error(`unstubbed fetch: ${url}`);
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
 * Render one of the two routes over the same object and the same section:
 * the anonymous `/f/:slug` page (`GET /forms/:slug`), or the authed internal
 * `/forms/:name` page (`GET /meta/view/:name` + `GET /meta/object/:name`).
 */
function renderSurface(surface: Surface) {
  if (surface === 'public') {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        {
          match: '/forms/support',
          body: {
            slug: 'support',
            object: 'hc_case',
            form: {
              type: 'simple',
              columns: 1,
              title: 'Support request',
              sections: [{ name: 'request', label: 'Request', fields: SECTION_FIELDS }],
            },
            objectSchema: OBJECT_SCHEMA,
          },
        },
      ]),
    );
    return render(
      <MemoryRouter initialEntries={['/f/support']}>
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  vi.stubGlobal(
    'fetch',
    stubFetch([
      {
        match: '/meta/view/',
        body: {
          name: 'hc_case.intake',
          object: 'hc_case',
          viewKind: 'form',
          label: 'Case intake',
          config: { type: 'simple', sections: [{ label: 'Request', fields: SECTION_FIELDS }] },
        },
      },
      { match: '/meta/object/', body: OBJECT_SCHEMA },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/hc_case.intake']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Harness-kill leg: every rich-text row's editor is on screen, named by its
 * label, and there is exactly one editor per row. Its message is unlike every
 * content assertion in this file on purpose, so a harness death is never read
 * as a hint line found or missed.
 */
async function liveEditors(): Promise<HTMLTextAreaElement[]> {
  await waitFor(() => {
    for (const label of EDITOR_LABELS) {
      expect(screen.getByLabelText(label).tagName).toBe('TEXTAREA');
    }
  });
  const count = document.body.querySelectorAll('textarea').length;
  if (count !== EDITOR_LABELS.length) {
    throw new Error(`HARNESS DEAD 12110: expected ${EDITOR_LABELS.length} editors, found ${count}`);
  }
  return EDITOR_LABELS.map((label) => screen.getByLabelText(label) as HTMLTextAreaElement);
}

beforeEach(() => {
  // The console mounts the `en` catalogue above both routes; the hint lines
  // were catalogue strings, so the page is read through the same catalogue.
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each<Surface>(['public', 'internal'])('objectui#12110 — rich-text editor hints, %s form', (surface) => {
  it('NO_HINT_LINE — no rich-text field draws a format label or the basic-editor line', async () => {
    renderSurface(surface);
    await liveEditors();

    const page = document.body.textContent ?? '';
    for (const line of HINT_LINES) {
      expect(page).not.toContain(line);
    }
  });

  it('AUTHORED_GUIDANCE_STAYS — the placeholder reaches the editor and the help text renders', async () => {
    renderSurface(surface);
    const [details] = await liveEditors();

    expect(details).toHaveAttribute('placeholder', PLACEHOLDER);
    expect(screen.getByText(HELP_TEXT)).toBeInTheDocument();
  });
});
