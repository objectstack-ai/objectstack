---
'@objectstack/service-settings': minor
---

fix(service-settings)!: a settings value that misses the format its `email`, `url`, `phone` or `color` type declares is refused, both when it is saved and when it arrives as an `OS_*` override (#24882)

ADR-0007 declares a format for four specifier types: `email`, `url` and `phone` take "format validation", and `color` takes a hex string. Until now nothing enforced it. `PUT /api/settings/branding` stored a Logo URL of `not a url` and answered `200`, and an `OS_*` override was served whatever it held. Both doors now judge the format through one shared check, after every other declared constraint, and refuse a value that misses it.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which runtime values two settings doors accept: a value saved through `PUT /api/settings/:namespace` or `setMany`, and a deployment's `OS_*` environment override. Settings values are runtime state in `sys_setting` (ADR-0007) and environment values belong to the deployment, and no metadata conversion reaches either; a row already stored is not rewritten and is still served. The remedy is to supply a well-formed value, never a rewrite of a metadata source. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the settings doors' accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

The formats are the platform's existing grammars for the same words:

- `email`: an address with a dotted domain, the grammar the mail transport sends with. `no-reply@localhost` misses it.
- `url`: `scheme://…`, a root-relative `/path`, a `data:` URI or a `blob:` URL. A relative logo path that the branding reader serves is accepted.
- `phone`: digits, spaces and `+ ( ) - .`, at least five characters.
- `color`: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.

Empty values and non-string values are not judged. Surrounding whitespace is ignored, because the readers trim it before use.

What changes:

- **Saving, FROM:** a save naming a value that misses its key's format answered `200` and stored the value as written.
- **Saving, TO:** the save answers `400` with `error.code: 'SETTINGS_VALIDATION'` and one entry per such key in `error.details.fields`, carrying `code` `invalid_email`, `invalid_url`, `invalid_phone` or `invalid_format` (for `color`), and `constraint.type`. Nothing in the save is stored. The answer names the expected format and never echoes the value.
- **Environment override, FROM:** a malformed `OS_*` override was in force: reads served it with source `env`, and it locked the key against saves.
- **Environment override, TO:** a malformed `OS_*` override is no longer in force. The server logs one `error` line per variable and value, naming the variable, the setting, the type and the expected format, never the value. Reads serve the next layer instead: the stored value when one exists, otherwise the manifest default, with that layer as the source. The key is no longer locked, so it can be saved through Setup.
- **Unchanged:** a well-formed value saves, and a well-formed override is in force and locks the key. A value that breaks another declared constraint (a length bound, a pattern) is still refused for that constraint. A value stored before this release is still served by every read, and it does not block a save of the namespace's other keys; only a save that writes that key, or a key its `visible` condition reads, judges it. An all-null save (reset) still clears it.
- **What to do:** fix the value. For an `OS_*` override, set the variable to a well-formed value or unset it and configure the setting in Setup. For a stored value, save a well-formed value for the key, or clear it.
