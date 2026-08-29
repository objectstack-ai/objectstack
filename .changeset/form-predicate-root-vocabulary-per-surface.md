---
"@objectstack/metadata-core": patch
"@objectstack/metadata": patch
---

fix(metadata-core,metadata): split the form-view predicate root vocabulary per surface, so a field-level `current_user` test is not false-flagged (#12915)

Same-day correction to the unbound-root boot notice. The notice judged **every**
form-view predicate against one vocabulary (`record` / `previous` / `parent` /
`data`), sourced faithfully from the contract prose — which, for the field-level
slot, was stale.

`current_user` and its ADR-0068 alias roots (`user`, `ctx.user`, `os.user`)
**resolve on a field-level `visibleWhen`** since objectui#6010; three spec text
sites still said otherwise until #12930 re-measured them, and one of those sites
was the sentence this policy was written against. A legacy artifact carrying a
legitimate `current_user.role == "admin"` field predicate was therefore reported
as faulting open — the cry-wolf failure the notice is explicitly built to avoid,
and the one that trains operators to ignore the channel.

The vocabulary is now per surface, which is what the contract actually says:

- **Field-level** (`BOUND_FORM_FIELD_PREDICATE_ROOTS`): the shared base plus
  `current_user`, `user`, `ctx`, `os`. Silent on all of them.
- **Section-level** (`BOUND_FORM_VIEW_PREDICATE_ROOTS`, unchanged in name and
  value): the base alone. `current_user` is still flagged there — the section
  docblock states it is unbound at that level and faults open.

Two limits of the field binding deliberately do **not** change the answer: it is
a rendering rule rather than authorization (an authoring hazard, not a
version-drift one), and the scope is empty on the console's public `/f/:slug`
route (equally true of a freshly built current artifact, so it says nothing
about the artifact's era — the only thing this notice claims to detect).

The emitted warn line now prints the bound roots **per surface, and only for the
surfaces the findings implicate**, so an operator is never shown a rule their
artifact has no instance of. Findings carry a `surface` field.

`unboundRootsInCelSource` takes the vocabulary as an optional second argument;
its default is unchanged (the stricter base), so existing callers behave exactly
as before.
