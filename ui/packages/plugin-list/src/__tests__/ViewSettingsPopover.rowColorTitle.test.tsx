/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The view-settings popover's colour section is titled with the SECTION key,
 * not the toolbar BUTTON key (objectui#4118).
 *
 * `list.color` ('Color') and `list.rowColor` ('Row Color') are two keys for two
 * slots of one feature, and `ListView` uses both correctly on the wide
 * toolbar: the compact `Paintbrush` button is `list.color`, and the panel that
 * button opens is headed `list.rowColor` (pinned by `ListView.test.tsx` →
 * "rowColor popover"). This popover is that same panel on the collapsed
 * surface — `compactToolbar` hides the button and folds its panel in here —
 * so it asked for the button's key and titled the section "Color".
 *
 * Reverse-verified by pointing the section back at `list.color`: the first two
 * cases go red (the section reads "Color", and no "Row Color" is rendered).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, useObjectTranslation, en } from '@object-ui/i18n';
import { ViewSettingsPopover } from '../components/ViewSettingsPopover';

/** The section's name, and the toolbar-button label it must no longer borrow. */
const SECTION_TITLE = en.list.rowColor;
const BUTTON_LABEL = en.list.color;

function Harness() {
  const { t } = useObjectTranslation();
  return (
    <ViewSettingsPopover
      t={t as (key: string, opts?: any) => string}
      allFields={[{ name: 'status', label: 'Status' }]}
      showColor
      // A configured row colour is what makes the section render EXPANDED
      // (`defaultOpen={!!rowColorConfig}`), so its body — the `Color by field`
      // label the exact-match assertion below leans on — is in the DOM.
      rowColorConfig={{ field: 'status', colors: {} }}
      setRowColorConfig={vi.fn()}
    />
  );
}

function openPopover() {
  render(
    <I18nProvider
      config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <Harness />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
}

describe('ViewSettingsPopover — the colour section takes the section key (objectui#4118)', () => {
  // Guards the premise: if the pack ever gave these two keys the same value the
  // assertions below would pass while proving nothing.
  it('the pack distinguishes the section title from the toolbar button label', () => {
    expect(SECTION_TITLE).toBe('Row Color');
    expect(BUTTON_LABEL).toBe('Color');
    expect(SECTION_TITLE).not.toBe(BUTTON_LABEL);
  });

  it('titles the colour section "Row Color"', async () => {
    openPopover();

    await vi.waitFor(() => {
      expect(screen.getByTestId('view-settings-content')).toBeInTheDocument();
    });
    expect(screen.getByText(SECTION_TITLE)).toBeInTheDocument();
  });

  it('does not title it with the toolbar button label', async () => {
    openPopover();

    await vi.waitFor(() => {
      expect(screen.getByTestId('view-settings-content')).toBeInTheDocument();
    });
    // Exact match: `list.colorByField` ('Color by field') is a legitimate
    // sibling inside the same section and must not be mistaken for the title.
    expect(screen.queryByText(BUTTON_LABEL)).not.toBeInTheDocument();
    expect(screen.getByText(en.list.colorByField)).toBeInTheDocument();
  });
});
