// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tool titles can be localized — cloud#1658.
 *
 * Measured in a fully Chinese conversation: every string on the tool card was
 * localized except the tool's own name.
 *
 *   Describe object    已完成   执行过程
 *   Visualize data     已完成   执行过程
 *   已统计完成，各阅读状态的书本数量如下：…
 *
 * The step the user most needs to read — "what is it doing right now?" — was
 * the one left in a foreign language, because `humanizeToolName` was an English
 * title-caser with no i18n channel at all: the name never passed through
 * translation, so no locale pack could reach it.
 *
 * The channel is OPTIONAL on purpose. Without a translator this function must
 * behave exactly as it always has — that is what makes the change safe to land
 * before every call site is wired and before any pack carries entries. The
 * first suite below is therefore the load-bearing one: it pins the old
 * behaviour, unchanged.
 */

import { describe, it, expect } from 'vitest';
import { humanizeToolName, toolTitleKey } from '../tool-display.js';

describe('humanizeToolName — unchanged without a translator', () => {
  it('still title-cases snake_case and kebab-case', () => {
    expect(humanizeToolName('list_objects')).toBe('List objects');
    expect(humanizeToolName('query_records')).toBe('Query records');
    expect(humanizeToolName('describe-api-tool')).toBe('Describe API tool');
  });

  it('still keeps the acronym casing table', () => {
    expect(humanizeToolName('fetch_url')).toBe('Fetch URL');
    expect(humanizeToolName('ai_summary')).toBe('AI summary');
  });

  it('still answers empty for empty input', () => {
    expect(humanizeToolName('')).toBe('');
    expect(humanizeToolName(undefined)).toBe('');
    expect(humanizeToolName(null)).toBe('');
  });
});

describe('humanizeToolName — with a translator', () => {
  it('looks the title up under a stable per-tool key', () => {
    expect(toolTitleKey('describe_object')).toBe('chatbot.tool.describe_object');
  });

  it('returns what the locale has', () => {
    const zh: Record<string, string> = {
      'chatbot.tool.describe_object': '查看对象结构',
      'chatbot.tool.visualize_data': '生成图表',
    };
    const tt = (key: string, fallback: string) => zh[key] ?? fallback;
    expect(humanizeToolName('describe_object', tt)).toBe('查看对象结构');
    expect(humanizeToolName('visualize_data', tt)).toBe('生成图表');
  });

  it('falls back to the English title for a tool the pack does not carry', () => {
    // The case that decides whether this is safe to ship gradually: a custom or
    // newly added tool must read exactly as it does today, not as a raw key.
    const tt = (_key: string, fallback: string) => fallback;
    expect(humanizeToolName('some_custom_tool', tt)).toBe('Some custom tool');
  });

  it('hands the translator the English title as the fallback, not the raw name', () => {
    // If the fallback were the raw `snake_case`, a missing entry would show
    // `describe_object` — a regression from today's behaviour.
    let seen: { key: string; fallback: string } | null = null;
    humanizeToolName('describe_object', (key, fallback) => {
      seen = { key, fallback };
      return fallback;
    });
    expect(seen).toEqual({ key: 'chatbot.tool.describe_object', fallback: 'Describe object' });
  });
});
