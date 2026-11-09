// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-wait-event-config-lift` conversion (`toMajor:
// 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helpers
// `WAIT_EVENT_CONFIG_LIFTS`, `liftWaitEventConfig` are read by this conversion
// alone). A LEAF: it imports neither `registry.ts` nor another conversion's
// module. `registry.ts` imports `flowNodeWaitEventConfigLift` and lists it
// where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapFlowNodes } from '../../walk.js';
import { WAIT_EVENT_CONFIG_LOOSE_KEYS } from '../../../automation/flow-sibling-block-loose-keys.js';
import { type Dict, type Emit, isDict } from '../shared.js';

/**
 * The loose `config` keys the `wait` executor used to also accept, in the exact
 * precedence order of the `??` chains it carried, keyed by the declared
 * `waitEventConfig` property each one feeds. Declared once in
 * `automation/flow-sibling-block-loose-keys.ts`, the table the flow parse's
 * loose-key refusal reads too (#23543 F3), so the keys refused at authoring and
 * the keys lifted at rehydration are one set.
 */
const WAIT_EVENT_CONFIG_LIFTS = WAIT_EVENT_CONFIG_LOOSE_KEYS;

/**
 * Lift `wait`'s loose `config.*` event keys onto the declared `waitEventConfig`
 * sibling (#4045).
 *
 * The only conversion here whose destination is **not** another `config` key.
 * `wait`'s contract does not live in `config` at all — it is
 * `FlowNodeSchema.waitEventConfig` (`flow.zod.ts`), a fully `.describe()`-annotated
 * block that is in the authorable-field list, reaches the generated reference,
 * and is what the showcase actually authors. Its descriptor therefore publishes
 * no `configSchema`, which is by design and not the gap it first looks like.
 *
 * The executor nevertheless carried `wec.X ?? loose.X` for six `config` keys —
 * a second, undeclared de-facto contract of exactly the `notify.source` shape
 * (PD #12), announced only by the comment "for hand-authored flows that put the
 * same keys under config".
 *
 * The showcase's `wait_revision` node authored exactly that shape
 * (`config: { eventType: 'signal', signalName: 'budget_revision' }`) until this
 * change moved it to the declared block — so the back door was not hypothetical,
 * and the example that demonstrates `wait` was itself on the retiring spelling.
 *
 * Precedence mirrors those `??` chains, so the rewrite is behaviour-preserving:
 * a value already on `waitEventConfig` WINS, and among loose candidates the
 * first one present decides.
 *
 * A loose key that does not lift is DELETED (#23543 F3): one the block already
 * shadows, a later candidate the first present one shadowed, and a `null` the
 * `??` chain skipped. None of them was ever read — the `??` chain never looked
 * past the value that won — and since 18 the flow parse refuses every named
 * loose key under `config` (`siblingBlockLooseConfigRefusals`), so a stored
 * flow that kept one would stop loading at the rehydration seam that replays
 * this entry. This is a LIFT between two locations, not an alias pair in one
 * dict, so #4923's by-value split (keep a disagreeing twin for the author to
 * decide) does not apply: the loose location is itself the retired thing, its
 * value lost to the block's under every reading that ever ran, and a stored
 * row has no author to decide.
 *
 * `eventType` is defaulted to `'timer'` whenever lifting would otherwise leave
 * the block without one. That is load-bearing, not tidiness: the loader parses
 * the CONVERTED flow (`applyConversionsToFlow` → `FlowSchema.parse`), and
 * `waitEventConfig.eventType` is **required** once the block exists — so a
 * stored flow carrying only `config: { duration: 'PT1M' }` would go from working
 * to failing to load. `'timer'` is the exact default the executor applied to
 * that shape.
 */
function liftWaitEventConfig(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'wait') return node;
    const config = node.config;
    if (!isDict(config)) return node;

    const wec: Dict = isDict(node.waitEventConfig) ? { ...node.waitEventConfig } : {};
    const nextConfig: Dict = { ...config };
    let lifted = false;
    let dropped = false;

    for (const [target, candidates] of WAIT_EVENT_CONFIG_LIFTS) {
      let decided = false;
      for (const from of candidates) {
        if (!(from in nextConfig)) continue;
        const value = nextConfig[from];
        delete nextConfig[from];
        // The first candidate PRESENT decides, lifted or shadowed — the `??`
        // chain never looked past it either.
        if (!decided && value != null && wec[target] == null) {
          wec[target] = value;
          emit({ from: `config.${from}`, to: `waitEventConfig.${target}`, path: `${path}.waitEventConfig.${target}` });
          lifted = true;
        } else {
          const by = value == null ? 'it carried no value' : `\`waitEventConfig.${target}\` already set, so it was never read`;
          emit({ from: `config.${from}`, to: `(removed — ${by})`, path: `${path}.config` });
          dropped = true;
        }
        if (value != null) decided = true;
      }
    }

    if (!lifted && !dropped) return node;
    if (lifted && wec.eventType == null) wec.eventType = 'timer';
    return lifted ? { ...node, config: nextConfig, waitEventConfig: wec } : { ...node, config: nextConfig };
  });
}

/**
 * Wait flow-node loose `config` keys → the declared `waitEventConfig` sibling
 * (protocol 17, #4045; retired from the load path at 18, #23543 F3). See
 * {@link liftWaitEventConfig} for the precedence rules, why `eventType` is
 * defaulted, and why a loose key that does not lift is deleted.
 *
 * ## Retired from the load path at 18 (#23543, ruling F3 A)
 *
 * Through 17 it stayed live because `wait` has no `config` contract (its
 * contract is the sibling block), so retired alone, a loose key beside a
 * declared `waitEventConfig` would have been silently ignored (the verdict
 * #23487 recorded). The ruling closed both halves: the flow parse refuses every
 * named loose key under a `wait` node's `config` with the prescription naming
 * its `waitEventConfig` key (`siblingBlockLooseConfigRefusals`,
 * `automation/flow-sibling-block-loose-keys.ts`, which owns the key table this
 * lift reads), and this lift deletes the loose keys the block shadows, so a
 * stored flow the refusal would reject keeps loading. The authoring funnel
 * (`defineStack`, `os validate` / `os build` / `os lint`) no longer replays it.
 * Stored flows are the `includeRetired` seams: the automation engine's flow
 * rehydration, stored-row rehydration (`applyConversionsToStoredItem`), the
 * metadata save door's flow fallback, the artifact-ingestion door inside its
 * window, and `os migrate meta --from 16` (a step-17 member).
 */
const flowNodeWaitEventConfigLift: MetadataConversion = {
  id: 'flow-node-wait-event-config-lift',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.wait.waitEventConfig',
  summary:
    "wait flow-node loose config keys → the declared `waitEventConfig` block: 'eventType', " +
    "'timerDuration'/'duration' → 'timerDuration', 'signalName'/'signal' → 'signalName', 'timeoutMs' (the executor also read these keys from the loose config, a second contract beside the declared block)",
  apply(stack, emit) {
    return liftWaitEventConfig(stack, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'order_settlement',
          nodes: [
            { id: 'n1', type: 'start' },
            // Loose-only, and via the UNDECLARED `duration` spelling with no
            // eventType anywhere — the shape that would stop loading without
            // the `'timer'` default.
            { id: 'n2', type: 'wait', config: { duration: 'PT1M' } },
            // Loose `signal` alongside an explicit eventType: both lift.
            { id: 'n3', type: 'wait', config: { eventType: 'signal', signal: 'order_paid' } },
            // Partially shadowed: `timerDuration` is already declared, so the
            // loose `duration` is deleted (#23543 F3); only `eventType` lifts.
            // (Deliberately not `timeoutMs` — protocol 17 retires that key
            // (#4158), and the fixture harness replays the WHOLE table, so an
            // `after` naming it would describe an end state that no longer
            // exists.)
            {
              id: 'n4',
              type: 'wait',
              waitEventConfig: { timerDuration: 'PT5M' },
              config: { duration: 'PT9M', eventType: 'signal' },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'order_settlement',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'wait', config: {}, waitEventConfig: { timerDuration: 'PT1M', eventType: 'timer' } },
            { id: 'n3', type: 'wait', config: {}, waitEventConfig: { eventType: 'signal', signalName: 'order_paid' } },
            {
              id: 'n4',
              type: 'wait',
              waitEventConfig: { timerDuration: 'PT5M', eventType: 'signal' },
              config: {},
            },
          ],
        },
      ],
    },
    // n2: `duration` → `timerDuration`. n3: `eventType` + `signal` → `signalName`.
    // n4: `eventType` lifts, and its `duration`, shadowed by a declared
    // `timerDuration`, is deleted with its own notice.
    expectedNotices: 5,
  },
};

export { flowNodeWaitEventConfigLift };
