// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4, ruling 6902014292] Over HTTP, on a real boot of the showcase:
// a package-less `PUT /meta/action/NAME` of a name a writable package P binds
// to `showcase_invoice`, saved on `showcase_task`, writes the environment's own
// item on `showcase_task`. P's item on `showcase_invoice` stays where it is,
// and the save, the read naming P and the action route key the two items alike.
//
// FROM (main 571cf9082a, measured on this boot): the save answered
// `Saved action 'NAME' (env-wide, package=P, …)`, P's item moved to
// `showcase_task` (`?package=P` served the environment's body), and
// `/actions/_env/showcase_task/NAME` answered 404.
//
// CONTROLs: the same save on `showcase_invoice` is still P's customization,
// and a managed package's action name is still refused 403 NOT_OVERRIDABLE.
//
// The file is ISOLATED: it writes `/meta` and creates a package.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG = 'com.example.qasaveother';
const action = (name: string, label: string, objectName: string) => ({
  name, label, objectName, type: 'url', target: `https://example.invalid/${label}`, locations: ['record_more'],
});

describe('[ADR-0150 D4] a package-less action save on an object the package does not bind', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    const created = await stack.apiAs(admin, 'POST', '/packages', {
      manifest: { id: PKG, name: 'QA save other object', version: '0.1.0', type: 'app', namespace: 'qasaveother' },
    });
    expect(created.status, await created.clone().text()).toBe(201);
  }, 240_000);

  afterAll(async () => { await stack?.stop(); });

  const put = async (path: string, body: unknown) => {
    const res = await stack.apiAs(admin, 'PUT', path, body);
    const text = await res.text();
    return { status: res.status, message: String((JSON.parse(text) as any)?.message ?? (JSON.parse(text) as any)?.data?.message ?? ''), text };
  };
  /** The identity a client reads off a served action: its object, label and package. */
  const read = async (path: string) => {
    const res = await stack.apiAs(admin, 'GET', path);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    const item = body?.data?.item ?? body?.item ?? body?.data;
    return [item?.objectName ?? null, item?.label ?? null, item?._packageId ?? null];
  };
  /** The declaration the action route judges: a `url` action is refused naming its own target. */
  const routeTarget = async (path: string) => {
    const res = await stack.apiAs(admin, 'POST', path, {});
    const text = await res.text();
    return [res.status, /example\.invalid\/(\w+)/.exec(text)?.[1] ?? text.slice(0, 200)];
  };

  it('writes the environment\'s item on `showcase_task`; P\'s item on `showcase_invoice` is untouched, and the read naming P and the route agree', async () => {
    const name = 'qa_save_other_p';
    const own = await put(`/meta/action/${name}?package=${PKG}`, action(name, 'pkg', 'showcase_invoice'));
    expect(own.status, own.text).toBe(200);

    const saved = await put(`/meta/action/${name}`, action(name, 'env', 'showcase_task'));

    expect(saved.status, saved.text).toBe(200);
    // FROM: `(env-wide, package=com.example.qasaveother, state=active)`.
    expect(saved.message).not.toContain('package=');
    // FROM: `['showcase_task', 'env', PKG]`, the environment's body under P.
    expect(await read(`/meta/action/${name}?package=${PKG}`)).toEqual(['showcase_invoice', 'pkg', PKG]);
    // The by-name read naming no package is not pinned here: with P's row and
    // the environment's row both stored it serves P's item, in either save
    // order (the read side's own seam, not this save door's).
    expect(await routeTarget(`/actions/showcase_invoice/${name}`)).toEqual([400, 'pkg']);
    expect(await routeTarget(`/actions/showcase_task/${name}`)).toEqual([400, 'env']);
    // FROM: 404, the environment held no item of the name.
    expect(await routeTarget(`/actions/_env/showcase_task/${name}`)).toEqual([400, 'env']);
  }, 120_000);

  it('CONTROL: the same save on `showcase_invoice`, the object P binds, is still P\'s customization', async () => {
    const name = 'qa_save_same_p';
    expect((await put(`/meta/action/${name}?package=${PKG}`, action(name, 'pkg', 'showcase_invoice'))).status).toBe(200);

    const saved = await put(`/meta/action/${name}`, action(name, 'edited', 'showcase_invoice'));

    expect(saved.status, saved.text).toBe(200);
    expect(saved.message).toContain(`package=${PKG}`);
    expect(await read(`/meta/action/${name}?package=${PKG}`)).toEqual(['showcase_invoice', 'edited', PKG]);
  }, 120_000);

  it('CONTROL: a managed package\'s action name saved package-less on another object is still refused 403 NOT_OVERRIDABLE', async () => {
    // `showcase_mark_done` is the showcase's own action on `showcase_task`.
    const refused = await put('/meta/action/showcase_mark_done', action('showcase_mark_done', 'env', 'showcase_product'));
    expect(refused.status, refused.text).toBe(403);
    expect(refused.text).toContain('NOT_OVERRIDABLE');
    expect(await read('/meta/action/showcase_mark_done')).toEqual(['showcase_task', 'Mark Done', 'com.example.showcase']);
  }, 120_000);
});
