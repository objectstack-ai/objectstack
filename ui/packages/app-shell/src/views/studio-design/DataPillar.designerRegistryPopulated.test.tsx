// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6846 — the Data pillar's four registry consumers on a POPULATED
 * registry: the contrast half of the empty-registry pins.
 *
 * ## The wrong fix this file exists to catch
 *
 * The empty-state repairs (#7120) and pins (#7120 + this card) all say what
 * a consumer must show when its registry read returns `undefined`. The
 * plausible wrong fix on that axis is an empty-state branch that fires
 * whenever the lookup is falsy in some wider sense — a guard inverted, a
 * `!!` dropped, a branch reordered — so that "the empty case now speaks"
 * while every populated screen goes blank or shows the notice. None of the
 * empty-registry files can see that: their registries are empty by
 * construction. So this file registers the builtin inspectors FIRST, proves
 * they are there, and pins that with them present:
 *
 *   - a field click opens the REAL `ObjectFieldInspector`;
 *   - Actions mounts the REAL `ActionDefaultInspector`;
 *   - Hooks mounts the curated `HookDefaultInspector`, not the generic form;
 *   - Settings mounts the REAL `ObjectDefaultInspector`;
 *
 * and that none of the empty-state sentences appears anywhere on screen.
 * Each case asserts a control only the real editor renders BEFORE it asserts
 * the notice's absence, so a blank screen reds on the positive, not on an
 * absence that a blank screen would satisfy.
 *
 * The fifth consumer, the Interfaces canvas, has its populated contrast in
 * {@link file://./StudioDesignSurface.designerRegistryPartial.test.tsx}.
 *
 * ## Why a separate file
 *
 * The registries are plain `Map`s — module state shared by every test in a
 * file. Splitting empty from populated is what lets each file assert its own
 * precondition instead of depending on test order. Same convention as the
 * `designerRegistryMissing` / `designerRegistryPartial` pair.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  actions: [{ name: 'send_email', label: 'Send Email', type: 'quick' }],
};

const hook = {
  name: 'guard_hook',
  label: 'Guard',
  object: 'showcase_task',
  events: ['beforeInsert'],
  handler: 'guard_fn',
};

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => {
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    if (type === 'hook') return [hook];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
  // The curated hook editor resolves the bound object's field catalog through
  // `useObjectFields` -> `client.withPreviewDrafts(true).get`.
  get: vi.fn(async () => null),
  withPreviewDrafts() { return this; },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// objectui#5813 — the advanced tabs live in a Radix DropdownMenu; this file
// measures which editor mounts, not radix's open/close machinery, so the menu
// renders as plain passthroughs (same convention as DataPillar.panelGate).
type Passthrough = { children?: React.ReactNode };
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...mod,
    DropdownMenu: (p: Passthrough) => <div>{p.children}</div>,
    DropdownMenuTrigger: (p: Passthrough) => <div>{p.children}</div>,
    DropdownMenuContent: (p: Passthrough) => <div>{p.children}</div>,
    DropdownMenuItem: (p: Passthrough & { onSelect?: () => void }) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
    // objectui#11794 — the Advanced items are radio items (the menu checks the open panel).
    DropdownMenuRadioGroup: (p: Passthrough) => <div>{p.children}</div>,
    DropdownMenuRadioItem: (p: Passthrough & { onSelect?: () => void }) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
  };
});

// objectui#8620: the records grid calls `find()` on this adapter. `{}` had no
// `find()`, so `ListView`'s fetch threw and its `catch` swallowed the error.
// `dataSource` is an empty-backend `DataSource`, created once below the imports
// so every render gets the same object.
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { listMetadataInspectorTypes, getMetadataInspector } from '../metadata-admin/inspector-registry';
import { getMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The populated precondition — registered here, proved in every test below.
registerBuiltinInspectors();

/** The four empty-state sentences the Data pillar's consumers can show. */
const EMPTY_STATE_SENTENCES = [
  'No field inspector is registered in this session, so this field’s properties cannot be edited here.',
  'No action editor is registered in this session, so this action’s properties cannot be edited here.',
  'No default object inspector registered.',
  'No metadata designers are registered in this session',
];

afterEach(cleanup);

/**
 * Assert the registries really are populated — stated, not assumed, so an
 * assertion below cannot pass for the wrong reason (a builtin that silently
 * stopped registering would otherwise turn every case here into an
 * empty-registry case that happens to render).
 */
function assertRegistriesPopulated(): void {
  expect(listMetadataInspectorTypes()).toContain('object');
  expect(getMetadataInspector('object')).toBeTypeOf('function');
  expect(getMetadataDefaultInspector('object')).toBeTypeOf('function');
  expect(getMetadataDefaultInspector('action')).toBeTypeOf('function');
  expect(getMetadataDefaultInspector('hook')).toBeTypeOf('function');
}

function expectNoEmptyStateSentence(): void {
  const text = document.body.textContent ?? '';
  for (const sentence of EMPTY_STATE_SENTENCES) expect(text).not.toContain(sentence);
}

function renderPillar() {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
}

describe('Data pillar consumers with the registries POPULATED (#6846 contrast)', () => {
  it('a field click opens the real field inspector, not the missing-inspector notice', async () => {
    assertRegistriesPopulated();
    renderPillar();

    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    const card = (await screen.findByText('Title')).closest('.cursor-grab') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);

    const rail = await waitFor(() => {
      const el = document.querySelector('aside');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(rail).toHaveTextContent('Field properties');
    // `ObjectFieldInspector`'s own API-name control, carrying the field's name.
    expect(await within(rail).findByDisplayValue('title')).toBeInTheDocument();
    expectNoEmptyStateSentence();
  });

  it('Actions mounts the real action editor, not the missing-editor notice', async () => {
    assertRegistriesPopulated();
    renderPillar();

    // objectui#12450 — the flat tab; the passthrough menu draws the folded
    // entry as a second button of the same name.
    fireEvent.click(await screen.findByTestId('data-tab-flat-actions'));
    // `ActionDefaultInspector`'s Name control, carrying the action's identifier.
    expect(await screen.findByDisplayValue('send_email')).toBeInTheDocument();
    expectNoEmptyStateSentence();
  });

  it('Hooks mounts the curated hook editor, not the generic form', async () => {
    assertRegistriesPopulated();
    renderPillar();

    // objectui#12450 — the flat tab; the passthrough menu draws the folded
    // entry as a second button of the same name.
    fireEvent.click(await screen.findByTestId('data-tab-flat-hooks'));
    fireEvent.click(await screen.findByText('Guard'));
    // Controls only `HookDefaultInspector` renders…
    expect(await screen.findByTestId('hook-name')).toBeInTheDocument();
    expect(screen.getByTestId('hook-body-source')).toBeInTheDocument();
    // …and none the generic `SchemaForm` would have synthesised from the
    // hook's keys (the empty-registry pin asserts this one is PRESENT).
    expect(screen.queryByLabelText('Handler')).toBeNull();
    expectNoEmptyStateSentence();
  });

  it('Settings mounts the real object inspector, not the missing-inspector notice', async () => {
    assertRegistriesPopulated();
    renderPillar();

    // objectui#12450 — the flat tab; the passthrough menu draws the folded
    // entry as a second button of the same name.
    fireEvent.click(await screen.findByTestId('data-tab-flat-settings'));
    // `ObjectDefaultInspector`'s Name control, carrying the object's name.
    expect(await screen.findByTestId('object-name-input')).toHaveValue('showcase_task');
    expect(screen.getByTestId('object-access-posture')).toBeInTheDocument();
    expectNoEmptyStateSentence();
  });
});
