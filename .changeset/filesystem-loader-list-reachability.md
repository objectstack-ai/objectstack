---
"@objectstack/metadata": minor
---

fix(metadata): `FilesystemLoader.list()` reports only names `findFile()` / `load()` / `exists()` can resolve

**BREAKING (list output narrows).** Two shapes stop appearing in
`FilesystemLoader.list()`, and therefore in `MetadataManager.listNames()`:

- **nested files** — `ROOT/TYPE/crm/account.json` was listed as `account`, a
  name that resolves against `ROOT/TYPE/account.json` and finds nothing;
- **extension-less files** — `ROOT/TYPE/noext` was listed as `noext`, which
  resolves under no appended extension at all.

A third shape follows from the same rule rather than from a rule of its own:
the extensions a name can be resolved under are now the ones belonging to the
loader's **registered serializers**, so under the manager's default format set
(`typescript` / `json` / `yaml`) a `.js` file leaves `list()` too. It was
previously listed and resolvable while `loadMany()` could never return it and
`load()` threw `No serializer found for format: javascript`. Register the
`javascript` serializer and it is listed, resolvable and loadable together.

`list()`, `findFile()` and `loadManyKeyed()` now share one name-to-path
derivation, so `listNames()` and `get()` give the same answer. Previously a name
could sit in the list while `get()` answered `null` for it — a silent failure an
author reads as their own typo.

Nothing changes for a tree whose metadata is laid out as `ROOT/TYPE/NAME.json`
(or `.yaml` / `.yml` / `.ts`), which is the layout ADR-0008 §10 already
prescribes and `metadata-fs`'s `parseItemPath()` already enforces. `.yaml`,
`.yml` and `.ts` are unaffected: the extension set follows the registered
serializers, not §10's `.json`-only rule, which governs the `metadata-fs` store.

`loadMany()` is unchanged and still returns bodies for nested and
extension-less files; `findFile()` still resolves an explicitly path-shaped
name such as `crm/account`, which nothing lists.

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, Zod schema or stored row moves: this narrows one runtime loader's `list()` output. The ledger's artifacts project metadata rewrites, and there is nothing here for `objectstack migrate meta` to rewrite — a tree carrying a nested or extension-less file needs the FILE relocated into the two-segment layout ADR-0008 §10 already prescribes, which no migration prescription can express. -->
