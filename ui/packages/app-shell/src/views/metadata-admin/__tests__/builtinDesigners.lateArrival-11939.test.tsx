// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 step 2 — a surface that rendered BEFORE the built-in
 * designers arrived shows its "designer missing" state, then the REAL built-in
 * designer once they land.
 *
 * The package entry registers the built-in previews and inspectors from a
 * chunk it loads with a dynamic `import()`. Between a reader's first render and
 * that chunk's arrival the registries are empty, so the gap is real on any
 * page that renders first. Step 1 made the readers observable and pinned each
 * one with a stub designer (`*.lateRegistration-11939.test.tsx`). This file
 * pins the arrival itself: nothing is stubbed in the registries, and what
 * lands is `registerBuiltinDesigners()` — the call the entry's `.then` makes.
 *
 * The surface is the Data pillar's field rail, the site objectui#6795 measured
 * as the silent failure ("Clicking a field does literally nothing"). Before:
 * the rail's missing-inspector sentence (objectui#7120). After: the real
 * `ObjectFieldInspector`, recognisable by its API-name control carrying the
 * field's name — no remount, no second click.
 *
 * `registerBuiltinDesigners` is imported at module scope, so the designers'
 * module graph loads in the import phase and the test's own window holds only
 * the call (AGENTS.md 测试纪律).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => {
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('../../studio-design/packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../studio-design/packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// objectui#8620: the records grid calls `find()` on this adapter, so it is an
// empty-backend `DataSource`, created once below the imports.
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from '../../studio-design/StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from '../../studio-design/__tests__/emptyDataSource';
import { getMetadataInspector, listMetadataInspectorTypes } from '../inspector-registry';
import { listMetadataPreviewTypes } from '../preview-registry';
import { registerBuiltinDesigners } from '../register-builtin-designers';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

afterEach(cleanup);

const MISSING =
  'No field inspector is registered in this session, so this field’s properties cannot be edited here.';

describe('Data pillar field rail — the built-in designers arrive after it rendered (objectui#11939 step 2)', () => {
  it('shows the missing-inspector sentence, then the real field inspector, with no remount', async () => {
    // Nothing registered yet: the state every reader is in until the chunk lands.
    expect(listMetadataPreviewTypes()).toEqual([]);
    expect(listMetadataInspectorTypes()).toEqual([]);

    render(
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    const card = (await screen.findByText('Title')).closest('.cursor-grab') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);

    const rail = await waitFor(() => {
      const el = document.querySelector('aside');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(rail).toHaveTextContent(MISSING);

    // The built-in designers land, as the package entry's `.then` lands them.
    act(() => registerBuiltinDesigners());
    expect(getMetadataInspector('object')).toBeTypeOf('function');

    // `ObjectFieldInspector`'s own API-name control, carrying the field's name.
    const railAfter = document.querySelector('aside') as HTMLElement;
    expect(await within(railAfter).findByDisplayValue('title')).toBeInTheDocument();
    expect(railAfter).toHaveTextContent('Field properties');
    expect(railAfter).not.toHaveTextContent(MISSING);
  });
});
