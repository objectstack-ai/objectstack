/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard config sidebar's FOOTER translates too — objectui#4750, with no
 * change to either panel.
 *
 * objectui#4748 routed everything these two panels own — breadcrumb, section
 * titles, field labels, placeholders, option labels — through `t()`. The two
 * words it could not reach were the footer's: `Save` and `Discard` are
 * `ConfigPanelRenderer`'s own chrome in `@object-ui/components`, handed to it as
 * PARAMETER DEFAULTS, and neither panel passes `saveLabel` / `discardLabel`.
 * The fix landed one package down, in the renderer.
 *
 * That is exactly what this file pins: both panels are mounted UNMODIFIED — no
 * label prop, nothing added to their schemas — and their footers still come out
 * Chinese. A future "fix" that translated the footer by making each caller pass
 * a label would keep the cases below green while re-opening the class for the
 * next `ConfigPanelRenderer` host, so the assertions are deliberately paired
 * with the components-package suites
 * (`config-panel-footer-i18n-4750.test.tsx`) rather than replacing them.
 *
 * Direction, predicted before running: RED before the renderer fix (both
 * footers read `Save` / `Discard` under a zh provider), GREEN after.
 *
 * The footer only exists while the draft is dirty, so each case makes one real
 * edit first — the same way `WidgetConfigPanel.retiredActionKeys.test.tsx`
 * reaches the save button.
 *
 * Provider-less rendering of these panels is asserted in
 * `ConfigPanel.noProviderLabels.test.tsx`; do not add a no-provider case here —
 * `createI18n`'s instance is registered module-globally and survives
 * `cleanup()`, so it would silently resolve against the zh instance above.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { WidgetConfigPanel } from '../WidgetConfigPanel';
import { DashboardConfigPanel } from '../DashboardConfigPanel';
import type { WidgetDatasetCatalogEntry } from '../dataset-catalog';

afterEach(cleanup);

const catalog: WidgetDatasetCatalogEntry[] = [
  {
    name: 'sales_pipeline',
    label: 'Sales Pipeline',
    dimensions: [{ name: 'stage' }],
    measures: [{ name: 'revenue', aggregate: 'sum' }],
  },
];

const footerText = () => ({
  save: screen.getByTestId('config-panel-save').textContent?.trim(),
  discard: screen.getByTestId('config-panel-discard').textContent?.trim(),
});

describe('WidgetConfigPanel footer under zh (objectui#4750)', () => {
  it('renders the translated save/discard words with no caller change', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <WidgetConfigPanel
          open
          onClose={vi.fn()}
          config={{ id: 'w1', type: 'bar', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'] }}
          onSave={vi.fn()}
          datasets={catalog}
        />
      </I18nProvider>,
    );

    // No footer until the draft is dirty — mirror a real edit.
    expect(screen.queryByTestId('config-panel-footer')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('config-field-title'), { target: { value: '营收' } });

    expect(footerText()).toEqual({ save: '保存', discard: '放弃' });
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByText('Discard')).not.toBeInTheDocument();
  });
});

describe('DashboardConfigPanel footer under zh (objectui#4750)', () => {
  it('renders the translated save/discard words with no caller change', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <DashboardConfigPanel
          open
          onClose={vi.fn()}
          config={{ columns: 3, gap: 4, rowHeight: 120 }}
          onSave={vi.fn()}
        />
      </I18nProvider>,
    );

    // `appearance` is `defaultCollapsed`, so its title input has to be revealed
    // before it can be edited.
    fireEvent.click(screen.getByTestId('section-header-appearance'));
    fireEvent.change(screen.getByTestId('config-field-title'), { target: { value: '销售看板' } });

    expect(footerText()).toEqual({ save: '保存', discard: '放弃' });
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByText('Discard')).not.toBeInTheDocument();
  });
});
