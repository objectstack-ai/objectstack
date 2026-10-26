// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RelatedRecordActionsBridge — the two gates that narrow a related list's
 * Create/Edit/Delete: the effective API operations (#3546) and the CURRENT
 * PRINCIPAL's permission on the child object (#4096).
 *
 * The related-list affordances for a CHILD object must be intersected with the
 * server-resolved effective operation set for that child (`/me/permissions`
 * `apiOperations`), so the list never offers an operation the server would 405:
 *   • full CRUD effective set → onCreate/onEdit/onDelete all present;
 *   • read-only effective set → none present;
 *   • update-only effective set → onEdit present, onCreate/onDelete absent;
 *   • undefined (unrestricted / old backend) → bucket affordances win (all present).
 *
 * [#4096] …and with the principal's `allowCreate` / `allowEdit` / `allowDelete`.
 * `apiOperations` describes the child OBJECT's exposure surface and is identical
 * for every account, so on its own it fails open — the second face of the row
 * kebab defect the main list carried. Both gates live in this one file so a
 * future change that drops either one fails here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { vi } from 'vitest';

// Controllable effective-operations map, keyed by child object name.
let effectiveOps: Record<string, string[] | undefined> = {};
// [#4096] Controllable principal verdict, keyed by action. `undefined` action
// entries default to allowed, matching `can()`'s permissive fallback.
let principal: Record<string, boolean> = {};

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      getObjectApiOperations: (name: string) => effectiveOps[name],
      can: (_name: string, action: string) => principal[action] ?? true,
      // Field-level read, open: the bridge reads it for "View all" (objectui#12741).
      checkField: () => true,
    }),
  };
});

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import { useRelatedRecordActions } from '@object-ui/react';

const CHILD = 'invoice';
// platform bucket → create/edit/delete all open by default.
const objects = [{ name: CHILD, managedBy: 'platform' }];

/** Probe: resolves the child's handlers and exposes which are present. */
function Probe({ onResolve }: { onResolve: (present: Record<string, boolean>) => void }) {
  const api = useRelatedRecordActions();
  const handlers = api?.resolve({ objectName: CHILD }) ?? {};
  onResolve({
    onCreate: typeof handlers.onCreate === 'function',
    onEdit: typeof handlers.onEdit === 'function',
    onDelete: typeof handlers.onDelete === 'function',
    onView: typeof handlers.onView === 'function',
  });
  return null;
}

function resolveHandlers(): Record<string, boolean> {
  let captured: Record<string, boolean> = {};
  render(
    <MemoryRouter>
      <RelatedRecordActionsBridge
        appName="crm"
        objects={objects}
        dataSource={{ delete: vi.fn() }}
      >
        <Probe onResolve={(p) => { captured = p; }} />
      </RelatedRecordActionsBridge>
    </MemoryRouter>,
  );
  return captured;
}

beforeEach(() => {
  effectiveOps = {};
  principal = {};
});

describe('RelatedRecordActionsBridge — effective API operations (#3546)', () => {
  it('full-CRUD effective set → Create/Edit/Delete all offered', () => {
    effectiveOps = { [CHILD]: ['get', 'list', 'create', 'update', 'delete'] };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(true);
    expect(h.onEdit).toBe(true);
    expect(h.onDelete).toBe(true);
    expect(h.onView).toBe(true); // view is always allowed when the list renders
  });

  it('read-only effective set → no Create/Edit/Delete (only View)', () => {
    effectiveOps = { [CHILD]: ['get', 'list'] };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(false);
    expect(h.onEdit).toBe(false);
    expect(h.onDelete).toBe(false);
    expect(h.onView).toBe(true);
  });

  it('update-only effective set → Edit offered, Create/Delete hidden', () => {
    effectiveOps = { [CHILD]: ['get', 'list', 'update'] };
    const h = resolveHandlers();
    expect(h.onEdit).toBe(true);
    expect(h.onCreate).toBe(false);
    expect(h.onDelete).toBe(false);
  });

  it('undefined effective set (unrestricted / old backend) → bucket wins, all offered', () => {
    effectiveOps = { [CHILD]: undefined };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(true);
    expect(h.onEdit).toBe(true);
    expect(h.onDelete).toBe(true);
  });
});

describe('RelatedRecordActionsBridge — principal permission gate (#4096)', () => {
  const FULL = ['get', 'list', 'create', 'update', 'delete'];

  it('a principal WITH the write grants keeps Create/Edit/Delete', () => {
    effectiveOps = { [CHILD]: FULL };
    principal = { create: true, update: true, delete: true };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(true);
    expect(h.onEdit).toBe(true);
    expect(h.onDelete).toBe(true);
  });

  it('a principal WITHOUT them loses all three — on a fully exposed child', () => {
    // The #4096 shape carried over to the related list: identical full
    // `apiOperations`, no write permission. Pre-#4096 all three were offered.
    effectiveOps = { [CHILD]: FULL };
    principal = { create: false, update: false, delete: false };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(false);
    expect(h.onEdit).toBe(false);
    expect(h.onDelete).toBe(false);
    // Viewing a child record is not a write — it must survive.
    expect(h.onView).toBe(true);
  });

  it('gates create / update / delete independently', () => {
    effectiveOps = { [CHILD]: FULL };
    principal = { create: false, update: true, delete: false };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(false);
    expect(h.onEdit).toBe(true);
    expect(h.onDelete).toBe(false);
  });

  it('with no permission source at all the affordances survive (fail-open preserved)', () => {
    // `usePermissions()` with no `PermissionProvider` answers `can: () => true`
    // and `getObjectApiOperations: () => undefined` — the stub's defaults here.
    effectiveOps = { [CHILD]: undefined };
    principal = {};
    const h = resolveHandlers();
    expect(h.onCreate).toBe(true);
    expect(h.onEdit).toBe(true);
    expect(h.onDelete).toBe(true);
  });

  it('keeps apiOperations as a layer — a write grant cannot re-open a closed surface', () => {
    effectiveOps = { [CHILD]: ['get', 'list'] };
    principal = { create: true, update: true, delete: true };
    const h = resolveHandlers();
    expect(h.onCreate).toBe(false);
    expect(h.onEdit).toBe(false);
    expect(h.onDelete).toBe(false);
  });
});
