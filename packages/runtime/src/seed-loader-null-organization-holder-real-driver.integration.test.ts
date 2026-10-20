// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An organization-scoped seed load over a row whose natural key a
 * NULL-organization row already holds REFUSES that seed row, by name, in the
 * seed result. It never inserts a twin beside the unowned row, and it never
 * adopts it.
 *
 * ## The defect, as measured
 *
 * A database whose rows predate organization stamping (a single-posture 17.x
 * install, every business row `organization_id` NULL) took an
 * organization-scoped load: the per-organization replay, the walled install or
 * the reseed, all of which ask `SeedLoaderService` for `defaultMode: 'upsert'`
 * with `config.organizationId`. The scoped pre-load read only
 * `organization_id = ORG`, so the NULL row holding each natural key was
 * invisible, the upsert decided `insert`, and every such row got a twin that
 * carried the organization: 0 errors, nothing logged. On this file's fixture
 * (two NULL events, one NULL task), before the fix, the scoped load inserted
 * all five seed rows, a twin for each of the three NULL-held keys
 * (`tw_event` 2 → 5, `tw_task` 1 → 3).
 *
 * ## Why a real engine and real drivers
 *
 * The scoped lookup's NULL comparison is a driver's answer, not the loader's:
 * `{ organization_id: null }` is `IS NULL` on the SQL family. An engine double
 * would encode the very predicate under test. So this file runs the real
 * `SeedLoaderService` behind a real `ObjectQL`, over a real `SqlDriver` on a
 * better-sqlite3 FILE, and asserts on the stored rows. The
 * per-organization replay is the production closure AppPlugin registers on a
 * walled boot; the walled install and the reseed are pinned with the request
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

/** The 17.x shape: every row of the seed already present, `organization_id` NULL. */
async function plantUnowned(plant: (o: string, r: Record<string, unknown>) => Promise<unknown>) {
  await plant('tw_event', { id: 'ev_kickoff', subject: 'Kickoff', notes: 'first', organization_id: null });
  await plant('tw_event', { id: 'ev_review', subject: 'Review', notes: 'second', organization_id: null });
  await plant('tw_task', { id: 'tk_room', title: 'Book room', event_id: 'ev_kickoff', organization_id: null });
}

/** The request the per-organization replay and `runInlineSeed` (install, reseed) both build. */
function scopedRequest(organizationId: string, seeds: unknown = SEEDS) {
  return SeedLoaderRequestSchema.parse({
    seeds,
    config: { defaultMode: 'upsert', multiPass: true, organizationId },
  });
}

/**
 * The per-row refusal, told apart structurally: the existing
 * `ReferenceResolutionError` shape with `field: 'organization_id'` searched on
 * the object itself (the unowned-row refusal of an unscoped load searches
 * `sys_organization` instead).
 */
const isNullHolderRefusal = (e: { field: string; sourceObject: string; targetObject: string }) =>
  e.field === 'organization_id' && e.targetObject === e.sourceObject;

describe('scoped seed load over NULL-organization holders (sqlite-file)', () => {
  it('refuses each NULL-held natural key by name, inserts no twin, adopts nothing, and still loads the rest', async () => {
    const { engine, all, plant } = await boot();
    await plantUnowned(plant);
    const eventsBefore = await all('tw_event');
    const tasksBefore = await all('tw_task');
    expect(eventsBefore).toHaveLength(2);
    expect(tasksBefore).toHaveLength(1);

    const logger = createLogger();
    const svc = new SeedLoaderService(engine as never, metadataFor(OBJECTS), logger as never);
    const result = await svc.load(scopedRequest(ORG) as never);

    const events = await all('tw_event');
    const tasks = await all('tw_task');
    // No twin: the two NULL-held events and the NULL-held task were refused;
    // only the keys nothing held ('Retro', 'Send notes') were inserted.
    expect(events).toHaveLength(3);
    expect(tasks).toHaveLength(2);
    expect(result.summary.totalInserted).toBe(2);
    expect(events.filter((r) => r.subject === 'Kickoff')).toHaveLength(1);
    expect(events.filter((r) => r.subject === 'Review')).toHaveLength(1);
    expect(tasks.filter((r) => r.title === 'Book room')).toHaveLength(1);
    // The rows that loaded are the organization's.
    expect(events.find((r) => r.subject === 'Retro')?.organization_id).toBe(ORG);
    expect(tasks.find((r) => r.title === 'Send notes')?.organization_id).toBe(ORG);

    // Never adopted: each unowned row is byte-for-byte what was planted.
    for (const before of [...eventsBefore, ...tasksBefore]) {
      const after = [...events, ...tasks].find((r) => r.id === before.id);
      expect(after?.organization_id ?? null).toBeNull();
      expect(after).toEqual(before);
    }

    // Each refusal is a named per-row error in the seed result.
    const refusals = result.errors.filter(isNullHolderRefusal);
    expect(refusals.map((e) => `${e.sourceObject}#${e.recordIndex}`).sort()).toEqual(['tw_event#0', 'tw_event#1', 'tw_task#0']);
    // The only other errors are the cascade the refusals cause: both tasks
    // name an event this organization does not hold ('Kickoff' and 'Review'
    // were refused), and a reference never resolves to an unowned row, so
    // pass 2 reports each link as dropped.
    expect(result.errors.filter((e) => !isNullHolderRefusal(e)).map((e) => `${e.sourceObject}.${e.field}#${e.recordIndex}`).sort())
      .toEqual(['tw_task.event_id#0', 'tw_task.event_id#1']);
    expect(tasks.find((r) => r.title === 'Send notes')?.event_id ?? null).toBeNull();
    const kickoff = refusals.find((e) => e.sourceObject === 'tw_event' && e.recordIndex === 0)!;
    expect(kickoff.targetObject).toBe('tw_event');
    expect(kickoff.targetField).toBe('subject');
    expect(kickoff.attemptedValue).toBe('Kickoff');
    // The message names the key, the unowned holder and the remedy's command.
    expect(kickoff.message).toContain('subject=Kickoff');
    expect(kickoff.message).toContain("'ev_kickoff'");
    expect(kickoff.message).toContain('os migrate organization-ownership --out PLAN');
    expect(kickoff.message).not.toMatch(/fresh installs only|on a 17\.x release|carries the upgrade path/);
    expect(result.success).toBe(false);
    // Loud: said at `error`, once per dataset.
    const lines = logger.error.mock.calls.map((c) => String(c[0])).filter((m) => refusals.some((e) => m.includes(e.message)));
    expect(lines).toHaveLength(2);
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

  it('an unscoped (single-posture) load keeps its behaviour: it matches the NULL rows and inserts no twin', async () => {
    const { engine, all, plant } = await boot();
    await plantUnowned(plant);
    const result = await new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never)
      .load(SeedLoaderRequestSchema.parse({ seeds: SEEDS, config: { defaultMode: 'upsert', multiPass: true } }) as never);

    expect(result.errors).toEqual([]);
    expect(result.summary.totalInserted).toBe(2);
    expect((await all('tw_event')).filter((r) => r.subject === 'Kickoff')).toHaveLength(1);
    expect((await all('tw_task')).filter((r) => r.title === 'Book room')).toHaveLength(1);
  });
});

describe('every scoped caller refuses the NULL-held row (sqlite-file)', () => {
  it('per-organization replay: the replayer a walled boot registers', async () => {
    const { engine, all, plant } = await boot();
    await plantUnowned(plant);
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
    expect(out.inserted).toBe(2);
    expect(out.errors.filter(isNullHolderRefusal).map((e) => `${e.sourceObject}#${e.recordIndex}`).sort())
      .toEqual(['tw_event#0', 'tw_event#1', 'tw_task#0']);
    expect(await all('tw_event')).toHaveLength(3);
    expect(await all('tw_task')).toHaveLength(2);
  });

  // `MarketplaceInstallLocalPlugin.runInlineSeed` serves both doors and builds
  // the same request for each: `defaultMode: 'upsert'`, `multiPass: true`, the
  // caller's organization.
  it('walled install and reseed: the request runInlineSeed builds for both', async () => {
    const { engine, all, plant } = await boot();
    await plantUnowned(plant);
    const result = await new SeedLoaderService(engine as never, metadataFor(OBJECTS), createLogger() as never)
      .load(scopedRequest(ORG) as never);
    expect(result.summary.totalInserted).toBe(2);
    expect(result.errors.filter(isNullHolderRefusal)).toHaveLength(3);
    expect(await all('tw_event')).toHaveLength(3);
    expect(await all('tw_task')).toHaveLength(2);
  });
});
