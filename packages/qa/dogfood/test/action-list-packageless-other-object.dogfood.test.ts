// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33904, ADR-0146 D8 one effective read, ADR-0150 D4] Over HTTP, on a real
// boot of the showcase, the action list and the by-name read of a name agree
// when a package holds the name on one object and the environment saves a
// package-less action of the same name on another object, in both save orders.
//
// ## What was measured (stock showcase, admin session, main 68e726d631 + b8ac0e240e)
//
// The card's shape (a package's action on `account`, the environment's own
// package-less row on `contact`, both stored) was measured on a boot harness,
// where `getMetaItems({ type: 'action' })` left the environment's row out while
// the bare by-name read served it. Over HTTP the shape is not reached:
//
//   - A managed code package's action name (`showcase_open_docs`): the
//     package-less `PUT /meta/action/NAME` on another object is refused 403
//     `NOT_OVERRIDABLE` (sealed managed item), so no second row is stored.
//   - A Studio-created package (writable): every save ends with ONE stored item
//     of the name, and the list, `?names=`, `?package=` and the by-name reads
//     all answer that one item. Which item that is (the later save's body under
//     the package) is pinned here only as "the list answers what the by-name
//     read answers"; the save door's choice is not this file's subject.
//
// The file is ISOLATED: it writes `/meta` and creates a package.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG = 'com.example.qalistagree';
const action = (name: string, label: string, objectName: string) => ({
  name, label, objectName, type: 'url', target: 'https://example.com', locations: ['record_more'],
});

describe('[#33904] the action list agrees with the by-name read beside a package-less save on another object', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    const created = await stack.apiAs(admin, 'POST', '/packages', {
      manifest: {
        id: PKG, name: 'QA list agree', version: '0.1.0', type: 'app', namespace: 'qalistagree',
        dependencies: { 'com.example.showcase': '*' },
      },
    });
    expect(created.status, await created.clone().text()).toBe(201);
  }, 240_000);

  afterAll(async () => { await stack?.stop(); });

  /** The identity a client reads off an action: its object, label and package. */
  const face = (a: any) => [a?.objectName ?? null, a?.label ?? null, a?._packageId ?? null];
  const listed = async (path: string, name: string) => {
    const res = await stack.apiAs(admin, 'GET', path);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    return ((body?.data?.items ?? body?.items ?? []) as any[]).filter((a) => a?.name === name).map(face);
  };
  const byName = async (path: string) => {
    const res = await stack.apiAs(admin, 'GET', path);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    return face(body?.data?.item ?? body?.item ?? body?.data);
  };
  const put = async (path: string, body: unknown) => {
    const res = await stack.apiAs(admin, 'PUT', path, body);
    expect(res.status, await res.clone().text()).toBe(200);
  };

  for (const order of ['the package\'s save first', 'the environment\'s save first'] as const) {
    it(`${order}: the list, \`?names=\` and \`?package=\` each answer exactly what the by-name read answers`, async () => {
      const name = order === 'the package\'s save first' ? 'qa_list_agree_pf' : 'qa_list_agree_ef';
      const savePackage = () => put(`/meta/action/${name}?package=${PKG}`, action(name, 'package on task', 'showcase_task'));
      const saveEnvironment = () => put(`/meta/action/${name}`, action(name, 'environment on product', 'showcase_product'));
      if (order === 'the package\'s save first') { await savePackage(); await saveEnvironment(); }
      else { await saveEnvironment(); await savePackage(); }

      const bare = await byName(`/meta/action/${name}`);
      expect(await listed('/meta/action', name)).toEqual([bare]);
      expect(await listed(`/meta/action?names=${name}`, name)).toEqual([bare]);
      const atPackage = await byName(`/meta/action/${name}?package=${PKG}`);
      expect(await listed(`/meta/action?package=${PKG}`, name)).toEqual([atPackage]);
    }, 120_000);
  }
});
