// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI-model diagnostics panel composes its own summary line (objectui#2886).
 *
 * `service-ai` builds `report.summary` as a hard-coded English template literal
 * and its route handler takes no request argument, so it cannot honour
 * `Accept-Language` even though the client has been sending it since
 * objectui#1319. Every ingredient of that sentence is already in the structured
 * fields, so the panel assembles a localized equivalent and ignores `summary`.
 *
 * These tests pin the two things that regressed before: the English string must
 * not reach the DOM, and `routing` — which the server always sent but the client
 * never declared — must be surfaced.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn().mockImplementation(() => Promise.resolve(mockResponse())),
}));

let payload: Record<string, unknown>;
const mockResponse = () =>
  ({ ok: true, status: 200, json: () => Promise.resolve(payload) }) as unknown as Response;

import { CloudAiModelStatus } from './CloudAiModelStatus';

/** The English sentence the server sends and this panel must NOT render. */
const SERVER_SUMMARY =
  'build/ask uses gpt-5 (pinned by OS_AI_MODEL); structured uses gpt-5-mini. ' +
  'Routing policy: free plans → gpt-5-mini, paid plans → gpt-5.';

function baseReport(extra: Record<string, unknown> = {}) {
  return {
    conversational: { model: 'gpt-5', source: 'env:OS_AI_MODEL' },
    structured: { model: 'gpt-5-mini', pinned: true, source: 'env:OS_AI_MODEL_STRUCTURED' },
    reasoningEffort: { effective: 'medium', source: 'code-default' },
    adapter: 'vercel',
    overrides: { OS_AI_MODEL: 'gpt-5' },
    summary: SERVER_SUMMARY,
    ...extra,
  };
}

function renderPanel(lang = 'en') {
  // `I18nProvider` takes a config/instance, not a `language` prop — passing one
  // is silently ignored at runtime, so pin the language on the instance.
  const instance = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  return render(
    <I18nProvider instance={instance}>
      <CloudAiModelStatus />
    </I18nProvider>,
  );
}

beforeEach(() => {
  payload = baseReport();
});
afterEach(cleanup);

describe('CloudAiModelStatus — summary is composed client-side', () => {
  it('renders a localized summary and never the server’s English string', async () => {
    renderPanel('en');
    const line = await screen.findByTestId('ai-model-summary');

    expect(line).toHaveTextContent('gpt-5');
    expect(line).toHaveTextContent('gpt-5-mini');
    // The regression: `<p>{report.summary}</p>` put this verbatim on screen for
    // every locale.
    expect(line.textContent).not.toBe(SERVER_SUMMARY);
    expect(document.body.textContent).not.toContain('build/ask uses');
  });

  it('surfaces the routing policy the client type used to drop', async () => {
    payload = baseReport({ routing: { free: 'gpt-5-mini', paid: 'gpt-5' } });
    renderPanel('en');
    const line = await screen.findByTestId('ai-model-summary');
    // Routing only ever appeared inside the English summary, so non-English
    // admins could not see it at all.
    expect(line).toHaveTextContent(/Routing policy/i);
    expect(line).toHaveTextContent('gpt-5-mini');
  });

  it('omits the routing clause when the host does not inject one', async () => {
    renderPanel('en');
    const line = await screen.findByTestId('ai-model-summary');
    expect(line).not.toHaveTextContent(/Routing policy/i);
  });

  it('translates the summary — a zh render shares no sentence text with en', async () => {
    payload = baseReport({ routing: { free: 'gpt-5-mini', paid: 'gpt-5' } });
    const { unmount } = renderPanel('en');
    const en = (await screen.findByTestId('ai-model-summary')).textContent ?? '';
    unmount();

    renderPanel('zh');
    const zh = (await screen.findByTestId('ai-model-summary')).textContent ?? '';

    expect(zh).not.toBe(en);
    expect(zh).toMatch(/[一-鿿]/);
    // Model ids are identifiers, not prose — they must survive translation.
    expect(zh).toContain('gpt-5');
  });

  it('falls back to a translated placeholder when the adapter reports no model', async () => {
    payload = baseReport({
      conversational: { model: undefined, source: 'unknown' },
      structured: { model: undefined, pinned: false, source: 'inherits-conversational' },
    });
    renderPanel('en');
    const line = await screen.findByTestId('ai-model-summary');
    // `attributeSource` emits the bare token 'unknown'; it used to render raw.
    expect(line.textContent).not.toMatch(/\bunknown\s*\)/);
    expect(line).toHaveTextContent(/not reported by the adapter/i);
  });
});
