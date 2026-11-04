// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user.locale` is stored in its BCP-47 case on every ObjectQL write, and
 * the fold only ever changes the spelling of a value the column already
 * accepted. The real door (`PATCH /api/v1/data/sys_user/:id` on a booted
 * showcase) is `user-locale-case-fold.dogfood.test.ts` in `packages/qa/dogfood`;
 * this file holds the hook's own contract and its composition with the
 * column's shape rule.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SysUser } from '@objectstack/platform-objects/identity';
import { evaluateValidationRules } from '@objectstack/objectql';
import { canonicalUserLocale, registerUserLocaleCaseFold } from './sys-user-locale-case.js';

type Handler = (ctx: any) => Promise<void>;

/** Fake engine capturing hook registrations (the identity-write-guard shape). */
function makeHookEngine() {
  const handlers: Record<string, Array<{ handler: Handler; options: any }>> = {};
  return {
    handlers,
    registerHook: (event: string, handler: Handler, options: any) => {
      (handlers[event] ??= []).push({ handler, options });
    },
  };
}

function hookOn(engine: ReturnType<typeof makeHookEngine>, event: string): { handler: Handler; options: any } {
  const entry = engine.handlers[event]?.find((h) => h.options?.packageId === 'test.user-locale-case');
  if (!entry) throw new Error(`no locale fold registered for ${event}`);
  return entry;
}

/** The column's own rules over a payload: the thrown error, or null. */
function columnRefusal(data: Record<string, unknown>, mode: 'insert' | 'update'): any {
  try {
    evaluateValidationRules(SysUser as any, data, mode, { previous: mode === 'update' ? {} : undefined });
    return null;
  } catch (e) {
    return e;
  }
}

describe('canonicalUserLocale: the LocaleSchema fold, or the value as given', () => {
  it.each([
    ['zh-cn', 'zh-CN'],
    ['ZH-CN', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['EN', 'en'],
    ['ZH-HANS-cn', 'zh-Hans-CN'],
    ['es-419', 'es-419'],
    // Shape-valid, served by no platform locale: folded and stored, as before.
    ['xx-yy', 'xx-YY'],
  ])('%s is stored as %s', (input, stored) => {
    expect(canonicalUserLocale(input)).toBe(stored);
  });

  it.each([
    ['an underscore separator', 'zh_CN'],
    ['a language name', 'Chinese'],
    ['whitespace inside the tag', 'zh CN'],
    ['a trailing space', 'zh-cn '],
    ['the empty string', ''],
  ])('leaves %s exactly as given, for the column rule to judge', (_why, input) => {
    expect(canonicalUserLocale(input)).toBe(input);
  });

  it.each([null, undefined, 42, {}])('leaves a non-string (%s) as given', (input) => {
    expect(canonicalUserLocale(input)).toBe(input);
  });
});

describe('the fold composed with the column rule: the verdict never moves', () => {
  it.each(['zh-cn', 'ZH-CN', 'zh-CN', 'zh_CN', 'Chinese', 'zh CN', '', 'xx-yy', 'ZH-HANS-cn'])(
    '%s is refused after the fold exactly when it was refused before it',
    (value) => {
      for (const mode of ['insert', 'update'] as const) {
        const before = columnRefusal({ locale: value }, mode);
        const after = columnRefusal({ locale: canonicalUserLocale(value) }, mode);
        expect(Boolean(after), `${value} on ${mode}`).toBe(Boolean(before));
      }
    },
  );

  it('zh_CN is still refused by the column rule, VALIDATION_FAILED on locale', () => {
    const err = columnRefusal({ locale: canonicalUserLocale('zh_CN') }, 'update');
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields).toEqual([expect.objectContaining({ field: 'locale', code: 'invalid_format' })]);
  });
});

describe('the write-path hooks', () => {
  let engine: ReturnType<typeof makeHookEngine>;
  beforeEach(() => {
    engine = makeHookEngine();
    registerUserLocaleCaseFold(engine, { packageId: 'test.user-locale-case' });
  });

  it('registers on sys_user only, at priority 5, ahead of the identity write guard', () => {
    for (const event of ['beforeInsert', 'beforeUpdate']) {
      const { options } = hookOn(engine, event);
      expect(options.object).toBe('sys_user');
      expect(options.priority).toBe(5);
    }
  });

  it.each(['beforeInsert', 'beforeUpdate'])('%s folds the payload in place', async (event) => {
    for (const sent of ['zh-cn', 'ZH-CN']) {
      const data: Record<string, unknown> = { id: 'usr_1', locale: sent };
      await hookOn(engine, event).handler({ object: 'sys_user', input: { id: 'usr_1', data } });
      expect(data).toEqual({ id: 'usr_1', locale: 'zh-CN' });
    }
  });

  it('fires for every context: user, system and none', async () => {
    for (const session of [undefined, { userId: 'usr_1' }, { userId: 'usr_1', isSystem: true }]) {
      const data: Record<string, unknown> = { locale: 'ja-jp' };
      await hookOn(engine, 'beforeUpdate').handler({ object: 'sys_user', input: { data }, session });
      expect(data.locale).toBe('ja-JP');
    }
  });

  it('leaves a canonical tag, a refused shape and a clear as sent', async () => {
    for (const sent of ['zh-CN', 'zh_CN', '', null]) {
      const data: Record<string, unknown> = { locale: sent };
      await hookOn(engine, 'beforeUpdate').handler({ object: 'sys_user', input: { data } });
      expect(data.locale).toBe(sent);
    }
  });

  it('adds no locale key to a payload that carries none', async () => {
    const data: Record<string, unknown> = { name: 'Renamed' };
    await hookOn(engine, 'beforeUpdate').handler({ object: 'sys_user', input: { data } });
    expect(data).toEqual({ name: 'Renamed' });
  });

  it('tolerates the shapes a hook context can arrive in', async () => {
    const { handler } = hookOn(engine, 'beforeUpdate');
    await expect(handler({ object: 'sys_user', input: {} })).resolves.toBeUndefined();
    await expect(handler({ object: 'sys_user' })).resolves.toBeUndefined();
    await expect(handler({})).resolves.toBeUndefined();
  });

  it('folds the shared payload a predicate update dispatches per row (ADR-0058 D3)', async () => {
    const data: Record<string, unknown> = { locale: 'zh-cn' };
    for (const id of ['usr_1', 'usr_2']) {
      await hookOn(engine, 'beforeUpdate').handler({ object: 'sys_user', input: { id, data, options: { multi: true } } });
    }
    expect(data.locale).toBe('zh-CN');
  });
});
