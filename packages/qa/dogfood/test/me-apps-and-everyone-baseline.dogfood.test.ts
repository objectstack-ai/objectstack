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
// The baseline is now anchor-safe per the D5 bit list, the everyone binding
// succeeds, and deleting records is no longer a baseline right.
//
// [#5491] The `'*'` wildcard that carried those bits is GONE entirely — not
// just its delete bit. It union-merged into every org member and erased
// app-declared explicit-allow gates on create/read/edit, so the maintainer
// narrowed the baseline to explicit-allow (2026-08-07). The two properties
// above are unaffected — the everyone binding is about the SET, not its
// grants — but the delete case below can no longer borrow its create right
// from the wildcard and now declares it. Anchor-safety of the shipped set is
// pinned statically in `plugin-security`'s `member-default-explicit-allow`
// suite; this file pins that the BINDING actually happens at bootstrap.
//
// @proof: me-apps-and-everyone-baseline

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin } from '@objectstack/plugin-security';

const SYS = { isSystem: true } as const;

describe('ADR-0090 D5 closures: /me/apps + anchor-bindable baseline', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;

  beforeAll(async () => {
    // Deliberately VANILLA: `member_default` must stay the CONFIGURED baseline,
    // because the #2753 assertion below is precisely that the bootstrap binds
    // THAT set to the `everyone` anchor. The #5491 consequence — the baseline no
    // longer grants objects — is handled where it bites, by declaring the probe's
    // create grant instead of inheriting it from a wildcard (see the delete case).
    //
    // [#7001] SAID OUT LOUD, in the argument, because it is a real dependency of
    // this file and not a background fact. It used to be silent: `bootStack`
    // built a vanilla `new SecurityPlugin()` for everyone, so this suite got the
    // platform baseline by DEFAULT while `objectstack dev` gave the same
    // showcase its own declared `showcase_member_default` — the boot-path
    // asymmetry #7001 closed. The harness now honours an app's declared default,
    // so the file that genuinely wants the platform's own baseline asks for it.
    // Nothing about the claim below changed; only who is saying it.
    stack = await bootStack(showcaseStack, { security: new SecurityPlugin() });
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

  // ── permission.tabPermissions authored end-to-end ─────────────────────────
  // Added by the 2026-07 security-subset liveness re-verification. Until then
  // this file only MENTIONED tabPermissions in its header while exercising the
  // route and requiredPermissions — and per ADR-0054, binding a ledger entry to
  // a proof that does not author the property is the preview-renderer mistake
  // in a nicer costume. This authors the property on a permission set, both
  // directions of the rank merge included.
  it('a permission set hiding an app via tabPermissions drops it from /me/apps — and a more-visible grant wins it back', async () => {
    const tabTok = await stack.signUp('tab-member@verify.test');
    const tabUser = await ql.findOne('sys_user', { where: { email: 'tab-member@verify.test' }, context: SYS });
    expect(tabUser?.id, 'dedicated tab-probe member resolved').toBeTruthy();

    // Control: before any tabPermissions grant, the member sees the app.
    const before = await stack.apiAs(tabTok, 'GET', '/me/apps');
    const beforeNames = (((await before.json()) as any)?.apps ?? []).map((a: any) => a?.name);
    expect(beforeNames, 'control: visible before any tab grant').toContain('showcase_app');

    // Author the property: a set whose ONLY job is tabPermissions.hidden.
    const hideSet = await ql.insert(
      'sys_permission_set',
      {
        name: 'tab_probe_hide',
        label: 'Tab probe — hide showcase',
        tab_permissions: JSON.stringify({ showcase_app: 'hidden' }),
      },
      { context: SYS },
    );
    const hideSetId = hideSet?.id ?? (await ql.findOne('sys_permission_set', { where: { name: 'tab_probe_hide' }, context: SYS }))?.id;
    expect(hideSetId, 'hide set stored').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: tabUser.id, permission_set_id: hideSetId }, { context: SYS });

    const hidden = await stack.apiAs(tabTok, 'GET', '/me/apps');
    const hiddenNames = (((await hidden.json()) as any)?.apps ?? []).map((a: any) => a?.name);
    expect(hiddenNames, 'tabPermissions.hidden drops the app for this principal').not.toContain('showcase_app');

    // Rank merge: hidden(0) loses to visible(3) from ANY other resolved set —
    // most-visible wins across the principal's sets, matching hono's tabRank.
    const showSet = await ql.insert(
      'sys_permission_set',
      {
        name: 'tab_probe_show',
        label: 'Tab probe — show showcase',
        tab_permissions: JSON.stringify({ showcase_app: 'visible' }),
      },
      { context: SYS },
    );
    const showSetId = showSet?.id ?? (await ql.findOne('sys_permission_set', { where: { name: 'tab_probe_show' }, context: SYS }))?.id;
    await ql.insert('sys_user_permission_set', { user_id: tabUser.id, permission_set_id: showSetId }, { context: SYS });

    const merged = await stack.apiAs(tabTok, 'GET', '/me/apps');
    const mergedNames = (((await merged.json()) as any)?.apps ?? []).map((a: any) => a?.name);
    expect(mergedNames, 'most-visible wins: a visible grant overrides the hidden one').toContain('showcase_app');

    // The probe must not leak into other principals' assertions.
    const others = await stack.apiAs(memberTok, 'GET', '/me/apps');
    const otherNames = (((await others.json()) as any)?.apps ?? []).map((a: any) => a?.name);
    expect(otherNames, 'unrelated principals are untouched by the probe sets').toContain('showcase_app');
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
    // [#5491] Where the create right comes from changed, and that is the point.
    // It used to come from `member_default`'s `'*'` grant — the baseline handed
    // every member create/read/edit on EVERY object, which is what erased
    // app-declared explicit-allow gates and what the maintainer removed. So the
    // create bit is now DECLARED, on one named object, and bound to this member
    // the same way the tab probes above bind theirs.
    //
    // The delete assertion is untouched and is still ADR-0090 D5's property: the
    // declared set deliberately carries no `allowDelete`, and the baseline may
    // not carry one (anchor-forbidden bit) — so a member's own record is still
    // undeletable. What this case can no longer be accused of is passing because
    // some wildcard happened to grant create.
    const memberUser = await ql.findOne('sys_user', { where: { email: 'baseline-member@verify.test' }, context: SYS });
    expect(memberUser?.id, 'baseline member resolved').toBeTruthy();
    const inquirySet = await ql.insert(
      'sys_permission_set',
      {
        name: 'baseline_inquiry_probe',
        label: 'Baseline probe — inquiry create, deliberately no delete',
        object_permissions: JSON.stringify({
          showcase_inquiry: { allowRead: true, allowCreate: true },
        }),
      },
      { context: SYS },
    );
    const inquirySetId = inquirySet?.id
      ?? (await ql.findOne('sys_permission_set', { where: { name: 'baseline_inquiry_probe' }, context: SYS }))?.id;
    expect(inquirySetId, 'probe set stored').toBeTruthy();
    await ql.insert(
      'sys_user_permission_set',
      { user_id: memberUser.id, permission_set_id: inquirySetId },
      { context: SYS },
    );

    const created = await stack.apiAs(memberTok, 'POST', '/data/showcase_inquiry', {
      name: 'Baseline Probe',
      email: 'baseline-probe@verify.test',
      message: 'delete-bit probe',
    });
    expect(created.status, 'the DECLARED create grant works').toBeLessThan(300);
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
