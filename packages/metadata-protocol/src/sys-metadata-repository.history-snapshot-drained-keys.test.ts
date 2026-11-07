// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ruling 6677709817, step (c): a `sys_metadata_history` snapshot written by
 * `SysMetadataRepository.put` withholds every position the type's redactor
 * marks withheld AND not carried forward — the connector's undeclared `auth`
 * keys the save door drains from the live row — so no new history row carries
 * such a value, whichever write produced the body.
 *
 * `put` is the one history writer behind the `/meta` save door, publish
 * (`promoteDraft`) and revert (`restoreVersion`). The save door already drains
 * the body it hands `put`, so the bodies that still reach `put` holding such a
 * key are the ones no door re-judged: a direct `put`, and a revert to a
 * snapshot written before this step. Both are pinned below. The live row is
 * NOT asserted on: the ruling binds what history stores.
 *
 * The placeholder below is a fixture string, not a credential.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row { [k: string]: unknown }

const LEGACY_AUTH_VALUE = 'TEST_PLACEHOLDER_LEGACY_AUTH_VALUE';

/** Minimal engine fake that stores exactly what it is handed (the recorded-by suite's shape). */
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
      assertEngineFindOnePredicate(table, opts);
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

/** A connector whose `auth` holds a key its `bearer` kind does not declare. */
function legacyConnector(label = 'Vendor API'): Row {
  return {
    name: 'vendor_api',
    label,
    type: 'api',
    provider: 'rest',
    // A DECLARED credential position (withheld on read, carried forward on save): kept in history.
    providerConfig: { baseUrl: 'https://api.vendor.example/v1', headers: { Accept: 'application/json' } },
    auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', token: LEGACY_AUTH_VALUE },
  };
}

const DECLARED_AUTH = { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' };

describe('[ruling 6677709817 (c)] SysMetadataRepository history snapshots withhold the drained connector keys', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  const ref = { org: 'org_alpha', type: 'connector' as const, name: 'vendor_api' };

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine, orgLabel: 'org_alpha' });
  });

  // `runtime-only`: a connector is a runtime-created item here, not an override
  // of one a managed package ships (which the repository seals).
  const snapshot = (h: Row): Row => JSON.parse(h.metadata as string) as Row;

  it('a put of a connector holding an undeclared `auth` key writes a snapshot without it', async () => {
    await repo.put(ref, legacyConnector(), { parentVersion: null, actor: null, intent: 'runtime-only' });

    expect(engine.historyRows).toHaveLength(1);
    expect(engine.historyRows[0]!.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
    expect(snapshot(engine.historyRows[0]!).auth).toEqual(DECLARED_AUTH);
  });

  it('CONTROL: every declared position is kept in the snapshot exactly as written', async () => {
    await repo.put(ref, legacyConnector(), { parentVersion: null, actor: null, intent: 'runtime-only' });

    const { auth: _auth, ...rest } = legacyConnector();
    const { auth, ...snapshotRest } = snapshot(engine.historyRows[0]!);
    expect(auth).toEqual(DECLARED_AUTH);
    expect(snapshotRest).toEqual(rest);
  });

  it('a revert to a snapshot written before this step appends a revert snapshot without it', async () => {
    const first = await repo.put(ref, legacyConnector(), { parentVersion: null, actor: null, intent: 'runtime-only' });
    await repo.put(ref, legacyConnector('Vendor API (edited)'), { parentVersion: first.version, actor: null, intent: 'runtime-only' });
    // The version-1 snapshot as a write before this step stored it: the key held.
    const v1 = engine.historyRows.find((h) => h.version === 1)!;
    v1.metadata = JSON.stringify(legacyConnector());

    await repo.restoreVersion(ref, 1, { actor: null, intent: 'runtime-only' });

    const revert = engine.historyRows.find((h) => h.operation_type === 'revert')!;
    expect(revert).toBeDefined();
    expect(revert.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
    expect(snapshot(revert).auth).toEqual(DECLARED_AUTH);
  });

  it('CONTROL: a non-connector type\'s snapshot is byte-identical to the body written', async () => {
    const viewRef = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
    const body = { name: 'case_grid', label: 'Cases', object: 'case', columns: [{ field: 'name' }] };
    await repo.put(viewRef, body, { parentVersion: null, actor: null, intent: 'runtime-only' });

    expect(engine.historyRows).toHaveLength(1);
    expect(engine.historyRows[0]!.metadata).toBe(JSON.stringify(body));
  });

  it('CONTROL: a connector with nothing undeclared is byte-identical to the body written', async () => {
    const { auth: _auth, ...rest } = legacyConnector();
    const body = { ...rest, auth: { ...DECLARED_AUTH } };
    await repo.put(ref, body, { parentVersion: null, actor: null, intent: 'runtime-only' });

    expect(engine.historyRows[0]!.metadata).toBe(JSON.stringify(body));
  });
});
