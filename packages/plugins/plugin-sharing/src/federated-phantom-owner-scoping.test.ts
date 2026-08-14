// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7858] Record-level ownership scoping must not filter a FEDERATED object by a
 * column it does not have.
 *
 * ## The defect these pins hold down
 *
 * The ObjectQL registry injects `owner_id` into every object that has not opted
 * out, federated ones included — but issues no DDL for a federated object,
 * because its remote schema is owned externally (`Engine.syncObjectSchema`
 * returns early for `external != null`). `SharingService.buildReadFilter` /
 * `buildWriteFilter` then read the registered field set, answer
 * `hasOwnerField: true`, and AND-compose `owner_id = <caller>` onto a query
 * whose backing table has no such column.
 *
 * The symptom is dialect-dependent and the defect is not: SQLite reinterprets
 * the unresolvable identifier as a string literal, so the predicate is
 * constant-false — **0 rows, no error, HTTP 200**; Postgres/MySQL raise
 * `column "owner_id" does not exist`. So "it did not throw" is precisely the
 * failure mode, and every case below asserts the **composed filter value**,
 * never an absence of error.
 *
 * ## Why the fixtures below leave `sharingModel` UNSET
 *
 * This is load-bearing, not an omission. `effectiveSharingModel` returns
 * `'public'` for the ADR-0090 D1 grandfather stamp `public_read_write`, and
 * both filters return `null` on that at a gate ABOVE the one under test — so a
 * fixture carrying the stamp can never reach the phantom-anchor line and would
 * stay green against the broken build. Both shipped showcase federated objects
 * (`showcase_ext_customer`, `showcase_ext_order`) carry exactly that stamp,
 * which is why the card's measurement had to register a fresh unstamped object
 * to see the defect at all. The unstamped fixture takes the secure-default
 * `private` OWD — the case an app author gets by declaring nothing, i.e. the
 * normal one. {@link GRANDFATHERED_SHOWCASE_SHAPE} pins the stamped behaviour
 * separately as the no-change regression surface.
 *
 * ## Why the fixtures are not circular
 *
 * The injected-anchor fixture spreads {@link OWNER_FIELD_DEF} exactly as
 * `applySystemFields` does (`additions.owner_id = { ...OWNER_FIELD_DEF }`), and
 * the provenance test compares against the same constant — so this file proves
 * the DECISION, not that the registry still spreads it verbatim. That second
 * fact has an independent witness in the dogfood layer, which reads what the
 * real registry produced on a real boot. If the registry ever stops spreading
 * the constant, that pin goes red while these stay green, which is the correct
 * division of labour rather than a gap.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OWNER_FIELD_DEF,
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  type EngineDeleteDispatchInput,
  type EngineUpdateDispatchData,
  type EngineUpdateDispatchInput,
} from '@objectstack/metadata-core';
import { ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { SharingService } from './sharing-service.js';

/** The caller: an ordinary member whose read/write DEPTH is narrower than `org`. */
const MEMBER = 'usr_member_1';

/** The remote table's real columns — the only ones a federated query can name. */
const REMOTE_COLUMNS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
  region: { type: 'text', label: 'Region' },
};

/**
 * What the registry hands this plugin for a federated object today: the remote
 * columns PLUS the platform anchor it provisions no storage for. No
 * `sharingModel` — see the module docs for why that is the whole point.
 */
const federatedSchema = (extra: Record<string, unknown> = {}) => ({
  name: 'measure_ext_nostamp',
  external: { remoteName: 'customers' },
  fields: {
    // `applySystemFields`: `additions.owner_id = { ...OWNER_FIELD_DEF }`
    owner_id: { ...OWNER_FIELD_DEF },
    ...REMOTE_COLUMNS,
  },
  ...extra,
});

/**
 * A federated object whose author DECLARED a real remote owner column. The
 * registry suppresses its injection entirely (`if (wantOwner &&
 * !schema.fields?.owner_id)`), so this def is the author's — the column is real
 * in the remote table and scoping by it is meaningful.
 */
const DECLARED_REAL_OWNER = {
  name: 'ext_with_real_owner',
  external: { remoteName: 'accounts' },
  fields: {
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Account Rep' },
    ...REMOTE_COLUMNS,
  },
};

/** A LOCAL private object — the control: its `owner_id` IS provisioned. */
const LOCAL_PRIVATE = {
  name: 'local_task',
  fields: { owner_id: { ...OWNER_FIELD_DEF }, ...REMOTE_COLUMNS },
};

/** The shipped showcase federated shape: grandfathered under ADR-0090 D1. */
const GRANDFATHERED_SHOWCASE_SHAPE = federatedSchema({
  name: 'showcase_ext_customer',
  sharingModel: 'public_read_write',
});

/**
 * The narrow slice of the engine both filters touch. `find` answers the
 * `sys_record_share` grant lookup with no rows, so the composed filter is the
 * owner branch alone — which is exactly the value under test.
 *
 * [#4550] `update` and `delete` open with the REAL engine's own dispatch
 * predicates. Neither verb is exercised by the cases below — the `SharingEngine`
 * contract requires both members, so the double has to declare them — but a
 * double that would ACCEPT a call shape `ObjectQL` rejects is precisely how
 * #4434 shipped a dead REST route with its suite green. That is the same
 * failure this file's own fixture choice guards against one level up: an
 * assertion that passes because the harness is more permissive than the thing
 * it stands for. Imported from `@objectstack/metadata-core`, where the
 * predicates have lived since #5619 and which this package already depends on
 * for {@link OWNER_FIELD_DEF}.
 *
 * [#8119] `tables` is optional and defaults to empty, so every pre-existing
 * caller keeps the always-`[]` behaviour it was written against. When rows ARE
 * supplied, `find` returns them by `id` **verbatim** — it deliberately does NOT
 * apply the `fields` projection `matchesOwnerScope` asks for, because the real
 * SQLite driver does not either: measured on a booted stack, a projection naming
 * a column the remote table lacks is DISCARDED and the whole row comes back
 * (minus the absent column). Storing each row in that measured shape — a
 * federated row simply having no `owner_id` key — is what makes the gate cases
 * below reproduce the defect instead of a fixture-shaped approximation of it.
 */
function makeEngine(
  schemas: Record<string, unknown>,
  tables: Record<string, Array<Record<string, unknown>>> = {},
) {
  /**
   * Match one row against a `where` bag. Handles exactly the two shapes this
   * service composes — primitive equality and `{ $in: [...] }` — and THROWS on
   * anything else rather than ignoring it. An unrecognised operator silently
   * skipped would make the double strictly more permissive than the engine, and
   * a fixture that over-matches is how a share lookup "finds" a grant that the
   * real store would not have returned.
   */
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, cond]) => {
      if (key.startsWith('$')) throw new Error(`fake engine: unsupported operator ${key}`);
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        const ops = Object.keys(cond as object);
        if (ops.length !== 1 || ops[0] !== '$in') {
          throw new Error(`fake engine: unsupported filter operator(s) ${ops.join(',')} on '${key}'`);
        }
        const set = (cond as { $in: unknown[] }).$in.map(String);
        return set.includes(String(row[key]));
      }
      return String(row[key]) === String(cond);
    });

  return {
    getSchema: (name: string) => schemas[name],
    find: async (object: string, options?: { where?: Record<string, unknown> }) => {
      const rows = tables[object] ?? [];
      const where = options?.where;
      return where === undefined ? rows : rows.filter((r) => matches(r, where));
    },
    // Persists, so a grant made in a case is READABLE by a later gate call in
    // the same case — which is what makes "the minted row is LIVE" provable
    // rather than merely "grant() resolved".
    insert: async (object: string, data: Record<string, unknown>) => {
      (tables[object] ??= []).push(data);
      return data;
    },
    update: async (
      _object: string,
      data: EngineUpdateDispatchData,
      options?: EngineUpdateDispatchInput,
    ) => {
      assertEngineUpdateDispatch(data, options);
      return data;
    },
    delete: async (_object: string, options?: EngineDeleteDispatchInput) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 0 };
    },
  };
}

describe('[#7858] ownership scoping vs federated (external) objects', () => {
  let svc: SharingService;

  beforeEach(() => {
    svc = new SharingService({
      engine: makeEngine({
        measure_ext_nostamp: federatedSchema(),
        ext_with_real_owner: DECLARED_REAL_OWNER,
        local_task: LOCAL_PRIVATE,
        showcase_ext_customer: GRANDFATHERED_SHOWCASE_SHAPE,
        sys_record_share: { name: 'sys_record_share' },
      }),
    });
  });

  describe('the INJECTED anchor contributes nothing', () => {
    // The card's measured values, pre-fix:
    //   buildReadFilter(measure_ext_nostamp, __readScope='own')  = {"owner_id":"usr_member_1"}
    //   buildReadFilter(measure_ext_nostamp, __readScope='unit') = {"owner_id":"usr_member_1"}
    it.each(['own', 'own_and_reports', 'unit', 'unit_and_below'] as const)(
      'read: no owner predicate at __readScope=%s',
      async (scope) => {
        const filter = await svc.buildReadFilter('measure_ext_nostamp', {
          userId: MEMBER,
          __readScope: scope,
        } as never);
        expect(filter).toBeNull();
      },
    );

    it('read: `org` scope stays null, exactly as it already did', async () => {
      const filter = await svc.buildReadFilter('measure_ext_nostamp', {
        userId: MEMBER,
        __readScope: 'org',
      } as never);
      expect(filter).toBeNull();
    });

    it.each(['update', 'delete'] as const)(
      'write: no owner predicate on a bulk %s',
      async (verb) => {
        const filter = await svc.buildWriteFilter(
          'measure_ext_nostamp',
          { userId: MEMBER, __writeScope: 'own' } as never,
          verb,
        );
        expect(filter).toBeNull();
      },
    );

    it('read: the principal-less degenerate case is not reached either', async () => {
      // Ownership contributes nothing BEFORE the deny-all fallback, so a
      // federated object does not become unreadable to an anonymous API key
      // over a column it has not got.
      const filter = await svc.buildReadFilter('measure_ext_nostamp', {} as never);
      expect(filter).toBeNull();
    });
  });

  describe('what must NOT change', () => {
    it('federated object with a DECLARED real remote owner column keeps its scoping', async () => {
      const read = await svc.buildReadFilter('ext_with_real_owner', {
        userId: MEMBER,
        __readScope: 'own',
      } as never);
      expect(read).toEqual({ owner_id: MEMBER });

      const write = await svc.buildWriteFilter(
        'ext_with_real_owner',
        { userId: MEMBER, __writeScope: 'own' } as never,
        'delete',
      );
      expect(write).toEqual({ owner_id: MEMBER });
    });

    it('LOCAL private object with the injected anchor is untouched', async () => {
      const read = await svc.buildReadFilter('local_task', {
        userId: MEMBER,
        __readScope: 'own',
      } as never);
      expect(read).toEqual({ owner_id: MEMBER });

      const write = await svc.buildWriteFilter(
        'local_task',
        { userId: MEMBER, __writeScope: 'own' } as never,
        'delete',
      );
      expect(write).toEqual({ owner_id: MEMBER });
    });

    it('the grandfathered showcase federated object behaves exactly as today', async () => {
      // `public_read_write` → `effectiveSharingModel` is `public`, so BOTH
      // filters return null at a gate above the phantom-anchor test. Pinned
      // rather than assumed: this is the shipped regression surface.
      expect(
        await svc.buildReadFilter('showcase_ext_customer', {
          userId: MEMBER,
          __readScope: 'own',
        } as never),
      ).toBeNull();
      expect(
        await svc.buildWriteFilter(
          'showcase_ext_customer',
          { userId: MEMBER, __writeScope: 'own' } as never,
          'update',
        ),
      ).toBeNull();
    });
  });
});

/**
 * [#8119] The SINGLE-record half — the three `hasOwnerField` consumers #7858's
 * ruled scope left alone. Two of them are pinned here as **unchanged**, and the
 * third is the only behaviour this card moves.
 *
 * ## What the measurement established, and why it changes what the fixtures say
 *
 * The card was filed as a code-path reading and flagged its own SELECT-list
 * premise as unverified. Measured on a booted showcase stack (SQLite external
 * datasource, an unstamped federated object bound to remote table `customers`),
 * the answer is neither branch the card offered:
 *
 * ```
 *   find(measure_ext_nostamp, { where:{id:'c1'}, fields:['id','name'] })
 *     -> keys [id, name]                                  (projection honoured)
 *   find(measure_ext_nostamp, { where:{id:'c1'}, fields:['id','owner_id'] })
 *     -> keys [id, created_at, updated_at, name, email, region, lifetime_value]
 *        hasOwnProperty('owner_id') === false             (projection DISCARDED)
 *   NO throw, in any dialect position tested.
 * ```
 *
 * So on SQLite the driver does not raise, `writeGateFailClosed` is never
 * reached, and nothing is logged: the refusal is produced silently by
 * `matchesOwnerScope` reading `owner == null`. That is why the federated rows
 * below carry NO `owner_id` key rather than an explicit `null` and rather than
 * being absent altogether — a row that is simply missing would prove only that
 * the gate refuses unknown records, which it does for every object.
 *
 * ## Why `checkEdit` / `checkDelete` are pinned but NOT changed
 *
 * They refuse, which is fail-closed and safe. Widening them to `abstain` hands
 * the row to another authority and can turn a refusal into an allow — ruled a
 * decision rather than a dispatch on #8119, and deliberately not taken here.
 * These cases exist so that decision is made against a measured baseline, and so
 * a later change to it cannot land silently.
 */
describe('[#8119] federated phantom anchor and the SINGLE-record gates', () => {
  /** The MEASURED federated row shape: present, and with no `owner_id` key. */
  const FEDERATED_ROW = { id: 'c1', name: 'Aurora Labs', email: 'ap@aurora.example', region: 'NA' };

  let svc: SharingService;

  beforeEach(() => {
    svc = new SharingService({
      engine: makeEngine(
        {
          measure_ext_nostamp: federatedSchema(),
          ext_with_real_owner: DECLARED_REAL_OWNER,
          local_task: LOCAL_PRIVATE,
          showcase_ext_customer: GRANDFATHERED_SHOWCASE_SHAPE,
          sys_record_share: { name: 'sys_record_share' },
        },
        {
          measure_ext_nostamp: [FEDERATED_ROW],
          // The author-declared remote owner column IS real — the row has it.
          ext_with_real_owner: [{ id: 'a1', owner_id: MEMBER, name: 'Acme' }],
          // `t2` is the same object, a DIFFERENT record: it is what proves a
          // grant on `t1` does not widen the whole object.
          local_task: [{ id: 't1', owner_id: MEMBER, name: 'My task' }, { id: 't2', owner_id: MEMBER, name: 'Other' }],
          showcase_ext_customer: [FEDERATED_ROW],
        },
      ),
    });
  });

  describe('unchanged: the write gates still REFUSE (fail-closed, not widened)', () => {
    it.each(['own', 'own_and_reports', 'unit', 'unit_and_below', 'org'] as const)(
      'checkEdit denies at __writeScope=%s',
      async (scope) => {
        // `org` is in the list on purpose: `matchesOwnerScope` short-circuits on
        // `owner == null` BEFORE it consults the scope, so even the widest
        // non-bypass depth cannot reach `allow`. Measured on the booted stack.
        expect(
          await svc.checkEdit('measure_ext_nostamp', 'c1', {
            userId: MEMBER,
            __writeScope: scope,
          } as never),
        ).toBe('deny');
      },
    );

    it.each(['own', 'org'] as const)('checkDelete denies at __writeScope=%s', async (scope) => {
      expect(
        await svc.checkDelete('measure_ext_nostamp', 'c1', {
          userId: MEMBER,
          __writeScope: scope,
        } as never),
      ).toBe('deny');
    });

    it('the two-state projections agree with the verdicts', async () => {
      const ctx = { userId: MEMBER, __writeScope: 'own' } as never;
      expect(await svc.canEdit('measure_ext_nostamp', 'c1', ctx)).toBe(false);
      expect(await svc.canDelete('measure_ext_nostamp', 'c1', ctx)).toBe(false);
    });

    it('ANTI-VACUITY: the same gate ALLOWS on a local object the caller owns', async () => {
      // Without this the block above would read identically if the gates denied
      // everything — which is exactly the fixture-that-cannot-fail shape.
      const ctx = { userId: MEMBER, __writeScope: 'own' } as never;
      expect(await svc.checkEdit('local_task', 't1', ctx)).toBe('allow');
      expect(await svc.checkDelete('local_task', 't1', ctx)).toBe('allow');
      // …and DENIES the same row to a different principal.
      const other = { userId: 'usr_someone_else', __writeScope: 'own' } as never;
      expect(await svc.checkEdit('local_task', 't1', other)).toBe('deny');
    });

    it('ANTI-VACUITY: a federated object with a DECLARED remote owner column allows', async () => {
      // The provenance test's whole point: `external` is not the predicate.
      const ctx = { userId: MEMBER, __writeScope: 'own' } as never;
      expect(await svc.checkEdit('ext_with_real_owner', 'a1', ctx)).toBe('allow');
      expect(await svc.checkDelete('ext_with_real_owner', 'a1', ctx)).toBe('allow');
    });
  });

  describe('changed: no share row may be minted on a phantom anchor (ADR-0111 D7)', () => {
    it('grant() refuses with SHARING_NOT_ENABLED', async () => {
      // Pre-fix this RESOLVED and persisted a `sys_record_share` row — measured
      // on the booted stack with a real platform-admin principal. The row was
      // inert by construction: no verdict above can ever consult it.
      await expect(
        svc.grant(
          { object: 'measure_ext_nostamp', recordId: 'c1', recipientId: 'usr_grantee' },
          { userId: MEMBER } as never,
        ),
      ).rejects.toThrow(/SHARING_NOT_ENABLED/);
    });

    it('the refusal names the federated anchor as the reason, not a missing field', async () => {
      // The operator-facing half: "this object has no owner_id" would be false
      // and would send them to add a column the platform already injected.
      await expect(
        svc.grant(
          { object: 'measure_ext_nostamp', recordId: 'c1', recipientId: 'usr_grantee' },
          { userId: MEMBER } as never,
        ),
      ).rejects.toThrow(/federated .*injected anchor, not a remote column/s);
    });

    it('the message carries the code as a PREFIX — what REST reads to pick 422', async () => {
      // This plugin's declared error idiom is a `CODE: message` prefix, and the
      // REST layer picks the status by `msg.startsWith(code)`
      // (`rest-server.ts` → `respondSharingError`, ['SHARING_NOT_ENABLED', 422]).
      // So the prefix IS the mechanism that produces the status: a refusal that
      // merely mentioned the code mid-sentence would fall through to a 500.
      // Asserting it here, and the resulting `code` + `status` end-to-end over
      // real HTTP in `federated-phantom-share-grant.dogfood.test.ts`.
      const err = await svc
        .grant(
          { object: 'measure_ext_nostamp', recordId: 'c1', recipientId: 'usr_grantee' },
          { userId: MEMBER } as never,
        )
        .then(() => null, (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message.startsWith('SHARING_NOT_ENABLED:')).toBe(true);
      // …and the code is one this package DECLARES in the ADR-0112 ledger,
      // rather than a new spelling invented at the throw site.
      expect(ERROR_CODE_LEDGER['@objectstack/plugin-sharing']).toContain('SHARING_NOT_ENABLED');
    });

    it('what must NOT change: a federated object with a DECLARED owner stays shareable', async () => {
      // `hasPhantomOwnerAnchor` is a PROVENANCE test — a real remote owner
      // column means the gates can consult a share row, so minting one is live.
      await expect(
        svc.grant(
          { object: 'ext_with_real_owner', recordId: 'a1', recipientId: 'usr_grantee' },
          { userId: MEMBER } as never,
        ),
      ).resolves.toMatchObject({ object_name: 'ext_with_real_owner', recipient_id: 'usr_grantee' });
    });

    it('what must NOT change: a LOCAL private object stays shareable, and the row is LIVE', async () => {
      await expect(
        svc.grant(
          { object: 'local_task', recordId: 't1', recipientId: 'usr_grantee', accessLevel: 'edit' },
          { userId: MEMBER } as never,
        ),
      ).resolves.toMatchObject({ object_name: 'local_task', recipient_id: 'usr_grantee' });

      // LIVE, not merely persisted — the contrast that gives the federated
      // refusal its meaning. `usr_grantee` owns nothing and holds no bypass, so
      // the only thing that can lift this verdict is the share row just minted.
      expect(
        await svc.checkEdit('local_task', 't1', { userId: 'usr_grantee', __writeScope: 'own' } as never),
      ).toBe('allow');
      // …and the grant does NOT leak to a different record of the same object.
      expect(
        await svc.checkEdit('local_task', 't2', { userId: 'usr_grantee', __writeScope: 'own' } as never),
      ).toBe('deny');
    });

    it('what must NOT change: the grandfathered showcase object still refuses as PUBLIC', async () => {
      // It is federated AND phantom-anchored, but `public_read_write` is judged
      // first — so its message must still be the public one. The regression
      // surface: a new branch inserted ABOVE the public check would silently
      // re-attribute this shipped object's refusal.
      await expect(
        svc.grant(
          { object: 'showcase_ext_customer', recordId: 'c1', recipientId: 'usr_grantee' },
          { userId: MEMBER } as never,
        ),
      ).rejects.toThrow(/SHARING_NOT_ENABLED: 'showcase_ext_customer' is not under record-sharing/);
    });
  });
});
