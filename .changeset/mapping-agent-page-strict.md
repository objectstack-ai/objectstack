---
'@objectstack/spec': minor
---

`mapping`, `agent` and `page` reject unknown keys — and `strictObject` stops suggesting keys that were removed.

**A bug this campaign introduced into its own helper, fixed first.** `skill` closed in the last batch while still carrying `retiredKey` tombstones, and `strictObject` built its "did you mean" candidates from the whole shape — tombstones included. So a `triggerPhrase` typo was answered with *"Did you mean `triggerPhrases`?"*, a key that had been **removed**. An author who complied landed on the tombstone and got a second rejection telling them to delete what they had just been told to write.

Third occurrence of a shape the ledger already records twice — this campaign's fix pointing the way into the failure it exists to kill — and the first one in a *shared* helper, where it would have reached every conversion after it. Fixed structurally: **never suggest a key the schema cannot accept.** Candidates that accept `never` are dropped, so the rule holds without knowing why a key is unwritable. The two helpers stay complementary; `retiredKey` is *stronger* than a `guidance` entry, because typing the key as `never` also fails `tsc` when the config arrives through a variable, where excess-property checking would not fire.

**`agent` had two security-shaped removals with no tombstone.** `visibility` and `tenantId` were deleted as unenforced security properties — correctly, since neither did anything — but deleted without a prescription, because the shape was `.strip` and there was no rejection to attach one to. An author who wrote `visibility: 'private'` believed the agent was hidden. It was listed to everyone, and always had been. This is the `skill.permissions` class: a key that reads as a security control, is not one, and says nothing when you write it. Closing the shape created the channel, so both now name what actually gates an agent (`access` / `permissions`, enforced at the chat route since #1884).

**`route` on a page was a fiction the platform's own test suite carried.** `stack.test.ts` authored `route: '/landing'` for years. `PageSchema` has never declared it — a page is routed by its `name`, which in the map format under test IS the map key, which the test asserted six lines below the key contradicting it. Fifth test found codifying a strip-era fiction as intent, and the most likely to be reinvented, since `route` is the first key anyone reaches for on a page. Tombstoned with `path` and `url`.

Also tombstoned from each file's own comments, now that there is somewhere to put them: `agent.memory.shortTerm` (declared a working-memory window nothing consumed — ADR-0013 D3), `page.recordReview` and `page.blankLayout` (page types with no renderer, removed in framework#2265), and wrong-layer pointers for the page keys that read like real controls — `interfaceConfig.visualization` (the display mode is chosen from `appearance.allowedVisualizations`, and is not a page type), `guardrails.allowedTopics` (there is no allow-list, only `blockedTopics`).

`mapping` and `page` also gain their ADR-0010 protection envelope, which their loaders stamp and their schemas could not hold. **The undeclared-envelope debt list is down to two** (`action`, `field`), from eight.

Registered types closed at the top level: **21 of 25**. Still open: `action`, `dashboard`, `field`, `view`.

That count is now derived and pinned rather than tallied by hand — it had already drifted by one, in a campaign whose recurring lesson is that hand-maintained measurements of coverage go stale. `metadata-type-schemas.test.ts` walks each registered schema for its top-level catchall and carries the open list as a reverse pin, so closing a type fails the test until the list shrinks, exactly like the envelope debt list next to it.

The unknown-key warning layer's covered roots drop from 6 to 3 — verified as a hand-off rather than a hole: `agent.zzz`, `page.zzz` and the nested `page.regions[0].zzz` are each now rejected by the parse. A broken walk and a successful graduation shrink that count identically, so the check is pinned in the test alongside the number.

Authoring impact: a key none of these shapes declares is now rejected instead of silently discarded — it was already being ignored, so no working metadata changes.
