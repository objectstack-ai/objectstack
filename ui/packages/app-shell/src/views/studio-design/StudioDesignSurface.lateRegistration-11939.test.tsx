// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 (step 1 of objectui#6795's order) — the studio-design pillars
 * RECOVER when a designer is registered after they rendered.
 *
 * objectui#6795 measured the opposite on these same reads, while the
 * registries were plain `Map`s read during render with no subscription:
 *
 *     fallback before registration: true
 *     still fallback after registration: true
 *     late inspector rendered: false
 *
 * Each test below repeats that probe on a migrated read site and must read
 * "late … rendered: true": the pillar first shows today's fallback, a
 * registration lands inside `act`, and the registered designer renders — with
 * no remount, no navigation, no unrelated state change to force a re-read.
 *
 * Controls, in the same tests:
 *   - a registration for ANOTHER type leaves the fallback where it is (an
 *     unregistered type still shows today's fallback);
 *   - the empty-registry wording is pinned in
 *     `StudioDesignSurface.designerRegistryMissing.test.tsx`, and the populated
 *     path in the pillars' existing suites, which register at module scope and
 *     so render exactly as before.
 *
 * Order-independent by construction: the registries are module state shared by
 * every test in this file, so each test owns ONE type (Data → the `object`
 * inspector, Interfaces → the `page` preview, Automations → the `flow`
 * preview), asserts that type unregistered first, and registers nothing another
 * test reads.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const NAV = [{ id: 'nav_page', type: 'page', label: 'Home', pageName: 'home_page' }];

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    if (type === 'flow') return [{ name: 'nightly', label: 'Nightly' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: objectDef, code: objectDef };
    if (type === 'page') return { effective: { name: 'home_page', label: 'Home' } };
    if (type === 'flow') return { effective: { name: 'nightly', label: 'Nightly', steps: [] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// objectui#8620: the records grid calls `find()` on this adapter, so it is an
// empty-backend `DataSource`, created once below the imports.
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { AutomationsPillar, DataPillar, InterfacesPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { getMetadataPreview, registerMetadataPreview } from '../metadata-admin/preview-registry';
import { getMetadataInspector, registerMetadataInspector } from '../metadata-admin/inspector-registry';
import type { MetadataInspectorProps } from '../metadata-admin/inspector-registry';
import type { MetadataPreviewProps } from '../metadata-admin/preview-registry';
import { getStudioCanvasPreview } from './studio-canvas-preview';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

/* The Automations pillar reads `GET /api/v1/automation/_status` from a mount
 * effect with a bare global `fetch`. Same recording double as
 * `StudioDesignSurface.designerRegistryMissing.test.tsx`: an empty roster for
 * that route, and any other URL fails the test in `afterEach`. */
const AUTOMATION_STATUS_ROUTE = '/api/v1/automation/_status';
let statusCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  statusCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      statusCalls.push(url);
      if (routeOf(url) !== AUTOMATION_STATUS_ROUTE) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: { flows: [] } }) };
    }),
  );
});

afterEach(() => {
  expect(statusCalls.filter((url) => routeOf(url) !== AUTOMATION_STATUS_ROUTE)).toEqual([]);
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

/** The designers registered late. Each renders a test id and nothing else. */
function LateObjectInspector(props: MetadataInspectorProps) {
  return <div data-testid="late-object-inspector">{props.selection.id}</div>;
}
function UnrelatedInspector() {
  return <div data-testid="unrelated-inspector" />;
}
function LatePagePreview(props: MetadataPreviewProps) {
  return <div data-testid="late-page-preview">{props.name}</div>;
}
function UnrelatedPreview() {
  return <div data-testid="unrelated-preview" />;
}
function LateFlowPreview(props: MetadataPreviewProps) {
  return <div data-testid="late-flow-preview">{props.name}</div>;
}

/** `studio-canvas-preview` registers `object` at module scope: a control that MUST hit. */
function assertModuleGraphLoaded(): void {
  expect(getStudioCanvasPreview('object')).toBeTypeOf('function');
}

describe('Data pillar field rail — a late object inspector fills the open rail (objectui#11939)', () => {
  it('late inspector rendered: true — and an unrelated registration leaves the fallback', async () => {
    assertModuleGraphLoaded();
    expect(getMetadataInspector('object')).toBeUndefined();

    render(
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    const card = (await screen.findByText('Title')).closest('.cursor-grab') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);

    // Before: today's fallback (fallback before registration: true).
    const rail = await waitFor(() => {
      const el = document.querySelector('aside');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const MISSING =
      'No field inspector is registered in this session, so this field’s properties cannot be edited here.';
    expect(rail).toHaveTextContent(MISSING);

    // Control: a registration for another type changes nothing here.
    act(() => registerMetadataInspector('report', UnrelatedInspector));
    expect(rail).toHaveTextContent(MISSING);
    expect(screen.queryByTestId('unrelated-inspector')).toBeNull();

    // The probe: the object inspector arrives after the rail rendered.
    act(() => registerMetadataInspector('object', LateObjectInspector));
    const late = await screen.findByTestId('late-object-inspector');
    expect(late).toHaveTextContent('title');
    expect(document.querySelector('aside')).not.toHaveTextContent(MISSING);
  });
});

describe('Interfaces pillar canvas — a late page preview replaces the fallback (objectui#11939)', () => {
  it('late preview rendered: true', async () => {
    assertModuleGraphLoaded();
    expect(getMetadataPreview('page')).toBeUndefined();

    render(
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTitle('page · home_page'));
    await waitFor(() => expect(screen.getByTestId('canvas-mode-toggle')).toBeInTheDocument(), {
      timeout: 4000,
    });

    // Before: today's fallback. Which of its two sentences shows depends on
    // whether ANY designer is registered (objectui#6795 part C), and that is
    // shared module state here — both end in the same clause.
    const FALLBACK = /cannot be previewed or designed here\.$/;
    expect(await screen.findAllByText(FALLBACK)).not.toHaveLength(0);
    expect(screen.queryByTestId('late-page-preview')).toBeNull();

    // Control: another type's preview changes nothing on this leaf.
    act(() => registerMetadataPreview('report', UnrelatedPreview));
    expect(screen.queryByTestId('unrelated-preview')).toBeNull();
    expect(screen.queryAllByText(FALLBACK)).not.toHaveLength(0);

    act(() => registerMetadataPreview('page', LatePagePreview));
    expect(await screen.findByTestId('late-page-preview')).toHaveTextContent('home_page');
    expect(screen.queryAllByText(FALLBACK)).toHaveLength(0);
  });
});

describe('Automations pillar canvas — a late flow preview replaces the fallback (objectui#11939)', () => {
  it('late preview rendered: true, and the header chip stops saying there is no designer', async () => {
    assertModuleGraphLoaded();
    expect(getMetadataPreview('flow')).toBeUndefined();

    render(
      <MemoryRouter initialEntries={['/studio/com.acme.app/automations']}>
        <AutomationsPillar packageId="com.acme.app" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Nightly/ }));

    const NO_DESIGNER =
      'No metadata designers are registered in this session, so this flow cannot be designed here.';
    // Before: the header chip names the missing designer (it keys on the flow
    // preview alone, so it shows whatever else this file registered).
    await screen.findAllByText(NO_DESIGNER, undefined, { timeout: 4000 });
    expect(screen.queryByTestId('late-flow-preview')).toBeNull();

    act(() => registerMetadataPreview('flow', LateFlowPreview));
    expect(await screen.findByTestId('late-flow-preview')).toHaveTextContent('nightly');
    expect(screen.getByText('Visual orchestration · click a node to configure')).toBeInTheDocument();
    expect(screen.queryAllByText(NO_DESIGNER)).toHaveLength(0);
  });
});
