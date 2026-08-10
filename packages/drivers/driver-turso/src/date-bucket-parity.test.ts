// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Date-bucket parity for TursoDriver (framework#3773, gate from framework#3813).
 *
 * A driver that advertises `supports.queryDateGranularity[g]` tells
 * `engine.aggregate` it may push that granularity down as SQL rather than
 * fetching rows and bucketing them in JS. The two then have to agree, because
 * the engine picks between them per query. `checkDateBucketParity` compares the
 * driver's pushed-down result against the REAL `applyInMemoryAggregation` over
 * the driver's own `find()` rows.
 *
 * Why this matters HERE and not only in the framework: TursoDriver extends
 * SqlDriver, so in local/replica mode it inherits `buildDateBucketExpr` and the
 * SQLite datetime storage convention along with it. That convention CHANGED in
 * framework#3912 ("give `Field.datetime` one UTC storage form per dialect"):
 * SQLite now stores a `Field.datetime` as canonical ISO TEXT
 * (`YYYY-MM-DDTHH:MM:SS.sssZ`), not the old INTEGER epoch ms. That retires the
 * framework#3773 hazard at its root for SQLite — `strftime` parses ISO TEXT
 * natively, so a `Field.datetime` can no longer be misread as a Julian day and
 * bucketed to NULL — and the precondition below now pins the NEW canonical form
 * so this suite still can't pass vacuously.
 *
 * What each mode is worth is stated explicitly below, because the honest answer
 * differs per mode and a vacuous pass must not read as coverage.
 */

import { describe, it, expect } from 'vitest';
import { checkDateBucketParity } from '@objectstack/verify';
import { TursoDriver } from './turso-driver.js';

describe('TursoDriver date-bucket parity (framework#3773)', () => {
  describe('local mode — the real check', () => {
    it('buckets identically pushed-down and in-memory, on both storage forms', async () => {
      // Local/replica keeps SqlDriver's native bucketing, so every granularity
      // it advertises is genuinely exercised here: `Field.datetime` (canonical
      // ISO TEXT since framework#3912) and `Field.date` (ISO TEXT) under one
      // probe object, compared against the in-memory reference at every
      // advertised granularity.
      const driver = new TursoDriver({ url: ':memory:' });
      expect(driver.transportMode).toBe('local');

      const problems = await checkDateBucketParity(driver, {
        createOptions: { bypassTenantAudit: true },
      });
      expect(problems).toEqual([]);
    });

    it('stores a Field.datetime in the canonical UTC form for SQLite (ISO TEXT, framework#3912) — the precondition', async () => {
      // Without this the suite above could be green for the wrong reason: it
      // pins the actual on-disk storage form so a driver/framework change that
      // silently altered it would fail HERE rather than letting the parity
      // check pass over a shape it no longer exercises. framework#3912 gave
      // `Field.datetime` one canonical UTC storage form per dialect — ISO TEXT
      // (`YYYY-MM-DDTHH:MM:SS.sssZ`) on SQLite, replacing the old ambiguous
      // INTEGER-epoch-vs-TEXT mix. `strftime` parses that text natively, which
      // is exactly why the framework#3773 all-NULL-buckets hazard no longer
      // applies to datetime on SQLite.
      const driver = new TursoDriver({ url: ':memory:' });
      try {
        await driver.syncSchema('bucket_storage_probe', {
          name: 'bucket_storage_probe',
          fields: { at: { type: 'datetime' } },
        });
        await driver.create(
          'bucket_storage_probe',
          { id: 'p1', at: new Date('2026-01-10T09:00:00Z') },
          { bypassTenantAudit: true },
        );
        const res: any = await driver.execute(
          `SELECT typeof("at") AS t FROM "bucket_storage_probe" WHERE id = 'p1'`,
        );
        const row = Array.isArray(res) ? res[0] : (res?.rows?.[0] ?? res);
        // framework#3912: canonical UTC storage for SQLite datetime is ISO TEXT.
        expect(row.t).toBe('text');
      } finally {
        await driver.disconnect?.();
      }
    });

    it('advertises something for the check to have bitten on', async () => {
      // Guards the test above from going quiet: if local ever stopped
      // advertising granularities, `checkDateBucketParity` would skip every one
      // of them and pass vacuously — the same silence this whole family of bugs
      // hides in.
      const driver = new TursoDriver({ url: ':memory:' });
      const caps = driver.supports.queryDateGranularity ?? {};
      expect(Object.entries(caps).filter(([, v]) => v === true).length).toBeGreaterThan(0);
      await driver.disconnect?.();
    });
  });

  describe('remote mode — what this does and does not prove', () => {
    it('advertises NO granularity, so the engine never pushes bucketing down here', () => {
      // Remote delegates aggregate() to RemoteTransport, which takes only string
      // group-by identifiers and has no bucketing — so it correctly advertises
      // nothing, and `engine.aggregate` always falls back to find() + in-memory
      // bucketing, which the contract guarantees is correct.
      //
      // `checkDateBucketParity` is deliberately NOT run here. It skips every
      // granularity a driver does not advertise, so against remote it would
      // return `[]` without comparing anything — a pass that looks like
      // coverage and is not. (Setting its probe up over the remote transport
      // would need a live Turso database, which no unit test has.) What
      // actually guards remote is this capability assertion plus the tripwire
      // below.
      const driver = new TursoDriver({ url: 'libsql://test-db.turso.io', authToken: 'test-token' });
      expect(driver.transportMode).toBe('remote');
      expect(driver.supports.queryDateGranularity).toEqual({});
    });

    it('the checker WOULD catch a driver that advertises a granularity it cannot run', async () => {
      // The tripwire the vacuous pass above is worth having. Rather than mock a
      // remote transport into life, this drives a real local driver and makes it
      // advertise `week` — which SqlDriver deliberately does NOT implement on
      // SQLite (`%V` needs 3.46+), so `aggregate()` throws exactly as
      // RemoteTransport would on a structured groupBy.
      //
      // So: if someone deletes remote's `queryDateGranularity: {}` override
      // believing SqlDriver handles it, this is the shape of failure they get —
      // named, not silent.
      const driver = new TursoDriver({ url: ':memory:' });
      Object.defineProperty(driver, 'supports', {
        get: () => ({ queryDateGranularity: { week: true } }),
        configurable: true,
      });

      const problems = await checkDateBucketParity(driver, {
        createOptions: { bypassTenantAudit: true },
      });
      expect(problems.join('\n')).toMatch(/advertises this granularity but aggregate\(\) threw/);
      expect(problems.join('\n')).toMatch(/week/);
    });
  });
});
