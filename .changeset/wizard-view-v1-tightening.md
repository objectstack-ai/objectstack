---
"@objectstack/spec": minor
---

feat(spec): wizard view v1 — declaration-and-refusal tightening of `FormViewSchema` `type: 'wizard'` (#13704)

**BREAKING** accept-set narrowing on `FormViewSchema`, shipped as `minor` under the
repo's launch-window convention for breaking changes. Grade argued per the #13622
ruling (T4 leaves the final call to this PR's review chain): the nearest
tightening precedents are the two `ActionSchema` accept-set narrowings #11519
(doubled post-success navigation refused) and #11842 (`newTabUrl` /
`opensInNewTab` co-constraint), both shipped `minor` with the **BREAKING** header;
the mechanism precedent is the `section.pane` non-split parse refusal this change
extends. The measured population of affected authored sources is zero in every
in-tree corpus (the showcase task wizard and its lint-fixture mirror are the whole
authored wizard corpus; both already use only clean step keys).

The wizard form view existed end to end (spec enum, gated renderer, one real
author) but its contract was silent: the gate semantics lived only in renderer
comments, wizard-inert section keys parsed clean, and a step-less wizard silently
rendered as a plain simple form. Ruled on #13622 (maintainer 2026-08-31, director
batch #12, 「同意」), v1 is a declaration-and-refusal tightening with **zero new
authorable keys**:

- **Wizard steps carry no predicate slot and do not collapse** (upgrades
  objectui#6237's ruled `FormSectionConfig` split to a parse refusal): on
  `type: 'wizard'`, a section `visibleWhen` (or its deprecated `visibleOn`
  alias), `collapsible: true`, or `collapsed: true` is now refused at parse with
  a prescription. Fix: remove the key — put visibility predicates on the fields
  inside the step, or use a `simple`/`tabbed` form for section-level
  visibility/collapsing. The same keys stay accepted on every non-wizard form
  type.
- **A wizard must declare its steps**: `type: 'wizard'` with absent or empty
  `sections` is refused (it previously fell back to plain simple rendering,
  silently). Fix: declare at least one step — `sections: [{ label, fields }]`.
  The flattened runtime personalization overlay (a partial patch bound by
  `object` + `viewKind`) is deliberately exempt.
- **`steps:` is refused with guidance, never accepted as an alias**: the
  unknown-key rejection now teaches the ruled spelling — sections ARE the steps,
  array order is step order.
- **The ruled semantics are declared in the schema** (TSDoc + generated
  reference docs): the step gate is the default of `type: 'wizard'`; `allowSkip`
  is navigation freedom, not a validation exemption; the gate is UI admission,
  never authorization; progress is derived state with `showStepIndicator` the
  only authorable knob; per-step validation binds only the existing field-level
  vocabulary; array order is step order.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over existing keys: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The parse refusal is the channel that reaches an affected author, at the parse site, carrying the remedy; whether an inert wizard-step `visibleWhen` meant "move it onto the fields" or "delete the leftover" is authoring intent no migration entry can decide on an upgrader's behalf — and the measured population of affected sources is zero in every corpus. Mirrors the disposition of the #11519 / #11842 ActionSchema narrowings. -->
