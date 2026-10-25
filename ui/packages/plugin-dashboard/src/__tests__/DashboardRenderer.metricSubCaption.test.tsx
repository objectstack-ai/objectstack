/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11389 — the metric card's SUB-CAPTION is retired at both ends
 * (ruling C, which reverses objectstack#5428 item 4).
 *
 * This file used to pin the opposite (objectui#4032 item 4): an authored
 * `options.description` drew as the line under a metric's value, and a client
 * bundle entry at `dashboards.<d>.widgets.<id>.subCaption` translated it. The
 * spec never declared that options key. Its only writer was objectstack's own
 * `translateDashboard` overlay, which `@objectstack/spec` 17.7.0 removed, and
 * the same release refuses a `subCaption` bundle entry by name. So the reader
 * half goes too, and these are the reversed pins, on the INLINE metric arm of
 * both dashboard surfaces:
 *
 *  - an authored `options.description`, a plain string or a per-locale map,
 *    draws nothing;
 *  - a bundle `subCaption` entry draws nothing, while the bundle `title` on
 *    the same entry still does (the lit control: bundle lookups are live);
 *  - `widget.description` still draws as the card-header subtitle on a widget
 *    that has a card header (the ruling's other pin), translated through the
 *    widget node's `description` key.
 *
 * Directions, written before the run: every "draws nothing" case is RED on the
 * pre-change code (it drew the caption) and GREEN after; the label, value,
 * title and header-subtitle controls are GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope, never a hook — AGENTS.md §测试纪律. The dashboard renders each
// widget through `SchemaRenderer`, which resolves the metric node from the
// registry, populated as a side effect of this barrel.
import { DashboardRenderer, DashboardGridLayout } from '../index';

afterEach(cleanup);

/**
 * `crm` is discovered as an app namespace because it carries a `dashboards`
 * sub-key. `revenue` keeps a `subCaption` entry beside its live keys: the
 * installed spec refuses that entry, but `I18nProvider` takes a host's
 * resources without the schema, so this is the door the pins close.
 */
const ZH_BUNDLE = {
  zh: {
    crm: {
      dashboards: {
        sales: {
          widgets: {
            revenue: {
              title: '总收入',
              description: '卡片头部描述',
              subCaption: '本季度已赢单',
            },
          },
        },
      },
    },
  },
};

function dashboard(...widgets: Record<string, unknown>[]): DashboardComponentSchema {
  return { type: 'dashboard', name: 'sales', widgets } as unknown as DashboardComponentSchema;
}

/** Both surfaces, driven identically: an inline metric renders through each one's own metric arm. */
const SURFACES: Array<[string, (schema: DashboardComponentSchema) => React.ReactElement]> = [
  ['DashboardRenderer', (schema) => <DashboardRenderer schema={schema} />],
  ['DashboardGridLayout', (schema) => <DashboardGridLayout schema={schema} />],
];

async function renderIn(
  surface: (schema: DashboardComponentSchema) => React.ReactElement,
  schema: DashboardComponentSchema,
  value: string,
) {
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      {surface(schema)}
    </I18nProvider>,
  );
  // The grid mounts its widgets only after it measures its width, so settle on
  // the drawn value (the lit half of every case) before asserting absence.
  await screen.findByText(value);
  return view;
}

describe.each(SURFACES)('%s — an inline metric card draws no sub-caption from `options` (objectui#11389)', (_name, surface) => {
  it('an authored plain-string `options.description` draws nothing', async () => {
    await renderIn(surface, dashboard({
      id: 'untranslated',
      type: 'metric',
      title: 'Bookings',
      options: { value: '12 deals', description: 'Signed this week' },
    }), '12 deals');

    expect(screen.getByText('Bookings')).toBeTruthy();
    expect(screen.queryByText('Signed this week')).toBeNull();
  });

  it('an authored per-locale map on `options.description` draws nothing, in any language', async () => {
    await renderIn(surface, dashboard({
      id: 'untranslated',
      type: 'metric',
      title: 'Bookings',
      options: { value: '12 deals', description: { en: 'Signed this week', 'zh-CN': '本周已签' } },
    }), '12 deals');

    expect(screen.queryByText('本周已签')).toBeNull();
    expect(screen.queryByText('Signed this week')).toBeNull();
  });
});

describe('DashboardRenderer — the bundle `subCaption` limb is gone too (objectui#11389)', () => {
  it('a bundle `subCaption` entry draws nothing, while the same entry\'s `title` still translates', async () => {
    await renderIn(SURFACES[0]![1], dashboard({
      id: 'revenue',
      type: 'metric',
      title: 'Total Revenue',
      options: { value: '1.93M', description: 'Won this quarter' },
    }), '1.93M');

    // Lit control: the bundle lookup is live on this widget.
    expect(screen.getByText('总收入')).toBeTruthy();
    expect(screen.queryByText('本季度已赢单')).toBeNull();
    expect(screen.queryByText('Won this quarter')).toBeNull();
  });

  it('`widget.description` still draws as the card-header subtitle; `options.description` beside it does not', async () => {
    // `kpi` is metric-family but not self-contained, so it takes the shared
    // card header: title + `widget.description`, translated through the widget
    // node's `description` key. The metric inside it no longer draws a caption.
    await renderIn(SURFACES[0]![1], dashboard({
      id: 'revenue',
      type: 'kpi',
      title: 'Total Revenue',
      description: 'Card header subtitle',
      options: { value: '1.93M', description: 'Won this quarter' },
    }), '1.93M');

    expect(screen.getByText('卡片头部描述')).toBeTruthy();
    expect(screen.queryByText('Card header subtitle')).toBeNull();
    expect(screen.queryByText('本季度已赢单')).toBeNull();
    expect(screen.queryByText('Won this quarter')).toBeNull();
  });

  it('an untranslated `widget.description` draws as the header subtitle verbatim (control)', async () => {
    await renderIn(SURFACES[0]![1], dashboard({
      id: 'untranslated',
      type: 'kpi',
      title: 'Bookings',
      description: 'Card header subtitle',
      options: { value: '12 deals', description: 'Signed this week' },
    }), '12 deals');

    expect(screen.getByText('Card header subtitle')).toBeTruthy();
    expect(screen.queryByText('Signed this week')).toBeNull();
  });

  it('a dashboard with no name draws no authored sub-caption either', async () => {
    // No `name` meant no bundle key, and the authored value used to answer
    // alone. There is no authored channel left to answer.
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
        <DashboardRenderer
          schema={{
            type: 'dashboard',
            widgets: [{ id: 'revenue', type: 'metric', title: 'Total Revenue', options: { value: '1.93M', description: 'Won this quarter' } }],
          } as unknown as DashboardComponentSchema}
        />
      </I18nProvider>,
    );

    await screen.findByText('1.93M');
    expect(screen.getByText('Total Revenue')).toBeTruthy();
    expect(screen.queryByText('Won this quarter')).toBeNull();
  });
});
