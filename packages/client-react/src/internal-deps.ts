// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dependency-array primitives (#4693, #4694) — internal, not exported from the
 * package entry point.
 *
 * Every fetch and subscription hook here keys a `useCallback`/`useEffect` on
 * values the caller supplies inline: `where` / `fields` / `orderBy` objects,
 * `onSuccess` / `onError` handlers, the `fetcher` `useMetadata` takes as a
 * required argument. Inline means a fresh identity on every render, so the
 * effect re-ran on every render — and for the fetch hooks that effect calls
 * `setState`, which renders again. Five hooks were in an unbounded request
 * loop under their own documented usage.
 *
 * The two helpers below fix the two halves of that:
 *
 *  - {@link stableKey} turns a structural value into a dependency that changes
 *    when the *value* changes rather than when the object is rebuilt;
 *  - {@link useEventCallback} gives a caller's handler a fixed identity, so
 *    passing it inline no longer re-runs anything.
 *
 * Neither is a substitute for the caller memoizing — they remove the need to.
 * Correctness must not rest on every call site remembering `useMemo`, least of
 * all when the TSDoc examples themselves pass object literals.
 */

import { useCallback, useEffect, useRef } from 'react';

/**
 * Order-independent stringify, used to derive a dependency from a structural
 * value. Object keys are sorted so `{ a, b }` and `{ b, a }` agree; array order
 * is preserved because it is semantic (`orderBy: ['-created_at', 'name']`).
 *
 * Mirrors the same helper in `service-settings` and `service-automation` — kept
 * local for the same reason they are: it is three lines and a shared util
 * package would be a heavier dependency than the code it carries.
 *
 * Values JSON cannot represent (functions, symbols) collapse to `undefined`
 * here. That is correct for this use: a handler's identity must not drive a
 * refetch, which is exactly what {@link useEventCallback} is for.
 */
export function stableKey(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'undefined';
  if (Array.isArray(input)) return '[' + input.map(stableKey).join(',') + ']';
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableKey(obj[k])).join(',') + '}';
}

/**
 * Wraps a caller-supplied handler in a function whose identity never changes,
 * while always invoking the most recent version.
 *
 * This is what lets the fetch and subscription effects drop `onSuccess` /
 * `onError` / `callback` from their dependency arrays. Those handlers say what
 * to do when something happens; they are not part of *what is subscribed to* or
 * *what is fetched*, so they have no business re-running an effect.
 *
 * The ref is updated in an effect rather than during render: a render may be
 * thrown away under concurrent rendering, and writing through a ref then would
 * publish a handler from a render that never committed.
 *
 * Returns `undefined` from the call when no handler was supplied, so optional
 * handlers need no call-site guard.
 */
export function useEventCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined
): (...args: A) => R | undefined {
  const ref = useRef(fn);

  useEffect(() => {
    ref.current = fn;
  }, [fn]);

  return useCallback((...args: A) => ref.current?.(...args), []);
}
