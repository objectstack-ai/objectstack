// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32225 — the Developer pages' strings (`console.developer.*`, and
 * the Integrations page's agent section's `connectAgent.*`) are a lazy
 * namespace, and a page never shows them in English or as raw keys while it
 * loads.
 *
 * Both groups left the language packs for `@object-ui/i18n/namespaces/developer`.
 * Each Developer page renders its body under app-shell's
 * `DeveloperNamespaceGate`: a copy-free skeleton (`developer-namespace-loading`)
 * until the namespace is in, then the page, in the console's language from the
 * first frame that has text.
 *
 * Every text node the page ever adds is recorded (a MutationObserver attached
 * before the first render), so "never English, never a raw key" holds over the
 * whole sequence, not only its end.
 *
 * ## The registry is put back in its production state
 *
 * The DOM setup calls `registerBuiltInLocales()`, which registers every
 * language COMPLETE — the namespace included — so the page would never need a
 * fetch. This file re-registers each language as its pack alone, at module
 * scope: the registry a console that awaited `preloadBootstrapLocale()` holds.
 *
 * Harness: `IntegrationsPage.pageHeader-12553.test.tsx`'s router and empty
 * reads, under a real `I18nProvider`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { BUILT_IN_LANGUAGE_CODES, registerBuiltInLocale } from '@object-ui/i18n/locales/registry';
import en from '@object-ui/i18n/locales/en';
import zhHans from '@object-ui/i18n/locales/zh-Hans';
import zhHant from '@object-ui/i18n/locales/zh-Hant';
import ja from '@object-ui/i18n/locales/ja';
import ko from '@object-ui/i18n/locales/ko';
import de from '@object-ui/i18n/locales/de';
import fr from '@object-ui/i18n/locales/fr';
import es from '@object-ui/i18n/locales/es';
import ptBr from '@object-ui/i18n/locales/pt-BR';
import ru from '@object-ui/i18n/locales/ru';
import ar from '@object-ui/i18n/locales/ar';
import { IntegrationsPage } from './IntegrationsPage';

const PACKS: Record<string, Record<string, unknown>> = {
  en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, de, fr, es, 'pt-BR': ptBr, ru, ar,
};
for (const code of BUILT_IN_LANGUAGE_CODES) registerBuiltInLocale(code, PACKS[code]);

const ENGLISH = builtInLocales.en.console.developer.integrations;
const RAW_KEY = /\b(?:console\.developer|connectAgent)\.[A-Za-z]/;

beforeEach(() => {
  // The object list and the agent section's discovery read: both answer empty.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a Developer page waits for its strings (objectstack#32225)', () => {
  it('zh-CN: Integrations & APIs shows the skeleton, then Chinese, and never English or a raw key', async () => {
    const zh = builtInLocales['zh-Hans'].console.developer.integrations;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const texts: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') texts.push(r.target.textContent ?? '');
        for (const node of Array.from(r.addedNodes)) texts.push(node.textContent ?? '');
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    render(
      <I18nProvider config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={['/apps/demo/developer/integrations']}>
          <Routes>
            <Route path="/apps/:appName/developer/integrations" element={<IntegrationsPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
      { container },
    );
    // The first frame holds no namespace text — in no language, and not as a
    // key — only the skeleton.
    texts.push(container.textContent ?? '');
    expect(container.textContent ?? '').not.toMatch(RAW_KEY);
    expect(container.textContent ?? '').not.toContain(ENGLISH.title);
    expect(screen.getByTestId('developer-namespace-loading')).toBeInTheDocument();

    expect(await screen.findByText(zh.title)).toBeInTheDocument();
    expect(screen.getByText(zh.subtitle)).toBeInTheDocument();
    // The agent section's `connectAgent.*` text arrived with the same catalogue.
    expect(container.textContent ?? '').not.toMatch(RAW_KEY);

    await act(async () => {
      await Promise.resolve();
    });
    for (const r of observer.takeRecords()) {
      for (const node of Array.from(r.addedNodes)) texts.push(node.textContent ?? '');
    }
    const shown = texts.join('\n');
    expect(shown).not.toContain(ENGLISH.title);
    expect(shown).not.toContain(ENGLISH.subtitle);
    expect(shown).not.toMatch(RAW_KEY);
  });
});
