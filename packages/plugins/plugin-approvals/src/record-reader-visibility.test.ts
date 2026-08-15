// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Record-reader approval visibility (#8652) — the built-in, read-only tier.
 *
 * ## What the maintainer ruled (2026-08-15)
 *
 * A user with read access to the target business record may view that record's
 * approval requests and full action history, READ-ONLY (no approval actions
 * delivered through this tier), behind a switch that is **default OFF**, and
 * anchored on the EXISTING record-read permission rather than a new permission
 * concept. The rejected alternative was a host-side visibility hook: exporting
 * a security predicate to host projects is a decision the platform can neither
 * constrain nor audit.
 *
 * ## What this file pins, and why each pin is load-bearing
 *
 * The security-critical property is that the tier is **purely additive to an
 * existing visibility set and cannot widen anything else**. That is three
 * separate claims, and each is pinned in the direction that can actually fail:
 *
 *   1. **switch OFF ⇒ today's visible set, unchanged.** The non-breaking
 *      guarantee, and the one a future refactor breaks silently — nothing about
 *      an over-wide default looks wrong at a call site.
 *   2. **switch ON ⇒ a reader of the target record sees the request and its
 *      full action history, and STILL CANNOT ACT.** Read-only is not a property
 *      of the read path; it is a property of the write paths continuing to
 *      refuse. Pinned by attempting the actions.
 *   3. **a user who CANNOT read the target record sees nothing change, in
 *      either switch position.** The pin that fails if the probe is ever
 *      short-circuited — including by the exact mistake that would be invisible
 *      in review: probing the business record with `SYSTEM_CTX` instead of the
 *      caller's own context, which admits everyone while reading like a
 *      permission check.
 *
 * The pins were checked against an ablated implementation rather than assumed
 * to bite (see the PR body): removing the record-read probe reddens (3);
 * removing the default-OFF guard reddens (1). A negative pin that survives the
 * over-exposure it names is worthless, so this was measured, not reasoned.
 *
 * ## Why the fake engine models permission at all
 *
 * `approval-service.test.ts`'s double ignores `context` on `find` — correct for
 * what it tests, useless here: this capability's whole subject is whether a
 * read is permitted, so a double that permits everything would make every pin
 * below green against an implementation that checks nothing. This double
 * therefore mirrors the two shapes the real stack refuses in
 * (`plugin-security`'s ObjectQL middleware): a CRUD denial THROWS, and a row
 * the caller may not see is FILTERED OUT. Both are exercised.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';

import { ApprovalService } from './approval-service.js';

interface FakeRow { [k: string]: any }

const OBJECT = 'exam_sheet';
const RECORD = 'sheet_1';
const REQUEST = 'req_1';
const TENANT = 't1';

/**
 * Engine double that enforces read permission on BUSINESS objects the way the
 * real stack does, and leaves the `sys_approval_*` tables open (the service
 * reads those with `SYSTEM_CTX` on purpose — the approver-visibility rule spans
 * identity forms RLS cannot model, which is why it lives in the service).
 */
function makePermissionedEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);

  /** userId -> record ids of OBJECT they may read. A user absent from the map holds no read on the object at all. */
  const readable = new Map<string, Set<string>>();
  /** Every business-object read, with the predicate and context it presented. */
  const businessReads: Array<{ object: string; where: any; context: any }> = [];

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      if (k === '$and') {
        if (!(v as any[]).every(sub => matches(row, sub))) return false;
        continue;
      }
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$contains' in (v as any)) {
        if (!String(rv ?? '').includes(String((v as any).$contains))) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    _businessReads: businessReads,
    /** Grant `user` read on one record of the business object (RLS-style row grant). */
    grantRead(user: string, recordId: string) {
      if (!readable.has(user)) readable.set(user, new Set());
      readable.get(user)!.add(recordId);
    },
    /** Give `user` the object-level read with NO rows — the RLS-filtered shape. */
    grantObjectReadOnly(user: string) {
      if (!readable.has(user)) readable.set(user, new Set());
    },
    async find(object: string, options?: any) {
      const context = options?.context;
      const isBusiness = !object.startsWith('sys_');
      if (isBusiness) {
        businessReads.push({ object, where: options?.filter ?? options?.where, context });
        // Mirrors plugin-security's middleware: `isSystem` short-circuits the
        // whole gate; anything else is judged.
        if (!context?.isSystem) {
          const uid = context?.userId != null ? String(context.userId) : '';
          if (!uid || !readable.has(uid)) {
            // CRUD denial — the real engine throws PermissionDeniedError here.
            throw new Error(`[Security] Access denied: no read on '${object}'`);
          }
          const grants = readable.get(uid)!;
          const rows = ensure(object).filter(
            r => matches(r, options?.filter ?? options?.where) && grants.has(String(r.id)),
          );
          return rows.slice(0, options?.limit ?? 1000);
        }
      }
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        const { field, order } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      const start = options?.offset ?? 0;
      return rows.slice(start, start + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) {
      ensure(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, data: any, options?: any) {
      // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate, for the
      // same reason as `delete` below: a double that accepts a call the real
      // engine refuses turns a green suite into no suite at all.
      const dispatch = assertEngineUpdateDispatch(data, options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i], options?.where)) { table[i] = { ...table[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      // [#4550] Pinned to ObjectQL.delete's OWN dispatch predicate — a double
      // looser than the engine it stands in for turns a green suite into no
      // suite at all.
      const dispatch = assertEngineDeleteDispatch(options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        const survivors = table.filter(r => !matches(r, options?.where));
        const deleted = table.length - survivors.length;
        table.splice(0, table.length, ...survivors);
        return { deleted };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table.splice(i, 1);
      return { id: dispatch.id };
    },
  };
}

const asUser = (userId: string) =>
  ({ userId, tenantId: TENANT, positions: [], permissions: [] }) as any;

describe('record-reader approval visibility (#8652)', () => {
  let engine: ReturnType<typeof makePermissionedEngine>;

  /** The business record, one completed 3-step request on it, and its history. */
  function seed() {
    engine._tables[OBJECT] = [{ id: RECORD, name: 'Q1 assessment', organization_id: TENANT }];
    engine._tables['sys_approval_request'] = [{
      id: REQUEST,
      organization_id: TENANT,
      process_name: 'flow:exam_review',
      object_name: OBJECT,
      record_id: RECORD,
      submitter_id: 'submitter',
      status: 'pending',
      current_step: 'finance',
      pending_approvers: 'finance_user',
      payload_json: JSON.stringify({ id: RECORD, name: 'Q1 assessment' }),
      created_at: '2026-08-01T00:00:00Z',
    }];
    // The normalized pending-approver index — how a CURRENT approver is
    // resolved (the `pending_approvers` CSV on the row above is the display
    // copy; `approverRequestIds` reads this table).
    engine._tables['sys_approval_approver'] = [
      { id: 'idx_1', request_id: REQUEST, approver: 'finance_user', organization_id: TENANT },
    ];
    engine._tables['sys_approval_action'] = [
      {
        id: 'act_1', request_id: REQUEST, step_name: 'dept_head', action: 'approve',
        actor_id: 'dept_head', comment: 'Meets the target.', created_at: '2026-08-01T01:00:00Z',
      },
      {
        id: 'act_2', request_id: REQUEST, step_name: 'gm', action: 'approve',
        actor_id: 'gm', comment: 'Agreed.', created_at: '2026-08-01T02:00:00Z',
      },
    ];
  }

  /** A ledger role that holds read on the business record but is no approval participant. */
  const LEDGER_ROLE = 'ledger_clerk';

  function service(recordReaderVisibleObjects?: string[]) {
    return new ApprovalService({
      engine: engine as any,
      ...(recordReaderVisibleObjects ? { recordReaderVisibleObjects } : {}),
    } as any);
  }

  beforeEach(() => {
    engine = makePermissionedEngine();
    seed();
    engine.grantRead(LEDGER_ROLE, RECORD);
  });

  // ── 1. The premise the whole card rests on ────────────────────────────

  describe('today (switch absent) — the measured downstream symptom', () => {
    it('a record-reader who is not a participant gets an EMPTY LIST, not a refusal', async () => {
      const svc = service();
      // The distinction the card is built on: visibility filtering, not an
      // object-permission refusal. A `403` would mean the anchor ("they can
      // read the record") does not attach where everyone assumes.
      const rows = await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE));
      expect(rows).toEqual([]);
    });

    it('…while the same account reads the business record itself perfectly well', async () => {
      const rows = await engine.find(OBJECT, { where: { id: RECORD }, context: asUser(LEDGER_ROLE) });
      expect(rows).toHaveLength(1);
    });

    it('the participants are unaffected — submitter and current approver still see it', async () => {
      const svc = service();
      for (const uid of ['submitter', 'finance_user']) {
        const rows = await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(uid));
        expect(rows.map(r => r.id)).toEqual([REQUEST]);
      }
    });
  });

  // ── 2. Switch OFF ⇒ byte-for-byte today's visible set ─────────────────

  describe('switch OFF (the default)', () => {
    it.each([
      ['omitted', undefined],
      ['an empty list', [] as string[]],
    ])('%s ⇒ the record-reader still sees nothing', async (_label, objects) => {
      const svc = service(objects as string[] | undefined);
      expect(await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE))).toEqual([]);
      expect(await svc.countRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE))).toBe(0);
      expect(await svc.getRequest(REQUEST, asUser(LEDGER_ROLE))).toBeNull();
      expect(await svc.listActions(REQUEST, asUser(LEDGER_ROLE))).toEqual([]);
    });

    it('an object OUTSIDE the enabled list is not enabled by another object being in it', async () => {
      const svc = service(['some_other_object']);
      expect(await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE))).toEqual([]);
      expect(await svc.getRequest(REQUEST, asUser(LEDGER_ROLE))).toBeNull();
    });

    it('the tier never probes the business record while it is off', async () => {
      const svc = service();
      await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE));
      // No read of the business object at all: OFF is a short-circuit, not a
      // probe whose answer is discarded.
      expect(engine._businessReads).toEqual([]);
    });
  });

  // ── 3. Switch ON ⇒ the reader sees it, and still cannot act ───────────

  describe('switch ON for this object', () => {
    it('the record-reader sees the request', async () => {
      const svc = service([OBJECT]);
      const rows = await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE));
      expect(rows.map(r => r.id)).toEqual([REQUEST]);
      expect(await svc.countRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE))).toBe(1);
      expect((await svc.getRequest(REQUEST, asUser(LEDGER_ROLE)))?.id).toBe(REQUEST);
    });

    it('…and its full action history — who, when, which decision', async () => {
      const svc = service([OBJECT]);
      const actions = await svc.listActions(REQUEST, asUser(LEDGER_ROLE));
      expect(actions.map(a => [a.actor_id, a.action, a.created_at])).toEqual([
        ['dept_head', 'approve', '2026-08-01T01:00:00Z'],
        ['gm', 'approve', '2026-08-01T02:00:00Z'],
      ]);
    });

    it('the history carries the action COMMENT text (意见正文) — the ruling\'s "full action history"', async () => {
      // Pinned deliberately, and flagged as the open granularity fork in the PR
      // body: `comment` is the field that most changes the size of this
      // capability, so the behaviour must be asserted rather than incidental.
      // If the maintainer narrows the tier, THIS is the test that must change,
      // which is exactly the property that makes the narrowing deliberate.
      const svc = service([OBJECT]);
      const actions = await svc.listActions(REQUEST, asUser(LEDGER_ROLE));
      expect(actions.map(a => a.comment)).toEqual(['Meets the target.', 'Agreed.']);
    });

    it('the probe presents the CALLER\'s context, never a system context', async () => {
      // The mistake this pin exists for: probing the business record with
      // `SYSTEM_CTX` reads exactly like a permission check, passes every
      // positive test, and admits every authenticated user in the tenant.
      //
      // Identified by shape rather than by ordinal, because it is not the only
      // business read on this path: once a row is ADMITTED, `enrichRows`
      // resolves its display title with `SYSTEM_CTX` (pre-existing #3266-era
      // display enrichment, unchanged here — and reached only by a caller this
      // tier already admitted). So "no system-context read anywhere" would be
      // the wrong assertion; "the read that DECIDES is the caller's" is the
      // right one.
      const svc = service([OBJECT]);
      await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE));
      const probes = engine._businessReads.filter(r => r.where?.id === RECORD);
      expect(probes).toHaveLength(1);
      expect(probes[0].object).toBe(OBJECT);
      expect(probes[0].context?.isSystem).not.toBe(true);
      expect(probes[0].context?.userId).toBe(LEDGER_ROLE);
      // …and it is the FIRST business read: the verdict is reached before any
      // enrichment runs, so nothing is fetched for a caller who is refused.
      expect(engine._businessReads[0]).toBe(probes[0]);
    });

    it('READ-ONLY: the reader still cannot approve, reject, reassign or comment', async () => {
      const svc = service([OBJECT]);
      const ctx = asUser(LEDGER_ROLE);
      // `FORBIDDEN:` is this service's error code; the REST layer maps that
      // prefix to HTTP 403 (`rest-server.ts` handleApprovalError). Seeing a
      // request is not a licence to decide it.
      await expect(svc.decide(REQUEST, { decision: 'approve', actorId: LEDGER_ROLE }, ctx))
        .rejects.toThrow(/^FORBIDDEN/);
      await expect(svc.decide(REQUEST, { decision: 'reject', actorId: LEDGER_ROLE }, ctx))
        .rejects.toThrow(/^FORBIDDEN/);
      await expect(svc.reassign(REQUEST, { actorId: LEDGER_ROLE, to: LEDGER_ROLE }, ctx))
        .rejects.toThrow(/^FORBIDDEN/);
      await expect(svc.comment(REQUEST, { actorId: LEDGER_ROLE, comment: 'hi' }, ctx))
        .rejects.toThrow(/^FORBIDDEN/);
      await expect(svc.recall(REQUEST, { actorId: LEDGER_ROLE }, ctx))
        .rejects.toThrow(/^FORBIDDEN/);
    });

    it('READ-ONLY: the row it reads offers the reader no decision affordance', async () => {
      const svc = service([OBJECT]);
      const row: any = await svc.getRequest(REQUEST, asUser(LEDGER_ROLE));
      // What a console ORs into the decision actions' `visible` gate.
      expect(row.viewer).toEqual({ can_act: false, is_submitter: false, can_override: false });
    });
  });

  // ── 4. A user who cannot read the record sees nothing change ──────────

  describe('a user who cannot read the target record', () => {
    it('is refused in BOTH switch positions — object-level denial (the throw shape)', async () => {
      const stranger = asUser('stranger'); // holds no read on the object at all
      for (const objects of [undefined, [OBJECT]]) {
        const svc = service(objects);
        expect(await svc.listRequests({ object: OBJECT, recordId: RECORD }, stranger)).toEqual([]);
        expect(await svc.countRequests({ object: OBJECT, recordId: RECORD }, stranger)).toBe(0);
        expect(await svc.getRequest(REQUEST, stranger)).toBeNull();
        expect(await svc.listActions(REQUEST, stranger)).toEqual([]);
      }
    });

    it('is refused when the row is filtered away by RLS (the empty-result shape)', async () => {
      // Holds the object-level read but no grant on THIS row — the shape a
      // `catch`-only implementation would wave through.
      engine.grantObjectReadOnly('rls_filtered');
      const svc = service([OBJECT]);
      const ctx = asUser('rls_filtered');
      expect(await svc.listRequests({ object: OBJECT, recordId: RECORD }, ctx)).toEqual([]);
      expect(await svc.getRequest(REQUEST, ctx)).toBeNull();
      expect(await svc.listActions(REQUEST, ctx)).toEqual([]);
    });

    it('an anonymous / tokenless caller is refused with the tier ON', async () => {
      const svc = service([OBJECT]);
      const anon = { tenantId: TENANT, positions: [], permissions: [] } as any;
      expect(await svc.listRequests({ object: OBJECT, recordId: RECORD }, anon)).toEqual([]);
      expect(await svc.getRequest(REQUEST, anon)).toBeNull();
    });
  });

  // ── 5. Additive only: nothing else widens ─────────────────────────────

  describe('the tier is additive and bounded', () => {
    it('an UNTARGETED list is unchanged — the tier does not turn the inbox into a browse surface', async () => {
      const svc = service([OBJECT]);
      // No object/recordId: nothing names a target record, so there is nothing
      // to anchor the read permission on. Participants only, as before.
      expect(await svc.listRequests(undefined, asUser(LEDGER_ROLE))).toEqual([]);
      expect(await svc.listRequests({ status: 'pending' }, asUser(LEDGER_ROLE))).toEqual([]);
      expect((await svc.listRequests(undefined, asUser('submitter'))).map(r => r.id)).toEqual([REQUEST]);
    });

    it('does not leak a request on a DIFFERENT record of an enabled object', async () => {
      engine._tables[OBJECT].push({ id: 'sheet_2', organization_id: TENANT });
      engine._tables['sys_approval_request'].push({
        ...engine._tables['sys_approval_request'][0], id: 'req_2', record_id: 'sheet_2',
      });
      const svc = service([OBJECT]);
      // The reader is granted `sheet_1` only.
      const rows = await svc.listRequests({ object: OBJECT, recordId: 'sheet_2' }, asUser(LEDGER_ROLE));
      expect(rows).toEqual([]);
      expect(await svc.getRequest('req_2', asUser(LEDGER_ROLE))).toBeNull();
    });

    it('does not cross the tenant wall', async () => {
      engine._tables['sys_approval_request'][0].organization_id = 'other_tenant';
      const svc = service([OBJECT]);
      expect(await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser(LEDGER_ROLE))).toEqual([]);
      expect(await svc.getRequest(REQUEST, asUser(LEDGER_ROLE))).toBeNull();
    });

    it('a participant keeps their visibility when the tier is on', async () => {
      const svc = service([OBJECT]);
      expect((await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser('submitter'))).map(r => r.id))
        .toEqual([REQUEST]);
      // …and a past actor whose slot has moved on.
      expect((await svc.listRequests({ object: OBJECT, recordId: RECORD }, asUser('dept_head'))).map(r => r.id))
        .toEqual([REQUEST]);
    });
  });
});
