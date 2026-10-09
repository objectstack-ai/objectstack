// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D6 (C5, stage S4) — the protocol half of the door narrowing
// `meta-doors-organization-scope-retired` records: the metadata protocol itself
// refuses every organization-scoped write, and the per-organization write path
// behind it is deleted. Registered because a caller that still names an
// organization is refused where it was accepted, and because the
// `organizationId` key leaves three declared request shapes.
export const entry: SemanticMigration = {
  id: 'metadata-write-organization-scope-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the organizationId member of the SaveMetaItem, PublishMetaItem and DeleteMetaItem request '
    + 'schemas of @objectstack/spec; and every organization-scoped write the metadata protocol of '
    + '@objectstack/metadata-protocol accepted: saveMetaItem (draft and publish), publishMetaItem, '
    + 'deleteMetaItem, rollbackMetaItem, revertCommit, rollbackToPackageCommit, publishPackageDrafts, '
    + 'discardPackageDrafts, revertStoredPackage, duplicatePackage and reassignOrphanedMetadata — '
    + 'including the five types that declared allowOrgOverride (view, dashboard, report, translation, '
    + 'email_template) and the OS_METADATA_WRITABLE hatch',
  replacement:
    'drop `organizationId` from the request: every metadata write lands environment-wide '
    + '(`organization_id` NULL), where every organization reads it. A request that still names an '
    + 'organization is refused with 403 `NOT_OVERRIDABLE`, before anything is read or written, '
    + 'and the message names the tenancy posture in force',
  reason:
    'ADR-0131 D6 retires the per-organization overlay axis: environment metadata written by Studio, '
    + 'by the cloud build agent or by an install belongs to the whole deployment. The /meta doors '
    + 'already carry no organization (meta-doors-organization-scope-retired); this is the protocol '
    + 'refusing the same write from every other door — the /packages verbs, the stored-row '
    + 'migrations, a plugin — so no path is left that stamps an organization on a metadata row. '
    + 'The audit and commit ledgers are environment-level too (ADR-0131 D7) and record no '
    + 'organization. Legacy organization-scoped rows are not touched: the stored-metadata migration '
    + 'reports them as skipped, the flow credential move reports them as not moved, and the '
    + 'promotion ceremony (ADR-0131 C7) carries them to the environment layer.',
  acceptanceCriteria:
    'A protocol write naming an organization — a saveMetaItem of a view with organizationId set, a '
    + 'publishPackageDrafts or a revertCommit with one — answers 403 NOT_OVERRIDABLE and writes '
    + 'nothing, for every metadata type and every tenancy posture; the same call without the key '
    + 'succeeds and stores organization_id NULL. POST /meta/_migrate-stored reports each '
    + 'organization-scoped row as skipped, naming the promotion ceremony, and re-saves none. A '
    + 'commit recorded in a legacy organization layer is refused by revertCommit with the same code, '
    + 'and duplicatePackage and reassignOrphanedMetadata copy or adopt the environment rows only. '
    + 'Remove organizationId from any typed SaveMetaItem / PublishMetaItem / DeleteMetaItem '
    + 'request literal: the key no longer type-checks.',
};
