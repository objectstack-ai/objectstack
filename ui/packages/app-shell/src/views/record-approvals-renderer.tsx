/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:approvals` — schema-addressable wrapper around
 * `RecordApprovalsPanel` (objectui#3461), mirroring how `record:attachments`
 * wraps `RecordAttachmentsPanel`.
 *
 * Two data paths, host-first:
 *
 *  1. **Synthesized record page** — RecordDetailView threads its LIVE
 *     `useRecordApprovals` result through the node (`schema.approvals`).
 *     The same read drives the record page's declared decision actions
 *     (objectui#3055 — the pending row IS the record those actions run
 *     against), so the tab content and the decision bar can never disagree,
 *     and a decision re-renders the tab through the host's refresh — no
 *     second fetch, no drift.
 *  2. **Authored page without the payload** — the renderer self-fetches via
 *     the RecordContext identity, so `record:approvals` stays usable as a
 *     plain schema node. The self-fetch hook is passed `undefined` names
 *     when the host payload exists, which keeps it inert (no request).
 *
 * Registered in app-shell rather than plugin-detail because the panel and
 * its hook depend on `@object-ui/auth` (Bearer fetch), which plugin-detail
 * deliberately does not pull in. The side-effect registration is imported
 * from the app-shell barrel (`src/index.ts`).
 */

import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { useRecordContext } from '@object-ui/react';
import { useAuth } from '@object-ui/auth';
import { useRecordApprovals } from '../hooks/useRecordApprovals.js';
import { RecordApprovalsPanel } from './RecordApprovalsPanel.js';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordApprovalsRendererProps {
  schema?: Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const RecordApprovalsRenderer: React.FC<RecordApprovalsRendererProps> = ({
  schema,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { user } = useAuth();
  const { designer } = splitDesigner(props);

  const hostApprovals = schema?.approvals;
  // Authored-page fallback only: with a host payload the hook gets no
  // identity and stays inert (its effect no-ops on undefined names).
  const selfObjectName = hostApprovals ? undefined : ctx?.objectName;
  const selfRecordId = hostApprovals
    ? undefined
    : ctx?.recordId != null ? String(ctx.recordId) : undefined;
  const selfFetched = useRecordApprovals(selfObjectName, selfRecordId);

  const approvals = hostApprovals ?? selfFetched;
  const currentUserId = schema?.currentUserId ?? user?.id;

  return (
    <div className={className} {...designer}>
      <RecordApprovalsPanel approvals={approvals} currentUserId={currentUserId} />
    </div>
  );
};

ComponentRegistry.register('approvals', RecordApprovalsRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Approvals',
  icon: 'Stamp',
  inputs: [{ name: 'className', type: 'string' }],
});

export default RecordApprovalsRenderer;
