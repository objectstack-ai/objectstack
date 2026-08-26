// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12277] Every mutation JS offers on `ctx.input` lands in the row the engine
 * persists — not just assignment.
 *
 * `installFlatInput` (`hook-wrappers.ts`) hands a declarative hook a flat-record
 * Proxy over the engine's `{ data, options, id? }` wrapper. It trapped `set`
 * but not `deleteProperty` or `defineProperty`, so those two fell through to
 * `Reflect.*` on the WRAPPER — one level above `data` — and changed a key that
 * was never there, on an object the engine does not read.
 *
 * ## What each assertion is worth, and why the two gaps are not the same shape
 *
 * The measurement that produced this file (pre-fix, one hook call):
 *
 * ```
 *                                     delete       Object.defineProperty
 * operation's own result           →  true         (no throw)
 * `k in input`                     →  true         —
 * `input.k`                        →  CALLER-VALUE DEFINED        ← agrees!
 * `Object.keys(input)`             →  includes k   excludes k
 * what the engine persisted        →  CALLER-VALUE absent
 * ```
 *
 * `delete`'s lie was confined to its own return value: the three other
 * read-backs stayed honest and reported the key still present. That is a
 * silent no-op, and it is what the card reported.
 *
 * `Object.defineProperty` — which no one reported — is the strictly worse
 * shape, and the reason this file pins BOTH: the `get` trap's fall-through to
 * the wrapper read the value straight back, so `input.k` CONFIRMED a write
 * that never reached `data`. A read-back that corroborates a write that did
 * not happen leaves an author no instrument to catch it with.
 *
 * So every case below asserts the CONJUNCTION — what the hook observes AND
 * what the engine is left holding — rather than either alone. Asserting only
 * the stored row would pass on an engine whose read-backs lie in the other
 * direction; asserting only the read-backs is what shipped the defect.
 *
 * The `assign-then-delete` case is the DISCRIMINATOR carried over from the
 * report: a `{...callerData, ...hookInput}` merge upstream would produce the
 * same symptoms as a missing trap, and it would restore the CALLER's value.
 * Seeing the hook's own assigned value survive a delete rules the merge out —
 * and post-fix, seeing the key vanish entirely rules out a merge just as
 * firmly, from the other side.
 *
 * `wrapDeclarativeHook` is driven directly rather than through `ObjectQL`: the
 * defect is in the wrapper's Proxy, and a full engine dispatch would put a
 * driver's own copy semantics between the hook and the assertion.
 */

import { describe, it, expect } from 'vitest';
import { wrapDeclarativeHook } from './hook-wrappers.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Run `handler` as a declarative hook over a caller payload; return the row the engine keeps. */
async function runHook(
  data: Record<string, unknown>,
  handler: (input: any) => void,
): Promise<Record<string, unknown>> {
  const meta: any = { name: 'trap_probe', object: 'case', event: 'beforeInsert' };
  const wrapped = wrapDeclarativeHook(meta, (async (ctx: any) => handler(ctx.input)) as any, {
    logger: silentLogger,
  });
  const raw: any = { data, options: {} };
  await wrapped({ object: 'case', event: 'beforeInsert', input: raw } as any);
  return raw.data as Record<string, unknown>;
}

describe('[#12277] `delete ctx.input.x` removes the field from the persisted row', () => {
  it('the hook read-backs and the stored row agree that the key is gone', async () => {
    const seen: Record<string, unknown> = {};
    const persisted = await runHook(
      { subject: 'help', owner_id: 'CALLER-VALUE' },
      (input) => {
        seen.deleteReturned = delete input.owner_id;
        seen.inOperator = 'owner_id' in input;
        seen.propertyRead = input.owner_id;
        seen.objectKeys = Object.keys(input);
        seen.spread = { ...input };
        seen.descriptor = Object.getOwnPropertyDescriptor(input, 'owner_id');
      },
    );

    // What the author observes. Pre-fix, only the first of these was `true`
    // and every other line reported the key still present.
    expect(seen.deleteReturned).toBe(true);
    expect(seen.inOperator).toBe(false);
    expect(seen.propertyRead).toBeUndefined();
    expect(seen.objectKeys).toEqual(['subject']);
    expect(seen.spread).toEqual({ subject: 'help' });
    expect(seen.descriptor).toBeUndefined();

    // …and what the engine is left holding. This is the half the author cannot
    // reach from inside the hook, and the half the defect falsified.
    expect(persisted).toEqual({ subject: 'help' });
  });

  it('POSITIVE CONTROL — an assignment in the same call still lands', async () => {
    // Without this, every assertion above would also pass against a wrapper
    // that had stopped writing anything through to `data` at all.
    const persisted = await runHook({ subject: 'help', owner_id: 'CALLER-VALUE' }, (input) => {
      input.subject = 'HELP';
      delete input.owner_id;
    });
    expect(persisted).toEqual({ subject: 'HELP' });
  });

  it('DISCRIMINATOR — assign-then-delete leaves no key, not the caller value', async () => {
    // A `{...callerData, ...hookInput}` merge would answer `CALLER-NOTE` here.
    const seen: Record<string, unknown> = {};
    const persisted = await runHook({ note: 'CALLER-NOTE' }, (input) => {
      input.note = 'ASSIGNED-THEN-DELETED';
      seen.afterAssign = input.note;
      delete input.note;
      seen.afterDelete = input.note;
    });
    expect(seen.afterAssign).toBe('ASSIGNED-THEN-DELETED');
    expect(seen.afterDelete).toBeUndefined();
    expect(persisted).toEqual({});
  });

  it('deleting a key that was never in the payload is a no-op that reports success', async () => {
    const persisted = await runHook({ subject: 'help' }, (input) => {
      expect(delete input.never_here).toBe(true);
    });
    expect(persisted).toEqual({ subject: 'help' });
  });

  it('the operation envelope is addressed separately from the record fields', async () => {
    // `id`/`options`/`ast`/`data` are wrapper keys on every other trap, and
    // `deleteProperty` routes them the same way — a hook deleting `options`
    // must not punch a hole in a record field that happens to share the name.
    const meta: any = { name: 'envelope', object: 'case', event: 'beforeUpdate' };
    const wrapped = wrapDeclarativeHook(meta, (async (ctx: any) => {
      delete ctx.input.options;
    }) as any, { logger: silentLogger });
    const raw: any = { id: 'r1', data: { options: 'A RECORD FIELD CALLED OPTIONS' }, options: { multi: true } };
    await wrapped({ object: 'case', event: 'beforeUpdate', input: raw } as any);
    expect('options' in raw).toBe(false);
    expect(raw.data).toEqual({ options: 'A RECORD FIELD CALLED OPTIONS' });
  });
});

describe('[#12277] `Object.defineProperty(ctx.input, …)` lands in the persisted row', () => {
  it('the confirming read-back is now telling the truth', async () => {
    // The pre-fix failure this case exists for: `input.defined_key` read back
    // `DEFINED` while `data` never received it, so the instrument an author
    // would reach for to check AGREED with a write that did not happen.
    const seen: Record<string, unknown> = {};
    const persisted = await runHook({ subject: 'help' }, (input) => {
      Object.defineProperty(input, 'defined_key', {
        value: 'DEFINED',
        enumerable: true,
        writable: true,
        configurable: true,
      });
      seen.propertyRead = input.defined_key;
      seen.inKeys = Object.keys(input).includes('defined_key');
    });
    expect(seen.propertyRead).toBe('DEFINED');
    expect(seen.inKeys).toBe(true);
    expect(persisted).toEqual({ subject: 'help', defined_key: 'DEFINED' });
  });
});
