// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'package-uninstall-explicit-all-tenants',
  surface: 'protocol.deletePackage({ packageId }) with no `organizationId` (and its transport, DELETE /api/v1/packages/:id)',
  replacement: 'explicit `allTenants: true` for a cross-tenant uninstall, or an `organizationId` to scope it',
  reason:
    'An uninstall that named no organization matched EVERY organization\'s rows — measured '
    + 'at 5 of 5 deleted, including a foreign org\'s (#7705, #7780). That width was never '
    + 'chosen; it fell out of a missing argument, and the two transports of the same route '
    + 'disagreed because of it. In protocol 17 the call is REFUSED instead: neither '
    + '`organizationId` nor `allTenants: true` answers 400 `TENANT_SCOPE_REQUIRED` and '
    + 'deletes nothing, as does supplying both (they are contradictory, not redundant). '
    + 'Whether a given caller meant "this tenant" or "every tenant" is an intent no '
    + 'transform can recover: `resolveActiveOrganizationId` is catch-wrapped, so an '
    + 'accidental org-less call and a deliberate environment-wide one are byte-identical '
    + 'at the call site — which is the whole reason the parameter had to become explicit '
    + 'rather than conventional. Nothing in authored metadata spells this: it is a runtime '
    + 'call-site contract, so it is one semantic TODO for operators and API callers rather '
    + 'than a stack conversion — the same disposition `rest-requireauth-default-flip` (#12) '
    + 'takes for its own default flip.',
  acceptanceCriteria:
    'Every caller of `deletePackage` states its tenant scope. A caller that intends an '
    + 'environment-wide uninstall passes `allTenants: true`; a caller that intends a scoped '
    + 'one passes `organizationId`; no caller passes both. An explicit `allTenants: false` '
    + 'is treated as undeclared and refused, since it is not an affirmative request for '
    + 'cross-tenant semantics. Verify the refusal is not merely absorbed: a 400 '
    + '`TENANT_SCOPE_REQUIRED` reaching a deploy script that previously "succeeded" means '
    + 'that script was relying on the cross-tenant reading and must now say so on purpose. '
    + 'The org-scoped path is unchanged — an uninstall carrying an `organizationId` still '
    + 'removes that org\'s rows AND the environment-wide (`organization_id IS NULL`) rows, '
    + 'exactly as #7705 left it.',
};
