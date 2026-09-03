---
'@objectstack/lint': minor
---

security lint: report a `controlled_by_parent` object whose master is decided by FIELD DECLARATION ORDER (#14747)

`SecurityPlugin.resolveCbpRelation` resolves the master a `controlled_by_parent`
object derives record-level access from through three tiers — a required
`master_detail`, then any `master_detail`, then a required `lookup` — and picks
inside a tier with `Array.prototype.find`. So when two or more candidates sit in
the tier that wins, the master is whichever one the field map happens to list
first. Measured on a real kernel: an object declaring two required lookups
resolved its security master to the first-declared one, and swapping the two
field declarations — nothing else — repointed every row's record-level access
to the other object. Nothing reported it: not `os validate`, not `os lint`, not
a boot warning.

New error id **`security-controlled-by-parent-ambiguous-relation`**, the mirror
image of `security-controlled-by-parent-no-relation` (#7503): that one reports
ZERO candidates, this one reports two or more. The message names every
candidate — field, type and master — in declaration order, says which tier was
tested, and says which candidate wins today and therefore which object access
derives from right now.

Only the **winning** tier is judged, and that is not a shortcut: the runtime's
`??` chain stops at the first tier that resolves, so a tie in a lower tier is
masked by a higher tier's single winner and is not a decision the platform ever
makes. An object with one required `master_detail` and two required lookups is
silent, and stays silent.

`error` rather than advisory, for the inverse of the usual reason. The other
error rules in this linter mirror a hard runtime refusal; this one has none to
mirror precisely BECAUSE the runtime does not refuse — it silently picks — so
author time is the only place the ambiguity can ever surface. What it does meet
is the admissibility bar the #7503 rule states: a self-contained property of the
object document, no per-permission-set nuance to adjudicate, and no legitimate
reading, since two tied candidates is not an author saying which master they
meant.

This **narrows the accept set of a gating rule** — error findings fail
`os validate` / `os compile`. Measured over the shipped corpus: the three
`controlled_by_parent` objects in the example apps (`showcase_invoice_line`,
`showcase_expense_line`, `crm_opportunity_line_item`) plus the 27
`ObjectSchema.create` sites the `check:doc-security-posture` gate reads across
226 marked prose blocks — **0 findings before and 0 after**. Each of the three
declares exactly one required `master_detail`, so tier 1 wins with a single
candidate. `showcase_invoice_line` is the interesting one: it also carries a
required `lookup`, and the rule is silent because that tie-free lower tier is
never reached.

No runtime behaviour changes. `resolveCbpRelation` in this package now reads its
tiers from one shared table so the two rules cannot disagree about which tier
wins, and its answer is unchanged by construction: `find` over a tier is the
first element `filter` over that tier keeps. The mirror's one deliberate
divergence from the runtime is kept — `reference` is the only spelling accepted
here (#5017), so a field carrying the rejected `reference_to` alias is not a
candidate and cannot create a tie.
