// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The confirmation contract of `ai.requiresConfirmation: true` is amended
// (`AI_ACTION_CONFIRMATION_CAPABILITY`, `contracts/ai-service.ts`): a person
// confirms through MCP elicitation, and the caller's own `confirm: true` stops
// counting. A structured TODO, not a D2 conversion: nothing an author wrote is
// rewritten or refused, and whether a gated action still needs a person, and
// which clients its users run, is the author's judgement.
export const entry: SemanticMigration = {
  id: 'action-requires-confirmation-elicited',
  surface:
    'objects[].actions[].ai.requiresConfirmation and actions[].ai.requiresConfirmation set to `true` — '
    + 'what the declaration asks of a caller on the MCP `run_action` and `resume_run` tools',
  replacement:
    'Keep the declaration where a person must approve the call. What changes is who confirms: the server asks '
    + 'the person through the MCP client with an elicitation (`elicitation/create`, form mode), and only an '
    + 'accepted answer runs the action. A client that did not advertise the `elicitation` capability at '
    + '`initialize` is refused with `ACTION_CONFIRMATION_REQUIRED` (428) and `details.reason` '
    + '`elicitation_unsupported`; a declined, cancelled or unanswered question is refused the same way with '
    + 'reason `declined`, `cancelled` or `timed_out`, and nothing runs. The caller\'s own `confirm: true` no '
    + 'longer confirms anything. An AI service account acting for itself is still refused whatever it sends. '
    + 'The doors switch in the change that implements the contract: a refusal carrying no `details.reason` '
    + 'comes from a door that still reads the member.',
  reason:
    '`confirm: true` was the caller\'s own claim that a person approved, and nothing could check it: an agent '
    + 'could send it for an irreversible action on reading the person\'s instruction as consent, and measured '
    + 'runs did exactly that. The gate made forgetting loud and did not prove a person. The server asking the '
    + 'person through the client, with the caller unable to answer for them, is what makes the declaration mean '
    + 'what an author who wrote it meant. No mechanical move applies: the metadata is unchanged, and the work is '
    + 'on the client side and in the author\'s decision about each gated action. ADR-0011 / ADR-0151 / ADR-0087.',
  acceptanceCriteria:
    'For every action declaring `ai.requiresConfirmation: true`, decide again that a person must approve each AI '
    + 'call; if not, declare `false` knowingly. Tell the people who run those actions through an MCP client that '
    + 'the client must support elicitation, or that they perform the action in the app. A script or agent that '
    + 'sent `confirm: true` to run such an action unattended stops working by design: it is refused, and a person '
    + 'runs the action. Done when no caller relies on its own `confirm: true` for a declared-gated action.',
};
