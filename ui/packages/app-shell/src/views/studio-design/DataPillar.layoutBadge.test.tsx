// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 数据 → 表单 layout caption must not claim unsaved changes it does not have
 * — objectui#4036, B-half of the objectstack#5768 split ruling.
 *
 * Measured on a dogfood run: in the read-only package `com.example.showcase`
 * the form tab rendered
 *
 *   布局 · 预览 · 草稿布局 · 含未保存改动
 *
 * with `保存草稿` disabled and `[draggable=true]` count 0 — the interaction
 * gating was correct, the copy was not. The mechanism was not a stale diff:
 * the caption was chosen by `formMode === 'layout'` alone, a TAB selector, so
 * it asserted pending edits on EVERY clean layout tab, read-only or not. The
 * component's real `dirty` flag sat four lines below, driving the preview
 * warning.
 *
 * Hence the two halves this suite pins: the claim is suppressed where nothing
 * can be saved (the card's defect), AND it tracks real edit state where writes
 * are allowed (without which the first half could be satisfied by deleting the
 * claim outright, and the caption would go from always-lying to never-telling).
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { completeAddFieldPopover } from './__tests__/dataPillarAddField';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
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

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

afterEach(cleanup);

const CLAIM = /your unsaved changes/i;

// objectui#12451 — the caption moved from a sentence beside the Layout /
// Preview control into the Layout item's title, so it is read by title.

/** Render the pillar, land on the auto-selected object, open 表单 (Form). */
async function openFormTab(props: Partial<React.ComponentProps<typeof DataPillar>> = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" {...props} />
    </MemoryRouter>,
  );
  // First object auto-selects; the Form tab is the second segmented control.
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  // `formMode` defaults to 'layout', so the layout caption is on screen once
  // its sub-mode control is. (Not awaited on the caption text: a read-only
  // package has its own caption since objectui#11781.)
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

describe('DataPillar form tab — the layout caption tells the truth (#4036)', () => {
  it('read-only package: no unsaved-changes claim where nothing can be saved', async () => {
    await openFormTab({ readOnly: true });

    expect(screen.queryByTitle(CLAIM)).toBeNull();
    // Nor a draft caption at all: a read-only package has no draft layout, so
    // its caption says what it is (objectui#11781 — pinned by key, with its
    // writable control, in StudioDesignSurface.readOnlyWording-11781.test.tsx).
    expect(screen.queryByTitle('Draft layout', { exact: true })).toBeNull();
  });

  it('writable package, nothing edited yet: still no claim', async () => {
    await openFormTab();

    // The other half of the same defect — before the fix the caption was a
    // constant, so a clean writable draft lied in exactly the same way.
    expect(screen.queryByTitle(CLAIM)).toBeNull();
    expect(screen.getByTitle('Draft layout', { exact: true })).toBeInTheDocument();
  });

  it('writable package with real unsaved edits: the claim renders', async () => {
    await openFormTab();

    // "+ Add field" is an edit path — it sets the pillar's `dirty` flag. Two
    // buttons drive the same `addField` callback (the pillar toolbar's and the
    // form designer's own); either does. Since objectui#12516 it opens a
    // popover that asks for the label first.
    fireEvent.click(screen.getAllByRole('button', { name: /Add field/i })[0]);
    await completeAddFieldPopover();

    expect(await screen.findByTitle(CLAIM)).toBeInTheDocument();
  });

  it('CONTROL — gating is untouched: read-only offers no edit affordance', async () => {
    await openFormTab({ readOnly: true });

    // The B-half ruling keeps Studio's package-level read-only exactly as it
    // is; this PR changes captions, never gates. Neither the pillar toolbar's
    // nor the form designer's own add-field button may appear.
    expect(screen.queryAllByRole('button', { name: /Add field/i })).toHaveLength(0);
  });
});
