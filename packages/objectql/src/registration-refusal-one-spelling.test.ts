// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One spelling per refusal, across the doors that throw it.
 *
 *  - The residual-picklist refusal (ADR-0130 D4): the `manifest` service
 *    throws the one judgement's sentence, `unreferencedResidualPicklists`
 *    (`@objectstack/metadata/picklist-references`), which this package
 *    re-exports for `os validate` / `os build`. The door's half is pinned in
 *    `packages/cli/src/utils/picklist-references.test.ts`.
 *  - The permission-set owner refusal (ADR-0086 D3) and the `views:`
 *    container-shape refusal: the body seam (`registerApp`) and the stack's
 *    residual registration (`plugin.ts`) throw the one envelope
 *    `engine.ts` exports.
 *
 * Each pin compares a door's thrown answer, field for field, with the one
 * exported function's answer for the same input, so a second copy of the
 * words or the envelope at any door reads red here — not only a copy that
 * drifts from the phrases the behaviour pins quote.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { unclaimedTopLevel } from '@objectstack/metadata';
import { unreferencedResidualPicklists } from '@objectstack/metadata/picklist-references';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL, permissionSetOwnerRegistrationRefusal, viewsEntryNotContainerRefusal } from './engine.js';
import { unreferencedResidualPicklists as reExported } from './index.js';

const RELEASE_ID = 'com.example.single.release';
const SERVICE_ID = 'com.example.single.service';
const OTHER_ID = 'com.example.single.other';

const caseObj = () => ({ name: 'single_case', label: 'Case', sharingModel: 'private', fields: { subject: { type: 'text', label: 'Subject' } } });
const list = (name: string) => ({ name, label: name, options: [{ label: 'A', value: 'a' }] });

/** One body, a manifest naming it not, and `top` on the top level — handed over as `AppPlugin` hands it. */
const composed = (top: Record<string, unknown>): Record<string, unknown> => {
  const manifest = { id: RELEASE_ID, name: 'release', version: '1.0.0', type: 'app' };
  return {
    ...manifest,
    manifest,
    ...top,
    packages: [{ manifest: { id: SERVICE_ID, name: 'service', version: '2.0.0', type: 'module', objects: [caseObj()] } }],
  };
};

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

/** Boot `stack` through the `manifest` service, as a config boot does; the boot's refusal, or `undefined`. */
async function bootRefusal(stack: Record<string, unknown>): Promise<unknown> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use({
    name: 'test.one-spelling.app',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      await ctx.getService<{ register(m: unknown): unknown }>('manifest').register(stack);
    },
  } as Plugin);
  return kernel.bootstrap().then(() => undefined, (e: unknown) => e);
}

/** The thrown answer's envelope and words — every field a client or a test reads. */
const envelope = (err: unknown) => {
  const e = err as { message?: unknown; code?: unknown; status?: unknown; httpStatus?: unknown; issues?: unknown };
  return { message: e?.message, code: e?.code, status: e?.status, httpStatus: e?.httpStatus, issues: e?.issues };
};

describe('the residual-picklist refusal: the engine throws the one judgement', () => {
  it('@objectstack/objectql re-exports the judgement itself, not a copy', () => {
    expect(reExported).toBe(unreferencedResidualPicklists);
  });

  it.each([
    ['one list', [list('single_unused')]],
    ['two lists, one plural sentence', [list('single_unused'), list('single_spare')]],
  ])('the boot\'s refusal is the judgement\'s sentence, byte for byte (%s)', async (_label, picklists) => {
    const stack = composed({ picklists });
    const judged = unreferencedResidualPicklists(
      unclaimedTopLevel(stack),
      (stack.packages as Array<{ manifest: unknown }>).map((entry) => entry.manifest),
    );
    expect(judged?.picklists.map((p) => p.name)).toEqual(picklists.map((p) => p.name));
    const refusal = await bootRefusal(stack);
    expect(envelope(refusal)).toEqual({
      message: judged!.wording.text,
      code: 'INVALID_METADATA',
      status: 422,
      httpStatus: 422,
      issues: undefined,
    });
  });
});

describe('the permission-set owner refusal: one envelope at the body seam and the residual registration', () => {
  const set = () => ({ name: 'single_set', label: 'Set', objects: {}, packageId: OTHER_ID });

  it('the residual registration throws the envelope engine.ts exports', async () => {
    const expected = permissionSetOwnerRegistrationRefusal(set(), 'single_set', RELEASE_ID);
    expect(expected).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(envelope(await bootRefusal(composed({ permissions: [set()] })))).toEqual(envelope(expected));
  });

  it('the body seam throws the same envelope for the same set', () => {
    const expected = permissionSetOwnerRegistrationRefusal(set(), 'single_set', RELEASE_ID);
    let thrown: unknown;
    try {
      new ObjectQL().registerApp({ id: RELEASE_ID, name: 'release', version: '1.0.0', permissions: [set()] });
    } catch (e) {
      thrown = e;
    }
    expect(envelope(thrown)).toEqual(envelope(expected));
  });
});

describe('the `views:` container-shape refusal: one envelope at the body seam and the residual registration', () => {
  const viewItem = () => ({ name: 'single_case_item', object: 'single_case', viewKind: 'list', config: { type: 'grid' } });

  it('the residual registration throws the envelope engine.ts exports', async () => {
    const expected = viewsEntryNotContainerRefusal('single_case_item', 'manifest', RELEASE_ID);
    expect(expected).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(envelope(await bootRefusal(composed({ views: [viewItem()] })))).toEqual(envelope(expected));
  });

  it('the body seam throws the same envelope for the same entry', () => {
    const expected = viewsEntryNotContainerRefusal('single_case_item', 'manifest', RELEASE_ID);
    let thrown: unknown;
    try {
      new ObjectQL().registerApp({ id: RELEASE_ID, name: 'release', version: '1.0.0', views: [viewItem()] });
    } catch (e) {
      thrown = e;
    }
    expect(envelope(thrown)).toEqual(envelope(expected));
  });
});
