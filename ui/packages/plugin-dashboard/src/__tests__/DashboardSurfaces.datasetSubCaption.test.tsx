/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11389 — a DATASET-BOUND KPI tile draws no sub-caption, on either
 * dashboard surface (ruling C: the metric sub-caption is retired at both ends).
 *
 * This file used to pin objectui#8889: both surfaces resolved the sub-caption
 * through one hook, `useWidgetSubCaption`, with two limbs (the authored
 * `options.description`, and a client bundle entry at
 * `dashboards.<d>.widgets.<id>.subCaption` that won over it), and handed the
 * answer to `DatasetWidget`. Both limbs are retired with the hook:
 * `@objectstack/spec` 17.7.0 removed the server overlay that wrote
 * `options.description` and refuses a `subCaption` bundle entry by name, and
 * the spec never declared the options key. The reversed pins:
 *
 *  - R1/R2 an authored `options.description` (plain string, per-locale map)
 *    grows no caption node on either surface;
 *  - R3 a bundle `subCaption` entry grows no caption node on either surface;
 *  - L1 lit control, both surfaces: the tile's value still draws, so every
 *    absence above is a reading of a drawn tile, not of an unmounted one;
 *  - L2 lit control, `DashboardRenderer`: `widget.description` still draws as
 *    the card-header subtitle over the tile (the ruling's other pin).
 *
 * Directions, written before the run: R1, R2 and R3 are RED on the pre-change
 * code (the caption node drew) and GREEN after; L1 and L2 are GREEN on both.
 * Running every case on BOTH surfaces is objectui#4614's lesson: a change wired
 * into one dispatch site leaves the other silently unchanged.
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and this file imports its
 * subjects relatively.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope, never inside a hook — AGENTS.md 测试纪律. Both surfaces render
// their non-dataset widgets through `SchemaRenderer`, which resolves component
// types from the registry these barrels populate as a side effect.
import '@object-ui/components';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';

afterEach(cleanup);

/**
 * `crm` is discovered as an app namespace because it carries a `dashboards`
 * sub-key. `pipeline` carries ONLY a `subCaption` (the shape objectui#8889 made
 * draw); `revenue` carries one beside a live `description` entry. The installed
 * spec refuses both `subCaption` entries; `I18nProvider` takes a host's
 * resources without that schema, which is the door these pins close.
 */
const ZH_BUNDLE = {
  zh: {
    crm: {
      dashboards: {
        sales: {
          widgets: {
            pipeline: { subCaption: '按阶段推进' },
            revenue: { description: '卡片头部描述', subCaption: '本季度已赢单' },
          },
        },
      },
    },
  },
};

/** A dataset-bound metric tile — `dataset` is what routes it to `DatasetWidget`. */
const datasetMetric = (id: string, extras: Record<string, unknown> = {}) => ({
  id,
  type: 'metric',
  title: 'Revenue',
  dataset: 'sales',
  values: ['revenue'],
  ...extras,
});

const dashboard = (...widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', name: 'sales', widgets }) as unknown as DashboardComponentSchema;

const makeSource = () => ({ queryDataset: vi.fn(async () => ({ rows: [{ revenue: 510000 }] })) });

const SURFACES: Array<[string, (schema: DashboardComponentSchema, dataSource: unknown) => React.ReactElement]> = [
  ['DashboardRenderer', (schema, dataSource) => <DashboardRenderer schema={schema} dataSource={dataSource} />],
  ['DashboardGridLayout', (schema, dataSource) => <DashboardGridLayout schema={schema} dataSource={dataSource} />],
];

const renderSurface = async (
  surface: (schema: DashboardComponentSchema, dataSource: unknown) => React.ReactElement,
  schema: DashboardComponentSchema,
) => {
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      {surface(schema, makeSource())}
    </I18nProvider>,
  );
  // L1 on every case: the grid mounts its widgets only after it measures its
  // width, so settle on the resolved measure before asserting any absence.
  await screen.findByText('510000');
  return container;
};

/** The caption node `DatasetWidget` drew before objectui#11389. */
const captionOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="dataset-metric-subcaption"]');

describe.each(SURFACES)('%s — a dataset-bound KPI tile draws no sub-caption (objectui#11389)', (_name, surface) => {
  it('R1 an authored plain-string `options.description` grows no caption node', async () => {
    const container = await renderSurface(
      surface,
      dashboard(datasetMetric('untranslated', { options: { description: 'awaiting confirmation' } })),
    );
    expect(captionOf(container)).toBeNull();
    expect(container.textContent).not.toContain('awaiting confirmation');
  });

  it('R2 an authored per-locale map on `options.description` grows no caption node', async () => {
    const container = await renderSurface(
      surface,
      dashboard(datasetMetric('untranslated', { options: { description: { en: 'Signed this week', 'zh-CN': '本周已签' } } })),
    );
    expect(captionOf(container)).toBeNull();
    expect(container.textContent).not.toContain('本周已签');
    expect(container.textContent).not.toContain('Signed this week');
  });

  it.each([
    ['with no authored value', datasetMetric('pipeline'), ['按阶段推进']],
    ['beside an authored value', datasetMetric('revenue', { options: { description: 'Won this quarter' } }), ['本季度已赢单', 'Won this quarter']],
  ])('R3 a bundle `subCaption` entry grows no caption node, %s', async (_label, widget, absent) => {
    const container = await renderSurface(surface, dashboard(widget));
    expect(captionOf(container)).toBeNull();
    for (const text of absent) expect(container.textContent).not.toContain(text);
  });
});

describe('DashboardRenderer — `widget.description` is still drawn, as the tile title tooltip (objectui#11389, objectui#12528)', () => {
  // objectui#12528 moved the dataset-bound metric's description out of a
  // header paragraph and onto the title's tooltip; what this lit control
  // proves is unchanged: `widget.description` still reaches the tile,
  // translated, while `options.description` reaches nothing.
  it('L2 carries the translated `widget.description` on a dataset tile whose `options.description` draws nothing', async () => {
    const container = await renderSurface(
      SURFACES[0]![1],
      dashboard(datasetMetric('revenue', {
        description: 'Card header subtitle',
        options: { description: 'Won this quarter' },
      })),
    );
    // objectui#12623 — the measure label follows on its own line.
    expect(screen.getByTestId('dataset-metric-title').getAttribute('title')).toBe('卡片头部描述\nrevenue');
    expect(captionOf(container)).toBeNull();
    expect(container.textContent).not.toContain('Won this quarter');
    expect(container.textContent).not.toContain('本季度已赢单');
  });
});
