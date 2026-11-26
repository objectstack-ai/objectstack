// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0046 §6.7] The Setup app's own docs are read by exactly the callers who
// may open the Setup app — through the real `@objectstack/setup` package, on a
// real boot, over HTTP.
//
// `@objectstack/setup` registers `setup_overview` with a manual
// (`setup_manual`) whose audience is `{ systemPermission: 'setup.access' }`,
// the capability the Setup app itself requires. Before that manual, the doc was
// claimed by no book, so its audience fell back to `org`: the Console's docs
// index listed it to administrators only, but any signed-in member read its
// body at its address and through `?include=content`.
//
// Each side is proven against the app gate it is meant to match: the member is
// first shown to be refused the Setup app, the administrator to be served it.
// The unit pins of the gate itself are in `@objectstack/rest`
// (`meta-doc-system-permission-audience.test.ts`).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { createSetupAppPlugin } from '@objectstack/setup';

const stackDef = defineStack({
  manifest: {
    id: 'com.dogfood.setup-docs-audience',
    namespace: 'sda',
    version: '0.0.0',
    type: 'app',
    name: 'Setup Docs Audience Fixture',
    description: 'A host with the Setup app package, to read its docs as a member and as an administrator.',
  },
  docs: [{ name: 'sda_welcome', label: 'Welcome', content: '# Welcome\n\nThe host app\'s own page.\n' }],
} as any);

const SETUP_LINE = 'Access is additive';

const names = (body: any): string[] =>
  (Array.isArray(body) ? body : (body?.items ?? body?.data ?? [])).map((d: any) => d?.name);

describe('objectstack verify: Setup\'s docs open only for callers who can open Setup', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;

  beforeAll(async () => {
    stack = await bootStack(stackDef, { extraPlugins: [createSetupAppPlugin()] });
    admin = await stack.signIn();
    member = await stack.signUp('setup-docs-member@verify.test');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const get = async (token: string, path: string) => {
    const r = await stack.apiAs(token, 'GET', path);
    return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
  };

  it('precondition: the member is refused the Setup app, the administrator is served it', async () => {
    expect((await get(member, '/meta/app/setup')).status).toBe(403);
    expect((await get(admin, '/meta/app/setup')).status).toBe(200);
  });

  it('a member without setup.access: the Setup doc is in neither list, and its read is refused', async () => {
    const list = await get(member, '/meta/doc');
    expect(list.status).toBe(200);
    expect(names(list.body)).toContain('sda_welcome');
    expect(names(list.body)).not.toContain('setup_overview');

    const withContent = await get(member, '/meta/doc?include=content');
    expect(withContent.status).toBe(200);
    expect(names(withContent.body)).not.toContain('setup_overview');
    expect(JSON.stringify(withContent.body)).not.toContain(SETUP_LINE);

    const single = await get(member, '/meta/doc/setup_overview');
    expect(single.status, JSON.stringify(single.body)).toBe(403);
    expect(JSON.stringify(single.body)).not.toContain(SETUP_LINE);
  });

  it('control — the administrator lists it, reads its body on both doors, and opens its manual', async () => {
    expect(names((await get(admin, '/meta/doc')).body)).toContain('setup_overview');

    const withContent = await get(admin, '/meta/doc?include=content');
    expect(JSON.stringify(withContent.body)).toContain(SETUP_LINE);

    const single = await get(admin, '/meta/doc/setup_overview');
    expect(single.status, JSON.stringify(single.body)).toBe(200);
    expect(JSON.stringify(single.body)).toContain(SETUP_LINE);

    const tree = await get(admin, '/meta/book/setup_manual/tree');
    expect(tree.status, JSON.stringify(tree.body)).toBe(200);
    expect(JSON.stringify(tree.body)).toContain('setup_overview');
  });
});
