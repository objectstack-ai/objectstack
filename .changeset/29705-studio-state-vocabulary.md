---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

refactor(i18n, app-shell)!: Studio names an item's state with one word everywhere

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the four retired keys are rows of the Studio designer's own string table (the studio namespace of @object-ui/i18n, typed as a plain string record, outside the locale packs and TranslationKeys); no packages/spec schema, stored shape or metadata names them, and after this change no t() call in the workspace reads them -->

The All metadata tiles, the list and item headers, the rail marks and the landing now use the words the Studio pillars use for an item's state: Read-only, Writable, Can be customized, Can be added, Customized, Added and Switched off (zh: 只读, 可写, 可定制, 可新增, 已定制, 新增, 已停用).

A tile's word answers "what can I do here" for the open package. On a read-only package (a code or installed package), a type that takes a customization reads "Can be customized" instead of "writable"; any other type there reads "Read-only", because the All metadata area offers no create on a read-only package. On a writable package, an overlay type reads "Writable" and a create-only type reads "Can be added". The `OS_METADATA_WRITABLE` hatch opens nothing on a read-only package, so its types read "Read-only" there. The list and item headers draw the same word as the tile.

The All metadata lead sentence now says what a person can do, without counting protocol types, and the "Writable only" filter is now "Hide read-only". The flow status that read "Off" now reads "Switched off", as the landing's count already did.

In zh, the Access sharing settings drop their English doublets: `Private 私有` reads `私有`, `Public read 公共只读` reads `公共只读`, `Public read/write 公共读写` reads `公共读写`, `Controlled by parent 受父级控制` reads `受父级控制`, and the matrix's bare `OWD` column reads `记录共享模型`. English is unchanged.

**BREAKING** (`@object-ui/i18n`): four keys of the Studio namespace retire. A `t()` call that still names one reads the key back.

| Removed key | Replacement |
|:---|:---|
| `engine.badge.readOnly` | `engine.studio.pkg.readonly` |
| `engine.badge.writable` | `engine.studio.pkg.writable` on a writable package, `engine.studio.customize.available` on a read-only one |
| `engine.badge.createOnly` | `engine.studio.customize.addable` |
| `engine.directory.writableOnly` | `engine.directory.hideReadOnly` |

New keys: `engine.studio.customize.available`, `engine.studio.customize.availableTitle`, `engine.studio.customize.addable`, `engine.studio.customize.addableTitle`, `engine.directory.hideReadOnly`. `engine.directory.description` no longer takes the `count` and `writable` placeholders.
