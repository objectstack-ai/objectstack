// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14078] `canonicalIsoInstant`'s `Date` arm is TOTAL — an Invalid `Date`
 * leaves as `undefined`, never as a `RangeError` at the serialisation seam.
 *
 * ## The defect
 *
 * The arm was `if (value instanceof Date) return value.toISOString();`, and
 * `toISOString()` raises `RangeError: Invalid time value` for the one `Date`
 * whose time value is `NaN`. The spelling it replaced — `String(value)` —
 * served the text `"Invalid Date"` for the same input, so the repair traded a
 * visibly-wrong field for an uncaught exception on a READ path: a 500 the
 * operator cannot trace to a row.
 *
 * ## Reachability is measured, not argued
 *
 * PR #14409 (landed `3ecb7dc1a`) drove both live client libraries: mysql2
 * 3.23.1 returns a module constant literally named `INVALID_DATE` for a zero
 * `DATETIME`, and postgres-date 1.0.7 builds `new Date(NaN)` for every year in
 * 275760..294276 — a range Postgres itself stores. The shape is not
 * hypothetical, which is why the maintainer ruled option B (2026-09-02) with
 * the guard on all five arms of the shared spelling at once.
 *
 * ## What is pinned here, and why `undefined` is the terminal value at THIS arm
 *
 * The ruling sets the terminal value **per call site**: the visible text
 * `"Invalid Date"` where the field is required and an operator reads it,
 * `undefined` where the field is optional and the caller already carries a
 * `?? default` chain. Both call sites of this copy are the second case —
 * `getByHash` ends in `?? new Date(0).toISOString()` and `rowToItem` in
 * `?? new Date().toISOString()`, the branch an absent column takes today — so
 * `undefined` hands the bad row to the caller's own fallback and
 * `MetadataItem.authoredAt` stays a parseable instant. Feeding the literal
 * text here would instead move the failure downstream: `authoredAt` is read by
 * machines, and its one in-repo forwarding lands in a `z.string().datetime()`
 * field that the text fails outright.
 *
 * ## Why the reverse check is in every case
 *
 * A pin that only asserts "no throw" would stay green against a fixture that
 * silently degraded to a string. Each case therefore proves the planted value
 * really is a `Date` with a `NaN` time value AND evaluates the OLD spelling on
 * that same object (`value.toISOString()`), asserting it raises `RangeError`.
 * That is the removed guard reproduced in-place: if the input ever stopped
 * being the contested shape, the reverse check goes red first.
 *
 * §C is the discrimination limb: a valid `Date` is still canonicalised
 * byte-exactly and an already-canonical string is still a fixed point, so the
 * guard cannot pass by having disabled the arm it guards.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate, MetadataItemSchema } from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

/** Canonical ISO-8601 UTC with milliseconds — what the declared type promises. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A checksum shaped as `MetadataItemSchema.hash` demands. */
const HASH = `sha256:${'a'.repeat(64)}`;

/** Non-zero milliseconds: a truncating regression stays observable. */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');
const SQLITE_TEXT = '2026-03-04T05:06:07.089Z';

/**
 * The one shape both live drivers were measured to hand back. Built here, per
 * case, so no case can share an object with another.
 */
function invalidDate(): Date {
  return new Date(NaN);
}

/**
 * The removed guard, reproduced: the OLD arm's expression on the very object
 * the case plants. Red here means the fixture is no longer the contested shape
 * and every assertion below would be vacuous.
 */
function assertOldSpellingWouldThrow(value: Date): void {
  expect(value, 'fixture degraded — not a Date').toBeInstanceOf(Date);
  expect(Number.isNaN(value.getTime()), 'fixture is a VALID Date — case is vacuous').toBe(true);
  expect(() => value.toISOString()).toThrow(RangeError);
}

/**
 * Minimal engine double: `findOne` only, which is every verb `get` and
 * `getByHash` reach. It opens on the producer's own refusal predicate, so a
 * query a real server would refuse cannot pass here either.
 */
function makeEngine(row: Record<string, unknown> | null) {
  return {
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, opts);
      return row;
    },
  };
}

function makeRepo(row: Record<string, unknown> | null) {
  return new SysMetadataRepository({
    engine: makeEngine(row) as never,
    organizationId: 'org_alpha',
    orgLabel: 'org_alpha',
  });
}

const REF = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
const BODY = { name: 'case_grid', label: 'Cases', object: 'case', columns: [{ field: 'name' }] };

function overlayRow(stamp: unknown): Record<string, unknown> {
  return {
    id: 'r_1', type: 'view', name: 'case_grid', organization_id: 'org_alpha',
    state: 'active', metadata: BODY, checksum: HASH, updated_by: 'usr_1',
    updated_at: stamp, created_at: stamp,
  };
}

function historyRow(stamp: unknown): Record<string, unknown> {
  return {
    id: 'h_1', type: 'view', name: 'case_grid', organization_id: 'org_alpha',
    metadata: BODY, checksum: HASH, previous_checksum: null,
    recorded_by: 'usr_1', recorded_at: stamp, event_seq: 3,
  };
}

describe('[#14078] §A rowToItem — an Invalid Date reaches the caller fallback, not a RangeError', () => {
  it('serves the `?? new Date().toISOString()` default instead of throwing', async () => {
    const bad = invalidDate();
    assertOldSpellingWouldThrow(bad);

    const before = Date.now();
    const item = await makeRepo(overlayRow(bad)).get(REF);
    const after = Date.now();

    expect(item).not.toBeNull();
    // The caller's own fallback fired — a real instant, stamped now.
    expect(item!.authoredAt).toMatch(ISO_Z);
    const stamped = Date.parse(item!.authoredAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);

    // ⛔ The two answers the ruling forbids at THIS arm: the visible text
    // (which a `z.string().datetime()` reader downstream refuses) and the
    // silent blank.
    expect(item!.authoredAt).not.toBe('Invalid Date');
    expect(item!.authoredAt).not.toBe('');

    // The declared contract, evaluated on a driver-shaped input.
    const parsed = MetadataItemSchema.safeParse(item);
    expect(parsed.success, JSON.stringify((parsed as never as { error?: { issues: unknown } }).error?.issues)).toBe(true);
  });
});

describe('[#14078] §B getByHash — the same arm, the same answer', () => {
  it('falls back to the epoch default instead of throwing', async () => {
    const bad = invalidDate();
    assertOldSpellingWouldThrow(bad);

    const item = await makeRepo(historyRow(bad)).getByHash(REF, HASH);

    expect(item).not.toBeNull();
    // `getByHash`'s own chain, unchanged by this card.
    expect(item!.authoredAt).toBe(new Date(0).toISOString());
    expect(MetadataItemSchema.safeParse(item).success).toBe(true);
  });
});

describe('[#14078] §C the guard discriminates — the arm it guards still works', () => {
  it('canonicalises a VALID Date byte-exactly', async () => {
    const item = await makeRepo(overlayRow(PG_INSTANT)).get(REF);
    expect(item!.authoredAt).toBe(PG_INSTANT.toISOString());
    expect(item!.authoredAt).toMatch(ISO_Z);
  });

  it('leaves an already-canonical SQLite string byte-identical', async () => {
    const item = await makeRepo(overlayRow(SQLITE_TEXT)).get(REF);
    expect(item!.authoredAt).toBe(SQLITE_TEXT);
  });

  it('still reads an absent column as absent, not as an Invalid Date', async () => {
    const row = overlayRow(PG_INSTANT);
    delete row.updated_at; delete row.created_at;

    const before = Date.now();
    const item = await makeRepo(row).get(REF);

    // Same branch the Invalid `Date` now takes — which is the point of
    // choosing `undefined`: one meaning, "this row carries no usable instant".
    expect(item!.authoredAt).toMatch(ISO_Z);
    expect(Date.parse(item!.authoredAt)).toBeGreaterThanOrEqual(before);
  });
});
