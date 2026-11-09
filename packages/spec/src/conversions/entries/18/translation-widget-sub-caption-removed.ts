// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `translation-widget-sub-caption-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `translationWidgetSubCaptionRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `translation.dashboards.<name>.widgets.<id>.subCaption` — the metric
 * sub-caption, retired at both ends (protocol 18, #21257; ruling C on
 * objectui#11389, which reverses #5428 item 4; ADR-0049).
 *
 * The key overlaid the widget's `options.description` from `translateDashboard`
 * (#7862). The dashboard schema never declared `options.description` and no
 * authored widget wrote it (0 producers measured in either repository), so the
 * string existed in the served document only when this key put it there. The
 * overlay is gone and a widget keeps ONE authored description,
 * `widget.description`, translated by the widget node's own `description` key;
 * the schema refuses `subCaption` with the prescription.
 *
 * Pure lossless delete in what it SERVES — nothing reads the key any more —
 * and a drop of translation work in what it STORES, which is why the family
 * also has a D3 entry (`translation-widget-sub-caption-retired`). Both
 * authored shapes are walked, exactly as
 * {@link translationComponentSubmitLabelRemoved} walks its key: a bundle entry
 * (locale → data, `stack.translations`' declared shape) and a bare data/item
 * entry (groups at the top level — the shape stored `translation` items replay
 * through, which `authored-translation-sync` does before it merges a row).
 */
const translationWidgetSubCaptionRemoved: MetadataConversion = {
  id: 'translation-widget-sub-caption-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'translation.dashboards.widgets.subCaption',
  summary:
    "translation widget key 'subCaption' removed: the metric sub-caption it overlaid onto the "
    + "widget's 'options.description' is retired at both ends — the dashboard schema never "
    + 'declared that key and no authored widget wrote it, so the overlay was its only writer. A '
    + "widget keeps one authored description, 'widget.description', translated by the widget "
    + "node's 'description' key",
  apply(stack, emit) {
    const stripFromData = (data: Record<string, unknown>, path: string): Record<string, unknown> => {
      const dashboards = data.dashboards;
      if (!isDict(dashboards)) return data;
      let dashboardsChanged = false;
      const nextDashboards: Record<string, unknown> = { ...dashboards };
      for (const [dashboardName, dashboard] of Object.entries(dashboards)) {
        if (!isDict(dashboard) || !isDict(dashboard.widgets)) continue;
        let widgetsChanged = false;
        const nextWidgets: Record<string, unknown> = { ...dashboard.widgets };
        for (const [id, entry] of Object.entries(dashboard.widgets)) {
          if (!isDict(entry)) continue;
          const stripped = stripKeys(entry, ['subCaption'], emit, `${path}.dashboards.${dashboardName}.widgets.${id}`);
          if (stripped === entry) continue;
          nextWidgets[id] = stripped;
          widgetsChanged = true;
        }
        if (!widgetsChanged) continue;
        nextDashboards[dashboardName] = { ...dashboard, widgets: nextWidgets };
        dashboardsChanged = true;
      }
      return dashboardsChanged ? { ...data, dashboards: nextDashboards } : data;
    };
    return mapCollection(stack, 'translations', (entry, path) => {
      // Bare data/item shape: the groups sit at the entry's top level.
      let next = stripFromData(entry, path);
      // Bundle shape: locale code → data, judged structurally (a dict whose
      // `dashboards` is a dict) because `LocaleSchema` judges only a tag's
      // shape, an open-ended set the locale keys cannot be enumerated from. A
      // strip-only walk makes a false positive a no-op: it removes nothing
      // unless the exact `dashboards.<name>.widgets.<id>.subCaption` path is
      // present.
      for (const [locale, data] of Object.entries(next)) {
        if (!isDict(data) || !isDict(data.dashboards)) continue;
        const stripped = stripFromData(data, `${path}.${locale}`);
        if (stripped === data) continue;
        next = next === entry ? { ...entry } : next;
        next[locale] = stripped;
      }
      return next;
    });
  },
  fixture: {
    before: {
      translations: [
        {
          // The bundle shape `stack.translations` declares.
          'zh-CN': {
            dashboards: {
              sales_pulse: {
                label: '销售脉搏',
                widgets: {
                  won_revenue: { title: '赢单收入', description: '本季度已赢单', subCaption: '较上季度' },
                  // A neighbouring widget with live keys only rides through untouched.
                  open_pipeline: { title: '在途商机' },
                },
              },
            },
          },
        },
        {
          // The bare item shape stored `translation` rows replay through.
          name: 'ja_jp',
          locale: 'ja-JP',
          dashboards: {
            sales_pulse: {
              widgets: { won_revenue: { subCaption: '前四半期比' } },
            },
          },
        },
      ],
    },
    after: {
      translations: [
        {
          'zh-CN': {
            dashboards: {
              sales_pulse: {
                label: '销售脉搏',
                widgets: {
                  won_revenue: { title: '赢单收入', description: '本季度已赢单' },
                  open_pipeline: { title: '在途商机' },
                },
              },
            },
          },
        },
        {
          name: 'ja_jp',
          locale: 'ja-JP',
          dashboards: {
            sales_pulse: {
              widgets: { won_revenue: {} },
            },
          },
        },
      ],
    },
    // One per stripped key instance: one in the bundle-shaped entry, one in
    // the item-shaped entry. The emptied widget entry stays — the conversion
    // strips KEYS, and deleting the entry would be a second, unprescribed edit.
    expectedNotices: 2,
  },
};

export { translationWidgetSubCaptionRemoved };
