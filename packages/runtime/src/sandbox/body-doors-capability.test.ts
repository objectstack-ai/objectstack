// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A body reaches `ctx.email.send` and `ctx.activity.append` only with the
 * capability that names each, and the call reaches the door with the caller
 * the platform resolved for the body's invocation.
 */

import { describe, it, expect } from 'vitest';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import { hookBodyRunnerFactory } from './body-runner.js';
import type { ScriptRunOptions } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'send_quote' } };

async function refusalOf(run: () => Promise<unknown>): Promise<SandboxError> {
  const e = await run().then(() => null, (err) => err as SandboxError);
  expect(e, 'expected the sandbox to refuse, but the script resolved').toBeInstanceOf(SandboxError);
  return e!;
}

describe('the door capabilities gate ctx.email.send and ctx.activity.append', () => {
  for (const [token, call] of [
    ['email.send', "ctx.email.send({ to: 'pat@example.test', subject: 'Hi', text: 'x' })"],
    ['activity.append', "ctx.activity.append({ object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'x' })"],
  ] as const) {
    it(`refuses ${call.split('(')[0]} without '${token}', and never reaches the door`, async () => {
      let reached = false;
      const seam = async () => {
        reached = true;
        return {};
      };
      const err = await refusalOf(() =>
        runner.runScript(
          { language: 'js', source: `return await ${call};`, capabilities: [] },
          { input: {}, email: { send: seam }, activity: { append: seam } },
          actionOpts,
        ),
      );
      expect(err.innerMessage).toContain(`capability '${token}' not granted to action 'send_quote'`);
      expect(err.code).toBe('INSUFFICIENT_PRIVILEGES');
      expect(err.status).toBe(403);
      expect(reached).toBe(false);
    });
  }

  it('hands the body\'s input to the door and the door\'s answer back to the body', async () => {
    const got: unknown[] = [];
    const out = await runner.runScript(
      {
        language: 'js',
        source: "var r = await ctx.email.send({ to: 'pat@example.test', subject: 'Hi', text: 'x' }); return r.id + ':' + r.status;",
        capabilities: ['email.send'],
      },
      {
        input: {},
        email: {
          send: async (input: unknown) => {
            got.push(input);
            return { id: 'em_1', status: 'queued' };
          },
        },
      },
      actionOpts,
    );
    expect((out as { value: unknown }).value).toBe('em_1:queued');
    expect(got).toEqual([{ to: 'pat@example.test', subject: 'Hi', text: 'x' }]);
  });

  it('refuses a door call inside ctx.api.transaction, and serves one after it settles', async () => {
    const reached: unknown[] = [];
    const seam = async (input: unknown) => {
      reached.push(input);
      return { id: 'em_1', status: 'queued' };
    };
    const api = { object: () => ({}) };
    const err = await refusalOf(() =>
      runner.runScript(
        {
          language: 'js',
          source:
            "await ctx.api.transaction(async () => { await ctx.email.send({ to: 'pat@example.test', subject: 'Hi', text: 'x' }); });",
          capabilities: ['api.transaction', 'email.send'],
        },
        { input: {}, api, email: { send: seam } } as any,
        actionOpts,
      ),
    );
    expect(err.innerMessage).toContain('ctx.email.send cannot be called inside ctx.api.transaction');
    expect(reached).toHaveLength(0);

    const out = await runner.runScript(
      {
        language: 'js',
        source:
          "await ctx.api.transaction(async () => {}); var r = await ctx.email.send({ to: 'pat@example.test', subject: 'Hi', text: 'x' }); return r.status;",
        capabilities: ['api.transaction', 'email.send'],
      },
      { input: {}, api, email: { send: seam } } as any,
      actionOpts,
    );
    expect((out as { value: unknown }).value).toBe('queued');
    expect(reached).toHaveLength(1);
  });

  it('tells a body on a host with no door that the door is not available', async () => {
    const err = await refusalOf(() =>
      runner.runScript(
        {
          language: 'js',
          source: "return await ctx.activity.append({ object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'x' });",
          capabilities: ['activity.append'],
        },
        { input: {} },
        actionOpts,
      ),
    );
    expect(err.innerMessage).toContain('ctx.activity.append is not available here');
  });
});

describe('a hook body\'s timeline entry carries the user whose write fired it, and a hook body sends no mail', () => {
  const mailService = (sent: unknown[]) => ({
    getDefaultFrom: () => ({ name: 'Acme CRM', address: 'noreply@acme.test' }),
    send: async (input: unknown) => {
      sent.push(input);
      return { id: 'em_1', status: 'queued' };
    },
  });

  it('stamps the session\'s user and organization, and the hook as the origin', async () => {
    const appended: any[] = [];
    const ql = { findOne: async (object: string, query: any) => (object === 'crm_contact' ? { id: query.where.id } : null) };
    const getService = (name: string): unknown =>
      name === 'audit'
        ? {
            appendAppActivity: async (entry: unknown, stamp: unknown) => {
              appended.push({ entry, stamp });
              return { id: 'act_1' };
            },
          }
        : undefined;
    const factory = hookBodyRunnerFactory(runner, { ql, appId: 'com.acme.crm', getService } as any);
    const fn = factory({
      name: 'note_new_contact',
      object: 'crm_contact',
      events: ['afterInsert'],
      body: {
        language: 'js',
        source: "await ctx.activity.append({ object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Welcomed' });",
        capabilities: ['activity.append'],
      },
    } as any);
    await fn!({
      object: 'crm_contact',
      event: 'afterInsert',
      input: {},
      result: { id: 'c1' },
      session: { userId: 'usr_ann', organizationId: 'org_acme' },
    } as any);

    expect(appended).toEqual([
      {
        entry: { object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Welcomed' },
        stamp: { actorId: 'usr_ann', organizationId: 'org_acme', origin: 'com.acme.crm/hook:note_new_contact' },
      },
    ]);
  });

  it('refuses to bind a hook body granted email.send', () => {
    const sent: unknown[] = [];
    const getService = (name: string): unknown => (name === 'email' ? mailService(sent) : undefined);
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'com.acme.crm', getService } as any);
    let thrown: any;
    try {
      factory({
        name: 'mail_new_contact',
        object: 'crm_contact',
        events: ['afterInsert'],
        body: {
          language: 'js',
          source: "await ctx.email.send({ to: 'pat@example.test', subject: 'Welcome', text: 'Hello' });",
          capabilities: ['email.send'],
        },
      } as any);
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.message).toContain("Hook 'mail_new_contact' was not bound: its body is granted `email.send`");
    expect(thrown).toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    expect(sent).toHaveLength(0);
  });

  it('refuses a hook body\'s mail call it was not granted, and sends nothing', async () => {
    const sent: unknown[] = [];
    const getService = (name: string): unknown => (name === 'email' ? mailService(sent) : undefined);
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'com.acme.crm', getService } as any);
    const fn = factory({
      name: 'mail_new_contact',
      object: 'crm_contact',
      events: ['afterInsert'],
      body: { language: 'js', source: "await ctx.email.send({ to: 'pat@example.test', subject: 'Welcome', text: 'Hello' });" },
    } as any);
    const err: any = await fn!({
      object: 'crm_contact',
      event: 'afterInsert',
      input: {},
      result: { id: 'c1' },
      session: { userId: 'usr_ann', organizationId: 'org_acme' },
    } as any).then(
      () => null,
      (x: unknown) => x,
    );
    expect(String(err?.innerMessage ?? err?.message ?? err)).toContain("capability 'email.send' not granted to hook 'mail_new_contact'");
    expect(sent).toHaveLength(0);
  });

  it('names the package that holds the body in the origin, not the bundle', async () => {
    const appended: any[] = [];
    const getService = (name: string): unknown =>
      name === 'audit'
        ? {
            appendAppActivity: async (entry: unknown, stamp: unknown) => {
              appended.push({ entry, stamp });
              return { id: 'act_1' };
            },
          }
        : undefined;
    const ql = { findOne: async (_object: string, query: any) => ({ id: query.where.id }) };
    const factory = hookBodyRunnerFactory(runner, {
      ql,
      appId: 'com.acme.bundle',
      originPackageId: 'com.acme.crm',
      getService,
    } as any);
    const fn = factory({
      name: 'note_contact',
      object: 'crm_contact',
      events: ['afterInsert'],
      body: {
        language: 'js',
        source: "await ctx.activity.append({ object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'x' });",
        capabilities: ['activity.append'],
      },
    } as any);
    await fn!({ object: 'crm_contact', event: 'afterInsert', input: {}, result: { id: 'c1' }, session: { userId: 'usr_ann', organizationId: 'org_acme' } } as any);
    expect(appended[0].stamp.origin).toBe('com.acme.crm/hook:note_contact');
  });
});
