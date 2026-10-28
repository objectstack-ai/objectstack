/**
 * The record detail overlay of the Console `ObjectView` (`./ObjectView.tsx`):
 * the drawer — the `NavigationOverlay` that draws the opened record's
 * `RecordDetailView`, moved out of `ObjectViewInner`'s JSX verbatim
 * (objectstack#25992, slice 10). The `split` face — drawn when the READER
 * prefers the record beside the list (`utils/recordOpenPreference.ts`,
 * objectstack#26677) — stays in the component, where it wraps the list
 * itself. Every value is passed in as a prop.
 *
 * Since objectstack#26679 the drawer is the in-place stack of
 * `./recordDrawerStack.tsx`: its root is the list row `?recordId=` names, a
 * related row or a lookup inside it opens one level down, and its bar names
 * no object (maintainer ruling 2 on that card).
 */

import type { useObjectTranslation } from '@object-ui/i18n';
import { RecordDetailView } from './RecordDetailView.js';
import { RecordStackDrawer, useRecordDrawerStack } from './recordDrawerStack.js';
import type { useObjectViewRecordNavigation } from './objectViewRecordNavigation.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

type RecordNavigation = ReturnType<typeof useObjectViewRecordNavigation>;

export function ObjectViewRecordOverlay({
    navOverlay,
    handleDrawerClose,
    objectDef,
    handleExpandDrawer,
    drawerRoot,
    drawerRestore,
    t,
    dataSource,
    objects,
    onEdit,
}: {
    navOverlay: RecordNavigation['navOverlay'];
    handleDrawerClose: RecordNavigation['handleDrawerClose'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    handleExpandDrawer: RecordNavigation['handleExpandDrawer'];
    drawerRoot: RecordNavigation['drawerRoot'];
    drawerRestore: RecordNavigation['drawerRestore'];
    t: ReturnType<typeof useObjectTranslation>['t'];
    dataSource: ConsoleObjectViewProps['dataSource'];
    objects: ConsoleObjectViewProps['objects'];
    onEdit: ConsoleObjectViewProps['onEdit'];
}) {
    const stack = useRecordDrawerStack({ root: drawerRoot, restoredPath: drawerRestore });
    return (
             <RecordStackDrawer
                 stack={stack}
                 open={navOverlay.isOpen}
                 mode={navOverlay.mode}
                 width={navOverlay.width}
                 onClose={handleDrawerClose}
                 onExpand={handleExpandDrawer}
                 expandLabel={t('console.objectView.expandToPage', { defaultValue: 'Open as full page' })}
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
