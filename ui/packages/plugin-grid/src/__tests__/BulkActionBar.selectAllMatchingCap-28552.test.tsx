/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28552 — over the "select all matching" cap, the bulk bar names
 * the cap.
 *
 * `resolveBulkRows` hands a bulk action at most BULK_SELECT_ALL_MATCHING_CAP
 * records. The bar used to count the whole match set ("All 7200 matching
 * records are selected."), so a bulk delete over 7200 matches reported every
 * match and processed the first 5000. Over the cap, the banner, the
 * select-all button, the count chip and the selection's context-menu label now
 * name the cap and the total; at or under it they read as before. Strings are
 * read from the packs, never from literals; the cap is read from the one
 * constant `resolveBulkRows` reads too.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/react';
import { DropdownMenu, DropdownMenuContent } from '@object-ui/components';
import { en, zh } from '@object-ui/i18n/locales';
import { BulkActionBar } from '../components/BulkActionBar';
import { SelectionContextMenuItems } from '../components/RowContextMenu';
import { BULK_SELECT_ALL_MATCHING_CAP } from '../bulkSelectAllMatchingCap';

afterEach(cleanup);

const CAP = BULK_SELECT_ALL_MATCHING_CAP;
const PAGE = 50;
const page = Array.from({ length: PAGE }, (_, i) => ({ id: String(i + 1) }));

const fill = (template: string, values: Record<string, number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k]));

const renderBar = (language: string, totalMatching: number, allMatchingSelected: boolean) =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <BulkActionBar
        selectedRows={page}
        actions={['delete']}
        pageSize={PAGE}
        totalMatching={totalMatching}
        allMatchingSelected={allMatchingSelected}
        onSelectAllMatching={() => {}}
      />
    </I18nProvider>,
  );

describe('the bulk bar names the select-all-matching cap (objectstack#28552)', () => {
  it('the cap is the number resolveBulkRows stops at', () => {
    // bulkFanoutHostParams.test.tsx pins the fan-out stopping at this value.
    expect(CAP).toBe(5000);
  });

  describe('over the cap', () => {
    const total = CAP + 2200;

    it('the select-all button offers the first CAP of the total, not all of them', async () => {
      renderBar('en', total, false);
      const button = await screen.findByTestId('bulk-select-all-matching');
      expect(button).toHaveTextContent(fill(en.grid.bulkSelectAllMatchingCapped, { cap: CAP, total }));
      expect(button).not.toHaveTextContent(fill(en.grid.bulkSelectAllMatching, { count: total }));
    });

    it('once selected, the banner says only the first CAP will be processed, and the chip counts CAP', async () => {
      renderBar('en', total, true);
      const banner = await screen.findByTestId('bulk-cross-page-banner');
      expect(banner).toHaveTextContent(fill(en.grid.bulkAllMatchingSelectedCapped, { cap: CAP, total }));
      expect(banner).toHaveTextContent(String(CAP));
      expect(banner).not.toHaveTextContent(fill(en.grid.bulkAllMatchingSelected, { count: total }));
      const bar = screen.getByTestId('bulk-actions-bar');
      expect(bar).toHaveTextContent(fill(en.grid.bulkSelectedAllMatchesCapped, { cap: CAP, total }));
      expect(bar).not.toHaveTextContent(fill(en.grid.bulkSelectedAllMatches, { count: total }));
    });

    it('under zh, the banner reads the zh pack', async () => {
      expect(zh.grid.bulkAllMatchingSelectedCapped).not.toBe(en.grid.bulkAllMatchingSelectedCapped);
      renderBar('zh', total, true);
      const banner = await screen.findByTestId('bulk-cross-page-banner');
      expect(banner).toHaveTextContent(fill(zh.grid.bulkAllMatchingSelectedCapped, { cap: CAP, total }));
    });

    it("the selection's context menu counts CAP of the total", async () => {
      render(
        <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
          <DropdownMenu open>
            <DropdownMenuContent>
              <SelectionContextMenuItems selectedRows={page} actions={[]} allMatchingSelected totalMatching={total} />
            </DropdownMenuContent>
          </DropdownMenu>
        </I18nProvider>,
      );
      const label = await screen.findByTestId('row-context-selection-count');
      expect(label).toHaveTextContent(fill(en.grid.bulkSelectedAllMatchesCapped, { cap: CAP, total }));
    });
  });

  describe.each([
    ['exactly at the cap', CAP],
    ['under the cap', CAP - 3800],
  ])('%s', (_name, total) => {
    it("the select-all button reads today's text", async () => {
      renderBar('en', total, false);
      const button = await screen.findByTestId('bulk-select-all-matching');
      expect(button).toHaveTextContent(fill(en.grid.bulkSelectAllMatching, { count: total }));
    });

    it("once selected, the banner and the chip read today's text", async () => {
      renderBar('en', total, true);
      const banner = await screen.findByTestId('bulk-cross-page-banner');
      expect(banner).toHaveTextContent(fill(en.grid.bulkAllMatchingSelected, { count: total }));
      expect(within(screen.getByTestId('bulk-actions-bar')).getByText(fill(en.grid.bulkSelectedAllMatches, { count: total }))).toBeInTheDocument();
    });
  });
});
