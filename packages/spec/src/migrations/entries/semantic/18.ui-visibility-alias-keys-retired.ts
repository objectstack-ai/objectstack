// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F4 — the key retirement's one D3 entry, for both keys (ruling F4 A:
// they retire in the same change). The D2 halves are
// `view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen`
// (protocol 15), now retired from the load path. It carries no `conversionIds`:
// protocol 15 is below MIGRATION_SUPPORT_FLOOR, so no step of the chain replays
// either conversion, and `os migrate meta` lists this entry as the hand edit it is.
export const entry: SemanticMigration = {
  id: 'ui-visibility-alias-keys-retired',
  surface:
    'view form visibleOn (view.form.sections[].visibleOn, view.form.sections[].fields[].visibleOn) '
    + 'and page component visibility (page.components[].visibility)',
  replacement:
    '`visibleWhen` — the one conditional-visibility key (ADR-0089) on a form field, a form section and a '
    + 'page component; the value, a CEL predicate, is unchanged',
  reason:
    'A maintainer ruling retired the two deprecated spellings of the conditional-visibility predicate '
    + 'at 18. Through 17 the form field and form section schemas declared `visibleOn`, and the page '
    + 'component schema declared `visibility`, and each parse folded the old key onto `visibleWhen` '
    + 'without a word. At 18 each is a tombstone: `tsc` refuses a typed authoring site, and the parse '
    + 'refuses the key by name with the prescription naming `visibleWhen` at `objectstack validate`, '
    + '`objectstack build`, the metadata save door (a 422) and `defineStack`. Where a node wrote both '
    + 'keys, `visibleWhen` was the one in effect: delete the old key. No tool makes the rename for an '
    + 'authored source: both D2 conversions belong to protocol 15, below the migration floor, so '
    + '`objectstack migrate meta --from 17` applies no edit for either key and `--write` writes none; '
    + 'it prints each written key among the refusals the migrated stack still has, and lists this entry. '
    + 'Rename each key by hand. Stored form views and pages need no edit: every stored-row rehydration '
    + 'seam replays the retired conversions, so a `sys_metadata` row written with the old key keeps '
    + 'loading with `visibleWhen`. A script or integration that saves a view or a page through the '
    + 'metadata API with the old key is refused and needs the same rename.',
  acceptanceCriteria:
    '`objectstack validate` reports no refusal at a `visibleOn` path in a form view or a `visibility` '
    + 'path on a page component, no view or page source in the project, and no script that writes views '
    + 'or pages through the metadata API, writes either key, and each renamed predicate shows and hides '
    + 'the same field, section or component as before.',
};
