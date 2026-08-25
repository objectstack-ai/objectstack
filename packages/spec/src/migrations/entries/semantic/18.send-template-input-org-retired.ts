// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'send-template-input-org-retired',
  surface: 'contracts.emailService.sendTemplate input.org',
  replacement:
    '(removed — never implemented; delete the key from the call. It is NOT replaced by '
    + '`organizationId`: that member is the delivery row\'s tenant stamp '
    + '(`sys_email.organization_id` pass-through, #11741) and opts into no template overlay '
    + 'resolution)',
  reason:
    'ADR-0049 enforce-or-remove (#11832). `SendTemplateInput.org` was declared as "Tenant id '
    + 'for org-overlay resolution (when supported)" and no implementation ever read it: '
    + '`@objectstack/plugin-email` — the only IEmailService implementation — resolves templates '
    + 'on `(name, locale)` only, so a caller passing `org` got no org-overlay resolution and no '
    + 'error; the "(when supported)" hedge was the declaration admitting the gap. After #11741 '
    + 'landed `organizationId` beside it, the input carried two org-shaped keys of which one did '
    + 'nothing — exactly the shape that invites an AI author to pick the wrong one. There is no '
    + 'behaviour to preserve and nothing stored to rewrite: the key only ever appeared in a '
    + 'call-time input bag (the `data.engine.update options.upsert` precedent), which is why '
    + 'this is a D3 semantic entry with no D2 conversion — no metadata seam ever runs on it. '
    + 'Org-overlay template resolution, if it ever earns a measured business pull, is a new '
    + 'capability with its own ruling — not this key revived.',
  acceptanceCriteria:
    'No caller passes `org` to `IEmailService.sendTemplate()`. The enforcement channel is the '
    + 'compiler: `SendTemplateInput` is a programmatic contracts interface with no Zod surface, '
    + 'so authoring `org` is an excess-property `tsc` error (pinned in '
    + '`packages/spec/src/contracts/email-service.test.ts`). Runtime behaviour is deliberately '
    + 'UNCHANGED: nothing ever read the member, so removing it removes no behaviour — a '
    + 'JavaScript caller still passing `org` keeps its exact pre-removal outcome (the key is '
    + 'carried inert and ignored). Template resolution still keys on `(name, locale)`, and '
    + '`organizationId` still stamps `sys_email.organization_id` without acquiring any overlay '
    + 'semantics.',
};
