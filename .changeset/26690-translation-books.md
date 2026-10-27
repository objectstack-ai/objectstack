---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/cli': minor
---

feat(spec,rest,cli): a doc book's title and section titles are translatable — `books.<name>` in the translation bundle

Clause-②: yes (widening)
Metadata-protocol: added

A package that ships its docs in two languages showed a half-translated manual: each doc's body followed the reader's locale (`doc.translations`, `<name>.<locale>.md`), but the book title and every sidebar section title stayed in the authoring language. The book's own inline `translations` map was retired in 17.0.0 because nothing read it, and the translation bundle had no key for a book.

- **`@objectstack/spec`:** `TranslationData` (and the registered `translation` item and the platform bundle, which share its groups) gains `books`, keyed by the book's `name`: `label`, `description`, and `groups.<key>.label` for each group by its stable `key` (strict: any other key is refused; `name` / `title` point at `label`, and `sections` / `chapters` / `toc` point at `groups`; the singular group spelling `book` points at `books`). A new translator, `translateBook`, overlays them and is registered in the metadata-document dispatch, so `GET /meta/book` (list and item) is served in the request's locale. A key the bundle does not carry keeps the authored string. The rejection for the retired inline `translations` map on a book now names the bundle keys to move the strings to.
- **`@objectstack/rest`:** `GET /meta/book/:name/tree` translates the book it resolves through the same dispatch before rendering the spine, so the tree, the book list and the console's docs sidebar agree. `MetaBookTreeSources` gains `resolveI18nService()`, which both transports supply.
- **`@objectstack/runtime`:** the dispatcher's book-tree route supplies the same i18n service, so it answers the localized tree `RestServer` answers.
- **`@objectstack/cli`:** `os i18n extract` scaffolds `books.<name>.label` / `.description` and `books.<name>.groups.<key>.label` from the stack's `books[]`, and `os i18n check` / `os lint` coverage report an untranslated one as `i18n/missing-book`.

Example (`zh-CN` bundle of an English-authored package):

```ts
books: {
  crm_manual: {
    label: '使用手册',
    groups: { start: { label: '快速上手' }, pipeline: { label: '销售管道' } },
  },
},
```
