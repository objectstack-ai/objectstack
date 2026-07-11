// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveTelemetryDbPath } from './telemetry-datasource.js';

describe('resolveTelemetryDbPath (ADR-0057 §3.6)', () => {
  it('derives a sibling file next to a file-backed dev primary', () => {
    expect(resolveTelemetryDbPath({ primaryPath: '/p/.objectstack/data/dev.db', env: {}, dev: true }))
      .toBe('/p/.objectstack/data/dev.telemetry.db');
    expect(resolveTelemetryDbPath({ primaryPath: './app.sqlite', env: {}, dev: true }))
      .toBe('./app.telemetry.sqlite');
    expect(resolveTelemetryDbPath({ primaryPath: 'data/store', env: {}, dev: true }))
      .toBe('data/store.telemetry.db');
  });

  it('never derives one for in-memory primaries', () => {
    expect(resolveTelemetryDbPath({ primaryPath: ':memory:', env: {}, dev: true })).toBeUndefined();
    expect(resolveTelemetryDbPath({ primaryPath: '', env: {}, dev: true })).toBeUndefined();
  });

  it('is opt-in outside dev', () => {
    expect(resolveTelemetryDbPath({ primaryPath: '/srv/prod.db', env: {}, dev: false })).toBeUndefined();
    expect(
      resolveTelemetryDbPath({ primaryPath: '/srv/prod.db', env: { OS_TELEMETRY_DB: '/srv/prod.telemetry.db' }, dev: false }),
    ).toBe('/srv/prod.telemetry.db');
  });

  it('OS_TELEMETRY_DB=0|false|off opts out entirely, even in dev', () => {
    for (const off of ['0', 'false', 'off', 'OFF']) {
      expect(resolveTelemetryDbPath({ primaryPath: '/p/dev.db', env: { OS_TELEMETRY_DB: off }, dev: true })).toBeUndefined();
    }
  });

  it('an explicit OS_TELEMETRY_DB path wins over derivation and strips url prefixes', () => {
    expect(
      resolveTelemetryDbPath({ primaryPath: '/p/dev.db', env: { OS_TELEMETRY_DB: 'file:/tmp/t.db' }, dev: true }),
    ).toBe('/tmp/t.db');
  });
});
