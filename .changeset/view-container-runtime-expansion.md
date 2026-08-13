---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): expand a runtime-authored `defineView` container so the views it declares are actually served (#7736)

Publishing views through the runtime metadata API using the documented
`defineView` container shape succeeded at every step and produced nothing a user
could see. `PUT` the container to the draft endpoint, `POST` to publish, then
query the object — an empty list. Reading the row directly by name returned the
full body, badged `_diagnostics.valid: true`, and a server restart changed
nothing.

**Why.** "Object has-many View" (ADR-0017 §2, §3.2) makes container ingestion
**dual-read**: register the container under the bare `<object>` key for
back-compatible single-item reads, *and* register every named view as an
independent `ViewItem` under `<object>.<viewKey>`. Only the expanded items carry
the `viewKind` + `object` pair that every object-bound read path filters on, so
the expanded layer — never the container — is what `GET /meta/view?object=`,
`getViewsByObject()` and the view switcher actually read.

Both **source** registrars do this: the ObjectQL boot loop (`engine.ts`) and the
metadata artifact/HMR loader (`plugin.ts`). The **runtime** door did not. A
container written through it was stored verbatim, carrying neither `object` nor
`viewKind`, and `getMetaItems` then dropped it from enumeration — correctly, on
its stated assumption that "the registrar expands it into independent
ViewItems". For a runtime-written row no registrar ever had, so the container was
filtered out and the expansion it was filtered out *in favour of* did not exist.
Measured on the card's repro: the stored container expands cleanly to two items
that would match the switcher, and both object-bound exits answered zero.

**Where the fix goes.** At `hydrateOverlayIntoRegistry` — the one choke point all
three runtime hydration callers already share (boot `loadMetaFromDb`, read-side
`getMetaItems`, write-through `applyRegistryWriteThrough`). That matters,
because there are **two independent object-bound readers**: the REST route reads
through `getMetaItems`, while `getViewsByObject()` reads `MetadataManager.list`.
Expanding at either read exit fixes the card's literal repro and leaves its
sibling answering empty. One expansion at the shared seam serves every reader,
survives a restart, and keeps read-your-writes — the "single, universally-applied
location" #7163 asked for after the same defect was closed one seam further in.

The canonical-shape filter is deliberately **left alone**. Its invariant — a
container's expanded items are also present — is precisely what was false here,
and this restores it rather than loosening the filter, which would surface the
legacy wrapper shape to every list consumer (Studio list, REST, AI retriever)
and still show the switcher nothing, since a container carries no `viewKind`.

Nothing extra is persisted: the container is still stored as exactly one
byte-identical row and the ViewItems are derived on hydration, so an edited
container cannot leave stale expanded rows behind. An already-independent
`ViewItem`, a non-view type, and an object with no container authored are all
unaffected — pinned, along with the headline behaviour, in
`view-container-runtime-expansion.test.ts`.
