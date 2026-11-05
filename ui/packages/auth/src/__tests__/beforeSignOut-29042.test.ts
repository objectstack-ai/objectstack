/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The steps `signOut()` awaits while the session still exists
 * (objectstack#29042): every one runs, none can hold the sign-out back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BEFORE_SIGN_OUT_TIMEOUT_MS,
  registerBeforeSignOut,
  resetBeforeSignOutForTests,
  runBeforeSignOut,
} from '../beforeSignOut';

beforeEach(() => {
  resetBeforeSignOutForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registerBeforeSignOut (objectstack#29042)', () => {
  it('runs every registered step and waits for them', async () => {
    const order: string[] = [];
    registerBeforeSignOut(async () => {
      await Promise.resolve();
      order.push('a');
    });
    registerBeforeSignOut(async () => {
      order.push('b');
    });
    await runBeforeSignOut();
    expect(order.sort()).toEqual(['a', 'b']);
  });

  it('a rejected step is reported and does not reject the run', async () => {
    const after = vi.fn(async () => {});
    registerBeforeSignOut(async () => {
      throw new Error('unregister failed');
    });
    registerBeforeSignOut(after);
    await expect(runBeforeSignOut()).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it('a step that never settles is cut off at the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    registerBeforeSignOut(() => new Promise(() => {}));
    let done = false;
    const run = runBeforeSignOut().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(BEFORE_SIGN_OUT_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(done).toBe(true);
  });

  it('a removed step no longer runs', async () => {
    const step = vi.fn(async () => {});
    const remove = registerBeforeSignOut(step);
    remove();
    await runBeforeSignOut();
    expect(step).not.toHaveBeenCalled();
  });
});
