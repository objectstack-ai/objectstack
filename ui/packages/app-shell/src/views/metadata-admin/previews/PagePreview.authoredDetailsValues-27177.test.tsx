// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page designer's Design canvas draws an authored `record:details` body's
 * values the way the record page does.
 *
 * A `full` record page names its detail fields (the full-create seed writes
 * `sections[].fields` as bare names). The canvas mounts the runtime
 * `record:details` renderer under a record context that holds the bound
 * object's schema but no dataSource, as every Studio preview does. The field
 * types come from that schema: without it a `select` drew its stored code and a
 * `location` drew `[Object]`.
 *
 * Everything here is real: the canvas, the record context, `record:details`,
 * `DetailView` and the `@object-ui/fields` cell renderers. Only the two
 * endpoints `PagePreview` reads (the object schema and the sample records) are
 * answered by a double.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
// Registers `record:details`, which the canvas resolves through the registry.
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';

/** Stable stub identity: `PagePreview` carries `perms` in an effect dep list. */
const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: true,
    checkField: () => true,
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
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { PagePreview } from './PagePreview';
import {
  deriveStudioDetailSections,
  toAuthoredDetailSections,
  MORE_DETAILS_DEFAULT_LABEL,
} from '../../recordDetailSections';

const OBJECT = 'showcase_account';
const OBJECT_DEF = {
  name: OBJECT,
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Account Name' },
    account_code: { type: 'text', label: 'Account Code' },
    sales_region: {
      type: 'select',
      label: 'Sales Region',
      options: [
        { value: 'amer', label: 'Americas' },
        { value: 'emea', label: 'Europe' },
      ],
    },
    headquarters: { type: 'location', label: 'Headquarters' },
  },
};
const RECORD = {
  id: 'acc_1',
  name: 'Northwind',
  account_code: 'NW-001',
  sales_region: 'amer',
  headquarters: { latitude: 37.7749, longitude: -122.4194 },
};

/** The page the full-create seed writes for this object: authored, named fields. */
function fullCreateSeed(): Record<string, unknown> {
  const sections = toAuthoredDetailSections(
    deriveStudioDetailSections(OBJECT_DEF as any, { moreDetails: MORE_DETAILS_DEFAULT_LABEL }),
  );
  const synth = buildDefaultPageSchema(OBJECT_DEF as any, sections ? { sections: sections as any } : undefined) as {
    regions: unknown[];
    template?: unknown;
  };
  return {
    name: 'account_page',
    label: 'Account page',
    type: 'record',
    object: OBJECT,
    kind: 'full',
    regions: synth.regions,
    ...(synth.template !== undefined ? { template: synth.template } : {}),
  };
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/meta/object/')) return { ok: true, json: async () => ({ item: OBJECT_DEF }) } as any;
    if (url.startsWith(`/api/v1/data/${OBJECT}`)) return { ok: true, json: async () => ({ records: [RECORD] }) } as any;
    // The record-edit probe and anything else the real blocks ask for.
    return { ok: true, json: async () => ({}) } as any;
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PagePreview Design canvas: an authored record:details draws typed values', () => {
  it('names its detail fields as bare names (the premise this file pins)', () => {
    const seed = JSON.stringify(fullCreateSeed());
    expect(seed).toContain('"record:details"');
    expect(seed).toContain('"sales_region"');
    expect(seed).not.toContain('"type":"select"');
  });

  it('draws a select by its option label and a location as coordinates, never the raw value', async () => {
    stubFetch();
    render(
      <PagePreview
        type="page"
        name="account_page"
        draft={fullCreateSeed()}
        editing
        selection={null}
        onSelectionChange={() => {}}
        onPatch={vi.fn() as any}
        locale="en-US"
      />,
    );

    // Control: a plain text field reads as stored, before and after the fix.
    await waitFor(() => expect(screen.getByText('NW-001')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Americas')).toBeTruthy());
    expect(screen.getByText(/37\.7749, -122\.4194/)).toBeTruthy();
    expect(screen.queryByText('amer')).toBeNull();
    expect(document.body.textContent).not.toContain('[Object]');
  });
});
