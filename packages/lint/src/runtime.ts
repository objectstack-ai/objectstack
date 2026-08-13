// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/lint/runtime` — the KERNEL-SAFE entry (#4463).
 *
 * The metadata write path (`@objectstack/metadata-protocol`) sits on the kernel
 * boot path and must reach the shared rule core without dragging the lint
 * package's gate-only dependencies (`typescript` ~9 MB, `sucrase`) into it.
 * That constraint is real and it is guarded from both ends:
 *
 * - `lazy-deps.test.ts` pins that no `src/` file eagerly imports either dep, so
 *   importing this entry loads neither;
 * - `runtime-lazy-deps.test.ts` pins the stronger claim this entry needs — that
 *   RUNNING the gate on a real, gated body loads neither either, because the
 *   rules #4463 wired to `runtime-publish` (flow / approval / expression /
 *   reference) never parse authored source.
 *
 * The deliberate NON-goal: this is not a second, lighter rule set. It re-exports
 * a filtered view of the ONE registry in `authoring-rules.ts`. If the two ever
 * disagree it is a bug, and `authoring-rule-wiring.test.ts` is what makes them
 * unable to.
 */

export {
  buildRuntimeWriteSnapshots,
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';
export type { RuntimeGateResult, RuntimeStackContext } from './runtime-gate.js';
export type { AuthoringFinding, AuthoringSeverity } from './authoring-rules.js';
