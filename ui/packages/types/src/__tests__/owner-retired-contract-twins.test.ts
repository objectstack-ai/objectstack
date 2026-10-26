/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the three PUBLISHED contract twins of the `owner` field type
 * (objectui#4914, fast-follow to objectui#4814's ruling A′).
 *
 * #4814 retired the `owner` field-type spelling and shrank the three public
 * DOC unions (`fields/user.mdx`, `filter-builder.mdx`, `report-schema.mdx`).
 * Their CODE twins live here and were left blessing the word, so this package
 * spent the interval telling an author "legal" for a spelling
 * `@object-ui/fields` answers with a tombstone refusal — the declared ≠
 * enforced shape ADR-0049 targets, on a PUBLISHED surface:
 *
 *  1. `ReportFieldSchema.type` (`zod/reports.zod.ts`) — a runtime validator, so
 *     the contradiction was executable, not merely advisory.
 *  2. `ReportField['type']` (`reports.ts`) — its TS twin; the two report faces
 *     move in lockstep and are never split.
 *  3. `UserFieldMetadata['type']` (`field-types.ts`) — published `.d.ts`
 *     autocomplete, i.e. the surface an AI author copies from.
 *
 * Two kinds of assertion, deliberately: the Zod half is an accept-set SHRINK on
 * a published validator, so it is pinned by the REFUSAL ENVELOPE (a `type`-path
 * issue naming the offending value) rather than by a bare `success === false` —
 * a schema that rejected the whole document for an unrelated reason would
 * satisfy the weaker check. The two TS halves erase at runtime, so they are
 * pinned with `@ts-expect-error`, which is real enforcement here only because
 * `packages/types/tsconfig.test.json` is chained from this package's
 * `type-check` script (#3009).
 *
 * The `user` survivor is asserted with a FULL green `safeParse`, not merely
 * "no `type` issue": this is a value-level judgement, so anything less would
 * pass while the shrink had quietly invalidated the replacement idiom too.
 */

import { describe, it, expect } from 'vitest';
import { ReportFieldSchema } from '../zod/reports.zod.js';
import type { ReportField } from '../reports.js';
import type { UserFieldMetadata } from '../field-types.js';

/** The retired spelling, and the survivor it was a zero-delta synonym for. */
const RETIRED = 'owner';
const SURVIVOR = 'user';

describe('ReportFieldSchema — the runtime twin refuses the retired spelling', () => {
  it('rejects a report field authored as `type: "owner"`, on the `type` path', () => {
    const result = ReportFieldSchema.safeParse({ name: 'owner', type: RETIRED });

    expect(result.success).toBe(false);
    if (result.success) return;

    // The envelope, not just the verdict: exactly one issue, on the `type`
    // path, coded as a closed-vocabulary violation. A bare `success === false`
    // would also pass if the document had been rejected for some unrelated
    // reason, which is not what this pin is for.
    //
    // The offending value is deliberately NOT asserted to appear in the
    // message: measured on zod 4, an `invalid_value` issue carries the ALLOWED
    // `values` and no echo of the input, so an assertion on the received
    // spelling would have been pinning a message this validator never emits.
    // What the allow-list itself says is the stronger reading anyway, and it
    // is asserted directly below.
    const typeIssues = result.error.issues.filter((i) => i.path.join('.') === 'type');
    expect(typeIssues).toHaveLength(1);
    expect(typeIssues[0].code).toBe('invalid_value');

    // The shrink, read off the refusal: the retired spelling is gone from the
    // offered vocabulary and the survivor is still in it.
    const offered = (typeIssues[0] as { values?: unknown[] }).values ?? [];
    expect(offered).not.toContain(RETIRED);
    expect(offered).toContain(SURVIVOR);
  });

  it('still accepts the replacement idiom `{ type: "user", name: "owner" }` in full', () => {
    // The whole point of the retirement is that the record-owner concept
    // survives verbatim — the field NAME carries ownership, the type carries
    // the rendering. A full green parse, because a value-level rule is what
    // this pin guards.
    const result = ReportFieldSchema.safeParse({ name: 'owner', label: 'Owner', type: SURVIVOR });
    expect(result.success).toBe(true);
  });

  it('shrank by exactly one member — the sibling vocabulary is untouched', () => {
    // Guards the shrink from over-reaching: a hand-edited enum that dropped a
    // neighbour would otherwise pass every assertion above.
    for (const type of ['lookup', 'reference', 'master_detail', 'image', 'file', 'tags']) {
      expect(ReportFieldSchema.safeParse({ name: 'f', type }).success).toBe(true);
    }
  });
});

describe('the published TS twins no longer offer the retired spelling', () => {
  it('`ReportField["type"]` rejects it at compile time', () => {
    const legal: ReportField = { name: 'owner', type: SURVIVOR };
    expect(legal.type).toBe(SURVIVOR);

    const retired: ReportField = {
      name: 'owner',
      // @ts-expect-error `owner` was retired by objectui#4814 — write
      // `{ type: 'user', name: 'owner' }` instead (objectui#4914).
      type: RETIRED,
    };
    // Referenced so the binding is not merely unused — the `@ts-expect-error`
    // above is the actual assertion, enforced by `tsconfig.test.json`.
    expect(retired.name).toBe('owner');
  });

  it('`UserFieldMetadata["type"]` rejects it at compile time', () => {
    const legal: UserFieldMetadata = { name: 'owner', type: SURVIVOR };
    expect(legal.type).toBe(SURVIVOR);

    const retired: UserFieldMetadata = {
      name: 'owner',
      // @ts-expect-error `owner` was retired by objectui#4814; this interface
      // describes the person-picker family, not the retired spelling
      // (objectui#4914).
      type: RETIRED,
    };
    expect(retired.name).toBe('owner');
  });
});
