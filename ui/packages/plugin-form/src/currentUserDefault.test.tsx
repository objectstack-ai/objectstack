/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A CREATE form pre-fills the ONE runtime default the client can resolve
 * exactly: `current_user` (#5683).
 *
 * The #4047/#4068 rule stands — runtime defaults are the server's to resolve,
 * and seeding the literal token text would suppress that resolution. But the
 * engine's `current_user` resolution IS "the acting user's id"
 * (`ObjectQL.applyFieldDefaults` → `execCtx.userId`), and this session is that
 * actor, so seeding `usePermissions().userId` previews the very value the
 * server would stamp. This is #4069's promised "surface what the server WILL
 * supply" follow-up. Live shape that motivated it: 报销流程's
 * `applicant: { type: 'lookup', reference: 'sys_user', defaultValue:
 * 'current_user' }` — spec-legal, engine-honoured, and yet the create form
 * opened with 申请人 empty, reading as "the change did not work".
 *
 * Boundaries pinned here:
 *
 *   1. WITH a known user   → seeded and SUBMITTED (the explicit id equals the
 *      engine's own resolution, by construction)
 *   2. WITHOUT one (no provider / anonymous / role-based provider) → untouched:
 *      empty control, key omitted, the engine resolves at insert — the exact
 *      pre-#5683 contract, and why every older test in
 *      `createDefaults.test.tsx` passes unchanged
 *   3. type gate — the spec allows the token on `user` and `lookup→sys_user`
 *      ONLY (`field.zod` #7127); a token smuggled onto any other field seeds
 *      nothing here, mirroring the validator's refusal
 *   4. `NOW()` / CEL envelopes stay server-owned even with a known user —
 *      form-open time is not insert time, and the client cannot evaluate CEL
 *   5. caller-supplied initial values outrank the seed, same as every other
 *      default
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { schemaDefaultValues, seedCreateValues } from './schemaDefaults';
import { ObjectForm } from './ObjectForm';

registerAllFields();

const USER_ID = 'user-42';

/** The reported shape: a sys_user lookup defaulted to the acting user. */
const OBJECT_SCHEMA = {
  name: 'reimbursement_request',
  fields: {
    title: { type: 'text', label: 'Title' },
    applicant: { type: 'lookup', label: '申请人', reference: 'sys_user', defaultValue: 'current_user' },
    // A second sys_user lookup. It spelled the target `reference_to` until
    // objectui#11070 round 4 retired that spelling; `reference` is the only one read.
    reviewer: { type: 'lookup', label: 'Reviewer', reference: 'sys_user', defaultValue: 'current_user' },
    // The dedicated user field type is the token's other legal home.
    owner_person: { type: 'user', label: 'Owner', defaultValue: 'current_user' },
    // Token on an ILLEGAL type: the engine's validator refuses this authoring;
    // the seeding must not resolve it either.
    supplier: { type: 'lookup', label: 'Supplier', reference: 'account', defaultValue: 'current_user' },
    // The other runtime token stays server-owned even when the user is known.
    filed_at: { type: 'datetime', label: 'Filed at', defaultValue: 'NOW()' },
  },
};

/**
 * Authenticated `/me/permissions` payload for the acting user. The `*` object
 * grant matters: an authenticated payload with NO entry for an object
 * fail-closes `checkField` (#2926 ④) and the form would render zero fields.
 */
const ME_PERMISSIONS = {
  authenticated: true,
  userId: USER_ID,
  tenantId: 't1',
  roles: ['user'],
  permissionSets: [],
  objects: { '*': { allowCreate: true, allowRead: true, allowEdit: true } },
  fields: {},
};

const makeDS = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    create: vi.fn().mockResolvedValue({ id: 'r1' }),
    update: vi.fn().mockResolvedValue({ id: 'r1' }),
    findOne: vi.fn().mockResolvedValue({ id: USER_ID, name: 'Current User' }),
    query: vi.fn().mockResolvedValue({ data: [] }),
  }) as any;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('schemaDefaultValues — current_user resolution (#5683)', () => {
  it('seeds the acting user on the legal field shapes, and ONLY those', () => {
    const seeded = schemaDefaultValues(OBJECT_SCHEMA, { currentUserId: USER_ID });
    expect(seeded.applicant).toBe(USER_ID); // lookup + reference
    expect(seeded.reviewer).toBe(USER_ID); // lookup + reference
    expect(seeded.owner_person).toBe(USER_ID); // type: user
    expect('supplier' in seeded).toBe(false); // illegal type — validator territory
    expect('filed_at' in seeded).toBe(false); // NOW() stays server-owned
    expect('title' in seeded).toBe(false);
  });

  it('seeds nothing without a known user — the pre-#5683 contract', () => {
    expect('applicant' in schemaDefaultValues(OBJECT_SCHEMA)).toBe(false);
    expect('applicant' in schemaDefaultValues(OBJECT_SCHEMA, {})).toBe(false);
    expect('applicant' in schemaDefaultValues(OBJECT_SCHEMA, { currentUserId: null })).toBe(false);
  });

  it('caller-supplied initial values outrank the seed', () => {
    const seeded = seedCreateValues(OBJECT_SCHEMA, { applicant: 'someone-else' }, { currentUserId: USER_ID });
    expect(seeded.applicant).toBe('someone-else');
    expect(seeded.reviewer).toBe(USER_ID);
  });
});

describe('ObjectForm — current_user pre-fill on create (#5683)', () => {
  const renderCreate = (ds: any) =>
    render(
      <MePermissionsProvider initialPermissions={ME_PERMISSIONS as any}>
        <ObjectForm
          schema={{ type: 'object-form', objectName: 'reimbursement_request', mode: 'create' } as any}
          dataSource={ds}
        />
      </MePermissionsProvider>,
    );

  it('submits the seeded acting-user id — the same value the engine would stamp', async () => {
    const ds = makeDS();
    renderCreate(ds);
    await waitFor(() => expect(document.body.querySelector('form')).toBeTruthy());
    const title = document.body.querySelector('input[name="title"]') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Taxi' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0].at(-1);
    expect(payload.applicant).toBe(USER_ID);
    // The illegal-type token and the server-owned NOW() must not be invented.
    expect(payload.supplier ?? undefined).toBeUndefined();
    expect(payload.filed_at ?? undefined).toBeUndefined();
  });

  it('leaves the field empty and omitted without a permission provider', async () => {
    const ds = makeDS();
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'reimbursement_request', mode: 'create' } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(document.body.querySelector('form')).toBeTruthy());
    const title = document.body.querySelector('input[name="title"]') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Taxi' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0].at(-1);
    // Key OMITTED — absence is what makes the engine resolve the token.
    expect('applicant' in payload).toBe(false);
  });
});
