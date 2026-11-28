// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0160 D7 — `type: 'ask_ai'`: an action on one record that focuses the
// in-app assistant on that record. What this file pins:
//   · the member exists and needs no `target`;
//   · a `target` beside it is refused at parse, on the registered and the
//     inline shape alike;
//   · `ai.exposed: true` beside it is refused at parse (`false` is not);
//   · the neighbours keep their rules: `script` still needs `body` or
//     `target`, the target-bound types still need a `target`.
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ActionSchema, ActionType, InlineActionSchema } from './action.zod';

const base = { name: 'ask_about_account', label: 'Ask AI', objectName: 'account', locations: ['record_page'] };

function issuePaths(result: { success: boolean; error?: z.ZodError }): string[] {
  return result.success ? [] : (result.error as z.ZodError).issues.map((i) => i.path.join('.'));
}

describe('ActionType — `ask_ai` (ADR-0160 D7)', () => {
  it('is a member of the dispatch-route vocabulary', () => {
    expect(ActionType.options).toContain('ask_ai');
  });

  it('parses with no `target`: the action names nothing', () => {
    const r = ActionSchema.safeParse({ ...base, type: 'ask_ai' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    expect((r as { data: { type: string } }).data.type).toBe('ask_ai');
  });

  it('parses beside ordinary presentation keys (icon, order, visible, confirmText)', () => {
    const r = ActionSchema.safeParse({
      ...base,
      type: 'ask_ai',
      icon: 'sparkles',
      order: 1,
      visible: "record.status != 'closed'",
      confirmText: 'Open the assistant on this account?',
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

describe('ActionSchema — refusals beside `type: ask_ai`', () => {
  it('refuses a `target`, at the `target` path', () => {
    const r = ActionSchema.safeParse({ ...base, type: 'ask_ai', target: 'account_overview' });
    expect(r.success).toBe(false);
    expect(issuePaths(r as never)).toEqual(['target']);
    const issue = (r as { error: z.ZodError }).error.issues[0];
    expect(issue.code).toBe('custom');
    expect(issue.message.split('.')[0]).toBe("A `type: 'ask_ai'` action takes no `target`: it focuses the in-app assistant on the record it runs on, and the material the assistant reads about that record is chosen by the record's context pack, not by the action");
  });

  it('refuses `ai.exposed: true`, at the `ai.exposed` path', () => {
    const r = ActionSchema.safeParse({
      ...base,
      type: 'ask_ai',
      ai: { exposed: true, description: 'Opens the assistant focused on this account so the user can ask about it.' },
    });
    expect(r.success).toBe(false);
    expect(issuePaths(r as never)).toEqual(['ai.exposed']);
    expect((r as { error: z.ZodError }).error.issues[0].code).toBe('custom');
  });

  it('accepts `ai.exposed: false` — nothing is advertised', () => {
    const r = ActionSchema.safeParse({ ...base, type: 'ask_ai', ai: { exposed: false } });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('reports both refusals in one parse', () => {
    const r = ActionSchema.safeParse({
      ...base,
      type: 'ask_ai',
      target: 'x',
      ai: { exposed: true, description: 'Opens the assistant focused on this account so the user can ask about it.' },
    });
    expect(issuePaths(r as never).sort()).toEqual(['ai.exposed', 'target']);
  });

  it('refuses a `body`: only `script` runs one', () => {
    const r = ActionSchema.safeParse({ ...base, type: 'ask_ai', body: { language: 'js', source: 'return 1;' } });
    expect(r.success).toBe(false);
    expect(issuePaths(r as never)).toContain('body');
  });
});

describe('InlineActionSchema — `type: ask_ai`', () => {
  it('parses with no `target`', () => {
    const r = InlineActionSchema.safeParse({ type: 'ask_ai', label: 'Ask AI' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('refuses a `target`, and its legacy spelling `to`', () => {
    for (const body of [{ type: 'ask_ai', target: 'x' }, { type: 'ask_ai', to: '/x' }]) {
      const r = InlineActionSchema.safeParse(body);
      expect(r.success, JSON.stringify(body)).toBe(false);
      expect(issuePaths(r as never)).toEqual(['target']);
    }
  });
});

describe('the neighbours keep their rules', () => {
  it('`script` still needs a `body` or a `target`', () => {
    const r = ActionSchema.safeParse({ ...base, type: 'script' });
    expect(r.success).toBe(false);
    expect(issuePaths(r as never)).toContain('body');
  });

  it.each(['url', 'modal', 'flow', 'api', 'form'])('`%s` still needs a `target`', (type) => {
    const r = ActionSchema.safeParse({ ...base, type });
    expect(r.success).toBe(false);
    expect(issuePaths(r as never)).toContain('target');
  });

  it('a `target` on any other type is not refused by the ask_ai rule', () => {
    const r = ActionSchema.safeParse({ ...base, type: 'flow', target: 'lead_reassignment' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});
