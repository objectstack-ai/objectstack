/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4421 — `effectiveObjects`: the `objects` map of the
 * `/auth/me/permissions` response, handed on verbatim for the predicate
 * binding `current_user.can(object, verb)`.
 *
 * The truth table, one row per `PermissionContextValue` source:
 *   - `MePermissionsProvider` with a response → the response's OWN `objects`
 *     object (identity, not a copy: the binding caches its adapted map on the
 *     payload object, AGENTS.md #10), with `isLoaded` true.
 *   - `MePermissionsProvider` with a response that grants nothing → `{}`, a
 *     real answer, NOT collapsed into `undefined`.
 *   - `PermissionProvider` (roles from config, no server payload) → `undefined`.
 *   - no provider at all → `undefined`, while `can` keeps its fail-open `true`
 *     for the built-in affordances — the two are separate answers.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '../MePermissionsProvider';
import { PermissionProvider } from '../PermissionProvider';
import { usePermissions } from '../usePermissions';

const seen: Array<ReturnType<typeof usePermissions>> = [];

function Probe() {
  const perms = usePermissions();
  seen.push(perms);
  return <span data-testid="loaded">{String(perms.isLoaded)}</span>;
}

function response(objects: MePermissionsResponse['objects']): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: ['account_clerk'],
    objects,
    fields: {},
  };
}

describe('objectui#4421 — effectiveObjects', () => {
  it('MePermissionsProvider hands on the response\'s own objects map', () => {
    seen.length = 0;
    const payload = response({ account: { allowRead: true, allowDelete: false } });
    render(
      <MePermissionsProvider initialPermissions={payload}>
        <Probe />
      </MePermissionsProvider>,
    );
    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(seen.at(-1)?.effectiveObjects).toBe(payload.objects);
  });

  it('a response that grants nothing is `{}`, not "no payload"', () => {
    seen.length = 0;
    render(
      <MePermissionsProvider initialPermissions={response({})}>
        <Probe />
      </MePermissionsProvider>,
    );
    expect(seen.at(-1)?.effectiveObjects).toEqual({});
  });

  it('PermissionProvider has no server payload: undefined', () => {
    seen.length = 0;
    render(
      <PermissionProvider roles={[]} permissions={[]} userRoles={[]}>
        <Probe />
      </PermissionProvider>,
    );
    expect(seen.at(-1)?.isLoaded).toBe(true);
    expect(seen.at(-1)?.effectiveObjects).toBeUndefined();
  });

  it('no provider: undefined — while the built-in `can` stays fail-open', () => {
    seen.length = 0;
    render(<Probe />);
    expect(seen.at(-1)?.effectiveObjects).toBeUndefined();
    expect(seen.at(-1)?.can('account', 'delete')).toBe(true);
  });
});
