// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full-page inbox's pure rules (objectstack#36741): its address, what a
 * notification's link points at, and how the selection moves. Kept free of
 * React so each rule is pinned on its own.
 *
 * ## The address
 *
 * `/apps/APP/inbox` (Notifications), `/apps/APP/inbox/approvals`,
 * `/apps/APP/inbox/activity`, each with `?item=ID` for the row the right pane
 * shows. The tab is a path segment, not a query parameter: `tab` is the
 * record page's reserved parameter (`urlParams.ts`), and the record the right
 * pane embeds reads it. The page sits inside the current app's shell, so the
 * sidebar stays where it was and the browser's Back returns to the page the
 * bell was pressed on.
 *
 * @module
 */

/** The route segment the inbox page is mounted at, under `/apps/:appName`. */
export const INBOX_PAGE_SEGMENT = 'inbox';

/** The page-scoped parameter naming the row the right pane shows. */
export const INBOX_ITEM_PARAM = 'item';

export type InboxPageTab = 'notifications' | 'approvals' | 'activity';

/** Tab order, as the strip draws it. */
export const INBOX_PAGE_TABS: readonly InboxPageTab[] = ['notifications', 'approvals', 'activity'];

/** The tab a path segment names; no segment (or an unknown one) is Notifications. */
export function inboxTabFromSegment(segment: string | null | undefined): InboxPageTab {
  return segment === 'approvals' || segment === 'activity' ? segment : 'notifications';
}

/** The address of the inbox page in `appSegment`, on `tab`, showing `item`. */
export function inboxPagePath(appSegment: string, tab: InboxPageTab = 'notifications', item?: string | null): string {
  const base = `/apps/${appSegment}/${INBOX_PAGE_SEGMENT}${tab === 'notifications' ? '' : `/${tab}`}`;
  return item ? `${base}?${INBOX_ITEM_PARAM}=${encodeURIComponent(item)}` : base;
}

/** Is `pathname` the inbox page of some app (any tab)? */
export function isInboxPagePath(pathname: string): boolean {
  return /^\/apps\/[^/]+\/inbox(?:\/(?:approvals|activity))?\/?$/.test(pathname);
}

/**
 * What a notification's `action_url` points at, as far as the right pane can
 * draw it:
 *
 *  - `approval` — one request of the Approvals inbox
 *    (`/system/approvals?request=ID`, the link the approvals service writes);
 *  - `approvals` — the Approvals inbox itself, no request named;
 *  - `record` — one record: `/OBJECT/record/ID` (with or without its
 *    `/apps/APP` prefix and a named page after it), or the app-relative
 *    `/OBJECT/ID` the messaging pipeline synthesizes from an event's source
 *    (ADR-0030);
 *  - `link` — anything else (an external URL, a page, a list): the pane shows
 *    the message and the link, and draws no record for it.
 *
 * `null` for no link at all.
 */
export type NotificationSubject =
  | { kind: 'approval'; requestId: string }
  | { kind: 'approvals' }
  | { kind: 'record'; objectName: string; recordId: string }
  | { kind: 'link' };

/** Route words that sit where an object name would and are not one. */
const NOT_AN_OBJECT = new Set([
  'system', 'page', 'dashboard', 'report', 'reports', 'component', 'metadata', 'design',
  'search', 'create-app', 'edit-app', 'docs', 'developer', 'forms', INBOX_PAGE_SEGMENT,
]);

/** Route words that sit where a record id would on an object route and are not one. */
const NOT_A_RECORD = new Set(['new', 'view', 'data', 'record']);

export function notificationSubject(actionUrl: string | null | undefined): NotificationSubject | null {
  const raw = (actionUrl ?? '').trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return { kind: 'link' };
  const [pathPart, query = ''] = raw.split(/[?#]/, 2);
  let segments = pathPart.split('/').filter(Boolean).map(safeDecode);
  if (segments[0] === 'apps') segments = segments.slice(2);
  if (segments[0] === 'system' && segments[1] === 'approvals' && segments.length === 2) {
    const requestId = new URLSearchParams(query).get('request');
    return requestId ? { kind: 'approval', requestId } : { kind: 'approvals' };
  }
  const [objectName, second, third] = segments;
  if (!objectName || NOT_AN_OBJECT.has(objectName)) return { kind: 'link' };
  if (second === 'record' && third) return { kind: 'record', objectName, recordId: third };
  if (segments.length === 2 && second && !NOT_A_RECORD.has(second)) {
    return { kind: 'record', objectName, recordId: second };
  }
  return { kind: 'link' };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The row J / K moves to: one step through `ids` from `current` (`+1` down,
 * `-1` up), held at either end. Nothing selected starts at the first row.
 */
export function stepSelection(ids: readonly string[], current: string | null | undefined, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current ? ids.indexOf(current) : -1;
  if (at < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/**
 * The row selected once `left` has left the list (an approval decided): the
 * one after it in the order the list showed (`before`), else the one before
 * it, among the rows still listed (`after`). `null` when none is left.
 */
export function selectionAfterLeaving(
  before: readonly string[],
  left: string,
  after: readonly string[],
): string | null {
  const still = new Set(after);
  const at = before.indexOf(left);
  if (at >= 0) {
    for (let i = at + 1; i < before.length; i++) if (still.has(before[i])) return before[i];
    for (let i = at - 1; i >= 0; i--) if (still.has(before[i])) return before[i];
  }
  return after[0] ?? null;
}

/** Is a key event typed into a field, where J / K are letters and not moves? */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
