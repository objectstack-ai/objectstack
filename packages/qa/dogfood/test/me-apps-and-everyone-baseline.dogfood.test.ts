// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Two ADR-0090 D5 closures, proven on the served showcase stack:
//
// #2752 — GET /me/apps used to read `metadata.list('app')` while stack apps
// live in the ENGINE REGISTRY, returning [] for every principal — leaving
// `tabPermissions` and `AppSchema.requiredPermissions` with no enforced
// consumer. It now sources the registry (same authority as the meta routes):
// a plain member sees the showcase app but NOT a `requiredPermissions`-gated
// platform app they hold no capability for.
//
// #2753 — the built-in `member_default` baseline carried an anchor-forbidden
// `allowDelete` on `'*'`, so the bootstrap REFUSED to bind it to the
// `everyone` position on every boot and the baseline flowed only through the
// separate fallback channel (the "second distribution channel" D5 rejected).
// The wildcard is now delete-free (anchor-safe per the D5 bit list), the
// everyone binding succeeds, and deleting records is no longer a baseline
// right.
//
// @proof: me-apps-and-everyone-baseline

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true } as const;

describe('ADR-0090 D5 closures: /me/apps + anchor-bindable baseline', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('baseline-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ── #2752: /me/apps sources the engine registry ───────────────────────────
  it('a plain member sees the showcase app in /me/apps (was [] for everyone)', async () => {
    const r = await stack.apiAs(memberTok, 'GET', '/me/apps');
    expect(r.status).toBe(200);
    const body: any = await r.json();
    const names = (body?.apps ?? []).map((a: any) => a?.name);
    expect(names, 'registry-sourced app list').toContain('showcase_app');
  });

  it('requiredPermissions still gates: the member does not see capability-gated apps', async () => {
    const r = await stack.apiAs(memberTok, 'GET', '/me/apps');
    const body: any = await r.json();
    const gated = (body?.apps ?? []).filter(
      (a: any) => Array.isArray(a?.requiredPermissions) && a.requiredPermissions.length > 0,
    );
    // The member holds no systemPermissions — every listed app must be ungated.
    expect(gated.map((a: any) => a.name), 'no capability-gated app leaks to a plain member').toEqual([]);
  });

  it('anonymous callers get an empty list', async () => {
    const r = await stack.api('/me/apps');
    const body: any = await r.json();
    expect(body?.apps ?? []).toEqual([]);
  });

  // ── #2753: the baseline binds to the everyone anchor at bootstrap ────────
  it('bootstrap binds member_default to the everyone position (one channel, D5)', async () => {
    const everyone = await ql.findOne('sys_position', { where: { name: 'everyone' }, context: SYS });
    const baseline = await ql.findOne('sys_permission_set', { where: { name: 'member_default' }, context: SYS });
    expect(everyone?.id && baseline?.id, 'anchor + baseline seeded').toBeTruthy();
    const binding = await ql.findOne('sys_position_permission_set', {
      where: { position_id: everyone.id, permission_set_id: baseline.id },
      context: SYS,
    });
    expect(binding, 'everyone ← member_default binding row exists (bootstrap no longer refuses)').toBeTruthy();
  });

  it('deleting records is no longer a baseline right (anchor-forbidden bit removed)', async () => {
    // The member can still create their own record…
    const created = await stack.apiAs(memberTok, 'POST', '/data/showcase_inquiry', {
      name: 'Baseline Probe',
      email: 'baseline-probe@verify.test',
      message: 'delete-bit probe',
    });
    expect(created.status, 'baseline create still works').toBeLessThan(300);
    const body: any = await created.json();
    const id = body?.id ?? body?.record?.id;
    expect(id).toBeTruthy();

    // …but DELETE is refused even on their OWN record: delete/purge/transfer
    // are not baseline bits (ADR-0090 D5). Domains that want member deletes
    // grant them per object via an ordinary position-distributed set.
    const del = await stack.apiAs(memberTok, 'DELETE', `/data/showcase_inquiry/${id}`);
    expect(del.status, 'baseline delete refused').not.toBeLessThan(300);
  });
});
