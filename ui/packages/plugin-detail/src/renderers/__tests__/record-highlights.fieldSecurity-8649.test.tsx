/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8649 — `record:highlights` folds its chips through `redactFields`
 * and `enforceFieldSecurity`, and that behaviour is what the declaration
 * describes.
 *
 * ## Why this file exists
 *
 * `@objectstack/spec` 17.5.0 declares the field-security triple on
 * `record:highlights`, and objectui#8649 declared it on the mirror, removed the
 * `(schema as any)` casts the renderer read it through, and published it as the
 * block's registry `inputs`. The emitted JavaScript did not move, so the
 * behaviour an author gets is the behaviour this renderer always had — but no
 * test drove the two FOLD keys on this block before: the capability gate
 * (`requiredPermissions`) is pinned for all three record blocks by
 * `record-blocks.requiredPermissions-gate.test.tsx`, and the fold keys only on
 * `record:details` (`record-details.unresolvedIdentityFailClosed-9054.test.tsx`)
 * and `record:related_list` (`RecordRelatedListRenderer.redactedDerivation-9053.test.tsx`).
 * This file closes that gap for the block, so "the declaration changed no
 * behaviour" rests on a pin here rather than on an argument.
 *
 * It is also the member pin for `record:highlights.redactFields` in the
 * console's registry-inputs guard: the published input is `array` of `string`,
 * and the rows below fix what a member IS to the renderer — a field NAME,
 * matched exactly, never a label or a case variant.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RecordHighlightsRenderer } from '../record-highlights';

const objectSchema = {
  name: 'employee',
  fields: {
    owner: { type: 'text', label: 'Owner' },
    status: { type: 'text', label: 'Status' },
    salary: { type: 'text', label: 'Salary' },
  },
};

/** Distinct VALUES, so a chip is read off the screen by what it paints. */
const RECORD = { id: 'E1', owner: 'owner-value-A', status: 'status-value-B', salary: 'salary-value-C' };

const FIELDS = ['owner', 'status', 'salary'];

const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];

/** `read` on `employee`, and `read` on every field EXCEPT the ones named. */
function permsDenying(...deniedFields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: 'employee',
      roles: {
        restricted: {
          actions: ['read'],
          fieldPermissions: deniedFields.map((field) => ({ field, read: false })),
        },
      },
    },
  ];
}

function renderStrip(schema: Record<string, unknown>, wrap?: (n: React.ReactNode) => React.ReactElement) {
  const node = (
    <RecordContextProvider objectName="employee" recordId="E1" data={RECORD} objectSchema={objectSchema}>
      <RecordHighlightsRenderer schema={{ fields: FIELDS, ...schema } as never} />
    </RecordContextProvider>
  );
  return render(wrap ? wrap(node) : node);
}

const denySalary = (n: React.ReactNode) => (
  <PermissionProvider roles={roles} permissions={permsDenying('salary')} userRoles={['restricted']}>
    {n}
  </PermissionProvider>
);

/** Which of the three chips painted their value. */
const painted = () =>
  FIELDS.filter((f) => screen.queryByText(RECORD[f as keyof typeof RECORD] as string) !== null);

afterEach(() => {
  cleanup();
});

describe('record:highlights — `redactFields` (objectui#8649)', () => {
  it('CONTROL — with neither fold key, every authored chip paints its value', () => {
    renderStrip({});
    expect(painted()).toEqual(['owner', 'status', 'salary']);
  });

  it('a member names a field, and exactly that chip is not rendered', () => {
    renderStrip({ redactFields: ['salary'] });
    expect(painted()).toEqual(['owner', 'status']);
  });

  it('CONTROL — a member naming a field the strip does not show removes nothing', () => {
    renderStrip({ redactFields: ['some_other_field'] });
    expect(painted()).toEqual(['owner', 'status', 'salary']);
  });

  it('members are matched as exact field NAMES — a label or a case variant removes nothing', () => {
    // The published member kind is `string` and the contract's is
    // `z.array(z.string())` of field NAMES; the renderer compares with
    // `includes`, so `Salary` (the label) and `SALARY` are different names.
    renderStrip({ redactFields: ['Salary', 'SALARY'] });
    expect(painted()).toEqual(['owner', 'status', 'salary']);
  });

  it('every member counts — two names remove two chips', () => {
    renderStrip({ redactFields: ['owner', 'salary'] });
    expect(painted()).toEqual(['status']);
  });
});

describe('record:highlights — `enforceFieldSecurity` (objectui#8649)', () => {
  it('a field the permission set denies leaves no chip', () => {
    renderStrip({ enforceFieldSecurity: true }, denySalary);
    expect(painted()).toEqual(['owner', 'status']);
  });

  it('CONTROL — the same denial with the key absent paints every chip: the key is the switch', () => {
    renderStrip({}, denySalary);
    expect(painted()).toEqual(['owner', 'status', 'salary']);
  });

  it('CONTROL — only `true` switches it on; the string spelling the contract refuses does not', () => {
    // The read is `=== true`, which the un-cast declaration (`boolean`) now
    // states at the type level too.
    renderStrip({ enforceFieldSecurity: 'true' }, denySalary);
    expect(painted()).toEqual(['owner', 'status', 'salary']);
  });

  it('the two keys compose: a denied field and a redacted one both leave', () => {
    renderStrip({ enforceFieldSecurity: true, redactFields: ['owner'] }, denySalary);
    expect(painted()).toEqual(['status']);
  });
});
