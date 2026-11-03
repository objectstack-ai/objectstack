/**
 * The record pane of the Console `ObjectView` (`./ObjectView.tsx`), and the
 * list it opens records from (objectstack#25992 slice 10; objectstack#27545).
 *
 * One `NavigationOverlay` draws both: the list in the same place and at its
 * full width whether or not a record is open — and whatever the object
 * declares, so a view switch never remounts it — and the opened record's
 * `RecordDetailView` in the drawer over it. The pane beside the list retired
 * (objectstack#28915); a reader who prefers the full page gets it from a row
 * click instead (`utils/recordOpenPreference.ts`, objectstack#26677). An
 * object that declares `page` (or `new_window` / `none`) draws no record
 * here. Every value is passed in as a prop.
 *
 * Since objectstack#26679 the pane is the in-place stack of
 * `./recordDrawerStack.tsx`: its root is the list row `?recordId=` names, a
 * related row or a lookup inside it opens one level down. Its top bar
 * (objectstack#27524, Target 7) names the object and the record at the root,
 * and its counter names the list's view (`stepScope`).
 */

import type { ReactNode } from 'react';
import type { NavigationOverlayMode } from '@object-ui/components';
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
    stepScope,
    dataSource,
    objects,
    onEdit,
}: {
    navOverlay: RecordNavigation['navOverlay'];
    /** The object's resolved mode: `drawer` draws the record over the list. */
    mode: NavigationOverlayMode;
    /** The list, drawn whether or not a record is open; pass a stable element. */
    list: ReactNode;
    handleDrawerClose: RecordNavigation['handleDrawerClose'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    handleOpenAsPage: RecordNavigation['handleOpenAsPage'];
    drawerRoot: RecordNavigation['drawerRoot'];
    drawerRestore: RecordNavigation['drawerRestore'];
    handleRootStep: RecordNavigation['handleRootStep'];
    /** The list's name (its view), which the pane's counter says. */
    stepScope?: string;
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
                 stepScope={stepScope}
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
