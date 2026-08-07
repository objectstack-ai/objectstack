// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared changes to the DEFAULT VALUE of an already-authorable key (#4666).
 *
 * ## What this table is for
 *
 * `authorable-defaults/` records what an author gets when they omit each key.
 * Moving one of those values silently changes the behaviour of metadata that is
 * ALREADY DEPLOYED — the author wrote nothing, so there is nothing to reject
 * and nothing to warn about. `check:authorable-surface` therefore refuses any
 * such move until it is declared here, by its exact `${defKey}:${name}` and its
 * exact before/after fingerprints.
 *
 * This is the "acknowledged change" exit, and it is deliberately NOT a bare
 * allowlist. Every field is re-derived on every run from something the entry's
 * author does not control (see `authoriseDefaultChanges` in
 * `authorable-defaults.ts` for the four properties in full):
 *
 *   - `from` must equal the baseline fingerprint — read out of git at the merge
 *     base with origin/main, which the commit under test cannot rewrite;
 *   - `to` must equal what the build EMITS. The moment the default moves again,
 *     or is reverted, this entry stops matching and the gate goes red naming
 *     it. An entry cannot outlive the fact it describes;
 *   - only entries at the CURRENT protocol major authorise anything. Older
 *     majors' rows are the historical record;
 *   - `reason` is printed in full by every build that consumes the entry, so an
 *     acknowledged default flip announces itself in the log rather than passing
 *     in silence (#4690: a gate that quietly exits 0 is worse than no gate).
 *
 * ## What belongs here, and what does not
 *
 *   - **Belongs**: the default of a key that already existed moved, gained a
 *     value where it had none, or lost one.
 *   - **Does not**: a NEW key that ships with a default (no deployed document
 *     could have omitted a key that did not exist — the authorable-surface
 *     ratchet records the addition); a tightened or loosened CONSTRAINT
 *     (`.min()` / `.max()`), which is deliberately outside this ratchet because
 *     it REJECTS the offending document loudly — maintainer ruling on #4666,
 *     direction B; a retirement (`retiredKey()`), which goes through
 *     RETIRED_KEYS_BY_MAJOR.
 *
 * ## Writing an entry
 *
 * The gate prints a copy-pasteable block naming the exact key and both
 * fingerprints. Fill in `reason` with what changes for a consumer who was
 * relying on the OLD value and what they should write to keep it — that
 * sentence is the entire human record of a change no error message will ever
 * carry, and it is what a build prints when it accepts the flip.
 *
 * A default change that also warrants a migration TODO should get one: add a
 * `semantic` entry to the major's step in `src/migrations/registry.ts` so it
 * reaches `spec-changes.json`, the generated upgrade guide and
 * `os migrate meta`. This table records that the change was DECLARED; the
 * migration chain is the prescription a consumer follows.
 */

import type { DeclaredDefaultChange } from './authorable-defaults.js';

/**
 * Declared default changes, keyed by the protocol major that shipped them.
 *
 * Empty at major 17: this ratchet lands with no default change to declare, and
 * that emptiness is the gate's own proof — `check:authorable-surface` is green
 * on origin/main with the table holding nothing, which means every default in
 * the tree matches its recorded fingerprint. The first entry will be written by
 * whoever first needs to move one.
 */
export const DEFAULT_CHANGES_BY_MAJOR: Readonly<Record<number, readonly DeclaredDefaultChange[]>> = {};
