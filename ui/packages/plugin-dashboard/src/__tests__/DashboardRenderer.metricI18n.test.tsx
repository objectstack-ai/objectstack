/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4032 (source thread objectstack#5428) — a `type: 'metric'` KPI card
 * drops the translated widget title while every OTHER widget type on the same
 * dashboard renders it.
 *
 * TWO INDEPENDENT CHANNELS reach a widget title, and the metric path was
 * disconnected from both:
 *
 *  1. **The convention-key channel** — `{ns}.dashboards.{dash}.widgets.{id}.title`,
 *     resolved by `tWidgetTitle`. `DashboardRenderer` computes `resolvedTitle`
 *     for every widget, but the self-contained metric branch renders no Card
 *     header, so the value was computed and thrown away; the metric dispatch
 *     built its own label from the raw authored `widget.title` instead.
 *  2. **The inline per-locale map** — `{ en: 'Revenue', 'zh-CN': '收入' }`, which
 *     `@objectstack/spec` 17.0.0-rc.6 admits on `DashboardWidget.title`
 *     (`I18nLabel`). The private `resolveLabel` copy this file's subject used
 *     read the RETIRED `{ key, defaultValue }` form (objectstack#5055) and
 *     answered `undefined` for a map — see the direction note below.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *
 *  - **(a) bundle-translated title/description → RED before the change.** The
 *    metric branch never consulted `tWidgetTitle`, so the card rendered the
 *    authored English in a `zh` UI.
 *  - **(b) inline map title → RED before the change, and NOT as `[object
 *    Object]`.** This is the prediction worth writing down, because it is not
 *    the failure the sibling surface had. `resolveLabel` ended
 *    `return label.defaultValue || label.key`, and a locale map has neither —
 *    so it returned `undefined`, and the caller's `|| widgetType` fallback took
 *    over. The card therefore rendered the literal widget TYPE, the string
 *    `"metric"`. A map that stringifies is at least visible; this one silently
 *    substitutes a plausible-looking word.
 *  - **(f) controls → GREEN on both sides.** A plain-string title must stay
 *    byte-identical, and a non-metric widget's title path is untouched. These
 *    are the acceptance boundary, not decoration: the fix must not move a
 *    dashboard that has no translations at all.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// The dashboard renders each widget through `SchemaRenderer`, which resolves
// `metric` / `chart` from the registry — populated as a side effect of the
// package barrel. Imported at MODULE scope (never in a hook) per AGENTS.md's
// flaky-test rule: the cost lands in the import phase, unbounded by any
// test/hook timeout.
import { DashboardRenderer } from '../index';

afterEach(cleanup);

/**
 * The app bundle. `crm` is discovered as an app namespace because it carries a
 * `dashboards` sub-key — the same discovery `useObjectLabel` performs for every
 * other convention lookup.
 */
const ZH_BUNDLE = {
  zh: {
    crm: {
      dashboards: {
        sales: {
          widgets: {
            revenue: { title: '总收入', description: '本季度已赢单' },
            pipeline: { title: '销售漏斗' },
          },
        },
      },
    },
  },
};

function dashboard(widget: Record<string, unknown>): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'sales',
    widgets: [widget],
  } as unknown as DashboardComponentSchema;
}

function renderIn(language: string, schema: DashboardComponentSchema) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      <DashboardRenderer schema={schema} />
    </I18nProvider>,
  );
}

describe('DashboardRenderer — KPI cards translate from the widget convention keys (#4032)', () => {
  it('(a) renders the bundle title on a self-contained metric card', () => {
    renderIn('zh', dashboard({
      id: 'revenue',
      type: 'metric',
      title: 'Total Revenue',
      options: { value: 1930000 },
    }));

    expect(screen.getByText('总收入')).toBeTruthy();
    // The authored English must not survive beside the translation.
    expect(screen.queryByText('Total Revenue')).toBeNull();
  });

  it('(b) resolves an inline per-locale title map, and never leaks the widget type', () => {
    const { container } = renderIn('zh', dashboard({
      id: 'unkeyed',
      type: 'metric',
      title: { en: 'Total Revenue', 'zh-CN': '总收入' },
      options: { value: 1930000 },
    }));

    expect(screen.getByText('总收入')).toBeTruthy();
    // The pre-fix failure mode: `resolveLabel` answered `undefined` for a map,
    // so `|| widgetType` rendered the literal string "metric".
    expect(screen.queryByText('metric')).toBeNull();
    // And the sibling surface's failure mode, which this path never had.
    // Asserted on the CONTAINER, which is where this pin belongs and where
    // #4163 puts the sibling one. It used to be scoped to the card heading:
    // the card carried an unrelated `schema="[object Object]"` attribute on
    // every render — `SchemaRenderer` hands the widget schema down and
    // `MetricWidget` spread `...props` onto the `Card` — so the container
    // assertion was red for a reason that had nothing to do with labels, and
    // the tempting repair was to delete it. objectui#4357 removed the leak at
    // its source (`src/schemaHostProps.ts`), so the assertion is writable now.
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('(b2) resolves the inline map for `en` too — the authored en text, not the raw map', () => {
    const { container } = renderIn('en', dashboard({
      id: 'unkeyed',
      type: 'metric',
      title: { en: 'Total Revenue', 'zh-CN': '总收入' },
      options: { value: 1930000 },
    }));

    expect(screen.getByText('Total Revenue')).toBeTruthy();
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('(b3) prefers the bundle over the inline map when both exist', () => {
    // Precedence is the same one `useObjectLabel` applies everywhere: the
    // authored value is collapsed to the active language FIRST and then offered
    // to the bundle as its fallback, so a bundle entry always wins.
    renderIn('zh', dashboard({
      id: 'revenue',
      type: 'metric',
      title: { en: 'Total Revenue', 'zh-CN': '收入合计' },
      options: { value: 1930000 },
    }));

    expect(screen.getByText('总收入')).toBeTruthy();
    expect(screen.queryByText('收入合计')).toBeNull();
  });

  it('(f) leaves a plain-string title on a metric exactly as authored when nothing translates it', () => {
    // Non-vacuity + the acceptance boundary: an app with no bundle entry for
    // this widget keeps the exact label it renders today.
    renderIn('zh', dashboard({
      id: 'untranslated',
      type: 'metric',
      title: 'Win Rate',
      options: { value: '42%' },
    }));

    expect(screen.getByText('Win Rate')).toBeTruthy();
  });

  it('(f2) leaves the NON-metric title path unchanged — it already read the bundle', () => {
    renderIn('zh', dashboard({
      id: 'pipeline',
      type: 'bar',
      title: 'Pipeline',
      options: { data: [{ name: 'a', value: 1 }] },
    }));

    expect(screen.getByText('销售漏斗')).toBeTruthy();
  });
});
