---
'@objectstack/lint': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

refactor(lint): the i18n translatable-key walk moves from the CLI into `@objectstack/lint`

Clause-②: no
Metadata-protocol: none

`collectExpectedEntries` — the one definition of which translation keys a stack can carry, each with the source text it translates — now lives in `@objectstack/lint` (`src/i18n-walk.ts`) and is exported from the package root with `authorWarnedTranslationGroups`, `humanizeFieldPath` and the `ExpectedEntry` / `ExpectedEntryOptions` types. It moved so a browser can run the same walk the CLI runs: Studio's translation editor builds its source-to-translation table from it. `os i18n extract` and `os lint`'s translation coverage keep reading it unchanged, through the CLI's extractor module, which keeps bundle assembly and serialization and re-exports the walk.

- No key, no skeleton and no coverage verdict changes: the walk's code moved as is.
- In a browser the walk cannot read the liveness ledger from disk, so its default leaves no translation group out. That is the same set the CLI leaves out today, because the ledger warns on no translation group; a browser caller that must honour a warned group passes `warnedGroups`.
- `@objectstack/spec`: the `action` and `view` liveness ledgers cite the walk at its new path.
