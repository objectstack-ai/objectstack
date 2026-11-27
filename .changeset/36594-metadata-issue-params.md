---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol): a `422 INVALID_METADATA` issue entry carries the registered refusal on `params`, so a client of the save door can read the code

Clause-②: yes (widening)
Metadata-protocol: none

A spec rule that owns a registered error code stamps it on its zod issue as `params.code`, next to the fields that say which fix applies: `CONTROLLED_BY_PARENT_MASTER_INVALID` with `shape` (an object save), and `PLUGIN_UI_REQUIRED_KEY_MISSING` with `key` (`PluginSchema`, which no save-door type parses today). zod reports every such rule with its own issue code `'custom'`. The metadata save door's `422 INVALID_METADATA` built each `issues[]` entry from `path`, `message` and that `'custom'` only, so a client of the door (anything that does not parse locally the way Studio does) could not tell which rule refused the body except by its English message.

- **`@objectstack/metadata-protocol`.** The save door's 422 entry gains an optional `params` member: the registered refusal the issue carries, present only when the issue's `params.code` is a registered error code, and holding only its string, finite-number and boolean members. An object save refused for a `controlled_by_parent` master now answers `{ path: 'fields', code: 'custom', message, params: { code: 'CONTROLLED_BY_PARENT_MASTER_INVALID', shape: 'master-not-writable' } }`. Read the registered code from `params.code`. `zodIssuesToMetadataIssues` takes a new option, `refusalParams`, which only the save door sets. The read path's `_diagnostics.errors[]` and the seed refusal's `seedApplied.issues[]` keep exactly `path`, `message` and `code`, the shape their spec schemas publish.
- **`@objectstack/spec`.** The `CONTROLLED_BY_PARENT_MASTER_INVALID` docblock and its ledger note now say the save door's 422 carries the code on `params.code`.

Nothing to migrate. The entry's `code` is unchanged (still zod's issue code, `'custom'` for these rules), and an entry that carries no registered refusal gets no `params` member, so a client that matches `code` or compares whole entries for other issues reads exactly what it read before.
