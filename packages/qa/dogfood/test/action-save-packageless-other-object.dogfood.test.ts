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
// The draft door keys the action alike: a package-less `?mode=draft` save on
// `showcase_task` writes the environment's draft, and the per-item publish
// naming no package promotes it into the environment's item (FROM: the draft
// was adopted into P and its publish overwrote P's item on `showcase_invoice`).
//
// CONTROLs: the same save on `showcase_invoice` is still P's customization,
// and a managed package's action name is still refused 403 NOT_OVERRIDABLE.
//
// The version-conflict FROM (a save carrying the version the read naming no
// package serves) is pinned in process, where that read serves `version`:
// `protocol.packageless-save-address.test.ts`. The bare REST read of an action
// is served from a cached branch that carries no `version` (its `ETag` is a
// representation hash, which no save resolves as a parent), so no leg here
// reads that token.
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
    expect(await routeTarget(`/actions/showcase_invoice/${name}`)).toEqual([400, 'pkg']);
    expect(await routeTarget(`/actions/showcase_task/${name}`)).toEqual([400, 'env']);
    // FROM: 404, the environment held no item of the name.
    expect(await routeTarget(`/actions/_env/showcase_task/${name}`)).toEqual([400, 'env']);

    // FROM pins: what does NOT move yet (#33904, the read, list and delete
    // half). Each turns when that card keys its door by object.
    // FROM: the by-name read naming no package serves P's item, never the
    // environment's row on `showcase_task`.
    expect(await read(`/meta/action/${name}`)).toEqual(['showcase_invoice', 'pkg', PKG]);
    // FROM: a package-less DELETE of the name removes P's row on
    // `showcase_invoice`, and leaves the environment's row.
    const deleted = await stack.apiAs(admin, 'DELETE', `/meta/action/${name}`);
    const deletedText = await deleted.text();
    expect(deleted.status, deletedText).toBe(200);
    expect(deletedText).toContain(`package=${PKG}`);
    // …so P no longer holds the name: the read naming P is refused 409, the
    // name held by the environment only.
    const afterDelete = await stack.apiAs(admin, 'GET', `/meta/action/${name}?package=${PKG}`);
    const afterText = await afterDelete.text();
    expect(afterDelete.status, afterText).toBe(409);
    expect(afterText).toContain('RESOURCE_CONFLICT');
    expect(await routeTarget(`/actions/_env/showcase_task/${name}`)).toEqual([400, 'env']);
  }, 120_000);

  it('the DRAFT save on `showcase_task` and its per-item publish write the environment\'s item; P\'s item on `showcase_invoice` is untouched', async () => {
    const name = 'qa_draft_other_p';
    expect((await put(`/meta/action/${name}?package=${PKG}`, action(name, 'pkg', 'showcase_invoice'))).status).toBe(200);

    const drafted = await put(`/meta/action/${name}?mode=draft`, action(name, 'env', 'showcase_task'));
    expect(drafted.status, drafted.text).toBe(200);
    // FROM: `package=com.example.qasaveother`, the draft adopted into P.
    expect(drafted.message).not.toContain('package=');
    expect(await read(`/meta/action/${name}?package=${PKG}`)).toEqual(['showcase_invoice', 'pkg', PKG]);

    const published = await stack.apiAs(admin, 'POST', `/meta/action/${name}/publish`, {});
    expect(published.status, await published.clone().text()).toBe(200);

    // FROM: `['showcase_task', 'env', PKG]`, the publish wrote P's row.
    expect(await read(`/meta/action/${name}?package=${PKG}`)).toEqual(['showcase_invoice', 'pkg', PKG]);
    expect(await routeTarget(`/actions/showcase_invoice/${name}`)).toEqual([400, 'pkg']);
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
