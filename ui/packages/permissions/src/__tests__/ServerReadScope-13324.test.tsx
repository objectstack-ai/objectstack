/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13324 — `ServerReadScope`: below it, the two READ verdicts for the
 * named objects are the server's ("allowed"), and everything else is the
 * enclosing provider's.
 *
 * The truth table, under a signed-in `/auth/me/permissions` answer that names
 * `invoice` but not the scoped object (so the enclosing answer fails closed for
 * it, which is the case the scope exists for):
 *   - `checkField(scoped, f, 'read')` and `check(scoped, 'read')` → allowed,
 *     matched case-insensitively as the provider matches object names;
 *   - `checkField(scoped, f, 'write' | 'create')` and every other action on the
 *     scoped object → the enclosing answer (closed);
 *   - every other object, explicit field entries included → the enclosing
 *     answer, unchanged;
 *   - the data members (`effectiveObjects`, `roles`, `userId`, `isLoaded`) →
 *     the enclosing provider's own values;
 *   - no provider at all → the children render with the no-provider answer.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '../MePermissionsProvider';
import { ServerReadScope } from '../ServerReadScope';
import { usePermissions } from '../usePermissions';

type Perms = ReturnType<typeof usePermissions>;

function Probe({ seen }: { seen: Perms[] }) {
  seen.push(usePermissions());
  return null;
}

const ANSWER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: ['member'],
  permissionSets: ['member_default'],
  objects: { invoice: { allowRead: true, allowEdit: true } },
  fields: { 'invoice.internal_score': { readable: false, editable: false } },
};

function underScope(objects: readonly string[]) {
  const outer: Perms[] = [];
  const inner: Perms[] = [];
  const tree = (names: readonly string[]) => (
    <MePermissionsProvider initialPermissions={ANSWER}>
      <Probe seen={outer} />
      <ServerReadScope objects={names}>
        <Probe seen={inner} />
      </ServerReadScope>
    </MePermissionsProvider>
  );
  const view = render(tree(objects));
  return { outer, inner, rerender: (names: readonly string[]) => view.rerender(tree(names)) };
}

describe('ServerReadScope (objectui#13324)', () => {
  it('answers both read verdicts for the scoped objects as allowed, matched case-insensitively', () => {
    const { outer, inner } = underScope(['Sys_Approval_Request']);
    const before = outer.at(-1)!;
    const perms = inner.at(-1)!;
    expect(before.checkField('sys_approval_request', 'status', 'read')).toBe(false);
    expect(before.can('sys_approval_request', 'read')).toBe(false);
    expect(perms.checkField('sys_approval_request', 'status', 'read')).toBe(true);
    expect(perms.checkField('SYS_APPROVAL_REQUEST', 'viewer', 'read')).toBe(true);
    expect(perms.can('sys_approval_request', 'read')).toBe(true);
    expect(perms.check('sys_approval_request', 'read')).toEqual({ allowed: true });
  });

  it('leaves every write verdict and every other action on the scoped objects to the enclosing answer', () => {
    const { inner } = underScope(['sys_approval_request']);
    const perms = inner.at(-1)!;
    expect(perms.checkField('sys_approval_request', 'status', 'write')).toBe(false);
    expect(perms.checkField('sys_approval_request', 'status', 'create')).toBe(false);
    for (const action of ['create', 'update', 'delete', 'export'] as const) {
      expect(perms.can('sys_approval_request', action), action).toBe(false);
    }
  });

  it('leaves every other object to the enclosing answer, its explicit field entries included', () => {
    const { outer, inner } = underScope(['sys_approval_request']);
    const before = outer.at(-1)!;
    const perms = inner.at(-1)!;
    for (const [object, field] of [['invoice', 'name'], ['invoice', 'internal_score'], ['payroll', 'salary']] as const) {
      for (const action of ['read', 'write', 'create'] as const) {
        expect(perms.checkField(object, field, action), `${object}.${field} ${action}`).toBe(before.checkField(object, field, action));
      }
    }
    expect(perms.checkField('invoice', 'internal_score', 'read')).toBe(false);
    expect(perms.can('payroll', 'read')).toBe(false);
    expect(perms.can('invoice', 'update')).toBe(true);
  });

  it("hands on the enclosing provider's data members as they are", () => {
    const { outer, inner } = underScope(['sys_approval_request']);
    const before = outer.at(-1)!;
    const perms = inner.at(-1)!;
    expect(perms.isLoaded).toBe(true);
    expect(perms.effectiveObjects).toBe(before.effectiveObjects);
    expect(perms.roles).toBe(before.roles);
    expect(perms.userId).toBe('u1');
    expect(perms.getFieldPermissions('sys_approval_request')).toEqual([]);
    expect(perms.getFieldPermissions('invoice')).toEqual(before.getFieldPermissions('invoice'));
  });

  it('keeps one identity across renders, for a fresh array with the same names in any order or case (AGENTS.md #10)', () => {
    const { inner, rerender } = underScope(['sys_approval_request', 'sys_approval_action']);
    rerender(['sys_approval_action', 'sys_approval_request']);
    rerender(['SYS_APPROVAL_REQUEST', 'sys_approval_action', 'sys_approval_action']);
    expect(inner.length).toBeGreaterThanOrEqual(3);
    expect(new Set(inner).size).toBe(1);
    rerender(['sys_approval_request']);
    expect(inner.at(-1)).not.toBe(inner[0]);
  });

  it('with no enclosing provider, renders its children with the no-provider answer', () => {
    const seen: Perms[] = [];
    render(
      <ServerReadScope objects={['sys_approval_request']}>
        <Probe seen={seen} />
      </ServerReadScope>,
    );
    const perms = seen.at(-1)!;
    expect(perms.isLoaded).toBe(false);
    expect(perms.checkField('anything', 'at_all', 'write')).toBe(true);
    expect(perms.can('anything', 'delete')).toBe(true);
  });
});
