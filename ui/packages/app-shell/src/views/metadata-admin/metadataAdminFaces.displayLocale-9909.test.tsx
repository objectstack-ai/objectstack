/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The metadata-admin surfaces' dates and numbers read the DECLARED session
 * locale, never the machine's (objectui#9909): the audit and history event
 * times, an external datasource's catalog snapshot time and its tables' row
 * estimates, a flow run's start time, and a job's next fire times.
 *
 * ⚠️ These panels carry a `locale` of their own — the metadata-admin UI
 * language (`useMetadataLocale()`: `'zh-CN'` or `'en-US'`), which picks their
 * STRINGS. The faces below are formatted in the DISPLAY locale instead
 * (`useDisplayLocale()`), the channel every date and number renderer resolves
 * through; handing `Intl` that UI-string tag would trade the machine's locale
 * for a hard-coded `'en-US'`.
 *
 * Each surface is read twice — under a declared `de-DE` tenant locale and a
 * declared `en` one, the UI language `en` on both — and must read differently;
 * the runtime tripwire then checks the argument every locale-taking call
 * received.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { MetadataClient } from '@object-ui/data-objectstack';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

/** 2020-03-04 15:30:00 UTC — the suite runs in UTC. */
const { STORED } = vi.hoisted(() => ({ STORED: '2020-03-04T15:30:00.000Z' }));

vi.mock('./external/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshCatalog: async () => ({ datasource: 'warehouse', snapshotAt: STORED, tables: [] }),
  listRemoteTables: async () => [{ name: 'orders', schema: 'public', columnCount: 3, rowCountEstimate: 1234567 }],
}));

import { AuditPanel } from './AuditPanel';
import { HistoryPanel } from './ResourceHistoryPage';
import { ExternalDatasourcePanel } from './external/ExternalDatasourcePanel';
import { SchemaBrowser } from './external/SchemaBrowser';
import { FlowRunsPanel } from './previews/FlowRunsPanel';
import { JobPreview } from './previews/JobPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function session(locale: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

const auditClient = {
  audit: async () => ({
    events: [
      {
        id: 'a_1',
        occurredAt: STORED,
        actor: 'admin@objectos.ai',
        source: 'protocol.saveMetaItem',
        operation: 'save',
        outcome: 'allowed',
        code: null,
        lockState: 'none',
        lockOverridden: false,
        requestId: null,
        note: null,
      },
    ],
  }),
} as unknown as MetadataClient;

const historyClient = {
  history: async () => ({ events: [{ seq: 1, op: 'save', actor: 'ada', ts: STORED, version: 2 }] }),
} as never;

interface Surface {
  name: string;
  /** Mounts under `locale`, settles, and returns the face under test. */
  read: (locale: string) => Promise<string>;
  de: RegExp;
  en: RegExp;
}

async function settle(locale: string, node: React.ReactNode, ready: RegExp, act?: () => void): Promise<string> {
  session(locale, node);
  await screen.findAllByText(ready);
  act?.();
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ');
}

const DE_DATETIME = /4\.3\.2020, 15:30:00/;
const EN_DATETIME = /3\/4\/2020, 3:30:00\sPM/;

const SURFACES: Surface[] = [
  {
    name: 'AuditPanel — event time',
    read: (locale) =>
      settle(locale, <AuditPanel type="object" name="a_account" client={auditClient} />, /admin@objectos\.ai/),
    de: DE_DATETIME,
    en: EN_DATETIME,
  },
  {
    name: 'HistoryPanel — event time',
    read: (locale) => settle(locale, <HistoryPanel type="object" name="a_account" client={historyClient} />, /ada/),
    de: DE_DATETIME,
    en: EN_DATETIME,
  },
  {
    name: 'ExternalDatasourcePanel — catalog snapshot time',
    read: async (locale) => {
      session(locale, <ExternalDatasourcePanel datasource="warehouse" schemaMode="external" />);
      const refresh = (await screen.findAllByRole('button')).find((b) => /refresh/i.test(b.textContent ?? ''));
      expect(refresh, 'the catalog refresh button').toBeTruthy();
      fireEvent.click(refresh!);
      const snapshot = await screen.findByText(/snapshot/);
      const text = snapshot.textContent ?? '';
      cleanup();
      return text;
    },
    de: DE_DATETIME,
    en: EN_DATETIME,
  },
  {
    name: 'SchemaBrowser — row estimate',
    read: (locale) => settle(locale, <SchemaBrowser datasource="warehouse" />, /orders/),
    de: /1\.234\.567/,
    en: /1,234,567/,
  },
  {
    name: 'FlowRunsPanel — run start time',
    read: async (locale) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              success: true,
              data: { runs: [{ id: 'run_1', status: 'completed', startedAt: STORED, durationMs: 12, trigger: { type: 'manual' }, steps: [] }] },
            }),
            { status: 200 },
          ),
        ),
      );
      return settle(locale, <FlowRunsPanel flowName="sync" />, /2020/);
    },
    de: DE_DATETIME,
    en: EN_DATETIME,
  },
  {
    name: 'JobPreview — next fire time',
    read: (locale) =>
      settle(locale, <JobPreview type="job" name="nightly" draft={{ name: 'nightly', at: '2030-03-06T15:30:00.000Z' }} />, /nightly/),
    de: /06\. März, 15:30/,
    en: /Mar 06, 03:30\sPM/,
  },
];

describe('metadata-admin dates and numbers follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async ({ read, de }) => {
    const text = await read('de-DE');
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async ({ read, en }) => {
    const text = await read('en');
    expect(text, `got: ${text}`).toMatch(en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async ({ read }) => {
    expect(await read('de-DE')).not.toBe(await read('en'));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async ({ read }) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await read('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
