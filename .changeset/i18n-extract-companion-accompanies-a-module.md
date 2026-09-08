---
"@objectstack/cli": patch
---

`os i18n extract --source-hashes` no longer writes a provenance companion with no bundle module beside it, and names the sections it commits from the payloads those modules hold instead of from two literals.

The command narrows the provenance table to "the sections this run commits" before writing `<locale>.source-hashes.generated.ts`. The half that decided WHICH modules were emitted already read the emitted set; the half that named them pushed the string `'objects'` or `'metadataForms'`.

- **A zero-record orphan is no longer written.** With no module emitted for a locale — a stack whose only surface is apps, under the default `--objects-only` with `--no-metadata-forms` — the committed-section list is empty, `narrowToCommittedSections` returns `{}`, and `{}` is truthy at the emit gate. The run therefore wrote one file holding an empty table, describing nothing, with no bundle module beside it for it to be about. Because `--check` compares the companion by bytes like any other emitted file, that orphan once committed is a file the gate demands forever: deleting it made `--check` report `missing` and exit 1. Such a run now writes nothing, and reports `Generated 0 file(s)`.
- **The section list is derived.** `translationModuleSections(bundle, kind)` sits beside `translationModulePayload` and is switched on the same `kind`, so what a module holds and which sections it commits are one decision rather than two. Under `kind: 'stack'` the module holds every group the stack authors and the caller now names all of them; a group added later needs no edit, and a further aggregate kind fails to compile at that one site rather than silently committing its own name as a section.

**No provenance record changes in this repository, and none is restored.** The generated tables only ever carry the two sections `collectFilledFromHashes` walks (`objects` and `metadataForms`), so `'objects'` was the right name for both stack sub-tree modes — the old list was correct by coincidence, not by construction. In particular an `apps.*` record is not restored by this change: no such record is built, so none was being filtered out.

**Already committed an empty companion?** Nothing needs doing and nothing is deleted. `--check` compares only the files a run writes and reports `missing` / `stale` over that set, so a leftover empty companion is in neither category — it is tolerated where it sits, and is inert to the next extract, which reads it back as an empty record set exactly as it would read its absence. Delete it at your convenience.
