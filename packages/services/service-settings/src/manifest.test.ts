// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { settingsObjects } from './manifest.js';

describe('service-settings manifest objects (#4270)', () => {
  it('owns exactly the K/V store and its audit trail', () => {
    expect(settingsObjects.map((o: any) => o.name)).toEqual(['sys_setting', 'sys_setting_audit']);
  });

  /**
   * #4270 pin against double registration: `sys_secret` moved to
   * `PlatformObjectsPlugin` (its producers span settings, the engine's
   * `secret`-field encryption, and the datasource credential binder — and the
   * engine fails closed without the store). #4236 flagged "same object
   * registered twice" as behaviour to avoid; the move REPLACED this
   * registration, it did not add a second one. Re-adding SysSecret here would
   * recreate exactly that conflict.
   */
  it('does not (re-)register sys_secret — that is PlatformObjectsPlugin material', () => {
    expect(settingsObjects.map((o: any) => o.name)).not.toContain('sys_secret');
  });
});
