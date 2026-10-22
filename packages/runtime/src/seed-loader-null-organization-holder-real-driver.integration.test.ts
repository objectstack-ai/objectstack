// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8] An organization-scoped seed load on a CERTIFIED database reads
 * its own organization's rows and nothing else: no `organization_id IS NULL`
 * read on any path, no twin of a row it already holds, and another
 * organization's row invisible to it.
 *
 * ## What retired
 *
 * Until step 7 of the organization-ownership line the scoped pre-load also
 * read the natural keys held by rows with NO organization — a 17.x
 * single-posture install's rows — and refused to twin or adopt them (#24301).
 * A database is certified before it boots now: the ownership ceremony
 * attributes every such row (D10), an uncertified database is refused at boot,
 * and a new write without an organization is stamped or refused (D9). So the
 * NULL read had no row left to find, and it retired. What these cases hold is
 * its absence, and the behaviour a certified database keeps without it.
 *
 * ## Why a real engine and real drivers
 *
 * The scoped lookup's comparison is a driver's answer, not the loader's. So
 * this file runs the real `SeedLoaderService` behind a real `ObjectQL`, over a
 * real `SqlDriver` on a better-sqlite3 FILE, and asserts on the stored rows.
 * The per-organization replay is the production closure AppPlugin registers on
 * a walled boot; the walled install and the reseed are pinned with the request
 * `MarketplaceInstallLocalPlugin.runInlineSeed` builds for both.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { SeedLoaderRequestSchema, type EngineQueryOptions } from '@objectstack/spec/data';
import type { PluginContext } from '@objectstack/core';
import { AppPlugin } from './app-plugin';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const ORG = 'org_twdefaultk3x9qfa2';
const OTHER_ORG = 'org_twotherorgp4w8m2';

const EVENT = {
  name: 'tw_event',
  label: 'Event',
  fields: {
    subject: { type: 'text' },
    notes: { type: 'text' },
  },
};
const TASK = {
  name: 'tw_task',
  label: 'Task',
  fields: {
    title: { type: 'text' },
    event_id: { type: 'lookup', reference: 'tw_event' },
  },
};
const OBJECTS = [EVENT, TASK];

/** The seed every scoped caller replays: two objects, natural keys, a reference. */
const SEEDS = [
  {
    object: 'tw_event',
    mode: 'upsert',
    externalId: 'subject',
    records: [
      { subject: 'Kickoff', notes: 'first' },
      { subject: 'Review', notes: 'second' },
      { subject: 'Retro', notes: 'third' },
    ],
  },
  {
    object: 'tw_task',
    mode: 'upsert',
    externalId: 'title',
    records: [
      { title: 'Book room', event_id: 'Kickoff' },
      { title: 'Send notes', event_id: 'Review' },
    ],
  },
];

type Row = Record<string, unknown> & { id: string };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* already closed */ }
  }
});

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: vi.fn(async (name: string) => byName.get(name)),
    listObjects: vi.fn(async () => objects),
    getObjects: vi.fn(async () => objects),
    get: vi.fn(async (_t: string, n: string) => byName.get(n)),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
  } as any;
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-24301-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
  cleanups.push(() => raw.disconnect());
  const engine = new ObjectQL();
  engine.registerDriver(raw, true);
  await engine.init();
  for (const o of OBJECTS) engine.registry.registerObject(o as any, 'com.objectstack.test.24301');
  await raw.initObjects(OBJECTS.map((o) => engine.registry.getObject(o.name) ?? o) as any);
  // The 17.x residue this file plants lands only on a store built before 18.x,
  // whose tenant columns are nullable (ADR-0131 D1 makes a fresh one NOT NULL).
  await relaxTenantColumns(raw as any, OBJECTS.filter((o) => (engine.registry.getObject(o.name) as any)?.fields?.organization_id).map((o) => o.name));
  cleanups.push(() => engine.destroy());

  const systemRead: EngineQueryOptions = { context: { isSystem: true } };
  const all = async (object: string): Promise<Row[]> => (await engine.find(object, systemRead)) as Row[];
  /**
   * A row written straight through the DRIVER, as a 17.x single-posture
   * install left it — no engine stamping, `organization_id` exactly as given.
   */
  const plant = async (object: string, row: Record<string, unknown>) => raw.create(object, row);
  return { engine, all, plant };
}

/** A certified database: part of the seed already present, stamped with the organization. */
async function plantOwn(plant: (o: string, r: Record<string, unknown>) => Promise<unknown>) {
  await plant('tw_event', { id: 'ev_kickoff', subject: 'Kickoff', notes: 'first', organization_id: ORG });
  await plant('tw_event', { id: 'ev_review', subject: 'Review', notes: 'second', organization_id: ORG });
  await plant('tw_task', { id: 'tk_room', title: 'Book room', event_id: 'ev_kickoff', organization_id: ORG });
}

/** The request the per-organization replay and `runInlineSeed` (install, reseed) both build. */
function scopedRequest(organizationId: string, seeds: unknown = SEEDS) {
  return SeedLoaderRequestSchema.parse({
    seeds,
    config: { defaultMode: 'upsert', multiPass: true, organizationId },
  });
}

/** Every engine read that names `organization_id` with a NULL value — the retired arm. */
function spyNullReads(engine: ObjectQL): () => unknown[] {
  const seen: unknown[] = [];
  const realFind = engine.find.bind(engine);
  vi.spyOn(engine, 'find').mockImplementation(async (object: string, query?: any) => {
    const where = query?.where;
    if (where && typeof where === 'object' && 'organization_id' in where && where.organization_id == null) seen.push({ object, where });
    return realFind(object, query);
  });
  return () => seen;
}

describe('scoped seed load on a certified database (sqlite-file)', () => {
  it('matches its own rows, inserts no twin, and issues no NULL read', async () => {
    const { engine, all, plant } = await boot();
    await plantOwn(plant);
    const nullReads = spyNullReads(engine);

    const svc = new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never);
    const result = await svc.load(scopedRequest(ORG) as never);

    expect(result.errors).toEqual([]);
    expect(nullReads()).toEqual([]);
    const events = await all('tw_event');
    const tasks = await all('tw_task');
    // Only the keys the organization did not hold ('Retro', 'Send notes') were inserted.
    expect(result.summary.totalInserted).toBe(2);
    expect(events).toHaveLength(3);
    expect(tasks).toHaveLength(2);
    expect(events.filter((r) => r.subject === 'Kickoff')).toHaveLength(1);
    expect(tasks.filter((r) => r.title === 'Book room')).toHaveLength(1);
    expect([...events, ...tasks].every((r) => r.organization_id === ORG)).toBe(true);
    // The new task's reference resolved to the organization's own event.
    expect(tasks.find((r) => r.title === 'Send notes')?.event_id).toBe('ev_review');
  });

  it('a fully stamped database still loads with 0 inserts and 0 errors', async () => {
    const { engine, all } = await boot();
    const svc = new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never);
    const first = await svc.load(scopedRequest(ORG) as never);
    expect(first.errors).toEqual([]);
    expect(first.summary.totalInserted).toBe(5);

    const again = await new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never)
      .load(scopedRequest(ORG) as never);
    expect(again.errors).toEqual([]);
    expect(again.summary.totalInserted).toBe(0);
    expect(await all('tw_event')).toHaveLength(3);
    expect(await all('tw_task')).toHaveLength(2);
  });

  it("another organization's row holding the key stays invisible: this organization gets its own row and the other is untouched", async () => {
    const { engine, all, plant } = await boot();
    await plant('tw_event', { id: 'ev_other', subject: 'Kickoff', notes: 'theirs', organization_id: OTHER_ORG });
    const theirsBefore = (await all('tw_event'))[0];

    const result = await new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never)
      .load(scopedRequest(ORG, [SEEDS[0]]) as never);

    expect(result.errors).toEqual([]);
    expect(result.summary.totalInserted).toBe(3);
    const kickoffs = (await all('tw_event')).filter((r) => r.subject === 'Kickoff');
    expect(kickoffs.map((r) => r.organization_id).sort()).toEqual([OTHER_ORG, ORG].sort());
    expect(kickoffs.find((r) => r.id === 'ev_other')).toEqual(theirsBefore);
  });
});

describe('every scoped caller reads the same way (sqlite-file)', () => {
  it('per-organization replay: the replayer a walled boot registers', async () => {
    const { engine, all, plant } = await boot();
    await plantOwn(plant);
    const nullReads = spyNullReads(engine);
    const services = new Map<string, unknown>([['tenancy', { posture: 'isolated' }]]);
    const metadata = metadataFor(OBJECTS);
    const ctx = {
      logger: createLogger(),
      registerService: vi.fn((name: string, svc: unknown) => { services.set(name, svc); }),
      getService: vi.fn((name: string) => (name === 'objectql' ? engine : name === 'metadata' ? metadata : services.get(name))),
      getServices: vi.fn(() => services),
      hook: vi.fn(),
      trigger: vi.fn(),
    } as unknown as PluginContext;
    await new AppPlugin({ id: 'com.example.tw-replay', data: SEEDS }).start(ctx);
    const replayer = services.get('seed-replayer') as (org: string) => Promise<{ inserted: number; errors: any[] }>;
    expect(typeof replayer).toBe('function');

    const out = await replayer(ORG);
    expect(out.errors).toEqual([]);
    expect(out.inserted).toBe(2);
    expect(nullReads()).toEqual([]);
    expect(await all('tw_event')).toHaveLength(3);
    expect(await all('tw_task')).toHaveLength(2);
  });

  // `MarketplaceInstallLocalPlugin.runInlineSeed` serves both doors and builds
  // the same request for each: `defaultMode: 'upsert'`, `multiPass: true`, the
  // caller's organization.
  it('walled install and reseed: the request runInlineSeed builds for both', async () => {
    const { engine, all, plant } = await boot();
    await plantOwn(plant);
    const nullReads = spyNullReads(engine);
    const result = await new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never)
      .load(scopedRequest(ORG) as never);
    expect(result.errors).toEqual([]);
    expect(result.summary.totalInserted).toBe(2);
    expect(nullReads()).toEqual([]);
    expect(await all('tw_event')).toHaveLength(3);
    expect(await all('tw_task')).toHaveLength(2);
  });
});
