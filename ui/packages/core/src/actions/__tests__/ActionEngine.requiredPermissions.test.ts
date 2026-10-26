/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0066 D4 — UI half of the action dual-surface gate. The server is the
 * source of truth (403); the ActionEngine derives the same gate from
 * `action.requiredPermissions` so a button the user can't use is hidden.
 * Fail-OPEN when the user's systemPermissions are unknown.
 */

import { describe, it, expect } from 'vitest';
import { ActionEngine } from '../ActionEngine';

const engineWith = (systemPermissions?: string[]) =>
  new ActionEngine({
    user: systemPermissions === undefined ? { id: 'u1' } : { id: 'u1', systemPermissions },
  } as any);

describe('ActionEngine.getActionsForLocation — ADR-0066 D4 requiredPermissions filter', () => {
  it('shows actions with no requiredPermissions', () => {
    const e = engineWith([]);
    e.registerAction({ name: 'open', type: 'api' } as any, { locations: ['record_section'] });
    expect(e.getActionsForLocation('record_section')).toHaveLength(1);
  });

  it('shows an action whose requiredPermissions are all held', () => {
    const e = engineWith(['manage_platform_settings']);
    e.registerAction({ name: 'issue', type: 'api', requiredPermissions: ['manage_platform_settings'] } as any, { locations: ['record_section'] });
    expect(e.getActionsForLocation('record_section')).toHaveLength(1);
  });

  it('hides an action whose requiredPermissions are NOT all held', () => {
    const e = engineWith(['setup.access']);
    e.registerAction({ name: 'issue', type: 'api', requiredPermissions: ['manage_platform_settings'] } as any, { locations: ['record_section'] });
    expect(e.getActionsForLocation('record_section')).toHaveLength(0);
  });

  it('requires ALL listed capabilities (AND, not OR)', () => {
    const e = engineWith(['a']);
    e.registerAction({ name: 'x', type: 'api', requiredPermissions: ['a', 'b'] } as any, { locations: ['record_section'] });
    expect(e.getActionsForLocation('record_section')).toHaveLength(0);
  });

  it('fails OPEN when systemPermissions is unknown (server still enforces)', () => {
    const e = engineWith(undefined);
    e.registerAction({ name: 'issue', type: 'api', requiredPermissions: ['manage_platform_settings'] } as any, { locations: ['record_section'] });
    expect(e.getActionsForLocation('record_section')).toHaveLength(1);
  });
});
