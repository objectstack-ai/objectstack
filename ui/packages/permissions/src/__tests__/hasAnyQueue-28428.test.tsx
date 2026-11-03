/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#28428 — `hasAnyQueue`: the `/auth/me/permissions` boolean
 * (objectstack#28508) saying the caller's organization has at least one
 * ownership queue, handed on verbatim for the list's "In a queue" toggle.
 *
 * The truth table, one row per `PermissionContextValue` source:
 *   - `MePermissionsProvider` with an authenticated answer → the answer's own
 *     boolean, `true` and `false` alike;
 *   - `MePermissionsProvider` with the anonymous answer → `undefined`;
 *   - a scope below it (`ServerReadScope`) → the parent's value, forwarded;
 *   - `PermissionProvider` (roles from config, no server payload) → `undefined`;
 *   - no provider at all → `undefined`.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '../MePermissionsProvider';
import { PermissionProvider } from '../PermissionProvider';
import { ServerReadScope } from '../ServerReadScope';
import { usePermissions } from '../usePermissions';

const seen: Array<ReturnType<typeof usePermissions>> = [];

function Probe() {
  seen.push(usePermissions());
  return null;
}

function answer(hasAnyQueue: boolean): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    hasAnyQueue,
    positions: [],
    permissionSets: ['member_default'],
    objects: {},
    fields: {},
  };
}

describe('objectstack#28428 — hasAnyQueue on the permission context', () => {
  it.each([true, false])('MePermissionsProvider hands on the served %s', (value) => {
    seen.length = 0;
    render(
      <MePermissionsProvider initialPermissions={answer(value)}>
        <Probe />
      </MePermissionsProvider>,
    );
    expect(seen.at(-1)?.isLoaded).toBe(true);
    expect(seen.at(-1)?.hasAnyQueue).toBe(value);
  });

  it('the anonymous answer carries no has-queues answer', () => {
    seen.length = 0;
    render(
      <MePermissionsProvider initialPermissions={{ authenticated: false }}>
        <Probe />
      </MePermissionsProvider>,
    );
    expect(seen.at(-1)?.isLoaded).toBe(true);
    expect(seen.at(-1)?.hasAnyQueue).toBeUndefined();
  });

  it('a scope below the provider forwards the parent\'s answer', () => {
    seen.length = 0;
    render(
      <MePermissionsProvider initialPermissions={answer(true)}>
        <ServerReadScope objects={['sys_user']}>
          <Probe />
        </ServerReadScope>
      </MePermissionsProvider>,
    );
    expect(seen.at(-1)?.hasAnyQueue).toBe(true);
  });

  it('PermissionProvider has no server payload: undefined', () => {
    seen.length = 0;
    render(
      <PermissionProvider roles={[]} permissions={[]} userRoles={[]}>
        <Probe />
      </PermissionProvider>,
    );
    expect(seen.at(-1)?.isLoaded).toBe(true);
    expect(seen.at(-1)?.hasAnyQueue).toBeUndefined();
  });

  it('no provider at all: undefined', () => {
    seen.length = 0;
    render(<Probe />);
    expect(seen.at(-1)?.isLoaded).toBe(false);
    expect(seen.at(-1)?.hasAnyQueue).toBeUndefined();
  });
});
