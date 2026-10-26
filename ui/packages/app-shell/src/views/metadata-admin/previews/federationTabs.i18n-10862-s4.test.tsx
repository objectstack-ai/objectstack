// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 4 — the federated datasource panel's two tabs and its
 * import dialog under zh-CN.
 *
 * `ExternalDatasourcePanel` read its own header and tab labels in the designer
 * locale since slice 3, while the tab CONTENTS stayed English: the tables tab
 * (`SchemaBrowser`), the validation tab (`ValidationPanel`, with its ten
 * diff-kind badges) and `ImportObjectDialog`. Each now reads its
 * `engine.externalDatasource.*` rows through `useMetadataLocale()`, the value
 * the panel's `locale` prop carries in production (every `DatasourcePreview`
 * host passes that hook's value). The cases mount the panel through
 * `DatasourcePreview`, as the console does.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The slice-1 to slice-3 harness: the REAL components under the i18n provider
 * in the case's language; a site is an element's whole text or a
 * `placeholder`; each zh expectation is read back from the catalogue and
 * guarded by `zhRow`; each en case reads the en row through `t` / `tFormat` for
 * `en-US`, the control that the en row renders what the literal rendered. A row
 * with a code span in it is read with the hole filled by the span's text.
 *
 * ── Stand-ins and as-written ─────────────────────────────────────────────────
 * The federation REST client (`../external/api`) is the real module with its
 * reads answered here. Remote table names, column names and types, a draft's
 * review notes and generated source (the server's words), a diff's expected /
 * actual values and a failure's own message read as written.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  tables: [] as unknown[] | 'unavailable' | 'never',
  report: null as unknown,
  draft: null as unknown,
  draftRequests: 0,
  importing: 'ok' as 'ok' | 'never',
}));

vi.mock('../external/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../external/api')>();
  const never = () => new Promise<never>(() => {});
  return {
    ...mod,
    listRemoteTables: async () => {
      if (state.tables === 'never') return never();
      if (state.tables === 'unavailable') throw new mod.ExternalServiceUnavailableError();
      return state.tables;
    },
    validateDatasource: async () => {
      if (state.report === 'unavailable') throw new mod.ExternalServiceUnavailableError();
      return state.report;
    },
    generateObjectDraft: async () => {
      state.draftRequests += 1;
      if (state.draft === 'never') return never();
      if (state.draft === 'unavailable') throw new mod.ExternalServiceUnavailableError();
      if (state.draft instanceof Error) throw state.draft;
      return state.draft;
    },
    importObjectDraft: async () => {
      if (state.importing === 'never') return never();
      return undefined;
    },
    refreshCatalog: async () => ({ datasource: 'warehouse', snapshotAt: '2020-03-04T15:30:00.000Z', tables: [] }),
  };
});

import { t, tFormat } from '../i18n';
import { DatasourcePreview } from './DatasourcePreview';

afterEach(() => {
  cleanup();
  state.tables = [];
  state.report = null;
  state.draft = null;
  state.draftRequests = 0;
  state.importing = 'ok';
});

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The provider's own language switch, handed to the case by the probe below. */
let switchLanguage: ((lang: string) => Promise<void>) | null = null;
const keepSwitch = (fn: (lang: string) => Promise<void>) => {
  switchLanguage = fn;
};
function LanguageProbe({ onSwitch }: { onSwitch: (fn: (lang: string) => Promise<void>) => void }) {
  const { changeLanguage } = useObjectTranslation();
  React.useEffect(() => onSwitch(changeLanguage), [onSwitch, changeLanguage]);
  return null;
}

/** The console mounts every designer surface under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      {ui}
      <LanguageProbe onSwitch={keepSwitch} />
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

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

interface Site {
  key: string;
  vars?: Vars;
  /**
   * Where the row lands: an element's whole text (default), a `placeholder`,
   * or a text-only button's whole text — the dialog's footer buttons, told
   * apart from the dialog's own close control, whose icon carries a
   * screen-reader label of the same word.
   */
  in?: 'text' | 'placeholder' | 'button';
  /** How many elements carry it on their own (default: at least one). */
  count?: number;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The elements carrying `text` on their own: whole text equal to it, and no
 * child element whose whole text is also equal (so a wrapper does not count
 * twice for the one element inside it).
 */
function carriers(text: string): Element[] {
  const els = Array.from(document.body.querySelectorAll<Element>('*'));
  return els.filter(
    (el) => norm(el.textContent) === text && !Array.from(el.children).some((c) => norm(c.textContent) === text),
  );
}

let misses: string[] = [];

function pin(name: string, body: () => void | Promise<void>) {
  it(name, async () => {
    misses = [];
    await body();
    expect(misses).toEqual([]);
  });
}

function expectSites(lang: Lang, sites: Site[]) {
  for (const s of sites) {
    const r = row(lang, s.key, s.vars);
    if (s.in === 'button') {
      const found = screen
        .getAllByRole('button')
        .some((b) => !b.querySelector('svg') && norm(b.textContent) === norm(r));
      if (!found) misses.push(`${s.key} (text-only button): ${JSON.stringify(norm(r))}`);
    } else if (s.in === 'placeholder') {
      const found = Array.from(document.body.querySelectorAll('[placeholder]')).some(
        (el) => el.getAttribute('placeholder') === r,
      );
      if (!found) misses.push(`${s.key} (placeholder): ${JSON.stringify(r)}`);
    } else {
      const n = carriers(norm(r)).length;
      if (s.count === undefined ? n === 0 : n !== s.count) {
        misses.push(`${s.key} (text${s.count === undefined ? '' : ` x${s.count}`}): ${JSON.stringify(norm(r))}, found ${n}`);
      }
    }
    if (lang === 'zh') zhRow(s.key);
  }
}

function expectAsWritten(texts: string[]) {
  misses.push(...texts.filter((x) => carriers(x).length === 0).map((x) => `as written: ${JSON.stringify(x)}`));
}

function federated() {
  return { name: 'warehouse', label: 'Warehouse', driver: 'postgres', schemaMode: 'external', external: { allowWrites: false } };
}

async function mountPanel(lang: Lang) {
  const view = inLang(lang, <DatasourcePreview type="datasource" name="warehouse" draft={federated()} locale={LOCALE[lang]} />);
  await flush();
  return view;
}

/**
 * A button found by being one: its whole text is the row in either language,
 * so a case still reaches the sites behind it when the button itself is the
 * miss (the case's own `expectSites` judges the button's words).
 */
function buttonReading(_lang: Lang, key: string): HTMLElement {
  const words = [norm(row('en', key)), norm(row('zh', key))];
  const button = screen.getAllByRole('button').find((b) => words.includes(norm(b.textContent)));
  expect(button, `the ${key} button`).toBeTruthy();
  return button!;
}

/** Radix tabs switch on mouse-down. */
async function openValidationTab(lang: Lang) {
  const want = norm(row(lang, 'engine.externalDatasource.validation'));
  const tab = screen.getAllByRole('tab').find((b) => norm(b.textContent) === want);
  expect(tab, 'the validation tab').toBeTruthy();
  fireEvent.mouseDown(tab!, { button: 0 });
  await flush();
}

const TABLES = [
  { schema: 'public', name: 'orders', columnCount: 3, rowCountEstimate: 1200 },
  { name: 'events', columnCount: 5 },
];

const DIFF_KINDS: Array<[kind: string, key: string]> = [
  ['missing_table', 'engine.externalDatasource.diff.missingTable'],
  ['missing_column', 'engine.externalDatasource.diff.missingColumn'],
  ['type_mismatch', 'engine.externalDatasource.diff.typeMismatch'],
  ['nullability_mismatch', 'engine.externalDatasource.diff.nullabilityMismatch'],
  ['unmapped_column', 'engine.externalDatasource.diff.unmappedColumn'],
  ['pk_mismatch', 'engine.externalDatasource.diff.pkMismatch'],
  ['index_mismatch', 'engine.externalDatasource.diff.indexMismatch'],
  ['unmapped_index', 'engine.externalDatasource.diff.unmappedIndex'],
  ['default_mismatch', 'engine.externalDatasource.diff.defaultMismatch'],
  ['unreachable', 'engine.externalDatasource.diff.unreachable'],
];

const DRAFT = {
  name: 'orders',
  datasource: 'warehouse',
  definition: { name: 'orders', fields: {} },
  source: 'export default defineObject({ name: "orders" });',
  review: [
    { column: 'total', remoteType: 'money', note: 'lossy money to currency' },
    { column: 'geo', remoteType: 'geometry', note: 'unknown type, mapped to text' },
  ],
};

// ─── The tables tab (SchemaBrowser) ──────────────────────────────────────────

describe('SchemaBrowser reads the designer locale (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the filter, the refresh button, the table headers and each row's import button`, async () => {
      state.tables = TABLES;
      await mountPanel(lang);
      expectSites(lang, [
        { key: 'engine.externalDatasource.browser.filter', in: 'placeholder' },
        { key: 'engine.externalDatasource.browser.refresh', count: 1 },
        { key: 'engine.externalDatasource.browser.colTable', count: 1 },
        { key: 'engine.externalDatasource.browser.colColumns', count: 1 },
        { key: 'engine.externalDatasource.browser.colRows', count: 1 },
        { key: 'engine.externalDatasource.browser.import', count: 2 },
      ]);
      expectAsWritten(['orders', 'events', 'public.']);
    });

    pin(`${lang}: introspecting, then no remote tables, then no match for the filter`, async () => {
      state.tables = 'never';
      await mountPanel(lang);
      expectSites(lang, [{ key: 'engine.externalDatasource.browser.introspecting' }]);
      cleanup();

      state.tables = [];
      await mountPanel(lang);
      expectSites(lang, [{ key: 'engine.externalDatasource.browser.noRemoteTables' }]);
      cleanup();

      state.tables = TABLES;
      await mountPanel(lang);
      const filter = document.body.querySelector<HTMLInputElement>('input[placeholder]')!;
      fireEvent.change(filter, { target: { value: 'zzz_no_such_table' } });
      expectSites(lang, [{ key: 'engine.externalDatasource.browser.noMatch' }]);
    });

    pin(`${lang}: a server without federation, the service name read as written inside the sentence`, async () => {
      state.tables = 'unavailable';
      await mountPanel(lang);
      expectSites(lang, [
        { key: 'engine.externalDatasource.browser.unavailable', vars: { service: 'external-datasource' } },
      ]);
      expectAsWritten(['external-datasource']);
    });
  }
});

// ─── The validation tab (ValidationPanel) ────────────────────────────────────

describe('ValidationPanel reads the designer locale (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the intro around the datasource name, and the run button`, async () => {
      await mountPanel(lang);
      await openValidationTab(lang);
      expectSites(lang, [
        { key: 'engine.externalDatasource.check.intro', vars: { datasource: 'warehouse' } },
        { key: 'engine.externalDatasource.check.run' },
      ]);
    });

    pin(`${lang}: every object matching, one and many, and none bound yet`, async () => {
      const cases: Array<[results: unknown[], key: string]> = [
        [[{ object: 'orders', ok: true, diffs: [] }], 'engine.externalDatasource.check.allMatchOne'],
        [
          [
            { object: 'orders', ok: true, diffs: [] },
            { object: 'events', ok: true, diffs: [] },
          ],
          'engine.externalDatasource.check.allMatchOther',
        ],
      ];
      for (const [results, key] of cases) {
        state.report = { ok: true, results };
        await mountPanel(lang);
        await openValidationTab(lang);
        fireEvent.click(buttonReading(lang, 'engine.externalDatasource.check.run'));
        await flush();
        expectSites(lang, [{ key, vars: { count: results.length } }]);
        cleanup();
      }

      state.report = { ok: true, results: [] };
      await mountPanel(lang);
      await openValidationTab(lang);
      fireEvent.click(buttonReading(lang, 'engine.externalDatasource.check.run'));
      await flush();
      expectSites(lang, [{ key: 'engine.externalDatasource.check.noObjects' }]);
    });

    pin(`${lang}: objects diverging, their diff counts, every diff kind's badge, and expected / actual`, async () => {
      state.report = {
        ok: false,
        results: [
          { object: 'orders', ok: true, diffs: [] },
          {
            object: 'events',
            ok: false,
            diffs: DIFF_KINDS.map(([kind], i) => ({
              kind,
              severity: i % 2 ? 'warning' : 'error',
              remoteName: 'events',
              column: `c${i}`,
              ...(kind === 'type_mismatch' ? { expected: 'integer', actual: 'text' } : {}),
            })),
          },
        ],
      };
      await mountPanel(lang);
      await openValidationTab(lang);
      fireEvent.click(buttonReading(lang, 'engine.externalDatasource.check.run'));
      await flush();
      expectSites(lang, [
        { key: 'engine.externalDatasource.check.divergeOther', vars: { diverged: 1, count: 2 } },
        { key: 'engine.externalDatasource.check.diffsOther', vars: { count: DIFF_KINDS.length } },
        ...DIFF_KINDS.map(([, key]) => ({ key })),
        { key: 'engine.externalDatasource.check.expectedActual', vars: { expected: 'integer', actual: 'text' } },
      ]);
      expectAsWritten(['orders', 'events', '.c0', 'integer', 'text']);
      cleanup();

      state.report = {
        ok: false,
        results: [{ object: 'events', ok: false, diffs: [{ kind: 'missing_column', severity: 'error', column: 'total' }] }],
      };
      await mountPanel(lang);
      await openValidationTab(lang);
      fireEvent.click(buttonReading(lang, 'engine.externalDatasource.check.run'));
      await flush();
      expectSites(lang, [
        { key: 'engine.externalDatasource.check.divergeOne', vars: { diverged: 1, count: 1 } },
        { key: 'engine.externalDatasource.check.diffsOne', vars: { count: 1 } },
      ]);
    });

    pin(`${lang}: a server without federation`, async () => {
      state.report = 'unavailable';
      await mountPanel(lang);
      await openValidationTab(lang);
      fireEvent.click(buttonReading(lang, 'engine.externalDatasource.check.run'));
      await flush();
      expectSites(lang, [{ key: 'engine.externalDatasource.check.unavailable' }]);
    });
  }
});

// ─── The import dialog (ImportObjectDialog) ──────────────────────────────────

/** The dialog's footer import button (the last button reading the title row, in either language). */
function importDraftButton(): HTMLElement {
  const key = 'engine.externalDatasource.import.title';
  const words = [norm(row('en', key)), norm(row('zh', key))];
  const button = screen.getAllByRole('button').filter((b) => words.includes(norm(b.textContent))).pop();
  expect(button, 'the dialog footer import button').toBeTruthy();
  return button!;
}

async function openImport(lang: Lang) {
  state.tables = [TABLES[0]];
  await mountPanel(lang);
  fireEvent.click(buttonReading(lang, 'engine.externalDatasource.browser.import'));
  await flush();
}

describe('ImportObjectDialog reads the designer locale (objectui#10862, slice 4)', () => {
  for (const lang of LANGS) {
    pin(`${lang}: the title and intro while the draft is generated`, async () => {
      state.draft = 'never';
      await openImport(lang);
      expectSites(lang, [
        // The dialog's title, and its import button (disabled until the draft is ready).
        { key: 'engine.externalDatasource.import.title', count: 2 },
        { key: 'engine.externalDatasource.import.intro', vars: { table: 'public.orders', datasource: 'warehouse' } },
        { key: 'engine.externalDatasource.import.generating' },
        { key: 'engine.cancel', in: 'button' },
      ]);
    });

    pin(`${lang}: a ready draft — object name, review count, generated source, the two buttons`, async () => {
      state.draft = DRAFT;
      await openImport(lang);
      expectSites(lang, [
        { key: 'engine.externalDatasource.import.title', count: 2 },
        { key: 'engine.externalDatasource.import.objectName' },
        { key: 'engine.externalDatasource.import.reviewOther', vars: { count: 2 } },
        { key: 'engine.externalDatasource.import.source' },
        { key: 'engine.cancel', in: 'button' },
      ]);
      expectAsWritten(['— lossy money to currency', '(geometry)', DRAFT.source]);
      cleanup();

      state.draft = { ...DRAFT, review: [DRAFT.review[0]] };
      await openImport(lang);
      expectSites(lang, [{ key: 'engine.externalDatasource.import.reviewOne', vars: { count: 1 } }]);
    });

    pin(`${lang}: importing, then imported`, async () => {
      state.draft = DRAFT;
      state.importing = 'never';
      await openImport(lang);
      fireEvent.click(importDraftButton());
      await flush();
      expectSites(lang, [{ key: 'engine.externalDatasource.import.importing' }]);
      cleanup();

      state.importing = 'ok';
      await openImport(lang);
      fireEvent.click(importDraftButton());
      await flush();
      expectSites(lang, [
        { key: 'engine.externalDatasource.import.done', vars: { name: 'orders' } },
        { key: 'engine.externalDatasource.import.doneNext' },
        { key: 'engine.close', in: 'button' },
      ]);
    });

    pin(`${lang}: a server without federation; any other failure is the server's own message, as written`, async () => {
      state.draft = 'unavailable';
      await openImport(lang);
      expectSites(lang, [{ key: 'engine.externalDatasource.unavailable' }]);
      cleanup();

      state.draft = new Error('relation "orders" does not exist');
      await openImport(lang);
      expectAsWritten(['relation "orders" does not exist']);
    });
  }

  pin('the unavailable sentence follows a language switch without a new draft request', async () => {
    state.draft = 'unavailable';
    await openImport('en');
    expectSites('en', [{ key: 'engine.externalDatasource.unavailable' }]);
    await act(async () => {
      await switchLanguage!('zh');
    });
    await flush();
    expectSites('zh', [{ key: 'engine.externalDatasource.unavailable' }]);
    expect(state.draftRequests, 'one draft request, not one per language').toBe(1);
  });
});
