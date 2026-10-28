// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (item 3) — the copilot's draft marks: when one is drawn for a
 * key, which array elements count as added, and the source sentence's copy in
 * both designer locales. objectstack#27176 — the same marks for an agent
 * through the MCP build door, naming its OAuth client.
 */

import { describe, expect, it } from 'vitest';
import type { DraftChange } from '@object-ui/data-objectstack';
import { addedArrayElements, agentDraftMarkOf, draftSourceText, type AgentDraftMark } from './StudioDraftMark';

// The `engine.studio.*` rows this suite reads in zh live in `@object-ui/i18n`'s
// `studio` namespace, whose `zh` catalogue is fetched on demand
// (objectstack#25922). Resident before any case: this file runs in the `unit`
// project, whose shared module graph would otherwise let it pass only when
// another file had loaded `zh` first.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const NOW = Date.parse('2026-10-19T10:00:00.000Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const entry = (path: string[], by: DraftChange['by'], minutes = 2): DraftChange => ({ path, by, actor: 'usr_1', at: ago(minutes) });
const copilot = (at: string): AgentDraftMark => ({ at, by: 'copilot' });
const CLAUDE = { id: 'cli_claude', name: 'Claude' };

describe('agentDraftMarkOf — only a copilot write marks a key (objectui#12725)', () => {
  it('the answering entry by the copilot marks the key, with its `at`', () => {
    expect(agentDraftMarkOf([entry(['fields', 'x'], 'copilot')], ['fields', 'x'])).toEqual({ at: ago(2), by: 'copilot' });
    expect(agentDraftMarkOf([entry([], 'copilot', 7)], ['fields', 'x'])).toEqual({ at: ago(7), by: 'copilot' });
  });

  it.each(['studio', 'api'] as const)('an answering entry through `%s` draws no mark', (by) => {
    expect(agentDraftMarkOf([entry(['fields', 'x'], by)], ['fields', 'x'])).toBeNull();
    // The deeper studio write answers, not the copilot's whole-body one.
    expect(agentDraftMarkOf([entry([], 'copilot'), entry(['fields', 'x'], by)], ['fields', 'x'])).toBeNull();
  });

  it('a copilot entry under the key marks it; the latest copilot `at` is the one read', () => {
    const changes = [entry(['fields', 'x'], 'studio', 1), entry(['fields', 'x', 'label'], 'copilot', 4), entry(['fields', 'x', 'type'], 'copilot', 3)];
    expect(agentDraftMarkOf(changes, ['fields', 'x'])).toEqual({ at: ago(3), by: 'copilot' });
  });

  it('CONTROL: absent `draftChanges` draws no mark', () => {
    expect(agentDraftMarkOf(null, ['fields', 'x'])).toBeNull();
  });

  it('objectstack#27176: an `mcp` write marks the key too, with its client; the latest agent write names the source', () => {
    const mcp = { ...entry(['fields', 'x'], 'mcp', 1), client: CLAUDE };
    expect(agentDraftMarkOf([mcp], ['fields', 'x'])).toEqual({ at: ago(1), by: 'mcp', client: CLAUDE });
    expect(agentDraftMarkOf([entry(['fields', 'x'], 'mcp')], ['fields', 'x'])).toEqual({ at: ago(2), by: 'mcp' });
    const mixed = [entry(['fields', 'x', 'label'], 'copilot', 5), { ...entry(['fields', 'x', 'type'], 'mcp', 1), client: CLAUDE }];
    expect(agentDraftMarkOf(mixed, ['fields', 'x'])).toEqual({ at: ago(1), by: 'mcp', client: CLAUDE });
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
    expect(draftSourceText(copilot(ago(2)), 'zh-CN', [], NOW)).toBe('由 AI 副驾在 2 分钟前作为草稿加入');
    expect(draftSourceText(copilot(ago(2)), 'zh-CN', ['读者', '应还日期'], NOW)).toBe('「读者」「应还日期」 2 项由 AI 副驾在 2 分钟前作为草稿加入');
  });

  it('reads the en copy, and moves to hours and days past an hour', () => {
    expect(draftSourceText(copilot(ago(2)), 'en-US', [], NOW)).toBe('Added as a draft by the AI copilot 2 min ago');
    expect(draftSourceText(copilot(ago(125)), 'en-US', [], NOW)).toBe('Added as a draft by the AI copilot 2 h ago');
    expect(draftSourceText(copilot(ago(3 * 1440)), 'zh-CN', [], NOW)).toBe('由 AI 副驾在 3 天前作为草稿加入');
    expect(draftSourceText(copilot(ago(2)), 'en-US', ['Reader', 'Due date'], NOW)).toBe('"Reader", "Due date": 2 added as a draft by the AI copilot 2 min ago');
  });

  it('under a minute reads "just now", never "0 minutes ago"', () => {
    expect(draftSourceText(copilot(ago(0)), 'zh-CN', [], NOW)).toBe('由 AI 副驾刚刚作为草稿加入');
    expect(draftSourceText(copilot(ago(0)), 'en-US', [], NOW)).toBe('Added as a draft by the AI copilot just now');
  });
});

describe('draftSourceText — an MCP write names its client (objectstack#27176)', () => {
  it('names the client by its registered name, in both designer locales', () => {
    const mark: AgentDraftMark = { at: ago(2), by: 'mcp', client: CLAUDE };
    expect(draftSourceText(mark, 'zh-CN', [], NOW)).toBe('由 MCP 客户端「Claude」在 2 分钟前作为草稿加入');
    expect(draftSourceText(mark, 'en-US', [], NOW)).toBe('Added as a draft by the MCP client "Claude" 2 min ago');
    expect(draftSourceText(mark, 'zh-CN', ['读者'], NOW)).toBe('「读者」 1 项由 MCP 客户端「Claude」在 2 分钟前作为草稿加入');
    expect(draftSourceText({ ...mark, at: ago(0) }, 'en-US', [], NOW)).toBe('Added as a draft by the MCP client "Claude" just now');
  });

  it('a client with no registered name, or none recorded, is an MCP client unnamed — never its id', () => {
    for (const mark of [{ at: ago(2), by: 'mcp', client: { id: 'cli_opaque' } }, { at: ago(2), by: 'mcp' }] as AgentDraftMark[]) {
      expect(draftSourceText(mark, 'zh-CN', [], NOW)).toBe('由 MCP 客户端在 2 分钟前作为草稿加入');
      expect(draftSourceText(mark, 'en-US', [], NOW)).toBe('Added as a draft by an MCP client 2 min ago');
      expect(draftSourceText(mark, 'en-US', [], NOW)).not.toContain('cli_opaque');
    }
  });
});
