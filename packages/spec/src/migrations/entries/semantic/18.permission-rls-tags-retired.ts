// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20321 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `permission-rls-tags-removed` family (ruling B on #17152: one D3 entry per
// retirement family, even when D2 is lossless). The strip changes no access
// decision; what it leaves is whatever process was built on the belief that a
// policy's tags were read.
export const entry: SemanticMigration = {
  id: 'permission-rls-tags-retired',
  surface: 'permission.rowLevelSecurity[].tags — the free-form categorization tags on a row-level '
    + 'security policy',
  replacement: '(removed — no mainstream platform tags a row-level policy, and nothing here ever '
    + 'read one.) A policy is identified by its `name` and its `object`, and reported by those and '
    + 'its predicate; its purpose belongs in `description`. Whom a policy applies to is decided by '
    + '`positions`, never by a tag.',
  reason: 'The D2 conversion `permission-rls-tags-removed` deletes `tags` from every row-level '
    + 'security policy in author sources and in stored permission rows, and the delete is '
    + 'lossless: the RLS compiler never consulted the key and nothing else acted on it — no '
    + 'report, audit filter or review queue selected on it — so no access decision changes. '
    + 'The judgment is about what people '
    + 'believed. An admin who tagged a policy `gdpr` or `pci` may have expected a compliance '
    + 'report, an audit filter or a review queue to pick it up; none ever did. An author who '
    + 'wrote a tag such as `managers_only` may have believed it scoped the policy; it never did '
    + '— only `positions` narrows whom a policy applies to. Any report, runbook or control that '
    + 'relies on either belief needs another path, and choosing that path is a governance '
    + 'decision no conversion can make.',
  acceptanceCriteria: 'No authored or stored row-level security policy carries `tags`; the parse '
    + 'refuses the key with the prescription. Access decisions are unchanged: every policy admits '
    + 'and refuses exactly the rows it did before the upgrade. Every policy whose tag expressed an '
    + 'audience has that audience in `positions`, and every compliance report, audit filter or '
    + 'review process that assumed policy tags names the mechanism it actually uses instead.',
};
