// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Two refusals in one entry because they are one walk and one remedy family:
// an edge must resolve in the graph that declares it, and must not be a copy
// the engine cannot tell from an earlier edge. Neither has a D2 conversion —
// a dangling endpoint carries no intent a rewrite could recover, and dropping
// a repeated edge changes how many times its target runs.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'flow-edge-unresolved-or-repeated-refused',
  surface:
    'a flow edge whose source or target is not the id of a node in the graph that declares it — '
    + 'the flow\'s own nodes for a top-level edge, the region body\'s nodes for an edge inside a '
    + 'loop, parallel or try_catch region, so a top-level edge into a region node is one of them — '
    + 'and a later edge of the same graph with the same source, target, type, condition and branch '
    + 'label as an earlier one. Reachable wherever a flow is authored or stored: defineStack flows '
    + 'sources, defineFlow, an exported stack passed to objectstack validate, a flow saved from the '
    + 'Studio flow designer after a node was removed (its edges were left behind, and a node added '
    + 'later under the reused id picked them up), and a flow row already sitting in sys_metadata',
  replacement:
    'an edge whose `source` and `target` are node ids declared in the same graph as the edge: '
    + 're-point the endpoint at the node it was meant to reach, or delete the edge. Deleting a '
    + 'dangling edge changes nothing a run did, with one exception: a conditioned edge into a '
    + 'missing node still counted as the branch taken when its condition held, so a default '
    + 'sibling was passed over and, on an exclusive `decision`, the later conditioned siblings '
    + 'were skipped — where a flow relied on that, point the edge at a node that ends the branch. '
    + 'For a repeated edge, delete the later copy: the target then runs once per traversal '
    + 'instead of once per copy — a CHANGE of behaviour wherever the copies ran it more than once, '
    + 'which is the defect being removed. An edge meant to take its own route needs its own '
    + '`condition` or branch `label`',
  reason:
    'The engine resolves an edge\'s endpoints in the graph that declares it — traversal looks the '
    + 'target up there, and a region runs against a view of its own nodes and edges — and runs a '
    + 'target once per out-edge it selects. `FlowSchema` held node ids and edge ids unique and '
    + 'checked neither that an edge names a node of its graph nor that it is not a copy of another, '
    + 'so a draft holding an edge into a node it no longer had, or one edge three times, passed '
    + '`FlowSchema.parse`, `objectstack validate` and the metadata save door, published with '
    + '`_diagnostics.valid: true`, and ran: the dangling edge carried the run nowhere, silently, '
    + 'and the repeated edge ran its target once per copy (one record update created three '
    + 'identical records). The parse now refuses both at every depth the region walk reaches: an '
    + 'endpoint at `edges.N.source` / `edges.N.target` (or the region path '
    + '`nodes.N.config.body.edges.M.target`), naming the missing id and, when it is a node of '
    + 'another graph, that graph; a repeated edge at `edges.N`, naming the earlier copy. Repeated '
    + 'means the key the engine selects on — `source`, `target`, `type`, `condition` (its dialect '
    + 'and source) and branch `label` — so two nodes joined by edges with different conditions, a '
    + '`fault` edge beside a default one, or `approve` and `reject` branches into one node stay '
    + 'legal. A region edge naming no node of its region was already refused at registration by '
    + 'the region analysis; the top-level half had no refusal anywhere. '
    + '⚠️ No D2 conversion: a dangling endpoint carries no intent a rewrite could recover, and '
    + 'dropping a repeated edge changes how many times its target runs. '
    + '⚠️ Where such an edge already sits the whole flow is refused: registered from the metadata '
    + 'registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not '
    + 'armed, while the flows beside it register; a `defineStack` flows source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load. '
    + 'ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Grep every flow in `defineStack` flows sources, exported stacks and every flow row in '
    + '`sys_metadata` — including the `edges` of each `loop` / `parallel` / `try_catch` region '
    + 'body — for an edge whose `source` or `target` is not the `id` of a node in the `nodes` list '
    + 'beside that `edges` list, and for two edges in one `edges` list with the same `source`, '
    + '`target`, `type`, `condition` and `label`. Each refusal names the edge: `FlowSchema.parse` '
    + 'anchors a `custom` issue at `edges.N.source`, `edges.N.target` or `edges.N` (or the region '
    + 'path `nodes.N.config.body.edges.M…`), and `objectstack validate` prints the same path. For a '
    + 'dangling endpoint, point it at the node the edge was meant to reach or delete the edge; for '
    + 'a repeated edge, delete the later copy. Two proofs. (1) For a stack authored in config '
    + 'files, `objectstack validate` is clean. (2) Boot the stack and confirm each flow REGISTERS: '
    + 'no `failed to register flow` warn for it (the three boot paths spell it `[Automation] failed '
    + 'to register flow`, `[Automation] flow re-sync: failed to register flow` and `[Automation] '
    + 'cold-boot flow bind: failed to register flow`) — that warn line is the locator for a row '
    + 'that exists only in `sys_metadata`. A flow whose edges all resolve in their own graph and '
    + 'repeat nothing parses and registers byte-identically to before.',
};
