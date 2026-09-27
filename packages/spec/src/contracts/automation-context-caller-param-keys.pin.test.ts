// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19846] `AutomationContext.callerParamKeys` — the flow doors' statement of
 * which `params` keys the CALLER supplied, read by the `screen` node's headless
 * verdict instead of inferring it from the merged bag.
 *
 * Pinned here, at the type level, because a TypeScript interface member has no
 * Zod schema to assert against (the `automation-context-record-load-denied`
 * pin's form, compiled by `check:test-typecheck` under `tsconfig.test.json`):
 *
 *  1. **The key's type is exactly `string[] | undefined`** — a list of names,
 *     not a bag of values, and not a boolean per key.
 *  2. **Additive.** A context literal without it still type-checks, so no
 *     existing `IAutomationService.execute` caller moves, and an absent key is
 *     what every producer other than the two doors and the schedule trigger
 *     (which states `[]`, #19900) sends.
 *  3. **An empty list is a legal value** — "the caller supplied nothing" — and
 *     it is a different value from an absent key.
 *
 * ⛔ Not pinned here: that the doors fill it, and that the verdict reads it.
 * Those are `packages/runtime`'s `flow-caller-param-keys.test.ts` (the
 * producers) and `@objectstack/service-automation`'s
 * `screen-headless-caller-signal.test.ts` (the consumer, on the real engine).
 */

import { describe, it, expect } from 'vitest';

import type { AutomationContext, IAutomationService } from './automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

/** Exported deliberately — an unread alias is TS6196, and a pin no program compiles is no pin at all. */
export type CallerParamKeysIsAListOfNames = Assert< Eq< AutomationContext['callerParamKeys'], string[] | undefined > >;

/** Additive: a context written before the key still type-checks. */
export const contextWithoutTheKey: AutomationContext = { object: 'crm_lead', params: { subject: 'x' } };
/** The caller supplied nothing — an answer, not an absence. */
export const contextSupplyingNothing: AutomationContext = { object: 'crm_lead', params: { recordId: 'lead_1' }, callerParamKeys: [] };
export const contextSupplyingSubject: AutomationContext = {
  object: 'crm_lead', params: { recordId: 'lead_1', subject: 'x' }, callerParamKeys: ['subject'],
};
// @ts-expect-error — a per-key boolean map is not the shape: the key lists names.
export const contextWithAMap: AutomationContext = { params: { subject: 'x' }, callerParamKeys: { subject: true } };

describe('[#19846] AutomationContext.callerParamKeys', () => {
  it('reads back absent, empty and populated as three different values', () => {
    expect('callerParamKeys' in contextWithoutTheKey).toBe(false);
    expect(contextSupplyingNothing.callerParamKeys).toEqual([]);
    expect(contextSupplyingSubject.callerParamKeys).toEqual(['subject']);
  });

  it('a service implementation reads it without a cast', async () => {
    const seen: Array<string[] | undefined> = [];
    const service: IAutomationService = {
      execute: async (_flowName, context?) => {
        seen.push(context?.callerParamKeys);
        return { success: true };
      },
      listFlows: async () => [],
    };
    await service.execute('f', contextSupplyingSubject);
    await service.execute('f', contextWithoutTheKey);
    expect(seen).toEqual([['subject'], undefined]);
  });
});
