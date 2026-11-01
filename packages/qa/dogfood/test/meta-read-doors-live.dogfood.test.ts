// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.meta-read-doors-v18` acceptance[1]–[4] over the real
// HTTP stack of a booted showcase. The item's other pins drive the protocol,
// the RestServer route handlers or the dispatcher with a stub server and
// response, and none boots the Hono adapter, so every `api` clause scored
// partial. These are the item's steps, through the door a client reaches:
//
//  - GET /meta/app/com.example.showcase answers the showcase's app by its
//    package id; an unknown package answers the same 404 as an unknown name.
//  - `?member=` reads one bundle member: after the zh-CN member of
//    `showcase_task_done_email` is authored (PUT with `locale` in the BODY —
//    the save door takes no `?member=`), `?member=zh-CN` reads it and
//    `?member=en-US` the shipped one. On a type with no bundle members
//    (`object`) it is 400 VALIDATION_ERROR, and an unknown parameter on a
//    by-name door is 400 naming it.
//  - `?package=all` on a list door answers byte-identically to no parameter.
//  - A member bound to the `client_liaison` position (the showcase's one FLS
//    persona: `showcase_client_liaison` withholds budget, spent and
//    budget_remaining on showcase_project) reads a definition whose
//    `sortability.fields` does not list `budget` at all, and the data sort on
//    `budget` is 403 — the two agree. The admin's definition offers `budget`
//    (the CONTROL that the field is sortable for a caller who may read it).
//
// This file writes /meta (the zh-CN member), so it boots its own showcase.
//
// [#28576] ADR-0146 D11 closed the package-less write onto a packaged item, so
// the zh-CN member is authored into the showcase's `.custom` pair. The base
// ships `en-US` only, so the member declares no `overrides`: it is the pair's
// own member, and the by-name read serves it the same.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { ensurePair, inPair } from './customization-pair.js';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { context: { isSystem: true } } as const;
const PKG = 'com.example.showcase';
const TEMPLATE = 'showcase_task_done_email';
const ZH_SUBJECT = 'mrd-live zh-CN subject';
const LIAISON_EMAIL = 'mrd-live-liaison@verify.test';

const codeOf = (b: any): string | undefined => (b?.error && typeof b.error === 'object' ? b.error.code : b?.code);
const messageOf = (b: any): string => String(b?.error && typeof b.error === 'object' ? b.error.message : b?.error ?? b?.message ?? '');

describe('[#26572] the v18 /meta read doors, over HTTP on a booted showcase', () => {
  let stack: VerifyStack;
  let admin = '';
  let liaison = '';

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    admin = await stack.signIn();
    liaison = await stack.signUp(LIAISON_EMAIL);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    const user = await ql.findOne('sys_user', { where: { email: LIAISON_EMAIL }, ...SYS });
    const membership = await ql.findOne('sys_member', { where: { user_id: user.id }, ...SYS });
    // The assignment carries the holder's organization, as a write through a
    // door does: an unstamped row is UNKNOWN tenancy.
    await ql.insert('sys_user_position', {
      user_id: user.id, position: 'client_liaison', organization_id: membership?.organization_id,
    }, SYS);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  describe('acceptance[1] — GET /meta/app/PACKAGE_ID', () => {
    it('answers the showcase\'s app, by its own name', async () => {
      const res = await stack.apiAs(admin, 'GET', `/meta/app/${PKG}`);
      const body: any = await res.json();
      expect(res.status, JSON.stringify(body).slice(0, 400)).toBe(200);
      expect(body.name).toBe('showcase_app');
      expect(body.item?.name).toBe('showcase_app');
    });

    it('an unknown package answers the same 404 as an unknown name', async () => {
      const unknownPkg = await stack.apiAs(admin, 'GET', '/meta/app/com.unknown.pkg');
      const unknownName = await stack.apiAs(admin, 'GET', '/meta/app/no_such_app_mrd_live');
      expect(unknownPkg.status).toBe(404);
      expect(unknownName.status).toBe(404);
      expect(await unknownPkg.json()).toEqual(await unknownName.json());
    });
  });

  describe('acceptance[2] — `?member=` and the closed by-name query set', () => {
    it('setup: the zh-CN member is authored through the save door, the locale in the body', async () => {
      const read = await stack.apiAs(admin, 'GET', `/meta/email_template/${TEMPLATE}`);
      expect(read.status).toBe(200);
      const shipped: Record<string, unknown> = ((await read.json()) as any).item;
      const authored = Object.fromEntries(Object.entries(shipped).filter(([k]) => !k.startsWith('_')));
      await ensurePair(stack, admin, PKG);
      const res = await stack.apiAs(admin, 'PUT', inPair(`/meta/email_template/${TEMPLATE}`, PKG), {
        ...authored, locale: 'zh-CN', subject: ZH_SUBJECT, bodyText: 'mrd-live zh-CN body', bodyHtml: '<p>mrd-live zh-CN body</p>',
      });
      expect(res.status, await res.clone().text()).toBe(200);
    });

    it('?member=zh-CN reads only that member, ?member=en-US the shipped one', async () => {
      const zh = await stack.apiAs(admin, 'GET', `/meta/email_template/${TEMPLATE}?member=zh-CN`);
      const zhBody: any = await zh.json();
      expect(zh.status, JSON.stringify(zhBody)).toBe(200);
      expect({ locale: zhBody.item?.locale, subject: zhBody.item?.subject }).toEqual({ locale: 'zh-CN', subject: ZH_SUBJECT });

      const en = await stack.apiAs(admin, 'GET', `/meta/email_template/${TEMPLATE}?member=en-US`);
      const enBody: any = await en.json();
      expect(en.status, JSON.stringify(enBody)).toBe(200);
      expect(enBody.item?.locale).toBe('en-US');
      expect(enBody.item?.subject).not.toBe(ZH_SUBJECT);
    });

    it('?member= on a type with no bundle members (object): 400 VALIDATION_ERROR naming the selector', async () => {
      const res = await stack.apiAs(admin, 'GET', '/meta/object/showcase_task?member=x');
      const body: any = await res.json();
      expect({ status: res.status, code: codeOf(body) }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(messageOf(body)).toContain('"member"');
    });

    it('an unknown parameter on a by-name door: 400 VALIDATION_ERROR naming it', async () => {
      const res = await stack.apiAs(admin, 'GET', '/meta/object/showcase_task?memeber=x');
      const body: any = await res.json();
      expect({ status: res.status, code: codeOf(body) }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(messageOf(body)).toContain('"memeber"');
    });

    it('CONTROL — the same by-name door with no parameter answers 200', async () => {
      const res = await stack.apiAs(admin, 'GET', '/meta/object/showcase_task');
      expect(res.status, await res.clone().text()).toBe(200);
    });
  });

  describe('acceptance[3] — `?package=all` folds to the no-parameter answer', () => {
    it('GET /meta/view?package=all is byte-identical to GET /meta/view, and lists items', async () => {
      const all = await stack.apiAs(admin, 'GET', '/meta/view?package=all');
      const plain = await stack.apiAs(admin, 'GET', '/meta/view');
      expect(all.status).toBe(200);
      expect(plain.status).toBe(200);
      const allText = await all.text();
      expect(allText).toBe(await plain.text());
      const ids = ((JSON.parse(allText) as any).items ?? []).map((i: any) => i?.name);
      expect(ids.length).toBeGreaterThan(0);
    });
  });

  describe('acceptance[4] — an FLS-denied field is never offered as sortable, and the data sort on it is refused', () => {
    const sortability = async (token: string): Promise<Record<string, { sortable?: boolean }>> => {
      const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_project');
      expect(res.status, await res.clone().text()).toBe(200);
      const body: any = await res.json();
      return (body.sortability ?? body.item?.sortability ?? body.data?.sortability)?.fields ?? {};
    };

    it('client_liaison: budget is ABSENT from sortability.fields (not listed as sortable: false)', async () => {
      const fields = await sortability(liaison);
      expect(Object.keys(fields).length).toBeGreaterThan(0);
      expect(Object.keys(fields)).not.toContain('budget');
      expect(fields.name?.sortable).toBe(true);
    });

    it('client_liaison: GET /data/showcase_project?sort=budget is 403 PERMISSION_DENIED — the two agree', async () => {
      const res = await stack.apiAs(liaison, 'GET', '/data/showcase_project?sort=budget');
      const body: any = await res.json();
      expect({ status: res.status, code: codeOf(body) }, JSON.stringify(body)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      const control = await stack.apiAs(liaison, 'GET', '/data/showcase_project?sort=name');
      expect(control.status, 'CONTROL: a sort on a readable field is served').toBe(200);
    });

    it('CONTROL — the admin\'s definition offers budget as sortable', async () => {
      expect((await sortability(admin)).budget?.sortable).toBe(true);
    });
  });
});
