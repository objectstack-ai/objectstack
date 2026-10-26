/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView — the detail header's Edit/Delete gate vs the server's
 * effective API operation set (#3546).
 *
 * PR-4 (objectui#2823) intersected the LIST/TOOLBAR affordances with the
 * server-resolved effective operation set (`/me/permissions` `apiOperations`).
 * #3546 extends that intersection to the DETAIL surface: the synthesized
 * `sys_edit` CTA (which also gates the record-body inline-edit session) and the
 * `sys_delete` overflow item must never be offered for an operation the server
 * would 405.
 *
 * These pin the resulting show/hide matrix, including the two properties that
 * make this an INTERSECTION and not a union:
 *   • a server grant never re-opens an affordance the lifecycle bucket closed;
 *   • a permissive bucket default never survives a server denial.
 * ...and the backward-compatible fallback: a missing effective set (unrestricted
 * object / old backend / no PermissionProvider) leaves today's bucket +
 * `userActions` decision untouched.
 *
 * objectui#12082: the gate is now the `recordEdit` / `recordDelete` rows of the
 * affordance-to-grant map, which ask the operation set THEMSELVES from the
 * caller's permissions (`getObjectApiOperations`) and AND the caller's object
 * grant (`can(object, 'update' | 'delete')`). The rows above keep the grant
 * open, so the operation set stays their only variable; the block at the end
 * holds the grant half.
 */

import { describe, it, expect } from 'vitest';
import { resolveRecordHeaderActionGates } from './RecordDetailView';

// `platform` is the permissive bucket — edit + delete both default open, so it
// isolates the effective-set intersection as the only variable.
const platform = { name: 'crm_lead', managedBy: 'platform' };

/** A caller whose effective operation set is `ops` and whose grant is `grants` (every verb by default). */
const caller = (
  ops: readonly string[] | null | undefined,
  grants: Partial<Record<'create' | 'update' | 'delete', boolean>> = {},
) => ({
  can: (_object: string, verb: 'create' | 'update' | 'delete') => grants[verb] ?? true,
  getObjectApiOperations: () => ops ?? undefined,
});

describe('resolveRecordHeaderActionGates — effective API operations (#3546)', () => {
  it('full-CRUD effective set → Edit and Delete both offered', () => {
    expect(
      resolveRecordHeaderActionGates(platform, caller(['get', 'list', 'create', 'update', 'delete'])),
    ).toEqual({ edit: true, delete: true });
  });

  it('read-only effective set → neither Edit nor Delete', () => {
    expect(resolveRecordHeaderActionGates(platform, caller(['get', 'list']))).toEqual({
      edit: false,
      delete: false,
    });
  });

  it('update-only effective set → Edit offered, Delete hidden', () => {
    expect(resolveRecordHeaderActionGates(platform, caller(['get', 'list', 'update']))).toEqual({
      edit: true,
      delete: false,
    });
  });

  it('delete-only effective set → Delete offered, Edit hidden', () => {
    expect(resolveRecordHeaderActionGates(platform, caller(['get', 'list', 'delete']))).toEqual({
      edit: false,
      delete: true,
    });
  });

  it('empty effective set ("expose nothing") → neither', () => {
    expect(resolveRecordHeaderActionGates(platform, caller([]))).toEqual({ edit: false, delete: false });
  });

  it('undefined effective set (unrestricted / old backend) → bucket wins, both offered', () => {
    expect(resolveRecordHeaderActionGates(platform, caller(undefined))).toEqual({
      edit: true,
      delete: true,
    });
    // No permissions at all (no PermissionProvider) must behave identically:
    // neither the operation set nor the grant can be asked, so both read open.
    expect(resolveRecordHeaderActionGates(platform, undefined)).toEqual({ edit: true, delete: true });
  });

  it('null effective set is treated as absent, not as an empty set', () => {
    expect(resolveRecordHeaderActionGates(platform, caller(null))).toEqual({ edit: true, delete: true });
  });

  // ── Intersection, never union ────────────────────────────────────────────
  it('bucket-locked object stays locked even when the server allows update/delete', () => {
    // `system` (engine-owned) closes edit + delete by default. A permissive
    // server set must NOT re-open them — the server governs what it will
    // accept, the bucket governs what the product offers.
    expect(
      resolveRecordHeaderActionGates({ name: 'sys_automation_run', managedBy: 'engine-owned' }, caller([
        'get',
        'list',
        'create',
        'update',
        'delete',
      ])),
    ).toEqual({ edit: false, delete: false });
  });

  it('userActions opt-in still loses to a server denial', () => {
    // sys_user opens `edit` via userActions (ADR-0103), but a caller whose
    // effective set lacks `update` must not see the Edit CTA.
    const sysUser = { name: 'sys_user', managedBy: 'better-auth', userActions: { edit: true } };
    expect(resolveRecordHeaderActionGates(sysUser, caller(['get', 'list', 'update']))).toEqual({
      edit: true,
      delete: false,
    });
    expect(resolveRecordHeaderActionGates(sysUser, caller(['get', 'list']))).toEqual({
      edit: false,
      delete: false,
    });
  });

  it('admin-editable `config` bucket intersects the same way', () => {
    const webhook = { name: 'sys_webhook', managedBy: 'config' };
    expect(resolveRecordHeaderActionGates(webhook, caller(['get', 'list', 'update', 'delete']))).toEqual({
      edit: true,
      delete: true,
    });
    expect(resolveRecordHeaderActionGates(webhook, caller(['get', 'list', 'update']))).toEqual({
      edit: true,
      delete: false,
    });
  });

  it('a missing objectDef falls back to the platform default (no crash)', () => {
    // With no object name there is no object to ask the operation set or the
    // grant about, so both read open and the platform default stands. The page
    // never reaches this gate without an `objectDef` (its not-found arm returns
    // first); this row only holds that the gate does not throw.
    expect(resolveRecordHeaderActionGates(undefined, caller(['get', 'list', 'update']))).toEqual({
      edit: true,
      delete: true,
    });
  });
});

describe('resolveRecordHeaderActionGates — the caller\'s object grant (objectui#12082)', () => {
  const FULL_OPS = ['get', 'list', 'create', 'update', 'delete'];

  it('objectui#12081 item 1: a caller with the update grant and `update` in the operation set gets Edit', () => {
    // The hotclm reading: `allowEdit` held, `update` served. Edit shows; what
    // hid it on 17.7.0 was the explain engine's record verdict, which the page
    // ANDs after this gate (`useRecordEditable`), not this gate.
    expect(resolveRecordHeaderActionGates(platform, caller(FULL_OPS, { update: true, delete: false }))).toEqual({
      edit: true,
      delete: false,
    });
  });

  it('a read-only caller gets neither, even where the operation set serves both', () => {
    expect(
      resolveRecordHeaderActionGates(platform, caller(FULL_OPS, { create: false, update: false, delete: false })),
    ).toEqual({ edit: false, delete: false });
  });

  it('a create-only caller gets neither: Edit reads the update grant, never the create one', () => {
    expect(
      resolveRecordHeaderActionGates(platform, caller(FULL_OPS, { create: true, update: false, delete: false })),
    ).toEqual({ edit: false, delete: false });
  });

  it('the grant never re-opens what the bucket closed', () => {
    expect(
      resolveRecordHeaderActionGates({ name: 'sys_automation_run', managedBy: 'engine-owned' }, caller(FULL_OPS)),
    ).toEqual({ edit: false, delete: false });
  });
});
