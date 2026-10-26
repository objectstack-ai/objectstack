// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The grid asks only for columns the SERVER has — cloud#1652.
 *
 * "+ add field" appends `field_<N>` to the object DRAFT. The grid's column
 * array is a fetch input, so that append used to reach the data API as
 * `select=…,field_11`, which the API refuses by design: dropping an unknown
 * projection key would silently answer a NARROWER projection with a WIDER one.
 * The refusal replaced the whole grid with 「该视图的查询被拒绝」 — on the most
 * ordinary edit in the pillar, and with a message telling the operator to clear
 * filters that were never there.
 *
 * Measured on a rig before writing this (the boundary the fix turns on): saving
 * the field as a DRAFT returns 200 with `state=draft`, and the very next
 * `select` naming it STILL answers 400. Materialisation happens at PUBLISH, so
 * "has it been saved" is the wrong question for a projection — "does the server
 * have it" is, and the baseline (`layered().effective`) is where that lives.
 *
 * The assertion is on the columns handed to the object view, because that array
 * IS the projection. Asserting on a spy over the fetch would pass just as well
 * if the array were fixed somewhere downstream — and then the next refactor
 * would move the bug back without reddening anything.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The object as the SERVER has it: two published, materialised fields. */
const publishedObject = {
  name: 'showcase_book',
  label: 'Book',
  fields: [
    { name: 'book_name', label: 'Title', type: 'text' },
    { name: 'author', label: 'Author', type: 'text' },
  ],
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_book', label: 'Book' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: publishedObject, code: publishedObject })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ ok: true })),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

/**
 * Capture the columns the pillar hands the object view — the projection itself.
 * Rendered as text so an assertion reads the real array, not a mock's memory.
 */
const seenColumns: string[][] = [];
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  return {
    ...mod,
    // The pillar imports this as `PluginObjectView`; the projection it renders
    // with is `schema.table.fields`.
    ObjectView: ({ schema }: { schema?: { table?: { fields?: string[] } } }) => {
      const authoring = useGridFieldAuthoring();
      const cols = schema?.table?.fields ?? [];
      seenColumns.push(cols);
      return (
        <>
          <div data-testid="grid-columns">{cols.join(',')}</div>
          {/* objectui#12511 — the grid's "+" column, drawn from its authoring context. */}
          {authoring?.onAddColumn && (
            <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
              Add column
            </button>
          )}
        </>
      );
    },
  };
});

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromGrid } from './__tests__/dataPillarAddField';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';

registerBuiltinInspectors();

afterEach(() => {
  seenColumns.length = 0;
  cleanup();
});

function renderPillar(packageId = 'com.example.showcase') {
  return render(
    <MemoryRouter initialEntries={[`/studio/${packageId}/data`]}>
      <SurfaceDeepLinkProvider>
        <DataPillar packageId={packageId} />
      </SurfaceDeepLinkProvider>
    </MemoryRouter>,
  );
}

const columnsNow = () => screen.getByTestId('grid-columns').textContent ?? '';

describe('DataPillar grid projection (cloud#1652)', () => {
  it('opens on the published fields', async () => {
    renderPillar();
    await waitFor(() => expect(columnsNow()).toContain('book_name'));
    expect(columnsNow()).toContain('author');
  });

  it('does NOT put a freshly added, unpublished field into the projection', async () => {
    renderPillar();
    await waitFor(() => expect(columnsNow()).toContain('book_name'));

    await addFieldFromGrid();

    // The draft grew a `field_<N>`; the projection must not have.
    await waitFor(() => expect(columnsNow()).toContain('book_name'));
    expect(columnsNow()).not.toMatch(/field_\d+/);

    // And not through any render along the way — a single frame that leaked the
    // phantom column is one 400 and one blanked grid.
    expect(seenColumns.some((cols) => cols.some((c) => /^field_\d+$/.test(c)))).toBe(false);
  });
});
