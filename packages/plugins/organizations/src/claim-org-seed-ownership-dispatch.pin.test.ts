// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23008] What the organization seed-ownership claim's write DISPATCHES —
 * measured on a REAL `ObjectQL` over a real `SqliteWasmDriver` (the driver
 * `objectstack dev` uses). The multi-tenant twin of plugin-security's
 * `claim-seed-ownership-dispatch.pin.test.ts`.
 *
 * `claimOrgSeedOwnership` re-owns an organization's seeded rows to its owner.
 * That is attribution, the step that completes the seed, not a user event, so
 * its write runs under `{ isSystem: true, skipAutomations: true }`. This file
 * pins what that context reaches on the engine, because a flag that is
 * silently dropped on the way would read as green in every double:
 *
 *  1. **the metadata-hook filter** — a hook bound through the real binder
 *     (`bindHooksToEngine`, which is what stamps `entry.meta`) does not fire,
 *     before or after, on any claimed row;
 *  2. **the per-row hook path** — code-registered hooks (the shape of the
 *     audit writer, capability gates and the sharing projection) DO fire, once
 *     per claimed row and phase, and every one of those contexts carries the
 *     flag;
 *  3. **the record-change trigger's reading point** — every one of those
 *     contexts has `session.skipTriggers === true`, the one field
 *     `RecordChangeTrigger`'s handler reads before it dispatches a flow
 *     (`skipAutomations` implies it, `engine.ts` `buildSession`).
 *
 * And it measures the read the flag deliberately stays off: the claim's
 * per-object read is a plain system read, so the same metadata hook, bound on
 * `beforeFind`/`afterFind` too, sees it. That is also the in-run positive
 * control: the metadata hook is live on this engine DURING the claim, so its
 * silence on the write events is the filter, not a hook that was never bound.
 *
 * Each case carries a second positive control on the SAME engine: the claim's
 * own write shape with a plain `{ isSystem: true }` context fires the metadata
 * hook per row and phase.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';

const SYS = { context: { isSystem: true } } as const;
const ORG = 'org_alpha';
const OTHER_ORG = 'org_north';
const OWNER = 'usr_org_owner';
const SOMEONE = 'usr_someone';
const OBJECT = 'probe_deal';
const PACKAGE_ID = 'com.objectstack.org-claim-dispatch-23008';

const PROBE_OBJECT = {
  name: OBJECT,
  label: 'Probe Deal',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    stage: { name: 'stage', type: 'text' },
    owner_id: { name: 'owner_id', type: 'text' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

/** One dispatch a hook saw: what the engine handed it, reduced to the flags. */
interface Seen {
  event: string;
  id: unknown;
  isSystem: unknown;
  skipAutomations: unknown;
  skipTriggers: unknown;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * A booted engine with ONE metadata-bound hook and ONE code-registered hook on
 * the probe object.
 *
 * The metadata hook is bound through `bindHooksToEngine` — the binder an app's
 * `defineStack({ hooks })` goes through — so its entry carries `meta` exactly as
 * a shipped app hook's does. It listens on the write events AND the read
 * events. The code hook is `registerHook` with no metadata, on the write events,
 * the shape of the audit writer, the sharing projection and
 * `RecordChangeTrigger`'s per-flow handler.
 */
async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' } as never) as never, true);
  await engine.init();
  engine.registerApp({
    id: PACKAGE_ID,
    name: 'Organization claim dispatch',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [PROBE_OBJECT],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const metadataHook: Seen[] = [];
  const codeHook: Seen[] = [];
  const record = (into: Seen[]) => async (ctx: any) => {
    into.push({
      event: ctx.event,
      id: ctx.input?.id,
      isSystem: ctx.session?.isSystem,
      skipAutomations: ctx.session?.skipAutomations,
      skipTriggers: ctx.session?.skipTriggers,
    });
  };

  const bound = bindHooksToEngine(
    engine,
    [
      {
        name: 'probe_app_hook',
        object: OBJECT,
        events: ['beforeFind', 'afterFind', 'beforeUpdate', 'afterUpdate'],
        handler: record(metadataHook),
      } as never,
    ],
    { packageId: PACKAGE_ID },
  );
  expect(bound.registered, 'the metadata hook must be bound for its absence to mean anything').toBe(4);

  for (const event of ['beforeUpdate', 'afterUpdate'] as const) {
    engine.registerHook(event, record(codeHook) as never, { object: OBJECT, packageId: 'probe.code-hook' });
  }

  return { engine, metadataHook, codeHook };
}

/** Seed rows straight through the driver: the seed path is not the subject here. */
async function seed(engine: ObjectQL, rows: Record<string, unknown>[]): Promise<void> {
  const driver = (engine as any).getDriverForObject(OBJECT);
  for (let i = 0; i < rows.length; i += 500) {
    await driver.bulkCreate(OBJECT, rows.slice(i, i + 500));
  }
}

async function ownersOf(engine: ObjectQL): Promise<Map<string, unknown>> {
  const rows = await (engine as any).find(OBJECT, { fields: ['id', 'owner_id'] }, SYS);
  return new Map(rows.map((r: any) => [r.id, r.owner_id ?? null]));
}

const writeEvents = (seen: Seen[]) => seen.filter((s) => s.event === 'beforeUpdate' || s.event === 'afterUpdate');

describe('[#23008] the organization seed-ownership claim dispatches no metadata-bound automation (real engine)', () => {
  it('no metadata hook fires on the write; code hooks fire once per claimed row and phase with the flag and skipTriggers', async () => {
    const { engine, metadataHook, codeHook } = await boot();
    const N = 12;
    const claimed = Array.from({ length: N }, (_, i) => `d${i}`);
    await seed(engine, [
      ...claimed.map((id, i) => ({ id, name: `Deal ${i}`, stage: 'open', organization_id: ORG, owner_id: null })),
      // Out of the claim's scope: owned already, and another organization's row.
      { id: 'owned', name: 'Owned', stage: 'open', organization_id: ORG, owner_id: SOMEONE },
      { id: 'foreign', name: 'Foreign', stage: 'open', organization_id: OTHER_ORG, owner_id: null },
    ]);

    const result = await claimOrgSeedOwnership(engine, ORG, OWNER);
    // Taken before any read of the test's own: `ownersOf` is a `find` too.
    const metadataSeen = [...metadataHook];
    const codeSeen = [...codeHook];

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    const owners = await ownersOf(engine);
    for (const id of claimed) expect(owners.get(id)).toBe(OWNER);
    expect(owners.get('owned')).toBe(SOMEONE);
    expect(owners.get('foreign')).toBeNull();

    // ⭐ 1 — the metadata-hook filter: not one write dispatch, before or after.
    expect(writeEvents(metadataSeen), 'a metadata-bound hook fired for the claim write').toEqual([]);
    // In-run positive control, and the read's measurement: the claim's one read
    // of this object is a plain system read, so the same metadata hook saw it.
    expect(metadataSeen.map((s) => s.event)).toEqual(['beforeFind', 'afterFind']);
    for (const s of metadataSeen) {
      expect(s.isSystem).toBe(true);
      expect(s.skipAutomations).toBeUndefined();
    }

    // ⭐ 2 — the per-row path still runs code-registered hooks: one dispatch per
    // claimed row and phase, so audit and sharing keep their per-row input.
    for (const event of ['beforeUpdate', 'afterUpdate']) {
      const ids = codeSeen.filter((s) => s.event === event).map((s) => s.id);
      expect([...ids].sort(), `${event} per claimed row`).toEqual([...claimed].sort());
    }
    expect(codeSeen).toHaveLength(2 * N);
    // ⭐ 3 — every one of those contexts carries the flag AND `skipTriggers`,
    // the field the record-change trigger reads before dispatching a flow.
    for (const s of codeSeen) {
      expect(s).toEqual({ event: s.event, id: s.id, isSystem: true, skipAutomations: true, skipTriggers: true });
    }

    // Positive control, same engine, same rows: the claim's own write shape
    // (a by-id `update`) under a plain system context fires the metadata hook
    // per row and phase, and carries no skip flag.
    metadataHook.length = 0;
    codeHook.length = 0;
    for (const id of claimed) {
      await (engine as any).update(OBJECT, { id, stage: 'touched' }, SYS);
    }
    expect(writeEvents(metadataHook)).toHaveLength(2 * N);
    expect(codeHook).toHaveLength(2 * N);
    for (const s of codeHook) {
      expect(s.skipAutomations).toBeUndefined();
      expect(s.skipTriggers).toBeUndefined();
    }
  }, 120_000);

  it('a second run claims nothing and dispatches no write hook of either kind', async () => {
    const { engine, metadataHook, codeHook } = await boot();
    await seed(engine, [{ id: 'd0', name: 'Deal 0', stage: 'open', organization_id: ORG, owner_id: null }]);

    expect(await claimOrgSeedOwnership(engine, ORG, OWNER)).toEqual([{ object: OBJECT, count: 1 }]);
    metadataHook.length = 0;
    codeHook.length = 0;

    expect(await claimOrgSeedOwnership(engine, ORG, OWNER)).toEqual([]);
    expect(writeEvents(metadataHook)).toEqual([]);
    expect(codeHook).toEqual([]);
  }, 120_000);
});
