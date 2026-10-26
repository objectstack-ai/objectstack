/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The four `useDesignerTranslation` keys objectui#4396 backfills resolve to
 * ENGLISH when no `I18nProvider` is mounted.
 *
 * All four — `appDesigner.widgetProperties`, `appDesigner.addWidget`,
 * `appDesigner.modeEdit`, `common.delete` — are among the six keys PR #4372's
 * census measured as reading **outside** their hook's defaults table with **no
 * inline `defaultValue`** at the call site. #4372 taught
 * `createSafeTranslation`'s fallback to honour an inline default, which fixed
 * the other 20 outside-table keys; these carry neither, so until this card they
 * fell through to `fallbackT`'s last resort — the raw key. A provider-less
 * designer showed `appDesigner.widgetProperties` as an inspector heading,
 * `appDesigner.addWidget` as a toolbar label, `appDesigner.modeEdit` as a
 * button's accessible name, and `common.delete` on a destructive confirm.
 *
 * `common.delete` is the key the census left unattributed ("outside table
 * without default", no consumer named). Both of its call sites —
 * `FieldDesigner.tsx` and `ObjectManager.tsx` — resolve through
 * `useDesignerTranslation`, so the row belongs to THIS package's table, not to
 * `packages/components`. `ObjectManager` is the cheaper of the two to mount, so
 * it carries the pin.
 *
 * The call sites are bare on purpose and stay bare; the fix is four rows in
 * `DESIGNER_DEFAULT_TRANSLATIONS`, each byte-identical to its `en` pack value.
 *
 * Direction: this file was RED before the change (four raw keys) and is GREEN
 * after.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`, so one `<I18nProvider>` mount
 * anywhere in a file silently resolves every later "no provider" render in that
 * same file against it — a green-looking file that asserts nothing about the
 * fallback. Vitest's `dom` project runs with `isolate: true`, so a file that
 * never mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { DashboardComponentSchema, ObjectDefinition } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';
import { ObjectManager } from '../ObjectManager';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-form')),
}));

const DASHBOARD = {
  type: 'dashboard',
  name: 'sales',
  title: 'Sales dashboard',
  widgets: [{ id: 'w1', type: 'metric', title: 'Revenue' }],
} as DashboardComponentSchema;

const OBJECTS: ObjectDefinition[] = [
  {
    id: 'obj-1',
    name: 'accounts',
    label: 'Accounts',
    group: 'Custom Objects',
    isSystem: false,
    fieldCount: 12,
  },
];

afterEach(() => cleanup());

describe('DashboardEditor — English fallback with no provider (objectui#4396)', () => {
  it('labels the add-widget toolbar in English, never the raw key', () => {
    render(<DashboardEditor schema={DASHBOARD} onChange={() => {}} />);

    expect(screen.getByText('Add Widget:')).toBeTruthy();
    expect(screen.queryByText(/appDesigner\.addWidget/)).toBeNull();
  });

  it('heads the widget property panel in English, never the raw key', () => {
    render(<DashboardEditor schema={DASHBOARD} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('dashboard-widget-w1'));

    // Non-vacuity: the panel really did mount.
    expect(screen.getByTestId('widget-property-panel')).toBeTruthy();
    expect(screen.getByText('Widget Properties')).toBeTruthy();
    expect(screen.queryByText(/appDesigner\.widgetProperties/)).toBeNull();
  });

  it('names the preview toggle’s edit state in English, never the raw key', () => {
    render(<DashboardEditor schema={DASHBOARD} onChange={() => {}} />);
    const toggle = screen.getByTestId('dashboard-preview-toggle');

    // In edit mode the toggle offers "Preview" (already in the table); the
    // `modeEdit` half only appears once preview mode is ON, so the click is
    // what puts this key on screen at all.
    expect(toggle.getAttribute('aria-label')).toBe('Preview');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Edit');
  });

  it('leaves no `appDesigner.` raw key anywhere in the editor', () => {
    render(<DashboardEditor schema={DASHBOARD} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('dashboard-widget-w1'));

    expect(document.body.textContent).not.toMatch(/appDesigner\.[a-zA-Z]/);
  });
});

describe('ObjectManager delete confirm — English fallback with no provider (objectui#4396)', () => {
  it('labels the destructive confirm in English, never the raw key', async () => {
    render(<ObjectManager objects={OBJECTS} onObjectsChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('grid-delete-obj-1')).toBeDefined());
    fireEvent.click(screen.getByTestId('grid-delete-obj-1'));

    // Scoped to the dialog: the stub grid renders its own "Delete" control, so
    // an unscoped `getByText('Delete')` matches two nodes and throws.
    const dialog = await waitFor(() => {
      const el = document.querySelector('dialog');
      expect(el).not.toBeNull();
      return within(el as HTMLElement);
    });

    // `Cancel` is already in the table and pins that the dialog is mounted, so
    // the assertions below are about the key rather than about an empty DOM.
    expect(dialog.getByText('Cancel')).toBeTruthy();
    expect(dialog.getByText('Delete')).toBeTruthy();
    expect(dialog.queryByText('common.delete')).toBeNull();
  });
});
