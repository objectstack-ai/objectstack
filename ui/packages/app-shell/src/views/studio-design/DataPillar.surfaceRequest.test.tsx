// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar applies a LIVE surface request — objectui#5476.
 *
 * Studio's pre-publish security block names `object/crmext_visit` from a sheet
 * opened over this pillar while it is already mounted, so the `?surface=`
 * capture (read once, at mount) can never serve it. The pillar subscribes to
 * the channel instead, and this suite drives that end to end through the
 * pillar's OWN mirror: the surface param the pillar writes back is the
 * observable proof that its selection actually moved, not a spy on the wiring.
 *
 * The second test is the more important one. The request is applied AT MOST
 * ONCE by construction, because a standing request re-resolved on the next
 * rail reload would drag the author off whatever they had since chosen — the
 * exact regression the mount-time ref was introduced to prevent.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';

const objectDef = {
  name: 'showcase_project',
  label: 'Project',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const mockClient = {
  list: vi.fn(async () => [
    { name: 'showcase_project', label: 'Project' },
    { name: 'crmext_visit', label: 'Visit' },
  ]),
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
import { SurfaceDeepLinkProvider, useSurfaceNavigator } from './surfaceDeepLinkChannel';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerBuiltinInspectors();

afterEach(cleanup);

/** What the pillar mirrored back to the URL — i.e. what it currently has open. */
function OpenSurface(): React.ReactElement {
  const [params] = useSearchParams();
  return <span data-testid="open-surface">{params.get('surface') ?? 'none'}</span>;
}

/** Stands in for the pending-changes sheet's security block. */
function Producer(): React.ReactElement {
  const openSurface = useSurfaceNavigator();
  return (
    <button type="button" onClick={() => openSurface?.({ type: 'object', name: 'crmext_visit' })}>
      object/crmext_visit
    </button>
  );
}

function renderPillar(packageId = 'com.example.showcase') {
  return render(
    <MemoryRouter initialEntries={[`/studio/${packageId}/data`]}>
      <SurfaceDeepLinkProvider>
        <OpenSurface />
        <Producer />
        <DataPillar packageId={packageId} />
      </SurfaceDeepLinkProvider>
    </MemoryRouter>,
  );
}

const openSurface = () => screen.getByTestId('open-surface');

describe('DataPillar — a surface requested after mount (objectui#5476)', () => {
  it('opens the object the request names, with no remount and no URL to capture', async () => {
    renderPillar();
    // Nothing deep-linked: the rail opens its first item, as it always has.
    await waitFor(() => expect(openSurface()).toHaveTextContent('object:showcase_project'));

    fireEvent.click(screen.getByRole('button', { name: 'object/crmext_visit' }));

    await waitFor(() => expect(openSurface()).toHaveTextContent('object:crmext_visit'));
  });

  it('never re-applies it: a later selection survives the next rail reload', async () => {
    const { rerender } = renderPillar();
    await waitFor(() => expect(openSurface()).toHaveTextContent('object:showcase_project'));
    fireEvent.click(screen.getByRole('button', { name: 'object/crmext_visit' }));
    await waitFor(() => expect(openSurface()).toHaveTextContent('object:crmext_visit'));

    // The author moves on, by hand, in the rail.
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    await waitFor(() => expect(openSurface()).toHaveTextContent('object:showcase_project'));

    // Now the rail reloads (here: a package switch — same list, fresh array).
    // A request that is still standing would yank them back to the object the
    // sheet named, minutes after they left it.
    const loadsBefore = mockClient.list.mock.calls.length;
    rerender(
      <MemoryRouter initialEntries={['/studio/com.example.other/data']}>
        <SurfaceDeepLinkProvider>
          <OpenSurface />
          <Producer />
          <DataPillar packageId="com.example.other" />
        </SurfaceDeepLinkProvider>
      </MemoryRouter>,
    );
    // The reload has to have actually HAPPENED for the rest to mean anything:
    // an assertion that nothing moved is satisfied perfectly by nothing
    // running at all.
    await waitFor(() => expect(mockClient.list.mock.calls.length).toBeGreaterThan(loadsBefore));
    await new Promise((r) => setTimeout(r, 50));
    expect(openSurface()).toHaveTextContent('object:showcase_project');
  });
});
