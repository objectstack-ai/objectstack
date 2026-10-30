/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27611 — which `type: 'api'` click goes through the action door.
 *
 * `isSameOriginApiTarget` restates the server's predicate (`@objectstack/runtime`
 * `action-execution.ts#isSameOriginApiTarget`, ADR-0066 D4 as amended), so the
 * two answer alike on every spelling below. `findDeclaredApiAction` is the
 * lookup both api handlers ask before they send a click to the door.
 */

import { describe, it, expect } from 'vitest';
import { findDeclaredApiAction, isSameOriginApiTarget } from '../apiActionDoor';

describe('isSameOriginApiTarget — the server\'s predicate, restated', () => {
  it('admits a path on this origin', () => {
    expect(isSameOriginApiTarget('/api/v1/auth/admin/ban-user')).toBe(true);
    expect(isSameOriginApiTarget('/x')).toBe(true);
  });

  it('refuses another origin, a bare slash and a non-string', () => {
    expect(isSameOriginApiTarget('https://hooks.example.test/ping')).toBe(false);
    expect(isSameOriginApiTarget('//hooks.example.test/ping')).toBe(false);
    expect(isSameOriginApiTarget('/\\hooks.example.test/ping')).toBe(false);
    expect(isSameOriginApiTarget('/')).toBe(false);
    expect(isSameOriginApiTarget('api/v1/x')).toBe(false);
    expect(isSameOriginApiTarget('')).toBe(false);
    expect(isSameOriginApiTarget(undefined)).toBe(false);
  });
});

describe('findDeclaredApiAction — the click names a declared same-origin api action', () => {
  const BAN = { name: 'ban_user', type: 'api', target: '/api/v1/auth/admin/ban-user' };
  const ARCHIVE = { name: 'archive', type: 'api', target: '/api/v1/things/${ctx.recordId}/archive' };
  const PING = { name: 'ping', type: 'api', target: 'https://hooks.example.test/ping' };
  const RUN = { name: 'run', type: 'script', target: '/api/v1/auth/admin/ban-user' };
  const OBJECTS = [{ name: 'sys_user', actions: [BAN, ARCHIVE, PING, RUN] }];

  it('finds the declaration by object, name, type and target', () => {
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', 'ban_user', BAN.target)).toBe(BAN);
  });

  it('matches a target the runner already interpolated', () => {
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', 'archive', '/api/v1/things/rec%201/archive')).toBe(ARCHIVE);
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', 'archive', '/api/v1/things/a/b/archive')).toBeUndefined();
  });

  it('names nothing for an off-origin declaration, another type or another target', () => {
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', 'ping', PING.target)).toBeUndefined();
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', 'run', RUN.target)).toBeUndefined();
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', 'ban_user', '/api/v1/auth/admin/unban-user')).toBeUndefined();
  });

  it('names nothing without the object, the name or the object metadata', () => {
    expect(findDeclaredApiAction(OBJECTS, 'crm_lead', 'ban_user', BAN.target)).toBeUndefined();
    expect(findDeclaredApiAction(OBJECTS, undefined, 'ban_user', BAN.target)).toBeUndefined();
    expect(findDeclaredApiAction(OBJECTS, 'sys_user', undefined, BAN.target)).toBeUndefined();
    expect(findDeclaredApiAction(undefined, 'sys_user', 'ban_user', BAN.target)).toBeUndefined();
  });
});
