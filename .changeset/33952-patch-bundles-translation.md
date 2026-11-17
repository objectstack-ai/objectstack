---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
---

feat(i18n): a dependent package's `fieldPatches` text is translated from that package's own translations

Clause-②: yes (widening) — `TranslateDocumentOptions` gains an exported member, `patchBundles`; nothing accepted before is refused
Metadata-protocol: semantic — a dependent package's translations of its own `fieldPatches` text now take effect on `/meta` and on the public form
Skills-docs: follow-up owed — skills/objectstack-data/SKILL.md (the `fieldPatches` paragraph); `content/docs/data-modeling/object-extensions.mdx` teaches the rule in this change

A code package that relabels a vendor's field with `fieldPatches` (ADR-0146 D10) can now translate the text it writes. Before this change, a patched label, help text, description or option label was served exactly as the patch wrote it in every locale: a patched slot read only the pair `.custom` package's catalog, and the deployment catalog merges every package's translations with the package ids dropped, so the patching package's own `zh-CN` rows for the slot never applied.

A patched slot now reads, in order:

1. the pair `.custom` package's translation of that key, as before;
2. the translations of the code package whose patch wrote the served value: its shipped `translations` and its own active translation rows;
3. the served text.

The owner's translation of the text the patch replaced never applies to a patched slot, as before. A slot the patch did not write (a tenant's rename on top of it) keeps its own text. When two packages patch the same slot, the slot reads the package whose text it serves. Nothing is stamped on the served document: which package wrote a slot is found by comparing the served value with the packaged base plus that one package's patches (ADR-0029 D9.2a).

New reads beside the option: `SchemaRegistry.getPackagedFieldPatchBases(name)` and `ObjectStackProtocolImplementation.getPackagedFieldPatchBases(name)` (one entry per patching code package, highest precedence first) and `ObjectStackProtocolImplementation.getPackageTranslationBundle(packageId)` (one package's own translations, locale-keyed). The `/meta` object item and list reads and `GET /forms/:slug` pass `patchBundles` to the translator.
