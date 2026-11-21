/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval request page's title: the business record the request is
 * about, not the request itself.
 *
 * A request is a record that stands for another one. Its own declared title is
 * the flow's label (`process_label`, the object's `nameField`), which every
 * list and search result keeps; on the request's own page an approver reads
 * the record they are deciding on, so the page header names it by the title
 * the approvals get serves for it (`record_title`) and links to it, the way
 * the "As submitted" card's "Open record" link does.
 *
 * Where the get serves no subject title (one it could not resolve), or serves
 * the bare record id, the page keeps the request's own title: the header never
 * names the subject by a raw id.
 *
 * The name links only where the page itself read the record, the rule the "As
 * submitted" card's link and the record pointer card's title follow
 * (objectui#12557, objectui#11878): the page's own reads report what they
 * learned (`recordReadReport.ts`), and the title reads nothing itself. A
 * refused or unresolvable subject, and one the platform asserted deleted (which
 * the page never reads), is named as plain text.
 */

import * as React from 'react';
import type { RecordHeaderTitle } from '@object-ui/components';
import { useRelatedRecordActions } from '@object-ui/react';

/** A non-empty string value of `row[key]`, trimmed; `undefined` otherwise. */
function textOf(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

/**
 * The subject's name as a link to the subject, through the host's record
 * route; the bare name where the host routes to no record of that object.
 * A plain left click is the host's in-app navigation; a modifier or middle
 * click keeps the anchor's own new-tab behaviour.
 */
function ApprovalSubjectLink({ objectName, recordId, title, readable }: { objectName: string; recordId: string; title: string; readable: boolean }) {
  const recordLinks = useRelatedRecordActions();
  const href = readable && recordLinks?.recordHref ? recordLinks.recordHref(objectName, recordId) : null;
  if (!href) return <>{title}</>;
  return (
    <a
      href={href}
      className="hover:underline focus-visible:outline-none focus-visible:underline"
      data-testid="approval-subject-title-link"
      onClick={(event) => {
        if (!recordLinks?.openRecord || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        recordLinks.openRecord(objectName, recordId);
      }}
    >
      {title}
    </a>
  );
}

/**
 * The header title for an approval request row, or `undefined` to keep the
 * request's own title. `isReadable` answers whether the page's own reads
 * returned that record; only then is the name a link.
 */
export function approvalSubjectTitle(
  request: unknown,
  isReadable: (objectName: string, recordId: string) => boolean,
): RecordHeaderTitle | undefined {
  if (!request || typeof request !== 'object') return undefined;
  const row = request as Record<string, unknown>;
  const title = textOf(row, 'record_title');
  const objectName = textOf(row, 'object_name');
  const recordId = textOf(row, 'record_id');
  if (!title || !objectName || !recordId || title === recordId) return undefined;
  return {
    text: title,
    node: (
      <ApprovalSubjectLink objectName={objectName} recordId={recordId} title={title} readable={isReadable(objectName, recordId)} />
    ),
  };
}
