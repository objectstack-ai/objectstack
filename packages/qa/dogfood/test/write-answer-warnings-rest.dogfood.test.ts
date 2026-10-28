// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.write-answer-advisories-rollback-and-tree-delete`
// acceptance[1] (#26573): a warning-severity validation hit comes back in the
// 2xx WRITE ANSWER as `warnings[]`, and a write with no hit carries no
// `warnings` key — read off the REST PATCH body, the layer the clause's oracle
// names. `packages/objectql/src/validation/advisory-write-answer.test.ts` calls
// the protocol in-process, so it never observes this body (RUNNER rule 6).
//
// The rule is the showcase's own, as shipped: `showcase_project` declares
// `project_health_progression`, a `severity: 'warning'` state machine on
// `health` (green ↔ yellow ↔ red, one step at a time), on update only. A jump
// green → red is advised, not blocked: the write lands AND the answer says so.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PROJECT = 'showcase_project';
const RULE = 'project_health_progression';
const MESSAGE = 'Health changed by more than one step — confirm this is intentional.';

type Answer = { status: number; json: any };

describe('records-forms.write-answer-advisories — the REST write answer carries the advisory', () => {
  let stack: VerifyStack;
  let token = '';
  let accountId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const createProject = async (): Promise<string> => {
    const name = `war-${Math.random().toString(36).slice(2, 8)}`;
    const created = await call('POST', `/data/${PROJECT}`, { name, account: accountId, status: 'planned', health: 'green' });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    // No update rule runs on insert, so the create answer is the first no-hit control.
    expect(Object.keys(created.json), JSON.stringify(created.json)).not.toContain('warnings');
    const [row] = await stack.rows(PROJECT, { name });
    return String(row.id);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const [account] = await stack.rows('showcase_account', { status: 'active' });
    accountId = String(account.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a health jump answers 2xx with the hit in warnings[], and the write is stored', async () => {
    const id = await createProject();
    const patched = await call('PATCH', `/data/${PROJECT}/${id}`, { health: 'red' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    expect(patched.json.warnings, JSON.stringify(patched.json)).toEqual([
      { rule: RULE, severity: 'warning', field: 'health', code: 'invalid_transition', message: MESSAGE },
    ]);
    const [row] = await stack.rows(PROJECT, { id });
    expect(row.health).toBe('red');
  });

  it('control: a one-step change answers 2xx with no warnings key', async () => {
    const id = await createProject();
    const patched = await call('PATCH', `/data/${PROJECT}/${id}`, { health: 'yellow' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    expect(Object.keys(patched.json), JSON.stringify(patched.json)).not.toContain('warnings');
    const [row] = await stack.rows(PROJECT, { id });
    expect(row.health).toBe('yellow');
  });
});
