// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28251] The save-notice channel a record-change run is handed: the write's
 * `ctx.notice`, open only while the trigger's hook handler awaits the run.
 */
import { describe, it, expect } from 'vitest';
import { closeSaveNoticeChannel, saveNoticeChannelOf } from './record-change-trigger.js';

describe('saveNoticeChannelOf', () => {
  it('hands a message to the write\'s ctx.notice, carrying the writer\'s locale', () => {
    const heard: string[] = [];
    const { saveNotice } = saveNoticeChannelOf((m) => { heard.push(m); }, 'zh-CN');
    saveNotice!.set('已提交审批');
    expect(heard).toEqual(['已提交审批']);
    expect(saveNotice!.locale).toBe('zh-CN');
  });

  it('is absent when the dispatch bound no ctx.notice (a delete)', () => {
    expect(saveNoticeChannelOf(undefined, 'en')).toEqual({});
  });

  it('refuses a set once closed — the write has answered (a resumed leg)', () => {
    const heard: string[] = [];
    const context = saveNoticeChannelOf((m) => { heard.push(m); }, undefined);
    closeSaveNoticeChannel(context);
    expect(() => context.saveNotice!.set('late')).toThrow(/has already answered/);
    expect(heard).toEqual([]);
  });
});
