/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Did you mean" for `objectui check`, on CASE ALONE (objectui#5247).
 *
 * The 2026-08-19 ruling on objectui#5247 chose Option C — keep lookup strict,
 * make the failure teach. Nothing here makes a mis-cased type VALID: `check`
 * still reports `Page` as an unknown schema type, and `SchemaRenderer` still
 * paints the OBJUI-001 panel for it. All that changes is that the report names
 * the spelling that would have worked. Resolving `Page` to `page` is the
 * REJECTED option B.
 *
 * ## Why the candidate set is `KNOWN_SCHEMA_TYPES` and not a list typed here
 *
 * `KNOWN_SCHEMA_TYPES` is DERIVED from this repository's registration calls by
 * `scripts/regenerate-known-schema-types.mjs` and pinned by
 * `scripts/__tests__/known-schema-types-derivation-5115.test.ts`. Reading it is
 * the whole point: a suggestion built against a hand-maintained copy goes stale
 * silently and then confidently names a type nothing registers any more.
 * objectui#5115 measured that copy drifting in BOTH directions at once, which
 * is why the derivation exists.
 *
 * ## Why this is not shared with the renderer's copy of the same clause
 *
 * `packages/react/src/SchemaRenderer.tsx` emits the same clause for the
 * OBJUI-001 panel, from `ComponentRegistry.getKnownTypes()`. The two cannot
 * share one implementation because they cannot share a candidate SET. The
 * published CLI runs inside a USER's project and depends on neither
 * `@object-ui/core` nor the plugin packages that register most component
 * types; the header of `scripts/regenerate-known-schema-types.mjs` records the
 * measurement (eleven of the fifteen real types in the old hand list are
 * registered by packages the CLI does not depend on) and the reason a runtime
 * lookup would answer the wrong question anyway. What the two surfaces DO share
 * is the emitted wording, and each side pins it in its own test.
 *
 * ## Case only
 *
 * Case is the only trigger the ruling grants. This is deliberately not an edit
 * distance — `pge` suggests nothing — because a fuzzy match is scope the
 * ruling did not give and would guess where this merely names.
 */

import { KNOWN_SCHEMA_TYPES } from './known-schema-types.js';

/**
 * The known schema type that differs from `type` only in case, if there is one.
 *
 * Returns `undefined` when nothing matches case-insensitively — the caller must
 * then say nothing at all, so `Unknown schema type "zzz"` never acquires a
 * bogus suggestion.
 */
export function suggestKnownTypeByCase(type: string): string | undefined {
  if (typeof type !== 'string' || type === '') return undefined;
  const wanted = type.toLowerCase();
  for (const candidate of KNOWN_SCHEMA_TYPES) {
    if (candidate !== type && candidate.toLowerCase() === wanted) return candidate;
  }
  return undefined;
}

/**
 * The suggestion clause `objectui check` appends to an unknown-type warning, or
 * the empty string when there is nothing to suggest.
 *
 * Quoting follows this surface's own convention — the warning already spells
 * the offending type as `"Page"` — so the two halves of one line agree. The
 * OBJUI-001 panel quotes with `'…'` for the same reason on its side.
 */
export function didYouMeanClause(type: string): string {
  const match = suggestKnownTypeByCase(type);
  return match === undefined ? '' : ` — did you mean "${match}"?`;
}
