// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The LIVE `sys_metadata` row a revert (`restoreVersion`) or a publish
 * (`promoteDraft`) writes carries no position the type's redactor marks
 * withheld AND not carried forward: a connector's undeclared `auth` keys and
 * the undeclared keys of an object `retryConfig`, the positions a save of the
 * served form drains.
 *
 * The placeholders below are fixture strings, not credentials.
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
    async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
      const found = table === 'sys_metadata_history'
        ? historyRows.filter((h) => matchesHistory(h, opts.where))
        : Array.from(rows.values()).filter((r) => {
          if (opts.where.type && r.type !== opts.where.type) return false;
          if (opts.where.organization_id !== undefined && r.organization_id !== opts.where.organization_id) return false;
          if (opts.where.state && r.state !== opts.where.state) return false;
          return true;
        });
      // The caller's bound, applied after the filter (check:objectql-double-limit).
      return typeof opts?.limit === 'number' ? found.slice(0, opts.limit) : found;
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
const RETRY_VALUE = 'TEST_PLACEHOLDER_RETRY_VALUE';

describe('a revert or a publish writes no drained connector key to the live row', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;
  // `connector` is not in the repository's typed `MetaRef` union; the protocol
  // builds its refs the same way.
  const ref = { org: 'org_alpha', type: 'connector', name: 'vendor_api' } as unknown as Parameters<SysMetadataRepository['put']>[0];

  beforeEach(() => {
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine, orgLabel: 'org_alpha' });
  });

  const liveRow = (state: 'active' | 'draft' = 'active'): Row | undefined =>
    Array.from(engine.rows.values()).find((r) => r.type === 'connector' && r.name === 'vendor_api' && (r.state ?? 'active') === state);
  const liveBody = (state: 'active' | 'draft' = 'active'): Row => JSON.parse(liveRow(state)!.metadata as string) as Row;

  /** Two versions; version 1's snapshot set to `legacy`. */
  async function twoVersionsWithLegacyFirst(legacy: Row): Promise<void> {
    const first = await repo.put(ref, legacy, { parentVersion: null, actor: null, intent: 'runtime-only' });
    const { auth: _a, retryConfig: _r, ...rest } = legacy;
    await repo.put(ref, { ...rest, auth: { ...DECLARED_AUTH }, label: 'Vendor API (drained)' }, {
      parentVersion: first.version, actor: null, intent: 'runtime-only',
    });
    engine.historyRows.find((h) => h.version === 1)!.metadata = JSON.stringify(legacy);
  }

  it('a revert to a version that holds an undeclared `auth` key writes the live row without it', async () => {
    await twoVersionsWithLegacyFirst(legacyConnector());

    await repo.restoreVersion(ref, 1, { actor: null, intent: 'runtime-only' });

    expect(liveRow()!.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
    expect(liveBody().auth).toEqual(DECLARED_AUTH);
    expect(liveBody().label).toBe('Vendor API');
  });

  it('a revert to a version that holds an undeclared `retryConfig` key writes the live row without it', async () => {
    await twoVersionsWithLegacyFirst({ ...legacyConnector(), retryConfig: { maxAttempts: 3, secret: RETRY_VALUE } });

    await repo.restoreVersion(ref, 1, { actor: null, intent: 'runtime-only' });

    expect(liveRow()!.metadata as string).not.toContain(RETRY_VALUE);
    expect(liveBody().retryConfig).toEqual({ maxAttempts: 3 });
  });

  it('the body a revert hands `deriveRestoredBody` is the one it writes: without the key', async () => {
    await twoVersionsWithLegacyFirst(legacyConnector());
    const seen: unknown[] = [];

    await repo.restoreVersion(ref, 1, {
      actor: null,
      intent: 'runtime-only',
      deriveRestoredBody: (body) => { seen.push(body); return body; },
    });

    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0])).not.toContain(LEGACY_AUTH_VALUE);
    expect(liveRow()!.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
  });

  it('a publish of a stored draft that holds an undeclared `auth` key writes the live row without it', async () => {
    await repo.put(ref, legacyConnector(), { parentVersion: null, actor: null, intent: 'runtime-only', state: 'draft' });
    // The stored draft row holds the key.
    expect(liveRow('draft')!.metadata as string).toContain(LEGACY_AUTH_VALUE);

    await repo.promoteDraft(ref, { actor: null, intent: 'runtime-only' });

    expect(liveRow()!.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
    expect(liveBody().auth).toEqual(DECLARED_AUTH);
    expect(liveRow('draft')).toBeUndefined();
  });

  it('CONTROL: a revert of a connector with nothing undeclared writes the version exactly', async () => {
    const { auth: _a, ...rest } = legacyConnector();
    const clean = { ...rest, auth: { ...DECLARED_AUTH } };
    const first = await repo.put(ref, clean, { parentVersion: null, actor: null, intent: 'runtime-only' });
    await repo.put(ref, { ...clean, label: 'Vendor API (edited)' }, { parentVersion: first.version, actor: null, intent: 'runtime-only' });

    await repo.restoreVersion(ref, 1, { actor: null, intent: 'runtime-only' });

    expect(liveRow()!.metadata).toBe(JSON.stringify(clean));
  });

  it('CONTROL: a publish of another type\'s draft writes the draft body byte for byte', async () => {
    const viewRef = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
    const body = { name: 'case_grid', label: 'Cases', object: 'case', columns: [{ field: 'name' }], extra: { anything: 'kept' } };
    await repo.put(viewRef, body, { parentVersion: null, actor: null, intent: 'runtime-only', state: 'draft' });

    await repo.promoteDraft(viewRef, { actor: null, intent: 'runtime-only' });

    const active = Array.from(engine.rows.values()).find((r) => r.type === 'view' && (r.state ?? 'active') === 'active')!;
    expect(active.metadata).toBe(JSON.stringify(body));
  });
});
