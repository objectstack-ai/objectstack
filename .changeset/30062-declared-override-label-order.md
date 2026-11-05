---
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
---

fix(metadata-protocol,rest): a `.custom` pair's declared override of a page, dataset, app, book, dashboard, view or report is labelled in the ruled order on every `/meta` read — the pair's own translation, then the override's own label, then the base's translation (#30062)

Clause-②: yes (widening) — `ObjectStackProtocolImplementation` gains six public methods: `getPackagedPageBase`, `getPackagedDatasetBase`, `getPackagedAppBase`, `getPackagedBookBase`, `servedOverrideBaseOf` and `getPairTranslationBundle` (measured on `packages/metadata-protocol/dist/index.d.ts`); `@objectstack/rest`'s exported `MetaBookTreeSources` accepts one more optional key, `resolveProtocol` (measured on `packages/rest/dist/index.d.ts`). No accepted key, value or answer is taken away.
Metadata-protocol: semantic

- **Now.** A changed label on a declared override reads the pair's own translation of that key when the pair ships one, else the override's own text, in every locale, on `GET /meta/:type/:name`, `GET /meta/:type` and `GET /meta/book/:name/tree`. An unchanged label still reads the base's translation. Before, a page, dataset, app or book override read the base's translation over its own changed label, and no type read the pair's translation first.
- **The pair's translations.** They are the pair's own active `translation` rows (`package_id` = the pair). A `.custom` package has no code bundle, so it has no code translation source. A package-less authored row is in the deployment catalog but is not the pair's, so it does not rank first.
- **Object.** An object is extended, never replaced (ADR-0146 D10), so it has no declared override and no pair bundle: seven types take one.
- **The book tree.** `GET /meta/book/:name/tree` now judges a book against its packaged base as the list does, so the docs sidebar and the book list serve the same label (#26690).
