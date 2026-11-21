/**
 * The record pane of the Console `ObjectView` (`./ObjectView.tsx`), and the
 * list it opens records from (objectstack#25992 slice 10; objectstack#27545).
 *
 * One `NavigationOverlay` draws both: the list in the same place and at its
 * full width whether or not a record is open — and whatever the object
 * declares, so a view switch never remounts it — and the opened record's
 * `RecordDetailView` in the drawer over it — the floating card the name
 * cell's 「在侧边打开」 icon opens (objectstack#35854); the record's name opens
 * the full page instead. A list whose rows open nothing (`none`) draws no
 * record here. Every value is passed in as a prop.
 *
 * Since objectstack#26679 the pane is the in-place stack of
 * `./recordDrawerStack.tsx`: its root is the list row `?recordId=` names, a
 * related row or a lookup inside it opens one level down. Its top bar
 * (objectstack#27524, Target 7) names the object and the record at the root,
 * and its counter names the list's view (`stepScope`).
 */

import { lazy, Suspense, type ReactNode } from 'react';
import type { NavigationOverlayMode } from '@object-ui/components';
import { SkeletonDetail } from '../skeletons/index.js';
import { RecordStackDrawer, useRecordDrawerStack } from './recordDrawerStack.js';
import type { useObjectViewRecordNavigation } from './objectViewRecordNavigation.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

type RecordNavigation = ReturnType<typeof useObjectViewRecordNavigation>;

// The record view is fetched the first time a record opens here, not with the
// list: a list that never opens a record never downloads it.
const RecordDetailView = lazy(() => import('./RecordDetailView.js').then((m) => ({ default: m.RecordDetailView })));

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
                 listObjectName={objectDef.name}
                 onClose={handleDrawerClose}
                 onOpenAsPage={handleOpenAsPage}
                 stepScope={stepScope}
                 storageKey={`drawer-width:${objectDef.name}`}
                 objects={objects}
                 renderRecord={(level) => (
                     <Suspense fallback={<SkeletonDetail />}>
                         <RecordDetailView
                             dataSource={dataSource}
                             objects={objects}
                             onEdit={onEdit}
                             objectNameOverride={level.objectName}
                             recordIdOverride={level.recordId}
                             embedded
                         />
                     </Suspense>
                 )}
             />
    );
}
