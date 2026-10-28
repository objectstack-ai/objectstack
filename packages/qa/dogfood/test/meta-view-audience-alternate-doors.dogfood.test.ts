// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.meta-authoring-trail-and-audience-gates`,
// acceptance[2] and negative[0], over HTTP on the stock showcase.
//
// A view that names `requiredPermissions` is served only to a caller holding
// every one of them (#22639). `meta-view-dashboard-audience-gate.test.ts`
// drives RestServer over a mock protocol and covers the list prune, the plain
// by-name refusal and the cached arm; it has no `/published`, `/layers` or
// `?state=draft` door, no `/history` leg for an authoring-trail holder, and no
// real ETag path. This file drives those doors on a booted showcase:
//
//   - a scratch list view `showcase_task.qa_gated_view` gated on a capability
//     neither member holds, saved by the admin with a pending draft;
//   - a `setup.access`-only member: the view is absent from `GET /meta/view`,
//     and every by-name door (plain, `/published`, `/layers`, `?state=draft`)
//     answers 403 PERMISSION_DENIED; `/history` answers 403 FORBIDDEN, the
//     authoring-trail gate refusing first;
//   - a `studio.access` member (admitted by the trail gate): `/history`
//     answers the audience refusal, 403 PERMISSION_DENIED;
//   - the admin reads the view on every door (the control);
//   - negative[0]: the admin's ETag replayed by the member as `If-None-Match`
//     is never a 304.
//
// acceptance[1] (setup.access-only on history/audit/diff/commits) is pinned
// by `wall-authoring-trail-doors.dogfood.test.ts`. Isolated boot: the file
// saves metadata.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const VIEW = 'showcase_task.qa_gated_view';
const ITEM = `/meta/view/${VIEW}`;
/** A declared capability the admin holds and neither member does. */
const GATE = 'manage_users';
const SETUP_SET = 'qa_audience_setup_only';
const STUDIO_SET = 'qa_audience_studio';

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('a gated view on every alternate /meta door (#22639)', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let setupOnly: string;
  let studio: string;

  const read = async (token: string, path: string, headers: Record<string, string> = {}) => {
    const res = await stack.raw(`/api/v1${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, ...headers } });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, text, etag: res.headers.get('etag') };
  };

  const grant = async (email: string, set: string) => {
    const token = await stack.signUp(email);
    const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(userId, `${email} provisioned`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: set }, { context: SYS });
    return token;
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    for (const [name, caps] of [[SETUP_SET, ['setup.access']], [STUDIO_SET, ['studio.access']]] as const) {
      const saved = await stack.apiAs(admin, 'PUT', `/meta/permission/${name}`, { name, label: name, objects: {}, systemPermissions: [...caps] });
      expect(saved.status, await saved.clone().text()).toBe(200);
    }
    setupOnly = await grant('audience-setup@verify.test', SETUP_SET);
    studio = await grant('audience-studio@verify.test', STUDIO_SET);

    const body = {
      name: VIEW, object: 'showcase_task', viewKind: 'list', type: 'grid',
      label: 'QA gated view', columns: ['title'], requiredPermissions: [GATE],
    };
    const published = await stack.apiAs(admin, 'PUT', ITEM, body);
    expect(published.status, await published.clone().text()).toBe(200);
    const draft = await stack.apiAs(admin, 'PUT', `${ITEM}?mode=draft`, { ...body, label: 'QA gated view (draft)' });
    expect(draft.status, await draft.clone().text()).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('guard the guard: neither member holds the gate; the setup member lacks the trail capabilities, the studio member holds studio.access', async () => {
    const perms = async (token: string) => {
      const p = (await (await stack.apiAs(token, 'GET', '/auth/me/permissions')).json()) as any;
      return ((p?.data ?? p)?.systemPermissions ?? []) as string[];
    };
    const setup = await perms(setupOnly);
    expect(setup).toContain('setup.access');
    expect(setup).not.toContain(GATE);
    expect(setup).not.toContain('studio.access');
    expect(setup).not.toContain('manage_metadata');
    const st = await perms(studio);
    expect(st).toContain('studio.access');
    expect(st).not.toContain(GATE);
    expect(await perms(admin)).toContain(GATE);
  });

  it('the gated view is absent from the member\'s list and present in the admin\'s', async () => {
    const namesOf = (b: any) => ((b?.items ?? b?.data ?? b) as any[]).map((x: any) => x?.name);
    const member = await read(setupOnly, '/meta/view');
    expect(member.status, member.text).toBe(200);
    expect(namesOf(member.body)).not.toContain(VIEW);
    const control = await read(admin, '/meta/view');
    expect(namesOf(control.body)).toContain(VIEW);
  });

  for (const [door, path] of [
    ['by name', ITEM],
    ['/published', `${ITEM}/published`],
    ['/layers', `${ITEM}/layers`],
    ['?state=draft', `${ITEM}?state=draft`],
  ] as const) {
    it(`${door}: the member is refused 403 PERMISSION_DENIED; the admin reads it`, async () => {
      const member = await read(setupOnly, path);
      expect([member.status, codeOf(member.body)], member.text).toEqual([403, 'PERMISSION_DENIED']);
      const control = await read(admin, path);
      expect(control.status, control.text).toBe(200);
    });
  }

  it('/history: a member the trail gate refuses gets 403 FORBIDDEN first; a studio.access member gets the audience refusal; the admin reads it', async () => {
    const setup = await read(setupOnly, `${ITEM}/history`);
    expect([setup.status, codeOf(setup.body)], setup.text).toEqual([403, 'FORBIDDEN']);
    const st = await read(studio, `${ITEM}/history`);
    expect([st.status, codeOf(st.body)], st.text).toEqual([403, 'PERMISSION_DENIED']);
    const control = await read(admin, `${ITEM}/history`);
    expect(control.status, control.text).toBe(200);
  });

  it('negative[0]: the admin\'s ETag replayed by the member is never a 304', async () => {
    const control = await read(admin, ITEM);
    expect(control.status).toBe(200);
    expect(control.etag, 'the admin\'s read carries a validator').toBeTruthy();
    const replay = await read(setupOnly, ITEM, { 'if-none-match': control.etag! });
    expect(replay.status, 'a stale validator buys no 304').not.toBe(304);
    expect([replay.status, codeOf(replay.body)]).toEqual([403, 'PERMISSION_DENIED']);
    // Control: the admin's own validator IS a 304, so the replay above was a real one.
    expect((await read(admin, ITEM, { 'if-none-match': control.etag! })).status).toBe(304);
  });
});
