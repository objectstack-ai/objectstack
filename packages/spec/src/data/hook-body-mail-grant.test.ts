// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32004] `HookSchema` refuses a hook body granted `email.send`: a hook body
 * sends no mail, so the grant is refused at every door that parses a hook,
 * before the hook is deployed. The runtime half (`hookBodyRunnerFactory`)
 * refuses to bind the same hook.
 *
 * Not wider: an action's body, which is the same body schema, takes the grant;
 * a hook body with every other grant parses unchanged.
 */

import { describe, expect, it } from 'vitest';
import { defineStack } from '../stack.zod';
import { HookSchema } from './hook.zod';
import { HookBodySchema } from './hook-body.zod';

const hook = (capabilities: string[]) => ({
  name: 'welcome_contact',
  object: 'crm_contact',
  events: ['afterInsert'],
  body: { language: 'js', source: "await ctx.email.send({ to: 'pat@example.test', subject: 'Hi', text: 'x' });", capabilities },
});

describe('a hook body is not granted email.send', () => {
  it('refuses the grant at parse, at the grant, saying why and where mail goes instead', () => {
    const r = HookSchema.safeParse(hook(['api.read', 'email.send']));
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues;
    expect(issues.map((i) => ({ code: i.code, path: i.path.join('.') }))).toEqual([
      { code: 'custom', path: 'body.capabilities.1' },
    ]);
    expect(issues[0].message).toContain('A hook body cannot be granted `email.send`');
    expect(issues[0].message).toContain('from an action, a job or a flow');
  });

  it('refuses it where a stack is defined too', () => {
    expect(() =>
      defineStack({ manifest: { id: 'com.acme.crm', name: 'crm', version: '1.0.0', type: 'app' }, hooks: [hook(['email.send'])] } as any),
    ).toThrow(/A hook body cannot be granted `email.send`/);
  });

  it('parses a hook body with every other grant unchanged', () => {
    const others = HookSchema.safeParse(hook(['api.read', 'api.write', 'log', 'activity.append']));
    expect(others.success, JSON.stringify(others.error?.issues ?? [])).toBe(true);
  });

  it('leaves the grant to the body schema an action takes', () => {
    const body = HookBodySchema.safeParse({ language: 'js', source: 'x', capabilities: ['email.send'] });
    expect(body.success).toBe(true);
  });
});
