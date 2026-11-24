/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { RelatedCountStore, useRelatedCountVersion } from '@object-ui/components';
import { useRecordContext } from '@object-ui/react';

/**
 * The ids of the record page's 审批 and 附件 tabs, which the host's
 * `?related=` names (a related list's tab id is its relationship id).
 */
export const RECORD_TAB_APPROVALS = 'approvals';
export const RECORD_TAB_ATTACHMENTS = 'attachments';

/** Whether the approvals a `record:approvals` node carries hold a pending request (the 审批 tab's dot). */
export function approvalsHoldPendingRequest(approvals: unknown): boolean {
  const pending = (approvals as { pendingRequest?: unknown } | null | undefined)?.pendingRequest;
  return !!pending && typeof pending === 'object';
}

/**
 * The related-count store key the record's attachments are counted under: the
 * synthetic relationship the 附件 tab badge probes (`page:tabs`), which the
 * record page payload seeds and the panel takes its rows from.
 */
export const attachmentsCountField = (objectName: string): string => `attachments:${objectName}`;

/**
 * How many attachments the record holds, through the store the tab badge and
 * the panel share: the probe is the badge's own (the `(parent_object,
 * parent_id)` scope), so a page payload that seeded it answers at once.
 * `null` while unknown, or with nothing to ask.
 */
export function useRecordAttachmentCount(enabled: boolean): number | null {
  const ctx = useRecordContext();
  useRelatedCountVersion();
  const objectName = ctx?.objectName;
  const parentId = ctx?.recordId === undefined || ctx?.recordId === null ? undefined : String(ctx.recordId);
  const ds: any = ctx?.dataSource;
  const field = objectName ? attachmentsCountField(objectName) : undefined;
  const cached = enabled && field && parentId ? RelatedCountStore.get('sys_attachment', field, parentId) : undefined;
  React.useEffect(() => {
    if (!enabled || !field || !parentId || !ds || typeof ds.find !== 'function') return;
    if (RelatedCountStore.get('sys_attachment', field, parentId) !== undefined) return;
    const finder = (object: string, query: any) =>
      ds.find(object, { ...query, $filter: { parent_object: objectName, parent_id: parentId } });
    void RelatedCountStore.fetch(finder, 'sys_attachment', field, parentId).catch(() => 0);
  }, [enabled, field, parentId, ds, objectName, cached]);
  return typeof cached === 'number' ? cached : null;
}
