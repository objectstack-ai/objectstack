// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (item 3) — the copilot's draft marks: when one is drawn for a
 * key, which array elements count as added, and the source sentence's copy in
 * both designer locales.
 */

import { describe, expect, it } from 'vitest';
import type { DraftChange } from '@object-ui/data-objectstack';
import { addedArrayElements, copilotDraftMarkOf, draftSourceText } from './StudioDraftMark';

const NOW = Date.parse('2026-10-19T10:00:00.000Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const entry = (path: string[], by: DraftChange['by'], minutes = 2): DraftChange => ({ path, by, actor: 'usr_1', at: ago(minutes) });

describe('copilotDraftMarkOf — only a copilot write marks a key (objectui#12725)', () => {
  it('the answering entry by the copilot marks the key, with its `at`', () => {
    expect(copilotDraftMarkOf([entry(['fields', 'x'], 'copilot')], ['fields', 'x'])).toEqual({ at: ago(2) });
    expect(copilotDraftMarkOf([entry([], 'copilot', 7)], ['fields', 'x'])).toEqual({ at: ago(7) });
  });

  it.each(['studio', 'api'] as const)('an answering entry through `%s` draws no mark', (by) => {
    expect(copilotDraftMarkOf([entry(['fields', 'x'], by)], ['fields', 'x'])).toBeNull();
    // The deeper studio write answers, not the copilot's whole-body one.
    expect(copilotDraftMarkOf([entry([], 'copilot'), entry(['fields', 'x'], by)], ['fields', 'x'])).toBeNull();
  });

  it('a copilot entry under the key marks it; the latest copilot `at` is the one read', () => {
    const changes = [entry(['fields', 'x'], 'studio', 1), entry(['fields', 'x', 'label'], 'copilot', 4), entry(['fields', 'x', 'type'], 'copilot', 3)];
    expect(copilotDraftMarkOf(changes, ['fields', 'x'])).toEqual({ at: ago(3) });
  });

  it('CONTROL: absent `draftChanges` draws no mark', () => {
    expect(copilotDraftMarkOf(null, ['fields', 'x'])).toBeNull();
  });
});

describe('addedArrayElements — the draft array against the published one (objectui#12725)', () => {
  it('answers the draft elements the published array does not hold, in draft order', () => {
    expect(addedArrayElements(['book', 'reader', 'due_date'], ['book'])).toEqual(['reader', 'due_date']);
    expect(addedArrayElements([{ field: 'a' }, { field: 'b' }], [{ field: 'a' }])).toEqual([{ field: 'b' }]);
  });

  it('nothing published: every element is added', () => {
    expect(addedArrayElements(['book'], undefined)).toEqual(['book']);
  });
});

describe('draftSourceText — the source sentence (objectui#12725)', () => {
  it('reads the ruled zh copy, N minutes from `at`', () => {
    expect(draftSourceText(ago(2), 'zh-CN', [], NOW)).toBe('由 AI 副驾在 2 分钟前作为草稿加入');
    expect(draftSourceText(ago(2), 'zh-CN', ['读者', '应还日期'], NOW)).toBe('「读者」「应还日期」 2 项由 AI 副驾在 2 分钟前作为草稿加入');
  });

  it('reads the en copy, and moves to hours and days past an hour', () => {
    expect(draftSourceText(ago(2), 'en-US', [], NOW)).toBe('Added as a draft by the AI copilot 2 min ago');
    expect(draftSourceText(ago(125), 'en-US', [], NOW)).toBe('Added as a draft by the AI copilot 2 h ago');
    expect(draftSourceText(ago(3 * 1440), 'zh-CN', [], NOW)).toBe('由 AI 副驾在 3 天前作为草稿加入');
    expect(draftSourceText(ago(2), 'en-US', ['Reader', 'Due date'], NOW)).toBe('"Reader", "Due date": 2 added as a draft by the AI copilot 2 min ago');
  });

  it('under a minute reads "just now", never "0 minutes ago"', () => {
    expect(draftSourceText(ago(0), 'zh-CN', [], NOW)).toBe('由 AI 副驾刚刚作为草稿加入');
    expect(draftSourceText(ago(0), 'en-US', [], NOW)).toBe('Added as a draft by the AI copilot just now');
  });
});
