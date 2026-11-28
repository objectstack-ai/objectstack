// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0160 D7, seventh amendment — `ask_ai` left `ActionType` before 19.0.0
 * with no compatibility shim. Every slot that takes an action type refuses the
 * value with ONE prescription (`action-ask-ai-retired.ts`): a declared action,
 * an inline `element:button` action, an `action:button` / `action:icon` row's
 * `actionType`, an `action:group` / `action:menu` member's `type`, and a
 * dashboard header action's `actionType`. Each pin asserts the refusal lands
 * at the slot's own path with the prescription, and a control proves the slot
 * still takes a live type.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ASK_AI_RETIRED } from './action-ask-ai-retired';
import { ActionSchema, ActionType } from './action.zod';
import {
  ActionButtonPropsSchema,
  ActionGroupPropsSchema,
  ActionIconPropsSchema,
  ActionMenuPropsSchema,
  ElementButtonPropsSchema,
} from './component.zod';
import { DashboardHeaderActionSchema, DashboardHeaderSchema } from './dashboard.zod';

function refusal(schema: z.ZodTypeAny, input: unknown): { path: string; message: string }[] {
  const result = schema.safeParse(input);
  expect(result.success, 'the retired value is refused').toBe(false);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('ask_ai is retired from every action-type slot (ADR-0160 D7)', () => {
  it('the prescription names the release, the ADR, the shell entry and the migration command', () => {
    expect(ASK_AI_RETIRED).toContain('@objectstack/spec 19.0.0');
    expect(ASK_AI_RETIRED).toContain('ADR-0160 D7');
    expect(ASK_AI_RETIRED).toContain('「问 AI」');
    expect(ASK_AI_RETIRED).toContain('os migrate meta --from 18');
  });

  it('ActionType has the six live members and refuses ask_ai with the prescription', () => {
    expect(ActionType.options).toEqual(['script', 'url', 'modal', 'flow', 'api', 'form']);
    expect(refusal(ActionType, 'ask_ai')).toEqual([{ path: '', message: ASK_AI_RETIRED }]);
  });

  it('a declared action whose type is ask_ai is refused at `type`', () => {
    const issues = refusal(ActionSchema, { name: 'ask_about_case', label: 'Ask AI', type: 'ask_ai' });
    expect(issues).toContainEqual({ path: 'type', message: ASK_AI_RETIRED });
  });

  it('control: a declared script action still parses', () => {
    expect(ActionSchema.safeParse({ name: 'close_case', label: 'Close', type: 'script', target: 'close_case' }).success)
      .toBe(true);
  });

  it('an element:button inline action of ask_ai is refused at `action.type`', () => {
    const issues = refusal(ElementButtonPropsSchema, { label: 'Ask', action: { type: 'ask_ai', label: 'Ask' } });
    expect(issues).toContainEqual({ path: 'action.type', message: ASK_AI_RETIRED });
  });

  it.each([
    ['action:button', ActionButtonPropsSchema, { label: 'Ask AI', actionType: 'ask_ai' }],
    ['action:icon', ActionIconPropsSchema, { icon: 'sparkles', actionType: 'ask_ai' }],
  ])('an %s row whose actionType is ask_ai is refused at `actionType`', (_label, schema, row) => {
    expect(refusal(schema, row)).toContainEqual({ path: 'actionType', message: ASK_AI_RETIRED });
  });

  it.each([
    ['action:group', ActionGroupPropsSchema],
    ['action:menu', ActionMenuPropsSchema],
  ])('an %s member whose type is ask_ai is refused at `actions.N.type`', (_label, schema) => {
    const issues = refusal(schema, {
      actions: [
        { label: 'Run', type: 'api', target: '/api/v1/tickets/run' },
        { label: 'Ask AI', type: 'ask_ai' },
      ],
    });
    expect(issues).toContainEqual({ path: 'actions.1.type', message: ASK_AI_RETIRED });
  });

  it('control: the rows and members still take a live executor', () => {
    expect(ActionButtonPropsSchema.safeParse({ label: 'Escalate', actionType: 'flow', target: 'escalate' }).success)
      .toBe(true);
    expect(ActionMenuPropsSchema.safeParse({ actions: [{ label: 'Run', type: 'api', target: '/api/v1/run' }] }).success)
      .toBe(true);
  });

  it('a dashboard header action whose actionType is ask_ai is refused at `actionType`', () => {
    expect(refusal(DashboardHeaderActionSchema, { label: 'Ask AI', actionUrl: '#', actionType: 'ask_ai' }))
      .toContainEqual({ path: 'actionType', message: ASK_AI_RETIRED });
    expect(refusal(DashboardHeaderSchema, { actions: [{ label: 'Ask AI', actionUrl: '#', actionType: 'ask_ai' }] }))
      .toContainEqual({ path: 'actions.0.actionType', message: ASK_AI_RETIRED });
  });
});
