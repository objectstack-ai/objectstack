// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13993] The publish idempotency window, driven through every `created_at`
 * materialisation a driver actually hands out of the record read door.
 *
 * The defect: `DbQueueAdapter#publish` compared
 * `String(row.created_at) >= windowStart` — lexicographic text against
 * canonical ISO text. On Postgres/MySQL the builtin audit column `created_at`
 * comes back as a JS `Date` (pinned in `driver-sql`'s
 * `sql-driver-13567-audit-stamp-materialisation.test.ts`), whose `String()`
 * starts with a weekday LETTER (0x41–0x5A), unconditionally above the ISO
 * text's leading digit `'2'` (0x32) — so the predicate was TRUE for every
 * terminal row, the window never expired, and `publish()` returned the old id
 * having enqueued nothing: silent message loss on the production default
 * drivers. SQLite hands back ISO-Z text on both sides, so the SQLite arm was
 * always correct — which is why every existing test stayed green, and why the
 * ISO cases below are the CONTROL group: they must keep passing unchanged.
 *
 * The discriminating `Date` input exists in CI only inside
 * `@objectstack/driver-sql` today (#13973 point 4), so this pin lives in THIS
 * package driving hand-made `Date`s — deliberately NOT by widening any
 * required job's package set (#13567, maintainer decision).
 *
 * Assertions are DIRECTIONAL, not literal: out-of-window must stop blocking,
 * in-window must keep blocking, and `pending`/`running` rows must block
 * regardless of age (that arm bypasses the time compare entirely).
 */

import { describe, it, expect } from 'vitest';
import { DbQueueAdapter } from './db-queue-adapter.js';

/** Minimal engine double — only the surface `publish()` touches. */
function makeFakeEngine(seed: any[] = []) {
  const rows: any[] = [...seed];
  return {
    rows,
    async find(_table: string, opts: any = {}) {
      let out = opts?.where
        ? rows.filter((r) => Object.entries(opts.where).every(([k, v]) => r[k] === v))
        : [...rows];
      if (opts?.limit) out = out.slice(0, opts.limit);
      return out;
    },
    async insert(_table: string, data: any) {
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(): Promise<never> {
      throw new Error('not reachable from publish()');
    },
    async delete(): Promise<never> {
      throw new Error('not reachable from publish()');
    },
  };
}

/** Frozen "now" so window edges are deterministic. */
const NOW_MS = Date.parse('2026-08-30T10:00:00.000Z');
const WINDOW_MS = 60_000;

function makeAdapter(seed: any[]) {
  const engine = makeFakeEngine(seed);
  const adapter = new DbQueueAdapter({
    engine,
    clock: { now: () => new Date(NOW_MS) },
    options: { autoStart: false, idempotencyWindowMs: WINDOW_MS },
  });
  return { engine, adapter };
}

function terminalRow(id: string, status: 'completed' | 'dlq', createdAt: unknown) {
  return {
    id,
    queue: 'q',
    idempotency_key: 'k',
    status,
    created_at: createdAt,
  };
}

describe('[#13993] publish idempotency window vs created_at materialisation', () => {
  describe('Date side (Postgres/MySQL/Mongo hand the audit column back as a JS Date)', () => {
    it('an OUT-OF-WINDOW terminal Date row no longer blocks — publish enqueues a NEW message', async () => {
      // Pre-fix this row blocked FOREVER: String(Date) begins with a weekday
      // letter, lexicographically above the ISO windowStart's digit.
      const { engine, adapter } = makeAdapter([
        terminalRow('row_old', 'completed', new Date(NOW_MS - 2 * WINDOW_MS)),
      ]);
      const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(id).not.toBe('row_old');
      const inserted = engine.rows.find((r) => r.id === id);
      expect(inserted).toBeDefined();
      expect(inserted.status).toBe('pending');
      expect(engine.rows).toHaveLength(2);
    });

    it('an IN-WINDOW terminal Date row still blocks — old id back, nothing enqueued', async () => {
      const { engine, adapter } = makeAdapter([
        terminalRow('row_recent', 'dlq', new Date(NOW_MS - WINDOW_MS / 2)),
      ]);
      const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(id).toBe('row_recent');
      expect(engine.rows).toHaveLength(1);
    });
  });

  describe('ISO-text side (SQLite/turso/wasm/memory status quo — the CONTROL group)', () => {
    // The lexicographic compare was CORRECT on ISO-Z text (order = chronology).
    // These two must hold before AND after the fix; a red here is a regression
    // in the only arm that ever worked.
    it('an OUT-OF-WINDOW terminal ISO row does not block (as it never did on SQLite)', async () => {
      const { engine, adapter } = makeAdapter([
        terminalRow('row_old_iso', 'completed', new Date(NOW_MS - 2 * WINDOW_MS).toISOString()),
      ]);
      const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(id).not.toBe('row_old_iso');
      expect(engine.rows).toHaveLength(2);
    });

    it('an IN-WINDOW terminal ISO row still blocks', async () => {
      const { engine, adapter } = makeAdapter([
        terminalRow('row_recent_iso', 'completed', new Date(NOW_MS - WINDOW_MS / 2).toISOString()),
      ]);
      const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(id).toBe('row_recent_iso');
      expect(engine.rows).toHaveLength(1);
    });
  });

  describe('epoch-ms number (pre-canonical / hand-migrated SQLite column)', () => {
    it('windowed verdicts hold for a numeric created_at too', async () => {
      const outOfWindow = makeAdapter([
        terminalRow('row_old_num', 'completed', NOW_MS - 2 * WINDOW_MS),
      ]);
      const idA = await outOfWindow.adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(idA).not.toBe('row_old_num');

      const inWindow = makeAdapter([
        terminalRow('row_recent_num', 'completed', NOW_MS - WINDOW_MS / 2),
      ]);
      const idB = await inWindow.adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(idB).toBe('row_recent_num');
    });
  });

  describe('reverse control: the non-terminal arm bypasses the time compare', () => {
    // pending/running block REGARDLESS of age — prove the fix did not narrow
    // that arm. Both materialisations, both statuses, absurdly old stamps.
    it('a pending row blocks however old, Date and ISO alike', async () => {
      for (const createdAt of [
        new Date(NOW_MS - 1000 * WINDOW_MS),
        new Date(NOW_MS - 1000 * WINDOW_MS).toISOString(),
      ]) {
        const { engine, adapter } = makeAdapter([
          { id: 'row_pending', queue: 'q', idempotency_key: 'k', status: 'pending', created_at: createdAt },
        ]);
        const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
        expect(id).toBe('row_pending');
        expect(engine.rows).toHaveLength(1);
      }
    });

    it('a running row blocks however old, Date and ISO alike', async () => {
      for (const createdAt of [
        new Date(NOW_MS - 1000 * WINDOW_MS),
        new Date(NOW_MS - 1000 * WINDOW_MS).toISOString(),
      ]) {
        const { engine, adapter } = makeAdapter([
          { id: 'row_running', queue: 'q', idempotency_key: 'k', status: 'running', created_at: createdAt },
        ]);
        const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
        expect(id).toBe('row_running');
        expect(engine.rows).toHaveLength(1);
      }
    });
  });

  describe('a created_at that denotes no instant', () => {
    it('cannot be inside a window measured on the created_at axis — does not block', async () => {
      // Documented decision (createdAtInstantMs): duplicate delivery is
      // tolerated by contract; "suppress forever" is the defect. Pre-fix this
      // very value DID block forever ('n' is above '2' lexicographically).
      const { engine, adapter } = makeAdapter([
        terminalRow('row_opaque', 'completed', 'not-an-instant'),
      ]);
      const id = await adapter.publish('q', { x: 1 }, { idempotencyKey: 'k' });
      expect(id).not.toBe('row_opaque');
      expect(engine.rows).toHaveLength(2);
    });
  });
});
