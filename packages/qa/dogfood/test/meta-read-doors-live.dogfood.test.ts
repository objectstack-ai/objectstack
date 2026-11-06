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
//  - A member bound to the `showcase_client_liaison` position (the showcase's one FLS
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
      user_id: user.id, position: 'showcase_client_liaison', organization_id: membership?.organization_id,
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

  // A client that serialises arrays qs-style sends `?id[]=NAME` or
  // `?id[0]=NAME`. The adapter hands the key through as spelled (`id[]`), so
  // the app list's one-app filter never read it and the caller's whole list
  // came back for a request that asked for one app. It is refused like the
  // empty `?id=`: 400 VALIDATION_ERROR naming the key, no list.
  describe('GET /meta/app with a bracketed `id` key is refused, never answered with the whole list', () => {
    const appNames = (body: any): string[] => ((Array.isArray(body) ? body : body?.items) ?? []).map((a: any) => a?.name);

    for (const spelling of ['id[]', 'id[0]']) {
      it(`?${spelling}=setup: 400 VALIDATION_ERROR naming the key, for the admin and for a member`, async () => {
        for (const [who, token] of [['admin', admin], ['member', liaison]] as const) {
          const res = await stack.apiAs(token, 'GET', `/meta/app?${spelling}=setup`);
          const body: any = await res.json();
          expect({ who, status: res.status, code: codeOf(body) }, JSON.stringify(body).slice(0, 400))
            .toEqual({ who, status: 400, code: 'VALIDATION_ERROR' });
          expect(messageOf(body)).toMatch(new RegExp(`^Query parameter '${spelling.replace(/[[\]]/g, '\\$&')}' names no app`));
          expect(appNames(body)).toEqual([]);
        }
      });
    }

    it('CONTROLS — ?id=NAME is one app, ?id= and a repeated id are 400, no id is the pruned list', async () => {
      const one = await stack.apiAs(admin, 'GET', '/meta/app?id=showcase_app');
      expect(one.status).toBe(200);
      expect(appNames(await one.json())).toEqual(['showcase_app']);
      // The filter narrows: `setup` names no app on this stack, so `?id=setup`
      // is an empty list where `?id[]=setup` answered the whole one.
      const none = await stack.apiAs(admin, 'GET', '/meta/app?id=setup');
      expect(none.status).toBe(200);
      expect(appNames(await none.json())).toEqual([]);
      for (const query of ['id=', 'id=showcase_app&id=showcase_app']) {
        const res = await stack.apiAs(admin, 'GET', `/meta/app?${query}`);
        expect({ query, status: res.status, code: codeOf(await res.json()) })
          .toEqual({ query, status: 400, code: 'VALIDATION_ERROR' });
      }
      const adminList = await stack.apiAs(admin, 'GET', '/meta/app');
      const memberList = await stack.apiAs(liaison, 'GET', '/meta/app');
      expect(adminList.status).toBe(200);
      expect(memberList.status).toBe(200);
      const adminApps = appNames(await adminList.json());
      const memberApps = appNames(await memberList.json());
      expect(adminApps, JSON.stringify({ adminApps, memberApps })).toContain('showcase_app');
      expect(memberApps, JSON.stringify({ adminApps, memberApps })).toContain('showcase_app');
      expect(memberApps, 'a member never sees setup').not.toContain('setup');
    });
  });

  // The same class on the view switcher's `object` and on the list's
  // `package` scope: a bracketed key (`?object[]=`, `?package[]=`) reached the
  // door under the key as spelled, so the filter never read it, and a caller
  // who asked for one object's views (or one package's items) got every view
  // (or every package's items). Each is refused: 400 VALIDATION_ERROR naming
  // the key, no list.
  describe('GET /meta/view with a bracketed `object` key, and a list with a bracketed `package` key, are refused', () => {
    const itemsOf = (body: any): any[] => (Array.isArray(body) ? body : body?.items) ?? [];
    const OBJ = 'showcase_task';

    for (const [path, key] of [
      ['/meta/view', 'object[]'], ['/meta/view', 'object[0]'],
      ['/meta/object', 'package[]'], ['/meta/object', 'package[0]'],
    ] as const) {
      it(`${path}?${key}=…: 400 VALIDATION_ERROR naming the key, for the admin and for a member`, async () => {
        const value = key.startsWith('object') ? OBJ : PKG;
        const names = key.startsWith('object') ? 'object' : 'package';
        for (const [who, token] of [['admin', admin], ['member', liaison]] as const) {
          const res = await stack.apiAs(token, 'GET', `${path}?${key}=${encodeURIComponent(value)}`);
          const body: any = await res.json();
          expect({ who, status: res.status, code: codeOf(body) }, JSON.stringify(body).slice(0, 400))
            .toEqual({ who, status: 400, code: 'VALIDATION_ERROR' });
          expect(messageOf(body)).toMatch(new RegExp(`^Query parameter '${key.replace(/[[\]]/g, '\\$&')}' names no ${names}`));
          expect(itemsOf(body)).toEqual([]);
        }
      });
    }

    it('CONTROLS — ?object=NAME is that object\'s views and ?package=ID that package\'s items, each narrower than no filter', async () => {
      const all = itemsOf(await (await stack.apiAs(admin, 'GET', '/meta/view')).json());
      const switched = await stack.apiAs(admin, 'GET', `/meta/view?object=${OBJ}`);
      expect(switched.status).toBe(200);
      const views = itemsOf(await switched.json());
      expect(views.length, 'the showcase ships views of showcase_task').toBeGreaterThan(0);
      expect(views.every((v: any) => v?.object === OBJ), JSON.stringify(views.map((v: any) => v?.object))).toBe(true);
      expect(views.length).toBeLessThan(all.length);

      const everyPackage = itemsOf(await (await stack.apiAs(admin, 'GET', '/meta/object')).json());
      const scoped = await stack.apiAs(admin, 'GET', `/meta/object?package=${encodeURIComponent(PKG)}`);
      expect(scoped.status).toBe(200);
      const objects = itemsOf(await scoped.json());
      expect(objects.length, 'the showcase package declares objects').toBeGreaterThan(0);
      expect(objects.length).toBeLessThan(everyPackage.length);
    });
  });

  // The same class on `_drafts`' own filters: `?packageId[]=` / `?type[]=`
  // reached the door under the key as spelled, so the list was not narrowed
  // and an author who asked for one package's (or one type's) drafts got
  // every draft. Each is refused: 400 VALIDATION_ERROR naming the key, no list.
  describe('GET /meta/_drafts with a bracketed `packageId` or `type` key is refused', () => {
    const draftsOf = (body: any): any[] => body?.drafts ?? body?.data?.drafts ?? [];

    for (const [key, value, names] of [
      ['packageId[]', PKG, 'package'], ['packageId[0]', PKG, 'package'],
      ['type[]', 'view', 'metadata type'], ['type[0]', 'view', 'metadata type'],
    ] as const) {
      it(`/meta/_drafts?${key}=…: 400 VALIDATION_ERROR naming the key, for the admin`, async () => {
        const res = await stack.apiAs(admin, 'GET', `/meta/_drafts?${key}=${encodeURIComponent(value)}`);
        const body: any = await res.json();
        expect({ status: res.status, code: codeOf(body) }, JSON.stringify(body).slice(0, 400))
          .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(messageOf(body)).toMatch(new RegExp(`^Query parameter '${key.replace(/[[\]]/g, '\\$&')}' names no ${names};`));
        expect(draftsOf(body)).toEqual([]);
      });
    }

    it('CONTROLS — the plain spellings narrow, and a member is still refused at the capability gate first', async () => {
      const scoped = await stack.apiAs(admin, 'GET', `/meta/_drafts?packageId=${encodeURIComponent(PKG)}`);
      expect(scoped.status).toBe(200);
      const inPackage = draftsOf(await scoped.json());
      expect(inPackage.every((d: any) => d?.packageId === PKG), JSON.stringify(inPackage).slice(0, 400)).toBe(true);

      const typed = await stack.apiAs(admin, 'GET', '/meta/_drafts?type=view');
      expect(typed.status).toBe(200);
      const views = draftsOf(await typed.json());
      expect(views.every((d: any) => d?.type === 'view'), JSON.stringify(views).slice(0, 400)).toBe(true);

      const member = await stack.apiAs(liaison, 'GET', `/meta/_drafts?packageId[]=${encodeURIComponent(PKG)}`);
      expect(member.status).toBe(403);
    });
  });
});
