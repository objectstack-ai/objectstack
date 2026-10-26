/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10422, the gantt face: a tooltip row of a `currency` field hands
 * the field's WHOLE def (from the object schema) to `resolveFieldCurrency`,
 * whose truth table is pinned in `@object-ui/i18n` beside it.
 *
 * Under a USD tenant, a `dynamic` field, and an empty config as the spec parses
 * it, read exactly what a field with no `currencyConfig` reads (the tenant's
 * `$`); a `fixed` field keeps its own code.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   dynamic reads the tenant currency         RED   (read `€`)
 *   parsed-empty reads the tenant currency    RED   (read `CN¥`)
 *   control: fixed JPY reads `¥`              GREEN (untouched)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { CurrencyConfigSchema } from '@objectstack/spec/data';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ObjectGantt } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

// The GanttView stub idiom of `ObjectGantt.currencyDep.test.tsx`: tooltip rows
// surface as `gv-field-<id>-<i>` handles, so their text is assertable without
// rendering the real timeline.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">
          <span>{t.title}</span>
          {t.fields ? (
            <div data-testid={`gv-fields-${t.id}`}>
              {t.fields.map((f: any, i: number) => (
                <span key={i} data-testid={`gv-field-${t.id}-${i}`}>{f.value}</span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

afterEach(() => cleanup());

const ROWS = [
  {
    id: '1',
    name: 'Task 1',
    start_date: '2024-01-01',
    end_date: '2024-01-10',
    dyn: 1234.5,
    empty: 1234.5,
    plain: 1234.5,
    fixed: 1234,
  },
];

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    dyn: { type: 'currency', label: 'Dynamic', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } },
    // What the spec makes of an authored `currencyConfig: {}`: a dynamic CNY config.
    empty: { type: 'currency', label: 'Empty', currencyConfig: CurrencyConfigSchema.parse({}) },
    // The reference: no `currencyConfig`, so the tenant currency is right.
    plain: { type: 'currency', label: 'Plain' },
    fixed: { type: 'currency', label: 'Fixed', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
  },
};

const DATA_SOURCE: DataSource = {
  find: vi.fn().mockResolvedValue({ data: ROWS }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
} as any;

const SCHEMA: any = {
  type: 'gantt',
  gantt: {
    titleField: 'name',
    startDateField: 'start_date',
    endDateField: 'end_date',
    tooltipFields: ['dyn', 'empty', 'plain', 'fixed'],
  },
  data: { provider: 'object', object: 'tasks' },
};

/** Tooltip row handles, in `tooltipFields` order. */
const [DYN, EMPTY, PLAIN, FIXED] = [0, 1, 2, 3].map((i) => `gv-field-1-${i}`);

async function renderTooltips() {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ currency: 'USD', locale: 'en' }}>
        <ObjectGantt schema={SCHEMA} dataSource={DATA_SOURCE} />
      </LocalizationProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
}

const shown = (id: string) => screen.getByTestId(id).textContent;

describe('gantt tooltips agree with the resolver on currencyMode (objectui#10422)', () => {
  it('dynamic: reads what a field with no currencyConfig reads, the tenant $', async () => {
    await renderTooltips();
    expect(shown(PLAIN)).toBe('$1,234.50');
    expect(shown(DYN)).toBe(shown(PLAIN));
  });

  it('parsed-empty: an empty config, as the spec parses it, reads the tenant $, never CN¥', async () => {
    await renderTooltips();
    expect(shown(EMPTY)).not.toContain('CN¥');
    expect(shown(EMPTY)).toBe(shown(PLAIN));
  });

  it('control: a fixed JPY field keeps its own ¥', async () => {
    await renderTooltips();
    expect(shown(FIXED)).toBe('¥1,234');
  });
});
