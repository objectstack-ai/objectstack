// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24814 (ruling A) — an action's person-facing copy is an ADR-0032 `template`
 * slot over a CLOSED scope: `confirmText`, `successMessage` and `errorMessage`
 * on the page action rows, `confirmText` and `successMessage` on
 * `ActionSchema` — and, since #27948, `ActionSchema.description`, each
 * `params[].helpText` and each `outcomeMessages` entry. These pins hold each slot's accept set — a bare string is
 * shorthand for the envelope, a holeless sentence still parses, a blank one
 * still parses (the arm is kept so a stored one loads; the doors refuse it,
 * #25680), and `ActionSchema` keeps its
 * inline locale map — and the roots the spec declares from the runner. The
 * holes are judged at the doors through `closedScopeTemplateRefusal`
 * (`automation/flow-text-slot-template.test.ts` pins the judge) and
 * `@objectstack/lint`'s `validate-action-copy-templates` pins the doors.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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
        // the doors refuse it, the parse keeps it so a stored one loads.
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

describe('ActionSchema description / params[].helpText / outcomeMessages joined the family (#27948)', () => {
  const base = { name: 'pause', label: 'Pause', type: 'api', target: '/api/v1/pause' } as const;
  const parse = (patch: Record<string, unknown>) => ActionSchema.safeParse({ ...base, ...patch });
  const parsed = (patch: Record<string, unknown>) => {
    const r = parse(patch);
    if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join('\n'));
    return r.data as Record<string, any>;
  };
  /** Each slot: how to write a value into it, how to read it back, its refusal's slot name, and whether it keeps a locale map. */
  const SLOTS = [
    ['description', (v: unknown) => ({ description: v }), (d: Record<string, any>) => d.description, "An action's `description`", true],
    ['params[].helpText', (v: unknown) => ({ params: [{ name: 'reason', type: 'text', helpText: v }] }), (d: Record<string, any>) => d.params[0].helpText, "An action param's `helpText`", false],
    ['outcomeMessages entry', (v: unknown) => ({ outcomeMessages: { paused: v } }), (d: Record<string, any>) => d.outcomeMessages.paused, "An action's `outcomeMessages` entry", true],
  ] as const;

  for (const [slot, write, read, name, localeMap] of SLOTS) {
    it(`${slot}: string → envelope, envelope taken, blank string unchanged; a \${…} sentence still parses`, () => {
      expect(read(parsed(write('Pause {{ record.name }}?')))).toEqual({ dialect: 'template', source: 'Pause {{ record.name }}?' });
      expect(read(parsed(write({ dialect: 'template', source: 'Paused' })))).toEqual({ dialect: 'template', source: 'Paused' });
      // Stored copy written before the migration still loads; the doors refuse it.
      expect(read(parsed(write('Pause ${record.name}?')))).toEqual({ dialect: 'template', source: 'Pause ${record.name}?' });
      expect(read(parsed(write('')))).toBe('');
    });

    it(`${slot}: ${localeMap ? 'keeps' : 'takes no'} inline locale map; a foreign dialect is refused with the slot's own sentence`, () => {
      const map = { en: 'Paused', 'zh-CN': '已暂停' };
      if (localeMap) expect(read(parsed(write(map)))).toEqual(map);
      else expect(parse(write(map)).success).toBe(false);
      const r = parse(write({ dialect: 'cel', source: 'record.name' }));
      expect(r.success).toBe(false);
      if (r.success) return;
      const messages = r.error.issues.map((i) => i.message).join('\n');
      expect(messages).toContain(`${name} is a template-typed slot`);
      expect(messages.includes('or an inline locale map')).toBe(localeMap);
    });
  }

  it('the describes an author reads in Studio teach `{{ }}`, never `${…}`', () => {
    const json = z.toJSONSchema(ActionSchema, { unrepresentable: 'any', io: 'input' }) as {
      properties: Record<string, any>;
    };
    const describes = {
      description: json.properties.description.description as string,
      outcomeMessages: json.properties.outcomeMessages.description as string,
    };
    for (const [key, text] of Object.entries(describes)) {
      expect(text, key).toContain('`template` slot');
      expect(text, key).toContain('{{ ');
      expect(text, key).not.toMatch(/may interpolate \$\{/);
    }
    expect(describes.outcomeMessages).toContain('{{ result.email }}');
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
