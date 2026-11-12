// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the authoring rule `flow-node-unreachable`
// (`@objectstack/lint`). No D2 conversion: an unreached node never ran, so
// wiring it in changes what the flow does and deleting it does not, and only
// the author knows which was meant.
export const entry: SemanticMigration = {
  id: 'flow-node-unreachable-refused',
  surface:
    'automation.Flow.nodes and automation.Flow.edges on a flow saved live or published through the metadata '
    + 'doors (PUT /api/v1/meta/flow/NAME live save, the per-item publish, POST /api/v1/packages/PKG/publish-drafts, '
    + 'and the restore doors POST /api/v1/meta/flow/NAME/rollback, POST /api/v1/packages/PKG/commits/COMMIT/revert '
    + 'and POST /api/v1/packages/PKG/rollback; '
    + 'Studio, REST and MCP authors) and on a flow os validate / os build / os lint / os verify judge: a top-level node that no '
    + 'edge path from the flow\'s first start node reaches, a second start node included. Every edge type counts '
    + 'as a path (default, conditional, fault, back); a boundary_event node and the nodes only it leads to, and '
    + 'the nodes inside a loop, parallel or try_catch region body, are not judged',
  replacement:
    'Wire the node from the start node: add an edge into it from a node that runs. Or delete the node. A second '
    + 'start node is deleted, and what followed it is wired from a node that runs',
  reason:
    'A run starts at the flow\'s first start node and follows edges; nothing else schedules a top-level node. A '
    + 'node no edge path from the start node reaches (an edge forgotten while wiring, a node left behind when its '
    + 'in-edges were deleted) parsed, built, was stored live by the metadata save door and published, registered '
    + 'and reported itself as configured, and never ran. The authoring rule flow-node-unreachable (severity error) '
    + 'now refuses it in os validate, os build, os lint and os verify, and a live save, a publish and a restore answer 422 '
    + 'INVALID_METADATA with the rule in issues[], at `flow \'NAME\' · node \'ID\' (TYPE)`, one finding per node. '
    + 'A draft save (mode=draft) runs no rule and still stores, so a designer that deletes a node and leaves its '
    + 'successor unwired can keep saving; the finding is on the draft read\'s _diagnostics. '
    + 'Rows stored before this release: a flow row in sys_metadata, or a flow in an artifact built earlier, that '
    + 'holds an unreached node still registers at boot, arms its trigger and runs as it did before, and the '
    + 'unreached node still never runs: no engine registration check judges reachability, and the authoring '
    + 'rules run at the save and publish doors and in the CLI, not at boot. A live re-save of that row is '
    + 'refused until the node is wired or deleted, because the gate charges a write with the written flow\'s own '
    + 'findings whatever the stored row held; a draft stored earlier is judged at its publish and blocks its '
    + 'package\'s publish until fixed; a history version stored before the release that holds an unreached node can '
    + 'no longer be restored (the same 422); deleting the flow, or saving it as a draft, still works. '
    + 'OS_ALLOW_UNLINTED_METADATA_WRITES=1 turns the save, publish and restore refusal into a logged warning for a '
    + 'migration window. There is no mechanical rewrite: the node never ran, so deleting it keeps what the flow '
    + 'did and wiring it in changes it, and whether the author meant the step to run is a judgement about the flow.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files and confirm no flow-node-unreachable '
    + 'finding. For each stored flow, re-save it live (PUT /api/v1/meta/flow/NAME) and confirm it answers 200 '
    + 'rather than 422 naming flow-node-unreachable; for each node it named, an edge now leads to it from the start '
    + 'node, or it is gone. POST /api/v1/packages/PKG/publish-drafts publishes the package that holds the flow.',
};
