// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 (step 1 of objectui#6795's order) — the three object panels
 * RECOVER when their default inspector is registered after they rendered.
 *
 * Each panel reads one entry of the default-inspector registry during render:
 * Settings → `object`, Actions → `action`, Hooks → `hook`. While that registry
 * was a plain `Map` read with no subscription, a late registration never
 * reached the panel (objectui#6795: "late inspector rendered: false"). Each
 * test shows today's fallback, registers inside `act`, and requires the late
 * inspector to render — no remount, no prop change.
 *
 * Control in each test: a registration for another type leaves the fallback in
 * place. The empty-registry wording itself is pinned by the panels'
 * `designerRegistryMissing` suites; the populated path by
 * `DataPillar.designerRegistryPopulated.test.tsx`.
 *
 * Order-independent: each test owns ONE type, asserts it unregistered first,
 * and registers nothing another test here reads (the control type is `report`,
 * which none of the three panels reads).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';

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

import { ObjectSettingsPanel } from './ObjectSettingsPanel';
import { ObjectActionsPanel } from './ObjectActionsPanel';
import { ObjectHooksPanel } from './ObjectHooksPanel';
import {
  getMetadataDefaultInspector,
  registerMetadataDefaultInspector,
  type MetadataDefaultInspectorProps,
} from '../metadata-admin/default-inspector-registry';
import { getStudioCanvasPreview } from './studio-canvas-preview';

afterEach(cleanup);

function LateInspector(props: MetadataDefaultInspectorProps) {
  return <div data-testid={`late-${props.type}-inspector`}>{String(props.draft.name ?? '')}</div>;
}
function UnrelatedInspector() {
  return <div data-testid="unrelated-inspector" />;
}

/** `studio-canvas-preview` registers `object` at module scope: a control that MUST hit. */
function assertModuleGraphLoaded(): void {
  expect(getStudioCanvasPreview('object')).toBeTypeOf('function');
}

describe('ObjectSettingsPanel — a late object inspector replaces the note (objectui#11939)', () => {
  it('late inspector rendered: true', () => {
    assertModuleGraphLoaded();
    expect(getMetadataDefaultInspector('object')).toBeUndefined();
    const draft = { name: 'showcase_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } };
    const NO_INSPECTOR = 'No default object inspector registered.';

    render(<ObjectSettingsPanel name="showcase_task" draft={draft} onPatch={() => {}} locale="en-US" />);
    expect(screen.getByText(NO_INSPECTOR)).toBeInTheDocument();

    act(() => registerMetadataDefaultInspector('report', UnrelatedInspector));
    expect(screen.getByText(NO_INSPECTOR)).toBeInTheDocument();
    expect(screen.queryByTestId('unrelated-inspector')).toBeNull();

    act(() => registerMetadataDefaultInspector('object', LateInspector));
    const basics = screen.getByText('Basics').closest('section') as HTMLElement;
    expect(within(basics).getByTestId('late-object-inspector')).toHaveTextContent('showcase_task');
    expect(screen.queryByText(NO_INSPECTOR)).toBeNull();
  });
});

describe('ObjectActionsPanel — a late action inspector replaces the "no editor" pane (objectui#11939)', () => {
  it('late inspector rendered: true', async () => {
    assertModuleGraphLoaded();
    expect(getMetadataDefaultInspector('action')).toBeUndefined();
    const draft = {
      name: 'showcase_task',
      label: 'Task',
      actions: [{ name: 'send_email', label: 'Send Email', type: 'quick' }],
    };
    const NO_EDITOR =
      'No action editor is registered in this session, so this action’s properties cannot be edited here.';

    render(<ObjectActionsPanel draft={draft as Record<string, unknown>} onPatch={() => {}} />);
    await screen.findByText(NO_EDITOR);

    act(() => registerMetadataDefaultInspector('report', UnrelatedInspector));
    expect(screen.getByText(NO_EDITOR)).toBeInTheDocument();

    act(() => registerMetadataDefaultInspector('action', LateInspector));
    // The inspector is handed the SELECTED action, not the object.
    expect(await screen.findByTestId('late-action-inspector')).toHaveTextContent('send_email');
    expect(screen.queryByText(NO_EDITOR)).toBeNull();
  });
});

describe('ObjectHooksPanel — a late hook inspector replaces the generic form (objectui#11939)', () => {
  it('late inspector rendered: true', async () => {
    assertModuleGraphLoaded();
    expect(getMetadataDefaultInspector('hook')).toBeUndefined();

    render(<ObjectHooksPanel objectName="showcase_task" packageId="com.example.showcase" />);
    fireEvent.click(await screen.findByText('Guard'));
    // Before: the generic SchemaForm, recognisable by its synthesised controls.
    expect(await screen.findByLabelText('Handler')).toHaveValue('guard_fn');

    act(() => registerMetadataDefaultInspector('report', UnrelatedInspector));
    expect(screen.getByLabelText('Handler')).toHaveValue('guard_fn');
    expect(screen.queryByTestId('late-hook-inspector')).toBeNull();

    act(() => registerMetadataDefaultInspector('hook', LateInspector));
    expect(await screen.findByTestId('late-hook-inspector')).toHaveTextContent('guard_hook');
    expect(screen.queryByLabelText('Handler')).toBeNull();
  });
});
