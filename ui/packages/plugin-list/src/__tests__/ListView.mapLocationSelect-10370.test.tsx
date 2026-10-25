/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10370 — a map list view projects the fields its markers are drawn
 * from.
 *
 * `ListView`'s `$select` builder adds each view kind's per-row bindings
 * (kanban, calendar, gallery, timeline, gantt) through `collectViewFields`,
 * FLS-gated by `addSpeculative`. It had no `map` arm, and its candidate keys
 * named none of the map's bindings. A map view whose authored columns omit the
 * location field therefore sent `$select: ['id', ...columns]`, and on a backend
 * that honours `$select` every row arrived without coordinates: `ObjectMap`
 * draws from the host rows, so no marker could be placed.
 *
 * WHICH SPELLINGS — exactly the ones the map actually reads. The render branch
 * and the switcher's capability gate both take the map config from
 * `resolveListMapConfig`: the spec's view-level `map` block merged per key over
 * the producer's `options.map` bag. The projection now asks that same resolver,
 * so it requests what the markers are drawn from and nothing the renderer never
 * sees: a key shadowed by the view-level block is not requested, and a
 * top-level `locationField` — which the spec's list view refuses by name and
 * which no map branch reads — is not a binding at all.
 *
 * WHICH KEYS — the ones `ObjectMap` reads off a row: `locationField`, or the
 * `latitudeField` + `longitudeField` pair (`extractCoordinates`), the marker
 * title (`titleField`, already a candidate) and the marker description
 * (`descriptionField`).
 *
 * THE GATE — every one of them goes through `addSpeculative`, so a location
 * field the principal may not read is never requested, and a name the object
 * does not declare is never sent.
 *
 * The `$expand` twin collects the same bindings but one: a coordinate or title
 * binding that names a LOOKUP is resolved, the row shape `ObjectMap`'s own
 * fetch and a column-less `ListView` (both expand every declared relation)
 * already deliver. The DESCRIPTION is projected but never expanded: `ObjectMap`
 * renders it as a React child, so an expanded lookup there (an object) throws
 * when the marker is clicked, where a bare id renders as text. Expanding it
 * here would add a route to that crash.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * Same stub shape as `ListView.allDeniedSelect-10275.test.tsx`: swapped by
 * IDENTITY, because the fetch effect names `perms` in its dependency list.
 */
const { holder, makePerms } = vi.hoisted(() => {
  const makePerms = (isLoaded: boolean, denied: string[]) => ({
    isLoaded,
    checkField: (_object: string, field: string, action: string) =>
      action === 'read' ? !denied.includes(field) : true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  });
  return { holder: { current: makePerms(true, []) }, makePerms };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => holder.current as any };
});

import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'field_site';

const objectDef = {
  name: OBJECT,
  label: 'Site',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    geo: { name: 'geo', type: 'text', label: 'Location' },
    addr_geo: { name: 'addr_geo', type: 'text', label: 'Address location' },
    lat: { name: 'lat', type: 'number', label: 'Latitude' },
    lng: { name: 'lng', type: 'number', label: 'Longitude' },
    site_name: { name: 'site_name', type: 'text', label: 'Site name' },
    notes: { name: 'notes', type: 'textarea', label: 'Notes' },
    secret_geo: { name: 'secret_geo', type: 'text', label: 'Home location' },
    secret_lat: { name: 'secret_lat', type: 'number', label: 'Home latitude' },
    account: { name: 'account', type: 'lookup', reference: 'account', label: 'Account' },
  },
};

/** Fields the principal may NOT read. */
const DENIED = ['secret_geo', 'secret_lat'];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? objectDef : null)),
  }) as any;

/** Mount a list view and return the params of the LAST request it sent. */
async function paramsFor(schemaExtra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dataSource = makeDataSource();
  const schema: any = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'map',
    columns: ['subject'],
    ...schemaExtra,
  };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return (dataSource.find.mock.calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
}

const sorted = (v: unknown) => [...((v as string[] | undefined) ?? [])].sort();

beforeEach(() => {
  vi.clearAllMocks();
  holder.current = makePerms(true, DENIED);
});
afterEach(() => cleanup());

describe('ListView — a map view projects its location bindings (objectui#10370)', () => {
  // ── (a) Every spelling the map config resolver reads ────────────────────
  it('projects `map.locationField` when the columns omit it', async () => {
    const params = await paramsFor({ map: { locationField: 'geo' } });
    expect(sorted(params.$select)).toEqual(['geo', 'id', 'subject']);
  });

  it('projects the `map.latitudeField` + `map.longitudeField` pair', async () => {
    const params = await paramsFor({ map: { latitudeField: 'lat', longitudeField: 'lng' } });
    expect(sorted(params.$select)).toEqual(['id', 'lat', 'lng', 'subject']);
  });

  it('projects `options.map.locationField` (the producer bag)', async () => {
    const params = await paramsFor({ options: { map: { locationField: 'geo' } } });
    expect(sorted(params.$select)).toEqual(['geo', 'id', 'subject']);
  });

  it('projects the `options.map.latitudeField` + `options.map.longitudeField` pair', async () => {
    const params = await paramsFor({
      options: { map: { latitudeField: 'lat', longitudeField: 'lng' } },
    });
    expect(sorted(params.$select)).toEqual(['id', 'lat', 'lng', 'subject']);
  });

  it('projects a split pair — one half on the view-level block, one in the bag', async () => {
    const params = await paramsFor({
      map: { latitudeField: 'lat' },
      options: { map: { longitudeField: 'lng' } },
    });
    expect(
      sorted(params.$select),
      'the resolver merges the two sources per key, and the markers read both halves',
    ).toEqual(['id', 'lat', 'lng', 'subject']);
  });

  it('projects the marker title and description bindings too', async () => {
    const params = await paramsFor({
      map: { locationField: 'geo', titleField: 'site_name', descriptionField: 'notes' },
    });
    expect(sorted(params.$select)).toEqual(['geo', 'id', 'notes', 'site_name', 'subject']);
  });

  it('requests only the binding the markers read when the view-level block shadows the bag', async () => {
    const params = await paramsFor({
      map: { locationField: 'geo' },
      options: { map: { locationField: 'addr_geo' } },
    });
    expect(
      params.$select,
      'the view-level `map` block wins per key, so the markers are drawn from `geo`',
    ).toContain('geo');
    expect(
      params.$select,
      'the shadowed bag value is read by nothing and must not widen the projection',
    ).not.toContain('addr_geo');
  });

  // ── (b) The FLS gate ────────────────────────────────────────────────────
  it('does not request a location field the principal may not read', async () => {
    const params = await paramsFor({ map: { locationField: 'secret_geo' } });
    expect(params.$select).toEqual(['id', 'subject']);
  });

  it('drops the denied half of a coordinate pair and keeps the readable half', async () => {
    const params = await paramsFor({
      options: { map: { latitudeField: 'secret_lat', longitudeField: 'lng' } },
    });
    expect(sorted(params.$select)).toEqual(['id', 'lng', 'subject']);
    expect(params.$select).not.toContain('secret_lat');
  });

  it('does not add back a denied location field that is also an authored column', async () => {
    const params = await paramsFor({
      columns: ['subject', 'secret_geo'],
      map: { locationField: 'secret_geo' },
    });
    expect(params.$select).toEqual(['id', 'subject']);
  });

  it('does not send a location binding the object does not declare', async () => {
    const params = await paramsFor({ map: { locationField: 'no_such_field' } });
    expect(params.$select).toEqual(['id', 'subject']);
  });

  // ── The `$expand` twin ──────────────────────────────────────────────────
  it('expands a map binding that names a lookup, and not when it is not bound', async () => {
    const bound = await paramsFor({ map: { locationField: 'geo', titleField: 'account' } });
    expect(bound.$select).toContain('account');
    expect(bound.$expand).toEqual(['account']);

    cleanup();
    const unbound = await paramsFor({ map: { locationField: 'geo' } });
    expect(unbound.$expand).toBeUndefined();
  });

  it('projects a description bound to a lookup but does not expand it', async () => {
    const params = await paramsFor({ map: { locationField: 'geo', descriptionField: 'account' } });
    expect(
      params.$select,
      'the marker description is read off the row, so it is projected',
    ).toContain('account');
    expect(
      params.$expand,
      '`ObjectMap` renders the description as a React child: an expanded lookup (an object) '
        + 'throws on marker click, a bare id renders as text',
    ).toBeUndefined();
  });

  // ── (c) Controls ────────────────────────────────────────────────────────
  it('leaves a view with no map block unchanged', async () => {
    const params = await paramsFor({ viewType: 'grid' });
    expect(params.$select).toEqual(['id', 'subject']);
    expect(params.$expand).toBeUndefined();
  });

  it('does not read a top-level `locationField`: the map never binds it', async () => {
    const params = await paramsFor({ locationField: 'geo' });
    expect(
      params.$select,
      'a top-level `locationField` is refused by name by the spec list view and read by no map '
        + 'branch, so it binds no marker and is not projected',
    ).toEqual(['id', 'subject']);
  });
});
