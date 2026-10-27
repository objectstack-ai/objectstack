---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/metadata-core': patch
---

feat(spec)!: retirement kits whose conversion retired at or below protocol 16.x leave the tree; the strict unknown-key refusal names the protocol upgrade guide

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**BREAKING** for a source or a stored `sys_metadata` row still carrying a key whose ≤16.x kit aged out.

- **The rule (ADR-0087, amended 2026-10-26, #25767 ruling D2 = A as scoped by ruling 6434038284).** A retirement kit — the `retiredKey()` tombstone and its D2 conversion with fixtures — lives through the protocol major after the one it retired in and is removed when the next major is cut. At 18 that removes the kits whose conversion retired at or below 16.x; 19 repeats the move one major on. The kit ages out; the migration chain's step stays.
- **Before.** Such a key met a `retiredKey()` tombstone: the parse refused it with the key's own prescription in the error, `os migrate meta --from 16` listed and applied the mechanical edit, and a stored row in that shape was rewritten at read by the ≤16.x conversions.
- **Now.** Where the tombstone sat in a strict container, the key is gone from the shape, so a `strictObject` refuses it as an unknown key. The refusal carries one more sentence, after its fix channels and ahead of its history sentence (`RETIRED_KEY_UPGRADE_GUIDE_SENTENCE`, exported with `PROTOCOL_UPGRADE_GUIDE_URL` from `@objectstack/spec`): it says that keys retired before the previous major are no longer prescribed in the error and names the protocol upgrade guide, `https://objectstack.ai/docs/protocol-upgrade`, where the prescription lives; the CHANGELOG of the release that retired the key carries it too. A tombstone that stays (its container strips unknown keys) ends its error with a sentence that says the edit left `os migrate meta` with the 16.x conversions, to be applied by hand or on a release that still carries the conversion, and links the guide.
- **The chain stays.** `MIGRATION_SUPPORT_FLOOR` stays 16; step 17 and its entry files stay, and `os migrate meta --from 16` still replays 16 → 18, listing every surviving conversion and semantic to-do. Step 17's graduated list drops the ids of the 45 conversions that aged out, so their edits are no longer applied for you.
- **Stored rows.** A `sys_metadata` row still carrying such a spelling is no longer rewritten at read; canonicalize it once with `os migrate meta --stored --apply` on 18.2 or earlier, before moving to 18.3. `app-hidden-to-unpublished` is among the removed conversions, so a pre-split `hidden: true` app row is no longer rewritten to `_unpublished` by any seam, and the artifact door's refusal of it by id is removed as moot (`@objectstack/metadata-core`).
- **What left.** 50 D2 conversions with `retiredAfter` at or below 16.x (5 at 15.0.0, 45 at 16.1.0) and their fixtures; 55 tombstones already `[RETIRED]` at `@objectstack/spec@17.0.0` whose container is strict; 61 `[RETIRED]` lines of the authorable surface and their liveness-ledger rows. 58 same-age tombstones whose container strips unknown keys stay, because deleting one would turn a refusal into a silent strip; the four inline-credential refusals are not retirements and are untouched.
- **The deletion gate.** `check:authorable-surface` proof 1 ages a tombstone one major (was two). A deleted `[RETIRED]` line is dated by an exact `RETIRED_KEYS_BY_MAJOR` row or, new, by the previous major's release tag: a line already `[RETIRED]` on the surface at `@objectstack/spec@<current major − 1>.0.0` was retired before that cut. The tag is immutable, so neither a row a PR writes nor one it deletes moves the clock; where the tag cannot be read the gate dates by the registry alone and says so. No gate was added.
- **Who moves.** No `examples/**`, `ui/` or `hotcrm` source in this repository writes a removed key (the `ui/` hits for the removed names are the console's own same-named props and type mirrors, not readers of the retired spec keys, per the liveness ledger's measurements). A consumer source still carrying one meets the strict refusal and the guide link at `os validate`.

<!-- adr-0087: not-required (no-migration-prescription) the diff registers no retirement: it removes the ≤16.x kits that aged out under the 2026-10-26 ruling (ADR-0087 D2 = A), and nothing here prescribes a rewrite — each removed key's prescription lives in the protocol upgrade guide and in the CHANGELOG of the release that retired it -->
