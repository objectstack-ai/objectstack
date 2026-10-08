// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21982 — the D3 entry for the build doors refusing an UNDECLARED KEY on a
// `script` or `subflow` node's config: the key half of the executor-contract
// arm of `flowNodeConfigRefusals` (`flow-node-config-refusals.ts`), beside the
// value half (`flow-builtin-node-config-values-refused`) and the presence half
// (`flow-node-config-required-keys-refused`). It narrows a flow's accept set;
// no key is removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR
// row. There is no D2 conversion either: the platform cannot know what an
// undeclared key was meant to be, and the runtime never ran such a node.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-script-subflow-config-undeclared-keys-refused',
  surface:
    'a script or subflow flow node whose config carries a key its executor contract does not declare — a '
    + 'typo (funtion), a key copied from another node type (a subflow timeoutMs written inside config, an '
    + 'approvers list on a script), or a key nothing reads (bogusKey). script declares function, inputs and '
    + 'outputVariable; subflow declares flowName, input and outputVariable. Never a retired script key '
    + '(actionType, template, recipients, variables, script), which keeps its own path, and never a key on '
    + 'any other builtin node type, whose undeclared keys registration already judges against the node '
    + 'type descriptor. Reachable wherever a flow is authored or stored: defineStack({ flows }) sources, '
    + 'defineFlow(), an exported stack passed to objectstack validate or objectstack compile, a flow saved '
    + 'from the Studio flow designer, and a flow row already sitting in sys_metadata',
  replacement:
    'the key the contract declares, or no key: rename a typo to the declared key it meant (`function`, '
    + '`inputs`, `outputVariable` on a `script`; `flowName`, `input`, `outputVariable` on a `subflow`), move '
    + 'a value the function or the child flow should receive into `inputs` (script) or `input` (subflow), '
    + 'move a `subflow` timeout to the node itself (`{ id, type: \'subflow\', timeoutMs: 30000, config: { … } }`), '
    + 'and delete a key nothing reads. The refusal carries the contract\'s own sentence, with its '
    + 'did-you-mean for a near miss',
  reason:
    'The `script` and `subflow` executors (`service-automation` `builtin/screen-nodes.ts`, '
    + '`builtin/subflow-node.ts`) parse the node\'s `config` against a strict contract '
    + '(`ScriptConfigSchema`, `SubflowConfigSchema`) before they act, and refuse the node on an undeclared '
    + 'key. No door before the run judged one: `registerFlow`\'s undeclared-key check derives the declared '
    + 'set from the node type descriptor\'s `configSchema`, and these two descriptors publish none (the '
    + 'schemaless class, `SCHEMALESS_NODE_CONFIG_SCHEMAS`), while the build doors\' executor-contract arm '
    + 'judged required keys and present values but held key membership back on the premise that '
    + 'registration judges it. So a `script` node carrying `bogusKey` passed `FlowSchema.parse`, `objectstack '
    + 'validate` and `objectstack compile` (which copied the key into the artifact), registered, and then '
    + 'failed every run that reached the node: the config is metadata, and no rerun could succeed. The one '
    + 'judge `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and `objectstack '
    + 'validate` share (`flowNodeConfigRefusals`) now refuses such a key on these two types as '
    + '`node-config-refused-by-contract`, anchored at the key, one refusal per key, in the contract\'s own '
    + 'words — the code the value half and the approval contract already use. Every other builtin keeps its '
    + 'undeclared keys where they were judged: at registration, against its descriptor, with that check\'s '
    + 'own prescriptions. `decision` is schemaless too, but its executor parses no contract, so an '
    + 'undeclared key there fails no run and stays unjudged. A retired `script` key keeps its tombstone '
    + 'path. ⚠️ A spelling the ADR-0087 D2 conversion `flow-node-script-config-aliases` or '
    + '`flow-node-subflow-flow-alias` still rewrites at load (`functionName`, `input` on a `script`; `flow` '
    + 'on a `subflow`) is converted before the judge at every door that converts first; met by a direct '
    + '`FlowSchema.parse` or `defineFlow()` it is refused like any other undeclared key, as the missing '
    + 'canonical key already was. ⚠️ No D2 conversion: the platform cannot know what an undeclared key was '
    + 'meant to be. ⚠️ Where such a node already sits the whole flow is refused: registered from the '
    + 'metadata registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not '
    + 'armed, while the flows beside it register; a `defineStack({ flows })` source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load. ADR-0087, '
    + 'ADR-0031.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. Each refusal names the node and the key: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.config.<key>` (`nodes.N.config.bogusKey`, or the region path '
    + '`nodes.N.config.body.nodes.M.config…`), `objectstack validate` prints the same path, and '
    + '`validateStackExpressions` phrases it as `node \'summarize\' (script) config.bogusKey`. For each hit '
    + 'rename, move or delete the key per the replacement. Two proofs. (1) For a stack authored in config '
    + 'files, `objectstack validate` is clean. (2) Boot the stack and confirm each flow REGISTERS: no '
    + '`failed to register flow` warn for it — that warn line is the locator for a row that exists only in '
    + '`sys_metadata`. A `script` or `subflow` node whose keys its contract declares parses and registers '
    + 'byte-identically to before.',
};
