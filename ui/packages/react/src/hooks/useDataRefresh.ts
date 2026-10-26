/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useEffect } from 'react';
import type { DataSource } from '@object-ui/types';

/**
 * Reusable hook that encapsulates the data-refresh pattern:
 *  1. A numeric `refreshKey` that triggers React effect re-runs when incremented.
 *  2. An imperative `refresh()` function to trigger a re-fetch on demand.
 *  3. Auto-subscription to `DataSource.onMutation()` — if the DataSource
 *     implements the optional mutation event bus, the hook auto-refreshes
 *     whenever a mutation occurs on the matching `objectName`.
 *
 * @param dataSource - The DataSource instance (may be undefined during initial render)
 * @param objectName - The resource/object name to watch for mutations
 * @returns `{ refreshKey, refresh }` — include `refreshKey` in your effect deps
 *
 * @example
 * ```tsx
 * const { refreshKey, refresh } = useDataRefresh(dataSource, schema.objectName);
 *
 * useEffect(() => {
 *   dataSource.find(objectName, params).then(setData);
 * }, [objectName, refreshKey]);
 *
 * // Or trigger manually:
 * <button onClick={refresh}>Refresh</button>
 * ```
 */
export function useDataRefresh(
  dataSource: DataSource | undefined,
  objectName: string | undefined,
): { refreshKey: number; refresh: () => void } {
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // Auto-subscribe to DataSource mutation events
  useEffect(() => {
    if (!dataSource?.onMutation || !objectName) return;
    const unsub = dataSource.onMutation((event) => {
      if (event.resource === objectName) {
        setRefreshKey(k => k + 1);
      }
    });
    return unsub;
  }, [dataSource, objectName]);

  return { refreshKey, refresh };
}
