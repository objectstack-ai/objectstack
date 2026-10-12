---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': patch
---

fix(metadata-protocol): two locales of one email template saved through the metadata door both survive a restart — an overlay row is keyed by its bundle member (#22877)

Clause-②: no

**What an administrator sees.** Saving the same email template in two languages through the metadata door (`PUT /api/v1/meta/email_template/:name`, the Studio editor's save) keeps both. Before, the store kept one overlay row per template name, so the second language's save replaced the first language's row: both read back until the next restart, and then the first language mailed the package wording again. Each language now keeps its own wording across restarts, and each send in that language uses it.

**What changed in the store.**

- `sys_metadata` gains one nullable column, `bundle_member`. It holds the member of a metadata type whose identity is a pair — today `email_template`, identified by `(name, locale)`. NULL is the canonical member (`en-US`, the locale a send falls back to). Every other row stays NULL, so rows of every other type, and an `en-US` template row, are byte-identical to before.
- The value is taken from the saved body's `locale`; it is never authored. A body that declares no `locale` is the `en-US` member.
- The overlay uniqueness index becomes `(type, name, organization_id, COALESCE(package_id, ''), COALESCE(bundle_member, ''))`, for active rows and for draft rows, and the declared index in `metadata-core` carries the column too. A second row for the same template, language, package and state is refused by the index.

**What a read or a door addresses.** A save addresses the language its body names. A read, delete, publish, history or revert by name that names no language addresses the `en-US` member: `GET /meta/email_template/:name` serves the `en-US` wording (the stored one when it was customized, else the package's), where before it served whichever row the name had. The layered list and the send path serve every language as before. A non-`en-US` language's own customization is reached through the list, and is replaced by a save that names its `locale`; a by-name reset (`DELETE`) removes the `en-US` customization only. The lineage counter stays one per template name, so a version number names one saved snapshot, and a revert by name restores only a version of the `en-US` member.

**What happens on the first boot after upgrading.** Nothing to configure.

1. The schema sync adds the `bundle_member` column.
2. Boot hydration gives every `email_template` row stored before the column existed the member its body declares, so a row an earlier save left holding a second language's wording becomes that language's row, not the `en-US` one. Rows of every other type are not read or written.
3. The first metadata write rebuilds the overlay index with the new key, through the existing probe-then-replace order. Adding a key part only relaxes uniqueness, so no rows a store already holds can block the rebuild; a store that was already blocked is reported as before, with the duplicate-listing query and `os migrate duplicates`.

`os migrate duplicates` boots read-only and adds no column: run against a store this version has not booted yet, it reports the two overlay indexes `unreadable` (the column does not exist yet) rather than `clear`. Boot the server once, then re-run it.
