/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What the page's own record reads learned about a record (objectstack#35415).
 *
 * The approval request page links its title to the record the request is
 * about only where the page itself could read that record: the same rule the
 * "As submitted" card's "Open record" link and the record pointer card's title
 * follow (objectui#12557, objectui#11878). A refused or unresolvable target,
 * and one the platform asserted deleted (which the page never reads), yields
 * no link.
 *
 * The title does not read the record again. The reads the page already makes
 * (`SubmittedRecord`'s current read, `RecordPreviewCard`'s read) report each
 * answer here, and the host that provides the report collects them. No
 * provider (every page but the request page): reporting does nothing.
 */

import * as React from 'react';

/** Called with each settled read: the record read (`true`) or it did not (`false`). */
export type RecordReadReport = (objectName: string, recordId: string, readable: boolean) => void;

export const RecordReadReportContext = React.createContext<RecordReadReport | null>(null);

/** The key a report is collected under. */
export function recordReadKey(objectName: string, recordId: string): string {
  return `${objectName}::${recordId}`;
}

/**
 * Report a read's answer to the page's collector, once it has settled. Pass
 * `null` for either half while the read addresses nothing, and `'loading'`
 * until it answers.
 */
export function useReportRecordRead(
  objectName: string | null | undefined,
  recordId: string | null | undefined,
  status: 'loading' | 'readable' | 'unreadable' | 'absent',
): void {
  const report = React.useContext(RecordReadReportContext);
  React.useEffect(() => {
    if (!report || !objectName || !recordId) return;
    if (status !== 'readable' && status !== 'unreadable') return;
    report(objectName, recordId, status === 'readable');
  }, [report, objectName, recordId, status]);
}
