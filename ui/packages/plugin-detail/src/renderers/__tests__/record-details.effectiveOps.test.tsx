/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` — inline-edit vs the server's effective API operation set
 * (#3546).
 *
 * The record BODY offers per-field editing through a double-click / hover
 * pencil, gated by `isObjectInlineEditable`. #3546 intersects that gate with the
 * server-resolved effective operation set (`/me/permissions` `apiOperations`),
 * so a record page never offers inline editing the server would 405 on save.
 *
 * The renderer hands the resolved verdict to `<DetailView>` as
 * `schema.inlineEdit`; these stub DetailView and assert that flag across the
 * effective-set matrix — including that the intersection never becomes a union
 * (a server `update` grant can't re-open a bucket-locked object) and that a
 * missing effective set preserves today's behavior.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const stub = {
  /** Server-resolved effective API operations for the bound object. */
  effectiveOps: undefined as string[] | undefined,
  /** The bound object's schema (lifecycle bucket + userActions). */
  objectSchema: { managedBy: 'platform' } as any,
};

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordContext: () => ({
    objectName: 'crm_lead',
    recordId: 'rec_1',
    data: { id: 'rec_1', name: 'Acme' },
    dataSource: { update: async () => ({}) },
    refresh: async () => {},
    objectSchema: stub.objectSchema,
  }),
  useHighlightFieldNames: () => [] as string[],
  useSafeFieldLabel: () => ({
    sectionLabel: (_obj: string, _name: string, fallback: string) => fallback,
  }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      can: () => true,
      getObjectApiOperations: () => stub.effectiveOps,
    }),
    useFieldPermissions: () => ({ readableFields: (names: string[]) => names }),
  };
});

// Capture the schema the renderer synthesizes — `inlineEdit` is the gate under
// test. Stubbing DetailView also keeps the suite off the heavy field/registry
// graph, which this behavior does not depend on.
let captured: any = null;
vi.mock('../../DetailView', () => ({
  DetailView: (props: any) => {
    captured = props?.schema;
    return <div data-testid="detail-view" />;
  },
}));

import { RecordDetailsRenderer } from '../record-details';

/** Render the renderer and return the `inlineEdit` flag it resolved. */
function inlineEditFor(schema: any = { fields: ['name'] }): boolean {
  captured = null;
  render(<RecordDetailsRenderer schema={schema} />);
  return captured?.inlineEdit;
}

beforeEach(() => {
  stub.effectiveOps = undefined;
  stub.objectSchema = { managedBy: 'platform' };
  captured = null;
  cleanup();
});

describe('record:details — inline-edit vs effective API operations (#3546)', () => {
  it('effective set WITH `update` → inline-edit offered', () => {
    stub.effectiveOps = ['get', 'list', 'update'];
    expect(inlineEditFor()).toBe(true);
  });

  it('effective set WITHOUT `update` → inline-edit withheld', () => {
    // The #3546 behavior change: pre-fix this stayed `true` on a platform
    // object and the body offered a pencil the server would 405 on save.
    stub.effectiveOps = ['get', 'list'];
    expect(inlineEditFor()).toBe(false);
  });

  it('empty effective set ("expose nothing") → inline-edit withheld', () => {
    stub.effectiveOps = [];
    expect(inlineEditFor()).toBe(false);
  });

  it('undefined effective set (unrestricted / old backend) → bucket wins, offered', () => {
    stub.effectiveOps = undefined;
    expect(inlineEditFor()).toBe(true);
  });

  it('bucket-locked object stays locked even when the server allows `update`', () => {
    // Intersection, never union: an engine-owned object is not user-editable
    // regardless of what the caller's effective set permits.
    stub.objectSchema = { managedBy: 'engine-owned' };
    stub.effectiveOps = ['get', 'list', 'create', 'update', 'delete'];
    expect(inlineEditFor()).toBe(false);
  });

  it('userActions.edit opt-in still loses to a server denial', () => {
    stub.objectSchema = { managedBy: 'better-auth', userActions: { edit: true } };
    stub.effectiveOps = ['get', 'list', 'update'];
    expect(inlineEditFor()).toBe(true);

    stub.effectiveOps = ['get', 'list'];
    expect(inlineEditFor()).toBe(false);
  });

  it('author opt-out (`inlineEdit: false`) still wins over a permissive server set', () => {
    stub.effectiveOps = ['get', 'list', 'update'];
    expect(inlineEditFor({ fields: ['name'], inlineEdit: false })).toBe(false);
  });
});
