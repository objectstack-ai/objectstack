// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — the nav canvas births a new entry with NO `label`.
 *
 * `addItem` used to store a localized "New item" as the entry's label. A
 * present label renders verbatim — in the console's sidebar and on every
 * designer surface — so an entry the author then bound to an object kept
 * saying "New item" wherever a picker did not recognise the sentinel. A
 * placeholder is not the author's label, and an absent label is exactly what
 * inherits: the entry now shows its target's current label once a target is
 * bound, as the console draws it. Until then it reads the positional "Item N"
 * wording by its place, never the `nav_item_N` id it was minted with
 * (objectui#11862; it showed that id before).
 *
 * The canvas renders under a real `MetadataCtx` that labels the object, so the
 * inherited text (`Customers`) differs from the machine name (`account`). The
 * control: a legacy entry that STORED "New item" still renders it verbatim.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

function canvas(navigation: unknown[], onPatch = vi.fn(), onSelectionChange = vi.fn()) {
  return (
    <MetadataCtx.Provider value={METADATA as never}>
      <AppNavCanvas
        draft={{ navigation }}
        rootKey="navigation"
        onPatch={onPatch}
        selection={null}
        onSelectionChange={onSelectionChange}
      />
    </MetadataCtx.Provider>
  );
}

/** Click "Add nav item" on a canvas over `navigation`; answer the entry the canvas appended and the selection it made. */
function add(navigation: unknown[]) {
  const onPatch = vi.fn();
  const onSelectionChange = vi.fn();
  render(canvas(navigation, onPatch, onSelectionChange));
  fireEvent.click(screen.getByRole('button', { name: /Add nav item/ }));
  expect(onPatch).toHaveBeenCalledTimes(1);
  const written = (onPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> }).navigation;
  expect(written).toHaveLength(navigation.length + 1);
  return { entry: written[written.length - 1], selection: onSelectionChange.mock.calls.at(-1)?.[0] };
}

describe('objectui#11196 — a new canvas entry is stored label-less', () => {
  it('the appended entry carries an id and a type, and NO `label` key (in memory and on the wire)', () => {
    const { entry } = add([HOME]);
    expect(entry).toEqual({ id: 'nav_item_2', type: 'object' });
    expect(Object.prototype.hasOwnProperty.call(entry, 'label')).toBe(false);
    expect(JSON.parse(JSON.stringify(entry))).not.toHaveProperty('label');
  });

  it('the new entry is selected, titled by the text it shows: the positional wording, not its id', () => {
    const { selection } = add([HOME]);
    expect(selection).toEqual({ kind: 'nav', id: 'navigation[1]', label: 'Item 2' });
  });
});

describe('objectui#11196 — the card reads the positional wording until a target is bound, then inherits', () => {
  it('unbound: the card reads "Item N" by its place, never the entry id (objectui#11862)', () => {
    render(canvas([HOME, { id: 'nav_item_2', type: 'object' }]));
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.queryByText('nav_item_2')).not.toBeInTheDocument();
  });

  it("bound to an object: the card shows the object's label, not its id or machine name as its name", () => {
    render(canvas([HOME, { id: 'nav_item_2', type: 'object', objectName: 'account' }]));
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.queryByText('nav_item_2')).not.toBeInTheDocument();
  });

  it('CONTROL: a legacy entry that stored "New item" renders it verbatim, bound or not', () => {
    render(canvas([HOME, { id: 'nav_item_2', type: 'object', objectName: 'account', label: 'New item' }]));
    expect(screen.getByText('New item')).toBeInTheDocument();
    expect(screen.queryByText('Customers')).not.toBeInTheDocument();
  });
});
