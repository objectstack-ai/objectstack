// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — one shared picklist, two objects, two packages, booted for
// real and driven through the HTTP doors a client uses (the ADR-0054 runtime proof).
//
// The picklist kind lets several select fields name ONE option list
// (`Field.select({ picklist: 'industry' })`) instead of copying `options` into
// each, and lets another package ADD values to it (`picklistExtensions`). The
// runtime owes four things for that, and this file asserts them on one booted
// artifact rather than one unit at a time:
//
//   1. the served field carries the RESOLVED options — the owner's list plus
//      the extension's value — with `picklist` kept, on both objects;
//   2. object A accepts a write of the value the EXTENSION added;
//   3. object B refuses a value outside the set, and the refusal names the
//      picklist;
//   4. a locale switch relabels the options, through the list's own
//      translations (`picklists.<name>.options.<value>`), inherited by every
//      field bound to it.
//
// Every one of those is green in a unit test with a hand-built registry. What
// only a boot sees is the assembly: `composeStacks(…, { manifest: 'preserve' })`
// emitting the two package bodies, the artifact load registering them in
// dependency order, the ObjectQL fold the `/meta` read and the write door
// share, and the REST localization boundary reading the resolved field.
//
// Boots a fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { composeStacks, defineStack } from '@objectstack/spec';

const CORE = 'com.dogfood.picklist.core';
const HEALTH = 'com.dogfood.picklist.health';

/** The owning package: the list, its translations, and object A. */
const coreStack = defineStack({
  manifest: {
    id: CORE,
    namespace: 'dfp',
    version: '0.0.0',
    type: 'app',
    name: 'Picklist Core',
    description: 'Owns the shared industry picklist and the account object.',
  },
  picklists: [
    {
      name: 'industry',
      label: 'Industry',
      options: [
        { label: 'Technology', value: 'technology' },
        { label: 'Finance', value: 'finance' },
      ],
    },
  ],
  objects: [
    {
      name: 'dfp_account',
      label: 'Account',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        industry: { type: 'select', label: 'Industry', picklist: 'industry' },
      },
    },
  ],
  translations: [
    {
      'zh-CN': {
        picklists: {
          industry: {
            label: '行业',
            options: { technology: '科技', finance: '金融', healthcare: '医疗' },
          },
        },
      },
    },
  ],
});

/** A second package: adds a value to the list it does not own, and binds object B to it. */
const healthStack = defineStack({
  manifest: {
    id: HEALTH,
    namespace: 'dfp',
    version: '0.0.0',
    type: 'module',
    name: 'Picklist Health',
    description: 'Extends the industry picklist and binds the lead object to it.',
    dependencies: { [CORE]: '0.0.0' },
  },
  picklistExtensions: [{ extend: 'industry', options: [{ label: 'Healthcare', value: 'healthcare' }] }],
  objects: [
    {
      name: 'dfp_lead',
      label: 'Lead',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        industry: { type: 'select', label: 'Industry', picklist: 'industry' },
      },
    },
  ],
});

const artifact = composeStacks([healthStack, coreStack], { manifest: 'preserve' });

describe('dogfood: one shared picklist, two objects, a package extension', () => {
  let stack: VerifyStack;
  let token: string;

  /** A `/meta` read of one object, in a stated language. */
  const metaIn = async (locale: string | undefined, object: string): Promise<any> => {
    const res = await stack.api(`/meta/object/${object}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(locale ? { 'Accept-Language': locale } : {}),
      },
    });
    expect(res.status, `GET /meta/object/${object}`).toBe(200);
    // The by-name read answers `{ type, name, item }`; the object is `item`.
    const body: any = await res.json();
    expect(body?.item?.name, JSON.stringify(body).slice(0, 300)).toBe(object);
    return body.item;
  };

  beforeAll(async () => {
    stack = await bootStack(artifact);
    token = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('serves both objects with the resolved options — the owner\'s and the extension\'s — and keeps `picklist`', async () => {
    for (const object of ['dfp_account', 'dfp_lead']) {
      const field = (await metaIn(undefined, object))?.fields?.industry;
      expect(field?.picklist, object).toBe('industry');
      expect(field?.options, object).toEqual([
        { label: 'Technology', value: 'technology' },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
      ]);
    }
  });

  it('object A accepts the value the extension added', async () => {
    const res = await stack.apiAs(token, 'POST', '/data/dfp_account', { name: 'Clinic Co', industry: 'healthcare' });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const body: any = await res.json();
    const id = body.record?.id ?? body.id;
    const read = await stack.apiAs(token, 'GET', `/data/dfp_account/${id}`);
    const row: any = await read.json();
    expect(row.record?.industry ?? row.industry).toBe('healthcare');
  });

  it('object B refuses a value outside the set, and the refusal names the picklist', async () => {
    const res = await stack.apiAs(token, 'POST', '/data/dfp_lead', { name: 'Shop Co', industry: 'retail' });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields?.[0]).toMatchObject({ field: 'industry', code: 'invalid_option' });
    expect(body.fields?.[0]?.message).toBe('Industry must be one of the values of picklist "industry": technology, finance, healthcare');
  });

  it('a locale switch relabels the options on both objects, through the list\'s own translations', async () => {
    for (const object of ['dfp_account', 'dfp_lead']) {
      const field = (await metaIn('zh-CN', object))?.fields?.industry;
      expect(field?.options?.map((o: any) => o.label), object).toEqual(['科技', '金融', '医疗']);
      expect(field?.options?.map((o: any) => o.value), object).toEqual(['technology', 'finance', 'healthcare']);
    }
    // …and the default-language read is untouched by the other locale's catalog.
    expect((await metaIn(undefined, 'dfp_lead'))?.fields?.industry?.options?.[2]?.label).toBe('Healthcare');
  });

  it('the list itself is served as a `picklist` item, its label translated per locale', async () => {
    const read = async (locale: string | undefined) => {
      const res = await stack.api('/meta/picklist/industry', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(locale ? { 'Accept-Language': locale } : {}) },
      });
      expect(res.status, 'GET /meta/picklist/industry').toBe(200);
      const body: any = await res.json();
      expect(body?.item?.name, JSON.stringify(body).slice(0, 300)).toBe('industry');
      return body.item;
    };
    expect((await read(undefined)).label).toBe('Industry');
    expect((await read('zh-CN')).label).toBe('行业');
  });
});
