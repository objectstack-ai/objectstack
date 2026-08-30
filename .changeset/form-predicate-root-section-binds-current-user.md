---
"@objectstack/metadata-core": patch
"@objectstack/metadata": patch
---

fix(metadata-core,metadata): a form SECTION binds `current_user` too, so the unbound-root notice stops flagging one (#13072)

Second correction to the unbound-root boot notice, and the same defect as the
first one a surface later. The notice judged a SECTION-level predicate against
`record` / `previous` / `parent` / `data`, sourced faithfully from the section
contract prose — which was stale.

`current_user` and its ADR-0068 alias roots (`user`, `ctx.user`, `os.user`)
**resolve on a section-level `visibleWhen`**: objectui#6110 threads the host
shell's predicate scope into `isSectionVisible` where it used to pass
`undefined`, and objectui#6111 copies the authored `visibleWhen` onto the
`section-divider` pseudo-field whose predicate the SDUI form renderer evaluates
with that scope bound. #12914 re-measured the contract text accordingly. Until
this change, a legacy artifact carrying a legitimate section-level
`current_user.role == "admin"` predicate was reported at boot as an unbound root
that faults open — a notice about a predicate that resolves, which is the
cry-wolf failure the module's own doc forbids and the one that trains operators
to ignore the channel.

**What changes:** one vocabulary now serves both form-view predicate surfaces —
`record`, `previous`, `parent`, `data`, `current_user`, `user`, `ctx`, `os`. A
section predicate rooted at the `current_user` family is silent; a section
predicate rooted at a bare field identifier is still reported, and the operator
line still prints the rule per surface for the surfaces the findings implicate.

**Blast radius, stated without inflation:** this is a **notice**, not a refusal
— no parse change, no gate, no behaviour change, and it only runs inside the
versioned window `applyArtifactForwardConversions` opens. The cost it removes is
a false operator signal on legacy artifacts, not a broken runtime.

**Removed export, with its migration:** `FIELD_ONLY_BOUND_PREDICATE_ROOTS` is
gone from `@objectstack/metadata-core`. The section binding empties it, and an
exported constant named `FIELD_ONLY_…` holding `[]` asserts a per-surface
difference that no renderer makes. FROM → TO: read
`BOUND_FORM_VIEW_PREDICATE_ROOTS` (every root bound on any form-view predicate)
or `BOUND_FORM_FIELD_PREDICATE_ROOTS` (the field question, the same list today).
No consumer can be carrying it: the notice has never shipped — the two
changesets that introduce it are still pending in `.changeset/`, the newest
published `@objectstack/metadata-core` is 17.2.0, and the commit that added
`form-predicate-root-policy.ts` is in no release tag. This was the last moment
at which the removal cost nothing.

**Why the vocabulary is no longer justified by quoting the contract.** Both
times this list has been wrong, it was wrong by transcribing a correct-looking
sentence that the renderer had already moved past. The prose is a transcription
of a renderer and can only lag one, so membership is now stated as the mechanism
— *a root is bound on a surface iff some renderer threads a scope carrying it
into that surface's evaluator* — with the threading site named per entry, and
the module's test reads the LIVE `.describe()` text of
`FormFieldSchema.visibleWhen` / `FormSectionSchema.visibleWhen` out of
`@objectstack/spec` instead of copying it into a comment. A comment quoting that
sentence goes stale in silence, twice now; an assertion that fetches it cannot.

<!-- adr-0087: not-required (unpublished) the removed export FIELD_ONLY_BOUND_PREDICATE_ROOTS was added after 17.2.0 and is in no release tag, so no upgrader can be holding it and there is nothing to migrate from. -->
