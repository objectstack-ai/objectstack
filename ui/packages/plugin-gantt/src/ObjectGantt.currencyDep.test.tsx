/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4542 — the `tasks` memo formatted tooltip currency with
 * `tenantCurrency` but did not depend on it, so a tooltip could keep the
 * pre-resolution string forever.
 *
 * The tooltip strings are built EAGERLY inside the memo:
 *
 *     case 'currency':
 *       return formatCurrency(Number(value), resolveFieldCurrency(def, tenantCurrency));
 *
 * `tenantCurrency` comes from `useLocalization()`, which is fed by
 * `GET /api/v1/auth/me/localization` — cosmetic and non-blocking, so it
 * resolves AFTER first paint (`LocalizationFetchProvider` does one async
 * `setValue` post-mount). The context change re-renders ObjectGantt, but with
 * `tenantCurrency` absent from the dependency array none of `data` /
 * `ganttConfig` / `objectSchema` / `displayLocale` has changed, so the memo
 * hands back its cached task array and the tooltip keeps the fallback
 * rendering. This is the currency twin of objectui#4272 (PR #4544), which
 * added `displayLocale` to this very array for the same reason.
 *
 * ── Two masking paths this file deliberately steers around ───────────────
 * Both were measured before the fix; getting either wrong makes the red case
 * pass for the wrong reason.
 *
 *  1. **The locale channel.** The producer writes currency and locale from one
 *     response, so a tenant configuring BOTH re-runs the memo through #4544's
 *     `displayLocale` dep and the currency staleness never shows. The bug is
 *     observable on a tenant that configures **currency only** — the common
 *     shape, since `useDisplayLocale` documents the tenant locale as
 *     "frequently `undefined`", in which case it falls back to the UI language
 *     and does not change. So the deferred value here is `{ currency }` alone.
 *
 *  2. **`ganttConfig` identity.** `getGanttConfig` returns a FRESH object
 *     literal on the flattened top-level (console ListView) path, which
 *     invalidates this memo on every render all by itself; on the
 *     `schema.gantt` path it returns `schema.gantt` by reference. Only the
 *     latter is memoized in practice, so these cases use `schema.gantt` with a
 *     module-constant schema — the identity a metadata-sourced schema has.
 *     The `dataSource` is module-constant for the same reason.
 *
 * ── Directions (predicted in writing before the run, then measured) ──────
 * Runner: machine locale en-US. Only "re-formats when the tenant currency
 * resolves after first paint" is red against unfixed code. Every other case is
 * a must-not-change pin, GREEN ON BOTH SIDES: the pre-resolution rendering,
 * the resolved-before-first-paint rendering, the field-level currency
 * precedence, and #4544's own locale dep.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { I18nProvider, LocalizationProvider, type LocalizationValue } from '@object-ui/i18n';
import { ObjectGantt } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

// Same GanttView stub idiom as ObjectGantt.test.tsx / ObjectGantt.dateLocale
// .test.tsx: tooltip rows are surfaced as `gv-field-<id>-<i>` handles so their
// formatted text is assertable without rendering the real timeline.
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

/**
 * `amount` carries no currency code of its own, so it falls through to the
 * tenant default — the channel under test. `amount_fixed` pins its own code.
 * A fractional amount for the tenant-defaulted one: the symbol AND the minor
 * unit both come from the resolved code, so the two renderings differ in more
 * than one place.
 */
const ROWS = [
  {
    id: '1',
    name: 'Task 1',
    start_date: '2024-01-01',
    end_date: '2024-01-10',
    amount: 1234.5,
    amount_fixed: 1234,
    due_date: '2024-01-05',
  },
];

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    amount: { type: 'currency', label: 'Amount' },
    amount_fixed: { type: 'currency', label: 'Fixed', currency: 'JPY' },
    due_date: { type: 'date', label: 'Due' },
  },
};

// Module-constant so the identity is stable across the re-render the late
// resolution causes — see masking path 2 in the header.
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
    tooltipFields: ['amount', 'amount_fixed', 'due_date'],
  },
  data: { provider: 'object', object: 'tasks' },
};

/** Tooltip row handles, in `tooltipFields` order. */
const AMOUNT = 'gv-field-1-0';
const FIXED = 'gv-field-1-1';
const DUE = 'gv-field-1-2';

/**
 * The tenant localization channel as the app actually drives it: an initial
 * value (usually empty — the endpoint has not answered yet) and one async
 * write once a promise the test controls resolves. This is
 * `LocalizationFetchProvider` reduced to its timing: cosmetic, non-blocking,
 * one `setValue` after mount.
 */
function DeferredLocalization({
  initial,
  pending,
  children,
}: {
  initial: LocalizationValue;
  pending: Promise<LocalizationValue>;
  children: React.ReactNode;
}) {
  const [value, setValue] = React.useState<LocalizationValue>(initial);
  React.useEffect(() => {
    let cancelled = false;
    void pending.then((next) => {
      if (!cancelled) setValue(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pending]);
  return <LocalizationProvider value={value}>{children}</LocalizationProvider>;
}

function renderSession(opts: {
  initial?: LocalizationValue;
  pending?: Promise<LocalizationValue>;
  language?: string;
} = {}) {
  const pending = opts.pending ?? new Promise<LocalizationValue>(() => {});
  return render(
    <I18nProvider
      config={{ defaultLanguage: opts.language ?? 'en', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <DeferredLocalization initial={opts.initial ?? {}} pending={pending}>
        <ObjectGantt schema={SCHEMA} dataSource={DATA_SOURCE} />
      </DeferredLocalization>
    </I18nProvider>,
  );
}

/** Let the resolved promise's `.then` and the state write flush. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => cleanup());

describe('ObjectGantt tooltips — the tasks memo depends on the tenant currency (objectui#4542)', () => {
  /**
   * THE RED CASE. Pre-fix the memo returns its cached array when the context
   * changes, so this row keeps `Amount=1,234.50` forever.
   */
  it('re-formats when the tenant currency resolves after first paint', async () => {
    let resolveLocalization!: (v: LocalizationValue) => void;
    const pending = new Promise<LocalizationValue>((res) => {
      resolveLocalization = res;
    });
    renderSession({ pending });

    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    // First paint: the endpoint has not answered, so there is no code to
    // render and the amount is a plain number.
    expect(screen.getByTestId(AMOUNT).textContent).toBe('Amount=1,234.50');

    // The endpoint answers with a currency and NO locale — the tenant shape
    // that isolates this channel from #4544's `displayLocale` dep.
    await act(async () => {
      resolveLocalization({ currency: 'EUR' });
    });
    await flush();

    expect(screen.getByTestId(AMOUNT).textContent).toBe('Amount=€1,234.50');
  });

  /**
   * PIN, green both sides: the pre-resolution rendering itself is unchanged —
   * no tenant default known means a plain number, not a guessed symbol.
   */
  it('renders a plain number while the endpoint has not answered (must-not-change)', async () => {
    renderSession();
    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    expect(screen.getByTestId(AMOUNT).textContent).toBe('Amount=1,234.50');
  });

  /**
   * PIN, green both sides: when the channel has already answered before first
   * paint the memo never needed to re-run, so this rendering is byte-identical
   * across the fix. This is the case the PM ruling asks be pinned explicitly.
   */
  it('currency resolved BEFORE first paint renders identically (must-not-change)', async () => {
    renderSession({ initial: { currency: 'EUR' } });
    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    expect(screen.getByTestId(AMOUNT).textContent).toBe('Amount=€1,234.50');
    expect(screen.getByTestId(FIXED).textContent).toBe('Fixed=¥1,234');
  });

  /**
   * PIN, green both sides: `resolveFieldCurrency` precedence is untouched — a
   * field's own code outranks the tenant default before AND after the late
   * resolution, so the added dependency re-formats without re-deciding.
   */
  it("a field's explicit currency outranks the tenant default, before and after (must-not-change)", async () => {
    let resolveLocalization!: (v: LocalizationValue) => void;
    const pending = new Promise<LocalizationValue>((res) => {
      resolveLocalization = res;
    });
    renderSession({ pending });

    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    expect(screen.getByTestId(FIXED).textContent).toBe('Fixed=¥1,234');

    await act(async () => {
      resolveLocalization({ currency: 'EUR' });
    });
    await flush();

    expect(screen.getByTestId(FIXED).textContent).toBe('Fixed=¥1,234');
  });

  /**
   * PIN, green both sides: objectui#4272 / PR #4544's `displayLocale` dep on
   * this same array still invalidates the memo when the TENANT LOCALE lands
   * late. Guards the locale half of the array against a regression from this
   * card's edit — and documents masking path 1: it is precisely because this
   * works that the red case above must resolve currency alone.
   */
  it("#4544's displayLocale dep still re-formats on a late tenant locale (must-not-change)", async () => {
    let resolveLocalization!: (v: LocalizationValue) => void;
    const pending = new Promise<LocalizationValue>((res) => {
      resolveLocalization = res;
    });
    renderSession({ pending });

    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());
    expect(screen.getByTestId(DUE).textContent).toBe('Due=Jan 5, 2024');

    await act(async () => {
      resolveLocalization({ locale: 'de' });
    });
    await flush();

    expect(screen.getByTestId(DUE).textContent).toBe('Due=5. Jan. 2024');
  });
});
