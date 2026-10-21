---
'@objectstack/spec': minor
'@objectstack/metadata-core': minor
'@objectstack/platform-objects': patch
---

fix(spec)!: the `Field.select` string shorthand keeps every character it does not document transforming, so an option such as `'no-overlay'` is refused instead of being declared as a different value

Clause-②: no (narrowing: a `Field.select` shorthand string the helper used to rewrite silently, e.g. `'no-overlay'` → `nooverlay`, is refused instead)

Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: the shorthand is a TypeScript helper that runs in the author's own module, before any metadata exists, and what it hands on is an ordinary explicit option list. No spec key, stored shape or schema accept set changes: `SelectOptionSchema.value` refuses exactly what it refused before, and an object definition already stored or built from the old helper carries explicit values (`nooverlay`) that still parse, so there is nothing for `objectstack migrate meta` to rewrite. The one object definition that changes is `sys_metadata_audit`, a platform object `@objectstack/metadata-core` ships and owns: its `lock_state` column becomes a 255-character text column, its rows are audit records the metadata protocol writes, not metadata, no stored row is rewritten, and an existing column reports no drift. The other categories are closed on facts: every bumped package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a TypeScript author's shorthand that used to be rewritten is now refused), shipped as `minor` under the launch-window convention for breaking changes.

`Field.select(['a', 'b'])` and `Field.select({ options: ['a', 'b'] })` build each option as `{ label: s, value: … }`. The value used to be the string lower-cased, with whitespace turned into `_`, and then with every character outside `a-z`, `0-9` and `_` deleted. That last step was undocumented and silent: `'no-overlay'` became `nooverlay`, `'user-agent-based'` became `useragentbased`, `'v1.2'` became `v12`, and the field declared a value its author never wrote, so a record written with the value as written was refused with `invalid_option`.

- **FROM:** a shorthand string is lower-cased, whitespace becomes `_`, and every other character outside `a-z0-9_` is deleted. `Field.select(['no-overlay'])` declares the option value `nooverlay`, and the object loads.
- **TO:** a shorthand string is lower-cased and whitespace becomes `_`, nothing else. `Field.select(['no-overlay'])` declares `no-overlay`, which is not a system identifier, so the object is refused by the rule an explicit `{ value: 'no-overlay' }` already met: `ObjectSchema.create` throws a `ZodError` at module load with `invalid_format` at `fields.FIELD.options.N.value` and the message `System identifier must be lowercase, starting with a letter, and may contain letters, numbers, underscores, or dots`, and the object save door answers `422 INVALID_METADATA` with the same finding. A dot is now kept (`'v1.2'` declares `v1.2`, which is a valid identifier).
- **Unchanged:** `Field.select(['In Progress', 'Closed Won'])` still declares `in_progress` and `closed_won`. An explicit option's value is still lower-cased. `SelectOptionSchema.value` accepts and refuses exactly what it did before.
- **The fix:** write such an option explicitly, with the value you will store: `Field.select({ options: [{ label: 'no-overlay', value: 'no_overlay' }] })`. If rows already hold the hyphenated spelling, the column is not a select: declare it as `Field.text({ maxLength: 255 })`.

`@objectstack/metadata-core`: `sys_metadata_audit.lock_state` was the one in-tree column relying on the strip. It declared the options `none`, `nooverlay`, `nodelete` and `full`, while its writer stores the `MetadataLock` spelling (`none`, `no-overlay`, `no-delete`, `full`), so no `no-overlay` or `no-delete` row ever matched a declared option. It is now `Field.text({ maxLength: 255 })`, read-only as before. `GET /api/v1/meta/object/sys_metadata_audit` serves `lock_state` as `type: 'text'` with `maxLength: 255` and no `options`. No stored row is rewritten, the writer and reader are unchanged, and an existing `varchar(255)` column reports no schema drift on postgres, mysql or sqlite.

`@objectstack/platform-objects`: the translation bundles drop the four `sys_metadata_audit.lock_state` option labels (`none`, `nooverlay`, `nodelete`, `full`), which the column no longer declares. The field label stays translated.
