/**
 * The record pane of the Console `ObjectView` (`./ObjectView.tsx`), and the
 * list it opens records from (objectstack#25992 slice 10; objectstack#27545).
 *
 * One `NavigationOverlay` draws both: the list in the same place whether or
 * not a record is open — and whatever the object declares, so a view switch
 * never remounts it — and the opened record's `RecordDetailView` either
 * beside it (`split`, the default) or in the drawer over it (`drawer`, the
 * reader's preference, and the split face's fallback on a narrow content
 * area) — `utils/recordOpenPreference.ts`, objectstack#26677. An object that
 * declares `page` (or `new_window` / `none`) draws no record here. Every value
 * is passed in as a prop.
 *
 * Since objectstack#26679 the pane is the in-place stack of
 * `./recordDrawerStack.tsx`: its root is the list row `?recordId=` names, a
 * related row or a lookup inside it opens one level down, and its bar names
 * no object (maintainer ruling 2 on that card).
 */

import type { ReactNode } from 'react';
import { useRecordListFace, type NavigationOverlayMode } from '@object-ui/components';
import type { useObjectTranslation } from '@object-ui/i18n';
import { RecordDetailView } from './RecordDetailView.js';
import { RecordStackDrawer, useRecordDrawerStack } from './recordDrawerStack.js';
import type { useObjectViewRecordNavigation } from './objectViewRecordNavigation.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

type RecordNavigation = ReturnType<typeof useObjectViewRecordNavigation>;

export function ObjectViewRecordOverlay({
    navOverlay,
    mode,
    list,
    handleDrawerClose,
    objectDef,
    handleOpenAsPage,
    drawerRoot,
    drawerRestore,
    handleRootStep,
    dataSource,
    objects,
    onEdit,
}: {
    navOverlay: RecordNavigation['navOverlay'];
    /**
     * `split` (beside the list) or `drawer` (over it) for a record that opens
     * in the pane; the object's own mode otherwise.
     */
    mode: NavigationOverlayMode;
    /** The list, drawn whether or not a record is open; pass a stable element. */
    list: ReactNode;
    handleDrawerClose: RecordNavigation['handleDrawerClose'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    handleOpenAsPage: RecordNavigation['handleOpenAsPage'];
    drawerRoot: RecordNavigation['drawerRoot'];
    drawerRestore: RecordNavigation['drawerRestore'];
    handleRootStep: RecordNavigation['handleRootStep'];
    dataSource: ConsoleObjectViewProps['dataSource'];
    objects: ConsoleObjectViewProps['objects'];
    onEdit: ConsoleObjectViewProps['onEdit'];
}) {
    // The root steps through the rows the list shows (objectstack#26679).
    const stack = useRecordDrawerStack({ root: drawerRoot, restoredPath: drawerRestore, onRootStep: handleRootStep });
    return (
             <RecordStackDrawer
                 stack={stack}
                 open={navOverlay.isOpen}
                 mode={mode}
                 width={navOverlay.width}
                 mainContent={list}
                 onClose={handleDrawerClose}
                 onOpenAsPage={handleOpenAsPage}
                 storageKey={`drawer-width:${objectDef.name}`}
                 objects={objects}
                 renderRecord={(level) => (
                     <RecordDetailView
                         dataSource={dataSource}
                         objects={objects}
                         onEdit={onEdit}
                         objectNameOverride={level.objectName}
                         recordIdOverride={level.recordId}
                         embedded
                     />
                 )}
             />
    );
}

/**
 * The count under the list while the record pane narrows it (the split face,
 * objectui#10636): drawn inside the list the pane is handed, and only while
 * the pane sits beside it — a full-width list prints its own count in
 * `ListView`'s record-count bar.
 */
export function RecordPaneListCount({
    count,
    t,
}: {
    count: number | undefined;
    t: ReturnType<typeof useObjectTranslation>['t'];
}) {
    const face = useRecordListFace();
    if (face === 'full' || typeof count !== 'number') return null;
    return (
        <div data-testid="record-count-footer" className="border-t px-3 sm:px-4 py-1.5 text-xs text-muted-foreground bg-muted/5 shrink-0">
            {/* One count family, like `ListView`'s record-count bar
                (objectui#11445): i18next picks the CLDR slot. */}
            {t('console.objectView.recordCount', { count })}
        </div>
    );
}
