// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D3] The recycle bin's retention: the host resolver, then
 * `OS_RECYCLE_BIN_RETENTION_DAYS`, then 30 — and a defect in either source
 * refused with the spec's sentence, never read as "purge now" or "keep
 * forever", never replaced by the default.
 */

import { describe, it, expect } from 'vitest';
import { RECYCLE_BIN_DEFAULT_RETENTION_DAYS, recycleBinRetentionRefusal } from '@objectstack/spec/data';
import {
  readRecycleBinRetentionEnv,
  recycleBinPurgeAfter,
  resolveRecycleBinRetentionDays,
} from './retention.js';

const ENV = 'OS_RECYCLE_BIN_RETENTION_DAYS';

describe('resolveRecycleBinRetentionDays: resolver, then the variable, then 30', () => {
  it('answers 30 with no resolver and no variable', () => {
    expect(resolveRecycleBinRetentionDays(undefined, {})).toBe(RECYCLE_BIN_DEFAULT_RETENTION_DAYS);
    expect(RECYCLE_BIN_DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it('answers the variable when the resolver is absent', () => {
    expect(resolveRecycleBinRetentionDays(undefined, { [ENV]: '7' })).toBe(7);
  });

  it('keeps the default for an empty variable', () => {
    expect(resolveRecycleBinRetentionDays(undefined, { [ENV]: '' })).toBe(30);
  });

  it("answers the resolver's days, called with the host's token", () => {
    const seen: Array<string | undefined> = [];
    const days = resolveRecycleBinRetentionDays(
      { resolve: (token) => { seen.push(token); return 90; }, token: 'plan-token' },
      { [ENV]: '7' },
    );
    expect(days).toBe(90);
    expect(seen).toEqual(['plan-token']);
  });

  it('falls through to the variable, then the default, when the resolver answers undefined', () => {
    const settings = { resolve: () => undefined };
    expect(resolveRecycleBinRetentionDays(settings, { [ENV]: '14' })).toBe(14);
    expect(resolveRecycleBinRetentionDays(settings, {})).toBe(30);
  });

  it('calls the resolver with undefined when the host handed no token', () => {
    const seen: unknown[] = [];
    resolveRecycleBinRetentionDays({ resolve: (token) => { seen.push(token); return 1; } }, {});
    expect(seen).toEqual([undefined]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, '7', {}])(
    'refuses a resolver answer of %p with the spec sentence, never the default',
    (answer) => {
      const settings = { resolve: () => answer as unknown as number };
      expect(() => resolveRecycleBinRetentionDays(settings, { [ENV]: '7' }))
        .toThrow(recycleBinRetentionRefusal('resolver', answer));
    },
  );

  it.each(['0', '-3', '1.5', '07', ' 7', 'seven', '7d'])(
    'refuses a variable of %p with the spec sentence, never the default',
    (raw) => {
      expect(() => resolveRecycleBinRetentionDays(undefined, { [ENV]: raw }))
        .toThrow(recycleBinRetentionRefusal('env', raw));
    },
  );

  it('does not read a broken variable when the resolver answers', () => {
    expect(resolveRecycleBinRetentionDays({ resolve: () => 5 }, { [ENV]: '0' })).toBe(5);
  });
});

describe('readRecycleBinRetentionEnv: the boot-time read', () => {
  it('is undefined when unset or empty', () => {
    expect(readRecycleBinRetentionEnv({})).toBeUndefined();
    expect(readRecycleBinRetentionEnv({ [ENV]: '' })).toBeUndefined();
  });

  it('answers the days it holds', () => {
    expect(readRecycleBinRetentionEnv({ [ENV]: '365' })).toBe(365);
  });

  it('refuses zero by name, as a configuration defect', () => {
    expect(() => readRecycleBinRetentionEnv({ [ENV]: '0' }))
      .toThrow(/^OS_RECYCLE_BIN_RETENTION_DAYS is set to "0", which is not a recycle-bin retention/);
  });
});

describe('recycleBinPurgeAfter: the deadline stamped at delete time', () => {
  it('is deleted_at plus whole days, in ISO 8601', () => {
    const deletedAt = new Date('2026-11-06T01:02:03.004Z');
    expect(recycleBinPurgeAfter(deletedAt, 30)).toBe('2026-12-06T01:02:03.004Z');
    expect(recycleBinPurgeAfter(deletedAt, 1)).toBe('2026-11-07T01:02:03.004Z');
  });
});
