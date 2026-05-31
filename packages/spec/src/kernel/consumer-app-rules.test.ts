// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { ObjectStackManifest } from './manifest.zod';
import {
  validateConsumerAppPurity,
  validateRequiresShape,
  isConsumerInstallable,
} from './consumer-app-rules';

const baseApp: ObjectStackManifest = {
  id: 'com.example.app',
  version: '1.0.0',
  type: 'app',
  name: 'Example App',
  defaultDatasource: 'default',
  scope: 'project',
};

describe('isConsumerInstallable (ADR-0019 D2)', () => {
  it('only app is consumer-installable', () => {
    expect(isConsumerInstallable('app')).toBe(true);
    for (const t of ['plugin', 'driver', 'server', 'ui', 'theme', 'agent', 'objectql', 'module', 'adapter']) {
      expect(isConsumerInstallable(t)).toBe(false);
    }
    expect(isConsumerInstallable(undefined)).toBe(false);
  });
});

describe('validateConsumerAppPurity (ADR-0019 D6)', () => {
  it('a pure-metadata app produces no violations', () => {
    expect(validateConsumerAppPurity(baseApp)).toEqual([]);
  });

  it('ignores non-app packages (purity only applies to consumer units)', () => {
    const driver = { ...baseApp, type: 'driver' as const, contributes: { drivers: [{ id: 'pg', label: 'Postgres' }] } };
    expect(validateConsumerAppPurity(driver)).toEqual([]);
  });

  it('flags code-bearing contributes on an app', () => {
    const withActions = { ...baseApp, contributes: { actions: [{ name: 'doThing' }] } };
    const errs = validateConsumerAppPurity(withActions);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/contributes\.actions/);
  });

  it('flags multiple code surfaces independently', () => {
    const messy = {
      ...baseApp,
      contributes: { drivers: [{ id: 'pg', label: 'PG' }], functions: [{ name: 'distance' }] },
    };
    expect(validateConsumerAppPurity(messy)).toHaveLength(2);
  });

  it('flags capabilities.provides on an app', () => {
    const provider = {
      ...baseApp,
      capabilities: { provides: [{ interfaceId: 'x.interface.y', version: '1.0.0', methods: [] }] },
    } as unknown as ObjectStackManifest;
    const errs = validateConsumerAppPurity(provider);
    expect(errs.some((e) => /capabilities\.provides/.test(e))).toBe(true);
  });

  it('flags bundled runtime plugins via stack code surfaces', () => {
    const errs = validateConsumerAppPurity(baseApp, { pluginCount: 2 });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/runtime 'plugins'/);
  });
});

describe('validateRequiresShape (ADR-0019 D7)', () => {
  it('accepts abstract capability tokens', () => {
    expect(validateRequiresShape(['sql', 'sys.sql', 'blob.s3', 'ai', 'automation'])).toEqual([]);
  });

  it('accepts undefined / empty', () => {
    expect(validateRequiresShape(undefined)).toEqual([]);
    expect(validateRequiresShape([])).toEqual([]);
  });

  it('rejects paths, npm specs, and version pins', () => {
    const bad = ['./local/driver', '@scope/pkg', 'com.x.postgres@^1', 'Sql', 'sys_sql'];
    const errs = validateRequiresShape(bad);
    expect(errs).toHaveLength(bad.length);
  });
});
