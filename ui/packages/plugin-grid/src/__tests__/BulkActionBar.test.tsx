/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { I18nProvider } from '@object-ui/react';
import { BulkActionBar } from '../components/BulkActionBar';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));

// BulkActionBar surfaces its strings via useObjectTranslation, so tests wrap in
// an English i18n provider — otherwise `{{count}}` interpolation never runs and
// the raw templates leak into the DOM.
const renderBar = (ui: React.ReactElement) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );

describe('BulkActionBar', () => {
  it('renders nothing when selection empty', () => {
    const { container } = renderBar(
      <BulkActionBar selectedRows={[]} actions={['delete']} />,
    );
    // I18nProvider adds no DOM of its own, so an empty bar means no bar.
    expect(container.querySelector('[data-testid="bulk-actions-bar"]')).toBeNull();
  });

  it('shows count + Clear even with no bulk actions configured', () => {
    // The bar is the single canonical selection indicator: with no actions it
    // still surfaces "N selected / Clear" so the embedded table needn't draw
    // its own (unstyled) selection toolbar.
    renderBar(<BulkActionBar selectedRows={rows(2)} actions={[]} />);
    expect(screen.getByTestId('bulk-actions-bar')).toBeTruthy();
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    expect(screen.getByText('Clear')).toBeTruthy();
    // …but no action buttons.
    expect(screen.queryByTestId('bulk-action-delete')).toBeNull();
  });

  it('shows N selected for the current-page case', () => {
    renderBar(<BulkActionBar selectedRows={rows(3)} actions={['delete']} />);
    expect(screen.getByText(/3 selected/)).toBeTruthy();
  });

  it('does not show cross-page banner when total ≤ page', () => {
    renderBar(
      <BulkActionBar
        selectedRows={rows(5)}
        actions={['delete']}
        pageSize={5}
        totalMatching={5}
      />,
    );
    expect(screen.queryByTestId('bulk-cross-page-banner')).toBeNull();
  });

  it('offers "Select all N matching" when full page is selected and more exist', () => {
    const onSelectAll = vi.fn();
    renderBar(
      <BulkActionBar
        selectedRows={rows(10)}
        actions={['delete']}
        pageSize={10}
        totalMatching={137}
        onSelectAllMatching={onSelectAll}
      />,
    );
    const banner = screen.getByTestId('bulk-cross-page-banner');
    expect(banner.textContent).toMatch(/All 10 on this page are selected/);
    const cta = screen.getByTestId('bulk-select-all-matching');
    expect(cta.textContent).toMatch(/Select all 137 matching/);
    fireEvent.click(cta);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('shows "all matches selected" summary once user opts in', () => {
    renderBar(
      <BulkActionBar
        selectedRows={rows(10)}
        actions={['delete']}
        pageSize={10}
        totalMatching={137}
        allMatchingSelected
      />,
    );
    expect(screen.getByText(/All 137 matching records are selected/)).toBeTruthy();
    expect(screen.getByText(/137 selected \(all matches\)/)).toBeTruthy();
    expect(screen.queryByTestId('bulk-select-all-matching')).toBeNull();
  });

  it('calls onClearSelection and clears cross-page when Clear is clicked', () => {
    const onClear = vi.fn();
    renderBar(
      <BulkActionBar
        selectedRows={rows(10)}
        actions={['delete']}
        pageSize={10}
        totalMatching={137}
        allMatchingSelected
        onClearSelection={onClear}
      />,
    );
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
