// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * Declared pointer-pair resolution — #11339 (ADR-0052 §5, the ActivityPointer
 * model).
 *
 * `sys_activity.record_id` is a plain `text` column whose value is a record id
 * of the object the sibling `object_name` column names. Before #11339 the seed
 * loader resolved natural keys only for `lookup`/`master_detail`/`user`
 * fields, so a packaged app's activity seed loaded "successfully" while
 * storing the literal natural key — rows that attach to nothing: the shipped
 * console timeline filters on `{ object_name, record_id }` with the target's
 * REAL id and finds zero rows (measured downstream in
 * objectstack-ai/hotcrm#1258).
 *
 * The fix is a declared carrier: a `text` field carrying
 * `referenceVia: '<sibling>'` derives a per-ROW reference whose target object
 * is read from the sibling column, and flows through the SAME resolution
 * machinery as static references — same probes, same deferral, same loud
 * refusal. These tests pin both halves of the contract change:
 *  - the ACCEPT half: natural keys now resolve to internal ids (per row,
 *    in-memory and DB probes, pass-2 deferral for order independence);
 *  - the REFUSE half: an unresolvable or un-addressable pointer is a loud,
 *    counted failure — never the silently stored literal it used to be.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Same faithful engine shape as seed-loader-engine-schema-fallback.test.ts:
 *  where-filtering find, id-dispatch-asserting update/delete, and a
 *  `getSchema` backed by the schema map (the ObjectQL registry stand-in). */
function createFaithfulEngine(schemas: Record<string, any>) {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return r[k] === v;
          }),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      assertEngineFindOnePredicate(objectName, query);
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
    getSchema: vi.fn((objectName: string) => schemas[objectName]),
  } as unknown as IDataEngine & { getSchema: ReturnType<typeof vi.fn> };

  return { engine, store };
}

/** Objects known only to the engine registry — the marketplace-install path
 *  the downstream measurement ran on (metadata service knows nothing). */
function createEmptyMetadata(): IMetadataService {
  return {
    getObject: vi.fn(async () => undefined),
    listObjects: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

/** The measured shape: a business target plus the sys_activity pointer pairs
 *  exactly as plugin-audit declares them after #11339. */
const SCHEMAS: Record<string, any> = {
  crm_lead: {
    name: 'crm_lead',
    fields: {
      name: { type: 'text', required: true },
      status: { type: 'text' },
    },
  },
  sys_activity: {
    name: 'sys_activity',
    fields: {
      type: { type: 'select' },
      summary: { type: 'text', required: true },
      object_name: { type: 'text' },
      record_id: { type: 'text', referenceVia: 'object_name' },
      record_label: { type: 'text' },
      source_object: { type: 'text' },
      source_id: { type: 'text', referenceVia: 'source_object' },
    },
  },
  // The counter-example: same column names, NO declaration — the loader must
  // keep treating these as plain text (stored verbatim), because resolving
  // undeclared pairs would rewrite data on every object that happens to share
  // the idiom's spelling.
  sys_audit_like: {
    name: 'sys_audit_like',
    fields: {
      summary: { type: 'text', required: true },
      object_name: { type: 'text' },
      record_id: { type: 'text' },
    },
  },
};

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

const LEAD_SEED = {
  object: 'crm_lead',
  externalId: 'name',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records: [{ name: 'Lisa Thompson', status: 'qualified' }],
};

function activitySeed(records: Array<Record<string, unknown>>) {
  return {
    object: 'sys_activity',
    externalId: 'summary',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records,
  };
}

function newService(schemas: Record<string, any> = SCHEMAS) {
  const { engine, store } = createFaithfulEngine(schemas);
  const logger = createLogger();
  const service = new SeedLoaderService(engine, createEmptyMetadata(), logger);
  return { service, engine, store, logger };
}

describe('seed pointer-pair resolution (#11339 — referenceVia)', () => {
  it('resolves record_id through the object object_name names, so the console filter shape matches', async () => {
    const { service, store } = newService();

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        activitySeed([
          { type: 'completed', summary: 'Discovery call', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
    // The exact filter the shipped console bundle issues — the downstream
    // measurement's failing read, now the passing one:
    const attached = store.sys_activity.filter(
      (r) => r.object_name === 'crm_lead' && r.record_id === leadId,
    );
    expect(attached).toHaveLength(1);
    // …and the measured failure shape is gone: no row stores the literal key.
    expect(store.sys_activity.filter((r) => r.record_id === 'Lisa Thompson')).toHaveLength(0);
  });

  it('resolves each row against ITS OWN sibling value, and the source pair independently of the regarding pair', async () => {
    const { service, store } = newService({
      ...SCHEMAS,
      crm_case: { name: 'crm_case', fields: { name: { type: 'text', required: true } } },
      sys_email: { name: 'sys_email', fields: { name: { type: 'text', required: true } } },
    });

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        {
          object: 'crm_case',
          externalId: 'name',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Broken widget' }],
        },
        {
          object: 'sys_email',
          externalId: 'name',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Re: pricing' }],
        },
        activitySeed([
          // Row 1 points at the lead; its source drills to the email row.
          {
            type: 'completed', summary: 'Email follow-up',
            object_name: 'crm_lead', record_id: 'Lisa Thompson',
            source_object: 'sys_email', source_id: 'Re: pricing',
          },
          // Row 2 points at a DIFFERENT object — per-row targets, one dataset.
          { type: 'created', summary: 'Case opened', object_name: 'crm_case', record_id: 'Broken widget' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = store.crm_lead[0].id;
    const caseId = store.crm_case[0].id;
    const emailId = store.sys_email[0].id;
    const row1 = store.sys_activity.find((r) => r.summary === 'Email follow-up')!;
    const row2 = store.sys_activity.find((r) => r.summary === 'Case opened')!;
    expect(row1.record_id).toBe(leadId);
    expect(row1.source_id).toBe(emailId);
    expect(row2.record_id).toBe(caseId);
  });

  it('resolves through the target DATASET\'s declared externalId, like static references do', async () => {
    const { service, store } = newService({
      ...SCHEMAS,
      crm_lead: {
        name: 'crm_lead',
        fields: { name: { type: 'text' }, email: { type: 'text', required: true } },
      },
    });

    const result = await service.load({
      seeds: [
        {
          object: 'crm_lead',
          externalId: 'email',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Lisa Thompson', email: 'lisa@example.com' }],
        },
        activitySeed([
          { type: 'completed', summary: 'Call', object_name: 'crm_lead', record_id: 'lisa@example.com' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(store.sys_activity[0].record_id).toBe(store.crm_lead[0].id);
  });

  it('defers to pass 2 when the activity dataset loads before its target — order independence', async () => {
    const { service, store, engine } = newService();

    // sys_activity FIRST: no static dependency edge exists (the target is a
    // per-row fact), so topological order cannot save this — pass 2 must.
    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Discovery call', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
        ]),
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
    expect(store.sys_activity[0].record_id).toBe(leadId);
    // It really went through the back-fill write, not through luck of ordering.
    expect((engine.update as any).mock.calls.length).toBeGreaterThan(0);
    const activityResult = result.results.find((r: any) => r.object === 'sys_activity')!;
    expect(activityResult.referencesResolved).toBeGreaterThan(0);
  });

  it('REFUSES an unresolvable pointer loudly instead of storing the literal (the measured silent failure)', async () => {
    const { service, store, logger } = newService();

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        activitySeed([
          { type: 'completed', summary: 'Ghost call', object_name: 'crm_lead', record_id: 'No Such Lead' },
        ]),
      ] as any,
      config: CONFIG,
    });

    // The contract change this card ships: this load can no longer read as a
    // clean success — before #11339 it was `success: true` with the literal
    // stored, at every gate green.
    expect(result.success).toBe(false);
    expect(result.errors.some((e: any) => e.field === 'record_id' && String(e.message).includes('crm_lead'))).toBe(true);
    expect(logger.error).toHaveBeenCalled();
    // Never stored verbatim: the row (written in pass 1, pointer deferred)
    // carries NO record_id rather than the unresolvable literal.
    const row = store.sys_activity.find((r) => r.summary === 'Ghost call')!;
    expect(row.record_id ?? null).toBeNull();
    expect(store.sys_activity.filter((r) => r.record_id === 'No Such Lead')).toHaveLength(0);
  });

  it('REFUSES an un-addressable pointer (id half authored, type half empty) — the record is not seeded', async () => {
    const { service, store, logger } = newService();

    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Orphan pointer', record_id: 'Lisa Thompson' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(false);
    const err = result.errors.find((e: any) => e.field === 'record_id');
    expect(err).toBeDefined();
    // The message names the pair field so the author knows the one-line fix.
    expect(String(err!.message)).toContain('object_name');
    expect(logger.error).toHaveBeenCalled();
    expect(store.sys_activity ?? []).toHaveLength(0);
    const activityResult = result.results.find((r: any) => r.object === 'sys_activity')!;
    expect(activityResult.errored).toBe(1);
  });

  it('keeps an internal-id-shaped value verbatim (advanced seeds may wire real ids)', async () => {
    const { service, store } = newService();
    const uuid = '123e4567-e89b-42d3-a456-426614174000';

    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Wired by id', object_name: 'crm_lead', record_id: uuid },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(store.sys_activity[0].record_id).toBe(uuid);
  });

  it('leaves UNDECLARED pairs alone: same column names without referenceVia still store verbatim', async () => {
    const { service, store } = newService();

    const result = await service.load({
      seeds: [
        {
          object: 'sys_audit_like',
          externalId: 'summary',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ summary: 'Plain text row', object_name: 'crm_lead', record_id: 'Lisa Thompson' }],
        },
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    // Undeclared = untouched: the loader must not invent pointer semantics
    // from column spellings — only the declared carrier opts an object in.
    expect(store.sys_audit_like[0].record_id).toBe('Lisa Thompson');
  });

  it('dry-run reports the would-fail pointer without writing or logging at error', async () => {
    const { service, store, logger } = newService();

    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Orphan pointer', record_id: 'Lisa Thompson' },
          { type: 'completed', summary: 'Ghost target', object_name: 'crm_lead', record_id: 'No Such Lead' },
        ]),
      ] as any,
      config: { ...CONFIG, dryRun: true },
    });

    // Both defects are visible in the report the caller reads…
    expect(result.errors.filter((e: any) => e.field === 'record_id').length).toBe(2);
    // …and nothing was written or shouted about a simulated outcome (#4997).
    expect(store.sys_activity ?? []).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

/**
 * Per-object adoption of the declared pointer pair — #11386.
 *
 * #11339 landed the carrier and adopted it on `sys_activity`. This card adopts
 * it on the remaining system objects that carry the same `(object half, id
 * half)` idiom, and the card's own discipline is that they are adopted
 * MEASURED PER OBJECT, not as a sweep: five objects sharing a declaration
 * SHAPE do not thereby share semantics, and a sweep would declare a pair on an
 * object whose corpus contradicts it while every test stayed green.
 *
 * So each case below drives the loader against ONE adopted object's real field
 * shape and asserts THAT object's own consuming query — the query that makes
 * the pair load-bearing there — rather than a generic "the id resolved":
 *
 *  - `sys_audit_log`      → the `{object_name, record_id}` index / `record_views`
 *                           view, i.e. "who touched THIS record"
 *  - `sys_approval_request` → the pending-request lookup that
 *                           `lifecycle-hooks.ts` holds the record LOCK with
 *  - `sys_record_share`   → the grant lookup the sharing middleware enforces on
 *  - `sys_share_link`     → the fail-closed `recordStillExists` gate a token
 *                           resolve runs
 *
 * The fifth surveyed object, `sys_automation_run`, is deliberately NOT adopted
 * and therefore has no case here; the verdict and its reasons are recorded at
 * the declaration site (`sys-automation-run.object.ts`, `trigger_record_id`).
 *
 * ## Ordering: what heals, what still requires the target first (#11674)
 *
 * `sys_activity` heals an out-of-order pointer in pass 2 (the
 * order-independence case above). Whether these four inherit that was
 * measured rather than assumed, and the answer SPLIT — by dataset keyedness
 * first, then by the `required` flag on the id half:
 *
 *  - MEASURED, healed by #11674: all four are engine-owned rows with no
 *    natural key, so an honest seed dataset for them declares no
 *    `externalId`. Pass 2 used to back-fill by looking the row up BY its
 *    externalId, so a keyless deferral resolved the target and then had
 *    nowhere to write it ("Deferred reference DROPPED … empty externalId").
 *    Pass 2 now writes back through the internal id captured at insert time,
 *    so keylessness no longer costs the deferral — pinned by the keyless
 *    case (healing) and its keyed sibling control in the `sys_audit_log`
 *    block below.
 *  - MEASURED against the REAL engine (in `packages/objectql/src/`
 *    `engine-seed-required-deferral.test.ts` — this file's engine double
 *    does not validate, so no case HERE may claim it): on
 *    `sys_approval_request`, `sys_record_share` and `sys_share_link` the id
 *    half is also `required: true`, and pass 1 defers a reference by
 *    DELETING the column from the row. The real engine enforces `required`
 *    on seed inserts (SEED_OPTIONS skips only state_machine), so the
 *    deferred insert is rejected before pass 2 can help — an independent,
 *    equally LOUD road that #11674's write-back does NOT clear. For those
 *    three, order the target dataset first; `sys_audit_log` (optional id
 *    half) is genuinely order-independent now.
 */

/** The four adopted objects, mirroring their real declarations field-for-field
 *  in the shape this loader reads (type + `referenceVia`). The mirror is kept
 *  honest by a declaration pin in each owning package, which asserts the REAL
 *  object still declares the pair this file assumes. */
const ADOPTER_SCHEMAS: Record<string, any> = {
  crm_lead: {
    name: 'crm_lead',
    fields: { name: { type: 'text', required: true }, status: { type: 'text' } },
  },
  sys_audit_log: {
    name: 'sys_audit_log',
    fields: {
      action: { type: 'select' },
      actor: { type: 'text' },
      object_name: { type: 'text' },
      record_id: { type: 'text', referenceVia: 'object_name' },
    },
  },
  sys_approval_request: {
    name: 'sys_approval_request',
    fields: {
      process_name: { type: 'text', required: true },
      object_name: { type: 'text', required: true },
      record_id: { type: 'text', required: true, referenceVia: 'object_name' },
      status: { type: 'select' },
    },
  },
  sys_record_share: {
    name: 'sys_record_share',
    fields: {
      object_name: { type: 'text', required: true },
      record_id: { type: 'text', required: true, referenceVia: 'object_name' },
      recipient_type: { type: 'select' },
      recipient_id: { type: 'text' },
      access_level: { type: 'select' },
      source: { type: 'select' },
    },
  },
  sys_share_link: {
    name: 'sys_share_link',
    fields: {
      token: { type: 'text' },
      object_name: { type: 'text', required: true },
      record_id: { type: 'text', required: true, referenceVia: 'object_name' },
      permission: { type: 'select' },
      audience: { type: 'select' },
    },
  },
};

/** A dataset for an object with no natural key of its own — every adopted
 *  object here is engine/append-only owned, so `mode: 'insert'` (no
 *  `externalId`) is how such rows would honestly be authored. */
function insertSeed(object: string, records: Array<Record<string, unknown>>) {
  return { object, mode: 'insert', env: ['prod', 'dev', 'test'], records };
}

describe('pointer-pair adoption per object (#11386)', () => {
  describe('sys_audit_log — object_name / record_id', () => {
    it('resolves the ledger pointer so "who touched THIS record" matches on the real id', async () => {
      const { service, store } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_audit_log', [
            { action: 'update', actor: 'svc:importer', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      const leadId = store.crm_lead[0].id;
      // The `{object_name, record_id}` index query — the shape the
      // `record_views` list view and every "history of this record" drill-down
      // issue, with the target's REAL id.
      expect(
        store.sys_audit_log.filter((r) => r.object_name === 'crm_lead' && r.record_id === leadId),
      ).toHaveLength(1);
      expect(store.sys_audit_log.filter((r) => r.record_id === 'Lisa Thompson')).toHaveLength(0);
    });

    /**
     * MEASURED — and this case has now flipped TWICE, deliberately both times.
     *
     * As first written it asserted the healing this title now claims, on the
     * prediction that an optional `record_id` defers cleanly the way
     * `sys_activity`'s does. Measurement said no: pass 2 back-filled by
     * looking the row up BY its externalId, and a keyless dataset (the honest
     * authoring for an engine-owned ledger — no natural key) had no such
     * handle, so the deferral resolved the target and then dropped the link
     * LOUDLY ("Deferred reference DROPPED … empty externalId"). That
     * order-dependence is the defect #11674 names: the declared deferral
     * property ("a pointer pair contributes no static ordering edge, pass 2
     * heals it") did not hold for exactly the datasets the four adopted
     * objects ship.
     *
     * #11674's fix makes pass 2 write back through the internal id captured
     * at insert time, so the property now holds without requiring a key.
     * This case pins the healed behaviour; the keyed sibling below pins that
     * the pre-existing keyed path still heals identically (it was the
     * positive control that isolated keylessness as the cause while the
     * failure existed).
     */
    it('DOES heal an out-of-order pointer on a KEYLESS dataset — pass 2 writes back by the internal id captured at insert (#11674)', async () => {
      const { service, store, engine } = newService(ADOPTER_SCHEMAS);

      // Ledger dataset BEFORE its target. A pointer pair contributes no static
      // dependency edge (the target is a per-row fact), so nothing but pass 2
      // can save this — and pass 2 now can, with no externalId declared.
      const result = await service.load({
        seeds: [
          insertSeed('sys_audit_log', [
            { action: 'read', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
          ]),
          LEAD_SEED,
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
      // Healed to the REAL id — the `{object_name, record_id}` index query the
      // ledger exists to answer now matches.
      expect(store.sys_audit_log[0].record_id).toBe(leadId);
      // It really went through the pass-2 back-fill write, not luck of order.
      expect(
        (engine.update as any).mock.calls.some(([obj]: [string]) => obj === 'sys_audit_log'),
      ).toBe(true);
      const ledgerResult = result.results.find((r: any) => r.object === 'sys_audit_log')!;
      expect(ledgerResult.referencesResolved).toBeGreaterThan(0);
      expect(ledgerResult.referencesDeferred).toBe(0); // given back by the successful back-fill
      // Never the silent verbatim store this family exists to kill.
      expect(store.sys_audit_log.filter((r) => r.record_id === 'Lisa Thompson')).toHaveLength(0);
    });

    it('KEYED SIBLING CONTROL — the same out-of-order load heals identically with an externalId declared', async () => {
      const { service, store } = newService(ADOPTER_SCHEMAS);

      // Same seeds, same order, one difference: the ledger rows are also
      // addressable by natural key. While the keyless failure existed this was
      // the positive control that isolated its cause to keylessness (same
      // seeds, same order, key declared → healed); it stays pinned so the two
      // paths — internal-id write-back and the pre-existing keyed lookup —
      // cannot drift apart again.
      const result = await service.load({
        seeds: [
          {
            object: 'sys_audit_log',
            externalId: 'actor',
            mode: 'upsert',
            env: ['prod', 'dev', 'test'],
            records: [{ action: 'read', actor: 'svc:timeline', object_name: 'crm_lead', record_id: 'Lisa Thompson' }],
          },
          LEAD_SEED,
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      expect(store.sys_audit_log[0].record_id).toBe(store.crm_lead[0].id);
    });

    it('keeps an internal-id-shaped pointer verbatim — how a demo row ABOUT A DELETED record stays authorable', async () => {
      const { service, store } = newService(ADOPTER_SCHEMAS);
      const goneId = '123e4567-e89b-42d3-a456-426614174000';

      // An `action: 'delete'` row names a record that by definition no longer
      // exists, so it has no natural key to resolve. The landed escape hatch
      // is what keeps that row authorable under a declared pair.
      const result = await service.load({
        seeds: [
          insertSeed('sys_audit_log', [
            { action: 'delete', object_name: 'crm_lead', record_id: goneId },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      expect(store.sys_audit_log[0].record_id).toBe(goneId);
    });
  });

  describe('sys_approval_request — object_name / record_id', () => {
    it('resolves the pointer so the pending-request lock query finds the row', async () => {
      const { service, store } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_approval_request', [
            {
              process_name: 'flow:lead_discount_approval',
              object_name: 'crm_lead',
              record_id: 'Lisa Thompson',
              status: 'pending',
            },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      const leadId = store.crm_lead[0].id;
      // `lifecycle-hooks.ts` holds the record LOCK with exactly this where —
      // and `approval-service.ts` finds a record's open request with it. A
      // verbatim natural key matched neither, so the seeded request locked
      // nothing while looking pending.
      expect(
        store.sys_approval_request.filter(
          (r) => r.object_name === 'crm_lead' && r.record_id === leadId && r.status === 'pending',
        ),
      ).toHaveLength(1);
    });

    it('REFUSES a request pointing at a record that does not exist', async () => {
      const { service, store, logger } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_approval_request', [
            {
              process_name: 'flow:lead_discount_approval',
              object_name: 'crm_lead',
              record_id: 'No Such Lead',
              status: 'pending',
            },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(false);
      expect(
        result.errors.some((e: any) => e.field === 'record_id' && String(e.message).includes('crm_lead')),
      ).toBe(true);
      expect(logger.error).toHaveBeenCalled();
      expect(store.sys_approval_request.filter((r) => r.record_id === 'No Such Lead')).toHaveLength(0);
    });
  });

  describe('sys_record_share — object_name / record_id', () => {
    it('resolves the grant pointer so the enforcement lookup matches the shared record', async () => {
      const { service, store } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_record_share', [
            {
              object_name: 'crm_lead',
              record_id: 'Lisa Thompson',
              recipient_type: 'user',
              recipient_id: 'usr_agent',
              access_level: 'edit',
              source: 'manual',
            },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      const leadId = store.crm_lead[0].id;
      // The middleware asks "which record ids is this principal granted?" — a
      // grant whose `record_id` is a natural key answers with a string that is
      // no record's id, so it widens access to nothing while displaying as a
      // grant on Setup → Record Shares.
      expect(
        store.sys_record_share.filter(
          (r) => r.object_name === 'crm_lead' && r.record_id === leadId && r.recipient_id === 'usr_agent',
        ),
      ).toHaveLength(1);
    });

    it('REFUSES a grant on a record that does not exist — instead of a row the orphan sweep would delete', async () => {
      const { service, store, logger } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_record_share', [
            {
              object_name: 'crm_lead',
              record_id: 'No Such Lead',
              recipient_type: 'user',
              recipient_id: 'usr_agent',
              access_level: 'read',
              source: 'manual',
            },
          ]),
        ] as any,
        config: CONFIG,
      });

      // `record-orphan-cleanup.ts`: "record gone ⇒ the row cannot describe any
      // access at all" — the sweep deletes such a row. Refusing at seed time
      // reports the defect while the author is still looking at it.
      expect(result.success).toBe(false);
      expect(result.errors.some((e: any) => e.field === 'record_id')).toBe(true);
      expect(logger.error).toHaveBeenCalled();
      expect(store.sys_record_share.filter((r) => r.record_id === 'No Such Lead')).toHaveLength(0);
    });
  });

  describe('sys_share_link — object_name / record_id', () => {
    it('resolves the link pointer so the fail-closed record-existence gate passes', async () => {
      const { service, store } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_share_link', [
            {
              token: 'tok_demo_readonly',
              object_name: 'crm_lead',
              record_id: 'Lisa Thompson',
              permission: 'read',
              audience: 'anyone_with_link',
            },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(true);
      const leadId = store.crm_lead[0].id;
      const link = store.sys_share_link[0];
      expect(link.record_id).toBe(leadId);
      // `share-link-service.ts` resolves a token through
      // `recordStillExists(object_name, record_id)` and returns null when it
      // misses — the same null as revoked/expired. This is that probe.
      expect(store.crm_lead.filter((r) => r.id === link.record_id)).toHaveLength(1);
    });

    it('REFUSES a link whose target cannot be resolved — a token that would 404 as if revoked', async () => {
      const { service, store, logger } = newService(ADOPTER_SCHEMAS);

      const result = await service.load({
        seeds: [
          LEAD_SEED,
          insertSeed('sys_share_link', [
            {
              token: 'tok_dead_on_arrival',
              object_name: 'crm_lead',
              record_id: 'No Such Lead',
              permission: 'read',
              audience: 'anyone_with_link',
            },
          ]),
        ] as any,
        config: CONFIG,
      });

      expect(result.success).toBe(false);
      expect(result.errors.some((e: any) => e.field === 'record_id')).toBe(true);
      expect(logger.error).toHaveBeenCalled();
      expect(store.sys_share_link.filter((r) => r.record_id === 'No Such Lead')).toHaveLength(0);
    });
  });

  it('leaves the UNADOPTED fifth object alone: sys_automation_run stores its trigger pointer verbatim', async () => {
    const { service, store } = newService({
      ...ADOPTER_SCHEMAS,
      // Mirrors the real declaration: the trigger pair carries NO
      // `referenceVia` — the deliberate verdict recorded on the object.
      sys_automation_run: {
        name: 'sys_automation_run',
        fields: {
          flow_name: { type: 'text', required: true },
          status: { type: 'select' },
          trigger_object: { type: 'text' },
          trigger_record_id: { type: 'text' },
        },
      },
    });

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        insertSeed('sys_automation_run', [
          { flow_name: 'lead_scoring', status: 'completed', trigger_object: 'crm_lead', trigger_record_id: 'Lisa Thompson' },
        ]),
      ] as any,
      config: CONFIG,
    });

    // Undeclared stays undeclared: adopting four objects must not quietly
    // change the fifth by column spelling. If a later card rules that runs
    // ARE seedable, this expectation is what it has to come and change.
    expect(result.success).toBe(true);
    expect(store.sys_automation_run[0].trigger_record_id).toBe('Lisa Thompson');
  });
});

/**
 * The load-time EARLY SIGNAL for a deferral on a `required` column — #11674's
 * B half, ruled by triage on 2026-08-24 as "warn (loud) by default", scoped to
 * the required subset, and ⛔ NOT allowed to change the accept set.
 *
 * The failure it announces was already loud: PR #11830 measured against the
 * REAL engine (`packages/objectql/src/engine-seed-required-deferral.test.ts`)
 * that pass 1 defers by DELETING the column, so a `required: true` id half is
 * rejected at insert and pass-2 write-back can never reach the row. What this
 * signal changes is WHEN the author learns — the loader now says it before the
 * write that provokes the rejection, instead of leaving the author to read a
 * driver-level error after the fact.
 *
 * Two failure modes are pinned against, because both look green:
 *  - a signal that NEVER fires  → the FIRES cases below;
 *  - a signal that fires on EVERYTHING → the DOES-NOT-FIRE cases, which are
 *    the ones that give it meaning: an optional id half (`sys_audit_log`,
 *    genuinely order-independent since #11830), a pointer that resolves in
 *    pass 1, and the UPDATE arm, where the deleted column is an omitted field
 *    the write contract never checks.
 *
 * The message wording is pinned in ONE case only; the rest match on the
 * signal's identifying parts (`required`, the field, the target object) so a
 * reworded line does not fail six tests for one change.
 */
describe('required-deferral early signal (#11674)', () => {
  /** The load-time signal, isolated from every other line the loader logs. */
  function requiredDeferralWarnings(logger: ReturnType<typeof createLogger>): string[] {
    return logger.warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => /is `required: true`, but record #/.test(message));
  }

  /**
   * Non-vacuity probe: how many pass-2 back-fill writes landed for `field`.
   *
   * ⛔ NOT `referencesDeferred` — a successful back-fill GIVES THAT COUNTER
   * BACK (the loader decrements it when pass 2 heals the row), so a healed
   * deferral reads as zero and a case asserting `> 0` on it would be asserting
   * that healing FAILED. The pass-2 write itself is the durable evidence that
   * the deferral was taken: pass 1 deleted the column, so only pass 2 can put
   * it back, and its payload is the only `update` carrying that field.
   */
  function passTwoBackfills(engine: ReturnType<typeof newService>['engine'], object: string, field: string): number {
    // Same `as any` reach into the mock the rest of this file uses — the
    // engine is typed as `IDataEngine`, whose `update` carries no mock.
    return (engine.update as any).mock.calls.filter(
      (call: any[]) => call[0] === object && Object.prototype.hasOwnProperty.call(call[1] ?? {}, field),
    ).length;
  }

  it('FIRES when a keyless required id half defers — before the row is written, naming the fix', async () => {
    const { service, logger, engine, store } = newService(ADOPTER_SCHEMAS);

    const result = await service.load({
      seeds: [
        // Approval request BEFORE its target: `record_id` cannot resolve in
        // pass 1, so the loader defers it by deleting the required column.
        insertSeed('sys_approval_request', [
          { process_name: 'flow:discount', object_name: 'crm_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ]),
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // The scenario really deferred — without this the assertion below could
    // pass against a load that never took the deferral branch at all.
    const approvalResult = result.results.find((r) => r.object === 'sys_approval_request')!;
    expect(passTwoBackfills(engine, 'sys_approval_request', 'record_id'), 'no deferral was taken — the signal case is vacuous').toBe(1);

    const warnings = requiredDeferralWarnings(logger);
    expect(warnings).toHaveLength(1);
    // The line owes the author three things: WHICH declaration makes this
    // order-dependent, WHAT the deferral did to the row, and the fix.
    expect(warnings[0]).toContain('sys_approval_request.record_id is `required: true`');
    expect(warnings[0]).toContain('REMOVES the column from the pass-1 insert');
    expect(warnings[0]).toContain('Order the `crm_lead` dataset BEFORE `sys_approval_request`');

    // ⛔ ACCEPT SET UNCHANGED. This engine double does not validate, so the
    // deferred insert lands and #11830's write-back heals it — exactly as it
    // did before this signal existed. The warning is a log line and nothing
    // more: no counter moved, nothing reached `errors`, `success` is untouched.
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(approvalResult.errored).toBe(0);
    expect(approvalResult.referencesDropped).toBe(0);
    expect(store.sys_approval_request[0].record_id).toBe(store.crm_lead[0].id);
  });

  it('DOES NOT FIRE for an OPTIONAL id half deferring the very same way — sys_audit_log stays order-independent', async () => {
    const { service, logger, store, engine } = newService(ADOPTER_SCHEMAS);

    const result = await service.load({
      seeds: [
        insertSeed('sys_audit_log', [
          { action: 'view', actor: 'admin', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
        ]),
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // Same shape, same order, same deferral — the ONLY difference from the
    // case above is that this id half is not `required`.
    expect(passTwoBackfills(engine, 'sys_audit_log', 'record_id'), 'no deferral was taken — the control is vacuous').toBe(1);
    expect(requiredDeferralWarnings(logger)).toHaveLength(0);

    // …and it heals, which is why warning here would be a false alarm.
    expect(result.success).toBe(true);
    const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
    expect(store.sys_audit_log[0].record_id).toBe(leadId);
  });

  it('DOES NOT FIRE when the target is seeded first — the constraint is the deferral, not the declaration', async () => {
    const { service, logger } = newService(ADOPTER_SCHEMAS);

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        insertSeed('sys_approval_request', [
          { process_name: 'flow:discount', object_name: 'crm_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ]),
      ] as any,
      config: CONFIG,
    });

    // Resolved in pass 1: nothing was deferred, so there is nothing to warn
    // about. A signal keyed on the `required` DECLARATION rather than on the
    // deferral would fire here — and then fire on every correctly ordered
    // seed in the repo.
    const approvalResult = result.results.find((r) => r.object === 'sys_approval_request')!;
    expect(approvalResult.referencesDeferred).toBe(0);
    expect(approvalResult.referencesResolved).toBeGreaterThan(0);
    expect(requiredDeferralWarnings(logger)).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it('DOES NOT FIRE on the UPDATE arm: an omitted column is not a cleared one, so the replay succeeds today', async () => {
    const { service, logger, store, engine } = newService(ADOPTER_SCHEMAS);
    // A row this dataset will MATCH on replay — the dev-server-restart shape.
    store.sys_approval_request = [
      { id: 'ar-existing', process_name: 'flow:discount', object_name: 'crm_lead', record_id: 'lead-from-a-previous-run', status: 'pending' },
    ];

    const result = await service.load({
      seeds: [
        {
          object: 'sys_approval_request',
          externalId: 'process_name',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [
            { process_name: 'flow:discount', object_name: 'crm_lead', record_id: 'Lisa Thompson', status: 'approved' },
          ],
        },
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // The deferral IS taken (the target is not seeded yet) …
    const approvalResult = result.results.find((r) => r.object === 'sys_approval_request')!;
    expect(passTwoBackfills(engine, 'sys_approval_request', 'record_id'), 'no deferral was taken — the control is vacuous').toBe(1);
    expect(approvalResult.updated).toBe(1);
    // … but it lands on an UPDATE, where the deleted column is simply omitted
    // and the write contract never checks it. Warning here would announce a
    // rejection that does not happen — measured on the REAL engine in
    // `packages/objectql/src/engine-seed-required-deferral.test.ts`.
    expect(requiredDeferralWarnings(logger)).toHaveLength(0);
    expect(result.success).toBe(true);
    const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
    expect(store.sys_approval_request[0].record_id).toBe(leadId);
  });

  it('says it ONCE per dataset and field, not once per row', async () => {
    const { service, logger, engine } = newService(ADOPTER_SCHEMAS);

    const result = await service.load({
      seeds: [
        insertSeed('sys_approval_request', [
          { process_name: 'flow:a', object_name: 'crm_lead', record_id: 'Lisa Thompson', status: 'pending' },
          { process_name: 'flow:b', object_name: 'crm_lead', record_id: 'Lisa Thompson', status: 'pending' },
          { process_name: 'flow:c', object_name: 'crm_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ]),
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(passTwoBackfills(engine, 'sys_approval_request', 'record_id')).toBe(3);
    // Three rows, one ordering mistake, one line. The author's fix is the same
    // single change for all three — repeating it per row is the noise that
    // trains readers to skim `warn`.
    expect(requiredDeferralWarnings(logger)).toHaveLength(1);
  });

});
