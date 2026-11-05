// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30251] `onFailedRead` on {@link IOwnershipQueueService}: the call-time
 * signal ADR-0142 D2 (as amended) asks each consumer to send, so a recompute
 * consumer reached only through this contract (the D6 approver slate in
 * `@objectstack/plugin-approvals`) can ask for a refusal on a failed read.
 *
 * Pinned at the type level, under `check:test-typecheck` (this file compiles
 * under `tsconfig.test.json`):
 *
 *  1. **A widening, not a narrowing.** A call with no options, and the
 *     three-argument `isMember` call, compile exactly as before; so does an
 *     implementation written before the key existed.
 *  2. **Both members read one value type.** `expandMembers`' and `isMember`'s
 *     `onFailedRead` are both {@link OwnershipQueueFailedReadAnswer}, which is
 *     exactly `'nobody' | 'refuse'`; an unknown value does not compile.
 *  3. **Independent of `purpose`.** The two keys sit side by side; neither
 *     value set leaks into the other.
 *
 * ⛔ Not pinned: what any implementation DOES under `'refuse'` — that is the
 * producer half (#29604, `@objectstack/plugin-sharing`).
 */

import { describe, it, expect } from 'vitest';

import type {
  IOwnershipQueueService,
  OwnershipQueueFailedReadAnswer,
  QueueExpansionPurpose,
} from './ownership-queue-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;

type ExpandOptions = NonNullable<Parameters<IOwnershipQueueService['expandMembers']>[2]>;
type IsMemberOptions = NonNullable<Parameters<IOwnershipQueueService['isMember']>[3]>;

export type _AnswerIsExactlyTwoValues = Assert<Eq<OwnershipQueueFailedReadAnswer, 'nobody' | 'refuse'>>;
export type _ExpandReadsTheAnswerType = Assert<Eq<ExpandOptions['onFailedRead'], OwnershipQueueFailedReadAnswer | undefined>>;
export type _IsMemberReadsTheAnswerType = Assert<Eq<IsMemberOptions['onFailedRead'], OwnershipQueueFailedReadAnswer | undefined>>;
export type _PurposeUnchanged = Assert<Eq<ExpandOptions['purpose'], QueueExpansionPurpose | undefined>>;
export type _ExpandOptionKeys = Assert<Eq<keyof ExpandOptions, 'purpose' | 'onFailedRead'>>;
export type _IsMemberOptionKeys = Assert<Eq<keyof IsMemberOptions, 'onFailedRead'>>;
/** The axes stay apart: no failed-read answer is a purpose, and no purpose is a failed-read answer. */
export type _AxesDisjoint = Assert<Eq<Extract<OwnershipQueueFailedReadAnswer, QueueExpansionPurpose>, never>>;

/** An implementation written before the key existed still satisfies the contract (method bivariance on an optional trailing argument). */
const legacy: IOwnershipQueueService = {
  resolveQueue: async () => null,
  expandMembers: async (_name: string, _org: string | null, _options?: { purpose?: QueueExpansionPurpose }) => [],
  isMember: async (_user: string, _name: string, _org: string | null) => false,
  queuesOf: async () => [],
};

/** Every call shape the card's acceptance names; the unknown values must NOT compile. */
async function callShapes(svc: IOwnershipQueueService): Promise<unknown[]> {
  return [
    await svc.expandMembers('q', 'org_a'),
    await svc.expandMembers('q', null, {}),
    await svc.expandMembers('q', 'org_a', { purpose: 'addressing' }),
    await svc.expandMembers('q', 'org_a', { onFailedRead: 'refuse' }),
    await svc.expandMembers('q', 'org_a', { purpose: 'addressing', onFailedRead: 'refuse' }),
    await svc.expandMembers('q', 'org_a', { onFailedRead: 'nobody' }),
    await svc.isMember('u', 'q', 'org_a'),
    await svc.isMember('u', 'q', 'org_a', { onFailedRead: 'refuse' }),
    // @ts-expect-error — not a failed-read answer
    await svc.expandMembers('q', 'org_a', { onFailedRead: 'throw' }),
    // @ts-expect-error — not a failed-read answer
    await svc.isMember('u', 'q', 'org_a', { onFailedRead: 'empty' }),
    // @ts-expect-error — `purpose` is the other axis, and `isMember` does not take it
    await svc.isMember('u', 'q', 'org_a', { purpose: 'addressing' }),
    // @ts-expect-error — a purpose value is not a failed-read answer
    await svc.expandMembers('q', 'org_a', { onFailedRead: 'addressing' }),
  ];
}

describe('IOwnershipQueueService onFailedRead (#30251)', () => {
  it('every call shape compiles against an implementation written before the key, and answers as it did', async () => {
    expect(await callShapes(legacy)).toEqual([[], [], [], [], [], [], false, false, [], false, false, []]);
  });
});
