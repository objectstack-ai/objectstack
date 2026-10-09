// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D6 (C5, stage S3) — a runtime-door narrowing with no authorable key:
// the /meta doors of both transports stop carrying the caller's organization
// into a metadata write or read. Registered because legacy organization-scoped
// rows stop being served, which an operator must be told (stage 0's F10 of the
// retirement card: a single-posture deployment observes it too).
export const entry: SemanticMigration = {
  id: 'meta-doors-organization-scope-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the organization the /meta doors of @objectstack/rest and of the runtime dispatcher thread '
    + 'into a metadata write (PUT, DELETE, publish, rollback) or read (item, list, layered, '
    + 'published, drafts, history, audit, diff, diagnostics, references) of the five '
    + 'org-overridable types; the organizationIdForMetaWrite export of @objectstack/metadata-core; '
    + 'the metaReadOrganizationId export of @objectstack/rest; and the Default Organization read '
    + 'of the email-template boot sweep in @objectstack/plugin-email',
  replacement:
    'nothing to write: every `/meta` write now lands environment-wide (`organization_id` NULL) '
    + 'and every `/meta` read resolves environment → code, for every caller and every tenancy '
    + 'posture. Delete any import of `organizationIdForMetaWrite` (a write carries no '
    + 'organization) or `metaReadOrganizationId` (a read carries none either). A caller that '
    + 'needs the vetted organization of a request for another purpose still reads '
    + '`metaCallerOrganizationId`',
  reason:
    'ADR-0131 D6 retires the per-organization overlay axis: environment metadata written by '
    + 'Studio, by the cloud build agent or by a template install belongs to the whole deployment. '
    + 'The doors threaded the active organization for view, dashboard, report, translation and '
    + 'email_template, so under the single posture, where the Default Organization is active, '
    + 'every Studio save of those types was stored under that organization. The read and the '
    + 'write flip together: reads-first would hide the organization rows the doors still wrote, '
    + 'writes-first would let those rows shadow new environment saves.',
  acceptanceCriteria:
    'A manage_metadata caller with an active organization saves a view through PUT '
    + '/api/v1/meta/view/<name> on either transport: the stored row carries organization_id '
    + 'NULL and GET serves it. An organization-scoped row stored before this release, including '
    + 'a single-posture Studio save filed under the Default Organization, is no longer served by '
    + 'any /meta read (the environment row or the code definition is), nor projected by the '
    + 'email-template boot sweep; it stays in sys_metadata untouched until the promotion '
    + 'ceremony (ADR-0131 C7) carries it to the environment layer. Re-save such an item in '
    + 'Studio to make the edit live on the /meta doors now. Public forms are the exception: '
    + 'until that ceremony the anonymous form doors read a form view in the Default Organization '
    + 'and prefer its overlay for the form\'s body, while a withdrawal in either layer closes the '
    + 'form, fail-closed. So a legacy organization overlay of a public form keeps serving its '
    + 'body there: a Studio re-save of that body (an environment row) does not change the body '
    + 'the public form serves, and a Studio withdrawal (an environment row) still closes it.',
};
