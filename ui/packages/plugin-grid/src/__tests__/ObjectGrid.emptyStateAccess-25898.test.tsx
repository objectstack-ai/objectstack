/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#25898 — an empty `object-grid` tells "no records you can see"
 * and "nothing of yours yet" apart from "no records", the way `ListEmptyState`
 * (plugin-list) does and in the same `list.*` words.
 *
 * - No filter and a caller KNOWN not to hold the create grant (the `listNew`
 *   row, asked once permissions have loaded): "No records you can see", never
 *   the first-run invitation to create.
 * - A declared filter naming the signed-in user (resolved to the caller's id,
 *   or the `{current_user_id}` placeholder): "Nothing of yours yet", not "No
 *   records match this view's filter".
 *
 * SUITE DIRECTION, predicted before running: the read-only and "my" cases are
 * RED against the base commit; the create-grant, no-provider and
 * plain-filter controls are green in both worlds.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterScopeProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
// Registers `object-grid`, the block under test.
import { ObjectGridRenderer } from '../index';

afterEach(cleanup);

const OBJECT = 'crm_case';
const USER = 'u-rep';

const READ_ONLY = { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false };
const FULL = { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true };

const envelope = (bits: Record<string, boolean>): MePermissionsAuthenticatedResponse => ({
  authenticated: true,
  userId: USER,
  tenantId: null,
  hasAnyQueue: false,
  positions: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits },
  fields: {},
});

const grid = (extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: OBJECT,
  columns: ['name'],
  data: { provider: 'value', items: [] },
  ...extra,
});

function mount(schema: Record<string, unknown>, bits?: Record<string, boolean>, currentUserId?: string) {
  let tree: React.ReactNode = <ObjectGridRenderer schema={schema} />;
  if (currentUserId) tree = <FilterScopeProvider currentUserId={currentUserId}>{tree}</FilterScopeProvider>;
  if (bits) tree = <MePermissionsProvider initialPermissions={envelope(bits)}>{tree}</MePermissionsProvider>;
  return render(<>{tree}</>);
}

const emptyState = () => screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });

describe('an empty object-grid says what the caller may see and do (objectstack#25898)', () => {
  it('no filter, no create grant: "No records you can see", never the first-run invitation', async () => {
    mount(grid(), READ_ONLY);
    const state = await emptyState();
    expect(state.querySelector('h3')).toHaveTextContent('No records you can see');
    expect(state).toHaveTextContent('ask your administrator');
    expect(state).not.toHaveTextContent('Create your first record');
  });

  it('CONTROL: no filter, the create grant: the first-run copy as before', async () => {
    mount(grid(), FULL);
    const state = await emptyState();
    expect(state.querySelector('h3')).toHaveTextContent('Nothing here yet');
  });

  it('CONTROL: no permission provider: the first-run copy as before (fail-open)', async () => {
    mount(grid());
    const state = await emptyState();
    expect(state.querySelector('h3')).toHaveTextContent('Nothing here yet');
  });

  it('a filter resolved to the caller\'s id: "Nothing of yours yet"', async () => {
    mount(grid({ filter: [['owner', '=', '{current_user_id}']] }), FULL, USER);
    const state = await emptyState();
    expect(state.querySelector('h3')).toHaveTextContent('Nothing of yours yet');
    expect(state).not.toHaveTextContent('No records match this view');
  });

  it('CONTROL: a filter about something else keeps the view-filter copy', async () => {
    mount(grid({ filter: [['status', '=', 'open']] }), FULL, USER);
    const state = await emptyState();
    expect(state.querySelector('h3')).toHaveTextContent('No matching records');
  });
});
