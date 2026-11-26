// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio create dialogs — each label names its input (objectui#13128).
 *
 * Measured on `origin/main` before this fix: `CreateItemDialog` rendered its
 * two `Label`s with no `htmlFor` and its two `Input`s with no `id`, so a
 * screen reader announced two unlabeled edit fields and `getByLabelText`
 * found nothing. The component is shared by every Studio create dialog
 * (package, app, object, flow, permission set), so the fix is there and this
 * suite drives two real openers: the Data pillar's New object, and the
 * toolbar's Create app.
 *
 * Label strings are read by their catalog key, so the pin is on the binding,
 * not on the copy.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@object-ui/plugin-detail';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let clientImpl: any;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [
      { id: 'app.a', name: 'App A', writable: true, namespace: 'a' },
    ]),
  };
});

vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { MetadataListCreateDialog } from '../metadata-admin/MetadataListCreateDialog';
import { t } from '../metadata-admin/i18n';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as any;

(globalThis as any).ResizeObserver =
  (globalThis as any).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

beforeEach(() => {
  clientImpl = {
    list: async () => [],
    listDrafts: async () => [],
    layered: async () => ({ effective: null, code: null }),
    getDraft: async () => null,
    get: async () => null,
    save: async (_type: string, _name: string, body: unknown) => body,
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as any);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Assert `labelText` names an input inside `dialog`, and return that input. */
function expectBound(dialog: HTMLElement, labelText: string): HTMLInputElement {
  const input = within(dialog).getByLabelText(labelText) as HTMLInputElement;
  expect(input.tagName).toBe('INPUT');
  expect(input).toHaveAccessibleName(labelText);
  return input;
}

describe('Studio create dialogs bind each label to its input (objectui#13128)', () => {
  it('New object: "Object name" and "Identifier" each find their input', async () => {
    // objectstack#36904 — New object is the object list's create dialog.
    render(
      <MemoryRouter>
        <MetadataListCreateDialog type="object" open onOpenChange={() => {}} packageId="app.a" inPair={false} locale="en-US" onCreated={() => {}} />
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole('dialog');

    const nameInput = expectBound(dialog, t('engine.studio.data.nameLabel', 'en'));
    const idInput = expectBound(dialog, t('engine.studio.data.idLabel', 'en'));
    expect(nameInput).not.toBe(idInput);

    // The binding is to the live fields: the display name auto-slugs the identifier.
    fireEvent.change(nameInput, { target: { value: 'Repair Ticket' } });
    expect(idInput.value).toBe('repair_ticket');
  });

  it('Create app (a sibling dialog on the same component): "App name" and "Identifier" each find their input', async () => {
    // objectstack#36903 — the Automations pillar is retired; the sharing overview's page hosts the toolbar.
    render(
      <MemoryRouter initialEntries={['/studio/app.a/owd']}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
        </Routes>
      </MemoryRouter>,
    );
    const toolbar = await screen.findByTestId('studio-shell-header');
    await waitFor(() =>
      expect(within(toolbar).getByRole('button', { name: 'Create app' })).toBeInTheDocument(),
    );
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Create app' }));
    const dialog = await screen.findByRole('dialog');

    const nameInput = expectBound(dialog, t('engine.studio.app.nameLabel', 'en'));
    const idInput = expectBound(dialog, t('engine.studio.app.idLabel', 'en'));
    expect(nameInput).not.toBe(idInput);
  });
});
