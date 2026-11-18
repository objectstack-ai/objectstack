// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of six author-time rules (#34776) that refuse, at
// publish and in `os validate` / `build`, metadata the schema still accepts but
// the runtime ignores or turns against its author. Notice only: no key is
// removed and no D2 conversion exists, because each fix is a choice only the
// author can make (which state a record starts in, how long a call may wait).
export const entry: SemanticMigration = {
  id: 'publish-refuses-metadata-the-runtime-ignores',
  surface:
    'Six author-time rules, run by the runtime publish gate and by `os validate` / `lint` / `compile` / `build`: '
    + 'a flow node whose `type` no executor in the deployment runs (`flow-node-type-no-executor`, judged at publish '
    + 'against the automation engine\'s sealed node-type vocabulary); an `approval` node whose decision out-edges are '
    + 'not labelled `approve` and `reject` (`flow-approval-decision-unrouted`); an `http` node with no `timeoutMs` '
    + '(`flow-http-timeout-missing`, a warning); a `boolean` / `toggle` field marked `required` '
    + '(`field-boolean-required`); a `state_machine` validation with no `initialStates` '
    + '(`state-machine-no-initial-states`); a standalone action that declares `locations` but no `objectName` '
    + '(`action-no-object-binding`)',
  replacement:
    'Give the node a type the deployment runs (or install the plugin that contributes it); label the approval node\'s '
    + 'two decision edges `approve` and `reject`; set `config.timeoutMs` on the http node; remove `required` from the '
    + 'checkbox and give it `defaultValue: false` (a validation rule says so when the box must be ticked); list the '
    + 'states a record may be created in under `initialStates`; set the action\'s `objectName`, or write `locations: []` '
    + 'for an action that is headless (REST / MCP / AI only)',
  reason:
    'Each declaration parses and publishes, then does nothing or works against its author at run time: a node no '
    + 'executor runs fails every run with NO_EXECUTOR; an approval decision with no matching edge routes nowhere; an '
    + 'http call with no timeout waits as long as the connection stays open; a required checkbox makes the record form '
    + 'refuse to save the box unchecked, while `false` is never a missing value; a state machine without '
    + '`initialStates` lets a record be created already in its last state; an action bound to no object never renders. '
    + 'Stored items are not rewritten or refused at boot. The next publish or write of an item that carries one of the '
    + 'five errors is refused with the fix named, and the http timeout is reported as a warning.',
  acceptanceCriteria:
    'os validate reports none of the five errors (`flow-node-type-no-executor` is judged only at publish, against the '
    + 'deployment\'s sealed vocabulary) and no `flow-http-timeout-missing` warning; a publish of every flow, object and '
    + 'action the package carries succeeds.',
};
