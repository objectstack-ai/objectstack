// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 (step 1 of objectui#6795's order) — the metadata editor
 * RECOVERS when a designer for its type is registered after it rendered.
 *
 * `MetadataResourceEditPage` reads all three designer registries for its type:
 * the canvas preview, the scoped inspector (with a selection) and the default
 * inspector (without one). While they were plain `Map`s read during render, a
 * late registration never reached an open editor (objectui#6795: "late
 * inspector rendered: false"). This test opens the editor on a type with no
 * designer, then registers each of the three inside `act` and requires each to
 * render — no remount, no navigation.
 *
 * It also pins the one EFFECT that reads the preview registry: a type with a
 * canvas opens in design mode (the auto-design effect). Its read now keys on
 * the observed preview, so a canvas registered late switches the open editor
 * into design mode exactly as a canvas registered before the first render
 * would have. The stub canvas prints the `editing` it is handed.
 *
 * Control: a registration for another type leaves the editor on its fallback.
 * The populated path is every other `ResourceEditPage.*` suite, which registers
 * at module scope or in `beforeEach` and so renders exactly as before.
 *
 * The type is a made-up `gizmo_11939`, so no built-in registration can reach it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const TYPE = 'gizmo_11939';
const doc = { name: 'g1', label: 'Gizmo one' };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string) => ({ effective: doc, code: doc, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: TYPE, name: TYPE, label: 'Gizmo', allowEnvironmentOverlay: true }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import {
  getMetadataPreview,
  registerMetadataPreview,
  type MetadataPreviewProps,
} from './preview-registry';
import {
  getMetadataInspector,
  registerMetadataInspector,
  type MetadataInspectorProps,
} from './inspector-registry';
import {
  getMetadataDefaultInspector,
  registerMetadataDefaultInspector,
  type MetadataDefaultInspectorProps,
} from './default-inspector-registry';

afterEach(cleanup);

/** The canvas registered late: prints the `editing` it is handed, and emits a selection. */
function LateCanvas(props: MetadataPreviewProps) {
  return (
    <div data-testid="late-canvas" data-editing={String(!!props.editing)}>
      <button type="button" onClick={() => props.onSelectionChange?.({ kind: 'block', id: 'b1' })}>
        pick block
      </button>
    </div>
  );
}
function LateDefaultInspector(props: MetadataDefaultInspectorProps) {
  return <div data-testid="late-default-inspector">{String(props.draft.label ?? '')}</div>;
}
function LateScopedInspector(props: MetadataInspectorProps) {
  return <div data-testid="late-scoped-inspector">{props.selection.id}</div>;
}
function UnrelatedCanvas() {
  return <div data-testid="unrelated-canvas" />;
}

describe('MetadataResourceEditPage — designers registered late reach the open editor (objectui#11939)', () => {
  it('canvas, design mode, default inspector and scoped inspector each arrive without a remount', async () => {
    expect(getMetadataPreview(TYPE)).toBeUndefined();
    expect(getMetadataInspector(TYPE)).toBeUndefined();
    expect(getMetadataDefaultInspector(TYPE)).toBeUndefined();

    render(
      <MemoryRouter initialEntries={[`/metadata/${TYPE}/g1`]}>
        <MetadataResourceEditPage type={TYPE} name="g1" />
      </MemoryRouter>,
    );
    // The editor has loaded: its "Loading TYPE/NAME…" placeholder is gone.
    await waitFor(() => expect(screen.queryByText(`Loading ${TYPE}/g1…`)).toBeNull());
    expect(mockClient.layered.mock.calls.some(([t, n]) => t === TYPE && n === 'g1')).toBe(true);
    // Before: no designer for this type, so no canvas (fallback before registration: true).
    expect(screen.queryByTestId('late-canvas')).toBeNull();

    // Control: another type's canvas changes nothing here.
    act(() => registerMetadataPreview('other_11939', UnrelatedCanvas));
    expect(screen.queryByTestId('late-canvas')).toBeNull();
    expect(screen.queryByTestId('unrelated-canvas')).toBeNull();

    // 1. The canvas arrives, and the auto-design effect re-reads it: the open
    //    editor enters design mode, as it would have with the canvas present
    //    from the start.
    act(() => registerMetadataPreview(TYPE, LateCanvas));
    const canvas = await screen.findByTestId('late-canvas');
    expect(canvas).toHaveAttribute('data-editing', 'true');

    // 2. The default inspector arrives in the rail (no selection yet).
    expect(screen.queryByTestId('late-default-inspector')).toBeNull();
    act(() => registerMetadataDefaultInspector(TYPE, LateDefaultInspector));
    expect(await screen.findByTestId('late-default-inspector')).toHaveTextContent('Gizmo one');

    // 3. With a selection and no scoped inspector the rail falls back; the
    //    scoped inspector registered late replaces that.
    fireEvent.click(screen.getByRole('button', { name: 'pick block' }));
    expect(screen.queryByTestId('late-default-inspector')).toBeNull();
    expect(screen.queryByTestId('late-scoped-inspector')).toBeNull();
    act(() => registerMetadataInspector(TYPE, LateScopedInspector));
    expect(await screen.findByTestId('late-scoped-inspector')).toHaveTextContent('b1');
  });
});
