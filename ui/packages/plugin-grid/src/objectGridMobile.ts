/**
 * The mobile affordances of `ObjectGrid` (`./ObjectGrid.tsx`): pull to
 * refresh and the card-view breakpoint effect, moved out of the component
 * verbatim (objectstack#25994, slice 7). The refresh key and the card-view
 * flag stay component state; their setters are passed in.
 */

import React, { useEffect, useCallback } from 'react';
import type { ObjectGridSchema, DataSource } from '@object-ui/types';
import { usePullToRefresh } from '@object-ui/mobile';

/**
 * Wires `ObjectGrid`'s pull to refresh and its card-view breakpoint. Returns
 * what the grid's scroll container reads. `ObjectGrid` calls it where these
 * lines used to stand, so the order of the component's hooks does not change.
 */
export function useObjectGridMobile({
  schema, dataSource, setRefreshKey, setUseCardView,
}: {
  schema: ObjectGridSchema;
  dataSource: DataSource | undefined;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  setUseCardView: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const handlePullRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1);
  }, []);

  const { ref: pullRef, isRefreshing, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handlePullRefresh,
    enabled: !!dataSource && !!schema.objectName,
  });

  // Activate the mobile card view below the 768px app mobile breakpoint so
  // phones and tablet-portrait never need to side-scroll a wide grid.
  useEffect(() => {
    const checkWidth = () => setUseCardView(window.innerWidth < 768);
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  return { pullRef, isRefreshing, pullDistance };
}
