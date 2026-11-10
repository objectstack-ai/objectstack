// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32225 — the `connectAgent.*` strings are a lazy namespace, and
 * the widgets that read them never show them in English or as raw keys while
 * the namespace loads.
 *
 * `connectAgent.*` (with `console.developer.*`) left the language packs for
 * `@object-ui/i18n/namespaces/developer`. Both `console/connect/` widgets
 * render their bodies under `DeveloperNamespaceGate`, which shows a copy-free
 * skeleton (`developer-namespace-loading`) until the namespace is in, then the
 * widget, in the console's language from the first frame that has text. A
 * catalogue that cannot be fetched is said in the console's own resident error
 * words, with Try again.
 *
 * Every text node the widget ever adds is recorded (a MutationObserver over the
 * render container, attached before the first render), so "never English,
 * never a raw key" is checked over the whole sequence, not only its end.
 *
 * ## The registry is put back in its production state
 *
 * The DOM setup calls `registerBuiltInLocales()`, which registers every
 * language COMPLETE — the namespace included — so the widget would never need
 * a fetch. This file re-registers each language as its pack alone, at module
 * scope: the registry a console that awaited `preloadBootstrapLocale()` holds.
 *
 * Harness: `ConnectAgentWidget.connected-30898.test.tsx`'s adapter, auth and
 * discovery stubs, under a real `I18nProvider` instead of its echoing `t`.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const arChunk = vi.hoisted(() => ({ fails: false, requests: 0 }));
const koChunk = vi.hoisted(() => ({ requests: 0 }));

// The Arabic catalogue's chunk, failing while a case says so.
vi.mock('@object-ui/i18n/namespaces/developer/ar', async (importOriginal) => {
  arChunk.requests += 1;
  if (arChunk.fails) throw new Error('chunk offline');
  return { ...(await importOriginal<Record<string, unknown>>()) };
});
// Counted: a page the AI Assistants widget does not belong on fetches nothing.
vi.mock('@object-ui/i18n/namespaces/developer/ko', async (importOriginal) => {
  koChunk.requests += 1;
  return { ...(await importOriginal<Record<string, unknown>>()) };
});

let record: { objectName: string; recordId: string } | null = null;
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({
    getClient: () => ({
      oauth: { authorizedClients: { list: async () => ({ clients: [], truncated: false }), withdraw: async () => ({}) } },
    }),
    find: async () => ({ data: [] }),
    update: async () => ({}),
  }),
  useRecordContext: () => record,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'user_me' },
    activeOrganization: { id: 'org_here', name: 'Here Inc' },
    organizations: [{ id: 'org_here', name: 'Here Inc' }],
  }),
}));

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
import { ConnectAgent } from './ConnectAgentWidget';
import { ManagedPersonAssistants } from './ManagedPersonAssistants';

const PACKS: Record<string, Record<string, unknown>> = {
  en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, de, fr, es, 'pt-BR': ptBr, ru, ar,
};
for (const code of BUILT_IN_LANGUAGE_CODES) registerBuiltInLocale(code, PACKS[code]);

const ENGLISH = builtInLocales.en.connectAgent;
const RAW_KEY = /\bconnectAgent\.[A-Za-z]/;

beforeEach(() => {
  arChunk.fails = false;
  record = null;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/discovery')) {
        return new Response(JSON.stringify({ data: { routes: { mcp: '/api/v1/mcp' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render `widget` in `language`, recording the text of every node it ever adds. */
function renderRecording(widget: ReactElement, language: string) {
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
  const result = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {widget}
    </I18nProvider>,
    { container },
  );
  // The first commit is synchronous; record it whatever the observer batched.
  texts.push(container.textContent ?? '');
  return {
    ...result,
    /** Everything the widget has shown so far, once the observer has delivered. */
    async shown(): Promise<string[]> {
      await act(async () => {
        await Promise.resolve();
      });
      for (const r of observer.takeRecords()) {
        for (const node of Array.from(r.addedNodes)) texts.push(node.textContent ?? '');
      }
      return texts;
    },
  };
}

describe('the connect widgets wait for their strings (objectstack#32225)', () => {
  it('zh-CN: Connect an assistant shows the skeleton, then Chinese, and never English or a raw key', async () => {
    const zh = builtInLocales['zh-Hans'].connectAgent;
    const view = renderRecording(<ConnectAgent />, 'zh-CN');
    // The first frame holds no namespace text — in no language, and not as a
    // key — only the skeleton.
    const firstFrame = view.container.textContent ?? '';
    expect(firstFrame).not.toMatch(RAW_KEY);
    expect(firstFrame).not.toContain(ENGLISH.capabilities.title);
    expect(screen.getByTestId('developer-namespace-loading')).toBeInTheDocument();

    expect(await screen.findByText(zh.capabilities.title)).toBeInTheDocument();
    expect(screen.queryByTestId('developer-namespace-loading')).toBeNull();

    const shown = (await view.shown()).join('\n');
    expect(shown).not.toContain(ENGLISH.capabilities.title);
    expect(shown).not.toContain(ENGLISH.capabilities.body);
    expect(shown).not.toMatch(RAW_KEY);
  });

  it('ja: the AI Assistants tab of a user record shows the skeleton, then Japanese, and never English or a raw key', async () => {
    record = { objectName: 'sys_user', recordId: 'user_7' };
    const view = renderRecording(<ManagedPersonAssistants />, 'ja');
    expect(view.container.textContent ?? '').not.toMatch(RAW_KEY);
    expect(screen.getByTestId('developer-namespace-loading')).toBeInTheDocument();

    expect(await screen.findByText(builtInLocales.ja.connectAgent.access.managedBody)).toBeInTheDocument();

    const shown = (await view.shown()).join('\n');
    expect(shown).not.toContain(ENGLISH.access.managedBody);
    expect(shown).not.toMatch(RAW_KEY);
  });

  it('a record page it does not belong on draws nothing and fetches nothing', async () => {
    record = { objectName: 'account', recordId: 'acc_1' };
    const view = renderRecording(<ManagedPersonAssistants />, 'ko');
    await view.shown();
    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('developer-namespace-loading')).toBeNull();
    expect(koChunk.requests).toBe(0);
  });

  it('ar: a catalogue that cannot be fetched is said in resident words, and Try again fetches it', async () => {
    arChunk.fails = true;
    const view = renderRecording(<ConnectAgent />, 'ar');

    const failed = await screen.findByTestId('developer-namespace-failed');
    expect(failed).toHaveTextContent(ar.console.errors.somethingWentWrong);
    expect(arChunk.requests).toBe(1);

    arChunk.fails = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: ar.console.errors.tryAgain }));
    });
    expect(await screen.findByText(builtInLocales.ar.connectAgent.capabilities.title)).toBeInTheDocument();
    expect(arChunk.requests).toBe(2);

    const shown = (await view.shown()).join('\n');
    expect(shown).not.toContain(ENGLISH.capabilities.title);
    expect(shown).not.toMatch(RAW_KEY);
  });
});
