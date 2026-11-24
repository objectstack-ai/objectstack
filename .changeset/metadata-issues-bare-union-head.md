---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a refused metadata save no longer lists zod's bare "Invalid input" union entry ahead of the entries that explain it

Clause-②: no (narrowing) — narrowed: the `issues[]` of a refused metadata save (`422 INVALID_METADATA`), a stored item's `_diagnostics.errors`, the seed-request refusal's `issues` and the unmanaged-import `400` no longer carry a union's own `invalid_union` entry when its message is zod's bare `Invalid input` and an entry below it explains the failure. `issues[0]` of a refused view save is now the first located cause.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moves is which entries a refusal's issues list carries, computed afresh on every refused save and every read. The accept set is unchanged. The one reading instruction is in the body: read entries by path and code, never by index. -->

**BREAKING** for a client that reads a refused metadata save's `issues[]`, or a stored item's `_diagnostics.errors`, by position, or that looks for a root `invalid_union` entry. That entry said only `Invalid input` and named no key; the entries that name the key were always further down the same list, and they are now first. Read entries by `path` and `code`, not by index.

| Refused save | Was | Now |
|:--|:--|:--|
| A list view with a typo in a column's `summary` key | `issues[0]` is `{ path: '', code: 'invalid_union', message: 'Invalid input' }`, then the `unrecognized_keys` entry | `issues[0]` is the `unrecognized_keys` entry naming `type` and `columns` |
| A view whose `label` is a map keyed by something other than a locale | `invalid_union` / `Invalid input` at `''` and again at `label`, then two `label.not_a_locale` entries | only the two `label.not_a_locale` entries: `invalid_key`, then the locale-tag prescription |
| The `meta-envelope` face's headline for the first row | `2 issues — (root) [invalid_union]; (root) [unrecognized_keys]` | `1 issue — (root) [unrecognized_keys]` |

The headline's root locator is the angle-bracketed word `root`; it is spelled `(root)` above only so this changelog renders it.

**What stays.** A union entry is kept, ahead of what it explains, in every other case:

- its message is the schema's own sentence rather than zod's default. An object whose `titleFormat` is written as a formula still gets, first, the template slot's sentence telling the author to write `'{{record.name}}'`; the entry below it says only `expected "template"`, so dropping the first would drop the fix. An action's `confirmText` written as a formula is the same.
- nothing below explains it: every branch only says the value is the wrong kind (a view's `label: 42`), or the nesting bound was reached. Then it is the whole answer for that slot.
- it is a container's entry (`invalid_key`, `invalid_element`): its code is the one place that says the key was refused rather than the value under it.

The comparison is against zod's exact default text, held in one constant in the producer and pinned against a real zod parse, so a zod upgrade that rewords the default fails a test instead of quietly bringing every such entry back.

**Unchanged, on purpose.** The terminal renderer (`formatZodError`, the CLI) still prints the union line as the parent of its indented tree, and the data API's `fields[]` (`zodIssuesToFields`, `400 VALIDATION_ERROR`) still carries it as an `invalid_shape` entry; whether that one follows is #35433. The cross-package parity test records the asymmetry.

**Known regression, until #35499 lands.** Studio's metadata form draws a refusal's entry on a field row only when the entry's path equals that row's key. On about 25 top-level keys (for example a view's `label`, `description`, `columns` and `exportOptions`) the dropped entry was the only one at that exact path, so after a refused save that row shows one red line fewer: the `Invalid input` line. The place is still named by the entries themselves and in the Save button's tooltip, and on a type with a live validator the next edit redraws the row. #35499 makes the form show the located cause on the row it sits under.
