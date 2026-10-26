/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  cn,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@object-ui/components';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DetailSection } from './DetailSection';
import type { SectionGroup as SectionGroupType } from '@object-ui/types';

export interface SectionGroupProps {
  group: SectionGroupType;
  data?: any;
  className?: string;
  objectSchema?: any;
  /** Object name for i18n field label resolution */
  objectName?: string;
  isEditing?: boolean;
  onFieldChange?: (field: string, value: any) => void;
  /** Enter inline-edit mode focused on a field (double-click / hover pencil). */
  onEnterInlineEdit?: (fieldName: string) => void;
  /** Field to auto-focus when inline edit is entered from a field. */
  autoFocusField?: string | null;
  /** DataSource used by reference widgets during inline editing */
  dataSource?: any;
}

export const SectionGroup: React.FC<SectionGroupProps> = ({
  group,
  data,
  className,
  objectSchema,
  objectName,
  isEditing = false,
  onFieldChange,
  onEnterInlineEdit,
  autoFocusField,
  dataSource,
}) => {
  const collapsible = group.collapsible ?? true;
  const [isCollapsed, setIsCollapsed] = React.useState(group.defaultCollapsed ?? false);

  const sectionsContent = (
    <div className="space-y-3 sm:space-y-4">
      {group.sections.map((section, index) => (
        <DetailSection
          key={index}
          section={section}
          data={data}
          objectSchema={objectSchema}
          objectName={objectName}
          isEditing={isEditing}
          onFieldChange={onFieldChange}
          onEnterInlineEdit={onEnterInlineEdit}
          autoFocusField={autoFocusField}
          dataSource={dataSource}
        />
      ))}
    </div>
  );

  if (!collapsible) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center gap-2 pb-2 border-b">
          {group.icon && <span className="text-muted-foreground">{group.icon}</span>}
          <h3 className="text-lg font-semibold">{group.title}</h3>
        </div>
        {group.description && (
          <p className="text-sm text-muted-foreground">{group.description}</p>
        )}
        {sectionsContent}
      </div>
    );
  }

  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => setIsCollapsed(!open)}
      className={className}
    >
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 pb-2 border-b cursor-pointer hover:bg-muted/50 transition-colors rounded-t-md px-2 py-1.5">
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          {group.icon && <span className="text-muted-foreground">{group.icon}</span>}
          <h3 className="text-lg font-semibold">{group.title}</h3>
        </div>
      </CollapsibleTrigger>
      {group.description && !isCollapsed && (
        <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
      )}
      <CollapsibleContent>
        <div className="mt-3">
          {sectionsContent}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
