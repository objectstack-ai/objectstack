/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The starter's `loadLanguage` — the loader `src/main.tsx` hands to
 * `I18nProvider` — must namespace a spec `TranslationData` payload where the
 * readers look (objectui#10349).
 *
 * The server answers `/api/v1/i18n/translations/:lang` with a spec document
 * inside the REST envelope. The loader used to return that document as-is, so
 * it landed at the root of the i18next resource tree; `useObjectLabel` only
 * reads app namespaces one level down, and an author starting from this
 * template saw their own source labels in every locale, with no error. The
 * loader now takes the reference console's branch —
 * `isSpecTranslationData` ⇒ `transformSpecTranslations`, both from
 * `@object-ui/i18n` — and these tests go through the real loader, then hand
 * its answer to i18next with the `addResourceBundle` call `I18nProvider` makes
 * and draw the reader the card names.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createI18n, I18nProvider, useObjectLabel } from '@object-ui/i18n';
import { loadLanguage } from '../src/loadLanguage';

/** Serve `body` as the endpoint's JSON answer. */
function respond(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
}

/** Serve `translations` inside the spec REST envelope, as the server does. */
function serve(translations: unknown) {
  respond({ data: { locale: 'zh-CN', translations } });
}

/** The card's payload: an object label AND a field label. */
const SPEC_PAYLOAD = {
  objects: { crm_lead: { label: '线索', fields: { name: { label: '名称' } } } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadLanguage — a spec payload lands where the readers look (objectui#10349)', () => {
  it('namespaces the spec payload under `app`, flattening its field labels', async () => {
    serve(SPEC_PAYLOAD);
    const resources = await loadLanguage('zh-CN');

    expect(resources).toEqual({
      app: {
        objects: { crm_lead: { label: '线索' } },
        fields: { crm_lead: { name: '名称' } },
      },
    });
  });

  it('renders the translated object and field labels through `useObjectLabel`', async () => {
    serve(SPEC_PAYLOAD);
    const resources = await loadLanguage('zh-CN');
    const instance = createI18n({ defaultLanguage: 'zh-CN', detectBrowserLanguage: false });
    instance.addResourceBundle('zh-CN', 'translation', resources, true, true);

    function LeadHeader() {
      const { objectLabel, fieldLabel } = useObjectLabel();
      return (
        <>
          <h1>{objectLabel({ name: 'crm_lead', label: 'Lead' })}</h1>
          <h2>{fieldLabel('crm_lead', 'name', 'Name')}</h2>
        </>
      );
    }
    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <LeadHeader />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('线索');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('名称');
  });
});

describe('loadLanguage — anything else passes through unchanged', () => {
  it('an already-namespaced tree inside the envelope', async () => {
    const flat = {
      crm: {
        objects: { crm_lead: { label: '线索' } },
        fields: { crm_lead: { name: '名称' } },
      },
    };
    serve(flat);
    await expect(loadLanguage('zh-CN')).resolves.toEqual(flat);
  });

  it('a built-in override with no envelope, as a mock server may answer', async () => {
    const flat = { common: { save: '保存' } };
    respond(flat);
    await expect(loadLanguage('zh-CN')).resolves.toEqual(flat);
  });
});

describe('loadLanguage — an empty or failed fetch still yields `{}`', () => {
  it('an empty translations document', async () => {
    serve({});
    await expect(loadLanguage('zh-CN')).resolves.toEqual({});
  });

  it('a null body', async () => {
    respond(null);
    await expect(loadLanguage('zh-CN')).resolves.toEqual({});
  });

  it('an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(loadLanguage('zh-CN')).resolves.toEqual({});
  });

  it('a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(loadLanguage('zh-CN')).resolves.toEqual({});
  });
});
