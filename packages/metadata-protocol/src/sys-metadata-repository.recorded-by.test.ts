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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
  // [#27539] The context each WRITE verb was handed, in call order — what the
  // engine turns into the hook's `session` / `provenance`.
  const writes: Array<{ verb: string; table: string; context: Record<string, unknown> | undefined }> = [];

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
    writes,
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
      assertEngineFindOnePredicate(table, opts);
      if (table === 'sys_metadata_history') return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
      return findRow(opts.where)?.row ?? null;
    },
    async insert(table: string, data: Record<string, unknown>, opts?: { context?: Record<string, unknown> }) {
      writes.push({ verb: 'insert', table, context: opts?.context });
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
    async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown>; context?: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      writes.push({ verb: 'update', table: _t, context: opts.context });
      const found = findRow(opts.where);
      if (!found) throw new Error('not found');
      rows.set(found.key, { ...found.row, ...data });
      return { id: found.row.id as string };
    },
    async delete(_t: string, opts: { where: Record<string, unknown>; context?: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      writes.push({ verb: 'delete', table: _t, context: opts.context });
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
    repo = new SysMetadataRepository({ engine, orgLabel: 'org_alpha' });
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

/**
 * #23033 — the PARENT row records the actor too: `created_by` on the row's
 * first write, `updated_by` on every write, from `PutOptions.actor` — the
 * header's `actor → updated_by` mapping, which `put()` used to declare and not
 * write. A missing actor stores NULL in both, never a placeholder user, for the
 * same reason `recorded_by` does above.
 *
 * This fake stores exactly what it is handed, so these pins prove the
 * repository HANDS the engine the pair. That the real engine KEEPS it — the
 * `isSystem` write path, the readonly strip and the audit hooks — is pinned on
 * the stored row in `packages/objectql/src/protocol-metadata-row-actor.test.ts`.
 */
describe('#23033 — the sys_metadata row records who created it and who last changed it', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  // Environment-wide, the topology the protocol's own overlay repository has
  // (ADR-0131 D6) and the scope `listDrafts` reads.
  const ref = { org: 'system', type: 'view' as const, name: 'case_grid' };
  const onlyRow = () => {
    expect(engine.rows.size).toBe(1);
    return Array.from(engine.rows.values())[0]!;
  };

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine });
  });

  it('a first write with actor A stamps created_by A and updated_by A', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    const row = onlyRow();
    expect(row.created_by).toBe('usr_alice');
    expect(row.updated_by).toBe('usr_alice');
  });

  it('a second write with actor B keeps created_by A and moves updated_by to B', async () => {
    const first = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    await repo.put(ref, view('B'), { parentVersion: first.version, actor: 'usr_bob' });
    const row = onlyRow();
    expect(row.created_by).toBe('usr_alice');
    expect(row.updated_by).toBe('usr_bob');
    // History is unchanged: each event names its own write's actor.
    expect(engine.historyRows.map((h) => h.recorded_by)).toEqual(['usr_alice', 'usr_bob']);
  });

  it('a write with no actor stamps NULL in both — never a placeholder user', async () => {
    await repo.put(ref, view('A'), { parentVersion: null, actor: null });
    const row = onlyRow();
    expect(row.created_by).toBeNull();
    expect(row.updated_by).toBeNull();
  });

  it('an actor-less write after an authored one clears updated_by and keeps created_by', async () => {
    // "Who last changed this?" — nobody named; the previous writer did not make this change.
    const first = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    await repo.put(ref, view('B'), { parentVersion: first.version, actor: null });
    const row = onlyRow();
    expect(row.created_by).toBe('usr_alice');
    expect(row.updated_by).toBeNull();
  });

  it('the read side follows the row: get().authoredBy and listDrafts().updatedBy name the last writer', async () => {
    const first = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    await repo.put(ref, view('B'), { parentVersion: first.version, actor: 'usr_bob' });
    expect((await repo.get(ref))!.authoredBy).toBe('usr_bob');

    await repo.put(ref, view('draft'), { parentVersion: null, actor: 'usr_carol', state: 'draft' });
    const drafts = await repo.listDrafts({ type: 'view' });
    expect(drafts.map((d) => [d.name, d.updatedBy])).toEqual([['case_grid', 'usr_carol']]);
  });
});

/**
 * [#27539, ADR-0073 D3] The save's actor reaches the AUDIT row too. Every
 * `sys_metadata` write runs under `isSystem` (the door already authorized it),
 * so the engine's hook carries no `session.userId`, and the audit writer's only
 * other channel for `sys_audit_log.user_id` is `provenance.attributedUserId`,
 * which the engine copies from `ExecutionContext.attributedUserId`. So the
 * repository hands every write verb of `put` and `delete` the actor on that
 * key, and never as `userId` (that would make every caller-gating hook read
 * the actor as the caller).
 *
 * This fake records the context it is handed, so these pins prove the
 * repository HANDS the engine the attribution. That the engine copies it into
 * `provenance` and the audit writer reads it into `user_id` / `actor` is the
 * engine's and the writer's own contract, measured end to end on the PR.
 */
describe('#27539 — put and delete credit the actor to the audit writer through attributedUserId', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  const ref = { org: 'system', type: 'view' as const, name: 'case_grid' };
  const contexts = () => engine.writes.map((w) => [w.verb, w.table, w.context?.isSystem, w.context?.attributedUserId, w.context?.userId]);

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine });
  });

  it('create, update and delete with an actor credit that actor on every write, as the system', async () => {
    const first = await repo.put(ref, view('A'), { parentVersion: null, actor: 'usr_alice' });
    const second = await repo.put(ref, view('B'), { parentVersion: first.version, actor: 'usr_bob' });
    await repo.delete(ref, { parentVersion: second.version, actor: 'usr_carol' });
    expect(contexts()).toEqual([
      ['insert', 'sys_metadata', true, 'usr_alice', undefined],
      ['insert', 'sys_metadata_history', true, 'usr_alice', undefined],
      ['update', 'sys_metadata', true, 'usr_bob', undefined],
      ['insert', 'sys_metadata_history', true, 'usr_bob', undefined],
      ['delete', 'sys_metadata', true, 'usr_carol', undefined],
      ['insert', 'sys_metadata_history', true, 'usr_carol', undefined],
    ]);
  });

  it('CONTROL: with no actor the writes carry no attributedUserId key at all — unattributed, as before', async () => {
    const first = await repo.put(ref, view('A'), { parentVersion: null, actor: null });
    const second = await repo.put(ref, view('B'), { parentVersion: first.version });
    await repo.delete(ref, { parentVersion: second.version, actor: null });
    expect(engine.writes).toHaveLength(6);
    for (const w of engine.writes) {
      expect(w.context?.isSystem).toBe(true);
      expect(w.context !== undefined && 'attributedUserId' in w.context).toBe(false);
    }
  });
});
