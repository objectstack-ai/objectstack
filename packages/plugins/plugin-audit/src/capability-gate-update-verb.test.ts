// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10170] `enable.feeds` is a property of the TARGET object, so the verb that
 * made a row target it does not change the answer.
 *
 * The feeds gate in `audit-writers.ts` registered on `beforeInsert` only, which
 * left a re-point via UPDATE outside the declaration: a `sys_comment` could be
 * re-threaded into a feeds-disabled object's thread. The access kit authorizes
 * the re-point (`comment-access-hooks.ts` since #4630) — an ACCESS check, and
 * the capability half was never asked on the update verb.
 *
 * `enable.files` is not this capability's: the storage service is its one
 * enforcer, and its real-engine pins on the same dispatch shapes, with and
 * without this capability installed, live in service-storage's
 * `attachment-files-opt-in.test.ts`.
 *
 * This file runs against a REAL `ObjectQL` (a stub driver underneath), not the
 * hand-rolled fake in `audit-writers.test.ts`, for two reasons the fake cannot
 * serve:
 *
 *   1. the fake's `registerHook` ignores the `{ object }` scoping option, so a
 *      registration's OBJECT SCOPE is unobservable there — and this change is
 *      a registration change;
 *   2. the gap has to be pinned on BOTH dispatch shapes, and "by-id" vs
 *      "predicate/per-row" is an engine behaviour (#5574 / ADR-0058 Addendum
 *      II D1–D2 builds a fresh context per matched row per phase). Only the
 *      real engine fans out.
 *
 * Every rejection asserts the ADR-0112 envelope — `code` AND `status`, never
 * one alone — and every direction is pinned twice: the disabled parent must be
 * REFUSED and the enabled parent must still SUCCEED. A one-directional pin
 * passes just as well on a gate that refuses everything.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import { installAuditWriters } from './audit-writers.js';

const text = (name: string, primaryKey = false) => ({
  name,
  label: name,
  type: 'text' as const,
  ...(primaryKey ? { primaryKey: true } : {}),
});

const fieldMap = (...names: string[]) =>
  Object.fromEntries(names.map((n) => [n, text(n, n === 'id')]));

/** A stub driver with just enough storage for the write paths under test. */
function makeStubDriver(): any {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) {
      s = new Map();
      stores.set(o, s);
    }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o);
      const cur = s.get(id);
      if (!cur) return null;
      const u = { ...cur, ...data, id };
      s.set(id, u);
      return u;
    },
    // `driver.updateMany(object, AST, data, options)` — the second argument is
    // the compiled AST, not a bare `where`. Stubbing it as `(o, where, data)`
    // silently matches nothing and resolves 0, which reads exactly like "the
    // predicate write was accepted and touched no row" — a vacuous pass on the
    // very path this file exists to measure.
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(o);
      let n = 0;
      for (const [id, row] of s) {
        if (!matches(row, ast?.where)) continue;
        s.set(id, { ...row, ...data, id });
        n += 1;
      }
      return n;
    },
    async delete() {
      return true;
    },
    async count(o: string, ast: any) {
      return (await d.find(o, ast)).length;
    },
    async aggregate() {
      return [];
    },
  };
  return d;
}

/**
 * Boot a real engine carrying the gated object, a feeds-enabled parent, a
 * feeds-disabled parent, and the audit sinks (registered so
 * the `afterUpdate` audit writer has somewhere real to land — its failures are
 * swallowed by design, and a swallowed failure would make this harness lie
 * about which write actually happened).
 */
async function boot() {
  const engine = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();

  const reg = engine.registry;
  reg.registerObject({
    name: 'lead_open',
    label: 'Lead (capabilities on)',
    fields: fieldMap('id', 'name'),
    enable: { feeds: true },
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'lead_walled',
    label: 'Lead (capabilities off)',
    fields: fieldMap('id', 'name'),
    // `feeds` is opt-OUT (spec default true), so the walled object says
    // `feeds: false` explicitly.
    enable: { feeds: false },
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'sys_comment',
    label: 'Comment',
    fields: fieldMap('id', 'thread_id', 'body'),
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'sys_audit_log',
    label: 'Audit Log',
    fields: fieldMap(
      'id', 'action', 'user_id', 'actor', 'object_name', 'record_id', 'old_value', 'new_value', 'tenant_id',
    ),
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'sys_activity',
    label: 'Activity',
    fields: fieldMap(
      'id', 'type', 'timestamp', 'summary', 'actor_id', 'object_name', 'record_id', 'record_label', 'metadata',
    ),
  } as any, 'test.fixture');

  installAuditWriters(engine as any, 'test.audit');
  return engine;
}

const seedComment = async (engine: ObjectQL, thread = 'lead_open:rec-1') =>
  (await engine.insert('sys_comment', { thread_id: thread, body: 'hello' } as any)) as any;

/* ────────────────────────────────────────────────────────────────────────────
 * The CONTROL — proves the harness is wired before anything is read from it.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#10170] control: the insert-verb gate is live in this harness', () => {
  it('refuses the identical shape on INSERT', async () => {
    const engine = await boot();

    await expect(
      engine.insert('sys_comment', { thread_id: 'lead_walled:rec-1', body: 'hi' } as any),
    ).rejects.toMatchObject({ code: 'FEEDS_DISABLED', status: 403, object: 'lead_walled' });

    // …and the enabled parent is accepted, so the control is two-directional
    // too: `enable` really round-trips through the registry, and the gate is
    // reading it rather than refusing everything.
    await expect(seedComment(engine)).resolves.toBeTruthy();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * `enable.feeds` — the same two shapes on the comment thread re-point.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#10170] enable.feeds is asked on the UPDATE verb too', () => {
  it('by-id: re-threading into a feeds-disabled object → 403 FEEDS_DISABLED', async () => {
    const engine = await boot();
    const row = await seedComment(engine);

    await expect(
      engine.update('sys_comment', { thread_id: 'lead_walled:rec-1' } as any, {
        where: { id: String(row.id) },
      } satisfies EngineUpdateOptions),
    ).rejects.toMatchObject({ code: 'FEEDS_DISABLED', status: 403, object: 'lead_walled' });

    const after: any = await engine.findOne('sys_comment', { where: { id: String(row.id) } } satisfies EngineQueryOptions);
    expect(after.thread_id).toBe('lead_open:rec-1');
  });

  it('by-id: re-threading into a feeds-ENABLED object still succeeds', async () => {
    const engine = await boot();
    const row = await seedComment(engine);

    await expect(
      engine.update('sys_comment', { thread_id: 'lead_open:rec-2' } as any, {
        where: { id: String(row.id) },
      } satisfies EngineUpdateOptions),
    ).resolves.toBeTruthy();
  });

  it('predicate: re-threading into a feeds-disabled object → 403 FEEDS_DISABLED', async () => {
    const engine = await boot();
    await seedComment(engine);
    await seedComment(engine);

    await expect(
      engine.update('sys_comment', { thread_id: 'lead_walled:rec-1' } as any, {
        multi: true,
        where: { body: 'hello' },
      } satisfies EngineUpdateOptions),
    ).rejects.toMatchObject({ code: 'FEEDS_DISABLED', status: 403, object: 'lead_walled' });
  });

  it('predicate: re-threading into a feeds-ENABLED object still succeeds', async () => {
    const engine = await boot();
    await seedComment(engine);
    await seedComment(engine);

    await expect(
      engine.update('sys_comment', { thread_id: 'lead_open:rec-2' } as any, {
        multi: true,
        where: { body: 'hello' },
      } satisfies EngineUpdateOptions),
    ).resolves.toBeTruthy();
  });

  it('a free-form or absent thread_id stays allowed — capability gating, not access control', async () => {
    const engine = await boot();
    const row = await seedComment(engine);

    await expect(
      engine.update('sys_comment', { body: 'edited' } as any, { where: { id: String(row.id) } } satisfies EngineUpdateOptions),
    ).resolves.toBeTruthy();
    await expect(
      engine.update('sys_comment', { thread_id: 'free-form-thread' } as any, {
        where: { id: String(row.id) },
      } satisfies EngineUpdateOptions),
    ).resolves.toBeTruthy();
  });
});
