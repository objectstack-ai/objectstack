// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchemaRegistry, REGISTRY_LOG_LEVELS } from './registry';

/**
 * #3420 — the registry's expected-but-noisy housekeeping (re-registering an
 * owned object, overwriting a package manifest on a rebuild / HMR / multi-project
 * seed-replay) must NOT reach a stock `os dev` boot log. It used to be emitted
 * via `console.warn` (always on) and looked like an error, though it is a normal
 * path. It is now emitted at `debug`, so it stays out of the default `info` level
 * but `OS_REGISTRY_LOG=debug` (or `{ logLevel: 'debug' }`) makes it discoverable.
 *
 * This is the regression guard: if either line ever regresses back to `warn`
 * (or to the always-on `log`/`console.log`), the "silent at info" assertions
 * fail — keeping the official examples' boot log clean.
 */
describe('SchemaRegistry log-level gating (#3420)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  beforeEach(() => { warn.mockClear(); debug.mockClear(); });
  afterEach(() => { delete process.env.OS_REGISTRY_LOG; });

  const reRegisterSameOwner = (r: SchemaRegistry) => {
    r.registerObject({ name: 'sys_thing', fields: {} } as any, 'com.acme.app', 'sys', 'own');
    r.registerObject({ name: 'sys_thing', fields: {} } as any, 'com.acme.app', 'sys', 'own');
  };

  it('at the default (info) level, re-registering an owned object is silent — no warn, no debug', () => {
    const r = new SchemaRegistry({ multiTenant: false });
    reRegisterSameOwner(r);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Re-registering owned object'));
    expect(debug).not.toHaveBeenCalledWith(expect.stringContaining('Re-registering owned object'));
  });

  it('at debug level, the re-register line is emitted via console.debug (never console.warn)', () => {
    const r = new SchemaRegistry({ multiTenant: false, logLevel: 'debug' });
    reRegisterSameOwner(r);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Re-registering owned object: sys_thing'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Re-registering owned object'));
  });

  it('overwriting a package manifest is debug-gated the same way', () => {
    const manifest = { id: 'com.test', name: 'Test', namespace: 'test', version: '1.0.0' } as any;

    const info = new SchemaRegistry({ multiTenant: false });
    info.installPackage(manifest);
    info.installPackage(manifest); // same-package reload → "Overwriting package"
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Overwriting package'));
    expect(debug).not.toHaveBeenCalledWith(expect.stringContaining('Overwriting package'));

    debug.mockClear();
    const dbg = new SchemaRegistry({ multiTenant: false, logLevel: 'debug' });
    dbg.installPackage(manifest);
    dbg.installPackage(manifest);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Overwriting package: com.test'));
  });

  it('resolves the level from OS_REGISTRY_LOG when no explicit option is given', () => {
    process.env.OS_REGISTRY_LOG = 'debug';
    expect(new SchemaRegistry({ multiTenant: false }).logLevel).toBe('debug');
  });

  it('falls back to info for an unrecognized OS_REGISTRY_LOG value', () => {
    process.env.OS_REGISTRY_LOG = 'chatty';
    expect(new SchemaRegistry({ multiTenant: false }).logLevel).toBe('info');
  });

  it('an explicit logLevel option wins over the env var', () => {
    process.env.OS_REGISTRY_LOG = 'debug';
    expect(new SchemaRegistry({ multiTenant: false, logLevel: 'silent' }).logLevel).toBe('silent');
  });

  it('exposes the full level vocabulary for validation', () => {
    expect(REGISTRY_LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error', 'silent']);
  });
});
