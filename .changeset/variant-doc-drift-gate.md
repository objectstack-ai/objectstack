---
"@objectstack/spec": patch
---

Add a gate that fails CI when a discriminated-union variant the schema declares is
never mentioned in the hand-written doc bound to it.

The liveness gate asks whether a property does anything; `check-doc-authoring` asks
whether docs use the right authoring form. Neither asked the inverse-drift question:
does a variant the schema declares appear in the prose at all? `content/docs/references/`
is generated from the schemas and cannot drift, but the hand-written pages are typed by
humans and do.

The founding case shipped for months: `content/docs/ui/apps.mdx` said the navigation
tree "supports eight item types" and enumerated eight. The schema had nine — `separator`
was added to match the objectui renderer and no hand-written page ever learned about it.
Making `NavigationItemSchema` a discriminated union raised the cost of that gap, because
a mistyped `type` now answers with the list of valid discriminators and the doc's
enumeration is what an author checks it against.

`packages/spec/variant-docs.json` classifies all 20 unions: 5 governed (every variant
must be mentioned in a bound doc), 15 exempt as either generated-reference-only or
not-authorable. The ledger key is the discriminator plus its sorted variant set, so
adding or removing a variant changes the key and sends the author back through the
ledger — and therefore back to the doc.
