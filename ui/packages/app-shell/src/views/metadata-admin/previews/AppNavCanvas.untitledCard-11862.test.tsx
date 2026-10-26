// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11862 — the nav editor's edit-mode card never names an entry by the
 * `nav_item_N` id the canvas minted for it.
 *
 * *Add nav item* births `{ id: 'nav_item_N', type: 'object' }` with no label
 * (objectui#11196), and the runtime's inheritance rule names an entry with no
 * target by its `id`. So while an author edited the navigation, the new card
 * read `nav_item_2`. On the maintainer's word 「所有地方以标签为主，机器名只作为次要信息」
 * the card now reads the editor's existing positional wording
 * (`engine.appNav.item`, "Item N" / 「导航项 N」) by the entry's place, the same
 * rule the Studio's nav rail uses:
 *
 *  - an unbound entry, and an untyped one (what an unbind leaves), read
 *    "Item N" in English and 「导航项 N」 in Chinese, never their id;
 *  - selecting the card titles the selection with that same text;
 *  - CONTROL: a bound entry still shows its object's label;
 *  - CONTROL: an entry with an authored label shows it verbatim, bound or not;
 *  - CONTROL: a label-less group keeps the runtime's reading, its id — it is
 *    saved, and the console's sidebar names it so.
 *
 * Display only: nothing here writes, and the ids stay as minted.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';

import { AppNavCanvas } from './AppNavCanvas';

afterEach(cleanup);

/** The host's metadata cache: the object carries a label. One module-level value, so its identity is stable. */
const METADATA = {
  apps: [],
  objects: [{ name: 'account', label: 'Customers' }],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const HOME = { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' };

function renderCanvas(navigation: unknown[], language = 'en', onSelectionChange = vi.fn()) {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MetadataCtx.Provider value={METADATA as never}>
        <AppNavCanvas
          draft={{ navigation }}
          rootKey="navigation"
          onPatch={vi.fn()}
          selection={null}
          onSelectionChange={onSelectionChange}
        />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  return onSelectionChange;
}

describe('objectui#11862 — an edit-mode card for an entry with no target reads the positional wording', () => {
  it('an unbound entry reads "Item N" by its place, never its minted id', () => {
    // The id's number (7) differs from the place (2), so the text is not read off the id.
    renderCanvas([HOME, { id: 'nav_item_7', type: 'object' }]);
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.queryByText('nav_item_7')).not.toBeInTheDocument();
  });

  it('in Chinese it reads 「导航项 N」, never its minted id', () => {
    renderCanvas([HOME, { id: 'nav_item_7', type: 'object' }], 'zh');
    expect(screen.getByText('导航项 2')).toBeInTheDocument();
    expect(screen.queryByText('nav_item_7')).not.toBeInTheDocument();
  });

  it('an untyped entry (what an unbind leaves) reads the same wording', () => {
    renderCanvas([HOME, { id: 'nav_item_3' }]);
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.queryByText('nav_item_3')).not.toBeInTheDocument();
  });

  it('selecting the card titles the selection with the text it shows', () => {
    const onSelectionChange = renderCanvas([HOME, { id: 'nav_item_7', type: 'object' }]);
    fireEvent.click(screen.getByText('Item 2'));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: 'nav', id: 'navigation[1]', label: 'Item 2' });
  });

  it("CONTROL: a bound entry still shows its object's label", () => {
    renderCanvas([HOME, { id: 'nav_item_7', type: 'object', objectName: 'account' }]);
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
  });

  it('CONTROL: an authored label shows verbatim, on an unbound entry too', () => {
    renderCanvas([HOME, { id: 'nav_item_7', type: 'object', label: 'Clients' }]);
    expect(screen.getByText('Clients')).toBeInTheDocument();
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
  });

  it("CONTROL: a label-less group keeps the runtime's reading, its id", () => {
    renderCanvas([HOME, { id: 'nav_admin', type: 'group', children: [] }]);
    expect(screen.getByText('nav_admin')).toBeInTheDocument();
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
  });
});
