---
'@objectstack/spec': minor
---

`action` rejects unknown keys, and the ADR-0010 protection-envelope debt list reaches zero.

`ActionParamSchema` has been strict since #3746 — the template this whole campaign was generalized from, and the source of its sharpest lesson: `visibleWhen` → `visible` showed that the most valuable entry in an alias table is rarely a typo, it is a key that reads as a control and silently is not one. The action *around* the param stayed open for three more releases.

**The AI exposure block is the reason this one mattered.** `ActionAiSchema` is the governance gate — its own doc says the platform's value is that "a human can govern exactly which capabilities the agent fleet is allowed to invoke", and that "a half-finished or unreviewed action must never be silently armed". Yet `requireConfirmation` (one letter off `requiresConfirmation`) was dropped in silence, so an author who asked for a human-in-the-loop gate on an AI-invoked action did not get one and was not told. Both that block and the action root now reject, with prescriptions for the two keys authors reach for at the wrong level (`exposed` and `requiresConfirmation` belong under `ai`).

**An action's capability gate is real, and the near-misses now rename onto it.** `requiredPermissions` (ADR-0066 D4) is enforced with a 403 on the platform action route, so `permissions` / `capabilities` / `acl` are aliased to it rather than being told the gate lives elsewhere. What *is* tombstoned is the trap beside it: `visible` and `disabled` are UI predicates — **they hide or grey a button, they do not stop a request** — and an action with no UI surface is `locations: []`, still gated.

That entry was wrong in the first draft of this change, in the direction that matters. It claimed an action carries no permission key and sent authors to the object's permission sets, which — had anyone followed it — invites deleting a working `requiredPermissions` gate. Caught by checking the docs the drift report flagged (`ui/actions.mdx` teaches exactly that key) against the schema. It is the ledger's finding 7 for the fourth time: **this campaign's own prescriptions are themselves a surface that can be confidently wrong**, and the only defence is verifying each one against the schema rather than against memory of it.

`resultDialog` and its fields, the AI param hints, and the `bodyShape` wrapper close alongside.

**The undeclared-envelope debt list is now empty.** The structural walk opened it with eight names (`action`, `book`, `field`, `job`, `mapping`, `page`, `translation`, `validation`) after replacing a probe that had been hiding seven of them; `action` was the last. The empty set is kept rather than deleted — with no exemptions, the `DECLARES the protection envelope` case now runs over every registered type, so a new type shipping without the spread fails immediately instead of being quietly added to a list. Adding a name back is filing a bug, not granting an exemption.

Registered types closed at the top level: **24 of 25**. Only `view` remains.

Two things the lint layer surfaced, recorded rather than papered over:

- **The array-index test has run out of subject.** It was `pages[].regions[]`, then `objects[].actions[]`; with `action` closed there is no declared array-of-objects left anywhere in the registered surface that is still strip-mode. The walker's array handling is unchanged and still correct — what is gone is any metadata type that exercises it. The test now asserts the hand-off plus the per-node descent under a closed root (the #4522 fix), and says in place that an indexed assertion should be restored if a new strip surface ever appears.
- **`view` is the last open root**, so when it closes this layer has nothing left to warn about at a root. The test says to change the floor to 0 and assert the empty set *deliberately* — not to delete the test, because an empty result nobody chose is indistinguishable from a derivation that broke.

Authoring impact: a key `ActionSchema` does not declare is now rejected instead of silently discarded — it was already being ignored, so no working action changes.
