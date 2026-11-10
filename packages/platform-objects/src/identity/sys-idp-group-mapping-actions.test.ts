// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's three IdP group-mapping actions — Map SSO Group, Map SCIM Group and
 * Delete Mapping — wired to plugin-auth's two platform-admin mounts.
 *
 * What the console cannot be allowed to drift from is the mount's contract:
 * the route and method, the body keys the save reads (`providerId` or
 * `connectionId`, `groupExternalId`, `groupDisplayName`, `permissionSet`) and
 * the one the delete reads (`mappingId`). The save closes its key set, so a
 * param spelled as the row's column (`permission_set`) would reach it as an
 * unknown key and be refused 400; the names are pinned against the mount's own
 * spelling (`SET_BODY_KEYS` in `idp-group-mapping-admin.ts`, which this package
 * cannot import).
 *
 * The neighbouring pin this file does not repeat: the platform-admin standing
 * and the declared gate of every action on an admin mount are held by
 * `platform-admin-affordance-standing.test.ts` (its family floor names all
 * three). This file pins the same two facts for these three directly, so a
 * dropped gate reds here with the action's name.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import type { Action } from '@objectstack/spec/ui';
import { SysIdpGroupMapping } from './sys-idp-group-mapping.object.js';

const SET_ROUTE = '/api/v1/auth/admin/scim/set-group-mapping';
const DELETE_ROUTE = '/api/v1/auth/admin/scim/delete-group-mapping';
/** The save's closed body keys, restated from the mount. */
const SET_BODY_KEYS = ['connectionId', 'providerId', 'groupExternalId', 'groupDisplayName', 'permissionSet'];

type Param = { name?: string; required?: boolean; type?: string; widget?: string };

function actions(): Action[] {
  return (SysIdpGroupMapping.actions ?? []) as Action[];
}

function action(name: string): Action {
  const found = actions().find((a) => a.name === name);
  expect(found, `sys_idp_group_mapping declares no action '${name}'`).toBeDefined();
  return found!;
}

function paramsOf(a: Action): Param[] {
  return (a.params ?? []) as Param[];
}

function visibleSource(a: Action): string {
  const visible = a.visible as unknown;
  return typeof visible === 'string' ? visible : String((visible as { source?: unknown })?.source);
}

function offered(source: string, user: Record<string, unknown>): string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record: {}, extra: { current_user: user, user, ctx: { user }, os: { user }, features: {} } },
  );
  return r.ok ? String(r.value) : `FAULT ${r.error.message.split('\n')[0]}`;
}

describe('sys_idp_group_mapping: Map and Delete reach the platform-admin mounts', () => {
  it('Map SSO Group POSTs the save from the list toolbar, naming the provider, with the body keys the save reads', () => {
    const map = action('map_sso_group');
    expect(map).toMatchObject({ type: 'api', method: 'POST', target: SET_ROUTE, locations: ['list_toolbar'] });
    const params = paramsOf(map);
    expect(params.map((p) => p.name)).toEqual(['providerId', 'groupExternalId', 'groupDisplayName', 'permissionSet']);
    // The source and the set are required; the group is one of two, judged by the door.
    expect(params.filter((p) => p.required).map((p) => p.name)).toEqual(['providerId', 'permissionSet']);
  });

  it('Map SCIM Group POSTs the save from the list toolbar, naming the connection, with the body keys the save reads', () => {
    const map = action('map_scim_group');
    expect(map).toMatchObject({ type: 'api', method: 'POST', target: SET_ROUTE, locations: ['list_toolbar'] });
    const params = paramsOf(map);
    expect(params.map((p) => p.name)).toEqual(['connectionId', 'groupExternalId', 'groupDisplayName', 'permissionSet']);
    expect(params.filter((p) => p.required).map((p) => p.name)).toEqual(['connectionId', 'permissionSet']);
  });

  it('every param of both Map actions is a body key the save admits, and each names exactly one source', () => {
    for (const name of ['map_sso_group', 'map_scim_group']) {
      const keys = paramsOf(action(name)).map((p) => p.name ?? '');
      expect(keys.filter((k) => !SET_BODY_KEYS.includes(k)), `${name} sends a key the save refuses`).toEqual([]);
      expect(keys.filter((k) => k === 'connectionId' || k === 'providerId'), `${name} sources`).toHaveLength(1);
    }
  });

  it('the permission set is picked from the security catalog, not typed', () => {
    for (const name of ['map_sso_group', 'map_scim_group']) {
      expect(paramsOf(action(name)).find((p) => p.name === 'permissionSet')).toMatchObject({
        type: 'text',
        widget: 'permission-ref',
      });
    }
  });

  it('Delete Mapping POSTs the delete from a mapping row, sending the row id as mappingId, behind a confirmation', () => {
    const del = action('delete_group_mapping');
    expect(del).toMatchObject({
      type: 'api',
      method: 'POST',
      target: DELETE_ROUTE,
      recordIdParam: 'mappingId',
      locations: ['list_item', 'record_header'],
    });
    // No param dialog: the row is the whole input, so the confirmation is the one dialog.
    expect(del.params ?? []).toEqual([]);
    expect(del.confirmText).toBeTruthy();
  });

  it('the instrument is live: the save has two actions and the delete one on this object', () => {
    // Positive control for the gate pins below: a renamed target would leave them judging nothing.
    expect(actions().filter((a) => a.target === SET_ROUTE).map((a) => a.name).sort()).toEqual(['map_scim_group', 'map_sso_group']);
    expect(actions().filter((a) => a.target === DELETE_ROUTE).map((a) => a.name)).toEqual(['delete_group_mapping']);
  });
});

describe('sys_idp_group_mapping: each action is offered to, and gated on, the rung its door admits', () => {
  const NAMES = ['map_sso_group', 'map_scim_group', 'delete_group_mapping'];

  it('each declares the door\'s platform-settings gate where both action doors read it', () => {
    for (const name of NAMES) {
      expect(action(name).requiredPermissions, name).toEqual(['manage_platform_settings']);
    }
  });

  it('each is offered to a platform administrator and to nobody else', () => {
    for (const name of NAMES) {
      const source = visibleSource(action(name));
      expect(offered(source, { id: 'u_pa', isPlatformAdmin: true, positions: [] }), name).toBe('true');
      expect(offered(source, { id: 'u_org_admin', isPlatformAdmin: false, positions: [] }), name).toBe('false');
      expect(offered(source, { id: 'u_member', isPlatformAdmin: false, positions: ['member'] }), name).toBe('false');
    }
  });

  it('none is exposed to AI tools: they postdate the ADR-0011 identity-actions assessment', () => {
    for (const name of NAMES) {
      expect(action(name).ai?.exposed ?? false, `${name} declares ai.exposed`).toBe(false);
    }
  });

  it('the generic data path stays closed: full lock, list-only API, engine-owned rows', () => {
    expect(SysIdpGroupMapping.protection?.lock).toBe('full');
    expect(SysIdpGroupMapping.enable?.apiMethods).toEqual(['list']);
    expect(SysIdpGroupMapping.managedBy).toBe('engine-owned');
  });
});
