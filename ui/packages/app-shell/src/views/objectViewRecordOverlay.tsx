/**
 * The record detail overlay of the Console `ObjectView` (`./ObjectView.tsx`)
 * for every navigation mode but `split` (drawer, modal, popover): the
 * `NavigationOverlay` that draws the opened record's `RecordDetailView`, moved
 * out of `ObjectViewInner`'s JSX verbatim (objectstack#25992, slice 10). The
 * `split` face stays in the component, where it wraps the list itself. Every
 * value is passed in as a prop.
 */

import { NavigationOverlay } from '@object-ui/components';
import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { RecordDetailView } from './RecordDetailView.js';
import type { useObjectViewRecordNavigation } from './objectViewRecordNavigation.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function ObjectViewRecordOverlay({
    navOverlay,
    handleDrawerClose,
    objectLabel,
    objectDef,
    handleExpandDrawer,
    t,
    dataSource,
    objects,
    onEdit,
}: {
    navOverlay: ReturnType<typeof useObjectViewRecordNavigation>['navOverlay'];
    handleDrawerClose: ReturnType<typeof useObjectViewRecordNavigation>['handleDrawerClose'];
    objectLabel: ReturnType<typeof useObjectLabel>['objectLabel'];
    objectDef: ConsoleObjectViewProps['objects'][number];
    handleExpandDrawer: ReturnType<typeof useObjectViewRecordNavigation>['handleExpandDrawer'];
    t: ReturnType<typeof useObjectTranslation>['t'];
    dataSource: ConsoleObjectViewProps['dataSource'];
    objects: ConsoleObjectViewProps['objects'];
    onEdit: ConsoleObjectViewProps['onEdit'];
}) {
    return (
             <NavigationOverlay
                 {...navOverlay}
                 setIsOpen={(open: boolean) => { if (!open) handleDrawerClose(); }}
                 title={objectLabel(objectDef)}
                 onExpand={handleExpandDrawer}
                 expandLabel={t('console.objectView.expandToPage', { defaultValue: 'Open as full page' })}
                 storageKey={`drawer-width:${objectDef.name}`}
             >
                 {(record: Record<string, unknown>) => {
                     const recordId = (record.id || record._id) as string;
                     return (
                         <RecordDetailView
                             dataSource={dataSource}
                             objects={objects}
                             onEdit={onEdit}
                             objectNameOverride={objectDef.name}
                             recordIdOverride={recordId}
                             embedded
                         />
                     );
                 }}
             </NavigationOverlay>
    );
}
