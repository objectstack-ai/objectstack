// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26506] `IAutomationService.toggleFlow`'s caller channel — who switched a
 * packaged flow on or off, so the activation-ledger row and its audit row can
 * name that user instead of writing a null actor.
 *
 * Pinned here, at the type level, because a TypeScript interface member has no
 * Zod schema to assert against (the `automation-context-caller-param-keys`
 * pin's form, compiled by `check:test-typecheck` under `tsconfig.test.json`):
 *
 *  1. **The third parameter is exactly `Pick<AutomationContext, 'userId'>`,
 *     optional.** The acting-user key `execute` already reads, and nothing
 *     else: no grants (the authority gate stays at the door) and no tenant
 *     (the ledger has no organization column). A caller literal carrying
 *     positions or a record does not compile.
 *  2. **Additive.** A two-argument call still compiles, and so does an
 *     implementation written against the two-parameter signature, so no
 *     current implementer or caller moves.
 *
 * ⛔ Not pinned here: that the doors pass the caller and that the ledger write
 * carries it. That is the server half, `@objectstack/runtime`'s toggle door
 * and `@objectstack/service-automation`'s `toggleFlow` (#26474).
 */

import { describe, it, expect } from 'vitest';

import type { AutomationContext, IAutomationService } from './automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

type ToggleFlow = NonNullable< IAutomationService['toggleFlow'] >;
type ToggleFlowParams = Parameters< ToggleFlow >;

// Exported deliberately — an unread alias is TS6196, and a pin no program compiles is no pin at all.

/** The third parameter is the caller, narrowed to the acting user, optional. */
export type CallerIsTheActingUserOnly = Assert< Eq< ToggleFlowParams[2], Pick< AutomationContext, 'userId' > | undefined > >;
/** It is the last parameter, and the two existing ones keep their place. */
export type ToggleFlowArity = Assert< Eq< ToggleFlowParams['length'], 2 | 3 > >;
export type NameAndEnabledUnchanged = Assert< Eq< [ToggleFlowParams[0], ToggleFlowParams[1]], [string, boolean] > >;

/** Additive: an implementation written against the two-parameter signature still satisfies the contract. */
export const twoParameterToggle: ToggleFlow = async (_name: string, _enabled: boolean) => {};
export class TwoParameterService implements Pick< IAutomationService, 'execute' | 'listFlows' | 'toggleFlow' > {
  async execute() { return { success: true }; }
  async listFlows() { return []; }
  async toggleFlow(_name: string, _enabled: boolean): Promise< void > {}
}

/** Additive: a two-argument call still compiles. */
export const twoArgumentCall = (service: IAutomationService) => service.toggleFlow?.('showcase_urgent_task_alert', false);
export const callerCall = (service: IAutomationService) =>
  service.toggleFlow?.('showcase_urgent_task_alert', false, { userId: 'usr_admin' });

/** A caller that names no user is allowed, and reads as an unattributed write. */
export const anonymousCaller: ToggleFlowParams[2] = {};

// @ts-expect-error — grants are not the channel's: the authority gate stays at the door.
export const callerWithPositions: ToggleFlowParams[2] = { userId: 'usr_admin', positions: ['admin'] };
// @ts-expect-error — the channel is not an execution context: no record, no params.
export const callerWithRecord: ToggleFlowParams[2] = { userId: 'usr_admin', record: { id: 'r1' } };

describe('IAutomationService.toggleFlow — the caller channel', () => {
  it('an implementation reads the caller id without a cast, and absent when not passed', async () => {
    const seen: Array< string | undefined > = [];
    const service: Pick< IAutomationService, 'toggleFlow' > = {
      toggleFlow: async (_name, _enabled, caller?) => {
        seen.push(caller?.userId);
      },
    };
    await service.toggleFlow?.('showcase_urgent_task_alert', false, { userId: 'usr_admin' });
    await service.toggleFlow?.('showcase_urgent_task_alert', true);
    expect(seen).toEqual(['usr_admin', undefined]);
  });

  it('a two-parameter implementation still runs when a caller is passed', async () => {
    const service = new TwoParameterService();
    await expect(service.toggleFlow('showcase_urgent_task_alert', false)).resolves.toBeUndefined();
    const asContract: Pick< IAutomationService, 'toggleFlow' > = service;
    await expect(asContract.toggleFlow?.('showcase_urgent_task_alert', false, { userId: 'usr_admin' })).resolves.toBeUndefined();
  });
});
