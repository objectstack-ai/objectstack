---
'@objectstack/rest': patch
---

fix(rest)!: `POST /api/v1/meta/:type/:name/rollback` accepts only a positive integer as `toVersion`, and refuses everything else with its own `400 INVALID_REQUEST` instead of coercing it into a version

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type, flag or error code is added, removed or renamed: the refusal is the door's existing `INVALID_REQUEST` with its existing message. What narrows is one REST door's accept set for a request value, and the remedy is the caller sending a JSON number. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the rollback door's accept set narrows), shipped as `patch`: it changes which requests one REST door serves, not what a metadata author can write.

The rollback door read its version with a bare `Number(...)` and accepted any result that was finite and at least 1. So `{"toVersion": true}` restored version 1, `{"toVersion": [2]}` and `{"toVersion": "2"}` restored version 2, and `{"toVersion": 1.5}` reached the protocol and answered `404 VERSION_NOT_FOUND`. This is the door that makes a caller-supplied version the live row, and its own refusal already said `'toVersion' (positive integer) is required`.

- **FROM:** a JSON body `toVersion` (or its `version` alias) that `Number()` turned into a number of at least 1 restored that version: a boolean, a one-element array, a numeric string. A fractional value answered `404`.
- **TO:** the body value must be a JSON number that is a whole number of at least 1. A `?toVersion=` query string is read the way `/diff` reads its versions (`readDeclaredQueryNumber`), so `?toVersion=3` still restores version 3. Everything else, `true`, `[2]`, `"2"`, `1.5`, `0`, `-1`, `"abc"`, a blank or non-finite query value, answers `400 INVALID_REQUEST` with the same message as before, and nothing is restored.
- **Unchanged:** the precedence (`toVersion`, then `version`, then `?toVersion=`), the capability and walled-catalog gates in front of it, and every answer for a valid version. The client SDK's `rollbackItem` and the console's metadata client already send a JSON number.
- **Fix:** send `toVersion` as a JSON number, for example `{"toVersion": 2}`.
