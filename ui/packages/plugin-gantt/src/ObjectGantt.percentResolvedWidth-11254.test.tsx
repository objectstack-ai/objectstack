/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11254 — the gantt tooltip's `percent` row reads its width through
 * `resolveFieldScale`, a carrier of ruling A′ (objectstack-ai/objectstack#19628).
 *
 * `formatFieldValue` handed `formatPercent` an `undefined` width, so the
 * function's own parameter default decided: a percent field declaring
 * `scale: 2` read whole percents in the tooltip beside a list cell reading two
 * decimals. For an undeclared percent that default happens to equal the
 * protocol's row, which is why only a declared width is red on the base tree.
 *
 * The agreement row renders the REAL list cell (`PercentCellRenderer`) for the
 * same value and field; the absolute-byte rows guard against a joint move.
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   `scale: 2`                 RED   (`12%` before)
 *   no `scale`                 GREEN (the default equals the protocol row)
 *   malformed `scale: "2"`     GREEN (no declaration: the protocol row)
 *
 * Harness: the GanttView stub and the module-constant schema / data source of
 * `ObjectGantt.numberLocale.test.tsx`, for the reasons stated there.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { PercentCellRenderer } from '@object-ui/fields';
import { ObjectGantt } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

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

const STORED = 0.1234;

const ROWS = [
  {
    id: '1',
    name: 'Task 1',
    start_date: '2024-01-01',
    end_date: '2024-01-10',
    declared: STORED,
    undeclared: STORED,
    malformed: STORED,
  },
];

const FIELDS = {
  declared: { type: 'percent', label: 'Declared', scale: 2 },
  undeclared: { type: 'percent', label: 'Undeclared' },
  malformed: { type: 'percent', label: 'Malformed', scale: '2' },
} as const;

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    ...FIELDS,
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
    tooltipFields: ['declared', 'undeclared', 'malformed'],
  },
  data: { provider: 'object', object: 'tasks' },
};

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the list cell renders for the stored value on `field`. */
function cellText(field: Record<string, unknown>): string {
  const { container, unmount } = render(
    <Providers>
      <PercentCellRenderer value={STORED} field={field as any} />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

async function tooltipRows(): Promise<string[]> {
  render(
    <Providers>
      <ObjectGantt schema={SCHEMA} dataSource={DATA_SOURCE} />
    </Providers>,
  );
  await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
  return [0, 1, 2].map((i) => screen.getByTestId(`gv-field-1-${i}`).textContent ?? '');
}

afterEach(() => cleanup());

describe('the gantt tooltip percent row reads the resolved width (objectui#11254)', () => {
  it('a declared `scale: 2` reads what the list cell reads', async () => {
    const expected = cellText(FIELDS.declared);
    expect(expected).toBe('12.34%');
    const [declared] = await tooltipRows();
    expect(declared).toBe(expected);
  });

  it('an undeclared percent reads the protocol row, as the list cell does', async () => {
    const expected = cellText(FIELDS.undeclared);
    expect(expected).toBe('12%');
    const [, undeclared] = await tooltipRows();
    expect(undeclared).toBe(expected);
  });

  it('a malformed `scale: "2"` is no declaration', async () => {
    const [, , malformed] = await tooltipRows();
    expect(malformed).toBe('12%');
  });
});
