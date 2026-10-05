// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21850 — the D3 entry for the build doors judging an `approval` node's config
// against the contract the spec declares for it (`ApprovalNodeConfigSchema`),
// whole: the declared contract map in `flow-node-config-refusals.ts`, read by
// the one judge `flowNodeConfigRefusals`. It narrows a flow's accept set; no key
// is removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. There
// is no D2 conversion either: the platform cannot know the approvers, the key
// or the value the author meant, and the runtime never ran such a node.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-approval-node-config-contract-refused',
  surface:
    'an approval flow node whose config the approval node contract (ApprovalNodeConfigSchema) refuses — '
    + 'a key it does not declare (escalation.bogusKey, a top-level key such as steps or onApprove, an '
    + 'alias such as escalation.timeout), a value it refuses (escalation.timeoutHours below 1, an '
    + 'unknown behavior or escalation.action, an empty approvers list, a fallbackApprovers list under any '
    + 'policy but fallback), or a key it requires left out (approvers; escalation.timeoutHours inside an '
    + 'escalation block). Reachable wherever a flow is authored or stored: defineStack({ flows }) sources, '
    + 'defineFlow(), an exported stack passed to objectstack validate or objectstack compile, a flow saved '
    + 'from the Studio flow designer, and a flow row already sitting in sys_metadata',
  replacement:
    'the shape the approval contract declares, written on the node\'s `config`: `approvers` with at least '
    + 'one approver, and inside an `escalation` block a `timeoutHours` of at least 1 (wall-clock hours; '
    + '`timeoutHours: 1` is the shortest SLA the contract accepts). An undeclared key is renamed to the key '
    + 'the refusal\'s did-you-mean names (`timeout` → `timeoutHours`, `mode` → `behavior`, `quorum` → '
    + '`minApprovals`) or deleted; a process-level key (`steps`, `entryCriteria`, `onApprove`, `onReject`, '
    + '`rejectionBehavior`) moves onto the flow graph as the refusal\'s guidance says. To turn an SLA off, '
    + 'delete the whole `escalation` block — an `escalation: { enabled: false }` with no `timeoutHours` '
    + 'is refused like any block missing it',
  reason:
    'An approval node\'s executor (`plugin-approvals`) parses `node.config` against '
    + '`ApprovalNodeConfigSchema` before it does anything else and fails the node on ANY issue. '
    + 'Registration already refused an undeclared key, against the descriptor\'s published `configSchema`, '
    + 'but a refused value (`timeoutHours: 0.5`) registered and then failed every run that reached the node '
    + '— the config is metadata, and no rerun could succeed. The build doors asked about neither: '
    + '`FlowSchema.parse` judged only the builtin node types\' '
    + 'executor contracts, and only for a key left out, so `objectstack validate` and `objectstack compile` '
    + 'exited 0 on an `escalation.bogusKey` or a `timeoutHours: 0.5` and compile copied it into the '
    + 'artifact. The contract is the spec\'s own, so the build can judge it with no plugin loaded: the '
    + 'approval node joins a declared contract map beside the builtin executor contracts, read by the one '
    + 'judge `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and '
    + '`objectstack validate` share (`flowNodeConfigRefusals`), and is judged WHOLE — every issue the '
    + 'contract raises is refused, because the executor refuses on every one. An undeclared key or a '
    + 'refused value is `node-config-refused-by-contract`, anchored at the key, in the contract\'s own '
    + 'sentence (its did-you-mean included); a key left out keeps `node-config-key-missing` or '
    + '`node-config-key-required-by-rule`. The builtin arm is unchanged and stays presence-only. '
    + 'A plugin node type whose contract the spec does not declare stays outside the build doors, as '
    + 'before. ⚠️ No D2 conversion: the platform cannot know the approvers, the key or the value the '
    + 'author meant, and no value it could write would keep what the flow did. ⚠️ Where such a node '
    + 'already sits the whole flow is refused: registered from the metadata registry or `sys_metadata` '
    + 'at boot it is skipped with a `warn` naming it, its trigger not armed, while the flows beside it '
    + 'register; a `defineStack({ flows })` source throws `StackSchemaInvalidError` for the whole stack; '
    + 'an artifact file is refused whole at load. ADR-0087, ADR-0019.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. Each refusal names the node and the key: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.config.<key>` (`nodes.N.config.escalation.bogusKey`, `nodes.N.config.escalation.'
    + 'timeoutHours`, `nodes.N.config.approvers`), `objectstack validate` prints the same path, and '
    + '`validateStackExpressions` phrases it as `node \'gate\' (approval) config.escalation.bogusKey`. '
    + 'For each hit write what the contract accepts, per the replacement. Two proofs. (1) For a stack '
    + 'authored in config files, `objectstack validate` is clean. (2) Boot the stack and confirm each '
    + 'flow REGISTERS: no `failed to register flow` warn for it — that warn line is the locator for a '
    + 'row that exists only in `sys_metadata`. An approval node the contract accepts parses and '
    + 'registers byte-identically to before.',
};
