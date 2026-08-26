// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12397] `Object.getOwnPropertyDescriptor(ctx.input, k)` reports what `data`
 * actually holds — it does not synthesise an answer.
 *
 * `installFlatInput` (`hook-wrappers.ts`) answered the descriptor trap for any
 * key `data` carries with a fixed literal:
 *
 * ```
 * { configurable: true, enumerable: true, writable: true, value: data[prop] }
 * ```
 *
 * For a key created by ordinary assignment that synthesis is the truth, which
 * is why it cost nothing for as long as assignment was the only way a key could
 * arrive. #12277 routed `defineProperty` into `data`, so a hook can now put a
 * key on the record payload with NON-DEFAULT attributes — and the synthesis
 * reports the defaults back regardless.
 *
 * ## The constraint that shapes the fix
 *
 * The proxy target is the `{ data, options, id? }` WRAPPER, which does not
 * carry the record key at all. A proxy may not report a property the target
 * does not have as non-configurable, so a naive mirror throws `TypeError` on
 * any key `data` holds as `configurable: false` — and, because `Object.keys`
 * walks `ownKeys` through this trap, it throws on plain enumeration too. The
 * mirror therefore FORCES `configurable: true` and mirrors the rest. Both legs
 * are pinned below: the forced one (`a data key held non-configurable`) and the
 * mirrored ones (`enumerable`, `writable`).
 *
 * ## What these cases deliberately do NOT pin
 *
 * Whether a record payload may carry an ACCESSOR at all — and what the engine
 * should do persisting one, since it persists a payload by evaluating it — is a
 * contract question about the payload, not about this trap. Nothing here widens
 * or narrows it: the accessor case below asserts only the two facts that hold
 * under every answer to it (the trap does not throw, and reading a descriptor
 * does not RUN the getter — the synthesis did, via `data[prop]`). Routing
 * (`defineProperty` → `data`) and persistence are untouched by this card.
 *
 * `wrapDeclarativeHook` is driven directly rather than through `ObjectQL`, for
 * the reason the sibling trap-set file (`hook-input-mutation-traps.test.ts`)
 * gives: the subject is the wrapper's Proxy, and a full engine dispatch would
 * put a driver's own copy semantics between the hook and the assertion.
 */

import { describe, it, expect } from 'vitest';
import { wrapDeclarativeHook } from './hook-wrappers.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Run `handler` as a declarative hook over a caller payload; return the row the engine keeps. */
async function runHook(
  data: Record<string, unknown>,
  handler: (input: any) => void,
): Promise<Record<string, unknown>> {
  const meta: any = { name: 'descriptor_probe', object: 'case', event: 'beforeInsert' };
  const wrapped = wrapDeclarativeHook(meta, (async (ctx: any) => handler(ctx.input)) as any, {
    logger: silentLogger,
  });
  const raw: any = { data, options: {} };
  await wrapped({ object: 'case', event: 'beforeInsert', input: raw } as any);
  return raw.data as Record<string, unknown>;
}

describe('[#12397] the flat-input descriptor trap mirrors `data` instead of synthesising', () => {
  it('REPRODUCTION — a key defined non-enumerable reports non-enumerable', async () => {
    // The card's repro, verbatim. Pre-fix this reported `enumerable: true`
    // for a key that is not enumerable — and `Object.keys` agreed with the
    // truth, not with the descriptor, so the two instruments an author has
    // contradicted each other.
    const seen: Record<string, unknown> = {};
    const persisted = await runHook({ subject: 'help' }, (input) => {
      Object.defineProperty(input, 'k', { value: 1, enumerable: false, configurable: true });
      seen.descriptor = Object.getOwnPropertyDescriptor(input, 'k');
      seen.objectKeys = Object.keys(input);
      seen.read = input.k;
    });

    expect(seen.descriptor).toEqual({
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    // The conjunction: the descriptor the author reads agrees with the row the
    // engine is left holding. Asserting either alone would pass on a proxy
    // whose two halves disagree, which is the defect itself.
    expect(Object.getOwnPropertyDescriptor(persisted, 'k')).toEqual({
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    expect(seen.objectKeys).toEqual(['subject']);
    expect(seen.read).toBe(1);
  });

  it('`writable: false` is reported as such — the descriptor agrees with what assignment does', async () => {
    // The instrument and the operation used to disagree in the loudest possible
    // way: the descriptor advertised `writable: true` while the very next
    // assignment threw, because the `set` trap writes into `data` from strict
    // module code.
    const seen: Record<string, unknown> = {};
    await runHook({ subject: 'help' }, (input) => {
      Object.defineProperty(input, 'frozen_key', {
        value: 'V',
        enumerable: true,
        writable: false,
        configurable: true,
      });
      seen.descriptor = Object.getOwnPropertyDescriptor(input, 'frozen_key');
      try {
        input.frozen_key = 'REASSIGNED';
        seen.assignmentThrew = false;
      } catch (err) {
        seen.assignmentThrew = true;
        seen.assignmentError = (err as Error).constructor.name;
      }
      seen.afterAssign = input.frozen_key;
    });

    expect(seen.descriptor).toEqual({
      value: 'V',
      writable: false,
      enumerable: true,
      configurable: true,
    });
    expect(seen.assignmentThrew).toBe(true);
    expect(seen.assignmentError).toBe('TypeError');
    expect(seen.afterAssign).toBe('V');
  });

  it('INVARIANT — a data key held non-configurable is reported configurable, and does not throw', async () => {
    // The reason the mirror cannot be naive. The proxy target is the wrapper,
    // which does not carry `locked`; reporting a target-absent property as
    // non-configurable is a proxy invariant violation, so mirroring
    // `configurable` verbatim throws `TypeError` here — and takes
    // `Object.keys`/spread down with it, since those reach every listed key
    // through this same trap.
    const data: Record<string, unknown> = { subject: 'help' };
    Object.defineProperty(data, 'locked', {
      value: 'L',
      enumerable: true,
      writable: false,
      configurable: false,
    });

    const seen: Record<string, unknown> = {};
    await runHook(data, (input) => {
      seen.descriptor = Object.getOwnPropertyDescriptor(input, 'locked');
      seen.objectKeys = Object.keys(input);
      seen.spread = { ...input };
      // `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`: this
      // package's programs run against `lib: ES2020` (see the workspace
      // tsconfig), where the ES2022 spelling is a type error — and this file is
      // read by the TEST_DEBT re-measure program, whose count is a ratchet.
      seen.hasOwn = Object.prototype.hasOwnProperty.call(input, 'locked');
    });

    // `configurable` is FORCED, `enumerable`/`writable` are MIRRORED. That is
    // the whole contract of this trap in one assertion.
    expect(seen.descriptor).toEqual({
      value: 'L',
      writable: false,
      enumerable: true,
      configurable: true,
    });
    expect(seen.objectKeys).toEqual(['subject', 'locked']);
    expect(seen.spread).toEqual({ subject: 'help', locked: 'L' });
    expect(seen.hasOwn).toBe(true);
  });

  it('POSITIVE CONTROL — an ordinary assigned key still reads back as a plain data descriptor', async () => {
    // Every existing consumer sees this shape and must keep seeing it: the
    // mirror is only visible on keys that were not created by assignment.
    const seen: Record<string, unknown> = {};
    await runHook({ subject: 'help' }, (input) => {
      input.owner_id = 'U1';
      seen.assigned = Object.getOwnPropertyDescriptor(input, 'owner_id');
      seen.caller = Object.getOwnPropertyDescriptor(input, 'subject');
    });
    expect(seen.assigned).toEqual({
      value: 'U1',
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(seen.caller).toEqual({
      value: 'help',
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  it('an INHERITED key has no own descriptor to mirror, and no longer gets a fabricated one', async () => {
    // `prop in data` is true for the whole prototype chain, so the synthesis
    // answered `Object.getOwnPropertyDescriptor(input, 'toString')` with an own,
    // enumerable, writable data property that no payload has ever held. `in`
    // stays true (inherited keys ARE `in` the object) and the read still
    // resolves up the chain — only the own-ness claim changes.
    const seen: Record<string, unknown> = {};
    await runHook({ subject: 'help' }, (input) => {
      seen.descriptor = Object.getOwnPropertyDescriptor(input, 'toString');
      seen.hasOwn = Object.prototype.hasOwnProperty.call(input, 'toString');
      seen.inOperator = 'toString' in input;
      seen.readable = typeof input.toString;
    });
    expect(seen.descriptor).toBeUndefined();
    expect(seen.hasOwn).toBe(false);
    expect(seen.inOperator).toBe(true);
    expect(seen.readable).toBe('function');
  });

  it('an accessor on the payload: the trap neither throws nor RUNS the getter', async () => {
    // Deliberately narrow — see the file header. Whether a record payload may
    // carry an accessor at all is a contract question this card does not
    // answer, so this pins only what is true under either answer. The second
    // half is a property the synthesis did NOT have: it read `data[prop]` to
    // fill `value`, so merely asking for a descriptor invoked author code.
    let getterCalls = 0;
    const data: Record<string, unknown> = { subject: 'help' };
    Object.defineProperty(data, 'derived', {
      get() {
        getterCalls += 1;
        return 'COMPUTED';
      },
      enumerable: true,
      configurable: true,
    });

    const seen: Record<string, unknown> = {};
    await runHook(data, (input) => {
      seen.descriptorRead = () => Object.getOwnPropertyDescriptor(input, 'derived');
      seen.callsAfterDescriptor = ((): number => {
        Object.getOwnPropertyDescriptor(input, 'derived');
        return getterCalls;
      })();
    });

    expect(seen.callsAfterDescriptor).toBe(0);
  });
});
