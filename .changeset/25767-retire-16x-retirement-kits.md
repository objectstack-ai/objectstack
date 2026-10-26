---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/lint': patch
'@objectstack/metadata-core': patch
---

feat(spec,cli)!: retirement kits retired at or below protocol 16.x leave the tree; the strict unknown-key refusal names the protocol upgrade guide, and the migration floor rises to 17

Clause-②: no (narrowing: a key retired at or below protocol 16.x is refused as a strict unknown key without its own prescription in the error, and `os migrate meta --from 16` refuses at the support floor instead of replaying step 17)
Metadata-protocol: narrowed

**Upgrading from protocol 16 or earlier.** One major at a time, each major's CLI in turn — a major's CLI carries the steps for itself and the major before it, so the same sequence holds at 19:

```bash
npx @objectstack/cli@17.7.0 migrate meta --from 16 --apply   # 16 → 17, on the last 17.x release (its floor is 16)
npx @objectstack/cli@17.7.0 migrate meta --stored --apply    # the sys_metadata rows, BEFORE the runtime moves
# move the dependencies / the deployment's image to 18.2, then
os migrate meta --from 17 --apply                             # 17 → 18
os validate && os build
```

**Alternative, one shot:** `@objectstack/cli@18.1.0` is the last release whose floor is 16, so `npx @objectstack/cli@18.1.0 migrate meta --from 16` (then `--apply`) runs both hops in one command — work the to-do list it prints, then move the dependencies to 18.2 and run `os migrate meta --from 17`, `os validate` and `os build`; its `migrate meta --stored --apply` canonicalizes the stored rows the same way.

**Stored metadata (`sys_metadata`, Studio-authored) is migrated BEFORE the deployment's image or dependencies move to 18.2.** 18.2 no longer rewrites a ≤16.x row at read: a row left behind is refused by the strict parse until it is migrated.

**If the first hop is skipped:** on 18.2, `os migrate meta --from 16` refuses with `MigrationFloorError` and rewrites nothing, and a key retired at or below 16.x meets the strict unknown-key refusal with the guide link, `https://objectstack.ai/docs/protocol-upgrade`.

**BREAKING** for a source still carrying a key retired at or below protocol 16.x, and for an operator who runs `os migrate meta --from 16`.

- **The rule (ADR-0087, amended 2026-10-26, #25767 ruling D2 = A).** A retirement kit — the `retiredKey()` tombstone, its `RETIRED_KEYS_BY_MAJOR` / `RETIRED_DEFS_BY_MAJOR` rows, its semantic entry and its D2 conversion — lives through the protocol major after the one it retired in and is removed when the next major is cut. At 18 that keeps the 17.x and 18.x kits and removes everything retired at or below 16.x; 19 repeats the move one major on. "Never deleted", "permanent" and "forever" in ADR-0087 are amended in place.
- **Before.** A key retired at or below 16.x met a `retiredKey()` tombstone: the parse refused it with the key's own prescription in the error, `os migrate meta --from 16` listed and applied the mechanical edit, and a stored row in that shape was rewritten at read by the ≤16.x conversions.
- **Now.** The key is gone from the shape, so a `strictObject` refuses it as an unknown key. The refusal carries one more sentence, after its fix channels and ahead of its history sentence (`RETIRED_KEY_UPGRADE_GUIDE_SENTENCE`, exported with `PROTOCOL_UPGRADE_GUIDE_URL` from `@objectstack/spec`): it says that keys retired before the previous major are no longer prescribed in the error and names the protocol upgrade guide, `https://objectstack.ai/docs/protocol-upgrade`, where the prescription lives; the CHANGELOG of the release that retired the key carries it too. The 17.x kits still carry their prescription in the error, and they leave when 19 is cut.
- **The floor.** `MIGRATION_SUPPORT_FLOOR` is 17. `os migrate meta --from 16` and below answer `MigrationFloorError`, whose message now names the floor and the guide link, and rewrite nothing. A source authored against protocol 16 reaches 17 on a release that still carries the step (any `@objectstack/cli` up to 18.1), then runs the current release. The house sentence a 17.x retirement's error ends with is respelled accordingly: it says the edit is applied by hand or on a release that still carries the step, and links the guide.
- **Stored rows.** A `sys_metadata` row still in a ≤16.x shape is no longer rewritten at read; canonicalize it once with `os migrate meta --stored --apply` on 18.1 or earlier. `app-hidden-to-unpublished` is among the removed conversions, so a pre-split `hidden: true` app row is no longer rewritten to `_unpublished` by any seam, and the artifact door's refusal of it by id is removed as moot (`@objectstack/metadata-core`).
- **What left.** 50 D2 conversions with `retiredAfter` at or below 16.x (5 at 15.0.0, 45 at 16.1.0) and their fixtures; 55 tombstones already `[RETIRED]` at `@objectstack/spec@17.0.0` whose container is strict; the 159 major-17 entry files (29 retired-key rows, 53 retired-def rows, 77 semantic entries) and the chain's step 17; 61 `[RETIRED]` lines of the authorable surface and their 36 liveness-ledger rows. 58 same-age tombstones whose container strips unknown keys stay, because deleting one would turn a refusal into a silent strip; the four inline-credential refusals are not retirements and are untouched.
- **The deletion gate.** `check:authorable-surface` proof 1 ages a tombstone one major (was two). A deleted `[RETIRED]` line is dated by an exact `RETIRED_KEYS_BY_MAJOR` row or, new, by the previous major's release tag: a line already `[RETIRED]` on the surface at `@objectstack/spec@<current major − 1>.0.0` was retired before that cut. The tag is immutable, so neither a row a PR writes nor one it deletes moves the clock; where the tag cannot be read the gate dates by the registry alone and says so. No gate was added.
- **Who moves.** Measured over this repository at `963e504cf5`: no `examples/**`, `ui/` or `hotcrm` source writes a removed key (the `ui/` hits for the removed names are the console's own same-named props and type mirrors, not readers of the retired spec keys, per the liveness ledger's measurements). A consumer source still carrying one meets the strict refusal and the guide link at `os validate`.

<!-- adr-0087: not-required (no-migration-prescription) the diff registers no retirement: it removes the ≤16.x kits that aged out under the 2026-10-26 ruling (ADR-0087 D2 = A), and nothing here prescribes a rewrite — each removed key's prescription lives in the protocol upgrade guide and in the CHANGELOG of the release that retired it -->
