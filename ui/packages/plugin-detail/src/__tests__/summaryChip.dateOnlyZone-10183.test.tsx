/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10183 — two detail-page surfaces render a date-only value as the
 * day it names west of UTC: the summary chip beside the record H1, and a
 * related list whose child schema is unavailable.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The summary chip's `date` branch formatted `new Date(val)` itself, so a
 * date-only value was UTC midnight read back in the viewer's zone:
 * `2026-08-01` rendered `2026年7月31日` (zh-CN) in `America/Los_Angeles`.
 * It now takes its `Date` from `toDisplayDate`, the shared parse step
 * (objectui#10110). The chip's own `dateStyle: 'medium'` face is unchanged —
 * `summaryChip.displayLocale-9453.test.tsx`'s `EN_CONTROL_ROWS` hold it.
 *
 * `RelatedList` renders its cells through `data-table`'s default face when
 * the child object's schema is unavailable (no `getObjectSchema`, or a
 * rejected read), and that face pre-parsed the value before the shared
 * formatter: `2026-09-01` read `Aug 31` west of UTC. Repaired in
 * `data-table` itself (`data-table.dateOnlyZone-10183.test.tsx`); this is the
 * same repair reached through the detail page.
 *
 * ── ⚠️ This file runs ONLY when driven, in a FORKS child ───────────────────
 * Every case below is skipped in the normal run. The zone is an input here,
 * and `process.env.TZ` written inside a test of the normal run does NOT move
 * it: the root config runs `pool: 'threads'`, a worker thread's `process.env`
 * is a plain copy with no native setter, and `Intl` keeps reading UTC — every
 * case would pass for the wrong reason. A forked worker is a real process's
 * MAIN thread, where Node's `TZ` setter does reset the zone.
 * `scripts/__tests__/date-only-zone-pins-10183.test.ts` spawns one vitest on
 * the forks pool over this file and its three siblings, and fails unless
 * every case here ran and passed. Each zone opens with a rig case — the zone
 * `Intl` resolved, and the local hour of a fixed INSTANT — so a child whose
 * zone did not move reds instead of going quietly green. `Asia/Shanghai` is
 * the control an hour-offset "repair" breaks; the `datetime` chip is the
 * control that an instant keeps converting.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@object-ui/components';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { DetailViewSchema } from '@object-ui/types';
import { DetailView } from '../DetailView';
import { RelatedList } from '../RelatedList';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in August — the card's zone. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control, where the UTC-midnight parse was already harmless. */
const EAST = 'Asia/Shanghai';

/** Frozen so `2026` is the current year for the related-list face. */
const CLOCK = '2026-09-03T10:35:00.000Z';
const CHIP_DATE = '2026-08-01';
const ROW_DATE = '2026-09-01';
/** A fixed instant: 20:00 the day before in the west, 11:00 in the east. */
const INSTANT = '2026-08-01T03:00:00.000Z';

/** Move this forked process into `zone` and freeze the clock. */
function enter(zone: string): void {
  process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
}

beforeEach(() => {
  // `useRecordEditable` falls back to the global fetch with no provider in the
  // tree; served from a double so no case depends on the network.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The summary chip beside the H1, under a declared session locale. */
function chip(type: 'date' | 'datetime', stored: string, locale: string): string {
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <DetailView
          schema={
            {
              type: 'record:details',
              objectName: 'account',
              summaryFields: ['closed_on'],
              fields: [{ name: 'closed_on', label: 'Closed on', type }],
              data: { id: 'A9', name: 'Acme', closed_on: stored },
            } as unknown as DetailViewSchema
          }
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
  const text = container.querySelector('[data-summary-chip="closed_on"]')?.textContent ?? '';
  cleanup();
  return text;
}

/** A related list with no `dataSource`, so no child schema: the cell is `data-table`'s own. */
async function relatedRow(): Promise<string> {
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <RelatedList title="Tasks" type="table" data={[{ id: 't1', due: ROW_DATE }]} columns={[{ accessorKey: 'due', header: 'Due' }]} />
    </I18nProvider>,
  );
  await waitFor(() => expect(container.querySelector('tbody tr td')).not.toBeNull());
  return container.querySelector('tbody tr td')?.textContent ?? '';
}

describe.runIf(DRIVEN)('detail-page date-only faces west of UTC (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('the summary chip reads `2026-08-01` as August 1st, where it read July 31st', () => {
    enter(WEST);
    expect(chip('date', CHIP_DATE, 'zh-CN')).toBe('2026年8月1日');
    expect(chip('date', CHIP_DATE, 'en')).toBe('Aug 1, 2026');
  });

  it('a `datetime` chip keeps converting its instant, onto the day before', () => {
    enter(WEST);
    expect(chip('datetime', INSTANT, 'en')).toBe('Jul 31, 2026, 8:00 PM');
  });

  it('a related list with no child schema reads `2026-09-01` as Sep 1, where it read Aug 31', async () => {
    enter(WEST);
    expect(await relatedRow()).toBe('Sep 1');
  });
});

describe.runIf(DRIVEN)('detail-page date-only faces east of UTC, the control (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(11);
  });

  it('the summary chip reads `2026-08-01` as August 1st, as it already did', () => {
    enter(EAST);
    expect(chip('date', CHIP_DATE, 'zh-CN')).toBe('2026年8月1日');
    expect(chip('date', CHIP_DATE, 'en')).toBe('Aug 1, 2026');
  });

  it('a `datetime` chip keeps converting its instant', () => {
    enter(EAST);
    expect(chip('datetime', INSTANT, 'en')).toBe('Aug 1, 2026, 11:00 AM');
  });

  it('a related list with no child schema reads `2026-09-01` as Sep 1', async () => {
    enter(EAST);
    expect(await relatedRow()).toBe('Sep 1');
  });
});
