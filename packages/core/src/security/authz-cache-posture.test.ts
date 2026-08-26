// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  AUTHZ_GRANTS_CACHE_TTL_ENV,
  readAuthzGrantsCacheTtlMs,
  reportAuthzCachePosture,
  resolveAuthzCachePosture,
  type AuthzInvalidationBusState,
} from './authz-cache-posture.js';

/**
 * #11968 — the boot-time posture statement, pinned on BOTH arms.
 *
 * The acceptance criterion of the substrate card is a biconditional: the line
 * appears **exactly when** a cache flag is on without a bus, **and not
 * otherwise**. Each arm alone is passed by a broken implementation — "appears"
 * alone is satisfied by one that prints always, "silent" alone by one that
 * never prints — so both are asserted here, and the exhaustive matrix below is
 * what makes "exactly when" a measured claim rather than a described one.
 */

const BUS_STATES: AuthzInvalidationBusState[] = ['bridged', 'in-process', 'absent'];

function makeSink() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe('#11968 authz cache posture — the loud arm', () => {
  it('warns when a cache is enabled and NO cluster service is registered', () => {
    const sink = makeSink();
    const statement = reportAuthzCachePosture({ ttlMs: 5000, bus: 'absent' }, sink);

    expect(statement.posture).toBe('ttl-only');
    expect(statement.loud).toBe(true);
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.info).not.toHaveBeenCalled();
  });

  it('warns when a cluster service exists but its driver is in-process', () => {
    // The case that would otherwise slip through: `Runtime` registers the
    // memory driver by DEFAULT, so "is a cluster service registered?" answers
    // yes while the bus fans out to nobody.
    const sink = makeSink();
    const statement = reportAuthzCachePosture(
      { ttlMs: 5000, bus: 'in-process', driver: 'memory' },
      sink,
    );

    expect(statement.posture).toBe('ttl-only');
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.warn.mock.calls[0][0]).toContain('memory');
  });

  it('the loud line names the window, the remedy and that it is not an error', () => {
    // A warning nobody can act on gets muted, and a warning that reads as a
    // failure gets "fixed" by turning the cache off. Both halves are content.
    const { message } = resolveAuthzCachePosture({ ttlMs: 7500, bus: 'absent' });

    expect(message).toContain('7500ms');
    expect(message).toContain(AUTHZ_GRANTS_CACHE_TTL_ENV);
    expect(message).toMatch(/not an error/i);
    expect(message).toContain('#4785');
  });
});

describe('#11968 authz cache posture — the silent arm', () => {
  it.each(BUS_STATES)(
    'says NOTHING when the cache is disabled (ttl=0, bus=%s)',
    (bus) => {
      const sink = makeSink();
      const statement = reportAuthzCachePosture({ ttlMs: 0, bus }, sink);

      expect(statement.posture).toBe('disabled');
      expect(statement.message).toBe('');
      expect(sink.warn).not.toHaveBeenCalled();
      expect(sink.info).not.toHaveBeenCalled();
    },
  );

  it('does not warn when the cache is enabled AND the bus is bridged', () => {
    const sink = makeSink();
    const statement = reportAuthzCachePosture(
      { ttlMs: 5000, bus: 'bridged', driver: 'redis' },
      sink,
    );

    expect(statement.posture).toBe('bus-narrowed');
    expect(statement.loud).toBe(false);
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.info).toHaveBeenCalledTimes(1);
  });

  it('a negative TTL is off, not a degenerate enabled cache', () => {
    const sink = makeSink();
    expect(reportAuthzCachePosture({ ttlMs: -1, bus: 'absent' }, sink).posture).toBe(
      'disabled',
    );
    expect(sink.warn).not.toHaveBeenCalled();
  });
});

describe('#11968 authz cache posture — "exactly when", as a matrix', () => {
  // The biconditional itself. Enumerated rather than described, so an
  // implementation that prints always or never fails here and not only in prose.
  const ttls = [0, 1, 5000];
  const expectedLoud = new Set(['1|in-process', '1|absent', '5000|in-process', '5000|absent']);

  for (const ttlMs of ttls) {
    for (const bus of BUS_STATES) {
      const key = `${ttlMs}|${bus}`;
      const shouldBeLoud = expectedLoud.has(key);
      it(`ttl=${ttlMs} bus=${bus} -> ${shouldBeLoud ? 'LOUD' : 'quiet'}`, () => {
        const sink = makeSink();
        reportAuthzCachePosture({ ttlMs, bus, driver: 'memory' }, sink);
        expect(sink.warn.mock.calls.length > 0).toBe(shouldBeLoud);
      });
    }
  }
});

describe('#11968 grants-cache TTL reading', () => {
  it('defaults to 0 — the cache is off unless a deployment turns it on', () => {
    expect(readAuthzGrantsCacheTtlMs({})).toEqual({ ttlMs: 0, malformed: false });
  });

  it('an explicit 0 is a real path, not a degenerate TTL', () => {
    expect(readAuthzGrantsCacheTtlMs({ [AUTHZ_GRANTS_CACHE_TTL_ENV]: '0' })).toEqual({
      ttlMs: 0,
      raw: '0',
      malformed: false,
    });
  });

  it('reads a millisecond count', () => {
    expect(
      readAuthzGrantsCacheTtlMs({ [AUTHZ_GRANTS_CACHE_TTL_ENV]: ' 5000 ' }).ttlMs,
    ).toBe(5000);
  });

  it('a malformed value is reported as malformed, never folded into "off"', () => {
    // `5OOO` with letter O resolving silently to "disabled" is the same
    // silent-disable class the posture statement exists to prevent.
    const reading = readAuthzGrantsCacheTtlMs({
      [AUTHZ_GRANTS_CACHE_TTL_ENV]: '5OOO',
    });
    expect(reading).toEqual({ ttlMs: 0, raw: '5OOO', malformed: true });

    const sink = makeSink();
    reportAuthzCachePosture(
      { ttlMs: reading.ttlMs, bus: 'absent', malformedTtl: { raw: reading.raw } },
      sink,
    );
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.warn.mock.calls[0][0]).toContain(AUTHZ_GRANTS_CACHE_TTL_ENV);
  });

  it('a negative value is malformed, not a clamp', () => {
    expect(
      readAuthzGrantsCacheTtlMs({ [AUTHZ_GRANTS_CACHE_TTL_ENV]: '-5' }).malformed,
    ).toBe(true);
  });
});
