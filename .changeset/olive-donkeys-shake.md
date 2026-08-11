---
'@objectstack/plugin-security': patch
---

Surface the `isDefault` audience-binding suggestion on stock instead of skipping auto-bound declarations

`GET /api/v1/security/suggested-bindings` returned an empty list on a stock boot even though the `isDefault` permission set and its `everyone` binding both existed. The security plugin binds the app's baseline set to the `everyone` anchor at boot, before the first reconcile runs, so `syncAudienceBindingSuggestions` always found the declaration already satisfied and skipped it entirely — no row was written, and the declaration only ever appeared after an admin deleted the binding by hand.

An already-satisfied declaration is now recorded rather than skipped, in the state it is actually in: `confirmed` with an empty `resolved_by`, which is how the backing object defines an observed binding ("bound at boot or by hand, not confirmed through the prompt"). It is deliberately not `pending`: that is the actionable-prompt state the console panel lists and the confirm/dismiss methods accept, so a pending row would ask an admin to accept a binding that already exists.

The existing flow is unchanged — an unbound declaration still surfaces as `pending`, and the pending-to-confirmed transition still fires when the binding is observed later.
