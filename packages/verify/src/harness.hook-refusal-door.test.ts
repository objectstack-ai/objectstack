// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33214 (ruling 6879477573, 问一 A) — a hook's declared refusal catalogue
 * answers the same on both doors of `bootStack`, under `Accept-Language:
 * zh-CN`: the source boot, where the hook's inline `handler` runs in-process
 * (an app's own test harness), and the artifact door, where the `body` the
 * build lowered it to runs in the sandbox, as `objectstack dev` serves it.
 *
 * Measured before (`origin/main` e540baf887): the configuration did not load at
 * all — `defineStack` refused `refusals` on a hook with no `js` body — and once
 * accepted, the in-process handler's throw would have reached the caller as the
 * handler's own English error, never the catalogue.
 *
 * Pinned on each door, for one `beforeInsert` that refuses three ways:
 *
 *  - a declared code with a translation: the zh-CN sentence and the code;
 *  - a declared reason under a registered code, with a declared param: the
 *    zh-CN reason sentence, its hole filled, the wire code unchanged;
 *  - the two doors' envelopes are byte-identical.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';
// The boot's dynamic loads, paid at collection rather than inside a clocked case.
import '@objectstack/service-datasource';
import '@objectstack/service-automation';

const BOOT_TIMEOUT = 120_000;

const manifest = { id: 'com.example.hook-refusal-door', name: 'Hook Refusal Door', namespace: 'hrd', version: '1.0.0', type: 'app' };

const plan = {
  name: 'hrd_plan', label: 'Plan', pluralLabel: 'Plans', sharingModel: 'public_read_write',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    state: { name: 'state', type: 'text', label: 'State' },
  },
};

const refusals = {
  CREDIT_LIMIT: { message: 'This plan exceeds the credit limit.' },
  VALIDATION_FAILED: {
    message: 'This plan cannot be saved.',
    params: ['state'],
    reasons: { plan_locked: { message: 'The plan is {{ state }} and can no longer change.' } },
  },
};

const translations = [
  {
    'zh-CN': {
      hooks: {
        hrd_plan_gate: {
          refusals: {
            CREDIT_LIMIT: { message: '该计划超出信用额度。' },
            VALIDATION_FAILED: { reasons: { plan_locked: { message: '计划处于{{ state }}状态，不能再修改。' } } },
          },
        },
      },
    },
  },
];

/** One statement set, run in-process by the handler and in the sandbox by the body. */
const SOURCE = [
  "if (ctx.input.state === 'over') throw Object.assign(new Error('internal'), { code: 'CREDIT_LIMIT' });",
  "if (ctx.input.state === '锁定') throw Object.assign(new Error('internal'), { code: 'VALIDATION_FAILED', reason: 'plan_locked', params: { state: ctx.input.state } });",
].join('\n');

type GateCtx = { input: Record<string, unknown> };

/** The configuration: the hook is an inline TypeScript handler, which a source boot runs in-process. */
const app = (): Record<string, unknown> =>
  defineStack({
    manifest,
    objects: [plan],
    hooks: [
      {
        name: 'hrd_plan_gate',
        object: 'hrd_plan',
        events: ['beforeInsert'],
        handler: async (ctx: GateCtx) => {
          if (ctx.input.state === 'over') throw Object.assign(new Error('internal'), { code: 'CREDIT_LIMIT' });
          if (ctx.input.state === '锁定') {
            throw Object.assign(new Error('internal'), {
              code: 'VALIDATION_FAILED',
              reason: 'plan_locked',
              params: { state: ctx.input.state },
            });
          }
        },
        refusals,
      },
    ],
    translations,
  } as never) as unknown as Record<string, unknown>;

/** The artifact: the same app, its hook carrying the same statements as a `body`. */
const artifact = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      defineStack({
        manifest,
        objects: [plan],
        hooks: [
          {
            name: 'hrd_plan_gate',
            object: 'hrd_plan',
            events: ['beforeInsert'],
            body: { language: 'js', source: SOURCE, capabilities: [] },
            refusals,
          },
        ],
        translations,
      } as never),
    ),
  ) as Record<string, unknown>;

let hostRoot: string;
beforeAll(() => {
  hostRoot = mkdtempSync(join(tmpdir(), 'verify-hook-refusal-door-'));
  mkdirSync(join(hostRoot, 'dist'));
  writeFileSync(join(hostRoot, 'dist', 'objectstack.json'), JSON.stringify(artifact()));
});
afterAll(() => {
  if (hostRoot) rmSync(hostRoot, { recursive: true, force: true });
});

const live: VerifyStack[] = [];
afterEach(async () => {
  for (const stack of live.splice(0)) await stack.stop();
});

/** The two refusals as a zh-CN caller reads them, over REST. */
const refusalsOn = async (stack: VerifyStack): Promise<Array<{ status: number; body: any }>> => {
  live.push(stack);
  const token = await stack.signIn();
  const insert = async (state: string) => {
    const res = await stack.api('/data/hrd_plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Accept-Language': 'zh-CN' },
      body: JSON.stringify({ name: 'P1', state }),
    });
    return { status: res.status, body: await res.json() };
  };
  return [await insert('over'), await insert('锁定')];
};

describe('#33214: a hook\'s refusal catalogue answers the same on both bootStack doors, in zh-CN', () => {
  let viaArtifact: Array<{ status: number; body: any }>;

  it('the artifact door: the body, in the sandbox, as `objectstack dev` serves it', async () => {
    viaArtifact = await refusalsOn(await bootStack(app(), { hostRoot, artifact: 'dist/objectstack.json' }));
    const [over, locked] = viaArtifact;
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('VALIDATION_ERROR');
    expect(over.body.declaredCode).toBe('CREDIT_LIMIT');
    expect(over.body.userMessage).toBe('该计划超出信用额度。');
    expect(locked.status).toBe(400);
    expect(locked.body.code).toBe('VALIDATION_FAILED');
    expect(locked.body.userMessage).toBe('计划处于锁定状态，不能再修改。');
    expect(JSON.stringify(viaArtifact)).not.toContain('internal');
  }, BOOT_TIMEOUT);

  it('the source door: the inline handler, in-process, answers byte-for-byte the same', async () => {
    const viaSource = await refusalsOn(await bootStack(app(), { hostRoot }));
    expect(viaSource[0].body.userMessage).toBe('该计划超出信用额度。');
    expect(viaSource[1].body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(viaSource)).toBe(JSON.stringify(viaArtifact));
  }, BOOT_TIMEOUT);
});
