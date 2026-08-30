// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10825] Row-equivalence proof for the BATCHED `resolveUserAuthzGrants`.
 *
 * `resolveUserAuthzGrants` used to issue its eight reads one after another —
 * legs 6–13 of an authenticated request. They are now issued in four waves
 * (`Promise.all` over the reads that have no data dependency on one another).
 * Latency-wise that is the whole point (cloud#1539: sequential LEGS, not query
 * count, are the multiplier), but on an AUTHORIZATION path a re-ordering that
 * changes even one returned row is a privilege bug that a "the request still
 * succeeds" suite cannot see.
 *
 * So this file is a DIFFERENTIAL CONTROL, not a smoke test. Every expectation
 * below was CAPTURED from the pre-batch sequential implementation on `main`
 * (`git show 795ea05a7:packages/core/src/security/resolve-authz-context.ts`,
 * 2026-08-23 — AFTER #10982, so the lapsed-membership goldens record the
 * corrected ADR-0091 semantics; see that fixture's note) running against these
 * exact fixtures, and is asserted verbatim against the batched one. Two
 * independent goldens per fixture:
 *
 *   1. `grants` — the whole resolved envelope, deep-equal INCLUDING array
 *      order (positions/permissions order is contractual: `seedPermissions`
 *      first, `platform_admin` unshifted to the front, …).
 *   2. `queries` — the exact multiset of `{ object, where, limit }` triples the
 *      resolver issued, in issue order, each with `context.isSystem === true`.
 *      This is the "same filters, same tenancy scoping, same limits" half:
 *      widening an `$in`, dropping a tenancy filter or merging two reads into
 *      one changes this list even when the resolved envelope happens to agree.
 *
 * A third, non-golden assertion measures the LEG count (see `makeRecordingQl`)
 * — that one is the changed-behaviour control: it read 8 pre-fix and reads 4
 * now.
 *
 * ⛔ These goldens are a record of what the sequential code DID. Never "fix" a
 * red one by re-capturing it: the whole value of the file is that it cannot be
 * satisfied by agreeing with the new implementation.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
// The recording double and the 11-fixture matrix live in the sibling
// `.testkit.ts` (extracted for #11971 so the grants-cache identity pins can
// drive the SAME fixtures without importing this test file and re-registering
// its suites). The goldens stay HERE, next to the assertions they control.
import {
  makeRecordingQl,
  FIXTURES,
  type RecordedCall,
} from './resolve-authz-context.batch-equivalence.testkit.js';

// ── Goldens captured from the SEQUENTIAL implementation ─────────────────────

interface Golden { sequentialLegs: number; grants: unknown; queries: RecordedCall[] }

/**
 * Captured by running the fixtures above against
 * `git show 795ea05a7:packages/core/src/security/resolve-authz-context.ts`
 * — the last mainline commit before the batch (post-#10982). `sequentialLegs`
 * is that run's leg count, which equalled its query count because every read
 * awaited the one before it.
 */
const GOLDEN: Record<string, Golden> = JSON.parse(
  readFileSync(new URL('./resolve-authz-context.batch-equivalence.golden.json', import.meta.url), 'utf8'),
);

/**
 * The leg count each fixture resolves in AFTER batching — the changed-behaviour
 * control, written out per fixture rather than derived, so a regression that
 * re-serialises one read shows up as a number rather than as a slower suite.
 *
 * Four is the floor, not three: wave 1 (every independent read) → wave 2
 * (`sys_position`, needs the position NAMES wave 1 produced) → wave 3
 * (`sys_position_permission_set`, needs the position IDS wave 2 produced) →
 * wave 4 (`sys_permission_set`, needs the union of directly- and
 * position-granted ids). A principal with no `sys_position` row backing any of
 * its position names skips wave 3 and lands in 3.
 */
const BATCHED_LEGS: Record<string, number> = {
  'empty-principal': 2,
  'multi-org-membership': 2,
  'lapsed-own-membership-among-active-peers': 2,
  'position-derived-grants': 4,
  'permission-set-derived-grants': 3,
  'tenant-admin-via-position': 4,
  'ai-seat-and-email-from-sys-user': 2,
  'ai-seat-denied': 2,
  'seeded-permissions-and-email': 3,
  'read-limits-truncate': 2,
  'no-active-org': 2,
};

/** Order-insensitive comparison key: a batch reorders ISSUE order by design. */
const asMultiset = (calls: RecordedCall[]) => calls.map((c) => JSON.stringify(c)).sort();

describe('[#10825] batched resolveUserAuthzGrants — equivalence with the sequential reads', () => {
  /**
   * [#11663 L2] These goldens are captured from a deployment that declares NO
   * platform administrators, and they must stay that way.
   *
   * The config anchor added a third reason to read `sys_user` — but a
   * CONDITIONAL one: with `OS_PLATFORM_OWNER_EMAIL` unset the derivation
   * answers "not an admin" on an empty list before it looks at any row (pin
   * P2), so every query below is byte-identical to what the sequential
   * implementation issued and NOT ONE golden moved for this leg. That is a real
   * property of the change, and it is only worth anything if the suite pins the
   * condition it rests on: an ambient value in a CI worker would silently add a
   * `sys_user` read to `seeded-permissions-and-email` and turn a green
   * differential control into a mystery. So the variable is cleared here rather
   * than assumed absent, and the memo — keyed on the raw string — is dropped
   * with it on both sides.
   *
   * ⛔ If a future leg makes the read unconditional, the golden MOVES and the
   * move is written down in the PR that makes it. It is never re-captured to
   * agree with new output.
   */
  const ENV = 'OS_PLATFORM_OWNER_EMAIL';
  let ambientOwnerEmail: string | undefined;
  beforeAll(() => {
    ambientOwnerEmail = process.env[ENV];
    delete process.env[ENV];
    resetPlatformAdminEmailMemo();
  });
  afterAll(() => {
    if (ambientOwnerEmail === undefined) delete process.env[ENV];
    else process.env[ENV] = ambientOwnerEmail;
    resetPlatformAdminEmailMemo();
  });

  it('the fixture matrix and the captured goldens have not drifted apart', () => {
    expect(FIXTURES.map((f) => f.name).sort()).toEqual(Object.keys(GOLDEN).sort());
    expect(Object.keys(BATCHED_LEGS).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  describe.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (name, f) => {
    it('resolves the SAME grants envelope, row for row and in the same order', async () => {
      const ql = makeRecordingQl(f.tables);
      const grants = await resolveUserAuthzGrants(ql, f.userId, f.opts);
      expect(grants).toEqual(GOLDEN[name].grants);
    });

    it('issues the SAME reads — same objects, same filters, same tenancy scoping, same limits', async () => {
      const ql = makeRecordingQl(f.tables);
      await resolveUserAuthzGrants(ql, f.userId, f.opts);
      // Multiset, not sequence: parallelising is precisely a change of issue
      // order. What must not change is WHICH reads happen and with WHAT.
      expect(asMultiset(ql.calls)).toEqual(asMultiset(GOLDEN[name].queries));
      // Batching must not become a privilege change by another route: every
      // read still runs as system, as it did before.
      expect(ql.calls.every((c) => c.isSystem)).toBe(true);
      // Query COUNT is not the win here and must not silently become one:
      // an extra read would mean the batch speculated, a missing one would
      // mean it elided a read the sequential path made.
      expect(ql.calls.length).toBe(GOLDEN[name].queries.length);
    });

    it('collapses those reads into fewer sequential LEGS — the actual win', async () => {
      const ql = makeRecordingQl(f.tables);
      await resolveUserAuthzGrants(ql, f.userId, f.opts);
      expect(ql.legs).toBe(BATCHED_LEGS[name]);
      expect(ql.legs).toBeLessThan(GOLDEN[name].sequentialLegs);
      // Every wave-1 read really is in wave 1 — a `Promise.all` that someone
      // later `await`s member-by-member would still pass the two assertions
      // above while restoring the whole cost this card removed.
      const wave1 = ql.calls.filter((_, i) => ql.legOf[i] === 1).map((c) => c.object).sort();
      expect(wave1).toEqual(
        asMultiset(GOLDEN[name].queries)
          .map((s) => JSON.parse(s) as RecordedCall)
          .filter((c) => c.object !== 'sys_position' && c.object !== 'sys_position_permission_set' && c.object !== 'sys_permission_set')
          .map((c) => c.object)
          .sort(),
      );
    });
  });
});
