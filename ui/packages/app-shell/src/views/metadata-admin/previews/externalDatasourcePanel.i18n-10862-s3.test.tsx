// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 3 — `ExternalDatasourcePanel` under zh-CN.
 *
 * The panel `DatasourcePreview` renders for a federated datasource
 * (`schemaMode` other than `managed`) carried its own English beside the
 * preview's localized words: the save-first prompt, the header, the write
 * badge, the snapshot line, the refresh button, the two tab labels and the
 * federation-unavailable message. It now reads its `engine.externalDatasource.*`
 * rows in the `locale` `DatasourcePreview` threads to it, the one the preview's
 * own host hands it (`useMetadataLocale()`). The cases mount the panel through
 * that host.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The harness of `dataPreviews.i18n-10862-s3.test.tsx`: the REAL components
 * under the i18n provider in the case's language; each zh expectation read back
 * from the catalogue and guarded by `zhRow`; each en case reading the en row
 * through `t` / `tFormat` for `en-US`.
 *
 * ── Stand-ins and as-written ─────────────────────────────────────────────────
 * The federation REST client (`../external/api`) is the real module with its
 * two reads answered here; everything else is real. The schema mode, the
 * datasource name and the snapshot time (formatted in the display locale,
 * objectui#9909's channel) read as written. The tables tab's own contents are
 * `SchemaBrowser`'s and are not read here.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { I18nProvider, useDisplayLocale } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  refresh: 'ok' as 'ok' | 'unavailable',
  snapshotAt: '2020-03-04T15:30:00.000Z',
}));

vi.mock('../external/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../external/api')>();
  return {
    ...mod,
    listRemoteTables: async () => [],
    refreshCatalog: async () => {
      if (state.refresh === 'unavailable') throw new mod.ExternalServiceUnavailableError();
      return { datasource: 'warehouse', snapshotAt: state.snapshotAt, tables: [] };
    },
  };
});

import { t, tFormat } from '../i18n';
import { DatasourcePreview } from './DatasourcePreview';

afterEach(() => {
  cleanup();
  state.refresh = 'ok';
});

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The display locale the panel formats its snapshot time in, read off the same provider. */
function DisplayLocaleProbe() {
  return <i data-testid="display-locale" data-locale={useDisplayLocale()} />;
}

/** The console mounts every designer surface under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      {ui}
      <DisplayLocaleProbe />
    </I18nProvider>,
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function row(lang: Lang, key: string, vars?: Vars): string {
  return vars ? tFormat(key, LOCALE[lang], vars) : t(key, LOCALE[lang]);
}

function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

interface Site {
  key: string;
  vars?: Vars;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function rendered(text: string): boolean {
  return Array.from(document.body.querySelectorAll<Element>('*')).some((el) => norm(el.textContent) === text);
}

/** What a case did not find; a case reads every site before it judges, so a failure lists each miss. */
let misses: string[] = [];

function pin(name: string, body: () => void | Promise<void>) {
  it(name, async () => {
    misses = [];
    await body();
    expect(misses).toEqual([]);
  });
}

function expectSites(lang: Lang, sites: Site[]) {
  misses.push(
    ...sites
      .map((s) => `${s.key}: ${JSON.stringify(norm(row(lang, s.key, s.vars)))}`)
      .filter((_, i) => !rendered(norm(row(lang, sites[i].key, sites[i].vars)))),
  );
  if (lang === 'zh') for (const s of sites) zhRow(s.key);
}

function expectAsWritten(texts: string[]) {
  misses.push(...texts.filter((x) => !rendered(x)).map((x) => `as written: ${JSON.stringify(x)}`));
}

/** The catalog refresh button, found by being one, whichever language it reads in. */
function refreshButton(): HTMLElement {
  const words = [row('en', 'engine.externalDatasource.refresh'), row('zh', 'engine.externalDatasource.refresh')];
  const button = screen.getAllByRole('button').find((b) => words.includes(norm(b.textContent)));
  expect(button, 'the catalog refresh button').toBeTruthy();
  return button!;
}

/** A federated datasource draft as `DatasourcePreview` receives it. */
function federated(allowWrites: boolean) {
  return { name: 'warehouse', label: 'Warehouse', driver: 'postgres', schemaMode: 'external', external: { allowWrites } };
}

function mount(lang: Lang, name: string, draft: Record<string, unknown>) {
  return inLang(lang, <DatasourcePreview type="datasource" name={name} draft={draft} locale={LOCALE[lang]} />);
}

describe('ExternalDatasourcePanel reads the locale DatasourcePreview threads to it (objectui#10862)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: an unsaved federated datasource (a draft name, no saved one yet) is asked to save first`, () => {
      mount(lang, '', { name: 'warehouse', schemaMode: 'external' });
      expectSites(lang, [{ key: 'engine.externalDatasource.saveFirst' }]);
    });

    pin(`${lang}: the header, the write badge, the refresh button and the two tabs`, async () => {
      mount(lang, 'warehouse', federated(true));
      await flush();
      expectSites(lang, [
        { key: 'engine.externalDatasource.title' },
        { key: 'engine.externalDatasource.writesAllowed' },
        { key: 'engine.externalDatasource.refresh' },
        { key: 'engine.externalDatasource.tables' },
        { key: 'engine.externalDatasource.validation' },
      ]);
      expectAsWritten(['external']);
      cleanup();
      mount(lang, 'warehouse', federated(false));
      await flush();
      expectSites(lang, [{ key: 'engine.externalDatasource.readOnly' }]);
    });

    pin(`${lang}: a refreshed catalog's snapshot line, its time formatted in the display locale`, async () => {
      mount(lang, 'warehouse', federated(false));
      await flush();
      fireEvent.click(refreshButton());
      await flush();
      const displayLocale = screen.getByTestId('display-locale').getAttribute('data-locale')!;
      const time = new Date(state.snapshotAt).toLocaleString(displayLocale);
      expectSites(lang, [{ key: 'engine.externalDatasource.snapshot', vars: { time } }]);
    });

    pin(`${lang}: a server without federation`, async () => {
      state.refresh = 'unavailable';
      mount(lang, 'warehouse', federated(false));
      await flush();
      fireEvent.click(refreshButton());
      await flush();
      expectSites(lang, [{ key: 'engine.externalDatasource.unavailable' }]);
    });
  }
});
