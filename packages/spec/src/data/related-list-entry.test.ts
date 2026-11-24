// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35897 · #35899] The one reading of a `relatedLists` entry's name and the
 * built-in tab vocabulary every reader shares.
 */
import { describe, expect, it } from 'vitest';
import {
  RECORD_PAGE_BUILTIN_TABS,
  RELATED_LIST_BUILTIN_PART_OF,
  isRecordPageBuiltinTab,
  relatedListEntryName,
} from './related-list-entry';

describe('relatedListEntryName', () => {
  it('reads a bare name and the object form alike', () => {
    expect(relatedListEntryName('task')).toBe('task');
    expect(relatedListEntryName('event.related_to')).toBe('event.related_to');
    expect(relatedListEntryName({ list: 'quote_line', columns: ['product'] })).toBe('quote_line');
  });

  it('names nothing for any other value', () => {
    for (const value of [undefined, null, 1, ['task'], {}, { list: 1 }]) {
      expect(relatedListEntryName(value)).toBeUndefined();
    }
  });
});

describe('the built-in tab vocabulary', () => {
  it('is the three platform objects the record page draws as its own tabs, in their default order', () => {
    expect(RECORD_PAGE_BUILTIN_TABS).toEqual(['sys_attachment', 'sys_approval_request', 'sys_activity']);
    for (const name of RECORD_PAGE_BUILTIN_TABS) expect(isRecordPageBuiltinTab(name)).toBe(true);
    expect(isRecordPageBuiltinTab('sys_comment')).toBe(false);
    expect(isRecordPageBuiltinTab({ list: 'sys_attachment' })).toBe(false);
  });

  it('maps the parts of the activity stream to the stream tab, and names no tab as a part', () => {
    expect(RELATED_LIST_BUILTIN_PART_OF).toEqual({ sys_comment: 'sys_activity', sys_audit_log: 'sys_activity' });
    for (const tab of Object.values(RELATED_LIST_BUILTIN_PART_OF)) expect(isRecordPageBuiltinTab(tab)).toBe(true);
    for (const part of Object.keys(RELATED_LIST_BUILTIN_PART_OF)) expect(isRecordPageBuiltinTab(part)).toBe(false);
  });
});
