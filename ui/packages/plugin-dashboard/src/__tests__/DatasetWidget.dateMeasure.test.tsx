// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7178 — a `min` / `max` measure over a datetime renders as a date on
 * the surfaces `DatasetWidget` owns, through the path a list cell uses.
 *
 * The ruling's pin, in its own words: "a `min` measure over a datetime renders
 * through the same path a list cell uses for that field, on the metric tile and
 * in the dataset table, and a numeric measure is byte-identical before and
 * after." The two rendered surfaces are here; the argument-level sweep is in
 * `@object-ui/core`'s `dataset-format.date.test.ts`.
 *
 * ── Why the expectations are DERIVED and not literal ────────────────────────
 * Every expected date string below is computed by calling `formatDateTime`
 * FROM `@object-ui/fields` — the module the `date` / `datetime` cell renderers
 * call, imported by the path they import it by. So these cases assert "the tile
 * shows what a list cell would show", which is the pin, rather than "the tile
 * shows the string I typed", which would pass just as well against a second
 * date convention living in `dataset-format.ts` — the objectui#4576 failure the
 * ruling forbids. If the two ever diverge, this file goes red at the divergence
 * instead of quietly blessing it.
 *
 * ── Directions, predicted in writing BEFORE the run ─────────────────────────
 *   both date cases        RED pre-fix — `formatMeasure` returned `String(v)`
 *                          for a non-numeric value, so the tile rendered the
 *                          raw 24-character ISO string.
 *   ⭐ both numeric cases   GREEN on both sides — the must-not-change guard.
 *
 * ⚠️ The objectui#4487 flake lives in the sibling `DatasetWidget.test.tsx`.
 * This file mounts the same component, so a red here is verified locally and
 * re-run before being owned.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider, type LocalizationValue } from '@object-ui/i18n';
// The list cell's own date path, by the list cell's own import path.
import { formatDateTime } from '@object-ui/fields';
import { DatasetWidget } from '../DatasetWidget';

afterEach(cleanup);

type Row = Record<string, unknown>;

const makeSource = (rows: Row[], fields?: Row[]) => ({
  queryDataset: vi.fn(async () => ({ rows, ...(fields ? { fields } : {}) })),
});

function renderIn(locale: string, widget: Row, dataSource: unknown) {
  const value: LocalizationValue = { locale };
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={value}>
        <DatasetWidget widget={widget} dataSource={dataSource} />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** A NON-current year, so `formatDate`'s "drop the year" branch is not in play. */
const OLDEST = '2024-07-04T07:00:00.000Z';
const EN = 'en-US';
const DE = 'de-DE';

/** The card's own repro: `{ aggregate: 'min', field: 'last_update_at' }`. */
const DATE_FIELDS = [{ name: 'oldest_touch', type: 'datetime', label: 'Oldest touch' }];

describe('DatasetWidget metric tile renders a date measure as a date (objectui#7178)', () => {
  const METRIC = { type: 'metric', dataset: 'tasks', values: ['oldest_touch'] };

  it('shows what a list cell shows, not the raw ISO string', async () => {
    renderIn(EN, METRIC, makeSource([{ oldest_touch: OLDEST }], DATE_FIELDS));
    const expected = formatDateTime(OLDEST, { locale: EN });
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(OLDEST)).not.toBeInTheDocument();
  });

  it('follows the display locale, through that same path', async () => {
    renderIn(DE, METRIC, makeSource([{ oldest_touch: OLDEST }], DATE_FIELDS));
    const expected = formatDateTime(OLDEST, { locale: DE });
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('⭐ leaves a numeric measure byte-identical (must-not-change)', async () => {
    renderIn(EN, { type: 'metric', dataset: 'sales', values: ['revenue'] },
      makeSource([{ revenue: 1234.5 }], [{ name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' }]));
    expect(await screen.findByText('1,234.5')).toBeInTheDocument();
  });
});

describe('DatasetWidget dataset table renders a date measure as a date (objectui#7178)', () => {
  const TABLE = { type: 'table', dataset: 'tasks', dimensions: ['owner'], values: ['oldest_touch'] };
  const FIELDS = [{ name: 'owner', type: 'string', label: 'Owner' }, ...DATE_FIELDS];

  it('shows what a list cell shows in the measure cell', async () => {
    renderIn(EN, TABLE, makeSource([{ owner: 'Ada', oldest_touch: OLDEST }], FIELDS));
    const expected = formatDateTime(OLDEST, { locale: EN });
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
    expect(screen.queryByText(OLDEST)).not.toBeInTheDocument();
  });

  it('⭐ leaves a numeric measure cell byte-identical (must-not-change)', async () => {
    renderIn(EN, { type: 'table', dataset: 'sales', dimensions: ['owner'], values: ['revenue'] },
      makeSource([{ owner: 'Ada', revenue: 1234.5 }], [
        { name: 'owner', type: 'string', label: 'Owner' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' },
      ]));
    await waitFor(() => expect(screen.getByText('1,234.5')).toBeInTheDocument());
  });
});
