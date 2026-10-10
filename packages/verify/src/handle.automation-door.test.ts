// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 8: the handle's door to the automation engine's predicate
 * evaluator, `stack.automation.evaluateCondition(condition, variables)`.
 *
 * On 17.7.0 the handle had no such door, so an app's suite that tested a
 * flow condition's truth table over variable shapes no write produces reached
 * `kernel.getService('automation').evaluateCondition(…)` by hand (hotcrm's
 * `conditionHolds`). The door is that same call, made by the handle: the
 * booted kernel's own `automation` service, the condition as given, the
 * variables as the `Map` the engine takes, and the engine's answer back.
 *
 * So every claim below is read off the engine itself: a spy on the booted
 * service instance (it was asked, with exactly these arguments, and its
 * answer is the door's), the engine called directly beside the door (same
 * verdict, same fault), and the engine's own dialect decision, which a door
 * that rewrote the condition would change. The no-automation boot answers
 * with the kernel's own rejection, compared against the kernel asked
 * directly.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

import { isServiceNotRegisteredError, SERVICE_NOT_REGISTERED_CODE } from '@objectstack/core';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

import { bootStack, type VerifyStack } from './harness.js';
import { isVerifyRefusal } from './handle.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

/** The engine's evaluator, as the booted `automation` service exposes it. */
interface Evaluator {
  evaluateCondition(condition: unknown, variables: Map<string, unknown>): boolean;
}

/**
 * The fixture, built anew per boot: one neutral object, and the automation
 * capability declared (`requires`) or not. Two configurations, so the two
 * boots are two stacks rather than a refused second boot of one.
 */
function fixture(withAutomation: boolean) {
  return defineStack({
    manifest: {
      id: `com.objectstack.verify.automation-door${withAutomation ? '' : '-none'}`,
      namespace: 'acd',
      version: '0.0.0',
      type: 'app',
      name: 'Verify Automation Door Fixture',
      description: 'One neutral object; the automation capability declared or not.',
    },
    ...(withAutomation ? { requires: ['automation'] } : {}),
    objects: [
      ObjectSchema.create({
        name: 'acd_deal',
        label: 'Deal',
        pluralLabel: 'Deals',
        fields: {
          name: Field.text({ label: 'Name', required: true }),
          stage: Field.text({ label: 'Stage' }),
          amount: Field.number({ label: 'Amount' }),
        },
      }),
    ],
  } as never);
}

/** A record-change predicate over `record` and `previous`, as a flow's start gate holds it. */
const MOVED_AND_LARGE = 'record.amount >= 1000 && record.stage != previous.stage';
const movedLarge = { record: { id: 'd1', amount: 5000, stage: 'won' }, previous: { id: 'd1', amount: 5000, stage: 'open' } };
const unmoved = { record: { id: 'd1', amount: 5000, stage: 'won' }, previous: { id: 'd1', amount: 5000, stage: 'won' } };
const small = { record: { id: 'd1', amount: 10, stage: 'won' }, previous: { id: 'd1', amount: 10, stage: 'open' } };

/** What the door, or the engine asked directly, answered: a verdict or a fault. */
async function answer<T>(run: () => T | Promise<T>): Promise<{ value?: T; fault?: unknown }> {
  try {
    return { value: await run() };
  } catch (fault) {
    return { fault };
  }
}

describe('stack.automation.evaluateCondition (#22301 item 8)', () => {
  let stack: VerifyStack;
  let bare: VerifyStack;
  let engine: Evaluator;

  beforeAll(async () => {
    stack = await bootStack(fixture(true));
    bare = await bootStack(fixture(false));
    engine = await stack.kernel.getServiceAsync<Evaluator>('automation');
  }, BOOT_TIMEOUT * 2);

  afterAll(async () => {
    await stack?.stop();
    await bare?.stop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The door and the engine, asked the same question; the engine's Map built here, independently. */
  async function both(condition: unknown, variables: Record<string, unknown>) {
    const door = await answer(() =>
      stack.automation.evaluateCondition(condition as Parameters<VerifyStack['automation']['evaluateCondition']>[0], variables),
    );
    const direct = await answer(() => engine.evaluateCondition(condition, new Map(Object.entries(variables))));
    return { door, direct };
  }

  it('asks the booted automation service, with the condition as given and the variables as its Map, and answers its boolean', async () => {
    const spy = vi.spyOn(engine, 'evaluateCondition');
    const condition = { dialect: 'cel', source: MOVED_AND_LARGE };

    const verdict = await stack.automation.evaluateCondition(condition, movedLarge);

    expect(spy).toHaveBeenCalledTimes(1);
    const [given, variables] = spy.mock.calls[0];
    // The same envelope object, not a rebuilt one.
    expect(given).toBe(condition);
    expect(variables).toBeInstanceOf(Map);
    expect([...variables.entries()]).toEqual(Object.entries(movedLarge));
    expect(spy.mock.results[0]).toEqual({ type: 'return', value: true });
    expect(verdict).toBe(true);
  });

  it('answers the truth table over record-shaped variables: true and false, as the engine does', async () => {
    const condition = { dialect: 'cel', source: MOVED_AND_LARGE };
    const rows: Array<[Record<string, unknown>, boolean]> = [
      [movedLarge, true],
      // A pre-image the engine would have read as unchanged, and an amount under the bar.
      [unmoved, false],
      [small, false],
    ];
    for (const [variables, expected] of rows) {
      const { door, direct } = await both(condition, variables);
      expect(door).toEqual({ value: expected });
      expect(direct).toEqual({ value: expected });
    }
  });

  it('takes an envelope and a bare CEL string alike', async () => {
    for (const [variables, expected] of [[movedLarge, true], [unmoved, false]] as const) {
      expect(await stack.automation.evaluateCondition({ dialect: 'cel', source: MOVED_AND_LARGE }, variables)).toBe(expected);
      expect(await stack.automation.evaluateCondition(MOVED_AND_LARGE, variables)).toBe(expected);
    }
  });

  it('never rewrites the condition: a bare `{var}` string keeps the template dialect the engine gives it', async () => {
    const holed = '{amount} > 100';
    const spy = vi.spyOn(engine, 'evaluateCondition');

    // The engine reads a bare string with a `{…}` hole as the template dialect.
    expect(await stack.automation.evaluateCondition(holed, { amount: 5000 })).toBe(true);
    expect(spy.mock.calls[0][0]).toBe(holed);

    // The same text in a CEL envelope is the brace trap, and the engine refuses it.
    const { door, direct } = await both({ dialect: 'cel', source: holed }, { amount: 5000 });
    expect(direct.fault).toBeInstanceOf(Error);
    expect(door.fault).toBeInstanceOf(Error);
    expect((door.fault as Error).message).toBe((direct.fault as Error).message);
  });

  it("rejects with the engine's own error when the condition faults, never `false`", async () => {
    // A CEL parse error, and a reference to a variable the set does not bind.
    const faulting: Array<[unknown, Record<string, unknown>]> = [
      [{ dialect: 'cel', source: 'record.amount >=' }, movedLarge],
      [{ dialect: 'cel', source: 'record.amount >= 1000' }, {}],
    ];
    for (const [condition, variables] of faulting) {
      const { door, direct } = await both(condition, variables);
      expect(direct.fault).toBeInstanceOf(Error);
      expect(door.value).toBeUndefined();
      expect(door.fault).toBeInstanceOf(Error);
      // Handed back as the engine threw it: its message, and no refusal envelope added.
      expect((door.fault as Error).message).toBe((direct.fault as Error).message);
      expect(isVerifyRefusal(door.fault)).toBe(false);
      expect((door.fault as { code?: unknown }).code).toBeUndefined();
    }
  });

  it("rejects with the kernel's own SERVICE_NOT_REGISTERED error, naming 'automation', on a stack without the service", async () => {
    const kernelSaid = await answer(() => bare.kernel.getServiceAsync<Evaluator>('automation'));
    expect(isServiceNotRegisteredError(kernelSaid.fault)).toBe(true);

    const door = await answer(() => bare.automation.evaluateCondition({ dialect: 'cel', source: 'true' }, {}));
    expect(door.value).toBeUndefined();
    expect(isServiceNotRegisteredError(door.fault)).toBe(true);
    const fault = door.fault as Error & { code?: unknown; serviceName?: unknown };
    expect(fault.code).toBe(SERVICE_NOT_REGISTERED_CODE);
    expect(fault.serviceName).toBe('automation');
    expect(fault.message).toBe((kernelSaid.fault as Error).message);
  });
});
