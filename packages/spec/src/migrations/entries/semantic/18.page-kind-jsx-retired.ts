// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F5-jsx — the value retirement's one D3 entry. The D2 half is
// `page-kind-jsx-to-html` (protocol 11), now retired from the load path. It
// carries no `conversionIds`: protocol 11 is below MIGRATION_SUPPORT_FLOOR, so
// no step of the chain replays that conversion, and `os migrate meta` lists
// this entry as the hand edit it is.
export const entry: SemanticMigration = {
  id: 'page-kind-jsx-retired',
  surface: "page kind authored as 'jsx' (PageSchema.kind, ui/page.zod.ts)",
  replacement:
    "`kind: 'html'` — the constrained-JSX page tier's name since ADR-0081; the page's `source` and "
    + '`requires` stay as they are',
  reason:
    "A maintainer ruling retired `jsx` as a page kind at 18. It was the first name of the constrained-JSX "
    + 'tier (ADR-0080), which ADR-0081 renamed `html`; through 17 the loader rewrote an authored '
    + "`kind: 'jsx'` to `html` with a notice. At 18 the page parse refuses it by name with the "
    + 'prescription naming `html`: at `objectstack validate`, `objectstack build`, the metadata save '
    + 'door (a 422) and `defineStack`, so under `objectstack lint` too when the config calls it. The '
    + 'rename is lossless — the source is compiled and rendered exactly as before — but no tool makes it '
    + 'for an authored source: the D2 conversion `page-kind-jsx-to-html` belongs to protocol 11, below '
    + 'the migration floor, so change the value by hand. Stored pages need no edit: every stored-row '
    + "rehydration seam replays the retired conversion, so a `sys_metadata` page row written as `jsx` "
    + 'keeps loading as an html page. A script or integration that saves a page through the metadata '
    + "API with `kind: 'jsx'` is refused and needs the same one-word change.",
  acceptanceCriteria:
    "`objectstack validate` reports no refusal at a page's `kind` path, no page source in the project "
    + "or in a script that writes pages through the metadata API says `kind: 'jsx'`, and each former "
    + 'jsx page renders the same tree as an html page.',
};
