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

import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

import { judgePicklistReferences, PICKLIST_REFERENCE_UNKNOWN, PICKLIST_RESIDUAL_UNREFERENCED } from './picklist-references.js';

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

/**
 * Boot the stack through the `manifest` service. Answers the boot's refusal (or
 * `undefined`) and the engine it registered into, so a pin can ask the
 * REGISTRY what the boot made of the stack.
 */
async function bootStack(stack: AnyRec): Promise<{
  refusal?: Error & { code?: string };
  engine?: { registry: unknown };
}> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  let engine: { registry: unknown } | undefined;
  await kernel.use({
    name: 'test.parity.app',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      engine = ctx.getService<{ registry: unknown }>('objectql');
      await ctx.getService<{ register(m: unknown): unknown }>('manifest')
        .register({ ...(stack.manifest as AnyRec), ...stack });
    },
  } as Plugin);
  return kernel.bootstrap().then(
    () => ({ engine }),
    (e: Error & { code?: string }) => ({ refusal: e, engine }),
  );
}

/** Boot the stack through the `manifest` service; the boot's refusal, or `undefined`. */
const bootRefusal = async (stack: AnyRec) => (await bootStack(stack)).refusal;

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

/**
 * [#29898] The second parity, on the same stacks: `picklist-reference-unknown`
 * (this door, over the PARSED artifact) and the metadata save door's
 * `unknownPicklistBindingSaveRefusal` (`@objectstack/metadata-protocol`, over
 * the BOOTED registry) must call the same name declared.
 *
 * They cannot share one judgement the way the residual pair above does: this
 * door resolves a reference against the artifact's own `picklists` and weighs
 * the declaring package's outside dependencies, while the save door asks the
 * live registry (`resolvePicklistOptions`, the read that serves the field's
 * options) because a runtime write is judged against the packages INSTALLED
 * here. So the agreement is pinned rather than inherited — and pinned where
 * the two can disagree: a list a SIBLING package of the same artifact owns,
 * which this door resolves under ADR-0130 D4 and the save door must resolve
 * because the boot registered it.
 *
 * Asked of the save door's judge directly, over the real registry the boot
 * filled. `readMetaItem` is stubbed to "no stored row", so the case is a FIRST
 * write of the binding; the held-binding exemption, the other doors and the
 * envelope are pinned in
 * `packages/metadata-protocol/src/protocol.unknown-picklist-binding-refusal.test.ts`,
 * and the real-store controls (a dependency's list, the base's list of a
 * `.custom` pair, another installed package's) in
 * `packages/runtime/src/domains/meta-picklist-binding-door.test.ts`.
 */
describe('[#29898] picklist-reference-unknown — the author-time door and the metadata save door agree', () => {
  /** The object body a case writes: one select field bound to `picklist`. */
  const boundCase = (picklist: string) =>
    caseObj({ subject: { type: 'text', label: 'Subject' }, status: { type: 'select', label: 'Status', picklist } });

  /** One artifact: the core body carries the object, the app body declares `parity_status`. */
  const artifactWith = (picklist: string): AnyRec => ({
    manifest: manifest(STACK_ID),
    packages: [
      { manifest: { ...manifest('com.example.parity.core'), objects: [boundCase(picklist)] } },
      { manifest: { ...manifest('com.example.parity.app'), picklists: [status] } },
    ],
  });

  /**
   * The save door's judge, over the registry a boot of the DECLARING artifact
   * filled — the live deployment an author then writes into. ⛔ Not a boot of
   * the typo artifact: that is the shape the boot already refuses (the pin
   * above), which is why the save door is the door this card is about.
   */
  const saveDoorRefusal = async (body: AnyRec) => {
    const { refusal, engine } = await bootStack(artifactWith('parity_status'));
    expect(refusal, String(refusal?.message)).toBeUndefined();
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map()) as unknown as {
      readMetaItem: unknown;
      unknownPicklistBindingSaveRefusal(type: string, item: unknown, name: string): Promise<{ issues?: Array<{ path: string }> } | undefined>;
    };
    protocol.readMetaItem = async () => undefined;
    return protocol.unknownPicklistBindingSaveRefusal('object', body, String(body.name));
  };

  it('a list a SIBLING package of the same artifact declares: both doors accept it', async () => {
    const stack = artifactWith('parity_status');

    const door = judgePicklistReferences(stack);
    const saveDoor = await saveDoorRefusal(boundCase('parity_status'));

    expect(door.refusals.filter((r) => r.rule === PICKLIST_REFERENCE_UNKNOWN)).toEqual([]);
    expect(door.notices).toEqual([]);
    expect(saveDoor, JSON.stringify(saveDoor?.issues)).toBeUndefined();
  });

  // The two paths are rooted in their own SUBJECTS — the artifact for this
  // door, the one body for the save door — so the field is the tail of the
  // artifact-rooted path, never the whole of it.
  it('a name no package of the artifact declares: both doors refuse it, at the same field', async () => {
    const stack = artifactWith('parity_typo');

    const door = judgePicklistReferences(stack).refusals.filter((r) => r.rule === PICKLIST_REFERENCE_UNKNOWN);
    const saveDoor = await saveDoorRefusal(boundCase('parity_typo'));

    expect(door).toHaveLength(1);
    expect(saveDoor?.issues?.map((i) => i.path)).toEqual(['fields.status.picklist']);
    expect(door[0].path, door[0].path).toBe('packages[0].manifest.objects[0].fields.status.picklist');
    expect(door[0].path?.endsWith(saveDoor!.issues![0].path)).toBe(true);
  });
});
