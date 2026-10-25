/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * approverValueSources — reading the spec's registry binding,
 * `{ source: 'registry', type }` (objectstack#22710), structurally
 * (objectui#7611 Q3b).
 *
 * The readers' behaviour under that binding is pinned where it renders:
 * `approverIdentity.registryBinding-7611.test.tsx` and the two
 * `FlowReferenceField.*-7611.test.tsx` files. This file pins the reading
 * itself. It carried the reminder the ruling asked for — the type loosening in
 * `approverValueSources.ts` goes when objectui moves to spec 18 — and that move
 * (objectui#12030) took the loosening out.
 */

import { describe, it, expect } from 'vitest';
import { APPROVER_VALUE_SOURCES } from '@objectstack/spec/automation';
import {
  APPROVER_REGISTRY_TYPES,
  registryTypesOf,
  registryValueSourceOf,
} from './approverValueSources';

describe('registryValueSourceOf (objectui#7611 Q3b)', () => {
  it('reads the registry member', () => {
    expect(registryValueSourceOf({ source: 'registry', type: 'position' })).toEqual({
      source: 'registry',
      type: 'position',
    });
  });

  it('refuses a registry entry with no usable type, and every other member', () => {
    expect(registryValueSourceOf({ source: 'registry' })).toBeUndefined();
    expect(registryValueSourceOf({ source: 'registry', type: '' })).toBeUndefined();
    expect(registryValueSourceOf({ source: 'data', object: 'sys_position', valueField: 'name' })).toBeUndefined();
    expect(registryValueSourceOf({ source: 'enum', values: ['owner'] })).toBeUndefined();
    expect(registryValueSourceOf(undefined)).toBeUndefined();
  });
});

describe('registryTypesOf (objectui#7611 Q3b)', () => {
  it('maps every registry-bound kind to its type and nothing else', () => {
    // The shape objectstack#22710 publishes: `position` on the registry, the
    // directory kinds on data rows.
    expect(
      registryTypesOf({
        user: { source: 'data', object: 'sys_user', valueField: 'id' },
        position: { source: 'registry', type: 'position' },
        team: { source: 'data', object: 'sys_team', valueField: 'id' },
        manager: { source: 'auto' },
      }),
    ).toEqual({ position: 'position' });
  });
});

describe('the installed spec publishes the registry binding itself (objectui#7611 Q3b, objectui#12030)', () => {
  it('binds `position` to the registry, and nothing else', () => {
    // The tripwire that stood here ("the installed spec binds nothing to the
    // registry yet") went red on the move to `@objectstack/spec` 18, as it said
    // it would: the widening it guarded is gone from approverValueSources.ts,
    // which reads `APPROVER_VALUE_SOURCES` directly now.
    expect(APPROVER_REGISTRY_TYPES).toEqual({ position: 'position' });
    expect(APPROVER_VALUE_SOURCES.position).toEqual({ source: 'registry', type: 'position' });
  });
});
