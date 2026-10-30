// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Webhooks subtitle in Setup is the `sys_webhook` object description, and
 * an administrator reads it (#27853). It used to explain the object in code —
 * `defineStack({ webhooks })` / `defineWebhook()`, the "webhook auto-enqueuer",
 * the "HTTP outbox". The source description and every shipped locale's copy
 * now say it in business words; the code-level account lives in the comment
 * beside the description in `sys-webhook.object.ts`.
 *
 * Pins SHAPES, never wording.
 */

import { describe, it, expect } from 'vitest';
import { SysWebhook } from './sys-webhook.object.js';
import { enObjects } from './translations/en.objects.generated.js';
import { zhCNObjects } from './translations/zh-CN.objects.generated.js';
import { jaJPObjects } from './translations/ja-JP.objects.generated.js';
import { esESObjects } from './translations/es-ES.objects.generated.js';

const DEVELOPER_SHAPES: Array<[string, RegExp]> = [
  ['code call', /\b[A-Za-z_$][\w$]*\(\s*[\w{}\s,]*\)/],
  ['camelCase code identifier', /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/],
  ['object API name', /\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/],
  ['internal component', /auto-enqueuer|outbox/i],
];

const shapesIn = (text: string) =>
  DEVELOPER_SHAPES.filter(([, re]) => re.test(text)).map(([name]) => name);

describe('sys_webhook description reads as business words (#27853)', () => {
  it('the sweep has teeth on the old subtitle', () => {
    expect(
      shapesIn('declared in code via defineStack({ webhooks }) / defineWebhook() by the webhook auto-enqueuer'),
    ).toEqual(['code call', 'camelCase code identifier', 'internal component']);
  });

  it('the source description carries no code', () => {
    expect(typeof SysWebhook.description).toBe('string');
    expect(shapesIn(SysWebhook.description as string)).toEqual([]);
  });

  for (const [locale, objects] of [
    ['en', enObjects],
    ['zh-CN', zhCNObjects],
    ['ja-JP', jaJPObjects],
    ['es-ES', esESObjects],
  ] as const) {
    it(`the ${locale} bundle's description carries no code`, () => {
      const description = (objects as any).sys_webhook?.description;
      expect(typeof description).toBe('string');
      expect(shapesIn(description)).toEqual([]);
    });
  }
});
