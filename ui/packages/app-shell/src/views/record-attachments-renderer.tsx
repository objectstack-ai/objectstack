/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:attachments` — schema-addressable wrapper around
 * `RecordAttachmentsPanel`, mirroring how `record:discussion` wraps
 * `RecordChatterPanel` (plugin-detail/renderers/record-chatter.tsx).
 *
 * Registered here (app-shell) rather than in plugin-detail because the panel
 * depends on `@object-ui/providers` (presigned upload adapter) and
 * `@object-ui/auth` (Bearer fetch), which plugin-detail deliberately does not
 * pull in. The side-effect registration is imported from the app-shell barrel
 * (`src/index.ts`), so any host that mounts the shell — the console runtime
 * AND Studio's PagePreview — resolves the type before a synthesized page
 * references it (objectstack#4358).
 *
 * Renders nothing without a record identity (e.g. a page composed outside a
 * RecordContext). A missing dataSource is tolerated: the panel just shows its
 * empty state — that is what Studio's PagePreview binds.
 */

import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { useRecordContext } from '@object-ui/react';
import { useAuth } from '@object-ui/auth';
import { RecordAttachmentsPanel } from './RecordAttachmentsPanel.js';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordAttachmentsRendererProps {
  schema?: Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const RecordAttachmentsRenderer: React.FC<RecordAttachmentsRendererProps> = ({
  schema: _schema,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { user } = useAuth();
  const { designer } = splitDesigner(props);

  const objectName = ctx?.objectName;
  const recordId = ctx?.recordId != null ? String(ctx.recordId) : '';
  if (!objectName || !recordId) return null;

  return (
    <div className={className} {...designer}>
      <RecordAttachmentsPanel
        objectName={objectName}
        recordId={recordId}
        dataSource={ctx?.dataSource}
        currentUserId={user?.id}
      />
    </div>
  );
};

ComponentRegistry.register('attachments', RecordAttachmentsRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Attachments',
  icon: 'Paperclip',
  inputs: [{ name: 'className', type: 'string' }],
});

export default RecordAttachmentsRenderer;
