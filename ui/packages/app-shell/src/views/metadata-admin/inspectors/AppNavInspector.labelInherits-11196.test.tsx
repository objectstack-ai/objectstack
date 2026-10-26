// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — the app nav inspector names a label-less item the way the
 * console's sidebar does, and its Label field shows the inherited text as a
 * PLACEHOLDER, never as a stored value.
 *
 * The inspector read `label ?? title ?? name ?? <selection id>`: a label-less
 * item was titled by its positional selection id (`navigation[0]`), and its
 * Label field was empty with nothing to say what the item shows. `title` /
 * `name` are not nav-item keys. The title and the field now read through the
 * shared `navItemLabel` module with the console's own target resolver, under
 * a real `MetadataCtx`:
 *
 *  - a label-less item is titled by its target's metadata label; its Label
 *    field's value is empty and its placeholder is that text;
 *  - typing writes an author label;
 *  - emptying the field restores inheritance: the `label` key is REMOVED,
 *    never written as `''`;
 *  - a locale-map label shows the designer locale's text (not
 *    `[object Object]`), and emptying it drops only that locale's entry;
 *  - CONTROL: an authored label is the title and the field's value, verbatim.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

// ONE client for the whole file, as the real hook hands out. A client minted
// per call is a new identity every render, and the inspector's option loader
// keys its effect on the client and sets state in it: that is a render loop
// that never settles.
const client = vi.hoisted(() => ({ list: async () => [] }));

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { AppNavInspector } from './AppNavInspector';

afterEach(cleanup);

const METADATA = {
  apps: [],
  objects: [{ name: 'lead', label: 'Leads' }],
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

function inspect(item: Record<string, unknown>, locale: 'en-US' | 'zh-CN' = 'en-US') {
  const onPatch = vi.fn();
  render(
    <MetadataCtx.Provider value={METADATA as never}>
      <AppNavInspector
        type="app"
        name="crm"
        selection={{ kind: 'nav', id: 'navigation[0]' }}
        draft={{ name: 'crm', navigation: [item] }}
        onPatch={onPatch}
        onClearSelection={() => {}}
        locale={locale}
        readOnly={false}
      />
    </MetadataCtx.Provider>,
  );
  return onPatch;
}

/** The Label field: the first text input of the inspector. */
function labelField(): HTMLInputElement {
  return screen.getAllByRole('textbox')[0] as HTMLInputElement;
}

/** The single nav item an `onPatch` call wrote. */
function written(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(onPatch).toHaveBeenCalledTimes(1);
  return (onPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> }).navigation[0];
}

const LABEL_LESS = { id: 'nav_leads', type: 'object', objectName: 'lead' };

describe('objectui#11196 — AppNavInspector names a label-less item by what it inherits', () => {
  it("is titled by the target's metadata label, not by the selection's positional id", () => {
    inspect(LABEL_LESS);
    expect(screen.getByText('Leads')).toBeTruthy();
    expect(screen.queryByText('navigation[0]')).toBeNull();
  });

  it('shows the inherited text as the Label placeholder, never as its value', () => {
    inspect(LABEL_LESS);
    expect(labelField().value).toBe('');
    expect(labelField().placeholder).toBe('Leads');
  });

  it('typing writes an author label', () => {
    const onPatch = inspect(LABEL_LESS);
    fireEvent.change(labelField(), { target: { value: 'Hot prospects' } });
    expect(written(onPatch).label).toBe('Hot prospects');
  });

  it("emptying the field restores inheritance: the key is removed, never written as ''", () => {
    const onPatch = inspect({ ...LABEL_LESS, label: 'Hot prospects' });
    fireEvent.change(labelField(), { target: { value: '' } });
    const item = written(onPatch);
    expect(Object.prototype.hasOwnProperty.call(item, 'label')).toBe(false);
    expect(item).toEqual(LABEL_LESS);
  });

  it("a locale-map label shows the designer locale's text, and emptying it drops only that locale's entry", () => {
    const onPatch = inspect({ ...LABEL_LESS, label: { en: 'Prospects', 'zh-CN': '潜在客户' } }, 'zh-CN');
    expect(labelField().value).toBe('潜在客户');
    expect(document.body.textContent).not.toContain('[object Object]');
    fireEvent.change(labelField(), { target: { value: '' } });
    expect(written(onPatch).label).toEqual({ en: 'Prospects' });
  });

  it('CONTROL: an authored label is the title and the value, verbatim', () => {
    inspect({ ...LABEL_LESS, label: 'Hot prospects' });
    expect(screen.getByText('Hot prospects')).toBeTruthy();
    expect(labelField().value).toBe('Hot prospects');
    expect(screen.queryByText('Leads')).toBeNull();
  });
});
