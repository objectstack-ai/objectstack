// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A TS/API surface, never stored in stack metadata: there is no source for the
// chain to rewrite, so this entry is the whole ADR-0087 registration. The two
// stored-row conversions that rename the retired keys on a pre-18 `sys_metadata`
// row (`view-visibleOn-to-visibleWhen`, `page-component-visibility-to-visibleWhen`)
// are a different mechanism and are not touched by this removal.
export const entry: SemanticMigration = {
  id: 'visibility-alias-fold-unexported',
  surface:
    '`normalizeVisibleWhen` (function) and `VISIBILITY_ALIAS_KEYS` (const) on '
    + '`@objectstack/spec/shared` — the fold of the retired `visibleOn` / `visibility` '
    + 'keys onto the canonical `visibleWhen` (ADR-0089 D2), and the list of those two keys',
  replacement:
    '(removed from the public surface — no replacement export. Read and write `visibleWhen` '
    + 'directly: it is the one conditional-visibility key every schema accepts, and the form '
    + 'field, form section and page component shapes refuse `visibleOn` and `visibility` by '
    + 'name with the rename as the prescription. A pre-18 document carrying either key is '
    + 'renamed by hand; a stored row is renamed by the rehydration conversions.)',
  reason:
    'ADR-0049 enforce-or-remove applied to an export. Since the two alias keys retired at 18, '
    + 'no schema calls the fold, and a measured search of this repository and of the pinned '
    + 'renderer found no caller of either export, only comments. A published helper that '
    + 'quietly re-accepts two keys every parsing door refuses invites exactly the consumer-side '
    + 'tolerance the contract-first rule forbids: a renderer calling it would honour `visibleOn` '
    + 'where the spec rejects it.',
  acceptanceCriteria:
    'No code imports `normalizeVisibleWhen` or `VISIBILITY_ALIAS_KEYS` from '
    + '`@objectstack/spec/shared` or any other entry (TS2305 after upgrade). Every '
    + 'visibility-carrying shape parses and refuses exactly as before — no schema used the '
    + 'fold. No authored metadata document ever carried either export, so `os migrate meta` '
    + 'has nothing to visit.',
};
