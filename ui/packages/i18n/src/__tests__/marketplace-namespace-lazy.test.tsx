/**
 * The `marketplace` namespace's lazy runtime (objectstack#30588) — what a
 * marketplace page observes through `useMarketplaceNamespace()`, in order:
 *
 *   1. in a translated console, the namespace answers `loading` until the
 *      language's catalogue (and `en`, the packs' fallback) has landed, and a
 *      component behind it renders in that language from its FIRST render —
 *      never English, never the raw key;
 *   2. a language switch answers `loading` again until the new language's
 *      catalogue lands;
 *   3. a language the namespace has no catalogue for is served by `en`;
 *   4. a host's own `resources` for one `marketplace.*` key win over the
 *      built-in text and do not stop the rest of the catalogue from loading;
 *   5. a catalogue that cannot be fetched answers `failed` once — no retry
 *      loop — and `retry()` fetches it again.
 *
 * ## The registry is put back in its production state
 *
 * The DOM setup (`vitest.setup.i18n-catalogues.ts`) calls
 * `registerBuiltInLocales()`, which registers every language COMPLETE —
 * namespace included — so a page would never need a fetch, which is the
 * all-ten door's promise and not what a console visitor gets. This file
 * re-registers each language as its pack ALONE, at module scope: the registry
 * a console that awaited `preloadBootstrapLocale()` holds. A `dom` project
 * isolates each file's module graph, so nothing here reaches another file,
 * and the namespace starts with no catalogue fetched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { I18nProvider, useI18nContext, useObjectTranslation } from '../provider.js';
import { BUILT_IN_LANGUAGE_CODES, registerBuiltInLocale } from '../locales/registry.js';
import enPack from '../locales/en.js';
import zhPack from '../locales/zh.js';
import jaPack from '../locales/ja.js';
import koPack from '../locales/ko.js';
import dePack from '../locales/de.js';
import frPack from '../locales/fr.js';
import esPack from '../locales/es.js';
import ptPack from '../locales/pt.js';
import ruPack from '../locales/ru.js';
import arPack from '../locales/ar.js';
import enNs from '../namespaces/marketplace/en.js';
import zhNs from '../namespaces/marketplace/zh.js';
import jaNs from '../namespaces/marketplace/ja.js';
import {
  isMarketplaceCatalogueLoaded,
  useMarketplaceNamespace,
} from '../namespaces/marketplace/index.js';

/** `ko` is the catalogue whose fetch fails, until a case says otherwise. */
const koChunk = vi.hoisted(() => ({ fails: true, requests: 0 }));
vi.mock('../namespaces/marketplace/ko.js', async (importOriginal) => {
  koChunk.requests += 1;
  if (koChunk.fails) throw new Error('chunk offline');
  return importOriginal();
});

const PACKS: Record<string, Record<string, unknown>> = {
  en: enPack, zh: zhPack, ja: jaPack, ko: koPack, de: dePack,
  fr: frPack, es: esPack, pt: ptPack, ru: ruPack, ar: arPack,
};
for (const code of BUILT_IN_LANGUAGE_CODES) registerBuiltInLocale(code, PACKS[code]);

afterEach(cleanup);

/** Every text the probe below rendered, with the language it rendered in. */
let seen: string[] = [];

function Title() {
  const { t, i18n } = useObjectTranslation();
  const title = t('marketplace.title');
  const refresh = t('marketplace.refresh');
  seen.push(`${i18n.language}|${title}`);
  return (
    <div>
      <h1 data-testid="title">{title}</h1>
      <span data-testid="refresh">{refresh}</span>
    </div>
  );
}

function Page() {
  const namespace = useMarketplaceNamespace();
  const { changeLanguage } = useI18nContext();
  return (
    <div>
      <button onClick={() => void changeLanguage('ja')}>switch</button>
      {namespace.status === 'ready' ? (
        <Title />
      ) : (
        <p data-testid="state">
          {namespace.status}
          <button onClick={namespace.retry}>retry</button>
        </p>
      )}
    </div>
  );
}

function renderIn(language: string, resources?: Record<string, Record<string, unknown>>) {
  seen = [];
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources }} persistLanguage={false}>
      <Page />
    </I18nProvider>,
  );
}

const ZH_TITLE = zhNs.marketplace.title;
const JA_TITLE = jaNs.marketplace.title;
const EN_TITLE = enNs.marketplace.title;

describe('marketplace namespace — lazy', () => {
  it('a Chinese page waits, then renders Chinese from its first render', async () => {
    expect(isMarketplaceCatalogueLoaded('zh')).toBe(false);
    expect(isMarketplaceCatalogueLoaded('en')).toBe(false);

    renderIn('zh-CN');
    // The first paint: the fetch cannot have resolved synchronously.
    expect(screen.getByTestId('state').textContent).toContain('loading');
    expect(screen.queryByTestId('title')).toBeNull();

    expect(await screen.findByText(ZH_TITLE)).toBeTruthy();
    expect(screen.getByTestId('refresh').textContent).toBe(zhNs.marketplace.refresh);
    // Every render the component made was Chinese: no English, no raw key.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((entry) => entry !== `zh-CN|${ZH_TITLE}`)).toEqual([]);
    // What it fetched: its own catalogue and the fallback, nothing else.
    expect(isMarketplaceCatalogueLoaded('zh')).toBe(true);
    expect(isMarketplaceCatalogueLoaded('en')).toBe(true);
    expect(isMarketplaceCatalogueLoaded('ja')).toBe(false);
  });

  it('a language switch waits again for the new language', async () => {
    renderIn('zh-CN');
    expect(await screen.findByText(ZH_TITLE)).toBeTruthy();

    seen = [];
    await act(async () => {
      fireEvent.click(screen.getByText('switch'));
    });
    expect(await screen.findByText(JA_TITLE)).toBeTruthy();
    // Between the two, the component never rendered Japanese-console English.
    expect(seen.filter((entry) => entry.startsWith('ja|') && entry !== `ja|${JA_TITLE}`)).toEqual([]);
    expect(seen).toContain(`ja|${JA_TITLE}`);
  });

  it('a language with no catalogue of its own is served by en', async () => {
    renderIn('sv');
    expect(await screen.findByText(EN_TITLE)).toBeTruthy();
    expect(seen.filter((entry) => entry !== `sv|${EN_TITLE}`)).toEqual([]);
  });

  it("a host's own key wins, and the rest of the catalogue still loads", async () => {
    // A fresh instance whose zh resources spell the probe key themselves.
    renderIn('zh-CN', { zh: { marketplace: { title: '宿主自己的市场' } } });
    expect(await screen.findByText('宿主自己的市场')).toBeTruthy();
    expect(screen.getByTestId('refresh').textContent).toBe(zhNs.marketplace.refresh);
  });

  it('a catalogue that cannot be fetched says so once, and retry fetches it again', async () => {
    expect(koChunk.requests).toBe(0);
    renderIn('ko');
    expect(await screen.findByText(/failed/)).toBeTruthy();
    expect(koChunk.requests).toBe(1);

    // No retry loop: the failure stays a failure until the visitor asks.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(koChunk.requests).toBe(1);
    expect(screen.getByTestId('state').textContent).toContain('failed');

    koChunk.fails = false;
    await act(async () => {
      fireEvent.click(screen.getByText('retry'));
    });
    const ko = await vi.importActual<typeof import('../namespaces/marketplace/ko.js')>('../namespaces/marketplace/ko.js');
    expect(await screen.findByText(ko.default.marketplace.title)).toBeTruthy();
    expect(koChunk.requests).toBe(2);
  });
});
