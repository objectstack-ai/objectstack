// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F3 — the two lifts' one D3 entry. The D2 halves are
// `flow-node-wait-event-config-lift` and `flow-node-connector-config-lift`
// (both step-17 conversions), which move every named loose key the chain can
// reach into its block and are now retired from the load path; this entry
// states the refusal an authored source meets at 18, and the one shape no
// conversion repairs — a connector node whose pair the lift cannot complete.
export const entry: SemanticMigration = {
  id: 'flow-sibling-block-loose-config-keys-refused',
  surface:
    'wait and connector_action flow-node settings written under config (eventType, timerDuration, duration, '
    + 'signalName, signal, timeoutMs on wait; connectorId, actionId, input on connector_action)',
  replacement:
    'the sibling block each executor reads — `waitEventConfig` (`duration` → `timerDuration`, `signal` → '
    + '`signalName`, `timeoutMs` → `timerDuration` as a string, the other keys by the same name) and '
    + '`connectorConfig` (each key by the same name)',
  reason:
    'A maintainer ruling retired the two lifts at 18. Neither node type has a `config` contract: the `wait` '
    + 'executor reads only `waitEventConfig` and the `connector_action` executor only `connectorConfig`. '
    + 'Through 17 the loader lifted these keys from `config` into the block with a notice. At 18 the flow '
    + 'parse refuses each one where it is written, naming the block key it belongs on, at `objectstack '
    + 'validate`, `objectstack build` and `defineStack`, so under `objectstack lint` too when the config '
    + 'calls it — because with the lift gone a loose key would be read by nobody, and a loose `input` '
    + 'beside a complete `connectorConfig` would dispatch the action with no input. The D2 conversions '
    + 'make the move wherever the chain reaches: `objectstack migrate meta` lists every such key in your '
    + 'metadata sources. Where the block already sets the same key, the block is the one the node always '
    + 'ran with, and the loose key is deleted. Stored flows keep loading: every rehydration seam replays '
    + 'both conversions, and each now deletes the loose keys its block shadows instead of leaving them '
    + 'for the parse to refuse; the metadata save door judges a flow after the same replay, so a script '
    + 'that still sends the loose spelling keeps saving. What no conversion repairs is a `connector_action` '
    + 'node whose `connectorId` / `actionId` pair is complete in neither place: that node never loaded, '
    + 'and it is still refused until its block names both.',
  acceptanceCriteria:
    '`objectstack validate` reports no refusal at a `config` path of a `wait` or `connector_action` node, '
    + 'every such node declares its settings in `waitEventConfig` / `connectorConfig` only, and each wait '
    + 'resumes and each connector action dispatches with the same input as before.',
  conversionIds: ['flow-node-wait-event-config-lift', 'flow-node-connector-config-lift'],
};
