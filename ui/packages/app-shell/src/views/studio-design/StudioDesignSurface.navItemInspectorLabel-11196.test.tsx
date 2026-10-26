// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — `StudioNavItemInspector`'s Label field has the shape
 * `AppNavInspector`'s has: the authored label is its value, the text the entry
 * inherits is its placeholder, and emptying it restores inheritance.
 *
 * Before: the field showed a fixed "e.g. Positions" hint, never what a
 * label-less entry actually shows, and emptying it wrote `label: ''` — a
 * PRESENT label, so the entry showed nothing instead of inheriting. Binding an
 * object also removed a label that matched the canvas's "New item" birth
 * sentinel; the canvas now births an entry label-less, so the sentinel
 * matching is gone and a present label, a legacy "New item" included, is kept.
 *
 * The inspector renders under a real `MetadataCtx` that labels the object, so
 * the inherited text (`Customers`) differs from the machine name (`account`).
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { MetadataCtx } from '@object-ui/react';

import { StudioNavItemInspector } from './StudioDesignSurface';

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

const OBJECTS = [{ name: 'account', label: 'Customers' }];

function renderInspector(node: Record<string, unknown>) {
  const onNavPatch = vi.fn();
  render(
    <MetadataCtx.Provider value={METADATA as never}>
      <StudioNavItemInspector
        navId="navigation[0]"
        appDraft={{ navigation: [node] }}
        objects={OBJECTS}
        packageId="com.acme.app"
        onNavPatch={onNavPatch}
        onClear={vi.fn()}
      />
    </MetadataCtx.Provider>,
  );
  return onNavPatch;
}

/** The Label field: the inspector's one text input. */
const labelField = () => screen.getByRole('textbox') as HTMLInputElement;

/** The entry the one `onNavPatch` call wrote. */
function written(onNavPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(onNavPatch).toHaveBeenCalledTimes(1);
  return (onNavPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> }).navigation[0];
}

const has = (entry: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(entry, key);

describe('objectui#11196 — the Studio nav-item inspector shows what a label-less entry inherits', () => {
  it("a label-less bound entry: the field is empty, and its placeholder is the object's label", () => {
    renderInspector({ id: 'nav_account', type: 'object', objectName: 'account' });
    expect(labelField()).toHaveValue('');
    expect(labelField()).toHaveAttribute('placeholder', 'Customers');
  });

  // objectui#11862 — the rule's last rung would name an unbound entry by the id
  // the canvas minted; the field offers the editor's untitled wording instead,
  // by the entry's place ("Item 1" at `navigation[0]`), never `nav_item_3`.
  it('a new canvas entry, not yet bound: the placeholder is the untitled wording, not its id', () => {
    renderInspector({ id: 'nav_item_3', type: 'object' });
    expect(labelField()).toHaveValue('');
    expect(labelField()).toHaveAttribute('placeholder', 'Item 1');
  });

  it('CONTROL: an authored label is the value, verbatim; the placeholder is still what it would inherit', () => {
    renderInspector({ id: 'nav_account', type: 'object', objectName: 'account', label: 'Clients' });
    expect(labelField()).toHaveValue('Clients');
    expect(labelField()).toHaveAttribute('placeholder', 'Customers');
  });
});

describe('objectui#11196 — emptying the field restores inheritance', () => {
  it('a plain-string label is REMOVED, never written as an empty string', () => {
    const onNavPatch = renderInspector({ id: 'nav_account', type: 'object', objectName: 'account', label: 'Clients' });
    fireEvent.change(labelField(), { target: { value: '' } });
    const entry = written(onNavPatch);
    expect(has(entry, 'label')).toBe(false);
    expect(entry).toMatchObject({ id: 'nav_account', type: 'object', objectName: 'account' });
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
  });

  it("a locale map loses only the designer locale's entry; every other language keeps its text", () => {
    const onNavPatch = renderInspector({
      id: 'nav_account',
      type: 'object',
      objectName: 'account',
      label: { 'en-US': 'Clients', 'zh-CN': '客户们' },
    });
    fireEvent.change(labelField(), { target: { value: '' } });
    expect(written(onNavPatch).label).toEqual({ 'zh-CN': '客户们' });
  });

  it('CONTROL: typing into a label-less entry writes an author label', () => {
    const onNavPatch = renderInspector({ id: 'nav_account', type: 'object', objectName: 'account' });
    fireEvent.change(labelField(), { target: { value: 'Clients' } });
    expect(written(onNavPatch).label).toBe('Clients');
  });
});

/** Pick an object in *Link object*, the shared `Select` since objectui#11865. */
async function pickObject(label: string): Promise<void> {
  // objectui#12455 — the inspector also offers an Icon picker (a combobox), so the object picker is addressed by its test id.
  fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

describe('objectui#11196 — binding an object leaves the label as it is', () => {
  it('a label-less entry stays label-less', async () => {
    const onNavPatch = renderInspector({ id: 'nav_item_3', type: 'object' });
    await pickObject('Customers (account)');
    const entry = written(onNavPatch);
    expect(entry).toMatchObject({ id: 'nav_item_3', type: 'object', objectName: 'account' });
    expect(has(entry, 'label')).toBe(false);
  });

  it('a legacy stored "New item" label is a present label: it is kept, verbatim', async () => {
    const onNavPatch = renderInspector({ id: 'nav_item_3', type: 'object', label: 'New item' });
    await pickObject('Customers (account)');
    expect(written(onNavPatch).label).toBe('New item');
  });
});
