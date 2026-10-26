// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6846 — the Hooks panel on an EMPTY default-inspector registry.
 *
 * The second of the two consumers #7120 (#6795 part C) measured as already
 * honest and deliberately left unpinned: with `getMetadataDefaultInspector('hook')`
 * undefined the panel falls back to the generic `SchemaForm`, which synthesises
 * a control per top-level key of the selected hook. That is a working editor,
 * not an empty state — so the pin has to prove it WORKS, not merely that
 * something rendered: an edit in the generic form dirties the panel, and the
 * panel's autosave (objectui#11787) writes the edited value through.
 *
 * "Something rendered" would pass on the hook's bare label — exactly the shape
 * of the `ObjectActionsPanel` defect the card repaired — which is why the
 * assertions below name the generic form's controls and drive one of them.
 *
 * The populated contrast, where the curated `HookDefaultInspector` mounts and
 * the generic form must NOT, is
 * {@link file://./DataPillar.designerRegistryPopulated.test.tsx}.
 *
 * ⚠️ This file must never register a designer — its subject is the empty
 * branch, and the registries are module state shared by every test in a file.
 * Emptiness is asserted FIRST, with a control that must hit.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const hook = {
  name: 'guard_hook',
  label: 'Guard',
  object: 'showcase_task',
  events: ['beforeInsert'],
  handler: 'guard_fn',
};

const mockClient = {
  list: vi.fn(async () => [hook]),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { ObjectHooksPanel } from './ObjectHooksPanel';
import { listMetadataPreviewTypes } from '../metadata-admin/preview-registry';
import { listMetadataInspectorTypes } from '../metadata-admin/inspector-registry';
import { getMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { getStudioCanvasPreview } from './studio-canvas-preview';

afterEach(() => {
  cleanup();
  mockClient.save.mockClear();
});

/** Same shape as the sibling pins: a control that MUST hit, then the zeros. */
function assertRegistriesEmptyWithControl(): void {
  expect(getStudioCanvasPreview('object')).toBeTypeOf('function'); // control — MUST hit
  expect(listMetadataPreviewTypes()).toEqual([]);
  expect(listMetadataInspectorTypes()).toEqual([]);
  expect(getMetadataDefaultInspector('hook')).toBeUndefined();
  expect(getMetadataDefaultInspector('object')).toBeUndefined();
  expect(getMetadataDefaultInspector('action')).toBeUndefined();
}

describe('ObjectHooksPanel — no curated hook editor registered (#6846)', () => {
  it('falls back to the generic SchemaForm, and that form edits and saves the hook', async () => {
    assertRegistriesEmptyWithControl();

    render(<ObjectHooksPanel objectName="showcase_task" packageId="com.example.showcase" />);
    fireEvent.click(await screen.findByText('Guard'));

    // The generic form: one labelled control per top-level key of the hook,
    // carrying the hook's own values. These labels are synthesised from the
    // keys, which is what makes them the generic form's signature.
    const handler = await screen.findByLabelText('Handler');
    expect(handler).toHaveValue('guard_fn');
    expect(screen.getByLabelText('Name')).toHaveValue('guard_hook');
    // The curated editor is NOT what rendered — its controls carry test ids
    // the generic form never produces.
    expect(screen.queryByTestId('hook-name')).toBeNull();
    // Nothing on screen promises recovery, and nothing calls this an empty
    // state — it is an editor.
    expect(document.body.textContent ?? '').not.toMatch(/loading|try again/i);

    // "Working": an edit in the generic form dirties the panel, and its
    // autosave (objectui#11787 — no Save button) writes the edited value
    // through, as a draft of THIS hook, after the shared autosave's pause.
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();
    expect(mockClient.save).not.toHaveBeenCalled();
    fireEvent.change(handler, { target: { value: 'guard_fn_v2' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(mockClient.save).toHaveBeenCalledWith(
      'hook',
      'guard_hook',
      expect.objectContaining({ handler: 'guard_fn_v2' }),
      // objectui#11773 — no draft of this hook was pending at the load: its
      // first save is the first-write pin.
      { mode: 'draft', packageId: 'com.example.showcase', ifNoneMatch: '*', surface: 'studio' },
    );
  });
});
