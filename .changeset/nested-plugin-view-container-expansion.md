---
"@objectstack/objectql": patch
---

fix(objectql): a nested plugin expands an aggregated `views` container — its per-view items reached no registry

**This changes boot behaviour for packages that ship views through
`manifest.plugins[]`.** "Object has-many View" (ADR-0017 §2, §3.2) makes the
loader **dual-read**: an aggregated `defineView` container is registered under
the bare `<object>` key for back-compatible reads AND expanded into independent
`ViewItem`s under `<object>.<viewKey>`. Only the expanded items carry
`viewKind`, and `getViewsByObject()` filters on exactly that — so the expanded
layer, not the container, is what `GET /meta/view?object=`, the runtime view
switcher and Studio's package attribution actually read.

`engine.ts` reaches the registration seam from two entry points, and only the
manifest one expanded. One container measured through each:

```
via manifest      → ['account', 'account.all_accounts', 'account.form']
via nested plugin → ['account']
```

No refusal and no diagnostic: a package whose views arrived through a nested
plugin registered the container and nothing else, so every reader of the
expanded layer saw an object with no views at all. After this change both seams
answer the same, and those packages' view switchers begin working. Anything that
has been compensating for the silence — a duplicate `views:` hoisted to the
top-level manifest — now finds the views already registered.

The direction was measured rather than assumed, because the divergence had two
coherent readings. ADR-0017 states the dual-read as a property of "the loader"
at load time, not of one entry point; the OTHER loader agrees with the manifest
seam (`MetadataPlugin`'s artifact/HMR path expands too, which is why the shared
implementation lives in `@objectstack/spec` — "so the two loaders cannot
drift"); every authored stack in the tree ships `views` at manifest top level,
so removing the manifest seam's expansion would take the switcher away from all
of them; and no in-tree package ships `views` through a nested plugin, so the
seam that GAINS behaviour here breaks nobody. One direction is load-bearing for
real consumers and the other is not.

So, as with #7049, the copies are gone rather than reconciled: both seams now
run one `registerMetadataCollections()` body. #7049 hoisted the shared
`METADATA_ARRAY_KEYS` and measured the loop bodies on the way past, recording
that they still differed in a per-key `debug` line, this view expansion, and a
warn-on-nameless-item — sharing the list made "which collections does a seam
see?" unanswerable-differently while leaving "what does a seam DO with a
collection both see?" answered in two places. Both remaining differences had the
same structure, a body copied then improved on one side only, so the body is
shared too: a nested plugin now also emits the skipping-a-nameless-item warning
it used to swallow. `engine-nested-plugin-collections.test.ts`'s `views`
exclusion row — the only one that was ever a behaviour difference rather than a
retired kind — is removed with the divergence.

Refs: #7163, #7049, #6242, #5870, ADR-0017, ADR-0010.
