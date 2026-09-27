// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #11027 (ADR-0049) — the D3 entry of the `page-component-responsive-removed`
// family (ruling B on #17152: one D3 entry per retirement family, even when D2
// is lossless). The family is the key plus the shape that leaves with it —
// `ui/ResponsiveConfig`, `ui/BreakpointColumnMap`, `ui/BreakpointName` and
// `ui/BreakpointOrderMap` in RETIRED_DEFS_BY_MAJOR[18]. The strip changes no
// pixel; translating an intended layout into CSS that IS applied is a design
// decision the conversion cannot make.
export const entry: SemanticMigration = {
  id: 'page-component-responsive-retired',
  surface: 'page.components[].responsive — the per-breakpoint columns / order / hiddenOn block, '
    + 'and the exported ResponsiveConfig shape with its breakpoint maps',
  replacement: 'The sibling `responsiveStyles` (ADR-0065): per-breakpoint CSS maps compiled to '
    + 'id-scoped CSS at render — for example `responsiveStyles: { xsmall: { display: \'none\' } }` '
    + 'to hide a component on the narrowest screens.',
  reason: 'The D2 conversion `page-component-responsive-removed` deletes `responsive` from every '
    + 'page component wherever one can be authored, and the delete is lossless: no renderer ever '
    + 'read the block, so the per-breakpoint columns, order and visibility it declared parsed, '
    + 'validated and did nothing. This was also the block an earlier tombstone prescribed as the '
    + 'live alternative for dashboard widgets, so an author who followed that advice moved an '
    + 'inert key to an inert key and may still believe their page adapts to small screens. What '
    + 'remains is theirs to decide: whether the layout they declared is one they still want, and '
    + 'if so how to say it in CSS that is applied — `hiddenOn` maps to a `display` rule per '
    + 'breakpoint, while column spans and order are layout choices with no one-to-one CSS '
    + 'rewrite. Code that imported the retired shape (ResponsiveConfigSchema, BreakpointName, the '
    + 'breakpoint maps) must drop the import; nothing replaces it.',
  acceptanceCriteria: 'No page component carries `responsive`; the parse refuses it, and no code '
    + 'imports the retired shape (each such import is a compile error). Each page renders exactly as '
    + 'it did before the upgrade at every breakpoint. Where the author re-expressed an intended '
    + 'adaptation through `responsiveStyles`, resizing the viewport across the named breakpoints '
    + 'shows it — a component declared hidden on the narrowest breakpoint is absent there and '
    + 'present above it.',
};
