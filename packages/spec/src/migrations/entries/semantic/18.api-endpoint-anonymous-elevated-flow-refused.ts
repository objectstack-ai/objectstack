// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0138 D2b, ruled R: publish refuses an anonymous flow endpoint whose target
// flow runs as `system`, in both directions. The refusal narrows the accept set,
// and no conversion can choose a posture for the author, so the record's card E2
// registers this one semantic entry with it.
export const entry: SemanticMigration = {
  id: 'api-endpoint-anonymous-elevated-flow-refused',
  surface:
    'A PAIR of declarations: an `apis[]` endpoint with `authRequired: false` and `type: \'flow\'`, and the '
    + 'flow its `target` names when that flow declares `runAs: \'system\'`. Refused in both directions, '
    + 'because either item can be the last one edited: the endpoint\'s publish reads its target\'s `runAs`, '
    + 'and a flow\'s publish that sets `runAs: \'system\'` reads the anonymous endpoints that target it. The '
    + 'doors: the stack parse (`defineStack`, `os validate`, `os build`, the artifact load), located at '
    + '`apis[i].authRequired`; a package publish through the metadata layer; and a flow published through '
    + 'the metadata API (`PUT /meta/flow/:name` in publish mode, a draft\'s publish, a package\'s '
    + 'publish-drafts), refused `422 INVALID_METADATA` with the issue at `runAs`. Each endpoint alone, and '
    + 'each flow alone, is unchanged: an authenticated endpoint on a `system` flow and an anonymous endpoint '
    + 'on a `user` flow both still publish.',
  replacement:
    'Serve the caller through the channel that fits its scenario, and keep the flow\'s `runAs` as the work '
    + 'needs it: a partner that can hold a credential calls an authenticated endpoint (`authRequired: true`, '
    + 'the default); a partner webhook posts to the flow\'s signed inbound hook (ADR-0041: a `type: \'api\'` '
    + 'flow whose start node declares `triggerType: \'api\'`, a `hookId` and a `secret`, reached at '
    + '`POST /api/v1/automation/hooks/<flow>/<hookId>` with an HMAC signature header), which may keep '
    + '`runAs: \'system\'`; anonymous intake goes through a public form (a form view whose `sharing` declares '
    + '`enabled: true`, `allowAnonymous: true` and a `publicLink`). `runAs: \'automation\'` joins these when '
    + 'ADR-0073 M2 lands; the enum has no such value until then.',
  reason:
    'An anonymous request admitted at such an endpoint ran the flow\'s data steps as the system principal, '
    + 'past row-level security, by the flow author\'s explicit declaration; the only brake was the endpoint\'s '
    + 'rate limit (ADR-0121 D6), and the runtime\'s own elevated-start refusal covers self-triggered flow '
    + 'types only, so a `system` flow of type `api` or `screen` behind the door executed elevated. The flow '
    + '`runAs` description prescribed `system` for user-less triggers, `api` included, so an author who '
    + 'followed it opened the door. ⛔ NOT convertible: which serving channel replaces the anonymous endpoint '
    + 'depends on who the caller is (a partner with a credential, a signed webhook sender, or an anonymous '
    + 'visitor), and whether the flow needs elevation at all is a judgment about its data steps. A transform '
    + 'that flipped `authRequired` would break every caller that holds no credential; one that dropped '
    + '`runAs: \'system\'` would refuse the flow\'s data steps for a run with no user. Either would choose a '
    + 'posture for the author, which the record forbids. Out of scope by the record: a guest-written row '
    + 'firing a record-change flow (the trigger there is the write, not the door).',
  acceptanceCriteria:
    'No `apis[]` endpoint with `authRequired: false` and `type: \'flow\'` names, in `target`, a flow that '
    + 'declares `runAs: \'system\'`, whether the flow is in the same stack, another package, or authored '
    + 'through the metadata API. `os validate` passes the stack, a package publish reports no '
    + 'validation error for the pair, and publishing each formerly-paired flow through the metadata API '
    + 'answers 2xx. Each replaced caller is re-pointed and checked: an authenticated partner call answers '
    + 'with a credential and 401 without one, a webhook sender\'s signed POST reaches the inbound hook and '
    + 'an unsigned one is refused, and a public form submission lands its row. ⚠️ A stored flow row that '
    + 'already pairs this way keeps its bytes and keeps executing as published until its next publish, '
    + 'which is refused; list such flows and re-serve their callers before that publish.',
};
