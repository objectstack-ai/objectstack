/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7063 — the dashboard/analytics DEFAULT empty state, pinned at the
 * SEAM rather than once per widget.
 *
 * Maintainer ruling 2026-08-31 (hotcrm#1212, following hotcrm#1203): a widget
 * that renders a bare row-placeholder on an empty result is the platform's
 * defect and must be fixed UNIFORMLY — apps must not compensate widget by
 * widget (objectstack#13848).
 *
 * ## What "uniformly" had to mean here, measured
 *
 * The card's premise was that `暂无数据行` is ONE shared placeholder every
 * affected widget reaches. It is not. Three dashboard surfaces wrote their own,
 * in two different strings:
 *
 *   - `DatasetWidget`   -> `dashboard.noRows`          ('No rows' / `暂无数据行`)
 *   - `ObjectDataTable` -> `dashboard.noDataAvailable` ('No data available')
 *   - `PivotTable`      -> `dashboard.noDataAvailable`
 *
 * `emptyState` — the authored override the card assumes exists — appears ZERO
 * times in `packages/plugin-dashboard` and `packages/plugin-charts` (control in
 * the same sweep: `widget`, 1154 hits). It is a LIST-view contract
 * (`ObjectGridSchema` / `NamedListView`, honoured in `plugin-list`), and
 * `@objectstack/spec`'s `DashboardWidgetSchema` declares no such key at all.
 *
 * So there was no seam to fix; `WidgetEmptyState` IS the seam. This file pins
 * that all three surfaces reach it, which is the property that decays first: a
 * fourth widget added later can quietly write a fourth placeholder, and every
 * per-widget test stays green while "uniformly" stops being true.
 *
 * ## It pins PROPERTIES, not the sentence
 *
 * The ruling fixes what the state must DO — read as a state and not a failure,
 * describe itself with no authored copy, name what is empty, translate through
 * the platform packs. Exact copy is review's to move, so the assertions here
 * are the role, the presence of an explanation beside the title, and the source
 * name — never a full-string equality.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import React from 'react';

import { DatasetWidget } from '../DatasetWidget';
import { ObjectDataTable } from '../ObjectDataTable';
import { PivotTable } from '../PivotTable';
import { ObjectPivotTable } from '../ObjectPivotTable';

afterEach(cleanup);

/** A dataSource whose every read succeeds and returns nothing. */
const emptySource = () => ({
  queryDataset: vi.fn(async () => ({ rows: [] })),
  find: vi.fn(async () => []),
  getObject: vi.fn(async () => ({ name: 'crm_forecast', fields: {} })),
});

describe('objectui#7063 — one self-explaining default across the dashboard surface', () => {
  it('DatasetWidget (the measured surface) names its dataset', async () => {
    render(
      <DatasetWidget
        widget={{ type: 'table', dataset: 'crm_forecast', dimensions: ['owner'], values: ['attainment'] }}
        dataSource={emptySource()}
      />,
    );
    const panel = await screen.findByTestId('widget-empty-state');
    expect(panel).toHaveAttribute('role', 'status');
    expect(panel.textContent).toContain('No data yet');
    expect(screen.getByTestId('widget-empty-source').textContent).toContain('crm_forecast');
  });

  it('ObjectDataTable reaches the same default and names its object', async () => {
    render(<ObjectDataTable schema={{ type: 'object-data-table', objectName: 'quota_attainment' } as any} dataSource={emptySource() as any} />);
    // The wrapper keeps the id the pre-existing pins select on…
    await waitFor(() => expect(screen.getByTestId('table-empty-state')).toBeInTheDocument());
    // …and the shared default renders inside it.
    const panel = screen.getByTestId('widget-empty-state');
    expect(panel).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('widget-empty-source').textContent).toContain('quota_attainment');
  });

  it('PivotTable reaches the same default (id preserved for the app-shell sweep)', () => {
    render(
      <PivotTable
        schema={{ type: 'pivot', rowField: 'stage', columnField: 'quarter', valueField: 'amount', data: [] }}
        sourceLabel="crm_forecast"
      />,
    );
    const panel = screen.getByTestId('pivot-empty-state');
    expect(panel).toHaveAttribute('role', 'status');
    // The pivot used to suppress its title outright (`title=""` plus a
    // `[&>h3]:hidden` rule), leaving only the terse description.
    expect(panel.textContent).toContain('No data yet');
    expect(screen.getByTestId('widget-empty-source').textContent).toContain('crm_forecast');
  });

  it('ObjectPivotTable forwards its objectName as the source', async () => {
    render(
      <ObjectPivotTable
        schema={{ type: 'object-pivot', objectName: 'crm_forecast', rowField: 'stage', columnField: 'quarter', valueField: 'amount' } as any}
        dataSource={emptySource() as any}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('pivot-empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('widget-empty-source').textContent).toContain('crm_forecast');
  });

  it('the copy comes from the platform packs, not from an inline English default', async () => {
    // The i18n half of the ruling: mounting a zh provider must move the whole
    // default, title and explanation alike. An inline `defaultValue` (or a
    // hard-coded string) renders English here and is untranslatable everywhere
    // else — objectui#3517's exact failure, which is why this asserts on a
    // MOUNTED provider rather than on the pack file's contents.
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <DatasetWidget
          widget={{ type: 'table', dataset: 'crm_forecast', dimensions: ['owner'], values: ['attainment'] }}
          dataSource={emptySource()}
        />
      </I18nProvider>,
    );
    const panel = await screen.findByTestId('widget-empty-state');
    await waitFor(() => expect(panel.textContent).toContain('暂时还没有数据'));
    expect(panel.textContent).toContain('已成功加载');
    // The bare placeholder this card replaces must be gone from the rendered
    // output — not merely joined by better copy.
    expect(panel.textContent).not.toContain('暂无数据行');
    // The source line keeps its own punctuation from the pack (`数据源：`), so
    // no separator is concatenated in code.
    expect(screen.getByTestId('widget-empty-source').textContent).toContain('数据源：');
  });
});
