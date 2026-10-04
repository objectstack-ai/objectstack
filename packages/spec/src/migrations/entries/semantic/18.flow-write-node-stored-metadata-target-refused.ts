// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21654 — the D3 entry for `FlowSchema`'s refusal of a write node aimed at a
// stored-metadata table: the save-time half of #21624, which applies #21520's
// ruling A (record 5965059068) to flows, whose run-time half refuses the same
// node before any write. It narrows a flow's accept set; no key is removed, so
// there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. There is no D2
// conversion either: a refused node carries no intent the chain could rewrite
// into one the runtime runs.
export const entry: SemanticMigration = {
  id: 'flow-write-node-stored-metadata-target-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span and a table cell.
  surface:
    'a create_record, update_record or delete_record flow node whose config.objectName is the string '
    + 'sys_metadata or sys_metadata_history, at any depth including an ADR-0031 region body',
  replacement:
    'Change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`, the metadata protocol), '
    + 'where it is validated and its provenance is recorded. Delete the node, or point its `objectName` at '
    + 'the object the flow really means to write. Elevation (`runAs`, a system context) does not change this.',
  reason:
    '`FlowSchema` accepted a `create_record`, `update_record` or `delete_record` node whose `objectName` '
    + 'names `sys_metadata` or `sys_metadata_history`, the tables that hold stored metadata. The maintainer '
    + 'ruled (2026-10-03) that app-authored work may not write those tables: the metadata protocol is their '
    + 'only writer, where a change is validated and its provenance recorded, and a flow is app-authored '
    + 'automation. The runtime enforces that at the node, refusing the write before it resolves a filter, '
    + 'computes a field or calls the data engine, under every run identity; but every authoring door still '
    + 'accepted such a flow, and the author learned otherwise only at its first run. The parse now refuses '
    + 'it too, through the one judge `FlowSchema.parse`, `AutomationEngine.registerFlow` and '
    + '`objectstack validate` share (`flowNodeConfigRefusals`), with the runtime\'s prescription: '
    + '`objectstack validate`, `defineStack`, compile, an artifact\'s parse, `registerFlow` and the metadata '
    + 'save door each name the node at `nodes.N.config.objectName`. The refused set is exactly the '
    + 'runtime\'s: one of those three write nodes, whose `objectName` is a string naming a stored-metadata '
    + 'table by exact name. A `get_record` node is outside it (a read is not a write), and so is a dynamic '
    + 'target, a `{token}` template or an expression envelope: the parse cannot read it as a name, and the '
    + 'run judges the name it hands the data engine. No authored flow writing either table was measured in this '
    + 'repository, its examples, its skills or its docs. There is no mechanical rewrite: retargeting the '
    + 'node or deleting it each changes what the author wrote, and the runtime already never ran it. Where '
    + 'such a node already sits, the whole flow is refused: registered from `sys_metadata` at boot it is '
    + 'skipped with a warn naming it, its trigger not armed, while the flows beside it register.',
  acceptanceCriteria:
    '`objectstack validate` reports no issue at a flow node\'s `config.objectName`: no `create_record`, '
    + '`update_record` or `delete_record` node names `sys_metadata` or `sys_metadata_history`. Every change '
    + 'those nodes made to metadata is made through the metadata API instead. Saving each formerly affected '
    + 'flow through the metadata API succeeds instead of answering a 422 that names `config.objectName`, '
    + 'and boot logs no `failed to register flow` warn for it.',
};
