/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4272 — the gantt tooltip's date and datetime rows rendered in the
 * MACHINE's locale.
 *
 * `formatFieldValue` formats tooltip values through the shared
 * `@object-ui/fields` formatters, and threaded no locale into any of its four
 * temporal call sites (two `formatDate`, two `formatDateTime` — the schema
 * `date`/`datetime` cases plus the no-schema ISO-string sniffing pair).
 *
 * `formatDateTime` could not have been localized here even deliberately: it
 * took no options parameter at all until this card. That is why the parameter
 * and these consumers land together — a parameter with nothing passing one
 * would have grown the public surface for no consumer.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Runner machine locale is `en-US`, so the `en` cases are GREEN ON BOTH SIDES
 * — the byte-identical must-not-change pins. The `zh` cases are the red ones.
 *
 * Dates here are in 2024 on purpose: `formatDate`'s default branch drops the
 * year when it matches the current one, so a non-current year keeps the
 * expectation stable no matter which calendar year the suite runs in.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ObjectGantt } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

// Same GanttView stub idiom as ObjectGantt.test.tsx: the tooltip rows are
// surfaced as `gv-field-<id>-<i>` handles so their formatted text is
// assertable without rendering the real timeline.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid="gantt-task">
          <span>{t.title}</span>
          {t.fields ? (
            <div data-testid={`gv-fields-${t.id}`}>
              {t.fields.map((f: any, i: number) => (
                <span key={i} data-testid={`gv-field-${t.id}-${i}`}>{f.label}={f.value}</span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

const ttData = [
  {
    id: '1',
    name: 'Task 1',
    start_date: '2024-01-01',
    end_date: '2024-01-10',
    // A `date` field and a `datetime` field — the two schema-typed branches.
    due_date: '2024-01-05',
    reviewed_at: '2024-01-05T08:30:00',
  },
];

function makeDataSource(): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: ttData }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      fields: {
        name: { type: 'text' },
        start_date: { type: 'date' },
        end_date: { type: 'date' },
        due_date: { type: 'date', label: 'Due' },
        reviewed_at: { type: 'datetime', label: 'Reviewed' },
      },
    }),
  } as any;
}

function renderSession(language: string) {
  const schema: any = {
    type: 'gantt',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
      tooltipFields: ['due_date', 'reviewed_at'],
    },
    data: { provider: 'object', object: 'tasks' },
  };
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{}}>
        <ObjectGantt schema={schema} dataSource={makeDataSource()} />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('ObjectGantt tooltips — temporal values follow the display locale (objectui#4272)', () => {
  it('zh session renders Chinese date and datetime forms', async () => {
    renderSession('zh');
    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    expect(screen.getByTestId('gv-field-1-0').textContent).toBe('Due=2024年1月5日');
    expect(screen.getByTestId('gv-field-1-1').textContent).toBe('Reviewed=2024年1月5日 08:30');
  });

  /** PIN — green on both sides; the runner's machine locale is `en-US`. */
  it('en session output is byte-identical (must-not-change)', async () => {
    renderSession('en');
    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    expect(screen.getByTestId('gv-field-1-0').textContent).toBe('Due=Jan 5, 2024');
    expect(screen.getByTestId('gv-field-1-1').textContent).toBe('Reviewed=Jan 5, 2024, 08:30 AM');
  });
});
