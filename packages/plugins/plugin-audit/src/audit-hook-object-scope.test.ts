// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5860] plugin-audit declares its skip list ON THE REGISTRATION FACE, so the
 * engine's per-object demand gates can see it.
 *
 * ## The defect
 *
 * The five audit registrations (`captureBefore` on `beforeUpdate`/`beforeDelete`,
 * `writeAudit` on `afterInsert`/`afterUpdate`/`afterDelete`) carried no scope at
 * all, so every one of them read as GLOBAL. The knowledge of which objects are
 * audited existed — `SKIP_OBJECTS` — but it lived inside the handler as an early
 * return, where no gate can reach it. `hasHooksFor` therefore answered "yes, a
 * hook covers this object" for `sys_job_queue` as readily as for a business
 * object, and #5284's single-id prior-row gate (`update()`) plus #5038's bulk
 * gates bought a `driver.findOne` / matched-row read for a handler that was
 * going to return on its first line.
 *
 * ## Why an allow list could not fix it (#5928, PR #6575)
 *
 * `SKIP_OBJECTS` is a DENY list over an OPEN universe: `/meta` PUT registers new
 * objects into a running engine with no event a plugin could subscribe to, so a
 * registrant that enumerated the complement would freeze its list at boot and
 * silently stop auditing everything created afterwards — a compliance
 * regression, and a quiet one. The `excludeObjects` face #6575 added is the
 * expression this plugin was missing; `test 3` below is the pin that the deny
 * direction is preserved.
 *
 * ## What each case measures
 *
 *  1. **the flip** — a SKIP object's single-id `update()` stops paying the
 *     prior-row read, and the gate itself answers `false`. RED before this
 *     change (delta 1 / gate `true`).
 *  2. **not over-narrowed** — a business object still demands the read AND
 *     still gets its audit row. Green before and after: the pin exists so a
 *     narrowing that went one step too far cannot pass.
 *  3. **the compliance direction** — an object registered AFTER the writers are
 *     installed is audited, because the declared face SUBTRACTS rather than
 *     enumerates. Green before and after by construction; it is the property
 *     that made `excludeObjects` necessary, so it is pinned where a future
 *     "just list the audited objects" refactor would break it.
 *  4. **the two faces cannot drift** — every name on the registration's
 *     exclusion list is also refused by the handler's early return (kept as
 *     defence in depth, so audit behaviour is conserved).
 *  5. **`writeCommentMentions`** is a closed single-name allow list and now says
 *     so. Behaviour-conserving by construction (the handler's first line
 *     already refused every other object), so this case is a scope pin, not a
 *     flip.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The audit ledger + its activity mirror, single-tenant shape (no org column). */
const sysAuditLog = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    action: { name: 'action', label: 'Action', type: 'text' as const },
    user_id: { name: 'user_id', label: 'User', type: 'text' as const },
    object_name: { name: 'object_name', label: 'Object', type: 'text' as const },
    record_id: { name: 'record_id', label: 'Record', type: 'text' as const },
    old_value: { name: 'old_value', label: 'Old', type: 'textarea' as const },
    new_value: { name: 'new_value', label: 'New', type: 'textarea' as const },
    tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'text' as const },
  },
};

const sysActivity = {
  name: 'sys_activity',
  label: 'Activity',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    type: { name: 'type', label: 'Type', type: 'text' as const },
    timestamp: { name: 'timestamp', label: 'At', type: 'datetime' as const },
    summary: { name: 'summary', label: 'Summary', type: 'text' as const },
    actor_id: { name: 'actor_id', label: 'Actor', type: 'text' as const },
    object_name: { name: 'object_name', label: 'Object', type: 'text' as const },
    record_id: { name: 'record_id', label: 'Record', type: 'text' as const },
    record_label: { name: 'record_label', label: 'Label', type: 'text' as const },
    metadata: { name: 'metadata', label: 'Metadata', type: 'textarea' as const },
  },
};

/**
 * IN `SKIP_OBJECTS` — engine-owned durable queue plumbing (#5193, ADR-0057 D5).
 * The table this issue was measured on: ≥3 writes per queued message, each one
 * buying a prior-row read for a handler that returns immediately.
 */
const sysJobQueue = {
  name: 'sys_job_queue',
  label: 'Job Queue',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    status: { name: 'status', label: 'Status', type: 'text' as const },
    topic: { name: 'topic', label: 'Topic', type: 'text' as const },
  },
};

/** NOT in `SKIP_OBJECTS` — ordinary business truth, must stay fully audited. */
const bizTask = {
  name: 'biz_task',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    status: { name: 'status', label: 'Status', type: 'text' as const },
  },
};

/** Registered only AFTER the writers are installed — case 3's whole point. */
const bizLate = {
  name: 'biz_late_arrival',
  label: 'Late Arrival',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    status: { name: 'status', label: 'Status', type: 'text' as const },
  },
};

const sysComment = {
  name: 'sys_comment',
  label: 'Comment',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    thread_id: { name: 'thread_id', label: 'Thread', type: 'text' as const },
    body: { name: 'body', label: 'Body', type: 'textarea' as const },
    author_id: { name: 'author_id', label: 'Author', type: 'text' as const },
    mentions: { name: 'mentions', label: 'Mentions', type: 'textarea' as const },
  },
};

// ---------------------------------------------------------------------------
// A driver that COUNTS reads, so "pays no extra read" is a measurement
// ---------------------------------------------------------------------------

/**
 * Same shape as `objectql`'s own `engine-update-prior-read-scope.test.ts`
 * counter (this is the `IDataDriver` contract — object name first, primary key
 * SECOND — not an engine double). `findOneOn` is per object because a write can
 * legitimately read a different object, and conflating the two would make the
 * delta below unreadable.
 */
function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const reads = { findOne: 0, find: 0, findOneOn: {} as Record<string, number> };
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matchesWhere(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      reads.find += 1;
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      reads.findOne += 1;
      reads.findOneOn[object] = (reads.findOneOn[object] ?? 0) + 1;
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, storeFor };
}

const BASE_OBJECTS = [sysAuditLog, sysActivity, sysJobQueue, bizTask];

/** Owning package for the fixtures — the registry requires one. */
const OWNER_PACKAGE = 'com.objectstack.test.audit-scope';

async function boot(objects: unknown[] = BASE_OBJECTS) {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o as any, OWNER_PACKAGE);
  return { engine, reads: stub.reads, storeFor: stub.storeFor };
}

/** Audit ledger rows recorded for one object, in write order. */
function auditRowsFor(
  storeFor: (o: string) => Map<string, Record<string, unknown>>,
  objectName: string,
): Array<Record<string, unknown>> {
  return Array.from(storeFor('sys_audit_log').values()).filter((r) => r.object_name === objectName);
}

/** The gate #5284 / #5038 consult. Private on purpose; read directly so the
 *  assertion names the gate rather than inferring it from a side effect. */
const gateOpen = (engine: unknown, event: string, object: string): boolean =>
  (engine as any).hasHooksFor(event, object);

// ---------------------------------------------------------------------------
// 1. The flip — this is the issue's acceptance criterion
// ---------------------------------------------------------------------------

describe('[#5860] a SKIP_OBJECTS object no longer forces the prior-row read', () => {
  it('[#7867] single-id update() on `sys_job_queue` pays ONE prior read — for existence, not for audit', async () => {
    // ⚠️ Asserted 0 between #5860 and #7867, and the flip is deliberate.
    //
    // #5860's acceptance criterion is that the per-object DEMAND GATE judges a
    // SKIP_OBJECTS object unhooked — and that is unchanged, asserted directly
    // by the very next case (`gateOpen(...)` is `false` for all five events)
    // and by the "no audit row is written" case below. What changed is that the
    // gate no longer decides whether the ENGINE LOOKS at the row.
    //
    // #7867 added the not-found gate the by-id write path never had: a write
    // against an id that names no row must answer `RECORD_NOT_FOUND` rather
    // than run on and die on whatever the pipeline complains about first.
    // Existence is a consumer no hook registration can express and the one
    // consumer every by-id write has, so the read is unconditional now — for
    // `sys_job_queue` exactly as for everything else.
    //
    // The number still holds down what this file cares about: it is ONE — the
    // engine's own — not the TWO an audit handler forcing its own read would
    // cost, and the audit ledger below is still empty.
    const { engine, reads } = await boot();
    installAuditWriters(engine);

    const row: any = await engine.insert('sys_job_queue', { topic: 'mail', status: 'pending' });
    const before = reads.findOneOn['sys_job_queue'] ?? 0;
    await engine.update('sys_job_queue', { status: 'running' }, { where: { id: row.id } } as any);

    expect((reads.findOneOn['sys_job_queue'] ?? 0) - before).toBe(1);
  });

  it('the gate itself answers `false` for every audit event on a skipped object', async () => {
    const { engine } = await boot();
    installAuditWriters(engine);

    // The direct reading of the acceptance criterion: not "a read was avoided"
    // but "the per-object demand gate judges this object unhooked".
    expect(gateOpen(engine, 'afterUpdate', 'sys_job_queue')).toBe(false);
    expect(gateOpen(engine, 'afterInsert', 'sys_job_queue')).toBe(false);
    expect(gateOpen(engine, 'afterDelete', 'sys_job_queue')).toBe(false);
    expect(gateOpen(engine, 'beforeUpdate', 'sys_job_queue')).toBe(false);
    expect(gateOpen(engine, 'beforeDelete', 'sys_job_queue')).toBe(false);
  });

  it('no audit or activity row is written for the skipped object either', async () => {
    // Behaviour conservation, measured on the same run as the saving: the read
    // that disappeared was never feeding a row.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine);

    const row: any = await engine.insert('sys_job_queue', { topic: 'mail', status: 'pending' });
    await engine.update('sys_job_queue', { status: 'running' }, { where: { id: row.id } } as any);

    expect(auditRowsFor(storeFor, 'sys_job_queue')).toEqual([]);
    expect(Array.from(storeFor('sys_activity').values())
      .filter((r) => r.object_name === 'sys_job_queue')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Not over-narrowed
// ---------------------------------------------------------------------------

describe('[#5860] an audited object keeps its read and its ledger row', () => {
  it('the gate stays open for a business object — on the AFTER terms (#6656)', async () => {
    const { engine } = await boot();
    installAuditWriters(engine);

    expect(gateOpen(engine, 'afterUpdate', 'biz_task')).toBe(true);
    expect(gateOpen(engine, 'afterInsert', 'biz_task')).toBe(true);
    expect(gateOpen(engine, 'afterDelete', 'biz_task')).toBe(true);

    // [#6656] These two were `true` when this case was written, because
    // `captureBefore` was registered on them. It is retired, so plugin-audit
    // now declares NO before-phase hook for any object.
    //
    // That is deliberately not a weakening of #5860: both demand gates are
    // `hasHooksFor(before*) || hasHooksFor(after*) || getSummaryDescriptors()`
    // (`engine.ts:6992` for update, `:7857` for delete), so the AFTER terms
    // asserted above hold them open and the engine still buys the one
    // pre-image read `writeAudit` consumes. The case below measures exactly
    // that, which is what keeps this pair of expectations from silently
    // meaning "audit stopped seeing the prior row".
    expect(gateOpen(engine, 'beforeUpdate', 'biz_task')).toBe(false);
    expect(gateOpen(engine, 'beforeDelete', 'biz_task')).toBe(false);
  });

  it('single-id update() on `biz_task` still reads the prior row and audits the diff', async () => {
    const { engine, reads, storeFor } = await boot();
    installAuditWriters(engine);

    const row: any = await engine.insert('biz_task', { title: 'Ship it', status: 'todo' });
    const before = reads.findOneOn['biz_task'] ?? 0;
    await engine.update('biz_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    // The count and the effect together: a read that happened but fed nothing
    // would pass the first assertion and fail the second.
    expect((reads.findOneOn['biz_task'] ?? 0) - before).toBeGreaterThan(0);
    const audited = auditRowsFor(storeFor, 'biz_task');
    expect(audited.map((r) => r.action)).toEqual(['create', 'update']);
    expect(JSON.parse(String(audited[1]!.new_value))).toMatchObject({ status: 'in_progress' });
    expect(JSON.parse(String(audited[1]!.old_value))).toMatchObject({ status: 'todo' });
  });
});

// ---------------------------------------------------------------------------
// 3. The compliance direction — why this is a deny list, not an allow list
// ---------------------------------------------------------------------------

describe('[#5860] objects registered AFTER install are audited by default', () => {
  it('a `/meta`-style late registration is covered with no re-install', async () => {
    // This is the property that ruled out enumerating the complement of
    // SKIP_OBJECTS (probe D on #5860, ruling #5928): the audit face must be a
    // list of subtractions, so an object nobody had heard of at boot is
    // audited, not silently skipped. `SchemaRegistry.registerObject` emits no
    // event, so a plugin holding an allow list could never learn about this.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine);

    engine.registry.registerObject(bizLate as any, OWNER_PACKAGE);

    expect(gateOpen(engine, 'afterUpdate', 'biz_late_arrival')).toBe(true);

    const row: any = await engine.insert('biz_late_arrival', { title: 'New', status: 'todo' });
    await engine.update('biz_late_arrival', { status: 'done' }, { where: { id: row.id } } as any);

    expect(auditRowsFor(storeFor, 'biz_late_arrival').map((r) => r.action)).toEqual(['create', 'update']);
  });
});

// ---------------------------------------------------------------------------
// 4/5. The registration face itself
// ---------------------------------------------------------------------------

interface Registration {
  event: string;
  handler: (ctx: any) => any;
  options: Record<string, any> | undefined;
}

/**
 * Records what `installAuditWriters` DECLARES. Deliberately not a data engine —
 * it owns no write verbs, so there is no dispatch contract for it to be looser
 * than; the behaviour half of every claim here is measured on the real
 * `ObjectQL` above.
 */
function makeRecordingEngine() {
  const registrations: Registration[] = [];
  const created: Array<{ object: string; row: Record<string, any> }> = [];
  const sudoApi = {
    object(name: string) {
      return {
        async create(row: Record<string, any>) {
          created.push({ object: name, row });
          return { id: 'generated-id', ...row };
        },
      };
    },
  };
  const engine = {
    getSchema(name: string) {
      return { name, fields: { id: { type: 'text' }, title: { type: 'text' } } };
    },
    registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>) {
      registrations.push({ event, handler, options });
    },
    unregisterHooksByPackage() {},
    logger: { warn() {}, debug() {} },
  };
  const api = { sudo: () => sudoApi };
  return { engine, registrations, created, api };
}

/**
 * The writer registrations: global minus the skip list.
 *
 * [#6656] Was five. `captureBefore`'s `beforeUpdate` / `beforeDelete` pair is
 * retired — the engine binds `previous` before every `before*` dispatch — so
 * three remain. #5860's property is unchanged and is what this case still
 * measures: every registration the plugin DOES declare carries the exclusion
 * on its registration face, and none of them narrows the allow half.
 */
const AUDIT_WRITER_EVENTS = ['afterInsert', 'afterUpdate', 'afterDelete'];

describe('[#5860] the skip list is declared on the registration face', () => {
  it('plugin-audit declares NO GLOBAL `beforeUpdate` / `beforeDelete` hook (#6656)', () => {
    const { engine, registrations } = makeRecordingEngine();
    installAuditWriters(engine);

    // The retirement, asserted on the declaration itself rather than inferred
    // from a read count — this is the face `hasHooksFor` reads, so it is what
    // decides whether the engine's per-row bulk dispatch runs at all.
    //
    // [#10170] The filter is on GLOBAL registrations, not on the event names.
    // It used to be on the event names, and the case above already recorded
    // why that was only ever a PROXY: the plugin's capability gates are
    // "unrelated … on a single named object each", they "read no prior row",
    // and an assertion that caught them "would fail on them while measuring
    // nothing about this card". While those gates were insert-only, filtering
    // by event name expressed that carve-out exactly. #10170 registers them on
    // `beforeUpdate` too — `enable.files`/`enable.feeds` are properties of the
    // TARGET object, so a re-point via update is inside the declaration — and
    // the proxy stopped tracking the property.
    //
    // What #6656 retired was `captureBefore`: an UNSCOPED pre-image reader
    // that made `hasHooksFor(<any object>, 'beforeUpdate')` true system-wide
    // and bought a prior-row read on every update in the stack. That is the
    // invariant, and it is what this now asserts. An object-SCOPED gate costs
    // the demand gate nothing beyond its own object — and on these two
    // objects nothing at all: `comment-access-hooks.ts` (#4630) and
    // service-storage's `attachment-access-hooks.ts` (#10091) already declare
    // `beforeUpdate` scoped to `sys_comment` / `sys_attachment`, so
    // `hasHooksFor` is already true for both wherever the access kits install.
    const globalPreImage = registrations
      .filter((r) => r.event === 'beforeUpdate' || r.event === 'beforeDelete')
      .filter((r) => r.options?.object === undefined)
      .map((r) => r.event);
    expect(globalPreImage).toEqual([]);
  });

  it('[#10170] the two capability gates are declared on insert AND update, each scoped to one object', () => {
    // The other half of the case above: the reason a `beforeUpdate`
    // registration is admissible here is that it names ONE object. Assert that
    // rather than leaving it to the negative filter — a future gate that
    // forgot its `object` scope would otherwise only be caught by the absence
    // test above, which reads as "nothing was retired", not "a gate went
    // global".
    const { engine, registrations } = makeRecordingEngine();
    installAuditWriters(engine);

    // BEFORE-phase only: `sys_comment` also carries the M10.8 @mention
    // notification hook on `afterInsert`, which is not a capability gate.
    const gateEvents = (object: string) =>
      registrations
        .filter((r) => r.options?.object === object && r.event.startsWith('before'))
        .map((r) => r.event)
        .sort();

    expect(gateEvents('sys_comment')).toEqual(['beforeInsert', 'beforeUpdate']);
    expect(gateEvents('sys_attachment')).toEqual(['beforeInsert', 'beforeUpdate']);

    // …and neither of them widened into the global allow half.
    for (const r of registrations) {
      if (r.options?.object === 'sys_comment' || r.options?.object === 'sys_attachment') {
        expect(r.options?.excludeObjects).toBeUndefined();
      }
    }
  });

  it('all writer registrations carry `excludeObjects` and stay global otherwise', () => {
    const { engine, registrations } = makeRecordingEngine();
    installAuditWriters(engine);

    for (const event of AUDIT_WRITER_EVENTS) {
      const writers = registrations.filter(
        (r) => r.event === event && r.options?.excludeObjects !== undefined,
      );
      expect(writers, `no excluding registration for ${event}`).toHaveLength(1);
      const opts = writers[0]!.options!;
      // Still global on the allow half — narrowing THAT is the enumeration
      // mistake case 3 exists to forbid.
      expect(opts.object).toBeUndefined();
      const excluded: string[] = Array.isArray(opts.excludeObjects)
        ? opts.excludeObjects
        : [opts.excludeObjects];
      // Representatives of both reasons a table lands on the list: recursion /
      // auth noise, and ADR-0057 operational telemetry.
      expect(excluded).toContain('sys_audit_log');
      expect(excluded).toContain('sys_activity');
      expect(excluded).toContain('sys_comment');
      expect(excluded).toContain('sys_job_queue');
      expect(excluded).not.toContain('biz_task');
      // #6575 refuses both of these at registration; a spread of the real skip
      // list can never produce them, and this says so out loud.
      expect(excluded).not.toContain('*');
      expect(excluded.every((n) => typeof n === 'string' && n.trim().length > 0)).toBe(true);
    }
  });

  it('the handler early return still refuses every name the registration excludes', async () => {
    // Defence in depth, and the anti-drift pin: the two faces are one list, so
    // a hand-edit that adds a name to only one of them fails here. A handler
    // that stopped refusing would still be correct on a hook-dispatching
    // engine — and wrong for every direct caller and every future dispatch
    // path, which is why the early return was kept rather than deleted.
    const { engine, registrations, created, api } = makeRecordingEngine();
    installAuditWriters(engine);

    const writeAudit = registrations.find(
      (r) => r.event === 'afterUpdate' && r.options?.excludeObjects !== undefined,
    )!;
    const excluded: string[] = writeAudit.options!.excludeObjects;
    expect(excluded.length).toBeGreaterThan(0);

    for (const object of excluded) {
      await writeAudit.handler({
        event: 'afterUpdate',
        object,
        api,
        input: { id: 'x1' },
        result: { id: 'x1', title: 'after' },
        previous: { id: 'x1', title: 'before' },
      });
    }
    expect(created).toEqual([]);

    // Control: the same handler on a name that is NOT excluded does write.
    await writeAudit.handler({
      event: 'afterUpdate',
      object: 'biz_task',
      api,
      input: { id: 'x1' },
      result: { id: 'x1', title: 'after' },
      previous: { id: 'x1', title: 'before' },
    });
    expect(created.map((c) => c.object)).toContain('sys_audit_log');
  });

  it('`writeCommentMentions` is registered for `sys_comment` only', () => {
    const { engine, registrations } = makeRecordingEngine();
    installAuditWriters(engine);

    const mentions = registrations.filter(
      (r) => r.event === 'afterInsert' && r.options?.object === 'sys_comment',
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.options!.excludeObjects).toBeUndefined();
    expect(mentions[0]!.options!.packageId).toBe('com.objectstack.audit');
  });

  it('mention notifications fire for a comment and for nothing else', async () => {
    // Behaviour conservation, not a flip: the handler's first line already
    // refused every other object, so this reads the same before and after the
    // registration was narrowed. It is what makes the narrowing provably free.
    const emit = vi.fn(async (_event: Record<string, unknown>) => {});
    const { engine, storeFor } = await boot([...BASE_OBJECTS, sysComment]);
    installAuditWriters(engine, 'com.objectstack.audit', {
      getMessaging: () => ({ emit } as any),
    });

    await engine.insert('sys_comment', {
      thread_id: 'biz_task:t1',
      body: 'ping @u2',
      author_id: 'u1',
      mentions: JSON.stringify(['u2']),
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toMatchObject({ topic: 'collab.mention', audience: ['u2'] });

    // A non-comment insert carrying the same shape must not reach it.
    emit.mockClear();
    await engine.insert('biz_task', { title: 'unrelated', status: 'todo' });
    expect(emit).not.toHaveBeenCalled();

    // And sys_comment stays out of the ledger — it has its own feed.
    expect(auditRowsFor(storeFor, 'sys_comment')).toEqual([]);
  });
});
