// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rest of the url-target family: the authoring doors outside the two
 * url-action doors whose value the console's action runner navigates to, each
 * judged by the ONE grammar in `navigation-target.ts` (ruling A+ on
 * objectstack-ai/objectui#12191 — the scheme set is stated once in the
 * contract and the runtime fulfils exactly that). The set itself is pinned
 * case by case in `action-url-target-scheme-set.test.ts`; this file pins only
 * that each door APPLIES it, with one refusal and one accepted control per
 * door, plus the scope each door draws:
 *
 * - `DashboardHeaderActionSchema.actionUrl` — judged when `actionType` is
 *   `'url'` or omitted (both readers that give an omitted type a meaning give
 *   it `'url'`), untouched on every other type.
 * - `ActionSchema.onSuccess.navigate` — judged on every value; a template that
 *   opens with `${` keeps the predicate's own rule and is left to the hop.
 *
 * Each refusal is pinned by its Zod issue path and its first sentence, through
 * the schema AND through the stack parse `os validate` runs, so the reach is
 * the public door's, not a unit's.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { ActionSchema } from './action.zod';
import { DashboardHeaderActionSchema } from './dashboard.zod';

const HEADER_SUBJECT =
  "A dashboard header action's `actionUrl`, a url target when `actionType` is `'url'` or omitted,";
const NAVIGATE_SUBJECT = "An action's `onSuccess.navigate`";
const JAVASCRIPT_REST = ' opens with `javascript:`, a scheme a url target never opens.';

/** The message's first sentence: everything up to the first `. ` outside a code span. */
function firstSentence(message: string): string {
  let inCode = false;
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] === '`') inCode = !inCode;
    if (!inCode && message[i] === '.' && (message[i + 1] === ' ' || i === message.length - 1)) {
      return message.slice(0, i + 1);
    }
  }
  return message;
}

type Issue = { code: string; path: PropertyKey[]; message: string };
const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  (r.success ? [] : (r.error?.issues ?? [])) as Issue[];

const MANIFEST = { id: 'com.example.url_doors', name: 'url_doors', version: '1.0.0', type: 'app' };

// ===========================================================================
// 1. DashboardHeaderActionSchema.actionUrl
// ===========================================================================

const headerAction = (extra: Record<string, unknown>) => ({ label: 'Open', ...extra });
const dashboardWith = (action: Record<string, unknown>) => ({
  manifest: MANIFEST,
  dashboards: [{ name: 'url_doors_dash', label: 'Doors', widgets: [], header: { actions: [headerAction(action)] } }],
});

describe('dashboard header action: `actionUrl` on the url route is judged by the shared set', () => {
  it("REFUSAL: `actionType: 'url'` with `javascript:alert(1)` is refused at `actionUrl`", () => {
    const issues = issuesOf(DashboardHeaderActionSchema.safeParse(headerAction({ actionType: 'url', actionUrl: 'javascript:alert(1)' })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['actionUrl']]]);
    expect(firstSentence(issues[0].message)).toBe(`${HEADER_SUBJECT}${JAVASCRIPT_REST}`);
  });

  it('REFUSAL: an omitted `actionType` is the url route too — `javascript:alert(1)` is refused at `actionUrl`', () => {
    const issues = issuesOf(DashboardHeaderActionSchema.safeParse(headerAction({ actionUrl: 'javascript:alert(1)' })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['actionUrl']]]);
    expect(firstSentence(issues[0].message)).toBe(`${HEADER_SUBJECT}${JAVASCRIPT_REST}`);
  });

  it.each([
    ["`actionType: 'url'`", { actionType: 'url', actionUrl: 'https://example.com/report' }],
    ['`actionType` omitted', { actionUrl: '/reports/forecast' }],
  ])('ACCEPTED CONTROL: %s with an admitted target parses unchanged', (_label, action) => {
    const r = DashboardHeaderActionSchema.safeParse(headerAction(action));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect((r.data as { actionUrl: string }).actionUrl).toBe(action.actionUrl);
  });

  it('CONTROL: on a non-url `actionType` `actionUrl` names a flow, script or page and is not judged', () => {
    for (const actionType of ['flow', 'script', 'modal', 'api', 'form']) {
      const r = DashboardHeaderActionSchema.safeParse(headerAction({ actionType, actionUrl: 'export_dashboard_pdf' }));
      expect(r.success, `${actionType}: ${JSON.stringify(issuesOf(r))}`).toBe(true);
    }
  });

  it('REACH: the stack parse `os validate` runs refuses it at its full path, and accepts the control', () => {
    const refused = issuesOf(ObjectStackDefinitionSchema.safeParse(dashboardWith({ actionType: 'url', actionUrl: 'javascript:alert(1)' })));
    expect(refused.map((i) => i.path.join('.'))).toEqual(['dashboards.0.header.actions.0.actionUrl']);
    expect(firstSentence(refused[0].message)).toBe(`${HEADER_SUBJECT}${JAVASCRIPT_REST}`);

    const accepted = ObjectStackDefinitionSchema.safeParse(dashboardWith({ actionType: 'url', actionUrl: 'https://example.com/report' }));
    expect(accepted.success, JSON.stringify(issuesOf(accepted))).toBe(true);
  });

  it('REACH: `defineStack` throws the refusal for the omitted-type spelling', () => {
    expect(() => defineStack(dashboardWith({ actionUrl: 'javascript:alert(1)' }) as never))
      .toThrow(`${HEADER_SUBJECT}${JAVASCRIPT_REST}`);
  });
});

// ===========================================================================
// 2. ActionSchema.onSuccess.navigate
// ===========================================================================

const apiAction = (navigate: string) => ({
  name: 'clone_task', label: 'Clone', type: 'api', target: '/api/v1/tasks/clone', onSuccess: { navigate },
});

describe('`onSuccess.navigate` is judged by the shared set', () => {
  it('REFUSAL: `javascript:alert(1)` is refused at `onSuccess.navigate`', () => {
    const issues = issuesOf(ActionSchema.safeParse(apiAction('javascript:alert(1)')));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['onSuccess', 'navigate']]]);
    expect(firstSentence(issues[0].message)).toBe(`${NAVIGATE_SUBJECT}${JAVASCRIPT_REST}`);
  });

  it('REFUSAL: a bare relative template is refused — the runner refuses `tasks/42` after interpolation too', () => {
    const issues = issuesOf(ActionSchema.safeParse(apiAction('tasks/${result.id}')));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['onSuccess', 'navigate']]]);
    expect(firstSentence(issues[0].message))
      .toBe(`${NAVIGATE_SUBJECT} opens with neither an admitted scheme nor \`/\` or \`./\`.`);
  });

  it.each([
    ['an in-app route template', '/apps/crm/tasks/${result.id}'],
    ['an https:// URL', 'https://example.com/receipt'],
    ['a template that opens with `${` — deferred to the hop, by the predicate\'s own rule', '${result.redirectUrl}'],
  ])('ACCEPTED CONTROL: %s parses unchanged', (_label, navigate) => {
    const r = ActionSchema.safeParse(apiAction(navigate));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect((r.data as { onSuccess: { navigate: string } }).onSuccess.navigate).toBe(navigate);
  });

  it('REACH: the stack parse refuses it at its full path, `defineStack` throws it, and the control parses', () => {
    const stack = (navigate: string) => ({ manifest: MANIFEST, actions: [apiAction(navigate)] });
    const refused = issuesOf(ObjectStackDefinitionSchema.safeParse(stack('javascript:alert(1)')));
    expect(refused.map((i) => i.path.join('.'))).toEqual(['actions.0.onSuccess.navigate']);
    expect(() => defineStack(stack('javascript:alert(1)') as never)).toThrow(`${NAVIGATE_SUBJECT}${JAVASCRIPT_REST}`);

    const accepted = ObjectStackDefinitionSchema.safeParse(stack('/apps/crm/tasks/${result.id}'));
    expect(accepted.success, JSON.stringify(issuesOf(accepted))).toBe(true);
  });
});
