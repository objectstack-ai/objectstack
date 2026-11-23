/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// JSX-free on purpose: this module is on the package's eager line, and every
// lazily loaded field widget reaches its chunk through it (objectstack#36608).
import React from 'react';

/** What `React.lazy` takes: a dynamic import of a module whose `default` is the component. */
export type LazyWidgetLoader<C extends React.ComponentType<any>> = () => Promise<{ default: C }>;

/** One request for the chunk, shared by every mount that asks while it stands. */
interface LoadAttempt {
  readonly Lazy: React.ComponentType<any>;
  /** Set once a failure of this request has been shown; the next mount asks again. */
  retired: boolean;
}

/**
 * `React.lazy`, except that a failed load is not kept for the rest of the
 * session (objectstack#36608).
 *
 * A `React.lazy` component caches its first import promise, a rejection
 * included: once the chunk fails to load (a deploy that replaced it, a dropped
 * connection), every later mount rethrows that failure until the page is
 * reloaded. Here each MOUNT picks the current request when it is first
 * created, and a failure retires that request, so a later mount (an error
 * boundary's reset, a reopened form, a revisited page) loads the chunk again.
 *
 * - Loading and loaded behave as `React.lazy` does: the mount suspends to the
 *   host's nearest `Suspense` boundary while the chunk loads, and a mount after
 *   it has loaded renders in the same pass. Every mount shares one request.
 * - A failed load resolves to a stand-in that COMMITS once, rendering nothing,
 *   and then throws the failure to the nearest error boundary. Committing first
 *   is what makes the retry safe: a mount that never committed keeps no state,
 *   so React's own re-render of it (after the promise settles, or its one
 *   synchronous retry of an errored render) would otherwise pick a fresh
 *   request and suspend again, hiding the failure behind a loading face and
 *   asking the network in a loop. The committed mount holds on to the failed
 *   request, so it rethrows the same failure for as long as it is re-rendered;
 *   only a NEW mount asks again.
 *
 * Call it at module scope (or once per registration), never during render:
 * each call is its own cache, as each `React.lazy` call is.
 */
export function recoverableLazy<C extends React.ComponentType<any>>(
  loader: LazyWidgetLoader<C>,
): React.ComponentType<React.ComponentProps<C>> {
  let current: LoadAttempt | undefined;

  const currentAttempt = (): LoadAttempt => {
    if (!current || current.retired) {
      const attempt: { Lazy?: React.ComponentType<any>; retired: boolean } = { retired: false };
      attempt.Lazy = React.lazy<React.ComponentType<any>>(() =>
        loader().then(
          (loaded) => loaded,
          (error: unknown) => ({ default: failedLoad(attempt as LoadAttempt, error) }),
        ),
      );
      current = attempt as LoadAttempt;
    }
    return current;
  };

  function RecoverableLazy(props: React.ComponentProps<C>): React.ReactElement {
    // Picked once per mount: the mount that saw a failure keeps rethrowing it
    // rather than asking the network again on every re-render.
    const [attempt] = React.useState(currentAttempt);
    return React.createElement(attempt.Lazy, props);
  }
  return RecoverableLazy;
}

/**
 * The stand-in a failed load resolves to: commits once (nothing drawn), retires
 * the request so the next mount asks again, then throws the failure from its
 * next render to the nearest error boundary.
 */
function failedLoad(attempt: LoadAttempt, error: unknown): React.ComponentType<any> {
  return function FailedLazyLoad(): null {
    const [committed, setCommitted] = React.useState(false);
    React.useEffect(() => {
      attempt.retired = true;
      setCommitted(true);
    }, []);
    if (committed) throw error;
    return null;
  };
}
