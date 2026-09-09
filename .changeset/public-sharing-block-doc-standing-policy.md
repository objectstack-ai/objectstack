---
"@objectstack/spec": patch
---

The block-level `publicSharing` TSDoc now states the standing policy, not just the mint half.

`ObjectSchema.publicSharing`'s block comment said that with the block omitted or `enabled:false` "the platform refuses to create share-link rows for this object — independent of any permission the caller holds". Literally true, and the mint half only. Since #14033 the switch is a **standing policy held again at every redemption**: `resolveToken` re-reads the object's current block, so a block that is off refuses every token on it — those minted while it was on, and those minted through the system-context / `permissive` mint bypass alike.

That correction already landed on the `enabled` property comment thirty lines below, on `IShareLinkService.resolveToken`'s `null`-cause list and in design note 7 of `contracts/share-link-service.ts`. The block-level sentence was left behind, so the same file stated one fact two ways with no signal telling a reader which was current — and the block doc is the more likely landing site of the two, since it is what a reader scanning the object schema for the sharing policy meets first and it carries the `@see` pointers that make it read as the block's orientation text.

The sentence now names both halves and points at `enabled` for the full statement rather than restating the mechanism a third time. Comment text only: no schema arm, bound, default, `.describe()` string or runtime behaviour moves, and no generated artefact changes. The text ships because `packages/spec` publishes both `src/**/*.zod.ts` and unminified bundles that carry source comments verbatim.
