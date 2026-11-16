// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The confirmation contract of `ai.requiresConfirmation: true` is amended
// (`AI_ACTION_CONFIRMATION_CAPABILITY`, `contracts/ai-service.ts`): a person
// confirms, elicited in the MCP client or handed off to the app, and the
// caller's own `confirm: true` stops counting once the doors implement it. A
// structured TODO, not a D2 conversion: nothing an author wrote is rewritten
// or refused, and whether a gated action still needs a person is the author's
// judgement. Written conditionally on purpose: the release that first carried
// this entry (spec 18.5.0) still gated on `confirm: true`. The switch is keyed
// on the hand-off, the step every MCP door takes (#33690), never on
// elicitation (review nit 2 on PR #34202), which only a door that can carry
// the question takes (#33712: stdio first, ahead of the hand-off); the same
// switch retires the member from both tools' input (#34209, ruling 6909355256).
export const entry: SemanticMigration = {
  id: 'action-requires-confirmation-elicited',
  surface:
    'objects[].actions[].ai.requiresConfirmation and actions[].ai.requiresConfirmation set to `true` — '
    + 'what the declaration asks of a caller on the MCP `run_action` and `resume_run` tools',
  replacement:
    'Read this against your runtime first. The switch is the release whose changelog says `run_action` and '
    + '`resume_run` hand a declared-gated call to the person (`status: \'pending_confirmation\'`). Before it, '
    + 'those tools still run a declared-gated action on the caller\'s `confirm: true`, and a call without it is '
    + 'refused with `ACTION_CONFIRMATION_REQUIRED` (428): keep sending it there. From that release, keep the '
    + 'declaration where a person must approve the call; what changes is who confirms. The server hands the '
    + 'call to the host\'s pending-confirmation service, answers `status: \'pending_confirmation\'` with a '
    + 'pending id, and the person approves or rejects it in the app, where it runs as them with every '
    + 'permission re-checked. Only a host with no such service refuses, with `details.reason` '
    + '`no_confirmation_service`. The same release stops accepting `confirm` on `run_action` and '
    + '`resume_run` at all: a call that carries it is refused at the tool, on every action, so the caller '
    + 'resends without it. A runtime whose changelog also says the MCP doors confirm by elicitation asks the '
    + 'person in the MCP client instead (`elicitation/create`, form mode) when the client advertised the '
    + '`elicitation` capability at `initialize` and the connection can carry the question: accept runs the '
    + 'call, and decline, dismissal or no answer in time refuses it.',
  reason:
    '`confirm: true` was the caller\'s own claim that a person approved, and nothing could check it: an agent '
    + 'could send it for an irreversible action on reading the person\'s instruction as consent, and measured '
    + 'runs did exactly that. The gate made forgetting loud and did not prove a person. The server asking the '
    + 'person, in the app or in the client, with the caller unable to answer for them, is what makes the '
    + 'declaration mean what an author who wrote it meant. No mechanical move applies: the metadata is '
    + 'unchanged, and the work is on the client side and in the author\'s decision about each gated action. '
    + 'ADR-0011 / ADR-0151 / ADR-0087.',
  acceptanceCriteria:
    'Now: for every action declaring `ai.requiresConfirmation: true`, decide again that a person must approve '
    + 'each AI call; if not, declare `false` knowingly. Once your runtime hands such a call to the person (its '
    + 'changelog says so; a refusal then carries `details.reason`): an MCP client that supports elicitation, on '
    + 'a connection that can carry it, has the person asked in place; any other caller gets a pending answer and '
    + 'the person decides in the app, provided the host runs a pending-confirmation service; a script or agent that '
    + 'ran such an action unattended on its own `confirm: true` no longer runs it, and a person does; and no '
    + 'client sends `confirm` to `run_action` or `resume_run`, which refuse it. Done when no caller sends '
    + '`confirm` to those two tools on a runtime that has switched.',
};
