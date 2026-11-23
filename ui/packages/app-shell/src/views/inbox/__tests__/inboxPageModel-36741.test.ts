// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full-page inbox's pure rules (objectstack#36741): its address, what a
 * notification's link points at, and how the selection moves.
 */

import { describe, expect, it } from 'vitest';
import {
  inboxPagePath,
  inboxTabFromSegment,
  isInboxPagePath,
  isTypingTarget,
  notificationSubject,
  selectionAfterLeaving,
  stepSelection,
} from '../inboxPageModel';

describe('the inbox page address', () => {
  it('names the tab in the path and the selected row in ?item=', () => {
    expect(inboxPagePath('crm')).toBe('/apps/crm/inbox');
    expect(inboxPagePath('crm', 'approvals')).toBe('/apps/crm/inbox/approvals');
    expect(inboxPagePath('crm', 'activity', 'a 1')).toBe('/apps/crm/inbox/activity?item=a%201');
  });

  it('recognises every tab of the page, and nothing under it', () => {
    expect(isInboxPagePath('/apps/crm/inbox')).toBe(true);
    expect(isInboxPagePath('/apps/crm/inbox/approvals')).toBe(true);
    expect(isInboxPagePath('/apps/crm/inbox/activity/')).toBe(true);
    expect(isInboxPagePath('/apps/crm/inbox/other')).toBe(false);
    expect(isInboxPagePath('/apps/crm/inbox_item/record/1')).toBe(false);
    expect(isInboxPagePath('/apps/crm/account')).toBe(false);
  });

  it('reads an unknown or absent tab segment as Notifications', () => {
    expect(inboxTabFromSegment(undefined)).toBe('notifications');
    expect(inboxTabFromSegment('approvals')).toBe('approvals');
    expect(inboxTabFromSegment('activity')).toBe('activity');
    expect(inboxTabFromSegment('nope')).toBe('notifications');
  });
});

describe('notificationSubject — what the right pane draws for a link', () => {
  it('an approvals-inbox link names one request, or the inbox itself', () => {
    expect(notificationSubject('/system/approvals?request=r1')).toEqual({ kind: 'approval', requestId: 'r1' });
    expect(notificationSubject('/apps/sales/system/approvals?request=r2')).toEqual({ kind: 'approval', requestId: 'r2' });
    expect(notificationSubject('/system/approvals')).toEqual({ kind: 'approvals' });
  });

  it('a record route, hosted or not, with or without a named page', () => {
    const rec = { kind: 'record', objectName: 'opportunity', recordId: 'o1' };
    expect(notificationSubject('/opportunity/record/o1')).toEqual(rec);
    expect(notificationSubject('/apps/sales/opportunity/record/o1')).toEqual(rec);
    expect(notificationSubject('/apps/sales/opportunity/record/o1/page/summary')).toEqual(rec);
    expect(notificationSubject('opportunity/record/o1?tab=details')).toEqual(rec);
  });

  it('the app-relative /OBJECT/ID the messaging pipeline synthesizes', () => {
    expect(notificationSubject('/task/t1')).toEqual({ kind: 'record', objectName: 'task', recordId: 't1' });
  });

  it('anything else is a plain link, and no link is null', () => {
    expect(notificationSubject('https://example.com/x')).toEqual({ kind: 'link' });
    expect(notificationSubject('//cdn.example.com/x')).toEqual({ kind: 'link' });
    expect(notificationSubject('/dashboard/sales')).toEqual({ kind: 'link' });
    expect(notificationSubject('/task/view/all')).toEqual({ kind: 'link' });
    expect(notificationSubject('/task/new')).toEqual({ kind: 'link' });
    expect(notificationSubject('/task')).toEqual({ kind: 'link' });
    expect(notificationSubject('')).toBeNull();
    expect(notificationSubject(null)).toBeNull();
  });
});

describe('moving the selection', () => {
  const ids = ['a', 'b', 'c'];

  it('J / K step one row and hold at either end', () => {
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'b', -1)).toBe('a');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection(ids, 'gone', -1)).toBe('a');
    expect(stepSelection([], 'a', 1)).toBeNull();
  });

  it('a row that leaves the list hands the selection to the next one, else the one before', () => {
    expect(selectionAfterLeaving(ids, 'b', ['a', 'c'])).toBe('c');
    expect(selectionAfterLeaving(ids, 'c', ['a', 'b'])).toBe('b');
    expect(selectionAfterLeaving(ids, 'a', [])).toBeNull();
    // A row that arrived meanwhile is not skipped to over the old order.
    expect(selectionAfterLeaving(ids, 'b', ['new', 'a', 'c'])).toBe('c');
  });

  it('keys typed into a field are not moves', () => {
    const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('DIV', true))).toBe(true);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
