// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A TS/API surface, never stored in stack metadata: there is no source for the
// chain to rewrite, so this entry is the whole ADR-0087 registration.
export const entry: SemanticMigration = {
  id: 'visibility-strict-options-unexported',
  surface:
    '`VISIBILITY_STRICT_OPTIONS` (const) on `@objectstack/spec/shared` — the shared '
    + '`strictObject` options of the visibility-carrying view/page shapes (ADR-0089 D3a)',
  replacement:
    '(removed from the public surface — no replacement export. It was an internal option bag '
    + 'for this package\'s own schemas; the visibility contract it configures is unchanged and '
    + 'still published through the schemas that use it — `FormFieldSchema`, `FormSectionSchema` '
    + 'and the page component — together with `normalizeVisibleWhen` and '
    + '`VISIBILITY_ALIAS_KEYS`, which stay exported.)',
  reason:
    'ADR-0049 enforce-or-remove applied to an export. The const was barrel-exported while its '
    + 'type, `StrictObjectOptions`, is deliberately unpublished, so no consumer could annotate it, '
    + 'spread it into a typed option bag or name it in a parameter — a published value with no '
    + 'usable contract and zero measured pull outside this package. Publishing the type instead '
    + 'was weighed and not adopted: no consumer ever asked for it, and it would turn the '
    + 'strict-object template\'s internals into public API.',
  acceptanceCriteria:
    'No code imports `VISIBILITY_STRICT_OPTIONS` from `@objectstack/spec`, `@objectstack/spec/shared` '
    + 'or any other entry (TS2305 after upgrade). Every visibility-carrying shape parses and '
    + 'refuses exactly as before — the options object is unchanged, only where it is exported '
    + 'from moved. No authored metadata document ever carried it, so `os migrate meta` has '
    + 'nothing to visit.',
};
