// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15072] The `field` sharing recipient — the services half of the #14103
 * ruling (maintainer, 2026-09-02, B): `sharedWith: { type: 'field', value:
 * '<user-field-name>' }` shares each matched record with the user or users
 * named by that column ON THE RECORD, honouring `multiple: true`;
 * `expandRecipient` becomes per-record for that member ONLY; ⛔ no `manager`
 * member.
 *
 * ## What this file pins, and why each pin exists
 *
 * The executor contract (issue #15072, comment 5532175167) has seven points;
 * the discharged precondition (comment 5535095827) adds two rule-wide call
 * sites of `expandRecipient` that the contract's per-record reading does not
 * cover. Every `describe` below names which of those it guards:
 *
 *  1. **Per record** — `evaluateAllForRecord`, the write-hook pass: single
 *     column, multi column, FAIL-CLOSED on empty (never an owner fallback),
 *     and the record's own users never reaching another record.
 *  2. **Re-materialisation on the record's own write** — driven through the
 *     real `bindRuleHooks` binding: a write touching ONLY the recipient column
 *     revokes the stale grant and materialises the new one, with NO second
 *     trigger (the bound hook set is unchanged).
 *  3. **Site 2, `evaluateRule`** — the whole-rule pass behind the background
 *     re-grant, the boot backfill and the REST evaluate endpoint: per-record
 *     pairs, never a cartesian product, and the unbounded-bulk-write path
 *     (`revokeRuleGrantsForObject` → `evaluateAllRulesForObject`) restores
 *     exactly the per-record grants.
 *  4. **Site 3, `revokeRuleGrantsForRetiredRecipients`** — declines a `field`
 *     rule at the door (0, no grant touched), beside a control that still
 *     retires a rule-wide recipient, and the BU-graph recompute that is its one
 *     caller never hands a `field` rule in.
 *  5. **The ruling's explicit pin** — a `position` recipient still expands
 *     RULE-WIDE: one holder read per pass however many records match, while
 *     the `field` rule's expansion reads no principal table at all.
 *  6. **The column must hold users** — when the object's schema can say:
 *     a `user` field or a `sys_user` lookup is read, anything else grants
 *     nobody and warns once; a failing read fails closed and warns once.
 *  7. **Authoring seams** — the declared-rule bootstrap seeds a `field` rule
 *     (it used to skip it), `defineRule` holds a `field` `recipientId` to the
 *     field-name grammar, and the `sys_sharing_rule.recipient_type` select can
 *     store every authorable `ShareRecipientType` member.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ShareRecipientType } from '@objectstack/spec/security';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { bindRuleHooks, unbindAllRuleHooks, SHARING_RULE_HOOK_PACKAGE } from './rule-hooks.js';
import { bindBusinessUnitTreeRecompute } from './bu-tree-recompute.js';
import { bootstrapDeclaredSharingRules } from './bootstrap-declared-sharing-rules.js';
import { SysSharingRule } from './objects/sys-sharing-rule.object.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** What an interactive admin's write carries. */
const ADMIN_SESSION = { isSystem: false, userId: 'admin' };

type HookEntry = { event: string; handler: (ctx: any) => any; options: Row };

function matches(row: Row, f: any): boolean {
  if (!f || typeof f !== 'object') return true;
  // A combinator is CONJOINED with its sibling field keys, never a
  // short-circuit that returns before they are read (#7676) — `listRules`
  // composes `{object_name, active, $or:[…org scope…]}`.
  if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
  if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
  for (const [k, v] of Object.entries(f)) {
    if (k === '$or' || k === '$and') continue;
    const rv = row[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const op: any = v;
      if ('$in' in op) { if (!op.$in.includes(rv)) return false; continue; }
      if ('$ne' in op) { if (rv === op.$ne) return false; continue; }
      if ('$gte' in op) { if (!(rv >= op.$gte)) return false; continue; }
    }
    if (rv !== v) return false;
  }
  return true;
}

/**
 * A fake ObjectQL engine: tables, an optional schema per object, a hook
 * registry the real `bindRuleHooks` can bind to, and a `find` census. Both
 * write verbs open with the PRODUCER's own dispatch predicate (#4550 / #5480)
 * so a double looser than `ObjectQL` cannot green a call production refuses.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const schemas: Record<string, Row> = {};
  const hooks: HookEntry[] = [];
  const finds: Array<{ object: string; fields?: string[] }> = [];
  const ensure = (n: string) => (tables[n] ??= []);
  let seq = 0;

  const engine = {
    _tables: tables,
    _schemas: schemas,
    _finds: finds,
    /** A projected field name whose read the engine refuses (`INVALID_FIELD`). */
    _refuseField: '' as string,
    getSchema(name: string) { return schemas[name]; },
    seed(object: string, rows: Row[]) { ensure(object).push(...rows.map((r) => ({ ...r }))); },
    async find(o: string, opts?: any) {
      finds.push({ object: o, fields: opts?.fields });
      if (engine._refuseField && Array.isArray(opts?.fields) && opts.fields.includes(engine._refuseField)) {
        const err: any = new Error(`Unknown field '${engine._refuseField}' on ${o}`);
        err.code = 'INVALID_FIELD';
        throw err;
      }
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) {
      const row = { id: data.id ?? `${o}_${++seq}`, ...data };
      ensure(o).push(row);
      return row;
    },
    async update(o: string, data: any, options?: any) {
      const verdict = assertEngineUpdateDispatch(data, options);
      const t = ensure(o);
      const targets = verdict.kind === 'by-id'
        ? t.filter((r) => r.id === verdict.id)
        : t.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return verdict.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(o: string, opts?: any) {
      assertEngineDeleteDispatch(opts);
      const t = ensure(o);
      const where = opts?.where ?? (opts?.id != null ? { id: opts.id } : {});
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
    registerHook(event: string, handler: (ctx: any) => any, options: Row = {}) {
      hooks.push({ event, handler, options });
    },
    unregisterHooksByPackage(packageId: string) {
      let removed = 0;
      for (let i = hooks.length - 1; i >= 0; i--) {
        if (hooks[i].options.packageId === packageId) { hooks.splice(i, 1); removed++; }
      }
      return removed;
    },
    boundFor(packageId: string, object?: string) {
      return hooks.filter((h) => h.options.packageId === packageId && (!object || h.options.object === object));
    },
    async fire(event: string, object: string, ctx: any) {
      for (const h of [...hooks]) {
        if (h.event === event && h.options.object === object) await h.handler(ctx);
      }
    },
    /** One row insert, fired the way the engine fires `afterInsert`. */
    async simulateInsert(object: string, row: Row, session: any = ADMIN_SESSION) {
      ensure(object).push({ ...row });
      await engine.fire('afterInsert', object, {
        object, event: 'afterInsert', input: { data: row }, result: row, session,
      });
    },
    /**
     * A SINGLE-ID update — the shape the `before` stash resolves without
     * querying (`resolveAffectedRows` step 1), so `afterUpdate` takes its
     * bounded per-row branch.
     */
    async simulateUpdate(object: string, id: string, data: Row, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object, event: 'beforeUpdate',
        input: { id, data: { ...data, id }, options: {} },
        session,
      };
      await engine.fire('beforeUpdate', object, ctx);
      const t = ensure(object);
      const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      ctx.event = 'afterUpdate';
      await engine.fire('afterUpdate', object, ctx);
    },
  };
  return engine;
}

type Engine = ReturnType<typeof makeEngine>;

const OBJECT = 'request';
const RULE = 'approved_to_assignees';

/** The `field` rule under test: approved requests → the users the row's `assignees` column names. */
const fieldRule = (over: Row = {}): Row => ({
  id: 'srule_assignees', organization_id: null, name: RULE,
  label: 'Approved requests → assignees', object_name: OBJECT,
  criteria_json: JSON.stringify({ status: 'approved' }),
  recipient_type: 'field', recipient_id: 'assignees',
  access_level: 'read', active: true, managed_by: 'package',
  ...over,
});

function harness() {
  const engine = makeEngine();
  const warn = vi.fn();
  const sharing = new SharingService({ engine: engine as any });
  const rules = new SharingRuleService({ engine: engine as any, sharing, logger: { warn } as any });
  /** Who currently holds a rule-materialised grant on `recordId`, sorted. */
  const granteesOf = (recordId: string, ruleId = 'srule_assignees'): string[] =>
    (engine._tables.sys_record_share ?? [])
      .filter((r) => r.record_id === recordId && r.source === 'rule' && r.source_id === ruleId)
      .map((r) => String(r.recipient_id))
      .sort();
  const ruleShares = (ruleId = 'srule_assignees') =>
    (engine._tables.sys_record_share ?? []).filter((r) => r.source === 'rule' && r.source_id === ruleId);
  /** A grant the rule materialised at some earlier point — the stale row a reconcile must retire. */
  const seedStaleGrant = (recordId: string, userId: string, ruleId = 'srule_assignees') =>
    engine.seed('sys_record_share', [{
      id: `shr_stale_${recordId}_${userId}`, object_name: OBJECT, record_id: recordId,
      recipient_type: 'user', recipient_id: userId, access_level: 'read',
      source: 'rule', source_id: ruleId,
    }]);
  const fieldWarns = () => warn.mock.calls.filter((c) => String(c[0]).includes('field-recipient rule grants NOBODY'));
  return { engine, rules, sharing, warn, granteesOf, ruleShares, seedStaleGrant, fieldWarns };
}

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 per record — `evaluateAllForRecord`, the write-hook pass', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
    h.engine.seed('sys_sharing_rule', [fieldRule()]);
  });

  it('a single-user column shares the record with the one user it names', async () => {
    h.engine.seed('sys_sharing_rule', [fieldRule({ id: 'srule_mgr', name: 'approved_to_manager', recipient_id: 'owner_manager' })]);
    h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', owner_manager: 'u_mgr', assignees: null }]);

    const results = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);

    expect(h.granteesOf('req_1', 'srule_mgr')).toEqual(['u_mgr']);
    const mine = results.find((r) => r.ruleId === 'srule_mgr')!;
    expect(mine).toMatchObject({ matchedRecords: 1, expandedUsers: 1, grantsCreated: 1, grantsRevoked: 0 });
  });

  it('a multi-user column (`multiple: true`) shares with EVERY user it names, once each', async () => {
    h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a', 'u_b', 'u_a'] }]);

    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);

    expect(h.granteesOf('req_1')).toEqual(['u_a', 'u_b']);
    expect(result).toMatchObject({ matchedRecords: 1, expandedUsers: 2, grantsCreated: 2 });
  });

  describe('FAIL-CLOSED on empty (executor-contract point 3)', () => {
    it.each([
      ['null', null],
      ['undefined (column absent from the row)', undefined],
      ['an empty string', ''],
      ['an empty array', []],
      ['whitespace', '   '],
    ])('%s materialises no grant', async (_label, value) => {
      const row: Row = { id: 'req_1', status: 'approved', owner_id: 'boss' };
      if (value !== undefined) row.assignees = value;
      h.engine.seed(OBJECT, [row]);

      const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);

      expect(h.granteesOf('req_1')).toEqual([]);
      expect(result).toMatchObject({ matchedRecords: 1, expandedUsers: 0, grantsCreated: 0 });
      // Not a misconfiguration: an unassigned record shares with nobody by design.
      expect(h.fieldWarns()).toHaveLength(0);
    });

    it('never falls back to the record owner: an empty column does not share with `owner_id`', async () => {
      h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', assignees: [] }]);
      await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
      expect(h.granteesOf('req_1')).not.toContain('boss');
      expect(h.ruleShares()).toEqual([]);
    });

    it('a value that is not a user id — an object — names nobody', async () => {
      h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', assignees: { id: 'u_a' } }]);
      await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
      expect(h.granteesOf('req_1')).toEqual([]);
    });
  });

  it('a stale grant is REVOKED when the column no longer names its user', async () => {
    h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_new'] }]);
    h.seedStaleGrant('req_1', 'u_old');

    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);

    expect(h.granteesOf('req_1')).toEqual(['u_new']);
    expect(result).toMatchObject({ grantsCreated: 1, grantsRevoked: 1 });
  });

  it('an emptied column revokes the grant it once earned (fail-closed in the revoke direction too)', async () => {
    h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', assignees: null }]);
    h.seedStaleGrant('req_1', 'u_old');

    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);

    expect(h.granteesOf('req_1')).toEqual([]);
    expect(result).toMatchObject({ matchedRecords: 1, grantsCreated: 0, grantsRevoked: 1 });
  });

  it('the criteria still bite: a filled column on a record OUTSIDE the criteria grants nobody', async () => {
    h.engine.seed(OBJECT, [{ id: 'req_draft', status: 'draft', owner_id: 'boss', assignees: ['u_a'] }]);
    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_draft', SYS);
    expect(h.granteesOf('req_draft')).toEqual([]);
    expect(result).toMatchObject({ matchedRecords: 0, expandedUsers: 0 });
  });

  it('the users are read from THE matched record — one record\'s users never reach another', async () => {
    h.engine.seed(OBJECT, [
      { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] },
      { id: 'req_2', status: 'approved', owner_id: 'boss', assignees: ['u_b'] },
    ]);
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    await h.rules.evaluateAllForRecord(OBJECT, 'req_2', SYS);
    expect(h.granteesOf('req_1')).toEqual(['u_a']);
    expect(h.granteesOf('req_2')).toEqual(['u_b']);
  });

  it('an INACTIVE field rule desires nothing and purges what it held', async () => {
    h.engine._tables.sys_sharing_rule = [fieldRule({ active: false })];
    h.engine.seed(OBJECT, [{ id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] }]);
    h.seedStaleGrant('req_1', 'u_a');
    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    expect(h.granteesOf('req_1')).toEqual([]);
    expect(result).toMatchObject({ matchedRecords: 0, grantsRevoked: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 re-materialisation on the record\'s OWN write (executor-contract point 4)', () => {
  let h: ReturnType<typeof harness>;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  /** Bind the real hooks against whatever is in `sys_sharing_rule`. */
  const bind = async () => {
    const ruleRows = await h.rules.listRules({ activeOnly: true }, SYS);
    unbindAllRuleHooks(h.engine as any);
    bindRuleHooks(h.engine as any, h.rules, ruleRows, logger);
  };

  beforeEach(async () => {
    h = harness();
    h.engine.seed('sys_sharing_rule', [fieldRule()]);
    await bind();
  });

  it('an insert naming a user materialises the grant through `afterInsert`', async () => {
    await h.engine.simulateInsert(OBJECT, { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] });
    expect(h.granteesOf('req_1')).toEqual(['u_a']);
  });

  it('a write that changes ONLY the recipient column revokes the stale grant and materialises the new one', async () => {
    await h.engine.simulateInsert(OBJECT, { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] });
    expect(h.granteesOf('req_1')).toEqual(['u_a']);

    // The patch carries the recipient column and nothing else — the criteria
    // column is untouched, so this is the write the precondition asked about:
    // `afterUpdate` has no changed-field gating and re-runs the per-record
    // reconcile regardless of which columns moved.
    await h.engine.simulateUpdate(OBJECT, 'req_1', { assignees: ['u_b'] });

    expect(h.granteesOf('req_1')).toEqual(['u_b']);
    // The old grant is gone, not merely joined by a new one.
    expect(h.ruleShares().map((r) => r.recipient_id)).toEqual(['u_b']);
  });

  it('widening the column (one user → two) adds the second grant and keeps the first', async () => {
    await h.engine.simulateInsert(OBJECT, { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] });
    await h.engine.simulateUpdate(OBJECT, 'req_1', { assignees: ['u_a', 'u_b'] });
    expect(h.granteesOf('req_1')).toEqual(['u_a', 'u_b']);
  });

  it('clearing the column withdraws every grant the record held (fail-closed on the write path)', async () => {
    await h.engine.simulateInsert(OBJECT, { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a', 'u_b'] });
    await h.engine.simulateUpdate(OBJECT, 'req_1', { assignees: [] });
    expect(h.granteesOf('req_1')).toEqual([]);
  });

  it('a write moving the record OUT of the criteria withdraws the grant, whatever the column says', async () => {
    await h.engine.simulateInsert(OBJECT, { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] });
    await h.engine.simulateUpdate(OBJECT, 'req_1', { status: 'rejected' });
    expect(h.granteesOf('req_1')).toEqual([]);
  });

  it('NO second materialisation trigger: the bound hook set for the object is the existing five', () => {
    // The precondition was CONFIRMED on the tree (comment 5535095827): the
    // existing `afterUpdate` covers a recipient-column write. So the binding a
    // `field` rule receives must be byte-for-byte the binding every rule
    // receives — nothing registered for the recipient column specifically.
    const events = h.engine.boundFor(SHARING_RULE_HOOK_PACKAGE, OBJECT).map((x) => x.event).sort();
    expect(events).toEqual(['afterDelete', 'afterInsert', 'afterUpdate', 'beforeDelete', 'beforeUpdate']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 site 2 — `evaluateRule`, the whole-rule pass (background re-grant, boot backfill, REST evaluate)', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
    h.engine.seed('sys_sharing_rule', [fieldRule()]);
    h.engine.seed(OBJECT, [
      { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] },
      { id: 'req_2', status: 'approved', owner_id: 'boss', assignees: ['u_b', 'u_c'] },
      { id: 'req_3', status: 'approved', owner_id: 'boss', assignees: [] },
      { id: 'req_draft', status: 'draft', owner_id: 'boss', assignees: ['u_a'] },
    ]);
  });

  it('derives per-record (record, user) pairs — never matched records × one recipient list', async () => {
    const result = await h.rules.evaluateRule(RULE, SYS);

    expect(h.granteesOf('req_1')).toEqual(['u_a']);
    expect(h.granteesOf('req_2')).toEqual(['u_b', 'u_c']);
    expect(h.granteesOf('req_3')).toEqual([]);
    expect(h.granteesOf('req_draft')).toEqual([]);
    // The cartesian product would have put u_a on req_2 and u_b/u_c on req_1.
    expect(h.granteesOf('req_2')).not.toContain('u_a');
    expect(h.granteesOf('req_1')).not.toContain('u_b');
    expect(result).toMatchObject({
      matchedRecords: 3,          // req_1, req_2, req_3 — the empty one still matched
      expandedUsers: 3,           // DISTINCT users across the matched records
      grantsCreated: 3,
      grantsUpdated: 0,
      grantsRevoked: 0,
    });
  });

  it('revokes a cross-product grant a rule-wide materialisation would have left behind', async () => {
    h.seedStaleGrant('req_2', 'u_a');   // u_a is named on req_1 only
    h.seedStaleGrant('req_3', 'u_b');   // req_3 names nobody
    const result = await h.rules.evaluateRule(RULE, SYS);
    expect(h.granteesOf('req_2')).toEqual(['u_b', 'u_c']);
    expect(h.granteesOf('req_3')).toEqual([]);
    expect(result.grantsRevoked).toBe(2);
  });

  it('is idempotent: a second pass changes nothing', async () => {
    await h.rules.evaluateRule(RULE, SYS);
    const again = await h.rules.evaluateRule(RULE, SYS);
    expect(again).toMatchObject({ matchedRecords: 3, expandedUsers: 3, grantsCreated: 0, grantsUpdated: 0, grantsRevoked: 0 });
  });

  it('the unbounded-bulk-write path end to end: revoke the object set-based, then the background re-grant restores exactly the per-record grants', async () => {
    // `rule-hooks.ts` `revokeThenQueueRegrant`: `revokeRuleGrantsForObject`
    // synchronously, `evaluateAllRulesForObject` on the queue. Driven here
    // without the queue so the assertion is about the two primitives.
    await h.rules.evaluateRule(RULE, SYS);
    const before = h.ruleShares().map((r) => `${r.record_id}::${r.recipient_id}`).sort();
    expect(before).toEqual(['req_1::u_a', 'req_2::u_b', 'req_2::u_c']);

    await h.rules.revokeRuleGrantsForObject(OBJECT);
    expect(h.ruleShares()).toEqual([]);

    const reconciled = await h.rules.evaluateAllRulesForObject(OBJECT);

    expect(reconciled).toBe(1);
    expect(h.ruleShares().map((r) => `${r.record_id}::${r.recipient_id}`).sort()).toEqual(before);
  });

  it('the rule-wide expansion is never asked for a field rule on this path (no "object reconcile failed")', async () => {
    await h.rules.evaluateAllRulesForObject(OBJECT);
    const failed = h.warn.mock.calls.filter((c) => String(c[0]).includes('object reconcile failed'));
    expect(failed).toEqual([]);
    expect(h.granteesOf('req_2')).toEqual(['u_b', 'u_c']);
  });

  it('the pass reads the recipient column ALONGSIDE the id on the matched rows — one criteria read, no per-record round trip', async () => {
    await h.rules.evaluateRule(RULE, SYS);
    const criteriaReads = h.engine._finds.filter((f) => f.object === OBJECT);
    expect(criteriaReads).toHaveLength(1);
    expect(criteriaReads[0].fields).toEqual(['id', 'assignees']);
  });

  it('an INACTIVE field rule purges its grants on the whole-rule pass (#4433 holds for the new kind)', async () => {
    await h.rules.evaluateRule(RULE, SYS);
    expect(h.ruleShares()).toHaveLength(3);
    await h.engine.update('sys_sharing_rule', { id: 'srule_assignees', active: false });
    const result = await h.rules.evaluateRule(RULE, SYS);
    expect(result.grantsRevoked).toBe(3);
    expect(h.ruleShares()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 site 3 — `revokeRuleGrantsForRetiredRecipients`, the recipient-axis revoke', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(async () => {
    h = harness();
    h.engine.seed('sys_sharing_rule', [fieldRule()]);
    h.engine.seed(OBJECT, [
      { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] },
      { id: 'req_2', status: 'approved', owner_id: 'boss', assignees: ['u_b', 'u_c'] },
    ]);
    await h.rules.evaluateRule(RULE, SYS);
    expect(h.ruleShares()).toHaveLength(3);
  });

  it('declines a field rule at the door: returns 0 and touches no grant', async () => {
    const rule = (await h.rules.getRule('srule_assignees', SYS))!;
    expect(rule.recipient_type).toBe('field');
    const grantReadsBefore = h.engine._finds.filter((f) => f.object === 'sys_record_share').length;

    const retired = await h.rules.revokeRuleGrantsForRetiredRecipients(rule);

    expect(retired).toBe(0);
    // Every grant is still correct and still standing — a rule-wide "desired"
    // set for this kind would have been empty, and the diff would have
    // retired all three.
    expect(h.ruleShares().map((r) => `${r.record_id}::${r.recipient_id}`).sort())
      .toEqual(['req_1::u_a', 'req_2::u_b', 'req_2::u_c']);
    // Declined at the door: not even the grant table was read.
    expect(h.engine._finds.filter((f) => f.object === 'sys_record_share').length).toBe(grantReadsBefore);
  });

  it('CONTROL: a rule-wide recipient still retires the recipients it no longer reaches', async () => {
    h.engine.seed('sys_sharing_rule', [fieldRule({
      id: 'srule_alice', name: 'approved_to_alice', recipient_type: 'user', recipient_id: 'alice',
    })]);
    await h.rules.evaluateRule('approved_to_alice', SYS);
    h.seedStaleGrant('req_1', 'bob', 'srule_alice');   // bob is nobody the rule expands to
    const rule = (await h.rules.getRule('srule_alice', SYS))!;

    const retired = await h.rules.revokeRuleGrantsForRetiredRecipients(rule);

    expect(retired).toBe(1);
    expect(h.granteesOf('req_1', 'srule_alice')).toEqual(['alice']);
  });

  it('the BU-graph recompute — its one production caller — never hands a field rule in', async () => {
    // A business-unit rule beside the field rule, so the filter is exercised
    // in both directions on one write.
    h.engine.seed('sys_sharing_rule', [fieldRule({
      id: 'srule_bu', name: 'approved_to_unit', recipient_type: 'business_unit', recipient_id: 'bu_ops',
    })]);
    const spy = vi.spyOn(h.rules, 'revokeRuleGrantsForRetiredRecipients');
    bindBusinessUnitTreeRecompute(h.engine as any, h.rules, { warn: vi.fn() } as any);

    await h.engine.fire('afterInsert', 'sys_business_unit_member', {
      object: 'sys_business_unit_member', event: 'afterInsert',
      input: { data: { id: 'bum_1', business_unit_id: 'bu_ops', user_id: 'u_z' } },
    });

    const handed = spy.mock.calls.map((c) => c[0].recipient_type);
    expect(handed).toEqual(['business_unit']);
    expect(handed).not.toContain('field');
    expect(h.ruleShares()).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 the ruling\'s explicit pin — a `position` recipient still expands RULE-WIDE', () => {
  let h: ReturnType<typeof harness>;
  const POSITION_RULE = 'approved_to_sales_reps';

  beforeEach(() => {
    h = harness();
    h.engine.seed('sys_sharing_rule', [
      fieldRule(),
      fieldRule({ id: 'srule_pos', name: POSITION_RULE, recipient_type: 'position', recipient_id: 'sales_rep' }),
    ]);
    h.engine.seed('sys_user_position', [
      { id: 'up_1', position: 'sales_rep', user_id: 'u_p1' },
      { id: 'up_2', position: 'sales_rep', user_id: 'u_p2' },
    ]);
    h.engine.seed(OBJECT, [
      { id: 'req_1', status: 'approved', owner_id: 'boss', assignees: ['u_a'] },
      { id: 'req_2', status: 'approved', owner_id: 'boss', assignees: ['u_b'] },
      { id: 'req_3', status: 'approved', owner_id: 'boss', assignees: [] },
    ]);
  });

  const holderReads = () => h.engine._finds.filter((f) => f.object === 'sys_user_position').length;

  it('every matched record gets the SAME holder set, resolved ONCE per pass however many records match', async () => {
    const before = holderReads();
    const result = await h.rules.evaluateRule(POSITION_RULE, SYS);

    for (const id of ['req_1', 'req_2', 'req_3']) expect(h.granteesOf(id, 'srule_pos')).toEqual(['u_p1', 'u_p2']);
    expect(result).toMatchObject({ matchedRecords: 3, expandedUsers: 2, grantsCreated: 6 });
    // One holder read for three matched records: the expansion is per RULE.
    expect(holderReads() - before).toBe(1);
  });

  it('…while the field rule on the same object reads NO principal table at all', async () => {
    const before = h.engine._finds.length;
    await h.rules.evaluateRule(RULE, SYS);
    const objects = new Set(h.engine._finds.slice(before).map((f) => f.object));
    for (const principalTable of ['sys_user_position', 'sys_position', 'sys_member', 'sys_team_member', 'sys_business_unit_member', 'sys_business_unit']) {
      expect(objects.has(principalTable)).toBe(false);
    }
    // The two kinds coexist on one object without either widening the other.
    expect(h.granteesOf('req_1')).toEqual(['u_a']);
    expect(h.granteesOf('req_1', 'srule_pos')).toEqual([]);
  });

  it('on the per-record pass too: the position rule and the field rule each answer for themselves', async () => {
    await h.rules.evaluateAllForRecord(OBJECT, 'req_2', SYS);
    expect(h.granteesOf('req_2', 'srule_pos')).toEqual(['u_p1', 'u_p2']);
    expect(h.granteesOf('req_2')).toEqual(['u_b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 the recipient column must EXIST and HOLD USERS — judged from the object\'s schema when it can be', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
    h.engine._schemas[OBJECT] = {
      name: OBJECT,
      fields: {
        id: { type: 'text' },
        status: { type: 'select', options: ['draft', 'approved'] },
        owner_id: { type: 'lookup', reference: 'sys_user' },
        assignees: { type: 'user', multiple: true },
        reviewer: { type: 'lookup', reference: 'sys_user' },
        account: { type: 'lookup', reference: 'account' },
        notes: { type: 'text' },
      },
    };
    h.engine.seed(OBJECT, [{
      id: 'req_1', status: 'approved', owner_id: 'boss',
      assignees: ['u_a'], reviewer: 'u_rev', account: 'acc_1', notes: 'u_smuggled',
    }]);
  });

  const withRecipient = (recipient_id: string) =>
    h.engine.seed('sys_sharing_rule', [fieldRule({ recipient_id })]);

  it('a `user` field is read', async () => {
    withRecipient('assignees');
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    expect(h.granteesOf('req_1')).toEqual(['u_a']);
    expect(h.fieldWarns()).toHaveLength(0);
  });

  it('a lookup to `sys_user` is read', async () => {
    withRecipient('reviewer');
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    expect(h.granteesOf('req_1')).toEqual(['u_rev']);
    expect(h.fieldWarns()).toHaveLength(0);
  });

  it('a column of another type grants NOBODY — a text column holding a user id is not read as one — and warns once per rule', async () => {
    withRecipient('notes');
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    await h.rules.evaluateRule(RULE, SYS);

    expect(h.granteesOf('req_1')).toEqual([]);
    const warns = h.fieldWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ rule: RULE, object: OBJECT, field: 'notes', cause: 'not-user-typed' });
  });

  it('a lookup to another object is not a user column either', async () => {
    withRecipient('account');
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    expect(h.granteesOf('req_1')).toEqual([]);
    expect(h.fieldWarns()[0][1]).toMatchObject({ field: 'account', cause: 'not-user-typed' });
  });

  it('a column the object does not declare grants nobody and warns (cause: no-such-field)', async () => {
    withRecipient('ghost');
    await h.rules.evaluateRule(RULE, SYS);
    expect(h.ruleShares()).toEqual([]);
    expect(h.fieldWarns()).toHaveLength(1);
    expect(h.fieldWarns()[0][1]).toMatchObject({ field: 'ghost', cause: 'no-such-field' });
  });

  it('an unusable column still REVOKES the grants the rule once held (fail-closed, not frozen)', async () => {
    withRecipient('notes');
    h.seedStaleGrant('req_1', 'u_smuggled');
    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    expect(h.granteesOf('req_1')).toEqual([]);
    expect(result.grantsRevoked).toBe(1);
  });

  it('NO schema to consult: the column is read on its declared semantics', async () => {
    delete h.engine._schemas[OBJECT];
    withRecipient('assignees');
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    expect(h.granteesOf('req_1')).toEqual(['u_a']);
  });

  it('a read the engine REFUSES (`INVALID_FIELD`) fails closed and warns once (cause: read-failed)', async () => {
    delete h.engine._schemas[OBJECT];   // nothing to pre-judge — the engine is the one that refuses
    h.engine._refuseField = 'ghost';
    withRecipient('ghost');
    h.seedStaleGrant('req_1', 'u_old');

    const [result] = await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);
    await h.rules.evaluateAllForRecord(OBJECT, 'req_1', SYS);

    expect(result).toMatchObject({ matchedRecords: 0, grantsCreated: 0, grantsRevoked: 1 });
    expect(h.granteesOf('req_1')).toEqual([]);
    const warns = h.fieldWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ field: 'ghost', cause: 'read-failed', error: expect.stringContaining('ghost') });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('#15072 authoring seams', () => {
  describe('the declared-rule bootstrap seeds a `field` rule (it used to skip it as unmappable)', () => {
    function seedHarness(declared: any[]) {
      const engine = { _registry: { listItems: (type: string) => (type === 'sharing_rule' ? declared : []) } };
      const defineRule = vi.fn(async (input: any) => ({ id: `id_${input.name}` }));
      const warns: Array<{ msg: string; meta: any }> = [];
      const logger = { warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); }, info: () => {} };
      return { engine, ruleService: { defineRule } as any, logger, warns, defineRule };
    }

    it('maps `sharedWith.type: field` onto `recipient_type: field` with the field NAME as the recipient', async () => {
      const { engine, ruleService, logger, warns, defineRule } = seedHarness([{
        name: 'approved_to_assignees', object: OBJECT,
        condition: "record.status == 'approved'",
        sharedWith: { type: 'field', value: 'assignees' },
        accessLevel: 'edit',
      }]);

      const res = await bootstrapDeclaredSharingRules(ruleService, null, engine, logger);

      expect(res).toEqual({ seeded: 1, skipped: 0 });
      expect(warns).toEqual([]);
      expect(defineRule).toHaveBeenCalledTimes(1);
      expect(defineRule.mock.calls[0][0]).toMatchObject({
        name: 'approved_to_assignees',
        object: OBJECT,
        criteria: { status: 'approved' },
        recipientType: 'field',
        recipientId: 'assignees',
        accessLevel: 'edit',
        managedBy: 'package',
      });
    });

    it('CONTROL: an unmapped recipient kind is still skipped, never seeded wider', async () => {
      const { engine, ruleService, logger, warns, defineRule } = seedHarness([{
        name: 'r_manager', object: OBJECT,
        condition: "record.status == 'approved'",
        sharedWith: { type: 'manager', value: 'owner_id' },   // ⛔ no `manager` member — the ruling
      }]);
      const res = await bootstrapDeclaredSharingRules(ruleService, null, engine, logger);
      expect(res).toEqual({ seeded: 0, skipped: 1 });
      expect(defineRule).not.toHaveBeenCalled();
      expect(warns.some((w) => w.msg.includes('unmappable recipient'))).toBe(true);
    });
  });

  describe('`defineRule` holds a `field` recipientId to the field-name grammar (the seam the spec parse never sees)', () => {
    let h: ReturnType<typeof harness>;
    const base = {
      label: 'Approved → field', object: OBJECT, criteria: { status: 'approved' },
      accessLevel: 'read' as const,
    };

    beforeEach(() => { h = harness(); });

    it('a snake_case field name is accepted and stored as the recipient', async () => {
      const row = await h.rules.defineRule({ ...base, name: 'ok_field', recipientType: 'field', recipientId: 'assignees' } as any, SYS);
      expect(row).toMatchObject({ recipient_type: 'field', recipient_id: 'assignees' });
    });

    it.each([
      ['a dotted path (a graph walk spelled as a value)', 'owner.manager_id'],
      ['a principal-shaped id', 'usr_01HZX'],
      ['a name starting with a digit', '1st_owner'],
      ['upper case', 'Assignees'],
    ])('refuses %s with VALIDATION_FAILED', async (_label, recipientId) => {
      await expect(
        h.rules.defineRule({ ...base, name: 'bad_field', recipientType: 'field', recipientId } as any, SYS),
      ).rejects.toThrow(/^VALIDATION_FAILED: recipientId must name a user-typed field/);
      expect(h.engine._tables.sys_sharing_rule ?? []).toEqual([]);
    });

    it('is scoped to `field`: a `user` recipient keeps its opaque id, dots and case included', async () => {
      const row = await h.rules.defineRule({ ...base, name: 'user_rule', recipientType: 'user', recipientId: 'Usr.01HZX' } as any, SYS);
      expect(row).toMatchObject({ recipient_type: 'user', recipient_id: 'Usr.01HZX' });
    });
  });

  describe('the `sys_sharing_rule.recipient_type` select can store every authorable recipient', () => {
    const selectValues = (): string[] =>
      ((SysSharingRule as any).fields.recipient_type.options as Array<{ value: string }>).map((o) => o.value);

    it('lists `field` (executor-contract point 5 — a stored field row is no longer refused at the select)', () => {
      expect(selectValues()).toContain('field');
    });

    it('is a superset of `ShareRecipientType` — the class, not just the newest member', () => {
      for (const member of ShareRecipientType.options) {
        expect(selectValues(), `authorable member '${member}' must be storable`).toContain(member);
      }
    });

    it('the recipient help text tells an admin what to put there for a field recipient', () => {
      const help = String((SysSharingRule as any).fields.recipient_id.description);
      expect(help).toMatch(/field/i);
    });
  });
});
