// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the authoring rule `flow-start-node-missing`
// (`@objectstack/lint`). No D2 conversion: the start node carries the flow's
// trigger, which only the author knows, so no rewrite keeps what the flow
// was meant to do.
export const entry: SemanticMigration = {
  id: 'flow-start-node-missing-refused',
  surface:
    'automation.Flow.nodes on a flow saved live or published through the metadata doors '
    + '(PUT /api/v1/meta/flow/NAME live save, the per-item publish, POST /api/v1/packages/PKG/publish-drafts; '
    + 'Studio, REST and MCP authors) and on a flow os validate / os build / os lint judge: a flow whose top-level '
    + 'nodes hold no node of type start, an empty list included. A start node inside a loop, parallel or '
    + 'try_catch region body does not count',
  replacement:
    'Add a node with `type: \'start\'` to the flow\'s top-level `nodes` and an edge from it to the first step. '
    + 'A record-change or schedule flow declares its trigger in that start node\'s `config`',
  reason:
    'A run begins at the flow\'s first top-level start node and follows edges from there; nothing else '
    + 'schedules a top-level node. FlowSchema requires no start node, so a flow whose top-level nodes held none '
    + 'parsed, built, was stored live by the metadata save door (200) and published, and could never run: every '
    + 'trigger and every explicit run was refused with FLOW_NO_START_NODE, and the automation engine now refuses '
    + 'to register it. The authoring rule flow-start-node-missing (severity error) now refuses it in os validate, '
    + 'os build and os lint, and a live save and a publish answer 422 INVALID_METADATA with the rule in issues[], '
    + 'at `flow \'NAME\' · nodes`, naming the node types found. A draft save (mode=draft) still stores, with the '
    + 'finding in its _diagnostics, so a designer can keep saving mid-edit. A flow with two start nodes is not '
    + 'this rule: it runs from the first, and flow-node-unreachable names the extra one. '
    + 'Rows stored before this release: a start-less flow row in sys_metadata stays stored and readable. The '
    + 'boot completes and the flow is not armed: the engine refuses to register it with a warn naming the flow '
    + '(`[Automation] failed to register flow`, or `[Automation] cold-boot flow bind: failed to register flow`), '
    + 'and the metadata read serves the stored row unchanged beside `registration: refused` and the engine\'s '
    + 'words naming the missing start node. A live re-save of that row is refused until a start node is added, '
    + 'because the gate charges a write with the written flow\'s own findings whatever the stored row held; a '
    + 'draft stored earlier is judged at its publish and blocks its package\'s publish until fixed; deleting the '
    + 'flow, or saving it as a draft, still works. OS_ALLOW_UNLINTED_METADATA_WRITES=1 turns the save and publish '
    + 'refusal into a logged warning for a migration window; the engine still refuses to register the flow. '
    + 'There is no mechanical rewrite: the start node carries the trigger, which only the author knows.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files and confirm no flow-start-node-missing '
    + 'finding. For stored flows, GET /api/v1/meta/flow/NAME for each flow and confirm none reads '
    + '`registration: refused` for a missing start node, and boot the stack with no `failed to register flow` '
    + 'warn naming it. PUT /api/v1/meta/flow/NAME with a top-level start node wired to the first step answers '
    + '200, and POST /api/v1/packages/PKG/publish-drafts publishes the package that holds it.',
};
