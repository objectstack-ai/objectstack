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
import { OWNER_FIELD_DEF } from '@objectstack/metadata-core';
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
 */
function makeEngine(schemas: Record<string, unknown>) {
  return {
    getSchema: (name: string) => schemas[name],
    find: async () => [],
    insert: async (_o: string, d: unknown) => d,
    update: async (_o: string, d: unknown) => d,
    delete: async () => ({ deleted: 0 }),
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
