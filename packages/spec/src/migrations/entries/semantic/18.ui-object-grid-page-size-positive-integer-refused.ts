// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-object-grid-page-size-positive-integer-refused',
  surface: '`object-grid` page-component page sizes '
    + "(`ComponentPropsMap['object-grid']` — `pagination.pageSize`, each "
    + '`pagination.pageSizeOptions[]` entry, and the flat `pageSize` shorthand) — '
    + 'zero, negative and non-integer values (`pagination: { pageSize: 0 }`, '
    + '`pageSize: 25.5`)',
  replacement: 'a positive integer, or no declaration at all. A page size of `0` has no '
    + 'defined meaning on this surface and never had one: delete the key to take the '
    + "renderer's own default, or write the page size that was meant (`pageSize: 0` "
    + 'authored to mean "no paging" is `showPagination: false` with no `pagination` bag, '
    + "since the bag's PRESENCE is what enables paging)",
  reason:
    '#19046: this door carried the pre-#7751 read-point shape — `pagination: z.unknown()` '
    + 'and `pageSize: z.number()` — after the view arm converged on '
    + '`z.number().int().positive()`. So the SAME authored member carried two accept sets '
    + 'and renderers read the looser one: `PaginationConfigSchema` (`view.zod.ts`) refuses '
    + '`pageSize: 0` and pins that refusal by name, and every other `pageSize` the package '
    + 'declares is bounded with its own throwing pin (`kernel/metadata-plugin.zod.ts`, '
    + '`marketplace/marketplace.zod.ts`) — the component arm was the only one that '
    + 'accepted `0`. The value is LIVE: measured at objectui#9853, an authored '
    + '`pagination.pageSize: 0` reached `ObjectGrid`, went out on the wire as `$top: 0` '
    + 'and rendered ZERO ROWS, with no grouping needed to trigger it, and it reached the '
    + 'renderer through this arm. objectui#9896 repaired the consumer half (a resolver at '
    + 'every read point, fail-soft, one loud diagnostic); this is the declaration half, '
    + 'and it is not a prerequisite for that repair. '
    + '⚠️ The `pagination` bag itself stays OPEN (`z.looseObject`): only the two members '
    + 'whose value is a page size are bounded, and sibling keys parse and pass through '
    + 'exactly as before. `PaginationConfigSchema` on the view arm is a closed shape and '
    + 'is unchanged by this entry.',
  acceptanceCriteria:
    'Every `object-grid` node declaring a page size — inside `pagination` or through the '
    + 'flat shorthand — carries a positive integer. Well-formed values (`10`, `25`, `50`) '
    + 'parse byte-identically to before, a `pagination` bag carrying sibling keys parses '
    + 'and keeps them, and absence stays absence. A stored page whose `object-grid` node '
    + 'carries `pageSize: 0` is refused on its next authoring-path save with a per-key '
    + 'issue at `pagination.pageSize`; the author deletes the key or writes the page size '
    + 'they meant.',
};
