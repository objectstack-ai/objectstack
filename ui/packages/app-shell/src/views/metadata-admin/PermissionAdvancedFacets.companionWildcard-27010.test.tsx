// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27010 — the delegated-admin companion grants read a companion
 * object's grant as the runtime resolves it: the set's own entry, else its
 * `'*'` entry where that applies to the object (`objectRuleCell`, the matrix's
 * reading). An object the `'*'` entry covers is marked granted on the bits that
 * entry carries, and the one-click grant starts a missing object's entry from
 * the drawn one, so it only ever turns flags on.
 */

import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionAdvancedFacets, type ObjectAccessDefaultOf } from './PermissionAdvancedFacets';

afterEach(cleanup);

const t = (k: string) => k;
type Draft = Record<string, unknown>;
let latest: Draft = {};

function Harness({ initial, accessDefaultOf }: { initial: Draft; accessDefaultOf?: ObjectAccessDefaultOf }) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  React.useEffect(() => {
    latest = draft;
  }, [draft]);
  return (
    <PermissionAdvancedFacets
      draft={draft}
      setDraft={setDraft as never}
      writable
      allSetNames={[]}
      t={t}
      only="admin"
      objectAccessDefault={accessDefaultOf}
    />
  );
}

const ANCHORED = { businessUnit: 'bu_field_ops', manageAssignments: true };
const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const SUPER = { ...CRUD, viewAllRecords: true, modifyAllRecords: true };
const OBJECT_COMPANIONS = ['sys_user', 'sys_business_unit', 'sys_business_unit_member', 'sys_user_position'];

const row = (id: string) => screen.getByTestId(`admin-companion-${id}`);

describe('companion grants read the `*` entry as the runtime does (objectstack#27010)', () => {
  it('a `*` entry carrying the flags marks each companion object granted', async () => {
    latest = {};
    render(<Harness initial={{ name: 'delegate', objects: { '*': SUPER }, adminScope: ANCHORED }} />);
    for (const id of OBJECT_COMPANIONS) expect(row(id).getAttribute('data-granted'), id).toBe('true');
    expect(row('setup.access').getAttribute('data-granted')).toBe('false');
  });

  it('the one-click grant then adds only the capability and leaves the objects to the `*` entry', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ name: 'delegate', objects: { '*': SUPER }, adminScope: ANCHORED }} />);
    await user.click(screen.getByTestId('admin-companions-grant'));
    expect(latest.systemPermissions).toEqual(['setup.access']);
    expect(latest.objects).toEqual({ '*': SUPER });
  });

  it('a read-only `*` entry: the CRUD companion starts from it and only turns flags on', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ name: 'delegate', objects: { '*': { allowRead: true, allowExport: true } }, adminScope: ANCHORED }} />);
    expect(row('sys_user').getAttribute('data-granted')).toBe('true');
    expect(row('sys_user_position').getAttribute('data-granted')).toBe('false');
    await user.click(screen.getByTestId('admin-companions-grant'));
    expect(latest.objects).toEqual({
      '*': { allowRead: true, allowExport: true },
      sys_user_position: { allowRead: true, allowExport: true, allowCreate: true, allowEdit: true, allowDelete: true },
    });
  });

  it('a private companion object is not covered by a plain `*` entry', async () => {
    const user = userEvent.setup();
    const accessDefaultOf: ObjectAccessDefaultOf = (name) => (name === 'sys_user' ? 'private' : 'public');
    render(
      <Harness
        initial={{ name: 'delegate', objects: { '*': CRUD }, adminScope: ANCHORED }}
        accessDefaultOf={accessDefaultOf}
      />,
    );
    expect(row('sys_user').getAttribute('data-granted')).toBe('false');
    expect(row('sys_business_unit').getAttribute('data-granted')).toBe('true');
    await user.click(screen.getByTestId('admin-companions-grant'));
    expect((latest.objects as Record<string, unknown>).sys_user).toEqual({ allowRead: true });
  });
});
