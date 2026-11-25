// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37248 — a related list offers no + New when the child's
 * relationship field is one the create form will not save.
 *
 * + New opens the child's create form pre-linked (`formLink=<fk>:<parentId>`).
 * A `readonly` relationship field is stripped by the form's outbound filter
 * (and by the server on a user insert), so the record used to save with no
 * link and never appear in the list it was created from. The list now asks
 * the create form's own filter before it offers + New.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Field-level verdict for `create`, keyed by field name; absent = allowed.
let createDenied: Record<string, boolean> = {};
let loaded = false;

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      isLoaded: loaded,
      getObjectApiOperations: () => undefined,
      can: () => true,
      checkField: (_o: string, field: string, action: string) =>
        !(action === 'create' && createDenied[field]),
    }),
  };
});

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import { useRelatedRecordActions } from '@object-ui/react';

const CHILD = 'sales_order';
const FK = 'quote';

function Probe({ onResolve }: { onResolve: (hasCreate: boolean) => void }) {
  const api = useRelatedRecordActions();
  const handlers = api?.resolve({ objectName: CHILD, relationshipField: FK, parentId: 'q1' }) ?? {};
  onResolve(typeof handlers.onCreate === 'function');
  return null;
}

function offersNew(fields: unknown): boolean {
  let captured = false;
  render(
    <MemoryRouter>
      <RelatedRecordActionsBridge
        appName="crm"
        objects={[{ name: CHILD, managedBy: 'platform', fields }]}
        dataSource={{ delete: vi.fn() }}
      >
        <Probe onResolve={(v) => { captured = v; }} />
      </RelatedRecordActionsBridge>
    </MemoryRouter>,
  );
  return captured;
}

beforeEach(() => {
  createDenied = {};
  loaded = false;
});

describe('RelatedRecordActionsBridge — + New needs a link the create form keeps (#37248)', () => {
  it('CONTROL: a writable relationship field keeps + New', () => {
    expect(offersNew({ [FK]: { type: 'lookup', reference: 'quote' } })).toBe(true);
  });

  it('a readonly relationship field offers no + New', () => {
    expect(offersNew({ [FK]: { type: 'lookup', reference: 'quote', readonly: true } })).toBe(false);
  });

  it('reads the array container shape the same way', () => {
    expect(offersNew([{ name: FK, type: 'lookup', reference: 'quote', readonly: true }])).toBe(false);
    expect(offersNew([{ name: FK, type: 'lookup', reference: 'quote' }])).toBe(true);
  });

  it('a relationship field closed to this caller on create offers no + New', () => {
    loaded = true;
    createDenied = { [FK]: true };
    expect(offersNew({ [FK]: { type: 'lookup', reference: 'quote' } })).toBe(false);
  });
});
