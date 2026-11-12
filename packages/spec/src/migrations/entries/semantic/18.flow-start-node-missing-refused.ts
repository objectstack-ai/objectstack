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
    + '(PUT /api/v1/meta/flow/NAME live save, the per-item publish, POST /api/v1/packages/PKG/publish-drafts, '
    + 'and the restore doors POST /api/v1/meta/flow/NAME/rollback, POST /api/v1/packages/PKG/commits/COMMIT/revert '
    + 'and POST /api/v1/packages/PKG/rollback; '
    + 'Studio, REST and MCP authors), on a flow registered through the automation write doors (POST /api/v1/automation, '
    + 'PUT /api/v1/automation/NAME), and on a flow os validate / os build / os lint / os verify judge: a flow whose top-level '
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
    + 'os build, os lint and os verify, and a live save, a publish and a restore answer 422 INVALID_METADATA with the rule in issues[], '
    + 'at `flow \'NAME\' · nodes`, naming the node types found. The automation write doors (POST /api/v1/automation, '
    + 'PUT /api/v1/automation/NAME) register the flow before they store it, so the engine\'s registration check '
    + 'refuses it first and the door answers 400 VALIDATION_FAILED with the engine\'s words ("Flow \'NAME\' '
    + 'rejected: the flow\'s top-level `nodes` hold no `start` node …") and registers and stores nothing. A draft save (mode=draft) runs no rule and still '
    + 'stores, so a designer can keep saving mid-edit; the finding is on the draft read\'s _diagnostics. A flow with two start nodes is not '
    + 'this rule: it runs from the first, and flow-node-unreachable names the extra one. '
    + 'Rows stored before this release: a start-less flow row in sys_metadata stays stored and readable, and a '
    + 'start-less flow in an artifact built earlier still loads. The '
    + 'boot completes and the flow is not armed: the engine refuses to register it with a warn naming the flow '
    + '(the boot pull `[Automation] failed to register flow`, the kernel:ready bind `[Automation] cold-boot flow bind: '
    + 'failed to register flow`, the metadata:reloaded re-sync `[Automation] flow re-sync: failed to register flow`, '
    + 'and the metadata-change sync `[Automation] a flow changed in the metadata store could not be registered`), '
    + 'and the metadata read serves the stored row unchanged beside `registration: refused` and the engine\'s '
    + 'words naming the missing start node. A live re-save of that row is refused until a start node is added, '
    + 'because the gate charges a write with the written flow\'s own findings whatever the stored row held; a '
    + 'draft stored earlier is judged at its publish and blocks its package\'s publish until fixed; a history '
    + 'version stored before the release that holds no start node can no longer be restored (the same 422); '
    + 'deleting the flow, or saving it as a draft, still works. OS_ALLOW_UNLINTED_METADATA_WRITES=1 turns the save, publish and '
    + 'restore refusal into a logged warning for a migration window; it does not cover the automation write doors\' '
    + '400, which is the engine\'s registration check and reads no such variable, and the engine still refuses to '
    + 'register the flow. '
    + 'There is no mechanical rewrite: the start node carries the trigger, which only the author knows.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files and confirm no flow-start-node-missing '
    + 'finding. For stored flows, GET /api/v1/meta/flow/NAME for each flow and confirm none reads '
    + '`registration: refused` for a missing start node, and boot the stack with no `failed to register flow` '
    + 'warn naming it. PUT /api/v1/meta/flow/NAME with a top-level start node wired to the first step answers '
    + '200, and POST /api/v1/packages/PKG/publish-drafts publishes the package that holds it.',
};
