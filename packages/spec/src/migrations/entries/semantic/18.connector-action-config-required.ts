// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The `connector_action` sibling of `wait-node-event-config-required`: a node
// whose one input is a SIBLING block (not `config`) owes that block, and the
// flow parse now refuses what the executor's own read refuses — the block
// absent, or an id in it empty.
//
// Form D: no tracker number anywhere in the author-shown text; the decision is
// stated in words.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'connector-action-config-required',
  surface:
    'The connectorConfig block of every type: \'connector_action\' flow node — the BLOCK, and its '
    + 'connectorId and actionId once it is written. The block was optional on the node and both ids '
    + 'were any string inside it, so a node with no block, or with connectorId or actionId empty or '
    + 'only whitespace, parsed. That is the state of a node authored without its configuration, and '
    + 'of a new connector node from the Studio flow designer, which seeds both ids empty. At any depth, '
    + 'including an ADR-0031 region body. Reachable wherever a flow is authored or stored: '
    + 'defineStack({ flows }) sources, defineFlow(), an exported stack passed to objectstack validate, '
    + 'a flow saved from the Studio flow designer (a connector node added and saved before it is '
    + 'configured), and a flow row already sitting in sys_metadata. Also reached: connectorId, actionId '
    + 'or input written under the node\'s config instead of the block, where the load-time conversion '
    + 'cannot complete the pair and leaves them there',
  replacement:
    'Declare what the node dispatches, on the node: `connectorConfig: { connectorId: \'slack\', '
    + 'actionId: \'chat.postMessage\', input: { channel: \'C0WINS000\', text: \'Done\' } }` — '
    + '`connectorId` the registered connector\'s `name`, `actionId` one of the action keys that '
    + 'connector declares, `input` optional. Keys written under the node\'s `config` move into the '
    + 'block. A node you cannot configure yet is deleted until you can: there is no placeholder '
    + 'connector, and a block with empty ids names nothing to dispatch to',
  reason:
    'The block is the node\'s whole contract: the connector_action executor reads nothing else and '
    + 'refuses the node when `connectorId` or `actionId` is empty. The build doors checked only the '
    + 'block\'s shape once it was written, so `FlowSchema.parse`, `AutomationEngine.registerFlow` and '
    + '`objectstack validate` all admitted a node with no block, or with an empty id, and every run '
    + 'that reached the node then failed at the executor\'s guard — a guard refusal, never routed to a '
    + '`fault` edge, and no rerun could succeed because the config is metadata. The flow parse now '
    + 'refuses what that read refuses, in the walk that reaches every region body, so all three doors '
    + 'answer alike. A whitespace-only id is refused with the empty one: a connector `name` is a '
    + 'snake_case identifier, so whitespace names nothing a dispatch can reach. '
    + '⚠️ No D2 conversion: the platform cannot know the connector or the action the author left out, '
    + 'and no value it could write would dispatch anything. '
    + '⚠️ Where such a node already sits the whole flow is refused: registered from the metadata '
    + 'registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not armed, '
    + 'while the flows beside it register; a `defineStack({ flows })` source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load. '
    + 'ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. Each refusal names the node and the key: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.connectorConfig` for an absent block, at `nodes.N.connectorConfig.connectorId` or '
    + '`nodes.N.connectorConfig.actionId` for an empty or whitespace-only id, or at the region path '
    + '`nodes.N.config.body.nodes.M.connectorConfig…`, and `objectstack validate` prints the same path '
    + 'under `flows.K.`. For each hit write the block, per the replacement. Two proofs. (1) For a stack '
    + 'authored in config files, `objectstack validate` is clean. (2) Boot the stack and confirm each '
    + 'flow REGISTERS: no `failed to register flow` warn for it — that warn line is the locator for a '
    + 'row that exists only in `sys_metadata`. A connector node carrying a complete block parses, '
    + 'registers and dispatches as before, and `input` stays optional.',
};
