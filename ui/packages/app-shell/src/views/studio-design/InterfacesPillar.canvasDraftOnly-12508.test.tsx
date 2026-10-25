// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12508 — the Interfaces canvas does not mount the runtime records
 * grid for an object that has only a draft.
 *
 * Measured on the card's session (HotCRM, a writable package): New object
 * (saved as a draft), Create app, and the canvas of the object's entry sent
 * `GET /api/v1/meta/object/st_ticket` → 404, logged
 * `[useSettledSchema] getObjectSchema failed … MetadataNotFoundError` twice,
 * and showed "Error loading grid". The default object canvas renders
 * `object-view`, whose `ObjectView` asks the object's schema on mount; its
 * records read (`/data/st_ticket`) answers 404 `OBJECT_NOT_FOUND` too. Preview
 * = runtime, and a draft-only object has no runtime yet.
 *
 * The pillar already reads the package's published objects and drafts
 * (stamped with the `publishNonce` the read ran under). It hands the canvas
 * those names through `StudioCanvasDraftOnlyObjectsContext`; the default
 * canvas shows an empty state for a draft-only object.
 *
 * The REAL `InterfacesPillar` and the REAL default canvas. `object-view` is a
 * recorder registered in the component registry: its mount stands for
 * `ObjectView`'s schema read, so "no mount" is "no `/meta/object` request".
 *
 * Pinned:
 *  - a draft-only object: the empty state, and no `object-view` mount;
 *  - CONTROL: a published object mounts `object-view`, as before;
 *  - a publish (`publishNonce` bumped): the answer read under the earlier
 *    publish is not used, so the just-published object is never shown as
 *    unpublished, and the grid mounts once the re-read answers, no reload.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';

const PKG = 'com.default.studio-test';
const DRAFT_ONLY = 'st_ticket';
const PUBLISHED = 'st_case';

const NAV = [
  { id: 'nav_ticket', type: 'object', label: 'Tickets', objectName: DRAFT_ONLY },
  { id: 'nav_case', type: 'object', label: 'Cases', objectName: PUBLISHED },
];

const defOf = (name: string) => ({ name, label: name, fields: { title: { name: 'title', type: 'text' } } });

const state = {
  published: [PUBLISHED] as string[],
  /** Set to hold the package's published-objects read until released. */
  holdObjectList: null as Promise<void> | null,
};

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'tickets', label: 'Tickets' }];
    if (type === 'object') {
      if (state.holdObjectList) await state.holdObjectList;
      return state.published.map((name) => ({ name, label: name }));
    }
    return [];
  }),
  listDrafts: vi.fn(async (opts?: { type?: string }) =>
    opts?.type === 'object' && !state.published.includes(DRAFT_ONLY) ? [{ name: DRAFT_ONLY, label: 'Ticket' }] : [],
  ),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'tickets', label: 'Tickets', navigation: NAV } };
    if (type === 'object' && state.published.includes(name)) return { effective: defOf(name), code: defOf(name) };
    return { effective: null, code: null };
  }),
  getDraft: vi.fn(async (type: string, name: string) =>
    type === 'object' && name === DRAFT_ONLY && !state.published.includes(DRAFT_ONLY) ? defOf(DRAFT_ONLY) : null,
  ),
  get: vi.fn(async () => undefined),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';

/** Every `object-view` the canvas mounted, by object: each is one `/meta/object/NAME` read in the running app. */
const objectViewMounts: string[] = [];
function ObjectViewRecorder({ schema }: { schema: { objectName?: string } }) {
  React.useEffect(() => {
    objectViewMounts.push(String(schema.objectName));
  }, [schema.objectName]);
  return <div data-testid="object-view-recorder" data-object={schema.objectName} />;
}

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  objectViewMounts.length = 0;
  state.published = [PUBLISHED];
  state.holdObjectList = null;
});

afterEach(cleanup);

function pillar(publishNonce: number) {
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} publishNonce={publishNonce} />
    </MemoryRouter>
  );
}

async function openLeaf(name: string) {
  fireEvent.click(await screen.findByTitle(`object · ${name}`));
}

describe('InterfacesPillar canvas — a draft-only object has no runtime to preview (objectui#12508)', () => {
  it('a draft-only object shows the not-published empty state and mounts no object-view', async () => {
    render(pillar(0));
    await openLeaf(DRAFT_ONLY);
    expect(await screen.findByTestId('studio-canvas-object-unpublished')).toHaveTextContent(
      'This object is not published yet',
    );
    expect(screen.queryByTestId('object-view-recorder')).toBeNull();
    expect(objectViewMounts).toEqual([]);
  });

  it('CONTROL: a published object mounts the runtime object-view, as before', async () => {
    render(pillar(0));
    await openLeaf(PUBLISHED);
    expect(await screen.findByTestId('object-view-recorder')).toHaveAttribute('data-object', PUBLISHED);
    expect(objectViewMounts).toEqual([PUBLISHED]);
    expect(screen.queryByTestId('studio-canvas-object-unpublished')).toBeNull();
  });

  it('after a publish, the answer read before it does not hide the object: the grid mounts once the re-read answers, no reload', async () => {
    const { rerender } = render(pillar(0));
    await openLeaf(DRAFT_ONLY);
    await screen.findByTestId('studio-canvas-object-unpublished');
    expect(objectViewMounts).toEqual([]);

    // The publish makes the draft live; the pillar's re-read is held, so the
    // only answer the pillar has is the one read under publish 0.
    let release!: () => void;
    state.holdObjectList = new Promise<void>((r) => {
      release = r;
    });
    state.published = [PUBLISHED, DRAFT_ONLY];
    rerender(pillar(1));

    expect(await screen.findByTestId('studio-canvas-object-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-canvas-object-unpublished')).toBeNull();

    await act(async () => {
      release();
    });
    expect(await screen.findByTestId('object-view-recorder')).toHaveAttribute('data-object', DRAFT_ONLY);
    expect(screen.queryByTestId('studio-canvas-object-unpublished')).toBeNull();
    expect(objectViewMounts).toEqual([DRAFT_ONLY]);
  });
});
