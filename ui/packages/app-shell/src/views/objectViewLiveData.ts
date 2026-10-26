/**
 * Live data of the Console `ObjectView` (`./ObjectView.tsx`): the realtime
 * subscription that refreshes the list when the server reports a change, the
 * reconnection conflict resolution, and the footer's record-count fetch, moved
 * out of `ObjectViewInner` verbatim (objectstack#25992, slice 4). The record
 * count state stays in the component; it and every other input are passed in.
 */

import { useEffect } from 'react';
import type { DataSource } from '@object-ui/types';
import { useRealtimeSubscription, useConflictResolution } from '@object-ui/collaboration';

export function useObjectViewLiveData({ dataSource, objectDef, refreshData, refreshKey, setRecordCount }: {
    dataSource: DataSource;
    objectDef: { name: string };
    refreshData: () => void;
    refreshKey: number;
    setRecordCount: (count: number) => void;
}) {
    // Real-time: auto-refresh when server reports data changes
    const { lastMessage: realtimeMessage } = useRealtimeSubscription({
        channel: `object:${objectDef.name}`,
    });

    // Conflict resolution: detect and queue conflicts on reconnection
    const conflictUserId = objectDef.name ? `user-${objectDef.name}` : 'current-user';
    const { hasConflicts, resolveAllConflicts } = useConflictResolution(conflictUserId);

    useEffect(() => {
        if (realtimeMessage) {
            // On reconnection data change, auto-resolve with server-wins strategy
            if (hasConflicts) {
                resolveAllConflicts('remote');
            }
            refreshData();
        }
    }, [realtimeMessage, hasConflicts, resolveAllConflicts, refreshData]);
    
    // Fetch record count for footer display.
    //
    // `$top: 0` IS the request: give me the total, send no rows. It was written
    // `limit: 0`, which is not a `QueryParams` key — `convertQueryParams` copies
    // exactly the `$`-prefixed keys the type declares — so the cap reached no
    // branch and was dropped, and the platform's GET list route has no default
    // page size. The effect therefore did the opposite of what it says: it
    // downloaded EVERY row of the object, on every mount and every refresh of
    // every list view, to read one integer off the envelope. The dead spelling
    // type-checked because `QueryParams` then carried `[key: string]: any` for
    // adapter-specific params; `object-ui/no-unprefixed-query-params` rejects it
    // at write time now (objectui#5458), and the index signature itself is gone
    // (objectui#7497), so `tsc` refuses it as well.
    //
    // `total` is the only field that can still answer the question, so the
    // row-counting fallbacks are gone rather than repointed. Once we ask for
    // zero rows an empty `data` means "you asked for none", not "the object is
    // empty" — counting the response would report a confident `0` for any
    // adapter that does not send a total. Leaving `recordCount` `undefined`
    // omits the footer line instead of asserting a wrong number; the render is
    // already guarded by `typeof recordCount === 'number'`.
    useEffect(() => {
        if (dataSource?.find && objectDef.name) {
            dataSource.find(objectDef.name, { $top: 0 }).then((result: any) => {
                if (typeof result?.total === 'number') {
                    setRecordCount(result.total);
                }
            }).catch(() => {
                // Silently ignore — record count is non-critical
            });
        }
    }, [dataSource, objectDef.name, refreshKey]);
}
