// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectExtensionSchema` refuses `hooks` and `listViews` on an extension and
 * says what to do instead. Each sentence makes a claim about `defineStack()`,
 * and this file holds each claim at `defineStack()` itself:
 *
 * - a top-level hook bound to an object the stack does not define is refused at
 *   build, even when the stack extends that object through `objectExtensions`.
 *   ADR-0130 §1.5 records that refusal as deliberate: "the split must follow
 *   hook ownership". A hook on an object the stack defines is accepted;
 * - a top-level view whose `list` or `form` data source is an object the stack
 *   does not define is refused the same way, extended or not. A view on an
 *   object the stack defines is accepted.
 *
 * Both refusals come from `validateCrossReferences` in `stack.zod.ts`, which
 * keeps exactly what it accepts and refuses; only the guidance text names it.
 */

import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';
import { ObjectExtensionSchema } from './data/object.zod';

const manifest = { id: 'com.test.extender', name: 'extender', version: '1.0.0', type: 'app' as const };
const OWN = { name: 'extender_note', label: 'Note', fields: { title: { type: 'text' as const, label: 'Title' } } };
const FOREIGN = 'sys_organization';
const extendsForeign = [{ extend: FOREIGN, fields: { tier: { type: 'text' as const, label: 'Tier' } } }];

const hook = (object: string) => ({ name: 'probe_hook', object, events: ['beforeInsert'], handler: 'noop' });
const listView = (object: string) => ({
  list: { type: 'grid', data: { provider: 'object', object }, columns: ['name'] },
});
const formView = (object: string) => ({
  form: { type: 'simple', data: { provider: 'object', object }, sections: [{ label: 'Main', fields: [{ field: 'name' }] }] },
});

const refusalOf = (config: unknown): any => {
  try {
    defineStack(config as any);
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('defineStack and a top-level hook bound to an object outside the stack', () => {
  it('refuses a hook on an object the stack only extends', () => {
    const err = refusalOf({ manifest, objects: [OWN], objectExtensions: extendsForeign, hooks: [hook(FOREIGN)] });
    expect(err).toMatchObject({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err.message).toContain(`Hook 'probe_hook' references object '${FOREIGN}'`);
  });

  it('accepts a hook on an object the stack defines (the control)', () => {
    const stack = defineStack({
      manifest, objects: [OWN], objectExtensions: extendsForeign, hooks: [hook(OWN.name)],
    } as any);
    expect(stack.hooks?.map((h) => h.object)).toEqual([OWN.name]);
  });
});

describe('defineStack and a top-level view whose data source is an object outside the stack', () => {
  it('refuses a view whose `list` reads an object the stack only extends', () => {
    const err = refusalOf({ manifest, objects: [OWN], objectExtensions: extendsForeign, views: [listView(FOREIGN)] });
    expect(err).toMatchObject({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err.message).toContain(`View[0].list references object '${FOREIGN}'`);
  });

  it('refuses a view whose `form` reads an object the stack only extends', () => {
    const err = refusalOf({ manifest, objects: [OWN], objectExtensions: extendsForeign, views: [formView(FOREIGN)] });
    expect(err).toMatchObject({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err.message).toContain(`View[0].form references object '${FOREIGN}'`);
  });

  it('accepts a view on an object the stack defines (the control)', () => {
    const stack = defineStack({
      manifest, objects: [OWN], objectExtensions: extendsForeign, views: [listView(OWN.name)],
    } as any);
    expect(stack.views).toHaveLength(1);
  });
});

describe('the extension refusal says what defineStack does', () => {
  const guidanceFor = (key: 'hooks' | 'listViews') => {
    const parsed = ObjectExtensionSchema.safeParse({ extend: FOREIGN, [key]: key === 'hooks' ? [] : {} });
    expect(parsed.success).toBe(false);
    return JSON.stringify(parsed.error?.issues);
  };

  it('`hooks` names the owning stack and the refusal of an extended target', () => {
    const text = guidanceFor('hooks');
    expect(text).toContain('declare it as a top-level hook in the stack that defines the object');
    expect(text).toContain('refuses a top-level hook bound to an object the stack does not define, an extended one included');
  });

  it('`listViews` names the owning stack and the refusal of an extended target', () => {
    const text = guidanceFor('listViews');
    expect(text).toContain('top-level `view` in the stack that defines the target object');
    expect(text).toContain('data source is an object the stack does not define, an extended one included');
  });
});
