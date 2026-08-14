// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4556 — `sys_metadata_history.recorded_by` stores an id or NULL, never a
 * sentinel string, and the read paths surface that NULL as `null`.
 *
 * Two halves, and they fail for different reasons if either regresses:
 *
 *  - **write**: an actor-less write must land SQL NULL. `undefined` is not
 *    good enough to assert on — a driver that drops undefined keys and one
 *    that writes them are indistinguishable at the row level — so the
 *    repository normalises to `null` and these tests pin `toBeNull()`.
 *  - **read**: the two read paths used to render an absent actor as the
 *    string `'unknown'`, which is the same declared-≠-actual defect pointed
 *    the other way: an audit timeline showing "changed by unknown" cannot be
 *    told apart from a real user id, and no consumer can resolve it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row { [k: string]: unknown }

/**
 * Minimal engine fake. Deliberately stores exactly what it is handed — no
 * key-dropping, no coercion — so `recorded_by: null` and a missing
 * `recorded_by` are distinguishable in the assertions below.
 */
function makeFakeEngine() {
  const rows = new Map<string, Row>();
  const historyRows: Row[] = [];

  const keyOf = (w: Record<string, unknown>) =>
    `${String(w.type)}|${String(w.name)}|${String(w.organization_id ?? 'null')}|${String(w.state ?? 'active')}`;

  const findRow = (where: Record<string, unknown>) => {
    if (where.id !== undefined) {
      for (const [k, r] of rows) if (r.id === where.id) return { key: k, row: r };
      return null;
    }
    const k = keyOf(where);
    const r = rows.get(k);
    return r ? { key: k, row: r } : null;
  };

  const matchesHistory = (h: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return v === undefined || h[k] === v;
    });

  return {
    rows,
    historyRows,
    async find(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows.filter((h) => matchesHistory(h, opts.where));
      return Array.from(rows.values()).filter((r) => {
        if (opts.where.type && r.type !== opts.where.type) return false;
        if (opts.where.organization_id !== undefined && r.organization_id !== opts.where.organization_id) return false;
        if (opts.where.state && r.state !== opts.where.state) return false;
        return true;
      });
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
      return findRow(opts.where)?.row ?? null;
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_history') {
        const h: Row = { ...data };
        if (!h.id) h.id = `h_${historyRows.length + 1}`;
        historyRows.push(h);
        return { id: h.id as string };
      }
      const k = keyOf(data);
      const row: Row = { id: `r_${rows.size + 1}`, ...data };
      rows.set(k, row);
      return { id: row.id as string };
    },
    async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      const found = findRow(opts.where);
      if (!found) throw new Error('not found');
      rows.set(found.key, { ...found.row, ...data });
      return { id: found.row.id as string };
    },
    async delete(_t: string, opts: { where: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      const found = findRow(opts.where);
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> { return cb(undefined, { owned: true }); },
  };
}

const view = (label: string) => ({ name: 'case_grid', label, object: 'case', columns: [{ field: 'name' }] });

describe('#4556 — recorded_by holds a user id or NULL, never a sentinel', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine, organizationId: 'org_alpha', orgLabel: 'org_alpha' });
  });

  it('put with actor: null writes SQL NULL — not "system", not any other string', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: null });

    expect(engine.historyRows).toHaveLength(1);
    const row = engine.historyRows[0]!;
    // The point of the issue: a lookup('sys_user') column must not hold a
    // value that resolves to no user row.
    expect(row.recorded_by).toBeNull();
    expect(typeof row.recorded_by).not.toBe('string');
    expect(row.recorded_by).not.toBe('system');
  });

  it('put with a real actor still stores the id verbatim', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    expect(engine.historyRows[0]!.recorded_by).toBe('usr_alice');
  });

  it('delete with actor: null writes a tombstone whose recorded_by is NULL', async () => {
    const first = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    await repo.delete(ref, { parentVersion: first.version, actor: null });

    const tombstone = engine.historyRows.find((h) => h.operation_type === 'delete')!;
    expect(tombstone).toBeDefined();
    expect(tombstone.recorded_by).toBeNull();
  });

  it('history() surfaces an actor-less event as actor: null — never the string "unknown"', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: null });

    const events = [];
    for await (const e of repo.history(ref)) events.push(e);

    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBeNull();
    // 'unknown' is indistinguishable from a user id to every consumer that
    // resolves this field — that is exactly what made it a lie.
    expect(events[0]!.actor).not.toBe('unknown');
  });

  it('history() still surfaces a real actor unchanged', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    const events = [];
    for await (const e of repo.history(ref)) events.push(e);
    expect(events[0]!.actor).toBe('usr_alice');
  });

  it('getByHash() returns authoredBy: null for an actor-less version', async () => {
    const put = await repo.put(ref, view('A'), { parentVersion: null, actor: null });

    const item = await repo.getByHash(ref, put.version);
    expect(item).not.toBeNull();
    expect(item!.authoredBy).toBeNull();
    expect(item!.authoredBy).not.toBe('unknown');
  });

  it('getByHash() returns the real actor when there was one', async () => {
    const put = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    const item = await repo.getByHash(ref, put.version);
    expect(item!.authoredBy).toBe('usr_alice');
  });

  it('list() reports authoredBy: null when the overlay row carries no updated_by/created_by', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: null });

    const headers = [];
    for await (const h of repo.list({ type: 'view' })) headers.push(h);

    expect(headers).toHaveLength(1);
    expect(headers[0]!.authoredBy).toBeNull();
    expect(headers[0]!.authoredBy).not.toBe('unknown');
  });
});
