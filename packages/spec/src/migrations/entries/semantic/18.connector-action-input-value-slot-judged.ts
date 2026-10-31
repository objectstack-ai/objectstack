// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A connector_action node's connectorConfig.input joins the value slots the
// expression ledger declares, rooted in the node's sibling block, so the two
// build doors judge it as they judge a subflow's input map. Its executor half
// (the map evaluated through the per-key value-slot resolver) landed first.
//
// Form D: no tracker number anywhere in the author-shown text; the decision is
// stated in words.
export const entry: SemanticMigration = {
  id: 'connector-action-input-value-slot-judged',
  surface:
    'Each value of connectorConfig.input on a type: \'connector_action\' flow node, at any depth of the flow, '
    + 'including an ADR-0031 region body. Two values that registered and passed objectstack validate are now '
    + 'refused there: an expression envelope (an object naming a dialect) that is not a valid CEL value '
    + 'envelope — a CEL source that does not parse, a blank or missing source, a dialect other than cel, a '
    + 'template envelope among them — and a string carrying a single-brace {…} token of the retired flow '
    + 'template dialect, anywhere in the value (a string inside a nested list or object included). Reachable '
    + 'wherever a flow is authored or stored: defineStack({ flows }) sources and objectstack validate, a flow '
    + 'written through the runtime authoring gate (a flow saved from the Studio flow designer), and a flow row '
    + 'already sitting in sys_metadata, judged when the engine registers it at boot',
  replacement:
    'Write a computed value as a CEL value envelope, `{ dialect: \'cel\', source: \'record.id\' }`, evaluated '
    + 'in the run\'s scope before the action is dispatched; write a constant as the literal it is. For a '
    + 'string that carried a token, the refusal names the token\'s CEL spelling: `\'{rec.id}\'` becomes '
    + '`{ dialect: \'cel\', source: \'rec.id\' }`, and text with a token inside it becomes a CEL string '
    + 'expression (`\'Ticket for \' + rec.name`). For a malformed envelope, correct its source or write the '
    + 'value as a literal',
  reason:
    'The connector_action executor evaluates every top-level CEL envelope in `connectorConfig.input` before '
    + 'dispatch, through the same per-key value-slot resolver a subflow\'s `input` map uses, and fails the '
    + 'step on a malformed one. The two build doors judge value slots only through the spec\'s expression '
    + 'ledger, whose paths could address a node\'s `config` and no sibling block, so `registerFlow` and '
    + '`objectstack validate` admitted a malformed envelope, a template envelope and a `{…}` token in this '
    + 'map while refusing the same three under a subflow\'s `config.input`: one slot, two reject sets, and '
    + 'the malformed envelope met first by a run. A token string was never read as a template here; the '
    + 'action was handed its text as written. The ledger now roots a path in the node\'s `connectorConfig` '
    + 'block, so both doors judge this map by the value-slot rule every other value map takes. '
    + '⚠️ No D2 conversion: no token has a lossless CEL spelling (the value-slot template retirement measured '
    + 'each), and a malformed envelope carries no source the platform could correct. '
    + '⚠️ Where such a node already sits the whole flow is refused: registered from the metadata registry or '
    + '`sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not armed, while the flows '
    + 'beside it register; a `defineStack({ flows })` source fails `objectstack validate`. The flow parse '
    + '(`FlowSchema.parse`) does not judge the map, as it judges no value slot of a node\'s open `config`. '
    + 'ADR-0087, ADR-0032.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed stack. '
    + 'Each refusal names the node and the key: `objectstack validate` prints `node \'ID\' (connector_action) '
    + 'connector_action input value at connectorConfig.input.KEY`, and `registerFlow` names the same position, '
    + 'its message leading with the value-slot refusal sentence. For each hit, rewrite the value per the '
    + 'replacement. Two proofs. (1) For a stack authored in config files, `objectstack validate` is clean. '
    + '(2) Boot the stack and confirm each flow REGISTERS: no `failed to register flow` warn for it — that warn '
    + 'line is the locator for a row that exists only in `sys_metadata`. A connector node whose input holds '
    + 'literals and valid CEL envelopes registers and dispatches as before, and `input` stays optional.',
};
