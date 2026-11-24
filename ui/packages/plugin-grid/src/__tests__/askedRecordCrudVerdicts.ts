/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useRecordCrudVerdicts` as a list whose row actions have been reached for.
 *
 * The hook asks the explain engine nothing until a row-action surface calls
 * `requestVerdicts` (objectstack#34208): the first paint of a list sends no
 * explain request. The suites that pin what the hook does ONCE it asks — the
 * batching, the cap, the cache, the re-checks after a change, the principal
 * scope — render it through this, which asks on mount, so each of them keeps
 * pinning the behaviour it was written for. What the hook does BEFORE anyone
 * asks is pinned where the asking happens: `rowRecordCrudVerdict.test.tsx`.
 */
import * as React from 'react';
import { useRecordCrudVerdicts } from '../hooks/useRecordCrudVerdicts';

export function useAskedRecordCrudVerdicts(
  opts: Parameters<typeof useRecordCrudVerdicts>[0],
): ReturnType<typeof useRecordCrudVerdicts> {
  const verdicts = useRecordCrudVerdicts(opts);
  const { requestVerdicts } = verdicts;
  // A repeat call is free, so a new callback identity costs nothing here.
  React.useEffect(() => {
    requestVerdicts();
  }, [requestVerdicts]);
  return verdicts;
}
