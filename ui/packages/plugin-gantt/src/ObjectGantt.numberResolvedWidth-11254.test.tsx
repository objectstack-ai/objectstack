/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11254 — the gantt tooltip's numeric row (`number` / `integer` /
 * `float` / `decimal`) reads its width through `resolveFieldScale`, a carrier
 * of ruling A′ (objectstack-ai/objectstack#19628).
 *
 * `formatFieldValue` handed `formatNumber` an `undefined` width, so the
 * function's own parameter default (two places) decided: every numeric field
 * read two decimals in the tooltip, whatever it declared. A declared `scale: 3`
 * read `1.50`, a declared `scale: 0` read `1.50`, and an undeclared `number`
 * read `1.50` beside a list cell reading `1.5`. Under A′ a `number` has no
 * absent-`scale` row, so absent means NO fixed width (the value's natural
 * precision), and a declared width is that width.
 *
 * The agreement rows render the REAL list cell (`NumberCellRenderer`) for the
 * same value and field; the absolute-byte expectations guard against a joint
 * move of both faces.
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   `scale: 3`                 RED   (`1.50` before)
 *   `scale: 2`                 GREEN (the old default equals the declaration)
 *   `scale: 0`                 RED   (`1.50` before)
 *   no `scale`                 RED   (`1.50` before)
 *   `integer`, no `scale`      RED   (`7.00` before; the protocol has no row)
 *   malformed `scale: "2"`     RED   (`1.50` before; no declaration, no width)
 *
 * Harness: the GanttView stub and the module-constant schema / data source of
 * `ObjectGantt.numberLocale.test.tsx`, for the reasons stated there.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { NumberCellRenderer } from '@object-ui/fields';
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

const STORED = 1.5;
const STORED_INTEGER = 7;

const FIELDS = {
  scale3: { type: 'number', label: 'Scale 3', scale: 3 },
  scale2: { type: 'number', label: 'Scale 2', scale: 2 },
  scale0: { type: 'number', label: 'Scale 0', scale: 0 },
  undeclared: { type: 'number', label: 'Undeclared' },
  integer: { type: 'integer', label: 'Integer' },
  malformed: { type: 'number', label: 'Malformed', scale: '2' },
} as const;

/** Tooltip order, and each row's stored value. */
const ORDER = ['scale3', 'scale2', 'scale0', 'undeclared', 'integer', 'malformed'] as const;
const VALUE: Record<(typeof ORDER)[number], number> = {
  scale3: STORED,
  scale2: STORED,
  scale0: STORED,
  undeclared: STORED,
  integer: STORED_INTEGER,
  malformed: STORED,
};

const ROWS = [
  {
    id: '1',
    name: 'Task 1',
    start_date: '2024-01-01',
    end_date: '2024-01-10',
    ...VALUE,
  },
];

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
    tooltipFields: [...ORDER],
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

/** What the list cell renders for `key`'s stored value on its field. */
function cellText(key: (typeof ORDER)[number]): string {
  const { container, unmount } = render(
    <Providers>
      <NumberCellRenderer value={VALUE[key]} field={FIELDS[key] as any} />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

async function tooltipRow(key: (typeof ORDER)[number]): Promise<string> {
  render(
    <Providers>
      <ObjectGantt schema={SCHEMA} dataSource={DATA_SOURCE} />
    </Providers>,
  );
  await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
  return screen.getByTestId(`gv-field-1-${ORDER.indexOf(key)}`).textContent ?? '';
}

afterEach(() => cleanup());

describe('the gantt tooltip numeric row reads the resolved width (objectui#11254)', () => {
  it('a declared `scale: 3` reads three places, as the list cell does', async () => {
    const expected = cellText('scale3');
    expect(expected).toBe('1.500');
    expect(await tooltipRow('scale3')).toBe(expected);
  });

  it('a declared `scale: 2` reads two places, as the list cell does', async () => {
    const expected = cellText('scale2');
    expect(expected).toBe('1.50');
    expect(await tooltipRow('scale2')).toBe(expected);
  });

  it('a declared `scale: 0` reads no places, as the list cell does', async () => {
    const expected = cellText('scale0');
    expect(expected).toBe('2');
    expect(await tooltipRow('scale0')).toBe(expected);
  });

  it('an undeclared `number` has no fixed width: its natural precision, as the list cell reads', async () => {
    const expected = cellText('undeclared');
    expect(expected).toBe('1.5');
    expect(await tooltipRow('undeclared')).toBe(expected);
  });

  it('an undeclared `integer` has no protocol row either: no padded places', async () => {
    const expected = cellText('integer');
    expect(expected).toBe('7');
    expect(await tooltipRow('integer')).toBe(expected);
  });

  it('a malformed `scale: "2"` is no declaration: no fixed width', async () => {
    const expected = cellText('malformed');
    expect(expected).toBe('1.5');
    expect(await tooltipRow('malformed')).toBe(expected);
  });
});
