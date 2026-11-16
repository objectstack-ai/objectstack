// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The confirmation rule of `AI_ACTION_CONFIRMATION_CAPABILITY`
// (`contracts/ai-service.ts`) now binds the in-app assistant door too, through
// its own pending-action queue (`IAIService.proposePendingAction` /
// `approvePendingAction` / `rejectPendingAction`): only the person the call ran
// as decides an item, only on a signed-in session, and the approved action runs
// as that person with every gate re-checked. A structured TODO, not a D2
// conversion: nothing an author wrote is rewritten or refused. Written
// conditionally on purpose: in the release that first carries this entry the
// in-app door still runs its queue as before.
export const entry: SemanticMigration = {
  id: 'in-app-pending-action-decided-by-person',
  surface:
    'objects[].actions[].ai.requiresConfirmation and actions[].ai.requiresConfirmation set to `true`, '
    + 'and every other action the in-app assistant queues for approval — who may approve or reject the '
    + 'pending action (`/api/v1/ai/pending-actions/:id/approve` and `/reject`, `IAIService.approvePendingAction` '
    + 'and `rejectPendingAction`)',
  replacement:
    'Read this against your runtime first. Until the release whose changelog says the in-app assistant door '
    + 'enforces it, any holder of `ai:approve` may approve or reject an item in the AI pending-actions inbox, on '
    + 'whatever credential the route accepts. From that release, only the person the assistant call ran as '
    + 'approves or rejects their own item, on their signed-in session to the app; an API key, a token or an AI '
    + 'identity is refused, and the approved action runs as that person with every gate and permission '
    + 're-checked. Where a second person, such as an administrator, must also approve the write, route it '
    + 'through the approvals engine (the `held` outcome) instead of letting them decide the item.',
  reason:
    'One `ai.requiresConfirmation: true` declaration has to mean one rule on every AI door. Under the in-app '
    + 'queue as first built, any user holding `ai:approve` could decide another person\'s pending action, from '
    + 'any credential the route accepted, and the approved action was re-dispatched rather than re-checked as '
    + 'that person: a side path around the confirmation the author declared. No mechanical move applies: the '
    + 'metadata is unchanged, and the work is in who operates the inbox and how a host routes a second '
    + 'approver. ADR-0011 / ADR-0087.',
  acceptanceCriteria:
    'Now: list who decides in-app pending actions today (inbox operators, scripts or integrations on an API '
    + 'key or token) and, where someone other than the requesting person must approve, plan a `held` route '
    + 'through the approvals engine. Once your runtime enforces it (its changelog says so): each person '
    + 'approves or rejects their own items in the app while signed in, and no script, integration or other '
    + 'user decides them. Done when nothing relies on deciding another person\'s item or on deciding with a '
    + 'non-session credential.',
};
