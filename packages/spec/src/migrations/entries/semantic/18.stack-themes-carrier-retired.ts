// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Registered as D3 SEMANTIC and deliberately NOT as a D2 conversion, on the
// D2 scope guard (lossless only — the `owd-legacy-read-aliases` / `'full'`
// precedent): an authored theme has no lossless target. `app.branding` holds
// two colour strings scoped per APP, while a theme is a stack-scoped palette
// with modes and inheritance — a stack may declare N themes and M apps, so
// which palette entry becomes which app's `primaryColor` is a judgment the
// transform cannot make, and auto-DELETING the whole authored artifact would
// silently discard content the author may want to salvage. (Mechanically, a
// full-carrier `stripKeys` conversion also cannot coexist with the published
// `theme-inert-token-scales-removed` fixture: the fixture-disjointness
// contract replays the whole table over every fixture, and that entry's
// fixture necessarily authors `themes` — a secondary observation recorded for
// the next reader, not the reason.)
export const entry: SemanticMigration = {
  id: 'stack-themes-carrier-retired',
  surface: 'stack `themes` (the carrier collection, and `ThemeSchema` with its sub-blocks)',
  replacement:
    'delete the `themes:` key (and any `defineTheme` calls). To colour the shipped console, '
    + "set `app.branding.primaryColor` / `accentColor` — the one live colour surface (read by "
    + 'objectui, driving `--primary`, `--accent` and their derived CSS variables). A palette '
    + 'value your own stylesheet consumed has no spec slot any more: move it into your own CSS.',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-21 on #10485 (disposition B: '
    + '退役授权面 — objectui engine code and its unit tests are retained). The pipeline was '
    + 'live from the authoring gate (`ObjectStackDefinitionSchema.themes`, `defineTheme`) '
    + 'through artifact ingest (`ARTIFACT_FIELD_TO_TYPE.themes`) and stopped there, measured: '
    + 'zero non-test readers of `.themes` or stored `theme` items across '
    + 'core/runtime/rest/services/plugins; `theme` never in `MetadataTypeSchema`, '
    + '`DEFAULT_METADATA_TYPE_REGISTRY` or `BUILTIN_METADATA_TYPE_SCHEMAS`; the only mounted '
    + 'ThemeProvider is the app-shell chrome light/dark toggle, unrelated to `ThemeSchema`; '
    + 'and no key anywhere selected an active theme. So an author (human or AI) who wrote a '
    + 'theme shipped it through every green gate and saw nothing change — the '
    + 'declared-but-unenforced shape ADR-0049 exists to delete. What colours a console today '
    + 'is `app.branding`, and that path is live and untouched.',
  acceptanceCriteria:
    'No stack source authors `themes:`; a stack that still does is refused at parse with the '
    + 'prescription (unrecognized_keys carrying the #10485 guidance — pinned in '
    + '`stack-top-level-strict.test.ts`). `PUT /meta/theme/:name` gets the #8421 '
    + 'unrecognised-type refusal instead of the pre-#10194 store-anything branch (pinned in '
    + '`protocol.unrecognised-meta-type.test.ts`). Legacy stored `theme` rows are untouched: '
    + '`applyConversionsToStoredItem` passes them through, reads still answer, and DELETE '
    + 'still works, so the residue is removable. ⚠️ On-screen behaviour is deliberately '
    + 'UNCHANGED and must be verified as such: nothing ever read an authored theme, so '
    + 'removing the surface removes no behaviour — `app.branding` colours the console before '
    + 'and after.',
};
