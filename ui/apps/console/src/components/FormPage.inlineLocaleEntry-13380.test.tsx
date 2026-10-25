// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13380 — a form field entry whose `label`, `placeholder` or
 * `helpText` is the spec's inline locale map (`I18nLabel`, `{ en, 'zh-CN' }`)
 * renders, in the visitor's language, on both routes `FormPage` serves.
 *
 * ## The defect
 *
 * `FormFieldBaseSchema` in `@objectstack/spec` types all three keys as
 * `I18nLabelSchema`, so the map parses and publishes clean, and the public
 * resolver serves it unchanged. `buildSections` copied it into `string` slots,
 * and the label reached JSX through `fieldLabel`'s fallback, which hands an
 * unmatched fallback back untouched. React refused the object as a child
 * (error #31) and `/f/:slug` was a white page for every visitor.
 *
 * ## The tree
 *
 * Each surface is the route `App.tsx` / `InternalFormRoute` declares, under
 * the `I18nProvider` `main.tsx` mounts, fed the console's real `loadLanguage`:
 *
 *  - `public` — `/f/:slug` signed out, so the loader asks for no bundle and
 *    the payload is the only source of copy;
 *  - `internal` — `/forms/:name` signed in, with the bundle answered empty so
 *    the authored copy is what renders.
 *
 * ## Discrimination
 *
 * One entry per key carries the map, so each key has its own leg. Putting the
 * map back on `label` or `helpText` blanks the page and turns every leg red;
 * on `placeholder` it reaches an attribute and renders `[object Object]`, so
 * only that key's legs go red. The zh-CN and en-US legs read different
 * strings out of the same map, which a resolver that took the first entry, or
 * always `en`, cannot both pass. `PLAIN_STRING_CONTROL` is a sibling entry
 * written with plain strings, asserted unchanged in both languages.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { FormPage } from './FormPage';
import { loadLanguage } from '../loadLanguage';
import { publishAuthState } from '../i18nSession';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixture ──────────────────────────────────────────────────────────────

const API_NAME = 'support_case';

/** Each inline map, and what each visitor must read out of it. */
const LABEL_MAP = { en: 'Your name', 'zh-CN': '您的姓名' };
const PLACEHOLDER_MAP = { en: 'name@example.com', 'zh-CN': '请输入邮箱' };
const HELP_MAP = { en: 'We reply within a day.', 'zh-CN': '我们会在一天内回复。' };

/** The plain-string control entry — the same strings in every language. */
const PLAIN = {
  label: 'Subject',
  placeholder: 'One line, please',
  helpText: 'Shown to the agent first.',
};

const CASE_SCHEMA = {
  name: API_NAME,
  label: 'Case',
  fields: {
    // The object labels differ from every entry override, so a row that fell
    // back to the object field would read as a miss.
    contact_name: { type: 'text', label: 'Contact name' },
    email: { type: 'text', label: 'Email' },
    phone: { type: 'text', label: 'Phone' },
    subject: { type: 'text', label: 'Case subject' },
  },
};

const FORM = {
  type: 'simple',
  columns: 1,
  title: 'Support',
  sections: [
    {
      name: 'contact',
      label: 'Contact',
      fields: [
        // The map on `label` alone.
        { field: 'contact_name', label: LABEL_MAP, placeholder: 'Full name', helpText: 'As on your ID.' },
        // The map on `placeholder` alone.
        { field: 'email', label: 'Email address', placeholder: PLACEHOLDER_MAP, helpText: 'For replies.' },
        // The map on `helpText` alone.
        { field: 'phone', label: 'Phone number', placeholder: '+1 555 0100', helpText: HELP_MAP },
        // PLAIN_STRING_CONTROL.
        { field: 'subject', ...PLAIN },
      ],
    },
  ],
};

const PUBLIC_PAYLOAD = { slug: 'support', object: API_NAME, form: FORM, objectSchema: CASE_SCHEMA };

const VIEW_ENVELOPE = {
  name: 'support_case.intake',
  object: API_NAME,
  viewKind: 'form',
  label: 'Support',
  config: FORM,
};

// ─── Harness ──────────────────────────────────────────────────────────────

type Surface = 'public' | 'internal';
type Lang = 'en-US' | 'zh-CN';

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

const recordPath = (objectName: string, recordId: string) =>
  `/apps/support/${objectName}/record/${recordId}`;

function renderSurface(surface: Surface, lang: Lang) {
  publishAuthState({ isAuthenticated: surface === 'internal', isLoading: false });
  vi.stubGlobal(
    'fetch',
    stubFetch(
      surface === 'public'
        ? [{ match: '/forms/support', body: PUBLIC_PAYLOAD }]
        : [
            { match: '/meta/view/', body: VIEW_ENVELOPE },
            { match: '/meta/object/', body: CASE_SCHEMA },
            // The signed-in visitor's bundle, answered empty: the authored copy
            // is what renders.
            { match: '/i18n/', body: {} },
          ],
    ),
  );
  return render(
    <I18nProvider
      loadLanguage={loadLanguage}
      config={{ defaultLanguage: lang, detectBrowserLanguage: false }}
    >
      {surface === 'public' ? (
        <MemoryRouter initialEntries={['/f/support']}>
          <Routes>
            <Route path="/f/:slug" element={<FormPage mode="public" />} />
          </Routes>
        </MemoryRouter>
      ) : (
        <MemoryRouter initialEntries={['/forms/support_case.intake']}>
          <Routes>
            <Route path="/forms/:name" element={<FormPage mode="internal" recordPath={recordPath} />} />
          </Routes>
        </MemoryRouter>
      )}
    </I18nProvider>,
  );
}

/** The form, once loaded — anchored on the plain-string control's label. */
async function liveForm() {
  await waitFor(() => expect(screen.getByLabelText(PLAIN.label)).toBeInTheDocument());
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pick = (map: Record<string, string>, lang: Lang) => (lang === 'zh-CN' ? map['zh-CN'] : map.en);

describe.each<Surface>(['public', 'internal'])('objectui#13380 — inline locale map on a field entry, %s form', (surface) => {
  describe.each<Lang>(['en-US', 'zh-CN'])('visitor in %s', (lang) => {
    it('LABEL_MAP_RESOLVES — the entry label is the visitor\'s string', async () => {
      renderSurface(surface, lang);
      await liveForm();
      expect(screen.getByLabelText(pick(LABEL_MAP, lang))).toBeInTheDocument();
    });

    it('PLACEHOLDER_MAP_RESOLVES — the entry placeholder is the visitor\'s string', async () => {
      renderSurface(surface, lang);
      await liveForm();
      expect(screen.getByLabelText('Email address')).toHaveAttribute('placeholder', pick(PLACEHOLDER_MAP, lang));
    });

    it('HELP_TEXT_MAP_RESOLVES — the entry help line is the visitor\'s string', async () => {
      renderSurface(surface, lang);
      await liveForm();
      expect(screen.getByText(pick(HELP_MAP, lang))).toBeInTheDocument();
    });

    it('PLAIN_STRING_CONTROL — a plain-string entry renders exactly as authored', async () => {
      renderSurface(surface, lang);
      await liveForm();
      expect(screen.getByLabelText(PLAIN.label)).toHaveAttribute('placeholder', PLAIN.placeholder);
      expect(screen.getByText(PLAIN.helpText)).toBeInTheDocument();
    });
  });
});
