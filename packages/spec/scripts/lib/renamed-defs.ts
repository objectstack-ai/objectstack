// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declarative carry-over table for JSON Schema **def renames** (#4684).
 *
 * ## The gap this closes
 *
 * `build-schemas.ts` runs two ratchets, and both measure in units of the def
 * key (`<category>/<SchemaName>`):
 *
 *   - `json-schema.manifest.json` — every schema ever published;
 *   - `authorable-surface.json`   — every `<def>:<prop>` an author may write.
 *
 * Renaming an exported schema const renames its def, and to both ratchets that
 * is indistinguishable from a **deletion**: the manifest sees a published
 * schema disappear, and the authorable surface sees every key under the old def
 * vanish. Yet in a pure rename *nothing leaves the author-facing contract* —
 * `connectors[].rateLimitConfig.windowSeconds` still parses byte-for-byte the
 * same. Only an internal schema name moved.
 *
 * The three remedies the ratchets suggest are all wrong for a rename:
 *
 *   1. hand-edit `authorable-surface.json` — forbidden (#4650): the snapshot is
 *      generated, and editing it is exactly how a real deletion would hide;
 *   2. `retiredKey()` + an ADR-0087 D2 conversion — semantically false. Nothing
 *      is retired, so the tombstone has no live def to hang on and the
 *      conversion would have to name an author path that never changed.
 *      Registering it would pollute the ADR-0087 registries with a migration
 *      consumers must not run (the "green gate, wrong ledger" class of #4659);
 *   3. delete the manifest line as a "deliberate removal" — right mechanism,
 *      wrong claim, and it says nothing about the keys underneath.
 *
 * So the ratchets learn renames instead, from this table.
 *
 * ## The rule
 *
 * > Every key under the OLD def must exist under the NEW def. Otherwise: red.
 *
 * This is strictly **stronger** than the status quo it replaces. Hand-editing
 * the baseline (the practice #4650 banned) can silently drop any line at all;
 * a declared rename cannot drop even one, and a key that is genuinely being
 * retired during a rename still has to carry its tombstone and its registered
 * migration (`build-schemas.ts` re-runs check (b) against the carried key's
 * previous state). The table also fails on its own decay: a target that this
 * build does not emit, or a source that it still emits — that is a copy, not a
 * rename — is rejected before either ratchet runs.
 *
 * ## Adding an entry
 *
 * A rename is a breaking change for anyone importing the type by name, so an
 * entry here rides with a `major` changeset spelling FROM → TO. Entries stay
 * after the surface snapshot has been regenerated (they are then inert against
 * the snapshot but still enforce the hygiene invariants above), and are pruned
 * only when the old name has aged out — same discipline as a tombstone.
 */
export const RENAMED_DEFS: Readonly<Record<string, string>> = {
  // #4684 / ADR-0112 D9a — the connector-side (outbound throttling) config no
  // longer shares a name with `shared/RateLimitConfig` (inbound API limiting).
  'integration/RateLimitConfig': 'integration/ConnectorRateLimitConfig',
};

/**
 * Rewrite an authorable-surface key (`<def>:<prop>`) through the rename table.
 * Returns the key unchanged when its def is not declared renamed.
 *
 * Only the def part is rewritten — a rename moves keys, it never renames them.
 */
export function carryAuthorableKey(
  key: string,
  renames: Readonly<Record<string, string>> = RENAMED_DEFS,
): string {
  const sep = key.indexOf(':');
  if (sep < 0) return key;
  const to = renames[key.slice(0, sep)];
  return to === undefined ? key : to + key.slice(sep);
}

/**
 * Validate the table against the defs a build actually emitted.
 *
 * Returns one human-readable problem line per broken entry; an empty array
 * means the table is honest about this build.
 */
export function checkRenameTable(
  emittedDefs: ReadonlySet<string>,
  renames: Readonly<Record<string, string>> = RENAMED_DEFS,
): string[] {
  const problems: string[] = [];
  for (const [from, to] of Object.entries(renames)) {
    if (from === to) {
      problems.push(`${from} → ${to}: source and target are the same def.`);
      continue;
    }
    if (emittedDefs.has(from)) {
      problems.push(
        `${from} → ${to}: the SOURCE def is still emitted by this build. ` +
          `That is a copy, not a rename — and a copy is precisely the dual-source ` +
          `shape this table must never be able to launder (#4411, #4446).`,
      );
    }
    if (!emittedDefs.has(to)) {
      problems.push(
        `${from} → ${to}: the TARGET def is not emitted by this build. ` +
          `Either the new name is misspelled here, or the renamed schema was ` +
          `since deleted — in which case its keys really did leave the contract ` +
          `and need the tombstone route, not this table.`,
      );
    }
  }
  return problems;
}
