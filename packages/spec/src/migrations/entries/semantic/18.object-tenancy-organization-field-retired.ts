// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #19054 (ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18) — the D3
// entry of the `object-tenancy-organization-field-removed` family (ruling B on
// #17152: one D3 entry per retirement family, even when D2 is lossless). This
// is the family the pre-ruling rationale said had "no semantic residue". The
// delete changes no stamp; what it leaves is an author who asked for a
// divergence and should know they never got it.
export const entry: SemanticMigration = {
  id: 'object-tenancy-organization-field-retired',
  surface: 'object.tenancy.organizationField — the column a platform row is stamped from, as '
    + 'distinct from the column the object is walled by',
  replacement: '`tenancy.tenantField` — one column that both walls the object and stamps its '
    + 'platform rows. The stamp-only divergence is a platform-internal fact now, kept for the '
    + 'platform\'s own credential table.',
  reason: 'The D2 conversion `object-tenancy-organization-field-removed` deletes the key from every '
    + 'object\'s `tenancy` block in author sources and on stored object rows, and the delete is '
    + 'lossless: the key\'s only readers were three platform-row writers, pinned by name to '
    + 'platform tables, so an application that declared it was never read. The judgment is what '
    + 'the declaration was for. An author who set `organizationField` to a column other than '
    + '`tenantField` asked for platform rows (audit stamps, approval rows, automation-run records) '
    + 'to carry a different organization column than the one walling the data — and never got '
    + 'it. If the object\'s real tenant column is not `organization_id`, the fix is '
    + '`tenancy.tenantField`, which moves the wall as well as the stamp; whether moving the wall '
    + 'is correct for that object is a data-isolation decision only its author can make.',
  acceptanceCriteria: 'No object declares `tenancy.organizationField`; the `tenancy` block refuses '
    + 'it with the prescription. Every object whose tenant column is not `organization_id` '
    + 'declares that column as `tenancy.tenantField`. A record created by a user of one '
    + 'organization is stored with that organization in the tenant column, a user of another '
    + 'organization cannot read it, and the audit stamp on the change names the same '
    + 'organization.',
};
