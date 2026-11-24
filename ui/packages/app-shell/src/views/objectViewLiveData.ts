/**
 * Live data of the Console `ObjectView` (`./ObjectView.tsx`): the realtime
 * subscription that refreshes the list when the server reports a change and the
 * reconnection conflict resolution, moved out of `ObjectViewInner` verbatim
 * (objectstack#25992, slice 4); every input is passed in.
 *
 * objectstack#34207 — this hook used to also send a `$top: 0` count probe on
 * every mount and every `refreshKey` bump, beside the list's own read, for a
 * page-level `recordCount`. Nothing drew that number any more: the split
 * pane's footer it fed was retired (objectstack#28915), and the one prop it
 * still reached, `ViewConfigPanel`'s `recordCount`, is never read there. The
 * counts the page does draw — `ListView`'s record-count bar and the title's
 * view count — come from the list's own answer (`total`), the query that
 * carries the view's filters and search. So the probe is gone rather than
 * repointed: a list page load sends one `data/OBJECT` read.
 */

import { useEffect } from 'react';
import { useRealtimeSubscription, useConflictResolution } from '@object-ui/collaboration';

export function useObjectViewLiveData({ objectDef, refreshData }: {
    objectDef: { name: string };
    refreshData: () => void;
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
}
