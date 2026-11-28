// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0160 D7 — a dashboard header runs on no record, so it cannot carry the
// one member of the derived action vocabulary that needs one: `ask_ai`. The
// header refuses it at parse, at the `actionType` path, and keeps every other
// member of `ActionType`.
import { describe, it, expect } from 'vitest';
import { ActionType } from './action.zod';
import { DashboardHeaderActionSchema, WidgetActionTypeSchema } from './dashboard.zod';

describe('DashboardHeaderActionSchema — `actionType: ask_ai`', () => {
  it('is refused at the `actionType` path, naming where an ask_ai action belongs', () => {
    const r = DashboardHeaderActionSchema.safeParse({ label: 'Ask AI', actionType: 'ask_ai', actionUrl: 'account' });
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual(['actionType']);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].message).toContain("locations: ['record_page']");
  });

  it('keeps the vocabulary derived: ask_ai is still a member, refused by the header alone', () => {
    expect(WidgetActionTypeSchema.options).toEqual(ActionType.options);
  });

  it.each(['script', 'url', 'modal', 'flow', 'api', 'form'])('still accepts `actionType: %s`', (actionType) => {
    const r = DashboardHeaderActionSchema.safeParse({ label: 'Go', actionType, actionUrl: actionType === 'url' ? '/target_x' : 'target_x' });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});
