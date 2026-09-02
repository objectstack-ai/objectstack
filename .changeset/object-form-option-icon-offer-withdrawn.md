---
"@objectstack/spec": patch
---

fix(spec): withdraw the `icon` input from the `object.form` options repeater (#13671)

The field designer's `options` sub-form offered five inputs per select option,
and one of them named a key the publish door refuses. `SelectOptionSchema` is
strict and has never declared `icon`, so a Lucide name typed into that input
came back as an `unrecognized_keys` refusal at publish — the author found out
at the 422. Offer and door disagreed: the same class #11410 (a form offering a
`deleteBehavior` the schema refuses) and #12868 (the form-face option
narrowing) retired elsewhere, one key over.

Resolved under **ADR-0049 enforce-or-remove on the remove route**: the offer is
withdrawn so that declared = offered converges downward. ⚠️ **No accept/reject
behaviour moves** — `icon` on a select option was refused before this change
and is refused after it. Metadata that parses today parses identically; the
only thing that changes is what the Studio object designer teaches an author to
write. The repeater now offers `label`, `value`, `color` and `description` —
exactly `SelectOptionSchema`'s authorable keys minus `visibleWhen`, which is a
CEL predicate rather than a repeater text input.

**Why remove rather than declare.** The route rests on a premise measured for
the FIELD-option surface rather than inherited from #5016, which measured the
ACTION-param path — objectui's `SelectOptionMetadata` does declare `icon`, so
the two faces had to be measured apart. Measured twice with a live positive
control, same answer both times: at the objectui pin this repo ships
(`.objectui-sha` = `d8ec8d6d4f011b11c8eb1e6dbd364ef206711391`) and again at
that repo's `origin/main` (`67dadd602a3a891666ea1513c5de677140784b6a`). The
select/multiselect cell renderer (`packages/fields/src/index.tsx`) reads
`option?.label` and `option?.color` off a `SelectOptionMetadata[]` and never
`option?.icon`, and no field-option render path in either tree reads the key at
all. Declaring `icon` instead would widen
the accepted set, which needs a maintainer ruling and is deliberately not taken
here.

The #13669 pin (`field-rows-option-description.test.ts`) moves in the same
stroke rather than being deleted: its `icon` case asserted only that the door
refuses the key, which is how the offer-side half stayed green across a live
disagreement. It now asserts both halves — the door still refuses `icon`, and
the form no longer offers it — plus the general invariant that every input the
repeater offers names a key the door accepts.
