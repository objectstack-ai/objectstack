// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-connector-config-lift` conversion (`toMajor:
// 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helpers
// `CONNECTOR_CONFIG_LIFTS`, `liftConnectorConfigShape` are read by this
// conversion alone). A LEAF: it imports neither `registry.ts` nor another
// conversion's module. `registry.ts` imports `flowNodeConnectorConfigLift` and
// lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapFlowNodes } from '../../walk.js';
import { CONNECTOR_CONFIG_LOOSE_KEYS } from '../../../automation/flow-sibling-block-loose-keys.js';
import { type Dict, type Emit, isDict } from '../shared.js';

/**
 * The `config` keys a mis-taught `connector_action` node carries, in
 * declared-block order — the one table the flow parse's loose-key refusal reads
 * too (`automation/flow-sibling-block-loose-keys.ts`, #23543 F3).
 */
const CONNECTOR_CONFIG_LIFTS = CONNECTOR_CONFIG_LOOSE_KEYS;

/**
 * Lift `connector_action`'s loose `config.*` keys onto the declared
 * `connectorConfig` sibling (#4045).
 *
 * Like `wait`, `connector_action`'s contract does not live in `config` at all —
 * it is `FlowNodeSchema.connectorConfig` (`flow.zod.ts`), and the executor reads
 * nothing else. Unlike `wait`, the executor never carried a loose-config
 * fallback; the wrong spelling was taught by the node's own **descriptor**,
 * whose `configSchema` declared `connectorId`/`actionId`/`input` as `config`
 * keys — and the Studio inspector derives its property form from a published
 * `configSchema` (rooting every field at `config.<key>`), so an author who
 * configured a connector node against a live backend produced exactly this
 * shape, and a node that then refused to dispatch. The descriptor stops
 * publishing that schema in the same change (see connector-nodes.ts); this
 * conversion is what makes the flows it mis-taught start working.
 *
 * Precedence matches every other lift here: a key already on the declared
 * block WINS. Its loose counterpart, never read, is DELETED (#23543 F3), and so
 * is a loose `null`: since 18 the flow parse refuses every named loose key
 * under `config`, so a stored flow that kept one would stop loading at the
 * rehydration seam that replays this entry. The reason it is a deletion and
 * not #4923's keep-the-disagreeing-twin is the one under
 * {@link liftWaitEventConfig}.
 *
 * One completeness guard is load-bearing, mirroring `wait`'s `eventType`
 * default: the loader parses the CONVERTED flow, and `connectorConfig` requires
 * `connectorId` + `actionId` once the block exists. Unlike `eventType` there is
 * no defensible default for either, so when lifting cannot complete that pair
 * the node is left **untouched** — materializing a half block would only move
 * the refusal onto a key the author never wrote. The flow parse then refuses
 * the node for its missing `connectorConfig` block, whose prescription names
 * the move out of `config` (#20418); before the parse required the block, such
 * a node registered and failed every run at the executor's guard. Nothing is
 * deleted on that path either: the node fails to load whatever happens to its
 * loose keys, and the refusal names each of them.
 */
function liftConnectorConfigShape(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'connector_action') return node;
    const config = node.config;
    if (!isDict(config)) return node;

    const cc: Dict = isDict(node.connectorConfig) ? { ...node.connectorConfig } : {};
    const nextConfig: Dict = { ...config };
    const lifts: Array<(typeof CONNECTOR_CONFIG_LIFTS)[number]> = [];
    const drops: Array<{ key: (typeof CONNECTOR_CONFIG_LIFTS)[number]; empty: boolean }> = [];
    for (const key of CONNECTOR_CONFIG_LIFTS) {
      if (!(key in nextConfig)) continue;
      const value = nextConfig[key];
      delete nextConfig[key];
      if (value != null && cc[key] == null) {
        cc[key] = value;
        lifts.push(key);
      } else {
        drops.push({ key, empty: value == null }); // declared block wins, or nothing to carry
      }
    }
    if (lifts.length === 0 && drops.length === 0) return node;
    // Completeness guard — never materialize a block the loader would reject.
    if (cc.connectorId == null || cc.actionId == null) return node;

    for (const key of lifts) {
      emit({ from: `config.${key}`, to: `connectorConfig.${key}`, path: `${path}.connectorConfig.${key}` });
    }
    for (const { key, empty } of drops) {
      const by = empty ? 'it carried no value' : `\`connectorConfig.${key}\` already set, so it was never read`;
      emit({ from: `config.${key}`, to: `(removed — ${by})`, path: `${path}.config` });
    }
    return lifts.length > 0 ? { ...node, config: nextConfig, connectorConfig: cc } : { ...node, config: nextConfig };
  });
}

/**
 * Connector flow-node loose `config` keys → the declared `connectorConfig`
 * sibling (protocol 17, #4045; retired from the load path at 18, #23543 F3).
 * See {@link liftConnectorConfigShape} for the precedence rules, the
 * completeness guard, and why a shadowed loose key is deleted.
 *
 * ## Retired from the load path at 18 (#23543, ruling F3 A)
 *
 * Through 17 it stayed live because, like `wait`, `connector_action` has no
 * `config` contract, so retired alone, a loose key beside a complete
 * `connectorConfig` would have been silently ignored: a loose `input` next to a
 * declared pair would dispatch the action with no input (the verdict #23487
 * recorded). The ruling closed both halves: the flow parse refuses
 * `config.connectorId` / `config.actionId` / `config.input` on a
 * `connector_action` node with the prescription naming `connectorConfig`
 * (`siblingBlockLooseConfigRefusals`), and this lift deletes the loose keys the
 * block shadows, so a stored flow the refusal would reject keeps loading. The
 * seams that still replay it are the ones listed on
 * `flow-node-wait-event-config-lift`.
 */
const flowNodeConnectorConfigLift: MetadataConversion = {
  id: 'flow-node-connector-config-lift',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.connector_action.connectorConfig',
  summary:
    "connector_action flow-node loose config keys 'connectorId' / 'actionId' / 'input' → " +
    'the declared `connectorConfig` block (the executor reads only that block; the published designer form had been writing these keys where nothing read them)',
  apply(stack, emit) {
    return liftConnectorConfigShape(stack, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'task_completed_slack',
          nodes: [
            { id: 'n1', type: 'start' },
            // The shape the descriptor's configSchema (via the schema-driven
            // Studio form) mis-taught: the whole trio under `config`.
            {
              id: 'n2',
              type: 'connector_action',
              config: {
                connectorId: 'slack',
                actionId: 'chat.postMessage',
                input: { channel: 'C0WINS000', text: 'Task done: {record.title}' },
              },
            },
            // A declared block WINS: the shadowed `config.connectorId` is
            // deleted (#23543 F3) and the block is untouched.
            {
              id: 'n3',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get', input: {} },
              config: { connectorId: 'ignored' },
            },
            // Completeness guard: no actionId anywhere, so lifting would
            // create a block the loader rejects — left untouched instead
            // (the flow parse refuses it for the missing block).
            {
              id: 'n4',
              type: 'connector_action',
              config: { connectorId: 'slack' },
            },
            // A partial lift may complete an existing block: only `input`
            // lifts into the already-complete pair.
            {
              id: 'n5',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get' },
              config: { input: { path: '/api/v1/health' } },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'task_completed_slack',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'connector_action',
              config: {},
              connectorConfig: {
                connectorId: 'slack',
                actionId: 'chat.postMessage',
                input: { channel: 'C0WINS000', text: 'Task done: {record.title}' },
              },
            },
            {
              id: 'n3',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get', input: {} },
              config: {},
            },
            {
              id: 'n4',
              type: 'connector_action',
              config: { connectorId: 'slack' },
            },
            {
              id: 'n5',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get', input: { path: '/api/v1/health' } },
              config: {},
            },
          ],
        },
      ],
    },
    // n2: the full trio lifts. n3: shadowed → deleted, one notice. n4: guard —
    // nothing materializes. n5: the single unshadowed `input`.
    expectedNotices: 5,
  },
};

export { flowNodeConnectorConfigLift };
