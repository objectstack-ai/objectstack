// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Bindings for rendering a binding scaffold (#21325) in a test that judges
 * something OTHER than what the scaffold binds — whether its bytes parse,
 * whether it type-checks, what it is called.
 *
 * `os g view|action|flow|app` no longer derive a reference from the new item's
 * name: `runMetadataGeneration` resolves each one against the project's stack
 * and `generate` throws without them. A test that only needs the bytes still
 * has to hand over SOMETHING the command could have resolved, so this resolves
 * them the command's way — `stackBindingCandidates` over a stack that declares
 * one object and one flow — rather than inventing a shape of its own.
 *
 * A test that judges the BINDING itself (that it names a declared object,
 * that the gates accept it) builds its stack from real scaffolds instead:
 * `generate-scaffold-validates.test.ts`.
 */

import {
  stackBindingCandidates,
  type ScaffoldBindings,
  type ScaffoldBinds,
} from '../../src/commands/generate.js';

/** The object and flow the probe stack declares. */
export const PROBE_OBJECT = 'probe_target';
export const PROBE_FLOW = 'probe_target_changed_flow';

const PROBE_STACK = {
  objects: [
    {
      name: PROBE_OBJECT,
      label: 'Probe Target',
      pluralLabel: 'Probe Targets',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  flows: [{ name: PROBE_FLOW }],
};

/** Every binding `binds` declares, resolved off the probe stack; `undefined` for a scaffold that binds nothing. */
export function probeBindings(target: { binds: ScaffoldBinds }): ScaffoldBindings | undefined {
  if (Object.keys(target.binds).length === 0) return undefined;
  const { objects, flows } = stackBindingCandidates(PROBE_STACK);
  return {
    ...(target.binds.object ? { object: objects[0] } : {}),
    ...(target.binds.flow ? { flow: flows[0] } : {}),
  };
}
