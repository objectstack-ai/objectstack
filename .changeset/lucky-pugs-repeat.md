---
'@objectstack/service-analytics': patch
---

Source the comparand-type allow-list and the accepted-set refusal sentence from the shared `@objectstack/spec/data` door instead of re-spelling them locally.

`comparand-shape.ts`'s `isBindableComparand` / `isRenderableTextComparand` spelled the same six accepted comparand types (`string | number | bigint | boolean | null | Date`) that `isAcceptedFilterComparand` single-sources for the SQL driver family, and two refusal messages hand-copied the accepted-set sentence. Both predicates now delegate the type membership to the door and quote `ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE`, matching how `driver-sql` and `driver-turso` consume it.

No comparand is accepted or refused differently: the local copies already agreed with the door, and the full accept/refuse matrix is pinned end to end at both analytics filter doors, in three comparand positions each, measured before the change and re-run unchanged after it.

One user-visible wording correction falls out of removing the copy: the hand-copied sentence omitted `bigint`, a type both predicates have always accepted and both doors have always compiled, so a refusal message under-described the values it accepts. The message now names the full set. The package-local extras — a binary bindable, and the `undefined` arm both doors already refuse upstream — are unchanged and recorded at their use sites.
