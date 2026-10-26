// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12333 — the console half of objectstack-ai/objectstack#23497: a
 * SIGNED-OUT visitor of the public form `/f/:slug` reads each section's heading
 * and description in the language the server served them in.
 *
 * ## Why this needs its own pin
 *
 * `FormPage.sectionLabelI18n.test.tsx` (objectui#8813) seeds the app bundle
 * itself through `createI18n`, so it covers a visitor who HOLDS a bundle: the
 * signed-in visitor of `/f/:slug`. A signed-out visitor holds none. The
 * `/i18n` domain refuses an anonymous caller (objectstack-ai/objectstack#22432)
 * and the console's `loadLanguage` requests nothing and answers `{}` when
 * signed out (objectui#12034). So on this path the client-side
 * `objects.{object}._sections.{name}.label` lookup always misses, and the
 * heading is whatever `sec.label` the payload carries.
 *
 * Since objectstack-ai/objectstack#23497 the server's `GET /forms/:slug`
 * localizes each section's `label` and `description` under `Accept-Language`.
 * This file pins that the console renders those served strings on the
 * signed-out path, with the bundle state production has there: none.
 *
 * ## The tree
 *
 * The route is wrapped in the provider `main.tsx` mounts, `I18nProvider`, fed
 * the console's real `loadLanguage`, with the session answered signed out
 * through the same `publishAuthState` that `App.tsx` feeds. ⛔ No bundle is
 * seeded anywhere in this file. `NO_I18N_REQUEST` proves the loader asked for
 * none, so the payload is the only source a translated string can come from.
 *
 * ## Discrimination
 *
 * The zh-CN legs would also pass on a renderer that printed any string it was
 * handed, so `CONTROL_ENGLISH_PAYLOAD_RENDERS_ENGLISH` renders the same route
 * against an English payload and asserts English. Nothing here can produce a
 * Chinese heading except the payload. The description legs were proven red
 * against `main` before `FormPage` rendered `sec.description` at all.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { FormPage } from './FormPage';
import { loadLanguage } from '../loadLanguage';
import { publishAuthState } from '../i18nSession';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixture — HotCRM's web-to-lead form, as next.3 serves it in zh-CN ────

const LANG = 'zh-CN';
const API_NAME = 'crm_lead';

const LEAD_SCHEMA = {
  name: API_NAME,
  label: '线索',
  fields: {
    first_name: { type: 'text', label: '名' },
    company: { type: 'text', label: '公司' },
    description: { type: 'textarea', label: '描述' },
  },
};

/** One section per row: its stable name, and what each payload serves for it. */
const SECTIONS = [
  {
    name: 'tell_us_about_yourself',
    field: 'first_name',
    zh: { label: '请介绍一下您自己', description: '我们只用这些信息联系您。' },
    en: { label: 'Tell us about yourself', description: 'We use these details only to contact you.' },
  },
  {
    name: 'about_your_company',
    field: 'company',
    zh: { label: '您的公司信息', description: '帮助我们把您转给合适的团队。' },
    en: { label: 'About your company', description: 'Helps us route you to the right team.' },
  },
  {
    name: 'how_can_we_help',
    field: 'description',
    zh: { label: '我们能帮您什么？', description: undefined },
    en: { label: 'How can we help?', description: undefined },
  },
] as const;

function payload(locale: 'zh' | 'en') {
  return {
    slug: 'contact-us',
    object: API_NAME,
    form: {
      type: 'simple',
      columns: 1,
      title: locale === 'zh' ? '联系我们' : 'Contact us',
      sections: SECTIONS.map((s) => ({
        name: s.name,
        label: s[locale].label,
        ...(s[locale].description ? { description: s[locale].description } : {}),
        fields: [s.field],
      })),
    },
    objectSchema: LEAD_SCHEMA,
  };
}

// ─── Harness ──────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;

function renderSignedOutPublicRoute(body: unknown) {
  fetchSpy = vi.fn(async (url: string) => {
    if (!String(url).includes('/forms/contact-us')) {
      throw new Error(`unstubbed fetch: ${url}`);
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchSpy);
  return render(
    <I18nProvider
      loadLanguage={loadLanguage}
      config={{ defaultLanguage: LANG, detectBrowserLanguage: false }}
    >
      <MemoryRouter initialEntries={['/f/contact-us']}>
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The drawn sections, once the form loaded. Fails loudly if it never did. */
async function liveSections(): Promise<HTMLElement[]> {
  await waitFor(() =>
    expect(document.body.querySelectorAll('form > section').length).toBe(SECTIONS.length),
  );
  const sections = Array.from(document.body.querySelectorAll<HTMLElement>('form > section'));
  if (sections.length !== SECTIONS.length) {
    throw new Error(`HARNESS DEAD 12333: expected ${SECTIONS.length} sections, found ${sections.length}`);
  }
  return sections;
}

const heading = (s: HTMLElement) => s.querySelector('h2')?.textContent ?? '';
const description = (s: HTMLElement) =>
  s.querySelector(':scope > p')?.textContent ?? null;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // What `App.tsx` feeds `i18nSession` for a visitor who is not signed in.
  publishAuthState({ isAuthenticated: false, isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#12333 — signed-out /f/:slug renders the section text the server localized (console half of objectstack-ai/objectstack#23497)', () => {
  it('NO_I18N_REQUEST — the signed-out loader asks for no bundle, so the payload is the only source', async () => {
    renderSignedOutPublicRoute(payload('zh'));
    await liveSections();
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/forms/contact-us'))).toBe(true);
    expect(urls.filter((u) => u.includes('/i18n'))).toEqual([]);
  });

  it('SERVED_HEADINGS_RENDER — each named section shows the zh-CN label the payload carries', async () => {
    renderSignedOutPublicRoute(payload('zh'));
    const sections = await liveSections();
    expect(sections.map(heading)).toEqual(SECTIONS.map((s) => s.zh.label));
  });

  it('SERVED_DESCRIPTIONS_RENDER — a section description the payload carries is shown under its heading', async () => {
    renderSignedOutPublicRoute(payload('zh'));
    const sections = await liveSections();
    expect(sections.map(description)).toEqual(SECTIONS.map((s) => s.zh.description ?? null));
  });

  it('CONTROL_ENGLISH_PAYLOAD_RENDERS_ENGLISH — the route invents no translation of its own', async () => {
    renderSignedOutPublicRoute(payload('en'));
    const sections = await liveSections();
    expect(sections.map(heading)).toEqual(SECTIONS.map((s) => s.en.label));
    expect(sections.map(description)).toEqual(SECTIONS.map((s) => s.en.description ?? null));
  });
});
