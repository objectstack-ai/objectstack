// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6832] `hook.retryPolicy` has ONE answer per key, whether or not the metadata
 * has been through `HookSchema`.
 *
 * `packages/spec/src/data/hook.zod.ts` declares `maxRetries: .default(3)` and
 * `backoffMs: .default(1000)`. `wrapDeclarativeHook` read both with `?? 0`. So
 * "how many times does an under-specified hook retry?" had two answers, and the
 * winner depended on the path: `defineStack` / `PUT /meta` / Studio parse through
 * `HookSchema` and got 3, while the public `wrapDeclarativeHook` export — and
 * `hook-binder.ts:221`, which calls it with unparsed `Hook` metadata — got 0.
 * The generated reference page, the Studio form and the schema all promised a
 * retry that the executor silently did not perform: no error, no log line, no
 * red test, just the recovery the author thought they had configured, gone.
 *
 * That is the shape #4247 removed from flow `errorHandling` (`flow.zod.ts:651`,
 * "one contract, one number") with the numbers swapped, and the ADR-0049
 * declared-＝-enforced case for closing it.
 *
 * The boundary this file exists to pin — because the obvious fix breaks it:
 * `retryPolicy` is `.optional()` with no `.default({})`, so an ABSENT block and
 * an EMPTY one are different declarations. A bare `?? 3` would "fix" the
 * divergence by giving every hook that never wrote a `retryPolicy` three retries
 * it never asked for — a behaviour change for every existing author, worse than
 * the defect. Absent stays 0.
 *
 *   1. block absent          → 1 attempt, no retry          (unchanged, and correct)
 *   2. block present, empty  → schema's 3 retries / 1000ms  (was 1 attempt)
 *   3. block half-filled     → written key wins, omitted key takes the default
 *   4. parsed ≡ unparsed     → the two paths agree, per key
 */

import { describe, it, expect, vi } from 'vitest';
import { wrapDeclarativeHook } from './hook-wrappers.js';
import { HookSchema } from '@objectstack/spec/data';
import type { Hook, HookContext } from '@objectstack/spec/data';

const taskObject = { name: 'retry_task', label: 'Task', fields: {} };
const qlStub = { getObject: (n: string) => (n === 'retry_task' ? taskObject : undefined) };

function makeCtx(): HookContext {
  return {
    object: 'retry_task',
    event: 'beforeInsert',
    input: { data: { title: 'x' } },
    ql: qlStub,
  } as unknown as HookContext;
}

/**
 * Run an always-failing hook through the declarative wrapper and report how many
 * times the handler was entered. `attempts === 1 + maxRetries`.
 *
 * `retryPolicy` is spread in only when supplied, so "absent" really is an absent
 * key and not `retryPolicy: undefined`.
 */
async function attemptsFor(retryPolicy?: Hook['retryPolicy']): Promise<number> {
  let attempts = 0;
  const handler = async () => {
    attempts += 1;
    throw new Error('always fails');
  };
  const meta = {
    name: 'h_retry',
    object: 'retry_task',
    events: ['beforeInsert'],
    handler,
    ...(retryPolicy === undefined ? {} : { retryPolicy }),
  } as unknown as Hook;

  const wrapped = wrapDeclarativeHook(meta, handler, { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
  await expect(wrapped(makeCtx())).rejects.toThrow('always fails');
  return attempts;
}

/** The declared defaults, read from the schema so this file restates nothing either. */
function declared(): { maxRetries: number; backoffMs: number } {
  return HookSchema.shape.retryPolicy.unwrap().parse({});
}

/**
 * Run `fn` with `setTimeout` firing synchronously, and return every delay it was
 * asked for. The retry loop's only use of the clock is the backoff sleep, so the
 * recorded delays ARE the backoff schedule — read without waiting for it.
 */
async function recordingBackoff(fn: () => Promise<void>): Promise<number[]> {
  const slept: number[] = [];
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
    slept.push(ms ?? 0);
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return slept;
}

describe('#6832 — hook.retryPolicy defaults agree across the parsed and unparsed paths', () => {
  it('the schema still declares the numbers this file is about', () => {
    // If these ever change, the expectations below follow them rather than
    // drifting: every assertion reads `declared()`. This one exists so a
    // deliberate change to the published contract is visible in the diff.
    expect(declared()).toEqual({ maxRetries: 3, backoffMs: 1000 });
  });

  describe('case 1 — the block is absent: no policy declared, so no retry', () => {
    it('does not retry, and does NOT pick up the per-key defaults', async () => {
      expect(await attemptsFor(undefined)).toBe(1);
    });

    it('agrees with the parsed path, which leaves retryPolicy undefined', () => {
      const parsed = HookSchema.parse({
        name: 'h_retry', object: 'retry_task', events: ['beforeInsert'], handler: async () => {},
      });
      expect(parsed.retryPolicy).toBeUndefined();
    });
  });

  describe('case 2 — the block is present but empty: both keys take the declared default', () => {
    it('retries `maxRetries` times', async () => {
      let attempts = 0;
      await recordingBackoff(async () => { attempts = await attemptsFor({}); });
      expect(attempts).toBe(1 + declared().maxRetries);
    });

    it('waits the declared backoff between attempts (linear: backoffMs * attempt)', async () => {
      const slept = await recordingBackoff(async () => { await attemptsFor({}); });
      const base = declared().backoffMs;
      // Three retries after a failed first attempt; the backoff is linear
      // (`retryBackoffMs * attempt`), which matches the declared shape — there
      // is no multiplier or jitter key on `hook.retryPolicy`.
      expect(slept).toEqual([base * 1, base * 2, base * 3]);
    });
  });

  describe('case 3 — the block is half-filled: written key wins, omitted key defaults', () => {
    it('an omitted `maxRetries` takes the declared count even when `backoffMs` is written', async () => {
      expect(await attemptsFor({ backoffMs: 0 })).toBe(1 + declared().maxRetries);
    });

    it('an omitted `backoffMs` takes the declared delay even when `maxRetries` is written', async () => {
      let attempts = 0;
      const slept = await recordingBackoff(async () => { attempts = await attemptsFor({ maxRetries: 1 }); });
      expect(attempts).toBe(2);
      expect(slept).toEqual([declared().backoffMs]);
    });

    it('a written value still wins outright, including an explicit 0', async () => {
      expect(await attemptsFor({ maxRetries: 0, backoffMs: 0 })).toBe(1);
      expect(await attemptsFor({ maxRetries: 2, backoffMs: 0 })).toBe(3);
    });
  });

  describe('case 4 — the two paths answer identically, which is the whole point', () => {
    for (const [label, policy] of [
      ['absent', undefined],
      ['empty', {}],
      ['half-filled (backoffMs only)', { backoffMs: 0 }],
      ['half-filled (maxRetries only)', { maxRetries: 1 }],
      ['fully written', { maxRetries: 2, backoffMs: 0 }],
    ] as const) {
      it(`${label}: unparsed metadata retries as often as the same metadata parsed`, async () => {
        const parsed = HookSchema.parse({
          name: 'h_retry',
          object: 'retry_task',
          events: ['beforeInsert'],
          handler: async () => {},
          ...(policy === undefined ? {} : { retryPolicy: policy }),
        });
        const parsedMax = parsed.retryPolicy?.maxRetries ?? 0;

        let attempts = 0;
        await recordingBackoff(async () => { attempts = await attemptsFor(policy); });
        expect(attempts).toBe(1 + parsedMax);
      });
    }
  });
});
