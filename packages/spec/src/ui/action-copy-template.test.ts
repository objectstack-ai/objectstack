// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24814 (ruling A) — an action's person-facing copy is an ADR-0032 `template`
 * slot over a CLOSED scope: `confirmText`, `successMessage` and `errorMessage`
 * on the page action rows, `confirmText` and `successMessage` on
 * `ActionSchema`. These pins hold each slot's accept set — a bare string is
 * shorthand for the envelope, a holeless sentence still parses, a blank one
 * still parses (the widening keeps that arm), and `ActionSchema` keeps its
 * inline locale map — and the roots the spec declares from the runner. The
 * holes are judged at the doors through `closedScopeTemplateRefusal`
 * (`automation/flow-text-slot-template.test.ts` pins the judge) and
 * `@objectstack/lint`'s `validate-action-copy-templates` pins the doors.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTION_CONFIRM_PARAMS_ROOT,
  ACTION_COPY_RECORD_ROOT,
  ACTION_ERROR_TEMPLATE_ROOTS,
  ACTION_SUCCESS_RESULT_ROOT,
  ACTION_SUCCESS_TEMPLATE_ROOTS,
  actionConfirmTemplateRoots,
} from './index';
import { ActionSchema } from './action.zod';
import { ActionButtonPropsSchema, ActionGroupPropsSchema, ActionIconPropsSchema } from './component.zod';

const KEYS = ['confirmText', 'successMessage', 'errorMessage'] as const;

/** The three row surfaces: each parses one action row, and answers the parsed row. */
const ROWS = [
  ['action:button', (row: Record<string, unknown>) => ActionButtonPropsSchema.safeParse({ label: 'Run', actionType: 'script', target: 'run', ...row })],
  ['action:icon', (row: Record<string, unknown>) => ActionIconPropsSchema.safeParse({ label: 'Run', actionType: 'script', target: 'run', ...row })],
  ['action:group member', (row: Record<string, unknown>) => {
    const r = ActionGroupPropsSchema.safeParse({ actions: [{ name: 'run', type: 'script', target: 'run', ...row }] });
    return r.success ? { success: true as const, data: (r.data as { actions: Record<string, unknown>[] }).actions[0] } : r;
  }],
] as const;

describe('the page action rows\' copy keys are template slots', () => {
  for (const [surface, parse] of ROWS) {
    for (const key of KEYS) {
      it(`${surface} ${key}: a bare string is the envelope, the envelope is taken, a blank string stays`, () => {
        const ok = (value: unknown) => {
          const r = parse({ [key]: value });
          if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join('\n'));
          return (r.data as Record<string, unknown>)[key];
        };
        expect(ok('Delete {{ record.name }}?')).toEqual({ dialect: 'template', source: 'Delete {{ record.name }}?' });
        expect(ok({ dialect: 'template', source: 'Done' })).toEqual({ dialect: 'template', source: 'Done' });
        // A `${…}` sentence parsed while the key was a string, and still does:
        // the doors name it with a warning.
        expect(ok('Delete ${record.name}?')).toEqual({ dialect: 'template', source: 'Delete ${record.name}?' });
        expect(ok('')).toBe('');
        expect(ok('  ')).toBe('  ');
      });

      it(`${surface} ${key}: a foreign dialect and a non-string are refused with the key's own sentence`, () => {
        for (const value of [{ dialect: 'cel', source: 'record.name' }, 42, { en: 'Done' }]) {
          const r = parse({ [key]: value });
          expect(r.success, JSON.stringify(value)).toBe(false);
          if (r.success) continue;
          const messages = r.error.issues.map((i) => i.message).join('\n');
          expect(messages).toContain(`An action's \`${key}\` is a template-typed slot`);
        }
      });
    }
  }
});

describe('ActionSchema confirmText / successMessage are template slots that keep the locale map', () => {
  const base = { name: 'invite', label: 'Invite', type: 'api', target: '/api/v1/invite' } as const;
  const parsed = (patch: Record<string, unknown>) => {
    const r = ActionSchema.safeParse({ ...base, ...patch });
    if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join('\n'));
    return r.data as Record<string, unknown>;
  };

  for (const key of ['confirmText', 'successMessage'] as const) {
    it(`${key}: string → envelope, envelope taken, locale map and blank string unchanged`, () => {
      expect(parsed({ [key]: 'Sent to {{ result.email }}' })[key]).toEqual({ dialect: 'template', source: 'Sent to {{ result.email }}' });
      expect(parsed({ [key]: { dialect: 'template', source: 'Sent' } })[key]).toEqual({ dialect: 'template', source: 'Sent' });
      expect(parsed({ [key]: { en: 'Sent', 'zh-CN': '已发送' } })[key]).toEqual({ en: 'Sent', 'zh-CN': '已发送' });
      expect(parsed({ [key]: '' })[key]).toBe('');
    });

    it(`${key}: a foreign dialect is refused, naming the locale map among what it takes`, () => {
      const r = ActionSchema.safeParse({ ...base, [key]: { dialect: 'cel', source: 'x' } });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues.map((i) => i.message).join('\n')).toContain('or an inline locale map');
    });
  }

  it('errorMessage is NOT in this family on ActionSchema: it stays an I18nLabel, a string parsed as itself', () => {
    expect(parsed({ errorMessage: 'Failed' }).errorMessage).toBe('Failed');
  });
});

describe('the roots are what the runner binds', () => {
  it('confirmText binds `record`, and `params` only beside static values', () => {
    expect(ACTION_COPY_RECORD_ROOT).toBe('record');
    expect(ACTION_CONFIRM_PARAMS_ROOT).toBe('params');
    expect(actionConfirmTemplateRoots({})).toEqual(['record']);
    expect(actionConfirmTemplateRoots({ params: [{ name: 'tier', type: 'text' }] })).toEqual(['record']);
    expect(actionConfirmTemplateRoots({ params: { tier: 'gold' } })).toEqual(['record', 'params']);
    expect(actionConfirmTemplateRoots({ params: null })).toEqual(['record']);
  });

  it('successMessage binds `result` then `record`; errorMessage binds nothing', () => {
    expect(ACTION_SUCCESS_RESULT_ROOT).toBe('result');
    expect([...ACTION_SUCCESS_TEMPLATE_ROOTS]).toEqual(['result', 'record']);
    expect([...ACTION_ERROR_TEMPLATE_ROOTS]).toEqual([]);
  });
});
