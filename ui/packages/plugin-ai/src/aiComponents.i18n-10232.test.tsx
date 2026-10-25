/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-ai` speaks the session's language and formats in the
 * session's DISPLAY locale (objectui#10232).
 *
 * Before this card the package had no `@object-ui/i18n` dependency: every
 * string was hard-coded English, and `nl-query`'s history date was
 * `toLocaleDateString()` with no argument — the MACHINE's locale, which also
 * kept the package outside the repo-wide machine-locale census (that census's
 * population is read from the manifests, and this manifest named no
 * `@object-ui/i18n`).
 *
 * Three things are pinned here:
 *  - the history date reads the declared display locale — two sessions that
 *    differ ONLY in that locale must read differently, which the runner's own
 *    locale cannot satisfy, and the runtime tripwire sees every locale-taking
 *    call receive the declared tag;
 *  - the strings follow the UI language;
 *  - the provider-less defaults map is byte-identical to the `en` pack, row for
 *    row, in both directions.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider, en } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';
import type { NLQuerySchema } from '@object-ui/types';
import { NLQueryInput } from './NLQueryInput';
import { AIFormAssist } from './AIFormAssist';
import { AIRecommendations } from './AIRecommendations';
import { AI_DEFAULT_TRANSLATIONS } from './useAiTranslation';

afterEach(cleanup);

/** 2020-03-04 15:30:00 UTC — the suite runs in UTC. */
const STORED = '2020-03-04T15:30:00.000Z';

const historySchema = {
  type: 'nl-query',
  showHistory: true,
  history: [{ query: 'open deals', timestamp: STORED }],
} as unknown as NLQuerySchema;

function session(language: string, locale: string | undefined, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

/** The history row's text under UI language `en` and the given display locale. */
async function readHistory(locale: string): Promise<string> {
  session('en', locale, <NLQueryInput schema={historySchema} />);
  const query = await screen.findByText('open deals');
  const text = query.parentElement?.textContent ?? '';
  cleanup();
  return text;
}

describe('nl-query — the history date follows the display locale (objectui#10232)', () => {
  it('says the de-DE face under a de-DE session', async () => {
    const text = await readHistory('de-DE');
    expect(text, `got: ${text}`).toContain('4.3.2020');
  });

  it('keeps the en face under an en session', async () => {
    const text = await readHistory('en');
    expect(text, `got: ${text}`).toContain('3/4/2020');
  });

  it('is a reading of the session, not of the machine', async () => {
    expect(await readHistory('de-DE')).not.toBe(await readHistory('en'));
  });

  it('every locale-taking call receives the declared tag', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await readHistory('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});

describe('plugin-ai strings follow the UI language (objectui#10232)', () => {
  it('nl-query renders the de pack', async () => {
    session('de', undefined, <NLQueryInput schema={historySchema} />);
    expect(await screen.findByText('Letzte Abfragen')).toBeTruthy();
    expect(screen.getByText('Fragen')).toBeTruthy();
    expect(screen.getByPlaceholderText('Stellen Sie eine Frage zu Ihren Daten…')).toBeTruthy();
  });

  it('ai-form-assist picks the singular key at exactly one, and formats its confidence in the display locale', async () => {
    session(
      'de',
      'de-DE',
      <AIFormAssist
        schema={{ type: 'ai-form-assist', suggestions: [{ fieldName: 'industry', value: 'Retail', confidence: 0.85 }] } as never}
      />,
    );
    expect(await screen.findByText('KI-Vorschläge')).toBeTruthy();
    expect(screen.getByText('1 Vorschlag')).toBeTruthy();
    // de-DE percent: a (narrow no-break) space before the sign.
    expect(screen.getByText(/^85\s%\sKonfidenz$/)).toBeTruthy();
  });

  it('ai-recommendations renders the de pack for its empty state', async () => {
    session('de', undefined, <AIRecommendations schema={{ type: 'ai-recommendations', recommendations: [] } as never} />);
    expect(await screen.findByText('Keine Empfehlungen verfügbar')).toBeTruthy();
  });

  it('with no provider, renders English rather than raw keys', () => {
    render(<AIRecommendations schema={{ type: 'ai-recommendations', loading: true } as never} />);
    expect(screen.getByText('Generating recommendations…')).toBeTruthy();
  });
});

describe('AI_DEFAULT_TRANSLATIONS mirrors the en pack (objectui#10232)', () => {
  const at = (dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], en);

  it('every row is byte-identical to its en pack value', () => {
    for (const [key, value] of Object.entries(AI_DEFAULT_TRANSLATIONS)) {
      expect(at(key), key).toBe(value);
    }
  });

  it('every en `ai.*` key has a row', () => {
    const keys: string[] = [];
    const walk = (node: unknown, prefix: string) => {
      if (typeof node === 'string') keys.push(prefix);
      else for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, `${prefix}.${k}`);
    };
    walk((en as Record<string, unknown>).ai, 'ai');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !(k in AI_DEFAULT_TRANSLATIONS))).toEqual([]);
  });
});
