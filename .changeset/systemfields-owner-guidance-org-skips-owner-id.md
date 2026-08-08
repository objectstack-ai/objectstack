---
"@objectstack/spec": patch
---

fix(spec): the `systemFields.owner` rescue no longer tells authors that `ownership: 'org'` picks a different principal (#6365)

`systemFields` has never declared an `owner` key, and the field doc above the
block names one — so an author (or an AI writing metadata) who follows that
prose lands on the block's `guidance.owner` prescription. That prescription
said:

> `owner_id` injection is governed by the object-level `ownership` property
> (`ownership: 'none'` skips it; `'user'`/`'org'` choose the principal).

The second half was false. `'org'` does not choose a different principal — it
injects **no** `owner_id` at all. The authority `applySystemFields` consumes,
`resolveInjectedSystemColumns` (`packages/spec/src/data/injected-system-columns.ts`),
admits exactly two spellings:

```ts
const owner = ownershipEligible && (ownership === undefined || ownership === 'user');
```

and the `ownership` property's own JSDoc, ~90 lines above the guidance, already
said so correctly (`org` / `none` — no per-record owner; `owner_id` is NOT
injected). The guidance was the wrong side of that contradiction.

Why it was worth fixing rather than leaving as prose drift: this is the text an
author is handed at the exact moment they are already confused about where owner
injection is configured, and it sent them to `ownership: 'org'` expecting an
org-keyed owner column. Nothing rejects `ownership: 'org'`, so the mistake
ships silently and every owner-keyed feature quietly does nothing —
owner-scoped RLS, "My" views, owner reports, the first-admin bootstrap handoff.
That is the failure mode the `guidance` machinery exists to prevent, inverted:
a wrong-key rescue handing out a second wrong answer.

The rescue now states the injection rule as the authority implements it —
`'user'` (or omitted) injects `owner_id`; `'org'` and `'none'` **both** skip it
and no `owner_id` is injected at all — while keeping the two skipping values
visibly distinct in intent (`'org'` for an org-wide catalog, `'none'` for a
junction/link table), since that distinction is the reason the enum carries
both.

The sibling `guidance.ownership` message is widened in the same pass. It was not
wrong, only out of date: since #5677 / ADR-0117 D1 the `ownership` property
governs **both** record-ownership anchors, so the message now says it decides
whether `owner_id` **and** `owning_business_unit_id` are injected, rather than
naming only the first.

Text only — no acceptance change. Every value `ObjectSchema` accepted before is
accepted now, every value it rejected is still rejected, and the injection
behaviour is untouched. The new pin tests assert the message's substance against
`resolveInjectedSystemColumns` rather than echoing the sentence, so the
prescription can only stay green while it still describes what the injection
pass really does.
