// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declarative carry-over table for JSON Schema **def renames** (#4684).
 *
 * ## The gap this closes
 *
 * `build-schemas.ts` runs two ratchets, and both measure in units of the def
 * key (`<category>/<SchemaName>`):
 *
 *   - `json-schema.manifest/`  — every schema ever published;
 *   - `authorable-surface/`     — every `<def>:<prop>` an author may write.
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
 *   1. hand-edit `authorable-surface/` — forbidden (#4650): the snapshot is
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
  // ─── ABSORBED, do not re-add: `integration/RateLimitConfig` ────────────
  //
  // #4684 / ADR-0112 D9a renamed the connector-side (outbound throttling) def
  // to `integration/ConnectorRateLimitConfig` so it no longer shared a name
  // with `shared/RateLimitConfig` (inbound API limiting). #4911 then RETIRED
  // that def outright — no outbound rate-limiting engine ever existed
  // (ADR-0049) — inside the SAME unreleased major.
  //
  // Composed, rename-then-delete is just a delete, and the entry could not
  // survive either way: `checkRenameTable` rejects a target this build no
  // longer emits, which is precisely the decay guard that made this table
  // trustworthy. The removal is carried by the real retirement kit instead —
  // a `retiredKey()` tombstone on `ConnectorSchema.rateLimitConfig`, the
  // `connector-rate-limit-config-removed` D2 conversion, and the deliberate
  // manifest deletion of both `integration/ConnectorRateLimitConfig` and
  // `integration/RateLimitStrategy`. A retirement must never ride this table
  // (same ruling as `automation/ConflictResolution` below).

  // #4703 / ADR-0112 D9a — `FieldMapping` was published by THREE defs at once.
  // The two domain-specific sides take a domain prefix; `shared/FieldMapping`
  // is the BASE that this rename's target (and, until #8075's whole-family
  // retirement, `data/ExternalFieldMapping`)
  // extend, so it keeps the bare name and is deliberately absent from this
  // table. Note what an `extend` means for the invariants below: the target
  // def's key set is a superset of the base's, so every carried key is found,
  // while the base def is emitted unchanged and is neither a source nor a
  // target here.
  'integration/FieldMapping': 'integration/ConnectorFieldMapping', // 7 keys carried
  'data/FieldMapping': 'data/ImportFieldMapping', //                  4 keys carried

  // #4738 / ADR-0112 D9a — `ConflictResolution` was published by THREE defs at
  // once (automation ≠ integration ≠ ui, three disjoint vocabularies). The
  // connector-sync side takes the domain prefix (0-key carry: it is an enum
  // def, no authorable properties). The automation side was retired outright
  // with the rest of `automation/sync.zod.ts` in the same change (deliberate
  // manifest removal, NOT carried here — a real retirement must never ride the
  // rename table). `ui/ConflictResolution` kept the bare name at #4738 — a
  // distinct concept (client/server offline sync). #4988 then RETIRED
  // `ui/offline.zod.ts` whole (ADR-0049; deliberate manifest deletion, not
  // carried here either), so the bare name is now emitted by no def at all.
  // This entry is unaffected and STAYS: its source is still unemitted, its
  // target still emitted, and `ConnectorConflictResolution` remains the
  // connector vocabulary's real name — a freed word is not a reason to rename
  // back, which would be a second breaking change carrying no keys.
  'integration/ConflictResolution': 'integration/ConnectorConflictResolution',

  // #4737 / ADR-0112 D9a — `ActionLocation` was published by ./studio AND ./ui
  // for two disjoint concepts. The studio side (3-value IDE surface enum,
  // consumed only by `ActionContributionSchema.location`) takes the
  // domain-specific name (0-key carry: enum def, no authorable properties).
  // `ui/ActionLocation` keeps the bare name: its docblock declares it the
  // platform-wide canonical vocabulary and objectui pins it by reference
  // (spec-derived-unions.test.ts).
  'studio/ActionLocation': 'studio/ActionContributionLocation',

  // #4741 / ADR-0112 D9a — `PackageDependency` was published by TWO defs whose
  // key sets are ENTIRELY disjoint (zero shared properties): `cloud` is the
  // DECLARATION form an author writes into a package manifest
  // (`packageId` / `versionRange` / `optional`), `kernel` is the RESOLVER form
  // the dependency graph walks (`name` / `versionConstraint` / `type` /
  // `resolvedVersion`). Two concepts, not two spellings. The resolver side
  // takes the descriptive name; `cloud/PackageDependency` keeps the bare one
  // and is deliberately absent from this table — it is neither source nor
  // target, and it is emitted byte-for-byte unchanged by this build.
  'kernel/PackageDependency': 'kernel/ResolvedPackageDependency', // 4 keys carried

  // #5832 / ADR-0112 D9 — `shared/http.zod.ts` declared TWO different enums
  // whose def keys collided after the `Schema` suffix strip: `HttpMethod`
  // (7 values, the routing contract every `api/*` endpoint is declared with)
  // and `HttpMethodSchema` (5 values, the view data-source subset). The subset
  // won by iteration order, so `shared/HttpMethod` published five values and
  // the routing contract was not published at all. The SUBSET is renamed
  // (`HttpMethodSubsetSchema` / `HttpMethodSubset`) and `HttpMethod` keeps the
  // bare name, per #4684's `RateLimitConfig` precedent.
  //
  // Only the `ui` side is a def RENAME and belongs here: `./ui` re-exported the
  // subset alone, so `ui/HttpMethod` really did leave and `ui/HttpMethodSubset`
  // took its keys (0-key carry: enum def, no authorable properties).
  // `shared/HttpMethod` is deliberately absent — it is still emitted, by the
  // 7-value enum that always declared it, so the table would reject it as a
  // copy. What changed there is the def's CONTENT (5 values -> the 7 the source
  // always had), which no ratchet here measures and which the changeset states.
  // `shared/HttpMethodSubset` is a plain manifest addition.
  'ui/HttpMethod': 'ui/HttpMethodSubset',

  // #6604 / ADR-0112 D9a — `ServiceStatus` was published by `./api` AND
  // `./system` for two disjoint concepts: the discovery HEALTH ENUM
  // (`api/discovery.zod.ts`, `z.enum(['operational', ...])`) and the kernel
  // service STATE OBJECT (`system/core-services.zod.ts`, a `features`-bearing
  // record). Maintainer ruling 2026-08-08 (Option B): the kernel side is
  // renamed and `./api` keeps the published bare name untouched — the smallest
  // blast radius, because the system side had no type alias yet, so the name
  // had not petrified there.
  //
  // 6 keys carried (`enabled` / `features` / `name` / `provider` / `status` /
  // `version`) — every one of them re-emitted byte-for-byte under the new def,
  // which is the whole point of routing this through the table rather than the
  // retirement kit: NOTHING left the author-facing contract. `api/ServiceStatus`
  // is deliberately absent — it is still emitted, by the enum that always
  // declared it, so the table would (correctly) reject it as a copy.
  //
  // This entry is what finally lets the `./system` side declare
  // `KernelServiceStatus`: #4593's alias backfill had to skip this one name
  // because declaring `ServiceStatus` on both entry points would have minted
  // the #4411 dual-source trap `dual-source-exports.baseline.json` stays empty
  // to prevent. The rename removes the collision at its source, so the baseline
  // stays empty rather than gaining its first exception.
  'system/ServiceStatus': 'system/KernelServiceStatus', // 6 keys carried
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
 *
 * The last two rules are about entries *interacting*, and only bind once the
 * table holds more than one entry — which #4703 is the first change to do.
 */
export function checkRenameTable(
  emittedDefs: ReadonlySet<string>,
  renames: Readonly<Record<string, string>> = RENAMED_DEFS,
): string[] {
  const problems: string[] = [];
  const claimedBy = new Map<string, string>(); // target def -> first source claiming it
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
    // Two sources onto one target is a MERGE, not two renames. Left unchecked
    // it defeats the table's own reason to exist: `build-schemas.ts` carries
    // the snapshot into a `prev` map keyed by the NEW key, so the two defs'
    // entries for the same property name collapse — last one wins — and with
    // them the property's recorded retired state. A key that was live under
    // one def and tombstoned under the other would then read as "already
    // retired", and check (b) — every live → retired transition needs a
    // registered ADR-0087 conversion — would never fire for it. That is a key
    // leaving the contract with the table's blessing, the one thing it must
    // not be able to explain (#4684). Converging two defs is a real change:
    // make it one rename plus an explicit retirement.
    const first = claimedBy.get(to);
    if (first !== undefined) {
      problems.push(
        `${from} → ${to}: the TARGET def is already claimed by ${first}. ` +
          `Two sources onto one target is a merge, not a rename: the carried key ` +
          `sets (and their retired states) would silently collapse into one.`,
      );
    } else {
      claimedBy.set(to, from);
    }
  }
  // A chain (A → B → C) is rejected above as "B is not emitted", which is true
  // but misdiagnoses it as a typo. Say what it is: a def that is renamed away
  // cannot also be a rename target, or the carry is order-dependent — `prev`
  // is built in one pass and never re-visits a key it has already rewritten.
  for (const [from, to] of Object.entries(renames)) {
    // A self-rename is `to in renames` by construction; rule 1 already named it,
    // and reporting it twice would just bury the real diagnosis.
    if (from === to) continue;
    if (Object.hasOwn(renames, to)) {
      problems.push(
        `${from} → ${to}: the TARGET def is itself renamed away (${to} → ${renames[to]}). ` +
          `Chained renames are not supported — the carry is a single pass. Point ` +
          `${from} straight at the final name.`,
      );
    }
  }
  return problems;
}
