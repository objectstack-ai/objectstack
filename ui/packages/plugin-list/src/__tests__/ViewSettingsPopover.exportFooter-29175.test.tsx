/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Display popover's footer keeps every export entry inside the panel
 * (objectstack#29175).
 *
 * A view offering CSV, XLSX and JSON drew Refresh and the three entries in one
 * group that could not wrap; at the popover's fixed width (`sm:w-80`) the
 * group was wider than the panel and "Export as JSON" spilled past its edge.
 * The entries now take a row of their own that wraps, and Refresh stays on
 * the first row beside Reset.
 *
 * jsdom has no layout, so what is pinned is the structure the fit depends on:
 * every entry sits in a full-width row whose flex container wraps, and that
 * row holds nothing but export entries.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { ViewSettingsPopover, type ViewSettingsPopoverProps } from '../components/ViewSettingsPopover';

const FORMATS = ['csv', 'xlsx', 'json'];

function Harness(props: Partial<ViewSettingsPopoverProps>) {
  const { t } = useObjectTranslation();
  return (
    <ViewSettingsPopover
      t={t as (key: string, opts?: any) => string}
      allFields={[{ name: 'status', label: 'Status' }]}
      {...props}
    />
  );
}

function openPopover(props: Partial<ViewSettingsPopoverProps>) {
  render(
    <I18nProvider
      config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <Harness {...props} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return screen.getByTestId('view-settings-content');
}

describe('ViewSettingsPopover — every export entry stays inside the panel (objectstack#29175)', () => {
  it('draws CSV, XLSX and JSON in a full-width row that wraps', () => {
    const onExport = vi.fn();
    const panel = openPopover({
      changedCount: 1,
      onReset: vi.fn(),
      onRefresh: vi.fn(),
      exportFormats: FORMATS,
      onExport,
    });

    const group = within(panel).getByTestId('display-export-group');
    expect(group).toHaveClass('flex', 'flex-wrap', 'basis-full');
    expect(within(panel).getByTestId('display-footer')).toHaveClass('flex-wrap');

    for (const format of FORMATS) {
      const name = `Export as ${format.toUpperCase()}`;
      const button = within(panel).getByRole('button', { name });
      expect(button).toBe(within(panel).getByTestId(`display-export-${format}`));
      expect(group).toContainElement(button);
      fireEvent.click(button);
      expect(onExport).toHaveBeenLastCalledWith(format);
    }
    expect(onExport).toHaveBeenCalledTimes(FORMATS.length);
  });

  it('keeps Refresh and Reset on the first row, out of the export row', () => {
    const panel = openPopover({
      changedCount: 1,
      onReset: vi.fn(),
      onRefresh: vi.fn(),
      exportFormats: FORMATS,
      onExport: vi.fn(),
    });

    const footer = within(panel).getByTestId('display-footer');
    const group = within(panel).getByTestId('display-export-group');
    const refresh = within(panel).getByTestId('refresh-button');
    const reset = within(panel).getByTestId('display-reset-button');

    // The cause of the clipping was Refresh and the exports sharing one
    // non-wrapping group: the export row now holds export entries only.
    expect(group).not.toContainElement(refresh);
    expect(group).not.toContainElement(reset);
    expect(within(group).getAllByRole('button')).toHaveLength(FORMATS.length);
    expect(refresh.parentElement).toBe(footer);
    expect(reset.parentElement).toBe(footer);
  });

  it('draws no export row when the view offers no format', () => {
    const panel = openPopover({ onRefresh: vi.fn(), exportFormats: [], onExport: vi.fn() });

    expect(within(panel).getByTestId('refresh-button')).toBeInTheDocument();
    expect(within(panel).queryByTestId('display-export-group')).not.toBeInTheDocument();
  });
});
