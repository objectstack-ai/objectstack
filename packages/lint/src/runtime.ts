// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/lint/runtime` — the NARROW entry. Not the light one (#4463).
 *
 * ## What it is, measured
 *
 * This entry narrows the EXPORT SURFACE. It does not narrow the module graph,
 * and reading it as a weight boundary is a trap that costs a console build to
 * disprove. Measured by walking the static import graph of `src/` from each
 * entry, and by `stat` on this package's own `tsup` output:
 *
 * |            | modules reached        | ESM bundle       | exported names |
 * |------------|------------------------|------------------|----------------|
 * | `.`        | 72                     | 552,936 B        | 263            |
 * | `./runtime`| 71, 70 shared with `.` | 518,583 B (93.8%)| 5              |
 *
 * So: **93.8% of the bytes, 1.9% of the surface.** The one non-barrel module
 * `.` reaches and this entry does not is `lint-startup-registry-verdict.ts`;
 * that single module IS the whole graph delta, and it is not the reason the
 * entry exists. (Re-derive rather than trust these: the numbers move with the
 * rule set, the ratio has not.)
 *
 * The published `.d.ts` is the one place the narrowing shows as bytes —
 * `dist/runtime.d.ts` is a 278 B re-export line against `dist/index.d.ts`'s
 * ~158 KB — because types are erased, and code is not.
 *
 * ## What it does NOT carry
 *
 * `validateCapabilityReferences` is not exported here, and switching to this
 * entry to get a cheaper capability check gets neither half: the rule's code is
 * compiled INTO `dist/runtime.js` (it is a member of the one shared registry),
 * it is only not named on the way out. You pay its bytes and cannot call it.
 * The root entry is where that rule, and the other 257 names, are reachable.
 *
 * ## Why it exists anyway
 *
 * So the kernel boot path can name only the five gate functions below, and so a
 * test can prove it named nothing else. `@objectstack/metadata-protocol`'s
 * runtime gate must reach this package through this entry rather than the root
 * barrel, and `authoring-rule-wiring.test.ts` fails if it ever does otherwise.
 * That is an import-discipline boundary, machine-checked: it stops a
 * kernel-path consumer from hand-calling a CLI-only rule, which is the drift
 * #4463 closed. The value is the pin, not the payload.
 *
 * ## What is the PACKAGE's doing, not this entry's
 *
 * Lazy dependency loading. `lazy-deps.test.ts` pins that no `src/` file eagerly
 * imports `typescript` (~9 MB), `sucrase` or `ajv` — so importing `.` loads
 * none of them either, and this entry is not what buys that.
 * `runtime-lazy-deps.test.ts` adds the claim this consumer actually needs: that
 * RUNNING the gate on a real, gated body loads none of them, because the rules
 * #4463 wired to `runtime-publish` (flow / approval / expression / reference)
 * never parse authored source. Both are properties of which rules RUN. Neither
 * is a property of which entry you import — the react/jsx rules' modules are
 * present in this entry's graph, exactly as `runtime-lazy-deps.test.ts` states.
 *
 * The deliberate NON-goal: this is not a second, lighter rule set. It re-exports
 * a filtered view of the ONE registry in `authoring-rules.ts`. If the two ever
 * disagree it is a bug, and `authoring-rule-wiring.test.ts` is what makes them
 * unable to.
 */

export {
  buildRuntimeWriteSnapshots,
  narrowObjectsToPackageClosure,
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';
export type {
  RuntimeGateResult,
  RuntimePackageScope,
  RuntimeStackContext,
} from './runtime-gate.js';
export type { AuthoringFinding, AuthoringSeverity } from './authoring-rules.js';
