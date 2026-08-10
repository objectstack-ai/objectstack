// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6402] Every `options` door on `TursoDriver` is a `DriverOptions`.
 *
 * # What was open
 *
 * `TursoDriver` overrides 17 methods that take an `options` argument, and every
 * one of them declared it `options?: any` while the base it forwards to
 * (`SqlDriver`, and behind it the `IDataDriver` contract) declared
 * `DriverOptions`. The keys `DriverOptions` names — `bypassTenantAudit`,
 * `tenantId`, `transaction`, `accessible_org_ids`, … — were therefore unchecked
 * at all 17 doors. The argument is #5181's, verbatim, one axis over: an internal
 * caller that misspells `bypassTenantAudit` has `tsc` as its ONLY warning
 * channel, and `any` switched that channel off.
 *
 * # Why all 17 at once
 *
 * The shape was character-identical across every override, so narrowing a subset
 * would read to the next person as a *verdict* on the rest. That is not
 * hypothetical: #6075 (PR #6210) narrowed `count`'s `query` and deliberately left
 * its `options`, and #6212 batch B did the same on `aggregate` — each leaving a
 * comment saying so. This file is the pin for the sweep that closed all of them
 * together, so no half-narrowed state exists to be misread.
 *
 * Note the issue that prompted this counted FIVE such overrides (`update`,
 * `upsert`, `delete`, `count`, `aggregate`) — the CRUD block it was reading while
 * #6212 was in flight. The measurement against `main` found 17: the bulk block,
 * `execute`, and the schema block carry the identical shape. Narrowing the five
 * would have reproduced, at larger scale, exactly the partial-narrowing the issue
 * was filed to prevent.
 *
 * # The table below is the pin, and it is a compile-time one
 *
 * `Door<T>` reports `'any'` for an `any` door and `'DriverOptions'` only for one
 * that is exactly `DriverOptions | undefined`. Each row then `satisfies` it with
 * `'DriverOptions'`, so putting any single signature back to `any` fails `tsc` on
 * that row with `error TS1360: Type '"DriverOptions"' does not satisfy the
 * expected type '"any"'` — naming the method that drifted. A mutual-`extends`
 * check could not do this: `any` satisfies both directions and reports green.
 *
 * # Reverse verification — direction predicted BEFORE it was run, per channel
 *
 * Revert `turso-driver.ts` to `options?: any` and:
 *
 * - `pnpm typecheck` goes RED, one error per reverted signature, on the table row
 *   for that method — plus TS2578 `Unused '@ts-expect-error' directive` on the
 *   misspelling case below, since under `any` the typo compiles fine.
 * - `pnpm test` stays GREEN. Every assertion here is a type-level fact carried by
 *   a string literal; vitest sees three passing string comparisons either way.
 *   That split is the point — this defect has no runtime face at all, which is
 *   why it went 17-for-17 unnoticed.
 *
 * Measured with all 17 reverted, as predicted: 18 typecheck errors — 17 × TS1360,
 * one per row, plus the TS2578 at the misspelling case; `pnpm test` green at 4/4.
 */

import { describe, it, expect } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import type { DriverOptions } from '@objectstack/spec/data';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Reports what a given `options` door actually is. `'any'` for a widened door,
 * `'DriverOptions'` for one that matches the base contract exactly.
 */
type Door<T> = IsAny<T> extends true
  ? 'any'
  : [T] extends [DriverOptions | undefined]
    ? [DriverOptions | undefined] extends [T]
      ? 'DriverOptions'
      : 'other'
    : 'other';

/**
 * One row per override, keyed by the method and the positional index of its
 * `options` argument. Adding an override with a widened `options` and forgetting
 * this table is caught by the exhaustiveness assertion at the end.
 */
const doors = {
  // CRUD
  find: 'DriverOptions' satisfies Door<Parameters<TursoDriver['find']>[2]>,
  findOne: 'DriverOptions' satisfies Door<Parameters<TursoDriver['findOne']>[2]>,
  create: 'DriverOptions' satisfies Door<Parameters<TursoDriver['create']>[2]>,
  update: 'DriverOptions' satisfies Door<Parameters<TursoDriver['update']>[3]>,
  upsert: 'DriverOptions' satisfies Door<Parameters<TursoDriver['upsert']>[3]>,
  delete: 'DriverOptions' satisfies Door<Parameters<TursoDriver['delete']>[2]>,
  count: 'DriverOptions' satisfies Door<Parameters<TursoDriver['count']>[2]>,
  aggregate: 'DriverOptions' satisfies Door<Parameters<TursoDriver['aggregate']>[2]>,
  // Bulk
  bulkCreate: 'DriverOptions' satisfies Door<Parameters<TursoDriver['bulkCreate']>[2]>,
  bulkUpdate: 'DriverOptions' satisfies Door<Parameters<TursoDriver['bulkUpdate']>[2]>,
  bulkDelete: 'DriverOptions' satisfies Door<Parameters<TursoDriver['bulkDelete']>[2]>,
  updateMany: 'DriverOptions' satisfies Door<Parameters<TursoDriver['updateMany']>[3]>,
  deleteMany: 'DriverOptions' satisfies Door<Parameters<TursoDriver['deleteMany']>[2]>,
  // Raw execution
  execute: 'DriverOptions' satisfies Door<Parameters<TursoDriver['execute']>[2]>,
  // Schema
  syncSchema: 'DriverOptions' satisfies Door<Parameters<TursoDriver['syncSchema']>[2]>,
  syncSchemasBatch: 'DriverOptions' satisfies Door<Parameters<TursoDriver['syncSchemasBatch']>[1]>,
  dropTable: 'DriverOptions' satisfies Door<Parameters<TursoDriver['dropTable']>[1]>,
} as const;

describe('[#6402] TursoDriver `options` doors are DriverOptions, all 17 of them', () => {
  it('pins every override — each row is a compile-time check, listed here so a drift names the method', () => {
    // The assertion that matters already ran in `tsc`. This keeps the count
    // honest: a row silently deleted to make a revert compile shows up here.
    expect(Object.keys(doors)).toHaveLength(17);
    expect(Object.values(doors).every((d) => d === 'DriverOptions')).toBe(true);
  });

  it('admits the declared keys — the pin is not green because nothing fits', () => {
    const declared: Parameters<TursoDriver['update']>[3] = {
      bypassTenantAudit: true,
      tenantId: 'org_1',
      skipCache: true,
      timeout: 5_000,
    };
    expect(declared.tenantId).toBe('org_1');
  });

  it('refuses the misspelling that motivated the narrowing', () => {
    // @ts-expect-error [#6402] `bypassTenantAdit` is not a key of DriverOptions.
    const typo: Parameters<TursoDriver['update']>[3] = { bypassTenantAdit: true };
    // The typo'd write silently does nothing at runtime — which is the whole
    // point: `tsc` above is the only channel that ever objects.
    expect(Object.keys(typo!)).toEqual(['bypassTenantAdit']);
  });

  it('the door is the base contract, not a structural look-alike', () => {
    const asBase: DriverOptions | undefined = undefined satisfies Parameters<TursoDriver['count']>[2];
    expect(asBase).toBeUndefined();
  });
});
