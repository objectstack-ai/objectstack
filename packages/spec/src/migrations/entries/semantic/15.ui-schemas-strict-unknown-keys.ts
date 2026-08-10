// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-schemas-strict-unknown-keys',
  surface: 'view form fields/sections · page components (undeclared keys)',
  replacement: 'declared keys only (`visibleWhen` for visibility predicates)',
  reason:
    'The `.strict()` flip (ADR-0089 D3a) turns a previously silently-stripped ' +
    'unknown key into a parse error. There is no mapping target for an ' +
    'arbitrary unknown key — auto-deleting it would be exactly the silent data ' +
    'loss ADR-0078 bans — so each occurrence needs the author to decide: fix ' +
    'the typo, move it to the right layer, or delete dead metadata.',
  acceptanceCriteria:
    '`objectstack validate` passes with no unknown-key parse errors on form ' +
    'fields, form sections, or page components.',
};
