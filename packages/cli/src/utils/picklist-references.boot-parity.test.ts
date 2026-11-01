// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0130 D4] `os validate` / `os build` foretell the boot: a composed
 * stack's top-level picklist that no package body declares and no object field
 * the engine registers names is refused by the boot (the engine's `manifest`
 * service, `INVALID_METADATA`), and `judgePicklistReferences` refuses the same
 * stack as `picklist-residual-unreferenced`, in the same words.
 *
 * Both read ONE judgement, `unreferencedResidualPicklists`
 * (`@objectstack/metadata/picklist-references`, re-exported by
 * `@objectstack/objectql`), so this file is a smoke check of the wiring, not
 * the guard against drift: one refused stack and one control, booted on a real
 * kernel with the real `ObjectQLPlugin`, the way `AppPlugin` hands a config
 * boot's stack to the `manifest` service (`{ ...manifest, ...stack }`). Which
 * lists are refused, judged off which fields, is pinned on the judgement and
 * at each door: `picklist-references.test.ts` here, and objectql's
 * `manifest-service-residual-objects.test.ts` and
 * `registration-refusal-one-spelling.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';

import { judgePicklistReferences, PICKLIST_RESIDUAL_UNREFERENCED } from './picklist-references.js';

type AnyRec = Record<string, unknown>;

const STACK_ID = 'com.example.parity.release';
const manifest = (id: string) => ({ id, name: id.split('.').pop(), version: '1.0.0', type: 'app' });
const status = { name: 'parity_status', label: 'Status', options: [{ label: 'Open', value: 'open' }] };
const unused = { name: 'parity_unused', label: 'Unused', options: [{ label: 'A', value: 'a' }] };
const statusField = { status: { type: 'select', label: 'Status', picklist: 'parity_status' } };
const caseObj = (fields: AnyRec = { subject: { type: 'text', label: 'Subject' } }) =>
  ({ name: 'parity_case', label: 'Case', sharingModel: 'private', fields });

/** Two bodies, a manifest naming neither, and `top` on the top level. */
const composed = (top: AnyRec, coreExtra: AnyRec = {}): AnyRec => ({
  manifest: manifest(STACK_ID),
  ...top,
  packages: [
    { manifest: { ...manifest('com.example.parity.core'), objects: [caseObj()], ...coreExtra } },
    { manifest: { ...manifest('com.example.parity.app'), picklists: [status] } },
  ],
});

/** One refused stack and one control. */
const STACKS: Record<string, AnyRec> = {
  'a list nothing names': composed({ picklists: [unused] }),
  'CONTROL: a body-declared list a body field names': composed({}, { objects: [caseObj(statusField)] }),
};

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

/** Boot the stack through the `manifest` service; the boot's refusal, or `undefined`. */
async function bootRefusal(stack: AnyRec): Promise<(Error & { code?: string }) | undefined> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use({
    name: 'test.parity.app',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      await ctx.getService<{ register(m: unknown): unknown }>('manifest')
        .register({ ...(stack.manifest as AnyRec), ...stack });
    },
  } as Plugin);
  return kernel.bootstrap().then(() => undefined, (e: Error & { code?: string }) => e);
}

describe('picklist-residual-unreferenced — the author-time door and the boot agree', () => {
  it.each(Object.keys(STACKS))('%s', async (label) => {
    const stack = STACKS[label];
    const door = judgePicklistReferences(stack).refusals.filter((r) => r.rule === PICKLIST_RESIDUAL_UNREFERENCED);
    const boot = await bootRefusal(stack);
    if (label.startsWith('CONTROL')) {
      expect(door).toEqual([]);
      expect(boot?.message ?? '').not.toContain('is declared on the top level of stack');
      return;
    }
    expect(door).toHaveLength(1);
    expect(boot?.code).toBe('INVALID_METADATA');
    expect(boot?.message).toBe(`${door[0].message} ${door[0].hint}`);
  });
});
