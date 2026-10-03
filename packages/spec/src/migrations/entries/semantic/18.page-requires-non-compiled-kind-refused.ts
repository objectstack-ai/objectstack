// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21459 — the D3 entry of the `page-requires-non-compiled-kind-removed` family
// (one D3 entry per retirement family, even when D2 is lossless): page
// `requires` narrowed to the kinds whose source the save door compiles, ruling
// record 5964312254, letter A. It is a narrowing by `kind`, not a key removal:
// the key stays live on html / jsx pages, so there is no tombstone and no
// RETIRED_KEYS_BY_MAJOR row — the parse refuses it through
// `checkPageRequiresKind` (ui/page.zod.ts) on the other kinds.
export const entry: SemanticMigration = {
  id: 'page-requires-non-compiled-kind-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span and a table cell.
  surface:
    'page.requires on a page whose kind is react, full or slotted — a page that omits kind '
    + 'included, since its kind is full',
  replacement:
    'Nothing: delete the key. On an html page (and its deprecated jsx alias) the platform derives '
    + '`requires` from the source at save and stores it, so it is omitted there too; on a react, full '
    + 'or slotted page nothing ever derived or enforced it, and nothing takes its place.',
  reason:
    '`PageSchema` admitted `requires` on every page kind, but the platform derives it only on the '
    + 'kinds whose source the metadata save door compiles: saving an html page (alias jsx) on a server '
    + 'that has the deployment\'s SDUI component manifest compiles the source, stores the plugin '
    + 'namespaces it uses as `requires`, and refuses a written list that disagrees. A react source is '
    + 'executed at render and never compiled at save, and full and slotted pages have no source, so on '
    + 'those kinds nothing derived the key, the Studio page editor dropped it on every save, and its '
    + 'one reader was a load-time warning. The maintainer ruled (2026-10-03) that the key is accepted '
    + 'only on html and jsx pages. The parse now refuses it on react, full and slotted pages, and a '
    + 'page that omits kind is a full page: `objectstack validate`, the metadata save door (a 422) and '
    + 'every other door that parses a page name the key, the page\'s kind and the compiled kinds. An '
    + 'empty list is refused like a full one, because the key is what is refused. No page body '
    + 'authoring the key on those kinds was measured in this repository, cloud, hotcrm or objectui. '
    + 'The D2 conversion `page-requires-non-compiled-kind-removed` deletes it from such pages: stored '
    + 'rows and built artifacts replay it at load, with a notice, and `objectstack migrate meta --from '
    + '17` lists the edit for authored sources, which the parse refuses until it is made. The delete '
    + 'loses nothing a page did. What it cannot decide is whether the page should have been an html '
    + 'page: an author who wrote the list to have plugin presence checked gets that check only on an '
    + 'html page, where the platform derives the list from the source and judges it at save and load.',
  acceptanceCriteria:
    '`objectstack validate` reports no issue at a page\'s `requires` path: no react, full or slotted '
    + 'page, and no page that omits kind, carries the key, and each html or jsx page either omits it '
    + 'or carries exactly the list its source compiles to. Saving each formerly affected page through '
    + 'the metadata API succeeds instead of answering a 422 that names `requires`. Replaying '
    + '`objectstack migrate meta --from 17` over the edited source lists no '
    + '`page-requires-non-compiled-kind-removed` edit, and every page renders as it did before the '
    + 'upgrade.',
  conversionIds: ['page-requires-non-compiled-kind-removed'],
};
