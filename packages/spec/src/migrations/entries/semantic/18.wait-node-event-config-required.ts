// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'wait-node-event-config-required',
  surface:
    'The `waitEventConfig` block of every `type: \'wait\'` flow node, and the '
    + '`boundaryConfig` block of every `type: \'boundary_event\'` node — the BLOCK, not a key '
    + 'inside it. `eventType` has been required INSIDE each block since protocol 17, so the '
    + 'contract already refused `waitEventConfig: {}`; what it also accepted was the block '
    + 'missing entirely, which is the state a freshly created node is in. Two documents, two '
    + 'verdicts, and the accepted one was the silent one. Also narrowed one level down: under '
    + '`eventType: \'timer\'`, `timerDuration` is now required and may not be blank.',
  replacement:
    'Declare what resumes the node, on the node: `waitEventConfig: { eventType: \'timer\', '
    + 'timerDuration: \'PT1H\' }` for a delay — QUOTE a bare number, the key is a string and a '
    + 'numeric string is read as milliseconds, so \'60000\' is the same 60s wait as \'PT1M\' — '
    + 'or `{ eventType: \'signal\' | \'webhook\' | \'manual\' | \'condition\', signalName: '
    + '\'<event>\' }` when an external producer resumes the run. For `boundary_event`, '
    + '`boundaryConfig: { attachedToNodeId: \'<host node>\', eventType: \'error\' | \'timer\' | '
    + '\'signal\' | \'cancel\' }`. ⛔ There is deliberately NO default for either `eventType`: a '
    + 'required key has no "unset behaves as", and an indefinite park — if one is ever wanted — '
    + 'is its own declared `eventType`, never the absence of configuration. ⚠️ `boundary_event` '
    + 'has no executor in the runtime at all (a flow reaching one fails with NO_EXECUTOR), so a '
    + 'stored boundary node is an authoring-surface repair: the native construct for error '
    + 'handling is a `try_catch` region (ADR-0031).',
  reason:
    'Maintainer ruling, decision batch #127 item 5, verbatim and untranslated: '
    + '「16678 具体解释，计划用哪个字段判断经理。其他同意」 — carrying the presented option: the '
    + 'protocol is the source of truth; a designer never invents a default the protocol does '
    + 'not apply; a default the protocol should have is declared by the protocol; a required '
    + 'key has no "unset behaves as". ⛔ NOT losslessly convertible, and the reason is that the '
    + 'missing value is an INTENT no artifact records: a block-less wait node does not say '
    + 'whether its author meant a delay (and for how long) or a named signal (and which one), '
    + 'and a transform that picked one would be inventing the very default this ruling forbids. '
    + 'What the old runtime picked was \'timer\' with no duration, which is not a wait at all: '
    + 'measured through a real `engine.execute()` run, such a node answered `{ success: true, '
    + 'suspend: true }`, scheduled no wake-up job THOUGH A JOB SERVICE WAS ANSWERING, persisted '
    + 'no `waitUntil` for a later boot\'s re-arm pass, and emitted not one log line at any '
    + 'level — the run parked forever and reported success. So the conversion layer (D2) cannot '
    + 'hide this break and the tombstone channel cannot carry it either (nothing was renamed or '
    + 'retired; a key that was optional became required), which leaves D3: a structured TODO '
    + 'naming each node that must be edited. The alternative considered and NOT taken was to '
    + 'warn and keep parsing — a warning on the authoring path an AI agent drives is read by '
    + 'nobody, and the agent reports "done" over a flow that hangs.',
  acceptanceCriteria:
    'Every `type: \'wait\'` node in the stack — at the top level AND inside every ADR-0031 '
    + 'region body — carries a `waitEventConfig` with an `eventType`, and every one whose '
    + '`eventType` is \'timer\' carries a non-blank `timerDuration`; every `type: '
    + '\'boundary_event\'` node carries a `boundaryConfig` with an `attachedToNodeId` and an '
    + '`eventType`. `FlowSchema.parse` (and therefore `registerFlow`, `os validate` and a '
    + 'Studio publish) accepts the stack: a node still missing its block is refused with the '
    + 'key named at `nodes[i].waitEventConfig` / `nodes[i].boundaryConfig` and the remedy in '
    + 'the message. ⚠️ A region body is checked through the REGION contract rather than the '
    + 'flow parse — `parseFlowNodeRegions` leaves a refused region raw — so a nested node is '
    + 'named by `LoopConfigSchema` / `ParallelConfigSchema` / `TryCatchConfigSchema` at '
    + '`body.nodes[i].waitEventConfig`, and at run time by the container node\'s own '
    + 'execute-time config parse; check the nested ones by parsing the container config, not '
    + 'only by parsing the flow. Behaviour to re-check after editing, because the fix CHANGES '
    + 'IT deliberately: a run that used to park forever on such a node now either waits the '
    + 'duration you declared or waits for the signal you named — anything that resumed those '
    + 'runs by hand (an operator calling `resume(runId)`, a nightly sweep) has less to do, and '
    + 'anything that COUNTED on the park is now on a timer.',
};
