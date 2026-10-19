// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24400] `defineStack` accepts a top-level action bound by `objectName` to an
 * object this stack does not define, in exactly the two cases its own metadata
 * says the object exists elsewhere — an object it EXTENDS through
 * `objectExtensions` (the route `ObjectExtensionSchema`'s `guidance.actions`
 * names) and a KNOWN platform object — and keeps it in the top-level `actions`,
 * merged into nothing. The engine's schema registry attaches it to the target
 * when the target is served (`@objectstack/objectql`,
 * `bound-action-foreign-object.test.ts`), and refuses at boot a target no
 * loaded package registers.
 *
 * Every other name is still refused here: one stack cannot tell another
 * package's object from a typo.
 */

import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';
import { ObjectExtensionSchema } from './data/object.zod';

const manifest = { id: 'com.test.binder', name: 'binder', version: '1.0.0', type: 'app' as const };
const OWN = { name: 'binder_note', label: 'Note', fields: { title: { type: 'text' as const, label: 'Title' } } };
const bound = (objectName: string) => ({
  name: 'probe_bound', label: 'Probe', objectName, type: 'url' as const, target: 'https://example.com',
  locations: ['record_header' as const],
});

const refusalOf = (config: unknown): any => {
  try {
    defineStack(config as any);
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('defineStack and an action bound to an object outside the stack', () => {
  it('accepts a target the stack extends, and keeps the action at the top level, merged into nothing', () => {
    const stack = defineStack({
      manifest,
      objects: [OWN],
      objectExtensions: [{ extend: 'crm_account', fields: { tier: { type: 'text', label: 'Tier' } } }],
      actions: [bound('crm_account')],
    } as any);
    expect(stack.actions?.map((a) => a.name)).toEqual(['probe_bound']);
    expect(stack.objects?.find((o) => o.name === 'binder_note')?.actions).toBeUndefined();
  });

  it('accepts a known platform object', () => {
    const stack = defineStack({ manifest, objects: [OWN], actions: [bound('sys_organization')] } as any);
    expect(stack.actions?.map((a) => a.objectName)).toEqual(['sys_organization']);
  });

  it('still refuses a name it cannot attribute — another package\'s object it does not extend', () => {
    expect(refusalOf({ manifest, objects: [OWN], actions: [bound('crm_account')] })).toMatchObject({
      code: 'STACK_CROSS_REFERENCE_INVALID',
      status: 422,
    });
  });

  it('still refuses a platform-prefixed name no platform package ships (the prefix is not the test)', () => {
    const err = refusalOf({ manifest, objects: [OWN], actions: [bound('sys_organizaton')] });
    expect(err).toMatchObject({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err.message).toContain("Action 'probe_bound' references object 'sys_organizaton'");
  });

  it('a same-stack bound action is merged into its object as before', () => {
    const stack = defineStack({ manifest, objects: [OWN], actions: [bound('binder_note')] } as any);
    expect(stack.objects?.find((o) => o.name === 'binder_note')?.actions?.map((a) => a.name)).toEqual(['probe_bound']);
  });
});

describe('the extension refusal names the route that works', () => {
  it('`actions` on an extension is refused, and the guidance names the registry attach', () => {
    const parsed = ObjectExtensionSchema.safeParse({ extend: 'crm_account', actions: [] });
    expect(parsed.success).toBe(false);
    const text = JSON.stringify(parsed.error?.issues);
    expect(text).toContain("objectName: '<target>'");
    expect(text).toContain('schema registry attaches it to the target object');
  });
});
