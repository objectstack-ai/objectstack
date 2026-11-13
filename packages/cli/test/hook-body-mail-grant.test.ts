// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32004] A hook body sends no mail, so the build refuses a hook whose handler
 * calls `ctx.email.send`: lowering infers the `email.send` grant from the call
 * (`extractLoweredBody`), and the hook parse every build runs after lowering
 * (`HookSchema`) refuses that grant, naming it. An action's handler that makes
 * the same call lowers to a body the body schema takes.
 */

import { describe, it, expect } from 'vitest';
import { HookBodySchema, HookSchema } from '@objectstack/spec/data';
import { lowerCallables } from '../src/utils/lower-callables.js';

describe('the build refuses a hook whose handler sends mail', () => {
  it('lowers the handler to a body granted email.send, which the hook parse refuses', () => {
    const out = lowerCallables({
      hooks: [
        {
          name: 'welcome_contact',
          object: 'crm_contact',
          events: ['afterInsert'],
          handler: async (ctx: any) => {
            await ctx.email.send({ to: 'pat@example.test', subject: 'Welcome', text: 'Hello' });
          },
        },
      ],
    });
    const lowered = (out.lowered.hooks as any[])[0];
    expect(lowered.body.capabilities).toContain('email.send');

    const r = HookSchema.safeParse(lowered);
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual([`body.capabilities.${lowered.body.capabilities.indexOf('email.send')}`]);
    expect(issues[0].message).toContain('A hook body cannot be granted `email.send`');
  });

  it('lowers a hook handler that only adds a timeline entry to a body the hook parse takes', () => {
    const out = lowerCallables({
      hooks: [
        {
          name: 'note_contact',
          object: 'crm_contact',
          events: ['afterInsert'],
          handler: async (ctx: any) => {
            await ctx.activity.append({ object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Welcomed' });
          },
        },
      ],
    });
    const lowered = (out.lowered.hooks as any[])[0];
    expect(lowered.body.capabilities).toEqual(['activity.append']);
    const r = HookSchema.safeParse(lowered);
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  it('leaves the grant to the body an action takes', () => {
    expect(HookBodySchema.safeParse({ language: 'js', source: 'x', capabilities: ['email.send'] }).success).toBe(true);
  });
});
