/**
 * `loadLanguage` — the app's translation payload off
 * `GET /api/v1/i18n/translations/:locale`, recognised by ANY spec group it
 * carries (objectui#10235).
 *
 * The loader branches on `isSpecTranslationData`: a spec payload is
 * transformed and namespaced under `app`, where the readers look; anything
 * else is returned as-is for a mock or local-dev server that already speaks
 * i18next namespaces. The recogniser used to answer `true` only when some
 * `objects` entry carried `fields`, so a genuine bundle that translated object
 * labels, apps, pages, dashboards or flows — and no field label — landed at the
 * root of the resource tree and nothing ever read it.
 *
 * The recogniser lives in `@object-ui/i18n`, which deliberately does not
 * depend on `@objectstack/spec`; this package does. So the spec-keyed pin is
 * here: the group list is walked off the spec's own served-document shape
 * (`GetTranslationsResponseSchema`), never retyped, and a group the spec adds
 * that the recogniser does not know fails the first test below.
 *
 * The render tests go through the real loader — envelope unwrap, predicate,
 * transform — and hand its answer to i18next with the `addResourceBundle` call
 * `I18nProvider` makes, then draw the two readers the card names.
 *
 * The loader reads only for a signed-in page load (objectui#12034), so every
 * test here runs signed in unless it says otherwise; the session rule itself
 * is the last describe block.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GetTranslationsResponseSchema } from '@objectstack/spec/api';
import type { TranslationData } from '@objectstack/spec/system';
import { createI18n, I18nProvider, useObjectLabel } from '@object-ui/i18n';
import { FlowRunner, type ScreenFlowState } from '@object-ui/app-shell';
import { TokenStorage } from '@object-ui/auth';
import { loadLanguage } from './loadLanguage';
import { publishAuthState } from './i18nSession';

/**
 * Serve `body` as the endpoint's JSON answer. A real `Response`: the loader
 * reads through the console's authenticated fetch, which reads the answer's
 * headers (objectui#12034).
 */
function respond(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

/** Serve `translations` inside the spec REST envelope, as the server does. */
function serve(translations: unknown) {
  respond({ data: { locale: 'zh-CN', translations } });
}

/** An i18next instance in zh-CN carrying whatever the real loader answered. */
async function loadedInstance(translations: TranslationData) {
  serve(translations);
  const resources = await loadLanguage('zh-CN');
  const instance = createI18n({ defaultLanguage: 'zh-CN', detectBrowserLanguage: false });
  instance.addResourceBundle('zh-CN', 'translation', resources, true, true);
  return instance;
}

beforeEach(() => {
  publishAuthState({ isAuthenticated: true, isLoading: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TokenStorage.clear();
});

describe('loadLanguage — a spec payload is recognised by any group it carries (objectui#10235)', () => {
  it('namespaces every group of the served document, alone, under `app`', async () => {
    const shape = GetTranslationsResponseSchema.shape.translations;
    const groups = Object.keys(shape.shape);
    // Positive control: the walk reads the spec's shape, not an empty object.
    expect(groups).toEqual(expect.arrayContaining(['objects', 'flows']));

    for (const group of groups) {
      const payload = { [group]: {} };
      // The probe is a payload the spec itself accepts …
      expect(shape.safeParse(payload).success, group).toBe(true);
      serve(payload);
      // … and the loader transforms it rather than returning it to the root.
      expect(Object.keys(await loadLanguage('zh-CN')), group).toEqual(['app']);
    }
  });

  it('an object-label-only bundle renders the translation', async () => {
    const instance = await loadedInstance({ objects: { crm_lead: { label: '线索' } } });

    function ObjectTitle() {
      const { objectLabel } = useObjectLabel();
      return <h1>{objectLabel({ name: 'crm_lead', label: 'Lead' })}</h1>;
    }
    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <ObjectTitle />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { name: '线索' })).toBeInTheDocument();
    expect(screen.queryByText('Lead')).not.toBeInTheDocument();
  });

  it('a flows-only bundle — the wizard draws the translation', async () => {
    const instance = await loadedInstance({
      flows: {
        lead_conversion: {
          screens: {
            screen_1: {
              title: '转化详情',
              fields: { opportunityName: { label: '商机名称' } },
            },
          },
        },
      },
    });
    const state: ScreenFlowState = {
      flowName: 'lead_conversion',
      runId: 'run-1',
      screen: {
        nodeId: 'screen_1',
        title: 'Conversion Details',
        fields: [{ name: 'opportunityName', label: 'Opportunity Name', type: 'text' }],
      },
    };

    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <FlowRunner
          state={state}
          authFetch={vi.fn(async () => new Response('{}'))}
          baseUrl=""
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />
      </I18nProvider>,
    );

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('商机名称')).toBeInTheDocument();
    expect(dialog.queryByText('Opportunity Name')).not.toBeInTheDocument();
    // The heading is drawn as served: the engine translates it in the run's
    // locale (objectstack#22507 ruling A), so the bundle's `title` is never
    // overlaid on the client (objectui#12075).
    expect(dialog.getByRole('heading', { name: 'Conversion Details' })).toBeInTheDocument();
  });
});

describe('loadLanguage — an already-namespaced tree is returned as-is', () => {
  it('an app namespace inside the envelope', async () => {
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

describe('loadLanguage — reads only for a signed-in page load, with its credentials (objectui#12034)', () => {
  it('signed out: requests nothing and answers no translations', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    publishAuthState({ isAuthenticated: false, isLoading: false });

    await expect(loadLanguage('zh-CN')).resolves.toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('unanswered: waits for the session, then reads with the bearer the data adapter sends', async () => {
    serve({ objects: { crm_lead: { label: '线索' } } });
    const fetchSpy = vi.mocked(fetch);
    TokenStorage.set('tok-12034');
    publishAuthState({ isAuthenticated: false, isLoading: true });

    const pending = loadLanguage('zh-CN');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).not.toHaveBeenCalled();

    publishAuthState({ isAuthenticated: true, isLoading: false });
    expect(Object.keys(await pending)).toEqual(['app']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/i18n/translations/zh-CN');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-12034');
  });
});
