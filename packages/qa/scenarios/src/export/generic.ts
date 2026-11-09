// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the gallery may show. ⛔ No customer-derived or held-out scenario is
 * ever exported to the gallery (the D1 ruling of the scenario-library epic,
 * and the gallery's own AGENTS.md: "No customer-derived content"), and no
 * internal check is either.
 *
 * A card is exported only when it is EXPLICITLY marked generic — its `origin`
 * is `generic` — and its `tier` is a gallery tier (`starter` or `delivery`;
 * never `control`, an internal quality check, whatever it scores). Where a
 * card lives is not a marker: the loader reads whatever directory it is
 * handed. Its `provenance` is free prose, and prose is not a marker either.
 *
 * {@link GALLERY_GUARD} is the guard the CLI uses; the exporter takes the guard
 * as a parameter so its own tests can run the export path with a double, and
 * the CLI offers no flag to pass another one.
 */

import type { LoadedScenario } from '../loader.js';
import { isGalleryTier } from '../schema.js';

export interface GalleryVerdict {
  /** True exactly when {@link reasons} is empty. */
  eligible: boolean;
  /** Why not, one line per rule the card fails — printed with the refusal. */
  reasons: string[];
}

/** Decides whether a card may be exported. Must refuse whatever it cannot show is generic and meant for the gallery. */
export type GalleryGuard = (scenario: LoadedScenario) => GalleryVerdict;

/** The guard the CLI uses: `origin` `generic`, and `tier` `starter` or `delivery`. */
export const GALLERY_GUARD: GalleryGuard = ({ card }) => {
  const reasons: string[] = [];
  if (card.origin !== 'generic') {
    reasons.push(`origin \`${card.origin}\`: only a \`generic\` card is exported, never a customer-derived or held-out one`);
  }
  if (!isGalleryTier(card.tier)) {
    reasons.push(`tier \`${card.tier}\`: an internal quality check, never exported whatever it scores`);
  }
  return { eligible: reasons.length === 0, reasons };
};
