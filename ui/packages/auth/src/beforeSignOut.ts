/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Steps that must run under the session that is about to end.
 *
 * Some cleanup can only happen while the session still exists: once
 * `signOut()` has ended it, the server answers every request 401. Unregistering
 * this device's push token is the case in point: left registered, a
 * signed-out device keeps receiving the person's pushes. A caller registers
 * such a step with `registerBeforeSignOut`, and `AuthProvider`'s `signOut()`
 * awaits every registered step before it ends the session.
 *
 * A step never holds sign-out back: the steps run together, a rejection is
 * reported and dropped, and sign-out goes ahead after
 * `BEFORE_SIGN_OUT_TIMEOUT_MS` whether or not they have settled.
 */

/** The longest `signOut()` waits for the registered steps, in milliseconds. */
export const BEFORE_SIGN_OUT_TIMEOUT_MS = 3000;

type BeforeSignOutStep = () => Promise<unknown>;

const steps = new Set<BeforeSignOutStep>();

/**
 * Run `step` under the current session each time `signOut()` is called, before
 * the session ends. Returns the function that removes it again.
 */
export function registerBeforeSignOut(step: BeforeSignOutStep): () => void {
  steps.add(step);
  return () => {
    steps.delete(step);
  };
}

/**
 * Run every registered step and settle once all have settled or `timeoutMs`
 * has passed. Never rejects.
 */
export async function runBeforeSignOut(timeoutMs: number = BEFORE_SIGN_OUT_TIMEOUT_MS): Promise<void> {
  if (steps.size === 0) return;
  const settled = Promise.allSettled(
    Array.from(steps, (step) =>
      Promise.resolve()
        .then(step)
        .catch((error: unknown) => {
          console.warn('[auth] a step registered to run before sign-out failed; signing out anyway', error);
        }),
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[auth] the steps registered to run before sign-out did not settle within ${timeoutMs} ms; signing out anyway`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: forget every registered step. Not exported from the package entry. */
export function resetBeforeSignOutForTests(): void {
  steps.clear();
}
