// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8207] The ADR-0111 D7 inert-grant guard runs for SYSTEM callers too.
 *
 * ## The distinction these pins hold down
 *
 * `SharingService.grant` used to skip BOTH of its pre-flights for a system
 * context, in one block, with one justification. The two halves ask different
 * questions and only one of them may vary by caller:
 *
 *   - **D1, `assertCanManageShares` — AUTHORIZATION.** "May this principal
 *     manage shares on this record?" A sharing rule is not a principal and has
 *     no ownership to prove, so skipping it for the evaluator is correct and
 *     stays.
 *   - **D7, the inertness guard — NOT authorization.** "Would any gate ever
 *     read a row on this object?" The gates that would consult the row
 *     (`buildReadFilter`, `checkEdit`, `checkDelete`) never see the granter, so
 *     the answer cannot depend on who asks. Exempting the system context made
 *     the guard answer a question it was not asked.
 *
 * ## The measurement that made this a defect rather than a tidy-up
 *
 * The card was filed observation-class, on the explicit condition that someone
 * check whether the rule evaluator independently refuses these object classes
 * before materialising — because if it did, the guard would have no live
 * consumer. It does not. Measured against `origin/main` @ `a7e94e990`, one rule
 * per class, `defineRule` then `evaluateRule`, both under a system context:
 *
 * ```
 *   object class                       defineRule   evaluateRule   rows minted
 *   account (private, control)         accepted     created=1      1
 *   whiteboard (public_read_write)     accepted     created=1      1
 *   note (no owner_id)                 accepted     created=1      1
 *   detail_item (controlled_by_parent) accepted     created=1      1
 *   ext_nostamp (phantom anchor)       accepted     created=1      1
 *   sys_user (bypass object)           accepted     created=1      1
 * ```
 *
 * Five inert classes, five real `sys_record_share` rows with `source: 'rule'`,
 * no refusal anywhere. `defineRule` never reads the object's schema at all, and
 * `reconcile` hands `grant` whatever `object_name` the rule row carries. So the
 * "own validation" the removed comment credited the evaluator with is not there,
 * and the guard was the only thing between an authored rule and rows no verdict
 * can ever consult. {@link describe} block 2 is that measurement, re-run as a
 * pin against the fixed build.
 *
 * ## Why the fixtures assert BOTH directions
 *
 * Every refusal case here is paired with an ordinary-object case that must
 * still SUCCEED — and, where the row is the point, must still be LIVE. A
 * one-sided suite would read identically against a build that refused every
 * system grant, which is the failure this change's own risk profile points at
 * (the boot backfill, the write hooks and the re-grant queues are all system
 * callers of `grant`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OWNER_FIELD_DEF,
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { backfillRuleGrants } from './sharing-plugin.js';

interface Row { [k: string]: any }

/** The system context every one of `grant`'s system callers passes. */
const SYS = { isSystem: true, positions: [], permissions: [] } as any;

function makeEngine(schemas: Record<string, any>) {
  const tables: Record<string, Row[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
    if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
    for (const [k, v] of Object.entries(f)) {
      if (k === '$or' || k === '$and') continue;
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    getSchema(n: string) { return schemas[n]; },
    async find(o: string, opts?: any) {
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter(r => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) { const row = { ...data }; ensure(o).push(row); return row; },
    async update(o: string, data: any, options?: any) {
      // [#4550/#5480] Pinned to `ObjectQL.update`'s OWN dispatch predicate, for
      // the same reason `delete` is below: a fake looser than the contract it
      // stands in for is how a green suite ships a dead route (#4434).
      //
      // The shape this replaced also mirrored the DRIVER arity
      // (`update(object, id, data)`) alongside the engine one, which
      // `IDataEngine` does not have at all — so the double accepted a call no
      // real engine would dispatch, on top of accepting the predicate updates
      // the producer rejects.
      const dispatch = assertEngineUpdateDispatch(data, options);
      const t = ensure(o);
      if (dispatch.kind === 'by-id') {
        const i = t.findIndex(r => r.id === dispatch.id);
        if (i >= 0) t[i] = { ...t[i], ...data };
        return t[i];
      }
      // `multi`: the producer rewrites every matching row's fields.
      let updated = 0;
      const where = options?.where ?? {};
      for (let i = 0; i < t.length; i++) {
        if (matches(t[i], where)) { t[i] = { ...t[i], ...data }; updated += 1; }
      }
      return { ok: true, updated };
    },
    async delete(o: string, opts?: any) {
      // [#4550] Pinned to `ObjectQL.delete`'s OWN dispatch predicate — a fake
      // looser than the contract it stands in for is how a green suite ships a
      // dead route (#4434).
      assertEngineDeleteDispatch(opts);
      const t = ensure(o); const where = opts?.where ?? {};
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
  };
}

/**
 * The control: an ordinary LOCAL object under the secure-default private OWD
 * with a real, provisioned `owner_id`. Every gate consults share rows on it, so
 * a system grant here must keep working — and the row it writes must be live.
 */
const ACCOUNT = {
  name: 'account',
  sharingModel: 'private',
  fields: { id: {}, tier: {}, owner_id: { ...OWNER_FIELD_DEF } },
};

/** The five classes on which a `sys_record_share` row can never be consulted. */
const INERT_SCHEMAS: Record<string, any> = {
  // 1 — public model: every principal already reads and writes it.
  whiteboard: {
    name: 'whiteboard',
    sharingModel: 'public_read_write',
    fields: { id: {}, tier: {}, owner_id: { ...OWNER_FIELD_DEF } },
  },
  // 2 — owner-less: ownership contributes nothing, so nothing composes a
  //     record filter that a share row could widen.
  note: { name: 'note', sharingModel: 'private', fields: { id: {}, tier: {} } },
  // 3 — controlled_by_parent (ADR-0055): access follows the master record.
  detail_item: {
    name: 'detail_item',
    sharingModel: 'controlled_by_parent',
    fields: { id: {}, tier: {}, owner_id: { ...OWNER_FIELD_DEF } },
  },
  // 4 — federated phantom anchor (#8119 / #8209): `owner_id` is the platform's
  //     injected anchor on an object whose storage the platform never
  //     provisioned, so the gates read it off a table that does not have it.
  //     Spreads OWNER_FIELD_DEF exactly as `applySystemFields` does.
  ext_nostamp: {
    name: 'ext_nostamp',
    external: { remoteName: 'customers' },
    fields: { id: {}, tier: {}, owner_id: { ...OWNER_FIELD_DEF } },
  },
  // 5 — a bypass object: sharing is not consulted on it at all.
  sys_user: {
    name: 'sys_user',
    isSystem: true,
    fields: { id: {}, tier: {}, owner_id: { ...OWNER_FIELD_DEF } },
  },
};

const ALL_SCHEMAS: Record<string, any> = {
  account: ACCOUNT,
  ...INERT_SCHEMAS,
  sys_record_share: { name: 'sys_record_share' },
  sys_sharing_rule: { name: 'sys_sharing_rule' },
};

const INERT_OBJECTS = Object.keys(INERT_SCHEMAS);

function seedRows(engine: ReturnType<typeof makeEngine>) {
  for (const object of ['account', ...INERT_OBJECTS]) {
    engine._tables[object] = [
      { id: 'r1', tier: 'gold', owner_id: 'usr_owner' },
      { id: 'r2', tier: 'silver', owner_id: 'usr_owner' },
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1 — the guard itself, at the `grant()` seam
// ─────────────────────────────────────────────────────────────────────

describe('[ADR-0111 D7 / #8207] the inert-grant guard does not ask who is calling', () => {
  let engine: ReturnType<typeof makeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeEngine(ALL_SCHEMAS);
    svc = new SharingService({ engine: engine as any });
    seedRows(engine);
  });

  it.each(INERT_OBJECTS)('refuses a SYSTEM grant on %s — the row could never be consulted', async (object) => {
    // Pre-fix every one of these RESOLVED and minted a real row (see the
    // measurement in this file's header).
    await expect(
      svc.grant({ object, recordId: 'r1', recipientId: 'usr_grantee' }, SYS),
    ).rejects.toThrow(/SHARING_NOT_ENABLED/);
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
  });

  it.each(INERT_OBJECTS)('the SYSTEM refusal on %s is the SAME verdict the user path gives', async (object) => {
    // The point of the card: an inertness check has one answer per object, not
    // one answer per caller. Comparing the two messages is what pins that —
    // a future guard that refused system callers for some *other* reason would
    // still be a guard whose answer depends on who asks.
    const asSystem = await svc
      .grant({ object, recordId: 'r1', recipientId: 'usr_grantee' }, SYS)
      .then(() => null, (e: Error) => e.message);
    const asUser = await svc
      .grant({ object, recordId: 'r1', recipientId: 'usr_grantee' }, { userId: 'usr_owner' } as any)
      .then(() => null, (e: Error) => e.message);
    expect(asSystem).toBe(asUser);
    expect(asSystem!.startsWith('SHARING_NOT_ENABLED:')).toBe(true);
  });

  it('the code is one the package DECLARES in the ADR-0112 ledger', () => {
    // The prefix is what `rest-server.ts` reads to pick 422; a code invented at
    // the throw site would fall through to a 500.
    expect(ERROR_CODE_LEDGER['@objectstack/plugin-sharing']).toContain('SHARING_NOT_ENABLED');
  });

  it('ANTI-VACUITY: a SYSTEM grant on an ordinary private object still succeeds', async () => {
    // Without this the block above would read identically against a build that
    // refused every system grant — which would break the boot backfill, the
    // write hooks and both re-grant queues.
    await expect(
      svc.grant(
        { object: 'account', recordId: 'r1', recipientId: 'usr_grantee', accessLevel: 'edit', source: 'rule', sourceId: 'srule_1' },
        SYS,
      ),
    ).resolves.toMatchObject({ object_name: 'account', recipient_id: 'usr_grantee', source: 'rule' });
    expect(engine._tables.sys_record_share).toHaveLength(1);
  });

  it('ANTI-VACUITY: the row that system grant wrote is LIVE, not merely persisted', async () => {
    await svc.grant(
      { object: 'account', recordId: 'r1', recipientId: 'usr_grantee', accessLevel: 'edit', source: 'rule', sourceId: 'srule_1' },
      SYS,
    );
    // `usr_grantee` owns nothing and holds no bypass, so the only thing that can
    // lift this verdict is the share row just minted — the contrast that gives
    // the refusals above their meaning.
    expect(await svc.canEdit('account', 'r1', { userId: 'usr_grantee' } as any)).toBe(true);
    // …and it does not leak to a sibling record of the same object.
    expect(await svc.canEdit('account', 'r2', { userId: 'usr_grantee' } as any)).toBe(false);
  });

  it('the D1 MANAGEMENT gate stays system-skipped — a rule has no ownership to prove', async () => {
    // The half that legitimately varies by caller. `usr_nobody` owns no record
    // and could not manage shares here, but the evaluator is not a principal:
    // the same grant must go through under a system context…
    await expect(
      svc.grant({ object: 'account', recordId: 'r2', recipientId: 'usr_grantee' }, SYS),
    ).resolves.toMatchObject({ object_name: 'account' });
    // …and must NOT go through for the user who cannot manage that record.
    await expect(
      svc.grant({ object: 'account', recordId: 'r2', recipientId: 'usr_grantee' }, { userId: 'usr_nobody' } as any),
    ).rejects.toThrow(/PERMISSION_DENIED|NOT_FOUND/);
  });

  it('an UNRESOLVABLE object stays a user-only NOT_FOUND — existence is not inertness', async () => {
    // The carve-out that keeps a legitimate system write working: absence of a
    // schema is absence of EVIDENCE of inertness, not evidence of it. A user
    // who names an object that does not resolve has made a mistake (404); the
    // evaluator holds a stored `object_name` against an engine that may not
    // have that schema registered at this instant, and hard-failing its pass on
    // that would refuse a grant nobody showed to be inert.
    await expect(
      svc.grant({ object: 'ghost_object', recordId: 'r1', recipientId: 'usr_grantee' }, { userId: 'usr_owner' } as any),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      svc.grant({ object: 'ghost_object', recordId: 'r1', recipientId: 'usr_grantee' }, SYS),
    ).resolves.toMatchObject({ object_name: 'ghost_object' });
  });

  it('an engine with NO schema access still cannot answer, for either caller', async () => {
    // The pre-existing "it cannot know" carve-out, unchanged: a `SharingEngine`
    // without `getSchema` skips the schema-derived verdicts (the bypass list is
    // still consulted — it needs no schema).
    const blind: any = { ...makeEngine({}) };
    delete blind.getSchema;
    const s = new SharingService({ engine: blind });
    await expect(
      s.grant({ object: 'anything', recordId: 'r1', recipientId: 'usr_grantee' }, SYS),
    ).resolves.toMatchObject({ object_name: 'anything' });
    await expect(
      s.grant({ object: 'sys_user', recordId: 'r1', recipientId: 'usr_grantee' }, SYS),
    ).rejects.toThrow(/SHARING_NOT_ENABLED/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2 — the consumer the card is actually about: the rule evaluator
// ─────────────────────────────────────────────────────────────────────

describe('[#8207] the sharing-rule evaluator can no longer materialise inert rows', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  let rules: SharingRuleService;
  const warns: Array<{ msg: string; meta: any }> = [];

  beforeEach(() => {
    warns.length = 0;
    engine = makeEngine(ALL_SCHEMAS);
    sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({
      engine: engine as any,
      sharing,
      logger: { warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); }, info: () => {} },
    });
    seedRows(engine);
  });

  const define = (object: string) => rules.defineRule({
    name: `share_${object}_gold`,
    label: `Share ${object}`,
    object,
    criteria: { tier: 'gold' },
    recipientType: 'user',
    recipientId: 'usr_grantee',
    accessLevel: 'read',
  } as any, SYS);

  it.each(INERT_OBJECTS)('evaluating a rule on %s mints NOTHING (it minted a row pre-fix)', async (object) => {
    await define(object);
    // `evaluateRule` does not swallow the refusal — its callers do (next block).
    await expect(rules.evaluateRule(`share_${object}_gold`, SYS)).rejects.toThrow(/SHARING_NOT_ENABLED/);
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
  });

  it('ANTI-VACUITY: the same rule shape on an ordinary object still materialises', async () => {
    await define('account');
    const result = await rules.evaluateRule('share_account_gold', SYS);
    expect(result).toMatchObject({ matchedRecords: 1, expandedUsers: 1, grantsCreated: 1 });
    expect(engine._tables.sys_record_share).toHaveLength(1);
    expect(engine._tables.sys_record_share[0]).toMatchObject({
      object_name: 'account', record_id: 'r1', recipient_id: 'usr_grantee', source: 'rule',
    });
    // LIVE: the criteria-matched record is reachable, the unmatched one is not.
    expect(await sharing.canEdit('account', 'r1', { userId: 'usr_grantee' } as any)).toBe(false); // read-level grant
    const filter: any = await sharing.buildReadFilter('account', { userId: 'usr_grantee' } as any);
    expect(filter.$or[1].id.$in).toEqual(['r1']);
  });

  it('the boot backfill still COMPLETES — one bad rule does not stop its siblings', async () => {
    // The path the card names as the one most likely to trip. `evaluateRule`
    // throws for the inert rule; `backfillRuleGrants` catches per rule, warns,
    // and carries on, so the ordinary rule is still reconciled.
    for (const object of ['account', ...INERT_OBJECTS]) await define(object);
    const logged: Array<{ msg: string; meta: any }> = [];
    const reconciled = await backfillRuleGrants(
      rules,
      [{ name: 'share_account_gold' }, ...INERT_OBJECTS.map(o => ({ name: `share_${o}_gold` }))],
      {
        info: (msg: string, meta?: any) => logged.push({ msg, meta }),
        warn: (msg: string, meta?: any) => logged.push({ msg, meta }),
      },
    );
    expect(reconciled).toBe(1); // the ordinary rule, and only it
    expect(logged.some(l => l.msg.includes('boot rule backfill done'))).toBe(true);
    // Each refusal reaches the operator naming the rule AND the reason.
    for (const object of INERT_OBJECTS) {
      const warn = logged.find(l => l.meta?.rule === `share_${object}_gold`);
      expect(warn?.msg).toMatch(/boot rule backfill failed for rule/);
      expect(warn?.meta?.error).toMatch(/SHARING_NOT_ENABLED/);
    }
    // …and the ordinary rule's grant is there.
    expect(engine._tables.sys_record_share).toHaveLength(1);
    expect(engine._tables.sys_record_share[0]).toMatchObject({ object_name: 'account' });
  });

  it('WITHDRAWAL still works on an inert object — revoke is untouched', async () => {
    // Rows minted by an older build stay purgeable: only `grant` gained the
    // guard, so `deleteRule` / `evaluateRule`-on-inactive can still clean up.
    await define('whiteboard');
    const rule = await rules.getRule('share_whiteboard_gold', SYS);
    engine._tables.sys_record_share = [{
      id: 'shr_legacy', object_name: 'whiteboard', record_id: 'r1',
      recipient_type: 'user', recipient_id: 'usr_grantee', access_level: 'read',
      source: 'rule', source_id: rule!.id,
    }];
    expect(await rules.revokeRuleGrants(rule!.id)).toBe(1);
    expect(engine._tables.sys_record_share).toHaveLength(0);
  });
});
