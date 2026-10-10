// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D6 (C5, stage S5) — the read half of the retirement whose write half
// `metadata-write-organization-scope-refused` records: every metadata read is
// environment → code. Registered because a read that named an organization
// served that organization's rows and now serves the environment's, because
// the `organizationId` key leaves six declared request shapes and the drafts
// listing, and because `overlayScope` loses its `org` value.
export const entry: SemanticMigration = {
  id: 'metadata-read-organization-scope-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the organizationId member of the GetMetaItems, GetMetaItem, GetMetaItemLayered, AuditMetaItem, '
    + 'HistoryMetaItem and GetMetaItemCached request schemas and of each ListDraftsResponse draft of '
    + '@objectstack/spec, and the org value of GetMetaItemLayeredResponse overlayScope; and every '
    + 'metadata read of @objectstack/metadata-protocol that served a row stored organization-scoped: '
    + 'the item, list, layered, cached, history, diff, audit, drafts, commit timeline, lock, search '
    + 'and references reads, and the boot hydration — plus an environment overlay row of an item a '
    + 'managed package ships on a type sealed against overlays (a managed flow, action, hook or '
    + 'object), which the reads served over the package definition',
  replacement:
    'drop `organizationId` from the read request: every read serves the environment row, else the '
    + 'code definition, to every caller, and `overlayScope` is `env` or null. A legacy row stored '
    + 'organization-scoped is served by no read; boot names each one, per type, and the v18 migration '
    + 'ceremony (ADR-0131 D10) carries it — nothing is deleted or rewritten before it. An environment '
    + 'overlay of sealed managed content is not served either, and boot names it: keep the change by '
    + 're-expressing it as a new item under a new name (a linkage-free clone), or delete the stored '
    + 'row. The anonymous public-form doors alone keep reading the Default Organization\'s legacy '
    + 'view rows, fail-closed, until the ceremony carries them',
  reason:
    'ADR-0131 D6 retires the per-organization overlay axis: environment metadata belongs to the '
    + 'whole deployment. The doors stopped carrying an organization '
    + '(meta-doors-organization-scope-retired) and the protocol refuses every organization-scoped '
    + 'write (metadata-write-organization-scope-refused); a read that still served a legacy '
    + 'organization row would keep a retired layer live, one caller at a time. D6 also seals managed '
    + 'content: an overlay of a managed flow, action, hook or object sits in no regime D6 recognises, '
    + 'so the package definition wins at read as the write doors already make it win at write. '
    + 'Permission sets keep their own ruling on stored forks.',
  acceptanceCriteria:
    'With a legacy organization-scoped view row and an environment row of the same name stored, '
    + 'getMetaItem, getMetaItems, getMetaItemLayered and getMetaItemCached serve the environment row '
    + 'whether or not the request names the organization, and the organization-only name answers '
    + 'nothing; historyMetaItem, auditMetaItem, listDrafts and listCommits show no legacy '
    + 'organization row; the ETag is one validator for every caller; overlayScope is env or null. A '
    + 'stored environment row of an action a managed package ships is not served — the package '
    + 'definition is. Boot logs metadata_org_scoped_unserved and metadata_sealed_overlay_unserved, '
    + 'per type. Remove organizationId from any typed read request literal: the key no longer '
    + 'type-checks.',
};
