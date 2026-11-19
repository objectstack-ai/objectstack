// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35197] `HookContext.text` — the published type of the `ctx.text(key,
 * params?)` call a hook asks for one of its declared `texts` with.
 *
 * The runtime binds it on every path a hook runs on
 * (`packages/runtime/src/sandbox/hook-text.ts`, `HookTextSurface`), so a typed
 * handler must be able to call it against `HookContext` without a local type.
 * Pinned from both sides:
 *
 *  1. the type: `HookContext['text']` is exactly an optional
 *     `(key: string, params?: Record<string, unknown>) => Promise<string>`,
 *     the signature the runtime injects, and a wrong call shape is a type
 *     error. The `@ts-expect-error` lines are real checks: `tsconfig.test.json`
 *     compiles this layer (`pnpm --filter @objectstack/spec check:test-typecheck`).
 *  2. the parse: `HookContextSchema` (deliberately non-strict, which strips a
 *     key it does not declare) keeps the bound function.
 */

import { describe, expect, it } from 'vitest';

import { HookContextSchema, type HookContext, type HookTextReader } from './hook.zod';

/** `true` only when every `A` is a usable `B`. */
type Assignable<A, B> = [A] extends [B] ? true : false;

type RuntimeTextSurface = (key: string, params?: Record<string, unknown>) => Promise<string>;

describe('HookContext.text — the declared-text call a typed handler makes', () => {
  it('declares the signature the runtime injects, optional like api and notice', () => {
    const declaredIsRuntime: Assignable<NonNullable<HookContext['text']>, RuntimeTextSurface> = true;
    const runtimeIsDeclared: Assignable<RuntimeTextSurface, NonNullable<HookContext['text']>> = true;
    const namedIsMember: Assignable<HookTextReader, NonNullable<HookContext['text']>> = true;
    const optional: Assignable<undefined, HookContext['text']> = true;
    expect([declaredIsRuntime, runtimeIsDeclared, namedIsMember, optional]).toEqual([true, true, true, true]);
  });

  it('a typed handler calls it with a key and params and gets a string', async () => {
    const asked: Array<[string, Record<string, unknown> | undefined]> = [];
    const handler = async (ctx: HookContext): Promise<string> => {
      const lead = 'Ada';
      return (await ctx.text?.('follow_up_subject', { lead })) ?? '';
    };
    const ctx: HookContext = {
      object: 'crm_lead',
      event: 'afterInsert',
      input: {},
      text: async (key, params) => {
        asked.push([key, params]);
        return `Follow up with qualified lead: ${String(params?.lead)}`;
      },
    };
    await expect(handler(ctx)).resolves.toBe('Follow up with qualified lead: Ada');
    expect(asked).toEqual([['follow_up_subject', { lead: 'Ada' }]]);
  });

  it('a wrong call shape is a type error', () => {
    const text: HookTextReader = async (key) => key;
    // @ts-expect-error the key is the snake_case string a hook declares, never a number
    void text(42);
    // @ts-expect-error params is a name → value record, never a positional list
    void text('follow_up_subject', ['Ada']);
    const answer = async (): Promise<void> => {
      // @ts-expect-error the call resolves to the sentence, a string
      const n: number = await text('follow_up_subject');
      void n;
    };
    expect(typeof answer).toBe('function');
  });

  it('the parse keeps the bound function instead of stripping it', () => {
    const text: HookTextReader = async () => 'sentence';
    const bare = { object: 'crm_lead', event: 'afterInsert', input: {}, ql: {} };
    expect(HookContextSchema.parse({ ...bare, text }).text).toBe(text);
    expect('text' in HookContextSchema.parse(bare)).toBe(false);
  });
});
