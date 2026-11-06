// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Generic only. ⛔ No customer-derived or held-out scenario is ever exported to
 * the gallery (the D1 ruling of the scenario-library epic, and the gallery's
 * own AGENTS.md: "No customer-derived content").
 *
 * A card is exported only when it is EXPLICITLY marked generic. Where it lives
 * is not a marker: the open library's README says every card in it is
 * generic, but the loader reads whatever directory it is handed, the private
 * overlay included, and a card file carries nothing that says which one it
 * came from. Its `provenance` is free prose, and prose is not a marker either.
 *
 * The card schema has no such marker today, so {@link NO_GENERIC_MARKER} — the
 * guard the CLI uses — refuses every card, and the gallery stays empty until
 * the marker is decided and added to the card schema. That guard is the one
 * place to change then; the exporter takes the guard as a parameter so its
 * own tests can run the export path with a double, and the CLI offers no flag
 * to pass another one.
 */

import type { LoadedScenario } from '../loader.js';

export interface GenericVerdict {
  generic: boolean;
  /** Why, in one line — printed with every refusal. */
  reason: string;
}

/** Decides whether a card may be exported. Must refuse whatever it cannot show is generic. */
export type GenericGuard = (scenario: LoadedScenario) => GenericVerdict;

/** The guard the CLI uses until the card schema carries an explicit generic marker: it refuses every card. */
export const NO_GENERIC_MARKER: GenericGuard = () => ({
  generic: false,
  reason:
    'not marked generic: the card schema carries no explicit generic marker, so no card can be shown not to be customer-derived or held out, and none is exported',
});
