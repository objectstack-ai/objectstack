// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11389 — a dataset-bound KPI tile draws no sub-caption from its
 * options bag, whatever an author wrote there (ruling C: the metric sub-caption
 * is retired at both ends).
 *
 * This file used to pin objectui#7293, which taught `DatasetWidget` to draw an
 * authored `options.description` as a caption row under the value. The spec
 * never declared that key; the server overlay that wrote it is gone in
 * `@objectstack/spec` 17.7.0, which also refuses the `subCaption` translation
 * key by name. The component now has no sub-caption prop and no read of the
 * key, and these are the reversed pins, rendered with `DatasetWidget` mounted
 * directly (no dashboard surface, so nothing upstream can supply a caption):
 *
 *  - every authored form of `options.description` (plain string, a value the
 *    server used to overlay, a per-locale map under either language) renders
 *    the no-caption markup BYTE-FOR-BYTE — RED on the pre-change code, which
 *    appended a caption span, and GREEN after;
 *  - the no-options and empty-value rows were the old file's control half and
 *    stay GREEN on both sides: that markup is the one every case now draws;
 *  - the objectui#7293 repro (three measures) still draws one value and,
 *    now, no caption.
 *
 * The widget's one authored description is `widget.description`, drawn as the
 * card-header subtitle by the dashboard surface, not by this component; the
 * surfaces' files pin that half.
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and this file imports
 * `../DatasetWidget` relatively.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

afterEach(cleanup);

/**
 * The metric tile's markup with no sub-caption, spelled out in full (not a
 * snapshot file) so a regression shows up as a diff in the test source review.
 * The same byte string `DatasetWidget.colorVariant.test.tsx` pins for the same
 * widget.
 */
const BASELINE_NO_SUBCAPTION =
  '<div class="flex h-full w-full flex-col items-start justify-center gap-1 p-2">'
  + '<span class="text-2xl font-semibold tabular-nums">510000</span>'
  + '<span class="text-xs text-muted-foreground">revenue</span>'
  + '</div>';

const renderMetric = async (
  widgetExtras: Record<string, unknown> = {},
  rows: Record<string, unknown>[] = [{ revenue: 510000 }],
) => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  const { container } = render(
    <DatasetWidget
      widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], ...widgetExtras }}
      dataSource={src}
    />,
  );
  await screen.findByText('510000');
  return container;
};

/** Same, under an explicit UI language — the inline per-locale map's axis. */
const renderMetricIn = async (language: string, widgetExtras: Record<string, unknown> = {}) => {
  const src = { queryDataset: vi.fn(async () => ({ rows: [{ revenue: 510000 }] })) };
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <DatasetWidget
        widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], ...widgetExtras }}
        dataSource={src}
      />
    </I18nProvider>,
  );
  await screen.findByText('510000');
  return container;
};

const CAPTION = '[data-testid="dataset-metric-subcaption"]';

describe('DatasetWidget metric tile — no sub-caption from the options bag (objectui#11389)', () => {
  // ── Control half: GREEN before and after. ────────────────────────────────
  it.each([
    ['no options bag at all', undefined],
    ['an options bag without the key', { limit: 10 }],
    ['an explicitly empty string', { description: '' }],
    ['a null', { description: null }],
    ['a locale map with no usable entry', { description: {} }],
  ])('renders the no-caption markup for %s', async (_label, options) => {
    const container = await renderMetric(options === undefined ? {} : { options });
    expect(container.innerHTML).toBe(BASELINE_NO_SUBCAPTION);
  });

  // ── Reversed half: RED before this change (a caption span was appended). ──
  it('renders the no-caption markup for an authored plain-string `options.description`', async () => {
    const container = await renderMetric({
      options: { description: 'awaiting confirmation / awaiting approval' },
    });
    expect(container.querySelector(CAPTION)).toBeNull();
    expect(container.innerHTML).toBe(BASELINE_NO_SUBCAPTION);
  });

  it('renders the no-caption markup for the text the server used to overlay onto the key', async () => {
    // `translateDashboard` wrote the resolved `subCaption` translation here
    // until `@objectstack/spec` 17.7.0. A stored document can still carry it.
    const container = await renderMetric({
      id: 'list_completeness',
      options: { description: '待确认 7 / 待审批 3' },
    });
    expect(container.innerHTML).toBe(BASELINE_NO_SUBCAPTION);
  });

  it.each(['zh', 'en'])('renders the no-caption markup for an authored per-locale map under %s', async (language) => {
    const container = await renderMetricIn(language, {
      options: { description: { en: 'to confirm / to approve', zh: '待确认 / 待审批' } },
    });
    expect(container.querySelector(CAPTION)).toBeNull();
    expect(container.innerHTML).toBe(BASELINE_NO_SUBCAPTION);
  });
});

describe('the objectui#7293 repro draws one value and no caption', () => {
  it('three measures and an authored `options.description`: the first measure, nothing under it', async () => {
    // The duly#109 tile, verbatim from objectui#7293's repro block.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ approved_rate: 82, duties_to_confirm: 7, duties_to_review: 3 }],
      })),
    };
    const { container } = render(
      <DatasetWidget
        widget={{
          id: 'list_completeness',
          type: 'metric',
          dataset: 'duly_duty_register',
          values: ['approved_rate', 'duties_to_confirm', 'duties_to_review'],
          options: { description: 'awaiting confirmation / awaiting approval' },
        }}
        dataSource={src}
      />,
    );
    await screen.findByText('82');
    expect(container.querySelector(CAPTION)).toBeNull();
    expect(container.textContent).not.toContain('awaiting confirmation');
    // Measures after `values[0]` are still not drawn (objectui#8894 reports
    // the drop); this change neither drew them nor moved that.
    expect(container.textContent).not.toContain('7');
    expect(container.textContent).not.toContain('3');
  });
});
