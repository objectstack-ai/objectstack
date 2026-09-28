// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ONE entry for the family, not one per node type: every member is the same
// decision — a node config its executor cannot run is refused where the flow
// is built, by one judge (`flowNodeConfigRefusals`), instead of registering
// and failing (or, for a branch with no label, misrouting) at run time.
//
// Form D: no tracker number anywhere in the author-shown text; the decision is
// stated in words.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'flow-node-config-required-keys-refused',
  surface:
    'a flow node whose config leaves out a key its executor contract requires — objectName on '
    + 'get_record / create_record / update_record / delete_record, recipients on notify (and title '
    + 'when there is no template), url on http, function on script, flowName on subflow, collection '
    + 'and flowName on map, collection on a loop that has a body, branches on parallel, try on '
    + 'try_catch, and on screen each field name, each option value and label, and a lookup field '
    + 'reference — and a decision node whose conditions is not an array, holds a branch that is not '
    + 'an object, or holds a branch whose label is absent, null, blank or not a string; at any depth '
    + 'including an ADR-0031 region body. Reachable wherever a flow is authored or stored: '
    + 'defineStack({ flows }) sources, defineFlow(), an exported stack passed to objectstack validate, '
    + 'a flow saved from the Studio flow designer (a node added and saved before it is configured; a '
    + 'decision branch row whose label cell is empty; a screen field row whose name cell is empty), '
    + 'and a flow row already sitting in sys_metadata',
  replacement:
    'the missing key, written on the node\'s `config` — the value the node was meant to act on '
    + '(`objectName: \'account\'`, `url: \'https://…\'`, `collection: \'{rows}\'`, …). For a decision '
    + 'branch, the label of the out-edge the branch should take (`{ label: \'approved\', expression: '
    + '\'record.amount > 1000\' }`, beside an out-edge labelled `approved`), `conditions` written as an '
    + 'array of such objects, and a bare predicate string moved under `expression`. To branch on the '
    + 'out-edges instead, delete `conditions` and put each predicate on its edge\'s `condition`. A '
    + 'legacy flat-graph `loop` (no `body`) needs no `collection` and is untouched',
  reason:
    'A flow node\'s `config` is an open record, so what its executor requires was checked by no build '
    + 'door: `FlowSchema.parse`, `AutomationEngine.registerFlow` and `objectstack validate` all admitted '
    + 'a node missing a key its executor contract requires, and the executor\'s own contract parse then '
    + 'refused the node on every run that reached it — the config is metadata, so no rerun could '
    + 'succeed. A decision branch with no label was worse: it never failed, the matched branch reported '
    + 'no label and traversal took EVERY out-edge, so the flow ran green down the wrong paths. All '
    + 'three doors now refuse these shapes through one judge, `flowNodeConfigRefusals`, which parses '
    + 'each builtin node\'s config against the very contract its executor parses against '
    + '(`getBuiltinNodeConfigContracts()`, reconciled against the executors\' own parse calls) and keeps '
    + 'only the keys left out — a present value of the wrong type and an undeclared key are judged where '
    + 'they were before — plus the decision branch shape its executor reads raw. A key a rule of the '
    + 'contract requires (a notify with no template needs a title; a lookup screen field needs its '
    + 'reference) is refused in the contract\'s own words. '
    + '⚠️ No D2 conversion: the platform cannot know the object, URL, collection, function or '
    + 'out-edge label the author left out, and no value it could write would keep what the flow did. '
    + '⚠️ Where such a node already sits the whole flow is refused: registered from the metadata '
    + 'registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not armed, '
    + 'while the flows beside it register; a `defineStack({ flows })` source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load. '
    + 'ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. Each refusal names the node and the key: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.config.<key>` (`nodes.N.config.fields.0.name`, `nodes.N.config.conditions.0.label`, or '
    + 'the region path `nodes.N.config.body.nodes.M.config…`), `objectstack validate` prints the same '
    + 'path, and `validateStackExpressions` phrases it as `node \'fetch\' (get_record) config.objectName`. '
    + 'For each hit write the key the node was meant to carry, per the replacement. Two proofs. (1) For '
    + 'a stack authored in config files, `objectstack validate` is clean. (2) Boot the stack and confirm '
    + 'each flow REGISTERS: no `failed to register flow` warn for it (the three boot paths spell it '
    + '`[Automation] failed to register flow`, `[Automation] flow re-sync: failed to register flow` and '
    + '`[Automation] cold-boot flow bind: failed to register flow`) — that warn line is the locator for a '
    + 'row that exists only in `sys_metadata`. A node carrying every key its contract requires parses '
    + 'and registers byte-identically to before, a decision with no `conditions` (or `conditions: null`, '
    + 'or an empty list) still routes by its out-edges, and a legacy `loop` with no `body` still needs '
    + 'no `collection`.',
};
