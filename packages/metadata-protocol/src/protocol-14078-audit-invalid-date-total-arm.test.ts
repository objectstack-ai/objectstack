// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14078] `auditMetaItem`'s `occurredAt` arm is TOTAL — an Invalid `Date`
 * renders as the visible text `"Invalid Date"`, never as a `RangeError`.
 *
 * ## The defect
 *
 * The mapping was a ternary whose middle arm ran `r.occurred_at.toISOString()`
 * for ANY `Date`. `toISOString()` raises `RangeError: Invalid time value` on a
 * `Date` whose time value is `NaN`, so ONE bad `sys_metadata_audit` row turned
 * `GET /api/v1/meta/:type/:name/audit` — the read behind Studio's 审计日志 tab —
 * into a 500 for the whole page, on a row the error does not name. This is a
 * COMPLIANCE surface: the trail going dark is the failure mode it exists to
 * prevent.
 *
 * ## Reachability is measured, not argued
 *
 * PR #14409 (landed `3ecb7dc1a`): mysql2 3.23.1 returns a module constant
 * literally named `INVALID_DATE` for a zero `DATETIME`; postgres-date 1.0.7
 * builds `new Date(NaN)` for every year in 275760..294276, a range Postgres
 * itself stores. The maintainer ruled option B on 2026-09-02, on all five arms
 * of the shared spelling at once.
 *
 * ## Why the terminal value here is the TEXT, not `undefined`
 *
 * The ruling sets it per call site: visible text where the field is required
 * and an operator reads it. `AuditMetaItemResponseSchema.events[].occurredAt`
 * is a REQUIRED plain `z.string()` — not `z.string().datetime()` — so the text
 * satisfies the declared contract and arrives in the tab where a human can see
 * and report it. `undefined` would fail the required field, and a blank `''`
 * is the silent shape the ruling forbids by name.
 *
 * The value is reached by letting the guard fail into the `String(...)` arm
 * that was already there, so the rendering is literally the one the pre-repair
 * spelling produced. §A pins that identity rather than only the literal.
 *
 * ## What makes these cases non-vacuous
 *
 * Every case proves its planted value is a `Date` with a `NaN` time value and
 * evaluates the OLD arm's expression on that same object, asserting it raises
 * `RangeError`. §B is the discrimination limb: a valid `Date` is still
 * canonicalised and a canonical string is still a fixed point, so the guard
 * cannot pass by having disabled the arm it guards.
 */

import { describe, it, expect } from 'vitest';
import { AuditMetaItemResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Canonical ISO-8601 UTC with milliseconds. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Non-zero milliseconds, so a truncating regression stays observable. */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');
const SQLITE_TEXT = '2026-03-04T05:06:07.089Z';

/**
 * The removed guard, reproduced: the OLD arm's expression on the very object
 * the case plants. Red here means the fixture is no longer the contested shape.
 */
function assertOldSpellingWouldThrow(value: Date): void {
  expect(value, 'fixture degraded — not a Date').toBeInstanceOf(Date);
  expect(Number.isNaN(value.getTime()), 'fixture is a VALID Date — case is vacuous').toBe(true);
  expect(() => value.toISOString()).toThrow(RangeError);
}

function auditRow(stamp: unknown): Record<string, unknown> {
  return {
    id: 'aud_1',
    occurred_at: stamp,
    actor: 'usr_1',
    source: 'protocol.saveMetaItem',
    operation: 'save',
    outcome: 'allowed',
    code: 'ok',
    lock_state: null,
    lock_overridden: false,
    request_id: 'req_1',
    note: null,
  };
}

/** The real `auditMetaItem`, over an engine whose read door returns `rows`. */
function protocolOver(rows: Array<Record<string, unknown>>) {
  const engine = { registry: { getObject: () => undefined }, find: async () => rows };
  return new ObjectStackProtocolImplementation(engine as never);
}

const REQ = { type: 'views', name: 'case_grid' };

describe('[#14078] §A an Invalid Date is served as visible text, not a 500', () => {
  it('renders `Invalid Date` and satisfies the declared response contract', async () => {
    const bad = new Date(NaN);
    assertOldSpellingWouldThrow(bad);

    const res = await protocolOver([auditRow(bad)]);
    const body = await res.auditMetaItem(REQ);

    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.occurredAt).toBe('Invalid Date');

    // The rendering is the pre-repair spelling's own, not a literal invented
    // here: `String(new Date(NaN))` is `"Invalid Date"` by ECMA-262.
    expect(body.events[0]!.occurredAt).toBe(String(bad));

    // ⛔ The blank the ruling forbids by name.
    expect(body.events[0]!.occurredAt).not.toBe('');

    // The contract itself — a REQUIRED plain `z.string()`, so the text passes
    // and reaches the operator's tab.
    const parsed = AuditMetaItemResponseSchema.safeParse(body);
    expect(parsed.success, JSON.stringify((parsed as { error?: { issues: unknown } }).error?.issues)).toBe(true);
  });

  it('keeps the REST of the trail readable — one bad row does not blank the page', async () => {
    const bad = new Date(NaN);
    assertOldSpellingWouldThrow(bad);

    const body = await protocolOver([auditRow(bad), auditRow(PG_INSTANT)]).auditMetaItem(REQ);

    // The whole point of the ruling: the good rows survive the bad one.
    expect(body.events.map((e) => e.occurredAt)).toEqual(['Invalid Date', PG_INSTANT.toISOString()]);
    expect(AuditMetaItemResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe('[#14078] §B the guard discriminates — the arm it guards still works', () => {
  it('canonicalises a VALID Date byte-exactly', async () => {
    const body = await protocolOver([auditRow(PG_INSTANT)]).auditMetaItem(REQ);
    expect(body.events[0]!.occurredAt).toBe(PG_INSTANT.toISOString());
    expect(body.events[0]!.occurredAt).toMatch(ISO_Z);
  });

  it('leaves an already-canonical SQLite string byte-identical', async () => {
    const body = await protocolOver([auditRow(SQLITE_TEXT)]).auditMetaItem(REQ);
    expect(body.events[0]!.occurredAt).toBe(SQLITE_TEXT);
  });

  it('still renders an absent column as the empty string it always did', async () => {
    const row = auditRow(null);
    delete row.occurred_at;
    const body = await protocolOver([row]).auditMetaItem(REQ);
    // Unchanged by this card — the nullish arm's meaning is not the ruling's
    // subject, and moving it would be a behaviour change nobody asked for.
    expect(body.events[0]!.occurredAt).toBe('');
  });
});
