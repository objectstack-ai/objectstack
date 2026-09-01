---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): an object's declared `publicSharing.redactFields` keep applying to share-link redemption after the object opts out (#13856)

`ShareLinkService.getPolicy()` collapsed to an EMPTY policy whenever the
object's `publicSharing` block had `enabled !== true` — `redactFields: []`
included. A link minted while the object was opted IN and redeemed after it
was opted OUT therefore kept resolving and started serving the very fields the
object declares redacted: turning the feature OFF made the anonymous endpoint
serve MORE data than it did while the feature was ON. Fail-open in the wrong
direction, and wrong under either answer to the standing-policy question.

The declared redaction set is now read from the object's declared
`publicSharing` block regardless of `enabled`, so opting out can never widen
what an existing token serves. Anonymous redemptions on opted-out objects that
previously received the declared-redacted fields stop receiving them — that
narrowing is this fix's intent, declared here rather than smoothed over.

Unchanged, deliberately:

- the `enabled: true` path (declared ∪ per-link union, byte-identical);
- an object with no `publicSharing` block at all (no redaction set sprouts);
- the per-link `redact_fields` half of the union;
- the mint-time opt-in gate (`SHARING_NOT_ENABLED`, 422) and the #13608
  redemption-time eligibility gate;
- whether an already-minted link should still RESOLVE at all once
  `enabled` is false — that ruling is pending in #14033 and is not
  implemented here in either direction.
